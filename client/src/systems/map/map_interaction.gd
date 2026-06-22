extends Node
## All mouse input on provinces lives here.
## Connects to generated Area2D signals after map_loaded.

signal province_clicked(province_id: String)
signal province_hovered(province_id: String)
signal province_right_clicked(province_id: String)
signal selection_cleared()

var _map_loader: Node = null
var _selected_id: String = ""
var _hovered_id: String = ""


func setup(map_loader: Node) -> void:
	_map_loader = map_loader


func on_map_loaded(_province_count: int) -> void:
	if _map_loader == null:
		return
	for pid in _map_loader.get_all_province_ids():
		for area: Area2D in _map_loader.get_province_click_areas(pid):
			area.set_meta("province_id", pid)
			area.mouse_entered.connect(_on_area_mouse_entered.bind(pid))
			area.mouse_exited.connect(_on_area_mouse_exited.bind(pid))
			area.input_event.connect(_on_area_input_event.bind(pid))


func deselect() -> void:
	if _selected_id != "":
		_selected_id = ""
		selection_cleared.emit()


# ── signal handlers ───────────────────────────────────────────────────────────

func _on_area_mouse_entered(pid: String) -> void:
	_hovered_id = pid
	province_hovered.emit(pid)


func _on_area_mouse_exited(_pid: String) -> void:
	_hovered_id = ""


func _on_area_input_event(_viewport: Node, event: InputEvent, _shape_idx: int, pid: String) -> void:
	if not event is InputEventMouseButton:
		return
	var mb := event as InputEventMouseButton
	if not mb.pressed:
		return

	if mb.button_index == MOUSE_BUTTON_LEFT:
		_selected_id = pid
		province_clicked.emit(pid)
	elif mb.button_index == MOUSE_BUTTON_RIGHT:
		province_right_clicked.emit(pid)
