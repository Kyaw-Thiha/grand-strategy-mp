# Softer Fog Of War With Hidden Enemy Units

## Summary
Change out-of-range vision from near-black concealment to a darker readable map treatment. Players should still read political/cover/elevation/frontline changes outside vision, but enemy division icons and enemy route overlays should be hidden unless inside visible range.

## Key Changes
- Update `VisionSystem` dark treatment:
  - replace the near-black `DARKNESS_COLOR` with a readable dark tint
  - keep existing PointLight2D reveal behavior so visible areas still brighten naturally
  - keep map overlays under the same tint so political/elevation/cover remain visible out of range
- Add an `EventBus.vision_visibility_changed(visible_provinces: Dictionary)` signal.
- Emit that signal from `VisionSystem.refresh_visibility()` after recomputing visible provinces, and emit an empty dictionary when vision is disabled.

## Enemy Unit Visibility
- Update `MilitarySystem` to listen for `vision_visibility_changed`.
- Store the latest visible province set locally inside `MilitarySystem`.
- After division add/update/removal and during dead-reckoning movement, update icon and route visibility:
  - own units are always visible
  - enemy units are visible only when their current position is inside a visible province polygon
  - enemy route overlays follow the enemy icon visibility
  - hidden enemy units cannot be clicked, box-selected, or selected by hit testing

## Behavior Preserved
- Do not change GameState or server authority.
- Do not hide map layers, province ownership, cover, elevation, city labels, or future frontline overlays.
- Do not hide friendly units, their routes, or their selection/move UI.
- Keep existing vision lights and owned/observed province logic.

## Test Plan
- Run `godot --headless --path client --quit`.
- Run `godot --headless --path client res://scenes/debug/map_debug.tscn --quit`.
- Manual smoke test:
  - Confirm out-of-range map is darker but still readable in political, cover, and elevation modes.
  - Confirm enemy divisions outside visible range are hidden.
  - Confirm enemy divisions inside visible range still appear.
  - Confirm friendly divisions remain visible everywhere.
  - Confirm hidden enemy units cannot be clicked or drag-selected.
  - Confirm visible enemy route overlays hide/show with the enemy icon.

## Assumptions
- “Outside of range” should still be visibly dimmed, just not blacked out.
- For v1, enemy visibility can be derived client-side from the existing visible province set and unit position.
- Frontline display should remain map information, not vision-gated unit intelligence.
