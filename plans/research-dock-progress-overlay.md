# RESe Dock Research Progress Overlay

## Summary
Add a transparent square progress fill over the entire `RESe` dock button. The fill grows from bottom to top and reflects the currently active research progress. It remains visually subtle so the icon and labels stay readable.

## Key Changes
- In `game_hud.tscn`, add a full-button `ColorRect` overlay inside `DockButton_U`:
  - anchored to the bottom of the button
  - full width
  - height controlled by progress ratio
  - mouse filter ignored so button clicks still work
  - drawn behind the existing icon/text content
  - transparent amber/gold color matching the HUD theme
- In `game_hud.gd`, cache the overlay node and update it from research events:
  - `EventBus.research_started`
  - `EventBus.research_progress_changed`
  - `EventBus.research_completed`
- Add a small helper that sets the overlay height from `0.0` to button height using `progress_ratio`, so visual motion is bottom-to-top.
- When no research is active, hide/reset the overlay to `0%`.
- Keep all research logic in `ResearchSystem`; this is display-only and only listens to existing EventBus signals.

## Test Plan
- Run `godot --headless --path client --quit`.
- Run `godot --headless --path client res://scenes/debug/map_debug.tscn --quit`.
- Run `godot --headless --path client --scene res://scenes/test/test_hud_manager.tscn`.
- Manual smoke test:
  - Start a research entry.
  - Confirm the `RESe` button gets a transparent fill that rises from bottom to top.
  - Confirm icon/text remain readable and the button remains clickable.
  - Confirm progress persists visually after closing/reopening the research panel.
  - Confirm the overlay resets when the active research completes.

## Assumptions
- The fill should be amber/gold with low alpha, matching the current HUD icon/button palette.
- The overlay should cover the whole button background, not just the icon/text area.
- This is a HUD display feature only; no research state, server, or persistence behavior changes.
