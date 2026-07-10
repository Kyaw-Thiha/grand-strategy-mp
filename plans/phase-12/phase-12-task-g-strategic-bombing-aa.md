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

### `air_bombing_system.ts` — two things to fix before writing new tests

1. **`MISSION_TYPES.AREA` is currently in `BOMBING_MISSIONS`** (line 13). AREA is a
   strategic mission targeting province scalars — it must be **removed** from the
   tactical system so it is never passed to `resolvePattern()`.
2. **`this.state` bug**: line `lifecycleSystem.resolveWingBombed(wing.wing_id, this.state)`
   references `this.state` which does not exist on `AirBombingSystem`. The correct
   call is `lifecycleSystem.resolveWingBombed(wing.wing_id, state)` (using the `tick()`
   parameter). **Do not copy this bug into the new strategic system.**

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
`resolveWingBombed(wingId: string, state: GameRoomState): void`
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
`division_hidden`.

`air_bombing_province_result` and `province_aa_fired` do **NOT** exist — add in
Step 10a.

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

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/schema/GameRoomState.ts` | Add 4 fields to `ProvinceState` |
| `game-server/src/rooms/GameRoom.ts` | Widen `_initProvinces` type; construct new systems; add test handlers; wire tick |
| `game-server/src/systems/air_bombing_system.ts` | Remove `MISSION_TYPES.AREA` from `BOMBING_MISSIONS`; fix `this.state` bug |
| `game-server/src/data/air_bombing_stats.ts` | Append province bombing stats + oil debuff duration |
| `game-server/package.json` | Append 12g to test chain |
| `client/src/core/event_bus.gd` | Add 2 new signals |
| `client/src/systems/session/session_manager.gd` | Add 2 new message handlers |
| `client/src/ui/hud/friendly_province_panel.gd` | Display live industry/pop/infra/oil-status |
| `client/src/ui/hud/game_hud.gd` | Merge live Colyseus province data into populate call |
| `client/src/systems/air/air_wing_system.gd` | Connect `province_aa_fired`; spawn flak burst |

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

### 2a. Widen the type assertion in `GameRoom.ts`

```typescript
// Before:
const raw = JSON.parse(readFileSync(dataPath, "utf-8")) as {
  provinces: Array<{ province_id: string; nation_id: string; city_position?: [number, number] }>;
};

// After:
const raw = JSON.parse(readFileSync(dataPath, "utf-8")) as {
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

## Step 3: Fix `air_bombing_system.ts`

Make both fixes before writing more tests so the test file can import cleanly.

### 3a. Remove AREA from BOMBING_MISSIONS

```typescript
// Before:
const BOMBING_MISSIONS = new Set([
  MISSION_TYPES.TACTICAL_BOMBING,
  MISSION_TYPES.AREA,
]);

// After:
const BOMBING_MISSIONS = new Set([
  MISSION_TYPES.TACTICAL_BOMBING,
]);
```

### 3b. Fix `this.state` bug

```typescript
// Before:
lifecycleSystem.resolveWingBombed(wing.wing_id, this.state);

// After:
lifecycleSystem.resolveWingBombed(wing.wing_id, state);
```

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
        lifecycleSystem.resolveWingBombed(wing.wing_id, state);
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
        lifecycleSystem.resolveWingBombed(wing.wing_id, state);
        continue;
      }

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

      // Broadcast only to attacker + defender
      const resultMsg = {
        province_id:         provinceId,
        mission:             wing.mission,
        attacker_nation_id:  wing.nation_id,
        defender_nation_id:  province.owner_id,
        industry:            province.industry,
        population:          province.population,
        infrastructure:      province.infrastructure,
        oil_bombed_until_ms: province.oil_bombed_until_ms,
      };
      broadcastToNation("AIR_BOMBING_PROVINCE_RESULT", resultMsg, wing.nation_id);
      broadcastToNation("AIR_BOMBING_PROVINCE_RESULT", resultMsg, province.owner_id);

      lifecycleSystem.resolveWingBombed(wing.wing_id, state);
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

### 10a. `event_bus.gd` — add 2 signals

After the last existing air signal (`division_hidden`):
```gdscript
signal air_bombing_province_result(data: Dictionary)
signal province_aa_fired(data: Dictionary)
```

### 10b. `session_manager.gd` — add 2 message handlers

In the `match type:` block, after `AIR_WING_MOVE_REJECTED`:

```gdscript
"AIR_BOMBING_PROVINCE_RESULT":
    EventBus.air_bombing_province_result.emit(data)
    var mission: String = data.get("mission", "")
    var prov_id: String = data.get("province_id", "")
    EventBus.notification_requested.emit(
        "Air strike on %s — %s bombing complete." % [prov_id, mission.capitalize()],
        "info"
    )
"PROVINCE_AA_FIRED":
    EventBus.province_aa_fired.emit(data)
```

### 10c. `game_hud.gd` — merge live Colyseus province data into populate call

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

### 10e. `air_wing_system.gd` — flak burst visual

In `setup()`, connect the new signal:
```gdscript
EventBus.province_aa_fired.connect(_on_province_aa_fired)
```

Handler and burst implementation:
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
    var lbl := Label.new()
    lbl.text = "✸"
    lbl.position = pos - Vector2(8.0, 8.0)
    lbl.modulate = Color(1.0, 0.8, 0.2, 1.0)
    _icon_layer.add_child(lbl)
    var tween := create_tween()
    tween.tween_property(lbl, "modulate:a", 0.0, 0.6)
    tween.tween_callback(lbl.queue_free)
```

In `cleanup()` or `_exit_tree()`, disconnect:
```gdscript
if EventBus.province_aa_fired.is_connected(_on_province_aa_fired):
    EventBus.province_aa_fired.disconnect(_on_province_aa_fired)
```

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
   altitude) → `✸` flak burst at city; wing count decreases; `PROVINCE_AA_FIRED`
   in Godot debug output.

6. Same with strategic bomber (high altitude) → burst appears; wing loses fewer
   planes than CAS plane test at same AA strength.

7. Fly LOGISTICS mission → no scalar changes; wing RTBs normally; no
   `AIR_BOMBING_PROVINCE_RESULT` notification.

8. Fly bomber over own province → no damage; wing RTBs; no result broadcast.

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
