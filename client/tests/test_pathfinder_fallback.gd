extends Node

func _ready() -> void:
    var pf = load("res://src/systems/military/pathfinder.gd").new()

    var graph: Dictionary = {
        "nodes": [
            {"id": "A", "lng": 0.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": ""},
            {"id": "B", "lng": 1.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": ""},
            {"id": "C", "lng": 2.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": ""},
        ],
        "edges": [
            {"from": "A", "to": "B", "base_cost": 1.0, "river_size": null},
            {"from": "B", "to": "A", "base_cost": 1.0, "river_size": null},
        ],
        "road_connections": [],
    }
    pf.build(graph)
    var profile := {"plains_flat": 1.0}

    # Direct path A->C fails (C is isolated)
    var direct: Dictionary = pf.find_path("A", "C", profile)
    assert(direct.get("logical", []).is_empty(), "FAIL: direct path to isolated C should be empty")
    print("PASS test_direct_to_isolated_empty")

    # find_nearest_reachable should return B (closest to C reachable from A)
    var fallback_id: String = pf.find_nearest_reachable("A", 2.0, 0.0, profile)
    assert(fallback_id == "B", "FAIL: nearest reachable to C from A should be B, got: " + fallback_id)
    print("PASS test_fallback_returns_B")

    # Path from A to the fallback should succeed
    var fallback_result: Dictionary = pf.find_path("A", fallback_id, profile)
    assert(not fallback_result.get("logical", []).is_empty(), "FAIL: path to fallback must succeed")
    print("PASS test_path_to_fallback_succeeds")

    print("=== test_pathfinder_fallback: all passed ===")
    get_tree().quit(0)
