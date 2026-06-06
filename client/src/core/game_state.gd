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
# relations: { "from_id:to_id" → { stance: String } }
var relations: Dictionary = {}
# proposals: { proposal_id → { from_id, to_id, stance, resolved } }
var proposals: Dictionary = {}


# ── Write gate ───────────────────────────────────────────────────────────────

## Called exclusively by NetManager when a LOBBY_STATE_UPDATE arrives.
## Updates local state and emits EventBus signals for changed fields.
func _apply_server_delta(delta: Dictionary) -> void:
	var new_phase: String = delta.get("phase", phase)
	if new_phase != phase:
		phase = new_phase
		EventBus.phase_changed.emit(phase)

	host_session_id = delta.get("host_session_id", host_session_id)
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
	for div_data: Dictionary in data.get("divisions", []):
		var div_id: String = div_data.get("division_id", "")
		if div_id.is_empty():
			continue
		divisions[div_id] = div_data.duplicate()
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
		EventBus.division_updated.emit(div_id)


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
