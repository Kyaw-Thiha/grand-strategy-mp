import type { SubprovinceDefinition, SubprovinceGraph } from "../data/map_loader.js";
import { haversineKm } from "../data/map_loader.js";
import { UNIT_TERRAIN_COSTS } from "../data/unit_terrain_costs.js";

/**
 * Pure supply-routing core: given a subprovince adjacency graph, ownership snapshot, and a
 * set of hub cells, finds the cheapest path from a division's location to the nearest
 * reachable friendly (or requester-occupied) hub. Contains no caching, no mutation of its
 * inputs, and no I/O — callers own the graph/ownership snapshot and any memoization.
 *
 * Edge cost is real-world time-to-traverse (distanceKm / speedKmh), not hop count — cell sizes
 * vary widely, so a flat "1 hop = 1 unit" cost was a poor proxy for actual supply-line length and
 * didn't make roads matter enough. Off-road speed is further graded by terrain harshness via
 * UNIT_TERRAIN_COSTS.standard_infantry (a generic stand-in — supply convoys aren't tied to any
 * one unit type, and exact accuracy isn't required here), so routes naturally hug roads and avoid
 * harsh terrain (mountains/swamp/dense forest) wherever an easier alternative exists, without any
 * special-cased "prefer road in this section" logic — that behavior falls straight out of
 * Dijkstra once edge weights reflect real cost.
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

const SUPPLY_ROAD_SPEED_KMH = 60;
const SUPPLY_OFFROAD_SPEED_KMH = 20;
const OPEN_THROUGHPUT_THRESHOLD = 0.9; // tunable: at/above this ratio -> "open", else "degraded"
// throughputRatio decays purely from accumulated off-road distance — road distance is deliberately
// excluded entirely (not just weighted small), matching "roads are fast, so supply on them should
// feel unpenalized." OFFROAD_DEGRADE_DISTANCE_KM is the off-road km at which a route reads fully
// "severe" (ratio 0); with OPEN_THROUGHPUT_THRESHOLD at 0.9, a route stays "open" up to 10% of that
// distance and degrades linearly from there.
//
// 300 (not the original 150) is calibrated to this map's actual cell scale, measured directly
// against western_europe_6's real graph: a single hinterland-to-hinterland hop is commonly 30-75km
// (hinterland cells are generated at a ~5,000km^2 target size — subprovince_generator.py's
// hinterland_target_area), with some hops over 200km. At 150 an ordinary single off-road hop right
// next to a hub already blew past the "open" budget, making routes read "degraded" even when the
// unit was genuinely one field away from the road network. At 300, one typical hop (~30km) lands
// right at the open/degraded boundary, and only a longer cross-country trek (multiple hops or one
// very large one) reads as meaningfully degraded.
const OFFROAD_DEGRADE_DISTANCE_KM = 300;

// Supply convoys have no single unit type; standard_infantry's terrain-cost row is used as a
// generic proxy for off-road terrain harshness (doesn't need to be exact).
const SUPPLY_TERRAIN_PROFILE: Record<string, number> = UNIT_TERRAIN_COSTS.standard_infantry;

/** Effective speed (km/h) for traversing a cell of the given definition. */
function hopSpeedKmh(def: SubprovinceDefinition): number {
  if (def.kind === "road") return SUPPLY_ROAD_SPEED_KMH;
  const terrainKey = def.coverCombat && def.elevationType ? `${def.coverCombat}_${def.elevationType}` : null;
  const terrainCost = terrainKey ? SUPPLY_TERRAIN_PROFILE[terrainKey] ?? 1.0 : 1.0;
  return SUPPLY_OFFROAD_SPEED_KMH / terrainCost; // terrainCost === Infinity -> 0 kmh -> Infinity edge cost (impassable)
}

/** Real-world distance (km) between two adjacent cells, via centroid haversine. Falls back to a
 *  flat 1.0 when either cell lacks geometry (e.g. synthetic test fixtures), preserving relative
 *  road/off-road speed preference without fabricating a distance. */
function edgeDistanceKm(graph: SubprovinceGraph, fromId: string, toId: string): number {
  const a = graph.nodes.get(fromId)?.centroid;
  const b = graph.nodes.get(toId)?.centroid;
  if (!a || !b) return 1.0;
  return haversineKm(a, b);
}

/** Time cost (hours) to traverse into `neighborId` from `fromId`. */
function hopCost(graph: SubprovinceGraph, fromId: string, neighborId: string, neighborDef: SubprovinceDefinition): number {
  return edgeDistanceKm(graph, fromId, neighborId) / hopSpeedKmh(neighborDef);
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
      const edgeCost = hopCost(graph, currentId, neighborId, def);
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
// Cost tiers (all built on the same distance/speed time cost findSupplyRoute already uses, so
// road cells and easy terrain keep their natural speed advantage in every tier with no
// special-casing):
//   friendly (isFriendly(owner))            -> hopCost(...)                                  [base]
//   contested (combat-frozen, non-friendly) -> RETREAT_CONTESTED_COST_MULTIPLIER * that       [5x]
//   enemy/neutral (everything else)         -> RETREAT_ENEMY_NEUTRAL_COST_MULTIPLIER * that   [20x]
// The multipliers are large enough that the tier ordering (friendly < contested < enemy/neutral)
// holds regardless of road/off-road/terrain mix, so "retreat prefers friendly ground" is true by
// construction, not just true on average.
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
 *     CALLER CONTRACT: unlike the friendly-road branch of the target-set check, membership in
 *     `hubs` is trusted unconditionally (no ownership re-check inside this function) — callers
 *     MUST pre-filter `hubs` to friendly-or-allied ownership before calling, e.g. via
 *     `SubprovinceSystem.getHubSubprovinceIds(state, isFriendly)`, the same helper
 *     findSupplyRoute's callers already use. Passing an unfiltered hub set (including
 *     enemy-held hubs) would let a division "retreat" onto enemy soil.
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

  const edgeCost = (fromId: string, subprovinceId: string): number => {
    const def = graph.nodes.get(subprovinceId);
    const base = def ? hopCost(graph, fromId, subprovinceId, def) : edgeDistanceKm(graph, fromId, subprovinceId) / SUPPLY_OFFROAD_SPEED_KMH;
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
      const candidate = currentCost + edgeCost(currentId, neighborId);
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

  let offRoadKm = 0, blockedSubprovinceId: string | null = null;
  for (let i = 1; i < path.length; i++) {
    const id = path[i];
    // The start cell isn't traversed, and the hub itself is the destination — its own kind
    // (typically "capital", never "road") must not count as off-road distance, or a route made
    // entirely of road hops could never reach throughputRatio 1.0 / status "open".
    if (id === startId || id === hubId) continue;
    if (isOccupiedByRequester(id)) { blockedSubprovinceId = id; continue; }
    const def = graph.nodes.get(id);
    if (def?.kind === "road") continue;
    offRoadKm += edgeDistanceKm(graph, path[i - 1], id);
  }
  const throughputRatio = Math.min(1, Math.max(0, 1 - offRoadKm / OFFROAD_DEGRADE_DISTANCE_KM));
  const status: SupplyRoute["status"] = throughputRatio >= OPEN_THROUGHPUT_THRESHOLD ? "open" : "degraded";

  return { divisionId, sourceHubId: hubId, subprovinceIds: path, status, throughputRatio, blockedSubprovinceId };
}
