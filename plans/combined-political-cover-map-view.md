# Combined Political + Elevation Map View

## Summary

Combine elevation and subtle cover detail into Political mode while retaining the original standalone Elevation button as a future debug view. Political mode keeps nation ownership colors as the dominant visual layer while adding elevation and cover overlays.

## Key Changes

- Update `client/scenes/game/game_hud.tscn`:
  - Keep `BtnMapPolitical`, `BtnMapCover`, and `BtnMapElevation`.
  - Update Political tooltip to communicate that it includes elevation detail.
- Update `client/src/ui/hud/game_hud.gd`:
  - Keep Political emitting `"political"`, Cover emitting `"cover"`, and Elevation emitting `"elevation"`.
- Update `client/src/systems/map/map_renderer.gd`:
  - In `OverlayMode.POLITICAL`, show `ElevationLayer` with low layer opacity, defaulting to `modulate.a = 0.36`, so nation colors remain dominant while elevation is readable.
  - In `OverlayMode.POLITICAL`, also show `CoverLayer` at `modulate.a = 0.20` for additional terrain detail.
  - In `OverlayMode.POLITICAL` and `OverlayMode.COVER`, index shared edges from `Fill` and `FillPart##` polygons and render only edges whose two adjacent provinces have different nation owners, using the same medium-light grey border highlight with a wider dark contrast line underneath for clear separation.
  - In `OverlayMode.COVER` and `OverlayMode.ELEVATION`, use a full-black nation-boundary stroke with a thicker width while preserving each mode's terrain layer behavior.
  - Never use or style road/river `Line2D` nodes; their `RoadsLayer` and `RiversLayer` remain unchanged.
  - Skip exterior/coastline edges and internal same-nation province edges.
  - In `OverlayMode.COVER`, hide `ElevationLayer` and show `CoverLayer` as before.
  - Ensure mode switching resets layer visibility and opacity deterministically.
- Extend `client/src/test/test_hud_manager.gd`:
  - Assert all three map buttons exist.
  - Press Political, Cover, and Elevation buttons and assert `EventBus.map_mode_changed` emits `"political"`, `"cover"`, and `"elevation"`.

## Test Plan

- Run `godot --headless --path client scenes/test/test_hud_manager.tscn`.
- Run `godot --headless --path client scenes/debug/map_debug.tscn` as a scene-load smoke test; stop it manually if it continues running normally.
- Run `git diff --check`.
- Manual visual check in Godot:
  - Open the game/map scene.
  - Confirm the map mode bar has three buttons: Political, Cover, and Elevation.
  - Confirm Political shows dominant nation colors with visible elevation and subtle cover detail.
  - Confirm Cover still displays cover mode without elevation tint and uses thicker full-black nation boundaries.
  - Confirm Elevation still displays the standalone elevation debug view with thicker full-black nation boundaries.
  - Confirm roads remain brown/orange and rivers remain blue.
  - Toggle Political/Cover/Elevation repeatedly and confirm no stale overlay remains.

## Assumptions

- "Combine elevation and political" means adding elevation detail to Political, while retaining the original Elevation button for debug use.
- Political elevation detail should be a subtle always-on overlay, not equal-strength elevation coloring.
- Cover mode remains separate and visually unchanged.
- Strong borders represent nation boundaries, not every province boundary.
- Existing unrelated dirty files should not be touched.
