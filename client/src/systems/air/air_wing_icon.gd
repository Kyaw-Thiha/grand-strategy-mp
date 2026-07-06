extends Node2D

var wing_id: String = ""
var nation_id: String = ""
var nation_color: Color = Color(0.5, 0.5, 0.5)
var aircraft_type: String = "fighter"
var wing_count: int = 10
var combat_readiness: float = 1.0
var lifecycle_state: String = "idle"
var is_selected: bool = false

const DIAMOND_HALF    := 11.0
const READINESS_BAR_H := 3.0
const READINESS_BAR_Y := DIAMOND_HALF + 4.0
const BADGE_RADIUS    := 5.5


func _ready() -> void:
	set_process(false)


func setup(data: Dictionary, color: Color) -> void:
	wing_id          = data.get("wing_id", "")
	nation_id        = data.get("nation_id", "")
	nation_color     = color
	aircraft_type    = data.get("aircraft_type", "fighter")
	wing_count       = data.get("count", 10)
	combat_readiness = float(data.get("combat_readiness", 1.0))
	lifecycle_state  = data.get("lifecycle_state", "idle")
	_update_visibility()
	queue_redraw()


func update_data(data: Dictionary) -> void:
	wing_count       = data.get("count", wing_count)
	combat_readiness = float(data.get("combat_readiness", combat_readiness))
	lifecycle_state  = data.get("lifecycle_state", lifecycle_state)
	aircraft_type    = data.get("aircraft_type", aircraft_type)
	_update_visibility()
	queue_redraw()


func _update_visibility() -> void:
	visible = not lifecycle_state.is_empty()


func _readiness_color() -> Color:
	if combat_readiness >= 0.7:
		return Color(0.2, 0.85, 0.2)
	elif combat_readiness >= 0.4:
		return Color(0.9, 0.8, 0.1)
	else:
		return Color(0.9, 0.2, 0.1)


func _should_show_count_badge() -> bool:
	return wing_count > 1


func _lifecycle_color() -> Color:
	match lifecycle_state:
		"transit":  return Color(0.267, 0.533, 1.0)
		"engaged":  return Color(1.0, 0.267, 0.267)
		"loiter":   return Color(1.0, 0.533, 0.0)
		"rtb":      return Color(0.667, 0.267, 1.0)
		"refuel":   return Color(0.0, 0.8, 0.8)
		_:          return Color(0.5, 0.5, 0.5)


func set_selected(selected: bool) -> void:
	if is_selected != selected:
		is_selected = selected
		queue_redraw()


func _draw() -> void:
	var points := PackedVector2Array([
		Vector2(0,            -DIAMOND_HALF),
		Vector2(DIAMOND_HALF,  0),
		Vector2(0,             DIAMOND_HALF),
		Vector2(-DIAMOND_HALF, 0),
	])
	draw_colored_polygon(points, nation_color)
	var border_color: Color = _lifecycle_color() if lifecycle_state != "idle" else Color(0.1, 0.1, 0.1, 0.9)
	draw_polyline(
		PackedVector2Array([points[0], points[1], points[2], points[3], points[0]]),
		border_color, 2.5
	)
	_draw_aircraft_symbol()

	if is_selected:
		draw_arc(Vector2.ZERO, DIAMOND_HALF + 7.0, 0.0, TAU, 32,
				Color(1.0, 0.78, 0.08, 0.96), 2.0)

	var bar_w := DIAMOND_HALF * 2.0
	var bar_x := -DIAMOND_HALF
	draw_rect(Rect2(bar_x, READINESS_BAR_Y, bar_w, READINESS_BAR_H),
			Color(0.2, 0.2, 0.2, 0.8))
	draw_rect(Rect2(bar_x, READINESS_BAR_Y, bar_w * combat_readiness, READINESS_BAR_H),
			_readiness_color())

	if _should_show_count_badge():
		var badge_pos := Vector2(DIAMOND_HALF - 2.0, -DIAMOND_HALF + 2.0)
		draw_circle(badge_pos, BADGE_RADIUS, Color(1.0, 1.0, 1.0, 0.9))
		draw_string(ThemeDB.fallback_font, badge_pos + Vector2(-3, 4),
				str(wing_count), HORIZONTAL_ALIGNMENT_LEFT, -1, 8, Color(0.0, 0.0, 0.0, 1.0))


func _draw_aircraft_symbol() -> void:
	var c := Color(1.0, 1.0, 1.0, 0.85)
	draw_line(Vector2(-7,  2), Vector2(0, -3), c, 1.5)
	draw_line(Vector2( 7,  2), Vector2(0, -3), c, 1.5)
	draw_line(Vector2( 0, -3), Vector2(0,  5), c, 1.0)
