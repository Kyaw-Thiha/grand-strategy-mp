extends Node
## Manages the WebSocket connection to the Colyseus game server.
## Call connect_to_room() after AuthManager emits logged_in.

signal room_joined(session_id: String, room_id: String)
signal room_error(message: String)
signal disconnected()

var COLYSEUS_HTTP_URL: String:
	get: return Config.COLYSEUS_URL.replace("ws://", "http://").replace("wss://", "https://")
var COLYSEUS_WS_URL: String:
	get: return Config.COLYSEUS_URL
const ROOM_NAME := "game_room"

var session_id: String = ""
var room_id: String = ""

var _socket := WebSocketPeer.new()
var _connected := false


func connect_to_room() -> void:
	if not AuthManager.is_logged_in():
		room_error.emit("Not logged in")
		return

	# Step 1: matchmake via Colyseus HTTP endpoint
	var http := HTTPRequest.new()
	add_child(http)

	var headers := ["Content-Type: application/json"]
	http.request(
		COLYSEUS_HTTP_URL + "/matchmake/joinOrCreate/" + ROOM_NAME,
		headers,
		HTTPClient.METHOD_POST,
		JSON.stringify({"token": APIClient.jwt})
	)

	var result: Array = await http.request_completed
	http.queue_free()

	if result[1] != 200:
		room_error.emit("Matchmaking failed: " + str(result[1]))
		return

	var response: Dictionary = JSON.parse_string(result[3].get_string_from_utf8())
	session_id = response.get("sessionId", "")
	room_id = response.get("roomId", "")

	# Step 2: open WebSocket to the reserved room
	var ws_url := COLYSEUS_WS_URL + "/" + room_id + "?sessionId=" + session_id
	_socket.connect_to_url(ws_url)
	_connected = true
	set_process(true)

	room_joined.emit(session_id, room_id)


func disconnect_from_room() -> void:
	if _connected:
		_socket.close()
		_connected = false
		disconnected.emit()


func _ready() -> void:
	set_process(false)


func _process(_delta: float) -> void:
	_socket.poll()
	match _socket.get_ready_state():
		WebSocketPeer.STATE_CLOSED:
			_connected = false
			set_process(false)
			disconnected.emit()
