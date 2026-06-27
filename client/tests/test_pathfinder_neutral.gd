extends Node

func _ready() -> void:
    print("=== test_pathfinder_neutral ===")
    var pass_count: int = 0
    var fail_count: int = 0

    # Graph: player is in 'france', neutral is 'germany', enemy is 'spain'
    # Layout: france_node -> germany_node -> spain_node (straight line)
    #         france_node -> bypass_node (longer path around germany)
    var wp_graph: Dictionary = {
        "nodes": [
            {"id":"fr","lng":0.0,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"france"},
            {"id":"de","lng":0.1,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"germany"},
            {"id":"es","lng":0.2,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"spain"},
            {"id":"by","lng":0.1,"lat":0.2,"cover_combat":"plains","elevation":"flat","nation_id":"france"},
        ],
        "edges": [
            {"from":"fr","to":"de","base_cost":1.0,"river_size":null},
            {"from":"de","to":"es","base_cost":1.0,"river_size":null},
            {"from":"fr","to":"by","base_cost":2.0,"river_size":null},
            {"from":"by","to":"es","base_cost":2.0,"river_size":null},
        ],
        "road_connections": [],
    }
    var relations: Dictionary = {
        "france:germany": {"stance": "neutral"},
        "france:spain":   {"stance": "war"},
    }

    var pf = load("res://src/systems/military/pathfinder.gd").new()
    pf.build(wp_graph)

    # TEST 1: Without nation filtering, A* takes the short route through germany
    var result_nofilter = pf.find_path("fr", "es", {})
    var path_nofilter: Array = result_nofilter.get("logical", result_nofilter)
    var has_germany_nofilter: bool = false
    for wp in path_nofilter:
        if str(wp) == "de": has_germany_nofilter = true
    if has_germany_nofilter:
        print("PASS test_without_filter_routes_through_neutral")
        pass_count += 1
    else:
        print("FAIL test_without_filter_routes_through_neutral — path: ", path_nofilter)
        fail_count += 1

    # TEST 2: With nation filtering, A* must NOT route through germany
    var result_filtered = pf.find_path("fr", "es", {}, 1.0, "france", relations)
    var path_filtered: Array = result_filtered.get("logical", result_filtered)
    var has_germany: bool = false
    for wp in path_filtered:
        if str(wp) == "de": has_germany = true
    if not has_germany and path_filtered.size() >= 2:
        print("PASS test_neutral_territory_avoided")
        pass_count += 1
    else:
        print("FAIL test_neutral_territory_avoided — path still goes through germany: ", path_filtered)
        fail_count += 1

    # TEST 3: Enemy territory (spain) must be traversable
    if path_filtered.size() >= 2 and str(path_filtered[-1]) == "es":
        print("PASS test_destination_in_enemy_territory_reachable")
        pass_count += 1
    else:
        print("FAIL test_destination_in_enemy_territory_reachable — path: ", path_filtered)
        fail_count += 1

    # TEST 4: Own territory always passable
    var path_own = pf.find_path("fr", "by", {}, 1.0, "france", relations)
    var logical_own: Array = path_own.get("logical", path_own)
    if logical_own.size() >= 2 and str(logical_own[-1]) == "by":
        print("PASS test_own_territory_always_passable")
        pass_count += 1
    else:
        print("FAIL test_own_territory_always_passable — path: ", logical_own)
        fail_count += 1

    # TEST 5: Empty player_nation_id -> no filtering (backward compat)
    var result_empty = pf.find_path("fr", "es", {}, 1.0, "", {})
    var path_empty: Array = result_empty.get("logical", result_empty)
    var has_germany_empty: bool = false
    for wp in path_empty:
        if str(wp) == "de": has_germany_empty = true
    if has_germany_empty:
        print("PASS test_no_nation_no_exclusion")
        pass_count += 1
    else:
        print("FAIL test_no_nation_no_exclusion — expected germany in unfiltered path: ", path_empty)
        fail_count += 1

    print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
    if fail_count > 0:
        get_tree().quit(1)
    else:
        get_tree().quit(0)
