extends Node

func _ready() -> void:
    var pf = load("res://src/systems/military/pathfinder.gd").new()

    var graph = {
        "nodes": [
            {"id": "A", "lng": 0.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "alpha"},
            {"id": "B", "lng": 1.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "beta"},
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

    # Case 1: empty relations (cold start) — unknown nation MUST be passable
    var result1 = pf.find_path("A", "C", profile, 1.0, "alpha", {})
    var path1 = result1.get("logical", [])
    assert(not path1.is_empty(), "FAIL: path through unknown-relation nation should succeed with empty relations dict")
    assert("B" in path1, "FAIL: unknown-relation node B should not be blocked")
    print("PASS test_empty_relations_passable")

    # Case 2: explicit neutral stance — must be BLOCKED
    var result2 = pf.find_path("A", "C", profile, 1.0, "alpha", {"alpha:beta": {"stance": "neutral"}})
    assert(result2.get("logical", []).is_empty(), "FAIL: explicitly neutral nation must block path")
    print("PASS test_explicit_neutral_blocked")

    # Case 3: explicit war stance — must be PASSABLE
    var result3 = pf.find_path("A", "C", profile, 1.0, "alpha", {"alpha:beta": {"stance": "war"}})
    assert(not result3.get("logical", []).is_empty(), "FAIL: war-stance nation must be passable")
    print("PASS test_explicit_war_passable")

    # Case 4: no player_nation_id — no filtering at all
    var result4 = pf.find_path("A", "C", profile, 1.0, "", {})
    assert(not result4.get("logical", []).is_empty(), "FAIL: empty player_nation_id must disable all filtering")
    print("PASS test_no_nation_no_filter")

    print("=== test_neutral_fallback: all passed ===")
    get_tree().quit(0)
