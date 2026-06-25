extends Node
class_name HUDManager
## Panel registry and visibility orchestrator.
## Owns: panel registry, open/close state, anchor routing.
## Forbidden from: game state mutation, game logic, network calls.

signal panel_opened(panel_name: String)
signal panel_closed(panel_name: String)
## Emitted when a panel requests its sub-tabs be cycled (Tab key while panel open).
signal panel_sub_tab_cycle_requested(panel_name: String, forward: bool)

enum PlacementMode { SIDE_DOCKED, FULL_CENTER }

const _MOVE_MODE_ACTIVE := "move_mode"

# Set by GameHUD._ready() via setup()
var side_panel_anchor: MarginContainer
var center_panel_anchor: Control
var overlay_dim: ColorRect

# panel_name → { node: Node, placement: PlacementMode, is_open: bool }
var _registry: Dictionary = {}
var _currently_open: String = ""
# physical_keycode (int) → panel_name (String)
var _shortcut_map: Dictionary = {}
# Previously-open side-docked panel — saved before a FULL_CENTER panel opens, restored on close
var _previous_side_docked: String = ""
var _player_input_blocked: bool = false

# Escape state machine
var _escape_state_stack: Array[String] = []


func setup(
		side: MarginContainer,
		center: Control,
		dim: ColorRect
) -> void:
	side_panel_anchor = side
	center_panel_anchor = center
	overlay_dim = dim
	if not EventBus.pause_menu_blocking_changed.is_connected(_on_pause_menu_blocking_changed):
		EventBus.pause_menu_blocking_changed.connect(_on_pause_menu_blocking_changed)


func _input(event: InputEvent) -> void:
	if _player_input_blocked:
		return

	if not (event is InputEventKey):
		return
	var key: InputEventKey = event as InputEventKey
	if key.echo:
		return
	if not key.pressed:
		return

	var scancode: int = key.physical_keycode

	# Panel shortcut routing
	if _shortcut_map.has(scancode):
		var panel_name: String = _shortcut_map[scancode]
		_toggle_by_shortcut(panel_name)
		get_tree().root.set_input_as_handled()
		return

	match scancode:
		KEY_TAB:
			if _currently_open != "":
				panel_sub_tab_cycle_requested.emit(_currently_open, true)
			else:
				EventBus.notification_cycle_next.emit()
			get_tree().root.set_input_as_handled()
		KEY_ESCAPE:
			_handle_escape()
			get_tree().root.set_input_as_handled()


func _handle_escape() -> void:
	if _escape_state_stack.has(_MOVE_MODE_ACTIVE):
		_escape_state_stack.erase(_MOVE_MODE_ACTIVE)
		EventBus.move_mode_cancelled.emit()
		return

	if _currently_open != "":
		close_all()
		return

	if EventBus.settings_requested.get_connections().size() > 0:
		EventBus.settings_requested.emit()


## Responds to pause menu input ownership changes.
## Parameters:
## - blocking: true when HUD keyboard shortcuts should be ignored.
## Returns: nothing.
func _on_pause_menu_blocking_changed(blocking: bool) -> void:
	_player_input_blocked = blocking


func set_move_mode_active(active: bool) -> void:
	if active:
		if not _escape_state_stack.has(_MOVE_MODE_ACTIVE):
			_escape_state_stack.push_front(_MOVE_MODE_ACTIVE)
	else:
		_escape_state_stack.erase(_MOVE_MODE_ACTIVE)


## Adds panel to the registry and reparents it into the correct anchor (hidden).
func register_panel(
		panel_name: String,
		panel_node: Node,
		placement: PlacementMode = PlacementMode.SIDE_DOCKED
) -> void:
	if _registry.has(panel_name):
		push_warning("HUDManager: panel '%s' already registered" % panel_name)
		return
	var anchor: Node = (
		center_panel_anchor if placement == PlacementMode.FULL_CENTER
		else side_panel_anchor
	)
	if panel_node.get_parent() != null:
		panel_node.get_parent().remove_child(panel_node)
	anchor.add_child(panel_node)
	panel_node.hide()
	_registry[panel_name] = {
		"node": panel_node,
		"placement": placement,
		"is_open": false,
	}


## Sets the keyboard shortcut for a registered panel.
func set_panel_shortcut(panel_name: String, physical_keycode: int) -> void:
	if not _registry.has(panel_name):
		push_warning("HUDManager: cannot set shortcut — panel '%s' not registered" % panel_name)
		return
	_shortcut_map[physical_keycode] = panel_name


## Removes panel from registry. Hides it first if currently open.
func unregister_panel(panel_name: String) -> void:
	if not _registry.has(panel_name):
		return
	if _registry[panel_name].is_open:
		hide_panel(panel_name)
	_registry.erase(panel_name)


## Shows panel. Emits panel_opened. No-op if already open.
func show_panel(panel_name: String) -> void:
	if not _registry.has(panel_name):
		push_warning("HUDManager: unknown panel '%s'" % panel_name)
		return
	var entry: Dictionary = _registry[panel_name]
	if entry.is_open:
		return
	var placement: PlacementMode = entry.placement
	# Full-center panels close any open side-docked panels — save it for later restore
	if placement == PlacementMode.FULL_CENTER:
		if _currently_open != "" and _registry[_currently_open].placement == PlacementMode.SIDE_DOCKED:
			_previous_side_docked = _currently_open
		close_all()
		overlay_dim.show()
		center_panel_anchor.show()
	else:
		_previous_side_docked = ""
		side_panel_anchor.show()
	entry.node.show()
	if placement == PlacementMode.FULL_CENTER:
		_center_panel(entry.node as Control)
	entry.is_open = true
	_currently_open = panel_name
	panel_opened.emit(panel_name)


## Hides panel. Emits panel_closed. No-op if already closed.
func hide_panel(panel_name: String) -> void:
	if not _registry.has(panel_name):
		return
	var entry: Dictionary = _registry[panel_name]
	if not entry.is_open:
		return
	entry.node.hide()
	entry.is_open = false
	if _currently_open == panel_name:
		_currently_open = ""
	var placement: PlacementMode = entry.placement
	if placement == PlacementMode.FULL_CENTER:
		overlay_dim.hide()
		center_panel_anchor.hide()
		# Restore the previously-open side-docked panel
		if _previous_side_docked != "" and _registry.has(_previous_side_docked):
			var prev_entry: Dictionary = _registry[_previous_side_docked]
			if not prev_entry.is_open:
				prev_entry.node.show()
				prev_entry.is_open = true
				_currently_open = _previous_side_docked
				side_panel_anchor.show()
				panel_opened.emit(_previous_side_docked)
			_previous_side_docked = ""
		else:
			if not _any_docked_open():
				side_panel_anchor.hide()
	else:
		if not _any_docked_open():
			side_panel_anchor.hide()
	panel_closed.emit(panel_name)


func toggle_panel(panel_name: String) -> void:
	if not _registry.has(panel_name):
		push_warning("HUDManager: unknown panel '%s'" % panel_name)
		return
	if _registry[panel_name].is_open:
		hide_panel(panel_name)
	else:
		show_panel(panel_name)


## Closes all open panels.
func close_all() -> void:
	for panel_name: String in _registry.keys():
		if _registry[panel_name].is_open:
			hide_panel(panel_name)


func is_panel_open(panel_name: String) -> bool:
	if not _registry.has(panel_name):
		return false
	return _registry[panel_name].is_open


## Returns name of the last opened panel, or "" if none open.
func get_open_panel() -> String:
	return _currently_open


func _toggle_by_shortcut(panel_name: String) -> void:
	if not _registry.has(panel_name):
		return
	var entry: Dictionary = _registry[panel_name]
	if entry.is_open:
		hide_panel(panel_name)
	else:
		if _currently_open != "":
			hide_panel(_currently_open)
		show_panel(panel_name)


func _center_panel(panel: Control) -> void:
	if panel == null:
		return
	var psize: Vector2 = center_panel_anchor.size
	if (
			is_equal_approx(panel.anchor_left, 0.0)
			and is_equal_approx(panel.anchor_top, 0.0)
			and is_equal_approx(panel.anchor_right, 1.0)
			and is_equal_approx(panel.anchor_bottom, 1.0)
	):
		panel.set_position(Vector2.ZERO)
		panel.set_size(psize)
		return
	var mysize: Vector2 = panel.get_combined_minimum_size()
	panel.set_size(mysize)
	panel.set_position(Vector2(
		floor((psize.x - mysize.x) * 0.5),
		floor((psize.y - mysize.y) * 0.5)
	))


func _any_docked_open() -> bool:
	for entry: Dictionary in _registry.values():
		if entry.is_open and entry.placement == PlacementMode.SIDE_DOCKED:
			return true
	return false
