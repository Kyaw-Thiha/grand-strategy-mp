extends Node

func _ready() -> void:
	print("=== test_military_system_combat_zones ===")
	var pass_count: int = 0
	var fail_count: int = 0

	var ms = load("res://src/systems/military/military_system.gd").new()

	var divisions: Dictionary = {
		"div_a": {"position_lng": 0.0, "position_lat": 0.0},
		"div_b": {"position_lng": 0.1, "position_lat": 0.0},
		"div_c": {"position_lng": 5.0, "position_lat": 5.0},
		"div_d": {"position_lng": 5.1, "position_lat": 5.0},
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
	divisions_with_e["div_e"] = {"position_lng": 0.2, "position_lat": 0.0}
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

	print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
	if fail_count > 0:
		get_tree().quit(1)
	else:
		get_tree().quit(0)
