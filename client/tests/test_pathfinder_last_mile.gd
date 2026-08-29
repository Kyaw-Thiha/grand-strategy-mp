extends Node
## Regression coverage for the unvalidated "last-mile" straight-line movement bug (client mirror of
## game-server/test/subprovince-last-mile.test.ts's server-side coverage for
## movement_system.ts's resolveFinalPosition). Pathfinder.resolve_final_position() clamps a
## player's exact-click "final position" to the local waypoint graph's own density (with slack) and
## truncates the segment at the first neutral-territory or impassable-terrain sample, instead of
## handing the raw click coordinate through unchecked.

func _ready() -> void:
	print("=== test_pathfinder_last_mile ===")
	var pass_count: int = 0
	var fail_count: int = 0

	# Graph: "A" (anchor) has two neighbors at known distances (0.02 and 0.05 deg), and a
	# subprovince tag ("sp_a") for the live-ownership check.
	var wp_graph: Dictionary = {
		"nodes": [
			{"id":"A","lng":0.0,"lat":0.0,"cover_combat":"plains","elevation":"hills","nation_id":"france","subprovince_id":"sp_a"},
			{"id":"B","lng":0.02,"lat":0.0,"cover_combat":"plains","elevation":"hills","nation_id":"france","subprovince_id":"sp_a"},
			{"id":"C","lng":0.05,"lat":0.0,"cover_combat":"plains","elevation":"hills","nation_id":"france","subprovince_id":"sp_a"},
		],
		"edges": [
			{"from":"A","to":"B","base_cost":1.0,"river_size":null},
			{"from":"A","to":"C","base_cost":1.0,"river_size":null},
		],
		"road_connections": [],
	}
	# Local density baseline from A = max(0.02, 0.05) = 0.05; cap = 0.05 * 1.5 = 0.075.

	var pf = load("res://src/systems/military/pathfinder.gd").new()
	pf.build(wp_graph)

	GameState.subprovinces.clear()

	# TEST 1: a short click well within the cap passes through unclamped.
	var short_click: Vector2 = pf.resolve_final_position("A", 0.01, 0.0, {}, "france", {})
	if is_finite(short_click.x) and short_click.is_equal_approx(Vector2(0.01, 0.0)):
		print("PASS test_short_click_unclamped")
		pass_count += 1
	else:
		print("FAIL test_short_click_unclamped — got: ", short_click)
		fail_count += 1

	# TEST 2: a click right at the known baseline (0.05, within the 0.075 cap) is delivered whole,
	# confirming the slack multiplier isn't a harsh cutoff at the raw baseline.
	var at_baseline: Vector2 = pf.resolve_final_position("A", 0.05, 0.0, {}, "france", {})
	if is_finite(at_baseline.x) and at_baseline.is_equal_approx(Vector2(0.05, 0.0)):
		print("PASS test_baseline_distance_unclamped")
		pass_count += 1
	else:
		print("FAIL test_baseline_distance_unclamped — got: ", at_baseline)
		fail_count += 1

	# TEST 3: a click far beyond the local density gets clamped to roughly the cap, not delivered raw.
	var far_click: Vector2 = pf.resolve_final_position("A", 5.0, 0.0, {}, "france", {})
	if is_finite(far_click.x) and far_click.x < 1.0:
		print("PASS test_far_click_clamped")
		pass_count += 1
	else:
		print("FAIL test_far_click_clamped — got: ", far_click)
		fail_count += 1

	# TEST 4: a live-neutral subprovince along the segment truncates before the full click.
	GameState.subprovinces["sp_a"] = {"province_id": "probe", "owner_id": "germany"}
	var relations: Dictionary = {"france:germany": {"stance": "neutral"}}
	var blocked: Vector2 = pf.resolve_final_position("A", 0.01, 0.0, {}, "france", relations)
	if not is_finite(blocked.x):
		print("PASS test_neutral_segment_blocked_immediately")
		pass_count += 1
	else:
		print("FAIL test_neutral_segment_blocked_immediately — got: ", blocked)
		fail_count += 1
	GameState.subprovinces.clear()

	# TEST 5: impassable terrain for the given movement profile blocks the segment.
	var impassable_profile: Dictionary = {"plains_hills": INF}
	var terrain_blocked: Vector2 = pf.resolve_final_position("A", 0.01, 0.0, impassable_profile, "france", {})
	if not is_finite(terrain_blocked.x):
		print("PASS test_impassable_terrain_blocked")
		pass_count += 1
	else:
		print("FAIL test_impassable_terrain_blocked — got: ", terrain_blocked)
		fail_count += 1

	# TEST 6: a passable (finite) movement profile cost does not block.
	var passable_profile: Dictionary = {"plains_hills": 2.0}
	var terrain_ok: Vector2 = pf.resolve_final_position("A", 0.01, 0.0, passable_profile, "france", {})
	if is_finite(terrain_ok.x):
		print("PASS test_finite_terrain_cost_not_blocked")
		pass_count += 1
	else:
		print("FAIL test_finite_terrain_cost_not_blocked — got: ", terrain_ok)
		fail_count += 1

	print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
	if fail_count > 0:
		get_tree().quit(1)
	else:
		get_tree().quit(0)
