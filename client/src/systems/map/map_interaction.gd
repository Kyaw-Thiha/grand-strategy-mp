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
var _player_input_enabled: bool = true
var _pause_input_blocked: bool = false
var _chat_input_blocked: bool = false


func setup(map_loader: Node) -> void:
	_map_loader = map_loader
	if not EventBus.pause_menu_blocking_changed.is_connected(_on_pause_menu_blocking_changed):
		EventBus.pause_menu_blocking_changed.connect(_on_pause_menu_blocking_changed)
	if not EventBus.chat_input_focus_changed.is_connected(_on_chat_input_focus_changed):
		EventBus.chat_input_focus_changed.connect(_on_chat_input_focus_changed)


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


## Returns the province currently under the mouse cursor, or "" when none.
## Parameters: none.
## Returns: hovered province id, or empty string.
func get_hovered_province_id() -> String:
	return _hovered_id


# ── signal handlers ───────────────────────────────────────────────────────────

func _on_area_mouse_entered(pid: String) -> void:
	if not _player_input_enabled:
		return
	_hovered_id = pid
	province_hovered.emit(pid)


func _on_area_mouse_exited(_pid: String) -> void:
	if not _player_input_enabled:
		return
	_hovered_id = ""


func _on_area_input_event(_viewport: Node, event: InputEvent, _shape_idx: int, pid: String) -> void:
	if not _player_input_enabled:
		return
	if not event is InputEventMouseButton:
		return
	var mb: InputEventMouseButton = event as InputEventMouseButton
	if not mb.pressed:
		return

	if mb.button_index == MOUSE_BUTTON_LEFT:
		_selected_id = pid
		province_clicked.emit(pid)
	elif mb.button_index == MOUSE_BUTTON_RIGHT:
		province_right_clicked.emit(pid)
		get_viewport().set_input_as_handled()


## Enables or disables player-driven province hover and click interaction.
## Parameters:
## - enabled: true when province Area2D events should update hover/selection.
## Returns: nothing.
func set_player_input_enabled(enabled: bool) -> void:
	_player_input_enabled = enabled
	if not enabled:
		_hovered_id = ""


## Responds to pause menu input ownership changes.
## Parameters:
## - blocking: true when province hover/click signals should be ignored.
## Returns: nothing.
func _on_pause_menu_blocking_changed(blocking: bool) -> void:
	_pause_input_blocked = blocking
	_refresh_player_input_enabled()


## Responds to chat text input ownership changes.
## Parameters:
## - focused: true when chat text entry owns keyboard input.
## Returns: nothing.
func _on_chat_input_focus_changed(focused: bool) -> void:
	_chat_input_blocked = focused
	_refresh_player_input_enabled()


## Recomputes whether province hover/click input should be active.
## Parameters: none.
## Returns: nothing.
func _refresh_player_input_enabled() -> void:
	set_player_input_enabled(not (_pause_input_blocked or _chat_input_blocked))
