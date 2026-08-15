class_name MoveDestinationEffect
extends Node2D
## Draws transient lock-on and ripple feedback for a committed move destination.

const SNAP_DURATION_SEC: float = 0.15
const TOTAL_DURATION_SEC: float = 0.60
const BRACKET_START_RADIUS: float = 27.0
const BRACKET_END_RADIUS: float = 12.0
const BRACKET_ARM_LENGTH: float = 7.0
const RIPPLE_START_RADIUS: float = 9.0
const RIPPLE_END_RADIUS: float = 31.0

var _elapsed_sec: float = 0.0
var _effect_color: Color = Color.WHITE


func setup(world_position: Vector2, nation_color: Color) -> void:
	position = world_position
	_effect_color = nation_color.lightened(0.35)
	queue_redraw()


func get_elapsed_sec() -> float:
	return _elapsed_sec


func get_effect_color() -> Color:
	return _effect_color


func _process(delta: float) -> void:
	_elapsed_sec += delta
	_update_zoom_compensation()
	if _elapsed_sec >= TOTAL_DURATION_SEC:
		queue_free()
		return
	queue_redraw()


func _draw() -> void:
	if _elapsed_sec < SNAP_DURATION_SEC:
		_draw_lock_on_brackets()
		return
	_draw_impact()


func _draw_lock_on_brackets() -> void:
	var progress: float = _elapsed_sec / SNAP_DURATION_SEC
	var eased_progress: float = 1.0 - pow(1.0 - progress, 3.0)
	var radius: float = lerpf(BRACKET_START_RADIUS, BRACKET_END_RADIUS, eased_progress)
	var color: Color = Color(_effect_color.r, _effect_color.g, _effect_color.b, 0.95)

	_draw_corner(Vector2(-radius, -radius), Vector2.RIGHT, Vector2.DOWN, color)
	_draw_corner(Vector2(radius, -radius), Vector2.LEFT, Vector2.DOWN, color)
	_draw_corner(Vector2(radius, radius), Vector2.LEFT, Vector2.UP, color)
	_draw_corner(Vector2(-radius, radius), Vector2.RIGHT, Vector2.UP, color)


func _draw_corner(origin: Vector2, horizontal: Vector2, vertical: Vector2, color: Color) -> void:
	draw_line(origin, origin + horizontal * BRACKET_ARM_LENGTH, Color(0.0, 0.0, 0.0, 0.55), 3.5)
	draw_line(origin, origin + vertical * BRACKET_ARM_LENGTH, Color(0.0, 0.0, 0.0, 0.55), 3.5)
	draw_line(origin, origin + horizontal * BRACKET_ARM_LENGTH, color, 1.8)
	draw_line(origin, origin + vertical * BRACKET_ARM_LENGTH, color, 1.8)


func _draw_impact() -> void:
	var progress: float = (_elapsed_sec - SNAP_DURATION_SEC) \
			/ (TOTAL_DURATION_SEC - SNAP_DURATION_SEC)
	var fade: float = 1.0 - progress
	var primary_radius: float = lerpf(RIPPLE_START_RADIUS, RIPPLE_END_RADIUS, progress)
	var primary_color: Color = Color(_effect_color.r, _effect_color.g, _effect_color.b, fade * 0.9)
	draw_arc(Vector2.ZERO, primary_radius, 0.0, TAU, 32, Color(0.0, 0.0, 0.0, fade * 0.35), 3.5)
	draw_arc(Vector2.ZERO, primary_radius, 0.0, TAU, 32, primary_color, 1.8)

	var secondary_progress: float = clampf((progress - 0.18) / 0.82, 0.0, 1.0)
	if secondary_progress > 0.0:
		var secondary_radius: float = lerpf(RIPPLE_START_RADIUS, RIPPLE_END_RADIUS * 0.78, secondary_progress)
		var secondary_fade: float = 1.0 - secondary_progress
		var secondary_color: Color = Color(1.0, 1.0, 1.0, secondary_fade * 0.65)
		draw_arc(Vector2.ZERO, secondary_radius, 0.0, TAU, 28, secondary_color, 1.2)

	var dot_alpha: float = clampf(1.0 - progress * 2.5, 0.0, 1.0)
	if dot_alpha > 0.0:
		draw_circle(Vector2.ZERO, lerpf(4.5, 2.0, progress), Color(1.0, 1.0, 1.0, dot_alpha))


func _update_zoom_compensation() -> void:
	var camera: Camera2D = get_viewport().get_camera_2d()
	if camera == null:
		return
	var safe_zoom_x: float = maxf(absf(camera.zoom.x), 0.001)
	var safe_zoom_y: float = maxf(absf(camera.zoom.y), 0.001)
	scale = Vector2(1.0 / safe_zoom_x, 1.0 / safe_zoom_y)
