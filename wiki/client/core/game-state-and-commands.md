# Game-State Mirror and Commands

This system gives the player a current view of the match—selected nations, provinces, armies, relations, and air wings—and sends their choices, such as movement or diplomacy orders, to the game server.

# Details

## Match view

`GameState`, implemented by `client/src/core/game_state.gd`, holds the current match view for lobby phase, map identity, speed, players, nations, provinces, divisions, frontline data, relations, stacks, air wings, and cached air-wing paths. Display and UI systems use its getters; the game server decides simulation results.

Its underscore-prefixed application methods consume server-originated data and emit the relevant `EventBus` notifications. **Current:** `NetManager` applies lobby snapshots, while `SessionManager` applies other server event payloads; `MapDebug` and tests deliberately seed the mirror as isolated fixtures. This is the documented exception to the intended live-state write gate, not permission for ordinary UI/gameplay systems to mutate it.

`client/src/core/game_state.gd`, `GameState._apply_server_delta()`, applies a server lobby snapshot and emits a notification:

```gdscript
func _apply_server_delta(delta: Dictionary) -> void:
	var new_phase: String = delta.get("phase", phase)
	if new_phase != phase:
		phase = new_phase
		EventBus.phase_changed.emit(phase)
```

The underscore-prefixed method is an application path for server-originated data, not a UI editing API.

## Sending player choices

`CommandQueue`, implemented by `client/src/core/command_queue.gd`, validates local authentication and room-connection state before forwarding a named command and payload to `NetManager`. Military, diplomacy, air, chat, lobby, and tactical UI use this gate rather than sending directly through the socket.

Local validation only prevents clearly unusable sends. The game server validates ownership, phase, payload, and game rules, and may reject the request.

# Related Notes

- [[client/core/index|Client Core Runtime]]
- [[client/networking/commands-state-and-events|Commands, State, and Events]]
- [[client/session/index|Sessions]]
- [[game-server/game-state|Authoritative Game State]]
- [[game-server/commands-and-events|Commands and Events]]
