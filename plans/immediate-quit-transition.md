# Immediate Quit Transition Plan

## Goal

Make the pause-menu Quit button show the loading transition immediately.

## Phases

1. Move the loading transition before room disconnect in the Quit handler.
2. Defer disconnect so it does not block the click-to-transition visual response.
3. Validate the pause menu scene loads.
