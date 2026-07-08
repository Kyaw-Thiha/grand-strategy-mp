# Combined Political + Elevation Map View

## Summary

Combine elevation detail into Political mode while retaining the original standalone Elevation button as a future debug view. Political mode keeps nation ownership colors as the dominant visual layer while adding a stronger subtle elevation overlay.

## Key Changes

- Update `client/scenes/game/game_hud.tscn`:
  - Keep `BtnMapPolitical`, `BtnMapCover`, and `BtnMapElevation`.
  - Update Political tooltip to communicate that it includes elevation detail.
- Update `client/src/ui/hud/game_hud.gd`:
  - Keep Political emitting `"political"`, Cover emitting `"cover"`, and Elevation emitting `"elevation"`.
- Update `client/src/systems/map/map_renderer.gd`:
  - In `OverlayMode.POLITICAL`, show `ElevationLayer` with low layer opacity, defaulting to `modulate.a = 0.36`, so nation colors remain dominant while elevation is readable.
  - In `OverlayMode.ELEVATION`, preserve the original standalone elevation behavior with `ElevationLayer` at full opacity.
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
  - Confirm Political shows dominant nation colors with subtle elevation detail visible.
  - Confirm Cover still displays cover mode without elevation tint.
  - Confirm Elevation still displays the original standalone elevation debug view.
  - Toggle Political/Cover/Elevation repeatedly and confirm no stale overlay remains.

## Assumptions

- "Combine elevation and political" means adding elevation detail to Political, while retaining the original Elevation button for debug use.
- Political elevation detail should be a subtle always-on overlay, not equal-strength elevation coloring.
- Cover mode remains separate and visually unchanged.
- Existing unrelated dirty files should not be touched.
