# Chat Toggle And Enter Keybind

## Summary

Fix the minimized chat maximize button so it remains clickable, style it like a bordered HUD button, and wire the existing `chat_team` keybind to open and focus chat.

## Implementation

- Keep the max/min toggle directly inside layout containers in both maximized and minimized states.
- Add bordered normal, hover, pressed, and focus styles to the reusable toggle button scene.
- Add `open_chat_input()` and `is_message_input_focused()` to `ChatPanel`.
- Handle the `chat_team` action in `GameHUD` when chat is not already focused.

## Verification

- Extend chat panel and toggle button tests for clickable minimized restore, style overrides, and chat input focusing.
- Extend HUD test coverage for Enter opening/focusing chat from minimized state.
- Run focused Godot tests and available server checks.
