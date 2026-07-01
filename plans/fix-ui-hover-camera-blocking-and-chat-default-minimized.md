# Fix UI Hover Camera Blocking And Start Chat Minimized

## Summary
- Replace root `mouse_entered/mouse_exited` hover tracking with rect-based pointer detection over registered visible HUD roots.
- This fixes camera edge movement while hovering nested Controls such as active buttons, disabled `U`/`I` dock buttons, labels, and icon containers.
- Make the chat panel start minimized by default while preserving Enter-to-open behavior.

## Key Changes
- In `GameHUD`, store registered UI roots in an array and evaluate `get_global_rect().has_point(viewport_mouse)` each frame.
- Keep using `EventBus.ui_pointer_blocking_changed` as the public signal; no new EventBus API is needed.
- Keep text-input focus tracking as-is for keyboard camera suppression.
- Keep chat-specific click-outside behavior as-is.
- In `ChatPanel`, default `is_maximized` to `false`, and set the chat panel's toggle instance to minimized in `chat_panel.tscn`; do not change the reusable toggle button's default for other UIs.

## Test Plan
- Update `test_hud_manager.gd` to assert pointer blocking works when the pointer is inside `LeftDockRail`, nested dock buttons, disabled dock buttons, and `ChatPanel`.
- Update chat tests to expect minimized startup, while preserving Enter/open-chat maximization.
- Run focused Godot HUD/chat tests plus server `npm test` and `npm run build`.

## Assumptions
- UI hover should suppress mouse-wheel zoom and edge-scroll over any visible registered HUD root, including disabled buttons.
- Chat should still maximize automatically when pressing Enter/opening chat input.
- The reusable maximize/minimize button scene should remain maximized by default for future UIs; only the chat instance changes.
