extends Node
## Loads a processed map from client/assets/data/<map_id>/ and instantiates
## province nodes, overlay layers, and linear feature layers.
## Only place in the codebase that converts lng/lat to Godot screen space.

signal map_loaded(province_count: int)
signal map_load_failed(error: String)

const MAP_CANVAS_WIDTH := 4096.0
const MAP_CANVAS_HEIGHT := 3000.0
const CITY_DOT_RADIUS  := 8.0
const PORT_DOT_RADIUS  := 8.0

const PROVINCE_SCENE := preload("res://scenes/systems/map/province.tscn")

var _map_id: String = ""
var _bounds: Dictionary = {}
var _provinces: Dictionary = {}       # province_id → Node2D
var _province_data: Dictionary = {}   # province_id → Dictionary (raw JSON data)
var _adjacency: Array = []
var _terrain_lookup: Dictionary = {}
var _waypoints: Dictionary = {}    # { nodes: [], edges: [], road_connections: [] }

var _proj_center: Vector2 = Vector2.ZERO
var _scale: float = 1.0


func load_map(map_id: String) -> void:
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

	# Water must be added first so it renders behind everything
	_load_water_layer("%s/base_water.json" % data_root)

	var province_container := Node2D.new()
	province_container.name = "Provinces"
	add_child(province_container)

	for pdata in map_data.get("provinces", []):
		var pid: String = pdata.get("province_id", "")
		if pid.is_empty():
			continue
		_province_data[pid] = pdata
		var node := _instantiate_province(pdata)
		province_container.add_child(node)
		_provinces[pid] = node

	_load_overlay_layer("cover", "%s/cover.json" % data_root)
	_load_overlay_layer("elevation", "%s/elevation.json" % data_root)
	_load_linear_layer("rivers", "%s/rivers.json" % data_root)
	_load_linear_layer("roads", "%s/roads.json" % data_root)

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


# ── province instantiation ────────────────────────────────────────────────────

func _instantiate_province(pdata: Dictionary) -> Node2D:
	var node: Node2D = PROVINCE_SCENE.instantiate()
	node.name = pdata.get("province_id", "province")

	var polygons: Array = pdata.get("polygons", [])
	if polygons.is_empty():
		return node

	# First ring uses the pre-built scene nodes
	var first_pts := _ring_to_vector2(polygons[0])
	var fill: Polygon2D = node.get_node("Fill")
	fill.polygon = first_pts

	var border: Line2D = node.get_node("Border")
	border.points = first_pts
	if first_pts.size() > 0:
		border.add_point(first_pts[0])

	var shape: CollisionPolygon2D = node.get_node("Clickbox/Shape")
	shape.polygon = first_pts

	# Additional rings (MultiPolygon — e.g. island groups, Northern Ireland)
	for i in range(1, polygons.size()):
		var pts := _ring_to_vector2(polygons[i])

		var extra_fill := Polygon2D.new()
		extra_fill.color = fill.color
		node.add_child(extra_fill)
		extra_fill.polygon = pts

		var extra_border := Line2D.new()
		extra_border.default_color = border.default_color
		extra_border.width = border.width
		extra_border.points = pts
		if pts.size() > 0:
			extra_border.add_point(pts[0])
		node.add_child(extra_border)

		var extra_area := Area2D.new()
		var extra_shape := CollisionPolygon2D.new()
		extra_shape.polygon = pts
		extra_area.add_child(extra_shape)
		node.add_child(extra_area)

	var city_pos_raw: Array = pdata.get("city_position", [])
	if city_pos_raw.size() >= 2:
		var city_v := _project(float(city_pos_raw[0]), float(city_pos_raw[1]))

		var label: Label = node.get_node("CityLabel")
		label.position = city_v + Vector2(10, -4)
		label.text = pdata.get("city_name", "")
		label.z_as_relative = false
		label.z_index = 10

		var city_dot := _make_circle_dot(city_v, CITY_DOT_RADIUS, Color(1.0, 1.0, 0.8))
		city_dot.set_meta("is_marker", true)
		city_dot.z_as_relative = false
		city_dot.z_index = 9
		node.add_child(city_dot)

		var has_port: bool = pdata.get("has_port", false)
		if has_port:
			var port_dot := _make_circle_dot(city_v + Vector2(12, -12), PORT_DOT_RADIUS, Color(0.3, 0.9, 1.0))
			port_dot.set_meta("is_marker", true)
			port_dot.z_as_relative = false
			port_dot.z_index = 9
			node.add_child(port_dot)

		var anchor: Node2D = node.get_node("UnitAnchor")
		anchor.position = city_v

	node.set_meta("province_id", pdata.get("province_id", ""))
	return node


func _ring_to_vector2(ring: Array) -> PackedVector2Array:
	var pts := PackedVector2Array()
	pts.resize(ring.size())
	for i in ring.size():
		var coord: Array = ring[i]
		pts[i] = _project(float(coord[0]), float(coord[1]))
	return pts


func _make_circle_dot(center: Vector2, radius: float, color: Color, sides: int = 8) -> Polygon2D:
	var poly := Polygon2D.new()
	var pts := PackedVector2Array()
	pts.resize(sides)
	for i in sides:
		var angle := i * TAU / sides
		pts[i] = center + Vector2(cos(angle), sin(angle)) * radius
	poly.polygon = pts
	poly.color = color
	return poly


# ── water layer ───────────────────────────────────────────────────────────────

func _load_water_layer(path: String) -> void:
	var geojson_raw: Variant = _load_json(path)
	if not geojson_raw is Dictionary:
		return
	var geojson: Dictionary = geojson_raw

	var container := Node2D.new()
	container.name = "WaterLayer"
	add_child(container)

	for feat in geojson.get("features", []):
		var geom: Dictionary = feat.get("geometry", {})
		var gtype: String = geom.get("type", "")
		var coords: Array = geom.get("coordinates", [])

		if gtype == "Polygon":
			_add_water_polygon(container, coords[0])
		elif gtype == "MultiPolygon":
			for part in coords:
				_add_water_polygon(container, part[0])


func _add_water_polygon(parent: Node, ring: Array) -> void:
	var poly := Polygon2D.new()
	poly.polygon = _ring_to_vector2(ring)
	poly.color = Color(0.25, 0.55, 0.85, 1.0)
	parent.add_child(poly)


# ── overlay + linear layers ───────────────────────────────────────────────────

func _load_overlay_layer(layer_name: String, path: String) -> void:
	var geojson_raw: Variant = _load_json(path)
	if not geojson_raw is Dictionary:
		return
	var geojson: Dictionary = geojson_raw

	var container := Node2D.new()
	container.name = layer_name.capitalize() + "Layer"
	container.visible = false
	add_child(container)

	for feat in geojson.get("features", []):
		var geom: Dictionary = feat.get("geometry", {})
		var gtype: String = geom.get("type", "")
		var coords: Array = geom.get("coordinates", [])
		var props: Dictionary = feat.get("properties", {})

		if gtype == "Polygon":
			_add_overlay_polygon(container, coords[0], props)
		elif gtype == "MultiPolygon":
			for part in coords:
				_add_overlay_polygon(container, part[0], props)


func _add_overlay_polygon(parent: Node, ring: Array, props: Dictionary) -> void:
	var poly := Polygon2D.new()
	poly.polygon = _ring_to_vector2(ring)
	poly.set_meta("props", props)

	if parent.name == "CoverLayer":
		var cover_type: String = props.get("cover_visual", "grassland")
		var cover_colors: Dictionary = {
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
		poly.color = cover_colors.get(cover_type, Color(0.65, 0.80, 0.45, 0.7))
	elif parent.name == "ElevationLayer":
		# elevation.json features use either "elev_type" (original) or "elevation_type" (gap-fill)
		var elev_type: String = props.get("elev_type", props.get("elevation_type", "flat"))
		var elev_colors: Dictionary = {
			"flat":      Color(0.70, 0.85, 0.60, 0.7),
			"hills":     Color(0.55, 0.70, 0.35, 0.7),
			"mountains": Color(0.60, 0.50, 0.40, 0.7),
		}
		poly.color = elev_colors.get(elev_type, Color(0.70, 0.85, 0.60, 0.7))
	else:
		poly.color = Color(1, 1, 1, 0.4)

	parent.add_child(poly)


func _load_linear_layer(layer_name: String, path: String) -> void:
	var geojson_raw: Variant = _load_json(path)
	if not geojson_raw is Dictionary:
		return
	var geojson: Dictionary = geojson_raw

	var container := Node2D.new()
	container.name = layer_name.capitalize() + "Layer"
	add_child(container)

	for feat in geojson.get("features", []):
		var geom: Dictionary = feat.get("geometry", {})
		var gtype: String = geom.get("type", "")
		var coords: Array = geom.get("coordinates", [])
		var props: Dictionary = feat.get("properties", {})

		if gtype == "LineString":
			_add_line(container, coords, props, layer_name)
		elif gtype == "MultiLineString":
			for segment in coords:
				_add_line(container, segment, props, layer_name)


func _add_line(parent: Node, coords: Array, props: Dictionary, layer_name: String) -> void:
	var line := Line2D.new()
	var pts := PackedVector2Array()
	pts.resize(coords.size())
	for i in coords.size():
		pts[i] = _project(float(coords[i][0]), float(coords[i][1]))
	line.points = pts

	if layer_name == "rivers":
		var size: String = props.get("river_size", "stream")
		line.width = 3.0 if size == "major" else (2.0 if size == "minor" else 1.0)
		line.default_color = Color(0.2, 0.5, 0.9, 0.8)
	elif layer_name == "roads":
		var level: int = props.get("road_level", 2)
		line.width = 2.0 if level == 3 else 1.0
		line.default_color = Color(0.6, 0.4, 0.2, 0.9)

	parent.add_child(line)


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
