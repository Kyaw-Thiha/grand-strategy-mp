extends Node

const GENERATED_MAP_PATH := "res://scenes/map/western_europe_6.scn"
const EXPECTED_COVER_COLOR := Color(0.76, 0.70, 0.50, 0.7)
const EXPECTED_ELEVATION_COLOR := Color(0.55, 0.70, 0.35, 0.7)

var _failed: bool = false


func _ready() -> void:
	var packed_scene: PackedScene = load(GENERATED_MAP_PATH)
	_assert_true(packed_scene != null, "generated map scene must load")
	if packed_scene == null:
		get_tree().quit(1)
		return

	var generated_map: Node = packed_scene.instantiate()
	add_child(generated_map)
	_check_overlay_mesh(generated_map, "CoverLayer", EXPECTED_COVER_COLOR)
	_check_overlay_mesh(generated_map, "ElevationLayer", EXPECTED_ELEVATION_COLOR)

	generated_map.queue_free()
	await get_tree().process_frame
	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return

	print("[PASS] test_generated_map_overlay_meshes: all tests passed")
	get_tree().quit(0)


## Verifies one generated overlay is a single valid, hidden, colored triangle mesh.
func _check_overlay_mesh(root: Node, layer_name: String, expected_color: Color) -> void:
	var layer: Node = root.get_node_or_null(layer_name)
	_assert_true(layer is MeshInstance2D, "%s must be a MeshInstance2D" % layer_name)
	if not layer is MeshInstance2D:
		return

	var mesh_instance: MeshInstance2D = layer
	_assert_true(not mesh_instance.visible, "%s must start hidden" % layer_name)
	_assert_true(mesh_instance.get_child_count() == 0, "%s must not contain polygon children" % layer_name)
	_assert_true(mesh_instance.mesh is ArrayMesh, "%s must contain an ArrayMesh" % layer_name)
	if not mesh_instance.mesh is ArrayMesh:
		return

	var overlay_mesh: ArrayMesh = mesh_instance.mesh
	_assert_true(overlay_mesh.get_surface_count() == 1, "%s must have one mesh surface" % layer_name)
	if overlay_mesh.get_surface_count() != 1:
		return

	var arrays: Array = overlay_mesh.surface_get_arrays(0)
	var vertices: Variant = arrays[Mesh.ARRAY_VERTEX]
	var colors: PackedColorArray = arrays[Mesh.ARRAY_COLOR]
	var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	_assert_true(vertices.size() > 0, "%s must contain vertices" % layer_name)
	_assert_true(vertices.size() == colors.size(), "%s vertex and color counts must match" % layer_name)
	_assert_true(indices.size() > 0, "%s must contain triangle indices" % layer_name)
	_assert_true(indices.size() % 3 == 0, "%s indices must form triangles" % layer_name)
	for index: int in indices:
		_assert_true(index >= 0 and index < vertices.size(), "%s index must reference a vertex" % layer_name)
	_assert_true(_colors_include(colors, expected_color), "%s must retain its expected palette" % layer_name)


func _colors_include(colors: PackedColorArray, expected: Color) -> bool:
	for color: Color in colors:
		if (
			absf(color.r - expected.r) < 0.005
			and absf(color.g - expected.g) < 0.005
			and absf(color.b - expected.b) < 0.005
			and absf(color.a - expected.a) < 0.005
		):
			return true
	return false


func _assert_true(value: bool, message: String) -> void:
	if value:
		return
	_failed = true
	push_error("ASSERT FAILED: " + message)
