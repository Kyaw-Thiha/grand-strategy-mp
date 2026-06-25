# Wire Research Tree Into HUD

## Summary
Replace the empty fifth left-dock button `U` with a real research button labeled `RESe`, using `res://assets/icons/atom-solid-full.svg`, and wire it to the existing research tree scene at `res://scenes/systems/research/research_tree.tscn`. The existing `Q` resource button remains separate and untouched.

## Key Changes
- In `game_hud.tscn`, add the atom icon resource and restyle `DockButton_U` to match the other dock buttons:
  - enabled button
  - vertical content layout
  - tinted atom icon
  - shortcut label `U`
  - name label `RESe`
- Replace the old placeholder `ResearchPanel` instance with the actual `research_tree.tscn` instance, registered as the `"research"` HUD panel.
- In `game_hud.gd`, wire only `DockButton_U` and `KEY_U` to `"research"`.
- Leave the existing `Q` / `RES` resource button behavior alone.

## Research Panel Behavior
- The research tree should be created once as part of the HUD scene and hidden/shown through `HUDManager`, not recreated when opened.
- Closing the research tree must go through HUD ownership, so overlay state, active dock button state, and panel registry state stay correct.
- Add a lightweight close signal from `research_tree_view.gd`, emitted by the Close button and Escape handling.
- `GameHUD` listens for that signal and calls `hud_manager.hide_panel("research")`.
- Do not reset `ResearchSystem` when closing/reopening; progress continues because the same node instance remains alive.
- Keep the current prototype behavior where research advances while the node exists, even when the panel is hidden.

## Test Plan
- Run `godot --headless --path client --quit`.
- Run `godot --headless --path client res://scenes/debug/map_debug.tscn --quit`.
- Manual smoke test:
  - Press/click `U` and confirm the research tree opens.
  - Click Close and press Escape while open; confirm the overlay and active dock state clear correctly.
  - Start research, close the tree, reopen it, and confirm progress/completed state did not reset.
  - Confirm `Q` / `RES` is not changed by this work.

## Assumptions
- `U` is the intended shortcut for the research tree.
- `Q` / `RES` is already the resource component and must remain separate.
- Research remains client-local prototype state for now; no server command or `GameState` mutation is added.
