# HUD Button Icons

## Summary
Add the requested SVG icons to the HUD while keeping layout compact and consistent. Use inline-left icons in the topbar, icon-above-text in the left dock, and inline-left icons in map mode buttons. Empty icon entries reserve space so layout does not shift when icons are added later.

## Key Changes
- Update `client/scenes/game/game_hud.tscn` only unless Godot requires minor script references after scene validation.
- Add `ext_resource` entries for:
  - `hand-fist-solid-full.svg`
  - `cubes-stacked-solid-full.svg`
  - `scale-balanced-solid-full.svg`
  - `person-military-rifle-solid-full.svg`
  - `handshake-solid-full.svg`
  - `landmark-dome-solid-full.svg`
  - `mountain-solid-full.svg`
- Preserve current button node names and unique names so `game_hud.gd` continues to find:
  - `%BtnMapPolitical`, `%BtnMapCover`, `%BtnMapElevation`
  - `DockButton_Q/E/T/Y`

## Layout Design
- Topbar resources: each resource item uses an inline `18x18` icon slot left of the label; empty-icon resources reserve the same slot.
- Left dock: keep `72x72` buttons, with centered `24x24` icon above compact shortcut/label text.
- Map modes: keep horizontal buttons, with a `16x16` icon slot left of each label; COVER reserves a blank slot.

## Test Plan
- Run `godot --headless --path client --quit`.
- Run `godot --headless --path client res://scenes/debug/map_debug.tscn --quit`.
- Manual HUD check: topbar alignment, dock button panel toggles, map mode buttons, blank icon slots, and icon contrast.

## Assumptions
- Empty icon entries mean reserve icon space but do not add placeholder art.
- The left dock order remains RES, ECO, MIL, DIP.
- This is a visual scene update only; no game state, command, server, or API changes.
