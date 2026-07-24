# Client Testing and Debugging

Testing and debugging help the team check that player-facing features still work: login reaches a game, panels respond correctly, units follow expected routes, and the map can be inspected without starting a full match.

# Details

## Test layout

`client/test/` contains self-contained Godot test scenes/scripts for authentication handshake, research, EventBus, air wings, combat widgets, tactical panels, and map-debug interaction. `client/scenes/test/` contains scene wrappers for air, HUD, settings, division-template, relation, and pathfinding tests; related scripts live in `client/test/`, `client/tests/`, or `client/src/test/`.

Run a supported scene directly with `godot --headless --path client <scene.tscn>`, for example `godot --headless --path client test/auth_handshake_test.tscn`. The authentication handshake requires the API and game servers to be running with compatible secrets. Focused examples include research (`test/research_system_test.tscn`), EventBus (`test/test_event_bus_signals.tscn`), tactical combat (`test/test_tactical_combat_panel.tscn`), and the pathfinder/air scene checks under `scenes/test/`.

## Debug composition

The supported headless entry point is a real Godot scene command:

```bash
godot --headless --path client test/auth_handshake_test.tscn
```

This starts the authentication handshake scene; run the API and game servers first when testing that integration.

`scenes/debug/map_debug.tscn` is an executable map composition root. It loads `western_europe_6`, wires map/gameplay display systems, and seeds debug divisions and air wings only when the mirror is empty. It can be run from the editor or set as the main scene for visual diagnostics. Those test/debug seeds are deliberate exceptions to normal live-state ownership.

## Required verification selection

Choose the smallest scene test that covers the changed behavior. Network/auth changes also need `bash scripts/e2e-auth-handshake.sh`; room/session changes may need `bash scripts/e2e-session-loop.sh`. For UI work, perform the manual checks in [[client/ui|User Interface]] and record the results because headless checks do not validate rendering or input feel.

# Related Notes

- [[client/index|Client]]
- [[client/ui|User Interface]]
- [[client/networking-and-game-state|Networking and Game-State Mirror]]
