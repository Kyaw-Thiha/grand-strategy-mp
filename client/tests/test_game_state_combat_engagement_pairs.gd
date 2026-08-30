extends Node

func _ready() -> void:
	print("=== test_game_state_combat_engagement_pairs ===")
	var pass_count: int = 0
	var fail_count: int = 0

	var gs = load("res://src/core/game_state.gd").new()
	gs.divisions = {
		"div_a": {"nation_id": "germany"},
		"div_b": {"nation_id": "france"},
	}

	# TEST 1: COMBAT_STARTED stores the pair keyed by engagement_id.
	gs._apply_combat_started({
		"division_a": "div_a",
		"division_b": "div_b",
		"is_meeting_battle": false,
		"engagement_id": "div_a_vs_div_b_123",
	})
	if gs.active_engagement_pairs.get("div_a_vs_div_b_123", {}).get("division_a", "") == "div_a" \
			and gs.active_engagement_pairs["div_a_vs_div_b_123"]["division_b"] == "div_b":
		print("PASS test_combat_started_stores_pair")
		pass_count += 1
	else:
		print("FAIL test_combat_started_stores_pair — active_engagement_pairs: ", gs.active_engagement_pairs)
		fail_count += 1

	# TEST 2: erasing by engagement_id (the operation session_manager.gd performs on
	# COMBAT_ENDED) removes exactly that entry.
	gs.active_engagement_pairs.erase("div_a_vs_div_b_123")
	if not gs.active_engagement_pairs.has("div_a_vs_div_b_123"):
		print("PASS test_engagement_erased_by_id")
		pass_count += 1
	else:
		print("FAIL test_engagement_erased_by_id — still present: ", gs.active_engagement_pairs)
		fail_count += 1

	print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
	if fail_count > 0:
		get_tree().quit(1)
	else:
		get_tree().quit(0)
