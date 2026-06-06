extends Node2D
## Visual representation of one division on the strategic map.
## Draws NATO rectangle, HP bar, and engagement/observation radius circles.
## Position is driven externally by MilitarySystem LERP; call update_data() on state change.

var division_id: String = ""
var nation_color: Color = Color(0.6, 0.6, 0.6)
var hp: float = 100.0
var engagement_radius_px: float = 60.0
var observation_radius_px: float = 120.0
var is_selected: bool = false
var is_moving: bool = false

# NATO rectangle dimensions in pixels
const RECT_W := 22.0
const RECT_H := 14.0
const HP_BAR_H := 3.0
const HP_BAR_Y := RECT_H * 0.5 + 3.0


func setup(data: Dictionary, color: Color, eng_px: float, obs_px: float) -> void:
	division_id = data.get("division_id", "")
	nation_color = color
	hp = float(data.get("hp", 100))
	engagement_radius_px = eng_px
	observation_radius_px = obs_px
	is_moving = (data.get("move_order", []) as Array).size() > 0
	queue_redraw()


func update_data(data: Dictionary) -> void:
	hp = float(data.get("hp", hp))
	is_moving = (data.get("move_order", []) as Array).size() > 0
	queue_redraw()


func set_selected(selected: bool) -> void:
	if is_selected != selected:
		is_selected = selected
		queue_redraw()


func _draw() -> void:
	var half_w := RECT_W * 0.5
	var half_h := RECT_H * 0.5

	# Observation circle — large faded ring, drawn first (behind everything)
	draw_arc(Vector2.ZERO, observation_radius_px, 0.0, TAU, 48,
		Color(1.0, 1.0, 1.0, 0.12), 1.0)

	# Engagement circle
	var eng_color := Color(nation_color.r, nation_color.g, nation_color.b, 0.5)
	draw_arc(Vector2.ZERO, engagement_radius_px, 0.0, TAU, 48, eng_color, 1.5)

	# Selection highlight
	if is_selected:
		draw_arc(Vector2.ZERO, half_w + 5.0, 0.0, TAU, 24, Color(1.0, 0.9, 0.2, 0.9), 2.5)

	# NATO rectangle fill
	var rect := Rect2(-half_w, -half_h, RECT_W, RECT_H)
	draw_rect(rect, nation_color)
	draw_rect(rect, Color(0.05, 0.05, 0.05), false, 1.5)

	# Infantry cross symbol (two lines inside the rectangle)
	var cross_color := Color(0.0, 0.0, 0.0, 0.8)
	draw_line(Vector2(-half_w + 2, 0.0), Vector2(half_w - 2, 0.0), cross_color, 1.0)

	# HP bar below the rectangle
	var bar_x := -half_w
	var bar_w := RECT_W
	var fill_w := bar_w * clampf(hp / 100.0, 0.0, 1.0)
	draw_rect(Rect2(bar_x, HP_BAR_Y, bar_w, HP_BAR_H), Color(0.15, 0.15, 0.15))
	var hp_color := Color(0.2, 0.75, 0.2) if hp > 50 else (Color(0.85, 0.65, 0.1) if hp > 25 else Color(0.85, 0.15, 0.15))
	if fill_w > 0.0:
		draw_rect(Rect2(bar_x, HP_BAR_Y, fill_w, HP_BAR_H), hp_color)

	# Movement indicator: small arrow below HP bar when moving
	if is_moving:
		var arrow_y := HP_BAR_Y + HP_BAR_H + 3.0
		draw_line(Vector2(0, arrow_y), Vector2(0, arrow_y + 6), Color(1, 1, 1, 0.7), 1.5)
		draw_line(Vector2(-2, arrow_y + 4), Vector2(0, arrow_y + 7), Color(1, 1, 1, 0.7), 1.5)
		draw_line(Vector2(2, arrow_y + 4), Vector2(0, arrow_y + 7), Color(1, 1, 1, 0.7), 1.5)
