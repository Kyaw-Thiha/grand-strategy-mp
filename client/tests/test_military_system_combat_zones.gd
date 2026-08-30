extends Node

func _ready() -> void:
	print("=== test_military_system_combat_zones ===")
	var pass_count: int = 0
	var fail_count: int = 0

	var ms = load("res://src/systems/military/military_system.gd").new()

	var divisions: Dictionary = {
		"div_a": {"position_lng": 0.0, "position_lat": 0.0, "combat_state": "engaged"},
		"div_b": {"position_lng": 0.1, "position_lat": 0.0, "combat_state": "engaged"},
		"div_c": {"position_lng": 5.0, "position_lat": 5.0, "combat_state": "engaged"},
		"div_d": {"position_lng": 5.1, "position_lat": 5.0, "combat_state": "engaged"},
	}

	# Two separate pairwise engagements that share no division — must produce two
	# separate zones.
	var pairs_separate: Dictionary = {
		"eng_1": {"division_a": "div_a", "division_b": "div_b"},
		"eng_2": {"division_a": "div_c", "division_b": "div_d"},
	}
	var zones_separate: Array[Dictionary] = ms._build_combat_zones(pairs_separate, divisions)
	if zones_separate.size() == 2:
		print("PASS test_disjoint_pairs_form_two_zones")
		pass_count += 1
	else:
		print("FAIL test_disjoint_pairs_form_two_zones — zones: ", zones_separate)
		fail_count += 1

	# Two attackers vs one defender (div_b shared between eng_1 and eng_3) must merge
	# into a single zone containing all three divisions.
	var pairs_shared: Dictionary = {
		"eng_1": {"division_a": "div_a", "division_b": "div_b"},
		"eng_3": {"division_a": "div_e", "division_b": "div_b"},
	}
	var divisions_with_e: Dictionary = divisions.duplicate()
	divisions_with_e["div_e"] = {"position_lng": 0.2, "position_lat": 0.0, "combat_state": "engaged"}
	var zones_shared: Array[Dictionary] = ms._build_combat_zones(pairs_shared, divisions_with_e)
	if zones_shared.size() == 1 and zones_shared[0]["division_ids"].size() == 3:
		print("PASS test_shared_division_merges_pairs_into_one_zone")
		pass_count += 1
	else:
		print("FAIL test_shared_division_merges_pairs_into_one_zone — zones: ", zones_shared)
		fail_count += 1

	# Empty input produces no zones.
	var zones_empty: Array[Dictionary] = ms._build_combat_zones({}, divisions)
	if zones_empty.is_empty():
		print("PASS test_no_active_pairs_no_zones")
		pass_count += 1
	else:
		print("FAIL test_no_active_pairs_no_zones — zones: ", zones_empty)
		fail_count += 1

	# A pair referencing a division not present in `divisions` at all must be dropped —
	# this simulates a division that has been destroyed and removed from GameState.
	var pairs_missing_division: Dictionary = {
		"eng_missing": {"division_a": "div_a", "division_b": "div_ghost"},
	}
	var zones_missing: Array[Dictionary] = ms._build_combat_zones(pairs_missing_division, divisions)
	if zones_missing.is_empty():
		print("PASS test_pair_with_missing_division_produces_no_zone")
		pass_count += 1
	else:
		print("FAIL test_pair_with_missing_division_produces_no_zone — zones: ", zones_missing)
		fail_count += 1

	# A pair where both divisions exist but one has retreated (combat_state no longer
	# "engaged"/"suppressed") simulates a leaked active_engagement_pairs entry after a
	# multi-attacker retreat; it must not produce a zone.
	var divisions_with_retreat: Dictionary = divisions.duplicate(true)
	divisions_with_retreat["div_b"] = {"position_lng": 0.1, "position_lat": 0.0, "combat_state": "retreating"}
	var pairs_retreated: Dictionary = {
		"eng_1": {"division_a": "div_a", "division_b": "div_b"},
	}
	var zones_retreated: Array[Dictionary] = ms._build_combat_zones(pairs_retreated, divisions_with_retreat)
	if zones_retreated.is_empty():
		print("PASS test_pair_with_retreating_division_produces_no_zone")
		pass_count += 1
	else:
		print("FAIL test_pair_with_retreating_division_produces_no_zone — zones: ", zones_retreated)
		fail_count += 1

	# Sanity check: both divisions "engaged" must still produce a zone (no regression).
	var zones_engaged: Array[Dictionary] = ms._build_combat_zones(pairs_retreated, divisions)
	if zones_engaged.size() == 1:
		print("PASS test_pair_with_both_engaged_still_produces_zone")
		pass_count += 1
	else:
		print("FAIL test_pair_with_both_engaged_still_produces_zone — zones: ", zones_engaged)
		fail_count += 1

	print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
	if fail_count > 0:
		get_tree().quit(1)
	else:
		get_tree().quit(0)
