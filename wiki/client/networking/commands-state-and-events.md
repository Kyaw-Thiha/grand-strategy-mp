# Commands, State, and Events

Player actions travel to the game server as requests, while confirmed lobby and match changes travel back to the client for the map and interface to display.

# Details

## Sending player actions

Gameplay and lobby systems submit named actions through `CommandQueue`; they do not call the socket directly. `client/src/core/command_queue.gd`, `CommandQueue.submit()`, performs the current local gates:

```gdscript
func submit(type: String, payload: Dictionary) -> void:
	if not AuthManager.is_logged_in():
		command_rejected.emit(type, "Not authenticated")
		return

	if NetManager.get_connection_state() != "connected":
		command_rejected.emit(type, "Not connected to server")
		return

	NetManager.send_command(type, payload)
```

These checks improve feedback but do not validate ownership or game rules. The Colyseus game room remains responsible for deciding whether a command is legal.

`client/src/net/net_manager.gd`, `NetManager.send_command()`, creates the Colyseus named-message packet:

```gdscript
var packet := PackedByteArray([PROTO_ROOM_DATA])
var type_encoded: PackedByteArray = MsgPack.encode(type)
packet.append_array(type_encoded)
if not payload.is_empty():
	var payload_encoded: PackedByteArray = MsgPack.encode(payload)
	packet.append_array(payload_encoded)
_socket.send(packet)
```

For example, `LobbySystem.select_nation()` submits `SELECT_NATION` with `{ "nation_id": <id> }`; `NetManager` serializes the same name and payload rather than converting it into a different client-only contract.

The server registers those names in `game-server/src/rooms/GameRoom.ts`, `GameRoom.onCreate()`:

```ts
this.onMessage("SELECT_NATION",    (client, msg) => this.handleSelectNation(client, msg));
this.onMessage("DESELECT_NATION",  (client, _msg) => this.handleDeselectNation(client));
this.onMessage("SET_READY",        (client, msg) => this.handleSetReady(client, msg));
this.onMessage("START_GAME",       (client, _msg) => this.handleStartGame(client));
this.onMessage("VOTE_SPEED",       (client, msg) => this.handleVoteSpeed(client, msg));
```

This is the authority boundary: client code expresses intent, and `GameRoom` validates and resolves it.

## Receiving server messages

`client/src/net/net_manager.gd`, `NetManager._handle_room_data()`, decodes the message type and optional dictionary payload. Its final routing step treats the lobby snapshot specially:

```gdscript
# Route state updates to GameState directly; everything else via EventBus
if type == "LOBBY_STATE_UPDATE":
	GameState._apply_server_delta(data)
else:
	server_event_received.emit(type, data)
```

`LOBBY_STATE_UPDATE` replaces the lobby collections in `GameState` and emits `EventBus` signals for changed phase or lobby data. Other named messages are passed to `SessionManager._on_server_event()`.

`SessionManager` maps match messages to state application methods and presentation signals. For example, `client/src/systems/session/session_manager.gd` currently routes province changes like this:

```gdscript
"PROVINCE_INIT":
	GameState._apply_province_init(data)

"PROVINCE_CAPTURED":
	GameState._apply_province_captured(data)
```

After an application method changes the client mirror, it emits the relevant `EventBus` signal so unrelated map and interface systems can react without direct node references.

## Required write gate and current mismatch

The required architecture is that only `NetManager` updates `GameState` from server broadcasts. UI and gameplay systems read `GameState`, emit intent, and send commands through `CommandQueue`.

**Current architectural debt:** `NetManager` applies lobby snapshots, but `SessionManager` directly invokes most match-state application methods. The `GameState` file header also claims exclusive `NetManager` updates, so the comment and required boundary do not match runtime behavior. Do not copy the `SessionManager` write pattern into new systems. Restoring one `NetManager` write gate is a refactor candidate awaiting user approval.

## Event routing

`EventBus` carries cross-module notifications such as captures, unit changes, chat messages, diplomacy prompts, and air-combat events. Autoloads may call one another through their explicit service APIs, but unrelated scene systems should react through `EventBus` rather than acquiring direct node references.

Not every server message updates stored state. `SessionManager` forwards transient notifications such as `CHAT_MESSAGE`, `MOVE_ORDER_REJECTED`, and detection events directly to the relevant `EventBus` signal.

# Related Notes

- [[client/networking/index|Client Networking]]
- [[client/core/game-state-and-commands|Game-State Mirror and Commands]]
- [[client/core/events|Event Bus]]
- [[client/session/networked-lobby-and-match-lifecycle|Networked Lobby and Match Lifecycle]]
- [[game-server/commands-and-events|Commands and Events]]
- [[game-server/game-state|Authoritative Game State]]
