extends Node
## Handles lobby lifecycle: create, join, nation selection, and ready state.
## All writes go through CommandQueue. Room connection goes through NetManager.

signal lobby_created(join_code: String, room_id: String)
signal lobby_joined(room_id: String)
signal lobby_join_failed(reason: String)
signal nation_selected(nation_id: String)
signal all_players_ready()

var _current_join_code: String = ""


## Creates a new lobby. Requires has_host_pass in the JWT.
## Flow: POST /lobby/create → NetManager.create_and_join_room() → POST /lobby/activate
func create_lobby() -> void:
	var result: Dictionary = await APIClient.post("/lobby/create", {})
	if result["code"] != 200:
		lobby_join_failed.emit(result["data"].get("error", "Failed to create lobby"))
		return

	_current_join_code = result["data"].get("join_code", "")
	var room_id: String = await NetManager.create_and_join_room()
	if room_id == "":
		lobby_join_failed.emit("Failed to connect to game server")
		return

	# Activate: link this room_id to the pending join code
	await APIClient.post("/lobby/activate", {
		"join_code": _current_join_code,
		"room_id": room_id
	})

	lobby_created.emit(_current_join_code, room_id)


## Joins an existing lobby by its 6-character join code.
## Flow: GET /lobby/resolve/:code → NetManager.join_room_by_id()
func join_by_code(code: String) -> void:
	_current_join_code = code
	var result: Dictionary = await APIClient.get_req("/lobby/resolve/" + code)
	if result["code"] != 200 or not result["data"].has("room_id"):
		lobby_join_failed.emit(result["data"].get("error", "Invalid join code"))
		return

	var room_id: String = result["data"].get("room_id", "")
	var joined_room_id: String = await NetManager.join_room_by_id(room_id)
	if joined_room_id == "":
		lobby_join_failed.emit("Failed to connect to room")
		return

	lobby_joined.emit(joined_room_id)


## Joins the first available public lobby.
func join_public_game() -> void:
	var result: Dictionary = await APIClient.get_req("/lobby/public")
	if result["code"] != 200:
		lobby_join_failed.emit("Failed to fetch public lobbies")
		return
	var lobby_list: Variant = result["data"]
	if not lobby_list is Array or (lobby_list as Array).is_empty():
		lobby_join_failed.emit("No public games available")
		return

	var first: Dictionary = (lobby_list as Array)[0]
	var room_id: String = first.get("room_id", "")
	if room_id == "":
		lobby_join_failed.emit("Invalid public lobby data")
		return

	var joined_room_id: String = await NetManager.join_room_by_id(room_id)
	if joined_room_id == "":
		lobby_join_failed.emit("Failed to connect to room")
		return

	lobby_joined.emit(joined_room_id)


func select_nation(nation_id: String) -> void:
	CommandQueue.submit("SELECT_NATION", {"nation_id": nation_id})
	nation_selected.emit(nation_id)


func deselect_nation() -> void:
	CommandQueue.submit("DESELECT_NATION", {})


func set_ready(ready: bool) -> void:
	CommandQueue.submit("SET_READY", {"ready": ready})


func start_game() -> void:
	CommandQueue.submit("START_GAME", {})


func vote_speed(speed: int) -> void:
	CommandQueue.submit("VOTE_SPEED", {"speed": speed})


func get_join_code() -> String:
	return _current_join_code
