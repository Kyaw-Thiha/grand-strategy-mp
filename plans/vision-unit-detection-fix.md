# Vision Unit Detection Fix

## Summary
Fix enemy visibility by checking enemy positions directly against friendly unit vision radius, while keeping province visibility as terrain/fog display data.

## Key Changes
- Add a `VisionSystem.is_world_position_visible_to_units(...)` query for direct unit detection.
- Keep visible province data as map reveal state only.
- Let `MilitarySystem` show enemy divisions when either their province is visible or their displayed position is inside friendly unit vision radius.
- Wire the `VisionSystem` reference through `map_debug.gd`.
- Keep unit lights stable by reusing keyed `PointLight2D` nodes instead of rebuilding them on every division update.

## Test Plan
- Run headless validation for `res://scenes/debug/map_debug.tscn`.
- Smoke test enemy unit visibility near and outside friendly observation radius.
