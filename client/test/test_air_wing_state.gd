extends Node


func _ready() -> void:
	_test_eventbus_has_air_signals()
	_test_gamestate_apply_wing_updates()
	print("[PASS] test_air_wing_state: all tests passed")
	get_tree().quit()


func _test_eventbus_has_air_signals() -> void:
	assert(EventBus.has_signal("air_wing_added"),      "EventBus missing air_wing_added")
	assert(EventBus.has_signal("air_wing_updated"),    "EventBus missing air_wing_updated")
	assert(EventBus.has_signal("air_wing_removed"),    "EventBus missing air_wing_removed")
	assert(EventBus.has_signal("air_wing_selected"),   "EventBus missing air_wing_selected")
	assert(EventBus.has_signal("air_wing_deselected"), "EventBus missing air_wing_deselected")


func _test_gamestate_apply_wing_updates() -> void:
	GameState.air_wings.clear()

	var added_ids: Array = []
	EventBus.air_wing_added.connect(func(id: String) -> void: added_ids.append(id))

	# New wing stored and signal fires
	GameState._apply_air_wing_updates({
		"wings": [{
			"wing_id": "test-wing-1", "nation_id": "germany",
			"aircraft_type": "fighter", "count": 10, "combat_readiness": 1.0,
			"position_lng": 13.4, "position_lat": 52.5, "heading_deg": 0.0,
			"lifecycle_state": "transit", "mission": "interception",
			"target_id": "", "home_airbase_province_id": "berlin", "weapon_ready": true,
		}]
	})
	assert(GameState.air_wings.has("test-wing-1"),  "wing must be stored in air_wings")
	assert(added_ids.has("test-wing-1"),            "air_wing_added must fire on new wing")

	# Same id → updated, not added again
	var updated_ids: Array = []
	EventBus.air_wing_updated.connect(func(id: String) -> void: updated_ids.append(id))
	GameState._apply_air_wing_updates({
		"wings": [{
			"wing_id": "test-wing-1", "nation_id": "germany",
			"aircraft_type": "fighter", "count": 8, "combat_readiness": 0.9,
			"position_lng": 13.5, "position_lat": 52.5, "heading_deg": 0.0,
			"lifecycle_state": "transit", "mission": "interception",
			"target_id": "", "home_airbase_province_id": "berlin", "weapon_ready": true,
		}]
	})
	assert(not updated_ids.is_empty(),                         "air_wing_updated must fire on re-apply")
	assert(added_ids.size() == 1,                              "air_wing_added must NOT fire again on update")
	assert(GameState.air_wings["test-wing-1"]["count"] == 8,   "count must update to 8")

	# Destroy removes and signals
	var removed_ids: Array = []
	EventBus.air_wing_removed.connect(func(id: String) -> void: removed_ids.append(id))
	GameState._apply_air_wing_destroyed({"wing_id": "test-wing-1"})
	assert(not GameState.air_wings.has("test-wing-1"), "wing must be removed after destroy")
	assert(removed_ids.has("test-wing-1"),             "air_wing_removed must fire")

	# Empty wing_id is a no-op (must not crash)
	GameState._apply_air_wing_updates({"wings": [{"wing_id": ""}]})

	# get_air_wing returns {} for unknown id
	assert(GameState.get_air_wing("nonexistent").is_empty(),
		"get_air_wing must return {} for unknown id")

	GameState.air_wings.clear()
