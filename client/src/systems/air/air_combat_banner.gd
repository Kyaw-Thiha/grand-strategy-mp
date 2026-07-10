extends Node2D
## Timed map indicator for a resolved air combat engagement.

const CIRCLE_R:         float   = 14.0
const DISPLAY_DURATION: float   = 4.0
const ICON_SIZE:        Vector2 = Vector2(14, 14)

## Fill colors — combat type
const C_AIR:   Color = Color(0.25, 0.55, 0.85, 1.0)  # sky blue — air-to-air
const C_LAND:  Color = Color(0.85, 0.50, 0.10, 1.0)  # amber    — air-to-land
const C_NAVAL: Color = Color(0.10, 0.62, 0.62, 1.0)  # sea teal — air-to-naval

## Outcome ring colors — player-relative role (air-to-air only)
const C_ATTACKER: Color = Color(0.20, 0.75, 0.35, 1.0)  # green — we attacked
const C_DEFENDER: Color = Color(0.75, 0.20, 0.20, 1.0)  # red   — we defended
const C_OBSERVER: Color = Color(0.70, 0.70, 0.70, 1.0)  # gray  — not our fight

const C_BORDER: Color = Color(0.08, 0.05, 0.02, 0.8)

var _fill_color: Color = C_AIR
var _ring_color: Color = C_OBSERVER
var _show_ring:  bool  = false
var _elapsed:    float = 0.0
var _icon_tex:   Texture2D


## combat_type: "air", "land", or "naval"
## local_nation_id: the player's own nation string
## wing_a_nation_id: attacker's nation
## wing_b_nation_id: defender's nation
func setup(wing_a_pos: Vector2, wing_b_pos: Vector2,
		combat_type: String,
		local_nation_id: String,
		wing_a_nation_id: String,
		wing_b_nation_id: String) -> void:
	position = (wing_a_pos + wing_b_pos) * 0.5 + Vector2(0, -24)

	match combat_type:
		"land":  _fill_color = C_LAND
		"naval": _fill_color = C_NAVAL
		_:       _fill_color = C_AIR

	if combat_type == "air":
		_show_ring = true
		if wing_a_nation_id == local_nation_id:
			_ring_color = C_ATTACKER
		elif wing_b_nation_id == local_nation_id:
			_ring_color = C_DEFENDER
		else:
			_ring_color = C_OBSERVER

	_icon_tex = load("res://assets/icons/jet-fighter-up-solid-full.svg")

	var timer := Timer.new()
	timer.wait_time = DISPLAY_DURATION
	timer.one_shot  = true
	timer.timeout.connect(_begin_dismiss)
	add_child(timer)
	timer.start()
	queue_redraw()


func _process(delta: float) -> void:
	_elapsed += delta
	queue_redraw()


func _draw() -> void:
	draw_circle(Vector2.ZERO, CIRCLE_R, _fill_color)
	draw_arc(Vector2.ZERO, CIRCLE_R, 0.0, TAU, 24, C_BORDER, 1.5)
	if _icon_tex:
		var rect := Rect2(-ICON_SIZE * 0.5, ICON_SIZE)
		draw_texture_rect(_icon_tex, rect, false, Color(0.08, 0.05, 0.02, 0.9))
	if _show_ring:
		var progress: float = clamp(1.0 - _elapsed / DISPLAY_DURATION, 0.0, 1.0)
		if progress > 0.0:
			draw_arc(Vector2.ZERO, CIRCLE_R + 3.0,
				-PI * 0.5, -PI * 0.5 + TAU * progress,
				32, _ring_color, 2.5)


func _begin_dismiss() -> void:
	set_process(false)
	var tween := create_tween()
	tween.set_parallel(true)
	tween.tween_property(self, "modulate:a", 0.0, 0.45)
	tween.tween_property(self, "scale", Vector2(0.4, 0.4), 0.45).set_ease(Tween.EASE_IN)
	tween.chain().tween_callback(queue_free)
