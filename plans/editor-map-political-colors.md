# Editor Map Political Colors

## Summary

Bake initial political province colors into generated map scenes.

## Implementation

- Add the runtime nation palette to `map-generator.gd`.
- Generate province nodes as plain `Node2D` trees instead of `province.tscn` instances so polygon and color data is saved directly.
- Color all province fill polygons from `province_data.nation_id`.
- Keep city and port marker colors unchanged.
- Update editor map generation docs.

## Test Plan

- Parse-check the editor script.
- Regenerate `res://scenes/map/western_europe_6.tscn`.
- Confirm political colors are serialized in the generated scene.
- Confirm duplicate inherited node warnings do not return.
