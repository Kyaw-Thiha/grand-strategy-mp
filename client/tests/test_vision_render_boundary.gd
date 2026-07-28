extends Node
## Verifies combined-mask composition, source lifecycle, and fog/marker ordering.

const VisionRenderLayers := preload("res://src/systems/map/vision_render_layers.gd")
const VisionSystemScript := preload("res://src/systems/map/vision_system.gd")

var _failures: int = 0


class FakeMapLoader extends Node:
	var province_nodes: Dictionary = {}
	var province_data: Dictionary = {}

	func get_map_bounds() -> Rect2:
		return Rect2(Vector2(-512.0, -384.0), Vector2(1024.0, 768.0))

	func project_lng_lat(lng: float, lat: float) -> Vector2:
		return Vector2(lng * 100.0, lat * 100.0)

	func get_all_province_ids() -> Array[String]:
		var ids: Array[String] = []
		for province_id: String in province_data:
			ids.append(province_id)
		return ids

	func get_province_node(province_id: String) -> Node2D:
		return province_nodes.get(province_id, null) as Node2D

	func get_province_data(province_id: String) -> Dictionary:
		return province_data.get(province_id, {})

	func get_province_focus_position(_province_id: String) -> Vector2:
		return Vector2.INF

	func add_province(
			province_id: String,
			nation_id: String,
			position: Vector2,
			include_extra_fill: bool = false
	) -> void:
		var province := Node2D.new()
		province.name = province_id
		province.position = position
		add_child(province)

		var fill := Polygon2D.new()
		fill.name = "Fill"
		fill.polygon = PackedVector2Array([
			Vector2(-30.0, -20.0),
			Vector2(30.0, -20.0),
			Vector2(30.0, 20.0),
			Vector2(-30.0, 20.0),
		])
		province.add_child(fill)

		if include_extra_fill:
			var extra_fill := Polygon2D.new()
			extra_fill.name = "FillPart01"
			extra_fill.polygon = PackedVector2Array([
				Vector2(40.0, -10.0),
				Vector2(60.0, -10.0),
				Vector2(60.0, 10.0),
				Vector2(40.0, 10.0),
			])
			province.add_child(extra_fill)

		var city_marker := Polygon2D.new()
		city_marker.name = "CityMarker"
		city_marker.polygon = PackedVector2Array([
			Vector2(-2.0, -2.0), Vector2(2.0, -2.0), Vector2.ZERO,
		])
		province.add_child(city_marker)
		province_nodes[province_id] = province
		province_data[province_id] = {"nation_id": nation_id}


func _ready() -> void:
	await _test_combined_mask_rendering()
	_test_province_polygon_sources()
	_test_friendly_territory_rules()
	_test_unit_stamp_lifecycle()
	_test_render_order_boundary()
	_test_selected_only_division_ranges()
	await get_tree().process_frame
	if _failures == 0:
		print("=== test_vision_render_boundary: all passed ===")
		get_tree().quit(0)
	else:
		push_error("test_vision_render_boundary: %d failure(s)" % _failures)
		get_tree().quit(1)


func _check(condition: bool, message: String) -> void:
	if not condition:
		_failures += 1
		push_error("FAIL: " + message)


## Renders one and then two colocated reveal stamps and checks normalized composition.
func _test_combined_mask_rendering() -> void:
	var vision: Node = _create_vision()
	_check(vision._mask_viewport != null, "VisionSystem must create one mask viewport")
	_check(vision._fog_overlay != null, "VisionSystem must create one fog overlay")
	_check(
		not _contains_point_light(vision),
		"Combined-mask vision must not create PointLight2D nodes"
	)
	var mask_size: Vector2i = vision._mask_viewport.size
	_check(
		maxi(mask_size.x, mask_size.y) <= vision.MAX_MASK_DIMENSION,
		"Mask longest dimension must respect the configured cap"
	)

	var center_world := Vector2.ZERO
	var first_stamp: Sprite2D = vision._spawn_mask_stamp(center_world, 90.0, 1.0)
	_check(first_stamp.modulate.r <= 1.0, "Reveal stamp strength must be normalized")
	_check(
		first_stamp.modulate.g == 0.0,
		"Division reveal must write only to the unit mask channel"
	)
	await _wait_for_mask_render()
	var first_value: float = _read_mask_channel(vision, center_world, 0)

	var second_stamp: Sprite2D = vision._spawn_mask_stamp(center_world, 90.0, 1.0)
	_check(second_stamp.modulate.r <= 1.0, "Overlapping stamp strength must be normalized")
	await _wait_for_mask_render()
	var overlap_value: float = _read_mask_channel(vision, center_world, 0)
	if first_value >= 0.0 and overlap_value >= 0.0:
		_check(first_value > 0.90 and first_value <= 1.0, "One full reveal stamp must approach 1.0")
		_check(overlap_value >= first_value, "Overlapping stamps must not reduce visibility")
		_check(overlap_value <= 1.0, "Overlapping stamps must remain clamped to 1.0")

	var province_polygon := Polygon2D.new()
	var center_mask: Vector2 = vision._world_to_mask_position(center_world)
	province_polygon.polygon = PackedVector2Array([
		center_mask + Vector2(-20.0, -20.0),
		center_mask + Vector2(20.0, -20.0),
		center_mask + Vector2(20.0, 20.0),
		center_mask + Vector2(-20.0, 20.0),
	])
	province_polygon.color = vision.PROVINCE_MASK_COLOR
	province_polygon.material = vision._mask_stamp_material
	vision._mask_source_root.add_child(province_polygon)
	vision._request_mask_render()
	await _wait_for_mask_render()
	var province_value: float = _read_mask_channel(vision, center_world, 1)
	if province_value >= 0.0:
		_check(
			province_value > 0.90 and province_value <= 1.0,
			"Solid province geometry must render full visibility in its mask channel"
		)

	var fog_material: ShaderMaterial = vision._fog_overlay.material as ShaderMaterial
	_check(fog_material != null, "Fog overlay must use its mask shader")
	if fog_material != null:
		_check(
			"blend_mul" in fog_material.shader.code,
			"Fog must multiply cartography rather than add illumination"
		)
		_check(
			"max(unit_visibility, province_visibility_with_feather)"
				in fog_material.shader.code,
			"Fog shader must union unit and province visibility without adding brightness"
		)
		_check(
			"max(\n\t\tsolid_province_visibility" in fog_material.shader.code,
			"Province feather must preserve full visibility inside the exact polygon"
		)
	vision.free()


## Confirms exact multipart fill geometry is copied while non-fill polygons are ignored.
func _test_province_polygon_sources() -> void:
	var loader := FakeMapLoader.new()
	add_child(loader)
	loader.add_province("multipart", "local", Vector2(75.0, -30.0), true)
	var vision: Node = VisionSystemScript.new()
	add_child(vision)
	vision.setup(loader)
	vision._spawn_province_mask_polygons("multipart")

	_check(
		vision._friendly_province_polygons.size() == 2,
		"Every Fill and FillPart must become a province mask polygon"
	)
	for mask_polygon: Polygon2D in vision._friendly_province_polygons:
		_check(
			mask_polygon.color == vision.PROVINCE_MASK_COLOR,
			"Province polygons must write only to the province mask channel"
		)
		_check(
			mask_polygon.polygon.size() >= 3,
			"Copied province mask geometry must remain drawable"
		)

	var first_polygon: Polygon2D = vision._friendly_province_polygons[0]
	var expected_world_vertex := Vector2(45.0, -50.0)
	_check(
		first_polygon.polygon[0].is_equal_approx(
			vision._world_to_mask_position(expected_world_vertex)
		),
		"Province fill vertices must retain their world transform in mask space"
	)
	vision.free()
	loader.free()


## Confirms own/allied territory is visible, neutral territory is not, and only local
## divisions receive moving stamps.
func _test_friendly_territory_rules() -> void:
	var saved_user_id: String = AuthManager.user_id
	var saved_nations: Dictionary = GameState.nations
	var saved_provinces: Dictionary = GameState.provinces
	var saved_relations: Dictionary = GameState.relations
	var saved_divisions: Dictionary = GameState.divisions

	AuthManager.user_id = "vision-user"
	GameState.nations = {"local": {"player_id": "vision-user"}}
	GameState.provinces = {
		"owned": {"owner_id": "local"},
		"allied": {"owner_id": "ally"},
		"neutral": {"owner_id": "neutral"},
		"runtime_owner": {"owner_id": "local", "nation_id": "neutral"},
	}
	GameState.relations = {"local:ally": {"stance": "alliance"}}
	GameState.divisions = {
		"local-division": {
			"nation_id": "local",
			"position_lng": 0.0,
			"position_lat": 0.0,
			"observation_radius": 90.0,
		},
		"allied-division": {
			"nation_id": "ally",
			"position_lng": 2.0,
			"position_lat": 0.0,
			"observation_radius": 90.0,
		},
	}

	var loader := FakeMapLoader.new()
	add_child(loader)
	loader.add_province("owned", "neutral", Vector2(-200.0, 0.0))
	loader.add_province("allied", "neutral", Vector2(-100.0, 0.0), true)
	loader.add_province("neutral", "neutral", Vector2(100.0, 0.0))
	loader.add_province("runtime_owner", "neutral", Vector2(200.0, 0.0))
	var vision: Node = VisionSystemScript.new()
	add_child(vision)
	vision.setup(loader)
	vision.on_map_loaded(4)

	_check(vision.is_province_visible("owned"), "Locally owned province must be visible")
	_check(vision.is_province_visible("allied"), "Allied province must be visible")
	_check(not vision.is_province_visible("neutral"), "Neutral province must remain fogged")
	_check(
		vision.is_province_visible("runtime_owner"),
		"Runtime owner_id must override stale static and nation_id ownership"
	)
	_check(
		vision._friendly_province_polygons.size() == 4,
		"Friendly territory must render every exact fill part and no neutral geometry"
	)
	_check(
		vision._unit_stamps_by_division_id.size() == 1
			and vision._unit_stamps_by_division_id.has("local-division"),
		"Allied divisions must not contribute shared unit vision"
	)

	GameState.relations.clear()
	EventBus.relation_changed.emit("local", "ally")
	_check(
		not vision.is_province_visible("allied"),
		"Ending an alliance must restore full fog on former allied territory immediately"
	)
	_check(
		vision._friendly_province_polygons.size() == 2,
		"Former allied polygon sources must be removed in the same refresh"
	)

	vision.free()
	loader.free()
	AuthManager.user_id = saved_user_id
	GameState.nations = saved_nations
	GameState.provinces = saved_provinces
	GameState.relations = saved_relations
	GameState.divisions = saved_divisions


## Confirms moving a division reuses one keyed stamp and removal clears every cache.
func _test_unit_stamp_lifecycle() -> void:
	var vision: Node = _create_vision()
	var stamp: Sprite2D = vision._spawn_mask_stamp(Vector2(10.0, 20.0), 90.0, 1.0)
	vision._unit_stamps_by_division_id["division-test"] = stamp
	vision._unit_mask_positions_by_division_id["division-test"] = Vector2(10.0, 20.0)
	vision._unit_mask_radii_by_division_id["division-test"] = 90.0
	var original_instance_id: int = stamp.get_instance_id()
	var original_revision: int = vision._mask_revision

	vision.update_division_mask_position("division-test", Vector2(30.0, 40.0))
	_check(
		stamp.get_instance_id() == original_instance_id,
		"Position updates must reuse the existing division stamp"
	)
	_check(
		stamp.position.is_equal_approx(vision._world_to_mask_position(Vector2(30.0, 40.0))),
		"Position updates must move the stamp in mask space"
	)
	_check(vision._mask_revision > original_revision, "A moved stamp must dirty the mask")

	var stable_revision: int = vision._mask_revision
	vision.update_division_mask_position("division-test", Vector2(30.0, 40.0))
	_check(
		vision._mask_revision == stable_revision,
		"An unchanged position must not schedule another mask render"
	)

	vision._remove_unit_stamp("division-test")
	_check(
		not vision._unit_stamps_by_division_id.has("division-test"),
		"Removed division must leave no keyed stamp"
	)
	_check(
		not vision._unit_mask_positions_by_division_id.has("division-test"),
		"Removed division must leave no cached position"
	)
	_check(
		not vision._unit_mask_radii_by_division_id.has("division-test"),
		"Removed division must leave no cached radius"
	)
	vision.free()


func _test_render_order_boundary() -> void:
	var vision: Node = _create_vision()
	var marker_layer := Node2D.new()
	VisionRenderLayers.configure_world_marker_layer(marker_layer)
	_check(
		vision._fog_overlay.z_index == VisionRenderLayers.FOG_OVERLAY_Z,
		"Fog overlay must use the shared fog draw level"
	)
	_check(
		VisionRenderLayers.CARTOGRAPHY_MAX_Z < vision._fog_overlay.z_index,
		"Fog must render above all cartography"
	)
	_check(
		marker_layer.z_index > vision._fog_overlay.z_index,
		"Gameplay marker roots must render above fog"
	)
	marker_layer.free()
	vision.free()


func _test_selected_only_division_ranges() -> void:
	var file := FileAccess.open(
		"res://src/systems/military/division_icon.gd", FileAccess.READ
	)
	_check(file != null, "Division icon source must be readable")
	if file == null:
		return
	var source: String = file.get_as_text()
	file.close()
	_check(
		"if is_selected:" in source,
		"Division ranges must be guarded by selected state"
	)
	_check(
		"draw_circle(Vector2.ZERO, scouting_radius_px" not in source,
		"Scouting range must not be a permanent filled disc"
	)
	_check(
		"draw_circle(Vector2.ZERO, observation_radius_px" not in source,
		"Observation range must not be a permanent filled disc"
	)


func _create_vision() -> Node:
	var loader := FakeMapLoader.new()
	add_child(loader)
	var vision: Node = VisionSystemScript.new()
	add_child(vision)
	vision.setup(loader)
	return vision


func _contains_point_light(node: Node) -> bool:
	if node is PointLight2D:
		return true
	for child: Node in node.get_children():
		if _contains_point_light(child):
			return true
	return false


func _wait_for_mask_render() -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	await get_tree().process_frame


func _read_mask_channel(vision: Node, world_position: Vector2, channel: int) -> float:
	if DisplayServer.get_name() == "headless" \
			or OS.has_feature("headless") \
			or RenderingServer.get_current_rendering_driver_name() == "dummy":
		return -1.0
	var image: Image = vision._mask_viewport.get_texture().get_image()
	if image == null:
		# The headless dummy renderer exposes no render-target pixels. Structural mask
		# assertions still run; pixel sampling is covered when a rendering driver exists.
		return -1.0
	_check(not image.is_empty(), "Mask viewport must produce a readable image")
	if image.is_empty():
		return 0.0
	var mask_position: Vector2 = vision._world_to_mask_position(world_position)
	var pixel_x: int = clampi(roundi(mask_position.x), 0, image.get_width() - 1)
	var pixel_y: int = clampi(roundi(mask_position.y), 0, image.get_height() - 1)
	var pixel: Color = image.get_pixel(pixel_x, pixel_y)
	if channel == 1:
		return pixel.g
	return pixel.r
