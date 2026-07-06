extends Node


class StubAirWingSystem:
	extends Node

	var calls: Array = []

	func handle_mouse_input(event: InputEvent, world_pos: Vector2, hovered_province_id: String = "") -> bool:
		calls.append({
			"button_index": event.button_index if event is InputEventMouseButton else -1,
			"pressed": event.pressed if event is InputEventMouseButton else false,
			"world_pos": world_pos,
			"hovered_province_id": hovered_province_id,
		})
		return true


class StubMapLoader:
	extends Node

	func get_province_focus_position(province_id: String) -> Vector2:
		if province_id == "paris":
			return Vector2(123.0, 456.0)
		return Vector2.INF

	func get_province_node(_province_id: String) -> Node2D:
		return null


var _failed: bool = false


func _ready() -> void:
	var map_debug: Node = Node.new()
	map_debug.set_script(load("res://src/debug/map_debug.gd"))
	var air_stub: StubAirWingSystem = StubAirWingSystem.new()
	var map_loader: StubMapLoader = StubMapLoader.new()
	map_debug.set("_air_wing_system", air_stub)
	map_debug.set("_map_loader", map_loader)

	map_debug.call("_on_province_right_clicked", "paris")

	_assert_true(air_stub.calls.size() == 1, "province right click must forward to the air system")
	if air_stub.calls.size() == 1:
		var call_data: Dictionary = air_stub.calls[0]
		_assert_eq(call_data.get("button_index", -1), MOUSE_BUTTON_RIGHT, "forwarded click must be a right-click")
		_assert_eq(call_data.get("pressed", false), true, "forwarded click must be pressed")
		_assert_eq(call_data.get("world_pos", Vector2.ZERO), Vector2(123.0, 456.0), "forwarded click must use province focus position")
		_assert_eq(call_data.get("hovered_province_id", ""), "paris", "forwarded click must preserve province id")

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
