extends Node
## Read-only client mirror of Colyseus server state.
## Updated exclusively by NetManager via _apply_server_delta().
## All other code reads from this — nothing else may write to it.

# ── Core session state ───────────────────────────────────────────────────────
var phase: String = ""
var map_id: String = ""
var game_speed: int = 1
var host_session_id: String = ""

# ── Lobby state (populated from LOBBY_STATE_UPDATE) ──────────────────────────
# nations: { nation_id → { player_id: String, is_ready: bool } }
var nations: Dictionary = {}
# players: { session_id → { user_id: String } }
var players: Dictionary = {}

# ── In-game state (populated from Phase 4+ events) ───────────────────────────
# provinces: { province_id → { owner_id: String, ... } }
var provinces: Dictionary = {}
# subprovinces: { subprovince_id → { province_id: String, owner_id: String } }
var subprovinces: Dictionary = {}
# divisions: { division_id → DivisionState dict (mirrors server DivisionState) }
var divisions: Dictionary = {}
# relations: { "from_id:to_id" → { stance: String } }
var relations: Dictionary = {}
# proposals: { proposal_id → { from_id, to_id, stance, resolved } }
var proposals: Dictionary = {}
# stacks: { stack_id → Array[division_id] ordered by stack_position }
var stacks: Dictionary = {}
# active_engagement_pairs: { engagement_id → { division_a: String, division_b: String } }
# Populated on COMBAT_STARTED, erased on COMBAT_ENDED. Used by military_system.gd to
# build combat-avoidance zones for pathfinding — see docs/PATHFINDING.md.
var active_engagement_pairs: Dictionary = {}
# air_wings: { wing_id → {wing_id, nation_id, aircraft_type, count, combat_readiness,
#   position_lng, position_lat, heading_deg, lifecycle_state, mission,
#   target_id, home_airbase_province_id, weapon_ready} }
var air_wings: Dictionary = {}
# air_wing_paths: { wing_id → AIR_WING_PATH payload } — cached so the hydration loop
# can replay paths that arrived before air_wing_system was set up (GAME_STARTED race).
var air_wing_paths: Dictionary = {}
# supply_routes: { division_id → last-received SupplyRoute dict }
var supply_routes: Dictionary = {}
# naval_contact_markers: { marker_id → {marker_id, nation_id, position_lng, position_lat, ...} }
var naval_contact_markers: Dictionary = {}
# resources: { resource_type → amount }, this player's own nation only
var resources: Dictionary = {}
# Branch B — net rate (+N/t or -N/t) per resource type, from RESOURCE_UPDATES' net_rates field.
var resource_net_rates: Dictionary = {}
var manpower_available: float = 0.0
var manpower_ceiling: float = 0.0
var chromium_available: bool = true
var science_points: float = 0.0
var convoy_capacity: float = 0.0
var oil_priority: String = "balanced"
# Branch B — Warehouse's per-resource storage ceiling, keyed same as `resources`.
var resource_storage_cap: Dictionary = {}
# Branch B — Industry Pool slider values (0-100), keyed by resource type + "construction_speed"
# + "unit_production_speed".
var industry_alloc: Dictionary = {}
# Branch B — true while this nation has at least one division with an oil-consuming unit
# actually being penalized this tick (RESOURCE_ECONOMY.md's "!" marker rule: only shown when
# the penalty is actively biting, never purely for low stock with no active penalty).
var oil_penalty_active: bool = false
# province_economy: { province_id → { "buildings": {...}, "resource_deposits": {...},
#   "construction_queue": [...] } } — off-schema, mirrors DivisionState.grid's precedent
var province_economy: Dictionary = {}
var marshalling_divisions: Dictionary = {}   # marshalling_id -> {template_id, home_province_id, aggregate_hp_pct, slots}
var reserve: Dictionary = {}                 # unit_type -> HP-equivalent amount
var reserve_cap: float = 0.0
var reserve_category_stats: Dictionary = {}  # category ("infantry"/"ordnance"/"tank"/"air") -> {production_rate, net_rate}
var nation_capitals: Dictionary = {}         # nation_id -> capital province_id, sent once at GAME_STARTED


# ── Session reset ─────────────────────────────────────────────────────────────

## Called exclusively by NetManager on disconnect — this autoload otherwise persists for the
## life of the process, so without this a new game session's air wing system (and anything
## else that hydrates from these dictionaries on scene load) would replay the PREVIOUS
## session's stale data until the first fresh server broadcast overwrote it.
func reset_session_state() -> void:
	phase = ""
	map_id = ""
	game_speed = 1
	host_session_id = ""
	nations.clear()
	players.clear()
	provinces.clear()
	subprovinces.clear()
	divisions.clear()
	relations.clear()
	proposals.clear()
	stacks.clear()
	air_wings.clear()
	air_wing_paths.clear()
	supply_routes.clear()
	naval_contact_markers.clear()
	resources.clear()
	province_economy.clear()


# ── Write gate ───────────────────────────────────────────────────────────────

## Called exclusively by NetManager when a LOBBY_STATE_UPDATE arrives.
## Updates local state and emits EventBus signals for changed fields.
func _apply_server_delta(delta: Dictionary) -> void:
	var new_phase: String = delta.get("phase", phase)
	if new_phase != phase:
		phase = new_phase
		EventBus.phase_changed.emit(phase)

	host_session_id = delta.get("host_session_id", host_session_id)
	map_id = delta.get("map_id", map_id)
	game_speed = delta.get("game_speed", game_speed)

	# Overwrite lobby collections with the full snapshot from the server
	var lobby_changed := false
	if delta.has("nations"):
		nations = delta["nations"]
		lobby_changed = true
	if delta.has("players"):
		players = delta["players"]
		lobby_changed = true
	if lobby_changed:
		EventBus.lobby_state_updated.emit()


## Called by SessionManager when server sends DIVISIONS_SPAWNED.
func _apply_divisions_spawned(data: Dictionary) -> void:
	var shared_profile: String = data.get("shared_profile_json", "")
	for div_data: Dictionary in data.get("divisions", []):
		var div_id: String = div_data.get("division_id", "")
		if div_id.is_empty():
			continue
		var entry: Dictionary = div_data.duplicate()
		if not shared_profile.is_empty():
			entry["movement_profile_json"] = shared_profile
		divisions[div_id] = entry
		EventBus.division_added.emit(div_id)


## Called by SessionManager when server sends PROVINCE_ECONOMY_INIT (once, at game start).
func _apply_province_economy_init(data: Dictionary) -> void:
	var provinces_data: Dictionary = data.get("provinces", {})
	for pid: String in provinces_data:
		province_economy[pid] = provinces_data[pid]
	EventBus.province_economy_updated.emit("")  # empty id = bulk update, no specific province


## Called by SessionManager when server sends BUILDING_UPDATES.
func _apply_building_updates(data: Dictionary) -> void:
	var pid: String = data.get("province_id", "")
	if pid.is_empty():
		return
	if not province_economy.has(pid):
		province_economy[pid] = {}
	province_economy[pid]["buildings"] = data.get("buildings", {})
	province_economy[pid]["construction_queue"] = data.get("construction_queue", [])
	EventBus.province_economy_updated.emit(pid)


## Called by SessionManager when server sends RESOURCE_UPDATES.
func _apply_resource_updates(data: Dictionary) -> void:
	for key: String in data.get("resources", {}):
		resources[key] = data["resources"][key]
	resource_net_rates = data.get("net_rates", {})
	manpower_available = data.get("manpower_available", manpower_available)
	manpower_ceiling = data.get("manpower_ceiling", manpower_ceiling)
	chromium_available = data.get("chromium_available", chromium_available)
	science_points = data.get("science_points", science_points)
	convoy_capacity = data.get("convoy_capacity", convoy_capacity)
	oil_priority = data.get("oil_priority", oil_priority)
	oil_penalty_active = data.get("oil_penalty_active", false)
	resource_storage_cap = data.get("resource_storage_cap", resource_storage_cap)
	industry_alloc = data.get("industry_alloc", industry_alloc)
	EventBus.resources_updated.emit()


func _apply_marshalling_updates(data: Dictionary) -> void:
	marshalling_divisions.clear()
	for entry: Dictionary in data.get("marshalling", []):
		var mid: String = entry.get("marshalling_id", "")
		if mid.is_empty():
			continue
		marshalling_divisions[mid] = entry
	EventBus.marshalling_updated.emit()


func _apply_reserve_updates(data: Dictionary) -> void:
	reserve = data.get("reserve", {})
	reserve_cap = float(data.get("reserve_cap", 0.0))
	reserve_category_stats = data.get("category_stats", {})
	EventBus.reserve_updated.emit()


func set_nation_capitals(capitals: Dictionary) -> void:
	nation_capitals = capitals


## Called by SessionManager when server sends DIVISION_UPDATES.
func _apply_division_updates(data: Dictionary) -> void:
	for div_data: Dictionary in data.get("divisions", []):
		var div_id: String = div_data.get("division_id", "")
		if div_id.is_empty() or not divisions.has(div_id):
			continue
		var existing: Dictionary = divisions[div_id]
		for key: String in div_data:
			existing[key] = div_data[key]
		# Store reposition_order if present
		if "reposition_order" in div_data:
			existing["reposition_order"] = div_data["reposition_order"]
		# Clear meeting battle flag when combat ends
		var combat_state: String = div_data.get("combat_state", "")
		if combat_state in ["idle", "retreating"]:
			existing.erase("is_meeting_battle")
		EventBus.division_updated.emit(div_id)


func _apply_division_appeared(data: Dictionary) -> void:
	var div_id: String = data.get("division_id", "")
	if div_id.is_empty():
		return
	if divisions.has(div_id):
		for key: String in data:
			divisions[div_id][key] = data[key]
		EventBus.division_updated.emit(div_id)
		return
	divisions[div_id] = data.duplicate()
	EventBus.division_appeared.emit(div_id)


## Called by SessionManager when server sends UNIT_DESTROYED.
## Sets combat_state to "destroyed" immediately, then removes the division
## from GameState after a 1.5s delay so the client can display a brief
## destroyed animation before cleanup.
func _apply_unit_destroyed(data: Dictionary) -> void:
	var div_id: String = data.get("division_id", "")
	var nation_id: String = data.get("nation_id", "")
	if div_id.is_empty():
		return
	if divisions.has(div_id):
		divisions[div_id]["combat_state"] = "destroyed"
	EventBus.unit_destroyed.emit(div_id, nation_id)
	EventBus.division_updated.emit(div_id)
	# Show destroyed icon briefly then clean up
	get_tree().create_timer(1.5).timeout.connect(func():
		divisions.erase(div_id)
		EventBus.division_removed.emit(div_id)
	)


## Called by SessionManager when server sends PROVINCE_INIT (once at game start).
func _apply_province_init(data: Dictionary) -> void:
	for pid: String in data.get("provinces", {}):
		if not provinces.has(pid):
			provinces[pid] = {}
		provinces[pid]["owner_id"] = data["provinces"][pid]


## Called by SessionManager when server sends PROVINCE_CAPTURED.
func _apply_province_captured(data: Dictionary) -> void:
	var province_id: String = data.get("province_id", "")
	var new_owner: String   = data.get("new_owner_id", "")
	if province_id.is_empty():
		return
	if not provinces.has(province_id):
		provinces[province_id] = {}
	provinces[province_id]["owner_id"]  = new_owner
	provinces[province_id]["nation_id"] = new_owner
	EventBus.province_captured.emit(province_id, new_owner)


## Called by SessionManager when server sends SUPPLY_HUB_COMPLETED.
func _apply_supply_hub_completed(data: Dictionary) -> void:
	var province_id: String = data.get("province_id", "")
	if province_id.is_empty():
		return
	if not provinces.has(province_id):
		provinces[province_id] = {}
	provinces[province_id]["has_supply_hub"] = true
	EventBus.supply_hub_completed.emit(province_id)


## Called by SessionManager when server sends SUBPROVINCE_INIT (once at game start).
func _apply_subprovince_init(data: Dictionary) -> void:
	for sp_id: String in data.get("subprovinces", {}):
		if not subprovinces.has(sp_id):
			subprovinces[sp_id] = {}
		subprovinces[sp_id]["owner_id"] = data["subprovinces"][sp_id]


## Called by SessionManager when server sends SUBPROVINCE_CAPTURED.
func _apply_subprovince_captured(data: Dictionary) -> void:
	var subprovince_id: String = data.get("subprovince_id", "")
	var province_id: String = data.get("province_id", "")
	var new_owner: String = data.get("new_owner_id", "")
	if subprovince_id.is_empty():
		return
	if not subprovinces.has(subprovince_id):
		subprovinces[subprovince_id] = {}
	subprovinces[subprovince_id]["province_id"] = province_id
	subprovinces[subprovince_id]["owner_id"] = new_owner
	EventBus.subprovince_captured.emit(subprovince_id, province_id, new_owner)


## Called by SessionManager when server sends PROVINCE_CONTEST_UPDATE.
func _apply_province_contest_updated(data: Dictionary) -> void:
	var province_id: String = data.get("province_id", "")
	var contested: bool = data.get("contested", false)
	if province_id.is_empty():
		return
	EventBus.province_contest_updated.emit(province_id, contested)


## Called by SessionManager when server sends COMBAT_STARTED.
## Stores is_meeting_battle on the involved divisions for icon rendering, and records
## the pair under its engagement_id for pathfinding's combat-avoidance zones.
func _apply_combat_started(data: Dictionary) -> void:
	var is_meeting: bool = data.get("is_meeting_battle", false)
	var division_a: String = data.get("division_a", "")
	var division_b: String = data.get("division_b", "")
	for div_id: String in [division_a, division_b]:
		if divisions.has(div_id):
			divisions[div_id]["is_meeting_battle"] = is_meeting
			EventBus.division_updated.emit(div_id)
	var engagement_id: String = data.get("engagement_id", "")
	if not engagement_id.is_empty():
		active_engagement_pairs[engagement_id] = {"division_a": division_a, "division_b": division_b}


## Called by SessionManager when server sends STACK_FORMED.
func _apply_stack_formed(data: Dictionary) -> void:
	var sid: String = data.get("stack_id", "")
	var divs: Array = data.get("divisions", [])
	if sid.is_empty():
		return
	stacks[sid] = divs.duplicate()
	EventBus.stack_formed.emit(sid, divs)


## Called by SessionManager when server sends STACK_ROTATION.
func _apply_stack_rotation(data: Dictionary) -> void:
	var sid: String = data.get("stack_id", "")
	var rotated: String = data.get("rotated_back", "")
	var new_front: String = data.get("new_front", "")
	if sid.is_empty():
		return
	if stacks.has(sid):
		stacks[sid].erase(rotated)
		stacks[sid].append(rotated)
	EventBus.stack_rotated.emit(sid, rotated, new_front)


## Called by SessionManager when server sends STACK_DISSOLVED.
func _apply_stack_dissolved(data: Dictionary) -> void:
	var sid: String = data.get("stack_id", "")
	stacks.erase(sid)
	EventBus.stack_dissolved.emit(sid)


## Called by SessionManager when server sends RELATIONS_UPDATED.
func _apply_relations_updated(data: Dictionary) -> void:
	var raw: Dictionary = data.get("relations", {})
	var previous_relations: Dictionary = relations.duplicate(true)
	relations.clear()
	for key: String in raw:
		relations[key] = {"stance": str(raw[key])}
		var previous_entry: Dictionary = previous_relations.get(key, {})
		if str(previous_entry.get("stance", "")) != str(raw[key]):
			var parts: PackedStringArray = key.split(":")
			if parts.size() == 2:
				EventBus.relation_changed.emit(parts[0], parts[1])
	for previous_key: String in previous_relations:
		if not relations.has(previous_key):
			var previous_parts: PackedStringArray = previous_key.split(":")
			if previous_parts.size() == 2:
				EventBus.relation_changed.emit(previous_parts[0], previous_parts[1])


# ── Getters ──────────────────────────────────────────────────────────────────

func get_phase() -> String:
	return phase

func get_game_speed() -> int:
	return game_speed

func get_province(province_id: String) -> Dictionary:
	return provinces.get(province_id, {})

func get_division(division_id: String) -> Dictionary:
	return divisions.get(division_id, {})

func get_my_nation_divisions() -> Array:
	var nation_id := get_my_nation_id()
	var result: Array = []
	for div_id: String in divisions:
		if divisions[div_id].get("nation_id", "") == nation_id:
			result.append(div_id)
	return result

func get_divisions_for_nation(nation_id: String) -> Array:
	var result: Array = []
	for div_id: String in divisions:
		if divisions[div_id].get("nation_id", "") == nation_id:
			result.append(div_id)
	return result

## Returns the player dict for the given user_id (searched across session map).
func get_player(user_id: String) -> Dictionary:
	for _session_id: String in players:
		var p: Dictionary = players[_session_id]
		if p.get("user_id", "") == user_id:
			return p
	return {}

func get_relation(from_id: String, to_id: String) -> Dictionary:
	return relations.get(from_id + ":" + to_id, {})

func get_my_player() -> Dictionary:
	return get_player(AuthManager.user_id)

func get_my_provinces() -> Array:
	var result: Array = []
	for pid: String in provinces:
		if provinces[pid].get("owner_id", "") == AuthManager.user_id:
			result.append(pid)
	return result

func get_my_units() -> Array:
	return get_my_nation_divisions()

## Returns the nation_id this player has selected in the lobby, or "".
func get_my_nation_id() -> String:
	for nation_id: String in nations:
		var slot: Dictionary = nations[nation_id]
		if slot.get("player_id", "") == AuthManager.user_id:
			return nation_id
	return ""

func is_host() -> bool:
	# Match host_session_id against the session the local client holds in NetManager
	return NetManager.session_id == host_session_id

# ── Air wing accessors ────────────────────────────────────────────────────────

func get_air_wing(wing_id: String) -> Dictionary:
	return air_wings.get(wing_id, {})

func get_air_wings_for_nation(nation_id: String) -> Array:
	var result: Array = []
	for w in air_wings.values():
		if w.get("nation_id", "") == nation_id:
			result.append(w)
	return result

func _apply_air_wing_updates(data: Dictionary) -> void:
	for wing_data in data.get("wings", []):
		var id: String = wing_data.get("wing_id", "")
		if id.is_empty():
			continue
		var is_new: bool = not air_wings.has(id)
		air_wings[id] = wing_data
		if is_new:
			EventBus.air_wing_added.emit(id)
		else:
			EventBus.air_wing_updated.emit(id)

func _apply_air_wing_path(data: Dictionary) -> void:
	var id: String = data.get("wing_id", "")
	if id.is_empty():
		return
	air_wing_paths[id] = data

## Stores the latest server-authoritative supply route for one division and notifies
## listeners. GameState never recomputes route/supply data — this is a straight cache
## write of what the server sent.
func _apply_supply_route_update(data: Dictionary) -> void:
	var division_id: String = data.get("divisionId", "")
	supply_routes[division_id] = data
	EventBus.supply_route_updated.emit(division_id, data)

func _apply_air_wing_destroyed(data: Dictionary) -> void:
	var id: String = data.get("wing_id", "")
	if id.is_empty() or not air_wings.has(id):
		return
	air_wings.erase(id)
	EventBus.air_wing_removed.emit(id)

func _apply_naval_contact_updates(data: Dictionary) -> void:
	for marker in data.get("markers", []):
		var mid: String = marker.get("marker_id", "")
		if mid.is_empty():
			continue
		naval_contact_markers[mid] = marker
		EventBus.naval_contact_marker_added.emit(marker)
