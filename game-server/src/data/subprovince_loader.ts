import { loadSubprovinceGraph, type SubprovinceGraph } from "./map_loader.js";
import { pointInPolygon } from "../utils/geo_utils.js";

/** Thin per-room wrapper around the already file-level-cached Batch 3 parser. */
export function loadSubprovinceGraphForRoom(mapId: string): SubprovinceGraph {
  return loadSubprovinceGraph(mapId);
}

export interface SubprovincePIPEntry {
  id: string;
  rings: number[][][];
  minLng: number; maxLng: number;
  minLat: number; maxLat: number;
}

/** Builds a bbox-accelerated point-in-polygon index, mirroring geo_utils.ts's ProvincePIPEntry pattern. */
export function buildSubprovinceSpatialIndex(graph: SubprovinceGraph): SubprovincePIPEntry[] {
  const entries: SubprovincePIPEntry[] = [];
  for (const def of graph.nodes.values()) {
    if (def.polygon.length === 0) continue;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const ring of def.polygon) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    entries.push({ id: def.id, rings: def.polygon, minLng, maxLng, minLat, maxLat });
  }
  return entries;
}

/** Returns the subprovince_id containing (lng, lat), or null if none matches. */
export function findSubprovinceAtPoint(
  lng: number,
  lat: number,
  entries: SubprovincePIPEntry[],
): string | null {
  for (const e of entries) {
    if (lng < e.minLng || lng > e.maxLng || lat < e.minLat || lat > e.maxLat) continue;
    for (const ring of e.rings) {
      if (pointInPolygon(lng, lat, ring)) return e.id;
    }
  }
  return null;
}
