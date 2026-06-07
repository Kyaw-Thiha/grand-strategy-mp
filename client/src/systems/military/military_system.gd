extends Node
## Manages division icon rendering on the strategic map.
## Spawns DivisionIcon nodes on division_added, LERPs their positions each frame,
## and handles selection + move order submission.
##
## Phase 4A scope: spawn, LERP, click to select, M + click to submit move order.

const DIVISION_ICON_SCENE := preload("res://scenes/systems/military/division_icon.tscn")

# Nation colours matching nations.ts definitions
const NATION_COLORS: Dictionary = {
	"germany":        Color(0.29, 0.29, 0.29),
	"france":         Color(0.0,  0.14, 0.58),
	"united_kingdom": Color(0.0,  0.07, 0.41),
	"italy":          Color(0.0,  0.57, 0.27),
	"spain":          Color(0.78, 0.04, 0.12),
	"algeria":        Color(0.0,  0.38, 0.20),
}
const NEUTRAL_COLOR := Color(0.45, 0.45, 0.45)

# How fast icons lerp toward their server positions (units/sec at screen scale).
const LERP_SPEED := 8.0
const SNAP_THRESHOLD := 150.0  # pixels — snap instead of lerp on large jumps

# Engagement and observation radius in pixels (approximated for Phase 4A display).
# Phase 4C will compute these from km using the map scale.
const ENGAGEMENT_RADIUS_PX := 60.0
const OBSERVATION_RADIUS_PX := 130.0

var _map_loader: Node = null     # set by owner scene
var _icon_layer: Node2D = null   # parent for all division icons

# division_id → DivisionIcon node
var _icons: Dictionary = {}

# LERP targets: division_id → Vector2 (screen position)
var _target_positions: Dictionary = {}

# Selection state
var _selected_division_id: String = ""

# Move mode
var _move_mode: bool = false


func setup(map_loader: Node, icon_layer: Node2D) -> void:
	_map_loader = map_loader
	_icon_layer = icon_layer

	EventBus.division_added.connect(_on_division_added)
	EventBus.division_updated.connect(_on_division_updated)
	EventBus.division_removed.connect(_on_division_removed)


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

## Called by the game scene's _input handler for division-related keys.
func handle_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_M and _selected_division_id != "":
			_move_mode = not _move_mode
		elif event.keycode == KEY_H and _selected_division_id != "":
			_submit_hold(_selected_division_id)
		elif event.keycode == KEY_ESCAPE:
			_move_mode = false
			deselect()


## Called by the game scene when a map click occurs (world position in lng/lat).
func handle_map_click(lng: float, lat: float) -> void:
	if _move_mode and _selected_division_id != "":
		_submit_move_order(_selected_division_id, lng, lat)
		_move_mode = false
		return

	# Check if a division icon was clicked
	var clicked_id := _find_division_at(lng, lat)
	if clicked_id != "":
		_select(clicked_id)
	else:
		deselect()


# ── EventBus callbacks ────────────────────────────────────────────────────────

func _on_division_added(division_id: String) -> void:
	if _map_loader == null or _icon_layer == null:
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
	_move_mode = false


func deselect() -> void:
	if _selected_division_id != "" and _icons.has(_selected_division_id):
		(_icons[_selected_division_id] as Node2D).set_selected(false)
	_selected_division_id = ""
	EventBus.division_deselected.emit()
	_move_mode = false


## Returns division id hit at a world-space position, or "" if none within threshold.
func find_division_at_world(world_pos: Vector2) -> String:
	var best_id := ""
	var best_dist := 20.0  # pixel threshold
	for div_id: String in _icons:
		var icon: Node2D = _icons[div_id]
		var d: float = icon.position.distance_to(world_pos)
		if d < best_dist:
			best_dist = d
			best_id = div_id
	return best_id


## Attempt a click at world-space position. Returns true if a division was hit (caller should consume the event).
func try_click_at_world(world_pos: Vector2) -> bool:
	if _move_mode and _selected_division_id != "":
		var ll: Vector2 = _map_loader.world_to_lng_lat(world_pos)
		_submit_move_order(_selected_division_id, ll.x, ll.y)
		_move_mode = false
		return true

	var clicked_id := find_division_at_world(world_pos)
	if clicked_id != "":
		_select(clicked_id)
		return true
	return false


func _find_division_at(lng: float, lat: float) -> String:
	if _map_loader == null:
		return ""
	var click_screen: Vector2 = _map_loader.project_lng_lat(lng, lat)
	return find_division_at_world(click_screen)


# ── Commands ──────────────────────────────────────────────────────────────────

func _submit_move_order(division_id: String, target_lng: float, target_lat: float) -> void:
	var wp_graph: Dictionary = _map_loader.get_waypoint_graph()
	var nearest_wp_id := _find_nearest_waypoint(wp_graph, target_lng, target_lat)
	if nearest_wp_id.is_empty():
		push_warning("[MilitarySystem] No waypoints loaded — cannot submit move order")
		return
	CommandQueue.submit("SUBMIT_MOVE_ORDER", {
		"division_id": division_id,
		"waypoints": [nearest_wp_id],
	})


func _submit_hold(division_id: String) -> void:
	CommandQueue.submit("HOLD", { "division_id": division_id })


func _find_nearest_waypoint(wp_graph: Dictionary, lng: float, lat: float) -> String:
	var nodes: Array = wp_graph.get("nodes", [])
	var best_id := ""
	var best_sq := INF
	for node: Dictionary in nodes:
		var dx: float = float(node.get("lng", 0.0)) - lng
		var dy: float = float(node.get("lat", 0.0)) - lat
		var sq: float = dx * dx + dy * dy
		if sq < best_sq:
			best_sq = sq
			best_id = node.get("id", "")
	return best_id
