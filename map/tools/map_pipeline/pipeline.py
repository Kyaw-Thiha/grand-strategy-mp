"""
Map data pipeline: GeoJSON source files → Godot-native map_data.json + heightmap.

Usage:
    python pipeline.py --map europe_1938_6
    python pipeline.py --map europe_1938_6 --skip-dem

Reads source files from map/<map_dir>/, writes output to client/assets/data/<map_id>/.
The map_dir must contain a map.json with map_id, bounds, and dem_source.
"""

import argparse
import json
import math
import shutil
import sys
import warnings
from collections import defaultdict
from pathlib import Path

import numpy as np
import rasterio
from rasterio.merge import merge as rasterio_merge
from rasterio.transform import from_bounds as transform_from_bounds
from rasterio.warp import reproject, Resampling, transform_bounds
from shapely.geometry import Point, LineString as ShapelyLS, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

# pipeline.py lives at map/tools/map_pipeline/ — three levels up is repo root
REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent

sys.path.insert(0, str(Path(__file__).parent))
from validate import validate_all
from subprovince_generator import SubprovinceConfig, default_config
from subprovince_io import generate_real_province, publish_subprovince_outputs

# Pass-through files copied unchanged to the output directory
PASSTHROUGH_FILES = [
    "cover.geojson",
    "elevation.geojson",
    "base_water.geojson",
    "terrain_lookup.json",
    "rivers.geojson",
    "roads.geojson",
]

ALL_UNIT_TYPES = ["infantry", "armor", "motorized", "artillery"]

# The ten-resource roster per RESOURCE_ECONOMY.md / MAP_DATA_CONTRACT.md. Supersedes the old
# five-key placeholder envelope (manpower, steel, oil, fuel, coal, money) — not additive.
RESOURCE_TYPES = [
    "money", "grain", "iron", "oil", "rubber",
    "nitrates", "tungsten", "chromium", "aluminium", "uranium",
]

# TBD playtesting — flat abundance value used by the "playtest" resource preset below.
PLAYTEST_RESOURCE_ABUNDANCE = 60


# ── argument parsing ──────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    """
    Parse command-line arguments.

    --map:              Name of the source directory under map/ (e.g. europe_1938_6)
    --skip-dem:         Skip the DEM mosaicing and heightmap export step. Useful during
                        development when only map_data.json changes are needed.
    --resource-preset:  Override res_* resource abundance values instead of reading them
                        from the source geojson. Omit this flag (the default) to use
                        whatever is hand-authored in provinces.geojson's res_* fields —
                        the durable, documented authoring path. 'playtest' ignores res_*
                        entirely and round-robin-assigns all ten resource types across
                        each playable nation's own provinces, so every nation has access
                        to every resource somewhere without needing real authored data.
                        The source geojson is never modified by this flag — switching
                        between playtest and authored data is just adding or omitting
                        this flag on the next pipeline run.
    """
    parser = argparse.ArgumentParser(description="Map data pipeline: GeoJSON → Godot map_data.json")
    parser.add_argument("--map", required=True,
                        help="Source map directory name under map/ (e.g. europe_1938_6)")
    parser.add_argument("--skip-dem", action="store_true",
                        help="Skip DEM mosaicing and heightmap export")
    parser.add_argument("--resource-preset", choices=["playtest"], default=None,
                        help="Override res_* values with a named preset instead of reading "
                         "the source geojson (see docstring above). Omit for the default "
                         "authored-from-geojson behavior.")
    parser.add_argument("--subprovince-province", default=None,
                        help="Generate subprovince outputs for exactly one province ID")
    parser.add_argument("--subprovince-all-provinces", action="store_true",
                        help="Generate subprovince outputs for every province in the map. "
                             "Failures are skipped and logged to a report manifest instead of "
                             "aborting the run; provinces that succeed are still published. "
                             "Mutually exclusive with --subprovince-province.")
    parser.add_argument("--subprovince-retry-failed", action="store_true",
                        help="Read subprovince_generation_report.json from a previous full-map run "
                             "and regenerate only the provinces listed as failed, merging the "
                             "newly-succeeding output into the existing published files.")
    parser.add_argument("--subprovince-only", action="store_true",
                        help="When combined with --subprovince-province, publish only the "
                             "subprovince outputs and skip map_data, passthrough, waypoint, "
                             "terrain-grid, and DEM generation")
    return parser.parse_args()


# ── geometry helpers ──────────────────────────────────────────────────────────

def _extract_exterior_rings(geom) -> list[list]:
    """
    Extract exterior coordinate rings from a Polygon or MultiPolygon.

    Returns a list of rings, where each ring is a list of [lng, lat] pairs
    rounded to 6 decimal places (~11 cm precision). Interior rings (holes)
    are discarded — game provinces should not have holes.

    For a simple Polygon:     returns one ring.
    For a MultiPolygon:       returns one ring per sub-polygon.

    Example:
        rings = _extract_exterior_rings(shapely_geom)
        # rings[0] = [[lng, lat], [lng, lat], ...]
    """
    def _round_ring(coords) -> list:
        return [[round(c[0], 6), round(c[1], 6)] for c in coords]

    if geom.geom_type == "Polygon":
        return [_round_ring(geom.exterior.coords)]
    elif geom.geom_type == "MultiPolygon":
        return [_round_ring(poly.exterior.coords) for poly in geom.geoms]
    else:
        return []


def _get_elev_type(props: dict) -> str | None:
    """
    Read the elevation type from a feature's properties.

    Handles the split field name in elevation.geojson: original pipeline features
    use 'elev_type', gap-fill features use 'elevation_type'. Returns whichever
    is present, or None if neither exists.
    """
    return props.get("elev_type") or props.get("elevation_type")


def _parse_is_core(value) -> list:
    """
    Parse the is_core province field, which can be a list or a JSON-encoded string.

    QGIS stores JSON arrays as strings; the exported GeoJSON may preserve either
    form depending on the exporter version.

    Example:
        _parse_is_core(["france"]) == ["france"]
        _parse_is_core('["france","vichy"]') == ["france", "vichy"]
        _parse_is_core(None) == []
    """
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return []
    return []


# ── province building ─────────────────────────────────────────────────────────

def build_provinces(
    sources: dict, simplify_tolerance: float, resource_preset: str | None = None,
) -> list[dict]:
    """
    Build the province output list from validated source features.

    For each province: simplifies the polygon geometry, merges has_port from the
    matching city, and reconstructs nested buildings{} and resources{} dicts from
    the flat QGIS attribute fields. The 'notes' field is stripped.

    Parameters:
        sources:            Dict from validate_all() keyed by file name.
        simplify_tolerance: Shapely simplify tolerance in degrees. 0.001° ≈ 100m.
        resource_preset:    None (default) reads resources{} from the source geojson's
                            res_* fields as authored. 'playtest' overrides resources{}
                            for every playable province via _apply_playtest_resource_preset()
                            after the base list is built, ignoring res_* entirely.

    Returns a list of province dicts ready to write into map_data.json.
    """
    # Build city lookup so we can merge has_port into each province
    city_by_province = {
        f["properties"]["province_id"]: f["properties"]
        for f in sources["cities"]
    }

    provinces_out = []

    for feat in sources["provinces"]:
        props = feat["properties"]
        pid = props["province_id"]

        # Simplify polygon, fix any invalid geometry with buffer(0) first
        geom = shape(feat["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        simplified = geom.simplify(simplify_tolerance, preserve_topology=True)

        polygons = _extract_exterior_rings(simplified)
        if not polygons:
            print(f"  [WARN] province {pid} produced no polygon rings after simplification",
                  file=sys.stderr)
            continue

        city_props = city_by_province.get(pid, {})

        buildings = {
            "fort":       props.get("bld_fort", 0),
            "port":       props.get("bld_port", 0),
            "airbase":    props.get("bld_airbase", 0),
            "supply_hub": props.get("bld_supply_hub", 0),
            "factory":    props.get("bld_factory", 0),
        }
        resources = {r: props.get(f"res_{r}", 0) for r in RESOURCE_TYPES}

        provinces_out.append({
            "province_id":       pid,
            "name":              props["name"],
            "map_id":            props["map_id"],
            "nation_id":         props["nation_id"],
            "is_capital":        bool(props.get("is_capital", False)),
            "is_playable":       bool(props.get("is_playable", True)),
            "is_core":           _parse_is_core(props.get("is_core")),
            "city_name":         props["city_name"],
            "city_position":     [props["city_lng"], props["city_lat"]],
            "has_port":          bool(city_props.get("has_port", False)),
            "polygons":          polygons,
            "terrain_elevation": props["terrain_elevation"],
            "terrain_cover":     props["terrain_cover"],
            "population":        props.get("population", 0),
            "industry":          props.get("industry", 0),
            "infrastructure":    props.get("infrastructure", 0),
            "buildings":         buildings,
            "resources":         resources,
            "vp_value":          props.get("vp_value", 0),
            "is_objective":      bool(props.get("is_objective", False)),
        })

    if resource_preset == "playtest":
        _apply_playtest_resource_preset(provinces_out)

    return provinces_out


def _apply_playtest_resource_preset(provinces_out: list[dict]) -> None:
    """
    Playtest-only resource override — mutates provinces_out in place.

    Ignores res_* entirely. For every playable province, zeroes all ten resources first,
    then round-robins each nation's ten resource types across that nation's own playable
    provinces (sorted by province_id for determinism), so every nation has access to every
    resource somewhere in its own territory without every single province having every
    resource. Non-playable provinces are left untouched (never player-owned, so their
    resources never matter). This is a deliberate playtesting shortcut, not the documented
    hand-authored-in-QGIS model — see --resource-preset's help text.

    With 8 provinces and 10 resource types (the current western_europe_6 map), two of a
    nation's provinces end up with two assigned resources each and the remaining six get
    one each — every type covered exactly once per nation, cycling generically for any
    other province count so this isn't hardcoded to 8.
    """
    by_nation: dict[str, list[dict]] = defaultdict(list)
    for p in provinces_out:
        if p["is_playable"]:
            by_nation[p["nation_id"]].append(p)

    for provs in by_nation.values():
        provs.sort(key=lambda p: p["province_id"])
        for p in provs:
            p["resources"] = {r: 0 for r in RESOURCE_TYPES}
        for i, res_type in enumerate(RESOURCE_TYPES):
            provs[i % len(provs)]["resources"][res_type] = PLAYTEST_RESOURCE_ABUNDANCE


# ── adjacency building ────────────────────────────────────────────────────────

def build_adjacency(sources: dict) -> list[dict]:
    """
    Detect all shared borders between province pairs and classify each edge.

    Detection: uses Shapely intersection on every province pair. Only line
    intersections (shared edges) are counted — point touches at corners are
    discarded.

    Classification priority (highest wins):
        river  — shared border intersects a major river
        coast  — shared border touches the base_water polygon boundary
        open   — everything else

    Road assignment: finds the highest-level strategic road crossing each border
    and records its road_id and road_level. Null if no road crosses.

    passable_by defaults to all unit types. Mountain pass tagging (infantry-only
    borders) is a manual authoring step added in a later phase.

    Returns a list of adjacency dicts matching the map_data.json format.
    """
    # Build Shapely geometry per province
    province_shapes: dict[str, object] = {}
    for feat in sources["provinces"]:
        pid = feat["properties"]["province_id"]
        geom = shape(feat["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        province_shapes[pid] = geom

    # Spatial index over major rivers only — minor rivers and streams don't
    # impose crossing penalties per the data contract
    major_river_geoms = [
        shape(f["geometry"])
        for f in sources["rivers"]
        if f["properties"].get("river_size") == "major"
    ]
    major_river_tree = STRtree(major_river_geoms) if major_river_geoms else None

    # Spatial index over all strategic roads
    road_geoms = [shape(f["geometry"]) for f in sources["roads"]]
    road_props = [f["properties"] for f in sources["roads"]]
    road_tree = STRtree(road_geoms) if road_geoms else None

    # Water boundary for coast detection
    water_union = unary_union([shape(f["geometry"]) for f in sources["base_water"]])
    water_boundary = water_union.boundary

    province_ids = list(province_shapes.keys())
    adjacency_out = []

    for i in range(len(province_ids)):
        for j in range(i + 1, len(province_ids)):
            pid_a = province_ids[i]
            pid_b = province_ids[j]
            shape_a = province_shapes[pid_a]
            shape_b = province_shapes[pid_b]

            # Bounding box pre-filter — skips the vast majority of non-adjacent pairs
            ba = shape_a.bounds  # (minx, miny, maxx, maxy)
            bb = shape_b.bounds
            if ba[2] < bb[0] or bb[2] < ba[0] or ba[3] < bb[1] or bb[3] < ba[1]:
                continue

            # Full intersection check
            intersection = shape_a.intersection(shape_b)
            if intersection.is_empty:
                continue

            # Extract only linear components — corner touches (Points) are not borders
            border = _extract_linear_parts(intersection)
            if border is None or border.is_empty:
                continue

            # Classify border type, checking river first (higher priority than coast)
            border_type = "open"

            if border.intersects(water_boundary):
                border_type = "coast"

            if major_river_tree is not None:
                for idx in major_river_tree.query(border, predicate="intersects"):
                    if border.intersects(major_river_geoms[idx]):
                        border_type = "river"
                        break

            # Find the highest-level road crossing this border
            road_id = None
            road_level = None
            if road_tree is not None:
                best_level = 0
                for idx in road_tree.query(border, predicate="intersects"):
                    level = road_props[idx].get("road_level", 0)
                    if level > best_level and border.intersects(road_geoms[idx]):
                        best_level = level
                        road_id = road_props[idx]["road_id"]
                        road_level = level

            adjacency_out.append({
                "from_province": pid_a,
                "to_province":   pid_b,
                "border_type":   border_type,
                "road_id":       road_id,
                "road_level":    road_level,
                "passable_by":   ALL_UNIT_TYPES,
            })

    return adjacency_out


def _extract_linear_parts(geom):
    """
    Return the linear (line/multiline) components of a geometry.

    When two provinces intersect, the result may be a GeometryCollection
    containing both point touches (corners) and line segments (actual borders).
    We only want the line segments.

    Returns a Shapely geometry containing only lines, or None if there are none.
    """
    if geom.geom_type in ("LineString", "MultiLineString"):
        return geom

    if geom.geom_type == "GeometryCollection":
        lines = [g for g in geom.geoms if g.geom_type in ("LineString", "MultiLineString")]
        if not lines:
            return None
        return unary_union(lines)

    return None


# ── heightmap building ────────────────────────────────────────────────────────

def build_heightmap(dem_dir: Path, bounds: dict, output_path: Path) -> None:
    """
    Mosaic EU-DEM tiles covering the map extent and write a WGS84 GeoTIFF heightmap.

    The EU-DEM tiles are in EPSG:3035 (ETRS89-LAEA). This function:
        1. Transforms map bounds to EPSG:3035 to find overlapping tiles
        2. Mosaics only the relevant tiles (avoids loading the full dataset)
        3. Reprojects the mosaic to WGS84 and clips to map bounds
        4. Writes a 2048-pixel-wide GeoTIFF to output_path

    The heightmap is used by Godot for terrain shading only — it is never read
    by the game server.

    Parameters:
        dem_dir:     Directory containing EU-DEM .tif tiles.
        bounds:      Dict with min_lng, max_lng, min_lat, max_lat in WGS84.
        output_path: Destination path for the output heightmap.tif.
    """
    print("  Building heightmap from DEM tiles...")

    tile_paths = sorted(dem_dir.glob("*.tif"))
    if not tile_paths:
        print(f"  [WARN] No DEM tiles found in {dem_dir} — skipping heightmap", file=sys.stderr)
        return

    # Detect the DEM CRS from the first tile and transform map bounds into it
    # so we can find which tiles actually overlap the map extent
    with rasterio.open(tile_paths[0]) as probe:
        dem_crs = probe.crs

    dem_bounds = transform_bounds(
        "EPSG:4326", dem_crs,
        bounds["min_lng"], bounds["min_lat"],
        bounds["max_lng"], bounds["max_lat"],
    )

    # Open only tiles that overlap the transformed map bounds
    overlapping = []
    for tile_path in tile_paths:
        with rasterio.open(tile_path) as src:
            tb = src.bounds
            if (tb.right < dem_bounds[0] or dem_bounds[2] < tb.left or
                    tb.top < dem_bounds[1] or dem_bounds[3] < tb.bottom):
                continue
            # Re-open without context manager so rasterio_merge can read it
            overlapping.append(rasterio.open(tile_path))

    if not overlapping:
        print("  [WARN] No DEM tiles overlap the map bounds — skipping heightmap", file=sys.stderr)
        return

    # Target output dimensions — defined here so target_width is available for
    # the DEM resolution calculation before the merge step below
    target_crs = "EPSG:4326"
    target_width = 2048
    lng_span = bounds["max_lng"] - bounds["min_lng"]
    lat_span = bounds["max_lat"] - bounds["min_lat"]
    target_height = max(1, int(round(target_width * lat_span / lng_span)))

    print(f"  Mosaicing {len(overlapping)} DEM tile(s)...")

    # Compute a target resolution in DEM CRS so the merged output is ~2048px wide.
    # Without this rasterio would merge at native 25m resolution and allocate ~95GB.
    dem_width_m = dem_bounds[2] - dem_bounds[0]
    target_res_m = dem_width_m / target_width

    try:
        # Suppress the EU-DEM nodata float32 representation warning — cosmetic only
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="Ignoring nodata value")
            mosaic_data, mosaic_transform = rasterio_merge(
                overlapping,
                bounds=dem_bounds,
                res=target_res_m,
            )
        mosaic_crs = overlapping[0].crs
    finally:
        for src in overlapping:
            src.close()

    dst_transform = transform_from_bounds(
        bounds["min_lng"], bounds["min_lat"],
        bounds["max_lng"], bounds["max_lat"],
        target_width, target_height,
    )

    # Reproject and clip in one step by providing a target transform + shape
    dst_data = np.zeros(
        (mosaic_data.shape[0], target_height, target_width),
        dtype=mosaic_data.dtype,
    )
    reproject(
        source=mosaic_data,
        destination=dst_data,
        src_transform=mosaic_transform,
        src_crs=mosaic_crs,
        dst_transform=dst_transform,
        dst_crs=target_crs,
        resampling=Resampling.bilinear,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        output_path, "w",
        driver="GTiff",
        height=target_height,
        width=target_width,
        count=mosaic_data.shape[0],
        dtype=dst_data.dtype,
        crs=target_crs,
        transform=dst_transform,
        compress="deflate",
    ) as dst:
        dst.write(dst_data)

    print(f"  Heightmap written: {target_width}×{target_height}px → {output_path.name}")


# ── output writing ────────────────────────────────────────────────────────────

def write_map_data(output_dir: Path, map_config: dict,
                   provinces: list[dict], adjacency: list[dict]) -> None:
    """
    Write map_data.json to output_dir.

    map_data.json is the single file MapLoader reads to build the province scene
    tree and adjacency graph. All other files (cover, elevation, rivers, roads)
    are for visual rendering and are loaded separately by MapLoader.
    """
    map_data = {
        "map_id":    map_config["map_id"],
        "bounds":    map_config["bounds"],
        "provinces": provinces,
        "adjacency": adjacency,
    }
    out_path = output_dir / "map_data.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(map_data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  map_data.json written ({out_path.stat().st_size / 1024:.0f} KB)")


def generate_waypoints(sources: dict, output_dir: Path) -> None:
    """
    Sample road geometry at ~750m intervals to build the waypoint graph.

    Each node records lng/lat, cover_combat, and elevation at that point.
    Edges connect consecutive sampled points on the same road segment.
    River crossings are flagged per edge for penalty calculation in 4B+.

    Output: waypoints.json with { nodes, edges, road_connections }.
    """
    SAMPLE_DEG = 0.007  # ~750m at 50°N latitude

    # Movement cost tables for base_cost computation (cover × elevation).
    COVER_MOVE: dict[str, float] = {
        "plains": 1.0, "steppe": 1.1, "shrubland": 1.2, "light_forest": 1.3,
        "dense_forest": 1.8, "jungle": 2.5, "desert": 1.4, "swamp": 2.0,
        "tundra": 1.5, "glacier": 9999.0, "urban": 0.9,
    }
    ELEV_MOVE: dict[str, float] = {"flat": 1.0, "hills": 1.4, "mountains": 2.2}

    # Build spatial indices over cover and elevation polygons.
    cover_feats = sources.get("cover", [])
    elev_feats = sources.get("elevation", [])
    river_feats = sources.get("rivers", [])

    cover_geoms = [shape(f["geometry"]) for f in cover_feats]
    elev_geoms = [shape(f["geometry"]) for f in elev_feats]
    river_geoms = [shape(f["geometry"]) for f in river_feats]
    river_sizes = [f["properties"].get("river_size", "stream") for f in river_feats]

    cover_tree = STRtree(cover_geoms) if cover_geoms else None
    elev_tree = STRtree(elev_geoms) if elev_geoms else None
    river_tree = STRtree(river_geoms) if river_geoms else None

    prov_feats  = sources.get("provinces", [])
    prov_geoms  = [shape(f["geometry"]) for f in prov_feats]
    prov_nids   = [f["properties"].get("nation_id") for f in prov_feats]
    prov_tree   = STRtree(prov_geoms) if prov_geoms else None

    def _tag(lng: float, lat: float) -> tuple[str, str, str | None]:
        """Return (cover_combat, elevation, nation_id) for a point."""
        pt = Point(lng, lat)
        cover_combat = "plains"
        elevation = "flat"
        nation_id = None
        if cover_tree is not None:
            for idx in cover_tree.query(pt, predicate="intersects"):
                if cover_geoms[idx].contains(pt):
                    cover_combat = cover_feats[idx]["properties"].get("cover_combat", "plains")
                    break
        if elev_tree is not None:
            for idx in elev_tree.query(pt, predicate="intersects"):
                if elev_geoms[idx].contains(pt):
                    elevation = _get_elev_type(elev_feats[idx]["properties"]) or "flat"
                    break
        if prov_tree is not None:
            for idx in prov_tree.query(pt, predicate="intersects"):
                if prov_geoms[idx].contains(pt):
                    nation_id = prov_nids[idx]
                    break
        return cover_combat, elevation, nation_id

    def _river_crossing(lng0: float, lat0: float, lng1: float, lat1: float) -> str | None:
        seg = ShapelyLS([(lng0, lat0), (lng1, lat1)])
        if river_tree is not None:
            for idx in river_tree.query(seg, predicate="intersects"):
                if seg.intersects(river_geoms[idx]):
                    return river_sizes[idx]
        return None

    def _interpolate(coords: list, interval: float) -> list[tuple[float, float]]:
        """Yield (lng, lat) pairs along a coordinate list at roughly interval spacing."""
        result: list[tuple[float, float]] = [(coords[0][0], coords[0][1])]
        for i in range(len(coords) - 1):
            lng0, lat0 = coords[i][0], coords[i][1]
            lng1, lat1 = coords[i + 1][0], coords[i + 1][1]
            dx, dy = lng1 - lng0, lat1 - lat0
            dist = (dx * dx + dy * dy) ** 0.5
            if dist > interval * 1.5:
                steps = max(1, round(dist / interval))
                for s in range(1, steps):
                    t = s / steps
                    result.append((lng0 + dx * t, lat0 + dy * t))
            result.append((lng1, lat1))
        return result

    nodes: list[dict] = []
    edges: list[dict] = []
    road_connections: list[dict] = []

    # Deduplicate nodes by rounded coordinate to merge nearby road intersections.
    node_by_key: dict[tuple[int, int], str] = {}
    wp_counter = 0

    def _get_or_create(lng: float, lat: float) -> str:
        nonlocal wp_counter
        key = (round(lng * 100000), round(lat * 100000))  # ~1m grid
        if key in node_by_key:
            return node_by_key[key]
        wp_counter += 1
        wid = f"wp_{wp_counter:06d}"
        cover, elev, nation_id = _tag(lng, lat)
        nodes.append({
            "id": wid,
            "lng": round(lng, 6),
            "lat": round(lat, 6),
            "cover_combat": cover,
            "elevation": elev,
            "nation_id": nation_id,
        })
        node_by_key[key] = wid
        return wid

    node_pos: dict[str, tuple[float, float]] = {}  # id → (lng, lat) for edge cost lookup

    seen_edges: set[tuple[str, str]] = set()

    for feat in sources.get("roads", []):
        road_id = feat["properties"].get("road_id", "")
        geom = shape(feat["geometry"])
        lines = []
        if geom.geom_type == "LineString":
            lines = [list(geom.coords)]
        elif geom.geom_type == "MultiLineString":
            lines = [list(g.coords) for g in geom.geoms]

        for raw_coords in lines:
            pts = _interpolate(raw_coords, SAMPLE_DEG)
            wp_ids: list[str] = []

            for lng, lat in pts:
                wid = _get_or_create(lng, lat)
                node_pos[wid] = (lng, lat)
                if not wp_ids or wp_ids[-1] != wid:
                    wp_ids.append(wid)

            # Register road_connections (deduped by road_id + waypoint_id)
            seen_rc: set[str] = set()
            for wid in wp_ids:
                key_rc = f"{road_id}:{wid}"
                if key_rc not in seen_rc:
                    seen_rc.add(key_rc)
                    road_connections.append({"road_id": road_id, "waypoint_id": wid})

            # Create edges between consecutive waypoints
            node_data: dict[str, dict] = {n["id"]: n for n in nodes}
            for k in range(len(wp_ids) - 1):
                a_id, b_id = wp_ids[k], wp_ids[k + 1]
                edge_key = (min(a_id, b_id), max(a_id, b_id))
                if edge_key in seen_edges:
                    continue
                seen_edges.add(edge_key)

                a = node_data[a_id]
                river = _river_crossing(a["lng"], a["lat"],
                                        node_data[b_id]["lng"], node_data[b_id]["lat"])
                cover_cost = COVER_MOVE.get(a["cover_combat"], 1.0)
                elev_cost = ELEV_MOVE.get(a["elevation"], 1.0)
                edges.append({
                    "from": a_id,
                    "to": b_id,
                    "base_cost": round(cover_cost * elev_cost, 3),
                    "river_size": river,
                })

    out_path = output_dir / "waypoints.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"nodes": nodes, "edges": edges, "road_connections": road_connections},
                  f, ensure_ascii=False, separators=(",", ":"))
    print(f"  waypoints.json: {len(nodes)} nodes, {len(edges)} edges")


def generate_terrain_grid(
    sources: dict,
    existing_wp: dict,
    grid_deg: float = 0.07,
    id_prefix: str = "tg",
) -> tuple[list[dict], list[dict]]:
    """
    Generate a terrain grid for off-road movement and connect it to the waypoint graph.

    grid_deg:  spacing between grid nodes in degrees (default 0.07° ≈ 7.5 km at 50°N)
    id_prefix: prefix for generated node IDs ('tg' for fine/server, 'ct' for coarse/client)

    Returns (new_nodes, new_edges) to merge into a waypoints file.
    """
    TERRAIN_GRID_DEG    = grid_deg
    TERRAIN_CONNECT_DEG = min(grid_deg * 1.3, 0.11)  # cap at ~12 km to limit road connections

    COVER_MOVE: dict[str, float] = {
        "plains": 1.0, "steppe": 1.1, "shrubland": 1.2, "light_forest": 1.3,
        "dense_forest": 1.8, "jungle": 2.5, "desert": 1.4, "swamp": 2.0,
        "tundra": 1.5, "glacier": 9999.0, "urban": 0.9,
    }
    ELEV_MOVE: dict[str, float] = {"flat": 1.0, "hills": 1.4, "mountains": 2.2}

    # Build spatial indices (same pattern as generate_waypoints)
    cover_feats = sources.get("cover", [])
    elev_feats  = sources.get("elevation", [])
    river_feats = sources.get("rivers", [])
    water_feats = sources.get("base_water", [])

    cover_geoms = [shape(f["geometry"]) for f in cover_feats]
    elev_geoms  = [shape(f["geometry"]) for f in elev_feats]
    river_geoms = [shape(f["geometry"]) for f in river_feats]
    water_geoms = [shape(f["geometry"]) for f in water_feats]
    river_sizes = [f["properties"].get("river_size", "stream") for f in river_feats]

    cover_tree = STRtree(cover_geoms) if cover_geoms else None
    elev_tree  = STRtree(elev_geoms)  if elev_geoms  else None
    river_tree = STRtree(river_geoms) if river_geoms else None
    water_tree = STRtree(water_geoms) if water_geoms else None

    prov_feats  = sources.get("provinces", [])
    prov_geoms  = [shape(f["geometry"]) for f in prov_feats]
    prov_nids   = [f["properties"].get("nation_id") for f in prov_feats]
    prov_tree   = STRtree(prov_geoms) if prov_geoms else None

    def _in_water(lng: float, lat: float) -> bool:
        pt = Point(lng, lat)
        if water_tree is None:
            return False
        for idx in water_tree.query(pt, predicate="intersects"):
            if water_geoms[idx].contains(pt):
                return True
        return False

    def _tag(lng: float, lat: float) -> tuple[str, str, str | None]:
        pt = Point(lng, lat)
        cover_combat, elevation = "plains", "flat"
        nation_id = None
        if cover_tree is not None:
            for idx in cover_tree.query(pt, predicate="intersects"):
                if cover_geoms[idx].contains(pt):
                    cover_combat = cover_feats[idx]["properties"].get("cover_combat", "plains")
                    break
        if elev_tree is not None:
            for idx in elev_tree.query(pt, predicate="intersects"):
                if elev_geoms[idx].contains(pt):
                    elevation = _get_elev_type(elev_feats[idx]["properties"]) or "flat"
                    break
        if prov_tree is not None:
            for idx in prov_tree.query(pt, predicate="intersects"):
                if prov_geoms[idx].contains(pt):
                    nation_id = prov_nids[idx]
                    break
        return cover_combat, elevation, nation_id

    def _river_crossing(lng0: float, lat0: float, lng1: float, lat1: float) -> str | None:
        seg = ShapelyLS([(lng0, lat0), (lng1, lat1)])
        if river_tree is not None:
            for idx in river_tree.query(seg, predicate="intersects"):
                if seg.intersects(river_geoms[idx]):
                    return river_sizes[idx]
        return None

    road_nodes = existing_wp.get("nodes", [])
    if not road_nodes:
        print("  [WARN] No road nodes found — skipping terrain grid")
        return [], []

    all_lngs = [n["lng"] for n in road_nodes]
    all_lats = [n["lat"] for n in road_nodes]
    min_lng, max_lng = min(all_lngs), max(all_lngs)
    min_lat, max_lat = min(all_lats), max(all_lats)

    # Adjust lng step for latitude to keep grid cells roughly square
    lat_mid  = (min_lat + max_lat) / 2
    lng_step = TERRAIN_GRID_DEG / math.cos(math.radians(lat_mid))
    lat_step = TERRAIN_GRID_DEG

    # Spatial index over road nodes for snapping connection edges
    road_pts  = [Point(n["lng"], n["lat"]) for n in road_nodes]
    road_tree = STRtree(road_pts)
    road_ids  = [n["id"] for n in road_nodes]

    # 1. Generate terrain grid nodes
    grid_map:  dict[tuple[int, int], dict] = {}
    new_nodes: list[dict] = []
    node_counter = 1

    lat = min_lat
    while lat <= max_lat + lat_step * 0.5:
        gy  = round((lat - min_lat) / lat_step)
        lng = min_lng
        while lng <= max_lng + lng_step * 0.5:
            gx = round((lng - min_lng) / lng_step)
            if not _in_water(lng, lat):
                cover_combat, elevation, nation_id = _tag(lng, lat)
                if COVER_MOVE.get(cover_combat, 1.0) < 9000:  # skip glacier
                    node: dict = {
                        "id":           f"{id_prefix}_{node_counter:06d}",
                        "lng":          round(lng, 6),
                        "lat":          round(lat, 6),
                        "cover_combat": cover_combat,
                        "elevation":    elevation,
                        "nation_id":    nation_id,
                    }
                    grid_map[(gx, gy)] = node
                    new_nodes.append(node)
                    node_counter += 1
            lng += lng_step
        lat += lat_step

    print(f"  terrain grid: {len(new_nodes)} nodes")

    # 2. Connect 8-adjacent terrain grid neighbors
    new_edges:        list[dict] = []
    seen_terrain_edges: set[tuple[str, str]] = set()

    for (gx, gy), node in grid_map.items():
        for dgx, dgy in [(-1, 0), (1, 0), (0, -1), (0, 1),
                          (-1, -1), (-1, 1), (1, -1), (1, 1)]:
            nb = grid_map.get((gx + dgx, gy + dgy))
            if nb is None:
                continue
            edge_key = (min(node["id"], nb["id"]), max(node["id"], nb["id"]))
            if edge_key in seen_terrain_edges:
                continue
            seen_terrain_edges.add(edge_key)
            c1 = COVER_MOVE.get(node["cover_combat"], 1.0) * ELEV_MOVE.get(node["elevation"], 1.0)
            c2 = COVER_MOVE.get(nb["cover_combat"],   1.0) * ELEV_MOVE.get(nb["elevation"],   1.0)
            river = _river_crossing(node["lng"], node["lat"], nb["lng"], nb["lat"])
            new_edges.append({
                "from":       node["id"],
                "to":         nb["id"],
                "base_cost":  round((c1 + c2) / 2, 3),
                "river_size": river,
            })

    # 3. Snap terrain nodes to nearby road nodes with connection edges
    connect_sq = TERRAIN_CONNECT_DEG ** 2
    road_seen_pairs: set[tuple[str, str]] = set()

    for node in new_nodes:
        pt = Point(node["lng"], node["lat"])
        for idx in road_tree.query(pt.buffer(TERRAIN_CONNECT_DEG), predicate="intersects"):
            rpt = road_pts[idx]
            dist_sq = (node["lng"] - rpt.x) ** 2 + (node["lat"] - rpt.y) ** 2
            if dist_sq > connect_sq:
                continue
            pair = (node["id"], road_ids[idx])
            if pair in road_seen_pairs:
                continue
            road_seen_pairs.add(pair)
            cost  = round(
                COVER_MOVE.get(node["cover_combat"], 1.0) *
                ELEV_MOVE.get(node["elevation"],    1.0), 3
            )
            river = _river_crossing(node["lng"], node["lat"], rpt.x, rpt.y)
            new_edges.append({
                "from":       node["id"],
                "to":         road_ids[idx],
                "base_cost":  cost,
                "river_size": river,
            })

    road_conn_count = len(road_seen_pairs)
    print(f"  terrain grid: {len(new_edges)} edges ({road_conn_count} road connections)")
    return new_nodes, new_edges


def generate_nonuniform_terrain_grid(
    sources: dict,
    existing_wp: dict,
    id_prefix: str = "ct",
) -> tuple[list[dict], list[dict]]:
    """
    Non-uniform coarse terrain grid for client-side off-road routing.

    Sampling density adapts to terrain type:
      complex (dense_forest, jungle, swamp, urban, mountains): COMPLEX_STEP (~7.5 km)
      medium  (light_forest, shrubland, hills):                MEDIUM_STEP  (~11 km)
      open    (plains, steppe, desert, tundra):                OPEN_STEP    (~22 km)

    Nodes are generated by three independent grid sweeps (one per tier), then
    merged and deduplicated. Edges connect any two nodes within CONNECT_DEG.
    """
    OPEN_STEP    = 0.20   # degrees — same density as old uniform grid in open terrain
    MEDIUM_STEP  = 0.10   # denser in transitional terrain
    COMPLEX_STEP = 0.07   # finest in terrain that most constrains movement

    CONNECT_DEG      = 0.40   # must exceed lng_step=OPEN_STEP/cos_lat≈0.285° and its diagonal≈0.348°; stays below English Channel (~0.55° in degree-space)
    ROAD_CONNECT_DEG = 0.11   # road snap radius — matches original generate_terrain_grid cap
    K_TERRAIN        = 8      # max terrain-to-terrain neighbors (mirrors original 8-adjacency)
    K_ROAD           = 3      # max road nodes to snap per terrain node

    COMPLEX_COVERS = {"dense_forest", "jungle", "swamp", "urban"}
    MEDIUM_COVERS  = {"light_forest", "shrubland"}
    COMPLEX_ELEVS  = {"mountains"}
    MEDIUM_ELEVS   = {"hills"}

    COVER_MOVE: dict[str, float] = {
        "plains": 1.0, "steppe": 1.1, "shrubland": 1.2, "light_forest": 1.3,
        "dense_forest": 1.8, "jungle": 2.5, "desert": 1.4, "swamp": 2.0,
        "tundra": 1.5, "glacier": 9999.0, "urban": 0.9,
    }
    ELEV_MOVE: dict[str, float] = {"flat": 1.0, "hills": 1.4, "mountains": 2.2}

    cover_feats = sources.get("cover", [])
    elev_feats  = sources.get("elevation", [])
    river_feats = sources.get("rivers", [])
    water_feats = sources.get("base_water", [])

    cover_geoms  = [shape(f["geometry"]) for f in cover_feats]
    elev_geoms   = [shape(f["geometry"]) for f in elev_feats]
    river_geoms  = [shape(f["geometry"]) for f in river_feats]
    water_geoms  = [shape(f["geometry"]) for f in water_feats]
    river_sizes  = [f["properties"].get("river_size", "stream") for f in river_feats]

    cover_tree = STRtree(cover_geoms) if cover_geoms else None
    elev_tree  = STRtree(elev_geoms)  if elev_geoms  else None
    river_tree = STRtree(river_geoms) if river_geoms else None
    water_tree = STRtree(water_geoms) if water_geoms else None

    prov_feats  = sources.get("provinces", [])
    prov_geoms  = [shape(f["geometry"]) for f in prov_feats]
    prov_nids   = [f["properties"].get("nation_id") for f in prov_feats]
    prov_tree   = STRtree(prov_geoms) if prov_geoms else None

    def _in_water(lng: float, lat: float) -> bool:
        pt = Point(lng, lat)
        if water_tree is None:
            return False
        for idx in water_tree.query(pt, predicate="intersects"):
            if water_geoms[idx].contains(pt):
                return True
        return False

    def _tag(lng: float, lat: float) -> tuple[str, str, str | None]:
        pt = Point(lng, lat)
        cover_combat, elevation = "plains", "flat"
        nation_id = None
        if cover_tree is not None:
            for idx in cover_tree.query(pt, predicate="intersects"):
                if cover_geoms[idx].contains(pt):
                    cover_combat = cover_feats[idx]["properties"].get("cover_combat", "plains")
                    break
        if elev_tree is not None:
            for idx in elev_tree.query(pt, predicate="intersects"):
                if elev_geoms[idx].contains(pt):
                    elevation = _get_elev_type(elev_feats[idx]["properties"]) or "flat"
                    break
        if prov_tree is not None:
            for idx in prov_tree.query(pt, predicate="intersects"):
                if prov_geoms[idx].contains(pt):
                    nation_id = prov_nids[idx]
                    break
        return cover_combat, elevation, nation_id

    def _river_crossing(lng0: float, lat0: float, lng1: float, lat1: float) -> str | None:
        seg = ShapelyLS([(lng0, lat0), (lng1, lat1)])
        if river_tree is not None:
            for idx in river_tree.query(seg, predicate="intersects"):
                if seg.intersects(river_geoms[idx]):
                    return river_sizes[idx]
        return None

    def _tier(cover: str, elev: str) -> str:
        if cover in COMPLEX_COVERS or elev in COMPLEX_ELEVS:
            return "complex"
        if cover in MEDIUM_COVERS or elev in MEDIUM_ELEVS:
            return "medium"
        return "open"

    road_nodes = existing_wp.get("nodes", [])
    if not road_nodes:
        print("  [WARN] No road nodes found — skipping non-uniform terrain grid")
        return [], []

    all_lngs = [n["lng"] for n in road_nodes]
    all_lats = [n["lat"] for n in road_nodes]
    min_lng, max_lng = min(all_lngs), max(all_lngs)
    min_lat, max_lat = min(all_lats), max(all_lats)

    lat_mid = (min_lat + max_lat) / 2
    cos_lat = math.cos(math.radians(lat_mid))

    road_pts      = [Point(n["lng"], n["lat"]) for n in road_nodes]
    road_strtree  = STRtree(road_pts)
    road_ids      = [n["id"] for n in road_nodes]

    # Deduplicate at ~100 m resolution (same as generate_waypoints)
    node_by_key: dict[tuple[int, int], dict] = {}
    node_counter = [1]

    def _try_add(lng: float, lat: float) -> None:
        if lng < min_lng or lng > max_lng or lat < min_lat or lat > max_lat:
            return
        if _in_water(lng, lat):
            return
        cover, elev, nation_id = _tag(lng, lat)
        if COVER_MOVE.get(cover, 1.0) >= 9000:
            return
        key = (round(lng * 100_000), round(lat * 100_000))
        if key in node_by_key:
            return
        nid = f"{id_prefix}_{node_counter[0]:06d}"
        node_counter[0] += 1
        node_by_key[key] = {
            "id": nid, "lng": round(lng, 6), "lat": round(lat, 6),
            "cover_combat": cover, "elevation": elev, "nation_id": nation_id,
        }

    # Three sweeps — each only emits the tier it owns (or finer).
    # Open sweep: all land at OPEN_STEP.
    step     = OPEN_STEP
    lng_step = step / cos_lat
    lat = min_lat
    while lat <= max_lat + step * 0.5:
        lng = min_lng
        while lng <= max_lng + lng_step * 0.5:
            _try_add(lng, lat)
            lng += lng_step
        lat += step

    # Medium sweep: medium + complex terrain at MEDIUM_STEP.
    step     = MEDIUM_STEP
    lng_step = step / cos_lat
    lat = min_lat
    while lat <= max_lat + step * 0.5:
        lng = min_lng
        while lng <= max_lng + lng_step * 0.5:
            cover, elev, _ = _tag(lng, lat)
            if _tier(cover, elev) in ("medium", "complex"):
                _try_add(lng, lat)
            lng += lng_step
        lat += step

    # Complex sweep: complex terrain only at COMPLEX_STEP.
    step     = COMPLEX_STEP
    lng_step = step / cos_lat
    lat = min_lat
    while lat <= max_lat + step * 0.5:
        lng = min_lng
        while lng <= max_lng + lng_step * 0.5:
            cover, elev, _ = _tag(lng, lat)
            if _tier(cover, elev) == "complex":
                _try_add(lng, lat)
            lng += lng_step
        lat += step

    new_nodes = list(node_by_key.values())
    print(f"  non-uniform terrain grid: {len(new_nodes)} nodes ({id_prefix})")

    # Build STRtree for proximity-based edge generation.
    new_pts  = [Point(n["lng"], n["lat"]) for n in new_nodes]
    new_tree = STRtree(new_pts)

    new_edges:   list[dict] = []
    seen_edges:  set[tuple[str, str]] = set()
    connect_sq = CONNECT_DEG ** 2

    for i, node in enumerate(new_nodes):
        pt = Point(node["lng"], node["lat"])
        candidates: list[tuple[float, int]] = []
        for j in new_tree.query(pt.buffer(CONNECT_DEG), predicate="intersects"):
            if i == j:
                continue
            nb = new_nodes[j]
            dist_sq = (node["lng"] - nb["lng"]) ** 2 + (node["lat"] - nb["lat"]) ** 2
            if dist_sq <= connect_sq:
                candidates.append((dist_sq, j))
        candidates.sort()
        for _, j in candidates[:K_TERRAIN]:
            nb = new_nodes[j]
            edge_key = (min(node["id"], nb["id"]), max(node["id"], nb["id"]))
            if edge_key in seen_edges:
                continue
            seen_edges.add(edge_key)
            c1 = COVER_MOVE.get(node["cover_combat"], 1.0) * ELEV_MOVE.get(node["elevation"], 1.0)
            c2 = COVER_MOVE.get(nb["cover_combat"],   1.0) * ELEV_MOVE.get(nb["elevation"],   1.0)
            river = _river_crossing(node["lng"], node["lat"], nb["lng"], nb["lat"])
            new_edges.append({
                "from": node["id"], "to": nb["id"],
                "base_cost": round((c1 + c2) / 2, 3), "river_size": river,
            })

    # Snap each terrain node to at most K_ROAD nearest road nodes.
    road_connect_sq  = ROAD_CONNECT_DEG ** 2
    road_seen_pairs: set[tuple[str, str]] = set()

    for node in new_nodes:
        pt = Point(node["lng"], node["lat"])
        candidates: list[tuple[float, int]] = []
        for idx in road_strtree.query(pt.buffer(ROAD_CONNECT_DEG), predicate="intersects"):
            rpt = road_pts[idx]
            dist_sq = (node["lng"] - rpt.x) ** 2 + (node["lat"] - rpt.y) ** 2
            if dist_sq <= road_connect_sq:
                candidates.append((dist_sq, idx))
        candidates.sort()
        for _, idx in candidates[:K_ROAD]:
            rpt = road_pts[idx]
            pair = (node["id"], road_ids[idx])
            if pair in road_seen_pairs:
                continue
            road_seen_pairs.add(pair)
            cost  = round(
                COVER_MOVE.get(node["cover_combat"], 1.0) *
                ELEV_MOVE.get(node["elevation"],    1.0), 3
            )
            river = _river_crossing(node["lng"], node["lat"], rpt.x, rpt.y)
            new_edges.append({
                "from": node["id"], "to": road_ids[idx],
                "base_cost": cost, "river_size": river,
            })

    road_conn_count = len(road_seen_pairs)
    print(f"  non-uniform terrain grid: {len(new_edges)} edges ({road_conn_count} road connections)")
    return new_nodes, new_edges


def insert_boundary_nodes(
    sources: dict,
    existing_wp: dict,
    boundary_sample_deg: float = 1.0,
) -> tuple[list[dict], list[dict]]:
    """
    Insert nodes along every terrain-category boundary (cover or elevation changes).
    Two nodes per sample point: one offset to each side of the boundary.
    ID prefix: bn_

    Performance: dissolves individual polygons by type before boundary detection,
    reducing O(n^2) polygon-pair checks to O(k^2) type-pair checks (~55 pairs for
    11 cover types vs. 72M pairs for 12k individual polygons).
    """
    BOUNDARY_OFFSET_DEG = 0.0001   # ~11m perpendicular offset
    K_CONNECT = 8                  # max neighbours per new node (matches K_TERRAIN)

    COVER_MOVE: dict[str, float] = {
        "plains": 1.0, "steppe": 1.1, "shrubland": 1.2, "light_forest": 1.3,
        "dense_forest": 1.8, "jungle": 2.5, "desert": 1.4, "swamp": 2.0,
        "tundra": 1.5, "glacier": 9999.0, "urban": 0.9,
    }
    ELEV_MOVE: dict[str, float] = {"flat": 1.0, "hills": 1.4, "mountains": 2.2}

    cover_feats = sources.get("cover", [])
    elev_feats  = sources.get("elevation", [])
    water_feats = sources.get("base_water", [])
    prov_feats  = sources.get("provinces", [])

    cover_geoms = [shape(f["geometry"]) for f in cover_feats]
    elev_geoms  = [shape(f["geometry"]) for f in elev_feats]
    water_geoms = [shape(f["geometry"]) for f in water_feats]
    prov_geoms  = [shape(f["geometry"]) for f in prov_feats]
    prov_nids   = [f["properties"].get("nation_id") for f in prov_feats]

    cover_tree = STRtree(cover_geoms) if cover_geoms else None
    elev_tree  = STRtree(elev_geoms)  if elev_geoms  else None
    water_union = unary_union(water_geoms) if water_geoms else None
    prov_tree  = STRtree(prov_geoms)  if prov_geoms  else None

    def _in_water(lng: float, lat: float) -> bool:
        if water_union is None:
            return False
        pt = Point(lng, lat)
        return water_union.contains(pt)

    def _tag_point(lng: float, lat: float) -> tuple[str, str, str | None]:
        pt = Point(lng, lat)
        cover_combat, elevation, nation_id = "plains", "flat", None
        if cover_tree:
            for idx in cover_tree.query(pt, predicate="intersects"):
                if cover_geoms[idx].contains(pt):
                    cover_combat = cover_feats[idx]["properties"].get("cover_combat", "plains")
                    break
        if elev_tree:
            for idx in elev_tree.query(pt, predicate="intersects"):
                if elev_geoms[idx].contains(pt):
                    elevation = _get_elev_type(elev_feats[idx]["properties"]) or "flat"
                    break
        if prov_tree:
            for idx in prov_tree.query(pt, predicate="intersects"):
                if prov_geoms[idx].contains(pt):
                    nation_id = prov_nids[idx]
                    break
        return cover_combat, elevation, nation_id

    def _sample_boundary(geom_a, geom_b) -> list[tuple[float, float]]:
        """Sample points along the shared boundary between two polygons."""
        try:
            boundary = geom_a.boundary.intersection(geom_b.boundary)
        except Exception:
            return []
        if boundary.is_empty:
            return []
        coords: list[tuple[float, float]] = []
        lines = []
        if boundary.geom_type == "LineString":
            lines = [list(boundary.coords)]
        elif boundary.geom_type == "MultiLineString":
            lines = [list(g.coords) for g in boundary.geoms]
        elif boundary.geom_type == "GeometryCollection":
            for g in boundary.geoms:
                if g.geom_type in ("LineString", "MultiLineString"):
                    if g.geom_type == "LineString":
                        lines.append(list(g.coords))
                    else:
                        lines.extend([list(l.coords) for l in g.geoms])
        for line in lines:
            if len(line) < 2:
                continue
            current = 0.0
            for i in range(len(line) - 1):
                lng0, lat0 = line[i][0], line[i][1]
                lng1, lat1 = line[i+1][0], line[i+1][1]
                seg_len = math.hypot(lng1 - lng0, lat1 - lat0)
                while current <= seg_len:
                    t = current / seg_len if seg_len > 0 else 0.0
                    coords.append((lng0 + t * (lng1 - lng0), lat0 + t * (lat1 - lat0)))
                    current += boundary_sample_deg
                current -= seg_len
        return coords

    # Collect all boundary points from cover and elevation type boundaries.
    #
    # PERFORMANCE NOTE: Do NOT iterate individual polygon pairs (O(n^2) with 12k polys
    # -> 767k+ sample points, pipeline timeout). Instead dissolve by type first so we
    # only check O(k^2) type-pair boundaries (~11 cover types -> 55 pairs).
    bn_samples: list[tuple[float, float]] = []

    # Cover boundaries — dissolve per cover_combat type, then find type-pair boundaries
    cover_by_type: dict[str, list] = defaultdict(list)
    for g, f in zip(cover_geoms, cover_feats):
        cover_by_type[f["properties"].get("cover_combat", "plains")].append(g)
    cover_dissolved = {ct: unary_union([g.buffer(0) for g in geoms]) for ct, geoms in cover_by_type.items()}
    cover_types = list(cover_dissolved.keys())
    print(f"  boundary nodes: dissolving {len(cover_geoms)} cover polys into {len(cover_types)} types")
    for i in range(len(cover_types)):
        for j in range(i + 1, len(cover_types)):
            pts = _sample_boundary(cover_dissolved[cover_types[i]], cover_dissolved[cover_types[j]])
            bn_samples.extend(pts)

    # Elevation boundaries — same dissolve-first approach
    elev_by_type: dict[str, list] = defaultdict(list)
    for g, f in zip(elev_geoms, elev_feats):
        elev_by_type[_get_elev_type(f["properties"]) or "flat"].append(g)
    elev_dissolved = {et: unary_union([g.buffer(0) for g in geoms]) for et, geoms in elev_by_type.items()}
    elev_types = list(elev_dissolved.keys())
    print(f"  boundary nodes: dissolving {len(elev_geoms)} elev polys into {len(elev_types)} types")
    for i in range(len(elev_types)):
        for j in range(i + 1, len(elev_types)):
            pts = _sample_boundary(elev_dissolved[elev_types[i]], elev_dissolved[elev_types[j]])
            bn_samples.extend(pts)

    print(f"  boundary nodes: {len(bn_samples)} raw sample points")

    # For each sample, insert two offset nodes (one each side of boundary)
    new_nodes: list[dict] = []
    bn_counter = 1

    for lng, lat in bn_samples:
        if _in_water(lng, lat):
            continue
        for dlng, dlat in [(BOUNDARY_OFFSET_DEG, 0.0), (-BOUNDARY_OFFSET_DEG, 0.0), (0.0, BOUNDARY_OFFSET_DEG), (0.0, -BOUNDARY_OFFSET_DEG)]:
            nlng = round(lng + dlng, 6)
            nlat = round(lat + dlat, 6)
            if _in_water(nlng, nlat):
                continue
            cover, elev, nation_id = _tag_point(nlng, nlat)
            if COVER_MOVE.get(cover, 1.0) >= 9000:
                continue
            nid = f"bn_{bn_counter:06d}"
            bn_counter += 1
            new_nodes.append({
                "id": nid, "lng": nlng, "lat": nlat,
                "cover_combat": cover, "elevation": elev, "nation_id": nation_id,
            })

    print(f"  boundary nodes: {len(new_nodes)} nodes after water/glacier filter")

    # Connect each boundary node to K_CONNECT nearest existing nodes
    all_existing = existing_wp.get("nodes", []) + new_nodes
    all_pts = [Point(n["lng"], n["lat"]) for n in all_existing]
    all_tree = STRtree(all_pts)
    all_ids  = [n["id"] for n in all_existing]

    CONNECT_DEG = 0.40
    connect_sq  = CONNECT_DEG ** 2

    new_edges: list[dict] = []
    seen_edges: set[tuple[str, str]] = set()

    for node in new_nodes:
        pt = Point(node["lng"], node["lat"])
        candidates: list[tuple[float, int]] = []
        for idx in all_tree.query(pt.buffer(CONNECT_DEG), predicate="intersects"):
            nb = all_existing[idx]
            if nb["id"] == node["id"]:
                continue
            dist_sq = (node["lng"] - nb["lng"])**2 + (node["lat"] - nb["lat"])**2
            if dist_sq <= connect_sq:
                candidates.append((dist_sq, idx))
        candidates.sort()
        for _, idx in candidates[:K_CONNECT]:
            nb = all_existing[idx]
            ekey = (min(node["id"], nb["id"]), max(node["id"], nb["id"]))
            if ekey in seen_edges:
                continue
            seen_edges.add(ekey)
            c1 = COVER_MOVE.get(node["cover_combat"], 1.0) * ELEV_MOVE.get(node["elevation"], 1.0)
            c2 = COVER_MOVE.get(nb["cover_combat"],   1.0) * ELEV_MOVE.get(nb.get("elevation", "flat"), 1.0)
            new_edges.append({
                "from": node["id"], "to": nb["id"],
                "base_cost": round((c1 + c2) / 2, 3), "river_size": None,
            })

    print(f"  boundary nodes: {len(new_edges)} edges")
    return new_nodes, new_edges


import heapq


def generate_hpa_clusters(
    sources: dict,
    existing_wp: dict,
    cluster_threshold: int = 300,
) -> dict:
    """
    Build recursive HPA* cluster hierarchy and precompute abstract edges.

    Step 1: Assign each waypoint node to its province via point-in-polygon.
    Step 2: Recursively sub-partition clusters with > cluster_threshold nodes
            using 2x2 bounding-box quadrant split.
    Step 3: Find border nodes (nodes with at least one edge crossing to a
            different leaf cluster).
    Step 4: Precompute intra-cluster A* costs between all border node pairs.
    Step 5: Build abstract edge list.

    Returns: dict compatible with waypoints_clusters.json format.
    """
    from shapely.geometry import shape, Point
    from shapely.strtree import STRtree

    # Step 1: Province assignment
    prov_feats = sources.get("provinces", [])
    prov_geoms = [shape(f["geometry"]) for f in prov_feats]
    prov_ids   = [f["properties"]["province_id"] for f in prov_feats]
    prov_tree  = STRtree(prov_geoms) if prov_geoms else None

    node_province: dict[str, str] = {}
    for node in existing_wp.get("nodes", []):
        pt = Point(node["lng"], node["lat"])
        assigned = "sea"
        if prov_tree:
            for idx in prov_tree.query(pt, predicate="intersects"):
                if prov_geoms[idx].contains(pt):
                    assigned = prov_ids[idx]
                    break
        node_province[node["id"]] = assigned

    province_nodes: dict[str, list[str]] = {}
    for nid, pid in node_province.items():
        if pid == "sea":
            continue
        province_nodes.setdefault(pid, []).append(nid)

    node_coords: dict[str, tuple[float, float]] = {}
    for node in existing_wp.get("nodes", []):
        node_coords[node["id"]] = (node["lng"], node["lat"])

    adjacency: dict[str, list[str]] = {}
    for edge in existing_wp.get("edges", []):
        adjacency.setdefault(edge["from"], []).append(edge["to"])
        adjacency.setdefault(edge["to"],   []).append(edge["from"])

    # Step 2: Recursive sub-partitioning
    def _partition(node_ids: list[str], province_id: str, depth: int, parent_id: str | None,
                   node_coords: dict[str, tuple[float, float]]) -> list[dict]:
        cluster_id = f"c_{province_id}_{depth}_{parent_id or 'root'}"
        cluster: dict = {
            "id": cluster_id,
            "province_id": province_id,
            "parent": parent_id,
            "children": [],
            "border_nodes": [],
            "node_ids": node_ids,
        }
        if len(node_ids) <= cluster_threshold:
            return [cluster]
        lngs = [node_coords[nid][0] for nid in node_ids]
        lats = [node_coords[nid][1] for nid in node_ids]
        mid_lng = (min(lngs) + max(lngs)) / 2
        mid_lat = (min(lats) + max(lats)) / 2
        quads: dict[str, list[str]] = {"NW": [], "NE": [], "SW": [], "SE": []}
        for nid in node_ids:
            lng, lat = node_coords[nid]
            q = ("N" if lat >= mid_lat else "S") + ("E" if lng >= mid_lng else "W")
            quads[q].append(nid)
        children = []
        for qname, qnids in quads.items():
            if not qnids:
                continue
            sub = _partition(qnids, province_id, depth + 1, cluster_id, node_coords)
            children.extend(sub)
        cluster["children"] = [c["id"] for c in children]
        return [cluster] + children

    all_clusters: list[dict] = []
    for pid, nids in province_nodes.items():
        clusters = _partition(nids, pid, 0, None, node_coords)
        all_clusters.extend(clusters)

    # Step 3: Border node detection
    leaf_cluster_of: dict[str, str] = {}
    for cluster in all_clusters:
        if not cluster["children"]:
            for nid in cluster["node_ids"]:
                leaf_cluster_of[nid] = cluster["id"]

    border_nodes: set[str] = set()
    for nid, neighbours in adjacency.items():
        my_cluster = leaf_cluster_of.get(nid)
        if my_cluster is None:
            continue
        for nb in neighbours:
            if leaf_cluster_of.get(nb) != my_cluster:
                border_nodes.add(nid)
                break

    border_by_cluster: dict[str, set[str]] = {}
    for nid in border_nodes:
        cid = leaf_cluster_of.get(nid)
        if cid:
            border_by_cluster.setdefault(cid, set()).add(nid)

    for cluster in all_clusters:
        if not cluster["children"]:
            cluster["border_nodes"] = list(border_by_cluster.get(cluster["id"], []))

    # Step 4: Precompute intra-cluster border costs
    def _astar_in_cluster(start: str, goal: str, cluster_node_ids: set[str],
                          adjacency: dict, node_coords: dict) -> float | None:
        if start == goal:
            return 0.0
        def heuristic(a, b):
            ax, ay = node_coords[a]; bx, by = node_coords[b]
            return math.hypot(ax-bx, ay-by)
        heap = [(0.0, start)]
        dist = {start: 0.0}
        while heap:
            d, u = heapq.heappop(heap)
            if d > dist.get(u, float("inf")):
                continue
            if u == goal:
                return d
            for v in adjacency.get(u, []):
                if v not in cluster_node_ids:
                    continue
                nd = d + heuristic(u, v)
                if nd < dist.get(v, float("inf")):
                    dist[v] = nd
                    heapq.heappush(heap, (nd, v))
        return None

    abstract_edges: list[dict] = []
    for cid, bnids in border_by_cluster.items():
        cluster_node_ids = set(leaf_cluster_of.keys())
        bn_list = list(bnids)
        for i in range(len(bn_list)):
            for j in range(i + 1, len(bn_list)):
                cost = _astar_in_cluster(bn_list[i], bn_list[j], cluster_node_ids, adjacency, node_coords)
                if cost is not None:
                    abstract_edges.append({
                        "from": bn_list[i], "to": bn_list[j],
                        "cluster_id": cid, "cost": round(cost, 3),
                    })

    # Step 5: Build output (strip temporary node_ids)
    output_clusters = []
    for c in all_clusters:
        output_clusters.append({
            "id": c["id"],
            "province_id": c["province_id"],
            "parent": c["parent"],
            "children": c["children"],
            "border_nodes": c["border_nodes"],
        })

    print(f"  HPA clusters: {len(output_clusters)} clusters, {len(abstract_edges)} abstract edges")
    return {
        "cluster_threshold": cluster_threshold,
        "clusters": output_clusters,
        "abstract_edges": abstract_edges,
    }


def copy_passthrough_files(map_dir: Path, output_dir: Path) -> None:
    """
    Copy visual-layer files unchanged from map_dir to output_dir.

    These files are read directly by Godot for rendering (cover, elevation,
    rivers, roads) and require no processing by the pipeline.
    """
    for filename in PASSTHROUGH_FILES:
        src = map_dir / filename
        src_path = Path(filename)
        dst_name = src_path.stem + ".json" if src_path.suffix == ".geojson" else filename
        dst = output_dir / dst_name
        if src.exists():
            shutil.copy2(src, dst)
            print(f"  Copied {filename} → {dst_name}")
        else:
            print(f"  [WARN] Passthrough file not found: {src}", file=sys.stderr)


# ── subprovince full-map orchestration ──────────────────────────────────────

MANIFEST_NAME = "subprovince_generation_report.json"


def build_subprovince_config(map_config: dict) -> SubprovinceConfig:
    """Build SubprovinceConfig from map.json's subprovince section, falling back to defaults."""
    subprovince_values = map_config.get("subprovince", {})
    field_defaults = default_config().__dict__
    return SubprovinceConfig(
        city_radius=float(subprovince_values.get("city_radius", field_defaults["city_radius"])),
        city_noise_amplitude=float(subprovince_values.get("city_noise_amplitude", field_defaults["city_noise_amplitude"])),
        city_noise_wavelength=float(subprovince_values.get("city_noise_wavelength", field_defaults["city_noise_wavelength"])),
        urban_min_area=float(subprovince_values.get("urban_min_area", field_defaults["urban_min_area"])),
        urban_target_area=float(subprovince_values.get("urban_target_area", field_defaults["urban_target_area"])),
        road_width=float(subprovince_values.get("road_width", field_defaults["road_width"])),
        road_segment_length=float(subprovince_values.get("road_segment_length", field_defaults["road_segment_length"])),
        hinterland_target_area=float(subprovince_values.get("hinterland_target_area", field_defaults["hinterland_target_area"])),
        hinterland_max_area=float(subprovince_values.get("hinterland_max_area", field_defaults["hinterland_max_area"])),
        min_area=float(subprovince_values.get("min_area", field_defaults["min_area"])),
        road_min_area=float(subprovince_values.get("road_min_area", field_defaults["road_min_area"])),
        hinterland_tiny_grid_cells=float(subprovince_values.get("hinterland_tiny_grid_cells", field_defaults["hinterland_tiny_grid_cells"])),
        hinterland_split_grid_cells=float(subprovince_values.get("hinterland_split_grid_cells", field_defaults["hinterland_split_grid_cells"])),
        natural_noise_amplitude=float(subprovince_values.get("natural_noise_amplitude", field_defaults["natural_noise_amplitude"])),
        natural_noise_wavelength=float(subprovince_values.get("natural_noise_wavelength", field_defaults["natural_noise_wavelength"])),
        geometry_tolerance=float(subprovince_values.get("geometry_tolerance", field_defaults["geometry_tolerance"])),
        seed=int(subprovince_values.get("seed", field_defaults["seed"])),
    )


def _reconstruct_polygons(path: Path) -> list:
    """Rebuild SubprovincePolygon objects from a published subprovinces.geojson file."""
    from shapely.geometry import shape as to_shape
    from subprovince_generator import SubprovincePolygon
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("type") != "FeatureCollection":
        raise ValueError(f"not a FeatureCollection: {path}")
    polygons = []
    for feature in data.get("features", []):
        props = feature.get("properties") or {}
        required = ("subprovince_id", "province_id", "kind", "cover_combat", "elevation_type", "is_capital")
        if not all(key in props for key in required) or feature.get("geometry") is None:
            raise ValueError(f"malformed subprovince feature in {path}")
        polygons.append(SubprovincePolygon(
            subprovince_id=props["subprovince_id"],
            province_id=props["province_id"],
            geometry=to_shape(feature["geometry"]),
            kind=props["kind"],
            cover_combat=props["cover_combat"],
            elevation_type=props["elevation_type"],
            is_capital=props["is_capital"],
        ))
    return polygons


def _reconstruct_adjacency(path: Path) -> dict[str, list[str]]:
    """Rebuild the adjacency mapping from a published subprovince_adjacency.geojson file."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("type") != "FeatureCollection":
        raise ValueError(f"not a FeatureCollection: {path}")
    adjacency = {}
    for feature in data.get("features", []):
        props = feature.get("properties") or {}
        if "subprovince_id" not in props or "neighbors" not in props:
            raise ValueError(f"malformed adjacency feature in {path}")
        adjacency[props["subprovince_id"]] = list(props["neighbors"])
    return adjacency


def merge_subprovince_outputs(existing_polygons: list, existing_adjacency: dict[str, list[str]],
                              new_polygons: list, new_adjacency: dict[str, list[str]],
                              replaced_province_ids: set[str]) -> tuple[list, dict[str, list[str]]]:
    """
    Merge newly generated provinces into existing full-map output.

    Drops every existing polygon belonging to a replaced province (their cells were
    regenerated), drops adjacent/neighbor references to now-absent cells, then adds the
    new polygons/adjacency. Neighbor lists are pruned to the final cell ID set so the
    merged file never references missing cells.
    """
    kept_polygons = [p for p in existing_polygons if p.province_id not in replaced_province_ids]
    kept_polygons = kept_polygons + list(new_polygons)
    final_ids = {p.subprovince_id for p in kept_polygons}
    merged_adjacency = dict(existing_adjacency)
    for key in [key for key in merged_adjacency if key not in final_ids]:
        del merged_adjacency[key]
    for key, neighbors in new_adjacency.items():
        merged_adjacency[key] = [n for n in neighbors if n in final_ids]
    for key in merged_adjacency:
        merged_adjacency[key] = [n for n in merged_adjacency[key] if n in final_ids]
    return kept_polygons, merged_adjacency


def write_subprovince_manifest(output_dir: Path, succeeded: list[str],
                               failed: list[dict]) -> Path:
    """Write the full-map generation report manifest, returning its path."""
    manifest_path = output_dir / MANIFEST_NAME
    manifest = {"succeeded": sorted(succeeded), "failed": sorted(failed, key=lambda item: item["province_id"])}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest_path


def run_full_map_subprovince_generation(sources: dict, config: SubprovinceConfig,
                                        output_dir: Path) -> tuple[list, dict[str, list[str]], list[str], list[dict]]:
    """
    Generate subprovinces for every province in sources['provinces'].

    Per-province failures are caught, recorded, and logged instead of aborting the run.
    Returns (merged_polygons, adjacency, succeeded_ids, failed_records). Does not publish —
    the caller publishes once after all provinces are processed (atomic publish).
    """
    succeeded: list[str] = []
    failed: list[dict] = []
    merged_polygons: list = []
    merged_adjacency: dict[str, list[str]] = {}
    province_features = list(sources["provinces"])
    print(f"Building subprovinces for {len(province_features)} provinces...")
    for feature in province_features:
        province_id = (feature.get("properties") or {}).get("province_id")
        if not province_id:
            failed.append({"province_id": "<missing_id>", "error": "feature without province_id"})
            continue
        try:
            polygons, adjacency = generate_real_province(feature, sources, config)
        except Exception as exc:
            failed.append({"province_id": province_id, "error": str(exc)})
            print(f"  [subprovince] FAIL {province_id}: {exc}", file=sys.stderr)
            continue
        succeeded.append(province_id)
        merged_polygons.extend(polygons)
        merged_adjacency.update(adjacency)
        print(f"  [subprovince] ok {province_id}: {len(polygons)} cells")
    return merged_polygons, merged_adjacency, succeeded, failed


def run_subprovince_retry(sources: dict, config: SubprovinceConfig,
                          output_dir: Path) -> tuple[list, dict[str, list[str]], list[str], list[dict]]:
    """
    Regenerate only previously-failed provinces and merge them into existing output.

    Reads subprovince_generation_report.json for the failed list, regenerates each, drops
    their stale cells from the published files, merges the fresh cells, and republishes.
    Returns the merged (polygons, adjacency, succeeded, failed_after_retry).
    """
    manifest_path = output_dir / MANIFEST_NAME
    if not manifest_path.exists():
        raise FileNotFoundError(f"no {MANIFEST_NAME} found in {output_dir} — run --subprovince-all-provinces first")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    failed_ids = [item["province_id"] for item in manifest.get("failed", [])]
    if not failed_ids:
        print("  No failed provinces to retry — output left untouched.")
        existing_polygons = _reconstruct_polygons(output_dir / "subprovinces.geojson")
        existing_adjacency = _reconstruct_adjacency(output_dir / "subprovince_adjacency.geojson")
        # Re-write the same manifest so the file is consistent even though output is a no-op.
        write_subprovince_manifest(output_dir, manifest.get("succeeded", []), [])
        return existing_polygons, existing_adjacency, manifest.get("succeeded", []), []

    existing_polygons = _reconstruct_polygons(output_dir / "subprovinces.geojson")
    existing_adjacency = _reconstruct_adjacency(output_dir / "subprovince_adjacency.geojson")
    province_features = {f["properties"]["province_id"]: f for f in sources["provinces"]
                         if (f.get("properties") or {}).get("province_id")}
    still_failed: list[dict] = []
    succeeded = list(manifest.get("succeeded", []))
    new_polygons: list = []
    new_adjacency: dict[str, list[str]] = {}
    print(f"Retrying {len(failed_ids)} failed provinces...")
    for province_id in failed_ids:
        feature = province_features.get(province_id)
        if feature is None:
            still_failed.append({"province_id": province_id, "error": "province no longer in source data"})
            print(f"  [subprovince] FAIL {province_id}: missing from source data", file=sys.stderr)
            continue
        try:
            polygons, adjacency = generate_real_province(feature, sources, config)
        except Exception as exc:
            still_failed.append({"province_id": province_id, "error": str(exc)})
            print(f"  [subprovince] FAIL {province_id}: {exc}", file=sys.stderr)
            continue
        succeeded.append(province_id)
        new_polygons.extend(polygons)
        new_adjacency.update(adjacency)
        print(f"  [subprovince] retry ok {province_id}: {len(polygons)} cells")
    merged_polygons, merged_adjacency = merge_subprovince_outputs(
        existing_polygons, existing_adjacency, new_polygons, new_adjacency, set(failed_ids))
    return merged_polygons, merged_adjacency, sorted(set(succeeded)), still_failed


def _warn_if_overwriting_full_map(output_dir: Path) -> None:
    """Warn when a single-province run would replace published full-map subprovince output."""
    manifest_path = output_dir / MANIFEST_NAME
    if not manifest_path.exists():
        return
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    succeeded = manifest.get("succeeded", [])
    if not isinstance(succeeded, list) or len(succeeded) < 2:
        return
    print(f"[WARN] {len(succeeded)} provinces have full-map subprovince output published "
          f"({MANIFEST_NAME}); a single-province run will REPLACE them. Re-run "
          f"--subprovince-all-provinces afterwards to restore full-map output.",
          file=sys.stderr)


def _print_subprovince_summary(succeeded: list[str], failed: list[dict],
                               polygons: list, adjacency: dict[str, list[str]]) -> None:
    print()
    print("── Summary ──────────────────────────────────")
    print(f"  Subprovince provinces: {len(succeeded)} succeeded, {len(failed)} failed")
    print(f"  Subprovince cells: {len(polygons)}")
    print(f"  Subprovince adjacency:{len(adjacency):>5}")
    print("  Subprovince validation: passed for generated provinces")
    print("─────────────────────────────────────────────")


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()

    # Resolve all paths relative to repo root
    map_dir = REPO_ROOT / "map" / args.map
    if not map_dir.exists():
        print(f"[ERROR] Map directory not found: {map_dir}", file=sys.stderr)
        sys.exit(1)

    map_json_path = map_dir / "map.json"
    if not map_json_path.exists():
        print(f"[ERROR] Missing map.json in {map_dir}", file=sys.stderr)
        sys.exit(1)

    with open(map_json_path) as f:
        map_config = json.load(f)

    map_id = map_config["map_id"]
    bounds = map_config["bounds"]
    simplify_tolerance = map_config.get("simplify_tolerance", 0.001)
    dem_dir = REPO_ROOT / "map" / map_config["dem_source"]
    output_dir = REPO_ROOT / "client" / "assets" / "data" / map_id

    print(f"Pipeline: {args.map} → {map_id}")
    print(f"  Output: {output_dir.relative_to(REPO_ROOT)}")

    # Validate all source files — exits on any error
    sources = validate_all(map_dir)

    if args.subprovince_all_provinces and args.subprovince_province:
        print("[ERROR] --subprovince-all-provinces and --subprovince-province are mutually exclusive",
              file=sys.stderr)
        sys.exit(1)

    subprovince_config = build_subprovince_config(map_config)

    if args.subprovince_all_provinces:
        output_dir.mkdir(parents=True, exist_ok=True)
        polygons, adjacency, succeeded, failed = run_full_map_subprovince_generation(
            sources, subprovince_config, output_dir)
        if polygons:
            publish_subprovince_outputs(output_dir, polygons, adjacency)
            print(f"  subprovinces.geojson: {len(polygons)} cells")
            print(f"  subprovince_adjacency.geojson: {len(adjacency)} nodes")
        write_subprovince_manifest(output_dir, succeeded, failed)
        _print_subprovince_summary(succeeded, failed, polygons, adjacency)
        print("Done.")
        if failed:
            print(f"[WARN] {len(failed)} province(s) failed — see {MANIFEST_NAME}", file=sys.stderr)
            sys.exit(1)
        return

    if args.subprovince_retry_failed:
        output_dir.mkdir(parents=True, exist_ok=True)
        polygons, adjacency, succeeded, failed = run_subprovince_retry(
            sources, subprovince_config, output_dir)
        if polygons:
            publish_subprovince_outputs(output_dir, polygons, adjacency)
            print(f"  subprovinces.geojson: {len(polygons)} cells")
            print(f"  subprovince_adjacency.geojson: {len(adjacency)} nodes")
        write_subprovince_manifest(output_dir, succeeded, failed)
        _print_subprovince_summary(succeeded, failed, polygons, adjacency)
        print("Done.")
        if failed:
            print(f"[WARN] {len(failed)} province(s) still failing — see {MANIFEST_NAME}", file=sys.stderr)
            sys.exit(1)
        return

    selected_subprovinces = None
    selected_subprovince_adjacency = None
    if args.subprovince_province is not None:
        _warn_if_overwriting_full_map(output_dir)
        province_feature = next(
            (feature for feature in sources["provinces"]
             if (feature.get("properties") or {}).get("province_id") == args.subprovince_province),
            None,
        )
        if province_feature is None:
            print(f"[ERROR] Selected subprovince province not found: {args.subprovince_province}", file=sys.stderr)
            sys.exit(1)
        print(f"Building subprovinces for {args.subprovince_province}...")
        try:
            selected_subprovinces, selected_subprovince_adjacency = generate_real_province(
                province_feature, sources, subprovince_config
            )
        except Exception as exc:
            print(f"[ERROR] Subprovince generation failed for {args.subprovince_province}: {exc}", file=sys.stderr)
            sys.exit(1)

    if args.subprovince_only:
        if selected_subprovinces is None or selected_subprovince_adjacency is None:
            print("[ERROR] --subprovince-only requires --subprovince-province", file=sys.stderr)
            sys.exit(1)
        output_dir.mkdir(parents=True, exist_ok=True)
        publish_subprovince_outputs(output_dir, selected_subprovinces, selected_subprovince_adjacency)
        print(f"  subprovinces.geojson: {len(selected_subprovinces)} cells")
        print(f"  subprovince_adjacency.geojson: {len(selected_subprovince_adjacency)} nodes")
        print()
        print("── Summary ──────────────────────────────────")
        print(f"  Subprovince province: {args.subprovince_province}")
        print(f"  Subprovince cells: {len(selected_subprovinces)}")
        print(f"  Subprovince adjacency:{len(selected_subprovince_adjacency):>5}")
        print("  Subprovince validation: passed")
        print("─────────────────────────────────────────────")
        print("Done.")
        return

    # Build province and adjacency data
    print("Building provinces...")
    if args.resource_preset:
        print(f"  [NOTE] --resource-preset={args.resource_preset} active — res_* values in "
              f"the source geojson are being IGNORED; provinces.geojson itself is untouched")
    provinces = build_provinces(sources, simplify_tolerance, resource_preset=args.resource_preset)
    print(f"  {len(provinces)} provinces built")

    print("Building adjacency graph...")
    adjacency = build_adjacency(sources)
    print(f"  {len(adjacency)} edges detected")

    # Write all output files
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Writing output to {output_dir.relative_to(REPO_ROOT)}/")

    write_map_data(output_dir, map_config, provinces, adjacency)
    copy_passthrough_files(map_dir, output_dir)
    if selected_subprovinces is not None and selected_subprovince_adjacency is not None:
        publish_subprovince_outputs(output_dir, selected_subprovinces, selected_subprovince_adjacency)
        print(f"  subprovinces.geojson: {len(selected_subprovinces)} cells")
        print(f"  subprovince_adjacency.geojson: {len(selected_subprovince_adjacency)} nodes")

    print("Building waypoint graph (roads)...")
    generate_waypoints(sources, output_dir)

    print("Adding terrain grid for off-road movement...")
    wp_path = output_dir / "waypoints.json"
    with open(wp_path) as f:
        existing_wp = json.load(f)

    # Non-uniform coarse grid: merged into waypoints.json for client-side A* routing.
    # Denser in complex/medium terrain than the old uniform 0.2° grid.
    coarse_nodes, coarse_edges = generate_nonuniform_terrain_grid(
        sources, existing_wp, id_prefix="ct")
    if coarse_nodes:
        existing_wp["nodes"].extend(coarse_nodes)
        existing_wp["edges"].extend(coarse_edges)
        with open(wp_path, "w", encoding="utf-8") as f:
            json.dump(existing_wp, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  waypoints.json: +{len(coarse_nodes)} coarse nodes → "
              f"{len(existing_wp['nodes'])} total, {len(existing_wp['edges'])} edges")

    # Disabled: insert_boundary_nodes()'s boundary-sampling explodes to ~474k nodes on
    # real fragmented cover/elevation source data (_sample_boundary resets its sampling
    # cursor per disjoint boundary fragment, so every small same-type patch contributes
    # nodes regardless of length) — it never actually shipped in committed waypoints.json
    # before, and adding it back roughly quintupled client load time. Re-enable only after
    # fixing that sampling behavior.
    # print("Inserting boundary-conforming nodes...")
    # bn_nodes, bn_edges = insert_boundary_nodes(sources, existing_wp)
    # if bn_nodes:
    #     existing_wp["nodes"].extend(bn_nodes)
    #     existing_wp["edges"].extend(bn_edges)
    #     with open(wp_path, "w", encoding="utf-8") as f:
    #         json.dump(existing_wp, f, ensure_ascii=False, separators=(",", ":"))
    #     print(f"  waypoints.json: +{len(bn_nodes)} boundary nodes → "
    #           f"{len(existing_wp['nodes'])} total")

    # Disabled: generate_hpa_clusters()'s Step 4 (precomputing intra-cluster A* costs
    # between every border-node pair) takes 20+ minutes and produces waypoints_clusters.json
    # — a file that has never actually been consumed anywhere. game-server never references
    # it, HPA*, or clusters at all; client's pathfinder.gd has HPA*-query code gated behind
    # FileAccess.file_exists() on this file, but since it's never shipped, that branch never
    # runs and pathfinding always falls back to plain flat A*, which is what's live today.
    # Left in place (not deleted) for when a future larger map needs the hierarchy for
    # query-time performance — re-enable by uncommenting this block.
    # print("Building HPA* cluster hierarchy...")
    # cluster_data = generate_hpa_clusters(sources, existing_wp)
    # cluster_path = output_dir / "waypoints_clusters.json"
    # with open(cluster_path, "w", encoding="utf-8") as f:
    #     json.dump(cluster_data, f, ensure_ascii=False, separators=(",", ":"))
    # print(f"  waypoints_clusters.json: {len(cluster_data['clusters'])} clusters, "
    #       f"{len(cluster_data['abstract_edges'])} abstract edges")

    # Fine grid (0.07° ≈ 7.5 km): server-only — generated after coarse so fine nodes
    # can connect to coarse nodes via the TERRAIN_CONNECT_DEG snapping
    fine_nodes, fine_edges = generate_terrain_grid(
        sources, existing_wp, grid_deg=0.07, id_prefix="tg")
    if fine_nodes:
        terrain_path = output_dir / "waypoints_terrain.json"
        with open(terrain_path, "w", encoding="utf-8") as f:
            json.dump({"nodes": fine_nodes, "edges": fine_edges},
                      f, ensure_ascii=False, separators=(",", ":"))
        print(f"  waypoints_terrain.json: {len(fine_nodes)} fine nodes, {len(fine_edges)} edges")

    if args.skip_dem:
        print("  Skipping heightmap (--skip-dem)")
    else:
        build_heightmap(dem_dir, bounds, output_dir / "heightmap.tif")

    # Summary
    border_counts = {}
    for edge in adjacency:
        bt = edge["border_type"]
        border_counts[bt] = border_counts.get(bt, 0) + 1

    road_edges = sum(1 for e in adjacency if e["road_level"] is not None)

    waypoints_path = output_dir / "waypoints.json"
    wp_count = 0
    if waypoints_path.exists():
        with open(waypoints_path) as f:
            wp_data = json.load(f)
        wp_count = len(wp_data.get("nodes", []))

    print()
    print("── Summary ──────────────────────────────────")
    print(f"  Provinces:      {len(provinces)}")
    print(f"  Adjacency edges:{len(adjacency):>5}")
    for btype, count in sorted(border_counts.items()):
        print(f"    {btype:<14} {count}")
    print(f"  Road crossings: {road_edges}")
    print(f"  Waypoint nodes: {wp_count}")
    if selected_subprovinces is None:
        print("  Subprovinces: not generated (no province selected)")
    else:
        print(f"  Subprovince province: {args.subprovince_province}")
        print(f"  Subprovince cells: {len(selected_subprovinces)}")
        print(f"  Subprovince adjacency:{len(selected_subprovince_adjacency):>5}")
        print("  Subprovince validation: passed")
    print("─────────────────────────────────────────────")
    print("Done.")


if __name__ == "__main__":
    main()
