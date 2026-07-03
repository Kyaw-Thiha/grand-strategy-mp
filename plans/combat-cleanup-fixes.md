# Combat Cleanup Fixes — 3 Issues

## Context

Three bugs identified post-combat-state-machine implementation:

1. **Defender stays "engaged" after attacker retreats** — `_initiateRetreat()` removes the `ActivePair` but never resets the surviving division's `combat_state` back to "idle"
2. **No test for defender auto-retreat** — all 4c tests use meeting-battle setup (60% threshold for both); the attacker-vs-defender scenario (defender 60% / attacker 80%) has no coverage
3. **HP/suppression in bottom panel not live** — `friendly_division_panel.gd` only calls `populate()` on `division_selected`; never re-reads when `division_updated` fires

---

## Investigation Summary

### Bug 1 — Combat state not cleared

**File:** `game-server/src/systems/combat_system.ts`

`_initiateRetreat()` (lines 687–695) removes pairs correctly:
```typescript
for (const [key] of this.activePairs) {
  if (idA === div.division_id || idB === div.division_id)
    pairsToRemove.push(key);
}
for (const key of pairsToRemove) this.activePairs.delete(key);
```

But it **never touches the opponent division** — no `combat_state = "idle"`, no `attacker_role = ""`, no `engaged_with` clear.

`_checkDisengagement()` (lines 523–532) DOES reset both to idle, but only fires when **both** divisions drift apart by distance — it never runs when one side has already been removed from `activePairs` by `_initiateRetreat()`.

`_initiateRetreat()` signature: `(div, enemies)` — lacks `state` and `changed` needed to reach the opponent.

No `COMBAT_ENDED` event exists.

### Bug 2 — Defender retreat not tested

Suppression thresholds (combat_system.ts):
```typescript
const DEFENDER_SUPPRESS_THRESHOLD = 60;
const ATTACKER_SUPPRESS_THRESHOLD = 80;
```

All existing tests either:
- Issue move orders to **both** divisions → meeting battle, both use 60% → random which retreats first
- Or test manual RETREAT command (Test C in 4c-combat-state-machine.e2e.ts)

No test sets up one-has-order / one-doesn't to create a real attacker(80%) vs defender(60%) pair and asserts the **defender** retreats first.

### Bug 3 — Panel not updating live

**File:** `client/src/ui/hud/friendly_division_panel.gd`

- `game_hud.gd` lines 83, 226–238: connects `division_selected` → calls `_friendly_div_panel.populate(div_id, data)` once
- `friendly_division_panel.gd` has **no `_ready()` signal connections** — never listens to `division_updated`
- `military_panel.gd` line 15 already does this correctly: `EventBus.division_updated.connect(_refresh)`

---

## TDD Test — Write First

### New file: `game-server/test/4e-combat-cleanup.e2e.ts`

**Setup:** Standard two-player game. After `DIVISIONS_SPAWNED`, send a MOVE order **only to `germany_div_05`** (toward somewhere in Germany interior, e.g. waypoint at `8.0,49.5`). Do NOT send any order to `france_div_05`. This makes germany_div_05 the attacker (80% threshold) and france_div_05 the defender (60% threshold).

```
Test A — Defender retreats first:
  Wait for COMBAT_STARTED (timeout 20 s)
  Assert DIVISION_UPDATES shows france_div_05.attacker_role === "defender"
  Assert DIVISION_UPDATES shows germany_div_05.attacker_role === "attacker"
  Wait for france_div_05.combat_state === "retreating" (timeout 90 s)
  Assert germany_div_05.combat_state !== "retreating" at this point

Test B — Surviving attacker returns to idle after defender retreats:
  (Continues after Test A — france already retreating)
  Wait for DIVISION_UPDATES showing germany_div_05.combat_state === "idle" (timeout 30 s)
  Assert germany_div_05.attacker_role === "" (cleared)
  Assert germany_div_05.engaged_with is empty / absent
```

**Test A** passes immediately (server correctly assigns roles and defender threshold is lower).
**Test B** will **FAIL** with current code (defender stuck in "engaged") — goes green after Fix 1.

---

## Fix 1 — `_initiateRetreat()`: reset opponent on disengage

**File:** `game-server/src/systems/combat_system.ts`

### Step 1 — Add parameters to `_initiateRetreat()`

Change signature from:
```typescript
private _initiateRetreat(div: DivisionState, enemies: DivisionState[]): void
```
To:
```typescript
private _initiateRetreat(
  div:       DivisionState,
  enemies:   DivisionState[],
  state:     GameRoomState,
  changed:   Set<string>,
  broadcast: (type: string, msg: unknown) => void,
): void
```

### Step 2 — Collect opponents before deleting pairs, then reset after

Replace the existing pair-removal block with:
```typescript
// Collect pairs and their opponents before deletion
const opponentIds: string[] = [];
const pairsToRemove: string[] = [];
for (const [key] of this.activePairs) {
  const [idA, idB] = key.split("|");
  if (idA === div.division_id || idB === div.division_id) {
    pairsToRemove.push(key);
    opponentIds.push(idA === div.division_id ? idB : idA);
  }
}
for (const key of pairsToRemove) this.activePairs.delete(key);

// Reset each opponent if they are no longer in any remaining active pair
for (const opponentId of opponentIds) {
  const stillEngaged = Array.from(this.activePairs.keys())
    .some(k => k.startsWith(opponentId + "|") || k.endsWith("|" + opponentId));
  if (stillEngaged) continue;

  const opponent = state.divisions.get(opponentId);
  if (!opponent) continue;
  if (opponent.combat_state === "engaged" || opponent.combat_state === "suppressed") {
    opponent.combat_state  = "idle";
    opponent.attacker_role = "";
    opponent.engaged_with.splice(0, opponent.engaged_with.length);
    changed.add(opponentId);
    broadcast("COMBAT_ENDED", { winner_id: opponentId, retreated_id: div.division_id });
  }
}
```

### Step 3 — Update all callers

All call sites are inside `_checkAutoRetreatOrRotate()` which already has `state`, `changed`, and `broadcast` in scope:
```typescript
// Before:
this._initiateRetreat(div, enemies);

// After:
this._initiateRetreat(div, enemies, state, changed, broadcast);
```

Also check `GameRoom.ts` for any public `initiateRetreat()` wrapper and thread through `this.state` and the broadcast callback.

---

## Fix 2 — `friendly_division_panel.gd`: live HP/suppression

**File:** `client/src/ui/hud/friendly_division_panel.gd`

### Step 1 — Track currently displayed division ID

Add at class level:
```gdscript
var _current_div_id: String = ""
```

In `populate()`, store the id at the top:
```gdscript
func populate(div_id: String, data: Dictionary) -> void:
    _current_div_id = div_id
    # ... rest of existing populate logic unchanged ...
```

### Step 2 — Connect to `division_updated` in `_ready()`

```gdscript
func _ready() -> void:
    EventBus.division_updated.connect(_on_division_updated)
```

### Step 3 — Refresh only stat values on update

```gdscript
func _on_division_updated(div_id: String) -> void:
    if div_id != _current_div_id:
        return
    var data: Dictionary = GameState.get_division(div_id)
    if data.is_empty():
        return
    _refresh_stats(data)
```

Extract a `_refresh_stats(data: Dictionary)` method from `populate()` containing only the HP bar, suppression bar, and numeric label updates — no button recreation or layout changes. Call `_refresh_stats()` from within `populate()` to avoid duplication.

### Step 4 — Clear tracking on deselect

Where `division_deselected` is handled (in `game_hud.gd` or the panel itself), reset:
```gdscript
_current_div_id = ""
```

---

## Client: Handle `COMBAT_ENDED` Event

**File:** `client/src/systems/session/session_manager.gd`

Add handler in the `_on_server_event()` match block:
```gdscript
"COMBAT_ENDED":
    var winner_id: String = data.get("winner_id", "")
    var retreated_id: String = data.get("retreated_id", "")
    for div_id: String in [winner_id, retreated_id]:
        if game_state.divisions.has(div_id):
            game_state.divisions[div_id]["is_meeting_battle"] = false
    if not winner_id.is_empty():
        EventBus.division_updated.emit(winner_id)
```

This clears the meeting-battle purple icon when combat ends.

---

## Files to Modify

| File | Change |
|---|---|
| `game-server/test/4e-combat-cleanup.e2e.ts` | **NEW** — TDD: attacker-vs-defender setup; Test A asserts defender retreats first; Test B (red → green after Fix 1) asserts survivor returns to idle |
| `game-server/src/systems/combat_system.ts` | `_initiateRetreat()`: add `state`, `changed`, `broadcast` params; reset opponent after pair removal; emit `COMBAT_ENDED` |
| `client/src/ui/hud/friendly_division_panel.gd` | Add `_current_div_id`; connect to `division_updated`; extract `_refresh_stats()` for live updates |
| `client/src/systems/session/session_manager.gd` | Handle `COMBAT_ENDED`: clear `is_meeting_battle` on both divisions, emit `division_updated` for winner |

---

## Verification

1. **TDD red → green:**
   - Write `4e-combat-cleanup.e2e.ts` first; run it — confirm Test B fails (germany stuck in "engaged")
   - Apply Fix 1; run again — confirm both Test A and Test B pass

2. **Regression:** all existing 4c tests must still pass:
   - `npx tsx test/4c-combat.e2e.ts`
   - `npx tsx test/4c-combat-state-machine.e2e.ts`
   - `npx tsx test/4c-retreat-distance.e2e.ts`

3. **Typecheck:** `pnpm --filter game-server run typecheck`

4. **Visual (Godot):**
   - Start a game; let the attacker retreat; confirm defender icon immediately shows **idle** (amber circle gone)
   - Select a division in combat; confirm HP bar and suppression bar tick down live without reselecting
   - After combat ends, confirm meeting-battle purple border clears from the surviving division
