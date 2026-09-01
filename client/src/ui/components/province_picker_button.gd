class_name ProvincePickerButton
extends Button
## Reusable "pick a province on the map" control. Shows the currently-selected province (name
## if resolvable, id otherwise). Pressing it enters picking mode: the mouse cursor becomes a
## crosshair, and the next province clicked anywhere on the map is captured as the new
## selection — reuses the map's existing EventBus.province_selected signal (fires on every
## province click already, see map_scene.gd's _on_province_clicked) rather than adding a new
## click-detection path. Press ESC, or press the button again, to cancel picking without
## changing the selection.

signal province_changed(province_id: String)

var selected_province_id: String = "":
	set(value):
		selected_province_id = value
		_refresh_text()

var _picking: bool = false


func _ready() -> void:
	pressed.connect(_on_pressed)
	_refresh_text()


func _exit_tree() -> void:
	_stop_picking(false)


func _unhandled_input(event: InputEvent) -> void:
	if _picking and event.is_action_pressed("ui_cancel"):
		_stop_picking(false)
		get_viewport().set_input_as_handled()


func _on_pressed() -> void:
	if _picking:
		_stop_picking(false)
		return
	_picking = true
	text = "Click your own province..."
	Input.set_default_cursor_shape(Input.CURSOR_CROSS)
	if not EventBus.province_selected.is_connected(_on_province_picked):
		EventBus.province_selected.connect(_on_province_picked)


## Only the player's own territory is a valid deploy target — a click on neutral/enemy/allied
## territory is rejected and picking mode stays active so the player can try again, rather than
## silently accepting a province the server would reject anyway (RAISE_DIVISION/
## UPDATE_MARSHALLING_PROVINCE both re-check ownership server-side too; this is the client-side
## half so the picker doesn't show a selection that was never actually going to work).
func _on_province_picked(province_id: String) -> void:
	if not _picking:
		return
	var province_data: Dictionary = GameState.provinces.get(province_id, {})
	if province_data.get("owner_id", "") != GameState.get_my_nation_id():
		EventBus.notification_requested.emit("Can only deploy on your own territory.", "warning")
		return
	_stop_picking(false)
	selected_province_id = province_id
	province_changed.emit(province_id)


func _stop_picking(keep_text: bool) -> void:
	if not _picking and not keep_text:
		return
	_picking = false
	Input.set_default_cursor_shape(Input.CURSOR_ARROW)
	if EventBus.province_selected.is_connected(_on_province_picked):
		EventBus.province_selected.disconnect(_on_province_picked)
	if not keep_text:
		_refresh_text()


func _refresh_text() -> void:
	if _picking:
		return
	text = _resolve_display_name(selected_province_id) if not selected_province_id.is_empty() else "Choose province"


func _resolve_display_name(province_id: String) -> String:
	var map_loader: Node = _get_map_loader()
	if map_loader != null and map_loader.has_method("get_province_data"):
		var pd: Dictionary = map_loader.get_province_data(province_id)
		if not pd.is_empty():
			return pd.get("name", province_id)
	return province_id


## MapLoader is nested under the "Game" scene root (game.tscn: Game > MapLoader), not a direct
## child of the true scene tree root — find_child(recursive=true) is required, matching
## bombing_detail_panel.gd's version of this same lookup.
func _get_map_loader() -> Node:
	var main_loop: MainLoop = Engine.get_main_loop()
	if main_loop == null:
		return null
	return main_loop.root.find_child("MapLoader", true, false)
