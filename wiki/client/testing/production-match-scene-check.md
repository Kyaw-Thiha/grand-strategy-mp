# Production Match Scene Check

This check confirms that the normal match scene loads the selected map without quietly creating the sample armies, air wings, player identity, or nation assignment used by the debug scene.

# Details

## Headless check

Run `godot --headless --path client test/test_game_scene_no_debug_fixtures.tscn`. The test sets `GameState.map_id` to `western_europe_6`, loads `client/scenes/game/game.tscn`, and verifies that the scene leaves the debug-only collections empty.

It also checks that a province’s political color follows current `GameState` ownership rather than the map file’s initial owner. This covers the live map-data adapter used by `client/src/game/map_scene.gd`.

## Related focused checks

Run `godot --headless --path client scenes/test/test_map_debug_air_wing_right_click.tscn` to retain the debug scene’s province-to-air-order behavior, and use the air-wing scene checks when changing flight display or input behavior.

# Related Notes

- [[client/testing/index|Testing]]
- [[client/testing/test-scenes-and-workflows|Client Test Scenes and Workflows]]
- [[client/map/match-scene-composition|Production Match Scene]]
- [[client/debugging/map-debug-scene|Map Debug Scene]]
