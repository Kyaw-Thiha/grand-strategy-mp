# Research Button Q Swap

## Summary
Move research panel behavior from the U dock button to the first left-sidebar Q button.

## Key Changes
- Q button uses the atom icon and opens research.
- Q button owns the research progress fill.
- U button becomes a disabled text-only placeholder like I.
- Research keyboard shortcut changes from U to Q.

## Test Plan
- Run headless validation for `res://scenes/debug/map_debug.tscn`.
- Smoke test Q click/key toggles research and U does nothing.
