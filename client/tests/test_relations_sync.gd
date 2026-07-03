extends Node

func _ready() -> void:
    assert(GameState.has_method("_apply_relations_updated"),
        "FAIL: _apply_relations_updated must exist on GameState")
    print("PASS test_apply_method_exists")

    var mock_data = {
        "relations": {
            "alpha:beta": "war",
            "beta:alpha": "war",
            "alpha:gamma": "neutral",
            "gamma:alpha": "neutral",
        }
    }
    GameState._apply_relations_updated(mock_data)

    assert(GameState.relations.has("alpha:beta"), "FAIL: alpha:beta must be in relations")
    assert(GameState.relations["alpha:beta"].get("stance") == "war", "FAIL: stance must be war")
    assert(GameState.relations.has("alpha:gamma"), "FAIL: alpha:gamma must be in relations")
    assert(GameState.relations["alpha:gamma"].get("stance") == "neutral", "FAIL: stance must be neutral")
    print("PASS test_relations_populated")

    var pf = load("res://src/systems/military/pathfinder.gd").new()
    var graph = {
        "nodes": [
            {"id": "A", "lng": 0.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "alpha"},
            {"id": "B", "lng": 1.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "gamma"},
            {"id": "C", "lng": 2.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "alpha"},
        ],
        "edges": [
            {"from": "A", "to": "B", "base_cost": 1.0, "river_size": null},
            {"from": "B", "to": "C", "base_cost": 1.0, "river_size": null},
        ],
        "road_connections": [],
    }
    pf.build(graph)
    var profile := {"plains_flat": 1.0}

    var res = pf.find_path("A", "C", profile, 1.0, "alpha", GameState.relations)
    assert(res.get("logical", []).is_empty(), "FAIL: path through neutral gamma must be blocked")
    print("PASS test_neutral_blocked_with_relations")

    GameState._apply_relations_updated({
        "relations": {
            "alpha:gamma": "alliance",
            "gamma:alpha": "alliance",
        }
    })
    var allied_res = pf.find_path("A", "C", profile, 1.0, "alpha", GameState.relations)
    assert(not allied_res.get("logical", []).is_empty(), "FAIL: path through allied gamma must be allowed")
    print("PASS test_alliance_allowed_with_relations")

    print("=== test_relations_sync: all passed ===")
    get_tree().quit(0)
