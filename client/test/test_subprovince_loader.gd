extends Node
## Headless test for the MapLoader subprovince loading, lookups, and the shared
## MapProjection (bake-time/runtime parity snapshot).

const MAP_ID := "western_europe_6"
const EXPECTED_SUBPROVINCE_COUNT := 6140

var _failed: bool = false
var _loaded: bool = false
var _load_error: String = ""
var _fail_flag: bool = false


func _ready() -> void:
	await _test_projection_snapshot()
	await _test_projection_roundtrip()
	await _test_subprovince_loading()
	await _test_fail_path()

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return
	print("[PASS] test_subprovince_loader: all tests passed")
	get_tree().quit(0)


func _on_map_loaded(_count: int) -> void:
	_loaded = true


func _on_map_load_failed(error: String) -> void:
	_load_error = error
	_fail_flag = true


func _assert_true(condition: bool, message: String) -> void:
	if not condition:
		_failed = true
		push_error("ASSERT FAILED: %s" % message)


func _test_projection_snapshot() -> void:
	# Hardcoded snapshot computed with the reference Mercator math against the real map
	# bounds (min -12.3..22 lng, 33..59.9 lat). Any drift in the shared helper breaks this.
	var projection := MapProjection.new({
		"min_lng": -12.3, "max_lng": 22.0, "min_lat": 33.0, "max_lat": 59.9,
	})
	_check_point(projection, 0.0, 50.0, Vector2(-361.362119, -397.249832))
	_check_point(projection, -5.0, 45.0, Vector2(-733.900386, 154.769506))
	_check_point(projection, 10.0, 55.0, Vector2(383.714415, -1010.066888))


func _check_point(projection: MapProjection, lng: float, lat: float, expected: Vector2) -> void:
	var actual: Vector2 = projection.project(lng, lat)
	_assert_true(
		actual.distance_to(expected) < 0.05,
		"projection snapshot: project(%f,%f) = %s expected %s" % [lng, lat, actual, expected]
	)


func _test_projection_roundtrip() -> void:
	var projection := MapProjection.new({
		"min_lng": -12.3, "max_lng": 22.0, "min_lat": 33.0, "max_lat": 59.9,
	})
	var world: Vector2 = projection.project(2.37, 49.47)
	var back: Vector2 = projection.unproject(world)
	_assert_true(
		absf(back.x - 2.37) < 1e-3 and absf(back.y - 49.47) < 1e-3,
		"projection roundtrip: %s -> %s" % [world, back]
	)


func _test_subprovince_loading() -> void:
	_loaded = false
	_load_error = ""
	var loader := MapLoader.new()
	add_child(loader)
	loader.map_loaded.connect(_on_map_loaded)
	loader.map_load_failed.connect(_on_map_load_failed)
	loader.load_map(MAP_ID)
	if not _loaded:
		_assert_true(false, "map_loaded must fire for %s (error: %s)" % [MAP_ID, _load_error])
		loader.queue_free()
		await get_tree().process_frame
		return

	_assert_true(loader.get_subprovince_count() == EXPECTED_SUBPROVINCE_COUNT,
		"expected %d subprovinces, got %d" % [EXPECTED_SUBPROVINCE_COUNT, loader.get_subprovince_count()])

	# Known cell metadata
	var sample: Dictionary = loader.get_subprovince_data("we6_germany_01_sp_1")
	_assert_true(not sample.is_empty(), "get_subprovince_data must return data for we6_germany_01_sp_1")
	if not sample.is_empty():
		_assert_true(sample.get("province_id", "") == "we6_germany_01", "cell province_id")
		_assert_true(sample.has("kind"), "cell must expose kind")

	# Province reverse-lookup grouping (malta generated exactly 3 cells)
	var malta_ids: PackedStringArray = loader.get_province_subprovince_ids("we6_malta_01")
	_assert_true(malta_ids.size() == 3, "malta must have 3 subprovinces, got %d" % malta_ids.size())

	# Projected polygon falls inside the map world bounds
	var polygon: PackedVector2Array = loader.get_subprovince_polygon("we6_germany_01_sp_1")
	_assert_true(polygon.size() >= 4, "subprovince polygon must have a projected ring")
	if polygon.size() >= 4:
		var map_bounds: Rect2 = loader.get_map_bounds()
		for point: Vector2 in polygon:
			_assert_true(map_bounds.grow(8.0).has_point(point),
				"subprovince point %s outside map bounds %s" % [point, map_bounds])

	# Neighbors exist and all resolve to known cells
	var neighbors: PackedStringArray = loader.get_subprovince_neighbors("we6_germany_01_sp_1")
	_assert_true(neighbors.size() > 0, "cell must have neighbors")
	for neighbor: String in neighbors:
		_assert_true(not loader.get_subprovince_data(neighbor).is_empty(),
			"neighbor %s must be a known subprovince" % neighbor)

	# germany_01 adjacency never references unknown cells
	var all_known := true
	for sid: String in loader.get_province_subprovince_ids("we6_germany_01"):
		for neighbor: String in loader.get_subprovince_neighbors(sid):
			if loader.get_subprovince_data(neighbor).is_empty():
				all_known = false
	_assert_true(all_known, "germany_01 adjacency must reference known cells")

	loader.queue_free()
	await get_tree().process_frame


func _test_fail_path() -> void:
	_fail_flag = false
	var loader := MapLoader.new()
	add_child(loader)
	loader.map_load_failed.connect(_on_map_load_failed)
	# Point the loader at a data_root with no subprovince assets: must fail-clear, not warn.
	var result: bool = loader._load_subprovince_data("res://assets/data/does_not_exist_map")
	_assert_true(not result, "_load_subprovince_data must return false for missing assets")
	loader.queue_free()
	await get_tree().process_frame