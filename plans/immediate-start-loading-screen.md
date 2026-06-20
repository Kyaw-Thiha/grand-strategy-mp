# Immediate Start Loading Screen Plan

## Goal

Show the loading screen immediately when the host clicks Start, then wait for the server to confirm `GAME_STARTED` before loading the game scene.

## Phases

1. Add a SceneManager loading mode that can wait for server confirmation.
2. Make the lobby Start button enter that loading mode immediately after sending `START_GAME`.
3. Let SessionManager release or cancel the waiting loading screen from server events.
4. Adjust loading progress to use staged waiting/server and scene-loading progress.
5. Validate with headless Godot scene loads.
