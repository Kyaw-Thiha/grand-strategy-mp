extends Node

func _ready() -> void:
    print("=== test_smooth_path ===")
    var pass_count: int = 0
    var fail_count: int = 0

    var wp_graph: Dictionary = {
        "nodes": [
            {"id":"a","lng":0.0,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":null},
            {"id":"b","lng":0.1,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":null},
            {"id":"c","lng":0.2,"lat":0.1,"cover_combat":"plains","elevation":"flat","nation_id":null},
            {"id":"d","lng":0.3,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":null},
        ],
        "edges": [
            {"from":"a","to":"b","base_cost":1.0,"river_size":null},
            {"from":"b","to":"c","base_cost":1.0,"river_size":null},
            {"from":"c","to":"d","base_cost":1.0,"river_size":null},
        ],
        "road_connections": [],
    }

    var pf = load("res://src/systems/military/pathfinder.gd").new()
    pf.build(wp_graph)

    # TEST 1: find_path returns Dictionary with logical and visual keys
    var result = pf.find_path("a", "d", {})
    if result is Dictionary and result.has("logical") and result.has("visual"):
        print("PASS test_find_path_returns_dict")
        pass_count += 1
    else:
        print("FAIL test_find_path_returns_dict — got: ", result)
        fail_count += 1

    # TEST 2: logical path starts at 'a' and ends at 'd'
    if result.has("logical"):
        var logical: Array = result["logical"]
        if logical.size() >= 2 and str(logical[0]) == "a" and str(logical[-1]) == "d":
            print("PASS test_logical_path_correct_endpoints")
            pass_count += 1
        else:
            print("FAIL test_logical_path_correct_endpoints — got: ", logical)
            fail_count += 1

    # TEST 3: visual path is longer or equal to logical (smoothing only adds points)
    if result.has("logical") and result.has("visual"):
        var logical: Array = result["logical"]
        var visual: Array  = result["visual"]
        if visual.size() >= logical.size():
            print("PASS test_visual_path_at_least_as_long")
            pass_count += 1
        else:
            print("FAIL test_visual_path_at_least_as_long — logical=%d visual=%d" % [logical.size(), visual.size()])
            fail_count += 1

    # TEST 4: 2-waypoint path — visual should equal logical (no ghost artifact)
    var result2 = pf.find_path("a", "b", {})
    if result2.has("logical") and result2.has("visual"):
        var l2: Array = result2["logical"]
        var v2: Array = result2["visual"]
        if l2.size() <= 2 and v2.size() <= 2:
            print("PASS test_two_point_path_unchanged")
            pass_count += 1
        else:
            print("FAIL test_two_point_path_unchanged — logical=%d visual=%d" % [l2.size(), v2.size()])
            fail_count += 1

    print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
    if fail_count > 0:
        get_tree().quit(1)
    else:
        get_tree().quit(0)
