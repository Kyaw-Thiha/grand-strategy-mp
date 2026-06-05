extends Node
## Owns the WebSocket connection to the Colyseus game server.
## Decodes incoming Colyseus protocol messages and routes them to GameState and EventBus.
## All outgoing commands go through send_command(), called exclusively by CommandQueue.

signal room_joined(session_id: String, room_id: String)
signal room_error(message: String)
signal disconnected()
signal server_event_received(type: String, data: Dictionary)

const ROOM_NAME := "game_room"

# Colyseus protocol byte codes
const PROTO_JOIN_ROOM := 10
const PROTO_ERROR     := 11
const PROTO_LEAVE     := 12
const PROTO_ROOM_DATA := 13
# 14 = ROOM_STATE, 15 = ROOM_STATE_PATCH — binary schema, handled in Phase 4+

var session_id: String = ""
var room_id: String = ""

var _socket := WebSocketPeer.new()
var _connected := false


func _ready() -> void:
	set_process(false)


# ── Public API ───────────────────────────────────────────────────────────────

## Creates a new Colyseus room and connects to it.
## Emits room_joined when Colyseus confirms the connection.
## Returns the room_id, or "" on failure.
func create_and_join_room() -> String:
	var response: Dictionary = await _matchmake("/matchmake/create/" + ROOM_NAME)
	if response.is_empty():
		return ""
	return await _open_websocket(response)


## Joins an existing Colyseus room by its room_id.
## Emits room_joined when Colyseus confirms the connection.
## Returns the room_id, or "" on failure.
func join_room_by_id(target_room_id: String) -> String:
	var response: Dictionary = await _matchmake("/matchmake/joinById/" + target_room_id)
	if response.is_empty():
		return ""
	return await _open_websocket(response)


## Legacy entry point used by auth_handshake_test. Joins or creates a room.
func connect_to_room() -> void:
	var response: Dictionary = await _matchmake("/matchmake/joinOrCreate/" + ROOM_NAME)
	if not response.is_empty():
		await _open_websocket(response)


## Sends a command to the Colyseus room. Called exclusively by CommandQueue.
## type: Colyseus message type string (e.g. "SELECT_NATION")
## payload: optional data dict — omitted from packet if empty
func send_command(type: String, payload: Dictionary) -> void:
	if not _connected or _socket.get_ready_state() != WebSocketPeer.STATE_OPEN:
		push_warning("[NetManager] send_command called while not connected: " + type)
		return
	# Format: [PROTO_ROOM_DATA, msgpack(type), msgpack(payload)]
	var packet := PackedByteArray([PROTO_ROOM_DATA])
	packet.append_array(MsgPack.encode(type))
	if not payload.is_empty():
		packet.append_array(MsgPack.encode(payload))
	_socket.send(packet)


func disconnect_from_room() -> void:
	if _connected:
		_socket.close()
		_connected = false
		disconnected.emit()


func get_connection_state() -> String:
	return "connected" if _connected else "disconnected"


# ── Internal ─────────────────────────────────────────────────────────────────

## POSTs to the Colyseus HTTP matchmaker with the player JWT.
## Returns the parsed JSON response dict, or {} on failure.
func _matchmake(endpoint: String) -> Dictionary:
	var http := HTTPRequest.new()
	add_child(http)

	var colyseus_http: String = Config.COLYSEUS_URL.replace("ws://", "http://").replace("wss://", "https://")
	http.request(
		colyseus_http + endpoint,
		["Content-Type: application/json"],
		HTTPClient.METHOD_POST,
		JSON.stringify({"token": APIClient.jwt})
	)

	var result: Array = await http.request_completed
	http.queue_free()

	if result[1] != 200:
		room_error.emit("Matchmaking failed: HTTP " + str(result[1]))
		return {}

	var body: Variant = JSON.parse_string(result[3].get_string_from_utf8())
	if not body is Dictionary:
		room_error.emit("Matchmaking failed: invalid response")
		return {}

	return body


## Opens the WebSocket to the reserved room and waits for Colyseus JOIN_ROOM.
## Returns the room_id once confirmed, or "" on failure.
func _open_websocket(matchmake_response: Dictionary) -> String:
	session_id = matchmake_response.get("sessionId", "")
	room_id    = matchmake_response.get("roomId", "")
	var process_id: String = matchmake_response.get("processId", "")

	if session_id == "" or room_id == "":
		room_error.emit("Matchmaking response missing sessionId/roomId")
		return ""

	# Colyseus 0.17: URL must include processId between host and roomId
	var path: String = (process_id + "/" if process_id != "" else "") + room_id
	var ws_url: String = Config.COLYSEUS_URL + "/" + path + "?sessionId=" + session_id
	_socket.connect_to_url(ws_url)
	_connected = true
	set_process(true)

	var event: String = await _wait_for_join_or_fail()
	if event != "joined":
		return ""
	return room_id


func _wait_for_join_or_fail() -> String:
	var state := {"done": false, "result": ""}
	var on_joined  := func(_s: String, _r: String) -> void:
		state["done"] = true; state["result"] = "joined"
	var on_disconn := func() -> void:
		state["done"] = true; state["result"] = "disconnected"
	var on_error   := func(_m: String) -> void:
		state["done"] = true; state["result"] = "error"
	room_joined.connect(on_joined, CONNECT_ONE_SHOT)
	disconnected.connect(on_disconn, CONNECT_ONE_SHOT)
	room_error.connect(on_error, CONNECT_ONE_SHOT)
	while not state["done"]:
		await get_tree().process_frame
	return state["result"]


func _process(_delta: float) -> void:
	_socket.poll()

	# Drain all available packets
	while _socket.get_available_packet_count() > 0:
		_handle_packet(_socket.get_packet())

	match _socket.get_ready_state():
		WebSocketPeer.STATE_CLOSED:
			if _connected:
				_connected = false
				set_process(false)
				disconnected.emit()


func _handle_packet(packet: PackedByteArray) -> void:
	if packet.size() == 0:
		return

	var code: int = packet[0]

	match code:
		PROTO_JOIN_ROOM:
			# Colyseus 0.17: ACK with [10] before server considers client joined
			_socket.send(PackedByteArray([PROTO_JOIN_ROOM]))
			room_joined.emit(session_id, room_id)

		PROTO_ERROR:
			room_error.emit("Server error (code %d)" % code)

		PROTO_LEAVE:
			_connected = false
			set_process(false)
			disconnected.emit()

		PROTO_ROOM_DATA:
			_handle_room_data(packet)

		# 14 ROOM_STATE / 15 ROOM_STATE_PATCH: binary schema sync, deferred to Phase 4


func _handle_room_data(packet: PackedByteArray) -> void:
	if packet.size() < 2:
		return

	# Decode the message type string (msgpack at offset 1)
	var type_result: Array = MsgPack.decode(packet, 1)
	var type: String = str(type_result[0])
	var offset: int = type_result[1]

	# Decode payload dict if bytes remain
	var data: Dictionary = {}
	if offset < packet.size():
		var data_result: Array = MsgPack.decode(packet, offset)
		var raw: Variant = data_result[0]
		if raw is Dictionary:
			data = raw

	# Route state updates to GameState directly; everything else via EventBus
	if type == "LOBBY_STATE_UPDATE":
		GameState._apply_server_delta(data)
	else:
		server_event_received.emit(type, data)
