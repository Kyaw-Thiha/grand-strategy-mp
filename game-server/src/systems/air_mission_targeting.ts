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
