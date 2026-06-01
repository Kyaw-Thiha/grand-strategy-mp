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

var _map_loader: Node = null
var _data_source: Object = null
var _overlay_mode: OverlayMode = OverlayMode.POLITICAL
var _highlighted: Dictionary = {}   # province_id → original Color


func setup(map_loader: Node, data_source: Object) -> void:
	_map_loader = map_loader
	_data_source = data_source


func on_map_loaded(_province_count: int) -> void:
	_refresh_all()
	_set_overlay_layer_visibility()


func set_overlay_mode(mode: String) -> void:
	match mode:
		"political":  _overlay_mode = OverlayMode.POLITICAL
		"elevation":  _overlay_mode = OverlayMode.ELEVATION
		"cover":      _overlay_mode = OverlayMode.COVER
	_highlighted.clear()
	_refresh_all()
	_set_overlay_layer_visibility()


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
		_:
			return Color(0, 0, 0, 0)


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
