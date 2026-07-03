# Meeting Battle + Combat Events + Unit Stacking

## Context

Three features from `plans/strategic-combat-tasks.md` / `feat/combat-events` branch:

1. **Meeting battle visual** — server already detects meeting battles (`is_meeting_battle` in `COMBAT_STARTED`); client has no distinct icon for it yet
2. **Combat events wiring** — server already broadcasts most events; critical client bug: `UNIT_DESTROYED` never emits `division_removed`, so destroyed divisions stay in the military panel and on the map; client also doesn't handle `STACK_FORMED` / `STACK_ROTATION` / `STACK_DISSOLVED` at all; `COMBAT_RESULT` event (per-round result) missing from server
3. **Stacking client-side** — server stacking is ~90% complete (stack_id, stack_position, STACK_ROTATE_THRESHOLD=50, STACK_LAST_RETREAT_THRESHOLD=60, detection within 15 km, STACK_FORMED/STACK_ROTATION/STACK_DISSOLVED broadcast); client side is 0% done

**DEV_PHASES checklist items this closes (Phase 4):**
- `[ ]` → `[x]` "COMBAT_STARTED, COMBAT_RESULT, PROVINCE_CAPTURED, UNIT_DESTROYED, STACK_ROTATION events"
- `[ ]` → `[x]` "MilitarySystem — stack badge display"
- `[ ]` → `[x]` "Meeting battle icon state — distinct from standard Engaged"

**Not in scope:** Stack reorder UI panel (Phase 5), notification toasts (Phase 5), encirclement-at-stack-level (Phase 7).

---

## Investigation Summary

### Server state (what already exists)

| Feature | File | Key lines | Status |
|---|---|---|---|
| Meeting battle detection | `game-server/src/systems/combat_system.ts` | 231–246 | ✅ done — both-have-orders → `is_meeting = true` |
| `attacker_role = "meeting"` on both divisions | `combat_system.ts` | 275–276 | ✅ done |
| `COMBAT_STARTED` with `is_meeting_battle` flag | `combat_system.ts` | 281 | ✅ done |
| Stack formation (STACK_THRESHOLD_KM = 15 km) | `combat_system.ts` | 58, 811–860 | ✅ done |
| Stack rotation (STACK_ROTATE_THRESHOLD = 50) | `combat_system.ts` | 741–805 | ✅ done |
| `STACK_FORMED` / `STACK_ROTATION` / `STACK_DISSOLVED` broadcast | `combat_system.ts` | 839, 800, 897 | ✅ done |
| `UNIT_DESTROYED` broadcast | `combat_system.ts` | 617 | ✅ done |
| `PROVINCE_CAPTURED` broadcast | `combat_system.ts` | 568 | ✅ done |
| `COMBAT_RESULT` per-round event | — | — | ❌ missing |

### Client state (what exists / what's broken)

| Feature | File | Status |
|---|---|---|
| `UNIT_DESTROYED` handler | `game_state.gd` lines 84–92 | ⚠️ sets `combat_state="destroyed"` but **never emits `division_removed`** — icons and panel entries persist |
| `STACK_FORMED` / `STACK_ROTATION` / `STACK_DISSOLVED` handlers | `session_manager.gd` | ❌ not handled at all |
| Meeting battle icon | `division_icon.gd` | ❌ no distinct visual; just shows "engaged" amber border |
| Stack badge on icon | `division_icon.gd` | ❌ missing |
| Military panel filters destroyed divisions | `military_panel.gd` | ❌ shows all divisions regardless of `combat_state` |
| `division_removed` signal | `event_bus.gd` | ✅ defined but never emitted |
| `_on_division_removed()` cleanup | `military_system.gd` lines 1052–1068 | ✅ fully implemented — just never called |

### Key data structures

```typescript
// DivisionState (GameRoomState.ts lines 22–40)
stack_id: string        // UUID linking stack members; "" if not stacked
stack_position: number  // 0 = front of stack

// ActivePair
is_meeting: boolean
attacker_id: string  // "" in meeting battle
defender_id: string  // "" in meeting battle
```

---

## TDD — Write Tests First

### Test 1: `game-server/test/4d-meeting-battle.e2e.ts` (NEW)

```
Setup: standard two-player game (germany vs france)
After DIVISIONS_SPAWNED, immediately send MOVE orders to BOTH germany_div_05 and
france_div_05 pointing into their own territory (so move orders exist on tick 1 when
engagement is detected — divisions are already 37 km apart, within 50 km range).

Assert A: COMBAT_STARTED fires with is_meeting_battle === true
Assert B: DIVISION_UPDATES shows germany_div_05.attacker_role === "meeting"
Assert C: DIVISION_UPDATES shows france_div_05.attacker_role === "meeting"
```

This test validates the server's existing meeting battle detection as a regression guard.

### Test 2: `game-server/test/4d-stacking.e2e.ts` (NEW)

**Prerequisite change to starting positions:** Move `germany_div_04` from Düsseldorf `(7.020, 51.438)` to `(8.610, 50.000)` — approximately 9 km from `germany_div_01` at `(8.684, 50.063)`. Both will be stationary with no move orders → stack forms automatically.

```
Test A — STACK_FORMED:
  Start game (germany vs france)
  Wait for DIVISIONS_SPAWNED
  Wait for STACK_FORMED (timeout 15 s)
  Assert payload has stack_id, divisions array containing "germany_div_01" and "germany_div_04"
  Assert DIVISION_UPDATES shows both divisions with matching non-empty stack_id

Test B — STACK_DISSOLVED:
  After Test A, send MOVE order to germany_div_01
  Wait for STACK_DISSOLVED (timeout 10 s)
  Assert DIVISION_UPDATES shows germany_div_01.stack_id === "" (or absent)
```

---

## Phase 1 — Server: Add `COMBAT_RESULT` Event

**File:** `game-server/src/systems/combat_system.ts`

After the per-round damage resolution in `_resolveCombat()` (around line 560), add:
```typescript
broadcast("COMBAT_RESULT", {
  division_a:    a.division_id,
  division_b:    b.division_id,
  round:         pair.round,
  hp_a:          a.hp,
  hp_b:          b.hp,
  suppression_a: a.suppression,
  suppression_b: b.suppression,
});
```

The broadcast callback already passes through all event types generically — no GameRoom.ts changes needed.

---

## Phase 2 — Client: Fix `UNIT_DESTROYED` → emit `division_removed`

**File:** `client/src/core/game_state.gd`, function `_apply_unit_destroyed()` (lines 84–92)

```gdscript
func _apply_unit_destroyed(data: Dictionary) -> void:
    var div_id: String = data.get("division_id", "")
    var nation_id: String = data.get("nation_id", "")
    if div_id.is_empty():
        return
    if divisions.has(div_id):
        divisions[div_id]["combat_state"] = "destroyed"
    EventBus.unit_destroyed.emit(div_id, nation_id)
    EventBus.division_updated.emit(div_id)
    # Show destroyed icon briefly then clean up
    get_tree().create_timer(1.5).timeout.connect(func():
        divisions.erase(div_id)
        EventBus.division_removed.emit(div_id)
    )
```

`_on_division_removed()` in `military_system.gd` (lines 1052–1068) already handles icon cleanup and selection cleanup — this just ensures it actually gets called.

**Also fix `military_panel.gd`:** In the division list refresh loop, skip destroyed divisions:
```gdscript
if div_data.get("combat_state", "") == "destroyed":
    continue
```

---

## Phase 3 — Client: Handle Stack Events

### 3a. `client/src/core/event_bus.gd` — add signals
```gdscript
signal stack_formed(stack_id: String, division_ids: Array)
signal stack_rotated(stack_id: String, rotated_back: String, new_front: String)
signal stack_dissolved(stack_id: String)
```

### 3b. `client/src/core/game_state.gd` — add stack state
```gdscript
var stacks: Dictionary = {}  # { stack_id → Array[division_id] ordered by stack_position }
```

Add apply functions:
```gdscript
func _apply_stack_formed(data: Dictionary) -> void:
    var sid: String = data.get("stack_id", "")
    var divs: Array = data.get("divisions", [])
    stacks[sid] = divs
    EventBus.stack_formed.emit(sid, divs)

func _apply_stack_rotation(data: Dictionary) -> void:
    var sid: String = data.get("stack_id", "")
    var rotated: String = data.get("rotated_back", "")
    var new_front: String = data.get("new_front", "")
    # Reorder local stacks array: move rotated_back to end, new_front is now index 0
    if stacks.has(sid):
        stacks[sid].erase(rotated)
        stacks[sid].append(rotated)
    EventBus.stack_rotated.emit(sid, rotated, new_front)

func _apply_stack_dissolved(data: Dictionary) -> void:
    var sid: String = data.get("stack_id", "")
    stacks.erase(sid)
    EventBus.stack_dissolved.emit(sid)
```

Also store `is_meeting_battle` when COMBAT_STARTED arrives:
```gdscript
func _apply_combat_started(data: Dictionary) -> void:
    var is_meeting: bool = data.get("is_meeting_battle", false)
    for div_id: String in [data.get("division_a", ""), data.get("division_b", "")]:
        if divisions.has(div_id):
            divisions[div_id]["is_meeting_battle"] = is_meeting
```

Clear `is_meeting_battle` in `_apply_division_updates()` when `combat_state` becomes "idle" or "retreating".

### 3c. `client/src/systems/session/session_manager.gd` — add handlers

In the `_on_server_event()` match block, add:
```gdscript
"STACK_FORMED":    game_state._apply_stack_formed(data)
"STACK_ROTATION":  game_state._apply_stack_rotation(data)
"STACK_DISSOLVED": game_state._apply_stack_dissolved(data)
"COMBAT_STARTED":  game_state._apply_combat_started(data); EventBus.combat_started.emit(...)
"COMBAT_RESULT":   pass  # future tactical panel use
```

---

## Phase 4 — Client: Meeting Battle Distinct Icon

**File:** `client/src/systems/military/division_icon.gd`

Add property:
```gdscript
var is_meeting_battle: bool = false
```

In `_draw()`, modify the `"engaged"` match arm:
```gdscript
"engaged":
    var border_color: Color = Color(0.85, 0.2, 0.85, 0.85) if is_meeting_battle \
                              else Color(1.0, 0.65, 0.1, 0.80)
    draw_rect(rect, border_color, false, 2.5)
    if is_meeting_battle:
        # Two small inward arrows on top and bottom edge to signal head-on collision
        draw_line(Vector2(0, rect.position.y), Vector2(0, rect.position.y + 5), border_color, 2.0)
        draw_line(Vector2(0, rect.end.y),      Vector2(0, rect.end.y - 5),      border_color, 2.0)
```

**File:** `client/src/systems/military/military_system.gd`

In `_on_division_updated()`, after updating `combat_state` on the icon, also set:
```gdscript
var div_data: Dictionary = game_state.get_division(division_id)
(icon as DivisionIcon).is_meeting_battle = div_data.get("is_meeting_battle", false)
icon.queue_redraw()
```

---

## Phase 5 — Client: Stack Badge on Icon + Military Panel Grouping

**File:** `client/src/systems/military/division_icon.gd`

Add property:
```gdscript
var stack_count: int = 0
```

In `_draw()`, after drawing the rectangle:
```gdscript
if stack_count > 1:
    var badge_center := Vector2(rect.end.x - 5, rect.position.y + 5)
    draw_circle(badge_center, 5.5, Color(1, 1, 1, 0.9))
    draw_string(ThemeDB.fallback_font, badge_center + Vector2(-3, 4),
                str(stack_count), HORIZONTAL_ALIGNMENT_LEFT, -1, 8, Color(0, 0, 0, 1))
```

**File:** `client/src/systems/military/military_system.gd`

Connect to stack signals and update `stack_count` on affected icons:
```gdscript
func _on_stack_formed(stack_id: String, division_ids: Array) -> void:
    for div_id in division_ids:
        var icon = _icons.get(div_id) as DivisionIcon
        if icon:
            icon.stack_count = division_ids.size()
            icon.queue_redraw()

func _on_stack_rotated(_stack_id: String, _rotated_back: String, _new_front: String) -> void:
    pass  # stack_count unchanged; visual reorder handled by stack_position in DIVISION_UPDATES

func _on_stack_dissolved(stack_id: String) -> void:
    # Find all icons whose stack_id matches (stored in game_state)
    for div_id in game_state.divisions:
        var div_data: Dictionary = game_state.get_division(div_id)
        if div_data.get("stack_id", "") == stack_id:
            var icon = _icons.get(div_id) as DivisionIcon
            if icon:
                icon.stack_count = 0
                icon.queue_redraw()
```

**File:** `client/src/ui/hud/military_panel.gd`

In the list refresh, group divisions by `stack_id`:
- Divisions with the same non-empty `stack_id` → show as a single collapsible group with front division first
- Solo divisions → shown individually as before
- Destroyed divisions → filtered out (Phase 2 removes them from GameState, panel just won't see them)

---

## Files to Modify

| File | Change |
|---|---|
| `game-server/test/4d-meeting-battle.e2e.ts` | **NEW** — TDD: `is_meeting_battle: true` + both `attacker_role: "meeting"` |
| `game-server/test/4d-stacking.e2e.ts` | **NEW** — TDD: STACK_FORMED on close stationary pair; STACK_DISSOLVED on move order |
| `game-server/src/data/maps/western_europe_6/starting_positions.ts` | Move `germany_div_04` to `(8.610, 50.000)` — 9 km from `germany_div_01` |
| `game-server/src/systems/combat_system.ts` | Add `COMBAT_RESULT` broadcast after `_resolveCombat()` |
| `client/src/core/game_state.gd` | Fix `_apply_unit_destroyed()`; add `stacks` dict; add `_apply_stack_formed/rotation/dissolved()`; add `_apply_combat_started()` |
| `client/src/systems/session/session_manager.gd` | Add `STACK_FORMED`, `STACK_ROTATION`, `STACK_DISSOLVED`, `COMBAT_RESULT` handlers; route `COMBAT_STARTED` through `_apply_combat_started()` |
| `client/src/core/event_bus.gd` | Add `stack_formed`, `stack_rotated`, `stack_dissolved` signals |
| `client/src/systems/military/division_icon.gd` | Add `is_meeting_battle` flag + purple border; add `stack_count` badge |
| `client/src/systems/military/military_system.gd` | Connect to stack signals; set `is_meeting_battle` on icon in `_on_division_updated()` |
| `client/src/ui/hud/military_panel.gd` | Filter destroyed; group stacked divisions |

---

## Verification

1. **TDD red → green:**
   - `npx tsx test/4d-meeting-battle.e2e.ts` — must pass
   - `npx tsx test/4d-stacking.e2e.ts` — must pass

2. **Regression:** all 4c tests must still pass:
   - `npx tsx test/4c-combat.e2e.ts`
   - `npx tsx test/4c-combat-state-machine.e2e.ts`
   - `npx tsx test/4c-retreat-distance.e2e.ts`

3. **Typecheck:** `pnpm --filter game-server run typecheck`

4. **Visual (Godot):**
   - Start game → meeting battle pair shows **purple** border + inward arrows instead of amber
   - `germany_div_01` and `germany_div_04` (now 9 km apart) show **stack badge "2"** on both icons
   - Send move order to either → stack badge disappears from both
   - Destroy a division in combat → icon shows destroyed state for 1.5 s then vanishes; military panel removes the entry
