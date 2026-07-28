extends Node

const MapRendererScript := preload("res://src/systems/map/map_renderer.gd")
const FRANCE_COLOR := Color(0.27, 0.51, 0.71)
const GERMANY_COLOR := Color(0.40, 0.40, 0.40)

var _failed: bool = false


class FakeMapLoader:
	extends Node

	var province_nodes: Dictionary = {}
	var province_data: Dictionary = {}

	func add_province(province_id: String, nation_id: String) -> Node2D:
		var province_node := Node2D.new()
		province_node.name = province_id

		var fill := Polygon2D.new()
		fill.name = "Fill"
		province_node.add_child(fill)

		var fill_part := Polygon2D.new()
		fill_part.name = "FillPart01"
		province_node.add_child(fill_part)

		province_nodes[province_id] = province_node
		province_data[province_id] = {"nation_id": nation_id}
		add_child(province_node)
		return province_node

	func get_all_province_ids() -> Array[String]:
		var result: Array[String] = []
		for province_id: String in province_nodes.keys():
			result.append(province_id)
		return result

	func get_province_node(province_id: String) -> Node2D:
		return province_nodes.get(province_id) as Node2D

	func get_province_data(province_id: String) -> Dictionary:
		return province_data.get(province_id, {})

	func get_adjacency() -> Array:
		return []


class FakeProvinceDataSource:
	extends RefCounted

	var provinces: Dictionary = {}
	var read_count: int = 0

	func get_province(province_id: String) -> Dictionary:
		read_count += 1
		return provinces.get(province_id, {})


func _ready() -> void:
	var map_loader := FakeMapLoader.new()
	map_loader.name = "MapLoader"
	add_child(map_loader)
	map_loader.add_child(_make_layer("CoverLayer"))
	map_loader.add_child(_make_layer("ElevationLayer"))
	var first_province: Node2D = map_loader.add_province("first", "france")
	var second_province: Node2D = map_loader.add_province("second", "germany")

	var data_source := FakeProvinceDataSource.new()
	data_source.provinces = {
		"first": {"nation_id": "france"},
		"second": {"nation_id": "germany"},
	}

	var renderer: Node = MapRendererScript.new()
	add_child(renderer)
	renderer.setup(map_loader, data_source)
	renderer.on_map_loaded(2)

	_assert_fill_color(first_province, FRANCE_COLOR, "initial load must color every first-province fill")
	_assert_fill_color(second_province, GERMANY_COLOR, "initial load must color every second-province fill")
	_assert_layer_state(
		map_loader,
		true,
		MapRendererScript.POLITICAL_COVER_ALPHA,
		true,
		MapRendererScript.POLITICAL_ELEVATION_ALPHA,
		"initial political mode"
	)

	data_source.read_count = 0
	renderer.set_overlay_mode("cover")
	_assert_layer_state(
		map_loader,
		true,
		MapRendererScript.POLITICAL_COVER_ALPHA,
		true,
		MapRendererScript.POLITICAL_ELEVATION_ALPHA,
		"cover transition start"
	)
	_assert_eq(data_source.read_count, 0, "cover mode must not reread province data")
	_assert_fill_color(first_province, FRANCE_COLOR, "cover mode must preserve political fills")
	await get_tree().create_timer(MapRendererScript.OVERLAY_TRANSITION_SECONDS * 0.5).timeout
	await get_tree().process_frame
	var cover_mid_alpha: float = _layer_alpha(map_loader, "CoverLayer")
	var elevation_mid_alpha: float = _layer_alpha(map_loader, "ElevationLayer")
	_assert_true(
		cover_mid_alpha > MapRendererScript.POLITICAL_COVER_ALPHA and cover_mid_alpha < 1.0,
		"cover alpha must be intermediate during the crossfade (actual=%s)" % cover_mid_alpha
	)
	_assert_true(
		elevation_mid_alpha > 0.0
			and elevation_mid_alpha < MapRendererScript.POLITICAL_ELEVATION_ALPHA,
		"elevation alpha must be intermediate during the crossfade (actual=%s)"
			% elevation_mid_alpha
	)
	await _wait_for_transition()
	_assert_layer_state(map_loader, true, 1.0, false, 0.0, "completed cover mode")

	renderer.highlight_province("first")
	_assert_false(
		(first_province.get_node("Fill") as Polygon2D).color.is_equal_approx(FRANCE_COLOR),
		"highlight must alter the selected fill before switching"
	)
	renderer.set_overlay_mode("elevation")
	_assert_true(
		(map_loader.get_node("CoverLayer") as Node2D).visible
			and (map_loader.get_node("ElevationLayer") as Node2D).visible,
		"both meshes must remain visible while crossfading to elevation"
	)
	_assert_eq(data_source.read_count, 0, "elevation mode must not reread province data")
	_assert_fill_color(first_province, FRANCE_COLOR, "switching modes must restore highlighted fills")
	await _wait_for_transition()
	_assert_layer_state(map_loader, false, 0.0, true, 1.0, "completed elevation mode")

	data_source.provinces["first"] = {"nation_id": "germany"}
	renderer.update_province_owner("first", "germany")
	_assert_eq(data_source.read_count, 1, "ownership updates must read only the affected province")
	_assert_fill_color(first_province, GERMANY_COLOR, "ownership updates must refresh the political fill")
	_assert_fill_color(second_province, GERMANY_COLOR, "ownership updates must leave other fills unchanged")

	renderer.highlight_province("first")
	var highlighted_color: Color = (first_province.get_node("Fill") as Polygon2D).color
	renderer.set_overlay_mode("elevation")
	renderer.set_overlay_mode("unsupported")
	_assert_true(
		(first_province.get_node("Fill") as Polygon2D).color.is_equal_approx(highlighted_color),
		"active and unsupported mode requests must be no-ops"
	)

	renderer.clear_highlights()
	renderer.set_overlay_mode("cover")
	await get_tree().create_timer(MapRendererScript.OVERLAY_TRANSITION_SECONDS * 0.5).timeout
	await get_tree().process_frame
	var interrupted_cover_alpha: float = _layer_alpha(map_loader, "CoverLayer")
	var interrupted_elevation_alpha: float = _layer_alpha(map_loader, "ElevationLayer")
	renderer.set_overlay_mode("elevation")
	_assert_true(
		is_equal_approx(_layer_alpha(map_loader, "CoverLayer"), interrupted_cover_alpha),
		"interrupting a transition must retain the current cover alpha"
	)
	_assert_true(
		is_equal_approx(_layer_alpha(map_loader, "ElevationLayer"), interrupted_elevation_alpha),
		"interrupting a transition must retain the current elevation alpha"
	)
	await _wait_for_transition()
	_assert_layer_state(
		map_loader, false, 0.0, true, 1.0, "interrupted transition final state"
	)

	renderer.set_overlay_mode("political")
	await _wait_for_transition()
	_assert_layer_state(
		map_loader,
		true,
		MapRendererScript.POLITICAL_COVER_ALPHA,
		true,
		MapRendererScript.POLITICAL_ELEVATION_ALPHA,
		"political mode"
	)
	_assert_eq(data_source.read_count, 1, "returning to political mode must not reread province data")

	map_loader.queue_free()
	renderer.queue_free()
	await get_tree().process_frame
	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return

	print("[PASS] test_map_renderer_overlay_switch: all tests passed")
	get_tree().quit(0)


func _wait_for_transition() -> void:
	await get_tree().create_timer(MapRendererScript.OVERLAY_TRANSITION_SECONDS + 0.05).timeout


func _make_layer(layer_name: String) -> Node2D:
	var layer := Node2D.new()
	layer.name = layer_name
	layer.visible = false
	return layer


func _layer_alpha(map_loader: Node, layer_name: String) -> float:
	return (map_loader.get_node(layer_name) as Node2D).self_modulate.a


func _assert_fill_color(province_node: Node2D, expected: Color, message: String) -> void:
	for child: Node in province_node.get_children():
		if child is Polygon2D:
			_assert_true((child as Polygon2D).color.is_equal_approx(expected), message)


func _assert_layer_state(
		map_loader: Node,
		cover_visible: bool,
		cover_alpha: float,
		elevation_visible: bool,
		elevation_alpha: float,
		context: String
) -> void:
	var cover_layer := map_loader.get_node("CoverLayer") as Node2D
	var elevation_layer := map_loader.get_node("ElevationLayer") as Node2D
	_assert_eq(
		cover_layer.visible,
		cover_visible,
		"%s must set cover visibility" % context
	)
	_assert_eq(
		elevation_layer.visible,
		elevation_visible,
		"%s must set elevation visibility" % context
	)
	_assert_true(
		is_equal_approx(cover_layer.self_modulate.a, cover_alpha),
		"%s must set cover alpha (actual=%s expected=%s)" % [
			context, cover_layer.self_modulate.a, cover_alpha
		]
	)
	_assert_true(
		is_equal_approx(elevation_layer.self_modulate.a, elevation_alpha),
		"%s must set elevation alpha (actual=%s expected=%s)" % [
			context, elevation_layer.self_modulate.a, elevation_alpha
		]
	)


func _assert_false(value: bool, message: String) -> void:
	_assert_true(not value, message)


func _assert_eq(actual: Variant, expected: Variant, message: String) -> void:
	_assert_true(actual == expected, "%s (actual=%s expected=%s)" % [message, actual, expected])


func _assert_true(value: bool, message: String) -> void:
	if value:
		return
	_failed = true
	push_error("ASSERT FAILED: " + message)
