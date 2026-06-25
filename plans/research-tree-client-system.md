# Client Research Tree System

## Summary

Build a client-side research prototype under `client/` using JSON-authored research data, a new standalone research scene, and local `EventBus` signals. The system supports table-style row progression, one active research at a time, paused progress when switching active entries, entry durations, and named mutually exclusive groups.

This plan intentionally does not implement server authority yet. Other players will not reliably observe research completion until a later server phase handles `QUEUE_RESEARCH`, authoritative research state, and broadcasts.

## Key Changes

- Add research definitions as JSON at `res://src/systems/research/research_tree.json`.
- Add `research_system.gd`, `research_entry_card.gd`, and `research_tree_view.gd` under `res://src/systems/research/`.
- Add `res://scenes/systems/research/research_tree.tscn` as a full-center overlay/control scene.
- Add `EventBus` signals for research start, progress, completion, and rejection.
- Add a small sample tree with Infantry, Tank, and Air columns until final content exists.

## Behavior

- Entries include `id`, `column`, `row`, `title`, `description`, `duration_seconds`, optional `effects`, and optional `exclusive_group`.
- Row `0` entries are available by default.
- Completing any entry in row `N` unlocks all entries in row `N + 1`.
- Clicking an available entry starts or resumes it.
- Only one entry progresses at a time.
- Switching active entries preserves paused progress on the old entry.
- Entries sharing an `exclusive_group` conflict once one entry in that group is researched or has any progress.

## Test Plan

- Add a focused Godot test for first-row availability, row unlocks, paused progress, exclusivity, and completion signals.
- Run a Godot headless project/script load check from `client/`.
- Manually smoke test the scene in the editor.

## Assumptions

- `duration_seconds` is measured in real seconds for the prototype.
- Research state is local client prototype state, not persisted and not written into `GameState`.
- Server integration is deferred. When added, `ResearchSystem` should submit `QUEUE_RESEARCH` through `CommandQueue`, and completion should come from server state/events rather than local timers.
