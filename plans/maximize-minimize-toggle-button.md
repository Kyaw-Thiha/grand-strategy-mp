# Reusable Maximize/Minimize Toggle Button

## Summary
Add a reusable Godot UI scene for a two-state maximize/minimize icon button. The button owns only its visual toggle state and emits its state through the standard `Button.toggled` signal, so chat and future panels can decide what maximized or minimized means.

## Key Changes
- Add `client/scenes/game/components/maximize_minimize_toggle_button.tscn`.
- Add `client/src/ui/components/maximize_minimize_toggle_button.gd`.
- Use `res://assets/themes/hud_dark.tres`, compact icon-only sizing, and `expand_icon = true`.
- When maximized, show `res://assets/icons/up-right-and-down-left-from-center-solid-full.svg`.
- When minimized, show `res://assets/icons/down-left-and-up-right-to-center-solid-full.svg`.
- Add one instance to the chat header without changing chat minimize/maximize layout behavior yet.

## Test Plan
- Add a headless Godot test for initial state, icon swapping, state emission, and second toggle restore.
- Extend chat panel test to verify chat includes the reusable toggle button.
- Run the new toggle test and existing chat panel test.

## Assumptions
- This step only adds the reusable alternating button and places it in chat.
- Actual chat minimize/maximize layout behavior is a later step.
