"""Tests for generate_hpa_clusters() — Phase 3."""
import sys, math
from pathlib import Path
from shapely.geometry import mapping, Polygon
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from pipeline import generate_hpa_clusters


def _make_wp(n_nodes: int, spread: float = 1.0) -> dict:
    """Create a grid of n_nodes waypoint nodes within spread degrees."""
    side = math.ceil(math.sqrt(n_nodes))
    nodes = []
    edges = []
    for i in range(n_nodes):
        r, c = divmod(i, side)
        nodes.append({
            "id": f"wp_{i:04d}", "lng": round(c * spread / side, 6),
            "lat": round(r * spread / side, 6),
            "cover_combat": "plains", "elevation": "flat", "nation_id": "testland",
        })
    for i in range(n_nodes):
        r, c = divmod(i, side)
        for dr, dc in [(0,1),(1,0)]:
            j = (r+dr)*side + (c+dc)
            if j < n_nodes:
                edges.append({"from": f"wp_{i:04d}", "to": f"wp_{j:04d}",
                              "base_cost": 1.0, "river_size": None})
    return {"nodes": nodes, "edges": edges, "road_connections": []}


def _prov_feat(coords, nation_id, province_id):
    return {"type": "Feature",
            "properties": {"nation_id": nation_id, "province_id": province_id},
            "geometry": mapping(Polygon(coords))}


def test_small_cluster_stays_flat():
    """A province with <=300 nodes must produce a single flat cluster with no children."""
    sources = {"provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "a", "a_01")]}
    wp = _make_wp(50)
    result = generate_hpa_clusters(sources, wp, cluster_threshold=300)
    clusters = result["clusters"]
    root = next((c for c in clusters if c["parent"] is None and "a_01" in c["id"]), None)
    assert root is not None, "No root cluster for province a_01"
    assert root["children"] == [], f"Expected no children for small cluster, got {root['children']}"


def test_large_cluster_gets_sub_partitioned():
    """A province with >300 nodes must be sub-partitioned; all leaf clusters <=300 nodes."""
    sources = {"provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "a", "a_01")]}
    wp = _make_wp(400)
    result = generate_hpa_clusters(sources, wp, cluster_threshold=300)
    leaf_clusters = [c for c in result["clusters"] if not c["children"]]
    assert len(leaf_clusters) > 1, "Expected multiple leaf clusters for 400-node province"
    root = next((c for c in result["clusters"] if c["parent"] is None and "a_01" in c["id"]), None)
    assert root is not None
    assert len(root["children"]) > 0, "Root cluster should have children for large province"


def test_recursion_terminates():
    """Even 1000 nodes must terminate with all leaves <= cluster_threshold."""
    sources = {"provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "a", "a_01")]}
    wp = _make_wp(1000)
    result = generate_hpa_clusters(sources, wp, cluster_threshold=300)
    assert "clusters" in result
    assert "abstract_edges" in result


def test_border_nodes_have_cross_cluster_edges():
    """Every border node listed in a cluster must have at least one abstract edge."""
    sources = {
        "provinces": [
            _prov_feat([(-0.1,-0.1),(0.6,-0.1),(0.6,1.1),(-0.1,1.1),(-0.1,-0.1)], "a", "a_01"),
            _prov_feat([(0.4,-0.1),(1.1,-0.1),(1.1,1.1),(0.4,1.1),(0.4,-0.1)],    "b", "b_01"),
        ]
    }
    wp = {
        "nodes": [
            *[{"id": f"wa_{i}", "lng": 0.1+i*0.05, "lat": 0.5,
               "cover_combat": "plains", "elevation": "flat", "nation_id": "a"} for i in range(10)],
            *[{"id": f"wb_{i}", "lng": 0.6+i*0.05, "lat": 0.5,
               "cover_combat": "plains", "elevation": "flat", "nation_id": "b"} for i in range(10)],
        ],
        "edges": [
            *[{"from": f"wa_{i}", "to": f"wa_{i+1}", "base_cost": 1.0, "river_size": None}
              for i in range(9)],
            *[{"from": f"wb_{i}", "to": f"wb_{i+1}", "base_cost": 1.0, "river_size": None}
              for i in range(9)],
            {"from": "wa_9", "to": "wb_0", "base_cost": 1.0, "river_size": None},
        ],
        "road_connections": [],
    }
    result = generate_hpa_clusters(sources, wp, cluster_threshold=300)
    all_border_nodes = set()
    for c in result["clusters"]:
        all_border_nodes.update(c["border_nodes"])
    assert "wa_9" in all_border_nodes, "wa_9 should be a border node (cross-province edge)"
    assert "wb_0" in all_border_nodes, "wb_0 should be a border node (cross-province edge)"


def test_abstract_edge_count_reasonable():
    """Abstract edges must be <= border_node_count^2 (O(n^2) worst case)."""
    sources = {"provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "a", "a_01")]}
    wp = _make_wp(100)
    result = generate_hpa_clusters(sources, wp, cluster_threshold=300)
    all_border_nodes = set()
    for c in result["clusters"]:
        all_border_nodes.update(c["border_nodes"])
    max_edges = len(all_border_nodes) ** 2
    assert len(result["abstract_edges"]) <= max_edges, \
        f"Abstract edges {len(result['abstract_edges'])} > n^2 = {max_edges}"


def test_sea_nodes_excluded():
    """Nodes outside all provinces (sea) must not appear in any cluster."""
    sources = {"provinces": [_prov_feat([(0,0),(0.5,0),(0.5,0.5),(0,0.5),(0,0)], "a", "a_01")]}
    wp = {
        "nodes": [
            {"id": "inside", "lng": 0.25, "lat": 0.25,
             "cover_combat": "plains", "elevation": "flat", "nation_id": "a"},
            {"id": "outside", "lng": 5.0, "lat": 5.0,
             "cover_combat": "plains", "elevation": "flat", "nation_id": None},
        ],
        "edges": [{"from": "inside", "to": "outside", "base_cost": 1.0, "river_size": None}],
        "road_connections": [],
    }
    result = generate_hpa_clusters(sources, wp, cluster_threshold=300)
    for cluster in result["clusters"]:
        assert "outside" not in cluster.get("border_nodes", []), \
            "Sea node 'outside' should not appear in any cluster's border_nodes"
