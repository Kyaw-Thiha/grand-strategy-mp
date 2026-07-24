# Map Rendering, Camera, and Input

The map lets players pan across the world, zoom from a country view to local detail, choose display modes, inspect provinces, and point armies or air wings toward places of interest.

# Details

## Map loading and rendering

`MapLoader` loads a generated `scenes/map/<map-id>.tscn` plus map JSON data, indexes province nodes and click areas, and exposes adjacency, terrain, waypoint, projection, and map-bound helpers. It uses a Mercator-style projection to translate longitude/latitude to the 4096×3000 map canvas.

`MapRenderer` owns political, cover, and elevation presentation, province highlighting, ownership refreshes, borders, city-marker visibility, and zoom-sensitive nation labels. Province ownership comes from `GameState` through the supplied data source; rendering does not write it.

## Camera and interactions

`CameraSystem` pans with keys and edge scrolling, zooms, clamps to map bounds, and observes UI/pause/chat blocking signals before consuming player input. `MapInteraction` owns hover and province click/right-click signals, tracks the locally selected province, and similarly respects blocking state.

`MapDebug` is the composition root that prioritizes air-wing input, then military input, around the map interaction layer. It keeps keyboard focus out of map commands while chat or the pause menu owns input.

## Verified composition example

`client/src/core/scene_manager.gd` identifies the current gameplay composition target:

```gdscript
const SCENE_MAIN_MENU := "res://scenes/main_menu/main_menu.tscn"
const SCENE_LOBBY     := "res://scenes/lobby/lobby.tscn"
const SCENE_LOADING   := "res://scenes/loading/loading_screen.tscn"
const SCENE_GAME      := "res://scenes/debug/map_debug.tscn"
const SCENE_POSTGAME  := "res://scenes/postgame/postgame.tscn"
```

This is the current path into `MapDebug`, the scene that composes the map and its input systems.

# Related Notes

- [[client/index|Client]]
- [[client/military|Military Display and Movement Input]]
- [[client/air-and-vision|Air Operations and Vision]]
- [[game-server/maps-and-starting-state|Maps and Starting State]]
