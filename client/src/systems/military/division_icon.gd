extends Node2D
## Visual representation of one division on the strategic map.
## Draws NATO rectangle, HP bar, and engagement/observation radius circles.
## Position is driven externally by MilitarySystem LERP; call update_data() on state change.

var division_id: String = ""
var nation_color: Color = Color(0.6, 0.6, 0.6)
var hp: float = 100.0
var max_hp: float = 100.0
var suppression: float = 0.0
var engagement_radius_px: float = 60.0
var observation_radius_px: float = 45.0
var scouting_radius_px: float = 60.0
var is_selected: bool = false
var is_active_selection: bool = false
var is_selection_previewed: bool = false
var is_moving: bool = false
var is_move_mode: bool = false
var supply_status: String = "normal"
var combat_state: String = "idle"
var is_meeting_battle: bool = false
var stack_id: String = ""
var stack_position: int = -1  # -1 = not in a stack
var stack_count: int = 0

# NATO rectangle dimensions in pixels
const RECT_W := 22.0
const RECT_H := 14.0
const HP_BAR_H := 3.0
const STATUS_BAR_GAP := 1.0
const SUPPRESSION_BAR_Y := RECT_H * 0.5 + 3.0
const HP_BAR_Y := SUPPRESSION_BAR_Y + HP_BAR_H + STATUS_BAR_GAP
const SELECTION_RADIUS := RECT_W * 0.5 + 12.0
const EMPHASIS_TRANSITION_SECONDS := 0.12

var _visual_emphasis_target: float = 1.0
var _visual_emphasis_tween: Tween = null


## Division icons redraw only when their externally driven state changes.
##
## Returns: Nothing.
func _ready() -> void:
	set_process(false)


func setup(data: Dictionary, color: Color, eng_px: float, obs_px: float, scout_px: float) -> void:
	division_id = data.get("division_id", "")
	nation_color = color
	hp = float(data.get("hp", 100))
	max_hp = float(data.get("max_hp", 100))
	suppression = float(data.get("suppression", 0))
	engagement_radius_px = eng_px
	observation_radius_px = obs_px
	scouting_radius_px = scout_px
	combat_state = data.get("combat_state", "idle")
	is_meeting_battle = data.get("is_meeting_battle", false)
	# Suppress movement arrow while locked in combat — unit is not free to move
	is_moving = (data.get("move_order", []) as Array).size() > 0 \
		and combat_state not in ["engaged", "suppressed"]
	supply_status = data.get("supply_status", "normal")
	stack_id = data.get("stack_id", "")
	stack_position = int(data.get("stack_position", -1)) if stack_id != "" else -1
	queue_redraw()


func update_data(data: Dictionary) -> void:
	hp = float(data.get("hp", hp))
	max_hp = float(data.get("max_hp", max_hp))
	suppression = float(data.get("suppression", suppression))
	if data.has("combat_state"):
		combat_state = data["combat_state"]
		is_moving = (data.get("move_order", []) as Array).size() > 0 \
			and combat_state not in ["engaged", "suppressed"]
	if data.has("supply_status"):
		supply_status = data["supply_status"]
	if data.has("stack_id"):
		stack_id = data["stack_id"]
		stack_position = int(data.get("stack_position", 0)) if stack_id != "" else -1
	if data.has("is_meeting_battle"):
		is_meeting_battle = data["is_meeting_battle"]
	queue_redraw()


func set_selected(selected: bool) -> void:
	if is_selected != selected:
		is_selected = selected
		if is_selected:
			is_selection_previewed = false
		else:
			is_active_selection = false
		queue_redraw()


## Marks this selected counter as the active member of a multi-selection.
## Parameters:
## - active: whether this counter owns the contextual inspector anchor.
## Returns: nothing.
func set_active_selection(active: bool) -> void:
	if is_active_selection == active:
		return
	is_active_selection = active
	queue_redraw()


func set_selection_preview(active: bool) -> void:
	if is_selection_previewed != active:
		is_selection_previewed = active
		queue_redraw()


## Applies selection emphasis independently from reveal and conceal animation alpha.
func set_visual_emphasis(emphasis: float) -> void:
	var target: float = clampf(emphasis, 0.0, 1.0)
	if is_equal_approx(_visual_emphasis_target, target):
		return
	_visual_emphasis_target = target
	if _visual_emphasis_tween != null:
		_visual_emphasis_tween.kill()
	if not is_inside_tree():
		self_modulate.a = target
		return
	_visual_emphasis_tween = create_tween()
	_visual_emphasis_tween.set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_visual_emphasis_tween.tween_property(
		self,
		"self_modulate:a",
		target,
		EMPHASIS_TRANSITION_SECONDS
	)


## Returns the current independent visual-emphasis factor.
func get_visual_emphasis() -> float:
	return _visual_emphasis_target


func set_move_mode(active: bool) -> void:
	if is_move_mode != active:
		is_move_mode = active
		queue_redraw()


func set_moving(active: bool) -> void:
	if is_moving != active:
		is_moving = active
		queue_redraw()


func _draw() -> void:
	var half_w := RECT_W * 0.5
	var half_h := RECT_H * 0.5

	# Ranges are selection affordances, not permanent illumination.
	if is_selected and is_active_selection:
		draw_arc(
			Vector2.ZERO, scouting_radius_px, 0.0, TAU, 64,
			Color(0.72, 0.82, 0.92, 0.28), 1.0
		)
		draw_arc(
			Vector2.ZERO, observation_radius_px, 0.0, TAU, 64,
			Color(0.92, 0.96, 1.0, 0.42), 1.5
		)

	# Engagement circle — color and weight reflect combat state
	match combat_state:
		"engaged":
			draw_arc(Vector2.ZERO, engagement_radius_px, 0.0, TAU, 64, Color(1.0, 0.65, 0.1, 0.70), 2.5)
		"suppressed":
			draw_arc(Vector2.ZERO, engagement_radius_px, 0.0, TAU, 64, Color(0.9, 0.15, 0.15, 0.80), 2.5)
		"retreating":
			draw_arc(Vector2.ZERO, engagement_radius_px, 0.0, TAU, 64, Color(0.9, 0.45, 0.1, 0.50), 1.5)
		_:
			draw_arc(Vector2.ZERO, engagement_radius_px, 0.0, TAU, 48, Color(nation_color.r, nation_color.g, nation_color.b, 0.20), 1.0)

	# Encirclement ring — most prominent supply indicator, drawn before selection ring
	if supply_status == "encircled":
		draw_arc(Vector2.ZERO, half_w + 8.0, 0.0, TAU, 32, Color(0.90, 0.10, 0.10, 0.90), 2.5)

	# Drag-box preview — neutral grey halo for units that would be selected on release.
	if is_selection_previewed and not is_selected:
		var preview_radius: float = SELECTION_RADIUS
		draw_circle(Vector2.ZERO, preview_radius, Color(0.72, 0.72, 0.72, 0.13))
		draw_arc(Vector2.ZERO, preview_radius, 0.0, TAU, 48, Color(0.82, 0.82, 0.82, 0.82), 4.0)
		draw_arc(Vector2.ZERO, preview_radius - 4.0, 0.0, TAU, 48, Color(0.20, 0.20, 0.20, 0.75), 2.0)

	# NATO rectangle fill
	var rect := Rect2(-half_w, -half_h, RECT_W, RECT_H)
	draw_rect(rect, nation_color)
	draw_rect(rect, Color(0.05, 0.05, 0.05), false, 1.5)

	# Combat state border overlay
	match combat_state:
		"engaged":
			var border_color: Color = Color(0.85, 0.2, 0.85, 0.85) if is_meeting_battle \
			                          else Color(1.0, 0.65, 0.1, 0.80)
			draw_rect(rect, border_color, false, 2.5)
			if is_meeting_battle:
				draw_line(Vector2(0, rect.position.y), Vector2(0, rect.position.y + 5), border_color, 2.0)
				draw_line(Vector2(0, rect.end.y),      Vector2(0, rect.end.y - 5),      border_color, 2.0)
		"suppressed":
			draw_rect(rect, Color(0.9, 0.15, 0.15, 0.90), false, 2.5)
		"retreating":
			draw_rect(rect, Color(0.9, 0.45, 0.1, 0.85), false, 2.0)
		"destroyed":
			draw_rect(rect, Color(0.25, 0.25, 0.25, 0.85), false, 2.0)
			draw_line(rect.position, rect.end, Color(0.25, 0.25, 0.25, 0.85), 1.5)

	# Infantry cross symbol (two lines inside the rectangle)
	var cross_color := Color(0.0, 0.0, 0.0, 0.8)
	draw_line(Vector2(-half_w + 2, 0.0), Vector2(half_w - 2, 0.0), cross_color, 1.0)

	# Stack count badge — white circle with number in top-right corner
	if stack_count > 1:
		var badge_center := Vector2(rect.end.x - 5, rect.position.y + 5)
		draw_circle(badge_center, 5.5, Color(1, 1, 1, 0.9))
		draw_string(ThemeDB.fallback_font, badge_center + Vector2(-3, 4),
			str(stack_count), HORIZONTAL_ALIGNMENT_LEFT, -1, 8, Color(0, 0, 0, 1))

	# Stack FRONT badge — gold strip on top edge when this division leads the stack
	if stack_position == 0 and stack_id != "":
		draw_rect(Rect2(-half_w, -half_h - 4.0, RECT_W, 3.0), Color(1.0, 0.80, 0.0, 0.95))
	elif stack_position > 0 and stack_id != "":
		# Non-front stack members: gray strip with position dot
		draw_rect(Rect2(-half_w, -half_h - 4.0, RECT_W, 3.0), Color(0.50, 0.50, 0.50, 0.80))
		draw_circle(Vector2(half_w - 3.0, -half_h - 2.5), 1.5, Color(1, 1, 1, 0.9))

	# Suppression fills from left to right as danger increases.
	var bar_x := -half_w
	var bar_w := RECT_W
	var suppression_fill_w: float = bar_w * clampf(suppression / 100.0, 0.0, 1.0)
	draw_rect(Rect2(bar_x, SUPPRESSION_BAR_Y, bar_w, HP_BAR_H), Color(0.15, 0.15, 0.15))
	if suppression_fill_w > 0.0:
		var suppression_color := Color(0.95, 0.32, 0.12) if suppression >= 70.0 else Color(0.90, 0.62, 0.12)
		draw_rect(Rect2(bar_x, SUPPRESSION_BAR_Y, suppression_fill_w, HP_BAR_H), suppression_color)
	for segment_index: int in range(1, 4):
		var segment_x: float = bar_x + (bar_w * float(segment_index) / 4.0)
		draw_line(Vector2(segment_x, SUPPRESSION_BAR_Y), Vector2(segment_x, SUPPRESSION_BAR_Y + HP_BAR_H), Color(0.08, 0.08, 0.08, 0.75), 1.0)

	# HP depletes from left to right beneath suppression.
	var hp_ratio: float = hp / max_hp if max_hp > 0.0 else 0.0
	var fill_w: float = bar_w * clampf(hp_ratio, 0.0, 1.0)
	draw_rect(Rect2(bar_x, HP_BAR_Y, bar_w, HP_BAR_H), Color(0.15, 0.15, 0.15))
	var hp_color := Color(0.2, 0.75, 0.2) if hp_ratio > 0.5 else (Color(0.85, 0.65, 0.1) if hp_ratio > 0.25 else Color(0.85, 0.15, 0.15))
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

	# Movement indicator: small arrow below supply area when moving.
	# Orange-red when retreating from combat, white otherwise.
	var arrow_y := indicator_y + 6.0
	if is_moving:
		var arrow_color: Color = Color(0.9, 0.35, 0.1, 0.9) if combat_state == "retreating" else Color(1, 1, 1, 0.7)
		draw_line(Vector2(0, arrow_y), Vector2(0, arrow_y + 6), arrow_color, 1.5)
		draw_line(Vector2(-2, arrow_y + 4), Vector2(0, arrow_y + 7), arrow_color, 1.5)
		draw_line(Vector2(2, arrow_y + 4), Vector2(0, arrow_y + 7), arrow_color, 1.5)


func reveal() -> void:
	modulate.a = 0.0
	scale = Vector2(0.8, 0.8)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(self, "modulate:a", 1.0, 0.3).set_ease(Tween.EASE_OUT)
	tw.tween_property(self, "scale", Vector2.ONE, 0.3).set_ease(Tween.EASE_OUT)


func conceal() -> Signal:
	var tw := create_tween()
	tw.tween_property(self, "modulate:a", 0.0, 0.4)
	return tw.finished
