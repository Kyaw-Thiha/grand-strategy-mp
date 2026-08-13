"""
Schema validation for map source GeoJSON files.

Called by pipeline.py before any processing begins.
Each validator loads its file, checks all features, and prints [ERROR] lines to
stderr. validate_all() aggregates all results and calls sys.exit(1) on any failure
so the pipeline never processes bad data silently.
"""

import json
import sys
from pathlib import Path

# ── valid value sets ──────────────────────────────────────────────────────────

VALID_ELEVATION_TYPES = {"flat", "hills", "mountains"}

VALID_COVER_VISUAL = {
    "farmland", "grassland", "steppe", "mediterranean_scrub", "heathland",
    "open_forest", "boreal_forest", "temperate_forest", "jungle",
    "hot_desert", "cold_desert", "wetland", "mangrove", "tundra",
    "glacier", "urban", "town",
}

VALID_COVER_COMBAT = {
    "plains", "steppe", "shrubland", "light_forest", "dense_forest",
    "jungle", "desert", "swamp", "tundra", "glacier", "urban",
}

VALID_RIVER_SIZES = {"major", "minor", "stream"}
VALID_WATER_TYPES = {"sea", "ocean", "lake"}
VALID_ROAD_LEVELS = {2, 3}

# Province fields that must be integers in [0, 100]
#
# res_manpower/res_steel/res_fuel/res_coal are the old five-key placeholder resource
# envelope and are no longer required — RESOURCE_ECONOMY.md's ten-resource roster
# (money, grain, iron, oil, rubber, nitrates, tungsten, chromium, aluminium, uranium)
# supersedes it. Only res_money/res_oil are kept required here since they're common to
# both the old and new schema and already present in every source feature; the other
# eight new res_* fields are intentionally NOT required yet — real per-province values
# haven't been hand-authored into the source geojson yet (pipeline.py defaults any
# missing res_* field to 0), and requiring them here would fail validation on every
# existing map until that authoring work is done.
_PROVINCE_INT_0_100 = [
    "population", "industry", "infrastructure",
    "bld_fort", "bld_port", "bld_airbase", "bld_supply_hub", "bld_factory",
    "res_money", "res_oil",
]

# All required province property fields
_PROVINCE_REQUIRED = [
    "province_id", "name", "map_id", "nation_id", "is_capital", "is_core",
    "city_name", "city_lng", "city_lat",
    "terrain_elevation", "terrain_cover",
    "is_objective", "vp_value",
] + _PROVINCE_INT_0_100


# ── helpers ───────────────────────────────────────────────────────────────────

def _load_geojson(path: Path) -> list:
    """Load a GeoJSON FeatureCollection and return the features list."""
    with open(path) as f:
        data = json.load(f)
    if "features" not in data:
        print(f"[ERROR] {path.name} | not a valid FeatureCollection (missing 'features' key)",
              file=sys.stderr)
        sys.exit(1)
    return data["features"]


def _err(filename: str, feature_label: str, message: str) -> str:
    """Format a validation error line."""
    return f"[ERROR] {filename} | {feature_label} | {message}"


# ── individual validators ─────────────────────────────────────────────────────

def validate_provinces(path: Path) -> tuple[list, bool]:
    """
    Validate provinces.geojson.

    Checks: all required fields present, terrain_elevation and terrain_cover use
    valid values, integer fields are in range, province_ids are unique, geometry
    is Polygon or MultiPolygon.

    Returns (features, had_errors).
    """
    features = _load_geojson(path)
    errors = []
    seen_ids: dict[str, int] = {}

    for i, feat in enumerate(features):
        props = feat.get("properties") or {}
        pid = props.get("province_id", f"<index {i}>")
        label = f"province {pid}"

        # Required fields
        for field in _PROVINCE_REQUIRED:
            if field not in props:
                errors.append(_err(path.name, label, f"missing field: {field}"))

        # Unique province_id
        if pid in seen_ids:
            errors.append(_err(path.name, label,
                               f"duplicate province_id (first seen at index {seen_ids[pid]})"))
        else:
            seen_ids[pid] = i

        # terrain_elevation value
        elev = props.get("terrain_elevation")
        if elev is not None and elev not in VALID_ELEVATION_TYPES:
            errors.append(_err(path.name, label, f"invalid terrain_elevation: '{elev}'"))

        # terrain_cover value
        cover = props.get("terrain_cover")
        if cover is not None and cover not in VALID_COVER_VISUAL:
            errors.append(_err(path.name, label, f"invalid terrain_cover: '{cover}'"))

        # Integer range checks
        for field in _PROVINCE_INT_0_100:
            val = props.get(field)
            if val is not None and (not isinstance(val, (int, float)) or val < 0 or val > 100):
                errors.append(_err(path.name, label, f"{field}={val} out of range [0, 100]"))

        vp = props.get("vp_value")
        if vp is not None and (not isinstance(vp, (int, float)) or vp < 0 or vp > 5):
            errors.append(_err(path.name, label, f"vp_value={vp} out of range [0, 5]"))

        # Geometry type
        geom_type = (feat.get("geometry") or {}).get("type")
        if geom_type not in ("Polygon", "MultiPolygon"):
            errors.append(_err(path.name, label, f"unexpected geometry type: {geom_type}"))

    for err in errors:
        print(err, file=sys.stderr)

    return features, len(errors) > 0


def validate_cities(path: Path, province_ids: set) -> tuple[list, bool]:
    """
    Validate cities.geojson.

    Checks: required fields present, all province_ids reference a known province,
    no province has more than one city, geometry is Point.

    Returns (features, had_errors).
    """
    features = _load_geojson(path)
    errors = []
    seen_province_ids: dict[str, int] = {}

    for i, feat in enumerate(features):
        props = feat.get("properties") or {}
        cid = props.get("city_id", f"<index {i}>")
        label = f"city {cid}"

        for field in ("city_id", "province_id", "nation_id", "city_name",
                      "is_capital", "map_id", "has_port"):
            if field not in props:
                errors.append(_err(path.name, label, f"missing field: {field}"))

        pid = props.get("province_id")
        if pid and pid not in province_ids:
            errors.append(_err(path.name, label, f"province_id '{pid}' not found in provinces"))

        if pid in seen_province_ids:
            errors.append(_err(path.name, label,
                               f"duplicate city for province '{pid}' (first at index {seen_province_ids[pid]})"))
        elif pid:
            seen_province_ids[pid] = i

        if (feat.get("geometry") or {}).get("type") != "Point":
            errors.append(_err(path.name, label, "expected Point geometry"))

    # Every province must have a city
    for pid in sorted(province_ids - set(seen_province_ids.keys())):
        errors.append(_err(path.name, f"province {pid}", "has no city"))

    for err in errors:
        print(err, file=sys.stderr)

    return features, len(errors) > 0


def validate_cover(path: Path) -> tuple[list, bool]:
    """
    Validate cover.geojson.

    Checks: required fields present, cover_visual and cover_combat use valid values.
    cover_code=0 gap-fill cells are valid and are not filtered.

    Returns (features, had_errors).
    """
    features = _load_geojson(path)
    errors = []

    for i, feat in enumerate(features):
        props = feat.get("properties") or {}
        label = f"index {i}"

        for field in ("cover_code", "cover_visual", "cover_combat"):
            if field not in props:
                errors.append(_err(path.name, label, f"missing field: {field}"))

        visual = props.get("cover_visual")
        if visual and visual not in VALID_COVER_VISUAL:
            errors.append(_err(path.name, label, f"invalid cover_visual: '{visual}'"))

        combat = props.get("cover_combat")
        if combat and combat not in VALID_COVER_COMBAT:
            errors.append(_err(path.name, label, f"invalid cover_combat: '{combat}'"))

    for err in errors:
        print(err, file=sys.stderr)

    return features, len(errors) > 0


def validate_elevation(path: Path) -> tuple[list, bool]:
    """
    Validate elevation.geojson.

    The dataset has a split field name across features caused by a pipeline stage
    boundary: original features use (elev_code, elev_type), gap-fill features use
    (cover_code, elevation_type). Both forms are valid — the validator accepts either.

    Returns (features, had_errors).
    """
    features = _load_geojson(path)
    errors = []

    for i, feat in enumerate(features):
        props = feat.get("properties") or {}
        label = f"index {i}"

        # Accept either field name variant
        elev_type = props.get("elev_type") or props.get("elevation_type")
        elev_code = props.get("elev_code") if "elev_code" in props else props.get("cover_code")

        if elev_type is None:
            errors.append(_err(path.name, label, "missing elev_type or elevation_type"))
        elif elev_code != 0 and elev_type not in VALID_ELEVATION_TYPES:
            errors.append(_err(path.name, label, f"invalid elevation value: '{elev_type}'"))

    for err in errors:
        print(err, file=sys.stderr)

    return features, len(errors) > 0


def validate_roads(path: Path) -> tuple[list, bool]:
    """
    Validate roads.geojson.

    Checks: required fields present, road_level is 2 or 3, geometry is LineString.

    Returns (features, had_errors).
    """
    features = _load_geojson(path)
    errors = []

    for i, feat in enumerate(features):
        props = feat.get("properties") or {}
        rid = props.get("road_id", f"<index {i}>")
        label = f"road {rid}"

        for field in ("road_id", "road_level", "corridor_id", "map_id"):
            if field not in props:
                errors.append(_err(path.name, label, f"missing field: {field}"))

        level = props.get("road_level")
        if level is not None and level not in VALID_ROAD_LEVELS:
            errors.append(_err(path.name, label, f"road_level {level} not in {VALID_ROAD_LEVELS}"))

        if (feat.get("geometry") or {}).get("type") != "LineString":
            errors.append(_err(path.name, label, "expected LineString geometry"))

    for err in errors:
        print(err, file=sys.stderr)

    return features, len(errors) > 0


def validate_rivers(path: Path) -> tuple[list, bool]:
    """
    Validate rivers.geojson.

    Checks: required fields present, river_size uses a valid value.

    Returns (features, had_errors).
    """
    features = _load_geojson(path)
    errors = []

    for i, feat in enumerate(features):
        props = feat.get("properties") or {}
        rid = props.get("river_id", f"<index {i}>")
        label = f"river {rid}"

        for field in ("river_id", "name", "river_size", "map_id"):
            if field not in props:
                errors.append(_err(path.name, label, f"missing field: {field}"))

        size = props.get("river_size")
        if size and size not in VALID_RIVER_SIZES:
            errors.append(_err(path.name, label, f"invalid river_size: '{size}'"))

    for err in errors:
        print(err, file=sys.stderr)

    return features, len(errors) > 0


def validate_base_water(path: Path) -> tuple[list, bool]:
    """
    Validate base_water.geojson.

    Checks: water_type uses a valid value.

    Returns (features, had_errors).
    """
    features = _load_geojson(path)
    errors = []

    for i, feat in enumerate(features):
        props = feat.get("properties") or {}
        label = f"index {i}"

        wtype = props.get("water_type")
        if wtype and wtype not in VALID_WATER_TYPES:
            errors.append(_err(path.name, label, f"invalid water_type: '{wtype}'"))

    for err in errors:
        print(err, file=sys.stderr)

    return features, len(errors) > 0


# ── master validator ──────────────────────────────────────────────────────────

def validate_all(map_dir: Path) -> dict:
    """
    Run all validators on the source files in map_dir.

    Loads every required source file, validates its schema, and accumulates
    errors across all files before aborting. This way a single run surfaces all
    problems at once rather than stopping at the first bad file.

    Returns a dict mapping file keys to their loaded feature lists:
        {
            "provinces": [...],
            "cities":    [...],
            "cover":     [...],
            "elevation": [...],
            "roads":     [...],
            "rivers":    [...],
            "base_water": [...],
        }

    Calls sys.exit(1) if any validator found errors.

    Example:
        sources = validate_all(Path("map/europe_1938_6"))
        # sources["provinces"] is the raw feature list
    """
    print("Validating source files...")
    had_any_error = False
    sources = {}

    province_features, err = validate_provinces(map_dir / "provinces.geojson")
    had_any_error |= err
    sources["provinces"] = province_features
    province_ids = {f["properties"]["province_id"] for f in province_features}

    city_features, err = validate_cities(map_dir / "cities.geojson", province_ids)
    had_any_error |= err
    sources["cities"] = city_features

    cover_features, err = validate_cover(map_dir / "cover.geojson")
    had_any_error |= err
    sources["cover"] = cover_features

    elev_features, err = validate_elevation(map_dir / "elevation.geojson")
    had_any_error |= err
    sources["elevation"] = elev_features

    road_features, err = validate_roads(map_dir / "roads.geojson")
    had_any_error |= err
    sources["roads"] = road_features

    river_features, err = validate_rivers(map_dir / "rivers.geojson")
    had_any_error |= err
    sources["rivers"] = river_features

    water_features, err = validate_base_water(map_dir / "base_water.geojson")
    had_any_error |= err
    sources["base_water"] = water_features

    if had_any_error:
        print("[ABORT] Validation failed — fix the errors above before running the pipeline.",
              file=sys.stderr)
        sys.exit(1)

    counts = {k: len(v) for k, v in sources.items()}
    print(f"  OK — {counts}")
    return sources
