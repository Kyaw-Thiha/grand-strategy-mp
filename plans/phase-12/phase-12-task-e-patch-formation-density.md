# Branch E-Patch — Formation Density + Escort Path Following

## Context

Branch E (`feat/air-combat`) is merged. This patch fixes a gap (escort wings do not
mirror their bomber's Dubins path — they fight correctly but wander independently on
the client) and adds three mechanics that were scoped to Branch E but never implemented:
wing sub-status flags, formation density defense bonus, and airbase congestion.

**Test-Driven Development is mandatory.** Write ALL failing tests before each step.

---

## Critical Pre-Read

### Escort path mirroring — gap confirmed

In `air_combat_system.ts`, `_findEscortTargets()` (lines 172–193) finds enemies
attacking the escorted bomber and returns the fight target. It does NOT sync paths.

The bomber's `path_gen_id` and `path_elapsed_ms` are set in `GameRoom.ts` lines
198–199 after `computeTransitPath()`. Escorts never receive these values.

The fix belongs in `air_dubins_pathfinder.ts` tick — after incrementing the bomber's
`path_elapsed_ms`, scan for ESCORT wings whose `target_id === bomber.wing_id` and
copy `path_gen_id` and `path_elapsed_ms`. The client `DubinsInterpolator` then
renders the escort at the same position as the bomber.

### AirWingState — sub-status fields missing

`game-server/src/rooms/schema/AirWingState.ts` currently has only `status_fuel`.
These three do NOT exist yet and must be added:
- `status_engine: number = 1.0`
- `status_weapons: number = 1.0`
- `status_instruments: number = 1.0`

### air_unit_stats.ts — no min_turn_radius_deg yet (not this branch)

Per-type turn radius is planned for the NEXT branch (manual targeting). Do NOT add it here.

### Test handlers already registered (do NOT re-register)

`SET_WING_LIFECYCLE`, `SET_WING_READINESS`, `SET_WING_FUEL`, `SET_WING_COUNT`,
`SET_WING_STATUS_FUEL`, `SET_PATH_ELAPSED`, `SET_WING_POSITION`, `SPAWN_WING`,
`SPAWN_NATION`, `SET_RELATION`.

### gameTick ordering (confirmed from actual GameRoom.ts code)

```
airWingLifecycleSystem.tick()    ← line ~1290
→ airDubinsPathfinder.tick()     ← path_elapsed_ms incremented here (~1295)
→ airCombatSystem.tick()         ← escort combat targeting here (~1299)
→ RELOCATE loop                  ← (~1308)
→ pending-transit loop           ← (~1335)
→ airBombingSystem.tick()        ← (~1377)
→ airDetectionSystem.tick()      ← (~1393)
```

This ordering is correct in code and matches what this plan documents. The original
Branch E *plan doc* listed a slightly different order — ignore the plan doc; trust
the actual GameRoom.ts code.

Escort path sync must happen INSIDE `airDubinsPathfinder.tick()` — after the bomber's
`path_elapsed_ms` is incremented — so that the synced value is already up-to-date
when combat resolves.

### `_sync_detection_overlay` in `air_wing_system.gd` is a stub — out of scope

Line 399–400 of `air_wing_system.gd` has `_sync_detection_overlay(wing_id)` with a
`pass` / "Deferred" comment. This is a Branch E visual gap. Do NOT fix it in this
patch — it is out of scope.

### Recon observation_deg = 1.0 in actual code (plan doc said 0.5)

The code has `recon_plane: { observation_deg: 1.0 }` and the high-level plan is stale.
This patch does NOT change observation values. Do not "fix" recon to 0.5.

### `fuel_decay_rate` field on `AirWingState` — read before implementing congestion

`AirWingState` has a `fuel_decay_rate: number = 0.02` field that the lifecycle system
updates each tick. Before implementing airbase congestion (Step 6), read
`air_wing_lifecycle_system.ts` to understand whether:
- Fuel RECOVERY for IDLE wings is driven by a direct `status_fuel +=` expression, OR
- The `fuel_decay_rate` field is what gets modified (and recovery is indirect)

Apply the congestion penalty to whichever mechanism controls IDLE fuel recovery —
do not blindly assume `status_fuel += FUEL_RECOVERY_RATE * congestionFactor` is the
right expression if the actual system uses a different pattern.

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/test/12e-patch-formation-density.test.ts` | All E-patch tests |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/schema/AirWingState.ts` | Add 3 sub-status fields |
| `game-server/src/systems/air_dubins_pathfinder.ts` | Escort path sync in tick |
| `game-server/src/systems/air_combat_system.ts` | Apply status_weapons to attack/defense; apply formation density bonus |
| `game-server/src/systems/air_wing_lifecycle_system.ts` | Sub-status triggers; airbase congestion |
| `game-server/src/systems/air_bombing_system.ts` | Apply status_instruments to bombing reach |
| `game-server/src/data/air_unit_stats.ts` | MAX_FORMATION_BONUS and FORMATION_DENSITY_CAP constants |
| `game-server/package.json` | Append e-patch to test chain |

---

## Step 1: Escort Path Mirroring

### 1a. Write failing tests

Create `game-server/test/12e-patch-formation-density.test.ts`. Copy server setup
boilerplate (`joinRoom`, `makeToken`, `tickRoom`) from `12e-air-combat.test.ts`.

```typescript
describe("Escort path mirroring", () => {
  it("escort wing.path_gen_id matches bomber wing.path_gen_id after tick", async () => {
    // SPAWN_NATION attacker + SPAWN_NATION defender + SET_RELATION war
    // SPAWN_WING bomber: nation=attacker, mission=TACTICAL_BOMBING
    // SPAWN_WING escort: nation=attacker, mission=ESCORT, target_id=bomber.wing_id
    // SET_WING_LIFECYCLE bomber → "transit"
    // tick once
    // assert escort.path_gen_id === bomber.path_gen_id
    // assert escort.path_elapsed_ms === bomber.path_elapsed_ms
  });

  it("escort path_elapsed_ms follows bomber each tick", async () => {
    // same setup, tick 3 times
    // assert escort.path_elapsed_ms === bomber.path_elapsed_ms after each tick
  });

  it("non-ESCORT wing is unaffected by path sync", async () => {
    // SPAWN_WING with mission=INTERCEPTION (not ESCORT)
    // tick — confirm wing.path_gen_id is NOT overwritten to bomber's value
  });
});
```

Run — must FAIL.

### 1b. Implement in `air_dubins_pathfinder.ts`

Inside the `tick()` method, after the loop that increments `path_elapsed_ms` for
active wings, add a second pass:

```typescript
// Sync escort wings to their bomber's path so the client renders them co-located
for (const escort of state.air_wings.values()) {
  if (escort.mission !== MISSION_TYPES.ESCORT) continue;
  if (escort.lifecycle_state !== WING_LIFECYCLE.TRANSIT &&
      escort.lifecycle_state !== WING_LIFECYCLE.LOITER) continue;
  const bomber = state.air_wings.get(escort.target_id);
  if (!bomber || !bomber.path_gen_id) continue;
  escort.path_gen_id     = bomber.path_gen_id;
  escort.path_elapsed_ms = bomber.path_elapsed_ms;
}
```

Run escort tests — must PASS.

---

## Step 2: Sub-Status Schema Fields

### 2a. Write failing tests

```typescript
import { AirWingState } from "../src/rooms/schema/AirWingState.js";

describe("AirWingState sub-status fields", () => {
  it("status_engine defaults to 1.0", () => {
    assert.strictEqual(new AirWingState().status_engine, 1.0);
  });
  it("status_weapons defaults to 1.0", () => {
    assert.strictEqual(new AirWingState().status_weapons, 1.0);
  });
  it("status_instruments defaults to 1.0", () => {
    assert.strictEqual(new AirWingState().status_instruments, 1.0);
  });
});
```

Run — must FAIL (`status_engine is undefined`).

### 2b. Add to `AirWingState.ts`

After `status_fuel`:

```typescript
@type("number") status_engine:      number = 1.0;
@type("number") status_weapons:     number = 1.0;
@type("number") status_instruments: number = 1.0;
```

Run schema tests — must PASS.

---

## Step 3: Sub-Status Triggers

### Constants (add at top of the relevant system files)

In `air_combat_system.ts`:

```typescript
const INSTRUMENTS_DECAY_PER_HIT = 0.05;  // per defense return-fire event
```

In `air_wing_lifecycle_system.ts`:

```typescript
const ENGINE_DECAY_PER_LANDING  = 0.04;
const WEAPONS_DECAY_PER_LANDING = 0.04;
let _landingToggle = false;               // alternates engine vs weapons each landing
```

### Trigger 1: Defense return fire → status_instruments

In `air_combat_system.ts`, where a defending wing takes return damage (the existing
return-fire block), after reducing `defender.count`:

```typescript
wing.status_instruments = Math.max(0, wing.status_instruments - INSTRUMENTS_DECAY_PER_HIT);
```

### Trigger 2: AA fire → status_fuel (already in Branch E)

Confirm this exists. Do NOT modify it.

### Trigger 3: Fighter full attack landing → alternates engine/weapons

In `air_wing_lifecycle_system.ts`, in the logic that transitions a fighter from LOITER
back to TRANSIT/RTB after a full engagement cycle:

```typescript
if (_landingToggle) {
  wing.status_engine  = Math.max(0, wing.status_engine  - ENGINE_DECAY_PER_LANDING);
} else {
  wing.status_weapons = Math.max(0, wing.status_weapons - WEAPONS_DECAY_PER_LANDING);
}
_landingToggle = !_landingToggle;
```

### Tests for triggers

```typescript
describe("Sub-status triggers", () => {
  it("return fire reduces status_instruments", async () => { ... });
  it("fighter landing alternates engine/weapons degradation", async () => { ... });
  it("landing twice degrades engine then weapons (not same field twice)", async () => { ... });
  it("each sub-status floors at 0", async () => { ... });
});
```

---

## Step 4: Sub-Status Effects

### Effect 1: status_engine → wing speed

In `air_dubins_pathfinder.ts`, when computing tick distance:

```typescript
// Before:
const tickDistanceDeg = WING_SPEED_DEG_PER_MS * tickMs;

// After:
const tickDistanceDeg = WING_SPEED_DEG_PER_MS * tickMs * wing.status_engine;
```

### Effect 2: status_weapons → attack and defense

In `air_combat_system.ts`, in the damage resolution:

```typescript
const effectiveAttack  = baseAttack  * attacker.status_weapons;
const effectiveDefense = baseDefense * defender.status_weapons;
```

### Effect 3: status_instruments → bombing pattern reach

In `air_bombing_system.ts`, when computing the pattern radius (check field name in
`air_bombing_stats.ts` — likely `reach` or `radius`):

```typescript
const reach = BASE_REACH_DEG * wing.status_instruments;
```

### Tests for effects

```typescript
describe("Sub-status effects", () => {
  it("status_engine=0.5 halves travel distance per tick", async () => { ... });
  it("status_weapons=0.5 halves damage dealt", async () => { ... });
  it("status_instruments=0.5 halves bombing reach", async () => { ... });
});
```

---

## Step 5: Formation Density Defense Bonus

### 5a. Constants in `air_unit_stats.ts`

```typescript
export const MAX_FORMATION_BONUS   = 0.4;
export const FORMATION_DENSITY_CAP = 36; // planes — at or above this, full bonus applies
```

### 5b. Apply in combat

In `air_combat_system.ts`, modify effective defense calculation:

```typescript
import { MAX_FORMATION_BONUS, FORMATION_DENSITY_CAP, getAirUnitStats } from "../data/air_unit_stats.js";

const baseDefense  = getAirUnitStats(defender.aircraft_type).defense_vs_air;
const densityBonus = Math.min(defender.count / FORMATION_DENSITY_CAP, 1.0) * MAX_FORMATION_BONUS;
const effectiveDefense = baseDefense * (1 + densityBonus) * defender.status_weapons;
```

### 5c. Tests

```typescript
describe("Formation density defense bonus", () => {
  it("wing with count=36 takes less damage than count=1", async () => { ... });
  it("bonus does not increase past count=36", async () => {
    // count=72 takes same damage as count=36
  });
  it("count=1 has no formation bonus", async () => { ... });
});
```

---

## Step 6: Airbase Congestion

### 6a. Constants in `air_wing_lifecycle_system.ts`

```typescript
const CONGESTION_FREE_WINGS = 3;    // no penalty up to this many wings per base
const CONGESTION_FACTOR     = 0.15; // recovery rate penalty per additional wing above free cap
```

### 6b. Apply in IDLE recovery

In `air_wing_lifecycle_system.ts`, at the start of the tick, build a count map:

```typescript
const wingsPerBase = new Map<string, number>();
for (const w of state.air_wings.values()) {
  if (w.lifecycle_state === WING_LIFECYCLE.IDLE) {
    wingsPerBase.set(w.province_id, (wingsPerBase.get(w.province_id) ?? 0) + 1);
  }
}
```

Then in the IDLE wing recovery loop:

```typescript
const wingsAtBase      = wingsPerBase.get(wing.province_id) ?? 1;
const excess           = Math.max(0, wingsAtBase - CONGESTION_FREE_WINGS);
const congestionFactor = 1 / (1 + excess * CONGESTION_FACTOR);

wing.fuel             = Math.min(1.0, wing.fuel             + FUEL_RECOVERY_RATE      * congestionFactor);
wing.combat_readiness = Math.min(1.0, wing.combat_readiness + READINESS_RECOVERY_RATE * congestionFactor);
```

**IMPORTANT:** `wing.fuel` is the actual fuel level (0–1). `wing.status_fuel` is the
fuel-decay-rate multiplier (default 1.0, higher = burns fuel faster) — do NOT write
to `status_fuel` here or it will corrupt the decay math.

`FUEL_RECOVERY_RATE` and `READINESS_RECOVERY_RATE` are module-level `let` bindings
inside `air_wing_lifecycle_system.ts` — they are NOT exported. In tests, control them
via `setFuelRecoveryForTesting(rate)` and `setReadinessRecoveryForTesting(rate)`.
Do not attempt to import the rate constants directly.

### 6c. Tests

```typescript
describe("Airbase congestion", () => {
  it("single wing at base recovers at full rate", async () => { ... });
  it("4 wings at same base recover slower than 1 wing alone", async () => { ... });
  it("congestion never fully stops recovery (rate always > 0)", async () => { ... });
  it("wings at different bases do not affect each other", async () => { ... });
});
```

---

## Step 7: Update `package.json` test chain

Append after the 12e entry:
```
&& NODE_ENV=test mocha -r tsx test/12e-patch-formation-density.test.ts --exit --timeout 180000
```

Run full suite — 12a through 12e-patch must all pass:
```bash
cd game-server && npm test
```

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| Escort path sync belongs in `air_combat_system.ts` | **Wrong** — belongs in `air_dubins_pathfinder.ts` tick, AFTER `path_elapsed_ms` is incremented, so the synced value is already current |
| `escort.path_gen_id = bomber.path_gen_id` only needs to run once | **Wrong** — sync EVERY tick so `path_elapsed_ms` stays aligned; the client interpolates position from both fields together |
| Sub-status triggers exist in Branch E | **Wrong** — only `status_fuel` trigger (for AA fire) exists; all three new triggers are net-new |
| Formation density bonus should use some `MAX_PLANES_PER_WING` field | **Wrong** — use `FORMATION_DENSITY_CAP = 36` as the saturation point; that constant may not exist elsewhere |
| Airbase congestion should have a hard cap (zero recovery past N wings) | **Wrong** — soft penalty only; recovery rate is never zero, just reduced |
| `status_engine`, `status_weapons`, `status_instruments` should recover over time | **Not in this patch** — recovery is deferred to a future patch; these fields only decay here |
| The `_landingToggle` flag should be per-wing | **Wrong** — a single module-level toggle is sufficient for the alternating behavior |
| Congestion should write to `wing.status_fuel` | **Wrong** — `status_fuel` is the decay-rate multiplier (default 1.0); write to `wing.fuel` (the actual 0–1 fuel level) |
| `FUEL_RECOVERY_RATE` can be imported from the lifecycle module | **Wrong** — it is a module-level `let` binding, not exported; use `setFuelRecoveryForTesting()` in tests |
| Recon observation_deg should be changed to 0.5 | **Wrong** — actual code has 1.0; the plan doc was stale; do not change it |
