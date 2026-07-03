# Territory Movement Restriction + Combat State Label

## Context

Two features to add to the `feat/combat-events` branch:

1. **Territory-based movement restriction** — Units can only move into territory belonging to nations they are at war with or allied with. Neutral territory is off-limits for both move orders and retreat paths. The diplomacy schema exists (`RelationState`) but is never populated; we add a minimal initializer (all 6 playable nations = "war" with each other at game start). No UI for diplomacy — that's a future feature.

2. **Combat state text label** — Show the current combat state ("idle", "engaged", "suppressed", "retreating") in the bottom selection panel's IdentityBlock for easy debugging without disrupting existing layout.

---

## Investigation Summary

### Architecture gap: waypoints and provinces are disconnected

`WaypointNode` (movement_system.ts line 19-25) has no `province_id`. Provinces (map_data.json) have polygon boundaries. To check territory, we must build a `waypointId → nationId` map at game start via point-in-polygon.

Confirmed data:
- `map_data.json`: 89 provinces, each has `polygons: Array<Array<[lng, lat]>>` and `nation_id`
- `waypoints.json`: ~1000+ nodes with `id`, `lng`, `lat`
- Confirmed neutral waypoint in Switzerland: `wp_000754` (9.55926, 47.455312) — province `we6_switzerland_01`
- Confirmed German waypoint near `germany_div_01`: `wp_076355` (8.686738, 50.066746) — province `we6_germany_01`

### Relations schema exists but never populated

`GameRoomState.ts` line 69: `relations = new MapSchema<RelationState>()` — always empty.
Playable nations (from `nations.ts`): germany, france, united_kingdom, spain, algeria, italy.

### Move order flow

`GameRoom.ts:203–233` → `handleSubmitMoveOrder()`:
1. Checks ownership
2. Calls `movementSystem.validateMoveOrder(waypoints)` — only checks waypoint existence
3. Sets move order

No territory check exists.

### Retreat path flow

`combat_system.ts:646–703` → `_initiateRetreat()`:
- Computes retreat target point (50 km away from enemy centroid)
- Calls `this.movementSystem.getNearestWaypoint(retreatLng, retreatLat)` — no territory filter
- Sets that waypoint as move order

### friendly_division_panel.gd current state

`combat_state` is already read in `populate()` (line 64) but only used to show/hide Retreat button.
IdentityBlock path: `Margin/HBox/IdentityBlock/` contains NameRow + DivTemplate.
Node refs resolved in `_ready()` via `get_node_or_null()`.

---

## TDD Test — Write First

### New file: `game-server/test/4f-territory-movement.e2e.ts`

```
Setup: Standard two-player game (germany vs france). After DIVISIONS_SPAWNED:

Test A — Direct neutral target rejected (first waypoint is neutral):
  Send MOVE order for germany_div_01 with a single waypoint "wp_000754" (Switzerland, neutral)
  Wait for MOVE_ORDER_REJECTED (timeout 5 s)
  Assert reason === "neutral_territory"
  Assert germany_div_01 move_order remains empty

Test B — Path through neutral territory is trimmed (not rejected):
  Build a multi-waypoint path for germany_div_01:
    first 2–3 waypoints in German territory (e.g. wp_076355), then a Swiss waypoint
  Send the full path as a MOVE order
  Assert NO MOVE_ORDER_REJECTED
  Assert DIVISION_UPDATES shows germany_div_01.move_order contains only the German waypoints
    (i.e. length < sent length, Swiss waypoint absent)

Test C — Own territory allowed:
  Send MOVE order for germany_div_01 to "wp_076355" (Germany)
  Assert NO MOVE_ORDER_REJECTED within 3 s
  Assert move_order contains "wp_076355"

Test D — Enemy territory allowed:
  Send MOVE order for germany_div_05 toward france territory
  (Reuse any known France waypoint from existing 4c test setups)
  Assert NO MOVE_ORDER_REJECTED within 3 s
```

Tests A–D will FAIL with current code (no territory check, no relations). All go green after implementing fixes below.

---

## Fix 1 — Server: Initialize Relations

**File:** `game-server/src/rooms/GameRoom.ts`

Add method and import `RelationState`:
```typescript
private _initRelations(): void {
  const playerNations = ["germany", "france", "united_kingdom", "spain", "algeria", "italy"];
  for (let i = 0; i < playerNations.length; i++) {
    for (let j = i + 1; j < playerNations.length; j++) {
      const key = `${playerNations[i]}|${playerNations[j]}`;
      const rel = new RelationState();
      rel.from_id = playerNations[i];
      rel.to_id   = playerNations[j];
      rel.stance  = "war";
      this.state.relations.set(key, rel);
    }
  }
}
```

Call site in `startGame()` after `_initProvinces()` (line ~324):
```typescript
this._initProvinces(this.state.map_id);
this._initRelations();  // NEW
```

---

## Fix 1b — Auto-War at Game Start (Testing Convenience)

**Verified:** The `relations` MapSchema is always empty at game start — no code ever populates it. This means combat currently works (engagement checks don't use relations) but move orders will be blocked by the territory check once Fix 3 is applied. Fix 1 (`_initRelations()`) handles this, initializing all 6 playable nations as "war" with each other as soon as `startGame()` runs.

No additional changes needed — Fix 1 above covers this.

---

## Fix 2 — MovementSystem: Waypoint-Province Mapping + Territory Check

**File:** `game-server/src/systems/movement_system.ts`

### Step 1 — Add storage at class level

```typescript
private waypointNation: Map<string, string> = new Map(); // waypointId → nationId
```

### Step 2 — Add `loadMapData(mapId)` (call after `loadWaypoints`)

```typescript
loadMapData(mapId: string): void {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const gameServerRoot = join(__dir, "../..");
  const dataPath = join(gameServerRoot, "..", "client", "assets", "data", mapId, "map_data.json");

  let raw: { provinces: Array<{ nation_id: string; polygons: number[][][] }> };
  try {
    raw = JSON.parse(readFileSync(dataPath, "utf-8"));
  } catch {
    console.warn(`[MovementSystem] map_data.json not found — territory checks disabled`);
    return;
  }

  for (const [waypointId, node] of this.graph.nodes) {
    for (const province of raw.provinces) {
      let found = false;
      for (const ring of province.polygons) {
        if (this._pointInPolygon(node.lng, node.lat, ring)) {
          this.waypointNation.set(waypointId, province.nation_id);
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  console.log(`[MovementSystem] built waypoint→nation mapping: ${this.waypointNation.size} nodes mapped`);
}

private _pointInPolygon(px: number, py: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
```

### Step 3 — Add territory helpers

Add `RelationState` to the existing import from `GameRoomState.js`:
```typescript
import type { GameRoomState, DivisionState, RelationState } from "../rooms/schema/GameRoomState.js";
```

```typescript
private _isNeutralFor(
  waypointId: string,
  divNationId: string,
  relations: MapSchema<RelationState>,
): boolean {
  const wpNation = this.waypointNation.get(waypointId) ?? "";
  if (wpNation === "" || wpNation === divNationId) return false; // sea/unmapped or own territory
  const rel = relations.get(`${divNationId}|${wpNation}`) ?? relations.get(`${wpNation}|${divNationId}`);
  const stance = rel?.stance ?? "neutral";
  return stance !== "war" && stance !== "allied";
}

/**
 * Trim a waypoint path at the first neutral-territory waypoint.
 * Returns the allowed prefix. If the very first waypoint is neutral, returns [].
 * Caller rejects the order when the result is empty.
 *
 * Design: trimming is better UX than outright rejection — units advance as far as
 * allowed along the player's intended route. The France→UK case is handled naturally:
 * no sea waypoints exist in the graph, so the client cannot build a path there.
 */
trimToAllowedTerritory(
  waypointIds: string[],
  divNationId: string,
  relations: MapSchema<RelationState>,
): string[] {
  const allowed: string[] = [];
  for (const id of waypointIds) {
    if (this._isNeutralFor(id, divNationId, relations)) break;
    allowed.push(id);
  }
  return allowed;
}

getNearestNonNeutralWaypoint(
  lng: number,
  lat: number,
  divNationId: string,
  relations: MapSchema<RelationState>,
): WaypointNode | null {
  let best: WaypointNode | null = null;
  let bestDist = Infinity;
  for (const [id, node] of this.graph.nodes) {
    if (this._isNeutralFor(id, divNationId, relations)) continue;
    const dx = node.lng - lng;
    const dy = node.lat - lat;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; best = node; }
  }
  return best ?? this.getNearestWaypoint(lng, lat); // fallback if all neutral (shouldn't happen)
}
```

Note: `MapSchema` is already imported via `@colyseus/schema` — add to the existing import if not already there.

---

## Fix 3 — GameRoom.ts: Wire Territory Trim + loadMapData

**File:** `game-server/src/rooms/GameRoom.ts`

In `startGame()`, after `loadWaypoints` (~line 320):
```typescript
this.movementSystem.loadWaypoints(this.state.map_id);
this.movementSystem.loadMapData(this.state.map_id);  // NEW
```

In `handleSubmitMoveOrder()`, replace the section after ownership check with:
```typescript
if (!this.movementSystem.validateMoveOrder(waypoints)) {
  client.send("MOVE_ORDER_REJECTED", { division_id: divisionId, reason: "invalid_waypoints" });
  return;
}

// NEW: trim path at first neutral-territory waypoint
const allowedWaypoints = this.movementSystem.trimToAllowedTerritory(
  waypoints, division.nation_id, this.state.relations,
);
if (allowedWaypoints.length === 0) {
  // Even the first waypoint is in neutral territory — outright reject
  client.send("MOVE_ORDER_REJECTED", { division_id: divisionId, reason: "neutral_territory" });
  return;
}
// Use trimmed path (may be shorter than requested if path crosses neutral territory)
const effectiveWaypoints = allowedWaypoints;
```

Then replace the move-order assignment block to use `effectiveWaypoints` instead of `waypoints`:
```typescript
// Replace existing move order
division.move_order.splice(0, division.move_order.length);
for (const wpId of effectiveWaypoints) {   // was: waypoints
  division.move_order.push(wpId);
}
```
```

---

## Fix 4 — CombatSystem: Retreat Into Non-Neutral Territory

**File:** `game-server/src/systems/combat_system.ts`

In `_initiateRetreat()` (~line 698), replace:
```typescript
const waypoint = this.movementSystem.getNearestWaypoint(retreatLng, retreatLat);
```
With:
```typescript
const waypoint = this.movementSystem.getNearestNonNeutralWaypoint(
  retreatLng, retreatLat, div.nation_id, state.relations,
);
```

> `state` is the `GameRoomState` parameter added by the cleanup plan (`combat-cleanup-fixes.md`). If that plan hasn't run yet, also add `state: GameRoomState` to `_initiateRetreat()`'s signature and pass `this.state` (or thread it through callers in `_checkAutoRetreatOrRotate()`).

---

## Fix 5 — Client: Combat State Label

### Step 1 — Scene: add CombatStateLabel node

**File:** `client/scenes/game/panels/friendly_division_panel.tscn`

Add a Label node as the 3rd child of IdentityBlock, after the existing DivTemplate node. In the .tscn text format:
```
[node name="CombatStateLabel" type="Label" parent="Margin/HBox/IdentityBlock"]
layout_mode = 2
theme_override_font_sizes/font_size = 10
text = "STATE · IDLE"
```

### Step 2 — Script: reference and update

**File:** `client/src/ui/hud/friendly_division_panel.gd`

Add variable (after existing var declarations):
```gdscript
var _combat_state_label: Label
```

In `_ready()`, add after existing node refs:
```gdscript
_combat_state_label = get_node_or_null("Margin/HBox/IdentityBlock/CombatStateLabel")
```

In `populate()`, after reading `combat_state` (after line 67):
```gdscript
if _combat_state_label != null:
    _combat_state_label.text = "STATE · %s" % combat_state.to_upper()
```

In `_refresh_stats()` (added by cleanup plan), also update the label:
```gdscript
var combat_state: String = data.get("combat_state", "idle")
if _combat_state_label != null:
    _combat_state_label.text = "STATE · %s" % combat_state.to_upper()
```

---

## Files to Modify

| File | Change |
|---|---|
| `game-server/test/4f-territory-movement.e2e.ts` | **NEW** — TDD: neutral rejected, own ok, enemy ok |
| `game-server/src/rooms/GameRoom.ts` | Add `_initRelations()`; call `loadMapData()`; territory check in `handleSubmitMoveOrder()` |
| `game-server/src/systems/movement_system.ts` | Add `loadMapData()`, `_pointInPolygon()`, `_isNeutralFor()`, `checkTerritoryPermission()`, `getNearestNonNeutralWaypoint()`; `waypointNation` map; `RelationState` import |
| `game-server/src/systems/combat_system.ts` | Replace `getNearestWaypoint` with `getNearestNonNeutralWaypoint` in `_initiateRetreat()` |
| `client/scenes/game/panels/friendly_division_panel.tscn` | Add `CombatStateLabel` Label as 3rd child of IdentityBlock |
| `client/src/ui/hud/friendly_division_panel.gd` | Add `_combat_state_label` ref; update in `populate()` and `_refresh_stats()` |

---

## Verification

1. **TDD red → green:**
   - Write `4f-territory-movement.e2e.ts` first; run — all tests fail
   - Apply fixes; run — all 3 pass

2. **Regression:** All prior 4c + 4e tests must still pass:
   - `npx tsx test/4c-combat.e2e.ts`
   - `npx tsx test/4c-combat-state-machine.e2e.ts`
   - `npx tsx test/4c-retreat-distance.e2e.ts`
   - `npx tsx test/4e-combat-cleanup.e2e.ts` (if written)

3. **Typecheck:** `pnpm --filter game-server run typecheck`

4. **Visual (Godot):**
   - Select any division → bottom panel shows "STATE · IDLE"
   - Division enters combat → panel shows "STATE · ENGAGED" (updates live via `division_updated`)
   - Try to move a division toward Switzerland on the map → order rejected, unit doesn't move
   - Move toward France from Germany → accepted, unit starts moving
   - After retreat → retreating unit's target waypoint is in own/enemy territory, not neutral
