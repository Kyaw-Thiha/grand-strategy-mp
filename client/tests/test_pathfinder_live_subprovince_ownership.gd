extends Node
## Regression coverage for the stale-territory-snapshot bug: Pathfinder._is_neutral_for used to
## read a node's static, map-generation-time `nation_id` field only. Once subprovince ownership
## started churning far more often/granularly than that static field could ever reflect, a division
## could walk into land the guard should have blocked, or get walled into a dead pocket once inside
## (see pathfinder.gd's _resolve_node_nation doc comment). This confirms live `GameState.subprovinces`
## ownership now wins over the static `nation_id` tag whenever a node carries a `subprovince_id`.

func _ready() -> void:
	print("=== test_pathfinder_live_subprovince_ownership ===")
	var pass_count: int = 0
	var fail_count: int = 0

	# Graph: A (player) -> B (tagged sp_b, static nation_id says "player's own nation" but the
	# live subprovince ownership below says a neutral third party) -> C (player).
	var wp_graph: Dictionary = {
		"nodes": [
			{"id":"A","lng":0.0,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"france"},
			{"id":"B","lng":0.1,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"france","subprovince_id":"sp_b"},
			{"id":"C","lng":0.2,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"france"},
		],
		"edges": [
			{"from":"A","to":"B","base_cost":1.0,"river_size":null},
			{"from":"B","to":"C","base_cost":1.0,"river_size":null},
		],
		"road_connections": [],
	}
	var relations: Dictionary = {"france:germany": {"stance": "neutral"}}

	GameState.subprovinces.clear()
	GameState.subprovinces["sp_b"] = {"province_id": "probe_province", "owner_id": "germany"}

	var pf = load("res://src/systems/military/pathfinder.gd").new()
	pf.build(wp_graph)

	# TEST 1: live ownership (germany, neutral) wins over the stale static nation_id (france, own).
	# B is the only route from A to C, so a correctly-applied block yields an empty path (no
	# alternative to fall back to) — same "blocked with no alternative" pattern as
	# test_pathfinder_neutral_callsite.gd, not merely "a path that happens to avoid B".
	var result: Dictionary = pf.find_path("A", "C", {}, 1.0, "france", relations)
	var path: Array = result.get("logical", result)
	if path.is_empty():
		print("PASS test_live_subprovince_ownership_overrides_stale_nation_id")
		pass_count += 1
	else:
		print("FAIL test_live_subprovince_ownership_overrides_stale_nation_id — expected no path, got: ", path)
		fail_count += 1

	# TEST 2: once GameState reflects a friendly capture, the same node becomes passable again,
	# with no rebuild of the waypoint graph or Pathfinder needed.
	GameState.subprovinces["sp_b"] = {"province_id": "probe_province", "owner_id": "france"}
	var result_after_capture: Dictionary = pf.find_path("A", "C", {}, 1.0, "france", relations)
	var path_after_capture: Array = result_after_capture.get("logical", result_after_capture)
	if path_after_capture.size() >= 2 and str(path_after_capture[-1]) == "C":
		print("PASS test_capture_makes_node_passable_without_graph_rebuild")
		pass_count += 1
	else:
		print("FAIL test_capture_makes_node_passable_without_graph_rebuild — path: ", path_after_capture)
		fail_count += 1

	GameState.subprovinces.clear()

	print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
	if fail_count > 0:
		get_tree().quit(1)
	else:
		get_tree().quit(0)
