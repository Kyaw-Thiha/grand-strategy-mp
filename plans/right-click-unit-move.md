# Right-Click Unit Movement

## Summary
Add standard RTS-style movement: selected own units move when the player right-clicks the map.

## Key Changes
- Right-click with selected own units submits movement directly.
- Single-unit right-click submits one path immediately.
- Multi-unit right-click reuses the existing formation-preserving group move.
- Shift+right-click with one selected unit reuses the existing queued waypoint chain.
- Existing left-click selection, drag-select, and `M` move mode remain unchanged.

## Test Plan
- Run headless validation for `res://scenes/debug/map_debug.tscn`.
- Smoke test single selection, multi-selection, empty right-click, Shift+right-click, and existing `M` move mode.
