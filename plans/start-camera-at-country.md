# Start Camera At Selected Country

## Summary

Center the game camera on the player’s selected country when the map scene loads, using that nation’s `capital_province_id` from `nations.json`.

## Implementation

- Read the local player’s nation from `GameState.get_my_nation_id()` after the map finishes loading.
- Load nation metadata from `res://assets/data/<map_id>/nations.json`.
- Find the selected nation’s `capital_province_id`.
- Pan the existing `CameraSystem` to the capital province.
- Keep the current camera position unchanged if no player nation or valid capital province exists.

## Test Plan

- Start as United Kingdom, France, Germany, Italy, Spain, or Algeria and confirm the camera starts on that country’s capital province.
- Run the debug map scene without a selected nation and confirm the existing camera position is preserved.
- Run a Godot headless parse check for the touched scene/scripts.

## Assumptions

- “At the country” means the selected nation’s capital province for this pass.
- The startup zoom should stay unchanged.
- This is display-only and must not mutate `GameState`.
