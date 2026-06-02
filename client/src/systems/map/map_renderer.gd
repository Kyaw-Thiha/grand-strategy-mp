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

const ELEVATION_COLORS := {
	"flat":      Color(0.70, 0.85, 0.60),
	"hills":     Color(0.55, 0.70, 0.35),
	"mountains": Color(0.60, 0.50, 0.40),
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

var _map_loader: Node = null
var _data_source: Object = null
var _overlay_mode: OverlayMode = OverlayMode.POLITICAL
var _highlighted: Dictionary = {}       # province_id → original Color
var _nation_label_layer: Node2D = null
var _nation_labels: Dictionary = {}     # nation_id → Array[Label]
var _zoom_in_label_region := false      # true when camera zoom < NATION_LABEL_ZOOM_THRESHOLD


func setup(map_loader: Node, data_source: Object) -> void:
	_map_loader = map_loader
	_data_source = data_source
	_nation_label_layer = Node2D.new()
	_nation_label_layer.name = "NationLabelLayer"
	_nation_label_layer.visible = false
	_map_loader.add_child(_nation_label_layer)


func on_map_loaded(_province_count: int) -> void:
	_refresh_all()
	_set_overlay_layer_visibility()
	_build_nation_labels()


func set_overlay_mode(mode: String) -> void:
	match mode:
		"political":  _overlay_mode = OverlayMode.POLITICAL
		"elevation":  _overlay_mode = OverlayMode.ELEVATION
		"cover":      _overlay_mode = OverlayMode.COVER
	_highlighted.clear()
	_refresh_all()
	_set_overlay_layer_visibility()
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
	_set_all_fills(node, _province_color(province_id))
	_highlighted.erase(province_id)


# ── internal ──────────────────────────────────────────────────────────────────

func _refresh_all() -> void:
	if _map_loader == null:
		return
	for pid in _map_loader.get_all_province_ids():
		var node: Node2D = _map_loader.get_province_node(pid)
		if node == null:
			continue
		_set_all_fills(node, _province_color(pid))


func _set_all_fills(node: Node2D, colour: Color) -> void:
	for child in node.get_children():
		if child is Polygon2D and not child.has_meta("is_marker"):
			child.color = colour


func _province_color(province_id: String) -> Color:
	if _data_source == null:
		return NATION_PALETTE["default"]

	var pdata: Dictionary = _data_source.get_province(province_id)

	match _overlay_mode:
		OverlayMode.POLITICAL:
			var nation: String = pdata.get("nation_id", "default")
			return NATION_PALETTE.get(nation, NATION_PALETTE["default"])
		OverlayMode.COVER:
			return Color(0.55, 0.55, 0.55, 0.35)  # neutral grey; cover cells render on top, gaps show grey not ocean blue
		_:
			return Color(0, 0, 0, 0)


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

	match _overlay_mode:
		OverlayMode.POLITICAL:
			if cover_layer:  cover_layer.visible = false
			if elev_layer:   elev_layer.visible = false
		OverlayMode.ELEVATION:
			if cover_layer:  cover_layer.visible = false
			if elev_layer:   elev_layer.visible = true
		OverlayMode.COVER:
			if cover_layer:  cover_layer.visible = true
			if elev_layer:   elev_layer.visible = false
