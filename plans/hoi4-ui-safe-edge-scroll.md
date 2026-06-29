# HOI4-Style UI-Safe Edge Scroll

## Summary
Fix camera runaway by making edge-scroll a map-only pointer action, matching Hearts of Iron IV-style behavior: the camera pans at exposed map edges, but HUD/UI regions do not count as active edge-scroll zones.

## Key Changes
- Add lightweight UI pointer ownership signals through `EventBus`.
- Update `CameraSystem` so UI hover disables mouse edge-scroll and mouse-wheel map zoom, while text input focus disables keyboard camera movement too.
- Publish UI pointer blocking from HUD-owned interactive roots: top bar, left dock, map mode controls, side panels, bottom selection panels, chat, and full-center overlays.
- Keep existing pause/menu blocking as the stronger all-player-camera-input-off state.

## Test Plan
- Hover chat at bottom-right edge: camera does not edge-scroll.
- Focus chat input and type WASD: camera does not move.
- Hover side panel at left edge: camera does not edge-scroll.
- Hover top bar or dock rail near screen edge: camera does not edge-scroll.
- Move cursor from UI to exposed map edge: edge-scroll resumes.
- Use WASD while hovering a non-text panel: camera still moves.
- Mouse wheel over UI does not zoom map; mouse wheel over map still zooms.
- Add/extend a headless Godot test for `CameraSystem` edge-scroll suppression state.

## Assumptions
- Keep current edge-scroll speed and curve; the bug is input ownership, not speed tuning.
- Do not add Civ-style drag-pan now because drag already conflicts with multi-select.
- Middle-mouse drag-pan can be considered later as an optional secondary camera control.
