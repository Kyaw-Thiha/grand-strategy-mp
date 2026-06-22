# Vision System — V1 Implementation Record

## What was built

`client/src/systems/map/vision_system.gd` — a new `Node` (not autoload) that owns:

- `_visible_provinces: Dictionary` — client display state only, never written to GameState
- `DarknessLayer` — a `CanvasModulate` child in world space (not under CanvasLayer)
- `VisionLightLayer` — a `Node2D` child that holds all `PointLight2D` nodes

Wired into `client/scenes/debug/map_debug.tscn` and `client/src/debug/map_debug.gd`.

## How visibility is computed (V1 rules)

1. A province is visible if `_get_province_nation_id()` returns the local player's nation id.
   - Checks `GameState.get_province(id).nation_id` first (live server data).
   - Falls back to `MapLoader.get_province_data(id).nation_id` (static map data).
2. A province is visible if it falls within `observation_radius` of a friendly division
   (read from `GameState.get_my_nation_divisions()`).

## How lights are placed

- Light positions use `MapLoader.get_province_focus_position()` (city position) when available,
  falling back to the Fill polygon centroid.
- Division lights use `MapLoader.project_lng_lat(position_lng, position_lat)`.
- All positions are in world space (province nodes created at origin by map generator).

## Data / rendering boundary

| Owned by VisionSystem | NOT owned by VisionSystem |
|---|---|
| `_visible_provinces` set | Province colors (MapRenderer) |
| DarknessLayer (CanvasModulate) | Overlay mode logic (MapRenderer) |
| VisionLightLayer (PointLight2D nodes) | Nation labels (MapRenderer) |
| `is_province_visible()` query | Division icons (MilitarySystem) |

## CanvasModulate scope

Placed in world space (not under a CanvasLayer). Darkens only the main viewport canvas.
`HUD` and `PauseMenu` are `CanvasLayer` nodes and are unaffected.

## Debug scene setup

`map_debug._inject_debug_divisions()` also sets `GameState.nations["germany"]` with
`player_id = "debug_player"` and sets `AuthManager.user_id = "debug_player"` so
the VisionSystem treats germany as the local player's nation.

## Known V1 limits

- Full refresh on every division/province event (simple but not incremental).
- Observation radius is compared against province anchor points, not province area.
- No adjacency-based spread — distant provinces not within radius stay dark even if adjacent.
- Province lights are recreated from scratch on each refresh (no pooling).
- Constants in vision_system.gd should be tuned after a visual smoke test.
