extends Node

const AIR_WING_ICON_SCENE := preload("res://scenes/systems/air/air_wing_icon.tscn")
const BombingRunIndicatorScene := preload("res://scenes/systems/air/bombing_run_indicator.tscn")
const DubinsInterpolator := preload("res://src/systems/air/dubins_interpolator.gd")
const MoveOrderOverlay := preload("res://src/systems/military/move_order_overlay.gd")
const AirRangeOverlay := preload("res://src/systems/air/air_range_overlay.gd")
const RECON_RADIUS_DEG   := 1.0
const COMBAT_RADIUS_DEG  := 0.3

const OBSERVATION_DEG_BY_TYPE := {
	"fighter": 0.25, "heavy_fighter": 0.35,
	"cas_plane": 0.05, "dive_bomber": 0.05,
	"tactical_bomber": 0.05, "strategic_bomber": 0.05,
	"naval_bomber": 0.05, "recon_plane": 1.0,
}
const DEFAULT_OBSERVATION_DEG := 0.05

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
var _center: Vector2      = Vector2.ZERO
var _icons: Dictionary    = {}             # wing_id → AirWingIcon node
var _military_system: Node = null
var _target_positions: Dictionary = {}    # wing_id → Vector2 screen-space
var _selected_wing_id: String = ""
var _pending_milestones: Array[String] = []
var _pending_chain: Array[String] = []
var _shift_chain_started: bool = false
var _pending_route_overlay: Node2D = null
var _range_overlay: Node2D = null
var _recon_radius_px: float = 0.0
var _combat_radius_px: float = 0.0
var _wing_fuel: Dictionary = {}  # wing_id → float
var _wing_path_by_id: Dictionary = {}
var _engaged_pairs: Dictionary = {}   # wing_id → opponent wing_id
var _engagement_lines: Dictionary = {} # pair_key → Line2D
var _wing_path_generations_by_id: Dictionary = {}
var _wing_total_elapsed_ms: Dictionary = {}
var _wing_reconcile_from: Dictionary = {}   # wing_id → Vector2 screen pos (blend start)
var _wing_reconcile_ms: Dictionary   = {}   # wing_id → float ms elapsed in blend
var _last_synced_gen_id: Dictionary = {}
var _detected_wings: Dictionary = {}
var _bombing_indicators: Dictionary = {}    # province_id → BombingRunIndicator
var _air_combat_indicators: Dictionary = {} # bucket_key → AirCombatBanner node
var _strategic_bombing_banners: Dictionary = {} # bucket_key → AirCombatBanner
var _bucket_slot_counts: Dictionary    = {} # bucket_key → int (all indicator types)


func setup(map_loader: Node, icon_layer: Node2D, military_system: Node = null) -> void:
	_map_loader = map_loader
	_icon_layer = icon_layer
	_military_system = military_system
	_center = _map_loader.project_lng_lat(0.0, 0.0)
	_recon_radius_px   = _center.distance_to(_map_loader.project_lng_lat(RECON_RADIUS_DEG, 0.0))
	_combat_radius_px  = _center.distance_to(_map_loader.project_lng_lat(COMBAT_RADIUS_DEG, 0.0))
	EventBus.air_wing_added.connect(_on_air_wing_added)
	EventBus.air_wing_updated.connect(_on_air_wing_updated)
	EventBus.air_wing_removed.connect(_on_air_wing_removed)
	EventBus.air_wing_vanishing.connect(_on_air_wing_vanishing)
	if not EventBus.air_wing_path.is_connected(_on_air_wing_path):
		EventBus.air_wing_path.connect(_on_air_wing_path)
	if not EventBus.air_wing_detected.is_connected(_on_air_wing_detected):
		EventBus.air_wing_detected.connect(_on_air_wing_detected)
	if not EventBus.air_wing_detection_lost.is_connected(_on_air_wing_detection_lost):
		EventBus.air_wing_detection_lost.connect(_on_air_wing_detection_lost)
	EventBus.air_combat_started.connect(_on_air_combat_started)
	EventBus.air_combat_ended.connect(_on_air_combat_ended)
	if not EventBus.air_bombing_result.is_connected(_on_air_bombing_result):
		EventBus.air_bombing_result.connect(_on_air_bombing_result)
	EventBus.province_aa_fired.connect(_on_province_aa_fired)
	EventBus.air_bombing_province_result.connect(_on_air_bombing_province_result)
	if _pending_route_overlay == null:
		_pending_route_overlay = MoveOrderOverlay.new()
		_icon_layer.add_child(_pending_route_overlay)
	if _range_overlay == null:
		_range_overlay = AirRangeOverlay.new()
		_range_overlay.setup(_map_loader)
		_icon_layer.add_child(_range_overlay)
	# Hydrate any wings already in GameState (late join / scene reload).
	# Also replay cached AIR_WING_PATH payloads: the initial loiter paths arrive from the server
	# before the game scene finishes loading, so the signal connection isn't up yet and they're
	# lost. GameState caches each payload so we can reapply it here.
	for wing_id in GameState.air_wings:
		_on_air_wing_added(wing_id)
		var cached_path: Dictionary = GameState.air_wing_paths.get(wing_id, {})
		if not cached_path.is_empty():
			_on_air_wing_path(cached_path)
	_update_ghost()


func _exit_tree() -> void:
	cleanup()


func _process(delta: float) -> void:
	for wing_id_variant: Variant in _wing_path_generations_by_id.keys():
		var wing_id: String = str(wing_id_variant)
		_wing_total_elapsed_ms[wing_id] = float(_wing_total_elapsed_ms.get(wing_id, 0.0)) + delta * 1000.0
		_refresh_wing_icon_position(wing_id)
		if _wing_reconcile_ms.has(wing_id):
			const RECONCILE_DURATION_MS := 150.0
			var t: float = minf(_wing_reconcile_ms[wing_id] / RECONCILE_DURATION_MS, 1.0)
			var icon_node = _icons.get(wing_id)
			if icon_node and is_instance_valid(icon_node):
				icon_node.position = _wing_reconcile_from[wing_id].lerp(icon_node.position, t)
			_wing_reconcile_ms[wing_id] += delta * 1000.0
			if _wing_reconcile_ms[wing_id] >= RECONCILE_DURATION_MS:
				_wing_reconcile_ms.erase(wing_id)
				_wing_reconcile_from.erase(wing_id)
		_sync_detection_overlay(wing_id)
	if _range_overlay != null:
		_range_overlay.tick_interpolate(delta)
	_update_range_overlay()
	for pair_key: String in _engagement_lines:
		var line: Line2D = _engagement_lines[pair_key]
		var ids := pair_key.split(",")
		if ids.size() != 2:
			continue
		var icon_a = _icons.get(ids[0])
		var icon_b = _icons.get(ids[1])
		if is_instance_valid(icon_a) and is_instance_valid(icon_b):
			line.set_point_position(0, icon_a.position)
			line.set_point_position(1, icon_b.position)


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
	var is_own: bool = data.get("nation_id", "") == GameState.get_my_nation_id()
	var aircraft_type: String = data.get("aircraft_type", "fighter")
	var passive_deg: float = OBSERVATION_DEG_BY_TYPE.get(aircraft_type, DEFAULT_OBSERVATION_DEG)
	var passive_px: float = _center.distance_to(_map_loader.project_lng_lat(passive_deg, 0.0))
	icon.setup(data, color, passive_px, _recon_radius_px, _combat_radius_px, is_own)
	_icon_layer.add_child(icon)
	_icons[wing_id] = icon
	# Set the icon's real position BEFORE replaying any cached path below — a freshly
	# instantiated icon's position defaults to (0,0), and _on_air_wing_path() captures
	# icon.position as the reconciliation start point. Capturing it before this line would
	# lerp the icon from the map origin to its real position over ~150ms instead of just
	# appearing there.
	_refresh_wing_icon_position(wing_id)
	# Reappearing after a fog-of-war hide/show cycle re-adds the wing as "new," but its
	# interpolation cache (_wing_path_by_id etc.) was wiped on removal — without replaying the
	# cached path here, _process() has nothing to interpolate and the icon snaps to each raw
	# position update instead of moving smoothly, same as the late-join hydration in setup().
	var cached_path: Dictionary = GameState.air_wing_paths.get(wing_id, {})
	if not cached_path.is_empty():
		_on_air_wing_path(cached_path)
	_update_icon_visibility(wing_id)
	var is_enemy: bool = data.get("nation_id", "") != GameState.get_my_nation_id()
	if is_enemy and icon.has_method("reveal"):
		icon.reveal()


func _on_air_wing_updated(wing_id: String) -> void:
	var icon = _icons.get(wing_id)
	if icon == null:
		return
	var data := GameState.get_air_wing(wing_id)
	if data.is_empty():
		return
	icon.update_data(data)

	if data.has("fuel"):
		_wing_fuel[wing_id] = float(data.get("fuel", 1.0))
	if data.has("is_detected"):
		_detected_wings[wing_id] = bool(data.get("is_detected", false))

	var ls: String = data.get("lifecycle_state", "")
	var current_gen_id: String = data.get("path_gen_id", "")
	if ls == "idle" or ls == "refuel" or current_gen_id.is_empty():
		_wing_path_by_id.erase(wing_id)
		_wing_path_generations_by_id.erase(wing_id)
		_wing_total_elapsed_ms.erase(wing_id)
		_wing_reconcile_from.erase(wing_id)
		_wing_reconcile_ms.erase(wing_id)
		_last_synced_gen_id.erase(wing_id)
		_refresh_wing_icon_position(wing_id)
		if wing_id == _selected_wing_id:
			_update_ghost()
		_update_icon_visibility(wing_id)
		return

	var last_synced: String = str(_last_synced_gen_id.get(wing_id, ""))
	var server_elapsed: float = float(data.get("path_elapsed_ms", 0))
	if current_gen_id != last_synced:
		_last_synced_gen_id[wing_id] = current_gen_id
		_wing_total_elapsed_ms[wing_id] = server_elapsed
	else:
		var current: float = float(_wing_total_elapsed_ms.get(wing_id, 0.0))
		_wing_total_elapsed_ms[wing_id] = max(current, server_elapsed)
	_refresh_wing_icon_position(wing_id)
	_update_icon_visibility(wing_id)
	if wing_id == _selected_wing_id:
		_update_ghost()


func _on_air_wing_removed(wing_id: String) -> void:
	var icon = _icons.get(wing_id)
	if icon != null:
		icon.queue_free()
		_icons.erase(wing_id)
	_target_positions.erase(wing_id)
	_wing_path_by_id.erase(wing_id)
	_wing_path_generations_by_id.erase(wing_id)
	_wing_total_elapsed_ms.erase(wing_id)
	_last_synced_gen_id.erase(wing_id)
	_detected_wings.erase(wing_id)
	_wing_fuel.erase(wing_id)
	if _selected_wing_id == wing_id:
		_selected_wing_id = ""
		EventBus.air_wing_deselected.emit()
		_update_ghost()


func _on_air_wing_vanishing(wing_id: String) -> void:
	var icon: Node2D = _icons.get(wing_id) as Node2D
	if not is_instance_valid(icon) or not icon.has_method("conceal"):
		_do_wing_removal(wing_id)
		return
	var finished: Signal = icon.conceal()
	await finished
	_do_wing_removal(wing_id)


func _do_wing_removal(wing_id: String) -> void:
	GameState.air_wings.erase(wing_id)
	EventBus.air_wing_removed.emit(wing_id)


func handle_mouse_input(event: InputEvent, world_pos: Vector2, hovered_province_id: String = "") -> bool:
	if not event is InputEventMouseButton:
		return false
	var mouse_button: InputEventMouseButton = event as InputEventMouseButton
	if not mouse_button.pressed:
		return false
	if mouse_button.button_index == MOUSE_BUTTON_RIGHT and _selected_wing_id != "":
		var selected_wing: Dictionary = GameState.get_air_wing(_selected_wing_id)
		if not selected_wing:
			return false

		var my_nation: String = GameState.get_my_nation_id()

		# -- Phase 1: Find all click targets --
		var hit_wing: String = _find_nearest_enemy_wing_at(world_pos, my_nation)
		var hit_div_id: String = ""
		if _military_system != null:
			hit_div_id = _military_system.find_division_at_world(world_pos)
		var near_banner: bool = _is_near_engagement_banner(world_pos)
		var hit_prov: String = _resolve_province_at_screen_pos(world_pos)

		# -- Phase 2: Act by target priority --
		# Priority 1: Enemy wing → intercept (if capable)
		if hit_wing != "" and _can_intercept(selected_wing.aircraft_type):
			_submit_air_command("ASSIGN_WING_MISSION", {
				"wing_id":   _selected_wing_id,
				"mission":   "interception",
				"target_id": hit_wing,
				"is_manual": true,
			})
			return true

		# Priority 2: Enemy division or engagement banner → ground attack
		var hit_div_data: Dictionary = {}
		var hit_div_enemy: bool = false
		if hit_div_id != "":
			hit_div_data = GameState.get_division(hit_div_id)
			hit_div_enemy = not hit_div_data.is_empty() and hit_div_data.get("nation_id", "") != my_nation
		if hit_div_enemy or near_banner:
			if _can_ground_attack(selected_wing.aircraft_type,
					selected_wing.get("perk_strafing", false)):
				_submit_air_command("ASSIGN_WING_MISSION", {
					"wing_id":   _selected_wing_id,
					"mission":   "tactical_bombing",
					"target_id": hit_div_id,
					"is_manual": true,
				})
				return true

		# Priority 3: Enemy city → strategic bombing (if capable)
		if hit_prov != "":
			var prov: Dictionary = GameState.get_province(hit_prov)
			if not prov.is_empty() and prov.get("owner_id", "") != my_nation:
				if _can_strategic_bomb(selected_wing.aircraft_type):
					_submit_air_command("ASSIGN_WING_MISSION", {
						"wing_id":   _selected_wing_id,
						"mission":   "industry",
						"target_id": hit_prov,
						"is_manual": true,
					})
					return true

		# Priority 4: Fallback — existing move / redeploy behavior
		_handle_existing_right_click(event, world_pos)
		return true

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

	if not best_id.is_empty():
		_select(best_id)
		return true

	# Check air combat banners
	const BANNER_HIT_R: float = 20.0
	for banner_key in _air_combat_indicators:
		var banner = _air_combat_indicators[banner_key]
		if not is_instance_valid(banner):
			continue
		if world_pos.distance_to(banner.position) <= BANNER_HIT_R:
			banner.on_clicked()
			return true

	# Check strategic bombing banners
	for banner_key in _strategic_bombing_banners:
		var banner = _strategic_bombing_banners[banner_key]
		if not is_instance_valid(banner):
			continue
		if world_pos.distance_to(banner.position) <= BANNER_HIT_R:
			banner.on_clicked()
			return true

	# Check bombing run indicators
	for province_id in _bombing_indicators:
		var indicator = _bombing_indicators[province_id]
		if not is_instance_valid(indicator):
			continue
		if world_pos.distance_to(indicator.position) <= BANNER_HIT_R:
			indicator.on_clicked()
			return true

	if not _selected_wing_id.is_empty():
		_deselect()
	return false


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
	if _range_overlay != null:
		_range_overlay.hide_overlay()


func deselect() -> void:
	_deselect()


func _update_range_overlay() -> void:
	if _range_overlay == null or _selected_wing_id.is_empty():
		return
	var data: Dictionary = GameState.get_air_wing(_selected_wing_id)
	if data.is_empty():
		_range_overlay.hide_overlay()
		return
	var ls: String = data.get("lifecycle_state", "")
	if ls == "idle" or ls == "refuel":
		_range_overlay.hide_overlay()
		return
	var wing_pos: Vector2 = _get_interpolated_wing_position(_selected_wing_id)
	if wing_pos == Vector2.INF:
		wing_pos = Vector2(float(data.get("position_lng", 0.0)), float(data.get("position_lat", 0.0)))
	var fuel: float = float(_wing_fuel.get(_selected_wing_id, float(data.get("fuel", 1.0))))
	var nation_color: Color = NATION_COLORS.get(data.get("nation_id", ""), NEUTRAL_COLOR)
	var decay_rate: float = float(data.get("fuel_decay_rate", 0.02))
	_range_overlay.set_fuel_decay_rate(decay_rate)
	_range_overlay.show_for_wing(wing_pos.x, wing_pos.y, fuel, nation_color)


func _on_air_wing_path(path_data: Dictionary) -> void:
	var wing_id: String = path_data.get("wing_id", "")
	var path_gen_id: String = path_data.get("path_gen_id", "")
	if wing_id.is_empty():
		return
	_wing_path_by_id[wing_id] = path_data.duplicate()
	if not path_gen_id.is_empty():
		if not _wing_path_generations_by_id.has(wing_id):
			_wing_path_generations_by_id[wing_id] = {}
		_wing_path_generations_by_id[wing_id][path_gen_id] = path_data.duplicate()
		var last_synced: String = str(_last_synced_gen_id.get(wing_id, ""))
		if path_gen_id != last_synced:
			var icon = _icons.get(wing_id)
			if icon and is_instance_valid(icon):
				_wing_reconcile_from[wing_id] = icon.position
				_wing_reconcile_ms[wing_id]   = 0.0
			_last_synced_gen_id[wing_id] = path_gen_id
			const MAX_PRE_ADVANCE_MS := 500.0
			var path_ts: float = float(path_data.get("timestamp_ms", 0.0))
			var pre_advance: float = 0.0
			if path_ts > 0.0:
				var now_ms: float = Time.get_unix_time_from_system() * 1000.0
				pre_advance = clampf(now_ms - path_ts, 0.0, MAX_PRE_ADVANCE_MS)
			_wing_total_elapsed_ms[wing_id] = pre_advance
	if wing_id == _selected_wing_id:
		_update_ghost()


func _update_icon_visibility(wing_id: String) -> void:
	var icon = _icons.get(wing_id)
	if not is_instance_valid(icon):
		return
	var data: Dictionary = GameState.get_air_wing(wing_id)
	if data.is_empty():
		icon.visible = false
		return
	var airborne: bool = data.get("lifecycle_state", "") != "idle" and data.get("lifecycle_state", "") != "refuel"
	var is_own: bool = data.get("nation_id", "") == GameState.get_my_nation_id()
	if is_own:
		icon.visible = true
	else:
		icon.visible = airborne and bool(_detected_wings.get(wing_id, data.get("is_detected", false)))


func _on_air_wing_detected(wing_id: String) -> void:
	_detected_wings[wing_id] = true
	_update_icon_visibility(wing_id)


func _on_air_wing_detection_lost(wing_id: String) -> void:
	_detected_wings[wing_id] = false
	_update_icon_visibility(wing_id)


func _on_air_combat_started(data: Dictionary) -> void:
	var a: String = data.get("wing_a_id", "")
	var b: String = data.get("wing_b_id", "")
	if a.is_empty() or b.is_empty():
		return
	_engaged_pairs[a] = b
	_engaged_pairs[b] = a
	var parts := PackedStringArray([a, b])
	parts.sort()
	var key := ",".join(parts)
	if not _engagement_lines.has(key) and _icon_layer != null:
		var line := Line2D.new()
		line.default_color = Color(1.0, 0.2, 0.2, 0.7)
		line.width = 1.5
		line.add_point(Vector2.ZERO)
		line.add_point(Vector2.ZERO)
		_icon_layer.add_child(line)
		_engagement_lines[key] = line


func _on_air_combat_ended(data: Dictionary) -> void:
	var a: String = data.get("wing_a_id", "")
	var b: String = data.get("wing_b_id", "")
	_engaged_pairs.erase(a)
	_engaged_pairs.erase(b)
	var parts := PackedStringArray([a, b])
	parts.sort()
	var key := ",".join(parts)
	if _engagement_lines.has(key):
		(_engagement_lines[key] as Line2D).queue_free()
		_engagement_lines.erase(key)

	var icon_a = _icons.get(a)
	var icon_b = _icons.get(b)
	if icon_a != null and icon_b != null and _icon_layer != null:
		var wing_a_data: Dictionary = GameState.get_air_wing(a)
		var wing_b_data: Dictionary = GameState.get_air_wing(b)
		var nation_a: String = data.get("wing_a_nation_id", wing_a_data.get("nation_id", ""))
		var nation_b: String = data.get("wing_b_nation_id", wing_b_data.get("nation_id", ""))
		var mid_lng: float = (float(wing_a_data.get("position_lng", 0.0))
				+ float(wing_b_data.get("position_lng", 0.0))) / 2.0
		var mid_lat: float = (float(wing_a_data.get("position_lat", 0.0))
				+ float(wing_b_data.get("position_lat", 0.0))) / 2.0
		var bucket: String = _bucket_key(mid_lng, mid_lat)
		var _pk := PackedStringArray([a, b])
		_pk.sort()
		var _pair_key := ",".join(_pk)
		if _air_combat_indicators.has(bucket) and is_instance_valid(_air_combat_indicators[bucket]):
			if _air_combat_indicators[bucket].has_pair_entry(_pair_key):
				return
			_air_combat_indicators[bucket].add_combat(data)
		else:
			var slot: int = _bucket_slot_counts.get(bucket, 0)
			var banner: Node2D = preload("res://src/systems/air/air_combat_banner.gd").new()
			_icon_layer.add_child(banner)
			banner.setup_with_data(
				icon_a.position, icon_b.position,
				"air",
				GameState.get_my_nation_id(),
				nation_a,
				nation_b,
				data,
			)
			banner.position += Vector2(32.0 * slot, 0.0)
			_air_combat_indicators[bucket] = banner
			_bucket_slot_counts[bucket] = slot + 1
			banner.tree_exited.connect(func() -> void:
				_air_combat_indicators.erase(bucket)
				_bucket_slot_counts[bucket] = max(0, _bucket_slot_counts.get(bucket, 1) - 1)
			)


func _on_air_bombing_result(data: Dictionary) -> void:
	var province_id: String = data.get("province_id", "")
	if province_id.is_empty():
		return
	if not _bombing_indicators.has(province_id) or \
	   not is_instance_valid(_bombing_indicators[province_id]):
		var b_lng: float = 0.0
		var b_lat: float = 0.0
		var province_data: Dictionary = _map_loader.get_province_data(province_id)
		if province_data.is_empty():
			# Fallback for division bombing: use raw coordinates from payload
			b_lng = float(data.get("position_lng", 0.0))
			b_lat = float(data.get("position_lat", 0.0))
			if b_lng == 0.0 and b_lat == 0.0:
				return
		else:
			var city_pos: Array = province_data.get("city_position", [])
			if city_pos.size() < 2:
				return
			b_lng = float(city_pos[0])
			b_lat = float(city_pos[1])
		var key: String = _bucket_key(b_lng, b_lat)
		var slot: int = _bucket_slot_counts.get(key, 0)
		var indicator = BombingRunIndicatorScene.instantiate()
		_icon_layer.add_child(indicator)
		indicator.setup(_map_loader, province_id, b_lng, b_lat)
		indicator.position += Vector2(32.0 * slot, 0.0)
		_bombing_indicators[province_id] = indicator
		_bucket_slot_counts[key] = slot + 1
		indicator.tree_exited.connect(func() -> void:
			_bombing_indicators.erase(province_id)
			_bucket_slot_counts[key] = max(0, _bucket_slot_counts.get(key, 1) - 1)
		)
	for run in data.get("runs", []):
		_bombing_indicators[province_id].add_run(run)


func _on_province_aa_fired(data: Dictionary) -> void:
	var province_id: String = data.get("province_id", "")
	var pdata: Dictionary = _map_loader.get_province_data(province_id)
	if pdata.is_empty():
		return
	var city_pos: Array = pdata.get("city_position", [])
	if city_pos.size() < 2:
		return
	var screen_pos: Vector2 = _map_loader.project_lng_lat(
		float(city_pos[0]), float(city_pos[1]))
	_spawn_flak_burst(screen_pos)


func _spawn_flak_burst(pos: Vector2) -> void:
	var burst := Node2D.new()
	burst.position = pos
	_icon_layer.add_child(burst)
	var script := GDScript.new()
	script.source_code = """
extends Node2D
var _alpha := 1.0
func _draw():
	draw_circle(Vector2.ZERO, 14.0, Color(1.0, 0.75, 0.2, _alpha))
	draw_arc(Vector2.ZERO, 14.0, 0.0, TAU, 20, Color(0.9, 0.4, 0.1, _alpha), 2.0)
"""
	burst.set_script(script)
	var tween := create_tween()
	tween.tween_method(func(a: float):
		if is_instance_valid(burst):
			burst.set("_alpha", a)
			burst.queue_redraw()
	, 1.0, 0.0, 0.6)
	tween.tween_callback(burst.queue_free)


func _on_air_bombing_province_result(data: Dictionary) -> void:
	var province_id: String = data.get("province_id", "")
	var pdata: Dictionary = _map_loader.get_province_data(province_id)
	if pdata.is_empty():
		return
	var city_pos: Array = pdata.get("city_position", [])
	if city_pos.size() < 2:
		return
	var lng := float(city_pos[0])
	var lat := float(city_pos[1])
	var screen_pos: Vector2 = _map_loader.project_lng_lat(lng, lat)
	var key := _bucket_key(lng, lat)

	if not _strategic_bombing_banners.has(key) or \
	   not is_instance_valid(_strategic_bombing_banners[key]):
		var banner: Node2D = preload("res://src/systems/air/air_combat_banner.gd").new()
		_icon_layer.add_child(banner)
		banner.setup_with_data(
			screen_pos, screen_pos,
			"strategic",
			GameState.get_my_nation_id(),
			data.get("attacker_nation_id", ""),
			data.get("defender_nation_id", ""),
			data,
		)
		banner.tree_exited.connect(func(): _strategic_bombing_banners.erase(key))
		_strategic_bombing_banners[key] = banner
	else:
		_strategic_bombing_banners[key].add_combat(data)


func _sync_detection_overlay(wing_id: String) -> void:
	pass  # Deferred: detection overlay follows icon during TRANSIT


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


## Sends an air command through the shared command queue.
## Parameters:
## - type: Colyseus command name.
## - payload: command payload dictionary.
## Returns: nothing.
func _can_intercept(aircraft_type: String) -> bool:
	return aircraft_type in ["fighter", "heavy_fighter", "cas_plane", "dive_bomber"]


func _can_ground_attack(aircraft_type: String, has_strafing: bool) -> bool:
	if aircraft_type in ["cas_plane", "dive_bomber", "tactical_bomber"]:
		return true
	if aircraft_type == "fighter" and has_strafing:
		return true
	return false


func _can_strategic_bomb(aircraft_type: String) -> bool:
	return aircraft_type in ["strategic_bomber", "tactical_bomber"]


func _get_wing_screen_pos(wing_id: String) -> Vector2:
	var icon = _icons.get(wing_id)
	if icon and is_instance_valid(icon):
		return icon.position
	return Vector2.INF


func _find_nearest_enemy_wing_at(screen_pos: Vector2, my_nation: String) -> String:
	var best_id: String = ""
	var best_dist: float = HIT_THRESHOLD_PX
	for wing_id: String in GameState.air_wings:
		var wing_data: Dictionary = GameState.get_air_wing(wing_id)
		if wing_data.is_empty() or wing_data.get("nation_id", "") == my_nation:
			continue
		var icon = _icons.get(wing_id)
		if not icon or not is_instance_valid(icon) or not icon.visible:
			continue
		var dist: float = icon.position.distance_to(screen_pos)
		if dist < best_dist:
			best_dist = dist
			best_id = wing_id
	return best_id


func _is_near_engagement_banner(screen_pos: Vector2) -> bool:
	if _military_system == null:
		return false
	var banners: Dictionary = _military_system.get_banners()
	for eng_key: String in banners:
		var banner: Node2D = banners[eng_key]
		if not is_instance_valid(banner):
			continue
		if banner.position.distance_to(screen_pos) <= 20.0:
			return true
	return false


func _handle_existing_right_click(event: InputEvent, world_pos: Vector2) -> void:
	var mouse_button: InputEventMouseButton = event as InputEventMouseButton
	if mouse_button.shift_pressed:
		return  # shift-right-click handled upstream
	if _pending_milestones.is_empty():
		var city_province_id: String = ""
		if _map_loader != null:
			city_province_id = _resolve_province_at_screen_pos(world_pos)
		if not city_province_id.is_empty():
			if _is_friendly_province(city_province_id):
				_submit_redeploy_order(city_province_id)
			else:
				_submit_transit_order(world_pos)
			return
		_submit_transit_order(world_pos)
		return
	var last_point: Vector2 = _get_last_pending_point()
	if last_point != Vector2.INF and world_pos.distance_to(last_point) <= HIT_THRESHOLD_PX * 2.0:
		_remove_last_pending_milestone()


func _submit_air_command(type: String, payload: Dictionary) -> void:
	CommandQueue.submit(type, payload)


## Sends a transit order to the server using the clicked map position.
## Parameters:
## - world_pos: clicked world-space position.
## Returns: nothing.
func _submit_transit_order(world_pos: Vector2) -> void:
	if _map_loader == null:
		return
	var lng_lat: Vector2 = _map_loader.world_to_lng_lat(world_pos)
	_submit_air_command("SUBMIT_AIR_WING_MOVE", {
		"wing_id": _selected_wing_id,
		"target_lng": lng_lat.x,
		"target_lat": lng_lat.y,
	})


## Sends a redeploy order to the server for a friendly province.
## Parameters:
## - province_id: selected friendly province id.
## Returns: nothing.
func _submit_redeploy_order(province_id: String) -> void:
	_submit_air_command("REDEPLOY_WING", {
		"wing_id": _selected_wing_id,
		"new_province_id": province_id,
	})


## Returns true when the province belongs to the current player nation or an ally.
## Parameters:
## - province_id: province to inspect.
## Returns: true if the province is owned by own nation or an allied nation.
func _is_friendly_province(province_id: String) -> bool:
	if province_id.is_empty():
		return false
	var province: Dictionary = GameState.get_province(province_id)
	if province.is_empty():
		return false
	var my_nation_id: String = GameState.get_my_nation_id()
	if my_nation_id.is_empty():
		return false
	var owner_id: String = province.get("owner_id", "")
	if owner_id == my_nation_id:
		return true
	var stance_ab: String = GameState.get_relation(my_nation_id, owner_id).get("stance", "")
	var stance_ba: String = GameState.get_relation(owner_id, my_nation_id).get("stance", "")
	return stance_ab == "alliance" or stance_ba == "alliance"


## Returns the province id nearest to a screen-space position, or empty string.
## Parameters:
## - screen_pos: screen-space click position.
## Returns: province_id if within 30px of a city marker, else empty string.
func _resolve_province_at_screen_pos(screen_pos: Vector2) -> String:
	const PROXIMITY_PX := 15.0  # city dot radius is 8px
	var best_id: String = ""
	var best_dist: float = PROXIMITY_PX
	for pid: String in _map_loader.get_all_province_ids():
		var city_pos: Vector2 = _map_loader.get_province_focus_position(pid)
		var dist: float = screen_pos.distance_to(city_pos)
		if dist < best_dist:
			best_dist = dist
			best_id = pid
	return best_id


func cleanup() -> void:
	if EventBus.air_wing_added.is_connected(_on_air_wing_added):
		EventBus.air_wing_added.disconnect(_on_air_wing_added)
	if EventBus.air_wing_updated.is_connected(_on_air_wing_updated):
		EventBus.air_wing_updated.disconnect(_on_air_wing_updated)
	if EventBus.air_wing_removed.is_connected(_on_air_wing_removed):
		EventBus.air_wing_removed.disconnect(_on_air_wing_removed)
	if EventBus.air_wing_vanishing.is_connected(_on_air_wing_vanishing):
		EventBus.air_wing_vanishing.disconnect(_on_air_wing_vanishing)
	if EventBus.air_wing_path.is_connected(_on_air_wing_path):
		EventBus.air_wing_path.disconnect(_on_air_wing_path)
	if EventBus.air_wing_detected.is_connected(_on_air_wing_detected):
		EventBus.air_wing_detected.disconnect(_on_air_wing_detected)
	if EventBus.air_wing_detection_lost.is_connected(_on_air_wing_detection_lost):
		EventBus.air_wing_detection_lost.disconnect(_on_air_wing_detection_lost)
	if EventBus.air_bombing_result.is_connected(_on_air_bombing_result):
		EventBus.air_bombing_result.disconnect(_on_air_bombing_result)
	if EventBus.province_aa_fired.is_connected(_on_province_aa_fired):
		EventBus.province_aa_fired.disconnect(_on_province_aa_fired)
	if EventBus.air_bombing_province_result.is_connected(_on_air_bombing_province_result):
		EventBus.air_bombing_province_result.disconnect(_on_air_bombing_province_result)
	if _pending_route_overlay != null:
		_pending_route_overlay.free()
		_pending_route_overlay = null
	_wing_path_generations_by_id.clear()
	_wing_total_elapsed_ms.clear()
	_detected_wings.clear()
	_engaged_pairs.clear()
	for line: Variant in _engagement_lines.values():
		if is_instance_valid(line):
			(line as Line2D).queue_free()
	_engagement_lines.clear()
	for indicator in _bombing_indicators.values():
		if is_instance_valid(indicator):
			indicator.queue_free()
	_bombing_indicators.clear()
	for banner in _air_combat_indicators.values():
		if is_instance_valid(banner):
			banner.queue_free()
	for banner in _strategic_bombing_banners.values():
		if is_instance_valid(banner):
			banner.queue_free()
	_air_combat_indicators.clear()
	_strategic_bombing_banners.clear()
	_bucket_slot_counts.clear()


func _bucket_key(lng: float, lat: float) -> String:
	return "%d_%d" % [int(lng / 0.5), int(lat / 0.5)]


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

	var projected_position: Vector2 = _get_interpolated_wing_position(wing_id)
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


func _get_interpolated_wing_position(wing_id: String) -> Vector2:
	var path_data: Dictionary = _wing_path_by_id.get(wing_id, {})
	if path_data.is_empty():
		return Vector2.INF
	var total_ms: int = int(_wing_total_elapsed_ms.get(wing_id, 0.0))
	return DubinsInterpolator.evaluate_position(path_data, total_ms)


func _get_selected_wing_color() -> Color:
	if _selected_wing_id.is_empty():
		return NEUTRAL_COLOR
	var data: Dictionary = GameState.get_air_wing(_selected_wing_id)
	if data.get("target_id", "") != "":
		return Color(1.0, 0.55, 0.1, 0.7)  # Amber — pursuit / following target
	return NATION_COLORS.get(data.get("nation_id", ""), NEUTRAL_COLOR)


func _get_selected_wing_path_points(wing_id: String) -> Array[Vector2]:
	var path_data: Dictionary = _wing_path_by_id.get(wing_id, {})
	if path_data.is_empty():
		return []
	var elapsed: float = float(_wing_total_elapsed_ms.get(wing_id, 0.0))
	var lnglat_pts: Array = DubinsInterpolator.get_remaining_endpoints(path_data, elapsed)
	var screen_pts: Array[Vector2] = []
	for pt in lnglat_pts:
		screen_pts.append(_map_loader.project_lng_lat(pt.x, pt.y))
	return screen_pts


func _get_preview_route_points() -> Array[Vector2]:
	if not _pending_chain.is_empty():
		return _get_pending_chain_positions()
	return _get_selected_wing_path_points(_selected_wing_id)


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
