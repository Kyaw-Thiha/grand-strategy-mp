# Branch E — `feat/air-to-air-combat`

## Context

Branches A, K-stubs, B, B-patch, C, D are all merged. This branch adds real air-to-air combat
resolution: an `AirCombatSystem` that computes damage when opposing wings meet, a per-type stat
table that drives attack/defense/observation values, fuel-tank sub-status, surprise mechanics,
escort logic, and client-side combat visuals. It also migrates `AirDetectionSystem` from a
single global passive radius to per-type `observation_deg` from the stat table, and removes
the debug `console.log` statements added during Branch D debugging.

**Test-Driven Development is mandatory.** Write failing tests before implementing each step.

---

## Critical Pre-Read: Existing Code Facts

The execution agent MUST NOT misassume any of the following:

### Schema — what already exists on `AirWingState`
Fields confirmed present: `wing_id`, `nation_id`, `aircraft_type`, `count`, `fuel`,
`combat_readiness`, `position_lng`, `position_lat`, `heading_deg`, `lifecycle_state`,
`mission`, `target_id`, `home_airbase_province_id`, `path_gen_id`, `path_elapsed_ms`,
`weapon_ready`, `is_detected`, perk booleans.

**`status_fuel` does NOT exist yet** — must be added in Step 1.

### AirWingLifecycleSystem — existing public API
Methods confirmed: `tick()`, `assignMission()`, `triggerContact()`, `resolveEngagement()`,
`disbandWing()`, `setPerk()`, `retreatWing()`, `startRedeploy()`, `completeRedeploy()`,
`isPendingRedeploy()`, `startInterceptionPursuit()`, `queueMissionAfterRedeploy()`,
`getPendingRedeployTarget()`, `queueTransitAfterRedeploy()`, `consumePendingTransitAfterRedeploy()`.

**`getEngagementTarget(wingId)` does NOT exist yet** — must be added in Step 6.
**`startWeaponCooldown(wingId)` does NOT exist yet** — must be added in Step 6.

`triggerContact(wingId, targetWingId, state)`: transitions wingId TRANSIT → ENGAGED and stores
targetWingId in private `_lastEngagedTarget`. Does NOT apply any damage.

`resolveEngagement(wingId, state, broadcast)`: transitions ENGAGED → RTB (single-sortie default)
or LOITER (multi-sortie perk). Clears `_engagementTicks`.

The lifecycle system has an auto-resolve timer (`ENGAGEMENT_AUTO_RESOLVE_TICKS = 2`) that fires
in `tick()` if wings stay ENGAGED. **AirCombatSystem must resolve engagements within the same
tick they are triggered** so this timer never fires in normal play.

### gameTick ordering (confirmed from code)
```
movementSystem → combatSystem → supplySystem → frontlineSystem
→ airWingLifecycleSystem.tick()
→ RTB path loop
→ airDubinsPathfinder.tick()        ← positions finalized; sweep check calls triggerContact
→ RELOCATE path loop
→ pending-transit loop
→ AirDetectionSystem.tick()         ← updates is_detected
→ toUpdate / DIVISION_UPDATES
```

**AirCombatSystem slots in between pending-transit loop and detection:**
```
→ pending-transit loop
→ AirCombatSystem.tick()    ← NEW (reads is_detected before detection updates it)
→ AirDetectionSystem.tick()
```

This ordering is critical for the surprise mechanic: `wing.is_detected` at the start of the
combat tick holds the **previous tick's** detection state — exactly the "before this tick"
detection needed for surprise.

**Do NOT remove the pathfinder's sweep check.** `airDubinsPathfinder.tick()` already calls
`lifecycleSystem.triggerContact()` when wings come within `ENGAGEMENT_RANGE_DEG` — this is
what transitions wings from TRANSIT → ENGAGED. Leave it exactly as-is. AirCombatSystem also
calls `triggerContact()` in its loop, but `triggerContact` is idempotent: if the wing is
already ENGAGED the call is a no-op. The pathfinder sweep check and AirCombatSystem coexist
without conflict. The new responsibility AirCombatSystem adds is: **damage computation** and
calling `resolveEngagement()` so the engagement clears in the same tick (preventing the
2-tick auto-resolve timer from firing).

### airDubinsPathfinder engagement range
Currently `ENGAGEMENT_RANGE_DEG = 0.15` (module-level constant in `air_dubins_pathfinder.ts`).
Branch E requires `ATTACK_RANGE_DEG = 0.3`. **Update the pathfinder default to 0.3 in Step 8**
so pathfinder-triggered contacts match the combat system's range.

### AirDetectionSystem — current passive radius handling
`_isWingDetected()` uses `PASSIVE_WING_RADIUS_DEG = 0.1` for all non-RECON wing sources.
Branch E replaces this with `getObservationDeg(source.aircraft_type)` from the stat table.
`RECON_WING_RADIUS_DEG = 1.0` and the RECON mission multiplier remain unchanged.

**Backwards-compat requirement:** the 12d tests call `setPassiveWingRadiusForTesting(0.5)`.
This function must continue to work — implement it as a global override in `air_unit_stats.ts`
that supersedes the per-type stat value when set (see Step 4).

**Debug console.log statements** at lines 141 and 180 of `air_detection_system.ts` must be
removed in this branch.

### GameRoom.ts — existing test-only handlers (already registered — do NOT re-register)
`SPAWN_WING`, `SPAWN_DIVISION`, `SET_RELATION`, `SET_CELL`, `SPAWN_NATION`, `APPLY_PERKS`,
`SET_WING_LIFECYCLE`, `SET_WING_READINESS`, `SET_WING_FUEL`, `SET_WING_TARGET`,
`SET_PATH_ELAPSED`, `SET_PROVINCE_RADAR`, `SET_WING_POSITION`, `SIMULATE_ENGAGEMENT_START`.

`SET_WING_COUNT` and `SET_WING_STATUS_FUEL` do NOT exist yet — add in Step 9.

### session_manager.gd — existing air handlers
Lines 130–157 already handle: `AIR_WING_UPDATES`, `AIR_WING_PATH`, `WING_DETECTED`,
`WING_LOST_DETECTION`, `DIVISION_REVEALED`, `DIVISION_HIDDEN`, `AIR_WING_STAGING`,
`AIR_WING_DESTROYED`. Do NOT re-add these.

`AIR_COMBAT_STARTED` and `AIR_COMBAT_ENDED` do NOT exist yet — add in Step 11.

### event_bus.gd — existing air signals (lines 84–91)
`air_wing_added`, `air_wing_updated`, `air_wing_removed`, `air_wing_selected`,
`air_wing_deselected`, `air_wing_path`, `air_wing_detected`, `air_wing_detection_lost`.

`air_combat_started`, `air_combat_ended` do NOT exist yet — add in Step 11.

### air_wing_icon.gd — current engaged state
`_lifecycle_color()` already returns `Color(1.0, 0.267, 0.267)` for `"engaged"` (red border).
**Do NOT add a separate red tint** — only add the crosshairs overlay.

### Surprise mechanic — `is_detected` semantics
`wing.is_detected = true` means "this wing has been spotted by at least one hostile nation".

Surprise condition for attacker A vs target T:
- `T.is_detected === true` — A can see T (T was detected last tick)
- `A.is_detected === false` — T cannot see A (A was undetected last tick)

Both values are read **before** `AirDetectionSystem.tick()` runs, giving last-tick state.

### Damage formula
```
base_value = weapon_ready ? attack_vs_air : defense_vs_air
if (isSurprise && weapon_ready && attack_vs_air > 0): base_value *= SURPRISE_MULTIPLIER (2.5)
effective_damage = base_value × count × combat_readiness
```

`status_fuel` does NOT appear in the damage formula — it only multiplies the FUEL DECAY RATE
in lifecycle.tick(). A wing with `status_fuel = 1.5` burns fuel 1.5× faster, not harder.

### `status_fuel` lifecycle integration
Fuel decay line (currently):
```typescript
wing.fuel = Math.max(FUEL_FLOOR, wing.fuel - FUEL_DECAY_PER_TICK);
```
Must become:
```typescript
wing.fuel = Math.max(FUEL_FLOOR, wing.fuel - FUEL_DECAY_PER_TICK * wing.status_fuel);
```
Also reset `wing.status_fuel = 1.0` in the REFUEL → IDLE transition.

### Test directory and naming
`game-server/test/` (no `s`). New file: `12e-air-combat.test.ts`, timeout `180_000`.

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/src/data/air_unit_stats.ts` | Per-type stat table + `getObservationDeg` |
| `game-server/src/systems/air_combat_system.ts` | AirCombatSystem class |
| `game-server/test/12e-air-combat.test.ts` | All combat tests |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/schema/AirWingState.ts` | Add `status_fuel: number = 1.0`; add to `serializeWing` |
| `game-server/src/systems/air_detection_system.ts` | Per-type `observation_deg`; remove debug console.logs |
| `game-server/src/systems/air_wing_lifecycle_system.ts` | Add `getEngagementTarget`, `startWeaponCooldown`; multiply fuel decay by `status_fuel`; clear on refuel |
| `game-server/src/systems/air_dubins_pathfinder.ts` | Update `ENGAGEMENT_RANGE_DEG` 0.15 → 0.3 |
| `game-server/src/rooms/GameRoom.ts` | Add `airCombatSystem`; wire into tick; add `SET_WING_COUNT` + `SET_WING_STATUS_FUEL` |
| `game-server/package.json` | Append 12e to test chain |
| `client/src/core/event_bus.gd` | Add `air_combat_started`, `air_combat_ended` signals |
| `client/src/systems/session/session_manager.gd` | Add `AIR_COMBAT_STARTED`, `AIR_COMBAT_ENDED` handlers |
| `client/src/systems/air/air_wing_icon.gd` | Add crosshairs overlay in `_draw()` when `lifecycle_state == "engaged"` |
| `client/src/systems/air/air_wing_system.gd` | Track engaged pairs; draw engagement lines; handle combat events |

---

## Step 1: Schema Addition — `status_fuel` on AirWingState

### 1a. Write failing test first

In `game-server/test/12e-air-combat.test.ts`, add a pure unit test (no server needed):

```typescript
import assert from "assert";
import { describe, it } from "mocha";
import { AirWingState } from "../src/rooms/schema/AirWingState.js";

describe("AirWingState — status_fuel field", () => {
  it("defaults status_fuel to 1.0", () => {
    const wing = new AirWingState();
    assert.strictEqual(wing.status_fuel, 1.0, "status_fuel must default to 1.0");
  });
});
```

Run it — expect failure (`TypeError: Cannot read properties of undefined`).

### 1b. Add field

In `game-server/src/rooms/schema/AirWingState.ts`, after `is_detected`:

```typescript
@type("number") status_fuel: number = 1.0;
```

Add to `serializeWing()` return object:
```typescript
status_fuel: wing.status_fuel,
```

Run the schema test — it must now pass.

---

## Step 2: Create `air_unit_stats.ts`

Create `game-server/src/data/air_unit_stats.ts`:

```typescript
export interface AirUnitStats {
  attack_vs_air: number;
  defense_vs_air: number;
  observation_deg: number;
}

const STAT_TABLE: Record<string, AirUnitStats> = {
  fighter:          { attack_vs_air: 0.25, defense_vs_air: 0.03, observation_deg: 0.25 },
  heavy_fighter:    { attack_vs_air: 0.22, defense_vs_air: 0.05, observation_deg: 0.35 },
  cas_plane:        { attack_vs_air: 0.0,  defense_vs_air: 0.03, observation_deg: 0.25 },
  dive_bomber:      { attack_vs_air: 0.0,  defense_vs_air: 0.03, observation_deg: 0.25 },
  tactical_bomber:  { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.25 },
  strategic_bomber: { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.25 },
  naval_bomber:     { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.25 },
  recon_plane:      { attack_vs_air: 0.0,  defense_vs_air: 0.01, observation_deg: 0.5  },
};

const DEFAULT_STATS: AirUnitStats = { attack_vs_air: 0.0, defense_vs_air: 0.0, observation_deg: 0.05 };

// Module-level override: when set, supersedes stat table for all non-recon_plane types.
// Used by setPassiveWingRadiusForTesting() in air_detection_system.ts for 12d backwards-compat.
let _passiveOverride: number | null = null;

export function setPassiveObservationOverrideForTesting(v: number | null): void {
  _passiveOverride = v;
}

export function getAirUnitStats(aircraftType: string): AirUnitStats {
  return STAT_TABLE[aircraftType] ?? DEFAULT_STATS;
}

export function getObservationDeg(aircraftType: string): number {
  if (_passiveOverride !== null && aircraftType !== "recon_plane") return _passiveOverride;
  return (STAT_TABLE[aircraftType] ?? DEFAULT_STATS).observation_deg;
}
```

---

## Step 3: Write All Combat Tests First (TDD)

Create `game-server/test/12e-air-combat.test.ts` with the full test suite. Copy boilerplate
from `game-server/test/12d-air-detection.test.ts` for `joinRoom`, `makeToken`, server setup,
and `tickRoom`.

Add these imports at top:

```typescript
import {
  setAttackRangeForTesting,
  setSurpriseMultiplierForTesting,
} from "../src/systems/air_combat_system.js";
import {
  setRtbDurationTicksForTesting,
  setRefuelDurationTicksForTesting,
  setReadinessDecayForTesting,
  setReadinessRecoveryForTesting,
} from "../src/systems/air_wing_lifecycle_system.js";
import { setPassiveWingRadiusForTesting } from "../src/systems/air_detection_system.js";
```

In `before()`:
```typescript
setPassiveWingRadiusForTesting(0.01);   // wings don't accidentally detect each other
setAttackRangeForTesting(0.3);
setSurpriseMultiplierForTesting(2.5);
setRtbDurationTicksForTesting(2);
setRefuelDurationTicksForTesting(1);
setReadinessDecayForTesting(0.001);     // keep readiness near 1.0 during tests
setReadinessRecoveryForTesting(0.5);
```

In `after()`, restore all defaults.

### Test cases to include

**Stat table unit tests (no server):**
- `status_fuel` defaults to 1.0 on new AirWingState
- `getAirUnitStats("fighter").attack_vs_air > 0`
- `getAirUnitStats("strategic_bomber").attack_vs_air === 0`
- `getObservationDeg("heavy_fighter") === 0.35`
- `getObservationDeg("fighter") === 0.25`
- `getObservationDeg("recon_plane") === 0.5`

**Attack vs Defense branch:**
- `weapon_ready = true` uses `attack_vs_air` — reduces enemy count by ~2–3
- `weapon_ready = false` uses `defense_vs_air` — reduces enemy count by ≤1
- Pure bomber (`attack_vs_air = 0`) deals negligible damage even with `weapon_ready = true`

**Surprise mechanic:**
- S=2.5 when target.is_detected=true AND attacker.is_detected=false → 5+ count loss on 10-plane wing
- No bonus when both detect each other → base-level damage only
- Pure bomber unaffected by surprise (0 × anything = 0)

**WING_DESTROYED broadcast:**
- `AIR_WING_DESTROYED` fires (or wing is removed) when count reaches 0
- Test with 10 fighters + surprise vs 1 fighter to guarantee kill

**Targeting priority:**
- INTERCEPTION mission picks bomber-class target over fighter-class when both in range
- AIR_SUPERIORITY mission picks fighter-class target over bomber-class

**Target deconfliction:**
- 3 friendly wings vs 2 enemies: both enemies take damage (unique primary assignment before overflow)

**Escort mission:**
- ESCORT wing (`mission = MISSION_TYPES.ESCORT`, `target_id = bomber_wing_id`) engages the enemy threatening its bomber, not the nearest decoy enemy

**Fuel tank sub-status:**
- `status_fuel` becomes 1.5 on surviving target after fighter full attack (`weapon_ready=true, attack_vs_air>0`)
- `status_fuel` clears to 1.0 after RTB + refuel cycle completes
- Wing with `status_fuel=1.5` loses more fuel per tick than base rate

**Per-type observation_deg in detection:**
- `heavy_fighter` (0.35°) detects enemy 0.2° away; `fighter` (0.25°) does not

**Run all tests after Step 3 — ALL must fail (implementation not written yet):**
```bash
cd game-server && NODE_ENV=test mocha -r tsx test/12e-air-combat.test.ts --exit --timeout 180000
```

---

## Step 4: Update `AirDetectionSystem`

### 4a. Remove debug console.log statements

In `game-server/src/systems/air_detection_system.ts`, remove ALL three debug lines:
- Line 141: `console.log(\`[AirDetection] nation=${nation} can see divisions:...\`)`
- Line 180: `console.log(\`[AirDetection] checking wing=${wing.wing_id}...\`)`
- Line 187: `console.log(\`[AirDetection] wing=${wing.wing_id} REVEALS div=...\`)`

### 4b. Import `getObservationDeg` and update passive detection

```typescript
import { getObservationDeg, setPassiveObservationOverrideForTesting } from "../data/air_unit_stats.js";
```

Update `setPassiveWingRadiusForTesting` to also set the override in `air_unit_stats.ts`:

```typescript
export function setPassiveWingRadiusForTesting(v: number): void {
  PASSIVE_WING_RADIUS_DEG = v;
  setPassiveObservationOverrideForTesting(v);
}
```

In `_isWingDetected()`, replace the passive radius line:
```typescript
// Before:
const radius = source.mission === MISSION_TYPES.RECON ? RECON_WING_RADIUS_DEG : PASSIVE_WING_RADIUS_DEG;
// After:
const radius = source.mission === MISSION_TYPES.RECON
  ? RECON_WING_RADIUS_DEG
  : getObservationDeg(source.aircraft_type);
```

**Run 12d tests after Step 4 — must all still pass:**
```bash
cd game-server && NODE_ENV=test mocha -r tsx test/12d-air-detection.test.ts --exit --timeout 180000
```

---

## Step 5: Update `AirDubinsPathfinder` engagement range

In `game-server/src/systems/air_dubins_pathfinder.ts`, change:
```typescript
let ENGAGEMENT_RANGE_DEG = 0.15;
```
to:
```typescript
let ENGAGEMENT_RANGE_DEG = 0.3;
```

No test changes needed — existing 12c tests use `setEngagementRangeForTesting` explicitly.

---

## Step 6: Add lifecycle methods + integrate `status_fuel`

In `game-server/src/systems/air_wing_lifecycle_system.ts`:

### New public methods

```typescript
getEngagementTarget(wingId: string): string | undefined {
  return this._lastEngagedTarget.get(wingId);
}

startWeaponCooldown(wingId: string, state: GameRoomState): void {
  const wing = state.air_wings.get(wingId);
  if (!wing) return;
  wing.weapon_ready = false;
  this._weaponCooldown.set(wingId, WEAPON_COOLDOWN_TICKS);
}
```

### Fuel decay with `status_fuel`

```typescript
// Before:
wing.fuel = Math.max(FUEL_FLOOR, wing.fuel - FUEL_DECAY_PER_TICK);
// After:
wing.fuel = Math.max(FUEL_FLOOR, wing.fuel - FUEL_DECAY_PER_TICK * wing.status_fuel);
```

### Clear on refuel completion

In the `WING_LIFECYCLE.REFUEL` case, inside `if (ticks >= REFUEL_DURATION_TICKS)`:
```typescript
wing.status_fuel = 1.0;
```

---

## Step 7: Create `AirCombatSystem`

Create `game-server/src/systems/air_combat_system.ts`:

```typescript
import { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { AirWingState, MISSION_TYPES, WING_LIFECYCLE } from "../rooms/schema/AirWingState.js";
import { getAirUnitStats } from "../data/air_unit_stats.js";
import type { AirWingLifecycleSystem } from "./air_wing_lifecycle_system.js";

type BroadcastFn = (type: string, msg: unknown) => void;

let ATTACK_RANGE_DEG    = 0.3;
let SURPRISE_MULTIPLIER = 2.5;

export function setAttackRangeForTesting(v: number): void      { ATTACK_RANGE_DEG = v; }
export function setSurpriseMultiplierForTesting(v: number): void { SURPRISE_MULTIPLIER = v; }

function euclidDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  return Math.sqrt((lng1 - lng2) ** 2 + (lat1 - lat2) ** 2);
}

const BOMBER_TYPES = new Set(["strategic_bomber", "tactical_bomber", "cas_plane", "dive_bomber"]);
const FIGHTER_TYPES = new Set(["fighter", "heavy_fighter"]);

function scoreTarget(targetType: string, mission: string): number {
  if (mission === MISSION_TYPES.INTERCEPTION)   return BOMBER_TYPES.has(targetType)  ? 10 : 1;
  if (mission === MISSION_TYPES.AIR_SUPERIORITY) return FIGHTER_TYPES.has(targetType) ? 10 : 1;
  return 1;
}

function areHostile(nationA: string, nationB: string, state: GameRoomState): boolean {
  if (nationA === nationB) return false;
  const rel = state.relations.get(`${nationA}|${nationB}`)
    ?? state.relations.get(`${nationB}|${nationA}`);
  return (rel?.stance ?? "neutral") === "war";
}

export class AirCombatSystem {
  private _resolvedThisTick = new Set<string>();

  tick(state: GameRoomState, lifecycleSystem: AirWingLifecycleSystem, broadcast: BroadcastFn): void {
    this._resolvedThisTick.clear();

    const COMBAT_STATES = new Set([WING_LIFECYCLE.TRANSIT, WING_LIFECYCLE.LOITER, WING_LIFECYCLE.ENGAGED]);
    const candidates = [...state.air_wings.values()]
      .filter(w => COMBAT_STATES.has(w.lifecycle_state as WING_LIFECYCLE));

    const assignments = this._deconflict(this._findPairs(state, candidates), state);

    // Merge escort assignments without overwriting primary assignments
    for (const [escortId, targetId] of this._findEscortTargets(state, candidates)) {
      if (!assignments.has(escortId)) assignments.set(escortId, targetId);
    }

    for (const [attackerWingId, targetWingId] of assignments) {
      const pairKey = [attackerWingId, targetWingId].sort().join("|");
      if (this._resolvedThisTick.has(pairKey)) continue;
      this._resolvedThisTick.add(pairKey);

      const attacker = state.air_wings.get(attackerWingId);
      const target   = state.air_wings.get(targetWingId);
      if (!attacker || !target) continue;

      const isSurprise = target.is_detected === true && attacker.is_detected === false;

      broadcast("AIR_COMBAT_STARTED", { wing_a_id: attackerWingId, wing_b_id: targetWingId, is_surprise: isSurprise });

      this._resolveOneSide(attacker, target, isSurprise, state, lifecycleSystem);
      this._resolveOneSide(target,   attacker, false,     state, lifecycleSystem);

      // Trigger lifecycle transitions then resolve immediately (don't let auto-timer fire)
      lifecycleSystem.triggerContact(attackerWingId, targetWingId, state);
      lifecycleSystem.triggerContact(targetWingId, attackerWingId, state);
      lifecycleSystem.resolveEngagement(attackerWingId, state, broadcast);
      lifecycleSystem.resolveEngagement(targetWingId, state, broadcast);

      const aDestroyed = attacker.count <= 0;
      const tDestroyed = target.count <= 0;
      broadcast("AIR_COMBAT_ENDED", { wing_a_id: attackerWingId, wing_b_id: targetWingId,
        attacker_destroyed: aDestroyed, target_destroyed: tDestroyed });

      if (tDestroyed) {
        broadcast("AIR_WING_DESTROYED", { wing_id: targetWingId, nation_id: target.nation_id,
          destroyed_by_wing_id: attackerWingId });
        lifecycleSystem.disbandWing(targetWingId, state, broadcast);
      }
      if (aDestroyed) {
        broadcast("AIR_WING_DESTROYED", { wing_id: attackerWingId, nation_id: attacker.nation_id,
          destroyed_by_wing_id: targetWingId });
        lifecycleSystem.disbandWing(attackerWingId, state, broadcast);
      }
    }
  }

  private _resolveOneSide(
    attacker: AirWingState, target: AirWingState,
    isSurprise: boolean,
    state: GameRoomState, lifecycleSystem: AirWingLifecycleSystem,
  ): void {
    const stats = getAirUnitStats(attacker.aircraft_type);
    let baseValue = attacker.weapon_ready ? stats.attack_vs_air : stats.defense_vs_air;
    if (isSurprise && attacker.weapon_ready && stats.attack_vs_air > 0) {
      baseValue = stats.attack_vs_air * SURPRISE_MULTIPLIER;
    }
    const damage = Math.floor(baseValue * attacker.count * attacker.combat_readiness);
    target.count = Math.max(0, target.count - damage);

    // Fuel-tank sub-status: surviving target gets increased fuel-decay rate
    if (attacker.weapon_ready && stats.attack_vs_air > 0 && target.count > 0) {
      target.status_fuel = +(target.status_fuel * 1.5).toFixed(4);
    }

    lifecycleSystem.startWeaponCooldown(attacker.wing_id, state);
  }

  private _findPairs(
    state: GameRoomState, candidates: AirWingState[],
  ): Array<{ attackerWingId: string; targetWingId: string }> {
    const pairs: Array<{ attackerWingId: string; targetWingId: string }> = [];
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i], b = candidates[j];
        if (!areHostile(a.nation_id, b.nation_id, state)) continue;
        if (euclidDeg(a.position_lng, a.position_lat, b.position_lng, b.position_lat) <= ATTACK_RANGE_DEG) {
          pairs.push({ attackerWingId: a.wing_id, targetWingId: b.wing_id });
          pairs.push({ attackerWingId: b.wing_id, targetWingId: a.wing_id });
        }
      }
    }
    return pairs;
  }

  private _deconflict(
    pairs: Array<{ attackerWingId: string; targetWingId: string }>,
    state: GameRoomState,
  ): Map<string, string> {
    const byAttacker = new Map<string, string[]>();
    for (const { attackerWingId, targetWingId } of pairs) {
      if (!byAttacker.has(attackerWingId)) byAttacker.set(attackerWingId, []);
      byAttacker.get(attackerWingId)!.push(targetWingId);
    }

    const claimed    = new Set<string>();
    const result     = new Map<string, string>();

    for (const attackerId of [...byAttacker.keys()].sort()) {
      const attacker = state.air_wings.get(attackerId);
      if (!attacker) continue;
      const targets = (byAttacker.get(attackerId) ?? []).sort((a, b) => {
        const wa = state.air_wings.get(a), wb = state.air_wings.get(b);
        if (!wa || !wb) return 0;
        return scoreTarget(wb.aircraft_type, attacker.mission)
             - scoreTarget(wa.aircraft_type, attacker.mission);
      });
      const chosen = targets.find(t => !claimed.has(t)) ?? targets[0];
      if (chosen) { result.set(attackerId, chosen); claimed.add(chosen); }
    }
    return result;
  }

  private _findEscortTargets(
    state: GameRoomState, candidates: AirWingState[],
  ): Map<string, string> {
    const result = new Map<string, string>();
    for (const escort of candidates) {
      if (escort.mission !== MISSION_TYPES.ESCORT) continue;
      const bomber = state.air_wings.get(escort.target_id);
      if (!bomber) continue;
      for (const enemy of candidates) {
        if (!areHostile(escort.nation_id, enemy.nation_id, state)) continue;
        const distToBomber = euclidDeg(bomber.position_lng, bomber.position_lat,
          enemy.position_lng, enemy.position_lat);
        const distToEscort = euclidDeg(escort.position_lng, escort.position_lat,
          enemy.position_lng, enemy.position_lat);
        if (distToBomber <= ATTACK_RANGE_DEG && distToEscort <= ATTACK_RANGE_DEG) {
          result.set(escort.wing_id, enemy.wing_id);
          break;
        }
      }
    }
    return result;
  }
}
```

---

## Step 8: Wire `AirCombatSystem` into `GameRoom.ts`

### 8a. Import and declare

```typescript
import { AirCombatSystem } from "../systems/air_combat_system.js";
// In class body:
private airCombatSystem = new AirCombatSystem();
```

### 8b. Insert into gameTick

After the pending-transit loop and BEFORE `this.airDetectionSystem.tick(...)`:
```typescript
this.airCombatSystem.tick(
  this.state,
  this.airWingLifecycleSystem,
  (type, msg) => this.broadcast(type, msg),
);
```

### 8c. Add test-only handlers (inside the `NODE_ENV === "test"` block)

```typescript
this.onMessage("SET_WING_COUNT", (_client, msg: { wing_id: string; count: number }) => {
  const wing = this.state.air_wings.get(msg.wing_id);
  if (wing) wing.count = Math.max(0, msg.count);
});

this.onMessage("SET_WING_STATUS_FUEL", (_client, msg: { wing_id: string; status_fuel: number }) => {
  const wing = this.state.air_wings.get(msg.wing_id);
  if (wing) wing.status_fuel = msg.status_fuel;
});
```

---

## Step 9: Update `package.json`

Append to the `test` script (after the 12d entry):
```
&& NODE_ENV=test mocha -r tsx test/12e-air-combat.test.ts --exit --timeout 180000
```

**Run full test suite — all 12a through 12e must pass:**
```bash
cd game-server && npm test
```

---

## Step 10: Client Changes

### 10a. `event_bus.gd` — add signals

After `air_wing_detection_lost`:
```gdscript
signal air_combat_started(data: Dictionary)
signal air_combat_ended(data: Dictionary)
```

### 10b. `session_manager.gd` — add message handlers

In the match block handling room messages (near existing air handlers):
```gdscript
"AIR_COMBAT_STARTED":
    EventBus.air_combat_started.emit(data)
"AIR_COMBAT_ENDED":
    EventBus.air_combat_ended.emit(data)
```

### 10c. `air_wing_icon.gd` — crosshairs when engaged

In `_draw()`, after drawing the diamond border, before `_draw_aircraft_symbol()`:
```gdscript
if lifecycle_state == "engaged":
    var c := Color(1.0, 1.0, 1.0, 0.85)
    draw_line(Vector2(-DIAMOND_HALF, 0), Vector2(DIAMOND_HALF, 0), c, 1.5)
    draw_line(Vector2(0, -DIAMOND_HALF), Vector2(0, DIAMOND_HALF), c, 1.5)
```

### 10d. `air_wing_system.gd` — engagement lines

Add dict and connect signals in `setup()`:
```gdscript
var _engaged_pairs: Dictionary = {}

# In setup():
EventBus.air_combat_started.connect(_on_air_combat_started)
EventBus.air_combat_ended.connect(_on_air_combat_ended)

func _on_air_combat_started(data: Dictionary) -> void:
    var a: String = data.get("wing_a_id", "")
    var b: String = data.get("wing_b_id", "")
    if a and b:
        _engaged_pairs[a] = b
        _engaged_pairs[b] = a
    queue_redraw()

func _on_air_combat_ended(data: Dictionary) -> void:
    _engaged_pairs.erase(data.get("wing_a_id", ""))
    _engaged_pairs.erase(data.get("wing_b_id", ""))
    queue_redraw()
```

In `_draw()` (on the icon layer Node2D), draw engagement lines:
```gdscript
var drawn_keys := {}
for wing_id: String in _engaged_pairs:
    var opp: String = str(_engaged_pairs[wing_id])
    var parts := PackedStringArray([wing_id, opp])
    parts.sort()
    var key := ",".join(parts)
    if drawn_keys.has(key):
        continue
    drawn_keys[key] = true
    var icon_a = _icons.get(wing_id)
    var icon_b = _icons.get(opp)
    if is_instance_valid(icon_a) and is_instance_valid(icon_b):
        draw_line(icon_a.position, icon_b.position, Color(1, 0.2, 0.2, 0.7), 1.5)
```

Also clear `_engaged_pairs` in `cleanup()`.

---

## Step 11: Verification Checklist

**Server tests:**
```bash
cd game-server && npm test
```
All suites 12a–12e must pass. Note how many passed/skipped for each suite.

**Client visual checks (launch Godot):**
1. Two opposing fighters at war fly toward each other → red engagement line appears; crosshairs appear on both icons when `lifecycle_state == "engaged"`
2. After engagement resolves → icons RTB or disappear; engagement line clears
3. 10 fighters (Germany) + surprise vs 1 fighter (France) → French wing destroyed, `AIR_WING_DESTROYED` in Godot debug output
4. Bomber escorted by heavy fighter vs incoming interceptor → escort engages interceptor, bomber takes minimal damage
5. Set `status_fuel = 1.5` via debug handler → fuel bar depletes noticeably faster
6. After damaged wing RTBs and refuels → fuel depletes at normal rate
7. Heavy fighter and regular fighter side by side → heavy fighter's detection circle is larger

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| `status_fuel` already exists on AirWingState | **Does NOT** — add in Step 1 |
| `getEngagementTarget()` exists on lifecycle system | **Does NOT** — add in Step 6 |
| `startWeaponCooldown()` exists on lifecycle system | **Does NOT** — add in Step 6 |
| AirCombatSystem runs AFTER AirDetectionSystem | **Wrong** — runs BEFORE; `is_detected` must reflect last tick |
| `PASSIVE_WING_RADIUS_DEG` stays as production value | **No** — replaced by per-type `getObservationDeg()` |
| `setPassiveWingRadiusForTesting` must be updated in 12d tests | **No** — keep as wrapper; set global override in `air_unit_stats.ts` |
| `ENGAGEMENT_RANGE_DEG` in pathfinder stays at 0.15 | **No** — update to 0.3 to match ATTACK_RANGE_DEG |
| `status_fuel` multiplies outgoing damage | **No** — multiplies FUEL DECAY RATE only |
| `AIR_WING_DESTROYED` handler needs to be added to `session_manager.gd` | **Already at line 157** — do NOT duplicate |
| `air_wing_icon.gd` needs a new red tint for engaged | `_lifecycle_color()` already returns red — only add crosshairs |
| Escort targets nearest enemy | **No** — targets the enemy threatening its assigned BOMBER (`target_id`) |
| Damage formula includes attacker's `status_fuel` | **No** — `effective_damage = base_value × count × combat_readiness` only |
| `triggerContact` applies damage | **No** — it only transitions TRANSIT → ENGAGED and stores the target pair |
| The pathfinder sweep check should be moved into AirCombatSystem | **No** — leave it in the pathfinder. AirCombatSystem also calls `triggerContact` (idempotent no-op if already ENGAGED). The pathfinder triggers the state transition; AirCombatSystem handles damage + `resolveEngagement` |
| AirCombatSystem candidates are only TRANSIT and LOITER | **Wrong** — must include ENGAGED. The pathfinder sweep check calls `triggerContact` (TRANSIT → ENGAGED) in the same tick BEFORE AirCombatSystem runs. Without ENGAGED in the candidate set, the combat system skips those wings and the 2-tick auto-resolve timer fires instead. Always use `new Set([TRANSIT, LOITER, ENGAGED])` |

---

## Post-Implementation Fixes (discovered during test run)

The initial implementation was completed but 7 of 22 tests fail. This section documents the root
causes and the **exact changes required** to fix them. An execution agent MUST address all items
below before this branch can be considered done.

### ACS Design Bug — Count-snapshot + one-directional attacks

**Root cause (tests 1, 2, 4, 5):**

The current `tick()` loop processes each entry in `assignments` as the **primary attacker**, then
immediately calls `_resolveOneSide(target, attacker, false)` — an automatic retaliation — before
moving to the next assignment. Two problems compound:

1. **Count modified before retaliation uses it.** When A attacks B (reducing B.count), then B
   retaliates using `B.count` (already reduced), the retaliator fires with fewer planes than it
   had at the start of the exchange. Example: 10-fighter France attacks Germany (2 dmg → Germany
   has 8), then Germany retaliates with count=8 → `floor(0.25 × 8 × 1.0) = 1` dmg (not 2).
   France ends with count=9 instead of 8.

2. **`isSurprise` is hardcoded `false` for the retaliation.** If Germany is undetected it should
   get the 2.5× surprise bonus when it fires, but `_resolveOneSide(target, attacker, false)` always
   passes `false`. The undetected wing never benefits from its own surprise.

3. **`_resolvedThisTick` pairKey dedup prevents the correct AIR_SUPERIORITY assignment.** Germany
   is assigned `germany → france_wing_02 (fighter)` by deconflict. But `france_wing_01 (bomber)`
   processes first (alphabetically), Germany retaliates against the bomber, and the pairKey
   `france_wing_01|germany_wing_01` is marked resolved — preventing Germany from attacking its
   intended target (the fighter) via its own deconflict assignment.

**Fix — rewrite `tick()` to be one-directional with count snapshots:**

```typescript
tick(state: GameRoomState, lifecycleSystem: AirWingLifecycleSystem, broadcast: BroadcastFn): void {
  const COMBAT_STATES = new Set([WING_LIFECYCLE.TRANSIT, WING_LIFECYCLE.LOITER, WING_LIFECYCLE.ENGAGED]);
  const candidates = [...state.air_wings.values()]
    .filter(w => COMBAT_STATES.has(w.lifecycle_state as WING_LIFECYCLE));

  const pairs = this._findPairs(state, candidates);
  const assignments = this._deconflict(pairs, state);
  for (const [escortId, targetId] of this._findEscortTargets(state, candidates)) {
    if (!assignments.has(escortId)) assignments.set(escortId, targetId);
  }

  // Snapshot counts before any damage — simultaneous combat uses tick-start counts
  const countSnapshots = new Map<string, number>();
  for (const wing of state.air_wings.values()) countSnapshots.set(wing.wing_id, wing.count);

  // Track engaged pairs for lifecycle transitions + AIR_COMBAT_ENDED broadcasts
  const engagedPairs: Array<[string, string]> = [];

  // One-directional attacks — NO automatic retaliation
  for (const [attackerWingId, targetWingId] of assignments) {
    const attacker = state.air_wings.get(attackerWingId);
    const target   = state.air_wings.get(targetWingId);
    if (!attacker || !target) continue;

    const isSurprise = target.is_detected === true && attacker.is_detected === false;
    broadcast("AIR_COMBAT_STARTED", { wing_a_id: attackerWingId, wing_b_id: targetWingId, is_surprise: isSurprise });

    // Pass snapshot count so damage is based on tick-start strength, not post-hit strength
    this._resolveOneSide(attacker, target, isSurprise,
      countSnapshots.get(attackerWingId) ?? attacker.count, state, lifecycleSystem);

    engagedPairs.push([attackerWingId, targetWingId]);
  }

  // Lifecycle transitions and destruction (deduplicated per wing)
  const lifecycleProcessed = new Set<string>();
  for (const [attackerWingId, targetWingId] of engagedPairs) {
    for (const [wingId, otherId] of [[attackerWingId, targetWingId], [targetWingId, attackerWingId]] as [string, string][]) {
      if (lifecycleProcessed.has(wingId)) continue;
      lifecycleProcessed.add(wingId);

      const wing = state.air_wings.get(wingId);
      if (!wing) continue;

      if (wing.count <= 0) {
        broadcast("AIR_WING_DESTROYED", { wing_id: wingId, nation_id: wing.nation_id, destroyed_by_wing_id: otherId });
        lifecycleSystem.disbandWing(wingId, state, broadcast);
      } else {
        lifecycleSystem.triggerContact(wingId, otherId, state);
        lifecycleSystem.resolveEngagement(wingId, state, broadcast);
      }
    }

    const aWing = state.air_wings.get(attackerWingId);
    const tWing = state.air_wings.get(targetWingId);
    broadcast("AIR_COMBAT_ENDED", {
      wing_a_id: attackerWingId, wing_b_id: targetWingId,
      attacker_destroyed: !aWing || aWing.count <= 0,
      target_destroyed:   !tWing || tWing.count <= 0,
    });
  }
}
```

**Update `_resolveOneSide` signature** to accept a snapshot count:

```typescript
private _resolveOneSide(
  attacker: AirWingState, target: AirWingState,
  isSurprise: boolean,
  attackerCountSnapshot: number,    // ← NEW — use this for damage, not attacker.count
  state: GameRoomState, lifecycleSystem: AirWingLifecycleSystem,
): void {
  const stats = getAirUnitStats(attacker.aircraft_type);
  let baseValue = attacker.weapon_ready ? stats.attack_vs_air : stats.defense_vs_air;
  if (isSurprise && attacker.weapon_ready && stats.attack_vs_air > 0) {
    baseValue = stats.attack_vs_air * SURPRISE_MULTIPLIER;
  }
  const damage = Math.floor(baseValue * attackerCountSnapshot * attacker.combat_readiness);
  target.count = Math.max(0, target.count - damage);

  if (attacker.weapon_ready && stats.attack_vs_air > 0 && target.count > 0) {
    target.status_fuel = +(target.status_fuel * 1.5).toFixed(4);
  }

  lifecycleSystem.startWeaponCooldown(attacker.wing_id, state);
}
```

**Remove `_resolvedThisTick`** — the private field, its `.clear()` call, and all related logic.
It was needed only for pairKey dedup in the old bidirectional design.

**Remove the debug `console.log`** at line 47 (`[ACS tick]`) and line 67 (`[COMBAT]`).

---

### Test 3 — Wrong broadcast-capture API

`(room as any).onMessage("AIR_WING_DESTROYED", cb)` on the **server-side room handle** registers
a CLIENT→SERVER message handler, not a SERVER broadcast listener. The callback never fires.

**Fix:** Destructure `client` from `joinRoom()` and listen on the client connection:

```typescript
const { client, room } = await joinRoom();
// ...
let destroyedWingId = "";
client.onMessage("AIR_WING_DESTROYED", (msg: any) => {
  destroyedWingId = msg.wing_id;
});
```

Also change `lifecycle_state = WING_LIFECYCLE.TRANSIT` on frWing (count=1) so it's a candidate.
The rest of the test logic is correct — with the ACS redesign, Germany's undetected surprise
attack deals `floor(0.25 × 2.5 × 10 × ≈1.0) = 6` dmg to frWing (count=1) → count=0 → destroyed.

---

### Test 6 — status_fuel refuel: wrong initial state

The test sets `gerWing.lifecycle_state = WING_LIFECYCLE.IDLE` expecting the next tick to run a
refuel cycle and clear `status_fuel`. But `status_fuel` is only cleared in the **REFUEL → IDLE**
transition, not when already IDLE.

**Fix:** Set `lifecycle_state = WING_LIFECYCLE.REFUEL` instead. With
`setRefuelDurationTicksForTesting(1)`, one tick completes refuel and clears `status_fuel` to 1.0.

```typescript
gerWing.lifecycle_state = WING_LIFECYCLE.REFUEL;  // was IDLE
gerWing.status_fuel = 1.5;
gerWing.fuel = 0.5;
await tickRoom(room);
assert.strictEqual(gerWing.status_fuel, 1.0, "status_fuel should reset after refuel");
```

---

### Test 7 — Fuel decay comparison threshold is stale

The test comment says `// Base decay = 0.065 * 1.5 = 0.0975` — this was written when
`FUEL_DECAY_PER_TICK = 0.065`. The current default is `0.01`.

Actual per-tick loss with `status_fuel=1.5`: `0.01 × 1.5 = 0.015`.

**Fix the assertion:**
```typescript
// Replace:
assert.ok(fuelLost > 0.065, ...);
// With:
assert.ok(fuelLost > 0.01, `Fuel loss should exceed base rate at 1.5x, got ${fuelLost}`);
```

Import `FUEL_DECAY_PER_TICK` from the lifecycle module to keep the threshold DRY (it is already
exported: `export { FUEL_DECAY_PER_TICK, FUEL_RTB_THRESHOLD }`).

---

### Additional features — implemented in this branch

These were discussed and agreed during review and implemented as part of this branch:

**Transit vs loiter fuel decay split** (lifecycle system):
```typescript
let FUEL_DECAY_TRANSIT = 0.02;   // higher: engines at cruise power
let FUEL_DECAY_LOITER  = 0.008;  // lower: throttled back in orbit

const fuelRate = wing.lifecycle_state === WING_LIFECYCLE.LOITER
  ? FUEL_DECAY_LOITER
  : FUEL_DECAY_TRANSIT;
wing.fuel = Math.max(FUEL_FLOOR, wing.fuel - fuelRate * wing.status_fuel);
```
Test helpers `setFuelDecayTransitForTesting` and `setFuelDecayLoiterForTesting` are exported.

**Air-to-air readiness spike** (in `_resolveOneSide`):
```typescript
const READINESS_COMBAT_SPIKE_AIR = 0.12;
if (stats.attack_vs_air > 0) {
  attacker.combat_readiness = Math.max(0, attacker.combat_readiness - READINESS_COMBAT_SPIKE_AIR);
  target.combat_readiness   = Math.max(0, target.combat_readiness   - READINESS_COMBAT_SPIKE_AIR);
}
```
Both wings lose readiness when involved in air combat.

**Detection overlay follow fix** (`client/src/systems/air/air_wing_system.gd`):
In `_process()`, `_sync_detection_overlay(wing_id)` is called so the detection circle
follows the icon during TRANSIT.

**Attack range ring UI** (`air_wing_icon.gd`):
When selected, a red arc is drawn at `combat_radius_px` (0.3° attack range converted to pixels).
The outer ground-detection circle (`RECON_WING_RADIUS_DEG = 1.0°`) is suppressed for non-recon
aircraft types.

---

### Debug console.log removal

Debug logs in `air_combat_system.ts` were removed. No debug console.log statements remain.
