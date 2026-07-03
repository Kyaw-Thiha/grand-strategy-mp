extends Node

const AIR_WING_ICON_SCENE := preload("res://scenes/systems/air/air_wing_icon.tscn")
const DubinsInterpolator := preload("res://src/systems/air/dubins_interpolator.gd")
const MoveOrderOverlay := preload("res://src/systems/military/move_order_overlay.gd")

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
var _pending_milestones: Array[String] = []
var _pending_chain: Array[String] = []
var _shift_chain_started: bool = false
var _pending_route_overlay: Node2D = null
var _wing_path_by_id: Dictionary = {}
var _wing_path_generations_by_id: Dictionary = {}


func setup(map_loader: Node, icon_layer: Node2D) -> void:
	_map_loader = map_loader
	_icon_layer = icon_layer
	EventBus.air_wing_added.connect(_on_air_wing_added)
	EventBus.air_wing_updated.connect(_on_air_wing_updated)
	EventBus.air_wing_removed.connect(_on_air_wing_removed)
	if not EventBus.air_wing_path.is_connected(_on_air_wing_path):
		EventBus.air_wing_path.connect(_on_air_wing_path)
	if _pending_route_overlay == null:
		_pending_route_overlay = MoveOrderOverlay.new()
		_icon_layer.add_child(_pending_route_overlay)
	# Hydrate any wings already in GameState (late join / scene reload)
	for wing_id in GameState.air_wings:
		_on_air_wing_added(wing_id)
	_update_ghost()


func _exit_tree() -> void:
	cleanup()


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
	_icon_layer.add_child(icon)
	_icons[wing_id] = icon
	_refresh_wing_icon_position(wing_id)


func _on_air_wing_updated(wing_id: String) -> void:
	var icon = _icons.get(wing_id)
	if icon == null:
		return
	var data := GameState.get_air_wing(wing_id)
	if data.is_empty():
		return
	icon.update_data(data)
	_refresh_wing_icon_position(wing_id)


func _on_air_wing_removed(wing_id: String) -> void:
	var icon = _icons.get(wing_id)
	if icon != null:
		icon.queue_free()
		_icons.erase(wing_id)
	_target_positions.erase(wing_id)
	_wing_path_by_id.erase(wing_id)
	_wing_path_generations_by_id.erase(wing_id)
	if _selected_wing_id == wing_id:
		_selected_wing_id = ""
		EventBus.air_wing_deselected.emit()
		_update_ghost()


func handle_mouse_input(event: InputEvent, world_pos: Vector2) -> bool:
	if not event is InputEventMouseButton:
		return false
	var mouse_button: InputEventMouseButton = event as InputEventMouseButton
	if not mouse_button.pressed:
		return false
	if mouse_button.button_index == MOUSE_BUTTON_RIGHT:
		if _selected_wing_id.is_empty():
			return false
		if mouse_button.shift_pressed:
			_append_pending_milestone(_encode_pending_point(world_pos))
			return true
		if _pending_milestones.is_empty():
			return false
		var last_point: Vector2 = _get_last_pending_point()
		if last_point != Vector2.INF and world_pos.distance_to(last_point) <= HIT_THRESHOLD_PX * 2.0:
			_remove_last_pending_milestone()
			return true
		return false

	if mouse_button.button_index != MOUSE_BUTTON_LEFT:
		return false

	var best_id: String = ""
	var best_dist: float = HIT_THRESHOLD_PX
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
	_update_ghost()


func _deselect() -> void:
	if _selected_wing_id.is_empty():
		return
	_clear_pending()
	var icon = _icons.get(_selected_wing_id)
	if icon != null:
		icon.set_selected(false)
	_selected_wing_id = ""
	EventBus.air_wing_deselected.emit()
	_update_ghost()


func _on_air_wing_path(path_data: Dictionary) -> void:
	var wing_id: String = path_data.get("wing_id", "")
	var path_gen_id: String = path_data.get("path_gen_id", "")
	if wing_id.is_empty():
		return
	_wing_path_by_id[wing_id] = path_data.duplicate()
	if not path_gen_id.is_empty():
		if not _wing_path_generations_by_id.has(wing_id):
			_wing_path_generations_by_id[wing_id] = {}
		var generations: Dictionary = _wing_path_generations_by_id[wing_id]
		generations[path_gen_id] = path_data.duplicate()
	_refresh_wing_icon_position(wing_id)
	if wing_id == _selected_wing_id:
		_update_ghost()


func _append_pending_milestone(milestone_id: String) -> void:
	if milestone_id.is_empty():
		return
	_pending_milestones.append(milestone_id)
	_pending_chain.append(milestone_id)
	_shift_chain_started = true
	_update_ghost()


func _remove_last_pending_milestone() -> void:
	if _pending_milestones.is_empty():
		return
	_pending_milestones.pop_back()
	if _pending_milestones.is_empty():
		_clear_pending()
		return
	if not _pending_chain.is_empty():
		_pending_chain.pop_back()
	_update_ghost()


func _recompute_chain() -> void:
	_pending_chain = _pending_milestones.duplicate()
	_update_ghost()


func _clear_pending() -> void:
	_pending_milestones.clear()
	_pending_chain.clear()
	_shift_chain_started = false
	_update_ghost()


func cleanup() -> void:
	if EventBus.air_wing_added.is_connected(_on_air_wing_added):
		EventBus.air_wing_added.disconnect(_on_air_wing_added)
	if EventBus.air_wing_updated.is_connected(_on_air_wing_updated):
		EventBus.air_wing_updated.disconnect(_on_air_wing_updated)
	if EventBus.air_wing_removed.is_connected(_on_air_wing_removed):
		EventBus.air_wing_removed.disconnect(_on_air_wing_removed)
	if EventBus.air_wing_path.is_connected(_on_air_wing_path):
		EventBus.air_wing_path.disconnect(_on_air_wing_path)
	if _pending_route_overlay != null:
		_pending_route_overlay.free()
		_pending_route_overlay = null
	_wing_path_generations_by_id.clear()


func _update_ghost() -> void:
	if _pending_route_overlay == null:
		return

	var icon: Node2D = _icons.get(_selected_wing_id) as Node2D
	_pending_route_overlay.start_node = icon

	var route_points: Array[Vector2] = _get_preview_route_points()
	if route_points.is_empty():
		_pending_route_overlay.clear()
		return

	_pending_route_overlay.set_path(route_points, _get_pending_milestone_positions(), _get_selected_wing_color())


func _refresh_wing_icon_position(wing_id: String) -> void:
	var icon = _icons.get(wing_id)
	if icon == null:
		return
	var data: Dictionary = GameState.get_air_wing(wing_id)
	if data.is_empty():
		return

	var projected_position: Vector2 = _get_interpolated_wing_position(wing_id, data)
	if projected_position != Vector2.INF:
		icon.position = _map_loader.project_lng_lat(projected_position.x, projected_position.y)
		_target_positions[wing_id] = icon.position
		return

	var fallback_position: Vector2 = _map_loader.project_lng_lat(
		float(data.get("position_lng", 0.0)),
		float(data.get("position_lat", 0.0))
	)
	icon.position = fallback_position
	_target_positions[wing_id] = fallback_position


func _get_interpolated_wing_position(wing_id: String, data: Dictionary) -> Vector2:
	var path_gen_id: String = data.get("path_gen_id", "")
	if path_gen_id.is_empty():
		return Vector2.INF
	var generations: Dictionary = _wing_path_generations_by_id.get(wing_id, {})
	var path_data: Dictionary = generations.get(path_gen_id, {})
	if path_data.is_empty():
		return Vector2.INF
	return DubinsInterpolator.evaluate_position(path_data, int(data.get("path_elapsed_ms", 0)))


func _get_selected_wing_color() -> Color:
	if _selected_wing_id.is_empty():
		return NEUTRAL_COLOR
	var data: Dictionary = GameState.get_air_wing(_selected_wing_id)
	return NATION_COLORS.get(data.get("nation_id", ""), NEUTRAL_COLOR)


func _get_selected_wing_path_points() -> Array[Vector2]:
	if _selected_wing_id.is_empty():
		return []
	var path_data: Dictionary = _wing_path_by_id.get(_selected_wing_id, {})
	if path_data.is_empty():
		return []

	var points: Array[Vector2] = []
	var segments: Array = path_data.get("segments", [])
	if segments.is_empty():
		if path_data.has("start_lng") and path_data.has("start_lat"):
			points.append(_map_loader.project_lng_lat(float(path_data.get("start_lng", 0.0)), float(path_data.get("start_lat", 0.0))))
		if path_data.has("end_lng") and path_data.has("end_lat"):
			points.append(_map_loader.project_lng_lat(float(path_data.get("end_lng", 0.0)), float(path_data.get("end_lat", 0.0))))
		return points

	var first_segment: Dictionary = segments[0]
	if first_segment.has("start_lng") and first_segment.has("start_lat"):
		points.append(_map_loader.project_lng_lat(float(first_segment.get("start_lng", 0.0)), float(first_segment.get("start_lat", 0.0))))
	for segment_variant: Variant in segments:
		if not segment_variant is Dictionary:
			continue
		var segment: Dictionary = segment_variant
		if segment.has("end_lng") and segment.has("end_lat"):
			points.append(_map_loader.project_lng_lat(float(segment.get("end_lng", 0.0)), float(segment.get("end_lat", 0.0))))
	return points


func _get_preview_route_points() -> Array[Vector2]:
	if not _pending_chain.is_empty():
		return _get_pending_chain_positions()
	return _get_selected_wing_path_points()


func _get_pending_chain_positions() -> Array[Vector2]:
	var positions: Array[Vector2] = []
	for milestone_id: String in _pending_chain:
		var position: Vector2 = _decode_pending_point(milestone_id)
		if position != Vector2.INF:
			positions.append(position)
	return positions


func _get_pending_milestone_positions() -> Array[Vector2]:
	var positions: Array[Vector2] = []
	for milestone_id: String in _pending_milestones:
		var position: Vector2 = _decode_pending_point(milestone_id)
		if position != Vector2.INF:
			positions.append(position)
	return positions


func _get_last_pending_point() -> Vector2:
	if _pending_milestones.is_empty():
		return Vector2.INF
	return _decode_pending_point(_pending_milestones.back())


func _encode_pending_point(world_pos: Vector2) -> String:
	return "%0.3f,%0.3f" % [world_pos.x, world_pos.y]


func _decode_pending_point(point_id: String) -> Vector2:
	var parts: PackedStringArray = point_id.split(",")
	if parts.size() != 2:
		return Vector2.INF
	var x_text: String = parts[0].strip_edges()
	var y_text: String = parts[1].strip_edges()
	if x_text.is_empty() or y_text.is_empty():
		return Vector2.INF
	return Vector2(x_text.to_float(), y_text.to_float())
