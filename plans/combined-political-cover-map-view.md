# Combined Political + Elevation Map View

## Summary

Combine the current Political and Elevation map modes into one Political map mode. The HUD will show only Political and Cover map buttons. Political mode will keep nation ownership colors as the dominant visual layer while adding a subtle elevation overlay so terrain detail remains visible without switching modes.

## Key Changes

- Update `client/scenes/game/game_hud.tscn`:
  - Remove `BtnMapElevation` and its child icon/label nodes from `MapModeBar`.
  - Keep `BtnMapPolitical` and `BtnMapCover`.
  - Update Political tooltip to communicate that it includes elevation detail.
- Update `client/src/ui/hud/game_hud.gd`:
  - Remove `_btn_map_ele`.
  - Remove the `"elevation"` button signal connection.
  - Keep Political emitting `"political"` and Cover emitting `"cover"`.
- Update `client/src/systems/map/map_renderer.gd`:
  - In `OverlayMode.POLITICAL`, show `ElevationLayer` with low layer opacity, defaulting to `modulate.a = 0.22`, so nation colors remain dominant.
  - In `OverlayMode.COVER`, hide `ElevationLayer` and show `CoverLayer` as before.
  - Make incoming `"elevation"` map mode fall back to `"political"` for compatibility.
  - Ensure mode switching resets layer visibility and opacity deterministically.
- Extend `client/src/test/test_hud_manager.gd`:
  - Assert `BtnMapPolitical` and `BtnMapCover` exist.
  - Assert `BtnMapElevation` no longer exists.
  - Press Political and Cover buttons and assert `EventBus.map_mode_changed` emits `"political"` and `"cover"`.

## Test Plan

- Run `godot --headless --path client scenes/test/test_hud_manager.tscn`.
- Run `godot --headless --path client scenes/debug/map_debug.tscn` as a scene-load smoke test; stop it manually if it continues running normally.
- Run `git diff --check`.
- Manual visual check in Godot:
  - Open the game/map scene.
  - Confirm the map mode bar has two buttons: Political and Cover.
  - Confirm Political shows dominant nation colors with subtle elevation detail visible.
  - Confirm Cover still displays cover mode without elevation tint.
  - Toggle Political/Cover repeatedly and confirm no stale overlay remains.

## Assumptions

- "Combine elevation and political" means removing the separate Elevation HUD button, not adding a cycle/submode.
- Elevation detail should be a subtle always-on overlay in Political mode, not equal-strength elevation coloring.
- Cover mode remains separate and visually unchanged.
- Existing unrelated dirty files should not be touched.
