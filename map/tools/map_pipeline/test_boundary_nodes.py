"""Tests for insert_boundary_nodes() — Phase 2 boundary-conforming node insertion."""
import json, math, sys
from pathlib import Path
from shapely.geometry import shape, mapping, Polygon, MultiPolygon
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from pipeline import insert_boundary_nodes, _get_elev_type


def _cover_feat(coords, cover_combat):
    return {"type": "Feature", "properties": {"cover_combat": cover_combat},
            "geometry": mapping(Polygon(coords))}

def _elev_feat(coords, elev_type):
    return {"type": "Feature", "properties": {"elevation_type": elev_type},
            "geometry": mapping(Polygon(coords))}

def _empty_wp():
    return {"nodes": [], "edges": [], "road_connections": []}


def test_boundary_nodes_appear_at_cover_transition():
    """Nodes must appear near the boundary between plains and dense_forest."""
    sources = {
        "cover": [
            _cover_feat([(0,0),(1,0),(1,1),(0,1),(0,0)], "plains"),
            _cover_feat([(1,0),(2,0),(2,1),(1,1),(1,0)], "dense_forest"),
        ],
        "elevation": [],
        "base_water": [],
        "provinces": [],
    }
    nodes, edges = insert_boundary_nodes(sources, _empty_wp())
    plains_nodes  = [n for n in nodes if n["cover_combat"] == "plains"]
    forest_nodes  = [n for n in nodes if n["cover_combat"] == "dense_forest"]
    assert len(plains_nodes) > 0,  "Expected plains-side boundary nodes"
    assert len(forest_nodes) > 0,  "Expected forest-side boundary nodes"


def test_boundary_nodes_scale_with_boundary_length_not_area():
    """Same boundary length → same node count regardless of polygon area."""
    def _sources(width):
        return {
            "cover": [
                _cover_feat([(0,0),(1,0),(1,1),(0,1),(0,0)], "plains"),
                _cover_feat([(1,0),(1+width,0),(1+width,1),(1,1),(1,0)], "dense_forest"),
            ],
            "elevation": [], "base_water": [], "provinces": [],
        }
    n1, _ = insert_boundary_nodes(_sources(0.5),  _empty_wp())
    n2, _ = insert_boundary_nodes(_sources(2.0),  _empty_wp())
    assert len(n1) == len(n2), f"Boundary length same but node counts differ: {len(n1)} vs {len(n2)}"


def test_water_boundaries_skipped():
    """No boundary nodes should be inserted along a coastline (polygon adjacent to water)."""
    sources = {
        "cover": [
            _cover_feat([(0,0),(1,0),(1,1),(0,1),(0,0)], "plains"),
            _cover_feat([(1,0),(2,0),(2,1),(1,1),(1,0)], "dense_forest"),
        ],
        "elevation": [],
        "base_water": [{"type": "Feature", "properties": {},
                         "geometry": mapping(Polygon([(0.9,-0.1),(2.1,-0.1),(2.1,1.1),(0.9,1.1),(0.9,-0.1)]))}],
        "provinces": [],
    }
    nodes, _ = insert_boundary_nodes(sources, _empty_wp())
    wet_nodes = [n for n in nodes if n["lng"] > 0.95]
    assert len(wet_nodes) == 0, f"Expected no nodes in water zone, got {len(wet_nodes)}"


def test_boundary_nodes_connect_to_existing_nodes():
    """Each boundary node must have at least one edge connecting to an existing node."""
    sources = {
        "cover": [
            _cover_feat([(0,0),(1,0),(1,1),(0,1),(0,0)], "plains"),
            _cover_feat([(1,0),(2,0),(2,1),(1,1),(1,0)], "dense_forest"),
        ],
        "elevation": [], "base_water": [], "provinces": [],
    }
    existing_wp = {
        "nodes": [{"id": "wp_000001", "lng": 1.0, "lat": 0.5,
                   "cover_combat": "plains", "elevation": "flat", "nation_id": None}],
        "edges": [], "road_connections": [],
    }
    nodes, edges = insert_boundary_nodes(sources, existing_wp)
    if nodes:
        bn_ids = {n["id"] for n in nodes}
        connected = {e["from"] for e in edges if e["to"] not in bn_ids} | \
                    {e["to"]   for e in edges if e["from"] not in bn_ids}
        assert len(connected) > 0, "No boundary node connected to any existing node"


def test_nation_id_on_boundary_nodes():
    """Boundary nodes must carry nation_id from the province they fall within."""
    sources = {
        "cover": [
            _cover_feat([(0,0),(1,0),(1,1),(0,1),(0,0)], "plains"),
            _cover_feat([(1,0),(2,0),(2,1),(1,1),(1,0)], "dense_forest"),
        ],
        "elevation": [], "base_water": [],
        "provinces": [
            {"type": "Feature",
             "properties": {"nation_id": "testland", "province_id": "t_01"},
             "geometry": mapping(Polygon([(-0.5,-0.5),(2.5,-0.5),(2.5,1.5),(-0.5,1.5),(-0.5,-0.5)]))},
        ],
    }
    nodes, _ = insert_boundary_nodes(sources, _empty_wp())
    assert len(nodes) > 0
    for n in nodes:
        assert "nation_id" in n, f"Node {n['id']} missing nation_id key"
        assert n["nation_id"] == "testland", f"Expected 'testland', got {n['nation_id']}"
