extends Node2D
## Draws planned move-order routes.
## _chain: all A* waypoint positions (polyline drawn as a line)
## _milestones: user-clicked waypoints (drawn as ghost dots on top)
## start_node: when set, its position is prepended live every frame (no 1-frame lag)

var _chain: Array[Vector2] = []
var _milestones: Array[Vector2] = []
var _color: Color = Color.WHITE
var start_node: Node2D = null


func set_path(chain: Array[Vector2], milestones: Array[Vector2], color: Color) -> void:
	_chain = chain
	_milestones = milestones
	_color = color
	queue_redraw()


func clear() -> void:
	_chain.clear()
	_milestones.clear()
	queue_redraw()


func _process(_delta: float) -> void:
	if start_node != null:
		queue_redraw()


func _draw() -> void:
	# Prepend live icon position when tracking a moving unit (avoids 1-frame lag).
	var effective: Array[Vector2] = []
	if start_node != null:
		effective.append(start_node.position)
	effective.append_array(_chain)

	# Route polyline through all A* waypoints
	for i: int in range(effective.size() - 1):
		draw_line(effective[i], effective[i + 1], Color(_color.r, _color.g, _color.b, 0.55), 2.0)

	# Milestone dots at user-clicked waypoints
	for wp: Vector2 in _milestones:
		draw_arc(wp, 30.0, 0.0, TAU, 24, Color(_color.r, _color.g, _color.b, 0.35), 1.5)
		var rect := Rect2(wp - Vector2(11, 7), Vector2(22, 14))
		draw_rect(rect, Color(_color.r, _color.g, _color.b, 0.35))
		draw_rect(rect, Color(1.0, 1.0, 1.0, 0.4), false, 1.0)
		draw_line(wp + Vector2(-4, 0), wp + Vector2(4, 0), Color(1, 1, 1, 0.6), 1.0)
		draw_line(wp + Vector2(0, -4), wp + Vector2(0, 4), Color(1, 1, 1, 0.6), 1.0)
