extends Node2D

const FIRE_ICON: Texture2D = preload("res://assets/icons/fire-solid-full.svg")
const AUTO_DISMISS_SEC := 5.0
const CIRCLE_RADIUS    := 18.0

var _runs: Array[Dictionary] = []
var _province_id: String = ""
var _timer: float = 0.0
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
	_timer += delta
	if _timer >= AUTO_DISMISS_SEC:
		queue_free()
		return
	queue_redraw()


func _draw() -> void:
	draw_circle(Vector2.ZERO, CIRCLE_RADIUS, Color(0.8, 0.1, 0.1, 0.75))
	draw_texture_rect(FIRE_ICON, Rect2(Vector2(-10.0, -13.0), Vector2(20.0, 20.0)), false)
	var progress := 1.0 - (_timer / AUTO_DISMISS_SEC)
	if progress > 0.0:
		draw_arc(Vector2.ZERO, 24.0, -PI * 0.5,
		         -PI * 0.5 + TAU * progress, 32, Color(1, 1, 1, 0.6 * progress), 2.0)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_LEFT:
			var local := to_local(event.global_position)
			if local.length() <= CIRCLE_RADIUS + 6.0:
				EventBus.bombing_detail_open_requested.emit({ "runs": _runs, "province_id": _province_id })
				queue_free()
				get_viewport().set_input_as_handled()
