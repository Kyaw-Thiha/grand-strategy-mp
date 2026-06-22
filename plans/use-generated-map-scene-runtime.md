# Use Generated Map Scene At Runtime

## Summary

Load generated binary map scenes at runtime instead of rebuilding map visuals from JSON.

## Implementation

- Keep `MapLoader` as the public facade for map systems.
- Continue loading JSON metadata for province data, adjacency, terrain lookup, waypoints, projection, camera focus, and UI.
- Instance `res://scenes/map/<map_id>.scn` and adopt its generated layers as direct children of `MapLoader`.
- Index province nodes from the generated `Provinces` layer.
- Index click areas from the generated `CollisionLayer` using `province_id` metadata.
- Update `MapInteraction` to connect to generated click areas through `MapLoader`.

## Test Plan

- Parse-check changed GDScript with Godot 4.7.
- Load `res://scenes/debug/map_debug.tscn` headlessly.
- Confirm map load emits the expected province count.
- Confirm overlay, hover/click, camera, and military pathfinding still use the same public `MapLoader` API.
