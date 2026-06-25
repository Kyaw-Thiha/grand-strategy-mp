# Pause Menu Blur And Input Blocking

## Goal

Make the pause overlay feel stronger visually and ensure the player cannot interact with the underlying game while the pause menu is open. The game must continue processing normally because multiplayer simulation is not locally paused.

## Scope

1. Increase the pause background blur strength.
2. Emit a UI blocking signal when the pause menu opens and clear it after the close animation finishes.
3. Block player input in input-owning systems while the pause menu is blocking:
   - HUD keyboard shortcuts;
   - camera keyboard/edge/wheel scrolling;
   - province hover/click interaction;
   - map debug military input forwarding.
4. Keep pause menu controls interactive.
5. Do not pause the scene tree or change multiplayer simulation flow.

## Verification

1. Load the project headlessly.
2. Load the pause menu scene headlessly.
3. Load the map debug scene headlessly.
4. Manual smoke test:
   - open pause menu;
   - verify blur is stronger;
   - verify HUD/map/unit/camera input does not react behind it;
   - verify Continue, Escape, Settings, and Quit still work.
