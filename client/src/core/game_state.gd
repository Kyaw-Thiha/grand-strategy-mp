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
# units: { unit_id → { owner_id: String, province_id: String } }
var units: Dictionary = {}
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


# ── Getters ──────────────────────────────────────────────────────────────────

func get_phase() -> String:
	return phase

func get_game_speed() -> int:
	return game_speed

func get_province(province_id: String) -> Dictionary:
	return provinces.get(province_id, {})

func get_unit(unit_id: String) -> Dictionary:
	return units.get(unit_id, {})

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
	var result: Array = []
	for uid: String in units:
		if units[uid].get("owner_id", "") == AuthManager.user_id:
			result.append(uid)
	return result

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
