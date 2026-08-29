extends Node
## Verifies client-side subprovince event plumbing end-to-end:
## GameState apply methods correctly mutate GameState.subprovinces and emit
## the corresponding EventBus signals with the right arguments.

func _ready() -> void:
	var ok := true
	ok = _test_init_snapshot() and ok
	ok = _test_captured_updates_dict_and_emits_signal() and ok
	ok = _test_contest_updated_emits_signal() and ok
	if ok:
		print("[PASS] test_subprovince_events")
		get_tree().quit(0)
	else:
		print("[FAIL] test_subprovince_events")
		get_tree().quit(1)


func _test_init_snapshot() -> bool:
	GameState.subprovinces.clear()
	GameState._apply_subprovince_init({"subprovinces": {"sp_1": "germany", "sp_2": "france"}})
	return GameState.subprovinces.get("sp_1", {}).get("owner_id") == "germany" \
		and GameState.subprovinces.get("sp_2", {}).get("owner_id") == "france"


func _test_captured_updates_dict_and_emits_signal() -> bool:
	# NOTE: GDScript lambdas capture outer locals by value, so the callback
	# mutates the CONTENTS of a pre-existing Dictionary (a reference type)
	# rather than reassigning the outer variable — reassignment would not
	# be visible outside the lambda.
	var received := {}
	var cb := func(sp_id: String, p_id: String, owner: String) -> void:
		received["sp_id"] = sp_id
		received["p_id"] = p_id
		received["owner"] = owner
	EventBus.subprovince_captured.connect(cb)
	GameState._apply_subprovince_captured({"subprovince_id": "sp_1", "province_id": "we6_germany_01", "new_owner_id": "france"})
	EventBus.subprovince_captured.disconnect(cb)
	return GameState.subprovinces["sp_1"]["owner_id"] == "france" and received.get("sp_id") == "sp_1"


func _test_contest_updated_emits_signal() -> bool:
	var received := {}
	var cb := func(p_id: String, contested: bool) -> void:
		received["p_id"] = p_id
		received["contested"] = contested
	EventBus.province_contest_updated.connect(cb)
	GameState._apply_province_contest_updated({"province_id": "we6_germany_01", "contested": true})
	EventBus.province_contest_updated.disconnect(cb)
	return received.get("p_id") == "we6_germany_01" and received.get("contested") == true
