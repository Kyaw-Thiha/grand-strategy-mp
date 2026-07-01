# Chat Minimize State

## Summary
Use the existing reusable `MaximizeMinimizeToggleButton` in the chat header to switch the chat panel between full chat log and minimized chat. In minimized mode, the chat panel remains usable but only shows the most recent message plus the message input row.

## Key Changes
- Add `ChatPanel.is_maximized` and `set_maximized(value)`.
- Connect `%MaximizeMinimizeToggleButton.toggled(is_maximized)` to the chat panel.
- Add a hidden latest-message preview in `chat_panel.tscn`.
- Full state shows the scrollback and hides the preview.
- Minimized state hides the scrollback, shows the latest-message preview, and keeps the text input/send button visible.
- Incoming messages continue to append to the full scrollback and update the minimized preview.

## Test Plan
- Extend `test_chat_panel.gd` to verify initial maximized state, minimized state, latest-message preview, visible input row, and restored full scrollback.
- Run the chat, toggle-button, and HUD manager headless Godot tests.

## Assumptions
- “Most recent message” means the latest valid received/appended chat message.
- Minimized chat still shows the header and toggle button so the user can maximize again.
