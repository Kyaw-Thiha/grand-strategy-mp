"""Tests for the 24-key buildings{} schema and default production-building placement."""
import sys
from pathlib import Path
from shapely.geometry import mapping, Polygon

sys.path.insert(0, str(Path(__file__).parent))
from pipeline import build_provinces, _apply_default_building_placement, BUILDING_TYPES


def _prov_feat(pid, nation_id, is_playable=True):
    coords = [(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]
    return {
        "type": "Feature",
        "properties": {
            "province_id": pid, "nation_id": nation_id, "name": pid, "map_id": "test",
            "terrain_elevation": "flat", "terrain_cover": "plains",
            "city_name": pid, "city_lng": 0.5, "city_lat": 0.5,
            "is_core": False, "is_objective": False, "is_playable": is_playable,
            "population": 50, "industry": 50, "infrastructure": 50, "vp_value": 1,
        },
        "geometry": mapping(Polygon(coords)),
    }


def _city_feat(pid, is_capital=False, has_port=False):
    return {"properties": {"province_id": pid, "is_capital": is_capital, "has_port": has_port}}


def _build(provinces, cities):
    sources = {"provinces": provinces, "cities": cities}
    return build_provinces(sources, simplify_tolerance=0.001)


def test_buildings_dict_has_all_24_keys():
    provinces = _build(
        [_prov_feat("p1", "testland")],
        [_city_feat("p1")],
    )
    assert len(BUILDING_TYPES) == 24
    assert set(provinces[0]["buildings"].keys()) == set(BUILDING_TYPES)


def test_unauthored_building_keys_default_to_zero():
    provinces = _build(
        [_prov_feat("p1", "testland")],
        [_city_feat("p1")],
    )
    assert provinces[0]["buildings"]["school"] == 0
    assert provinces[0]["buildings"]["res_iron"] == 0


def test_capital_gets_all_four_production_buildings_at_level_one():
    provinces = _build(
        [_prov_feat("cap", "testland"), _prov_feat("p2", "testland"), _prov_feat("p3", "testland")],
        [_city_feat("cap", is_capital=True), _city_feat("p2"), _city_feat("p3")],
    )
    _apply_default_building_placement(provinces)
    capital = next(p for p in provinces if p["province_id"] == "cap")
    for b in ("barracks", "tank_plant", "ordnance_factory", "aircraft_factory"):
        assert capital["buildings"][b] == 1


def test_other_starting_provinces_get_one_rotated_production_building():
    provinces = _build(
        [_prov_feat("cap", "testland"), _prov_feat("p2", "testland"), _prov_feat("p3", "testland")],
        [_city_feat("cap", is_capital=True), _city_feat("p2"), _city_feat("p3")],
    )
    _apply_default_building_placement(provinces)
    others = [p for p in provinces if p["province_id"] != "cap"]
    for p in others:
        built = [b for b in ("barracks", "ordnance_factory", "tank_plant") if p["buildings"][b] == 1]
        assert len(built) == 1, f"{p['province_id']} expected exactly one rotated production building, got {built}"


def test_nation_with_no_capital_is_skipped_without_error():
    provinces = _build(
        [_prov_feat("p1", "testland")],
        [_city_feat("p1", is_capital=False)],
    )
    _apply_default_building_placement(provinces)  # must not raise
    assert all(v == 0 for v in provinces[0]["buildings"].values())
