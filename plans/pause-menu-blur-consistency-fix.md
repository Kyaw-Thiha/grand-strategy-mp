# Pause Menu Blur Fix

## Summary

Fix the pause-menu blur so it renders consistently and looks subtle. The issue is the blur overlay is hidden and the screen-copy path is underconfigured, while the blur strength is much higher than needed.

## Key Changes

- In `client/scenes/game/pause_menu.tscn`:
  - Make `BlurOverlay` visible by default within the pause menu scene; the parent `PauseMenu` already controls overall visibility.
  - Configure `BackBufferCopy` for a full-screen viewport copy so the shader samples a stable background in fullscreen and windowed modes.
- In `client/src/ui/game/pause_menu.gd`:
  - Reduce `TARGET_BLUR_STRENGTH` from `15.0` to `3.0`.
  - Keep the existing dim overlay and open/close animations unchanged.
  - Do not change pause input blocking, menu buttons, settings behavior, quit flow, or multiplayer simulation behavior.

## Test Plan

- Run `godot --headless --path client scenes/game/pause_menu.tscn` to confirm the pause menu scene loads.
- Run `godot --headless --path client scenes/debug/map_debug.tscn` to confirm the integrated game/debug scene loads.
- Manual check in Godot:
  - Open the map/game scene.
  - Press Escape to open the pause menu.
  - Confirm background blur is visible immediately in fullscreen.
  - Toggle fullscreen/windowed and confirm blur remains stable.
  - Confirm blur is subtle, not heavily smeared.
  - Close via Continue, Escape, and background click.

## Assumptions

- The intended effect is a light background softening plus the existing dark dim, not a strong frosted-glass blur.
- A shader-based screen-texture blur remains acceptable; no new viewport snapshot system is needed for this fix.
