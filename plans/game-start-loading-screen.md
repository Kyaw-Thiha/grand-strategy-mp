# Game Start Loading Screen Plan

## Goal

Add a loading screen between lobby game start and the game scene.

## Phases

1. Add a loading scene and script with background rotation, tips, and progress bar.
2. Route `SceneManager.goto_game()` through the loading scene.
3. Let the loading scene load the target game scene using Godot threaded loading.
4. Validate scene loading headlessly.
