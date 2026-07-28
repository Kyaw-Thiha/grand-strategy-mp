# Map Data and Loading

The map loader turns a selected world map into the provinces, terrain, roads, cities, and movement graph that players see and use during a match.

# Details

## Current generated assets

`MapLoader`, implemented by `client/src/systems/map/map_loader.gd`, loads the map selected by `GameState.map_id` in normal play. MapDebug overrides that choice with `western_europe_6`.

The current client uses two kinds of generated input:

- `client/scenes/map/<map-id>.scn` contains baked display geometry and province collision areas, including province polygons, combined cover and elevation meshes, roads, rivers, cities, and other generated nodes.
- `client/assets/data/<map-id>/` still supplies JSON metadata used at runtime, including bounds, province records, adjacency, terrain lookup, nations, and the waypoint graph.

`MapLoader.load_map()` reads `map_data.json`, `terrain_lookup.json`, and `waypoints.json`, then instances the matching generated scene. It indexes province nodes and click areas so rendering, input, vision, and military systems can address them by province ID.

Generated visual CanvasItems need no per-item vision material. Runtime layer ordering
places cartography below the combined fog polygon and gameplay markers above it. The generator's binary
`ResourceSaver` output is not currently byte-deterministic across otherwise identical runs,
so verification checks scene behavior and structure rather than binary hashes.

**Current:** map geometry is already generated into `client/scenes/map/western_europe_6.scn`, but static map data is not fully baked into one Godot artifact. The broader optimization that decides which remaining JSON data should become generated Godot resources is still pending.

## Static and changing data

Province outlines, city positions, initial nation IDs, terrain, cover, elevation, adjacency, and waypoints are generated map data. They describe the geography rather than the current result of the match.

Province ownership can change during play. The production map data source combines the static province record from `MapLoader` with the current owner in `GameState`; it does not rewrite the generated scene. Divisions, air wings, relations, stacks, and other match-changing data also remain outside the generated map artifact.

## Projection and performance-sensitive data

`MapLoader` is the client boundary that converts longitude and latitude to the 4096×3000 Godot map canvas and back. Military and air systems use that service rather than maintaining separate projections.

The waypoint graph is currently a large JSON file loaded before `map_loaded` is emitted. `MilitarySystem` builds its pathfinder from that graph. Generated scene loading, JSON parsing, province indexing, border reconstruction, visibility-mask composition, and pathfinding are performance-sensitive areas; documentation of the current implementation does not imply that their pending optimization has been completed.

## Failure behavior

Loading fails when required map JSON is invalid, the generated `.scn` is absent or not a `PackedScene`, or required generated layers are missing. The production composition reports the error and returns to the lobby. MapDebug reports the failure but remains a diagnostic scene.

# Related Notes

- [[client/map/index|Client Map]]
- [[client/map/rendering-camera-and-interaction|Rendering, Camera, and Interaction]]
- [[client/map/match-scene-composition|Production Match Scene]]
- [[client/military/movement-and-pathfinding|Movement and Pathfinding]]
- [[game-server/maps-and-starting-state|Maps and Starting State]]
