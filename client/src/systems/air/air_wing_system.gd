extends Node

const AIR_WING_ICON_SCENE := preload("res://scenes/systems/air/air_wing_icon.tscn")

const NATION_COLORS: Dictionary = {
	"germany":        Color(0.29, 0.29, 0.29),
	"france":         Color(0.0,  0.14, 0.58),
	"united_kingdom": Color(0.0,  0.07, 0.41),
	"italy":          Color(0.0,  0.57, 0.27),
	"spain":          Color(0.78, 0.04, 0.12),
	"algeria":        Color(0.0,  0.38, 0.20),
}
const NEUTRAL_COLOR    := Color(0.45, 0.45, 0.45)
const HIT_THRESHOLD_PX := 20.0

var _map_loader: Node     = null
var _icon_layer: Node2D   = null
var _icons: Dictionary    = {}             # wing_id → AirWingIcon node
var _target_positions: Dictionary = {}    # wing_id → Vector2 screen-space
var _selected_wing_id: String = ""


func setup(map_loader: Node, icon_layer: Node2D) -> void:
	_map_loader = map_loader
	_icon_layer = icon_layer
	EventBus.air_wing_added.connect(_on_air_wing_added)
	EventBus.air_wing_updated.connect(_on_air_wing_updated)
	EventBus.air_wing_removed.connect(_on_air_wing_removed)
	# Hydrate any wings already in GameState (late join / scene reload)
	for wing_id in GameState.air_wings:
		_on_air_wing_added(wing_id)


func _on_air_wing_added(wing_id: String) -> void:
	if _map_loader == null or _icon_layer == null:
		return
	if _icons.has(wing_id):
		_on_air_wing_updated(wing_id)
		return
	var data := GameState.get_air_wing(wing_id)
	if data.is_empty():
		return
	var icon: Node2D = AIR_WING_ICON_SCENE.instantiate()
	var color: Color = NATION_COLORS.get(data.get("nation_id", ""), NEUTRAL_COLOR)
	icon.setup(data, color)
	icon.position = _map_loader.project_lng_lat(
		float(data.get("position_lng", 0.0)),
		float(data.get("position_lat", 0.0))
	)
	_target_positions[wing_id] = icon.position
	_icon_layer.add_child(icon)
	_icons[wing_id] = icon


func _on_air_wing_updated(wing_id: String) -> void:
	var icon = _icons.get(wing_id)
	if icon == null:
		return
	var data := GameState.get_air_wing(wing_id)
	if data.is_empty():
		return
	icon.update_data(data)
	# Snap to server position — smooth interpolation is Branch C's job
	var pos: Vector2 = _map_loader.project_lng_lat(
		float(data.get("position_lng", 0.0)),
		float(data.get("position_lat", 0.0))
	)
	icon.position = pos
	_target_positions[wing_id] = pos


func _on_air_wing_removed(wing_id: String) -> void:
	var icon = _icons.get(wing_id)
	if icon != null:
		icon.queue_free()
		_icons.erase(wing_id)
	_target_positions.erase(wing_id)
	if _selected_wing_id == wing_id:
		_selected_wing_id = ""
		EventBus.air_wing_deselected.emit()


func handle_mouse_input(event: InputEvent, world_pos: Vector2) -> bool:
	if not event is InputEventMouseButton:
		return false
	if not (event as InputEventMouseButton).pressed:
		return false
	if (event as InputEventMouseButton).button_index != MOUSE_BUTTON_LEFT:
		return false

	var best_id   := ""
	var best_dist := HIT_THRESHOLD_PX
	for wing_id in _icons:
		var icon = _icons[wing_id]
		if not icon.visible:
			continue
		var dist: float = icon.position.distance_to(world_pos)
		if dist < best_dist:
			best_dist = dist
			best_id   = wing_id

	if best_id.is_empty():
		if not _selected_wing_id.is_empty():
			_deselect()
		return false

	_select(best_id)
	return true


func _select(wing_id: String) -> void:
	if _selected_wing_id == wing_id:
		_deselect()
		return
	_deselect()
	_selected_wing_id = wing_id
	var icon = _icons.get(wing_id)
	if icon != null:
		icon.set_selected(true)
	EventBus.air_wing_selected.emit(wing_id)


func _deselect() -> void:
	if _selected_wing_id.is_empty():
		return
	var icon = _icons.get(_selected_wing_id)
	if icon != null:
		icon.set_selected(false)
	_selected_wing_id = ""
	EventBus.air_wing_deselected.emit()
