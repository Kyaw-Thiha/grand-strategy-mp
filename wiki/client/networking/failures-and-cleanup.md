# Failures and Cleanup

Networking failures should tell the player why they could not join or continue, then leave the client in a state where they can safely try another game. The current client handles some failures but does not yet provide complete recovery.

# Details

## Matchmaking and room errors

`client/src/net/net_manager.gd`, `NetManager._matchmake()`, reports a non-200 matchmaker response or invalid JSON root through `room_error`:

```gdscript
if result[1] != 200:
	room_error.emit("Matchmaking failed: HTTP " + str(result[1]))
	return {}

var body: Variant = JSON.parse_string(result[3].get_string_from_utf8())
if not body is Dictionary:
	room_error.emit("Matchmaking failed: invalid response")
	return {}
```

`LobbySystem` converts an empty room result into `lobby_join_failed`, and the main menu re-enables its buttons and displays the reason. A Colyseus protocol `ERROR` packet currently becomes the generic text `Server error (code 11)`; its server-supplied error detail is not decoded.

The shared `APIClient` also assumes an HTTP request starts successfully and that the completed response body has the shape expected by its caller. It has no normalized transport-error result, timeout, retry, or invalid-JSON fallback. Authentication-specific effects are detailed in [[client/auth/jwt-and-api-requests|JWT and API Requests]].

## Connection state and waiting

`NetManager._open_websocket()` sets `_connected` immediately after calling `connect_to_url()`, before the socket is open and before `JOIN_ROOM` is acknowledged. Until the room join finishes, `get_connection_state()` can therefore report `connected` too early.

`NetManager._wait_for_join_or_fail()` waits for `room_joined`, `disconnected`, or `room_error` with no deadline. A connection attempt that produces none of those signals can leave a lobby operation and the main-menu “Connecting...” state waiting indefinitely.

**Current:** there is no automatic retry or reconnection path. A dropped room emits `NetManager.disconnected`, but `SessionManager` and the main menu do not subscribe to that signal, so an unexpected disconnect does not automatically notify the player or choose a recovery scene.

## Explicit room exit

The in-game pause menu is the only normal client UI path that closes the room. `client/src/ui/game/pause_menu.gd`, `PauseMenu._on_quit_button_pressed()`, starts the main-menu loading transition and defers the disconnect:

```gdscript
func _on_quit_button_pressed() -> void:
	if _has_restore_clear_color:
		RenderingServer.set_default_clear_color(_restore_clear_color)
	SceneManager.goto_main_menu_loading()
	NetManager.disconnect_from_room.call_deferred()
```

`client/src/net/net_manager.gd`, `NetManager.disconnect_from_room()`, closes the socket and emits `disconnected`:

```gdscript
func disconnect_from_room() -> void:
	if _connected:
		_socket.close()
		_connected = false
		disconnected.emit()
```

This method does not clear `session_id`, `room_id`, or `GameState`, and it does not explicitly disable processing. `AuthManager.logout()` also does not disconnect the room or reset match state. Re-entering multiplayer after a disconnect therefore lacks a defined complete reset contract.

## Lobby and session cleanup gaps

When hosting, `LobbySystem.create_lobby()` reserves a join code, opens a room, and calls `/lobby/activate`, but it ignores the activation response and emits `lobby_created` even if activation failed. A failed room connection can also leave the pending API-server reservation in memory.

When `GAME_ENDED` arrives, `SessionManager` emits `session_ended` before changing to the postgame scene. `PostgameUI` connects to that signal only after the new scene becomes ready, so the current result payload is not retained for that screen to consume.

These are current implementation limitations, not intended player behavior. Fixes require explicit approval because they change client lifecycle and recovery behavior.

# Related Notes

- [[client/networking/index|Client Networking]]
- [[client/session/networked-lobby-and-match-lifecycle|Networked Lobby and Match Lifecycle]]
- [[client/auth/jwt-and-api-requests|JWT and API Requests]]
- [[client/core/scene-lifecycle|Scene Lifecycle]]
- [[client/testing/networking-and-session-workflows|Networking and Session Workflows]]

