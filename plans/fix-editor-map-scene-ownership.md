# Fix Editor Map Scene Ownership

## Summary

Fix generated map scenes opening with duplicate node warnings.

## Implementation

- Remove recursive ownership assignment from `map-generator.gd`.
- Assign scene ownership only to generated layer nodes, province instances, and extra generated child nodes.
- Leave inherited children from `province.tscn` unowned by the generated scene.
- Restore the default output directory to `res://scenes/map`.
- Remove the bad generated `res://scenes/maps/western_europe_6.tscn` output.

## Test Plan

- Parse-check `map-generator.gd` with Godot.
- Run the generator.
- Confirm generated provinces do not save duplicate `Fill2`, `Border2`, `Clickbox2`, `CityLabel2`, `CityIcon2`, or `UnitAnchor2` nodes.
