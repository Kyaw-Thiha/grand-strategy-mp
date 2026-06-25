extends Node
class_name HUDManager
## Panel registry and visibility orchestrator.
## Owns: panel registry, open/close state, anchor routing.
## Forbidden from: game state mutation, game logic, network calls.

signal panel_opened(panel_name: String)
signal panel_closed(panel_name: String)

enum PlacementMode { SIDE_DOCKED, FULL_CENTER }

# Set by GameHUD._ready() via setup()
var side_panel_anchor: MarginContainer
var center_panel_anchor: CenterContainer
var overlay_dim: ColorRect

# panel_name → { node: Node, placement: PlacementMode, is_open: bool }
var _registry: Dictionary = {}
var _currently_open: String = ""


func setup(
		side: MarginContainer,
		center: CenterContainer,
		dim: ColorRect
) -> void:
	side_panel_anchor = side
	center_panel_anchor = center
	overlay_dim = dim


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
	if placement == PlacementMode.FULL_CENTER:
		overlay_dim.show()
		center_panel_anchor.show()
	else:
		side_panel_anchor.show()
	entry.node.show()
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


func _any_docked_open() -> bool:
	for entry: Dictionary in _registry.values():
		if entry.is_open and entry.placement == PlacementMode.SIDE_DOCKED:
			return true
	return false
