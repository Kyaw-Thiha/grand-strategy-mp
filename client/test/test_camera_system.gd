extends Node


class StubMapLoader:
	extends Node

	func get_map_bounds() -> Rect2:
		return Rect2(-1000.0, -1000.0, 2000.0, 2000.0)


var _failed: bool = false
var _right_clicks: Array[Dictionary] = []
var _camera: Camera2D
var _camera_system: Node


func _ready() -> void:
	_camera = Camera2D.new()
	_camera_system = Node.new()
	_camera_system.set_script(load("res://src/systems/map/camera_system.gd"))
	var map_loader: StubMapLoader = StubMapLoader.new()
	add_child(_camera)
	add_child(map_loader)
	add_child(_camera_system)
	_camera_system.set_process(false)
	_camera_system.setup(_camera, map_loader)
	_camera_system.right_click_requested.connect(
		func(screen_position: Vector2, shift_pressed: bool) -> void:
			_right_clicks.append({
				"screen_position": screen_position,
				"shift_pressed": shift_pressed,
			})
	)
	_camera_system.call("_process", 0.0)

	_test_stationary_right_click()
	_test_grab_drag_and_zoom_scaling()
	_test_drag_clamps_to_bounds()
	_test_blocked_and_cancelled_gestures()
	await _test_cursor_anchored_wheel_zoom()
	await _test_keyboard_speed_curve()
	_test_idle_processing_does_not_edge_scroll()

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return

	print("[PASS] test_camera_system: all tests passed")
	get_tree().quit(0)


func _test_stationary_right_click() -> void:
	_camera.position = Vector2.ZERO
	_camera.zoom = Vector2.ONE
	_camera_system.call("_input", _make_right_button(Vector2(100.0, 100.0), true))
	_camera_system.call(
		"_input",
		_make_right_motion(Vector2(105.0, 100.0), Vector2(5.0, 0.0))
	)
	_camera_system.call(
		"_input",
		_make_right_button(Vector2(105.0, 100.0), false, true)
	)

	_assert_vector_close(
		_camera.position,
		Vector2.ZERO,
		"sub-threshold right movement must not pan"
	)
	_assert_eq(_right_clicks.size(), 1, "sub-threshold release must emit one gameplay click")
	if _right_clicks.size() == 1:
		_assert_eq(
			_right_clicks[0].get("screen_position", Vector2.ZERO),
			Vector2(105.0, 100.0),
			"gameplay click must use the release position"
		)
		_assert_eq(
			_right_clicks[0].get("shift_pressed", false),
			true,
			"gameplay click must preserve Shift"
		)


func _test_grab_drag_and_zoom_scaling() -> void:
	var click_count_before_drag: int = _right_clicks.size()
	_camera.position = Vector2.ZERO
	_camera.zoom = Vector2(2.0, 2.0)
	_camera_system.call("_input", _make_right_button(Vector2(100.0, 100.0), true))
	_camera_system.call(
		"_input",
		_make_right_motion(Vector2(112.0, 100.0), Vector2(12.0, 0.0))
	)
	_camera_system.call("_input", _make_right_button(Vector2(112.0, 100.0), false))

	_assert_vector_close(
		_camera.position,
		Vector2(-6.0, 0.0),
		"dragging right must pull the map right by moving the camera left"
	)
	_assert_eq(
		_right_clicks.size(),
		click_count_before_drag,
		"a completed drag must suppress gameplay right-clicks"
	)


func _test_drag_clamps_to_bounds() -> void:
	_camera.position = Vector2(998.0, 0.0)
	_camera.zoom = Vector2.ONE
	_camera_system.call("_input", _make_right_button(Vector2(100.0, 100.0), true))
	_camera_system.call(
		"_input",
		_make_right_motion(Vector2(80.0, 100.0), Vector2(-20.0, 0.0))
	)
	_camera_system.call("_input", _make_right_button(Vector2(80.0, 100.0), false))

	_assert_vector_close(
		_camera.position,
		Vector2(1000.0, 0.0),
		"drag panning must remain clamped to map bounds"
	)


func _test_blocked_and_cancelled_gestures() -> void:
	var click_count_before_blocked_input: int = _right_clicks.size()
	_camera.position = Vector2.ZERO
	_camera_system.call("_on_ui_pointer_blocking_changed", true)
	_camera_system.call("_input", _make_right_button(Vector2(100.0, 100.0), true))
	_camera_system.call(
		"_input",
		_make_right_motion(Vector2(120.0, 100.0), Vector2(20.0, 0.0))
	)
	_camera_system.call("_input", _make_right_button(Vector2(120.0, 100.0), false))
	_camera_system.call("_on_ui_pointer_blocking_changed", false)

	_assert_vector_close(_camera.position, Vector2.ZERO, "UI-blocked input must not pan")
	_assert_eq(
		_right_clicks.size(),
		click_count_before_blocked_input,
		"UI-blocked input must not emit gameplay clicks"
	)

	_camera_system.call("_input", _make_right_button(Vector2(100.0, 100.0), true))
	_camera_system.call(
		"_input",
		_make_right_motion(Vector2(120.0, 100.0), Vector2(20.0, 0.0))
	)
	_camera_system.set_player_input_enabled(false)
	_camera_system.call("_input", _make_right_button(Vector2(120.0, 100.0), false))
	_camera_system.set_player_input_enabled(true)
	_assert_eq(
		_right_clicks.size(),
		click_count_before_blocked_input,
		"disabling camera input must cancel an active gesture without a click"
	)


func _test_cursor_anchored_wheel_zoom() -> void:
	_reset_camera(Vector2(100.0, -50.0), 1.0)
	await get_tree().process_frame
	var viewport_center: Vector2 = get_viewport().get_visible_rect().get_center()
	var cursor_position: Vector2 = viewport_center + Vector2(200.0, 100.0)
	var anchored_world_position: Vector2 = _world_at_screen(cursor_position)

	_camera_system.call(
		"_unhandled_input",
		_make_wheel_event(MOUSE_BUTTON_WHEEL_UP, cursor_position)
	)
	_camera_system.call("_process", 1.0 / 60.0)
	_assert_vector_close(
		_world_at_screen(cursor_position),
		anchored_world_position,
		"partial wheel zoom-in must preserve the world point beneath the cursor"
	)
	_assert_true(
		_camera.zoom.x > 1.0 and _camera.zoom.x < 1.15,
		"wheel zoom-in must retain smooth interpolation"
	)

	for _frame: int in range(120):
		_camera_system.call("_process", 1.0 / 60.0)
	_assert_vector_close(
		_world_at_screen(cursor_position),
		anchored_world_position,
		"completed wheel zoom-in must preserve the world point beneath the cursor"
	)
	_assert_float_close(_camera.zoom.x, 1.15, "wheel zoom-in must reach its existing target")

	_reset_camera(Vector2(100.0, -50.0), 1.5)
	var zoom_out_anchor_world: Vector2 = _world_at_screen(cursor_position)
	_camera_system.call(
		"_unhandled_input",
		_make_wheel_event(MOUSE_BUTTON_WHEEL_DOWN, cursor_position)
	)
	_camera_system.call("_process", 1.0 / 60.0)
	_assert_vector_close(
		_world_at_screen(cursor_position),
		zoom_out_anchor_world,
		"partial wheel zoom-out must preserve the world point beneath the cursor"
	)
	_assert_true(
		_camera.zoom.x < 1.5 and _camera.zoom.x > 1.35,
		"wheel zoom-out must retain smooth interpolation"
	)

	for _frame: int in range(120):
		_camera_system.call("_process", 1.0 / 60.0)
	_assert_vector_close(
		_world_at_screen(cursor_position),
		zoom_out_anchor_world,
		"completed wheel zoom-out must preserve the world point beneath the cursor"
	)
	_assert_float_close(_camera.zoom.x, 1.35, "wheel zoom-out must reach its existing target")

	_reset_camera(Vector2.ZERO, 1.0)
	var first_cursor: Vector2 = viewport_center + Vector2(-180.0, 40.0)
	_camera_system.call(
		"_unhandled_input",
		_make_wheel_event(MOUSE_BUTTON_WHEEL_UP, first_cursor)
	)
	_camera_system.call("_process", 1.0 / 60.0)
	var second_cursor: Vector2 = viewport_center + Vector2(220.0, -80.0)
	var second_anchor_world: Vector2 = _world_at_screen(second_cursor)
	_camera_system.call(
		"_unhandled_input",
		_make_wheel_event(MOUSE_BUTTON_WHEEL_UP, second_cursor)
	)
	_camera_system.call("_process", 1.0 / 60.0)
	_assert_vector_close(
		_world_at_screen(second_cursor),
		second_anchor_world,
		"repeated wheel zoom-in must refresh the cursor anchor"
	)

	_reset_camera(Vector2(240.0, -120.0), 1.0)
	var centered_position_before_zoom: Vector2 = _camera.position
	_camera_system.call(
		"_unhandled_input",
		_make_wheel_event(MOUSE_BUTTON_WHEEL_UP, viewport_center)
	)
	_camera_system.call("_process", 1.0 / 60.0)
	_assert_vector_close(
		_camera.position,
		centered_position_before_zoom,
		"wheel zoom-in at viewport center must not move the camera"
	)

	_reset_camera(Vector2(998.0, 0.0), 1.0)
	_camera_system.call(
		"_unhandled_input",
		_make_wheel_event(
			MOUSE_BUTTON_WHEEL_UP,
			viewport_center + Vector2(400.0, 0.0)
		)
	)
	_camera_system.call("_process", 0.125)
	_assert_float_close(
		_camera.position.x,
		1000.0,
		"map bounds must take precedence over cursor anchoring"
	)

	_camera_system.call(
		"_unhandled_input",
		_make_wheel_event(MOUSE_BUTTON_WHEEL_UP, cursor_position)
	)
	_camera_system.set_zoom(2.0)
	_assert_false(
		bool(_camera_system.get("_zoom_anchor_active")),
		"programmatic zoom must clear cursor anchoring"
	)

	_camera_system.call(
		"_unhandled_input",
		_make_wheel_event(MOUSE_BUTTON_WHEEL_UP, cursor_position)
	)
	var keyboard_zoom: InputEventKey = _make_key_event(KEY_EQUAL, true)
	keyboard_zoom.ctrl_pressed = true
	_camera_system.call("_unhandled_input", keyboard_zoom)
	_assert_false(
		bool(_camera_system.get("_zoom_anchor_active")),
		"keyboard zoom must clear cursor anchoring"
	)

	_camera_system.call(
		"_unhandled_input",
		_make_wheel_event(MOUSE_BUTTON_WHEEL_UP, cursor_position)
	)
	_camera_system.call("_input", _make_right_button(Vector2(100.0, 100.0), true))
	_camera_system.call(
		"_input",
		_make_right_motion(Vector2(112.0, 100.0), Vector2(12.0, 0.0))
	)
	_assert_false(
		bool(_camera_system.get("_zoom_anchor_active")),
		"right-drag panning must clear cursor anchoring"
	)
	_camera_system.call("_input", _make_right_button(Vector2(112.0, 100.0), false))

	_camera_system.call(
		"_unhandled_input",
		_make_wheel_event(MOUSE_BUTTON_WHEEL_UP, cursor_position)
	)
	Input.parse_input_event(_make_key_event(KEY_D, true))
	await get_tree().process_frame
	_camera_system.call("_handle_movement", 1.0 / 60.0)
	_assert_false(
		bool(_camera_system.get("_zoom_anchor_active")),
		"keyboard panning must clear cursor anchoring"
	)
	Input.parse_input_event(_make_key_event(KEY_D, false))
	await get_tree().process_frame
	_camera_system.call("_handle_movement", 0.0)


func _test_keyboard_speed_curve() -> void:
	_reset_camera(Vector2.ZERO, 1.0)
	Input.parse_input_event(_make_key_event(KEY_D, true))
	await get_tree().process_frame

	const FRAME_DELTA: float = 1.0 / 60.0
	_camera_system.call("_handle_movement", FRAME_DELTA)
	_assert_float_close(
		float(_camera_system.get("_move_speed")),
		360.0,
		"keyboard movement must begin at the gentle acceleration rate"
	)

	for _frame: int in range(120):
		_camera_system.call("_handle_movement", FRAME_DELTA)
	_assert_float_close(
		float(_camera_system.get("_move_speed")),
		900.0,
		"keyboard movement must stop accelerating at the new cap"
	)

	Input.parse_input_event(_make_key_event(KEY_D, false))
	await get_tree().process_frame
	_camera_system.call("_handle_movement", FRAME_DELTA)
	_assert_float_close(
		float(_camera_system.get("_move_speed")),
		0.0,
		"keyboard movement must stop immediately on release"
	)


func _test_idle_processing_does_not_edge_scroll() -> void:
	_camera.position = Vector2(200.0, 200.0)
	_camera_system.call("_handle_movement", 1.0)
	_assert_vector_close(
		_camera.position,
		Vector2(200.0, 200.0),
		"idle camera processing must not move based on cursor position"
	)


func _make_right_button(
	position: Vector2,
	pressed: bool,
	shift_pressed: bool = false
) -> InputEventMouseButton:
	var event: InputEventMouseButton = InputEventMouseButton.new()
	event.button_index = MOUSE_BUTTON_RIGHT
	event.position = position
	event.pressed = pressed
	event.shift_pressed = shift_pressed
	return event


func _make_right_motion(
	position: Vector2,
	relative: Vector2
) -> InputEventMouseMotion:
	var event: InputEventMouseMotion = InputEventMouseMotion.new()
	event.position = position
	event.relative = relative
	event.button_mask = MOUSE_BUTTON_MASK_RIGHT
	return event


func _make_wheel_event(
	button_index: MouseButton,
	position: Vector2
) -> InputEventMouseButton:
	var event: InputEventMouseButton = InputEventMouseButton.new()
	event.button_index = button_index
	event.position = position
	event.pressed = true
	return event


func _make_key_event(keycode: Key, pressed: bool) -> InputEventKey:
	var event: InputEventKey = InputEventKey.new()
	event.keycode = keycode
	event.physical_keycode = keycode
	event.pressed = pressed
	return event


func _reset_camera(position: Vector2, zoom_level: float) -> void:
	_camera_system.set_zoom(zoom_level)
	_camera.position = position
	_camera.zoom = Vector2(zoom_level, zoom_level)


func _world_at_screen(screen_position: Vector2) -> Vector2:
	var viewport_center: Vector2 = get_viewport().get_visible_rect().get_center()
	return _camera.position + (screen_position - viewport_center) / _camera.zoom.x


func _assert_true(value: bool, message: String) -> void:
	if value:
		return
	_failed = true
	push_error("ASSERT TRUE FAILED: " + message)


func _assert_false(value: bool, message: String) -> void:
	if not value:
		return
	_failed = true
	push_error("ASSERT FALSE FAILED: " + message)


func _assert_eq(actual: Variant, expected: Variant, message: String) -> void:
	if actual == expected:
		return
	_failed = true
	push_error("ASSERT EQ FAILED: %s actual=%s expected=%s" % [message, str(actual), str(expected)])


func _assert_float_close(actual: float, expected: float, message: String) -> void:
	if is_equal_approx(actual, expected):
		return
	_failed = true
	push_error(
		"ASSERT FLOAT CLOSE FAILED: %s actual=%s expected=%s"
		% [message, str(actual), str(expected)]
	)


func _assert_vector_close(actual: Vector2, expected: Vector2, message: String) -> void:
	if actual.is_equal_approx(expected):
		return
	_failed = true
	push_error(
		"ASSERT VECTOR CLOSE FAILED: %s actual=%s expected=%s"
		% [message, str(actual), str(expected)]
	)
