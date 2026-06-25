# Main Menu Background Card

## Summary
Wrap the main menu controls in a rounded dark card so the menu presentation matches the pause menu.

## Key Changes
- Add a local rounded `StyleBoxFlat` to `main_menu.tscn` using the pause menu's dark fill, bronze border, and shadow.
- Insert a centered `PanelContainer` between the existing `CenterContainer` and menu `VBox`.
- Reparent the existing login/post-login controls into the card without changing names, unique-name references, or script behavior.
- Update button signal paths to match the new node hierarchy.

## Test Plan
- Run headless validation for `res://scenes/main_menu/main_menu.tscn`.
- Confirm existing login, create, join, and browse signal wiring still resolves.
