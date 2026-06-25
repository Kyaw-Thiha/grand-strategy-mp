# Apply HUD Theme To Research Tree

## Summary
Unify the research tree with the in-game HUD by applying `res://assets/themes/hud_dark.tres` to the research scene and removing the visual mismatch caused by research-specific gray styles. Keep the research state colors, but shift them into the same dark brown/gold HUD palette.

## Key Changes
- In `research_tree.tscn`, add `hud_dark.tres` as a theme resource and set it on the root `ResearchTree` so labels, buttons, panels, and inherited controls use the same HUD theme.
- Remove the duplicated inspector-authored gray card styleboxes from the research scene where they are only placeholders for runtime card styling.
- Update `research_entry_card.gd` runtime styles to match the HUD palette:
  - available: dark HUD brown panel with muted gold border
  - active: same base with brighter gold border
  - researched: muted green-tinted completion state, still compatible with the HUD theme
  - locked: dimmed dark brown, not neutral gray/black
- Keep the current layout, research data, progress behavior, close behavior, and HUDManager sizing fix unchanged.
- Do not change the global `hud_dark.tres` unless Godot requires a missing control style to prevent default bright UI from leaking through.

## Test Plan
- Run `godot --headless --path client --quit`.
- Run `godot --headless --path client res://scenes/debug/map_debug.tscn --quit`.
- Run `godot --headless --path client --scene res://scenes/test/test_hud_manager.tscn`.
- Manual smoke test:
  - Open research with `U`.
  - Confirm title, Close button, panel background, labels, and cards visually match the rest of the HUD.
  - Confirm locked/available/active/researched cards remain distinguishable.
  - Start research, close, reopen, and confirm progress still persists.

## Assumptions
- The desired direction is the existing dark brown/gold HUD style, not the current gray research prototype style.
- Research cards may keep state-specific colors as long as they use the HUD palette.
- This task is visual/theme-only; no research logic or server authority work is included.
