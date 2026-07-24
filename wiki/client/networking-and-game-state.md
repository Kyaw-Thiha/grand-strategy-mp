# Networking and Game-State Mirror

Networking gets a player into the chosen multiplayer game and keeps their screen up to date as the lobby and match change. It carries orders to the server and brings back the results for the map and interface to show.

# Details

## Colyseus connection

`NetManager` uses the HTTP matchmaker with the JWT in its request body, then opens the returned WebSocket reservation. For Colyseus 0.17 it preserves the optional `processId` path segment and acknowledges `JOIN_ROOM` with byte `10`; both are required compatibility details. It MsgPack-encodes named room messages and accepts packets up to 1 MB.

`LOBBY_STATE_UPDATE` is a full lobby delta and is applied directly by `NetManager`. Other room messages become `server_event_received(type, data)`, which `SessionManager` translates into state updates and `EventBus` notifications. Binary `ROOM_STATE` and `ROOM_STATE_PATCH` support is **Planned**; current state sync is event/message based.

## State handoff

`LOBBY_STATE_UPDATE` is applied by `NetManager`; non-lobby messages are emitted for `SessionManager` to route into client state and presentation signals. The `GameState` data contract, intended read-only boundary, and command gate are documented by [[client/core/game-state-and-commands|Game-State Mirror and Commands]].

## Verified command handoff

`client/src/core/command_queue.gd`, `CommandQueue.submit()`, is the single client-side gateway before networking:

```gdscript
if NetManager.get_connection_state() != "connected":
	command_rejected.emit(type, "Not connected to server")
	return

NetManager.send_command(type, payload)
```

The queue rejects an obviously unusable send locally, then passes intent to `NetManager`; it does not resolve a game rule.

# Related Notes

- [[client/index|Client]]
- [[client/core/game-state-and-commands|Game-State Mirror and Commands]]
- [[client/networking/index|Networking]]
- [[game-server/commands-and-events|Commands and Events]]
- [[game-server/game-state|Authoritative Game State]]
