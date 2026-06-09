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
var is_move_mode: bool = false
var supply_status: String = "normal"
var stack_id: String = ""
var stack_position: int = -1  # -1 = not in a stack

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
	supply_status = data.get("supply_status", "normal")
	stack_id = data.get("stack_id", "")
	stack_position = int(data.get("stack_position", -1)) if stack_id != "" else -1
	queue_redraw()


func update_data(data: Dictionary) -> void:
	hp = float(data.get("hp", hp))
	is_moving = (data.get("move_order", []) as Array).size() > 0
	if data.has("supply_status"):
		supply_status = data["supply_status"]
	if data.has("stack_id"):
		stack_id = data["stack_id"]
		stack_position = int(data.get("stack_position", 0)) if stack_id != "" else -1
	queue_redraw()


func set_selected(selected: bool) -> void:
	if is_selected != selected:
		is_selected = selected
		queue_redraw()


func set_move_mode(active: bool) -> void:
	if is_move_mode != active:
		is_move_mode = active
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

	# Encirclement ring — most prominent supply indicator, drawn before selection ring
	if supply_status == "encircled":
		draw_arc(Vector2.ZERO, half_w + 8.0, 0.0, TAU, 32, Color(0.90, 0.10, 0.10, 0.90), 2.5)

	# Selection highlight — cyan ring in move mode, yellow ring otherwise
	if is_selected:
		var ring_color := Color(0.2, 1.0, 0.9, 0.95) if is_move_mode else Color(1.0, 0.9, 0.2, 0.9)
		draw_arc(Vector2.ZERO, half_w + 5.0, 0.0, TAU, 24, ring_color, 2.5)

	# NATO rectangle fill
	var rect := Rect2(-half_w, -half_h, RECT_W, RECT_H)
	draw_rect(rect, nation_color)
	draw_rect(rect, Color(0.05, 0.05, 0.05), false, 1.5)

	# Infantry cross symbol (two lines inside the rectangle)
	var cross_color := Color(0.0, 0.0, 0.0, 0.8)
	draw_line(Vector2(-half_w + 2, 0.0), Vector2(half_w - 2, 0.0), cross_color, 1.0)

	# Stack FRONT badge — gold strip on top edge when this division leads the stack
	if stack_position == 0 and stack_id != "":
		draw_rect(Rect2(-half_w, -half_h - 4.0, RECT_W, 3.0), Color(1.0, 0.80, 0.0, 0.95))
	elif stack_position > 0 and stack_id != "":
		# Non-front stack members: gray strip with position dot
		draw_rect(Rect2(-half_w, -half_h - 4.0, RECT_W, 3.0), Color(0.50, 0.50, 0.50, 0.80))
		draw_circle(Vector2(half_w - 3.0, -half_h - 2.5), 1.5, Color(1, 1, 1, 0.9))

	# HP bar below the rectangle
	var bar_x := -half_w
	var bar_w := RECT_W
	var fill_w := bar_w * clampf(hp / 100.0, 0.0, 1.0)
	draw_rect(Rect2(bar_x, HP_BAR_Y, bar_w, HP_BAR_H), Color(0.15, 0.15, 0.15))
	var hp_color := Color(0.2, 0.75, 0.2) if hp > 50 else (Color(0.85, 0.65, 0.1) if hp > 25 else Color(0.85, 0.15, 0.15))
	if fill_w > 0.0:
		draw_rect(Rect2(bar_x, HP_BAR_Y, fill_w, HP_BAR_H), hp_color)

	# Supply status indicators — below HP bar
	var indicator_y := HP_BAR_Y + HP_BAR_H + 3.0
	match supply_status:
		"out_of_supply":
			# Amber filled dot
			draw_circle(Vector2(-half_w + 3.0, indicator_y + 2.0), 2.5, Color(1.0, 0.65, 0.0, 0.95))
		"cut_off":
			# Red filled dot + X cross
			draw_circle(Vector2(-half_w + 3.0, indicator_y + 2.0), 2.5, Color(0.90, 0.10, 0.10, 0.95))
			var cx := -half_w + 3.0
			var cy := indicator_y + 2.0
			draw_line(Vector2(cx - 2, cy - 2), Vector2(cx + 2, cy + 2), Color(1, 1, 1, 0.9), 1.0)
			draw_line(Vector2(cx + 2, cy - 2), Vector2(cx - 2, cy + 2), Color(1, 1, 1, 0.9), 1.0)

	# Movement indicator: small arrow below supply area when moving
	var arrow_y := indicator_y + 6.0
	if is_moving:
		draw_line(Vector2(0, arrow_y), Vector2(0, arrow_y + 6), Color(1, 1, 1, 0.7), 1.5)
		draw_line(Vector2(-2, arrow_y + 4), Vector2(0, arrow_y + 7), Color(1, 1, 1, 0.7), 1.5)
		draw_line(Vector2(2, arrow_y + 4), Vector2(0, arrow_y + 7), Color(1, 1, 1, 0.7), 1.5)
