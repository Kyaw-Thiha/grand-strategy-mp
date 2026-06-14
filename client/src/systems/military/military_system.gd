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

## Set false to allow issuing orders to any nation's units (debug only).
const ENFORCE_OWNERSHIP := true

const LERP_SPEED := 3.5
const SNAP_THRESHOLD := 150.0
const ENGAGEMENT_RADIUS_PX := 18.0
const OBSERVATION_RADIUS_PX := 54.0
const HIT_THRESHOLD_PX := 20.0
## Distance threshold (deg) at which road avoidance reaches maximum strength (~1500m).
const OFFROAD_THRESHOLD_DEG := 0.014
## Maximum road cost multiplier applied when player is deep off-road.
const MAX_ROAD_MULTIPLIER := 13.0
## Dead reckoning — must match movement_system.ts constants exactly.
const DR_ROAD_KMH     := 60.0
const DR_OFFROAD_KMH  := 20.0
const DR_KM_PER_DEG   := 111.0
const DR_SNAP_DEG     := 0.0001  # waypoint snap threshold (matches server)

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
var _route_overlays: Dictionary = {}   # div_id → MoveOrderOverlay node

var _path_thread: Thread = null
var _path_pending: bool = false
var _pending_auto_submit: bool = false      # true during the 1.2s non-shift flash window
var _submit_on_thread_complete: bool = false # submit chain as soon as current thread finishes
var _shift_chain_started: bool = false      # true once the user has made at least one shift-click

var _dr_pos_deg: Dictionary = {}   # div_id -> Vector2(lng, lat) — local simulated position
var _dr_order: Dictionary = {}     # div_id -> Array[String] — client-local waypoint queue
var _dr_profiles: Dictionary = {}  # div_id -> Dictionary — cached parsed movement profiles

var _pending_chain_origin_deg: Vector2 = Vector2.ZERO
var _chain_last_refresh_time: float = 0.0
const CHAIN_REFRESH_INTERVAL_SEC := 1.0
const CHAIN_REFRESH_MIN_MOVE_DEG := 0.02


func get_icons() -> Dictionary:
	return _icons


func setup(map_loader: Node, icon_layer: Node2D) -> void:
	_map_loader = map_loader
	_icon_layer = icon_layer

	# Build pathfinder from the loaded waypoint graph
	_pathfinder = Pathfinder.new()
	var wp_graph: Dictionary = _map_loader.get_waypoint_graph()
	if not wp_graph.is_empty():
		_pathfinder.build(wp_graph)

	# Ghost overlay for the pending route being built (shift+click chain preview)
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
		if _dr_order.has(div_id) and not _dr_order[div_id].is_empty():
			_advance_dr(div_id, delta)
			_update_division_route(div_id)
		else:
			var target: Vector2 = _target_positions.get(div_id, icon.position)
			if icon.position.distance_to(target) > 0.5:
				icon.position = icon.position.lerp(target, clampf(LERP_SPEED * delta, 0.0, 1.0))

	# Live ghost refresh while building a shift chain with a moving unit
	if _move_mode and _shift_chain_started and not _pending_milestones.is_empty() and not _path_pending:
		var sel_id := _selected_division_id
		if _dr_order.has(sel_id) and not _dr_order[sel_id].is_empty():
			var now := Time.get_ticks_msec() / 1000.0
			var dr: Vector2 = _dr_pos_deg.get(sel_id, Vector2.ZERO)
			if now - _chain_last_refresh_time >= CHAIN_REFRESH_INTERVAL_SEC \
					and dr.distance_to(_pending_chain_origin_deg) > CHAIN_REFRESH_MIN_MOVE_DEG:
				_chain_last_refresh_time = now
				_refresh_chain_start()


# ── Ownership ─────────────────────────────────────────────────────────────────

func _is_own_unit(division_id: String) -> bool:
	if not ENFORCE_OWNERSHIP:
		return true
	var my_nation: String = GameState.get_my_nation_id()
	if my_nation.is_empty():
		return true  # standalone debug (no auth) — allow all
	return GameState.get_division(division_id).get("nation_id", "") == my_nation


# ── Input ─────────────────────────────────────────────────────────────────────

func handle_input(event: InputEvent) -> void:
	if not event is InputEventKey:
		return
	var key := event as InputEventKey
	if key.echo:
		return

	if not key.pressed:
		# Key-up: only act on Shift release — submit if user actually shift-clicked.
		if key.physical_keycode == KEY_SHIFT:
			if _shift_chain_started and _move_mode and not _pending_milestones.is_empty():
				if _path_pending:
					_submit_on_thread_complete = true
				else:
					_submit_pending()
		return

	match key.physical_keycode:
		KEY_SHIFT:
			# Shift pressed during the 1.2s non-shift transition window → promote to chain.
			if _pending_auto_submit and _move_mode and not _pending_milestones.is_empty():
				_pending_auto_submit = false
				_shift_chain_started = true
		KEY_M:
			if _selected_division_id != "" and _is_own_unit(_selected_division_id):
				_move_mode = true
				_pending_milestones.clear()
				_pending_chain.clear()
				_update_ghost()
				_set_icon_move_mode(_selected_division_id, true)
		KEY_H:
			if _selected_division_id != "" and _is_own_unit(_selected_division_id):
				_clear_pending()
				CommandQueue.submit("HOLD", { "division_id": _selected_division_id })
		KEY_X:
			if _selected_division_id != "" and _is_own_unit(_selected_division_id):
				_clear_pending()
				CommandQueue.submit("HOLD", { "division_id": _selected_division_id })
		KEY_G:
			if _selected_division_id != "" and _is_own_unit(_selected_division_id):
				_clear_pending()
				CommandQueue.submit("RETREAT", { "division_id": _selected_division_id })
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

	# Ignore clicks while a path is already computing.
	if _path_pending:
		return

	var div_data: Dictionary = GameState.get_division(_selected_division_id)
	var movement_profile: Dictionary = {}
	var profile_json: String = div_data.get("movement_profile_json", "")
	if not profile_json.is_empty():
		var parsed: Variant = JSON.parse_string(profile_json)
		if parsed is Dictionary:
			movement_profile = parsed

	# Start from last milestone, DR-simulated position, or server position (in priority order).
	var start_id: String
	if not _pending_chain.is_empty():
		start_id = _pending_chain.back()
	elif _dr_pos_deg.has(_selected_division_id):
		var dr: Vector2 = _dr_pos_deg[_selected_division_id]
		start_id = _pathfinder.find_nearest(dr.x, dr.y)
	else:
		start_id = _pathfinder.find_nearest(
				float(div_data.get("position_lng", 0.0)),
				float(div_data.get("position_lat", 0.0)))

	var goal_id: String = _pathfinder.find_nearest(lng, lat)

	if shift_held:
		_shift_chain_started = true

	# Compute avoidance multiplier on main thread (safe — read-only pathfinder access).
	# waypoint_index 0 means this is the first shift-click; no avoidance on the first segment.
	var waypoint_index := _pending_milestones.size()
	var road_mult := 1.0
	if shift_held and waypoint_index > 0:
		var sn: Dictionary = _pathfinder.get_node(start_id)
		if not sn.is_empty():
			var d: float = _pathfinder.nearest_road_node_distance(float(sn["lng"]), float(sn["lat"]))
			road_mult = _compute_avoidance_multiplier(d)

	_path_pending = true
	_path_thread = Thread.new()
	var division_id_snapshot := _selected_division_id
	_path_thread.start(func() -> void:
		# Only apply avoidance when there is no road naturally lying between waypoints.
		var effective_mult := 1.0
		if shift_held and waypoint_index > 0 and road_mult > 1.0:
			if not _pathfinder.road_crosses_segment(start_id, goal_id):
				effective_mult = road_mult
		var segment: Array = _pathfinder.find_path(start_id, goal_id, movement_profile, effective_mult)
		call_deferred("_on_segment_ready", segment, goal_id, shift_held, division_id_snapshot)
	)


func _on_segment_ready(segment: Array, goal_id: String, shift_held: bool, division_id_snapshot: String) -> void:
	if _path_thread != null and _path_thread.is_started():
		_path_thread.wait_to_finish()
	_path_thread = null
	_path_pending = false

	# Division was deselected or mode changed while computing — discard result.
	if not _move_mode or _selected_division_id != division_id_snapshot:
		_submit_on_thread_complete = false
		return

	if segment.is_empty():
		push_warning("[MilitarySystem] No path found to target")
		if not shift_held:
			_clear_pending()
		_submit_on_thread_complete = false
		return

	var was_empty := _pending_chain.is_empty()
	_append_segment_to_chain(segment, goal_id)
	if was_empty:
		_pending_chain_origin_deg = _dr_pos_deg.get(_selected_division_id, Vector2.ZERO)
		_chain_last_refresh_time = Time.get_ticks_msec() / 1000.0

	# Shift was released while this segment was computing — submit immediately.
	if _submit_on_thread_complete:
		_submit_on_thread_complete = false
		_submit_pending()
		return

	if shift_held:
		_update_ghost()
	else:
		_update_ghost()
		_pending_auto_submit = true
		get_tree().create_timer(1.2).timeout.connect(func() -> void:
			if _pending_auto_submit and _move_mode:
				_pending_auto_submit = false
				_submit_pending()
		, CONNECT_ONE_SHOT)


func _append_segment_to_chain(segment: Array, goal_id: String) -> void:
	var skip_first: bool = false
	if not _pending_chain.is_empty() and segment.size() > 0:
		skip_first = str(segment[0]) == _pending_chain.back()
	for i: int in segment.size():
		if i == 0 and skip_first:
			continue
		_pending_chain.append(segment[i])
	_pending_milestones.append(goal_id)


func _compute_avoidance_multiplier(dist_deg: float) -> float:
	var factor := clampf(dist_deg / OFFROAD_THRESHOLD_DEG, 0.0, 1.0)
	return 1.0 + factor * (MAX_ROAD_MULTIPLIER - 1.0)


func _refresh_chain_start() -> void:
	var div_id := _selected_division_id
	if not _dr_pos_deg.has(div_id) or _pending_milestones.is_empty():
		return
	var dr: Vector2 = _dr_pos_deg[div_id]
	_pending_chain_origin_deg = dr

	var div_data: Dictionary = GameState.get_division(div_id)
	var movement_profile: Dictionary = {}
	var pj: String = div_data.get("movement_profile_json", "")
	if not pj.is_empty():
		var parsed: Variant = JSON.parse_string(pj)
		if parsed is Dictionary:
			movement_profile = parsed

	var start_id: String = _pathfinder.find_nearest(dr.x, dr.y)
	var goal_id: String = _pending_milestones[0]
	var milestones_snapshot: Array = _pending_milestones.duplicate()
	var div_id_snapshot := div_id

	_path_pending = true
	_path_thread = Thread.new()
	_path_thread.start(func() -> void:
		var segment: Array = _pathfinder.find_path(start_id, goal_id, movement_profile)
		call_deferred("_on_chain_refresh_ready", segment, milestones_snapshot, div_id_snapshot)
	)


func _on_chain_refresh_ready(segment: Array, milestones_at_refresh: Array, div_id_snapshot: String) -> void:
	if _path_thread != null and _path_thread.is_started():
		_path_thread.wait_to_finish()
	_path_thread = null
	_path_pending = false

	var mode_changed: bool = not _move_mode or _selected_division_id != div_id_snapshot \
			or _pending_milestones != milestones_at_refresh
	if mode_changed:
		if _submit_on_thread_complete:
			_submit_on_thread_complete = false
			_submit_pending()
		return

	if _submit_on_thread_complete:
		_submit_on_thread_complete = false
		if not segment.is_empty():
			_replace_chain_first_segment(segment)
		_submit_pending()
		return

	if segment.is_empty():
		return
	_replace_chain_first_segment(segment)
	_update_ghost()


func _replace_chain_first_segment(new_segment: Array) -> void:
	if _pending_milestones.is_empty():
		return
	var first_milestone := _pending_milestones[0]
	var milestone_idx := _pending_chain.find(first_milestone)
	if milestone_idx < 0:
		return

	var tail: Array[String] = []
	for i: int in range(milestone_idx + 1, _pending_chain.size()):
		tail.append(_pending_chain[i])

	_pending_chain.clear()
	for wp: Variant in new_segment:
		_pending_chain.append(str(wp))
	_pending_chain.append_array(tail)


func _advance_dr(div_id: String, delta: float) -> void:
	var order: Array[String] = _dr_order[div_id]
	if order.is_empty():
		return
	var pos_deg: Vector2 = _dr_pos_deg[div_id]

	var next_id: String = order[0]
	var next_node: Dictionary = _pathfinder.get_node(next_id)
	if next_node.is_empty():
		return

	var target_deg := Vector2(float(next_node["lng"]), float(next_node["lat"]))

	# Speed — mirrors movement_system.ts formula exactly.
	var kmh: float
	if _pathfinder.is_road_node(next_id):
		kmh = DR_ROAD_KMH
	else:
		var profile: Dictionary = _dr_profiles.get(div_id, {})
		var terrain_key := str(next_node.get("cover_combat", "")) + "_" + str(next_node.get("elevation", ""))
		var raw_cost: Variant = profile.get(terrain_key, 1.0)
		if raw_cost == null:
			return  # impassable (null = Infinity from server JSON) — wait for server to reroute
		var cost: float = float(raw_cost)
		if not is_finite(cost) or cost <= 0.0:
			return  # impassable — wait for server to reroute
		kmh = DR_OFFROAD_KMH / cost

	var speed_degs: float = (kmh / DR_KM_PER_DEG) * float(GameState.game_speed)
	var advance: float = speed_degs * delta

	var to_target: Vector2 = target_deg - pos_deg
	var dist: float = to_target.length()

	if dist < DR_SNAP_DEG or advance >= dist:
		# Reached waypoint — snap and carry leftover time into the next segment.
		_dr_pos_deg[div_id] = target_deg
		order.pop_front()
		_dr_order[div_id] = order
		if order.is_empty():
			# DR exhausted — park icon at final waypoint so lerp doesn't pull back to origin.
			_target_positions[div_id] = _map_loader.project_lng_lat(
					_dr_pos_deg[div_id].x, _dr_pos_deg[div_id].y)
			_update_division_route(div_id)
			var done_icon := _icons[div_id] as Node2D
			done_icon.position = _target_positions[div_id]
			done_icon.set_moving(false)
			return
		if dist > 0.0:
			var leftover: float = delta * maxf(1.0 - dist / maxf(advance, 1e-9), 0.0)
			if leftover > 0.001:
				_advance_dr(div_id, leftover)
				return  # icon position already updated by recursive call
	else:
		_dr_pos_deg[div_id] = pos_deg + to_target.normalized() * advance

	var moving_icon := _icons[div_id] as Node2D
	moving_icon.position = _map_loader.project_lng_lat(
			_dr_pos_deg[div_id].x, _dr_pos_deg[div_id].y)
	moving_icon.queue_redraw()


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

	var div_id := _selected_division_id
	if not _is_own_unit(div_id):
		return

	# Trim chain: drop waypoints already behind the unit so neither DR nor server reverses.
	var chain_to_submit: Array[String] = _pending_chain.duplicate()
	if _dr_pos_deg.has(div_id) and chain_to_submit.size() > 1:
		var dr: Vector2 = _dr_pos_deg[div_id]
		var nearest_idx := 0
		var nearest_d2 := INF
		for i: int in chain_to_submit.size():
			var node: Dictionary = _pathfinder.get_node(chain_to_submit[i])
			if node.is_empty():
				continue
			var dx := float(node["lng"]) - dr.x
			var dy := float(node["lat"]) - dr.y
			var d2 := dx * dx + dy * dy
			if d2 < nearest_d2:
				nearest_d2 = d2
				nearest_idx = i
		if nearest_idx > 0:
			chain_to_submit = chain_to_submit.slice(nearest_idx)

	var chain_snapshot: Array = chain_to_submit

	CommandQueue.submit("SUBMIT_MOVE_ORDER", {
		"division_id": div_id,
		"waypoints": chain_snapshot,
	})

	# Seed DR immediately — don't wait for the server's ~1s DIVISION_UPDATES confirmation.
	if not _dr_pos_deg.has(div_id):
		var div_data: Dictionary = GameState.get_division(div_id)
		_dr_pos_deg[div_id] = Vector2(
				float(div_data.get("position_lng", 0.0)),
				float(div_data.get("position_lat", 0.0)))

	if not _dr_profiles.has(div_id):
		var div_data: Dictionary = GameState.get_division(div_id)
		var pj: String = div_data.get("movement_profile_json", "")
		if not pj.is_empty():
			var parsed: Variant = JSON.parse_string(pj)
			if parsed is Dictionary:
				_dr_profiles[div_id] = parsed

	var str_order: Array[String] = []
	for wp: Variant in chain_snapshot:
		str_order.append(str(wp))
	_dr_order[div_id] = str_order

	var icon_node := _icons.get(div_id) as Node2D
	if icon_node:
		icon_node.set_moving(true)

	_update_division_route(div_id)

	_clear_pending()


func _clear_pending() -> void:
	_set_icon_move_mode(_selected_division_id, false)
	_pending_milestones.clear()
	_pending_chain.clear()
	_move_mode = false
	_path_pending = false
	_pending_auto_submit = false
	_submit_on_thread_complete = false
	_shift_chain_started = false
	_pending_chain_origin_deg = Vector2.ZERO
	_chain_last_refresh_time = 0.0
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


func _get_chain_positions() -> Array[Vector2]:
	var positions: Array[Vector2] = []
	for wp_id: String in _pending_chain:
		var node: Dictionary = _pathfinder.get_node(wp_id)
		if not node.is_empty():
			positions.append(_map_loader.project_lng_lat(float(node["lng"]), float(node["lat"])))
	return positions


func _update_ghost() -> void:
	if _ghost_overlay == null:
		return
	if _pending_milestones.is_empty():
		_ghost_overlay.start_node = null
		_ghost_overlay.clear()
		return

	var color := Color.WHITE
	if _selected_division_id != "":
		var data: Dictionary = GameState.get_division(_selected_division_id)
		color = NATION_COLORS.get(data.get("nation_id", ""), NEUTRAL_COLOR)

	var icon: Node2D = _icons.get(_selected_division_id) as Node2D
	var dr_active: bool = _dr_order.has(_selected_division_id) \
			and not _dr_order[_selected_division_id].is_empty()
	_ghost_overlay.start_node = icon if (dr_active and icon != null) else null

	_ghost_overlay.set_path(_get_chain_positions(), _get_ghost_positions(), color)


func _update_division_route(division_id: String) -> void:
	var route := _route_overlays.get(division_id) as Node2D
	if route == null:
		return

	var div_data: Dictionary = GameState.get_division(division_id)
	var color: Color = NATION_COLORS.get(div_data.get("nation_id", ""), NEUTRAL_COLOR)
	var no_milestones: Array[Vector2] = []
	var icon: Node2D = _icons.get(division_id) as Node2D

	# DR active (owning client) — 60fps update via client-side remaining order.
	var dr_order: Array = _dr_order.get(division_id, [])
	if not dr_order.is_empty() and icon != null:
		var positions: Array[Vector2] = []
		for wp_id: Variant in dr_order:
			var node: Dictionary = _pathfinder.get_node(str(wp_id))
			if not node.is_empty():
				positions.append(_map_loader.project_lng_lat(float(node["lng"]), float(node["lat"])))
		route.start_node = icon
		route.set_path(positions, no_milestones, color.darkened(0.25))
		return

	# No local DR — draw from server move_order (foreign unit or stopped/arrived).
	route.start_node = null
	var order: Array = div_data.get("move_order", [])
	if order.is_empty():
		route.clear()
		return
	var positions: Array[Vector2] = []
	for wp_id: Variant in order:
		var node: Dictionary = _pathfinder.get_node(str(wp_id))
		if not node.is_empty():
			positions.append(_map_loader.project_lng_lat(float(node["lng"]), float(node["lat"])))
	if icon != null:
		route.start_node = icon
	route.set_path(positions, no_milestones, color.darkened(0.25))


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

	var route: Node2D = MoveOrderOverlay.new()
	_icon_layer.add_child(route)
	_route_overlays[division_id] = route


func _on_division_updated(division_id: String) -> void:
	var icon = _icons.get(division_id)
	if icon == null:
		return
	var data: Dictionary = GameState.get_division(division_id)
	if data.is_empty():
		return

	icon.update_data(data)

	var server_lng := float(data.get("position_lng", 0.0))
	var server_lat := float(data.get("position_lat", 0.0))

	var order: Array = data.get("move_order", [])

	if order.is_empty():
		# Division stopped — clear DR, snap icon to server position.
		_dr_pos_deg.erase(division_id)
		_dr_order.erase(division_id)
		_dr_profiles.erase(division_id)
		_target_positions[division_id] = _map_loader.project_lng_lat(server_lng, server_lat)
		(icon as Node2D).set_moving(false)
		_update_division_route(division_id)
		return

	# Cache movement profile once (doesn't change during a session).
	if not _dr_profiles.has(division_id):
		var pj: String = data.get("movement_profile_json", "")
		if not pj.is_empty():
			var parsed: Variant = JSON.parse_string(pj)
			if parsed is Dictionary:
				_dr_profiles[division_id] = parsed

	# Build typed String order.
	var str_order: Array[String] = []
	for wp: Variant in order:
		str_order.append(str(wp))

	if not _dr_pos_deg.has(division_id):
		# Foreign unit (no local DR seeded by submit) — lerp to server position.
		# Route is drawn from server move_order waypoints without running pathfinding.
		_target_positions[division_id] = _map_loader.project_lng_lat(server_lng, server_lat)
		(icon as Node2D).set_moving(true)
	else:
		# Owning client — sync DR order when server consumed more waypoints.
		var cur_order: Array = _dr_order[division_id]
		if str_order.size() < cur_order.size():
			_dr_order[division_id] = str_order

	_update_division_route(division_id)


func _on_division_removed(division_id: String) -> void:
	var icon = _icons.get(division_id)
	if icon:
		icon.queue_free()
		_icons.erase(division_id)
		_target_positions.erase(division_id)
	var route := _route_overlays.get(division_id) as Node2D
	if route:
		route.queue_free()
	_route_overlays.erase(division_id)
	_dr_pos_deg.erase(division_id)
	_dr_order.erase(division_id)
	_dr_profiles.erase(division_id)
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
