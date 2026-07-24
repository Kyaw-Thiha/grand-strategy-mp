# Connection and Room Transport

The connection flow signs the player into the game services, finds or creates their multiplayer room, and keeps a live path open for lobby choices and match updates.

# Details

## Two network paths

The client uses two distinct services:

- `APIClient` sends ordinary HTTP requests to the Hono API server for login and lobby coordination.
- `NetManager` uses the Colyseus HTTP matchmaker, then opens a WebSocket to the reserved game room for live lobby and match traffic.

Both paths use the JWT stored in memory as `APIClient.jwt`. Hono requests send it as an `Authorization: Bearer` header. Colyseus matchmaking sends it in the JSON `token` option, which `game-server/src/rooms/GameRoom.ts`, `GameRoom.onAuth()`, verifies before admitting the player.

The networking services are global autoloads. `client/project.godot` registers their real names and paths:

```ini
Config="*res://src/core/config.gd"
MsgPack="*res://src/core/msgpack.gd"
APIClient="*res://src/net/api_client.gd"
AuthManager="*res://src/auth/auth_manager.gd"
NetManager="*res://src/net/net_manager.gd"
```

The `*` makes each script a named runtime service. A scene or system can therefore call the appropriate facade without locating a networking node in the active scene.

## Matchmaking and room reservation

`client/src/net/net_manager.gd`, `NetManager._matchmake()`, converts the configured WebSocket origin to HTTP and includes the current JWT in the matchmaker request:

```gdscript
var colyseus_http: String = Config.COLYSEUS_URL.replace("ws://", "http://").replace("wss://", "https://")
http.request(
	colyseus_http + endpoint,
	["Content-Type: application/json"],
	HTTPClient.METHOD_POST,
	JSON.stringify({"token": APIClient.jwt})
)
```

`create_and_join_room()` calls `/matchmake/create/game_room`. `join_room_by_id()` calls `/matchmake/joinById/<room_id>`. The legacy `connect_to_room()` entry point uses `/matchmake/joinOrCreate/game_room` for the Godot authentication-handshake scene.

## Colyseus 0.17 WebSocket compatibility

The matchmaker returns `sessionId`, `roomId`, and optionally `processId`. `client/src/net/net_manager.gd`, `NetManager._open_websocket()`, preserves the Colyseus 0.17 process segment when it constructs the reserved-room URL:

```gdscript
session_id = matchmake_response.get("sessionId", "")
room_id    = matchmake_response.get("roomId", "")
var process_id: String = matchmake_response.get("processId", "")

if session_id == "" or room_id == "":
	room_error.emit("Matchmaking response missing sessionId/roomId")
	return ""

# Colyseus 0.17: URL must include processId between host and roomId
var path: String = (process_id + "/" if process_id != "" else "") + room_id
var ws_url: String = Config.COLYSEUS_URL + "/" + path + "?sessionId=" + session_id
_socket.inbound_buffer_size = 1024 * 1024   # 1 MB — defence against large Colyseus state patches
_socket.connect_to_url(ws_url)
_connected = true
set_process(true)
```

The one-megabyte inbound buffer allows larger server packets while bounding the client allocation. The current connection flag is set before the WebSocket and room join are fully confirmed; this limitation is described in [[client/networking/failures-and-cleanup|Failures and Cleanup]].

After Colyseus sends protocol byte `10` (`JOIN_ROOM`), `NetManager._handle_packet()` must acknowledge it with the same byte:

```gdscript
match code:
	PROTO_JOIN_ROOM:
		# Colyseus 0.17: ACK with [10] before server considers client joined
		_socket.send(PackedByteArray([PROTO_JOIN_ROOM]))
		room_joined.emit(session_id, room_id)
```

Removing either the `processId` path handling or this acknowledgement would break the current Godot client’s Colyseus 0.17 room-join flow.

## Named room messages

`MsgPack`, implemented by `client/src/core/msgpack.gd`, encodes and decodes the values carried by Colyseus named room messages: null, booleans, integers, 64-bit floats, strings, arrays, and dictionaries. `NetManager` prefixes outgoing and incoming named messages with protocol byte `13` (`ROOM_DATA`).

Protocol bytes `14` (`ROOM_STATE`) and `15` (`ROOM_STATE_PATCH`) are not applied by the current Godot client. Current synchronization uses named messages such as `LOBBY_STATE_UPDATE`, `DIVISION_UPDATES`, and `GAME_STARTED`; binary Colyseus schema synchronization remains unsupported on this client path.

# Related Notes

- [[client/networking/index|Client Networking]]
- [[client/auth/jwt-and-api-requests|JWT and API Requests]]
- [[client/core/configuration-and-serialization|Configuration and Serialization]]
- [[client/session/networked-lobby-and-match-lifecycle|Networked Lobby and Match Lifecycle]]
- [[game-server/room-lifecycle|Room Lifecycle]]
