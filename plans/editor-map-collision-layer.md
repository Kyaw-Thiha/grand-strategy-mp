# Editor Map Collision Layer

## Summary

Separate generated map visuals from generated interaction collision.

## Implementation

- Add a hidden `CollisionLayer` sibling beside `Provinces`.
- Keep `Provinces` visual-only: fills, borders, city labels, city icons, unit anchors, marker dots.
- Move generated `Area2D` and `CollisionPolygon2D` nodes into `CollisionLayer`.
- Set `province_id` and `polygon_index` metadata on each collision area and shape.
- Use deterministic names for multi-part fills, borders, and collision areas.
- Keep invalid rings skipped for fill/collision while borders remain visible.

## Test Plan

- Parse-check the editor script.
- Regenerate `western_europe_6.tscn`.
- Confirm `CollisionLayer` exists and is hidden by default.
- Confirm `Provinces` no longer contains `Clickbox` nodes.
- Confirm the generated scene loads without duplicate-node or triangulation warnings.
