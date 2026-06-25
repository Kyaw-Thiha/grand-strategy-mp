# More Obvious Unit Selection Indicator

## Summary
Make selected unit icons visually obvious by replacing the current small ring with a larger, wider hover-style selection halo and adding a short 0.1s selection pop animation.

## Key Changes
- Update `client/src/systems/military/division_icon.gd` only.
- Add selection visual constants:
  - idle selection radius: `RECT_W * 0.5 + 12.0`
  - line width: `5.0`
  - animation duration: `0.1`
  - animation starts larger/brighter, then settles to idle size.
- In `set_selected(true)`, restart the animation timer and redraw immediately.
- In `_process(delta)`, advance only the local visual animation timer while selected, then stop processing after it completes.
- In `_draw()`, render the selected state as:
  - a soft translucent filled halo behind the unit,
  - a dark country-tinted backing stroke for contrast,
  - a thick outer arc,
  - a thinner inner arc for readability,
  - cyan when in move mode, yellow otherwise.
- Animate selection color changes over `0.1` seconds when move mode is toggled, including the `M` key path.
- Preserve the existing encirclement/supply indicators and draw order so selection remains visible without hiding HP, supply, stack, or movement markers.

## Public Interfaces
- No server, network, API, command, or `GameState` changes.
- No new signals.
- Existing `DivisionIcon.set_selected(selected: bool)` and `set_move_mode(active: bool)` behavior remains the same externally.

## Test Plan
- Run a Godot syntax check if available through the project tooling.
- Manual smoke test in the debug map:
  - click a unit and confirm the larger halo appears clearly,
  - confirm the 0.1s pop animation plays on selection,
  - select another unit and confirm the previous one clears,
  - right-click/move-mode behavior still changes selection color to cyan,
  - deselect by clicking the map and confirm the halo disappears.

## Assumptions
- "Large and wider thing hovering around" means a bigger circular halo around the NATO rectangle, not a new sprite or UI panel.
- The animation should be local visual polish only and should not affect selection logic or game state.
- The unrelated modified file `client/scenes/systems/research/research_tree.tscn` will be left untouched.
