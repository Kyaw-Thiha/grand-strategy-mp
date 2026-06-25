# Fix Research Tree Panel Sizing

## Summary
The research tree is shown through `HUDManager` as a `FULL_CENTER` panel, but `HUDManager._center_panel()` shrinks full-center panels to their minimum size. That collapses the research tree to the title/status area, hiding the grid. Fix the panel sizing so the research tree uses the full center overlay area.

## Key Changes
- Update `HUDManager` full-center sizing behavior:
  - If a full-center panel is authored as a full-rect Control, keep it full-size inside `CenterPanelAnchor`.
  - Preserve centered minimum-size behavior for non-full-rect panels.
- Ensure `ResearchTree` remains full-rect when registered under `CenterPanelAnchor`, so its `OuterMargin`, `ScrollContainer`, and `ResearchGrid` receive enough space.
- Keep the existing research close flow through `close_requested` and `hud_manager.hide_panel("research")`.
- Do not recreate the research tree on open/close, so progress still does not reset.

## Test Plan
- Run `godot --headless --path client --quit`.
- Run `godot --headless --path client res://scenes/debug/map_debug.tscn --quit`.
- Manual smoke test:
  - Open research with `U`.
  - Confirm the full research panel appears, including all cards/grid, not just title/status.
  - Close with the Close button and Escape; confirm overlay/dock state clears.
  - Start research, close, reopen, and confirm progress persists.

## Assumptions
- The actual research tree should be a large/full overlay, matching how `research_tree.tscn` is authored.
- No redesign of card layout, fonts, or research data is included in this fix.
