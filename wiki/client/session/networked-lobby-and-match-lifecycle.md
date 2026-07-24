# Networked Lobby and Match Lifecycle

Players can create or find a lobby, choose a nation, ready up, enter the match together, and leave for the results or main menu when play ends.

# Details

## Hosting a lobby

`LobbySystem` coordinates two services when a host creates a game:

1. `POST /lobby/create` reserves a six-character join code in the API server.
2. `NetManager.create_and_join_room()` creates and joins a Colyseus `game_room`.
3. `POST /lobby/activate` links the join code to the returned room ID.

`client/src/systems/session/lobby_system.gd`, `LobbySystem.create_lobby()`, implements that order:

```gdscript
var result: Dictionary = await APIClient.post("/lobby/create", {})
if result["code"] != 200:
	lobby_join_failed.emit(result["data"].get("error", "Failed to create lobby"))
	return

_current_join_code = result["data"].get("join_code", "")
var room_id: String = await NetManager.create_and_join_room()
if room_id == "":
	lobby_join_failed.emit("Failed to connect to game server")
	return
```

After the shown room join, the function posts the join code and room ID to `/lobby/activate`, then emits `lobby_created`. The current code does not verify the activation response; see [[client/networking/failures-and-cleanup|Failures and Cleanup]].

## Joining an existing lobby

Joining by code uses `GET /lobby/resolve/<code>` to retrieve the active room ID, then calls `NetManager.join_room_by_id()`. Browsing uses `GET /lobby/public` and currently joins the first returned lobby. The main menu changes to the lobby scene only after `LobbySystem` emits `lobby_created` or `lobby_joined`.

Once connected, nation selection, readiness, game start, and speed votes use the normal command path. `client/src/systems/session/lobby_system.gd` submits the real room message names:

```gdscript
func select_nation(nation_id: String) -> void:
	CommandQueue.submit("SELECT_NATION", {"nation_id": nation_id})
	nation_selected.emit(nation_id)


func deselect_nation() -> void:
	CommandQueue.submit("DESELECT_NATION", {})


func set_ready(ready: bool) -> void:
	CommandQueue.submit("SET_READY", {"ready": ready})
```

The lobby UI reads confirmed nation slots, players, host session, map ID, and phase from `GameState`; it does not write those values directly.

## Starting and loading the match

When the host presses Start, the lobby submits `START_GAME` and asks `SceneManager.goto_game_loading(true)` to show a loading screen that waits for server confirmation.

`client/src/systems/session/session_manager.gd`, `SessionManager._on_server_event()`, releases that wait when `GAME_STARTED` arrives:

```gdscript
"GAME_STARTED":
	var assignments: Dictionary = data.get("nation_assignments", {})
	var speed: int = data.get("game_speed", 1)
	session_started.emit(assignments, speed)
	if SceneManager.is_game_loading_pending():
		SceneManager.confirm_game_start()
	else:
		SceneManager.goto_game()
```

The loading screen begins loading the configured game scene only after `SceneManager.game_start_confirmed`. **Current:** the configured target remains `client/scenes/debug/map_debug.tscn`; the production match scene exists but is not yet wired as the transition target.

If the server sends a named `ERROR` while loading waits for start, `SessionManager` calls `SceneManager.cancel_game_start_loading()`. That method cancels the pending target, returns to the lobby, and displays the reason through `EventBus.notification_requested`.

## Ending and leaving

On `GAME_ENDED`, `SessionManager` reads `winner_id` and `reason`, emits `session_ended`, and changes to the postgame scene. The current postgame UI subscribes after that emission and does not receive retained result data, so its result handoff needs a separate approved refactor.

Choosing Quit from the in-game pause menu returns through the loading screen to the main menu and calls `NetManager.disconnect_from_room()`. Unexpected disconnections do not currently drive an equivalent scene transition or state reset.

# Related Notes

- [[client/session/index|Client Sessions]]
- [[client/networking/connection-and-room-transport|Connection and Room Transport]]
- [[client/networking/commands-state-and-events|Commands, State, and Events]]
- [[client/networking/failures-and-cleanup|Failures and Cleanup]]
- [[client/core/scene-lifecycle|Scene Lifecycle]]
- [[api-server/lobby|Lobby Coordination]]
