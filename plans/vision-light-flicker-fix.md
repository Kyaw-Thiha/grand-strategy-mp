# Vision Light Flicker Fix

## Summary
Stabilize vision lighting during movement by separating per-frame light position updates from throttled visibility-data refreshes.

## Key Changes
- Stop recomputing global visibility immediately on every `division_updated`.
- Mark moving-unit visibility dirty and refresh it at a capped interval.
- Keep division add/remove refreshes immediate so unit light nodes appear/disappear correctly.
- Reserve light budget for unit lights by capping owned-province lights separately.

## Test Plan
- Run headless validation for `res://scenes/debug/map_debug.tscn`.
- Smoke test moving one owned unit while other owned lights remain stable.
