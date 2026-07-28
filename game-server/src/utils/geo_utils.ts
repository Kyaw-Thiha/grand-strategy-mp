import { getCachedFile } from "../data/map_cache.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/** Ray-casting point-in-polygon. polygon is [[lng,lat], ...] */
export function pointInPolygon(px: number, py: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export interface ProvincePIPEntry {
  province_id: string;
  nation_id:   string;
  polygons:    number[][][];
  minLng: number; maxLng: number;
  minLat: number; maxLat: number;
}

/** Loads province polygon data from map_data.json and builds bounding-box-accelerated PIP entries. */
export function loadProvincePIPData(mapId: string): ProvincePIPEntry[] {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const dataPath = join(__dir, "../../..", "client", "assets", "data", mapId, "map_data.json");
  const raw = getCachedFile<{
    provinces: Array<{ province_id: string; nation_id: string; polygons: number[][][] }>;
  }>(dataPath);

  return raw.provinces.map(p => {
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const ring of p.polygons) {
      for (const coord of ring) {
        if (coord[0] < minLng) minLng = coord[0];
        if (coord[0] > maxLng) maxLng = coord[0];
        if (coord[1] < minLat) minLat = coord[1];
        if (coord[1] > maxLat) maxLat = coord[1];
      }
    }
    return { province_id: p.province_id, nation_id: p.nation_id, polygons: p.polygons, minLng, maxLng, minLat, maxLat };
  });
}

/** Returns the province_id of the province containing (lng, lat), or null if none. */
export function findProvinceAtPoint(
  lng: number,
  lat: number,
  entries: ProvincePIPEntry[],
): string | null {
  for (const e of entries) {
    if (lng < e.minLng || lng > e.maxLng || lat < e.minLat || lat > e.maxLat) continue;
    for (const ring of e.polygons) {
      if (pointInPolygon(lng, lat, ring)) return e.province_id;
    }
  }
  return null;
}
