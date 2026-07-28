# Branch G — `feat/strategic-bombing-aa`

## Context

Branches A, K-stubs, B, B-patch, C, D, E, F are all merged. This branch adds
strategic bombing: when a STRATEGIC_BOMBER or TACTICAL_BOMBER on AREA, INDUSTRY,
OIL, or LOGISTICS mission reaches its target and enters LOITER, it damages province-
level scalars instead of the tactical grid. It also adds Province Fixed AA — a single
damage check against the bombing wing at the moment of attack — and the client visuals
for both (flak burst, province damage display in the info panel).

**Test-Driven Development is mandatory.** Write ALL failing tests before implementing
each step.

---

## Critical Pre-Read: Existing Code Facts

The execution agent MUST NOT misassume any of the following.

### ProvinceState — currently minimal

```typescript
export class ProvinceState extends Schema {
  @type("string") province_id: string = "";
  @type("string") owner_id: string = "";
}
```

`industry`, `population`, `infrastructure`, `oil_bombed_until_ms` do **NOT** exist
yet — all must be added in Step 1.

### Map JSON province fields (confirmed in map_data.json)

Each province object in `client/assets/data/western_europe_6/map_data.json` has:
```json
{
  "province_id": "we6_...",
  "nation_id": "...",
  "city_position": [lng, lat],
  "population": 50,
  "industry": 50,
  "infrastructure": 50,
  "resources": { "oil": 0, "steel": 0, ... }
}
```

Oil is nested under `resources.oil`, **not** a top-level `oil` field.

### `_initProvinces` — what it currently reads

`GameRoom.ts` line ~1988 type-asserts the raw JSON as:
```typescript
{ provinces: Array<{ province_id: string; nation_id: string; city_position?: [number, number] }> }
```
It must be widened to include `population`, `industry`, `infrastructure`, and
`resources?: { oil?: number }`.

### `_provinceCityPositionLookup` is private on GameRoom

This `Map<string, { lng: number; lat: number }>` lives on `GameRoom` and is not
passed to any system. `AirStrategicBombingSystem` receives it as a **constructor
argument** — same dependency-injection pattern as other systems.

### `air_bombing_system.ts` — verify before touching (Task F may have already fixed these)

**Read `air_bombing_system.ts` before Step 3 and verify both items:**

1. **`MISSION_TYPES.AREA` in `BOMBING_MISSIONS`** — Task F may have already removed it.
   If `BOMBING_MISSIONS` contains only `TACTICAL_BOMBING`, Step 3a is a no-op; skip it.
2. **`this.state` bug** — check whether the `resolveWingBombed` call uses `this.state`
   (bug) or the `state` tick parameter (already correct). Only apply Step 3b if the bug
   is still present.

Do **not** copy either pattern into the new strategic system regardless.

### MISSION_TYPES confirmed (AirWingState.ts)

```typescript
export const MISSION_TYPES = {
  TACTICAL_BOMBING:   "tactical_bombing",
  AREA:               "area",
  INDUSTRY:           "industry",
  OIL:                "oil",
  LOGISTICS:          "logistics",
  // ... others
} as const;
```

Strategic missions handled by Branch G: `AREA`, `INDUSTRY`, `OIL`, `LOGISTICS`.

### `air_bombing_stats.ts` — already exists

```typescript
export const BOMBING_RANGE_DEG = 0.5;
export const TARGET_NOISE_FLOOR = 0.1;
export const BOMBING_STATS = { ... }; // tactical per-cell stats only
```

Add province bombing stats to **this same file** in Step 4. Do not create a new file.

### gameTick ordering (confirmed from code)

```
movementSystem → combatSystem → supplySystem → frontlineSystem
→ airWingLifecycleSystem.tick()
→ _assignRtbPaths(true)
→ airDubinsPathfinder.tick()
→ airCombatSystem.tick()
→ _assignRtbPaths(false)
→ RELOCATE path loop
→ pending-transit loop
→ airBombingSystem.tick()              ← tactical bombing (Task F)
→ [AirStrategicBombingSystem here]     ← NEW in Step 8c
→ airDetectionSystem.tick()
→ Division state broadcast
```

### `lifecycleSystem.resolveWingBombed` — added in Task F

This method exists on `AirWingLifecycleSystem`. Signature:
`resolveWingBombed(wingId: string, state: GameRoomState, broadcast: BroadcastFn): void`
Call it with the `state` **parameter** from `tick()`, not `this.state`.

### Test-only handlers already registered (do NOT re-register)

`SPAWN_WING`, `SPAWN_DIVISION`, `SET_RELATION`, `SET_CELL`, `SPAWN_NATION`,
`APPLY_PERKS`, `SET_WING_LIFECYCLE`, `SET_WING_READINESS`, `SET_WING_FUEL`,
`SET_WING_TARGET`, `SET_WING_COUNT`, `SET_WING_STATUS_FUEL`, `SET_PATH_ELAPSED`,
`SET_PROVINCE_RADAR`, `SET_WING_POSITION`.

New handlers needed in this branch: `SET_PROVINCE_OWNER`, `SET_PROVINCE_AA`.

### session_manager.gd — existing air handlers (do NOT re-add)

Lines 130–170 already handle: `AIR_WING_UPDATES`, `AIR_WING_PATH`, `WING_DETECTED`,
`WING_LOST_DETECTION`, `RADAR_UPDATED`, `AIR_WING_STAGING`, `AIR_WING_DESTROYED`,
`AIR_COMBAT_STARTED`, `AIR_COMBAT_ENDED`, `AIR_WING_RTB_QUEUED`,
`AIR_WING_MOVE_REJECTED`.

`AIR_BOMBING_PROVINCE_RESULT` and `PROVINCE_AA_FIRED` do **NOT** exist — add in
Step 10.

### event_bus.gd — existing air signals (do NOT re-add)

`air_wing_added`, `air_wing_updated`, `air_wing_removed`, `air_wing_selected`,
`air_wing_deselected`, `air_wing_path`, `air_wing_detected`, `air_wing_detection_lost`,
`air_combat_started`, `air_combat_ended`, `radar_updated`, `division_revealed`,
`division_hidden`, `air_bombing_result`, `air_combat_detail_open_requested`,
`air_combat_detail_closed`, `bombing_detail_open_requested`, `bombing_detail_closed`.

The following do **NOT** exist yet — add in Step 10a:
`air_bombing_province_result`, `province_aa_fired`,
`strategic_bombing_detail_open_requested`, `strategic_bombing_detail_closed`.

### Province panel — `friendly_province_panel.gd`

`populate(province_id: String, data: Dictionary)` currently shows `"--"` for
industry/resources. Branch G adds live bombing-damage display. `game_hud.gd` line
~702 builds the `data` dict from `_map_loader.get_province_data()` (static map JSON)
— update it to also merge live Colyseus province fields.

### Province ownership for tests

Use `SET_PROVINCE_OWNER` (new test handler) to set a province to an enemy nation,
combined with `SET_RELATION` to war. Province IDs in the western europe map are
strings like `"we6_germany_01"` — look up a real province ID by reading
`client/assets/data/western_europe_6/map_data.json` and hardcode one for tests.

### Altitude split — two groups only

```
LOW_ALTITUDE  = ["cas_plane", "dive_bomber", "fighter", "naval_bomber"]
HIGH_ALTITUDE = ["heavy_fighter", "strategic_bomber", "tactical_bomber", "recon_plane"]
```

Province fixed AA deals **more** damage to low-altitude aircraft (easier flak target).

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/src/systems/air_province_aa_system.ts` | `ProvinceAaSystem` class |
| `game-server/src/systems/air_strategic_bombing_system.ts` | `AirStrategicBombingSystem` class |
| `game-server/test/12g-strategic-bombing.test.ts` | All Branch G tests |
| `client/src/ui/hud/strategic_bombing_detail_panel.gd` | Detail panel for strategic bombing results |
| `client/src/ui/hud/strategic_bombing_detail_panel.tscn` | Scene for the detail panel |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/schema/GameRoomState.ts` | Add 4 fields to `ProvinceState` |
| `game-server/src/rooms/GameRoom.ts` | Widen `_initProvinces` type; construct new systems; add test handlers; wire tick |
| `game-server/src/systems/air_bombing_system.ts` | Verify/fix `BOMBING_MISSIONS` and `this.state` bug (see Step 3) |
| `game-server/src/data/air_bombing_stats.ts` | Append province bombing stats + oil debuff duration |
| `game-server/package.json` | Append 12g to test chain |
| `client/src/core/event_bus.gd` | Add 4 new signals |
| `client/src/systems/session/session_manager.gd` | Add 2 new message handlers |
| `client/src/ui/hud/friendly_province_panel.gd` | Display live industry/pop/infra/oil-status |
| `client/src/ui/hud/game_hud.gd` | Merge live Colyseus province data; register strategic bombing detail panel |
| `client/src/systems/air/air_combat_banner.gd` | Dispatch `strategic_bombing_detail_open_requested` when `combat_type == "strategic"` |
| `client/src/systems/air/air_wing_system.gd` | Handle `province_aa_fired` (flak burst) and `air_bombing_province_result` (strategic banner) |

---

## Step 1: Schema Additions — `ProvinceState`

### 1a. Write failing tests first

Create `game-server/test/12g-strategic-bombing.test.ts` with the schema unit tests:

```typescript
import assert from "assert";
import { describe, it } from "mocha";
import { ProvinceState } from "../src/rooms/schema/GameRoomState.js";

describe("ProvinceState — bombing fields", () => {
  it("industry defaults to 50", () => {
    assert.strictEqual(new ProvinceState().industry, 50);
  });
  it("population defaults to 50", () => {
    assert.strictEqual(new ProvinceState().population, 50);
  });
  it("infrastructure defaults to 50", () => {
    assert.strictEqual(new ProvinceState().infrastructure, 50);
  });
  it("oil_bombed_until_ms defaults to 0", () => {
    assert.strictEqual(new ProvinceState().oil_bombed_until_ms, 0);
  });
});
```

Run — all four must fail (`Cannot read properties of undefined`).

### 1b. Add fields to `GameRoomState.ts`

In `ProvinceState`, after `owner_id`:

```typescript
@type("number") industry:            number = 50;
@type("number") population:          number = 50;
@type("number") infrastructure:      number = 50;
@type("number") oil_bombed_until_ms: number = 0;
```

Run the four schema tests — all must pass before proceeding.

---

## Step 2: Load Province Stats in `_initProvinces`

### 2a. Widen the type in `GameRoom.ts`

The actual code uses `getCachedFile<T>(dataPath)` (not `JSON.parse`/`readFileSync`).
Read `_initProvinces` to find the `getCachedFile` call and its current type parameter,
then widen the type to include the new fields:

```typescript
// Find the getCachedFile<T> call — widen T to:
type ProvinceMapData = {
  provinces: Array<{
    province_id:     string;
    nation_id:       string;
    city_position?:  [number, number];
    population?:     number;
    industry?:       number;
    infrastructure?: number;
    resources?:      { oil?: number };
  }>;
};
// Pass ProvinceMapData as the type argument: getCachedFile<ProvinceMapData>(dataPath)
```

### 2b. Populate fields in the loop body

After `slot.owner_id = p.nation_id ?? ""`:

```typescript
if (p.population     !== undefined) slot.population     = p.population;
if (p.industry       !== undefined) slot.industry       = p.industry;
if (p.infrastructure !== undefined) slot.infrastructure = p.infrastructure;
// p.resources?.oil is the province's base oil resource — not stored in ProvinceState;
// oil_bombed_until_ms is a runtime bombing debuff field, defaulting to 0.
```

---

## Step 3: Verify/Fix `air_bombing_system.ts`

**Read `air_bombing_system.ts` first.** Task F may have already made these fixes.

### 3a. Check `BOMBING_MISSIONS` set

If `BOMBING_MISSIONS` already contains **only** `MISSION_TYPES.TACTICAL_BOMBING` →
**skip this step** (already correct).

If it still contains `MISSION_TYPES.AREA`, remove it:

```typescript
// ONLY apply if AREA is still present:
const BOMBING_MISSIONS = new Set([
  MISSION_TYPES.TACTICAL_BOMBING,
]);
```

### 3b. Check `resolveEngagement` call site (method name is `resolveEngagement`, NOT `resolveWingBombed`)

Find the call to `lifecycleSystem.resolveEngagement(...)` inside
`AirBombingSystem.tick()`. If it already passes `state` as the second parameter →
**skip this step** (already correct). The actual method called here is
`resolveEngagement`, not `resolveWingBombed` — do not confuse the two.

**Run 12f tests after Step 3 — must all still pass:**
```bash
cd game-server && NODE_ENV=test mocha -r tsx test/12f-air-bombing-patterns.test.ts --exit --timeout 180000
```

---

## Step 4: Add Province Bombing Stats to `air_bombing_stats.ts`

Append to the existing file (do not replace existing exports):

```typescript
// Province scalar damage per plane per bombing run (values on 0–100 scale)
export const PROVINCE_BOMBING_STATS: Record<string, {
  population_damage:     number;
  infrastructure_damage: number;
  industry_damage:       number;
}> = {
  strategic_bomber: { population_damage: 0.4, infrastructure_damage: 0.3, industry_damage: 0.5 },
  tactical_bomber:  { population_damage: 0.2, infrastructure_damage: 0.2, industry_damage: 0.3 },
};

const DEFAULT_PROVINCE_STATS = {
  population_damage: 0.1, infrastructure_damage: 0.1, industry_damage: 0.1,
};

export function getProvinceBombingStats(aircraftType: string) {
  return PROVINCE_BOMBING_STATS[aircraftType] ?? DEFAULT_PROVINCE_STATS;
}

// Oil debuff duration in ms (real-time clock, not game-speed adjusted)
export let OIL_DEBUFF_DURATION_MS = 120_000; // 2 minutes

export function setOilDebuffDurationForTesting(ms: number): void {
  OIL_DEBUFF_DURATION_MS = ms;
}
```

---

## Step 5: Write All Integration Tests (TDD — write before implementing systems)

Extend `game-server/test/12g-strategic-bombing.test.ts`. Copy boilerplate
(`joinRoom`, `makeToken`, `tickRoom`, server setup) from
`game-server/test/12f-air-bombing-patterns.test.ts`.

Add imports:

```typescript
import { setOilDebuffDurationForTesting } from "../src/data/air_bombing_stats.js";
import {
  setRtbDurationTicksForTesting,
  setRefuelDurationTicksForTesting,
} from "../src/systems/air_wing_lifecycle_system.js";
```

In `before()`:
```typescript
setOilDebuffDurationForTesting(5_000);  // 5 seconds — tests don't wait 2 min
setRtbDurationTicksForTesting(1);
setRefuelDurationTicksForTesting(1);
```
In `after()`, restore all module-level overrides.

### ProvinceAaSystem unit tests (no server — import the class directly)

```typescript
import { ProvinceAaSystem } from "../src/systems/air_province_aa_system.js";

describe("ProvinceAaSystem", () => {
  it("returns 0 damage when no AA strength set", () => {
    const aa = new ProvinceAaSystem();
    assert.strictEqual(aa.computeAaDamage("p01", "strategic_bomber", 10), 0);
  });
  it("returns nonzero damage after setProvinceAaStrength", () => {
    const aa = new ProvinceAaSystem();
    aa.setProvinceAaStrength("p01", 1.0);
    assert.ok(aa.computeAaDamage("p01", "strategic_bomber", 10) > 0);
  });
  it("low-altitude takes more damage than high-altitude at same AA strength", () => {
    const aa = new ProvinceAaSystem();
    aa.setProvinceAaStrength("p01", 1.0);
    const lowDmg  = aa.computeAaDamage("p01", "cas_plane",        10);
    const highDmg = aa.computeAaDamage("p01", "strategic_bomber", 10);
    assert.ok(lowDmg > highDmg,
      `cas_plane (${lowDmg}) should take more AA than strategic_bomber (${highDmg})`);
  });
});
```

### Integration test setup helper

```typescript
async function spawnStrategicBomber(
  room: any, client: any,
  wingId: string, nationId: string, mission: string,
  targetProvId: string, provLng: number, provLat: number,
) {
  await client.send("SPAWN_WING", {
    wing_id: wingId, nation_id: nationId, aircraft_type: "strategic_bomber",
    count: 10, home_airbase_province_id: "we6_germany_01", mission,
    target_id: targetProvId,
  });
  await client.send("SET_WING_POSITION",  { wing_id: wingId, lng: provLng, lat: provLat });
  await client.send("SET_WING_LIFECYCLE", { wing_id: wingId, lifecycle_state: "loiter" });
}
```

### Test cases to write (all integration unless noted)

**AREA mission:**
- `population` decreases after one tick
- `infrastructure` decreases after one tick
- `industry` UNCHANGED (AREA does not touch industry)
- `oil_bombed_until_ms` UNCHANGED

**INDUSTRY mission:**
- `industry` decreases after one tick
- `population` UNCHANGED
- `infrastructure` UNCHANGED

**OIL mission:**
- `oil_bombed_until_ms > Date.now()` after one tick
- `industry`, `population`, `infrastructure` all UNCHANGED

**LOGISTICS mission:**
- No province scalar changes (no-op stub)
- Wing still transitions to RTB (lifecycle called)

**Province scalar floor:**
- `industry`/`population`/`infrastructure` never go below 0
  (Manually set province scalar to 0.1 via direct mutation, then bomb)

**Ownership guard:**
- Wing over own province: no damage applied even with matching mission type

**Province AA (use `SET_PROVINCE_AA` message):**
- `wing.count` unchanged when AA strength = 0
- `wing.count` decreases after bombing run when AA strength = 1.0
- `PROVINCE_AA_FIRED` message received by client listener when AA > 0
- `PROVINCE_AA_FIRED` NOT received when AA = 0

**Broadcast targeting:**
- `AIR_BOMBING_PROVINCE_RESULT` received by attacker nation client
- `AIR_BOMBING_PROVINCE_RESULT` received by defender nation client
- `AIR_BOMBING_PROVINCE_RESULT` NOT received by a third neutral-nation client

**Lifecycle:**
- Wing is in RTB state after the bombing run completes

**Run all tests now — integration tests MUST FAIL; unit tests MUST PASS:**
```bash
cd game-server && NODE_ENV=test mocha -r tsx test/12g-strategic-bombing.test.ts --exit --timeout 180000
```

---

## Step 6: Create `ProvinceAaSystem`

Create `game-server/src/systems/air_province_aa_system.ts`:

```typescript
const LOW_ALTITUDE_TYPES = new Set([
  "cas_plane", "dive_bomber", "fighter", "naval_bomber",
]);
const LOW_ALTITUDE_MULT  = 1.5;
const HIGH_ALTITUDE_MULT = 1.0;

// Planes lost: floor(strength × count × altitudeMult × COEFF)
let AA_DAMAGE_COEFFICIENT = 0.05; // 5% of wing at full AA strength

export function setAaDamageCoefficientForTesting(v: number): void {
  AA_DAMAGE_COEFFICIENT = v;
}

export class ProvinceAaSystem {
  private _strengths = new Map<string, number>(); // province_id → 0.0–1.0+

  setProvinceAaStrength(provinceId: string, strength: number): void {
    this._strengths.set(provinceId, strength);
  }

  computeAaDamage(provinceId: string, aircraftType: string, wingCount: number): number {
    const strength = this._strengths.get(provinceId) ?? 0;
    if (strength <= 0) return 0;
    const mult = LOW_ALTITUDE_TYPES.has(aircraftType)
      ? LOW_ALTITUDE_MULT
      : HIGH_ALTITUDE_MULT;
    return Math.floor(strength * wingCount * mult * AA_DAMAGE_COEFFICIENT);
  }
}
```

Run the three `ProvinceAaSystem` unit tests — all must now pass.

---

## Step 7: Create `AirStrategicBombingSystem`

Create `game-server/src/systems/air_strategic_bombing_system.ts`:

```typescript
import { GameRoomState, ProvinceState } from "../rooms/schema/GameRoomState.js";
import { MISSION_TYPES, WING_LIFECYCLE } from "../rooms/schema/AirWingState.js";
import {
  getProvinceBombingStats, BOMBING_RANGE_DEG, OIL_DEBUFF_DURATION_MS,
} from "../data/air_bombing_stats.js";
import type { AirWingLifecycleSystem } from "./air_wing_lifecycle_system.js";
import type { ProvinceAaSystem }       from "./air_province_aa_system.js";

type BroadcastFn         = (type: string, msg: unknown) => void;
type BroadcastToNationFn = (type: string, msg: unknown, nationId: string) => void;

const STRATEGIC_MISSIONS = new Set([
  MISSION_TYPES.AREA,
  MISSION_TYPES.INDUSTRY,
  MISSION_TYPES.OIL,
  MISSION_TYPES.LOGISTICS,
]);

let DAMAGE_SCALE = 1.0;
export function setProvinceBombingDamageForTesting(scale: number): void {
  DAMAGE_SCALE = scale;
}

function euclidDeg(
  lng1: number, lat1: number, lng2: number, lat2: number,
): number {
  return Math.sqrt((lng1 - lng2) ** 2 + (lat1 - lat2) ** 2);
}

export class AirStrategicBombingSystem {
  constructor(
    private readonly _cityPositions: Map<string, { lng: number; lat: number }>,
  ) {}

  tick(
    state:             GameRoomState,
    lifecycleSystem:   AirWingLifecycleSystem,
    aaSystem:          ProvinceAaSystem,
    broadcast:         BroadcastFn,
    broadcastToNation: BroadcastToNationFn,
  ): void {
    const bombers = [...state.air_wings.values()].filter(w =>
      w.lifecycle_state === WING_LIFECYCLE.LOITER &&
      STRATEGIC_MISSIONS.has(w.mission as any),
    );

    for (const wing of bombers) {
      const target = this._findTargetProvince(wing, state);
      if (!target) continue;
      const [provinceId, province] = target;

      // No friendly-fire
      if (province.owner_id === wing.nation_id) continue;

      // LOGISTICS — stub, no-op; wing still RTBs
      if (wing.mission === MISSION_TYPES.LOGISTICS) {
        lifecycleSystem.resolveWingBombed(wing.wing_id, state, broadcast);
        continue;
      }

      // Province fixed AA — single check at moment of attack
      const aaDamage = aaSystem.computeAaDamage(
        provinceId, wing.aircraft_type, wing.count,
      );
      if (aaDamage > 0) {
        wing.count = Math.max(0, wing.count - aaDamage);
        broadcast("PROVINCE_AA_FIRED", {
          province_id:  provinceId,
          wing_id:      wing.wing_id,
          damage_dealt: aaDamage,
        });
      }

      if (wing.count <= 0) {
        lifecycleSystem.resolveWingBombed(wing.wing_id, state, broadcast);
        continue;
      }

      // Snapshot before-damage values for the broadcast payload
      const industryBefore       = province.industry;
      const populationBefore     = province.population;
      const infrastructureBefore = province.infrastructure;

      // Apply province damage
      const stats = getProvinceBombingStats(wing.aircraft_type);
      const effectiveness = wing.count * wing.combat_readiness * DAMAGE_SCALE;

      if (wing.mission === MISSION_TYPES.AREA) {
        province.population     = Math.max(0,
          province.population     - stats.population_damage     * effectiveness);
        province.infrastructure = Math.max(0,
          province.infrastructure - stats.infrastructure_damage * effectiveness);
      } else if (wing.mission === MISSION_TYPES.INDUSTRY) {
        province.industry = Math.max(0,
          province.industry - stats.industry_damage * effectiveness);
      } else if (wing.mission === MISSION_TYPES.OIL) {
        province.oil_bombed_until_ms = Date.now() + OIL_DEBUFF_DURATION_MS;
      }

      // Capture before-damage values for the detail panel (snapshot already applied above)
      // NOTE: snapshot the values BEFORE applying damage earlier in the tick() method.
      // Move the snapshot to just before the if/else damage block and use these in resultMsg.
      // The broadcast payload must include wing info + before/after so the client panel
      // can display "50 → 46 (−4)" without the client having to remember prior values.
      const resultMsg = {
        province_id:              provinceId,
        mission:                  wing.mission,
        attacker_nation_id:       wing.nation_id,
        defender_nation_id:       province.owner_id,
        wing_id:                  wing.wing_id,
        aircraft_type:            wing.aircraft_type,
        count:                    wing.count,
        // After-damage values (current state):
        industry:                 province.industry,
        population:               province.population,
        infrastructure:           province.infrastructure,
        oil_bombed_until_ms:      province.oil_bombed_until_ms,
        // Before-damage values (snapshot taken before damage was applied):
        industry_before:          industryBefore,
        population_before:        populationBefore,
        infrastructure_before:    infrastructureBefore,
      };
      broadcastToNation("AIR_BOMBING_PROVINCE_RESULT", resultMsg, wing.nation_id);
      broadcastToNation("AIR_BOMBING_PROVINCE_RESULT", resultMsg, province.owner_id);

      lifecycleSystem.resolveWingBombed(wing.wing_id, state, broadcast);
    }
  }

  /** Returns [provinceId, province] for the bombing target.
   *  Prefers wing.target_id if it resolves to a province within range.
   *  Falls back to nearest province city within BOMBING_RANGE_DEG. */
  private _findTargetProvince(
    wing: { position_lng: number; position_lat: number; target_id: string },
    state: GameRoomState,
  ): [string, ProvinceState] | null {
    // 1. Direct target_id lookup
    const direct = state.provinces.get(wing.target_id);
    if (direct) {
      const pos = this._cityPositions.get(wing.target_id);
      if (pos && euclidDeg(
        wing.position_lng, wing.position_lat, pos.lng, pos.lat,
      ) <= BOMBING_RANGE_DEG) {
        return [wing.target_id, direct];
      }
    }

    // 2. Nearest province city within range
    let best: [string, ProvinceState] | null = null;
    let bestDist = Infinity;
    for (const [pid, pos] of this._cityPositions) {
      const prov = state.provinces.get(pid);
      if (!prov) continue;
      const dist = euclidDeg(
        wing.position_lng, wing.position_lat, pos.lng, pos.lat,
      );
      if (dist <= BOMBING_RANGE_DEG && dist < bestDist) {
        bestDist = dist;
        best = [pid, prov];
      }
    }
    return best;
  }
}
```

---

## Step 8: Wire into `GameRoom.ts`

### 8a. Imports and field declarations

```typescript
import { AirStrategicBombingSystem } from "../systems/air_strategic_bombing_system.js";
import { ProvinceAaSystem }          from "../systems/air_province_aa_system.js";

// In class body:
private provinceAaSystem           = new ProvinceAaSystem();
private airStrategicBombingSystem!: AirStrategicBombingSystem; // set after _initProvinces
```

### 8b. Construct after `_initProvinces`

`_cityPositions` is populated by `_initProvinces`; construct the system immediately
after:

```typescript
this._initProvinces(mapId);
this.airStrategicBombingSystem = new AirStrategicBombingSystem(
  this._provinceCityPositionLookup,
);
```

### 8c. Insert into `gameTick` immediately after `airBombingSystem.tick(...)`

```typescript
this.airStrategicBombingSystem.tick(
  this.state,
  this.airWingLifecycleSystem,
  this.provinceAaSystem,
  (type, msg) => this.broadcast(type, msg),
  (type, msg, nationId) => {
    for (const c of this.clients) {
      const p = this.state.players.get(c.sessionId);
      if (!p) continue;
      const n = this.getNationForPlayer(p.userId);
      if (!n || n.nation_id !== nationId) continue;
      c.send(type, msg);
    }
  },
);
```

### 8d. New test-only handlers (inside `NODE_ENV === "test"` block)

```typescript
this.onMessage("SET_PROVINCE_OWNER", (
  _client, msg: { province_id: string; owner_id: string },
) => {
  const prov = this.state.provinces.get(msg.province_id);
  if (prov) prov.owner_id = msg.owner_id;
});

this.onMessage("SET_PROVINCE_AA", (
  _client, msg: { province_id: string; strength: number },
) => {
  this.provinceAaSystem.setProvinceAaStrength(msg.province_id, msg.strength);
});
```

---

## Step 9: Update `package.json`

Append to the `test` script (after the 12f entry):
```
&& NODE_ENV=test mocha -r tsx test/12g-strategic-bombing.test.ts --exit --timeout 180000
```

**Run full test suite — 12a through 12g must all pass:**
```bash
cd game-server && npm test
```

---

## Step 10: Client Changes

### 10a. `event_bus.gd` — add 4 signals

After the last existing air signal (`bombing_detail_closed`):
```gdscript
signal air_bombing_province_result(data: Dictionary)
signal province_aa_fired(data: Dictionary)
signal strategic_bombing_detail_open_requested(data: Dictionary)
signal strategic_bombing_detail_closed()
```

### 10b. `session_manager.gd` — add 2 message handlers

In the `match type:` block, after `AIR_WING_MOVE_REJECTED`:

```gdscript
"AIR_BOMBING_PROVINCE_RESULT":
    EventBus.air_bombing_province_result.emit(data)
"PROVINCE_AA_FIRED":
    EventBus.province_aa_fired.emit(data)
```

### 10c. `game_hud.gd` — merge live Colyseus province data; register new panel

**Part 1 — province populate call.**
In `_on_province_selected` (line ~702), after building `data` from
`_map_loader.get_province_data()`, merge in live bombing-affected scalars.

Check how the rest of the codebase accesses Colyseus province state from GDScript
(look at how `GameState` or `SessionManager.room.state.provinces` is used elsewhere).
Use that same accessor pattern:

```gdscript
# Option A — if GameState.provinces is a Dictionary:
var live: Dictionary = GameState.provinces.get(province_id, {})
for key in ["industry", "population", "infrastructure", "oil_bombed_until_ms"]:
    if live.has(key):
        data[key] = live[key]

# Option B — if accessing Colyseus schema object directly:
var live_prov = SessionManager.room.state.provinces.get(province_id)
if live_prov:
    data["industry"]            = live_prov.industry
    data["population"]          = live_prov.population
    data["infrastructure"]      = live_prov.infrastructure
    data["oil_bombed_until_ms"] = live_prov.oil_bombed_until_ms
```

**Part 2 — register `StrategicBombingDetailPanel`.**
Follow the same pattern used for `BombingDetailPanel` and `AirCombatDetailPanel`:

```gdscript
const StrategicBombingDetailPanelScene = preload(
    "res://client/src/ui/hud/strategic_bombing_detail_panel.tscn")

# In _ready() alongside other panel instantiations:
_strategic_bombing_detail_panel = StrategicBombingDetailPanelScene.instantiate()
add_child(_strategic_bombing_detail_panel)
_register_ui_input_ownership_root(_strategic_bombing_detail_panel)
hud_manager.register_panel("strategic_bombing_detail", _strategic_bombing_detail_panel,
    HUDManager.PlacementMode.FULL_CENTER)

# Connect open/close signals (same pattern as bombing_detail):
EventBus.strategic_bombing_detail_open_requested.connect(func(data: Dictionary) -> void:
    _strategic_bombing_detail_panel.populate(data)
    hud_manager.show_panel("strategic_bombing_detail")
)
EventBus.strategic_bombing_detail_closed.connect(func() -> void:
    hud_manager.hide_panel("strategic_bombing_detail")
)
```

### 10d. `friendly_province_panel.gd` — display live scalars

In `populate()`, read bombing-affected values from `data` and display them. If Label
nodes for these values don't yet exist in the scene, add them as Label nodes —
either in the scene file or created in `_ready()`.

```gdscript
func populate(province_id: String, data: Dictionary) -> void:
    # ... existing name / nation / ownership code unchanged ...

    # Bombing-affected scalars (live from Colyseus schema, 0–100)
    var industry: Variant   = data.get("industry",       null)
    var pop: Variant        = data.get("population",     null)
    var infra: Variant      = data.get("infrastructure", null)
    var oil_until: float    = float(data.get("oil_bombed_until_ms", 0))

    if industry != null and is_instance_valid(_industry_val):
        _industry_val.text = str(int(industry))
    if pop != null and is_instance_valid(_population_val):
        _population_val.text = str(int(pop))
    if infra != null and is_instance_valid(_infrastructure_val):
        _infrastructure_val.text = str(int(infra))

    var now_ms := Time.get_unix_time_from_system() * 1000.0
    var oil_disrupted := oil_until > 0.0 and now_ms < oil_until
    if is_instance_valid(_oil_status_label):
        _oil_status_label.text     = "OIL DISRUPTED" if oil_disrupted else ""
        _oil_status_label.modulate = Color(1.0, 0.4, 0.4) if oil_disrupted else Color.WHITE
```

Declare the node variables and initialize them in `_ready()` from scene node
references (add the nodes to the scene if they do not exist):
```gdscript
var _industry_val:       Label
var _population_val:     Label
var _infrastructure_val: Label
var _oil_status_label:   Label
```

### 10e. `air_wing_system.gd` — flak burst (AA) + strategic bombing banner

**Read `air_wing_system.gd`'s `_on_air_combat_ended` and `_on_air_bombing_result`
methods before implementing.** These are the reference implementations to mirror.

In `setup()`, connect both new signals:
```gdscript
EventBus.province_aa_fired.connect(_on_province_aa_fired)
EventBus.air_bombing_province_result.connect(_on_air_bombing_province_result)
```

**Flak burst handler** — a brief transient circle (not clickable, no banner):
```gdscript
func _on_province_aa_fired(data: Dictionary) -> void:
    var province_id: String = data.get("province_id", "")
    var pdata: Dictionary = _map_loader.get_province_data(province_id)
    if pdata.is_empty():
        return
    var city_pos: Array = pdata.get("city_position", [])
    if city_pos.size() < 2:
        return
    var screen_pos: Vector2 = _map_loader.project_lng_lat(
        float(city_pos[0]), float(city_pos[1]))
    _spawn_flak_burst(screen_pos)

func _spawn_flak_burst(pos: Vector2) -> void:
    # Brief transient visual — matches draw_circle style used throughout air system.
    # Not clickable; no banner; fades in 0.6s.
    var burst := Node2D.new()
    burst.position = pos
    _icon_layer.add_child(burst)
    var script := GDScript.new()
    script.source_code = """
extends Node2D
var _alpha := 1.0
func _draw():
    draw_circle(Vector2.ZERO, 14.0, Color(1.0, 0.75, 0.2, _alpha))
    draw_arc(Vector2.ZERO, 14.0, 0.0, TAU, 20, Color(0.9, 0.4, 0.1, _alpha), 2.0)
"""
    burst.set_script(script)
    var tween := create_tween()
    tween.tween_method(func(a: float):
        if is_instance_valid(burst):
            burst.set("_alpha", a)
            burst.queue_redraw()
    , 1.0, 0.0, 0.6)
    tween.tween_callback(burst.queue_free)
```

> **Alternative if inline GDScript feels fragile**: make `_spawn_flak_burst` a
> dedicated small class file `client/src/systems/air/flak_burst.gd` (extends Node2D,
> draws circle in `_draw()`, tween in `_ready()`). Instantiate it the same way
> `BombingRunIndicator` is instantiated in `_on_air_bombing_result`. Either approach
> works; pick whichever is simpler to read during implementation.

**Strategic bombing banner handler** — reuses `AirCombatBanner` (already has
`combat_type = "strategic"` → purple, with stacking/auto-dismiss built in):

```gdscript
# Tracks strategic bombing banners by province bucket key (same 0.5° logic as
# the existing _dogfight_indicators and _air_combat_banners dictionaries)
var _strategic_bombing_banners: Dictionary = {}  # bucket_key → AirCombatBanner

func _on_air_bombing_province_result(data: Dictionary) -> void:
    var province_id: String = data.get("province_id", "")
    var pdata: Dictionary = _map_loader.get_province_data(province_id)
    if pdata.is_empty():
        return
    var city_pos: Array = pdata.get("city_position", [])
    if city_pos.size() < 2:
        return
    var lng := float(city_pos[0])
    var lat := float(city_pos[1])
    var screen_pos: Vector2 = _map_loader.project_lng_lat(lng, lat)
    var key := _bucket_key(lng, lat)   # reuse existing _bucket_key() helper

    if not _strategic_bombing_banners.has(key) or \
       not is_instance_valid(_strategic_bombing_banners[key]):
        # AirCombatBanner has no .tscn — instantiate from script directly.
        # This is the same pattern used in _on_air_combat_ended. Read that method
        # to confirm the exact preload path ("res://src/systems/air/air_combat_banner.gd").
        var banner: Node2D = preload("res://src/systems/air/air_combat_banner.gd").new()
        _icon_layer.add_child(banner)
        # Pass the same province city position for both "wing" positions so the
        # banner appears at the target, not mid-air between bomber and target.
        banner.setup_with_data(
            screen_pos, screen_pos,
            "strategic",              # combat_type — already defined as purple
            _local_nation_id,
            data.get("attacker_nation_id", ""),
            data.get("defender_nation_id", ""),
            data,                     # first_combat_data — full province result payload
        )
        banner.tree_exited.connect(func(): _strategic_bombing_banners.erase(key))
        _strategic_bombing_banners[key] = banner
    else:
        _strategic_bombing_banners[key].add_combat(data)
```

> **Read `_on_air_combat_ended` in `air_wing_system.gd` and `setup_with_data` in
> `air_combat_banner.gd` before implementing** to get the exact parameter names and
> types. There is no `AirCombatBannerScene` preload constant — the banner is always
> created via `preload("...air_combat_banner.gd").new()`.

In `cleanup()` or `_exit_tree()`, disconnect and clear:
```gdscript
if EventBus.province_aa_fired.is_connected(_on_province_aa_fired):
    EventBus.province_aa_fired.disconnect(_on_province_aa_fired)
if EventBus.air_bombing_province_result.is_connected(_on_air_bombing_province_result):
    EventBus.air_bombing_province_result.disconnect(_on_air_bombing_province_result)
for banner in _strategic_bombing_banners.values():
    if is_instance_valid(banner):
        banner.queue_free()
_strategic_bombing_banners.clear()
```

### 10f. `air_combat_banner.gd` — dispatch to strategic detail panel on click

In `on_clicked()`, check `combat_type` before emitting:

```gdscript
func on_clicked() -> void:
    if _combat_type == "strategic":
        EventBus.strategic_bombing_detail_open_requested.emit({
            "combats": _combats,    # full data array accumulated via add_combat()
        })
    else:
        EventBus.air_combat_detail_open_requested.emit({
            "combats": _combats,
        })
```

> **Read the actual `on_clicked()` implementation** in `air_combat_banner.gd` before
> editing — use the exact variable names for `_combat_type` and `_combats` that already
> exist in the file.

### 10g. Create `strategic_bombing_detail_panel.gd` + `.tscn`

**Copy the structure of `air_combat_detail_panel.gd`** (header row with icon + title +
close button, stacked run sections with HSeparator, ESC key, auto-dismiss timer bar,
`populate()` method, `_close()` emitting `strategic_bombing_detail_closed`).

**Data shape** — each entry in the `combats` array from the banner:
```
{
  province_id, mission, attacker_nation_id, defender_nation_id,
  wing_id, aircraft_type, count,
  industry, population, infrastructure, oil_bombed_until_ms,
  industry_before, population_before, infrastructure_before,
}
```

**Panel layout** (mirrors air_combat_detail_panel style):

```
┌─────────────────────────────────────────────┐
│  ✈  STRATEGIC BOMBING              [✕ close] │
│  Île-de-France  ·  Germany → France          │
├─────────────────────────────────────────────┤
│  12 × Strategic Bomber  (Germany)            │
│  Mission: Area Bombing                       │
│                                              │
│  Industry        50  (unchanged)             │
│  Population      62  →  57   (−5)            │
│  Infrastructure  55  →  52   (−3)            │
│  Oil supply      OK                          │
├─────────────────────────────────────────────┤  ← HSeparator if >1 run
│  [█████████████████░░░░░░]   6.1s            │
└─────────────────────────────────────────────┘
```

**Implementation notes:**
- Use `jet-fighter-up-solid-full.svg` as the header icon (already preloaded elsewhere
  in the project — find the preload path from `air_combat_detail_panel.gd`).
- For each scalar row: if before == after, show `"XX  (unchanged)"` in gray; otherwise
  show `"XX  →  YY  (−Z)"` where Z = before − after.
- Oil row: if `oil_bombed_until_ms > Time.get_unix_time_from_system() * 1000.0`,
  show `"DISRUPTED"` in red; otherwise `"OK"` in normal color.
- **Auto-dismiss timer** — neither `bombing_detail_panel.gd` nor
  `air_combat_detail_panel.gd` implement auto-dismiss; this is **new design work**.
  Add a `Timer` node (or `_process` accumulator) that calls `_close()` after 8 seconds.
  Draw a draining progress bar in `_draw()` using `draw_rect` — same approach as
  `bombing_run_indicator.gd`'s timer arc, adapted to a horizontal bar.
- `_close()` emits `EventBus.strategic_bombing_detail_closed` and calls
  `hud_manager.hide_panel("strategic_bombing_detail")` (same as how `BombingDetailPanel._close()` works — read that file for the exact pattern).
- ESC key closes (copy from `air_combat_detail_panel.gd`).
- Create the `.tscn` file — required so `game_hud.gd` can `preload()` it. Minimal
  scene with just the `PanelContainer` root node + script attached.

---

## Step 11: Verification Checklist

**Server tests:**
```bash
cd game-server && npm test
```
All suites 12a–12g must pass. Note pass/skip count per suite.

**Client visual checks (launch Godot):**

1. Click any owned province → panel shows numeric `industry`, `population`,
   `infrastructure` values (not `--`).

2. Fly a STRATEGIC_BOMBER on AREA mission to enemy province → LOITER → re-click
   province: `population` and `infrastructure` decreased; `industry` unchanged.

3. Fly TACTICAL_BOMBER on INDUSTRY mission → `industry` decreased; pop/infra unchanged.

4. Fly any bomber on OIL mission → province panel shows "OIL DISRUPTED" in red.

5. Use dev command to set province AA = 1.0. Fly CAS plane (AREA mission, low
   altitude) → orange/yellow circle burst at city fades out; wing count decreases;
   `PROVINCE_AA_FIRED` in Godot debug output.

6. Same with strategic bomber (high altitude) → burst appears; wing loses fewer
   planes than CAS plane test at same AA strength.

7. Fly STRATEGIC_BOMBER on AREA mission to enemy province → LOITER → **purple
   `AirCombatBanner` appears at province city** on the map; click it → `StrategicBombingDetailPanel`
   opens showing Population and Infrastructure decreased with before→after values;
   Industry row shows "unchanged"; Oil row shows "OK". Panel auto-dismisses after 8s.

8. Fly LOGISTICS mission → no scalar changes; wing RTBs normally; no banner, no
   `AIR_BOMBING_PROVINCE_RESULT` notification.

9. Fly bomber over own province → no damage; wing RTBs; no result broadcast.

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| `ProvinceState` already has `industry`, `population`, `infrastructure` | **Does NOT** — add all four fields in Step 1 |
| Oil is a top-level field on the province JSON object | **Wrong** — nested under `resources.oil` |
| `MISSION_TYPES.AREA` belongs to the tactical bombing system | **Wrong** — Task F leftover; remove from `BOMBING_MISSIONS` in Step 3a |
| `this.state` is valid inside `AirBombingSystem.tick()` | **Wrong** — use the `state` tick parameter; Task F has this bug; do NOT copy it |
| `AirStrategicBombingSystem` needs its own range constant | **Reuse** `BOMBING_RANGE_DEG = 0.5` from `air_bombing_stats.ts` |
| `_provinceCityPositionLookup` can be read from `GameRoomState` | **Wrong** — private field on `GameRoom`; pass as constructor argument |
| LOGISTICS should reduce road throughput now | **Wrong** — no-op stub; just call `resolveWingBombed` and `continue` |
| Low-altitude aircraft take LESS AA damage | **Wrong** — low-altitude takes MORE flak damage (easier target) |
| `oil_bombed_until_ms` should be server-side only | **Wrong** — `@type("number")` schema field so clients can display disruption state |
| `PROVINCE_AA_FIRED` should be nation-filtered | **Wrong** — AA flak is visible to all; broadcast to ALL clients |
| `AIR_BOMBING_PROVINCE_RESULT` should broadcast to all clients | **Wrong** — send only to attacker nation + defender nation |
| `broadcastToNation` needs a new helper | **Reuse** the exact per-client loop already in `GameRoom.ts` for `airBombingSystem.tick()` |
| `friendly_province_panel` already has Label nodes for industry/pop/infra | **Unknown** — verify in scene; create if missing |
| `GameState.provinces` is always a Dictionary in GDScript | **Verify** — check how other code reads Colyseus province state; use that pattern |
| `SET_PROVINCE_RADAR` can double as the AA setter | **Wrong** — it sets detection radar; `SET_PROVINCE_AA` is a new separate handler |
| Step 3a and 3b always need to be applied | **Wrong** — Task F may have already cleaned these up; verify before touching |
| The strategic bombing map indicator is a new file | **Wrong** — reuse `AirCombatBanner` with `combat_type = "strategic"` (already purple); do NOT create a new indicator scene |
| `AirCombatBannerScene` needs to be preloaded in `air_wing_system.gd` | **Wrong** — no such const exists; use `preload("res://src/systems/air/air_combat_banner.gd").new()` (read `_on_air_combat_ended` for exact path) |
| `air_bombing_result` signal doesn't exist yet | **Wrong** — it exists (added by Task F for tactical bombing); the NEW signal is `air_bombing_province_result` for strategic bombing |
| The flak burst should use a Label with "✸" text | **Wrong** — use a `draw_circle`/`draw_arc` based Node2D (or a small dedicated script file) to match the project's visual style |
| `resultMsg` should only contain after-damage values | **Wrong** — include `industry_before`, `population_before`, `infrastructure_before` so the detail panel can show "50 → 46 (−4)" without client-side memory |
| Damage values are final | **Wrong** — `PROVINCE_BOMBING_STATS` values are tuning stubs; the scalars (industry/population/infrastructure) are stored in ProvinceState but don't feed economy calculations yet (Phase 7+) |
| `on_clicked()` in `air_combat_banner.gd` already handles strategic type | **Wrong** — it currently always emits `air_combat_detail_open_requested`; must add a combat_type check to dispatch to `strategic_bombing_detail_open_requested` instead |
| `resolveWingBombed` takes 2 params `(wingId, state)` | **Wrong** — actual signature is `(wingId, state, broadcast)`; all 3 call sites in Step 7 must pass `broadcast` |
| The method called in `air_bombing_system.ts` is `resolveWingBombed` | **Wrong** — it calls `resolveEngagement`; Step 3b is about `resolveEngagement`, not `resolveWingBombed` |
| `_initProvinces` uses `JSON.parse(readFileSync(...))` | **Wrong** — it uses `getCachedFile<T>(dataPath)`; widen the type parameter on that call, not a `JSON.parse` cast |
| `AirCombatBannerScene` is a preloaded const in `air_wing_system.gd` | **Wrong** — no such const exists; the banner has no `.tscn` scene file; use `preload("res://src/systems/air/air_combat_banner.gd").new()` (read `_on_air_combat_ended` for exact path) |
| `bombing_detail_panel.gd` / `air_combat_detail_panel.gd` have auto-dismiss timers | **Wrong** — neither has one; auto-dismiss in `strategic_bombing_detail_panel.gd` is new work; implement via `Timer` node or `_process` accumulator |
