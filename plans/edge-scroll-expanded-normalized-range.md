# Edge Scroll Expanded Normalized Range

## Summary
- Increase the camera edge-scroll detection range so UI-heavy screen edges still leave a usable scroll zone just inside the panels.
- Normalize scroll strength against the previous 120px ramp so the wider detection zone does not feel weak or sluggish.

## Key Changes
- Add separate camera constants for detection range and strength normalization.
- Use a 180px detection band with a 120px strength ramp.
- Keep existing UI pointer blocking behavior unchanged: cursor over UI still blocks edge scroll and wheel zoom.

## Test Plan
- Run focused Godot HUD/chat tests to ensure recent UI input ownership still works.
- Run server verification commands required by repo workflow.
- Manual check: hover just inside UI-heavy edges, outside UI rects, and confirm camera scroll starts before the old 120px line while remaining blocked over panels.
