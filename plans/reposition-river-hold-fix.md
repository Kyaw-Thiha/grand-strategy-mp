# Reposition Mechanic + River Crossing in Combat + Hold Fix

## Context

Three features/fixes for the `feat/combat-events` branch:

1. **Reposition** — Units can reposition (change terrain) while actively engaged. Moves at 30% normal speed, uses a separate temporary path cleared when combat ends, capped at 12 km to prevent abuse as an escape route. Named "Reposition" — confirmed in `docs/TACTICAL_COMBAT.md` as a planned mechanic but not yet in DEV_PHASES or implemented. Hotkey: `R`.

2. **River crossing combat penalty** — Not yet implemented (verified: `WaypointEdge.river_size` exists but is never read by combat). When two divisions engage across a river, the attacker takes a terrain penalty. Re-checked each round so Reposition across a river removes the penalty.

3. **Hold button fix** — `handleHold()` clears `move_order` but never broadcasts `DIVISION_UPDATES`. The client never learns the order was cancelled. Fix: add broadcast after clearing. Already has `G` hotkey — no new hotkey needed.

**Post-victory movement continuation status:** Already works correctly. The winner's `move_order` is never touched by `_initiateRetreat()`. When the division returns to "idle", `movement_system.tick()` resumes it. No fix needed — just verified.

---

## Investigation Summary

### Codebase state

| Item | Location | Status |
|---|---|---|
| `reposition_order` field | DivisionState | ❌ missing |
| REPOSITION server handler | GameRoom.ts | ❌ missing |
| Reposition movement at 30% | movement_system.ts | ❌ missing |
| River crossing in ActivePair | combat_system.ts | ❌ missing — `ActivePair` has `terrain_mult_atk` already |
| `river_size` on WaypointEdge | movement_system.ts line 31 | ✅ exists, never used in combat |
| Hold broadcast | GameRoom.ts:244–256 | ❌ missing — clears move_order but no broadcast |
| G hotkey for Hold | keybind_manager.gd line 132 | ✅ already bound |
| Reposition button | friendly_division_panel.tscn | ❌ missing — add as Row3 in ActionsBlock |
| R hotkey | keybind_manager.gd | ❌ missing — R is free |

### ActivePair structure (combat_system.ts ~line 103)

```typescript
interface ActivePair {
  attacker_id: string;
  defender_id: string;
  is_meeting: boolean;
  terrain_mult_atk: number;   // attacker outgoing damage multiplier (≤1.0 = penalty)
  terrain_mult_def: number;   // defender outgoing damage multiplier (≥1.0 = bonus)
  round: number;
  is_primary_attacker: boolean;
  flank_class: "none" | "flank" | "rear";
}
```

`terrain_mult_atk` is already present — river crossing penalty can be applied through this field.

### Engagement range formula (combat_system.ts ~line 221)

```typescript
const engageRange = a.engagement_radius + b.engagement_radius;  // ~44–50 km combined
if (distKm <= engageRange) { /* engage */ }
// Disengage hysteresis: engageRange * 1.2 (~53–60 km)
```

A 12 km max reposition distance cannot push a division outside the 53–60 km disengagement threshold.

### HUD layout

```
ActionsBlock (VBoxContainer, 200px)
├── Row1 (HBoxContainer) — BtnMove + BtnHold
└── Row2 (HBoxContainer) — BtnRetreat (hidden) + BtnCancel
```

Add Row3 with BtnReposition (visible only when `engaged` or `suppressed`).

### Available hotkeys

Unit order cluster (keybind_manager.gd):
- SPACE: move, G: hold, C: retreat, X: cancel
- R: **free** — mnemonic match for Reposition, not reserved, ergonomically reachable
- Z: reserved for idle-division-select (unbound), V: reserved for cycle-engaged (unbound), B: free

→ **Use R for Reposition.**

---

## Constants

```typescript
const REPOSITION_MAX_KM   = 12;   // max path distance for a reposition order
const REPOSITION_SPEED    = 0.30; // 30% of normal movement speed
const RIVER_PENALTY_MINOR = 0.70; // terrain_mult_atk for minor river
const RIVER_PENALTY_MOD   = 0.55; // terrain_mult_atk for moderate river
const RIVER_PENALTY_MAJOR = 0.40; // terrain_mult_atk for major river
```

---

## TDD Tests — Write First

### New file: `game-server/test/4g-reposition.e2e.ts`

```
Setup: Standard two-player game.
After DIVISIONS_SPAWNED, send MOVE only to germany_div_05 (attacker).
Wait for COMBAT_STARTED.

Test A — Reposition accepted during combat:
  Send REPOSITION command for germany_div_05 with a nearby waypoint (~5 km away)
  Assert DIVISION_UPDATES shows germany_div_05.reposition_order non-empty (timeout 5 s)
  Assert germany_div_05 combat_state still "engaged" (not changed)
  Assert germany_div_05 move_order unchanged (original move still queued)

Test B — Reposition clears after combat ends:
  (Continuing after Test A — wait for one side to retreat)
  Assert DIVISION_UPDATES shows germany_div_05.reposition_order is empty (timeout 90 s)

Test C — Reposition rejected when not in combat:
  Send REPOSITION to germany_div_01 (idle, no combat)
  Assert MOVE_ORDER_REJECTED with reason "not_in_combat" (timeout 3 s)

Test D — Reposition rejected beyond 12 km:
  During combat, send REPOSITION to germany_div_05 with a waypoint ~20 km away
  Assert MOVE_ORDER_REJECTED with reason "reposition_too_far" (timeout 3 s)

Test E — Hold broadcasts update:
  Send MOVE order to germany_div_01 (a German-territory waypoint)
  Wait for DIVISION_UPDATES showing move_order non-empty (timeout 5 s)
  Send HOLD to germany_div_01
  Assert DIVISION_UPDATES shows germany_div_01.move_order empty (timeout 3 s)
```

All tests fail with current code. Go green after implementing fixes below.

---

## Fix 1 — Schema: Add `reposition_order` to DivisionState

**File:** `game-server/src/rooms/schema/GameRoomState.ts`

After the existing `move_order` field (line ~35):
```typescript
@type(["string"]) reposition_order = new ArraySchema<string>(); // in-combat reposition path
```

---

## Fix 2 — MovementSystem: River Edge Collection + Distance Helpers

**File:** `game-server/src/systems/movement_system.ts`

### Step 1 — Add storage for river segments

At class level:
```typescript
private riverSegments: Array<{ x1: number; y1: number; x2: number; y2: number; size: string }> = [];
```

In `loadWaypoints()`, after processing edges (after the existing `this.edgeSet.add(...)` block), add:
```typescript
for (const edge of raw.edges) {
  if (!edge.river_size) continue;
  const from = this.graph.nodes.get(edge.from);
  const to   = this.graph.nodes.get(edge.to);
  if (from && to) {
    this.riverSegments.push({ x1: from.lng, y1: from.lat, x2: to.lng, y2: to.lat, size: edge.river_size });
  }
}
```

### Step 2 — River crossing check

```typescript
checkRiverCrossing(lng1: number, lat1: number, lng2: number, lat2: number): string {
  for (const seg of this.riverSegments) {
    if (this._segmentsIntersect(lng1, lat1, lng2, lat2, seg.x1, seg.y1, seg.x2, seg.y2)) {
      return seg.size; // "minor" | "moderate" | "major"
    }
  }
  return "";
}

private _segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  // Standard cross-product segment intersection
  const d1x = bx - ax, d1y = by - ay;
  const d2x = dx - cx, d2y = dy - cy;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return false; // parallel
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
```

### Step 3 — Path distance helper (for REPOSITION validation)

```typescript
calculatePathDistance(waypointIds: string[], startLng: number, startLat: number): number {
  let totalKm = 0;
  let prevLng = startLng;
  let prevLat = startLat;
  for (const id of waypointIds) {
    const node = this.graph.nodes.get(id);
    if (!node) continue;
    totalKm += this._distKm(prevLng, prevLat, node.lng, node.lat);
    prevLng = node.lng;
    prevLat = node.lat;
  }
  return totalKm;
}
```

(Reuse existing `_distKm()` which already exists in combat_system.ts — either move it to movement_system.ts or expose it. Check for existing `_distKm` in movement_system.ts; if absent, add the haversine impl there.)

### Step 4 — Reposition movement processing

In `movement_system.ts`'s `tick()`, after the existing division loop (or inside it), add processing for reposition_order:

```typescript
// Process reposition movement for engaged/suppressed divisions
for (const division of state.divisions.values()) {
  if (division.reposition_order.length === 0) continue;
  if (division.combat_state !== "engaged" && division.combat_state !== "suppressed") continue;
  this._advanceReposition(division, speedMult);
}
```

Add `_advanceReposition()` — identical to `_advanceDivision()` but uses `reposition_order` instead of `move_order`, and applies `REPOSITION_SPEED * speedMult`:
```typescript
private _advanceReposition(division: DivisionState, speedMult: number): void {
  const nextId = division.reposition_order[0];
  const nextNode = this.graph.nodes.get(nextId);
  if (!nextNode) { division.reposition_order.splice(0, 1); return; }

  const dx = nextNode.lng - division.position_lng;
  const dy = nextNode.lat - division.position_lat;
  const distDeg = Math.sqrt(dx * dx + dy * dy);

  if (distDeg < 0.0001) {
    division.position_lng = nextNode.lng;
    division.position_lat = nextNode.lat;
    division.reposition_order.splice(0, 1);
    return;
  }

  // 30% of normal movement speed
  const speedKmH = this.graph.road_node_ids.has(nextId) ? ROAD_SPEED_KMH : OFFROAD_SPEED_KMH;
  const effectiveSpeed = speedKmH * REPOSITION_SPEED * speedMult;
  const stepDeg = (effectiveSpeed / KM_PER_DEG_LAT) / (60 * 60); // per second tick
  // (same speed calculation pattern as _advanceDivision)

  if (stepDeg >= distDeg) {
    division.position_lng = nextNode.lng;
    division.position_lat = nextNode.lat;
    division.reposition_order.splice(0, 1);
  } else {
    division.position_lng += (dx / distDeg) * stepDeg;
    division.position_lat += (dy / distDeg) * stepDeg;
  }
}
```

> Copy the exact speed computation from `_advanceDivision()` — it handles profile-based terrain costs. The only change is multiplying by 0.30.

---

## Fix 3 — CombatSystem: River Crossing in ActivePair + Reorder Clear

**File:** `game-server/src/systems/combat_system.ts`

### Step 1 — Add `river_crossing` to ActivePair interface

```typescript
interface ActivePair {
  // ... existing fields ...
  river_crossing: string;          // "" | "minor" | "moderate" | "major"
  river_side_attacker: string;     // division_id of crossing side ("" for meeting battle)
}
```

### Step 2 — Set at engagement creation (`_checkEngagement`)

When creating a new ActivePair (find the `activePairs.set(...)` call), after computing `terrain_mult_atk`:
```typescript
const riverSize = this.movementSystem.checkRiverCrossing(
  divA.position_lng, divA.position_lat,
  divB.position_lng, divB.position_lat,
);
// Apply penalty to the crossing side (attacker crosses to reach defender)
let terrainMultAtk = 1.0;
if (riverSize) {
  const penaltyMap: Record<string, number> = { minor: 0.70, moderate: 0.55, major: 0.40 };
  terrainMultAtk = penaltyMap[riverSize] ?? 1.0;
}
pair.river_crossing     = riverSize;
pair.river_side_attacker = riverSize ? pair.attacker_id : "";
pair.terrain_mult_atk   = terrainMultAtk;
```

### Step 3 — Re-check river crossing each round (after reposition)

In `_resolveCombat()` (called each round), after resolving damage and before returning, re-check river for each pair:
```typescript
private _updateRiverCrossing(pair: ActivePair, a: DivisionState, b: DivisionState): void {
  const riverSize = this.movementSystem.checkRiverCrossing(
    a.position_lng, a.position_lat,
    b.position_lng, b.position_lat,
  );
  const penaltyMap: Record<string, number> = { minor: 0.70, moderate: 0.55, major: 0.40 };
  pair.river_crossing = riverSize;
  pair.terrain_mult_atk = riverSize ? (penaltyMap[riverSize] ?? 1.0) : 1.0;
}
```

Call `this._updateRiverCrossing(pair, divA, divB)` at the start of each `_resolveCombat()` call.

### Step 4 — Clear `reposition_order` on combat end

In `_initiateRetreat()` (after pair removal and opponent reset, added by cleanup plan):
```typescript
// Clear reposition orders for both the retreating division and the opponent
div.reposition_order.splice(0, div.reposition_order.length);
for (const opponentId of opponentIds) {
  const opponent = state.divisions.get(opponentId);
  if (opponent) opponent.reposition_order.splice(0, opponent.reposition_order.length);
}
```

In `_checkDisengagement()` (when both divisions disengage by distance), also clear reposition_order for both.

---

## Fix 4 — GameRoom.ts: REPOSITION Handler + Hold Broadcast

**File:** `game-server/src/rooms/GameRoom.ts`

### Step 1 — Register REPOSITION handler

In `onCreate()`, alongside existing `onMessage` registrations:
```typescript
this.onMessage("REPOSITION", (client, msg) => this.handleReposition(client, msg));
```

### Step 2 — `handleReposition()` implementation

```typescript
private handleReposition(client: Client, msg: { division_id?: string; waypoints?: string[] }) {
  if (this.state.phase !== "running") return;
  const divisionId = msg.division_id ?? "";
  const waypoints  = msg.waypoints ?? [];

  const division = this.state.divisions.get(divisionId);
  if (!division) { client.send("ERROR", { message: `Unknown division: ${divisionId}` }); return; }

  const player = this.state.players.get(client.sessionId);
  if (!player) return;
  const nation = this.getNationForPlayer(player.userId);
  if (!nation || nation.nation_id !== division.nation_id) {
    client.send("ERROR", { message: "Not your division" }); return;
  }

  if (division.combat_state !== "engaged" && division.combat_state !== "suppressed") {
    client.send("MOVE_ORDER_REJECTED", { division_id: divisionId, reason: "not_in_combat" }); return;
  }

  if (!this.movementSystem.validateMoveOrder(waypoints)) {
    client.send("MOVE_ORDER_REJECTED", { division_id: divisionId, reason: "invalid_waypoints" }); return;
  }

  const distKm = this.movementSystem.calculatePathDistance(
    waypoints, division.position_lng, division.position_lat,
  );
  if (distKm > REPOSITION_MAX_KM) {
    client.send("MOVE_ORDER_REJECTED", { division_id: divisionId, reason: "reposition_too_far" }); return;
  }

  division.reposition_order.splice(0, division.reposition_order.length);
  for (const wpId of waypoints) division.reposition_order.push(wpId);

  this.broadcast("DIVISION_UPDATES", { divisions: [this.serializeDivision(division)] });
}
```

Add constant near top of file:
```typescript
const REPOSITION_MAX_KM = 12;
```

### Step 3 — Fix Hold broadcast

In `handleHold()` (line ~244), after clearing move_order:
```typescript
division.move_order.splice(0, division.move_order.length);
// NEW: broadcast so client learns order was cancelled
this.broadcast("DIVISION_UPDATES", { divisions: [this.serializeDivision(division)] });
```

### Step 4 — Include `reposition_order` in serialization

In `serializeDivision()` (line ~448), add:
```typescript
reposition_order: [...div.reposition_order],
```

---

## Fix 5 — Client: Reposition Mode + Button + Hotkey

### 5a. `game-server/src/rooms/schema/GameRoomState.ts` — already done in Fix 1

### 5b. Scene: add Row3 with BtnReposition

**File:** `client/scenes/game/panels/friendly_division_panel.tscn`

Add inside ActionsBlock (after existing Row2):
```
[node name="Row3" type="HBoxContainer" parent="Margin/HBox/ActionsBlock"]
layout_mode = 2
theme_override_constants/separation = 6

[node name="BtnReposition" type="Button" parent="Margin/HBox/ActionsBlock/Row3"]
layout_mode = 2
size_flags_horizontal = 3
custom_minimum_size = Vector2(0, 36)
text = "Reposition [R]"
visible = false
```

### 5c. Script: wire button + track `_current_div_id`

**File:** `client/src/ui/hud/friendly_division_panel.gd`

Add variable:
```gdscript
var _btn_reposition: Button
```

In `_ready()`:
```gdscript
_btn_reposition = get_node_or_null("Margin/HBox/ActionsBlock/Row3/BtnReposition")
```

In `populate()`, after the existing Retreat visibility logic (line ~67):
```gdscript
var can_reposition: bool = combat_state in ["engaged", "suppressed"]
if _btn_reposition != null:
    _btn_reposition.visible = can_reposition
```

In `_rewire_buttons()`, add:
```gdscript
if _btn_reposition != null:
    _btn_reposition.pressed.connect(func() -> void:
        EventBus.reposition_mode_requested.emit(div_id)
    )
```

In `_refresh_stats()` (from cleanup plan), also update visibility:
```gdscript
var combat_state: String = data.get("combat_state", "idle")
if _btn_reposition != null:
    _btn_reposition.visible = combat_state in ["engaged", "suppressed"]
```

### 5d. EventBus: add signal

**File:** `client/src/core/event_bus.gd`

```gdscript
signal reposition_mode_requested(div_id: String)
```

### 5e. Keybind: register R

**File:** `client/src/core/keybind_manager.gd`

After the existing unit order bindings (around line 137):
```gdscript
_reg("unit_reposition", _key(KEY_R))
```

**File:** `client/src/core/keybind_presets.gd`

In the left-handed preset overrides (around line 80–90), add:
```gdscript
"unit_reposition": {"physical_keycode": KEY_F},  # left-hand mirror: F
```

### 5f. Military system: handle reposition mode + R key

**File:** `client/src/systems/military/military_system.gd`

Add a `_reposition_mode: bool = false` flag (similar to existing move mode tracking).

In `handle_input()`, add alongside other unit-order key handlers:
```gdscript
elif event.is_action_pressed("unit_reposition"):
    if _selected_division_id != "":
        EventBus.reposition_mode_requested.emit(_selected_division_id)
```

Connect to `EventBus.reposition_mode_requested` in `_ready()`:
```gdscript
EventBus.reposition_mode_requested.connect(_enter_reposition_mode)
```

Implement `_enter_reposition_mode(div_id: String)`:
- Set `_reposition_mode = true`; store `_reposition_div_id = div_id`
- Change cursor to indicate reposition mode (different from move mode cursor)
- On map click in reposition mode: compute path, limit display to 12 km radius, send `CommandQueue.submit("REPOSITION", {"division_id": div_id, "waypoints": [...]})`
- Path preview rendered in a distinct color (e.g., cyan) vs normal move (white)
- Exit reposition mode after submission or on Escape

### 5g. Client: handle `reposition_order` in game_state

**File:** `client/src/core/game_state.gd`

In `_apply_division_updates()`, store `reposition_order` from the data dict:
```gdscript
if "reposition_order" in div_data:
    divisions[div_id]["reposition_order"] = div_data["reposition_order"]
```

---

## Files to Modify

| File | Change |
|---|---|
| `game-server/test/4g-reposition.e2e.ts` | **NEW** — TDD: Tests A–E (reposition accepted/cleared/rejected, hold broadcasts) |
| `game-server/src/rooms/schema/GameRoomState.ts` | Add `reposition_order: ArraySchema<string>` to DivisionState |
| `game-server/src/systems/movement_system.ts` | Add river segment collection, `checkRiverCrossing()`, `calculatePathDistance()`, `_advanceReposition()` processing, `_segmentsIntersect()` |
| `game-server/src/systems/combat_system.ts` | Add `river_crossing` + `river_side_attacker` to ActivePair; set at engagement; re-check per round; clear `reposition_order` on combat end |
| `game-server/src/rooms/GameRoom.ts` | Register REPOSITION handler; `handleReposition()` with 12 km cap; fix Hold to broadcast after clearing; include `reposition_order` in `serializeDivision()` |
| `client/scenes/game/panels/friendly_division_panel.tscn` | Add Row3 + BtnReposition (visible only in combat states) |
| `client/src/ui/hud/friendly_division_panel.gd` | Add `_btn_reposition` ref; visibility logic; wire to `reposition_mode_requested` signal |
| `client/src/core/event_bus.gd` | Add `signal reposition_mode_requested(div_id: String)` |
| `client/src/core/keybind_manager.gd` | Register `unit_reposition` → KEY_R |
| `client/src/core/keybind_presets.gd` | Add left-handed mirror for `unit_reposition` |
| `client/src/systems/military/military_system.gd` | Reposition mode flow: enter on R/button, send REPOSITION command, cyan path preview |
| `client/src/core/game_state.gd` | Store `reposition_order` in division data dict |

---

## Verification

1. **TDD red → green:**
   - Write `4g-reposition.e2e.ts` first; run — all 5 tests fail
   - Apply all fixes; run again — all pass

2. **Regression:** All prior tests must still pass:
   - `npx tsx test/4c-combat.e2e.ts`
   - `npx tsx test/4c-combat-state-machine.e2e.ts`
   - `npx tsx test/4c-retreat-distance.e2e.ts`
   - `npx tsx test/4e-combat-cleanup.e2e.ts` (if written)
   - `npx tsx test/4f-territory-movement.e2e.ts` (if written)

3. **Typecheck:** `pnpm --filter game-server run typecheck`

4. **Visual (Godot):**
   - Select division in combat → Reposition button appears; press R → cyan dotted path preview appears
   - Click within 12 km → reposition order submitted; division moves slowly (visually ~30% speed)
   - After combat ends → cyan path disappears
   - Try dragging reposition path >12 km → client caps/rejects
   - Select moving division → press G or click Hold → division stops immediately (no lag)
   - Select two divisions engaged across a river → combat panel shows river crossing penalty
   - Reposition division across the river → penalty disappears from combat indicator on next round
