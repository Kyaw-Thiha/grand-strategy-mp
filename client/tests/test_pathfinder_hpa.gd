extends Node

func _ready() -> void:
    print("=== test_pathfinder_hpa ===")
    var pass_count: int = 0
    var fail_count: int = 0

    var wp_graph: Dictionary = {
        "nodes": [
            {"id":"l0","lng":0.0,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"a"},
            {"id":"l1","lng":0.1,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"a"},
            {"id":"l2","lng":0.2,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"a"},
            {"id":"l3","lng":0.3,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"a"},
            {"id":"l4","lng":0.4,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"a"},
            {"id":"r0","lng":0.5,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"b"},
            {"id":"r1","lng":0.6,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"b"},
            {"id":"r2","lng":0.7,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"b"},
            {"id":"r3","lng":0.8,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"b"},
            {"id":"r4","lng":0.9,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"b"},
        ],
        "edges": [
            {"from":"l0","to":"l1","base_cost":1.0,"river_size":null},
            {"from":"l1","to":"l2","base_cost":1.0,"river_size":null},
            {"from":"l2","to":"l3","base_cost":1.0,"river_size":null},
            {"from":"l3","to":"l4","base_cost":1.0,"river_size":null},
            {"from":"l4","to":"r0","base_cost":1.0,"river_size":null},
            {"from":"r0","to":"r1","base_cost":1.0,"river_size":null},
            {"from":"r1","to":"r2","base_cost":1.0,"river_size":null},
            {"from":"r2","to":"r3","base_cost":1.0,"river_size":null},
            {"from":"r3","to":"r4","base_cost":1.0,"river_size":null},
        ],
        "road_connections": [],
    }
    var cluster_data: Dictionary = {
        "cluster_threshold": 300,
        "clusters": [
            {"id":"c_a_0","province_id":"a","parent":null,"children":[],"border_nodes":["l4"]},
            {"id":"c_b_0","province_id":"b","parent":null,"children":[],"border_nodes":["r0"]},
        ],
        "abstract_edges": [
            {"from":"l4","to":"r0","cluster_id":"c_a_0","cost":0.1},
        ],
    }

    var pf = load("res://src/systems/military/pathfinder.gd").new()
    pf.build(wp_graph)

    # TEST 1: without clusters, find_path works normally
    var path_flat: Array = pf.find_path("l0", "r4", {}).get("logical", [])
    if path_flat.size() >= 2 and str(path_flat[0]) == "l0" and str(path_flat[-1]) == "r4":
        print("PASS test_flat_path_works")
        pass_count += 1
    else:
        print("FAIL test_flat_path_works — got: ", path_flat)
        fail_count += 1

    # Load clusters
    pf.build_clusters(cluster_data)

    # TEST 2: HPA* finds a path from l0 to r4
    var path_hpa: Array = pf.find_path("l0", "r4", {}).get("logical", [])
    if path_hpa.size() >= 2 and str(path_hpa[0]) == "l0" and str(path_hpa[-1]) == "r4":
        print("PASS test_hpa_finds_cross_cluster_path")
        pass_count += 1
    else:
        print("FAIL test_hpa_finds_cross_cluster_path — got: ", path_hpa)
        fail_count += 1

    # TEST 3: synthetic goal — find_path with exact coordinates
    var path_synthetic: Array = pf.find_path("l0", "r4", {}).get("logical", [])
    if path_synthetic.size() >= 2:
        print("PASS test_synthetic_goal_returns_valid_path")
        pass_count += 1
    else:
        print("FAIL test_synthetic_goal_returns_valid_path")
        fail_count += 1

    # TEST 4: cluster fallback — reload without clusters, result same as flat
    var pf2 = load("res://src/systems/military/pathfinder.gd").new()
    pf2.build(wp_graph)
    var path_no_cluster: Array = pf2.find_path("l0", "r4", {}).get("logical", [])
    if path_no_cluster.size() >= 2:
        print("PASS test_cluster_fallback_when_no_cluster_file")
        pass_count += 1
    else:
        print("FAIL test_cluster_fallback_when_no_cluster_file")
        fail_count += 1

    print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
    if fail_count > 0:
        get_tree().quit(1)
    else:
        get_tree().quit(0)
