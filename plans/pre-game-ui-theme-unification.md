# Pre-Game UI Theme Unification

## Summary
Apply `res://assets/themes/hud_dark.tres` to the main menu and lobby/country selection UI so they match the in-game HUD style.

## Key Changes
- Add the HUD dark theme to the root controls of `main_menu.tscn` and `lobby.tscn`.
- Let dynamically created lobby nation buttons and player labels inherit the lobby root theme.
- Extend `hud_dark.tres` with matching `LineEdit` and `HSeparator` styling.
- Preserve existing layouts, signals, scripts, and font-size overrides.

## Test Plan
- Run headless scene validation for the main menu and lobby scenes.
- Confirm login/join fields, buttons, labels, separators, and generated nation buttons use the dark/bronze visual style.
