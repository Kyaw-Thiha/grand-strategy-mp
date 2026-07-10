# Branch H — `feat/air-manual-targeting`

## Context

Branches A, K-stubs, B, B-patch, C, D, E, E-patch, F, G are all merged. This branch
adds: (1) per-aircraft-type minimum turn radius wired into the Dubins pathfinder,
(2) right-click manual targeting from the client (enemy wing → intercept, land
division → ground attack, city → industry bombing), and (3) server-side lost-contact
handling when a manually targeted enemy wing goes undetected.

**Test-Driven Development is mandatory.** Write ALL failing tests before each step.

---

## Critical Pre-Read

### Turn radius — current state

`game-server/src/systems/air_dubins_pathfinder.ts` line 50:
`let WING_TURN_RADIUS_DEG = 0.3;` — global constant.

Used at:
- Line 240: inside `computeTransitPath` → `buildSmoothPath(..., WING_TURN_RADIUS_DEG)`
- Line 249: inside `computeRtbPath` → `buildSmoothPath(..., WING_TURN_RADIUS_DEG)`
- NOT in `computeLoiterArc` (takes `radiusDeg` parameter directly — leave alone)

Line 54: `setTurnRadiusForTesting(v)` export — keep for test compatibility.

### computeTransitPath / computeRtbPath — do NOT take turnRadiusDeg yet

These methods currently use the module-level constant internally. Add an optional
`turnRadiusDeg?: number` parameter with fallback:
`turnRadiusDeg ?? WING_TURN_RADIUS_DEG`. Callers that pass nothing still work.

### AirUnitStats — no min_turn_radius_deg field yet

`game-server/src/data/air_unit_stats.ts` interface currently:
```typescript
export interface AirUnitStats {
  attack_vs_air: number;
  defense_vs_air: number;
  observation_deg: number;
}
```
Add `min_turn_radius_deg: number` to the interface and all stat table entries.

### Per-type radius values (agreed design)

| Type | min_turn_radius_deg |
|---|---|
| fighter | 0.30 |
| cas_plane | 0.30 |
| recon_plane | 0.30 |
| dive_bomber | 0.40 |
| naval_bomber | 0.40 |
| heavy_fighter | 0.50 |
| tactical_bomber | 0.50 |
| strategic_bomber | 0.65 |

### ASSIGN_WING_MISSION — existing handler (GameRoom.ts lines 165–201)

Already accepts `{ wing_id, mission, target_id }`. `target_id` can be a wing_id
(ESCORT/INTERCEPTION) or province_id (bombing missions). `_resolveTargetPosition`
handles both. Extend with optional `is_manual: boolean` — no new message type needed.

### Client right-click — current state

`client/src/systems/air/air_wing_system.gd`, `handle_mouse_input()` lines 288–341.
Current right-click only resolves province at 15px proximity.

Key fields:
- `_selected_wing_id: String = ""` (line 152)
- `_detected_wings: Dictionary` (line 165) — keyed by wing_id, tracks detected enemies
- `_submit_air_command(type, payload)` (lines 418–419)
- `HIT_THRESHOLD_PX = 18` — wing icon hit test threshold

### Wing capability rules for right-click

| Action | Eligible types |
|---|---|
| Manual intercept (right-click enemy wing) | `fighter`, `heavy_fighter` (attack_vs_air > 0) |
| Ground attack (right-click land division) | `cas_plane`, `dive_bomber`, `tactical_bomber`; `fighter` only if has `perk_strafing` |
| Industry bombing (right-click enemy city) | `strategic_bomber`, `tactical_bomber` |

CAS and dive_bomber cannot intercept (attack_vs_air = 0). Recon cannot attack.

### Right-click disambiguation priority (when icons overlap)

1. Enemy wing icons within HIT_THRESHOLD_PX=18px — filter by intercept capability
2. Land division icons within HIT_THRESHOLD_PX — filter by ground attack capability
3. Province city markers within 15px — filter by strategic bomb capability
4. Empty map → existing move / redeploy behavior (unchanged)

### Lost-contact handling design

When a manually assigned INTERCEPTION target loses detection (`is_detected` becomes
false on the target wing):
1. Store last known position in `_lastKnownPositions: Map<targetWingId, {lng, lat}>`
   on the pathfinder — updated every tick while target is detected
2. Recompute transit path to last known position
3. Loiter at last known position for `LOST_CONTACT_LOITER_TICKS = 5` ticks
4. Clear `wing.target_id = ""` and delete tracking entries → lifecycle auto-retargets

For strategic/tactical bombers (INDUSTRY mission) whose target province is captured
by a friendly: RTB via `lifecycleSystem.resolveWingBombed()`.

### Lost contact — important nuance

The server always knows the actual position of all wings via `state.air_wings`. The
`is_detected` flag on a wing represents whether the ENEMY nation can observe it. For
lost-contact logic, use `target.is_detected` to decide when to switch from live
pursuit to last-known-position transit.

A separate `_manualTargets: Map<interceptorWingId, targetWingId>` is needed on the
pathfinder to know WHICH interceptors were manually assigned (vs. auto-assigned), so
that lost-contact only applies to manual intercept wings, not all INTERCEPTION wings.

### Test handlers already registered (do NOT re-register)

`SPAWN_WING`, `SPAWN_NATION`, `SET_RELATION`, `SET_WING_LIFECYCLE`,
`SET_WING_POSITION`, `SET_WING_TARGET`, `SET_PATH_ELAPSED`, `SPAWN_DIVISION`.

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/test/12h-manual-targeting.test.ts` | All Branch H server tests |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/data/air_unit_stats.ts` | Add `min_turn_radius_deg` to interface + stat table |
| `game-server/src/systems/air_dubins_pathfinder.ts` | Optional `turnRadiusDeg` param on `computeTransitPath`/`computeRtbPath`; `_lastKnownPositions` and `_manualTargets` maps; lost-contact tick logic |
| `game-server/src/rooms/GameRoom.ts` | Pass per-type radius in `computeTransitPath`/`computeRtbPath` calls; `is_manual` flag handling in ASSIGN_WING_MISSION |
| `game-server/src/systems/air_strategic_bombing_system.ts` | RTB when target province captured by friendly (amend to Branch G) |
| `game-server/src/systems/air_wing_lifecycle_system.ts` | Ground attack loiter timeout |
| `game-server/package.json` | Append 12h to test chain |
| `client/src/systems/air/air_wing_system.gd` | Right-click disambiguation logic |

---

## Step 1: Per-Type Turn Radius in Stats

### 1a. Write failing tests

Create `game-server/test/12h-manual-targeting.test.ts`:

```typescript
import assert from "assert";
import { describe, it } from "mocha";
import { getAirUnitStats } from "../src/data/air_unit_stats.js";

describe("Per-type turn radius", () => {
  it("fighter has min_turn_radius_deg = 0.3", () => {
    assert.strictEqual(getAirUnitStats("fighter").min_turn_radius_deg, 0.30);
  });
  it("dive_bomber has min_turn_radius_deg = 0.4", () => {
    assert.strictEqual(getAirUnitStats("dive_bomber").min_turn_radius_deg, 0.40);
  });
  it("heavy_fighter has min_turn_radius_deg = 0.5", () => {
    assert.strictEqual(getAirUnitStats("heavy_fighter").min_turn_radius_deg, 0.50);
  });
  it("strategic_bomber has min_turn_radius_deg = 0.65", () => {
    assert.strictEqual(getAirUnitStats("strategic_bomber").min_turn_radius_deg, 0.65);
  });
  it("recon_plane has min_turn_radius_deg = 0.3", () => {
    assert.strictEqual(getAirUnitStats("recon_plane").min_turn_radius_deg, 0.30);
  });
});
```

Run — must FAIL.

### 1b. Update `air_unit_stats.ts`

```typescript
export interface AirUnitStats {
  attack_vs_air:       number;
  defense_vs_air:      number;
  observation_deg:     number;
  min_turn_radius_deg: number;
}

const STAT_TABLE: Record<string, AirUnitStats> = {
  fighter:          { attack_vs_air: 0.25, defense_vs_air: 0.03, observation_deg: 0.25, min_turn_radius_deg: 0.30 },
  heavy_fighter:    { attack_vs_air: 0.22, defense_vs_air: 0.05, observation_deg: 0.35, min_turn_radius_deg: 0.50 },
  cas_plane:        { attack_vs_air: 0.0,  defense_vs_air: 0.03, observation_deg: 0.05, min_turn_radius_deg: 0.30 },
  dive_bomber:      { attack_vs_air: 0.0,  defense_vs_air: 0.03, observation_deg: 0.05, min_turn_radius_deg: 0.40 },
  tactical_bomber:  { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.05, min_turn_radius_deg: 0.50 },
  strategic_bomber: { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.05, min_turn_radius_deg: 0.65 },
  naval_bomber:     { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.05, min_turn_radius_deg: 0.40 },
  recon_plane:      { attack_vs_air: 0.0,  defense_vs_air: 0.01, observation_deg: 1.0,  min_turn_radius_deg: 0.30 },
};
```

Run — must PASS.

### 1c. Wire into pathfinder — add optional param

In `air_dubins_pathfinder.ts`:

```typescript
computeTransitPath(
  startPos: { lng: number; lat: number },
  startHeadingCompassDeg: number,
  endPos: { lng: number; lat: number },
  turnRadiusDeg?: number,   // NEW optional param
): DubinsPath {
  return buildSmoothPath(
    startPos, startHeadingCompassDeg, endPos, endHeading, "TRANSIT",
    turnRadiusDeg ?? WING_TURN_RADIUS_DEG,
  );
}

computeRtbPath(
  startPos: { lng: number; lat: number },
  startHeadingCompassDeg: number,
  airbasePos: { lng: number; lat: number },
  airbaseEntryHeadingCompassDeg: number,
  turnRadiusDeg?: number,   // NEW optional param
): DubinsPath {
  return buildSmoothPath(
    startPos, startHeadingCompassDeg,
    airbasePos, airbaseEntryHeadingCompassDeg, "RTB",
    turnRadiusDeg ?? WING_TURN_RADIUS_DEG,
  );
}
```

### 1d. Update `GameRoom.ts` call sites

Both `ASSIGN_WING_MISSION` handler (~line 193) and `REDEPLOY_WING` handler (~line 246)
and `_assignRtbPaths` — look up the wing's `aircraft_type` and pass the radius:

```typescript
import { getAirUnitStats } from "../data/air_unit_stats.js";

const radius = getAirUnitStats(wing.aircraft_type).min_turn_radius_deg;
const path = this.airDubinsPathfinder.computeTransitPath(startPos, heading, endPos, radius);
// or:
const path = this.airDubinsPathfinder.computeRtbPath(startPos, heading, airbasePos, entryHeading, radius);
```

### 1e. Test that path geometry differs per type

```typescript
describe("Per-type turn radius applied in pathfinder", () => {
  it("strategic_bomber path length > fighter path length for same start/end", async () => {
    // Spawn strategic_bomber and fighter at same position, same destination
    // Tick until both paths are computed
    // Compare path total length (wider turn radius = longer arc = longer path)
    // Access path from AIR_WING_PATH broadcast stored during joinRoom
  });
});
```

---

## Step 2: Lost-Contact Tracking (Server)

### 2a. Add tracking maps to `air_dubins_pathfinder.ts`

```typescript
const _lastKnownPositions = new Map<string, { lng: number; lat: number }>();
const _manualTargets = new Map<string, string>(); // interceptor wing_id → target wing_id
const _lostContactLoiterTicks = new Map<string, number>(); // interceptor wing_id → tick count

let LOST_CONTACT_LOITER_TICKS = 5;
export function setLostContactLoiterTicksForTesting(n: number): void {
  LOST_CONTACT_LOITER_TICKS = n;
}

export function registerManualTarget(interceptorId: string, targetId: string): void {
  _manualTargets.set(interceptorId, targetId);
}

export function clearManualTarget(interceptorId: string): void {
  _manualTargets.delete(interceptorId);
  _lostContactLoiterTicks.delete(interceptorId);
}
```

### 2b. Lost-contact tick logic in `air_dubins_pathfinder.ts`

In `tick()`, after the main path advancement loop:

```typescript
for (const [interceptorId, targetId] of _manualTargets) {
  const interceptor = state.air_wings.get(interceptorId);
  const target      = state.air_wings.get(targetId);
  if (!interceptor || !target) {
    _manualTargets.delete(interceptorId);
    continue;
  }

  if (target.is_detected) {
    // Target visible — store current position, clear any lost-contact loiter
    _lastKnownPositions.set(targetId, {
      lng: target.position_lng,
      lat: target.position_lat,
    });
    _lostContactLoiterTicks.delete(interceptorId);
    continue;
  }

  // Target lost — route to last known position if we have one
  const lastKnown = _lastKnownPositions.get(targetId);
  if (!lastKnown) continue;

  if (interceptor.lifecycle_state === WING_LIFECYCLE.LOITER) {
    // Already loitering at last known — count ticks
    const count = (_lostContactLoiterTicks.get(interceptorId) ?? 0) + 1;
    _lostContactLoiterTicks.set(interceptorId, count);

    if (count >= LOST_CONTACT_LOITER_TICKS) {
      // Give up — clear manual target, wing auto-retargets via mission rules
      interceptor.target_id = "";
      _manualTargets.delete(interceptorId);
      _lostContactLoiterTicks.delete(interceptorId);
      _lastKnownPositions.delete(targetId);
    }
  } else if (interceptor.lifecycle_state === WING_LIFECYCLE.TRANSIT) {
    // Reroute to last known if not already heading there
    // Only recompute if target_id still set and current path destination differs
    const lostPath = this.computeTransitPath(
      { lng: interceptor.position_lng, lat: interceptor.position_lat },
      interceptor.heading_deg,
      lastKnown,
      getAirUnitStats(interceptor.aircraft_type).min_turn_radius_deg,
    );
    this.storePath(interceptorId, lostPath);
    interceptor.path_gen_id     = lostPath.path_gen_id;
    interceptor.path_elapsed_ms = 0;
  }
}
```

### 2c. Wire into `GameRoom.ts` ASSIGN_WING_MISSION handler

```typescript
this.onMessage("ASSIGN_WING_MISSION", (client, msg: {
  wing_id:   string;
  mission:   string;
  target_id: string;
  is_manual?: boolean;
}) => {
  // ... existing logic unchanged ...

  // Register manual target for lost-contact tracking
  if (msg.is_manual && msg.target_id && msg.mission === MISSION_TYPES.INTERCEPTION) {
    this.airDubinsPathfinder.registerManualTarget(msg.wing_id, msg.target_id);
  }
});
```

### 2d. Strategic bomber — friendly capture → RTB

In `air_strategic_bombing_system.ts` (Branch G amendment), the existing guard:

```typescript
// Before (skips silently):
if (province.owner_id === wing.nation_id) continue;

// After (RTB on friendly capture):
if (province.owner_id === wing.nation_id) {
  lifecycleSystem.resolveWingBombed(wing.wing_id, state);
  continue;
}
```

### 2e. Tests

```typescript
describe("Lost contact handling", () => {
  it("interceptor routes to last known position when target goes undetected", async () => {
    // Spawn interceptor + target (enemy wing, initially detected)
    // Manually assign via ASSIGN_WING_MISSION with is_manual=true
    // Tick once → record target position → flip target.is_detected=false
    // Tick again → interceptor should be routing toward last stored position
  });

  it("interceptor clears target_id after LOST_CONTACT_LOITER_TICKS loiter ticks", async () => {
    // Set LOST_CONTACT_LOITER_TICKS=2 via setLostContactLoiterTicksForTesting
    // Set up lost contact scenario, tick until interceptor enters LOITER
    // Tick 2 more times → interceptor.target_id === ""
  });

  it("non-manual INTERCEPTION wings are unaffected by lost-contact logic", async () => {
    // Assign INTERCEPTION mission WITHOUT is_manual=true
    // Flip target.is_detected=false
    // Interceptor should NOT reroute to last known position
  });
});
```

---

## Step 3: Ground Attack Loiter Timeout

When a ground-attack wing (CAS/dive/tactical bomber on AREA or TACTICAL_BOMBING
mission) loiters with no engagement, RTB after N ticks.

### 3a. Constants and tracking in `air_wing_lifecycle_system.ts`

```typescript
const GROUND_ATTACK_LOITER_MAX_TICKS = 5;
const _groundAttackLoiterCount = new Map<string, number>();

const GROUND_ATTACK_MISSIONS = new Set(["area", "tactical_bombing"]);
```

### 3b. Loiter timeout logic in `tick()`

In the LOITER wing processing block:

```typescript
if (GROUND_ATTACK_MISSIONS.has(wing.mission) &&
    wing.lifecycle_state === WING_LIFECYCLE.LOITER) {
  const count = (_groundAttackLoiterCount.get(wing.wing_id) ?? 0) + 1;
  _groundAttackLoiterCount.set(wing.wing_id, count);
  if (count >= GROUND_ATTACK_LOITER_MAX_TICKS) {
    _groundAttackLoiterCount.delete(wing.wing_id);
    this.resolveWingBombed(wing.wing_id, state);
  }
}
```

Clear counter on non-LOITER transitions:

```typescript
if (wing.lifecycle_state !== WING_LIFECYCLE.LOITER) {
  _groundAttackLoiterCount.delete(wing.wing_id);
}
```

### 3c. Tests

```typescript
describe("Ground attack loiter timeout", () => {
  it("CAS wing RTBs after GROUND_ATTACK_LOITER_MAX_TICKS ticks with no engagement", async () => { ... });
  it("counter resets if wing leaves LOITER and re-enters", async () => { ... });
});
```

---

## Step 4: Right-Click Manual Targeting (Client)

### 4a. Capability helpers in `air_wing_system.gd`

Add near the top of the script or in a helper section:

```gdscript
func _can_intercept(aircraft_type: String) -> bool:
    return aircraft_type in ["fighter", "heavy_fighter"]

func _can_ground_attack(aircraft_type: String, perks: Array) -> bool:
    if aircraft_type in ["cas_plane", "dive_bomber", "tactical_bomber"]:
        return true
    if aircraft_type == "fighter" and "perk_strafing" in perks:
        return true
    return false

func _can_strategic_bomb(aircraft_type: String) -> bool:
    return aircraft_type in ["strategic_bomber", "tactical_bomber"]
```

### 4b. Update `handle_mouse_input()` — right-click priority order

Replace the existing right-click body (lines 288–341) with:

```gdscript
if event.button_index == MOUSE_BUTTON_RIGHT and _selected_wing_id != "":
    var selected_wing = _get_wing_data(_selected_wing_id)
    if not selected_wing:
        return

    # Priority 1: Enemy wing icons (intercept)
    if _can_intercept(selected_wing.aircraft_type):
        for wing_id in _detected_wings:
            var wing_data = _detected_wings[wing_id]
            if wing_data.get("nation_id", "") == _local_nation_id:
                continue
            var icon_pos = _get_wing_screen_pos(wing_id)
            if icon_pos.distance_to(event.position) <= HIT_THRESHOLD_PX:
                _submit_air_command("ASSIGN_WING_MISSION", {
                    "wing_id":   _selected_wing_id,
                    "mission":   "interception",
                    "target_id": wing_id,
                    "is_manual": true,
                })
                return

    # Priority 2: Land division icons (ground attack)
    if _can_ground_attack(selected_wing.aircraft_type,
                          selected_wing.get("perks", [])):
        var div = _resolve_division_at_screen_pos(event.position)
        if div and div.get("nation_id", "") != _local_nation_id:
            _submit_air_command("ASSIGN_WING_MISSION", {
                "wing_id":   _selected_wing_id,
                "mission":   "tactical_bombing",
                "target_id": div.get("province_id", ""),
                "is_manual": true,
            })
            return

    # Priority 3: Province city markers (strategic bombing)
    if _can_strategic_bomb(selected_wing.aircraft_type):
        var prov = _resolve_province_at_screen_pos(event.position)
        if prov and prov.get("nation_id", "") != _local_nation_id:
            _submit_air_command("ASSIGN_WING_MISSION", {
                "wing_id":   _selected_wing_id,
                "mission":   "industry",
                "target_id": prov.get("province_id", ""),
                "is_manual": true,
            })
            return

    # Priority 4: Fallback — existing move / redeploy behavior
    _handle_existing_right_click(event)
```

`_get_wing_screen_pos(wing_id: String) -> Vector2` — check if this already exists
(air_wing_icon.gd or air_wing_system.gd); if not, derive from the wing's `position_lng`
/ `position_lat` via the same `_map_loader.project_lng_lat()` call used elsewhere.

`_resolve_division_at_screen_pos(pos: Vector2) -> Dictionary` — check if the division
system has a similar helper. If not, iterate `_visible_divisions` (or equivalent) and
return the nearest division within `HIT_THRESHOLD_PX`. Follow the same pattern as the
existing `_resolve_province_at_screen_pos()`.

`_handle_existing_right_click(event)` — extract the current right-click fallback logic
into this private method to keep `handle_mouse_input()` readable.

---

## Step 5: Update `package.json` test chain

Append after the 12g entry:
```
&& NODE_ENV=test mocha -r tsx test/12h-manual-targeting.test.ts --exit --timeout 180000
```

Run full suite — 12a through 12h must all pass:
```bash
cd game-server && npm test
```

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| `computeTransitPath` already takes `turnRadiusDeg` | **Wrong** — it uses the module-level constant; add optional param with fallback |
| A new `MANUAL_TARGET_WING` server message type is needed | **Wrong** — extend `ASSIGN_WING_MISSION` with optional `is_manual: boolean`; no new message |
| Lost-contact requires tracking actual screen visibility | **Wrong** — use `target.is_detected` on the server-side wing state; the server always has the real position |
| `_lastKnownPositions` should be keyed by interceptor wing_id | **Wrong** — key by TARGET wing_id so multiple interceptors chasing the same target share the stored position |
| `_manualTargets` is redundant since `wing.target_id` already exists | **Wrong** — `wing.target_id` is set for ALL intercept missions (including auto-assigned); `_manualTargets` is needed to distinguish manual vs. auto so lost-contact only applies to manual assignments |
| CAS and dive_bomber should be able to right-click intercept | **Wrong** — attack_vs_air = 0 for both; only fighter and heavy_fighter have attack_vs_air > 0 |
| Fighter right-click always enables ground attack | **Wrong** — fighter needs `perk_strafing` perk for ground attack right-click; check `wing.perks` |
| Right-click on enemy city should use AREA mission | **Wrong** — use `industry` mission; AREA targets province scalars and is already handled by the strategic bombing system |
| Strategic bomber should auto-find nearest alternate city when target is captured | **Wrong** — RTB; no "find nearest city" auto-search logic exists |
| LOST_CONTACT_LOITER_TICKS and GROUND_ATTACK_LOITER_MAX_TICKS should be the same value | **Coincidence** — both happen to be 5 by default but are separate constants serving different systems |
| `_resolve_province_at_screen_pos()` returns a province owned by an enemy only | **Wrong** — it returns any province; check `nation_id !== _local_nation_id` in the caller |
