class_name StatusBars
extends Control
## Draws HP (green) and suppression (amber) bars at the bottom of the control.
## Properties:
##   hp_pct: float (0.0–1.0) — fills green bar from left
##   supp_pct: float (0.0–1.0) — fills amber bar from left, drawn above HP bar

var hp_pct: float = 1.0:
	set(v):
		hp_pct = clampf(v, 0.0, 1.0)
		queue_redraw()

var supp_pct: float = 0.0:
	set(v):
		supp_pct = clampf(v, 0.0, 1.0)
		queue_redraw()

const BAR_H   := 6.0
const SUPP_H  := 3.0
const C_BG    := Color(0.08, 0.06, 0.04, 0.8)
const C_HP    := Color(0.35, 0.75, 0.40, 1.0)
const C_SUPP  := Color(0.85, 0.55, 0.10, 1.0)


func _draw() -> void:
	var w := size.x
	# HP bar at bottom
	draw_rect(Rect2(0, size.y - BAR_H, w, BAR_H), C_BG)
	draw_rect(Rect2(0, size.y - BAR_H, w * hp_pct, BAR_H), C_HP)
	# Suppression bar above HP
	if supp_pct > 0.02:
		draw_rect(Rect2(0, size.y - BAR_H - SUPP_H, w * supp_pct, SUPP_H), C_SUPP)
