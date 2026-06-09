extends Node
## Manages division icon rendering on the strategic map.
## Phase 4B: A* pathfinding, waypoint chain (shift+click), ghost overlay, hotkeys.

const DIVISION_ICON_SCENE := preload("res://scenes/systems/military/division_icon.tscn")
const MoveOrderOverlay := preload("res://src/systems/military/move_order_overlay.gd")
const Pathfinder := preload("res://src/systems/military/pathfinder.gd")

const NATION_COLORS: Dictionary = {
	"germany":        Color(0.29, 0.29, 0.29),
	"france":         Color(0.0,  0.14, 0.58),
	"united_kingdom": Color(0.0,  0.07, 0.41),
	"italy":          Color(0.0,  0.57, 0.27),
	"spain":          Color(0.78, 0.04, 0.12),
	"algeria":        Color(0.0,  0.38, 0.20),
}
const NEUTRAL_COLOR := Color(0.45, 0.45, 0.45)

const LERP_SPEED := 8.0
const SNAP_THRESHOLD := 150.0
const ENGAGEMENT_RADIUS_PX := 60.0
const OBSERVATION_RADIUS_PX := 130.0
const HIT_THRESHOLD_PX := 20.0

var _map_loader: Node = null
var _icon_layer: Node2D = null

var _icons: Dictionary = {}
var _target_positions: Dictionary = {}

var _selected_division_id: String = ""
var _move_mode: bool = false

# Waypoint chain being built (shift+click milestones — each is one milestone waypoint ID)
var _pending_milestones: Array[String] = []
# Full accumulated A* path across all milestones (all waypoint IDs to submit)
var _pending_chain: Array[String] = []

var _pathfinder: RefCounted = null
var _ghost_overlay: Node2D = null


func setup(map_loader: Node, icon_layer: Node2D) -> void:
	_map_loader = map_loader
	_icon_layer = icon_layer

	# Build pathfinder from the loaded waypoint graph
	_pathfinder = Pathfinder.new()
	var wp_graph: Dictionary = _map_loader.get_waypoint_graph()
	if not wp_graph.is_empty():
		_pathfinder.build(wp_graph)

	# Ghost overlay node for planned waypoints
	_ghost_overlay = MoveOrderOverlay.new()
	_icon_layer.add_child(_ghost_overlay)

	EventBus.division_added.connect(_on_division_added)
	EventBus.division_updated.connect(_on_division_updated)
	EventBus.division_removed.connect(_on_division_removed)

	# Surface SUBMIT_MOVE_ORDER rejections in the console
	CommandQueue.command_rejected.connect(func(type: String, reason: String) -> void:
		if type == "SUBMIT_MOVE_ORDER":
			push_warning("[MilitarySystem] move rejected: " + reason)
	)

	# Catch-up: create icons for divisions that arrived before setup() ran
	for div_id: String in GameState.divisions:
		_on_division_added(div_id)


func _process(delta: float) -> void:
	for div_id: String in _icons:
		var icon: Node2D = _icons[div_id]
		var target: Vector2 = _target_positions.get(div_id, icon.position)
		var dist: float = icon.position.distance_to(target)
		if dist > SNAP_THRESHOLD:
			icon.position = target
		elif dist > 0.5:
			icon.position = icon.position.lerp(target, clampf(LERP_SPEED * delta, 0.0, 1.0))


# ── Input ─────────────────────────────────────────────────────────────────────

func handle_input(event: InputEvent) -> void:
	if not event is InputEventKey:
		return
	var key := event as InputEventKey
	if not key.pressed or key.echo:
		return

	match key.physical_keycode:
		KEY_M:
			if _selected_division_id != "":
				_move_mode = true
				_pending_milestones.clear()
				_pending_chain.clear()
				_update_ghost()
				_set_icon_move_mode(_selected_division_id, true)
		KEY_H:
			if _selected_division_id != "":
				_clear_pending()
				CommandQueue.submit("HOLD", { "division_id": _selected_division_id })
		KEY_X:
			if _selected_division_id != "":
				_clear_pending()
				CommandQueue.submit("HOLD", { "division_id": _selected_division_id })
		KEY_ESCAPE:
			_clear_pending()
			deselect()


## Left-click at a world-space position. Returns true if consumed (caller should mark event handled).
func try_click_at_world(world_pos: Vector2, shift_held: bool = false) -> bool:
	if _move_mode and _selected_division_id != "":
		var ll: Vector2 = _map_loader.world_to_lng_lat(world_pos)
		_handle_move_click(ll.x, ll.y, shift_held)
		return true

	var clicked_id := find_division_at_world(world_pos)
	if clicked_id != "":
		_select(clicked_id)
		return true

	# Click on empty map while something selected → deselect
	if _selected_division_id != "":
		deselect()
	return false


## Right-click: remove last milestone from chain if near a ghost dot, else do nothing.
func try_right_click_at_world(world_pos: Vector2) -> bool:
	if not _move_mode or _pending_milestones.is_empty():
		return false

	# Check if click is near the last ghost dot
	var ghost_positions: Array[Vector2] = _get_ghost_positions()
	if ghost_positions.is_empty():
		return false

	var last_pos: Vector2 = ghost_positions.back()
	if world_pos.distance_to(last_pos) <= HIT_THRESHOLD_PX * 2.0:
		_pending_milestones.pop_back()
		_recompute_chain()
		_update_ghost()
		return true

	return false


# ── Move mode helpers ─────────────────────────────────────────────────────────

func _handle_move_click(lng: float, lat: float, shift_held: bool) -> void:
	if not _pathfinder.is_built():
		push_warning("[MilitarySystem] Pathfinder not built — cannot route")
		_move_mode = false
		return

	var div_data: Dictionary = GameState.get_division(_selected_division_id)
	var movement_profile: Dictionary = {}
	var profile_json: String = div_data.get("movement_profile_json", "")
	if not profile_json.is_empty():
		var parsed: Variant = JSON.parse_string(profile_json)
		if parsed is Dictionary:
			movement_profile = parsed

	# Start from last milestone or division's current position
	var start_id: String
	if _pending_chain.is_empty():
		var div_lng: float = float(div_data.get("position_lng", 0.0))
		var div_lat: float = float(div_data.get("position_lat", 0.0))
		start_id = _pathfinder.find_nearest(div_lng, div_lat)
	else:
		start_id = _pending_chain.back()

	var goal_id: String = _pathfinder.find_nearest(lng, lat)

	var segment: Array = _pathfinder.find_path(start_id, goal_id, movement_profile)
	if segment.is_empty():
		push_warning("[MilitarySystem] No path found to target")
		if not shift_held:
			_clear_pending()
		return

	# Skip the start node if it duplicates the end of the existing chain
	var skip_first: bool = false
	if not _pending_chain.is_empty() and segment.size() > 0:
		skip_first = str(segment[0]) == _pending_chain.back()
	for i: int in segment.size():
		if i == 0 and skip_first:
			continue
		_pending_chain.append(segment[i])

	_pending_milestones.append(goal_id)

	if shift_held:
		_update_ghost()
	else:
		# Flash the route for 1.2 s so the player can see the planned path before it clears.
		_update_ghost()
		await get_tree().create_timer(1.2).timeout
		if _move_mode:
			_submit_pending()


func _recompute_chain() -> void:
	if _pending_milestones.is_empty():
		_pending_chain.clear()
		return

	var div_data: Dictionary = GameState.get_division(_selected_division_id)
	var movement_profile: Dictionary = {}
	var profile_json: String = div_data.get("movement_profile_json", "")
	if not profile_json.is_empty():
		var parsed: Variant = JSON.parse_string(profile_json)
		if parsed is Dictionary:
			movement_profile = parsed

	var div_lng: float = float(div_data.get("position_lng", 0.0))
	var div_lat: float = float(div_data.get("position_lat", 0.0))
	var start_id: String = _pathfinder.find_nearest(div_lng, div_lat)

	_pending_chain.clear()
	var current_start := start_id
	for milestone_id: String in _pending_milestones:
		var seg: Array = _pathfinder.find_path(current_start, milestone_id, movement_profile)
		if seg.is_empty():
			break
		var skip_first: bool = false
		if not _pending_chain.is_empty() and seg.size() > 0:
			skip_first = str(seg[0]) == _pending_chain.back()
		for i: int in seg.size():
			if i == 0 and skip_first:
				continue
			_pending_chain.append(seg[i])
		current_start = milestone_id


func _submit_pending() -> void:
	if _pending_chain.is_empty():
		return
	CommandQueue.submit("SUBMIT_MOVE_ORDER", {
		"division_id": _selected_division_id,
		"waypoints": _pending_chain.duplicate(),
	})
	_clear_pending()


func _clear_pending() -> void:
	_set_icon_move_mode(_selected_division_id, false)
	_pending_milestones.clear()
	_pending_chain.clear()
	_move_mode = false
	_update_ghost()


func _set_icon_move_mode(division_id: String, active: bool) -> void:
	var icon = _icons.get(division_id)
	if icon != null:
		(icon as Node2D).set_move_mode(active)


func _get_ghost_positions() -> Array[Vector2]:
	var positions: Array[Vector2] = []
	for wp_id: String in _pending_milestones:
		var node: Dictionary = _pathfinder.get_node(wp_id)
		if not node.is_empty():
			positions.append(_map_loader.project_lng_lat(float(node["lng"]), float(node["lat"])))
	return positions


func _update_ghost() -> void:
	if _ghost_overlay == null:
		return
	if _pending_milestones.is_empty():
		_ghost_overlay.clear()
		return

	var positions: Array[Vector2] = _get_ghost_positions()
	var color := Color.WHITE
	if _selected_division_id != "":
		var data: Dictionary = GameState.get_division(_selected_division_id)
		color = NATION_COLORS.get(data.get("nation_id", ""), NEUTRAL_COLOR)

	_ghost_overlay.set_milestones(positions, color)


# ── EventBus callbacks ────────────────────────────────────────────────────────

func _on_division_added(division_id: String) -> void:
	if _map_loader == null or _icon_layer == null:
		return
	if _icons.has(division_id):
		_on_division_updated(division_id)
		return
	var data: Dictionary = GameState.get_division(division_id)
	if data.is_empty():
		return

	var icon: Node2D = DIVISION_ICON_SCENE.instantiate()
	var color: Color = NATION_COLORS.get(data.get("nation_id", ""), NEUTRAL_COLOR)
	icon.setup(data, color, ENGAGEMENT_RADIUS_PX, OBSERVATION_RADIUS_PX)

	var lng: float = float(data.get("position_lng", 0.0))
	var lat: float = float(data.get("position_lat", 0.0))
	var screen_pos: Vector2 = _map_loader.project_lng_lat(lng, lat)
	icon.position = screen_pos
	_target_positions[division_id] = screen_pos

	_icon_layer.add_child(icon)
	_icons[division_id] = icon


func _on_division_updated(division_id: String) -> void:
	var icon = _icons.get(division_id)
	if icon == null:
		return
	var data: Dictionary = GameState.get_division(division_id)
	if data.is_empty():
		return

	icon.update_data(data)

	var lng: float = float(data.get("position_lng", 0.0))
	var lat: float = float(data.get("position_lat", 0.0))
	_target_positions[division_id] = _map_loader.project_lng_lat(lng, lat)


func _on_division_removed(division_id: String) -> void:
	var icon = _icons.get(division_id)
	if icon:
		icon.queue_free()
		_icons.erase(division_id)
		_target_positions.erase(division_id)
	if _selected_division_id == division_id:
		deselect()


# ── Selection ─────────────────────────────────────────────────────────────────

func _select(division_id: String) -> void:
	if _selected_division_id != "" and _icons.has(_selected_division_id):
		(_icons[_selected_division_id] as Node2D).set_selected(false)
	_selected_division_id = division_id
	if _icons.has(division_id):
		(_icons[division_id] as Node2D).set_selected(true)
	EventBus.division_selected.emit(division_id)
	_clear_pending()


func deselect() -> void:
	if _selected_division_id != "" and _icons.has(_selected_division_id):
		(_icons[_selected_division_id] as Node2D).set_selected(false)
	_selected_division_id = ""
	EventBus.division_deselected.emit()
	_clear_pending()


func find_division_at_world(world_pos: Vector2) -> String:
	var best_id := ""
	var best_dist := HIT_THRESHOLD_PX
	for div_id: String in _icons:
		var icon: Node2D = _icons[div_id]
		var d: float = icon.position.distance_to(world_pos)
		if d < best_dist:
			best_dist = d
			best_id = div_id
	return best_id
