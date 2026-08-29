import { loadSubprovinceGraph, type SubprovinceGraph } from "./map_loader.js";
import { pointInPolygon } from "../utils/geo_utils.js";
import { getCachedFile } from "./map_cache.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

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

/**
 * Reads client/assets/data/<mapId>/map_data.json's provinces array and returns every
 * province_id -> city_position pair, regardless of is_supply_hub — used both to seed static
 * hubs at room load and to resolve a province's city on demand when a player-built hub
 * (SubprovinceSystem.registerDynamicHub) completes construction in a province that wasn't one
 * of the map's original hubs.
 */
export function loadProvinceCityPositions(mapId: string): Map<string, [number, number]> {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const dataPath = join(__dir, "../../..", "client", "assets", "data", mapId, "map_data.json");
  const raw = getCachedFile<{
    provinces: Array<{ province_id: string; city_position?: [number, number] }>;
  }>(dataPath);

  const positions = new Map<string, [number, number]>();
  for (const p of raw.provinces) {
    if (!p.city_position) continue;
    positions.set(p.province_id, p.city_position);
  }
  return positions;
}

/**
 * Reads client/assets/data/<mapId>/map_data.json's provinces array and returns
 * province_id -> city_position for every province flagged is_supply_hub. Hub placement is
 * static, authored map data (Task A of the supply-hub plan) — the server never infers hubs
 * from cell kind at runtime.
 */
export function loadSupplyHubProvinces(mapId: string): Map<string, [number, number]> {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const dataPath = join(__dir, "../../..", "client", "assets", "data", mapId, "map_data.json");
  const raw = getCachedFile<{
    provinces: Array<{ province_id: string; is_supply_hub?: boolean; city_position?: [number, number] }>;
  }>(dataPath);

  const hubs = new Map<string, [number, number]>();
  for (const p of raw.provinces) {
    if (!p.is_supply_hub || !p.city_position) continue;
    hubs.set(p.province_id, p.city_position);
  }
  return hubs;
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
