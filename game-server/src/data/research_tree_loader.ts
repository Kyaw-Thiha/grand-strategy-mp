import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

/** Effect shapes a completed research node can carry (RESEARCH.md's Perk Taxonomy). */
export type ResearchEffect =
  | { type: "perk"; perk_id: string }
  | { type: "unlocks_unit_type"; unit_type: string };

export interface ResearchNodeDef {
  id: string;
  branch: string;
  unit_id?: string;
  building_id?: string;
  path_id: string;
  tier: number;
  mutex_group_id: string | null;
  name: string;
  // Card/glance text (RESEARCH_UI_HANDOFF.md §5/§6.1) — short_description is what a card or
  // hover tooltip shows; description is the fuller text the click-to-open popup shows
  // (Branch C consumes both; Branch A's minimal UI shows short_description on cards).
  short_description: string;
  description: string;
  cost: { money: number; science: number };
  badges: string[];
  size: "minor" | "notable";
  requires: string[];
  image_asset: string;
  effects: ResearchEffect[];
}

// Every branch file under client/assets/data/research/. `naval` is an explicit empty-array
// stub per Phase 11's own scope (no Naval doctrine content this phase).
export const RESEARCH_BRANCH_FILES: string[] = [
  "armour",
  "infantry",
  "ordnance",
  "air",
  "naval",
  "economy_buildings",
  "general",
];

function researchAssetPath(branchFile: string): string {
  const __dir = dirname(fileURLToPath(import.meta.url));
  // From game-server/src/data/ → game-server/ → repo root → client/assets/data/research/
  return join(__dir, "../..", "..", "client", "assets", "data", "research", `${branchFile}.json`);
}

function fail(branchFile: string, reason: string): never {
  throw new Error(`[ResearchTreeLoader] ${reason} (file: ${branchFile}.json)`);
}

/** True for a sample-content disclaimer entry (`{"_comment": "..."}`), skipped during load. */
function isCommentEntry(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "_comment" in (raw as Record<string, unknown>) &&
    Object.keys(raw as Record<string, unknown>).length === 1
  );
}

function validateNodeShape(raw: unknown, branchFile: string): ResearchNodeDef {
  const n = raw as Partial<ResearchNodeDef> & Record<string, unknown>;
  if (typeof n.id !== "string" || n.id.length === 0) {
    fail(branchFile, `node missing string 'id': ${JSON.stringify(raw)}`);
  }
  if (typeof n.branch !== "string") fail(branchFile, `node ${n.id} missing 'branch'`);
  if (typeof n.path_id !== "string") fail(branchFile, `node ${n.id} missing 'path_id'`);
  if (typeof n.tier !== "number") fail(branchFile, `node ${n.id} missing numeric 'tier'`);
  if (typeof n.name !== "string") fail(branchFile, `node ${n.id} missing 'name'`);
  if (!Array.isArray(n.requires) || !n.requires.every((r) => typeof r === "string")) {
    fail(branchFile, `node ${n.id} has malformed 'requires' (must be string[])`);
  }
  if (!Array.isArray(n.badges)) fail(branchFile, `node ${n.id} missing 'badges' array`);
  if (n.size !== "minor" && n.size !== "notable") {
    fail(branchFile, `node ${n.id} has invalid 'size' (must be "minor" or "notable")`);
  }
  if (!n.cost || typeof (n.cost as { money?: unknown }).money !== "number") {
    fail(branchFile, `node ${n.id} missing numeric 'cost.money'`);
  }
  if (!Array.isArray(n.effects)) fail(branchFile, `node ${n.id} missing 'effects' array`);
  return {
    id: n.id as string,
    branch: n.branch as string,
    unit_id: typeof n.unit_id === "string" ? n.unit_id : undefined,
    building_id: typeof n.building_id === "string" ? n.building_id : undefined,
    path_id: n.path_id as string,
    tier: n.tier as number,
    mutex_group_id: typeof n.mutex_group_id === "string" ? n.mutex_group_id : null,
    name: n.name as string,
    short_description: typeof n.short_description === "string" ? n.short_description : "",
    description: typeof n.description === "string" ? n.description : "",
    cost: { money: (n.cost as { money: number }).money, science: (n.cost as { science?: number }).science ?? 0 },
    badges: n.badges as string[],
    size: n.size as "minor" | "notable",
    requires: n.requires as string[],
    image_asset: typeof n.image_asset === "string" ? n.image_asset : "",
    effects: n.effects as ResearchEffect[],
  };
}

/** Reads and validates one branch file's node array. Throws on any malformed node. */
export function loadResearchBranch(branchFile: string): ResearchNodeDef[] {
  const path = researchAssetPath(branchFile);
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    fail(branchFile, `file not found or unreadable at ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(branchFile, "invalid JSON");
  }
  if (!Array.isArray(parsed)) fail(branchFile, "expected a top-level JSON array");
  const nodes: ResearchNodeDef[] = [];
  for (const raw of parsed) {
    if (isCommentEntry(raw)) continue;
    nodes.push(validateNodeShape(raw, branchFile));
  }
  return nodes;
}

export interface ResearchTree {
  nodes: Map<string, ResearchNodeDef>;
}

let _cachedTree: ResearchTree | null = null;

/**
 * Loads every branch file into one node map and cross-validates `requires` references.
 * Cached after first call — call `clearResearchTreeCache()` in tests that mutate the
 * underlying JSON files between assertions.
 */
export function loadResearchTree(): ResearchTree {
  if (_cachedTree) return _cachedTree;
  const nodes = new Map<string, ResearchNodeDef>();
  for (const branchFile of RESEARCH_BRANCH_FILES) {
    for (const node of loadResearchBranch(branchFile)) {
      if (nodes.has(node.id)) fail(branchFile, `duplicate node id '${node.id}' across branch files`);
      nodes.set(node.id, node);
    }
  }
  for (const node of nodes.values()) {
    for (const reqId of node.requires) {
      if (!nodes.has(reqId)) {
        throw new Error(
          `[ResearchTreeLoader] node '${node.id}' requires nonexistent node_id '${reqId}'`,
        );
      }
    }
  }
  _cachedTree = { nodes };
  return _cachedTree;
}

export function clearResearchTreeCache(): void {
  _cachedTree = null;
}

/**
 * A node is available once it has no prerequisites (tier-1, free investment across paths
 * per RESEARCH.md) or once ANY one of its listed `requires` is researched — this is the
 * adjacency-web rule in practice: a tier-2+ node that lists both its own-path predecessor
 * and an adjacent path's same-tier node becomes reachable via either route, not just its
 * own path's progression.
 */
export function isNodeAvailable(
  tree: ResearchTree,
  nodeId: string,
  researchedNodeIds: ReadonlySet<string>,
): boolean {
  if (researchedNodeIds.has(nodeId)) return false;
  const node = tree.nodes.get(nodeId);
  if (!node) return false;
  if (node.requires.length === 0) return true;
  return node.requires.some((r) => researchedNodeIds.has(r));
}
