@tool
extends EditorScript
## Generates a static map scene from processed map JSON assets.
## Run from the Godot editor after adjusting the exported paths if needed.

const CITY_DOT_RADIUS: float = 8.0
const PORT_DOT_RADIUS: float = 8.0

const NATION_PALETTE := {
	"france":          Color(0.27, 0.51, 0.71),
	"germany":         Color(0.40, 0.40, 0.40),
	"united_kingdom":  Color(0.65, 0.13, 0.18),
	"italy":           Color(0.00, 0.56, 0.29),
	"spain":           Color(0.83, 0.55, 0.00),
	"poland":          Color(0.80, 0.00, 0.12),
	"portugal":        Color(0.00, 0.47, 0.25),
	"netherlands":     Color(0.82, 0.41, 0.12),
	"belgium":         Color(0.07, 0.26, 0.58),
	"luxembourg":      Color(0.00, 0.50, 0.80),
	"switzerland":     Color(0.86, 0.08, 0.24),
	"ireland":         Color(0.17, 0.55, 0.20),
	"denmark":         Color(0.78, 0.06, 0.18),
	"norway":          Color(0.00, 0.44, 0.80),
	"sweden":          Color(0.00, 0.38, 0.67),
	"finland":         Color(0.72, 0.79, 0.86),
	"austria":         Color(0.90, 0.30, 0.20),
	"czechoslovakia":  Color(0.00, 0.60, 0.60),
	"hungary":         Color(0.60, 0.20, 0.40),
	"yugoslavia":      Color(0.40, 0.20, 0.60),
	"rumania":         Color(0.75, 0.60, 0.00),
	"albania":         Color(0.60, 0.40, 0.10),
	"greece":          Color(0.10, 0.40, 0.70),
	"bulgaria":        Color(0.50, 0.60, 0.20),
	"latvia":          Color(0.60, 0.10, 0.20),
	"lithuania":       Color(0.20, 0.50, 0.20),
	"estonia":         Color(0.00, 0.55, 0.55),
	"danzig":          Color(0.70, 0.65, 0.50),
	"malta":           Color(0.85, 0.85, 0.85),
	"algeria":         Color(0.80, 0.60, 0.20),
	"morocco":         Color(0.70, 0.50, 0.15),
	"spanish_morocco": Color(0.75, 0.55, 0.10),
	"tunisia":         Color(0.85, 0.65, 0.25),
	"libya":           Color(0.90, 0.75, 0.40),
	"default":         Color(0.55, 0.55, 0.55),
}

const COVER_COLORS := {
	"farmland":            Color(0.76, 0.70, 0.50, 0.7),
	"hot_desert":          Color(0.95, 0.85, 0.60, 0.7),
	"cold_desert":         Color(0.80, 0.80, 0.85, 0.7),
	"steppe":              Color(0.85, 0.80, 0.55, 0.7),
	"open_forest":         Color(0.45, 0.65, 0.35, 0.7),
	"temperate_forest":    Color(0.35, 0.50, 0.25, 0.7),
	"boreal_forest":       Color(0.30, 0.45, 0.35, 0.7),
	"urban":               Color(0.55, 0.55, 0.60, 0.7),
	"town":                Color(0.65, 0.60, 0.55, 0.7),
	"grassland":           Color(0.65, 0.80, 0.45, 0.7),
	"mediterranean_scrub": Color(0.70, 0.65, 0.45, 0.7),
	"heathland":           Color(0.65, 0.50, 0.55, 0.7),
	"wetland":             Color(0.40, 0.60, 0.55, 0.7),
	"glacier":             Color(0.85, 0.92, 0.97, 0.7),
	"tundra":              Color(0.72, 0.78, 0.72, 0.7),
	"jungle":              Color(0.20, 0.50, 0.20, 0.7),
	"mangrove":            Color(0.30, 0.55, 0.40, 0.7),
}

const ELEVATION_COLORS := {
	"flat":      Color(0.70, 0.85, 0.60, 0.7),
	"hills":     Color(0.55, 0.70, 0.35, 0.7),
	"mountains": Color(0.60, 0.50, 0.40, 0.7),
}

# change these two for input and output folders
@export_dir var map_asset_root: String = "res://assets/data/western_europe_6"
@export_dir var output_scene_root: String = "res://scenes/map"

var _bounds: Dictionary = {}
var _projection: MapProjection
var _skipped_polygon_count: int = 0


## EditorScript entrypoint. Builds and saves one map scene from map_asset_root.
## Parameters: none.
## Returns: nothing.
func _run() -> void:
	_skipped_polygon_count = 0

	var map_data_path: String = "%s/map_data.json" % map_asset_root
	var map_data_raw: Variant = _load_json(map_data_path)
	if not map_data_raw is Dictionary:
		push_error("MapGenerator: failed to load map data: %s" % map_data_path)
		return

	var map_data: Dictionary = map_data_raw
	_bounds = map_data.get("bounds", {})
	if _bounds.is_empty():
		push_error("MapGenerator: map_data.json is missing bounds")
		return

	_setup_projection()

	var root: Node2D = Node2D.new()
	root.name = _get_map_scene_name()
	root.set_meta("map_asset_root", map_asset_root)

	_load_water_layer(root, "%s/base_water.json" % map_asset_root)
	_load_province_layer(root, map_data)
	_load_overlay_layer(root, "cover", "%s/cover.json" % map_asset_root)
	_load_overlay_layer(root, "elevation", "%s/elevation.json" % map_asset_root)
	_load_linear_layer(root, "rivers", "%s/rivers.json" % map_asset_root)
	_load_linear_layer(root, "roads", "%s/roads.json" % map_asset_root)

	_save_scene(root)
	if _skipped_polygon_count > 0:
		push_warning("MapGenerator: skipped %d non-triangulatable polygons" % _skipped_polygon_count)


## Saves the generated node tree as a PackedScene.
## Parameters:
## - root: generated scene root.
## Returns: nothing.
func _save_scene(root: Node2D) -> void:
	var output_path: String = "%s/%s.scn" % [output_scene_root, _get_map_scene_name()]
	_ensure_directory_exists(output_scene_root)

	var packed_scene: PackedScene = PackedScene.new()
	var pack_error: Error = packed_scene.pack(root)
	if pack_error != OK:
		push_error("MapGenerator: failed to pack scene: %s" % error_string(pack_error))
		return

	var save_error: Error = ResourceSaver.save(packed_scene, output_path)
	if save_error != OK:
		push_error("MapGenerator: failed to save %s: %s" % [output_path, error_string(save_error)])
		return

	print("MapGenerator: saved %s" % output_path)


## Creates the target output directory when it does not exist.
## Parameters:
## - res_path: res:// directory path.
## Returns: nothing.
func _ensure_directory_exists(res_path: String) -> void:
	var absolute_path: String = ProjectSettings.globalize_path(res_path)
	var error: Error = DirAccess.make_dir_recursive_absolute(absolute_path)
	if error != OK and error != ERR_ALREADY_EXISTS:
		push_error("MapGenerator: failed to create directory %s: %s" % [res_path, error_string(error)])


## Generates the scene name from the selected map asset folder.
## Parameters: none.
## Returns: scene-safe map folder name.
func _get_map_scene_name() -> String:
	var trimmed_path: String = map_asset_root.trim_suffix("/")
	return trimmed_path.get_file()


## Adds the generated province container and province nodes.
## Parameters:
## - root: generated scene root.
## - map_data: parsed map_data.json dictionary.
## Returns: nothing.
func _load_province_layer(root: Node2D, map_data: Dictionary) -> void:
	var province_container: Node2D = Node2D.new()
	province_container.name = "Provinces"
	root.add_child(province_container)
	province_container.owner = root

	var collision_container: Node2D = Node2D.new()
	collision_container.name = "CollisionLayer"
	collision_container.visible = false
	root.add_child(collision_container)
	collision_container.owner = root

	var provinces: Array = map_data.get("provinces", [])
	for province_data_variant: Variant in provinces:
		if not province_data_variant is Dictionary:
			continue
		var province_data: Dictionary = province_data_variant
		var province_id: String = province_data.get("province_id", "")
		if province_id.is_empty():
			continue

		var province_node: Node2D = Node2D.new()
		province_node.name = province_id
		province_container.add_child(province_node)
		province_node.owner = root
		_build_province_node_children(province_node, root)
		_populate_province(province_node, collision_container, province_data, root)


## Creates the standard child structure expected for generated province nodes.
## Parameters:
## - node: generated province root.
## - scene_root: generated scene root that owns saved nodes.
## Returns: nothing.
func _build_province_node_children(node: Node2D, scene_root: Node) -> void:
	var fill: Polygon2D = Polygon2D.new()
	fill.name = "Fill"
	fill.color = NATION_PALETTE["default"]
	node.add_child(fill)
	fill.owner = scene_root

	var border: Line2D = Line2D.new()
	border.name = "Border"
	border.width = 1.0
	border.default_color = Color(0.1, 0.1, 0.1, 0.8)
	node.add_child(border)
	border.owner = scene_root

	var city_label: Label = Label.new()
	city_label.name = "CityLabel"
	node.add_child(city_label)
	city_label.owner = scene_root

	var city_icon: Sprite2D = Sprite2D.new()
	city_icon.name = "CityIcon"
	city_icon.visible = false
	node.add_child(city_icon)
	city_icon.owner = scene_root

	var unit_anchor: Node2D = Node2D.new()
	unit_anchor.name = "UnitAnchor"
	node.add_child(unit_anchor)
	unit_anchor.owner = scene_root


## Populates one generated province node from province JSON data.
## Parameters:
## - node: generated province root.
## - collision_container: hidden collision layer for click areas.
## - province_data: province entry from map_data.json.
## - scene_root: generated scene root that owns local generated nodes.
## Returns: nothing.
func _populate_province(node: Node2D, collision_container: Node2D, province_data: Dictionary, scene_root: Node) -> void:
	var polygons: Array = province_data.get("polygons", [])
	var province_id: String = province_data.get("province_id", "")
	if polygons.is_empty():
		node.set_meta("province_id", province_id)
		return

	var first_points: PackedVector2Array = _ring_to_vector2_array(polygons[0])
	var province_color: Color = _province_color(province_data)
	var fill: Polygon2D = node.get_node("Fill")
	fill.color = province_color
	var first_ring_valid: bool = _assign_polygon_if_valid(fill, first_points)

	var border: Line2D = node.get_node("Border")
	border.points = first_points
	if first_points.size() > 0:
		border.add_point(first_points[0])

	if first_ring_valid:
		_add_collision_polygon(collision_container, province_id, 0, first_points, scene_root)

	for index: int in range(1, polygons.size()):
		var points: PackedVector2Array = _ring_to_vector2_array(polygons[index])

		var extra_border: Line2D = Line2D.new()
		extra_border.name = "BorderPart%02d" % index
		extra_border.default_color = border.default_color
		extra_border.width = border.width
		extra_border.points = points
		if points.size() > 0:
			extra_border.add_point(points[0])
		node.add_child(extra_border)
		extra_border.owner = scene_root

		if not _is_polygon_triangulatable(points):
			_skipped_polygon_count += 1
			continue

		var extra_fill: Polygon2D = Polygon2D.new()
		extra_fill.name = "FillPart%02d" % index
		extra_fill.color = province_color
		extra_fill.polygon = points
		node.add_child(extra_fill)
		extra_fill.owner = scene_root

		_add_collision_polygon(collision_container, province_id, index, points, scene_root)

	var city_position_raw: Array = province_data.get("city_position", [])
	if city_position_raw.size() >= 2:
		var city_position: Vector2 = _project(float(city_position_raw[0]), float(city_position_raw[1]))

		var label: Label = node.get_node("CityLabel")
		label.position = city_position + Vector2(10, -4)
		label.text = province_data.get("city_name", "")
		label.z_as_relative = false
		label.z_index = 10

		var city_dot: Polygon2D = _make_circle_dot(city_position, CITY_DOT_RADIUS, Color(1.0, 1.0, 0.8))
		city_dot.set_meta("is_marker", true)
		city_dot.z_as_relative = false
		city_dot.z_index = 9
		node.add_child(city_dot)
		city_dot.owner = scene_root

		var has_port: bool = province_data.get("has_port", false)
		if has_port:
			var port_dot: Polygon2D = _make_circle_dot(city_position + Vector2(12, -12), PORT_DOT_RADIUS, Color(0.3, 0.9, 1.0))
			port_dot.set_meta("is_marker", true)
			port_dot.z_as_relative = false
			port_dot.z_index = 9
			node.add_child(port_dot)
			port_dot.owner = scene_root

		var anchor: Node2D = node.get_node("UnitAnchor")
		anchor.position = city_position

	node.set_meta("province_id", province_id)


## Adds one hidden collision polygon for province interaction.
## Parameters:
## - collision_container: hidden collision layer.
## - province_id: province id attached as metadata.
## - polygon_index: index of the source polygon ring inside the province.
## - points: projected polygon ring.
## - scene_root: generated scene root that owns saved nodes.
## Returns: nothing.
func _add_collision_polygon(
	collision_container: Node2D,
	province_id: String,
	polygon_index: int,
	points: PackedVector2Array,
	scene_root: Node
) -> void:
	var area: Area2D = Area2D.new()
	if polygon_index == 0:
		area.name = province_id
	else:
		area.name = "%s_part_%02d" % [province_id, polygon_index]
	area.set_meta("province_id", province_id)
	area.set_meta("polygon_index", polygon_index)
	area.set_meta("source_layer", "province_clickbox")
	collision_container.add_child(area)
	area.owner = scene_root

	var shape: CollisionPolygon2D = CollisionPolygon2D.new()
	shape.name = "Shape"
	shape.polygon = points
	shape.set_meta("province_id", province_id)
	shape.set_meta("polygon_index", polygon_index)
	area.add_child(shape)
	shape.owner = scene_root


## Returns the political preview color for a province.
## Parameters:
## - province_data: province entry from map_data.json.
## Returns: nation color or default grey.
func _province_color(province_data: Dictionary) -> Color:
	var nation_id: String = province_data.get("nation_id", "default")
	return NATION_PALETTE.get(nation_id, NATION_PALETTE["default"])


## Adds the water polygons when base water data is available.
## Parameters:
## - root: generated scene root.
## - path: base_water.json path.
## Returns: nothing.
func _load_water_layer(root: Node2D, path: String) -> void:
	var geojson_raw: Variant = _load_optional_json(path)
	if not geojson_raw is Dictionary:
		return
	var geojson: Dictionary = geojson_raw

	var container: Node2D = Node2D.new()
	container.name = "WaterLayer"
	root.add_child(container)
	container.owner = root

	for feature_variant: Variant in geojson.get("features", []):
		if not feature_variant is Dictionary:
			continue
		var feature: Dictionary = feature_variant
		var geometry: Dictionary = feature.get("geometry", {})
		var geometry_type: String = geometry.get("type", "")
		var coordinates: Array = geometry.get("coordinates", [])

		if geometry_type == "Polygon" and not coordinates.is_empty():
			_add_water_polygon(container, coordinates[0])
		elif geometry_type == "MultiPolygon":
			for part_variant: Variant in coordinates:
				var part: Array = part_variant
				if not part.is_empty():
					_add_water_polygon(container, part[0])


## Adds one projected water polygon to a parent layer.
## Parameters:
## - parent: water layer node.
## - ring: WGS84 polygon exterior ring.
## Returns: nothing.
func _add_water_polygon(parent: Node, ring: Array) -> void:
	var polygon: Polygon2D = Polygon2D.new()
	if not _assign_polygon_if_valid(polygon, _ring_to_vector2_array(ring)):
		return
	polygon.color = Color(0.25, 0.55, 0.85, 1.0)
	parent.add_child(polygon)
	polygon.owner = parent.owner


## Adds one combined cover or elevation mesh when layer data is available.
## Parameters:
## - root: generated scene root.
## - layer_name: cover or elevation.
## - path: layer JSON path.
## Returns: nothing.
func _load_overlay_layer(root: Node2D, layer_name: String, path: String) -> void:
	var geojson_raw: Variant = _load_optional_json(path)
	if not geojson_raw is Dictionary:
		return
	var geojson: Dictionary = geojson_raw

	var vertices: Array[Vector2] = []
	var colors: Array[Color] = []
	var indices: Array[int] = []

	for feature_variant: Variant in geojson.get("features", []):
		if not feature_variant is Dictionary:
			continue
		var feature: Dictionary = feature_variant
		var geometry: Dictionary = feature.get("geometry", {})
		var geometry_type: String = geometry.get("type", "")
		var coordinates: Array = geometry.get("coordinates", [])
		var properties: Dictionary = feature.get("properties", {})

		if geometry_type == "Polygon" and not coordinates.is_empty():
			_append_overlay_polygon(
				vertices, colors, indices, coordinates[0], properties, layer_name
			)
		elif geometry_type == "MultiPolygon":
			for part_variant: Variant in coordinates:
				var part: Array = part_variant
				if not part.is_empty():
					_append_overlay_polygon(
						vertices, colors, indices, part[0], properties, layer_name
					)

	var mesh_instance := MeshInstance2D.new()
	mesh_instance.name = layer_name.capitalize() + "Layer"
	mesh_instance.visible = false

	if not vertices.is_empty():
		var surface_arrays: Array = []
		surface_arrays.resize(Mesh.ARRAY_MAX)
		surface_arrays[Mesh.ARRAY_VERTEX] = PackedVector2Array(vertices)
		surface_arrays[Mesh.ARRAY_COLOR] = PackedColorArray(colors)
		surface_arrays[Mesh.ARRAY_INDEX] = PackedInt32Array(indices)

		var overlay_mesh := ArrayMesh.new()
		overlay_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, surface_arrays)
		mesh_instance.mesh = overlay_mesh

	root.add_child(mesh_instance)
	mesh_instance.owner = root


## Appends one projected overlay polygon to combined mesh arrays.
## Parameters:
## - vertices: combined projected vertex positions.
## - colors: per-vertex overlay colors.
## - indices: combined triangle indices.
## - ring: WGS84 polygon exterior ring.
## - properties: feature properties dictionary.
## - layer_name: cover or elevation.
## Returns: nothing.
func _append_overlay_polygon(
		vertices: Array[Vector2],
		colors: Array[Color],
		indices: Array[int],
		ring: Array,
		properties: Dictionary,
		layer_name: String
) -> void:
	var points: PackedVector2Array = _ring_to_vector2_array(ring)
	var polygon_indices: PackedInt32Array = Geometry2D.triangulate_polygon(points)
	if points.size() < 3 or polygon_indices.size() < 3:
		_skipped_polygon_count += 1
		return

	var overlay_color: Color
	if layer_name == "cover":
		var cover_type: String = properties.get("cover_visual", "grassland")
		overlay_color = COVER_COLORS.get(
			cover_type, Color(0.65, 0.80, 0.45, 0.7)
		)
	elif layer_name == "elevation":
		var elevation_type: String = properties.get("elev_type", properties.get("elevation_type", "flat"))
		overlay_color = ELEVATION_COLORS.get(
			elevation_type, Color(0.70, 0.85, 0.60, 0.7)
		)
	else:
		overlay_color = Color(1, 1, 1, 0.4)

	var vertex_offset: int = vertices.size()
	for point: Vector2 in points:
		vertices.append(point)
		colors.append(overlay_color)
	for polygon_index: int in polygon_indices:
		indices.append(vertex_offset + polygon_index)


## Adds road or river line layers when data is available.
## Parameters:
## - root: generated scene root.
## - layer_name: roads or rivers.
## - path: layer JSON path.
## Returns: nothing.
func _load_linear_layer(root: Node2D, layer_name: String, path: String) -> void:
	var geojson_raw: Variant = _load_optional_json(path)
	if not geojson_raw is Dictionary:
		return
	var geojson: Dictionary = geojson_raw

	var container: Node2D = Node2D.new()
	container.name = layer_name.capitalize() + "Layer"
	root.add_child(container)
	container.owner = root

	for feature_variant: Variant in geojson.get("features", []):
		if not feature_variant is Dictionary:
			continue
		var feature: Dictionary = feature_variant
		var geometry: Dictionary = feature.get("geometry", {})
		var geometry_type: String = geometry.get("type", "")
		var coordinates: Array = geometry.get("coordinates", [])
		var properties: Dictionary = feature.get("properties", {})

		if geometry_type == "LineString":
			_add_line(container, coordinates, properties, layer_name)
		elif geometry_type == "MultiLineString":
			for segment_variant: Variant in coordinates:
				var segment: Array = segment_variant
				_add_line(container, segment, properties, layer_name)


## Adds one projected road or river line.
## Parameters:
## - parent: linear layer node.
## - coordinates: WGS84 LineString coordinates.
## - properties: feature properties dictionary.
## - layer_name: roads or rivers.
## Returns: nothing.
func _add_line(parent: Node, coordinates: Array, properties: Dictionary, layer_name: String) -> void:
	var line: Line2D = Line2D.new()
	var points: PackedVector2Array = PackedVector2Array()
	points.resize(coordinates.size())
	for index: int in coordinates.size():
		var coordinate: Array = coordinates[index]
		points[index] = _project(float(coordinate[0]), float(coordinate[1]))
	line.points = points

	if layer_name == "rivers":
		var river_size: String = properties.get("river_size", "stream")
		line.width = 3.0 if river_size == "major" else (2.0 if river_size == "minor" else 1.0)
		line.default_color = Color(0.2, 0.5, 0.9, 0.8)
	elif layer_name == "roads":
		var road_level: int = properties.get("road_level", 2)
		line.width = 2.0 if road_level == 3 else 1.0
		line.default_color = Color(0.6, 0.4, 0.2, 0.9)

	parent.add_child(line)
	line.owner = parent.owner


## Configures the Mercator projection from map bounds.
## Parameters: none.
## Returns: nothing.
func _setup_projection() -> void:
	_projection = MapProjection.new(_bounds)


## Converts WGS84 coordinates to raw Mercator radians.
## Parameters:
## - lng: longitude.
## - lat: latitude.
## Returns: raw Mercator position.
func _mercator_raw(lng: float, lat: float) -> Vector2:
	return MapProjection.mercator_raw(lng, lat)


## Projects WGS84 coordinates into Godot world coordinates.
## Parameters:
## - lng: longitude.
## - lat: latitude.
## Returns: Godot world-space point.
func _project(lng: float, lat: float) -> Vector2:
	return _projection.project(lng, lat)


## Projects one WGS84 polygon ring into a PackedVector2Array.
## Parameters:
## - ring: array of [lng, lat] coordinate pairs.
## Returns: projected polygon points.
func _ring_to_vector2_array(ring: Array) -> PackedVector2Array:
	return _projection.project_ring(ring)


## Assigns polygon points only when Godot can triangulate them.
## Parameters:
## - polygon: Polygon2D node receiving the points.
## - points: projected polygon points.
## Returns: true when assigned, false when skipped.
func _assign_polygon_if_valid(polygon: Polygon2D, points: PackedVector2Array) -> bool:
	if not _is_polygon_triangulatable(points):
		_skipped_polygon_count += 1
		return false
	polygon.polygon = points
	return true


## Checks whether Godot can triangulate a polygon ring.
## Parameters:
## - points: projected polygon points.
## Returns: true when the ring can be safely used as Polygon2D/CollisionPolygon2D data.
func _is_polygon_triangulatable(points: PackedVector2Array) -> bool:
	if points.size() < 3:
		return false
	var indices: PackedInt32Array = Geometry2D.triangulate_polygon(points)
	return indices.size() >= 3


## Creates an n-sided marker dot centered on the given point.
## Parameters:
## - center: world-space marker center.
## - radius: marker radius.
## - color: marker color.
## - sides: polygon side count.
## Returns: marker polygon.
func _make_circle_dot(center: Vector2, radius: float, color: Color, sides: int = 8) -> Polygon2D:
	var polygon: Polygon2D = Polygon2D.new()
	var points: PackedVector2Array = PackedVector2Array()
	points.resize(sides)
	for index: int in sides:
		var angle: float = index * TAU / sides
		points[index] = center + Vector2(cos(angle), sin(angle)) * radius
	polygon.polygon = points
	polygon.color = color
	return polygon


## Loads required JSON from disk.
## Parameters:
## - path: JSON file path.
## Returns: parsed JSON value or null on failure.
func _load_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		push_warning("MapGenerator: file not found: %s" % path)
		return null
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_warning("MapGenerator: cannot open: %s" % path)
		return null
	var text: String = file.get_as_text()
	file.close()
	var result: Variant = JSON.parse_string(text)
	if result == null:
		push_warning("MapGenerator: JSON parse error: %s" % path)
	return result


## Loads optional JSON from disk.
## Parameters:
## - path: JSON file path.
## Returns: parsed JSON value or null when unavailable.
func _load_optional_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		push_warning("MapGenerator: optional layer missing: %s" % path)
		return null
	return _load_json(path)
