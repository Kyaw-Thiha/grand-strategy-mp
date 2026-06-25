# Smooth Rounded Edge Camera Scrolling

## Summary
Replace the current fixed-speed, tiny-margin edge scroll with a wider smooth edge zone. The safe center area behaves like a rounded rectangle: moving near viewport edges scrolls gradually, and moving toward corners produces natural diagonal scrolling before the mouse reaches the extreme corner.

## Key Changes
- Update `client/src/systems/map/camera_system.gd` only.
- Replace the current `EDGE_MARGIN = 20` and constant `EDGE_SPEED = 900` behavior with:
  - `EDGE_SCROLL_BAND = 120.0`
  - `EDGE_MIN_SPEED = 180.0`
  - `EDGE_MAX_SPEED = 1400.0`
  - `EDGE_SPEED_CURVE = 1.35`
  - `EDGE_CORNER_RADIUS = 180.0`
- Keep WASD/arrow-key movement priority unchanged: keyboard movement still disables edge-scroll for that frame.
- Keep zoom scaling unchanged: camera movement remains divided by `_camera.zoom.x`.

## Edge Scroll Behavior
- Treat the viewport as an outer box and the no-scroll center as an inset rounded rectangle.
- If the mouse is inside the rounded safe zone, no edge scroll happens.
- If the mouse is outside the rounded safe zone:
  - scroll direction points away from the closest safe-zone edge/corner
  - speed increases smoothly as the mouse moves farther from the safe zone and closer to the viewport edge
  - corners produce normalized diagonal motion, so top-right, top-left, bottom-right, and bottom-left feel natural
- Use a gentle speed curve:
  - near safe zone: low speed
  - near screen edge/corner: max speed
  - no sudden jump from idle to full speed

## Test Plan
- Run `godot --headless --path client --quit`.
- Run `godot --headless --path client res://scenes/debug/map_debug.tscn --quit`.
- Manual smoke test:
  - Move mouse near each edge and confirm slow-to-fast scrolling.
  - Move mouse toward each corner and confirm diagonal scrolling starts before the exact corner.
  - Confirm edge scrolling feels less awkward than the old 20px margin.
  - Confirm WASD/arrow movement still takes priority.
  - Confirm zooming still works and camera bounds are respected.

## Assumptions
- A 120px edge band is the intended starting point for easier activation.
- A 1400px/s max edge speed is fast enough without feeling drastic.
- This feature affects camera edge-scroll only; drag panning, zooming, HUD behavior, and map selection logic are unchanged.
