# Client Test Scenes and Workflows

Client test scenes check focused player-facing behavior such as map loading, path previews, panels, air-wing commands, and local research without running the entire game suite.

# Details

## Test ownership

Godot checks are split across three source locations:

- `client/test/` contains direct scene tests and scripts for authentication, research, EventBus, air wings, engagement/tactical widgets, and the production match composition.
- `client/tests/` contains scripts used by movement/pathfinding, relation, template, builder, and military-panel scene wrappers.
- `client/src/test/` contains HUD, chat, settings, and reusable UI-component test scripts.

Many wrappers live under `client/scenes/test/`. The `.tscn` path is the supported headless entry point; running a script path alone does not create its required scene tree.

## Focused headless commands

Run commands from the repository root:

```bash
godot --headless --path client test/research_system_test.tscn
godot --headless --path client test/test_event_bus_signals.tscn
godot --headless --path client test/test_tactical_combat_panel.tscn
godot --headless --path client scenes/test/test_pathfinder_hpa.tscn
godot --headless --path client scenes/test/test_air_wing_command_submission.tscn
godot --headless --path client scenes/test/test_chat_panel.tscn
```

Select the smallest scene that owns the changed behavior. Pathfinder wrappers cover fallback, neutral-territory, HPA, smoothing, and synthetic-goal cases. Air wrappers cover mirrored wing state, icons, path interpolation/bridging, preview state, command submission, and MapDebug right-click routing. UI wrappers cover HUD management, chat, settings, templates, and focused panel derivation.

## Map, debug, and production checks

`client/scenes/debug/map_debug.tscn` is primarily a manual diagnostic composition, not a broad automated suite. Its focused air right-click behavior is checked with:

```bash
godot --headless --path client scenes/test/test_map_debug_air_wing_right_click.tscn
```

The fixture-free production composition is checked separately by [[client/testing/production-match-scene-check|Production Match Scene Check]]. That distinction prevents MapDebug’s sample state from hiding production-scene regressions.

## Environment and E2E prerequisites

Most local scene tests do not need running services. The authentication handshake needs Hono and Colyseus with compatible `JWT_SECRET` values and local dependencies installed. The repository wrapper starts both services:

```bash
bash scripts/e2e-auth-handshake.sh
```

The server-side lobby/session bot uses:

```bash
bash scripts/e2e-session-loop.sh
```

It requires Bun, Node/npm dependencies, usable local environment files, matching shared secrets, available local ports, and the Godot executable only for the authentication wrapper. The session-loop bot does not exercise Godot lobby or scene-transition code.

## Manual UI verification

There is no broad visual-regression suite. UI work still needs manual checks for supported window sizes, readable map/HUD layers, focus and Escape behavior, pause/chat blocking, panel placement, notification overlap, animation, and pointer/keyboard ownership. Record which checks were performed or name the exact checks still needed.

# Related Notes

- [[client/testing/index|Client Testing]]
- [[client/testing/networking-and-session-workflows|Networking and Session Workflows]]
- [[client/testing/production-match-scene-check|Production Match Scene Check]]
- [[client/debugging/map-debug-scene|Map Debug Scene]]
- [[client/ui/index|Client User Interface]]

