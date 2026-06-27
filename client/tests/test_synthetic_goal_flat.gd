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
            {"from": "B", "to": "C", "base_cost": 1.0, "river_size": null},
        ],
        "road_connections": [],
    }
    pf.build(graph)
    var profile := {"plains_flat": 1.0}

    var click_lng := 1.5
    var click_lat := 0.0

    # This call should use goal_lng/goal_lat params (not yet implemented)
    # When they don't exist, this will error — that's the RED
    var result: Dictionary = pf.find_path("A", "C", profile, 1.0, "", {}, click_lng, click_lat)
    var logical: Array = result.get("logical", [])
    assert(not logical.is_empty(), "FAIL: path must not be empty")

    print("PASS test_synthetic_goal_flat")
    print("=== test_synthetic_goal_flat: all passed ===")
    get_tree().quit(0)
