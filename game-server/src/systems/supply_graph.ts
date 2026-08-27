import type { SubprovinceGraph } from "../data/map_loader.js";

/**
 * Pure supply-routing core: given a subprovince adjacency graph, ownership snapshot, and a
 * set of hub cells, finds the cheapest path from a division's location to the nearest
 * reachable friendly (or requester-occupied) hub. Contains no caching, no mutation of its
 * inputs, and no I/O — callers own the graph/ownership snapshot and any memoization.
 *
 * NOTE: this module never assigns SupplyRoute.status === "encircled" — that requires a
 * ring-based Tier 3 check that is a later batch's responsibility (city cascade / siege logic).
 */

export type SupplyRoute = {
  divisionId: string;
  sourceHubId: string | null;
  subprovinceIds: string[];
  status: "open" | "degraded" | "cut_off" | "encircled";
  throughputRatio: number;
  blockedSubprovinceId: string | null;
};

const ROAD_THROUGHPUT = 1.0;
const OFF_ROAD_THROUGHPUT = 0.5; // tunable
const OPEN_THROUGHPUT_THRESHOLD = 0.9; // tunable: at/above this ratio -> "open", else "degraded"

function hopThroughput(kind: string): number {
  return kind === "road" ? ROAD_THROUGHPUT : OFF_ROAD_THROUGHPUT;
}

/**
 * Deterministic multi-target Dijkstra from startSubprovinceId to the nearest reachable hub.
 * NOTE: never assigns status "encircled" — that requires Batch 8's ring-based Tier 3 check.
 */
export function findSupplyRoute(
  graph: SubprovinceGraph,
  ownership: ReadonlyMap<string, { ownerId: string; provinceId: string }>,
  hubs: ReadonlySet<string>,
  startSubprovinceId: string,
  requestingNationId: string,
  isFriendly: (ownerId: string) => boolean,
  isOccupiedByRequester: (subprovinceId: string) => boolean,
  divisionId: string,
): SupplyRoute {
  if (!graph.nodes.has(startSubprovinceId)) {
    throw new Error(`findSupplyRoute: unknown startSubprovinceId "${startSubprovinceId}"`);
  }

  const validEdge = (subprovinceId: string): boolean => {
    const owned = ownership.get(subprovinceId);
    if (!owned) return false;
    if (isFriendly(owned.ownerId)) return true;
    return isOccupiedByRequester(subprovinceId);
  };

  const cost: Map<string, number> = new Map([[startSubprovinceId, 0]]);
  const prev: Map<string, string> = new Map();
  const visited: Set<string> = new Set();

  // Simple O(V^2) Dijkstra — subprovince counts are in the thousands, well within budget for a per-division-per-tick call.
  while (true) {
    let currentId: string | null = null;
    let currentCost = Infinity;
    for (const [id, c] of cost) {
      if (!visited.has(id) && c < currentCost) { currentCost = c; currentId = id; }
    }
    if (currentId === null) break;
    visited.add(currentId);

    if (hubs.has(currentId) && currentId !== startSubprovinceId) {
      return _buildRoute(graph, prev, currentId, startSubprovinceId, divisionId, isOccupiedByRequester);
    }
    if (hubs.has(currentId) && currentId === startSubprovinceId) {
      return { divisionId, sourceHubId: currentId, subprovinceIds: [currentId], status: "open", throughputRatio: 1, blockedSubprovinceId: null };
    }

    const neighborIds = [...(graph.neighbors.get(currentId) ?? [])].sort();
    for (const neighborId of neighborIds) {
      if (visited.has(neighborId)) continue;
      if (!validEdge(neighborId)) continue;
      const def = graph.nodes.get(neighborId);
      if (!def) continue;
      const edgeCost = 1 / hopThroughput(def.kind);
      const candidate = currentCost + edgeCost;
      const existing = cost.get(neighborId);
      if (existing === undefined || candidate < existing || (candidate === existing && _tieBreakPrefers(neighborId, prev, currentId, graph))) {
        cost.set(neighborId, candidate);
        prev.set(neighborId, currentId);
      }
    }
  }

  return { divisionId, sourceHubId: null, subprovinceIds: [startSubprovinceId], status: "cut_off", throughputRatio: 0, blockedSubprovinceId: null };
}

function _tieBreakPrefers(_neighborId: string, _prev: Map<string, string>, _currentId: string, _graph: SubprovinceGraph): boolean {
  // Cost-equal ties are exceedingly rare given continuous float costs; when they occur, keep the
  // first-found predecessor (do not overwrite) so the result only depends on sorted neighbor
  // iteration order, never on Map insertion order — this satisfies the determinism requirement.
  return false;
}

// --- Retreat-cost graph search -------------------------------------------------------------
//
// Unlike findSupplyRoute's valid_edge (hard block on non-friendly cells, with a narrow
// occupied-by-requester exception), retreat pathing must be able to cross *any* cell — per
// STRATEGIC_COMBAT.md's retreat-pathing paragraph: "cheapest path ... cost-weighted by
// ownership — friendly/allied cells cheap, contested cells medium, enemy/neutral cells
// expensive". That is a difference in the edge-validity predicate itself, not just a cost
// tweak, so it is implemented as a sibling search rather than a flag on findSupplyRoute.
//
// Cost tiers (all built on the same 1/throughput inversion findSupplyRoute already uses, so
// road cells keep their natural speed advantage in every tier with no special-casing):
//   friendly (isFriendly(owner))         -> 1 / hopThroughput(kind)            [1.0 .. 2.0]
//   contested (combat-frozen, non-friendly) -> RETREAT_CONTESTED_COST_MULTIPLIER * that  [5.0 .. 10.0]
//   enemy/neutral (everything else)      -> RETREAT_ENEMY_NEUTRAL_COST_MULTIPLIER * that [20.0 .. 40.0]
// The multipliers are chosen so the *ranges* never overlap (friendly max 2.0 < contested min
// 5.0 < contested max 10.0 < enemy/neutral min 20.0): the tier ordering (friendly < contested
// < enemy/neutral) holds regardless of road/off-road mix, so "retreat prefers friendly ground"
// is true by construction, not just true on average.
const RETREAT_CONTESTED_COST_MULTIPLIER = 5;
const RETREAT_ENEMY_NEUTRAL_COST_MULTIPLIER = 20;

export type RetreatPath = {
  subprovinceIds: string[];
  blockedFraction: number;
};

/**
 * Deterministic multi-target Dijkstra from startSubprovinceId to the nearest reachable
 * friendly-or-allied road-corridor cell or supply hub, per STRATEGIC_COMBAT.md's retreat-
 * pathing paragraph. Every cell is traversable (no hard block, unlike findSupplyRoute) — only
 * the per-hop cost differs by ownership tier; see the cost-tier comment above this function.
 *
 * Signature note (deliberate, documented deviation from the plan's sketch, not silent scope
 * creep): the plan's signature omitted `hubs` and `isCombatFrozen`. Both are added here because
 * neither is derivable from the other parameters:
 *   - `hubs`: STRATEGIC_COMBAT.md's target is "a friendly-or-allied road-corridor cell OR
 *     supply hub" — a hub is not defined by `kind === "road"` (e.g. capitals), so the target
 *     set cannot be expressed from `ownership`/`isFriendly`/`graph` alone. findSupplyRoute
 *     already takes `hubs` as an explicit snapshot for the same reason; mirrored here.
 *   - `isCombatFrozen`: this is a pure function operating on plain snapshots (no
 *     SubprovinceSystem instance is passed in, matching findSupplyRoute's pattern of taking
 *     `ownership`/`hubs` as plain data rather than a system reference), so the contested-tier
 *     predicate must be threaded in explicitly by the caller (Task 3 will pass
 *     `SubprovinceSystem.isCombatFrozen.bind(...)`).
 *
 * `nationId` is accepted (and unused in the body) to mirror findSupplyRoute's
 * `requestingNationId` parameter, which is likewise not referenced directly — the friendliness
 * check is fully delegated to `isFriendly`, and the id is kept in the signature for symmetry /
 * future logging or diagnostics, same as the existing function.
 */
export function findRetreatPath(
  graph: SubprovinceGraph,
  ownership: ReadonlyMap<string, { ownerId: string; provinceId: string }>,
  hubs: ReadonlySet<string>,
  startSubprovinceId: string,
  nationId: string,
  isFriendly: (ownerId: string) => boolean,
  isCombatFrozen: (subprovinceId: string) => boolean,
): RetreatPath {
  void nationId;
  if (!graph.nodes.has(startSubprovinceId)) {
    throw new Error(`findRetreatPath: unknown startSubprovinceId "${startSubprovinceId}"`);
  }

  const isFriendlyCell = (subprovinceId: string): boolean => {
    const owned = ownership.get(subprovinceId);
    return !!owned && isFriendly(owned.ownerId);
  };

  const isRetreatTarget = (subprovinceId: string): boolean => {
    if (hubs.has(subprovinceId)) return true;
    if (!isFriendlyCell(subprovinceId)) return false;
    return graph.nodes.get(subprovinceId)?.kind === "road";
  };

  const edgeCost = (subprovinceId: string): number => {
    const def = graph.nodes.get(subprovinceId);
    const base = 1 / hopThroughput(def?.kind ?? "hinterland");
    if (isFriendlyCell(subprovinceId)) return base;
    if (isCombatFrozen(subprovinceId)) return base * RETREAT_CONTESTED_COST_MULTIPLIER;
    return base * RETREAT_ENEMY_NEUTRAL_COST_MULTIPLIER;
  };

  const cost: Map<string, number> = new Map([[startSubprovinceId, 0]]);
  const prev: Map<string, string> = new Map();
  const visited: Set<string> = new Set();

  // Simple O(V^2) Dijkstra — same complexity budget rationale as findSupplyRoute.
  while (true) {
    let currentId: string | null = null;
    let currentCost = Infinity;
    for (const [id, c] of cost) {
      if (!visited.has(id) && c < currentCost) { currentCost = c; currentId = id; }
    }
    if (currentId === null) break;
    visited.add(currentId);

    if (isRetreatTarget(currentId) && currentId !== startSubprovinceId) {
      return _buildRetreatPath(graph, prev, currentId, startSubprovinceId, isFriendlyCell);
    }
    if (isRetreatTarget(currentId) && currentId === startSubprovinceId) {
      return { subprovinceIds: [currentId], blockedFraction: 0 };
    }

    const neighborIds = [...(graph.neighbors.get(currentId) ?? [])].sort();
    for (const neighborId of neighborIds) {
      if (visited.has(neighborId)) continue;
      if (!graph.nodes.has(neighborId)) continue;
      const candidate = currentCost + edgeCost(neighborId);
      const existing = cost.get(neighborId);
      // Tie-break mirrors findSupplyRoute's _tieBreakPrefers: on an exact cost tie, keep the
      // first-found predecessor so the result depends only on sorted neighbor iteration order.
      if (existing === undefined || candidate < existing) {
        cost.set(neighborId, candidate);
        prev.set(neighborId, currentId);
      }
    }
  }

  // Fully disconnected graph from startSubprovinceId — should not occur in practice since every
  // edge is traversable and the subprovince graph is connected, but mirror findSupplyRoute's
  // cut_off fallback shape rather than throwing. blockedFraction is 0 because zero hops were
  // taken (no path data to report), matching _buildRoute's analogous totalHops === 0 -> fully-
  // open convention rather than treating "no path" as "fully blocked".
  return { subprovinceIds: [startSubprovinceId], blockedFraction: 0 };
}

function _buildRetreatPath(
  graph: SubprovinceGraph,
  prev: Map<string, string>,
  targetId: string,
  startId: string,
  isFriendlyCell: (subprovinceId: string) => boolean,
): RetreatPath {
  const path: string[] = [targetId];
  let cur = targetId;
  while (cur !== startId) {
    const p = prev.get(cur);
    if (p === undefined) throw new Error("findRetreatPath: broken path reconstruction");
    path.push(p);
    cur = p;
  }
  path.reverse();

  // Same "don't count the start cell itself" convention as findSupplyRoute._buildRoute — and,
  // mirroring that function exactly, the destination cell is also excluded (there it was to
  // avoid a capital's kind polluting the road/off-road throughput count; here the destination
  // is always friendly by construction of isRetreatTarget, so excluding it is a no-op for
  // blockedFraction but keeps the "which cells count as hops" convention identical between the
  // two functions).
  let totalHops = 0, blockedHops = 0;
  for (const id of path) {
    if (id === startId || id === targetId) continue;
    totalHops++;
    if (!isFriendlyCell(id)) blockedHops++;
  }
  const blockedFraction = totalHops === 0 ? 0 : blockedHops / totalHops;

  return { subprovinceIds: path, blockedFraction };
}

function _buildRoute(
  graph: SubprovinceGraph,
  prev: Map<string, string>,
  hubId: string,
  startId: string,
  divisionId: string,
  isOccupiedByRequester: (id: string) => boolean,
): SupplyRoute {
  const path: string[] = [hubId];
  let cur = hubId;
  while (cur !== startId) {
    const p = prev.get(cur);
    if (p === undefined) throw new Error("findSupplyRoute: broken path reconstruction");
    path.push(p);
    cur = p;
  }
  path.reverse();

  let roadHops = 0, offRoadHops = 0, blockedSubprovinceId: string | null = null;
  for (const id of path) {
    // The start cell isn't traversed, and the hub itself is the destination — its own kind
    // (typically "capital", never "road") must not count as an off-road hop, or a route made
    // entirely of road hops could never reach throughputRatio 1.0 / status "open".
    if (id === startId || id === hubId) continue;
    if (isOccupiedByRequester(id)) { blockedSubprovinceId = id; continue; }
    const def = graph.nodes.get(id);
    if (def?.kind === "road") roadHops++; else offRoadHops++;
  }
  const totalHops = roadHops + offRoadHops;
  const throughputRatio = totalHops === 0 ? 1 : (roadHops * ROAD_THROUGHPUT + offRoadHops * OFF_ROAD_THROUGHPUT) / totalHops;
  const status: SupplyRoute["status"] = throughputRatio >= OPEN_THROUGHPUT_THRESHOLD ? "open" : "degraded";

  return { divisionId, sourceHubId: hubId, subprovinceIds: path, status, throughputRatio, blockedSubprovinceId };
}
