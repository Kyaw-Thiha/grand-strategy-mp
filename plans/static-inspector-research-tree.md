# Static Inspector-Visible Research Tree

## Summary

Convert the research tree from JSON/dynamic UI generation to a scene-authored tree where all research cards exist directly in `research_tree.tscn`. Developers edit cards in the Godot inspector. In the editor, every card renders as locked/full-dark so the complete tree is visible but clearly inactive.

## Key Changes

- Replace runtime-spawned entry cards with permanent child nodes in `res://scenes/systems/research/research_tree.tscn`.
- Move research entry authoring onto exported fields in `research_entry_card.gd`.
- Update `research_tree_view.gd` to find existing `ResearchEntryCard` nodes, register their definitions with `ResearchSystem`, and refresh card visuals in place.
- Make `research_entry_card.gd` a `@tool` script so inspector edits update title/description/duration preview.
- Keep `ResearchSystem.load_from_definitions()` as the runtime state boundary and test target.
- Stop using `research_tree.json` at runtime.

## Test Plan

- Keep `research_system_test.gd` coverage for row unlocks, switching, progress, and exclusivity.
- Run a headless Godot scene load check for `research_tree.tscn`.
- Manual editor check: open the scene, confirm all cards are visible/selectable, locked in editor, and inspector edits update previews.

## Assumptions

- The Godot scene becomes the source of truth for authored research entries.
- Server integration remains deferred.
- Existing JSON can remain as an unused reference unless explicitly removed later.
