import { GameRoomState } from "../rooms/schema/GameRoomState.js";

export function buildProvinceNeighbors(
  adjacency: Array<{ from_province: string; to_province: string }>,
): Map<string, string[]> {
  const neighbors = new Map<string, string[]>();
  const addEdge = (a: string, b: string): void => {
    if (!neighbors.has(a)) neighbors.set(a, []);
    neighbors.get(a)!.push(b);
  };
  for (const edge of adjacency) {
    addEdge(edge.from_province, edge.to_province);
    addEdge(edge.to_province, edge.from_province);
  }
  return neighbors;
}

function getRelationStance(nationA: string, nationB: string, state: GameRoomState): string {
  if (nationA === nationB) return "alliance";
  const rel = state.relations.get(`${nationA}|${nationB}`) ?? state.relations.get(`${nationB}|${nationA}`);
  return rel?.stance ?? "neutral";
}

/**
 * True if province `provinceId` has at least one neighbor province owned by a nation
 * whose relation to `viewerNationId` is `stance`. Evaluated from the viewer's own nation,
 * not the province's owner — a wing based at an allied airbase correctly sees "my ally
 * borders the enemy" as a valid war-border.
 */
export function isBorderingStance(
  provinceId: string,
  viewerNationId: string,
  stance: "war" | "neutral",
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
): boolean {
  const neighborIds = provinceNeighbors.get(provinceId);
  if (!neighborIds) return false;
  for (const neighborId of neighborIds) {
    const neighbor = state.provinces.get(neighborId);
    if (!neighbor || !neighbor.owner_id) continue;
    if (getRelationStance(viewerNationId, neighbor.owner_id, state) === stance) return true;
  }
  return false;
}

const CROWD_WEIGHT = 0.15;   // placeholder — playtesting-tunable, see AIR_COMBAT.md Open Questions

function euclidDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  return Math.sqrt((lng1 - lng2) ** 2 + (lat1 - lat2) ** 2);
}

export function scoreCandidate(distDeg: number, claimCount: number): number {
  const distanceFalloff = 1 / (1 + distDeg);
  return distanceFalloff - CROWD_WEIGHT * claimCount;
}

/** Counts live wings currently assigned (by mission+target_id) to each target_id. */
export function buildClaimsRegistry(state: GameRoomState): Map<string, number> {
  const claims = new Map<string, number>();
  for (const wing of state.air_wings.values()) {
    if (!wing.target_id) continue;
    claims.set(wing.target_id, (claims.get(wing.target_id) ?? 0) + 1);
  }
  return claims;
}

/** Picks the highest-scoring candidate id from a list of {id, lng, lat}. Ties broken by id string. */
function pickBest<T extends { id: string; lng: number; lat: number }>(
  candidates: T[],
  fromLng: number,
  fromLat: number,
  claims: Map<string, number>,
): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const dist = euclidDeg(fromLng, fromLat, c.lng, c.lat);
    const score = scoreCandidate(dist, claims.get(c.id) ?? 0);
    if (score > bestScore || (score === bestScore && (!best || c.id < best.id))) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
