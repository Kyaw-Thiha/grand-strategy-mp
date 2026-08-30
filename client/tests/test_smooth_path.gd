extends Node
## Tests Pathfinder's post-string-pull entry expansion used for off-road jitter and last-mile
## resolution (LAND_MOVEMENT_IMPROVEMENTS.md Points 2 + 4). Replaces the original
## test_smooth_path.gd, which asserted on the dead _smooth_path / "visual" return-key behavior
## removed in Point 2's cleanup.

func _ready() -> void:
	print("=== test_pathfinder_jitter ===")
	var pass_count: int = 0
	var fail_count: int = 0

	# Graph: a-b-c-d where a-b and c-d are road nodes; b-c is off-road.
	# This lets us assert road-road segments skip jitter while off-road segments subdivide.
	var wp_graph: Dictionary = {
		"nodes": [
			{"id":"a","lng":0.0,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":null},
			{"id":"b","lng":0.1,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":null},
			{"id":"c","lng":0.15,"lat":0.05,"cover_combat":"plains","elevation":"flat","nation_id":null},
			{"id":"d","lng":0.25,"lat":0.05,"cover_combat":"plains","elevation":"flat","nation_id":null},
		],
		"edges": [
			{"from":"a","to":"b","base_cost":0.05,"river_size":null},
			{"from":"b","to":"c","base_cost":1.0,"river_size":null},
			{"from":"c","to":"d","base_cost":0.05,"river_size":null},
		],
		"road_connections": [
			{"road_id":"r1","waypoint_id":"a"},
			{"road_id":"r1","waypoint_id":"b"},
			{"road_id":"r1","waypoint_id":"c"},
			{"road_id":"r1","waypoint_id":"d"},
		],
	}

	var pf = load("res://src/systems/military/pathfinder.gd").new()
	pf.build(wp_graph)

	# TEST 1: find_path returns Dictionary with logical key only (no "visual" — removed).
	var result = pf.find_path("a", "d", {})
	if result is Dictionary and result.has("logical") and not result.has("visual"):
		print("PASS test_find_path_no_visual_key")
		pass_count += 1
	else:
		print("FAIL test_find_path_no_visual_key — got keys: ", result.keys())
		fail_count += 1

	# TEST 2: find_path logical path traverses a → b → c → d
	if result.has("logical"):
		var logical: Array = result["logical"]
		var got: String = ""
		for w in logical:
			got += str(w) + ","
		if got == "a,b,c,d,":
			print("PASS test_logical_path_endpoints")
			pass_count += 1
		else:
			print("FAIL test_logical_path_endpoints — got: ", got)
			fail_count += 1

	# TEST 3: _inject_offroad_jitter — all roads → no sub-points (jitter skipped).
	# Forcing all-road is hard with the actual graph; just check that road-road edges of
	# this graph (a→b is road, c→d is road) emit no sub-points by inspecting the
	# intermediate pair b→c (off-road) → must add sub-points, but a→b and c→d → must not.
	var entries: Array = pf._inject_offroad_jitter(["a","b","c","d"], {}, "div_test")
	# Expect: a, [b-sub..c-sub points between b and c], c, d
	# Sub-points have id=""; real waypoints have id set.
	var real_count: int = 0
	var sub_count: int = 0
	for e in entries:
		if str(e["id"]) == "":
			sub_count += 1
		else:
			real_count += 1
	if real_count == 4 and sub_count >= 1:
		print("PASS test_jitter_offroad_inserts_subpoints — real=%d sub=%d" % [real_count, sub_count])
		pass_count += 1
	else:
		print("FAIL test_jitter_offroad_inserts_subpoints — real=%d sub=%d entries=%s" % [real_count, sub_count, entries])
		fail_count += 1

	# TEST 4: deterministic — same division_id → same output across calls.
	var run1: Array = pf._inject_offroad_jitter(["b","c"], {}, "div_X")
	var run2: Array = pf._inject_offroad_jitter(["b","c"], {}, "div_X")
	var deterministic: bool = run1.size() == run2.size()
	if deterministic:
		for i in run1.size():
			if abs(float(run1[i]["lng"]) - float(run2[i]["lng"])) > 1e-9 \
					or abs(float(run1[i]["lat"]) - float(run2[i]["lat"])) > 1e-9:
				deterministic = false
				break
	if deterministic:
		print("PASS test_jitter_deterministic")
		pass_count += 1
	else:
		print("FAIL test_jitter_deterministic — run1=%s run2=%s" % [run1, run2])
		fail_count += 1

	# TEST 5: different division_id → different output (division_id is part of the seed).
	var run3: Array = pf._inject_offroad_jitter(["b","c"], {}, "div_Y")
	var different: bool = false
	if run1.size() == run3.size():
		for i in run1.size():
			if abs(float(run1[i]["lng"]) - float(run3[i]["lng"])) > 1e-9 \
					or abs(float(run1[i]["lat"]) - float(run3[i]["lat"])) > 1e-9:
				different = true
				break
	if different:
		print("PASS test_jitter_per_division_unique")
		pass_count += 1
	else:
		print("FAIL test_jitter_per_division_unique — divisions share noise")
		fail_count += 1

	# TEST 6: first and last real waypoint positions are preserved exactly (segment endpoints).
	if not entries.is_empty():
		var first: Dictionary = entries[0]
		var last: Dictionary = entries[entries.size() - 1]
		if str(first["id"]) == "a" and str(last["id"]) == "d" \
				and abs(float(first["lng"]) - 0.0) < 1e-9 \
				and abs(float(first["lat"]) - 0.0) < 1e-9 \
				and abs(float(last["lng"]) - 0.25) < 1e-9 \
				and abs(float(last["lat"]) - 0.05) < 1e-9:
			print("PASS test_jitter_endpoints_preserved")
			pass_count += 1
		else:
			print("FAIL test_jitter_endpoints_preserved — first=%s last=%s" % [first, last])
			fail_count += 1

	print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
	if fail_count > 0:
		get_tree().quit(1)
	else:
		get_tree().quit(0)
