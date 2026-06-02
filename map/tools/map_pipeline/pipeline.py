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
import shutil
import sys
import warnings
from pathlib import Path

import numpy as np
import rasterio
from rasterio.merge import merge as rasterio_merge
from rasterio.transform import from_bounds as transform_from_bounds
from rasterio.warp import reproject, Resampling, transform_bounds
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

# pipeline.py lives at map/tools/map_pipeline/ — three levels up is repo root
REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent

sys.path.insert(0, str(Path(__file__).parent))
from validate import validate_all

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


# ── argument parsing ──────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    """
    Parse command-line arguments.

    --map:      Name of the source directory under map/ (e.g. europe_1938_6)
    --skip-dem: Skip the DEM mosaicing and heightmap export step. Useful during
                development when only map_data.json changes are needed.
    """
    parser = argparse.ArgumentParser(description="Map data pipeline: GeoJSON → Godot map_data.json")
    parser.add_argument("--map", required=True,
                        help="Source map directory name under map/ (e.g. europe_1938_6)")
    parser.add_argument("--skip-dem", action="store_true",
                        help="Skip DEM mosaicing and heightmap export")
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

def build_provinces(sources: dict, simplify_tolerance: float) -> list[dict]:
    """
    Build the province output list from validated source features.

    For each province: simplifies the polygon geometry, merges has_port from the
    matching city, and reconstructs nested buildings{} and resources{} dicts from
    the flat QGIS attribute fields. The 'notes' field is stripped.

    Parameters:
        sources:            Dict from validate_all() keyed by file name.
        simplify_tolerance: Shapely simplify tolerance in degrees. 0.001° ≈ 100m.

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
        resources = {
            "manpower": props.get("res_manpower", 0),
            "steel":    props.get("res_steel", 0),
            "oil":      props.get("res_oil", 0),
            "fuel":     props.get("res_fuel", 0),
            "coal":     props.get("res_coal", 0),
            "money":    props.get("res_money", 0),
        }

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

    return provinces_out


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

    # Build province and adjacency data
    print("Building provinces...")
    provinces = build_provinces(sources, simplify_tolerance)
    print(f"  {len(provinces)} provinces built")

    print("Building adjacency graph...")
    adjacency = build_adjacency(sources)
    print(f"  {len(adjacency)} edges detected")

    # Write all output files
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Writing output to {output_dir.relative_to(REPO_ROOT)}/")

    write_map_data(output_dir, map_config, provinces, adjacency)
    copy_passthrough_files(map_dir, output_dir)

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

    print()
    print("── Summary ──────────────────────────────────")
    print(f"  Provinces:      {len(provinces)}")
    print(f"  Adjacency edges:{len(adjacency):>5}")
    for btype, count in sorted(border_counts.items()):
        print(f"    {btype:<14} {count}")
    print(f"  Road crossings: {road_edges}")
    print("─────────────────────────────────────────────")
    print("Done.")


if __name__ == "__main__":
    main()
