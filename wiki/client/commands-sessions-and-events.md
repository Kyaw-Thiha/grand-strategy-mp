# Commands, Sessions, and Events

Sessions guide players from creating or joining a lobby through country selection, loading, playing a match, and seeing the result. They also make game events visible to the map, panels, and notifications that need them.

# Details

## Command and event boundaries

[[client/core/game-state-and-commands|Game-State Mirror and Commands]] documents the normal `CommandQueue` submission route. [[client/core/events|Event Bus]] owns the cross-module signal contract. Session routing uses both but does not redefine either boundary.

## Lobby and sessions

`LobbySystem` reserves and activates host lobbies through the API server, joins rooms by resolved code or public listing, and submits nation, readiness, start, and speed-vote commands. `SessionManager` receives room events, changes scenes on game start/end, handles loading failures, and bridges server state/event payloads into `GameState` and `EventBus`.

`SceneManager` owns asynchronous scene targets. It can keep the loading scene open until `GAME_STARTED`, cancel that wait on server error, and then transitions to the configured game scene. The postgame scene observes the session-ended signal to render the result.

## Verified session command gateway

`client/src/core/command_queue.gd`, `CommandQueue.submit()`, accepts the named lobby and match command used by session systems:

```gdscript
func submit(type: String, payload: Dictionary) -> void:
	if not AuthManager.is_logged_in():
		command_rejected.emit(type, "Not authenticated")
		return

	NetManager.send_command(type, payload)
```

This shows why `LobbySystem` and `SessionManager` send intent through the queue instead of opening a separate socket path.

# Related Notes

- [[client/index|Client]]
- [[client/core/game-state-and-commands|Game-State Mirror and Commands]]
- [[client/core/events|Event Bus]]
- [[client/session/index|Sessions]]
- [[client/diplomacy-and-research|Diplomacy and Research]]
- [[client/ui|User Interface]]
