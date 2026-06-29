extends Control
## Draws a vertical dashed line down the centre.
## Used as a front-line separator between the attacker and defender grids.

func _draw() -> void:
	var color := Color(0.55, 0.15, 0.10, 0.6)
	var x := size.x * 0.5
	var y := 0.0
	var dash := 4.0
	var gap := 4.0
	while y < size.y:
		var end_y: float = min(y + dash, size.y)
		draw_line(Vector2(x, y), Vector2(x, end_y), color, 1.5)
		y = end_y + gap
