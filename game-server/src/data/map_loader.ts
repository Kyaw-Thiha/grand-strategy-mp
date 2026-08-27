import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getCachedFile } from "./map_cache.js";

export interface NationDefinition {
  id: string;
  name: string;
  colour: string;
  capital_province_id: string;
}

/**
 * Returns the nation definitions for a given map.
 * Add a new case here when a new map is added to the game.
 */
export async function getMapNations(mapId: string): Promise<NationDefinition[]> {
  switch (mapId) {
    case "western_europe_6": {
      const mod = await import(`./maps/${mapId}/nations.js`);
      return mod.default as NationDefinition[];
    }
    default:
      throw new Error(`Unknown map: ${mapId}`);
  }
}

export async function getMapNationIds(mapId: string): Promise<string[]> {
  const nations = await getMapNations(mapId);
  return nations.map((n) => n.id);
}

// ── Subprovince graph ────────────────────────────────────────────────────────

export type SubprovinceKind = "road" | "hinterland" | "town" | "capital";

export interface SubprovinceDefinition {
  id: string;
  provinceId: string;
  kind: SubprovinceKind;
  coverCombat: string | null;
  elevationType: string | null;
  isCapital: boolean;
  /** Outer ring(s) of the cell's geometry — one ring for a simple Polygon, several for a
   *  MultiPolygon. Interior holes are ignored, matching province-level handling. */
  polygon: Array<Array<[number, number]>>;
}

export interface SubprovinceGraph {
  nodes: Map<string, SubprovinceDefinition>;
  neighbors: Map<string, string[]>;
}

const VALID_KINDS: ReadonlySet<string> = new Set(["road", "hinterland", "town", "capital"]);

const _graphCache = new Map<string, SubprovinceGraph>();

function subprovinceAssetPath(mapId: string, filename: string): string {
  const __dir = dirname(fileURLToPath(import.meta.url));
  // From game-server/src/data/ → 2 levels up = game-server/
  const gameServerRoot = join(__dir, "../..");
  return join(gameServerRoot, "..", "client", "assets", "data", mapId, filename);
}

function fail(mapId: string, file: string, reason: string): never {
  throw new Error(`[SubprovinceLoader] ${reason} (map "${mapId}", file: ${file})`);
}

/** Collect a cell's exterior rings (type tolerant). Returns null when a Polygon/MultiPolygon
 *  is malformed (no readable ring); returns [] for genuinely zero-area artifact geometries
 *  (LineString/MultiLineString/Point) that are still valid graph nodes but have no area. */
function collectOuterRings(geometry: { type?: string; coordinates?: unknown } | null): Array<Array<[number, number]>> | null {
  if (!geometry) return null;
  const coords = geometry.coordinates;
  if (geometry.type === "Polygon") {
    if (Array.isArray(coords) && validRing(coords[0])) return [coords[0] as Array<[number, number]>];
    return null;
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(coords)) {
    const rings: Array<Array<[number, number]>> = [];
    for (const part of coords as Array<unknown>) {
      if (Array.isArray(part) && validRing(part[0])) rings.push(part[0] as Array<[number, number]>);
    }
    return rings.length > 0 ? rings : null;
  }
  return [];
}

function validRing(ring: unknown): ring is Array<[number, number]> {
  return Array.isArray(ring) && ring.length >= 4;
}

interface FeatureCollection {
  type: "FeatureCollection";
  features: Array<{ type: string; geometry: any; properties: Record<string, unknown> }>;
}

/**
 * Parse the generated subprovinces.geojson + subprovince_adjacency.geojson for a map
 * into a SubprovinceGraph. Room-agnostic and cached via `getCachedFile`.
 *
 * Subprovince data is load-bearing for capture and supply, so any missing, malformed, or
 * mismatched asset throws (unlike waypoints.json's soft-fail). Geometry must always be a
 * simple Polygon — the pipeline flattens MultiPolygons at write time, so the loader treats
 * a MultiPolygon or missing outer ring as malformed rather than silently flattening again.
 */
export function loadSubprovinceGraph(mapId: string): SubprovinceGraph {
  const cached = _graphCache.get(mapId);
  if (cached) return cached;
  const spFile = "subprovinces.geojson";
  const adjFile = "subprovince_adjacency.geojson";
  const rawSp = getCachedFile<FeatureCollection>(subprovinceAssetPath(mapId, spFile));
  const rawAdj = getCachedFile<FeatureCollection>(subprovinceAssetPath(mapId, adjFile));
  const graph = parseSubprovinceGraph(rawSp, rawAdj, mapId, spFile, adjFile);
  _graphCache.set(mapId, graph);
  return graph;
}

/**
 * Pure parser from the two GeoJSON FeatureCollections into a SubprovinceGraph.
 * Exported for direct unit testing of the fail-clear paths; `loadSubprovinceGraph`
 * is the thin fs/cache wrapper around it.
 */
export function parseSubprovinceGraph(
  rawSp: FeatureCollection | null | undefined,
  rawAdj: FeatureCollection | null | undefined,
  mapId: string,
  spFile = "subprovinces.geojson",
  adjFile = "subprovince_adjacency.geojson",
): SubprovinceGraph {
  if (rawSp?.type !== "FeatureCollection") fail(mapId, spFile, "not a FeatureCollection");

  const nodes = new Map<string, SubprovinceDefinition>();
  for (const feature of rawSp.features) {
    const props = feature.properties;
    const id = props?.subprovince_id;
    const provinceId = props?.province_id;
    const kind = props?.kind;
    const isCapital = props?.is_capital;
    if (typeof id !== "string" || typeof provinceId !== "string" || typeof kind !== "string") {
      fail(mapId, spFile, "feature missing required properties (subprovince_id/province_id/kind)");
    }
    if (!VALID_KINDS.has(kind)) {
      fail(mapId, spFile, `invalid kind ${JSON.stringify(kind)} for subprovince ${id}`);
    }
    if (typeof isCapital !== "boolean") {
      fail(mapId, spFile, `is_capital must be boolean for subprovince ${id}`);
    }
    const geometry = feature.geometry as { type?: string; coordinates?: unknown } | null;
    const rings = collectOuterRings(geometry);
    if (rings === null) {
      fail(mapId, spFile, `subprovince ${id} geometry must be a Polygon or MultiPolygon, got ${geometry?.type ?? "missing"}`);
    }
    nodes.set(id, {
      id,
      provinceId,
      kind: kind as SubprovinceKind,
      coverCombat: typeof props?.cover_combat === "string" ? props.cover_combat : null,
      elevationType: typeof props?.elevation_type === "string" ? props.elevation_type : null,
      isCapital,
      polygon: rings,
    });
  }

  if (rawAdj?.type !== "FeatureCollection") fail(mapId, adjFile, "not a FeatureCollection");
  const neighbors = new Map<string, string[]>();
  for (const feature of rawAdj.features) {
    const props = feature.properties;
    const id = props?.subprovince_id;
    if (typeof id !== "string") {
      fail(mapId, adjFile, "adjacency feature missing subprovince_id");
    }
    const list = props?.neighbors;
    if (!Array.isArray(list) || !list.every((n) => typeof n === "string")) {
      fail(mapId, adjFile, `adjacency feature ${id} has malformed neighbors array`);
    }
    neighbors.set(id, list as string[]);
  }

  for (const id of neighbors.keys()) {
    if (!nodes.has(id)) fail(mapId, adjFile, `adjacency references unknown subprovince ${id}`);
  }
  for (const nodeId of nodes.keys()) {
    if (!neighbors.has(nodeId)) fail(mapId, adjFile, `subprovince ${nodeId} missing from adjacency file`);
  }

  return { nodes, neighbors };
}
