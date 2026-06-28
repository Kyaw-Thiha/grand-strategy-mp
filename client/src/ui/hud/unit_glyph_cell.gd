class_name UnitGlyphCell
extends Control
## Draws a NATO-style unit symbol for one 5×5 grid cell.
## Emits cell_clicked when left-clicked, cell_right_clicked when right-clicked.
## Set unit_type = "" for an empty cell (dashed border + plus sign).
## Set is_selected = true for teal highlight border.

signal cell_clicked(cell: UnitGlyphCell)
signal cell_right_clicked(cell: UnitGlyphCell)

const CELL_SIZE    := 72.0
const BORDER_TEAL  := Color(0.2,  0.7,  0.7,  1.0)
const BORDER_FILLED:= Color(0.5,  0.4,  0.3,  0.9)
const BORDER_HOVER := Color(0.7,  0.65, 0.5,  1.0)
const BORDER_EMPTY := Color(0.5,  0.4,  0.3,  0.5)
const BG_FILLED    := Color(0.12, 0.09, 0.06, 0.9)

const UNIT_ABBREV: Dictionary = {
	"infantry": "INF",         "assault_infantry": "ASI",  "recon_infantry": "RCN",
	"mg": "MG",                "cavalry": "CAV",           "light_tank": "LTK",
	"medium_tank": "MTK",      "heavy_tank": "HTK",        "armoured_car": "APC",
	"at_infantry": "ATI",      "at_gun": "ATG",            "at_gun_sp": "SPA",
	"aa_gun": "AA",            "sniper": "SNP",            "flamethrower": "FLM",
	"artillery": "ART",        "commando": "CMD",
	"force_recon_sniper": "FRS","howitzer": "HOW",          "self_propelled_gun": "SPG",
}

const _CROSS_TYPES := ["infantry", "assault_infantry", "mg", "commando",
	"flamethrower", "at_infantry", "sniper"]
const _OVAL_TYPES  := ["light_tank", "medium_tank", "heavy_tank",
	"armoured_car", "at_gun_sp", "self_propelled_gun"]
const _DOT_TYPES   := ["artillery", "howitzer"]

const _COLOR_INF   := Color(0.42, 0.49, 0.18, 1.0)
const _COLOR_ARM   := Color(0.29, 0.43, 0.65, 1.0)
const _COLOR_ART   := Color(0.55, 0.13, 0.13, 1.0)
const _COLOR_RCN   := Color(0.10, 0.55, 0.50, 1.0)
const _COLOR_CAV   := Color(0.55, 0.40, 0.10, 1.0)
const _COLOR_ATG   := Color(0.55, 0.35, 0.10, 1.0)
const _COLOR_AA    := Color(0.30, 0.30, 0.60, 1.0)

var unit_type: String = "":
	set(v):
		unit_type = v
		queue_redraw()

var is_selected: bool = false:
	set(v):
		is_selected = v
		queue_redraw()

var _hovered: bool = false


func _ready() -> void:
	custom_minimum_size = Vector2(CELL_SIZE, CELL_SIZE)
	mouse_filter = MOUSE_FILTER_STOP
	mouse_entered.connect(func() -> void:
		_hovered = true
		queue_redraw()
	)
	mouse_exited.connect(func() -> void:
		_hovered = false
		queue_redraw()
	)


func _gui_input(event: InputEvent) -> void:
	if not (event is InputEventMouseButton):
		return
	var mb := event as InputEventMouseButton
	if not mb.pressed:
		return
	if mb.button_index == MOUSE_BUTTON_LEFT:
		cell_clicked.emit(self)
		accept_event()
	elif mb.button_index == MOUSE_BUTTON_RIGHT:
		cell_right_clicked.emit(self)
		accept_event()


func _draw() -> void:
	var pad   := 4.0
	var inner := Rect2(Vector2(pad, pad), size - Vector2(pad * 2.0, pad * 2.0))

	if unit_type == "":
		_draw_empty_cell(inner)
	else:
		_draw_filled_cell(inner)


func _draw_empty_cell(inner: Rect2) -> void:
	var border_color: Color = BORDER_EMPTY
	if _hovered:
		border_color = Color(0.6, 0.5, 0.4, 0.65)
		draw_rect(inner, Color(0.15, 0.12, 0.08, 0.3))
	_draw_dashed_rect(inner, border_color, 1.5, 7.0, 5.0)
	var center := inner.get_center()
	var lc := Color(0.5, 0.45, 0.35, 0.55)
	draw_line(center + Vector2(-6, 0), center + Vector2(6, 0), lc, 1.5)
	draw_line(center + Vector2(0, -6), center + Vector2(0, 6), lc, 1.5)


func _draw_filled_cell(inner: Rect2) -> void:
	draw_rect(inner, BG_FILLED)
	var border: Color
	if is_selected:
		border = BORDER_TEAL
	elif _hovered:
		border = BORDER_HOVER
	else:
		border = BORDER_FILLED
	draw_rect(inner, border, false, 2.0 if is_selected else 1.5)

	var glyph_rect := Rect2(
		inner.position + Vector2(8, 6),
		Vector2(inner.size.x - 16, inner.size.y - 26)
	)
	_draw_glyph(glyph_rect, unit_type)

	var abbrev: String = UNIT_ABBREV.get(unit_type, "???")
	var font := get_theme_default_font()
	var abbrev_x := inner.position.x + inner.size.x * 0.5
	var abbrev_y := inner.end.y - 4.0
	draw_string(font, Vector2(abbrev_x, abbrev_y), abbrev,
		HORIZONTAL_ALIGNMENT_CENTER, -1, 9, _get_unit_color(unit_type))


func _draw_glyph(rect: Rect2, utype: String) -> void:
	var color   := _get_unit_color(utype)
	var center  := rect.get_center()
	var thick   := 2.0

	if utype in _OVAL_TYPES:
		var rx := rect.size.x * 0.38
		var ry := rect.size.y * 0.30
		var pts: PackedVector2Array = PackedVector2Array()
		var steps := 32
		for i: int in range(steps + 1):
			var angle := (float(i) / steps) * TAU
			pts.append(Vector2(center.x + rx * cos(angle), center.y + ry * sin(angle)))
		for i: int in range(pts.size() - 1):
			draw_line(pts[i], pts[i + 1], color, thick)

	elif utype in _DOT_TYPES:
		draw_circle(center, min(rect.size.x, rect.size.y) * 0.28, color)

	elif utype in _CROSS_TYPES:
		draw_line(rect.position,
			rect.position + rect.size, color, thick)
		draw_line(
			Vector2(rect.end.x, rect.position.y),
			Vector2(rect.position.x, rect.end.y), color, thick)

	else:
		draw_line(
			Vector2(rect.end.x, rect.position.y),
			Vector2(rect.position.x, rect.end.y), color, thick)


func _get_unit_color(utype: String) -> Color:
	if utype in _OVAL_TYPES:       return _COLOR_ARM
	if utype in _DOT_TYPES:        return _COLOR_ART
	if utype == "recon_infantry" or utype == "force_recon_sniper":
		return _COLOR_RCN
	if utype == "cavalry":          return _COLOR_CAV
	if utype == "at_gun":           return _COLOR_ATG
	if utype == "aa_gun":           return _COLOR_AA
	return _COLOR_INF


func _draw_dashed_rect(rect: Rect2, color: Color, width: float,
		dash: float, gap: float) -> void:
	var corners := [
		rect.position,
		Vector2(rect.end.x, rect.position.y),
		rect.end,
		Vector2(rect.position.x, rect.end.y),
	]
	for i: int in range(4):
		_draw_dashed_line(corners[i], corners[(i + 1) % 4], color, width, dash, gap)


func _draw_dashed_line(from: Vector2, to: Vector2, color: Color,
		width: float, dash: float, gap: float) -> void:
	var dir   := (to - from).normalized()
	var total := from.distance_to(to)
	var pos   := 0.0
	var on    := true
	while pos < total:
		var seg := dash if on else gap
		var end: float = min(pos + seg, total)
		if on:
			draw_line(from + dir * pos, from + dir * end, color, width)
		pos = end
		on  = not on
