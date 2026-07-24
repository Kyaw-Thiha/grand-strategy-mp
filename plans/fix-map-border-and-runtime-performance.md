# Fix Terrain Borders And Tick Hitches

## Summary

Fix the white nation-border artifact and reduce periodic stutter caused by per-tick visibility updates while preserving terrain-view behavior.

## Implementation Changes

- Build shared border topology once after map load. Keep active `Line2D` pairs resident and reuse hidden pairs from a pool; ownership changes update only edges touching the captured province.
- Apply border styling when each overlay line is created and after mode changes so pooled lines never use Godot's default white style.
- Cache province positions and spatially index them for vision queries instead of scanning every province for every friendly division.
- Cache owned-province visibility, emit visibility changes only when the set changes, and avoid repeated military icon visibility checks when inputs are unchanged.
- Move friendly vision lights by changing position only; rewrite texture/radius properties only when a light is created or its radius changes.

## Verification

- Run targeted headless Godot map/debug scenes.
- Switch political, cover, and elevation views and trigger ownership changes.
- Verify routes and province boundaries are unaffected by nation-border styling.
- Exercise the normal session path across multiple server ticks while moving and scrolling the map.
