# Chat Polish And Input Focus

## Summary

Make chat less visually dominant, mask sender emails, and block gameplay/HUD hotkeys while the chat text box has focus.

## Implementation

- Restyle chat as a transparent overlay with no strong border.
- Mask emails in full chat messages and minimized latest-message preview.
- Remove bold styling from sender emails.
- Hide `ROOM CHAT` and `ENTER` while minimized; keep the toggle visible.
- Emit chat input focus through EventBus and make HUDManager, CameraSystem, MapInteraction, and MapDebug respect it.

## Verification

- Extend chat panel tests for email masking, focus blocking signal, minimized header hiding, and compact preview behavior.
- Extend HUDManager tests for ignoring shortcuts while chat input is focused.
- Run focused Godot tests and available server checks.
