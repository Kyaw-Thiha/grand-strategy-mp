# Chat Focus Exit And Minimized Toggle

## Summary

Allow players to leave chat typing mode with Escape, successful send, or outside click, and move the minimized max/min toggle to the rightmost position.

## Implementation

- Add `close_chat_input()` to release chat text focus without hiding the chat panel.
- Handle Escape inside the chat TextEdit and consume it so the pause menu does not open.
- Release focus after successfully sending a non-empty message.
- Let GameHUD release chat focus when a mouse click occurs outside the chat panel.
- Keep the minimized toggle button as the rightmost child in the minimized row and reduce its alpha while minimized.

## Verification

- Extend chat tests for Escape blur, send blur, blank Enter retaining focus, and rightmost minimized toggle.
- Extend HUD tests for outside-click blur and inside-click retention.
- Run focused Godot tests plus available server checks.
