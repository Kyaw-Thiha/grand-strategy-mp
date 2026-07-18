extends Node
## Pure display layer — no input, no game logic.
## Colors province fills and manages overlay modes.
## Takes a data_source with get_province(id) -> Dict so it works in both
## debug mode (MapLoader) and game mode (GameState) without any special cases.

enum OverlayMode { POLITICAL, ELEVATION, COVER }

const NATION_PALETTE := {
	# Major powers
	"france":          Color(0.27, 0.51, 0.71),
	"germany":         Color(0.40, 0.40, 0.40),
	"united_kingdom":  Color(0.65, 0.13, 0.18),
	"italy":           Color(0.00, 0.56, 0.29),
	"spain":           Color(0.83, 0.55, 0.00),
	"poland":          Color(0.80, 0.00, 0.12),
	# Western Europe
	"portugal":        Color(0.00, 0.47, 0.25),
	"netherlands":     Color(0.82, 0.41, 0.12),
	"belgium":         Color(0.07, 0.26, 0.58),
	"luxembourg":      Color(0.00, 0.50, 0.80),
	"switzerland":     Color(0.86, 0.08, 0.24),
	"ireland":         Color(0.17, 0.55, 0.20),
	# Scandinavia
	"denmark":         Color(0.78, 0.06, 0.18),
	"norway":          Color(0.00, 0.44, 0.80),
	"sweden":          Color(0.00, 0.38, 0.67),
	"finland":         Color(0.72, 0.79, 0.86),
	# Central/Eastern Europe
	"austria":         Color(0.90, 0.30, 0.20),
	"czechoslovakia":  Color(0.00, 0.60, 0.60),
	"hungary":         Color(0.60, 0.20, 0.40),
	"yugoslavia":      Color(0.40, 0.20, 0.60),
	"rumania":         Color(0.75, 0.60, 0.00),
	"albania":         Color(0.60, 0.40, 0.10),
	"greece":          Color(0.10, 0.40, 0.70),
	"bulgaria":        Color(0.50, 0.60, 0.20),
	# Baltic
	"latvia":          Color(0.60, 0.10, 0.20),
	"lithuania":       Color(0.20, 0.50, 0.20),
	"estonia":         Color(0.00, 0.55, 0.55),
	"danzig":          Color(0.70, 0.65, 0.50),
	# Mediterranean / North Africa
	"malta":           Color(0.85, 0.85, 0.85),
	"algeria":         Color(0.80, 0.60, 0.20),
	"morocco":         Color(0.70, 0.50, 0.15),
	"spanish_morocco": Color(0.75, 0.55, 0.10),
	"tunisia":         Color(0.85, 0.65, 0.25),
	"libya":           Color(0.90, 0.75, 0.40),
	"default":         Color(0.55, 0.55, 0.55),
}

const COVER_COLORS := {
	"farmland":            Color(0.76, 0.70, 0.50),
	"hot_desert":          Color(0.95, 0.85, 0.60),
	"cold_desert":         Color(0.80, 0.80, 0.85),
	"steppe":              Color(0.85, 0.80, 0.55),
	"open_forest":         Color(0.45, 0.65, 0.35),
	"temperate_forest":    Color(0.35, 0.50, 0.25),
	"boreal_forest":       Color(0.30, 0.45, 0.35),
	"urban":               Color(0.55, 0.55, 0.60),
	"town":                Color(0.65, 0.60, 0.55),
	"grassland":           Color(0.65, 0.80, 0.45),
	"mediterranean_scrub": Color(0.70, 0.65, 0.45),
}

const NATION_LABEL_ZOOM_THRESHOLD    := 0.6
const NATION_LABEL_MIN_COMPONENT_SIZE := 3
const NATION_LABEL_MIN_EXTENT        := 100.0   # world-px PCA std-dev; below → no label
const CHAR_WIDTH_RATIO               := 0.62    # avg capital letter width / font_size
const NATION_LABEL_MIN_FONT          := 55
const NATION_LABEL_MAX_FONT          := 130

const NATION_DISPLAY_NAMES := {
	"united_kingdom":  "UK",
	"spanish_morocco": "SP. MOROCCO",
}

const POLITICAL_ELEVATION_LAYER_ALPHA := 0.36
const POLITICAL_COVER_LAYER_ALPHA := 0.20
const POLITICAL_BORDER_COLOR := Color(0.68, 0.68, 0.68, 0.85)
const POLITICAL_BORDER_CONTRAST_COLOR := Color(0.08, 0.08, 0.08, 0.82)
const POLITICAL_BORDER_WIDTH := 1.4
const POLITICAL_BORDER_CONTRAST_WIDTH := 3.2
const ELEVATION_BORDER_COLOR := Color(0.0, 0.0, 0.0, 1.0)
const ELEVATION_BORDER_WIDTH := 2.8
const TERRAIN_CACHE_SIZE := Vector2i(2048, 1500)
const TERRAIN_CACHE_SCALE := Vector2(0.5, 0.5)
const BASE_FILL_SHADER_PATH := "res://src/systems/map/map_base_fill.gdshader"

var _map_loader: Node = null
var _data_source: Object = null
var _overlay_mode: OverlayMode = OverlayMode.POLITICAL
var _highlighted: Dictionary = {}       # province_id → original Color
var _nation_label_layer: Node2D = null
var _border_overlay_layer: CanvasLayer = null
var _border_overlay_root: Node2D = null
var _terrain_cache_layer: Node2D = null
var _terrain_cache_sprites: Dictionary = {}
var _terrain_cache_ready: bool = false
var _base_fill_material: ShaderMaterial = null
var _nation_labels: Dictionary = {}     # nation_id → Array[Label]
var _zoom_in_label_region := false      # true when camera zoom < NATION_LABEL_ZOOM_THRESHOLD



func setup(map_loader: Node, data_source: Object) -> void:
	_map_loader = map_loader
	_data_source = data_source
	_create_border_overlay()
	_nation_label_layer = Node2D.new()
	_nation_label_layer.name = "NationLabelLayer"
	_nation_label_layer.visible = false
	_map_loader.add_child(_nation_label_layer)

	# Auto-refresh province color on capture
	if not EventBus.province_captured.is_connected(_on_province_captured):
		EventBus.province_captured.connect(_on_province_captured)


func on_map_loaded(_province_count: int) -> void:
	_refresh_all()
	_setup_base_fill_material()
	_rebuild_border_overlay()
	_apply_border_style()
	_set_overlay_layer_visibility()
	_set_base_fill_mode()
	_build_nation_labels()
	call_deferred("_build_terrain_cache")


func set_overlay_mode(mode: String) -> void:
	match mode:
		"political":  _overlay_mode = OverlayMode.POLITICAL
		"elevation":  _overlay_mode = OverlayMode.ELEVATION
		"cover":      _overlay_mode = OverlayMode.COVER
	_highlighted.clear()
	_set_base_fill_mode()
	_set_overlay_layer_visibility()
	_apply_border_style()
	# Nation labels only make sense over political fills
	if _nation_label_layer:
		_nation_label_layer.visible = (
			_overlay_mode == OverlayMode.POLITICAL and _zoom_in_label_region
		)


func highlight_province(province_id: String) -> void:
	var node: Node2D = _map_loader.get_province_node(province_id)
	if node == null:
		return
	var fill: Polygon2D = node.get_node("Fill")
	if province_id not in _highlighted:
		_highlighted[province_id] = fill.color
	var base := fill.color
	var highlight := base.darkened(0.3) if base.a > 0.01 else Color(0, 0, 0, 0.30)
	_set_all_fills(node, highlight)


func is_highlighted(province_id: String) -> bool:
	return province_id in _highlighted


func clear_highlights() -> void:
	for pid in _highlighted.keys():
		var node: Node2D = _map_loader.get_province_node(pid)
		if node:
			_set_all_fills(node, _highlighted[pid])
	_highlighted.clear()


func on_zoom_changed(zoom_level: float) -> void:
	_zoom_in_label_region = zoom_level < NATION_LABEL_ZOOM_THRESHOLD
	var labels_visible := _zoom_in_label_region and _overlay_mode == OverlayMode.POLITICAL
	if _nation_label_layer:
		_nation_label_layer.visible = labels_visible
	_set_city_markers_visible(not _zoom_in_label_region)


func refresh_nation_labels(nation_id: String) -> void:
	if _nation_label_layer == null:
		return
	if nation_id in _nation_labels:
		for lbl: Label in _nation_labels[nation_id]:
			lbl.queue_free()
		_nation_labels.erase(nation_id)
	_build_components_for_nation(nation_id)


func refresh_province(province_id: String) -> void:
	if _map_loader == null:
		return
	var node: Node2D = _map_loader.get_province_node(province_id)
	if node == null:
		return
	_set_all_fills(node, _political_province_color(province_id))
	_set_province_borders(node)
	_rebuild_border_overlay()
	_highlighted.erase(province_id)


## Call after GameState.provinces has been updated with the new owner.
func update_province_owner(province_id: String, _new_owner_id: String) -> void:
	refresh_province(province_id)


# ── internal ──────────────────────────────────────────────────────────────────

func _refresh_all() -> void:
	if _map_loader == null:
		return
	for pid in _map_loader.get_all_province_ids():
		var node: Node2D = _map_loader.get_province_node(pid)
		if node == null:
			continue
		_set_all_fills(node, _political_province_color(pid))
		_set_province_borders(node)


func _set_all_fills(node: Node2D, colour: Color) -> void:
	for child in node.get_children():
		if child is Polygon2D and not child.has_meta("is_marker"):
			child.color = colour


func _setup_base_fill_material() -> void:
	var shader: Shader = load(BASE_FILL_SHADER_PATH) as Shader
	if shader == null:
		push_error("MapRenderer: failed to load base fill shader")
		return
	_base_fill_material = ShaderMaterial.new()
	_base_fill_material.shader = shader
	for province_id: String in _map_loader.get_all_province_ids():
		var province_node: Node2D = _map_loader.get_province_node(province_id)
		if province_node == null:
			continue
		for child: Node in province_node.get_children():
			if child is Polygon2D and not child.has_meta("is_marker") and _is_province_fill(child as Polygon2D):
				(child as Polygon2D).material = _base_fill_material
	_set_base_fill_mode()


func _set_base_fill_mode() -> void:
	if _base_fill_material == null:
		return
	var fill_mode: int = 0
	if _overlay_mode == OverlayMode.COVER:
		fill_mode = 1
	elif _overlay_mode == OverlayMode.ELEVATION:
		fill_mode = 2
	_base_fill_material.set_shader_parameter("map_fill_mode", fill_mode)


func _set_province_borders(node: Node2D) -> void:
	for child: Node in node.get_children():
		if child is Line2D and _is_province_border(child as Line2D):
			child.visible = false


func _is_province_border(line: Line2D) -> bool:
	return line.name == "Border" or line.name.begins_with("BorderPart")


func _create_border_overlay() -> void:
	_border_overlay_layer = CanvasLayer.new()
	_border_overlay_layer.name = "ProvinceBorderOverlayLayer"
	_border_overlay_layer.layer = 1
	_border_overlay_layer.follow_viewport_enabled = true
	_border_overlay_layer.follow_viewport_scale = 1.0
	add_child(_border_overlay_layer)

	_border_overlay_root = Node2D.new()
	_border_overlay_root.name = "ProvinceBorderOverlay"
	_border_overlay_layer.add_child(_border_overlay_root)


func _rebuild_border_overlay() -> void:
	if _map_loader == null or _border_overlay_root == null:
		return

	for child: Node in _border_overlay_root.get_children():
		child.free()

	var edge_segments: Dictionary = {}
	for province_id: String in _map_loader.get_all_province_ids():
		var province_node: Node2D = _map_loader.get_province_node(province_id)
		if province_node == null:
			continue
		var owner_id: String = _province_owner_id(province_id)
		for child: Node in province_node.get_children():
			if not child is Polygon2D or not _is_province_fill(child as Polygon2D):
				continue
			_collect_province_edges(edge_segments, child as Polygon2D, province_id, owner_id)

	var drawn_boundaries: Dictionary = {}
	for edge_key: String in edge_segments.keys():
		var entries: Array = edge_segments[edge_key] as Array
		if entries.size() < 2:
			continue
		for first_index: int in range(entries.size()):
			var first_entry: Dictionary = entries[first_index] as Dictionary
			for second_index: int in range(first_index + 1, entries.size()):
				var second_entry: Dictionary = entries[second_index] as Dictionary
				var first_owner: String = first_entry["owner_id"]
				var second_owner: String = second_entry["owner_id"]
				if first_owner == second_owner:
					continue
				var owner_pair: Array[String] = [first_owner, second_owner]
				owner_pair.sort()
				var boundary_key: String = "%s|%s:%s" % [edge_key, owner_pair[0], owner_pair[1]]
				if drawn_boundaries.has(boundary_key):
					continue
				drawn_boundaries[boundary_key] = true
				_add_nation_border_overlay_line(
					first_entry["start"] as Vector2,
					first_entry["end"] as Vector2,
					boundary_key
				)


func _is_province_fill(polygon: Polygon2D) -> bool:
	return polygon.name == "Fill" or polygon.name.begins_with("FillPart")


func _province_owner_id(province_id: String) -> String:
	if _data_source == null:
		return ""
	var province_data: Dictionary = _data_source.get_province(province_id)
	var owner_variant: Variant = province_data.get("nation_id", "")
	return str(owner_variant)


func _collect_province_edges(edge_segments: Dictionary, source_fill: Polygon2D,
		province_id: String, owner_id: String) -> void:
	if source_fill.polygon.size() < 2:
		return
	for point_index: int in range(source_fill.polygon.size()):
		var next_index: int = (point_index + 1) % source_fill.polygon.size()
		var start: Vector2 = source_fill.to_global(source_fill.polygon[point_index])
		var end: Vector2 = source_fill.to_global(source_fill.polygon[next_index])
		var edge_key: String = _make_border_edge_key(start, end)
		var entries: Array = edge_segments.get(edge_key, []) as Array
		entries.append({
			"province_id": province_id,
			"owner_id": owner_id,
			"start": start,
			"end": end,
		})
		edge_segments[edge_key] = entries


func _make_border_edge_key(start: Vector2, end: Vector2) -> String:
	var start_key: String = _make_border_point_key(start)
	var end_key: String = _make_border_point_key(end)
	if start_key < end_key:
		return "%s|%s" % [start_key, end_key]
	return "%s|%s" % [end_key, start_key]


func _make_border_point_key(point: Vector2) -> String:
	const EDGE_KEY_SCALE: float = 1000.0
	return "%d:%d" % [int(round(point.x * EDGE_KEY_SCALE)), int(round(point.y * EDGE_KEY_SCALE))]


func _add_nation_border_overlay_line(start: Vector2, end: Vector2, boundary_key: String) -> void:
	var points: PackedVector2Array = PackedVector2Array()
	points.append(_border_overlay_root.to_local(start))
	points.append(_border_overlay_root.to_local(end))

	var contrast_border: Line2D = Line2D.new()
	contrast_border.name = "%sContrast" % boundary_key
	contrast_border.set_meta("border_role", "contrast")
	contrast_border.points = points
	_border_overlay_root.add_child(contrast_border)

	var highlight_border: Line2D = Line2D.new()
	highlight_border.name = "%sHighlight" % boundary_key
	highlight_border.set_meta("border_role", "highlight")
	highlight_border.points = points
	_border_overlay_root.add_child(highlight_border)


func _apply_border_style() -> void:
	if _border_overlay_root == null:
		return
	var debug_border: bool = _overlay_mode == OverlayMode.COVER or _overlay_mode == OverlayMode.ELEVATION
	for child: Node in _border_overlay_root.get_children():
		if not child is Line2D:
			continue
		var line: Line2D = child as Line2D
		if line.get_meta("border_role", "") == "contrast":
			line.width = ELEVATION_BORDER_WIDTH if debug_border else POLITICAL_BORDER_CONTRAST_WIDTH
			line.default_color = ELEVATION_BORDER_COLOR if debug_border else POLITICAL_BORDER_CONTRAST_COLOR
		else:
			line.width = 0.0 if debug_border else POLITICAL_BORDER_WIDTH
			line.default_color = Color.TRANSPARENT if debug_border else POLITICAL_BORDER_COLOR


func _political_province_color(province_id: String) -> Color:
	if _data_source == null:
		return NATION_PALETTE["default"]

	var pdata: Dictionary = _data_source.get_province(province_id)
	var owner: String = str(pdata.get("nation_id", "default"))
	return NATION_PALETTE.get(owner, NATION_PALETTE["default"])


func _on_province_captured(province_id: String, _new_owner_id: String) -> void:
	refresh_province(province_id)


func _build_terrain_cache() -> void:
	if _map_loader == null or _terrain_cache_ready:
		return
	var cache_modes: Array[int] = [OverlayMode.POLITICAL, OverlayMode.COVER, OverlayMode.ELEVATION]
	for mode: int in cache_modes:
		var texture: Texture2D = await _render_terrain_mode(mode)
		if texture == null:
			return
		_create_terrain_cache_sprite(mode, texture)
	_terrain_cache_ready = true
	_set_overlay_layer_visibility()


func _render_terrain_mode(mode: int) -> Texture2D:
	var viewport: SubViewport = SubViewport.new()
	viewport.name = "TerrainCacheViewport_%s" % OverlayMode.keys()[mode]
	viewport.size = TERRAIN_CACHE_SIZE
	viewport.transparent_bg = true
	viewport.disable_3d = true
	viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	_map_loader.add_child(viewport)

	var cache_root: Node2D = Node2D.new()
	cache_root.position = Vector2(TERRAIN_CACHE_SIZE) * 0.5
	cache_root.scale = TERRAIN_CACHE_SCALE
	viewport.add_child(cache_root)

	if mode == OverlayMode.POLITICAL or mode == OverlayMode.COVER:
		var cover_layer: Node = _map_loader.get_node_or_null("CoverLayer")
		if cover_layer:
			var cover_copy: Node = cover_layer.duplicate()
			cover_copy.modulate = Color.WHITE if mode == OverlayMode.COVER else Color(1.0, 1.0, 1.0, POLITICAL_COVER_LAYER_ALPHA)
			cache_root.add_child(cover_copy)
	if mode == OverlayMode.POLITICAL or mode == OverlayMode.ELEVATION:
		var elevation_layer: Node = _map_loader.get_node_or_null("ElevationLayer")
		if elevation_layer:
			var elevation_copy: Node = elevation_layer.duplicate()
			elevation_copy.modulate = Color.WHITE if mode == OverlayMode.ELEVATION else Color(1.0, 1.0, 1.0, POLITICAL_ELEVATION_LAYER_ALPHA)
			cache_root.add_child(elevation_copy)

	await RenderingServer.frame_post_draw
	var image: Image = viewport.get_texture().get_image()
	var texture: ImageTexture = ImageTexture.create_from_image(image)
	viewport.free()
	return texture


func _create_terrain_cache_sprite(mode: int, texture: Texture2D) -> void:
	if _terrain_cache_layer == null:
		_terrain_cache_layer = Node2D.new()
		_terrain_cache_layer.name = "TerrainCacheLayer"
		_map_loader.add_child(_terrain_cache_layer)
		var cover_layer: Node = _map_loader.get_node_or_null("CoverLayer")
		if cover_layer:
			_map_loader.move_child(_terrain_cache_layer, cover_layer.get_index())

	var sprite: Sprite2D = Sprite2D.new()
	sprite.name = "TerrainCache_%s" % OverlayMode.keys()[mode]
	sprite.texture = texture
	sprite.position = Vector2.ZERO
	sprite.scale = Vector2(2.0, 2.0)
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	sprite.visible = false
	_terrain_cache_layer.add_child(sprite)
	_terrain_cache_sprites[mode] = sprite


func _set_terrain_cache_visibility() -> void:
	for mode_variant: Variant in _terrain_cache_sprites.keys():
		var mode: int = mode_variant
		var sprite: Sprite2D = _terrain_cache_sprites[mode] as Sprite2D
		sprite.visible = mode == _overlay_mode


func _build_nation_labels() -> void:
	if _nation_label_layer == null:
		return
	for child in _nation_label_layer.get_children():
		child.queue_free()
	_nation_labels.clear()

	for nid in _get_all_nation_ids():
		_build_components_for_nation(nid)


func _get_all_nation_ids() -> Array:
	var seen := {}
	for pid in _map_loader.get_all_province_ids():
		var nid: String = _map_loader.get_province_data(pid).get("nation_id", "")
		if nid != "":
			seen[nid] = true
	return seen.keys()


func _build_components_for_nation(nid: String) -> void:
	var province_ids := _provinces_for_nation(nid)
	if province_ids.is_empty():
		return

	var land_adj := _build_land_adjacency(province_ids)
	var components := _bfs_components(province_ids, land_adj)
	components.sort_custom(func(a: Array, b: Array) -> bool: return a.size() > b.size())

	_nation_labels[nid] = []
	for i in components.size():
		var comp: Array = components[i]
		if i > 0 and comp.size() < NATION_LABEL_MIN_COMPONENT_SIZE:
			continue
		var char_labels := _create_component_labels(nid, comp)
		for lbl in char_labels:
			_nation_label_layer.add_child(lbl)
		_nation_labels[nid].append_array(char_labels)


func _provinces_for_nation(nid: String) -> Array:
	var result := []
	for pid in _map_loader.get_all_province_ids():
		if _map_loader.get_province_data(pid).get("nation_id", "") == nid:
			result.append(pid)
	return result


func _build_land_adjacency(province_ids: Array) -> Dictionary:
	var pid_set := {}
	for pid in province_ids:
		pid_set[pid] = true
	var adj: Dictionary = {}
	for edge in _map_loader.get_adjacency():
		var bt: String = edge.get("border_type", "")
		if bt != "open" and bt != "river":
			continue
		var a: String = edge.get("from_province", "")
		var b: String = edge.get("to_province", "")
		if a not in pid_set or b not in pid_set:
			continue
		if a not in adj: adj[a] = []
		if b not in adj: adj[b] = []
		adj[a].append(b)
		adj[b].append(a)
	return adj


func _bfs_components(province_ids: Array, land_adj: Dictionary) -> Array:
	var remaining := province_ids.duplicate()
	var components := []
	while remaining.size() > 0:
		var start: String = remaining.pop_back()
		var component := [start]
		var queue := [start]
		var visited := {start: true}
		while queue.size() > 0:
			var curr: String = queue.pop_front()
			for nb: String in land_adj.get(curr, []):
				if nb in visited or nb not in remaining:
					continue
				visited[nb] = true
				remaining.erase(nb)
				component.append(nb)
				queue.append(nb)
		components.append(component)
	return components


func _get_province_poly_centroid(pid: String) -> Vector2:
	var node: Node2D = _map_loader.get_province_node(pid)
	if node == null:
		return Vector2.ZERO
	var fill := node.get_node_or_null("Fill") as Polygon2D
	if fill == null or fill.polygon.size() == 0:
		return Vector2.ZERO
	var sum := Vector2.ZERO
	for v in fill.polygon:
		sum += v
	return sum / fill.polygon.size()


func _compute_component_centroid(province_ids: Array) -> Vector2:
	var sum := Vector2.ZERO
	for pid: String in province_ids:
		sum += _get_province_poly_centroid(pid)
	return sum / province_ids.size()


func _compute_pca(province_ids: Array) -> Dictionary:
	if province_ids.size() < 2:
		return {"angle": 0.0, "major_extent": 0.0}
	var pts := []
	for pid: String in province_ids:
		pts.append(_get_province_poly_centroid(pid))
	var mean := Vector2.ZERO
	for p: Vector2 in pts:
		mean += p
	mean /= pts.size()
	var cxx := 0.0; var cxy := 0.0; var cyy := 0.0
	for p: Vector2 in pts:
		var d := p - mean
		cxx += d.x * d.x; cxy += d.x * d.y; cyy += d.y * d.y
	var trace_half  := (cxx + cyy) * 0.5
	var det_diff    := sqrt(((cxx - cyy) * 0.5) * ((cxx - cyy) * 0.5) + cxy * cxy)
	var major_extent := sqrt(maxf(trace_half + det_diff, 0.0))
	var angle := atan2(2.0 * cxy, cxx - cyy) * 0.5
	if angle > PI * 0.5:    angle -= PI
	elif angle < -PI * 0.5: angle += PI
	return {"angle": angle, "major_extent": major_extent}


func _create_component_labels(nation_id: String, province_ids: Array) -> Array:
	var pca := _compute_pca(province_ids)
	if pca["major_extent"] < NATION_LABEL_MIN_EXTENT:
		return []

	var text: String = NATION_DISPLAY_NAMES.get(
		nation_id, nation_id.replace("_", " ").to_upper()
	)
	var centroid := _compute_component_centroid(province_ids)
	var pa: float  = pca["angle"]
	var font_size := int(clamp(50.0 + pca["major_extent"] * 0.18,
		NATION_LABEL_MIN_FONT, NATION_LABEL_MAX_FONT))

	var char_w  := float(font_size) * CHAR_WIDTH_RATIO
	var n       := text.length()
	var total_w := float(n) * char_w
	var arc_radius := maxf(total_w * 2.5, 600.0)
	var span       := total_w / arc_radius

	var labels := []
	for i in n:
		var t   := (float(i) - (n - 1) * 0.5) / maxf(float(n - 1), 1.0)
		var a   := t * span
		var pos := centroid + arc_radius * Vector2(sin(a), 1.0 - cos(a)).rotated(pa)

		var lbl := Label.new()
		lbl.text = text[i]
		lbl.add_theme_font_size_override("font_size", font_size)
		lbl.add_theme_color_override("font_color", Color.WHITE)
		lbl.add_theme_color_override("font_shadow_color", Color(0.0, 0.0, 0.0, 0.85))
		lbl.add_theme_constant_override("shadow_offset_x", 2)
		lbl.add_theme_constant_override("shadow_offset_y", 2)
		lbl.pivot_offset  = Vector2(char_w * 0.5, float(font_size) * 0.5)
		lbl.position      = pos - lbl.pivot_offset
		lbl.rotation      = pa + a
		lbl.z_as_relative = false
		lbl.z_index       = 20
		labels.append(lbl)
	return labels


func _set_city_markers_visible(visible: bool) -> void:
	for pid in _map_loader.get_all_province_ids():
		var node: Node2D = _map_loader.get_province_node(pid)
		if node == null:
			continue
		for child in node.get_children():
			if child is Polygon2D and child.has_meta("is_marker"):
				child.visible = visible


func _set_overlay_layer_visibility() -> void:
	if _map_loader == null:
		return

	var cover_layer := _map_loader.get_node_or_null("CoverLayer")
	var elev_layer := _map_loader.get_node_or_null("ElevationLayer")
	if _terrain_cache_ready:
		if cover_layer:
			cover_layer.visible = false
		if elev_layer:
			elev_layer.visible = false
		_set_terrain_cache_visibility()
		return

	match _overlay_mode:
		OverlayMode.POLITICAL:
			if cover_layer:
				cover_layer.visible = true
				cover_layer.modulate = Color(1.0, 1.0, 1.0, POLITICAL_COVER_LAYER_ALPHA)
			if elev_layer:
				elev_layer.visible = true
				elev_layer.modulate = Color(1.0, 1.0, 1.0, POLITICAL_ELEVATION_LAYER_ALPHA)
		OverlayMode.ELEVATION:
			if cover_layer:
				cover_layer.visible = false
				cover_layer.modulate = Color.WHITE
			if elev_layer:
				elev_layer.visible = true
				elev_layer.modulate = Color.WHITE
		OverlayMode.COVER:
			if cover_layer:
				cover_layer.visible = true
				cover_layer.modulate = Color.WHITE
			if elev_layer:
				elev_layer.visible = false
				elev_layer.modulate = Color.WHITE
