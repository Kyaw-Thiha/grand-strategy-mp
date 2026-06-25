# V1 Box Selection and Group Move

## Summary
Add RTS-style drag box selection for units and group movement for selected units. Dragging previews units in the box with a grey selection state; releasing commits selection and applies the existing selected-unit hover effect to every selected unit. Pressing `M` and clicking a destination moves the selected units together.

## Key Changes
- Refactor `MilitarySystem` from one `_selected_division_id` to a selected id list, while keeping single-click selection behavior.
- Add drag selection input flow:
  - left mouse press records a pending drag start,
  - mouse motion past a small threshold shows a screen-space selection rectangle,
  - units whose icon positions fall inside the rectangle get a grey preview highlight,
  - left mouse release commits previewed own units as selected,
  - empty drag clears selection.
- Add a lightweight screen-space selection rectangle overlay owned by `MilitarySystem`, rendered above the map and below normal HUD controls.
- Add `DivisionIcon.set_selection_preview(active: bool)` and draw a greyish preview halo distinct from the committed selected halo.
- Add `EventBus.division_selection_changed(division_ids: Array[String])`; keep existing `division_selected(primary_id)` and `division_deselected()` emissions for compatibility.
- Keep box selection to own units only; standalone debug mode with no player nation may select all debug units.

## Group Movement
- `M` enters move mode for all currently selected own units and sets their selected visual to move-mode color.
- Single selected unit keeps the existing pathing behavior, including shift waypoint chaining.
- Multiple selected units use v1 group move:
  - click destination computes one route per selected unit,
  - each unit preserves its relative lng/lat offset from the group center, using the clicked point as the new group center,
  - one `SUBMIT_MOVE_ORDER` command is submitted per unit through `CommandQueue`,
  - local DR is seeded per unit so movement feedback starts immediately.
- Multi-selected shift waypoint chaining is out of scope for v1; shift behavior remains single-unit only.

## Input Behavior
- Single click on a unit selects only that unit.
- Drag box selects every own unit inside the box.
- Clicking empty map clears current unit selection.
- Province selection/highlights are cleared once a drag selection starts or a unit selection is committed.
- Right-click behavior remains limited to existing move-chain ghost removal; group movement uses `M` + left click.

## Test Plan
- Run `godot --headless --path client --quit`.
- Manual debug-map smoke tests:
  - drag over one unit: grey preview appears, release selects it,
  - drag over multiple own units: all selected units show committed selection hover,
  - empty drag clears selection,
  - single-click selection still works,
  - `M` then click with multiple units submits and displays movement for each selected unit,
  - one selected unit still supports existing shift-chain behavior,
  - enemy/foreign units are not box-selected when player nation is known.

## Assumptions
- V1 uses client-only selection state; `GameState` remains read-only.
- Group movement sends existing per-unit `SUBMIT_MOVE_ORDER` commands instead of adding a new server command.
- Formation movement is preferred over all units pathing to the exact same waypoint to reduce clumping.
- The current branch has the prior collision work excluded, so this plan targets the clean single-selection code currently present.
