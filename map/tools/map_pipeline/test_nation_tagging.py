"""Tests for nation_id tagging on all pipeline nodes — Phase 2."""
import json, sys
from pathlib import Path
from shapely.geometry import mapping, Polygon
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from pipeline import generate_waypoints, generate_nonuniform_terrain_grid


def _prov_feat(coords, nation_id, province_id):
    return {"type": "Feature",
            "properties": {"nation_id": nation_id, "province_id": province_id,
                           "name": province_id, "map_id": "test",
                           "terrain_elevation": "flat", "terrain_cover": "plains",
                           "city_name": "", "city_lng": 0.5, "city_lat": 0.5,
                           "is_capital": False, "is_core": False,
                           "is_objective": False, "is_playable": True,
                           "population": 50, "industry": 50, "infrastructure": 50,
                           "vp_value": 1},
            "geometry": mapping(Polygon(coords))}

def _cover_feat(coords, cover_combat):
    return {"type": "Feature", "properties": {"cover_combat": cover_combat},
            "geometry": mapping(Polygon(coords))}

def _road_feat(coords):
    from shapely.geometry import mapping, LineString
    return {"type": "Feature",
            "properties": {"road_id": "r1", "road_level": 1},
            "geometry": mapping(LineString(coords))}


def test_all_road_nodes_have_nation_id_key(tmp_path):
    """Every road node written by generate_waypoints() must have a 'nation_id' key."""
    sources = {
        "roads": [_road_feat([(0.1, 0.1), (0.5, 0.1), (0.9, 0.1)])],
        "cover": [_cover_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "plains")],
        "elevation": [],
        "rivers": [],
        "provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "testland", "t_01")],
    }
    generate_waypoints(sources, tmp_path)
    wp = json.loads((tmp_path / "waypoints.json").read_text())
    for node in wp["nodes"]:
        assert "nation_id" in node, f"Node {node['id']} missing nation_id"


def test_node_inside_province_gets_correct_nation_id(tmp_path):
    """A node at (0.5, 0.5) inside a 'france' province must get nation_id='france'."""
    sources = {
        "roads": [_road_feat([(0.1, 0.5), (0.9, 0.5)])],
        "cover": [_cover_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "plains")],
        "elevation": [],
        "rivers": [],
        "provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "france", "f_01")],
    }
    generate_waypoints(sources, tmp_path)
    wp = json.loads((tmp_path / "waypoints.json").read_text())
    assert wp["nodes"], "No nodes generated"
    for node in wp["nodes"]:
        assert node["nation_id"] == "france", \
            f"Node {node['id']} at ({node['lng']},{node['lat']}) got nation_id={node['nation_id']!r}"


def test_node_outside_all_provinces_gets_null_nation_id(tmp_path):
    """A node outside all provinces must get nation_id=null."""
    sources = {
        "roads": [_road_feat([(5.1, 0.5), (5.9, 0.5)])],
        "cover": [_cover_feat([(4,-1),(7,-1),(7,2),(4,2),(4,-1)], "plains")],
        "elevation": [],
        "rivers": [],
        "provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "france", "f_01")],
    }
    generate_waypoints(sources, tmp_path)
    wp = json.loads((tmp_path / "waypoints.json").read_text())
    assert wp["nodes"], "No nodes generated"
    for node in wp["nodes"]:
        assert node["nation_id"] is None, \
            f"Expected null for node outside province, got {node['nation_id']!r}"


def test_terrain_nodes_also_get_nation_id(tmp_path):
    """Terrain nodes from generate_nonuniform_terrain_grid() must also have nation_id."""
    sources = {
        "roads": [_road_feat([(0.1, 0.5), (0.9, 0.5)])],
        "cover": [_cover_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "plains")],
        "elevation": [],
        "rivers": [],
        "base_water": [],
        "provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "germany", "g_01")],
    }
    generate_waypoints(sources, tmp_path)
    wp = json.loads((tmp_path / "waypoints.json").read_text())
    new_nodes, _ = generate_nonuniform_terrain_grid(sources, wp, id_prefix="ct")
    for node in new_nodes:
        assert "nation_id" in node, f"Terrain node {node['id']} missing nation_id"
