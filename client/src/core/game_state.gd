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
# divisions: { division_id → DivisionState dict (mirrors server DivisionState) }
var divisions: Dictionary = {}
# frontline: { province_id → { nation_id: float share, ... } }
var frontline: Dictionary = {}
# relations: { "from_id:to_id" → { stance: String } }
var relations: Dictionary = {}
# proposals: { proposal_id → { from_id, to_id, stance, resolved } }
var proposals: Dictionary = {}
# stacks: { stack_id → Array[division_id] ordered by stack_position }
var stacks: Dictionary = {}
# air_wings: { wing_id → {wing_id, nation_id, aircraft_type, count, combat_readiness,
#   position_lng, position_lat, heading_deg, lifecycle_state, mission,
#   target_id, home_airbase_province_id, weapon_ready} }
var air_wings: Dictionary = {}
# air_wing_paths: { wing_id → AIR_WING_PATH payload } — cached so the hydration loop
# can replay paths that arrived before air_wing_system was set up (GAME_STARTED race).
var air_wing_paths: Dictionary = {}


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


## Called by SessionManager when server sends FRONTLINE_UPDATED.
func _apply_frontline_updated(data: Dictionary) -> void:
	var province_id: String = data.get("province_id", "")
	var shares: Dictionary = data.get("nation_shares", {})
	if province_id.is_empty():
		return
	frontline[province_id] = shares
	EventBus.frontline_updated.emit(province_id, shares)


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


## Called by SessionManager when server sends COMBAT_STARTED.
## Stores is_meeting_battle on the involved divisions for icon rendering.
func _apply_combat_started(data: Dictionary) -> void:
	var is_meeting: bool = data.get("is_meeting_battle", false)
	for div_id: String in [data.get("division_a", ""), data.get("division_b", "")]:
		if divisions.has(div_id):
			divisions[div_id]["is_meeting_battle"] = is_meeting
			EventBus.division_updated.emit(div_id)


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

func _apply_air_wing_destroyed(data: Dictionary) -> void:
	var id: String = data.get("wing_id", "")
	if id.is_empty() or not air_wings.has(id):
		return
	air_wings.erase(id)
	EventBus.air_wing_removed.emit(id)
