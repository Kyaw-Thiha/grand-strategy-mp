# Task 1 — Client Event Plumbing for SUPPLY_ROUTE_UPDATE

## Where this fits
Batch 7 (client-only) adds a supply-line visualization overlay. This task wires the raw
server event into GameState so a later renderer task can consume it. Purely mechanical:
mirror an existing pattern exactly, in three files.

## Files to modify
- `client/src/core/event_bus.gd`
- `client/src/core/game_state.gd`
- `client/src/systems/session/session_manager.gd`

## Exact requirements

### 1. `event_bus.gd`
Add one new signal, placed near the other supply/division-related signals (e.g. near
`signal supply_hub_completed(province_id: String)` at line 13, or near the division
signals section — pick whichever existing grouping in the file reads more natural):

```gdscript
signal supply_route_updated(division_id: String, route: Dictionary)
```

### 2. `game_state.gd`
Add a new cache dictionary, mirroring the existing `air_wing_paths: Dictionary = {}` cache
pattern (declared around line 39, with a doc comment above it in the same style):

```gdscript
var supply_routes: Dictionary = {}  # division_id → last-received SupplyRoute dict
```

Do NOT add any `last_known_supply_path` cache — a prior draft of this spec included one but
it has been dropped. `supply_routes` simply stores whatever the server last sent for that
division, overwritten each update, nothing more.

Add a new handler function, following the exact style of the existing `_apply_*` methods
(e.g. `_apply_supply_hub_completed` around line 193, or `_apply_air_wing_path` around line
382 — both are one-liner-ish handlers that store into a dict and emit a signal):

```gdscript
## Stores the latest server-authoritative supply route for one division and notifies
## listeners. GameState never recomputes route/supply data — this is a straight cache
## write of what the server sent.
func _apply_supply_route_update(data: Dictionary) -> void:
	var division_id: String = data.get("divisionId", "")
	supply_routes[division_id] = data
	EventBus.supply_route_updated.emit(division_id, data)
```

Check whether `game_state.gd` has a `clear()`/reset function (search for where
`air_wing_paths.clear()` is called, around line 65) that resets all per-match caches on
game reset/reconnect. If so, add `supply_routes.clear()` there too, in the same place, for
consistency with the other caches — do not skip this, a stale cache surviving a reset would
be a real bug matching the existing bug class this file already guards against.

### 3. `session_manager.gd`
Add one case to the existing `match type:` dispatch block (starts around line 15), in the
same style as the other cases, e.g. right by `"SUPPLY_HUB_COMPLETED"` around line 97-98:

```gdscript
"SUPPLY_ROUTE_UPDATE":
	GameState._apply_supply_route_update(data)
```

## Global constraints
- `GameState` is read-only from outside; only this dispatch path (mirroring existing
  patterns) may write it — you are extending that exact existing write path, not inventing
  a new one.
- GDScript strict typing: don't use `:=` for `Dictionary.get()` results (may return
  `Variant`) — type them explicitly as shown above.
- Do not touch anything under `game-server/`.

## Verification
This is plumbing with no renderer yet to visually check. Verify by:
- `grep -n "supply_route_updated" client/src/core/event_bus.gd` shows the new signal.
- `grep -n "supply_routes\|_apply_supply_route_update" client/src/core/game_state.gd` shows
  the new dict and handler.
- `grep -n "SUPPLY_ROUTE_UPDATE" client/src/systems/session/session_manager.gd` shows the
  new case.
- If the project has a lightweight GDScript syntax check available (e.g. an existing test
  scene that loads `game_state.gd`/`event_bus.gd`/`session_manager.gd` such as
  `client/test/test_subprovince_events.gd` touches similar dispatch wiring), running it via
  `godot --headless --path client <scene>.tscn` is good evidence the file still parses; not
  required to write new tests for this task.

## Report
Write your report to `.superpowers/sdd/task-1-report.md` (relative to the worktree root).
Report DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, the commit hash(es), a one-line
test/verification summary, and any concerns.
