import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pytest
from rasterio.crs import CRS
from shapely.geometry import LineString, Point, box, mapping

sys.path.insert(0, str(Path(__file__).parent))

from subprovince_generator import SubprovinceConfig, default_config
from subprovince_io import (
    adapt_cities,
    adapt_cover,
    adapt_rivers,
    adapt_roads,
    build_terrain_raster,
    choose_working_crs,
    generate_real_province,
    serialize_adjacency,
    serialize_subprovinces,
)
from subprovince_validation import validate_subprovince_partition


def feature(geometry, **properties):
    return {"type": "Feature", "geometry": mapping(geometry), "properties": properties}


def test_adapter_uses_deterministic_metric_crs_and_combat_labels():
    province = box(8, 49, 9, 50)
    crs = choose_working_crs(province)
    assert crs == choose_working_crs(province)
    assert crs.is_projected
    assert crs.to_epsg() is not None
    patches = adapt_cover(province, [
        feature(box(8, 49, 8.5, 50), cover_code=0, cover_visual="water", cover_combat="swamp"),
        feature(box(8.5, 49, 9, 50), cover_code=2, cover_visual="forest", cover_combat="dense_forest"),
    ], crs)
    assert set(patch.cover_combat for patch in patches) >= {"swamp", "dense_forest"}


def test_raster_adapter_shares_grid_and_accepts_elevation_field_variants():
    province = box(8, 49, 8.02, 49.02)
    crs = choose_working_crs(province)
    cover = [feature(province, cover_code=0, cover_visual="water", cover_combat="plains")]
    elevation = [feature(province, elev_code=1, elev_type="flat")]
    terrain = build_terrain_raster(province, cover, elevation, crs, 500)
    assert terrain.cover.shape == terrain.elevation.shape == (terrain.grid.height, terrain.grid.width)
    assert terrain.grid.crs == crs
    assert np.all(terrain.cover == "plains")
    assert np.all(terrain.elevation == "flat")
    with pytest.raises(ValueError, match="coverage"):
        outside = box(9, 50, 10, 51)
        build_terrain_raster(province, [
            {"type": "Feature", "geometry": {"type": "Polygon",
                                             "coordinates": [list(outside.exterior.coords)]},
             "properties": {"cover_combat": "plains"}},
        ], elevation, crs, 500)


def test_line_city_adapters_clip_sort_and_do_not_invent_towns():
    province = box(8, 49, 9, 50)
    crs = choose_working_crs(province)
    roads = adapt_roads(province, [
        feature(LineString([(8, 49.5), (9, 49.5)]), road_id="b", road_level=3, corridor_id="c2"),
        feature(LineString([(7, 49.25), (8.25, 49.25)]), road_id="a", road_level=2, corridor_id="c1"),
    ], crs)
    assert [road.geometry.bounds[0] for road in roads] == sorted(road.geometry.bounds[0] for road in roads)
    assert [road.road_level for road in roads] == [2, 3]
    rivers = adapt_rivers(province, [feature(LineString([(8.5, 48), (8.5, 51)]), river_id="r")], crs)
    assert len(rivers) == 1 and not rivers[0].is_empty
    capital, towns = adapt_cities("p", [
        feature(Point(8.5, 49.5), province_id="p", is_capital=True),
    ], crs)
    assert capital is not None and capital.x > 10000
    assert towns == []


def test_real_fixture_has_selected_province_and_intersecting_sources():
    root = Path(__file__).parents[2] / "europe_1938_6"
    province_data = json.loads((root / "provinces.geojson").read_text())
    province = next(f for f in province_data["features"]
                    if f["properties"]["province_id"] == "we6_germany_01")
    assert province["geometry"]["type"] in {"Polygon", "MultiPolygon"}
    cover = json.loads((root / "cover.geojson").read_text())["features"]
    elevation = json.loads((root / "elevation.geojson").read_text())["features"]
    from shapely.geometry import shape
    geometry = shape(province["geometry"])
    assert any(shape(f["geometry"]).intersects(geometry) for f in cover)
    assert any(shape(f["geometry"]).intersects(geometry) for f in elevation)


def test_geojson_serializers_are_stable_and_complete(tmp_path):
    from subprovince_generator import SubprovincePolygon
    polygons = [
        SubprovincePolygon("p_sp_1", "p", box(1, 1, 2, 2), "hinterland", "plains", "flat", False),
        SubprovincePolygon("p_sp_0", "p", box(0, 0, 1, 1), "capital", "urban", "flat", True),
    ]
    polygon_path = tmp_path / "subprovinces.geojson"
    adjacency_path = tmp_path / "adjacency.geojson"
    serialize_subprovinces(polygon_path, polygons)
    serialize_adjacency(adjacency_path, {"p_sp_1": ["p_sp_0"], "p_sp_0": ["p_sp_1"]})
    output = json.loads(polygon_path.read_text())
    assert [f["properties"]["subprovince_id"] for f in output["features"]] == ["p_sp_0", "p_sp_1"]
    assert set(output["features"][0]["properties"]) == {
        "subprovince_id", "province_id", "kind", "cover_combat", "elevation_type", "is_capital"
    }
    assert json.loads(adjacency_path.read_text())["features"][0]["geometry"] is None


def test_serialized_round_trip_is_clean(tmp_path):
    """Serialize real output, reload it, and verify one feature per ID with zero overlap."""
    from shapely.geometry import shape
    from shapely.ops import unary_union
    sources = _load_real_sources()
    province = next(f for f in sources["provinces"]
                    if f["properties"]["province_id"] == "we6_germany_01")
    polygons, adjacency = generate_real_province(province, sources, default_config())
    sp_path = tmp_path / "subprovinces.geojson"
    adj_path = tmp_path / "adjacency.geojson"
    serialize_subprovinces(sp_path, polygons)
    serialize_adjacency(adj_path, adjacency)
    features = json.loads(sp_path.read_text())["features"]
    ids = [f["properties"]["subprovince_id"] for f in features]
    assert len(ids) == len(set(ids)) == len(polygons)
    geoms = [shape(f["geometry"]) for f in features]
    assert all(g.is_valid for g in geoms)
    total = sum(g.area for g in geoms)
    union = unary_union(geoms)
    assert total - union.area < 1e-8
    parsed_adj = json.loads(adj_path.read_text())
    node_ids = {f["properties"]["subprovince_id"] for f in parsed_adj["features"]}
    assert node_ids == set(ids)


def _load_real_sources():
    root = Path(__file__).parents[2] / "europe_1938_6"
    return {
        name: json.loads((root / f"{name}.geojson").read_text())["features"]
        for name in ("provinces", "cover", "elevation", "roads", "rivers", "cities")
    }


def test_real_province_output_matches_baseline_artifact():
    artifacts = Path(__file__).parent / "diagnostics" / "we6_baseline.json"
    if not artifacts.exists():
        pytest.skip("baseline artifact not generated")
    baseline = json.loads(artifacts.read_text())
    sources = _load_real_sources()
    province = next(f for f in sources["provinces"]
                    if f["properties"]["province_id"] == "we6_germany_01")
    polygons, adjacency = generate_real_province(province, sources, default_config())
    digest = lambda data: hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
    assert digest([(p.subprovince_id, p.geometry.wkb_hex) for p in polygons]) == baseline["geometry_hash"]
    assert digest({k: sorted(v) for k, v in adjacency.items()}) == baseline["adjacency_hash"]
    assert len(polygons) == baseline["cells"]


def test_real_province_is_deterministic_under_reordered_sources():
    sources = _load_real_sources()
    province = next(f for f in sources["provinces"]
                    if f["properties"]["province_id"] == "we6_germany_01")
    first = generate_real_province(province, sources, default_config())
    reordered = dict(sources)
    for name in ("cover", "elevation", "roads", "rivers", "cities"):
        reordered[name] = list(reversed(sources[name]))
    second = generate_real_province(province, reordered, default_config())
    digest = lambda data: hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
    assert digest([(p.subprovince_id, p.geometry.wkb_hex) for p in first[0]]) == \
           digest([(p.subprovince_id, p.geometry.wkb_hex) for p in second[0]])
    assert digest({k: sorted(v) for k, v in first[1].items()}) == \
           digest({k: sorted(v) for k, v in second[1].items()})