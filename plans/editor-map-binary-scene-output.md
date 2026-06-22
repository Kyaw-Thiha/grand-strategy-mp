# Editor Map Binary Scene Output

## Summary

Save generated map scenes as binary `.scn` files instead of text `.tscn` files.

## Implementation

- Change the editor map generator output path from `.tscn` to `.scn`.
- Update editor map generation docs to describe binary generated scene output.
- Regenerate the default `western_europe_6` map scene.
- Remove the stale generated `.tscn` map scene after confirming `.scn` output works.

## Test Plan

- Parse-check the editor script with Godot 4.7.
- Run the generator headlessly.
- Confirm `res://scenes/map/western_europe_6.scn` is created.
- Load the generated `.scn` scene headlessly.
