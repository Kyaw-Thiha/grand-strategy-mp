extends Node
## Manages division icon rendering on the strategic map.
## Phase 4B: A* pathfinding, waypoint chain (shift+click), ghost overlay, hotkeys.

const DIVISION_ICON_SCENE := preload("res://scenes/systems/military/division_icon.tscn")
const ENGAGEMENT_BANNER_SCENE := preload("res://scenes/systems/military/engagement_banner.tscn")
const MoveOrderOverlay := preload("res://src/systems/military/move_order_overlay.gd")
const MoveDestinationEffectScript := preload("res://src/systems/military/move_destination_effect.gd")
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
const ENGAGEMENT_RADIUS_KM := 25.0
const OBSERVATION_RADIUS_PX := 45.0
const SCOUTING_RADIUS_PX := 60.0
const HIT_THRESHOLD_PX := 20.0
const DRAG_SELECT_THRESHOLD_PX := 6.0
const ORDINARY_DIVISION_EMPHASIS := 0.92
const FULL_DIVISION_EMPHASIS := 1.0
## Distance threshold (deg) at which road avoidance reaches maximum strength (~1500m).
const OFFROAD_THRESHOLD_DEG := 0.014
## Maximum road cost multiplier applied when player is deep off-road.
const MAX_ROAD_MULTIPLIER := 13.0
## Set false to revert foreign units to legacy lerp mode (useful for late-game perf testing).
const FOREIGN_UNIT_PATH_DR := true
## Dead reckoning — must match movement_system.ts constants exactly.
const DR_ROAD_KMH     := 60.0
const DR_OFFROAD_KMH  := 20.0
const DR_KM_PER_DEG   := 111.0
const DR_SNAP_DEG     := 0.0001  # waypoint snap threshold (matches server)
const REPOSITION_SPEED := 0.30   # matches server's REPOSITION_SPEED
## Click radius (degrees, ~500 m at Western European latitudes) within which a click snaps to
## a province's `city_position` rather than the raw mouse coordinate. Tight enough that clicks
## clearly intended for open terrain just outside a city boundary aren't hijacked; small enough
## to read as "I clicked on the city." Compared to ROAD_SEARCH_RADIUS_SQ (0.015², ~1.5 km):
## road snapping is more permissive because roads are a routing preference, but city snapping is
## a deliberate UX intent. See LAND_MOVEMENT_IMPROVEMENTS.md Point 3.
const CITY_SNAP_RADIUS_DEG := 0.005
const CITY_SNAP_RADIUS_SQ := 0.005 * 0.005

var _map_loader: Node = null
var _icon_layer: Node2D = null
var _vision_system: Node = null

var _icons: Dictionary = {}
var _banners: Dictionary = {}  # engagement_key → EngagementBanner node
var _target_positions: Dictionary = {}
var _visible_provinces: Dictionary = {}
var _vision_filter_enabled: bool = false
var _air_revealed_divisions: Dictionary = {}

var _selected_division_id: String = ""
var _selected_division_ids: Array[String] = []
var _selection_preview_division_ids: Array[String] = []
var _hovered_division_id: String = ""
var _move_mode: bool = false
var _reposition_mode: bool = false
var _reposition_div_id: String = ""
var _drag_select_pressed: bool = false
var _drag_select_active: bool = false
var _drag_select_start_screen: Vector2 = Vector2.ZERO
var _drag_select_current_screen: Vector2 = Vector2.ZERO
var _drag_select_additive: bool = false
var _drag_select_subtractive: bool = false
var _drag_select_can_activate: bool = false

# Waypoint chain being built (shift+click milestones — each is one milestone waypoint ID)
var _pending_milestones: Array[String] = []
# Full accumulated A* path across all milestones (all waypoint IDs to submit)
var _pending_chain: Array[String] = []

var _pathfinder: RefCounted = null
var _ghost_overlay: Node2D = null
var _selection_canvas_layer: CanvasLayer = null
var _selection_box_overlay: Control = null
var _route_overlays: Dictionary = {}   # div_id → MoveOrderOverlay node

var _path_thread: Thread = null
var _path_pending: bool = false
var _path_gen: int = 0
var _pending_auto_submit: bool = false      # true during the 0.2s non-shift flash window
var _submit_on_thread_complete: bool = false # submit chain as soon as current thread finishes
var _shift_chain_started: bool = false      # true once the user has made at least one shift-click

var _dr_pos_deg: Dictionary = {}   # div_id -> Vector2(lng, lat) — local simulated position
var _dr_order: Dictionary = {}     # div_id -> Array — client-local DR queue.
								   # Each entry: Dictionary {id: String, lng: float, lat: float, kmh: float}.
								   # - Real waypoint: id set (the waypoint id), lng/lat from the node,
								   #   kmh from terrain — speed lookup happens at build time, not per frame.
								   # - Jitter sub-point: id="" (synthetic), kmh inherited from the
								   #   segment's source real waypoint (Point 2 off-road jitter).
								   # - Terminal hop (Point 4): id="" with the resolved final point,
								   #   kmh carried over from the last real waypoint consumed.
								   #   Replaces the old _dr_final_goal + _advance_dr_last_mile pair —
								   #   the final hop is now a regular entry consumed by the same DR
								   #   loop as the rest of the chain.
var _dr_profiles: Dictionary = {}  # div_id -> Dictionary — cached parsed movement profiles
var _dr_speed_mult: Dictionary = {}  # div_id -> float — speed multiplier (1.0 normal, 0.30 repos)
var _dr_last_real_kmh: Dictionary = {}  # div_id -> float — kmh of the most recently consumed
										# real-waypoint entry. Used by Point 4 to seed the kmh of
										# a freshly-appended terminal entry when server's
										# final_position_lng/lat updates mid-flight (the chain's
										# last real entry has already been popped by then).
var _dr_icon_reconcile_from: Dictionary = {}  # div_id → Vector2 screen pos (blend start)
var _dr_icon_reconcile_t: Dictionary    = {}  # div_id → float 0.0..1.0 blend progress
## One-time snapshot of every province's city_position, built at setup() for click-time snapping.
## Linear-scanned on every right-click / move-click (clicks are infrequent — O(N) per click is fine).
## Each entry: {lng: float, lat: float, province_id: String}. World projection not stored here
## because snap compares in lng/lat (the input space); consumers can project the result themselves.
var _city_index: Array[Dictionary] = []

var _pending_chain_origin_deg: Vector2 = Vector2.ZERO
var _chain_last_refresh_time: float = 0.0
const CHAIN_REFRESH_INTERVAL_SEC := 1.0
const CHAIN_REFRESH_MIN_MOVE_DEG := 0.02
const GROUP_MOVE_SLOT_SPACING_DEG := 0.045


func get_icons() -> Dictionary:
	return _icons

func get_banners() -> Dictionary:
	return _banners


## Returns the world-space center of a rendered division counter.
func get_division_world_position(division_id: String) -> Vector2:
	var icon: Node2D = _icons.get(division_id) as Node2D
	if icon == null or not icon.visible:
		return Vector2.INF
	return icon.global_position


## Returns the current viewport position for a rendered division counter.
## Parameters:
## - division_id: division whose counter should be projected.
## Returns: screen position, or Vector2(-1, -1) when no visible counter exists.
func _get_division_screen_position(division_id: String) -> Vector2:
	var icon: Node2D = _icons.get(division_id) as Node2D
	if icon == null or not icon.visible:
		return Vector2(-1.0, -1.0)
	return get_viewport().get_canvas_transform() * icon.global_position


func setup(map_loader: Node, icon_layer: Node2D, vision_system: Node = null) -> void:
	_map_loader = map_loader
	_icon_layer = icon_layer
	_vision_system = vision_system

	# Build pathfinder from the loaded waypoint graph
	_pathfinder = Pathfinder.new()
	var wp_graph: Dictionary = _map_loader.get_waypoint_graph()
	if not wp_graph.is_empty():
		_pathfinder.build(wp_graph)

	# Load HPA* clusters if available
	var cluster_path := "res://assets/data/western_europe_6/waypoints_clusters.json"
	if FileAccess.file_exists(cluster_path):
		var file := FileAccess.open(cluster_path, FileAccess.READ)
		if file:
			var cluster_data: Variant = JSON.parse_string(file.get_as_text())
			file.close()
			if cluster_data is Dictionary:
				_pathfinder.build_clusters(cluster_data)
				print("[MilitarySystem] HPA* clusters loaded")

	# Ghost overlay for the pending route being built (shift+click chain preview)
	_ghost_overlay = MoveOrderOverlay.new()
	_icon_layer.add_child(_ghost_overlay)

	_selection_canvas_layer = CanvasLayer.new()
	_selection_canvas_layer.layer = 1
	add_child(_selection_canvas_layer)
	_selection_box_overlay = SelectionBoxOverlay.new()
	_selection_canvas_layer.add_child(_selection_box_overlay)

	EventBus.division_added.connect(_on_division_added)
	EventBus.division_updated.connect(_on_division_updated)
	EventBus.division_removed.connect(_on_division_removed)
	EventBus.stack_formed.connect(_on_stack_formed)
	EventBus.stack_rotated.connect(_on_stack_rotated)
	EventBus.stack_dissolved.connect(_on_stack_dissolved)
	EventBus.vision_visibility_changed.connect(_on_vision_visibility_changed)
	EventBus.division_revealed.connect(_on_division_revealed_with_ping)
	EventBus.division_hidden.connect(_on_division_hidden)
	EventBus.division_appeared.connect(_on_division_appeared)
	EventBus.division_vanishing.connect(_on_division_vanishing)
	EventBus.reposition_mode_requested.connect(_enter_reposition_mode)
	EventBus.division_active_requested.connect(_set_active_division)
	EventBus.division_selection_remove_requested.connect(_remove_from_selection)
	EventBus.division_hold_selected_requested.connect(_hold_selected_divisions)
	EventBus.division_hold_requested.connect(_hold_division)
	EventBus.division_retreat_selected_requested.connect(_retreat_selected_divisions)
	EventBus.division_retreat_requested.connect(_retreat_division)
	EventBus.move_mode_cancelled.connect(_clear_pending)
	EventBus.combat_started.connect(_on_combat_started_banner)
	EventBus.combat_resolved.connect(_on_combat_resolved_banner)

	# Surface SUBMIT_MOVE_ORDER and REPOSITION rejections in the console
	CommandQueue.command_rejected.connect(func(type: String, reason: String) -> void:
		if type == "SUBMIT_MOVE_ORDER":
			push_warning("[MilitarySystem] move rejected: " + reason)
		elif type == "REPOSITION":
			push_warning("[MilitarySystem] reposition rejected: " + reason)
	)

	# Catch-up: create icons for divisions that arrived before setup() ran
	for div_id: String in GameState.divisions:
		_on_division_added(div_id)

	_build_city_index()


func _process(delta: float) -> void:
	for div_id: String in _icons:
		var icon: Node2D = _icons[div_id]
		# Point 4: terminal hop is now a final entry in _dr_order (not a separate _dr_final_goal
		# field), so the only check needed is "is there anything left to consume." If empty, the
		# else-branch below lerps the icon toward _target_positions[div_id], which mirrors the
		# server's authoritative position on foreign units and the client's last DR step on self.
		if _dr_order.has(div_id) and not _dr_order[div_id].is_empty():
			_advance_dr(div_id, delta)
			if _dr_icon_reconcile_t.has(div_id):
				const RECONCILE_DURATION_S := 0.15
				var t: float = _dr_icon_reconcile_t[div_id]
				if t < 1.0 and _icons.has(div_id):
					_icons[div_id].position = _dr_icon_reconcile_from[div_id].lerp(
						_icons[div_id].position, t
					)
					_dr_icon_reconcile_t[div_id] = minf(t + delta / RECONCILE_DURATION_S, 1.0)
				else:
					_dr_icon_reconcile_t.erase(div_id)
					_dr_icon_reconcile_from.erase(div_id)
			_update_division_route(div_id)
		else:
			var target: Vector2 = _target_positions.get(div_id, icon.position)
			if icon.position.distance_to(target) > 0.5:
				icon.position = icon.position.lerp(target, clampf(LERP_SPEED * delta, 0.0, 1.0))
		if _is_own_unit(div_id) and _vision_system != null \
				and _vision_system.has_method("update_division_mask_position"):
			_vision_system.update_division_mask_position(div_id, icon.position)
		_update_division_visibility(div_id)
	_emit_ui_anchor_positions()

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

	if event.is_action_pressed("unit_hold", false, true):
		_hold_selected_divisions()
		return
	if event.is_action_pressed("unit_cancel", false, true):
		_hold_selected_divisions()
		return
	if event.is_action_pressed("unit_retreat", false, true):
		_retreat_selected_divisions()
		return

	match key.physical_keycode:
		KEY_SHIFT:
			# Shift pressed during the non-shift transition window promotes the route to a chain.
			if _pending_auto_submit and _move_mode and not _pending_milestones.is_empty():
				_pending_auto_submit = false
				_shift_chain_started = true
		KEY_SPACE:
			var own_selected_for_move: Array[String] = _get_own_selected_division_ids()
			if not own_selected_for_move.is_empty():
				_move_mode = true
				_pending_milestones.clear()
				_pending_chain.clear()
				_update_ghost()
				_set_selected_icons_move_mode(true)
				EventBus.move_mode_active_changed.emit(true)
		KEY_B:
			if _selected_division_id != "":
				EventBus.reposition_mode_requested.emit(_selected_division_id)
		KEY_ESCAPE:
			if _reposition_mode:
				_clear_pending()
			else:
				_clear_pending()
				deselect()


## Handles mouse press, drag, and release for unit click/box selection and move clicks.
## Parameters:
## - event: mouse button or mouse motion event from the map scene.
## - world_pos: event position transformed into map world coordinates.
## Returns: true when the military system consumed the mouse event.
func handle_mouse_input(event: InputEvent, world_pos: Vector2) -> bool:
	if event is InputEventMouseButton:
		var mouse_button: InputEventMouseButton = event
		if mouse_button.button_index == MOUSE_BUTTON_RIGHT:
			if not mouse_button.pressed:
				return false
			if try_right_click_at_world(world_pos):
				return true
			return _handle_right_click_move(world_pos, mouse_button.shift_pressed)

		if mouse_button.button_index != MOUSE_BUTTON_LEFT:
			return false

		if mouse_button.pressed:
			if (_move_mode or _reposition_mode) and not _selected_division_ids.is_empty():
				return try_click_at_world(world_pos, mouse_button.shift_pressed, mouse_button.ctrl_pressed)
			_drag_select_pressed = true
			_drag_select_active = false
			_drag_select_start_screen = mouse_button.position
			_drag_select_current_screen = mouse_button.position
			_drag_select_additive = mouse_button.shift_pressed
			_drag_select_subtractive = mouse_button.ctrl_pressed
			_drag_select_can_activate = find_division_at_world(world_pos).is_empty()
			_clear_selection_preview()
			_update_selection_box_overlay()
			return false

		if not _drag_select_pressed:
			return false

		_drag_select_current_screen = mouse_button.position
		if _drag_select_active:
			_commit_drag_selection()
			_reset_drag_selection()
			return true

		_reset_drag_selection()
		return try_click_at_world(world_pos, mouse_button.shift_pressed, mouse_button.ctrl_pressed)

	if event is InputEventMouseMotion:
		var mouse_motion: InputEventMouseMotion = event
		if not _drag_select_pressed:
			_update_hovered_division(world_pos)
			return false
		_set_hovered_division("")
		_drag_select_current_screen = mouse_motion.position
		if _drag_select_can_activate and not _drag_select_active \
				and _drag_select_start_screen.distance_to(_drag_select_current_screen) >= DRAG_SELECT_THRESHOLD_PX:
			_drag_select_active = true
		if _drag_select_active:
			_update_drag_selection_preview()
			_update_selection_box_overlay()
			return true

	return false


## Cancels hover and an in-progress pointer selection when UI takes pointer ownership.
## Parameters: none.
## Returns: nothing.
func cancel_pointer_interaction() -> void:
	_set_hovered_division("")
	if _drag_select_pressed or _drag_select_active:
		_reset_drag_selection()


## Left-click at a world-space position. Returns true if consumed (caller should mark event handled).
func try_click_at_world(world_pos: Vector2, shift_held: bool = false, ctrl_held: bool = false) -> bool:
	if _reposition_mode and _reposition_div_id != "":
		_reposition_mode = false
		var ll: Vector2 = _map_loader.world_to_lng_lat(world_pos)
		_submit_reposition_order(_reposition_div_id, ll.x, ll.y)
		return true

	if _move_mode and not _selected_division_ids.is_empty():
		var ll: Vector2 = _map_loader.world_to_lng_lat(world_pos)
		var snapped: Vector2 = _snap_click_to_nearest_city(ll.x, ll.y)
		ll = snapped
		if _selected_division_ids.size() == 1:
			_handle_move_click(ll.x, ll.y, shift_held)
		else:
			_handle_group_move_click(ll.x, ll.y)
		return true

	const BANNER_CLICK_R := 20.0
	for eng_key: String in _banners:
		var banner: Node2D = _banners[eng_key]
		if not is_instance_valid(banner):
			continue
		if banner.position.distance_to(world_pos) <= BANNER_CLICK_R:
			banner.on_clicked()
			return true

	var clicked_id := find_division_at_world(world_pos)
	if clicked_id != "":
		if ctrl_held:
			_remove_from_selection(clicked_id)
		elif shift_held:
			_add_to_selection(clicked_id)
		elif _selected_division_ids.has(clicked_id):
			_set_active_division(clicked_id)
		else:
			_select(clicked_id)
		return true

	# Click on empty map while something selected → deselect (skip if in move mode)
	if not _selected_division_ids.is_empty() and not _move_mode:
		deselect()
	return false

## Called by EventBus.reposition_mode_requested when the Reposition button is
## clicked in the bottom bar or B is pressed. Enables reposition mode.
func _enter_reposition_mode(div_id: String) -> void:
	if div_id == "" or not _is_own_unit(div_id):
		return
	_reposition_mode = true
	_reposition_div_id = div_id
	_move_mode = false
	_pending_milestones.clear()
	_pending_chain.clear()
	_update_ghost()
	_set_icon_move_mode(div_id, true)
	EventBus.move_mode_active_changed.emit(true)

## Called by EventBus.move_mode_requested when the Move button is clicked in a
## bottom bar selection panel. Enables move mode for the specified division.
func enter_move_mode(division_id: String) -> void:
	if division_id == "" or not _is_own_unit(division_id):
		return
	_move_mode = true
	_pending_milestones.clear()
	_pending_chain.clear()
	_update_ghost()
	_set_icon_move_mode(division_id, true)
	EventBus.move_mode_active_changed.emit(true)

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

## Handles RTS-style right-click movement for currently selected own divisions.
## Parameters:
## - world_pos: clicked destination in map world coordinates.
## - shift_held: whether the click should append to the single-unit waypoint chain.
## Returns: true when the right click was consumed by movement.
func _handle_right_click_move(world_pos: Vector2, shift_held: bool) -> bool:
	var moving_division_ids: Array[String] = _get_own_selected_division_ids()
	if moving_division_ids.is_empty():
		return false
	if _path_pending:
		return true

	var lng_lat: Vector2 = _map_loader.world_to_lng_lat(world_pos)
	var snapped: Vector2 = _snap_click_to_nearest_city(lng_lat.x, lng_lat.y)
	lng_lat = snapped
	if moving_division_ids.size() > 1:
		_handle_group_move_click(lng_lat.x, lng_lat.y)
		return true

	_selected_division_id = moving_division_ids[0]
	if shift_held:
		_move_mode = true
		_set_icon_move_mode(_selected_division_id, true)
		EventBus.move_mode_active_changed.emit(true)
		_handle_move_click(lng_lat.x, lng_lat.y, true)
	else:
		_submit_direct_move_order(_selected_division_id, lng_lat.x, lng_lat.y)
	return true


## Computes and submits an immediate single-division move order.
## Parameters:
## - division_id: selected own division to move.
## - target_lng: destination longitude.
## - target_lat: destination latitude.
## Returns: nothing.
func _submit_direct_move_order(division_id: String, target_lng: float, target_lat: float) -> void:
	if not _pathfinder.is_built():
		push_warning("[MilitarySystem] Pathfinder not built — cannot route")
		_clear_pending()
		return
	if not _is_own_unit(division_id):
		return

	_clear_pending()
	var current_lng_lat: Vector2 = _get_division_lng_lat(division_id)
	var start_id: String = _pathfinder.find_nearest(current_lng_lat.x, current_lng_lat.y)
	var goal_id: String = _pathfinder.find_nearest(target_lng, target_lat)
	var movement_profile: Dictionary = _get_movement_profile(division_id)
	var division_id_snapshot := division_id
	var goal_lng_snapshot := target_lng
	var goal_lat_snapshot := target_lat
	var my_nation: String = GameState.get_my_nation_id()
	var relations_snapshot: Dictionary = GameState.relations.duplicate()
	var combat_zones_snapshot: Array[Dictionary] = _build_combat_zones(GameState.active_engagement_pairs, GameState.divisions)
	_path_gen += 1
	var gen := _path_gen
	_path_pending = true
	_pathfinder._insert_synthetic_goal(goal_lng_snapshot, goal_lat_snapshot, my_nation, relations_snapshot)
	_path_thread = Thread.new()
	_path_thread.start(func() -> void:
		var path_result: Dictionary = _pathfinder.find_path(
			start_id, "_synthetic_goal", movement_profile, 1.0,
			my_nation, relations_snapshot,
			INF, INF, true, combat_zones_snapshot)
		var path: Array = path_result.get("logical", [])
		if path.is_empty():
			var fallback_id: String = _pathfinder.find_nearest_reachable(
				start_id, goal_lng_snapshot, goal_lat_snapshot, movement_profile,
				my_nation, relations_snapshot, combat_zones_snapshot)
			if not fallback_id.is_empty():
				path_result = _pathfinder.find_path(start_id, fallback_id, movement_profile, 1.0,
					my_nation, relations_snapshot,
					INF, INF, true, combat_zones_snapshot)
				path = path_result.get("logical", [])
		call_deferred("_on_direct_move_ready", path, division_id_snapshot, goal_lng_snapshot, goal_lat_snapshot, gen)
	)


func _on_direct_move_ready(path: Array, division_id: String, target_lng: float, target_lat: float, gen: int = 0) -> void:
	if gen != _path_gen:
		return
	_pathfinder._remove_synthetic_goal()
	if _path_thread != null and _path_thread.is_started():
		_path_thread.wait_to_finish()
	_path_thread = null
	_path_pending = false
	if path.is_empty():
		push_warning("[MilitarySystem] No path found for %s" % division_id)
		_clear_pending()
		return
	var goal_id: String = _pathfinder.find_nearest(target_lng, target_lat)
	var path_to_submit: Array[String] = []
	for waypoint_id: Variant in path:
		var wpid: String = str(waypoint_id)
		if wpid == "_synthetic_goal":
			wpid = goal_id
		path_to_submit.append(wpid)

	# Clamp the exact click target against the same neutral-territory/terrain rules the waypoint
	# chain above just went through, plus a distance cap scaled to local waypoint density — mirrors
	# movement_system.ts's resolveFinalPosition (server-authoritative). Without this, the client's
	# dead-reckoning "last mile" would predict an unbounded, unchecked straight line toward the raw
	# click coordinate, visibly overshooting before the server's own clamp corrects it.
	var resolved_final: Vector2 = _pathfinder.resolve_final_position(
		path_to_submit[-1], target_lng, target_lat,
		_get_movement_profile(division_id), GameState.get_my_nation_id(), GameState.relations)
	var final_pos: Vector2 = resolved_final if is_finite(resolved_final.x) else Vector2.INF

	_submit_move_order_for_division(division_id, path_to_submit, final_pos)
	_spawn_move_destination_effect(
			_map_loader.project_lng_lat(target_lng, target_lat),
			division_id)


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

	var my_nation: String = GameState.get_my_nation_id()
	var relations_snapshot: Dictionary = GameState.relations.duplicate()
	var combat_zones_snapshot: Array[Dictionary] = _build_combat_zones(GameState.active_engagement_pairs, GameState.divisions)
	_path_gen += 1
	var gen := _path_gen
	_path_pending = true
	_path_thread = Thread.new()
	var division_id_snapshot := _selected_division_id
	_path_thread.start(func() -> void:
		var effective_mult := 1.0
		if shift_held and waypoint_index > 0 and road_mult > 1.0:
			if not _pathfinder.road_crosses_segment(start_id, goal_id):
				effective_mult = road_mult
		var seg_result: Dictionary = _pathfinder.find_path(start_id, goal_id, movement_profile, effective_mult, my_nation, relations_snapshot, INF, INF, false, combat_zones_snapshot)
		call_deferred("_on_segment_ready", seg_result.get("logical", []), goal_id, shift_held, division_id_snapshot, gen)
	)


## Computes and submits one formation-preserving route per selected unit.
## Parameters:
## - target_lng: clicked destination longitude used as the group center.
## - target_lat: clicked destination latitude used as the group center.
## Returns: Nothing.
func _handle_group_move_click(target_lng: float, target_lat: float) -> void:
	if not _pathfinder.is_built():
		push_warning("[MilitarySystem] Pathfinder not built — cannot route group")
		_move_mode = false
		return

	var moving_division_ids: Array[String] = _get_own_selected_division_ids()
	if moving_division_ids.is_empty():
		_clear_pending()
		return

	var submitted_any_order: bool = false
	var combat_zones_snapshot: Array[Dictionary] = _build_combat_zones(GameState.active_engagement_pairs, GameState.divisions)
	for index: int in moving_division_ids.size():
		var division_id: String = moving_division_ids[index]
		var current_lng_lat: Vector2 = _get_division_lng_lat(division_id)
		var destination_lng_lat: Vector2 = Vector2(target_lng, target_lat) \
				+ _get_group_destination_offset(index, moving_division_ids.size())
		var start_id: String = _pathfinder.find_nearest(current_lng_lat.x, current_lng_lat.y)
		var goal_id: String = _pathfinder.find_nearest(destination_lng_lat.x, destination_lng_lat.y)
		var movement_profile: Dictionary = _get_movement_profile(division_id)
		var path_result: Dictionary = _pathfinder.find_path(start_id, goal_id, movement_profile, 1.0, GameState.get_my_nation_id(), GameState.relations, INF, INF, false, combat_zones_snapshot)
		var path: Array = path_result.get("logical", [])
		if path.is_empty():
			goal_id = _pathfinder.find_nearest(target_lng, target_lat)
			path_result = _pathfinder.find_path(start_id, goal_id, movement_profile, 1.0, GameState.get_my_nation_id(), GameState.relations, INF, INF, false, combat_zones_snapshot)
			path = path_result.get("logical", [])
			if path.is_empty():
				push_warning("[MilitarySystem] No group path found for %s" % division_id)
				continue

		var path_to_submit: Array[String] = []
		for waypoint_id: Variant in path:
			path_to_submit.append(str(waypoint_id))
		_submit_move_order_for_division(division_id, path_to_submit)
		submitted_any_order = true

	if submitted_any_order:
		_spawn_move_destination_effect(
				_map_loader.project_lng_lat(target_lng, target_lat),
				moving_division_ids[0])

	_clear_pending()


func _on_segment_ready(segment: Array, goal_id: String, shift_held: bool, division_id_snapshot: String, gen: int = 0) -> void:
	if gen != _path_gen:
		return
	if _path_thread != null and _path_thread.is_started():
		_path_thread.wait_to_finish()
	_path_thread = null
	_path_pending = false

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
	var destination_node: Dictionary = _pathfinder.get_node(goal_id)
	if not destination_node.is_empty():
		_spawn_move_destination_effect(
				_map_loader.project_lng_lat(
						float(destination_node.get("lng", 0.0)),
						float(destination_node.get("lat", 0.0))),
				division_id_snapshot)
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
		get_tree().create_timer(0.2).timeout.connect(func() -> void:
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


## Returns a compact destination slot around the clicked group-move target.
## Parameters:
## - index: selected unit index.
## - count: selected unit count.
## Returns: longitude/latitude offset in degrees.
func _get_group_destination_offset(index: int, count: int) -> Vector2:
	if count <= 1:
		return Vector2.ZERO

	var columns: int = int(ceil(sqrt(float(count))))
	var rows: int = int(ceil(float(count) / float(columns)))
	var column: int = index % columns
	var row: int = index / columns
	var centered_column: float = float(column) - (float(columns - 1) * 0.5)
	var centered_row: float = float(row) - (float(rows - 1) * 0.5)
	return Vector2(centered_column, centered_row) * GROUP_MOVE_SLOT_SPACING_DEG


## Groups active engagement pairs into combat clusters (any two pairs sharing a
## division_id merge into one cluster — handles e.g. two attackers vs one defender as
## a single zone) and resolves each participant's current position.
## Rebuilt fresh on every pathfinding call rather than cached — cheap (bounded by the
## number of active engagements, not graph size) and avoids drift from GameState.
## active_engagement_pairs: engagement_id -> {division_a: String, division_b: String}
## divisions: division_id -> DivisionState dict (must have position_lng/position_lat)
## Returns: [{division_ids: Array[String], positions: Array[Vector2]}, ...]
func _build_combat_zones(active_engagement_pairs: Dictionary, divisions: Dictionary) -> Array[Dictionary]:
	var parent: Dictionary = {}  # division_id -> division_id (union-find parent pointer)

	for eng_id: String in active_engagement_pairs:
		var pair: Dictionary = active_engagement_pairs[eng_id]
		var a: String = str(pair.get("division_a", ""))
		var b: String = str(pair.get("division_b", ""))
		if a.is_empty() or b.is_empty():
			continue
		var data_a: Dictionary = divisions.get(a, {})
		var data_b: Dictionary = divisions.get(b, {})
		if data_a.is_empty() or data_b.is_empty():
			continue
		var state_a: String = str(data_a.get("combat_state", ""))
		var state_b: String = str(data_b.get("combat_state", ""))
		if not (state_a == "engaged" or state_a == "suppressed"):
			continue
		if not (state_b == "engaged" or state_b == "suppressed"):
			continue
		if not parent.has(a):
			parent[a] = a
		if not parent.has(b):
			parent[b] = b
		var root_a: String = _uf_find(parent, a)
		var root_b: String = _uf_find(parent, b)
		if root_a != root_b:
			parent[root_a] = root_b

	var clusters: Dictionary = {}  # root -> Array[String]
	for div_id: String in parent:
		var root: String = _uf_find(parent, div_id)
		if not clusters.has(root):
			clusters[root] = []
		clusters[root].append(div_id)

	var zones: Array[Dictionary] = []
	for root: String in clusters:
		var division_ids: Array = clusters[root]
		var positions: Array[Vector2] = []
		for div_id: String in division_ids:
			var data: Dictionary = divisions.get(div_id, {})
			if data.is_empty():
				continue
			positions.append(Vector2(float(data.get("position_lng", 0.0)), float(data.get("position_lat", 0.0))))
		if not positions.is_empty():
			zones.append({"division_ids": division_ids, "positions": positions})
	return zones


## Iterative union-find "find" with path compression.
func _uf_find(parent: Dictionary, x: String) -> String:
	var root: String = x
	while parent[root] != root:
		root = parent[root]
	var cur: String = x
	while parent[cur] != root:
		var next_id: String = parent[cur]
		parent[cur] = root
		cur = next_id
	return root


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

	var my_nation: String = GameState.get_my_nation_id()
	var relations_snapshot: Dictionary = GameState.relations.duplicate()
	var combat_zones_snapshot: Array[Dictionary] = _build_combat_zones(GameState.active_engagement_pairs, GameState.divisions)
	_path_pending = true
	_path_thread = Thread.new()
	_path_thread.start(func() -> void:
		var seg_result: Dictionary = _pathfinder.find_path(start_id, goal_id, movement_profile, 1.0, my_nation, relations_snapshot, INF, INF, false, combat_zones_snapshot)
		call_deferred("_on_chain_refresh_ready", seg_result.get("logical", []), milestones_snapshot, div_id_snapshot)
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
	var order: Array = _dr_order[div_id]
	if order.is_empty():
		return
	if not _dr_pos_deg.has(div_id):
		_dr_order.erase(div_id)
		return
	var pos_deg: Vector2 = _dr_pos_deg[div_id]

	var entry: Dictionary = order[0]
	var target_lng: float = float(entry["lng"])
	var target_lat: float = float(entry["lat"])
	var entry_id: String = str(entry["id"])
	var entry_kmh: float = float(entry["kmh"])

	# Speed is precomputed per entry at build time (_waypoint_kmh for real waypoints; inherited
	# from the segment's source real waypoint for jitter sub-points and the terminal hop). The
	# per-frame loop never touches terrain/profile data, which is what kept the original code
	# having to look up _dr_last_waypoint_* caches for the last-mile phase.
	var kmh: float = entry_kmh * _dr_speed_mult.get(div_id, 1.0)
	var speed_degs: float = (kmh / DR_KM_PER_DEG) * float(GameState.game_speed)
	var advance: float = speed_degs * delta

	var to_target: Vector2 = Vector2(target_lng, target_lat) - pos_deg
	var dist: float = to_target.length()

	if dist < DR_SNAP_DEG or advance >= dist:
		# Cache the last real-waypoint kmh — used when re-appending a terminal entry mid-flight
		# (server's final_position changes after the chain's last real entry has already been
		# popped, leaving no entry to inherit from). No-op for sub-point entries.
		if not entry_id.is_empty():
			_dr_last_real_kmh[div_id] = entry_kmh
		_dr_pos_deg[div_id] = Vector2(target_lng, target_lat)
		order.pop_front()
		_dr_order[div_id] = order
		if order.is_empty():
			_target_positions[div_id] = _map_loader.project_lng_lat(
					_dr_pos_deg[div_id].x, _dr_pos_deg[div_id].y)
			_update_division_route(div_id)
			var done_icon := _icons[div_id] as Node2D
			done_icon.position = _target_positions[div_id]
			done_icon.set_moving(false)
			_update_division_visibility(div_id)
			return
		if dist > 0.0:
			var leftover: float = delta * maxf(1.0 - dist / maxf(advance, 1e-9), 0.0)
			if leftover > 0.001:
				_advance_dr(div_id, leftover)
				return
	else:
		_dr_pos_deg[div_id] = pos_deg + to_target.normalized() * advance

	var moving_icon := _icons[div_id] as Node2D
	moving_icon.position = _map_loader.project_lng_lat(
			_dr_pos_deg[div_id].x, _dr_pos_deg[div_id].y)
	moving_icon.queue_redraw()
	_update_division_visibility(div_id)


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
	var combat_zones_snapshot: Array[Dictionary] = _build_combat_zones(GameState.active_engagement_pairs, GameState.divisions)
	for milestone_id: String in _pending_milestones:
		var seg_result: Dictionary = _pathfinder.find_path(current_start, milestone_id, movement_profile, 1.0, GameState.get_my_nation_id(), GameState.relations, INF, INF, false, combat_zones_snapshot)
		var seg: Array = seg_result.get("logical", [])
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

	_submit_move_order_for_division(div_id, chain_snapshot)

	_clear_pending()


## Submits a move order and seeds client-local dead reckoning for immediate feedback.
## Parameters:
## - div_id: division receiving the order.
## - waypoint_ids: ordered waypoint ids for the server command and local route.
## Returns: Nothing.
func _submit_move_order_for_division(div_id: String, waypoint_ids: Array, final_pos: Vector2 = Vector2.INF) -> void:
	# Point 4: terminal hop is now appended to _dr_order as a final entry (id="" so the
	# existing consume-by-distance loop handles it like any other sub-point). The wire message
	# still includes final_lng/final_lat so the server's resolveFinalPosition stays authoritative.
	if waypoint_ids.is_empty():
		return
	if not _is_own_unit(div_id):
		return

	var chain_snapshot: Array = waypoint_ids.duplicate()

	var msg: Dictionary = {
		"division_id": div_id,
		"waypoints": chain_snapshot,
	}
	if final_pos != Vector2.INF:
		msg["final_lng"] = final_pos.x
		msg["final_lat"] = final_pos.y
	CommandQueue.submit("SUBMIT_MOVE_ORDER", msg)

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

	# Build DR entries with off-road jitter (Point 2) + terminal hop (Point 4). The chain
	# submitted to the server is the raw waypoint-id list — jitter / terminal are pure
	# client-side rendering concerns that don't change which nodes the server ticks through.
	var movement_profile: Dictionary = _dr_profiles.get(div_id, {})
	var entries: Array = _compute_visual_chain(chain_snapshot, div_id, movement_profile)
	if final_pos != Vector2.INF and not entries.is_empty():
		# Carry the speed over from the last real waypoint consumed. For a freshly-submitted
		# order, that's the chain's last real entry — its kmh is right there in `entries`.
		var terminal_kmh: float = float(entries[entries.size() - 1]["kmh"])
		entries.append({ "id": "", "lng": final_pos.x, "lat": final_pos.y, "kmh": terminal_kmh })
	_dr_order[div_id] = entries

	if div_id == _selected_division_id:
		_emit_active_hold_eligibility()

	var icon_node := _icons.get(div_id) as Node2D
	if icon_node:
		icon_node.set_moving(true)

	_update_division_route(div_id)


## Spawns immediate client-only confirmation at a successfully routed move destination.
func _spawn_move_destination_effect(world_position: Vector2, division_id: String) -> void:
	if _icon_layer == null:
		return
	var division_data: Dictionary = GameState.get_division(division_id)
	var nation_id: String = division_data.get("nation_id", "")
	var nation_color: Color = NATION_COLORS.get(nation_id, NEUTRAL_COLOR)
	var effect: MoveDestinationEffect = MoveDestinationEffectScript.new()
	effect.setup(world_position, nation_color)
	effect.z_index = 20
	_icon_layer.add_child(effect)


func _submit_reposition_order(div_id: String, target_lng: float, target_lat: float) -> void:
	if not _pathfinder.is_built():
		push_warning("[MilitarySystem] Pathfinder not built — cannot route reposition")
		return
	if not _is_own_unit(div_id):
		return

	var div_data: Dictionary = GameState.get_division(div_id)
	var own_radius: float = float(div_data.get("engagement_radius", 25.0))
	var engaged_with: Array = div_data.get("engaged_with", [])

	# Use SERVER position for distance calculations (not DR position, which may be stale).
	# DR position is still used for pathfinding below.
	var server_lng: float = float(div_data.get("position_lng", 0.0))
	var server_lat: float = float(div_data.get("position_lat", 0.0))

	# Compute max repos distance from engagement boundary with all engaged enemies.
	# The repos must stay within (own_radius + enemy_radius) of each enemy.
	var max_repos_km: float = INF
	for enemy_id: Variant in engaged_with:
		var enemy_data: Dictionary = GameState.get_division(str(enemy_id))
		if enemy_data.is_empty():
			continue
		var enemy_lng: float = float(enemy_data.get("position_lng", 0.0))
		var enemy_lat: float = float(enemy_data.get("position_lat", 0.0))
		var enemy_radius: float = float(enemy_data.get("engagement_radius", 25.0))
		var combined_radius: float = own_radius + enemy_radius
		var dx: float = enemy_lng - server_lng
		var dy: float = enemy_lat - server_lat
		var current_dist_km: float = sqrt(dx * dx + dy * dy) * DR_KM_PER_DEG
		var remaining_km: float = combined_radius - current_dist_km
		if remaining_km < max_repos_km:
			max_repos_km = remaining_km

	if max_repos_km == INF or max_repos_km <= 0.0:
		_clear_pending()
		return

	# Compute path, then truncate at engagement boundary.
	# Use DR position for pathfinding accuracy (it tracks live movement).
	var current_lng_lat: Vector2 = _get_division_lng_lat(div_id)
	var start_id: String = _pathfinder.find_nearest(current_lng_lat.x, current_lng_lat.y)
	var goal_id: String = _pathfinder.find_nearest(target_lng, target_lat)
	var movement_profile: Dictionary = _get_movement_profile(div_id)
	var path_result: Dictionary = _pathfinder.find_path(start_id, goal_id, movement_profile, 1.0, GameState.get_my_nation_id(), GameState.relations)
	var path: Array = path_result.get("logical", [])
	if path.is_empty():
		var fallback_id: String = _pathfinder.find_nearest_reachable(
			start_id, target_lng, target_lat, movement_profile,
			GameState.get_my_nation_id(), GameState.relations)
		if fallback_id.is_empty():
			push_warning("[MilitarySystem] No reposition path found for %s — target unreachable" % div_id)
			_clear_pending()
			return
		path_result = _pathfinder.find_path(start_id, fallback_id, movement_profile, 1.0,
			GameState.get_my_nation_id(), GameState.relations)
		path = path_result.get("logical", [])
		if path.is_empty():
			push_warning("[MilitarySystem] No reposition fallback path for %s" % div_id)
			_clear_pending()
			return
	# Start distance accumulation from SERVER position (authoritative), not DR position.
	var path_to_submit: Array[String] = []
	var accum_km: float = 0.0
	var prev_lng: float = server_lng
	var prev_lat: float = server_lat
	for waypoint_id: Variant in path:
		var wp_id: String = str(waypoint_id)
		var node: Dictionary = _pathfinder.get_node(wp_id)
		if node.is_empty():
			continue
		var node_lng: float = float(node["lng"])
		var node_lat: float = float(node["lat"])
		var seg_dx: float = node_lng - prev_lng
		var seg_dy: float = node_lat - prev_lat
		accum_km += sqrt(seg_dx * seg_dx + seg_dy * seg_dy) * DR_KM_PER_DEG
		if accum_km > max_repos_km:
			break
		path_to_submit.append(wp_id)
		prev_lng = node_lng
		prev_lat = node_lat

	if path_to_submit.is_empty():
		push_warning("[MilitarySystem] Reposition path all beyond engagement boundary")
		_clear_pending()
		return

	CommandQueue.submit("REPOSITION", {
		"division_id": div_id,
		"waypoints": path_to_submit,
	})

	_clear_pending()


func _clear_pending() -> void:
	if _path_thread != null and _path_thread.is_started():
		_path_thread.wait_to_finish()
	_path_thread = null
	_set_selected_icons_move_mode(false)
	_pending_milestones.clear()
	_pending_chain.clear()
	_move_mode = false
	_reposition_mode = false
	_reposition_div_id = ""
	_path_pending = false
	_pending_auto_submit = false
	_submit_on_thread_complete = false
	_shift_chain_started = false
	_pending_chain_origin_deg = Vector2.ZERO
	_chain_last_refresh_time = 0.0
	_update_ghost()
	EventBus.move_mode_active_changed.emit(false)


func _set_icon_move_mode(division_id: String, active: bool) -> void:
	var icon = _icons.get(division_id)
	if icon != null:
		(icon as Node2D).set_move_mode(active)


func _set_selected_icons_move_mode(active: bool) -> void:
	for division_id: String in _selected_division_ids:
		_set_icon_move_mode(division_id, active)


func _get_own_selected_division_ids() -> Array[String]:
	var result: Array[String] = []
	for division_id: String in _selected_division_ids:
		if _is_own_unit(division_id):
			result.append(division_id)
	return result


func _get_movement_profile(division_id: String) -> Dictionary:
	var div_data: Dictionary = GameState.get_division(division_id)
	var movement_profile: Dictionary = {}
	var profile_json: String = div_data.get("movement_profile_json", "")
	if not profile_json.is_empty():
		var parsed: Variant = JSON.parse_string(profile_json)
		if parsed is Dictionary:
			movement_profile = parsed
	return movement_profile


func _get_division_lng_lat(division_id: String) -> Vector2:
	if _dr_pos_deg.has(division_id):
		return _dr_pos_deg[division_id]

	var div_data: Dictionary = GameState.get_division(division_id)
	return Vector2(
			float(div_data.get("position_lng", 0.0)),
			float(div_data.get("position_lat", 0.0)))


## Builds _city_index once from the loaded map's province data. Runs O(province_count) at setup
## so click-time snap can stay a simple linear scan (clicks are infrequent — a spatial index here
## would be premature). Cities are absent from the waypoint graph itself (see
## LAND_MOVEMENT_IMPROVEMENTS.md Point 3), so this client-side index is the only lookup path.
## Parameters: none.
## Returns: nothing.
func _build_city_index() -> void:
	_city_index.clear()
	if _map_loader == null:
		return
	for province_id: String in _map_loader.get_all_province_ids():
		var province_data: Dictionary = _map_loader.get_province_data(province_id)
		var city_position: Array = province_data.get("city_position", [])
		if city_position.size() < 2:
			continue
		_city_index.append({
			"lng": float(city_position[0]),
			"lat": float(city_position[1]),
			"province_id": province_id,
		})


## Snaps a raw click coordinate to the nearest city_position when within CITY_SNAP_RADIUS_DEG;
## returns the input unchanged otherwise. Multiple cities within the radius resolve to the
## closest one (raw Euclidean in lng/lat — within the ~500 m snap radius, the cos(lat)
## distortion is negligible at Western European latitudes). City position data comes from
## provinces.geojson via the map pipeline (`pipeline.py:_build_provinces`); see
## LAND_MOVEMENT_IMPROVEMENTS.md Point 3 for the design rationale.
func _snap_click_to_nearest_city(lng: float, lat: float) -> Vector2:
	var best_dist_sq := CITY_SNAP_RADIUS_SQ
	var best: Vector2 = Vector2(lng, lat)
	for city: Dictionary in _city_index:
		var ddx: float = float(city["lng"]) - lng
		var ddy: float = float(city["lat"]) - lat
		var d2: float = ddx * ddx + ddy * ddy
		if d2 < best_dist_sq:
			best_dist_sq = d2
			best = Vector2(float(city["lng"]), float(city["lat"]))
	return best


## Returns the DR-consumable entry list for a raw waypoint-id path: real waypoints + off-road
## jitter sub-points (Point 2). Each entry is a Dictionary {id, lng, lat, kmh}; sub-points have
## id="" so consumers can distinguish real waypoints (for suffix-match against server broadcasts)
## from synthetic sub-points (consumed purely on the client's own distance check).
##
## Used by:
##  - `_submit_move_order_for_division` to seed `_dr_order` for self-moves
##  - `_on_division_updated` (foreign-unit branch) to expand server `move_order` for DR playback
##  - `_get_chain_positions` for the ghost overlay preview
##  - `_update_division_route` for the HUD line (foreign + self both go through the same helper)
##
## Deterministic per (division_id, waypoint set): same input always yields the same jittered
## polyline, so this client's icon, this client's HUD, and other players' HUD (all derived from
## the same call) draw the same wobble.
func _compute_visual_chain(raw_waypoint_ids: Array, division_id: String, movement_profile: Dictionary) -> Array:
	if _pathfinder == null or not _pathfinder.is_built():
		return []
	if raw_waypoint_ids.is_empty():
		return []
	return _pathfinder._inject_offroad_jitter(raw_waypoint_ids, movement_profile, division_id)


## Projects a list of {_dr_order} entries (lng/lat Dictionaries) into world-space Vector2 list
## suitable for HUD/overlay rendering. Single-purpose helper so `_update_division_route` and
## `_get_chain_positions` don't duplicate the projection loop. Entries may be real waypoints or
## jitter sub-points — projection is identical for both (lng/lat field set the same way).
func _project_entries_to_world(entries: Array) -> Array[Vector2]:
	var out: Array[Vector2] = []
	for entry: Dictionary in entries:
		out.append(_map_loader.project_lng_lat(float(entry["lng"]), float(entry["lat"])))
	return out


func _get_group_center_lng_lat(division_ids: Array[String]) -> Vector2:
	if division_ids.is_empty():
		return Vector2.ZERO

	var sum: Vector2 = Vector2.ZERO
	for division_id: String in division_ids:
		sum += _get_division_lng_lat(division_id)
	return sum / float(division_ids.size())


func _get_ghost_positions() -> Array[Vector2]:
	var positions: Array[Vector2] = []
	for wp_id: String in _pending_milestones:
		var node: Dictionary = _pathfinder.get_node(wp_id)
		if not node.is_empty():
			positions.append(_map_loader.project_lng_lat(float(node["lng"]), float(node["lat"])))
	return positions


func _get_chain_positions() -> Array[Vector2]:
	# Point 2: ghost preview uses the same jittered visual chain the actual DR will animate
	# through, so what the player sees mid-chain-build matches what they'll see during execution.
	# The division_id seed is the selected one — at ghost-build time there's no submitted order
	# yet, so determinism just means the ghost wobble is stable across ghost-refresh cycles.
	var div_id := _selected_division_id
	var movement_profile: Dictionary = _get_movement_profile(div_id)
	var entries: Array = _compute_visual_chain(_pending_chain, div_id, movement_profile)
	return _project_entries_to_world(entries)


func _update_ghost() -> void:
	if _ghost_overlay == null:
		return
	if _pending_milestones.is_empty():
		_ghost_overlay.start_node = null
		_ghost_overlay.clear()
		return

	var color := Color.WHITE
	if _reposition_mode and _reposition_div_id != "":
		color = Color.CYAN
	elif _selected_division_id != "":
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
	var is_repos: bool = _dr_speed_mult.has(division_id)
	var color: Color = Color.CYAN if is_repos else NATION_COLORS.get(div_data.get("nation_id", ""), NEUTRAL_COLOR)
	var no_milestones: Array[Vector2] = []
	var icon: Node2D = _icons.get(division_id) as Node2D

	# DR active (owning client) — 60fps update via client-side remaining order. Point 2:
	# entries may include jitter sub-points (id=""); Point 4: the last entry may be the
	# terminal hop. Both are projected by _project_entries_to_world without any special-casing.
	var dr_order: Array = _dr_order.get(division_id, [])
	if not dr_order.is_empty() and icon != null:
		var positions: Array[Vector2] = _project_entries_to_world(dr_order)
		route.start_node = icon
		if is_repos:
			route.set_path(positions, no_milestones, color)
		else:
			route.set_path(positions, no_milestones, color.darkened(0.25))
		return

	# No local DR — foreign unit's authoritative move_order arrives as string ids only, so
	# re-expand via _compute_visual_chain to keep this client's HUD line in lockstep with the
	# icon's animated path (and with every other player's view of the same unit). Same helper
	# the self-submit path uses, so the wobble is identical for self and foreign.
	route.start_node = null
	var order: Array = div_data.get("move_order", [])
	if order.is_empty():
		route.clear()
		return
	var movement_profile: Dictionary = _get_movement_profile(division_id)
	var entries: Array = _compute_visual_chain(order, division_id, movement_profile)
	# Foreign terminal hop: server's final_position_lng/lat, when set, becomes the chain's
	# final entry. Mirrors what _submit_move_order_for_division does for self-moves.
	var server_final_lng: float = float(div_data.get("final_position_lng", -999.0))
	var server_final_lat: float = float(div_data.get("final_position_lat", -999.0))
	if server_final_lng > -998.0 and not entries.is_empty():
		var terminal_kmh: float = float(entries[entries.size() - 1]["kmh"])
		entries.append({
			"id": "",
			"lng": server_final_lng,
			"lat": server_final_lat,
			"kmh": terminal_kmh,
		})
	var positions: Array[Vector2] = _project_entries_to_world(entries)
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

	var lng: float = float(data.get("position_lng", 0.0))
	var lat: float = float(data.get("position_lat", 0.0))
	var screen_pos: Vector2 = _map_loader.project_lng_lat(lng, lat)
	var edge_pos: Vector2 = _map_loader.project_lng_lat(lng, lat + ENGAGEMENT_RADIUS_KM / 111.0)
	var eng_px: float = screen_pos.distance_to(edge_pos)
	icon.setup(data, color, eng_px, OBSERVATION_RADIUS_PX, SCOUTING_RADIUS_PX)
	icon.position = screen_pos
	_target_positions[division_id] = screen_pos

	_icon_layer.add_child(icon)
	_icons[division_id] = icon
	_refresh_icon_visual_emphasis(division_id)

	var route: Node2D = MoveOrderOverlay.new()
	_icon_layer.add_child(route)
	_route_overlays[division_id] = route
	_update_division_visibility(division_id)


func _on_division_updated(division_id: String) -> void:
	if division_id == _selected_division_id:
		call_deferred("_emit_active_hold_eligibility")
		call_deferred("_emit_active_retreat_eligibility")
	var icon = _icons.get(division_id)
	if icon == null:
		return
	var data: Dictionary = GameState.get_division(division_id)
	if data.is_empty():
		return

	icon.update_data(data)

	icon.is_meeting_battle = data.get("is_meeting_battle", false)
	icon.queue_redraw()

	var server_lng := float(data.get("position_lng", 0.0))
	var server_lat := float(data.get("position_lat", 0.0))

	var order: Array = data.get("move_order", [])
	var repos_order: Array = data.get("reposition_order", [])
	var combat_state_val: String = data.get("combat_state", "idle")

	# Cache movement profile once (doesn't change during a session).
	if not _dr_profiles.has(division_id):
		var pj: String = data.get("movement_profile_json", "")
		if not pj.is_empty():
			var parsed: Variant = JSON.parse_string(pj)
			if parsed is Dictionary:
				_dr_profiles[division_id] = parsed

	# Engaged division with active reposition order — seed DR at 30% speed for smooth movement
	if repos_order.size() > 0 and combat_state_val in ["engaged", "suppressed"]:
		if not _dr_pos_deg.has(division_id):
			_dr_pos_deg[division_id] = Vector2(server_lng, server_lat)
		var repos_entries: Array = _compute_visual_chain(repos_order, division_id, _dr_profiles[division_id])
		_dr_order[division_id] = repos_entries
		_dr_speed_mult[division_id] = REPOSITION_SPEED
		(icon as Node2D).set_moving(true)
		_update_division_route(division_id)
		_update_division_visibility(division_id)
		return

	if order.is_empty() or combat_state_val in ["engaged", "suppressed"]:
		var server_final_lng: float = float(data.get("final_position_lng", -999.0))
		var server_final_lat: float = float(data.get("final_position_lat", -999.0))
		# Waypoints done but server is still advancing to the exact click position — let
		# client DR continue to the server-broadcast terminal; do not freeze yet. The terminal
		# is the last entry in `_dr_order` (Point 4); if it's missing or stale, refresh it
		# from the server's authoritative final_position_lng/lat. The client's own pre-submit
		# resolve_final_position only saw the road-only graph; the server resolves against the
		# full road+terrain-grid graph, so the two can disagree — without this sync the icon
		# would freeze on the client's possibly-wrong prediction instead of converging to the
		# server's truth once the broadcast arrives.
		if order.is_empty() and server_final_lng > -998.0 and not (combat_state_val in ["engaged", "suppressed"]):
			var server_goal := Vector2(server_final_lng, server_final_lat)
			var cur_order: Array = _dr_order.get(division_id, [])
			if cur_order.is_empty():
				# Last real entry was popped, leaving _dr_order empty. Rebuild a stub chain with
				# the server's terminal as the only entry; the carried-over kmh comes from the
				# last consumed real entry, cached in _dr_last_real_kmh during _advance_dr.
				var carried_kmh: float = float(_dr_last_real_kmh.get(division_id, DR_ROAD_KMH))
				if not _dr_pos_deg.has(division_id):
					_dr_pos_deg[division_id] = Vector2(server_final_lng, server_final_lat)
				_target_positions[division_id] = _map_loader.project_lng_lat(server_final_lng, server_final_lat)
				_dr_order[division_id] = [{
					"id": "",
					"lng": server_goal.x,
					"lat": server_goal.y,
					"kmh": carried_kmh,
				}]
			else:
				var tail: Dictionary = cur_order[cur_order.size() - 1]
				var tail_pos: Vector2 = Vector2(float(tail["lng"]), float(tail["lat"]))
				if not tail_pos.is_equal_approx(server_goal):
					var terminal_kmh: float = float(tail["kmh"])
					cur_order[cur_order.size() - 1] = {
						"id": "",
						"lng": server_goal.x,
						"lat": server_goal.y,
						"kmh": terminal_kmh,
					}
					_dr_order[division_id] = cur_order
			_update_division_route(division_id)
			_update_division_visibility(division_id)
			return
		# Server cleared final position (reached it) or combat overrides — pop the terminal
		# entry if present. The remaining real/sub-point entries should already have been
		# consumed by `_advance_dr`, but defensively drop any residual terminal.
		var stop_order: Array = _dr_order.get(division_id, [])
		if not stop_order.is_empty():
			var last_entry: Dictionary = stop_order[stop_order.size() - 1]
			if str(last_entry["id"]) == "":
				# Was the tail a terminal? Check by inspecting whether removing it leaves a real
				# waypoint at the tail OR leaves an empty list. The original heuristic from the
				# pre-Point-4 code: when the server clears final, anything left in _dr_order
				# that isn't a real waypoint needs clearing.
				# Walk back to find the last real entry; trim everything after it.
				var trim_to: int = stop_order.size() - 1
				while trim_to > 0:
					var candidate: Dictionary = stop_order[trim_to]
					if str(candidate["id"]) != "":
						break
					trim_to -= 1
				if trim_to < stop_order.size() - 1:
					stop_order = stop_order.slice(0, trim_to + 1)
					_dr_order[division_id] = stop_order
		_dr_order.erase(division_id)
		# Division fully stopped or locked in combat — freeze at server-authoritative position.
		_dr_pos_deg.erase(division_id)
		_dr_profiles.erase(division_id)
		_dr_speed_mult.erase(division_id)
		_dr_last_real_kmh.erase(division_id)
		_target_positions[division_id] = _map_loader.project_lng_lat(server_lng, server_lat)
		(icon as Node2D).set_moving(false)
		_update_division_route(division_id)
		_update_division_visibility(division_id)
		return

	# Build typed String order — the server's authoritative id sequence, used for suffix-match.
	var str_order: Array[String] = []
	for wp: Variant in order:
		str_order.append(str(wp))

	if not _dr_pos_deg.has(division_id):
		# First update with a live order — seed DR from server position. Build the full entry
		# list (real waypoints + jitter sub-points + optional terminal) up front so animation,
		# HUD line, and reconciliation all work off the same data.
		if not FOREIGN_UNIT_PATH_DR and not _is_own_unit(division_id):
			_target_positions[division_id] = _map_loader.project_lng_lat(server_lng, server_lat)
		else:
			_dr_pos_deg[division_id] = Vector2(server_lng, server_lat)
			var seeded: Array = _build_server_entries(division_id, data, str_order)
			_dr_order[division_id] = seeded
		(icon as Node2D).set_moving(true)
	else:
		if not _dr_order.has(division_id):
			return
		var cur_order: Array = _dr_order[division_id]
		# Filter to real-waypoint ids only (skip jitter sub-points with id="") for the
		# suffix-match against server's str_order — server has no notion of sub-points.
		var cur_real_ids: Array[String] = []
		for entry in cur_order:
			if str(entry["id"]) != "":
				cur_real_ids.append(str(entry["id"]))
		var new_lead: String = str_order[0] if not str_order.is_empty() else ""
		var updated_lead: String = cur_real_ids[0] if not cur_real_ids.is_empty() else ""
		var consumed_ids: Array = data.get("consumed_waypoint_ids", [])

		# Pop real entries whose ids match a server-broadcast consumed id. Sub-points are not
		# in this loop — they're consumed by distance in `_advance_dr`. The loop walks past
		# any leading sub-points to find a real entry, then checks if it's been consumed.
		while not cur_order.is_empty() and str(cur_order[0]["id"]) == "":
			cur_order = cur_order.slice(1)
		var consumed_set: Dictionary = {}
		for cid in consumed_ids:
			consumed_set[str(cid)] = true
		while not cur_order.is_empty() and str(cur_order[0]["id"]) != "" and consumed_set.has(str(cur_order[0]["id"])):
			var popped: Dictionary = cur_order[0]
			_dr_last_real_kmh[division_id] = float(popped["kmh"])
			cur_order = cur_order.slice(1)
			# Once we pop a real waypoint, the next entry may be a sub-point — skip past it.
			while not cur_order.is_empty() and str(cur_order[0]["id"]) == "":
				cur_order = cur_order.slice(1)
		_dr_order[division_id] = cur_order

		# Recompute cur_real_ids after the trim — needed for the suffix-match below.
		cur_real_ids.clear()
		for entry in _dr_order.get(division_id, []):
			if str(entry["id"]) != "":
				cur_real_ids.append(str(entry["id"]))
		updated_lead = cur_real_ids[0] if not cur_real_ids.is_empty() else ""

		# Check if client is ahead of server: client's remaining real ids form a suffix of the
		# server's str_order. Avoids resetting position when DR has simply outpaced consumption.
		var is_ahead: bool = false
		if not cur_real_ids.is_empty() and cur_real_ids.size() <= str_order.size():
			var str_tail: Array = str_order.slice(str_order.size() - cur_real_ids.size())
			is_ahead = true
			for i in range(cur_real_ids.size()):
				if str(cur_real_ids[i]) != str(str_tail[i]):
					is_ahead = false
					break

		# Client fully consumed the visual chain (real + sub + terminal) while server still has
		# trailing real waypoints. The next broadcast will catch up via consumed_waypoint_ids.
		var at_final_goal: bool = _dr_order.get(division_id, []).is_empty() and not str_order.is_empty()

		if is_ahead:
			var consumed_count: int = str_order.size() - cur_real_ids.size()
			if consumed_count > 0:
				var last_consumed_node: Dictionary = _pathfinder.get_node(str(str_order[consumed_count - 1]))
				if not last_consumed_node.is_empty():
					_dr_pos_deg[division_id] = Vector2(float(last_consumed_node["lng"]), float(last_consumed_node["lat"]))
		elif not at_final_goal and updated_lead != new_lead:
			# Real route change (e.g. server reroute) — full reset. The new lead is a real
			# waypoint; the new _dr_order is built fresh from str_order + jitter + terminal.
			if _icons.has(division_id):
				_dr_icon_reconcile_from[division_id] = _icons[division_id].position
				_dr_icon_reconcile_t[division_id]    = 0.0
			_dr_pos_deg[division_id] = Vector2(server_lng, server_lat)
			_dr_order[division_id] = _build_server_entries(division_id, data, str_order)
		else:
			# Same route, possibly with server-side final_position update. Refresh the terminal
			# entry if the server's broadcast changed — keeps the icon converging to the server's
			# authoritative clamp even if the client predicted a slightly different point.
			_refresh_terminal_entry(division_id, data)

	_update_division_route(division_id)
	_update_division_visibility(division_id)


## Builds the full DR entry list for a foreign unit (or self on reroute): real waypoints +
## jitter sub-points + optional terminal hop from the server's `final_position_lng/lat`. Mirrors
## what `_submit_move_order_for_division` does for self-submitted orders, but reads the source
## waypoint list from the authoritative schema broadcast rather than the client's submission.
## Parameters:
## - division_id: division the order is for (used as the deterministic jitter seed).
## - data: full division snapshot from GameState (for final_position + profile lookups).
## - str_order: typed Array[String] of server-authoritative waypoint ids for this move order.
## Returns: Array of entry dictionaries ready to assign to `_dr_order`.
func _build_server_entries(division_id: String, data: Dictionary, str_order: Array[String]) -> Array:
	var movement_profile: Dictionary = _dr_profiles.get(division_id, {})
	var entries: Array = _compute_visual_chain(str_order, division_id, movement_profile)
	var server_final_lng: float = float(data.get("final_position_lng", -999.0))
	var server_final_lat: float = float(data.get("final_position_lat", -999.0))
	if server_final_lng > -998.0 and not entries.is_empty():
		var terminal_kmh: float = float(entries[entries.size() - 1]["kmh"])
		entries.append({
			"id": "",
			"lng": server_final_lng,
			"lat": server_final_lat,
			"kmh": terminal_kmh,
		})
	return entries


## Refreshes the terminal entry in `_dr_order[division_id]` from the server's broadcast
## `final_position_lng/lat`. Replaces the tail if it was already a terminal; appends a new
## terminal if the tail was the chain's last real waypoint (sub-point entries between the last
## real waypoint and the terminal are preserved, so DR continues smoothly without a discontinuity).
## No-op when the tail is already up-to-date or when `_dr_order` is empty.
func _refresh_terminal_entry(division_id: String, data: Dictionary) -> void:
	var server_final_lng: float = float(data.get("final_position_lng", -999.0))
	var server_final_lat: float = float(data.get("final_position_lat", -999.0))
	var cur: Array = _dr_order.get(division_id, [])
	if cur.is_empty():
		return
	if server_final_lng > -998.0:
		var server_goal := Vector2(server_final_lng, server_final_lat)
		var tail: Dictionary = cur[cur.size() - 1]
		var tail_pos: Vector2 = Vector2(float(tail["lng"]), float(tail["lat"]))
		if tail_pos.is_equal_approx(server_goal):
			return  # already in sync
		# Replace the tail (could be either a terminal from a prior broadcast, or the chain's
		# last real waypoint — either way the new terminal kmh inherits from the existing tail).
		var terminal_kmh: float = float(tail["kmh"])
		cur[cur.size() - 1] = {
			"id": "",
			"lng": server_goal.x,
			"lat": server_goal.y,
			"kmh": terminal_kmh,
		}
		_dr_order[division_id] = cur


func _on_division_removed(division_id: String) -> void:
	if _hovered_division_id == division_id:
		_set_hovered_division("")
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
	_dr_speed_mult.erase(division_id)
	_dr_last_real_kmh.erase(division_id)
	_dr_icon_reconcile_from.erase(division_id)
	_dr_icon_reconcile_t.erase(division_id)
	if _selected_division_ids.has(division_id):
		_selected_division_ids.erase(division_id)
		_selection_preview_division_ids.erase(division_id)
		_selected_division_id = _selected_division_ids[0] if not _selected_division_ids.is_empty() else ""
		_emit_selection_changed()


func _on_stack_formed(stack_id: String, division_ids: Array) -> void:
	for div_id in division_ids:
		var icon = _icons.get(div_id)
		if icon:
			icon.stack_count = division_ids.size()
			icon.queue_redraw()


func _on_stack_rotated(_stack_id: String, _rotated_back: String, _new_front: String) -> void:
	pass  # stack_count unchanged; visual reorder handled by stack_position in DIVISION_UPDATES


func _on_stack_dissolved(stack_id: String) -> void:
	for div_id: String in GameState.divisions:
		var div_data: Dictionary = GameState.get_division(div_id)
		if div_data.get("stack_id", "") == stack_id:
			var icon = _icons.get(div_id)
			if icon:
				icon.stack_count = 0
				icon.queue_redraw()


func _on_vision_visibility_changed(visible_provinces: Dictionary) -> void:
	_visible_provinces = visible_provinces.duplicate()
	_vision_filter_enabled = not _visible_provinces.is_empty()
	for division_id: String in _icons:
		_update_division_visibility(division_id)


func _on_division_revealed(division_id: String) -> void:
	_air_revealed_divisions[division_id] = true
	_update_division_visibility(division_id)


func _on_division_hidden(division_id: String) -> void:
	_air_revealed_divisions.erase(division_id)
	_update_division_visibility(division_id)


func _on_division_revealed_with_ping(division_id: String) -> void:
	_on_division_revealed(division_id)
	var icon: Node2D = _icons.get(division_id) as Node2D
	if is_instance_valid(icon):
		_spawn_radar_ping(icon.position)


func _spawn_radar_ping(pos: Vector2) -> void:
	var ring := Node2D.new()
	ring.position = pos
	_icon_layer.add_child(ring)
	ring.set_script(load("res://src/systems/military/detection_ring.gd"))


func _on_division_appeared(division_id: String) -> void:
	_air_revealed_divisions[division_id] = true
	_on_division_added(division_id)
	var icon: Node2D = _icons.get(division_id) as Node2D
	icon.visible = true
	if is_instance_valid(icon) and icon.has_method("reveal"):
		icon.reveal()


func _on_division_vanishing(division_id: String) -> void:
	var icon: Node2D = _icons.get(division_id) as Node2D
	if not is_instance_valid(icon) or not icon.has_method("conceal"):
		_air_revealed_divisions.erase(division_id)
		_do_division_removal(division_id)
		return
	var finished: Signal = icon.conceal()
	await finished
	_air_revealed_divisions.erase(division_id)
	_do_division_removal(division_id)


func _do_division_removal(division_id: String) -> void:
	GameState.divisions.erase(division_id)
	EventBus.division_removed.emit(division_id)


func _update_division_visibility(division_id: String) -> void:
	var icon: Node2D = _icons.get(division_id) as Node2D
	if icon == null:
		return

	var should_show: bool = _is_division_visible_to_player(division_id)
	icon.visible = should_show
	_refresh_icon_visual_emphasis(division_id)

	var route: Node2D = _route_overlays.get(division_id) as Node2D
	if route != null:
		route.visible = should_show

	if not should_show:
		if _hovered_division_id == division_id:
			_set_hovered_division("")
		if _selected_division_ids.has(division_id):
			_selected_division_ids.erase(division_id)
			_selected_division_id = _selected_division_ids[0] if not _selected_division_ids.is_empty() else ""
			_emit_selection_changed()
		if _selection_preview_division_ids.has(division_id):
			_selection_preview_division_ids.erase(division_id)
			if icon.has_method("set_selection_preview"):
				icon.set_selection_preview(false)


func _is_division_visible_to_player(division_id: String) -> bool:
	if _is_own_unit(division_id):
		return true
	if _air_revealed_divisions.has(division_id):
		return true
	if not _vision_filter_enabled:
		return false

	var icon: Node2D = _icons.get(division_id) as Node2D
	if icon == null:
		return false
	if _is_world_position_in_visible_province(icon.position):
		return true
	if _vision_system != null and _vision_system.has_method("is_world_position_visible_to_units"):
		return _vision_system.is_world_position_visible_to_units(icon.position)
	return false


func _is_world_position_in_visible_province(world_position: Vector2) -> bool:
	if _map_loader == null:
		return true
	for province_id: String in _visible_provinces:
		if _is_world_position_in_province(world_position, province_id):
			return true
	return false


func _is_world_position_in_province(world_position: Vector2, province_id: String) -> bool:
	var province_node: Node2D = _map_loader.get_province_node(province_id)
	if province_node == null:
		return false
	for child: Node in province_node.get_children():
		if not child is Polygon2D:
			continue
		var polygon_node: Polygon2D = child
		if not (polygon_node.name == "Fill" or polygon_node.name.begins_with("FillPart")):
			continue
		if Geometry2D.is_point_in_polygon(world_position, polygon_node.polygon):
			return true
	return false


# ── Selection ─────────────────────────────────────────────────────────────────

func _select(division_id: String) -> void:
	var new_selection: Array[String] = []
	new_selection.append(division_id)
	_commit_selection(new_selection)
	_clear_pending()


func _add_to_selection(division_id: String) -> void:
	if _selected_division_ids.has(division_id):
		_set_active_division(division_id)
		return
	var new_selection: Array[String] = _selected_division_ids.duplicate()
	new_selection.append(division_id)
	_commit_selection(new_selection, division_id)


func _remove_from_selection(division_id: String) -> void:
	if not _selected_division_ids.has(division_id):
		return
	var removed_index: int = _selected_division_ids.find(division_id)
	var new_selection: Array[String] = _selected_division_ids.duplicate()
	new_selection.erase(division_id)
	var next_active_id: String = _selected_division_id
	if division_id == _selected_division_id and not new_selection.is_empty():
		next_active_id = new_selection[mini(removed_index, new_selection.size() - 1)]
	_commit_selection(new_selection, next_active_id)


func deselect() -> void:
	for division_id: String in _selected_division_ids:
		if _icons.has(division_id):
			(_icons[division_id] as Node2D).set_selected(false)
			(_icons[division_id] as Node2D).set_move_mode(false)
	_clear_selection_preview()
	_selected_division_id = ""
	_selected_division_ids.clear()
	_set_hovered_division("")
	EventBus.division_deselected.emit()
	EventBus.division_active_changed.emit("")
	EventBus.province_deselected.emit()
	EventBus.division_selection_changed.emit([] as Array[String])
	EventBus.division_hold_eligibility_changed.emit("", false)
	EventBus.division_retreat_eligibility_changed.emit("", false)
	_refresh_all_icon_visual_emphasis()
	_clear_pending()


func _commit_selection(division_ids: Array[String], active_division_id: String = "") -> void:
	for old_division_id: String in _selected_division_ids:
		if _icons.has(old_division_id):
			(_icons[old_division_id] as Node2D).set_selected(false)
			(_icons[old_division_id] as Node2D).set_move_mode(false)

	_selected_division_ids.clear()
	for division_id: String in division_ids:
		if division_id.is_empty() or not _icons.has(division_id):
			continue
		if not _is_own_unit(division_id):
			continue
		if _selected_division_ids.has(division_id):
			continue
		_selected_division_ids.append(division_id)

	_selected_division_id = active_division_id if _selected_division_ids.has(active_division_id) else ""
	if _selected_division_id.is_empty() and not _selected_division_ids.is_empty():
		_selected_division_id = _selected_division_ids[0]
	for selected_id: String in _selected_division_ids:
		(_icons[selected_id] as Node2D).set_selected(true)
		(_icons[selected_id] as Node2D).set_active_selection(selected_id == _selected_division_id)

	_clear_selection_preview()
	_refresh_all_icon_visual_emphasis()
	_emit_selection_changed()


func _emit_selection_changed() -> void:
	_refresh_active_selection_icons()
	if _selected_division_ids.is_empty():
		EventBus.division_deselected.emit()
	else:
		EventBus.division_selected.emit(_selected_division_id)
	EventBus.division_active_changed.emit(_selected_division_id)
	EventBus.division_selection_changed.emit(_selected_division_ids.duplicate())
	_emit_active_hold_eligibility()
	_emit_active_retreat_eligibility()


func _set_active_division(division_id: String) -> void:
	if division_id == _selected_division_id or not _selected_division_ids.has(division_id):
		return
	_selected_division_id = division_id
	_refresh_active_selection_icons()
	EventBus.division_selected.emit(division_id)
	EventBus.division_active_changed.emit(division_id)
	_emit_active_hold_eligibility()
	_emit_active_retreat_eligibility()


func _refresh_active_selection_icons() -> void:
	for selected_id: String in _selected_division_ids:
		if _icons.has(selected_id):
			(_icons[selected_id] as Node2D).set_active_selection(selected_id == _selected_division_id)
	_refresh_all_icon_visual_emphasis()


func _commit_drag_selection() -> void:
	var new_selection: Array[String] = []
	if _drag_select_additive or _drag_select_subtractive:
		new_selection.assign(_selected_division_ids)
	if _drag_select_subtractive:
		for division_id: String in _selection_preview_division_ids:
			new_selection.erase(division_id)
	else:
		for division_id: String in _selection_preview_division_ids:
			if not new_selection.has(division_id):
				new_selection.append(division_id)
	var active_id: String = _nearest_division_to_screen_position(new_selection, _drag_select_current_screen)
	_commit_selection(new_selection, active_id)


## Finds the selected counter closest to a screen-space selection release point.
## Parameters:
## - division_ids: eligible selected divisions.
## - screen_position: viewport-space release position.
## Returns: closest division ID, or an empty string when the selection is empty.
func _nearest_division_to_screen_position(division_ids: Array[String], screen_position: Vector2) -> String:
	var nearest_id: String = ""
	var nearest_distance: float = INF
	for division_id: String in division_ids:
		var icon_position: Vector2 = _get_division_screen_position(division_id)
		var distance: float = icon_position.distance_squared_to(screen_position)
		if distance < nearest_distance:
			nearest_distance = distance
			nearest_id = division_id
	return nearest_id


## Publishes the active counter position needed by contextual HUD anchoring.
## Parameters: none.
## Returns: nothing.
func _emit_ui_anchor_positions() -> void:
	if not _selected_division_id.is_empty():
		EventBus.division_screen_position_updated.emit(
			_selected_division_id,
			_get_division_screen_position(_selected_division_id)
		)


## Updates the owned-division hover target while no placement interaction owns the pointer.
## Parameters:
## - world_position: current pointer position in map coordinates.
## Returns: nothing.
func _update_hovered_division(world_position: Vector2) -> void:
	if _move_mode or _reposition_mode or _drag_select_active:
		_set_hovered_division("")
		return
	var division_id: String = find_division_at_world(world_position)
	if not division_id.is_empty() and not _is_own_unit(division_id):
		division_id = ""
	_set_hovered_division(division_id)


## Emits a hover transition only when the target actually changes.
## Parameters:
## - division_id: newly hovered owned division, or empty to clear hover.
## Returns: nothing.
func _set_hovered_division(division_id: String) -> void:
	if division_id == _hovered_division_id:
		return
	_hovered_division_id = division_id
	_refresh_all_icon_visual_emphasis()
	EventBus.division_hover_changed.emit(division_id)


## Applies ordinary or full emphasis without affecting visibility or reveal animation.
func _refresh_icon_visual_emphasis(division_id: String) -> void:
	var icon: Node2D = _icons.get(division_id) as Node2D
	if icon == null or not icon.has_method("set_visual_emphasis"):
		return
	var fully_emphasized: bool = _selected_division_ids.has(division_id) \
			or _selection_preview_division_ids.has(division_id) \
			or division_id == _hovered_division_id
	icon.set_visual_emphasis(
		FULL_DIVISION_EMPHASIS if fully_emphasized else ORDINARY_DIVISION_EMPHASIS
	)


func _refresh_all_icon_visual_emphasis() -> void:
	for division_id: String in _icons:
		_refresh_icon_visual_emphasis(division_id)


## Returns whether an owned division is in ordinary movement and can receive Hold.
## Parameters:
## - division_data: current authoritative division snapshot.
## - is_owned: whether the requesting player owns the division.
## - has_local_movement: immediate dead-reckoned movement awaiting server confirmation.
## Returns: true when the snapshot permits Hold.
static func can_hold_division_data(
		division_data: Dictionary,
		is_owned: bool,
		has_local_movement: bool = false
) -> bool:
	if not is_owned or division_data.is_empty():
		return false
	if division_data.get("combat_state", "idle") != "idle":
		return false
	var move_order: Array = division_data.get("move_order", [])
	return has_local_movement or not move_order.is_empty() \
			or float(division_data.get("final_position_lng", -999.0)) > -998.0


## Returns whether a division can receive Hold in current authoritative client state.
## Parameters:
## - division_id: division to validate.
## Returns: true when Hold may be submitted for this division.
func _can_hold_division(division_id: String) -> bool:
	if division_id.is_empty():
		return false
	# Point 4: terminal hop lives in `_dr_order`, so a non-empty `_dr_order` is sufficient — no
	# separate `_dr_final_goal.has` check is needed.
	var has_local_movement: bool = (
		_dr_order.has(division_id) and not (_dr_order[division_id] as Array).is_empty()
	)
	return can_hold_division_data(
		GameState.get_division(division_id),
		_is_own_unit(division_id),
		has_local_movement
	)


## Publishes Hold availability for the active selection without exposing command authority to UI.
## Parameters: none.
## Returns: nothing.
func _emit_active_hold_eligibility() -> void:
	EventBus.division_hold_eligibility_changed.emit(
		_selected_division_id,
		_selected_division_ids.size() == 1 and _can_hold_division(_selected_division_id)
	)


## Submits Hold for one selected division after revalidating its eligibility.
## Parameters:
## - division_id: selected division captured by the requesting UI context.
## Returns: nothing.
func _hold_division(division_id: String) -> void:
	if not _selected_division_ids.has(division_id) or not _can_hold_division(division_id):
		return
	_clear_pending()
	CommandQueue.submit("HOLD", {"division_id": division_id})


## Submits Hold for every currently selected owned and eligible division.
## Parameters: none.
## Returns: nothing.
func _hold_selected_divisions() -> void:
	var eligible_division_ids: Array[String] = []
	for division_id: String in _get_own_selected_division_ids():
		if _can_hold_division(division_id):
			eligible_division_ids.append(division_id)
	if eligible_division_ids.is_empty():
		return
	_clear_pending()
	for division_id: String in eligible_division_ids:
		CommandQueue.submit("HOLD", {"division_id": division_id})


## Returns whether an owned division's authoritative state permits Retreat.
## Parameters:
## - division_data: current authoritative division snapshot.
## - is_owned: whether the requesting player owns the division.
## Returns: true when the snapshot permits Retreat.
static func can_retreat_division_data(division_data: Dictionary, is_owned: bool) -> bool:
	if not is_owned or division_data.is_empty():
		return false
	return division_data.get("combat_state", "idle") in ["engaged", "suppressed"]


## Returns whether a division can receive Retreat in current authoritative client state.
## Parameters:
## - division_id: division to validate.
## Returns: true when Retreat may be submitted for this division.
func _can_retreat_division(division_id: String) -> bool:
	if division_id.is_empty():
		return false
	return can_retreat_division_data(
		GameState.get_division(division_id),
		_is_own_unit(division_id)
	)


## Publishes Retreat availability for the active selection without exposing command authority to UI.
## Parameters: none.
## Returns: nothing.
func _emit_active_retreat_eligibility() -> void:
	EventBus.division_retreat_eligibility_changed.emit(
		_selected_division_id,
		_selected_division_ids.size() == 1 and _can_retreat_division(_selected_division_id)
	)


## Submits Retreat for one selected division after revalidating its eligibility.
## Parameters:
## - division_id: selected division captured by the requesting UI context.
## Returns: nothing.
func _retreat_division(division_id: String) -> void:
	if not _selected_division_ids.has(division_id) or not _can_retreat_division(division_id):
		return
	_clear_pending()
	CommandQueue.submit("RETREAT", {"division_id": division_id})


## Submits Retreat for selected owned divisions currently eligible to retreat.
## Parameters: none.
## Returns: nothing.
func _retreat_selected_divisions() -> void:
	var eligible_division_ids: Array[String] = []
	for division_id: String in _get_own_selected_division_ids():
		if _can_retreat_division(division_id):
			eligible_division_ids.append(division_id)
	if eligible_division_ids.is_empty():
		return
	_clear_pending()
	for division_id: String in eligible_division_ids:
		CommandQueue.submit("RETREAT", {"division_id": division_id})


func _reset_drag_selection() -> void:
	_drag_select_pressed = false
	_drag_select_active = false
	_drag_select_start_screen = Vector2.ZERO
	_drag_select_current_screen = Vector2.ZERO
	_drag_select_additive = false
	_drag_select_subtractive = false
	_drag_select_can_activate = false
	_clear_selection_preview()
	_update_selection_box_overlay()


func _update_drag_selection_preview() -> void:
	var selection_rect: Rect2 = _get_drag_selection_rect()
	var preview_ids: Array[String] = []
	var canvas_transform: Transform2D = get_viewport().get_canvas_transform()
	for division_id: String in _icons:
		if not _is_own_unit(division_id):
			continue
		var icon: Node2D = _icons[division_id]
		var screen_position: Vector2 = canvas_transform * icon.global_position
		if selection_rect.has_point(screen_position):
			preview_ids.append(division_id)
	_set_selection_preview(preview_ids)


func _set_selection_preview(division_ids: Array[String]) -> void:
	for old_division_id: String in _selection_preview_division_ids:
		if _icons.has(old_division_id):
			(_icons[old_division_id] as Node2D).set_selection_preview(false)

	_selection_preview_division_ids.clear()
	for division_id: String in division_ids:
		if not _icons.has(division_id):
			continue
		_selection_preview_division_ids.append(division_id)
		(_icons[division_id] as Node2D).set_selection_preview(true)
	_refresh_all_icon_visual_emphasis()


func _clear_selection_preview() -> void:
	for division_id: String in _selection_preview_division_ids:
		if _icons.has(division_id):
			(_icons[division_id] as Node2D).set_selection_preview(false)
	_selection_preview_division_ids.clear()
	_refresh_all_icon_visual_emphasis()


func _get_drag_selection_rect() -> Rect2:
	var top_left: Vector2 = Vector2(
			minf(_drag_select_start_screen.x, _drag_select_current_screen.x),
			minf(_drag_select_start_screen.y, _drag_select_current_screen.y))
	var bottom_right: Vector2 = Vector2(
			maxf(_drag_select_start_screen.x, _drag_select_current_screen.x),
			maxf(_drag_select_start_screen.y, _drag_select_current_screen.y))
	return Rect2(top_left, bottom_right - top_left)


func _update_selection_box_overlay() -> void:
	if _selection_box_overlay == null:
		return
	if _drag_select_active:
		_selection_box_overlay.set_selection_rect(_get_drag_selection_rect(), true)
	else:
		_selection_box_overlay.set_selection_rect(Rect2(), false)


func find_division_at_world(world_pos: Vector2) -> String:
	var best_id := ""
	var best_dist := HIT_THRESHOLD_PX
	var canvas_transform: Transform2D = get_viewport().get_canvas_transform()
	var screen_position: Vector2 = canvas_transform * world_pos
	for div_id: String in _icons:
		if not _is_division_visible_to_player(div_id):
			continue
		var icon: Node2D = _icons[div_id]
		var icon_screen_position: Vector2 = canvas_transform * icon.global_position
		var d: float = icon_screen_position.distance_to(screen_position)
		if d < best_dist:
			best_dist = d
			best_id = div_id
	return best_id


# ── EngagementBanner lifecycle ────────────────────────────────────────────

func _on_combat_started_banner(division_a: String, division_b: String, _is_meeting: bool) -> void:
	var eng_key := division_a + "_vs_" + division_b
	if _banners.has(eng_key):
		return
	if not _icons.has(division_a) or not _icons.has(division_b):
		return
	var banner: Node2D = ENGAGEMENT_BANNER_SCENE.instantiate()
	_icon_layer.add_child(banner)
	banner.setup(division_a, division_b, _icons, eng_key)
	_banners[eng_key] = banner


func _on_combat_resolved_banner(_province_id: String, outcome: Dictionary) -> void:
	var div_a: String = str(outcome.get("winner_id", ""))
	var div_b: String = str(outcome.get("retreated_id", ""))
	for key in [div_a + "_vs_" + div_b, div_b + "_vs_" + div_a]:
		if _banners.has(key):
			_banners[key].cleanup()
			_banners.erase(key)
			return


class SelectionBoxOverlay:
	extends Control

	var _selection_rect: Rect2 = Rect2()
	var _is_active: bool = false

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_anchors_preset(Control.PRESET_FULL_RECT)

	## Updates the screen-space rectangle used for drag selection feedback.
	## Parameters:
	## - selection_rect: viewport-space rectangle to draw.
	## - active: whether the drag-selection box should be visible.
	## Returns: Nothing.
	func set_selection_rect(selection_rect: Rect2, active: bool) -> void:
		_selection_rect = selection_rect
		_is_active = active
		queue_redraw()

	func _draw() -> void:
		if not _is_active:
			return
		draw_rect(_selection_rect, Color(0.75, 0.78, 0.82, 0.16), true)
		draw_rect(_selection_rect, Color(0.82, 0.86, 0.92, 0.85), false, 1.5)
