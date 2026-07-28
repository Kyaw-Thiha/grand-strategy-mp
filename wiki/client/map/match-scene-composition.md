# Production Match Scene

The production match scene gives players the map, armies, air wings, HUD, pause menu, and map controls used during a real multiplayer game. It shows only the match information supplied by the game session; it never adds sample armies or a debug player.

# Details

## Scene status

`client/scenes/game/game.tscn` is the intended normal-play composition root. **Current:** it is ready for direct loading and automated checks, but it is unwired: `SceneManager` still routes ordinary gameplay to `client/scenes/debug/map_debug.tscn` until a later approved integration task changes that target.

## Shared map setup

`client/src/game/map_scene.gd` provides the common map loading, input routing, HUD setup, province selection, right-click camera-versus-order arbitration, and player-nation camera focus used by both map compositions. Stationary right-click releases retain air-before-military command priority, while right drags are consumed as camera movement. `client/src/game/game_scene.gd` uses the server-selected `GameState.map_id` and contains no fixture hook.

The scene returns to the lobby with an error if the game has no map ID. It does not guess a default map, because showing a different geography from the active match would make player orders misleading.

Both compositions contain `MapLoader`, `MapRenderer`, `MapInteraction`, `CameraSystem`, `MilitarySystem`, `VisionSystem`, `AirWingSystem`, division and air-wing layers, the pause menu, and `GameHUD`. The shared script wires those nodes after map loading.

## Province display data

The production scene combines stable province details from `MapLoader`—such as name, terrain, city position, and geometry—with the current owner from `GameState`. This lets political colors and country borders change after a province is captured without copying static map data into the live match state.

`GameHUD.setup_game_context()` receives its scene-owned map, army, air, interaction, and renderer systems directly. It no longer assumes the scene root is named `MapDebug`.

# Related Notes

- [[client/map/index|Map]]
- [[client/map/map-data-and-loading|Map Data and Loading]]
- [[client/map/rendering-camera-and-interaction|Rendering, Camera, and Interaction]]
- [[client/debugging/map-debug-scene|Map Debug Scene]]
- [[client/core/scene-lifecycle|Scene Lifecycle]]
- [[client/testing/production-match-scene-check|Production Match Scene Check]]
