# Bottom Selection Panels Safe Layout

## Summary
- Apply sidebar-safe and bottom-gap positioning to all bottom selection panels.
- Keep chat anchored independently on the bottom right.
- Compact the friendly division panel because it is the widest bottom panel.

## Key Changes
- Use the left dock right edge plus a gap as the left boundary for bottom selection panels.
- Reserve a bottom gap below selection panels so players can edge-scroll under them.
- Clamp panel width to available space before positioning, so panels do not overlap the left dock or chat.
- Reduce fixed widths and spacing in `friendly_division_panel.tscn`.

## Test Plan
- Add HUD tests covering all bottom selection panel positions.
- Run focused Godot HUD/chat tests plus server build/test verification.
