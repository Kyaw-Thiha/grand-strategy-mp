# Quit Loading Screen And Rotation Plan

## Goal

Route in-game Quit through the loading screen and make loading background rotation reliably avoid immediate repeats.

## Phases

1. Add a generic loading transition target to SceneManager.
2. Route pause-menu Quit through loading toward the main menu.
3. Tighten loading background rotation to avoid back-to-back repeats.
4. Validate loading, pause menu, and project scene loads.
