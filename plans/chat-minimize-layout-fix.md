# Chat Minimize Layout Fix

## Summary

Fix minimized chat so the panel shrinks to compact content height, stays anchored to the bottom-right, and shows the latest message as a one-line preview with ellipsis overflow.

## Implementation

- Replace the minimized RichTextLabel preview with a horizontal preview row containing time, email, and message labels.
- Keep the message label single-line with ellipsis overflow.
- Emit a chat panel layout signal after maximize/minimize changes.
- Connect GameHUD to that signal and rerun bottom HUD layout so the explicit chat panel size is refreshed.
- Reset the chat panel size to its current combined minimum size when the state changes.

## Verification

- Extend the chat panel test for one-line preview labels, ellipsis configuration, compact minimized height, and input row visibility.
- Extend the HUD manager test to confirm minimizing chat reduces its size and keeps it bottom-right anchored.
- Run the focused Godot tests for chat, toggle button, and HUD manager.
