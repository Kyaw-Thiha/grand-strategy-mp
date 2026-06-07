extends Node2D
## Draws ghost dots at planned move-order milestone positions.
## Positions are in world (map) coordinates — same space as division icons.

var _milestones: Array[Vector2] = []
var _color: Color = Color.WHITE


func set_milestones(positions: Array[Vector2], nation_color: Color) -> void:
	_milestones = positions
	_color = nation_color
	queue_redraw()


func clear() -> void:
	_milestones.clear()
	queue_redraw()


func _draw() -> void:
	for i: int in _milestones.size():
		var wp: Vector2 = _milestones[i]
		# Faded engagement circle
		draw_arc(wp, 30.0, 0.0, TAU, 24, Color(_color.r, _color.g, _color.b, 0.35), 1.5)
		# Faded NATO rectangle
		var rect := Rect2(wp - Vector2(11, 7), Vector2(22, 14))
		draw_rect(rect, Color(_color.r, _color.g, _color.b, 0.35))
		draw_rect(rect, Color(1.0, 1.0, 1.0, 0.4), false, 1.0)
		# Waypoint index label (drawn as a small cross for now)
		draw_line(wp + Vector2(-4, 0), wp + Vector2(4, 0), Color(1, 1, 1, 0.6), 1.0)
		draw_line(wp + Vector2(0, -4), wp + Vector2(0, 4), Color(1, 1, 1, 0.6), 1.0)
