# Client Role, Autoloads, and Scenes

The client is where players log in, choose a country, inspect the map, issue orders, manage panels, and see the result of a match. It turns those actions into requests for the multiplayer game and shows the resulting changes.

# Details

## Runtime services

`client/project.godot` registers the runtime autoloads. Cross-cutting configuration, state/command, event, scene-transition, and local-preference services are documented by [[client/core/index|Client Core Runtime]]. Authentication, networking, sessions, and gameplay presentation each have a focused component under this client wiki.

Scene systems should not hold direct references to unrelated systems outside their composition root. They communicate across subsystem ownership through [[client/core/events|Event Bus]] or through explicit autoload service boundaries.

`client/project.godot` registers the core services as autoloads, including this current state/command boundary:

```ini
GameState="*res://src/core/game_state.gd"
CommandQueue="*res://src/core/command_queue.gd"
SessionManager="*res://src/systems/session/session_manager.gd"
LobbySystem="*res://src/systems/session/lobby_system.gd"
```

The `*` makes each script a global runtime service, so scenes use the named facade rather than a direct scene-node reference.

## Scene composition

The main scene is `scenes/main_menu/main_menu.tscn`. `SceneManager` transitions through main menu, lobby, loading, game, and postgame scenes. **Current:** its game target is `scenes/debug/map_debug.tscn`, so the active gameplay scene is also the map debug composition root. The fixture-free `scenes/game/game.tscn` production composition exists but is not wired into this transition.

`MapDebug` composes `MapLoader`, `MapRenderer`, `MapInteraction`, `CameraSystem`, `MilitarySystem`, `VisionSystem`, `AirWingSystem`, layers for units and wings, `PauseMenu`, and `GameHUD`. It wires those systems after map loading. Menu, lobby, loading, postgame, HUD, pause-menu, and keybind scenes each own their local controls and use autoload façades to communicate with runtime services.

## Match rules and results

The client may calculate display-only paths, interpolation, selection, overlays, and local UI state. The game server validates commands and resolves movement, combat, diplomacy, air operations, and other simulation. The state/command boundary and its current write-gate exception are documented by [[client/core/game-state-and-commands|Game-State Mirror and Commands]].

# Related Notes

- [[client/index|Client]]
- [[client/core/index|Client Core Runtime]]
- [[client/networking/index|Networking]]
- [[client/ui/index|User Interface]]
- [[client/map/match-scene-composition|Production Match Scene]]
- [[game-server/overview|Game Server Role and Boundaries]]
