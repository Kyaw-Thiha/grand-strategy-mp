extends "res://src/systems/air/air_wing_system.gd"


class StubMapLoader:
	extends Node

	func project_lng_lat(lng: float, lat: float) -> Vector2:
		return Vector2(lng, lat)

	func world_to_lng_lat(world_pos: Vector2) -> Vector2:
		return Vector2(world_pos.x + 1.0, world_pos.y + 2.0)


var _failed: bool = false
var submitted_commands: Array = []


func _submit_air_command(type: String, payload: Dictionary) -> void:
	submitted_commands.append({
		"type": type,
		"payload": payload.duplicate(true),
	})


func _ready() -> void:
	GameState.air_wings.clear()
	GameState.provinces.clear()
	GameState.nations.clear()
	AuthManager.user_id = "debug_player"
	GameState.nations["germany"] = {"player_id": "debug_player", "is_ready": true}
	GameState.air_wings["wing-1"] = {
		"wing_id": "wing-1",
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
	GameState.provinces["berlin"] = {"owner_id": "germany"}
	GameState.provinces["paris"] = {"owner_id": "france"}

	var air_layer: Node2D = Node2D.new()
	var map_loader: Node = StubMapLoader.new()
	setup(map_loader, air_layer)
	call("_select", "wing-1")

	var right_click: InputEventMouseButton = _make_right_click_event(false)
	_assert_true(handle_mouse_input(right_click, Vector2(100.0, 200.0)), "empty-space right-click must be handled")
	_assert_eq(submitted_commands.size(), 1, "empty-space right-click must submit one command")
	_assert_eq(submitted_commands[0].get("type", ""), "SUBMIT_AIR_WING_MOVE", "empty-space right-click must submit a transit order")
	_assert_eq(submitted_commands[0].get("payload", {}), {
		"wing_id": "wing-1",
		"target_lng": 101.0,
		"target_lat": 202.0,
	}, "transit payload must include wing and clicked position")

	submitted_commands.clear()
	_assert_true(handle_mouse_input(right_click, Vector2(120.0, 220.0), "berlin"), "friendly-province right-click must be handled")
	_assert_eq(submitted_commands.size(), 1, "friendly-province right-click must submit one command")
	_assert_eq(submitted_commands[0].get("type", ""), "REDEPLOY_WING", "friendly-province right-click must submit redeploy")
	_assert_eq(submitted_commands[0].get("payload", {}), {
		"wing_id": "wing-1",
		"new_province_id": "berlin",
	}, "redeploy payload must include wing and province")

	cleanup()
	air_layer.free()
	map_loader.free()

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return

	print("[PASS] test_air_wing_command_submission: all tests passed")
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
