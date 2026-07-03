# Settings Page Enhancement

## Summary

Replace the current keybind-only settings overlay with a tabbed settings panel that has a left navigation bar and right-side content pages. Reuse the same settings overlay from the pause menu and add a Settings button to the logged-in main menu flow before Create Game.

## Key Changes

- Update the existing settings scene/script so the panel has left tabs: Control, Sound, Display, Advanced, and Mods.
- Keep Control as the existing keybind/remap system, including reset buttons and key capture behavior.
- Add UI-only placeholder pages for Sound, Display, Advanced, and Mods.
- Add a Settings button to the main menu post-login controls before Create Game.
- Main menu and pause menu open the same settings overlay.

## Test Plan

- Add or update Godot UI tests for settings opening, tab switching, keybind page preservation, sound sliders, advanced toggle, and mods text.
- Run Godot headless UI tests and `git diff --check`.
