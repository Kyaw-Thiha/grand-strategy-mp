extends Node

func _ready() -> void:
	print("=== test_pathfinder_combat_zones ===")
	var pass_count: int = 0
	var fail_count: int = 0

	# Graph: straight line A -> B -> C -> D -> E, plus a longer bypass A -> F -> G -> E.
	# A combat zone centered on B (radius covers B and C) blocks the direct route
	# unless the destination itself is inside the zone.
	var wp_graph: Dictionary = {
		"nodes": [
			{"id":"A","lng":0.0,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":""},
			{"id":"B","lng":0.1,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":""},
			{"id":"C","lng":0.2,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":""},
			{"id":"D","lng":0.3,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":""},
			{"id":"E","lng":0.4,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":""},
			{"id":"F","lng":0.1,"lat":0.5,"cover_combat":"plains","elevation":"flat","nation_id":""},
			{"id":"G","lng":0.3,"lat":0.5,"cover_combat":"plains","elevation":"flat","nation_id":""},
		],
		"edges": [
			{"from":"A","to":"B","base_cost":1.0,"river_size":null},
			{"from":"B","to":"C","base_cost":1.0,"river_size":null},
			{"from":"C","to":"D","base_cost":1.0,"river_size":null},
			{"from":"D","to":"E","base_cost":1.0,"river_size":null},
			{"from":"A","to":"F","base_cost":1.0,"river_size":null},
			{"from":"F","to":"G","base_cost":1.0,"river_size":null},
			{"from":"G","to":"E","base_cost":1.0,"river_size":null},
		],
		"road_connections": [],
	}

	var pf = load("res://src/systems/military/pathfinder.gd").new()
	pf.build(wp_graph)

	# Zone centered on B, radius covers B (0.1,0.0) and C (0.2,0.0) — both within
	# ENGAGEMENT_RADIUS_DEG (~0.225 deg at 25km/111) of the zone center.
	var zone_at_b: Array[Dictionary] = [{"positions": [Vector2(0.1, 0.0)]}]

	# TEST 1: without combat_zones, A* takes the short direct route through B and C.
	var result_nofilter: Dictionary = pf.find_path("A", "E", {})
	var path_nofilter: Array = result_nofilter.get("logical", [])
	var has_b_nofilter: bool = false
	for wp in path_nofilter:
		if str(wp) == "B": has_b_nofilter = true
	if has_b_nofilter:
		print("PASS test_without_zones_routes_through_b")
		pass_count += 1
	else:
		print("FAIL test_without_zones_routes_through_b — path: ", path_nofilter)
		fail_count += 1

	# TEST 2: with a combat zone at B, and destination E outside the zone,
	# A* must avoid B/C and take the bypass through F/G.
	var result_avoid: Dictionary = pf.find_path("A", "E", {}, 1.0, "", {}, INF, INF, false, zone_at_b)
	var path_avoid: Array = result_avoid.get("logical", [])
	var has_b_avoid: bool = false
	for wp in path_avoid:
		if str(wp) == "B": has_b_avoid = true
	if not has_b_avoid and path_avoid.size() >= 2 and str(path_avoid[-1]) == "E":
		print("PASS test_zone_avoided_when_destination_outside")
		pass_count += 1
	else:
		print("FAIL test_zone_avoided_when_destination_outside — path: ", path_avoid)
		fail_count += 1

	# TEST 3: destination C is INSIDE the zone at B — the segment must still be able
	# to reach it (destination is exempt from its own zone).
	var result_dest_in_zone: Dictionary = pf.find_path("A", "C", {}, 1.0, "", {}, INF, INF, false, zone_at_b)
	var path_dest_in_zone: Array = result_dest_in_zone.get("logical", [])
	if path_dest_in_zone.size() >= 2 and str(path_dest_in_zone[-1]) == "C":
		print("PASS test_destination_inside_zone_still_reachable")
		pass_count += 1
	else:
		print("FAIL test_destination_inside_zone_still_reachable — path: ", path_dest_in_zone)
		fail_count += 1

	# TEST 4: empty combat_zones array (default/backward-compat) behaves like no filter.
	var empty_zones: Array[Dictionary] = []
	var result_empty_zones: Dictionary = pf.find_path("A", "E", {}, 1.0, "", {}, INF, INF, false, empty_zones)
	var path_empty_zones: Array = result_empty_zones.get("logical", [])
	var has_b_empty: bool = false
	for wp in path_empty_zones:
		if str(wp) == "B": has_b_empty = true
	if has_b_empty:
		print("PASS test_empty_zones_no_exclusion")
		pass_count += 1
	else:
		print("FAIL test_empty_zones_no_exclusion — path: ", path_empty_zones)
		fail_count += 1

	print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
	if fail_count > 0:
		get_tree().quit(1)
	else:
		get_tree().quit(0)
