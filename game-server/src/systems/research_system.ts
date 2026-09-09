import type { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { loadResearchTree, isNodeAvailable, type ResearchNodeDef } from "../data/research_tree_loader.js";

export type BroadcastFn = (type: string, message: unknown) => void;

export interface ResearchProgress {
  node_id: string;
  points_remaining: number;
  points_total: number;
  // Set when this project, on completion, displaces an already-researched mutex sibling.
  // The sibling stays fully active until this instant — see RESEARCH.md's Respec section.
  respec_displaces: string | null;
}

export interface NationResearchData {
  nation_id: string;
  // Tracks completed NODE ids, distinct from NationState.researched_perks (which tracks
  // perk_ids specifically) — a node's effect may be unlocks_unit_type, not a perk at all.
  researched_node_ids: Set<string>;
  active_projects: ResearchProgress[];
}

// Flat placeholder progress rate — Branch A proves the tree mechanism stands on its own
// before Branch B wires the real money+science-funded rate on top (see RESEARCH.md's
// currency section and the Phase 9 Branch A precedent this branch's task file cites).
const RESEARCH_PROGRESS_PER_TICK_PLACEHOLDER = 1.0;

// Ordered lineage chains — a template referencing ANY entry resolves to the highest
// currently-researched entry in its chain. `unlocked_by_node_id: null` marks the chain's
// base tier, which is always resolvable (RESEARCH.md's "a template never breaks" guarantee)
// even with nothing researched yet. Chain order and unlock-node wiring are a separate
// concern from the JSON tree's own tier/requires shape — deliberately not derived from it.
interface LineageChainStep {
  unit_type: string;
  unlocked_by_node_id: string | null;
}
const LINEAGE_CHAINS: LineageChainStep[][] = [
  [
    { unit_type: "mechanised_infantry", unlocked_by_node_id: null },
    { unit_type: "improved_apc", unlocked_by_node_id: "armour_medium_improved_apc" },
    { unit_type: "ifv", unlocked_by_node_id: "armour_medium_ifv" },
  ],
];

function findLineageChain(unitType: string): LineageChainStep[] | undefined {
  return LINEAGE_CHAINS.find((chain) => chain.some((step) => step.unit_type === unitType));
}

/**
 * Resolves a requested unit type to the highest currently-researched tier in its lineage
 * chain. Pass-through for any unit type that isn't part of a lineage chain at all.
 */
export function resolveLineageUnitType(
  researchedNodeIds: ReadonlySet<string>,
  requestedUnitType: string,
): string {
  const chain = findLineageChain(requestedUnitType);
  if (!chain) return requestedUnitType;
  let resolved = chain[0].unit_type;
  for (const step of chain) {
    if (step.unlocked_by_node_id === null || researchedNodeIds.has(step.unlocked_by_node_id)) {
      resolved = step.unit_type;
    }
  }
  return resolved;
}

export class ResearchSystem {
  private data = new Map<string, NationResearchData>();

  /** Idempotent — safe to call every time a nation is set up. */
  init(nationId: string): void {
    if (this.data.has(nationId)) return;
    this.data.set(nationId, {
      nation_id: nationId,
      researched_node_ids: new Set<string>(),
      active_projects: [],
    });
  }

  private _get(nationId: string): NationResearchData {
    this.init(nationId);
    return this.data.get(nationId)!;
  }

  getResearchedNodeIds(nationId: string): ReadonlySet<string> {
    return this._get(nationId).researched_node_ids;
  }

  serialize(nationId: string): { researched_node_ids: string[]; active_projects: ResearchProgress[] } {
    const d = this._get(nationId);
    return {
      researched_node_ids: Array.from(d.researched_node_ids),
      active_projects: d.active_projects.map((p) => ({ ...p })),
    };
  }

  /**
   * Starts research on `nodeId` for `nationId`. No hard concurrency limit this branch
   * (RESEARCH.md: soft cost cap via Branch B's concurrency curve, never a hard slot limit).
   * Returns false (no-op) on: unknown node, already active, already researched (unless it's
   * a different option in the same mutex group — the respec case), or unmet prerequisites.
   */
  startResearch(nationId: string, nodeId: string): boolean {
    const tree = loadResearchTree();
    const node = tree.nodes.get(nodeId);
    if (!node) return false;
    const d = this._get(nationId);
    if (d.active_projects.some((p) => p.node_id === nodeId)) return false;
    if (d.researched_node_ids.has(nodeId)) return false;
    if (!isNodeAvailable(tree, nodeId, d.researched_node_ids)) return false;

    let respecDisplaces: string | null = null;
    if (node.mutex_group_id) {
      const sibling = this._findResearchedMutexSibling(tree, d, node.mutex_group_id, nodeId);
      if (sibling) respecDisplaces = sibling;
    }

    d.active_projects.push({
      node_id: nodeId,
      points_remaining: RESEARCH_PROGRESS_PER_TICK_PLACEHOLDER * 4,
      points_total: RESEARCH_PROGRESS_PER_TICK_PLACEHOLDER * 4,
      respec_displaces: respecDisplaces,
    });
    return true;
  }

  private _findResearchedMutexSibling(
    tree: ReturnType<typeof loadResearchTree>,
    d: NationResearchData,
    mutexGroupId: string,
    excludeNodeId: string,
  ): string | null {
    for (const researchedId of d.researched_node_ids) {
      if (researchedId === excludeNodeId) continue;
      const other = tree.nodes.get(researchedId);
      if (other && other.mutex_group_id === mutexGroupId) return researchedId;
    }
    return null;
  }

  /** Cancels an in-progress project. Progress resets to 0 — no partial state persists,
   *  restarting later begins from scratch. No refund this branch (Branch B adds the
   *  fixed-rate partial refund per RESEARCH.md's Cancelling In-Progress Research). */
  cancelResearch(nationId: string, nodeId: string): void {
    const d = this._get(nationId);
    d.active_projects = d.active_projects.filter((p) => p.node_id !== nodeId);
  }

  tick(state: GameRoomState, broadcast: BroadcastFn): void {
    const tree = loadResearchTree();
    for (const [nationId, d] of this.data) {
      // Nothing in flight for this nation this tick — no broadcast needed at all, not even
      // an unchanged snapshot.
      if (d.active_projects.length === 0) continue;

      const completed: ResearchProgress[] = [];
      for (const project of d.active_projects) {
        project.points_remaining = Math.max(
          0,
          project.points_remaining - RESEARCH_PROGRESS_PER_TICK_PLACEHOLDER,
        );
        if (project.points_remaining <= 0) completed.push(project);
      }

      const nation = state.nations.get(nationId);
      if (completed.length > 0) {
        d.active_projects = d.active_projects.filter((p) => !completed.includes(p));
        for (const project of completed) {
          const node = tree.nodes.get(project.node_id);
          if (!node) continue;
          d.researched_node_ids.add(project.node_id);
          if (project.respec_displaces) {
            d.researched_node_ids.delete(project.respec_displaces);
            const displacedNode = tree.nodes.get(project.respec_displaces);
            if (displacedNode && nation) this._removeNodePerkEffects(nation, displacedNode);
          }
          if (nation) this._applyNodeEffects(state, nationId, nation, node);
        }
        if (nation) nation.active_research_count = d.active_projects.length;
      }

      // Broadcast every tick a project is in flight, not just on completion — this is what
      // gives the client a smoothly-filling progress bar instead of a jump straight from
      // "just started" to "done" (the only two states a completion-only broadcast produces).
      broadcast("RESEARCH_UPDATES", { nation_id: nationId, ...this.serialize(nationId) });
    }
  }

  private _applyNodeEffects(
    state: GameRoomState,
    nationId: string,
    nation: NonNullable<ReturnType<GameRoomState["nations"]["get"]>>,
    node: ResearchNodeDef,
  ): void {
    for (const effect of node.effects) {
      if (effect.type === "perk") {
        if (!nation.researched_perks.includes(effect.perk_id)) {
          nation.researched_perks.push(effect.perk_id);
        }
      } else if (effect.type === "unlocks_unit_type") {
        this._migrateLineageUnitsForNation(state, nationId, effect.unit_type);
      }
    }
  }

  private _removeNodePerkEffects(
    nation: NonNullable<ReturnType<GameRoomState["nations"]["get"]>>,
    node: ResearchNodeDef,
  ): void {
    for (const effect of node.effects) {
      if (effect.type !== "perk") continue;
      const idx = nation.researched_perks.indexOf(effect.perk_id);
      if (idx >= 0) nation.researched_perks.splice(idx, 1);
    }
  }

  /** Re-resolves every grid cell of `nationId`'s divisions currently sitting on any tier of
   *  `unitType`'s lineage chain to the newly-highest-researched tier — this is what makes a
   *  fielded division's stats update live without re-saving its template (RESEARCH.md's
   *  Live Effective Stats guarantee), since combat/movement lookups key off `cell.unit_type`
   *  directly with no intermediate resolution step. */
  private _migrateLineageUnitsForNation(state: GameRoomState, nationId: string, unitType: string): void {
    const chain = findLineageChain(unitType);
    if (!chain) return;
    const chainUnitTypes = new Set(chain.map((s) => s.unit_type));
    const researchedNodeIds = this.getResearchedNodeIds(nationId);
    for (const division of state.divisions.values()) {
      if (division.nation_id !== nationId) continue;
      for (const cell of division.grid.cells) {
        if (chainUnitTypes.has(cell.unit_type)) {
          cell.unit_type = resolveLineageUnitType(researchedNodeIds, cell.unit_type);
        }
      }
    }
  }
}
