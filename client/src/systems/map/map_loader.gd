extends Node
## Loads a processed map from client/assets/data/<map_id>/ and instances
## the generated static scene from client/scenes/map/<map_id>.scn.
## Only place in the codebase that converts lng/lat to Godot screen space.

signal map_loaded(province_count: int)
signal map_load_failed(error: String)

const MAP_CANVAS_WIDTH := 4096.0
const MAP_CANVAS_HEIGHT := 3000.0
const GENERATED_SCENE_ROOT := "res://scenes/map"

var _map_id: String = ""
var _bounds: Dictionary = {}
var _provinces: Dictionary = {}       # province_id → Node2D
var _province_data: Dictionary = {}   # province_id → Dictionary (raw JSON data)
var _province_click_areas: Dictionary = {} # province_id → Array[Area2D]
var _adjacency: Array = []
var _terrain_lookup: Dictionary = {}
var _waypoints: Dictionary = {}    # { nodes: [], edges: [], road_connections: [] }

var _proj_center: Vector2 = Vector2.ZERO
var _scale: float = 1.0


func load_map(map_id: String) -> void:
	_clear_loaded_map()
	_map_id = map_id
	var data_root := "res://assets/data/%s" % map_id

	var map_data_raw: Variant = _load_json("%s/map_data.json" % data_root)
	if not map_data_raw is Dictionary:
		map_load_failed.emit("Failed to load map_data.json for '%s'" % map_id)
		return
	var map_data: Dictionary = map_data_raw

	_bounds = map_data.get("bounds", {})
	_adjacency = map_data.get("adjacency", [])
	_setup_projection()

	var terrain_raw: Variant = _load_json("%s/terrain_lookup.json" % data_root)
	if terrain_raw is Dictionary:
		_terrain_lookup = terrain_raw

	for province_data_variant: Variant in map_data.get("provinces", []):
		if not province_data_variant is Dictionary:
			continue
		var province_data: Dictionary = province_data_variant
		var pid: String = province_data.get("province_id", "")
		if pid.is_empty():
			continue
		_province_data[pid] = province_data

	if not _load_generated_scene(map_id):
		return

	# Load waypoint graph (Phase 4A) — non-fatal if not yet generated
	var wp_raw: Variant = _load_json("%s/waypoints.json" % data_root)
	if wp_raw is Dictionary:
		_waypoints = wp_raw
	else:
		push_warning("MapLoader: waypoints.json missing — run pipeline to generate it")

	map_loaded.emit(_provinces.size())


func get_province_node(province_id: String) -> Node2D:
	return _provinces.get(province_id)


func get_province_data(province_id: String) -> Dictionary:
	return _province_data.get(province_id, {})


## Returns generated province click areas for the interaction system.
## Parameters:
## - province_id: processed map province identifier.
## Returns: Area2D nodes whose metadata points at the province.
func get_province_click_areas(province_id: String) -> Array[Area2D]:
	var result: Array[Area2D] = []
	for area: Area2D in _province_click_areas.get(province_id, []):
		result.append(area)
	return result


## Returns the preferred world-space camera focus point for a province.
## Parameters:
## - province_id: processed map province identifier.
## Returns: projected city position when available, otherwise Vector2.INF.
func get_province_focus_position(province_id: String) -> Vector2:
	var province_data: Dictionary = get_province_data(province_id)
	var city_position: Array = province_data.get("city_position", [])
	if city_position.size() < 2:
		return Vector2.INF
	return project_lng_lat(float(city_position[0]), float(city_position[1]))


func get_all_province_ids() -> Array[String]:
	var ids: Array[String] = []
	for k in _province_data.keys():
		ids.append(k)
	return ids


func get_adjacency() -> Array:
	return _adjacency


func get_terrain_lookup() -> Dictionary:
	return _terrain_lookup

func get_waypoint_graph() -> Dictionary:
	return _waypoints

## Converts WGS84 (lng, lat) to Godot screen-space Vector2.
## Public wrapper around the internal Mercator projection.
func project_lng_lat(lng: float, lat: float) -> Vector2:
	return _project(lng, lat)


## Inverse of project_lng_lat. Returns [lng, lat] for a world-space pixel position.
func world_to_lng_lat(world_pos: Vector2) -> Vector2:
	if _scale == 0.0:
		return Vector2.ZERO
	var raw_x: float = world_pos.x / _scale + _proj_center.x
	var raw_y: float = -world_pos.y / _scale + _proj_center.y
	var lng: float = raw_x * 180.0 / PI
	var lat: float = (atan(exp(raw_y)) - PI / 4.0) * 360.0 / PI
	return Vector2(lng, lat)


func get_map_bounds() -> Rect2:
	if _bounds.is_empty():
		return Rect2()
	var tl := _project(_bounds.get("min_lng", 0.0), _bounds.get("max_lat", 0.0))
	var br := _project(_bounds.get("max_lng", 0.0), _bounds.get("min_lat", 0.0))
	return Rect2(tl, br - tl)


# ── projection ────────────────────────────────────────────────────────────────

func _setup_projection() -> void:
	var cx: float = (_bounds.get("min_lng", 0.0) + _bounds.get("max_lng", 0.0)) * 0.5
	var cy: float = (_bounds.get("min_lat", 0.0) + _bounds.get("max_lat", 0.0)) * 0.5
	_proj_center = _mercator_raw(cx, cy)

	var tl := _mercator_raw(_bounds.get("min_lng", 0.0), _bounds.get("max_lat", 0.0))
	var br := _mercator_raw(_bounds.get("max_lng", 0.0), _bounds.get("min_lat", 0.0))
	var raw_w: float = abs(br.x - tl.x)
	var raw_h: float = abs(br.y - tl.y)
	_scale = min(MAP_CANVAS_WIDTH / raw_w, MAP_CANVAS_HEIGHT / raw_h)


func _mercator_raw(lng: float, lat: float) -> Vector2:
	var x := lng * PI / 180.0
	var y := log(tan(PI / 4.0 + lat * PI / 360.0))
	return Vector2(x, y)


func _project(lng: float, lat: float) -> Vector2:
	var raw := _mercator_raw(lng, lat)
	return Vector2(
		(raw.x - _proj_center.x) * _scale,
		-(raw.y - _proj_center.y) * _scale
	)


# ── generated scene loading ───────────────────────────────────────────────────

## Clears loaded map scene nodes and indexed lookup data.
## Parameters: none.
## Returns: nothing.
func _clear_loaded_map() -> void:
	for child: Node in get_children():
		remove_child(child)
		child.queue_free()
	_provinces.clear()
	_province_data.clear()
	_province_click_areas.clear()
	_bounds.clear()
	_adjacency.clear()
	_terrain_lookup.clear()
	_waypoints.clear()


## Instances the generated static map scene and indexes its runtime nodes.
## Parameters:
## - map_id: processed map identifier.
## Returns: true when scene load and indexing succeeded.
func _load_generated_scene(map_id: String) -> bool:
	var scene_path: String = "%s/%s.scn" % [GENERATED_SCENE_ROOT, map_id]
	if not ResourceLoader.exists(scene_path):
		map_load_failed.emit("Generated map scene is missing: %s" % scene_path)
		return false

	var resource: Resource = ResourceLoader.load(scene_path)
	if not resource is PackedScene:
		map_load_failed.emit("Generated map scene is not a PackedScene: %s" % scene_path)
		return false

	var packed_scene: PackedScene = resource
	var generated_root: Node = packed_scene.instantiate()
	if generated_root == null:
		map_load_failed.emit("Failed to instance generated map scene: %s" % scene_path)
		return false

	_adopt_generated_scene_children(generated_root)
	generated_root.free()

	if not _index_generated_provinces():
		return false
	if not _index_generated_click_areas():
		return false
	return true


## Moves generated scene layers under this loader so existing systems keep using direct child paths.
## Parameters:
## - generated_root: root node instanced from the generated map scene.
## Returns: nothing.
func _adopt_generated_scene_children(generated_root: Node) -> void:
	while generated_root.get_child_count() > 0:
		var child: Node = generated_root.get_child(0)
		generated_root.remove_child(child)
		_clear_scene_owner_recursive(child)
		add_child(child)


## Clears PackedScene owner links before moving generated nodes under the runtime loader.
## Parameters:
## - node: generated node being adopted into the active scene tree.
## Returns: nothing.
func _clear_scene_owner_recursive(node: Node) -> void:
	node.owner = null
	for child: Node in node.get_children():
		_clear_scene_owner_recursive(child)


## Indexes generated province nodes by province id.
## Parameters: none.
## Returns: true when the generated Provinces layer exists.
func _index_generated_provinces() -> bool:
	var province_container: Node = get_node_or_null("Provinces")
	if province_container == null:
		map_load_failed.emit("Generated map scene is missing Provinces")
		return false

	for province_id: String in _province_data.keys():
		var province_node: Node2D = province_container.get_node_or_null(province_id)
		if province_node == null:
			push_warning("MapLoader: generated scene is missing province node: %s" % province_id)
			continue
		_provinces[province_id] = province_node

	return true


## Indexes generated collision areas by province id for interaction.
## Parameters: none.
## Returns: true when the generated CollisionLayer exists.
func _index_generated_click_areas() -> bool:
	var collision_layer: CanvasItem = get_node_or_null("CollisionLayer")
	if collision_layer == null:
		map_load_failed.emit("Generated map scene is missing CollisionLayer")
		return false

	collision_layer.visible = true
	for child: Node in collision_layer.get_children():
		if not child is Area2D:
			continue
		var area: Area2D = child
		var province_id: String = area.get_meta("province_id", "")
		if province_id.is_empty():
			push_warning("MapLoader: generated collision area missing province_id: %s" % area.name)
			continue
		area.input_pickable = true
		_hide_collision_debug_shapes(area)
		if not _province_click_areas.has(province_id):
			_province_click_areas[province_id] = []
		_province_click_areas[province_id].append(area)

	return true


## Hides generated collision polygons from normal/debug rendering while keeping Area2D input active.
## Parameters:
## - area: generated province click area.
## Returns: nothing.
func _hide_collision_debug_shapes(area: Area2D) -> void:
	for child: Node in area.get_children():
		if child is CanvasItem:
			var canvas_item: CanvasItem = child
			canvas_item.visible = false


# ── helpers ───────────────────────────────────────────────────────────────────

func _load_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		push_warning("MapLoader: file not found — %s" % path)
		return {}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_warning("MapLoader: cannot open — %s" % path)
		return {}
	var text := file.get_as_text()
	file.close()
	var result: Variant = JSON.parse_string(text)
	if result == null:
		push_warning("MapLoader: JSON parse error — %s" % path)
		return null
	return result
