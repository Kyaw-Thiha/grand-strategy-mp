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
