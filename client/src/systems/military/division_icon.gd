extends Node2D
## Visual representation of one division on the strategic map.
## Draws NATO rectangle, HP bar, and engagement/observation radius circles.
## Position is driven externally by MilitarySystem LERP; call update_data() on state change.

var division_id: String = ""
var nation_color: Color = Color(0.6, 0.6, 0.6)
var hp: float = 100.0
var engagement_radius_px: float = 60.0
var observation_radius_px: float = 45.0
var scouting_radius_px: float = 60.0
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
const SELECTION_RADIUS := RECT_W * 0.5 + 12.0
const SELECTION_LINE_WIDTH := 5.0
const SELECTION_INNER_LINE_WIDTH := 2.0
const SELECTION_ANIMATION_DURATION := 0.1
const SELECTION_ANIMATION_RADIUS_BOOST := 8.0
const SELECTION_NORMAL_COLOR := Color(1.0, 0.78, 0.08, 0.96)
const SELECTION_MOVE_COLOR := Color(0.05, 0.95, 1.0, 0.96)

var _selection_animation_elapsed: float = SELECTION_ANIMATION_DURATION
var _selection_color_elapsed: float = SELECTION_ANIMATION_DURATION
var _selection_color_start: Color = SELECTION_NORMAL_COLOR
var _selection_color_target: Color = SELECTION_NORMAL_COLOR
var _selection_color_current: Color = SELECTION_NORMAL_COLOR


## Disables per-frame work until the icon needs to play a selection animation.
##
## Returns: Nothing.
func _ready() -> void:
	set_process(false)


func setup(data: Dictionary, color: Color, eng_px: float, obs_px: float, scout_px: float) -> void:
	division_id = data.get("division_id", "")
	nation_color = color
	hp = float(data.get("hp", 100))
	engagement_radius_px = eng_px
	observation_radius_px = obs_px
	scouting_radius_px = scout_px
	is_moving = (data.get("move_order", []) as Array).size() > 0
	supply_status = data.get("supply_status", "normal")
	stack_id = data.get("stack_id", "")
	stack_position = int(data.get("stack_position", -1)) if stack_id != "" else -1
	queue_redraw()


func update_data(data: Dictionary) -> void:
	hp = float(data.get("hp", hp))
	if data.has("supply_status"):
		supply_status = data["supply_status"]
	if data.has("stack_id"):
		stack_id = data["stack_id"]
		stack_position = int(data.get("stack_position", 0)) if stack_id != "" else -1
	queue_redraw()


func set_selected(selected: bool) -> void:
	if is_selected != selected:
		is_selected = selected
		if is_selected:
			_selection_color_target = _get_selection_target_color()
			_selection_color_start = _selection_color_target
			_selection_color_current = _selection_color_target
			_selection_color_elapsed = SELECTION_ANIMATION_DURATION
			_selection_animation_elapsed = 0.0
			set_process(true)
		else:
			_selection_animation_elapsed = SELECTION_ANIMATION_DURATION
			_selection_color_elapsed = SELECTION_ANIMATION_DURATION
			set_process(false)
		queue_redraw()


func set_move_mode(active: bool) -> void:
	if is_move_mode != active:
		is_move_mode = active
		_start_selection_color_transition()
		queue_redraw()


func set_moving(active: bool) -> void:
	if is_moving != active:
		is_moving = active
		queue_redraw()


## Advances the short selection pop animation and stops processing once it settles.
##
## Parameters:
## - delta: Seconds elapsed since the previous rendered frame.
##
## Returns: Nothing.
func _process(delta: float) -> void:
	if not is_selected:
		set_process(false)
		return

	var should_keep_processing: bool = false

	if _selection_animation_elapsed < SELECTION_ANIMATION_DURATION:
		_selection_animation_elapsed += delta
		if _selection_animation_elapsed >= SELECTION_ANIMATION_DURATION:
			_selection_animation_elapsed = SELECTION_ANIMATION_DURATION
		else:
			should_keep_processing = true

	if _selection_color_elapsed < SELECTION_ANIMATION_DURATION:
		_selection_color_elapsed += delta
		if _selection_color_elapsed >= SELECTION_ANIMATION_DURATION:
			_selection_color_elapsed = SELECTION_ANIMATION_DURATION
			_selection_color_current = _selection_color_target
		else:
			should_keep_processing = true
			var color_progress: float = _ease_out_cubic(_selection_color_elapsed / SELECTION_ANIMATION_DURATION)
			_selection_color_current = _selection_color_start.lerp(_selection_color_target, color_progress)

	set_process(should_keep_processing)

	queue_redraw()


## Starts a short selected-ring color transition when the selected unit changes mode.
##
## Returns: Nothing.
func _start_selection_color_transition() -> void:
	_selection_color_target = _get_selection_target_color()
	if not is_selected:
		_selection_color_start = _selection_color_target
		_selection_color_current = _selection_color_target
		_selection_color_elapsed = SELECTION_ANIMATION_DURATION
		return

	_selection_color_start = _selection_color_current
	_selection_color_elapsed = 0.0
	set_process(true)


## Returns the high-contrast selection color for the current interaction mode.
##
## Returns: Cyan while move mode is active, otherwise amber.
func _get_selection_target_color() -> Color:
	return SELECTION_MOVE_COLOR if is_move_mode else SELECTION_NORMAL_COLOR


## Applies a quick ease-out curve for snappy selection feedback.
##
## Parameters:
## - value: Normalized animation progress from 0.0 to 1.0.
##
## Returns: Eased animation progress from 0.0 to 1.0.
func _ease_out_cubic(value: float) -> float:
	var clamped_value: float = clampf(value, 0.0, 1.0)
	return 1.0 - pow(1.0 - clamped_value, 3.0)


func _draw() -> void:
	var half_w := RECT_W * 0.5
	var half_h := RECT_H * 0.5

	# Scouting soft field — outermost, very faint filled disc, drawn first (behind everything)
	draw_circle(Vector2.ZERO, scouting_radius_px,    Color(1.0, 1.0, 1.0, 0.06))
	# Observation soft field — inner filled disc; overlaps center to create a gradient effect
	draw_circle(Vector2.ZERO, observation_radius_px, Color(1.0, 1.0, 1.0, 0.18))

	# Engagement circle
	var eng_color := Color(nation_color.r, nation_color.g, nation_color.b, 0.5)
	draw_arc(Vector2.ZERO, engagement_radius_px, 0.0, TAU, 48, eng_color, 1.5)

	# Encirclement ring — most prominent supply indicator, drawn before selection ring
	if supply_status == "encircled":
		draw_arc(Vector2.ZERO, half_w + 8.0, 0.0, TAU, 32, Color(0.90, 0.10, 0.10, 0.90), 2.5)

	# Selection highlight — cyan ring in move mode, yellow ring otherwise
	if is_selected:
		var animation_progress: float = clampf(_selection_animation_elapsed / SELECTION_ANIMATION_DURATION, 0.0, 1.0)
		var animation_pop: float = 1.0 - animation_progress
		var selection_radius: float = SELECTION_RADIUS + (SELECTION_ANIMATION_RADIUS_BOOST * animation_pop)
		var selection_line_width: float = SELECTION_LINE_WIDTH + (2.0 * animation_pop)
		var ring_color: Color = _selection_color_current
		var halo_color: Color = Color(ring_color.r, ring_color.g, ring_color.b, 0.12 + (0.08 * animation_pop))
		var backing_color: Color = Color(nation_color.r * 0.20, nation_color.g * 0.20, nation_color.b * 0.20, 0.92)
		var outer_ring_color: Color = Color(ring_color.r, ring_color.g, ring_color.b, 0.88 + (0.12 * animation_pop))
		var inner_ring_color: Color = Color(1.0, 1.0, 1.0, 0.65 + (0.25 * animation_pop))
		draw_circle(Vector2.ZERO, selection_radius, halo_color)
		draw_arc(Vector2.ZERO, selection_radius, 0.0, TAU, 48, backing_color, selection_line_width + 4.0)
		draw_arc(Vector2.ZERO, selection_radius, 0.0, TAU, 48, outer_ring_color, selection_line_width)
		draw_arc(Vector2.ZERO, selection_radius - 4.0, 0.0, TAU, 48, inner_ring_color, SELECTION_INNER_LINE_WIDTH)

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
