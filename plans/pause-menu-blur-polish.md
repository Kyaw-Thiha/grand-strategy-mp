# Pause Menu Blur Polish

## Goal

Make the pause menu feel more deliberate and visually consistent by replacing the flat square panel with a rounded HUD-style panel and animating the background blur on open and close.

## Scope

1. Add a screen-sampling blur overlay behind the pause panel.
2. Keep the existing dim overlay as the input-blocking layer and animate its alpha.
3. Give the pause panel rounded corners, warm border styling, padding, and shadow.
4. Animate pause menu entry and exit:
   - blur strength fades in and out;
   - dim alpha fades in and out;
   - panel opacity and scale ease in and out.
5. Keep all existing button behavior unchanged.

## Verification

1. Load the Godot project headlessly to catch parse/resource errors.
2. Load the map debug scene headlessly if available.
3. Manual smoke test in-game:
   - open pause menu;
   - close via Continue, Escape, and background click;
   - confirm Settings still opens;
   - confirm Quit still returns to main menu flow.
