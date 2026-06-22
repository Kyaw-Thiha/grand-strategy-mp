# Editor Map Scene Generator

## Summary

Add `res://src/utils/map-generator.gd` as an `EditorScript` that converts an existing processed map asset folder into a saved Godot scene under `res://scenes/map/`.

## Implementation

- Add editable script settings:
  - `map_asset_root = "res://assets/data/western_europe_6"`
  - `output_scene_root = "res://scenes/map"`
- Derive the output filename from the input folder name, e.g. `western_europe_6.tscn`.
- Generate a static `Node2D` scene with the same visual layer names as the runtime map:
  - `WaterLayer`
  - `Provinces`
  - `CoverLayer`
  - `ElevationLayer`
  - `RiversLayer`
  - `RoadsLayer`
- Use the same projection constants and geometry rules as `MapLoader`.
- Instantiate `res://scenes/systems/map/province.tscn` for provinces.
- Set scene ownership before packing so all generated nodes are saved into the output scene.

## Test Plan

- Run a Godot headless project load check with isolated user data.
- Open Godot, run the editor script, and confirm `res://scenes/map/western_europe_6.tscn` is created.
- Open the generated scene and confirm the map is visible in the editor.

## Assumptions

- Stage one only adds the generator script; it does not wire generated scenes into gameplay.
- The generated scene filename is derived from the map asset folder name.
