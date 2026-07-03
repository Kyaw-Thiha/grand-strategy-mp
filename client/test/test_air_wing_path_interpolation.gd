extends Node


class StubMapLoader:
	extends Node

	func project_lng_lat(lng: float, lat: float) -> Vector2:
		return Vector2(lng, lat)


var _failed: bool = false


func _ready() -> void:
	GameState.air_wings.clear()

	var air_layer: Node2D = Node2D.new()
	var map_loader: Node = StubMapLoader.new()
	var air_system: Node = preload("res://src/systems/air/air_wing_system.gd").new()
	air_system.setup(map_loader, air_layer)

	GameState._apply_air_wing_updates({
		"wings": [{
			"wing_id": "test-wing-1",
			"nation_id": "germany",
			"aircraft_type": "fighter",
			"count": 10,
			"combat_readiness": 1.0,
			"position_lng": 0.0,
			"position_lat": 0.0,
			"heading_deg": 0.0,
			"lifecycle_state": "transit",
			"mission": "interception",
			"target_id": "",
			"home_airbase_province_id": "berlin",
			"weapon_ready": true,
			"path_gen_id": "path-1",
			"path_elapsed_ms": 25,
		}]
	})
	air_system.call("_select", "test-wing-1")

	_assert_true(air_system.get("_icons").has("test-wing-1"), "air wing icon must be created")

	var path_a: Dictionary = _make_straight_path("test-wing-1", "path-1", Vector2(0.0, 0.0), Vector2(10.0, 0.0))
	EventBus.air_wing_path.emit(path_a)
	_assert_vec2_eq(_get_icon(air_system).position, Vector2(2.5, 0.0), "path elapsed time must interpolate along path A")

	GameState._apply_air_wing_updates({
		"wings": [{
			"wing_id": "test-wing-1",
			"nation_id": "germany",
			"aircraft_type": "fighter",
			"count": 10,
			"combat_readiness": 1.0,
			"position_lng": 0.0,
			"position_lat": 0.0,
			"heading_deg": 0.0,
			"lifecycle_state": "transit",
			"mission": "interception",
			"target_id": "",
			"home_airbase_province_id": "berlin",
			"weapon_ready": true,
			"path_gen_id": "path-2",
			"path_elapsed_ms": 25,
		}]
	})

	var path_b: Dictionary = _make_straight_path("test-wing-1", "path-2", Vector2(0.0, 0.0), Vector2(0.0, 10.0))
	EventBus.air_wing_path.emit(path_b)
	_assert_vec2_eq(_get_icon(air_system).position, Vector2(0.0, 2.5), "newer path generation must replace the visible position")
	_assert_eq(air_system.call("_get_selected_wing_path_points"), [Vector2(0.0, 0.0), Vector2(0.0, 10.0)], "newer path generation must replace the visible preview route")

	EventBus.air_wing_path.emit(path_a)
	_assert_vec2_eq(_get_icon(air_system).position, Vector2(0.0, 2.5), "stale path_gen_id must not overwrite the newer path")
	_assert_eq(air_system.call("_get_selected_wing_path_points"), [Vector2(0.0, 0.0), Vector2(0.0, 10.0)], "stale path_gen_id must not overwrite the visible preview route")

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return

	air_system.call("cleanup")
	air_system.free()
	air_layer.free()
	map_loader.free()
	GameState.air_wings.clear()

	print("[PASS] test_air_wing_path_interpolation: all tests passed")
	get_tree().quit(0)


func _get_icon(air_system: Node) -> Node2D:
	return air_system.get("_icons").get("test-wing-1") as Node2D


func _make_straight_path(wing_id: String, path_gen_id: String, start: Vector2, end: Vector2) -> Dictionary:
	return {
		"wing_id": wing_id,
		"path_gen_id": path_gen_id,
		"path_type": "dubins",
		"segments": [{
			"type": "straight",
			"length_deg": start.distance_to(end),
			"start_lng": start.x,
			"start_lat": start.y,
			"end_lng": end.x,
			"end_lat": end.y,
			"heading_compass_deg": 90.0,
		}],
		"total_length_deg": start.distance_to(end),
		"start_lng": start.x,
		"start_lat": start.y,
		"start_heading_compass_deg": 90.0,
		"end_lng": end.x,
		"end_lat": end.y,
		"end_heading_compass_deg": 90.0,
		"turn_radius_deg": 0.5,
		"speed_deg_per_ms": 0.1,
	}


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


func _assert_vec2_eq(actual: Vector2, expected: Vector2, message: String) -> void:
	if actual.is_equal_approx(expected):
		return
	_failed = true
	push_error("ASSERT VEC2 FAILED: %s actual=%s expected=%s" % [message, str(actual), str(expected)])
