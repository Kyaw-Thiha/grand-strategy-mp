extends Node2D

const JET_ICON: Texture2D = preload("res://assets/icons/jet-fighter-up-solid-full.svg")
const CIRCLE_R:         float   = 14.0
const AUTO_DISMISS_SEC: float   = 5.0
const ICON_SIZE:        Vector2 = Vector2(14, 14)
const C_LAND:   Color = Color(0.85, 0.50, 0.10, 1.0)
const C_BORDER: Color = Color(0.08, 0.05, 0.02, 0.8)

var _runs: Array[Dictionary] = []
var _province_id: String = ""
var _elapsed: float = 0.0
var _dismissing: bool = false
var _badge_label: Label


func _ready() -> void:
	var lbl := Label.new()
	lbl.name = "BadgeLabel"
	lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	lbl.add_theme_font_size_override("font_size", 11)
	lbl.position = Vector2(6.0, -18.0)
	lbl.size = Vector2(12, 12)
	add_child(lbl)
	_badge_label = lbl


func setup(map_loader: Node, province_id: String, lng: float, lat: float) -> void:
	_province_id = province_id
	position = map_loader.project_lng_lat(lng, lat) + Vector2(0.0, -32.0)
	queue_redraw()


func add_run(run_data: Dictionary) -> void:
	_runs.append(run_data)
	_badge_label.text = str(_runs.size())
	_badge_label.visible = _runs.size() > 1
	queue_redraw()


func _process(delta: float) -> void:
	if _dismissing:
		return
	_elapsed += delta
	if _elapsed >= AUTO_DISMISS_SEC:
		_begin_dismiss()
		return
	queue_redraw()


func _draw() -> void:
	draw_circle(Vector2.ZERO, CIRCLE_R, C_LAND)
	draw_arc(Vector2.ZERO, CIRCLE_R, 0.0, TAU, 24, C_BORDER, 1.5)
	draw_texture_rect(JET_ICON, Rect2(-ICON_SIZE * 0.5, ICON_SIZE), false, Color(0.08, 0.05, 0.02, 0.9))
	var progress: float = clamp(1.0 - _elapsed / AUTO_DISMISS_SEC, 0.0, 1.0)
	if progress > 0.0:
		draw_arc(Vector2.ZERO, CIRCLE_R + 3.0,
			-PI * 0.5, -PI * 0.5 + TAU * progress,
			32, C_LAND, 2.5)


func _begin_dismiss() -> void:
	if _dismissing:
		return
	_dismissing = true
	set_process(false)
	var tween := create_tween()
	tween.set_parallel(true)
	tween.tween_property(self, "modulate:a", 0.0, 0.45)
	tween.tween_property(self, "scale", Vector2(0.4, 0.4), 0.45).set_ease(Tween.EASE_IN)
	tween.chain().tween_callback(queue_free)


func on_clicked() -> void:
	if _dismissing:
		return
	EventBus.bombing_detail_open_requested.emit({ "runs": _runs, "province_id": _province_id })
	_begin_dismiss()
