extends Node


class StubMapLoader:
	extends Node

	func project_lng_lat(lng: float, lat: float) -> Vector2:
		return Vector2(lng, lat)


var _failed: bool = false


func _ready() -> void:
	GameState.air_wings.clear()
	GameState.air_wings["test-wing-1"] = {
		"wing_id": "test-wing-1",
		"nation_id": "germany",
		"aircraft_type": "fighter",
		"count": 10,
		"combat_readiness": 1.0,
		"position_lng": 13.4,
		"position_lat": 52.5,
		"heading_deg": 0.0,
		"lifecycle_state": "transit",
		"mission": "interception",
		"target_id": "",
		"home_airbase_province_id": "berlin",
		"weapon_ready": true,
	}
	GameState.air_wings["test-wing-2"] = {
		"wing_id": "test-wing-2",
		"nation_id": "germany",
		"aircraft_type": "fighter",
		"count": 10,
		"combat_readiness": 1.0,
		"position_lng": 15.0,
		"position_lat": 54.0,
		"heading_deg": 0.0,
		"lifecycle_state": "transit",
		"mission": "interception",
		"target_id": "",
		"home_airbase_province_id": "berlin",
		"weapon_ready": true,
	}

	var air_layer: Node2D = Node2D.new()
	var map_loader: Node = StubMapLoader.new()

	var air_system: Node = preload("res://src/systems/air/air_wing_system.gd").new()
	var cached_path: Dictionary = {
		"wing_id": "test-wing-1",
		"segments": [
			{
				"start_lng": 13.4,
				"start_lat": 52.5,
				"end_lng": 14.0,
				"end_lat": 53.0,
			}
		],
	}
	air_system.call("_on_air_wing_path", cached_path)
	air_system.call("_select", "test-wing-1")
	air_system.setup(map_loader, air_layer)

	_assert_true(air_layer.get_child_count() > 0, "AirWingSystem must attach a preview overlay to the air layer")
	_assert_true(air_system.get("_pending_route_overlay").get("start_node") != null, "setup must refresh the selected wing preview")
	_assert_eq(air_system.call("_get_selected_wing_path_points"), [Vector2(13.4, 52.5), Vector2(14.0, 53.0)], "cached route must stay available for the selected wing")

	_assert_true(air_system.has_method("_append_pending_milestone"), "AirWingSystem missing _append_pending_milestone()")
	_assert_true(air_system.has_method("_remove_last_pending_milestone"), "AirWingSystem missing _remove_last_pending_milestone()")
	_assert_true(air_system.has_method("_clear_pending"), "AirWingSystem missing _clear_pending()")

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return

	var first_right_click: InputEventMouseButton = _make_right_click_event(true)
	_assert_true(air_system.handle_mouse_input(first_right_click, Vector2(10.0, 10.0)), "shift-right-click must be handled")
	_assert_eq(air_system.get("_pending_milestones").size(), 1, "shift-right-click must append a pending milestone")
	_assert_eq(air_system.get("_pending_chain").size(), 1, "shift-right-click must extend the pending chain")
	_assert_true(air_system.get("_shift_chain_started"), "shift-chain flag must turn on after appending milestones")
	_assert_eq(air_system.get("_pending_route_overlay").get("_milestones").size(), 1, "overlay must show one ghost marker")
	_assert_eq(air_system.get("_pending_route_overlay").get("_chain").size(), 1, "overlay must show one route point")

	var second_right_click: InputEventMouseButton = _make_right_click_event(true)
	_assert_true(air_system.handle_mouse_input(second_right_click, Vector2(20.0, 20.0)), "second shift-right-click must be handled")
	_assert_eq(air_system.get("_pending_milestones").size(), 2, "shift-right-click must append again")
	_assert_eq(air_system.get("_pending_chain").size(), 2, "shift-right-click must keep the chain in sync")
	_assert_eq(air_system.get("_pending_route_overlay").get("_milestones").size(), 2, "overlay must show two ghost markers")
	_assert_eq(air_system.get("_pending_route_overlay").get("_chain").size(), 2, "overlay must show two route points")

	var plain_right_click: InputEventMouseButton = _make_right_click_event(false)
	_assert_true(air_system.handle_mouse_input(plain_right_click, Vector2(20.0, 20.0)), "right-click must be handled when pending state exists")
	_assert_eq(air_system.get("_pending_milestones").size(), 1, "right-click must remove the most recent pending milestone")
	_assert_eq(air_system.get("_pending_chain").size(), 1, "right-click must shrink the pending chain")
	_assert_eq(air_system.get("_pending_route_overlay").get("_milestones").size(), 1, "overlay must remove the last ghost marker")
	_assert_eq(air_system.get("_pending_route_overlay").get("_chain").size(), 1, "overlay must shrink with the chain")

	_assert_true(air_system.handle_mouse_input(plain_right_click, Vector2(10.0, 10.0)), "right-click near the last ghost must clear the last pending milestone")
	_assert_eq(air_system.get("_pending_milestones"), [], "clear must empty milestones")
	_assert_eq(air_system.get("_pending_chain"), [], "clear must empty pending chain")
	_assert_true(not air_system.get("_shift_chain_started"), "clear must reset shift-chain flag")
	_assert_eq(air_system.get("_pending_route_overlay").get("_milestones").size(), 0, "overlay must clear ghost markers")
	_assert_eq(air_system.get("_pending_route_overlay").get("_chain").size(), 2, "overlay must preserve the cached wing route after clearing the edit chain")

	air_system.call("_select", "test-wing-2")
	_assert_eq(air_system.get("_pending_milestones"), [], "switching wings must clear the previous preview state")
	_assert_true(not air_system.get("_shift_chain_started"), "switching wings must reset the shift-chain flag")
	_assert_eq(air_system.get("_pending_route_overlay").get("_milestones").size(), 0, "switching wings must clear ghost markers")

	air_system.call("cleanup")
	air_system.free()
	air_layer.free()
	map_loader.free()

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return

	print("[PASS] test_air_wing_preview_state: all tests passed")
	get_tree().quit(0)


func _assert_true(value: bool, message: String) -> void:
	if value:
		return
	_failed = true
	push_error("ASSERT TRUE FAILED: " + message)


func _assert_eq(actual: Variant, expected: Variant, message: String) -> void:
	if actual == expected:
		return
	_failed = true
	push_error("ASSERT EQ FAILED: %s actual=%s expected=%s" % [message, str(actual), str(expected)])


func _make_right_click_event(shift_pressed: bool) -> InputEventMouseButton:
	var event: InputEventMouseButton = InputEventMouseButton.new()
	event.button_index = MOUSE_BUTTON_RIGHT
	event.pressed = true
	event.shift_pressed = shift_pressed
	return event
