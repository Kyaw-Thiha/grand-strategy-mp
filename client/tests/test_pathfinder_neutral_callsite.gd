extends Node

func _ready() -> void:
    var pf = load("res://src/systems/military/pathfinder.gd").new()

    var graph: Dictionary = {
        "nodes": [
            {"id": "A", "lng": 0.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "player"},
            {"id": "B", "lng": 0.1, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "neutral_nation"},
            {"id": "C", "lng": 0.2, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "enemy_nation"},
        ],
        "edges": [
            {"from": "A", "to": "B", "base_cost": 1.0, "river_size": null},
            {"from": "B", "to": "C", "base_cost": 1.0, "river_size": null},
        ],
        "road_connections": [],
    }
    pf.build(graph)

    var profile := {"plains_flat": 1.0}
    var relations := {"player:neutral_nation": {"stance": "neutral"}, "player:enemy_nation": {"stance": "war"}}

    # Without filter: path through B works
    var result_no_filter: Dictionary = pf.find_path("A", "C", profile)
    var path_no_filter: Array = result_no_filter.get("logical", [])
    assert(not path_no_filter.is_empty())
    assert("B" in path_no_filter)
    print("PASS test_without_filter_paths_through_B")

    # With filter: B is neutral -> path empty (no alternate route)
    var result_filtered: Dictionary = pf.find_path("A", "C", profile, 1.0, "player", relations)
    var path_filtered: Array = result_filtered.get("logical", [])
    assert(path_filtered.is_empty())
    print("PASS test_with_filter_path_empty")

    print("=== test_pathfinder_neutral_callsite: all passed ===")
    get_tree().quit(0)
