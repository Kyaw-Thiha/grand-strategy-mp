extends Node


var _failed: bool = false


func _ready() -> void:
	_assert_true(EventBus.has_signal("air_wing_path"), "EventBus missing air_wing_path")
	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return

	var observed_payloads: Array = []
	EventBus.air_wing_path.connect(func(payload: Dictionary) -> void: observed_payloads.append(payload))

	var payload: Dictionary = {
		"wing_id": "test-wing-1",
		"path_gen_id": "path-1",
		"path_type": "dubins",
		"segments": [],
		"total_length_deg": 12.5,
		"start_lng": 0.0,
		"start_lat": 0.0,
		"start_heading_compass_deg": 90.0,
		"end_lng": 1.0,
		"end_lat": 1.0,
		"end_heading_compass_deg": 180.0,
		"turn_radius_deg": 0.5,
		"speed_deg_per_ms": 0.01,
	}

	SessionManager._on_server_event("AIR_WING_PATH", payload)

	_assert_true(not observed_payloads.is_empty(), "AIR_WING_PATH must emit EventBus.air_wing_path")
	_assert_true(observed_payloads[0] == payload, "AIR_WING_PATH must forward the payload unchanged")

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return

	print("[PASS] test_air_wing_path_bridge: all tests passed")
	get_tree().quit(0)


func _assert_true(value: bool, message: String) -> void:
	if value:
		return
	_failed = true
	push_error("ASSERT TRUE FAILED: " + message)
