# Map Debug Scene

The map debug scene lets developers inspect the western-Europe map, army controls, air-wing controls, vision, and HUD without creating or joining a multiplayer match. It adds sample forces only when the relevant match data is empty.

# Details

## Scene role

`client/scenes/debug/map_debug.tscn` remains the current diagnostic scene and the current `SceneManager` game target. Its script, `client/src/debug/map_debug.gd`, extends the shared map composition but fixes the map to `western_europe_6` and creates sample divisions, air wings, and a debug nation for visual inspection.

## Fixture boundary

The injected data is intentionally restricted to this diagnostic scene. The production match scene has no fixture injection and requires the map ID and match state announced by the game server.

MapDebug adds one sample division per playable nation and five sample air-wing types per listed capital only when the corresponding `GameState` collection is empty. It also creates a debug player/nation assignment when needed so vision can be inspected.

These writes deliberately bypass the live networking boundary. They are fixtures for visual diagnostics, not an example for production UI or gameplay systems.

## Diagnostic use

Run the scene from the Godot editor with Run Current Scene to inspect political, cover, and elevation modes; camera and province input; division and air-wing selection; movement previews; vision; panels; pause; chat; combat markers; and responsive HUD layout.

The scene still shares most composition code with the unwired production scene. A successful MapDebug check therefore does not prove that normal play is fixture-free or that `SceneManager` points at the production scene.

Focused automated checks are listed in [[client/testing/test-scenes-and-workflows|Client Test Scenes and Workflows]].

# Related Notes

- [[client/debugging/index|Debugging]]
- [[client/map/match-scene-composition|Production Match Scene]]
- [[client/testing/production-match-scene-check|Production Match Scene Check]]
- [[client/testing/test-scenes-and-workflows|Client Test Scenes and Workflows]]
