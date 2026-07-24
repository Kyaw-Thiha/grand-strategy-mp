# Scene Lifecycle

The scene manager takes players between the main menu, lobby, loading screen, match, and postgame results. It keeps the loading screen visible until the match is ready to enter.

# Details

## Transition targets

`SceneManager`, implemented by `client/src/core/scene_manager.gd`, names the main-menu, lobby, loading, game, and postgame scene paths and emits the resulting scene name after a transition. **Current:** the game target is `scenes/debug/map_debug.tscn`; this is a development composition choice, not a dedicated production game scene.

The current targets are defined in `client/src/core/scene_manager.gd`:

```gdscript
const SCENE_MAIN_MENU := "res://scenes/main_menu/main_menu.tscn"
const SCENE_LOBBY     := "res://scenes/lobby/lobby.tscn"
const SCENE_LOADING   := "res://scenes/loading/loading_screen.tscn"
const SCENE_GAME      := "res://scenes/debug/map_debug.tscn"
const SCENE_POSTGAME  := "res://scenes/postgame/postgame.tscn"
```

These constants keep the menu-to-lobby-to-loading-to-match sequence in one autoload.

## Loading handshake

The manager stores a pending target while the loading scene asynchronously prepares it. A caller can request that loading wait for `GAME_STARTED`; `SessionManager` confirms that event, while an error cancels the wait and returns the player to the main menu. The loading scene completes the transition only after both the scene resource and required start confirmation are available.

# Related Notes

- [[client/core/index|Client Core Runtime]]
- [[client/session/index|Sessions]]
- [[client/debugging/index|Debugging]]
- [[client/ui/index|User Interface]]
