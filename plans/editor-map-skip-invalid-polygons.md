# Editor Map Skip Invalid Polygons

## Summary

Prevent generated map scenes from saving polygon data that Godot cannot triangulate.

## Implementation

- Validate generated `PackedVector2Array` rings with `Geometry2D.triangulate_polygon()`.
- Assign rings to `Polygon2D` and `CollisionPolygon2D` only when they triangulate.
- Keep province borders even when a fill/collision polygon is skipped.
- Skip invalid water and overlay polygons.
- Print a summary warning for skipped polygons.

## Test Plan

- Parse-check the editor script.
- Regenerate `western_europe_6.tscn`.
- Load the generated scene and confirm the triangulation error spam is gone.
