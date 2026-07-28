extends Node


class StubAirWingSystem:
	extends Node

	var calls: Array = []
	var consume_input: bool = true

	func handle_mouse_input(event: InputEvent, world_pos: Vector2, hovered_province_id: String = "") -> bool:
		calls.append({
			"button_index": event.button_index if event is InputEventMouseButton else -1,
			"pressed": event.pressed if event is InputEventMouseButton else false,
			"world_pos": world_pos,
			"hovered_province_id": hovered_province_id,
			"shift_pressed": event.shift_pressed if event is InputEventMouseButton else false,
		})
		return consume_input


class StubMilitarySystem:
	extends Node

	var calls: Array = []

	func handle_mouse_input(event: InputEvent, world_pos: Vector2) -> bool:
		calls.append({
			"button_index": event.button_index if event is InputEventMouseButton else -1,
			"pressed": event.pressed if event is InputEventMouseButton else false,
			"world_pos": world_pos,
			"shift_pressed": event.shift_pressed if event is InputEventMouseButton else false,
		})
		return true


var _failed: bool = false


func _ready() -> void:
	var map_debug: Node = Node.new()
	map_debug.set_script(load("res://src/debug/map_debug.gd"))
	var air_stub: StubAirWingSystem = StubAirWingSystem.new()
	var military_stub: StubMilitarySystem = StubMilitarySystem.new()
	map_debug.set("_air_wing_system", air_stub)
	map_debug.set("_military_system", military_stub)

	var right_click: InputEventMouseButton = InputEventMouseButton.new()
	right_click.button_index = MOUSE_BUTTON_RIGHT
	right_click.pressed = true
	right_click.position = Vector2(12.0, 34.0)
	right_click.shift_pressed = true
	map_debug.call(
		"_dispatch_gameplay_right_click",
		right_click,
		Vector2(123.0, 456.0),
		"paris"
	)

	_assert_true(air_stub.calls.size() == 1, "classified right-click must reach the air system")
	if air_stub.calls.size() == 1:
		var call_data: Dictionary = air_stub.calls[0]
		_assert_eq(call_data.get("button_index", -1), MOUSE_BUTTON_RIGHT, "forwarded click must be a right-click")
		_assert_eq(call_data.get("pressed", false), true, "forwarded click must be pressed")
		_assert_eq(call_data.get("world_pos", Vector2.ZERO), Vector2(123.0, 456.0), "forwarded click must use its world position")
		_assert_eq(call_data.get("hovered_province_id", ""), "paris", "forwarded click must preserve province id")
		_assert_eq(call_data.get("shift_pressed", false), true, "forwarded click must preserve Shift")
	_assert_true(military_stub.calls.is_empty(), "air-consumed right-click must not reach military")

	air_stub.consume_input = false
	map_debug.call(
		"_dispatch_gameplay_right_click",
		right_click,
		Vector2(321.0, 654.0),
		""
	)
	_assert_eq(military_stub.calls.size(), 1, "unconsumed right-click must fall through to military")
	if military_stub.calls.size() == 1:
		var military_call: Dictionary = military_stub.calls[0]
		_assert_eq(military_call.get("world_pos", Vector2.ZERO), Vector2(321.0, 654.0), "military fallback must preserve world position")
		_assert_eq(military_call.get("shift_pressed", false), true, "military fallback must preserve Shift")

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return

	print("[PASS] test_map_debug_air_wing_right_click: all tests passed")
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
