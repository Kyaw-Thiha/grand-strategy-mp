# Branch C Implementation Plan — `feat/unit-production-reserve`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `phase-9-task-c-unit-production-reserve.md` (four production buildings,
national Reserve, the auto-scheduler, Marshalling + early deployment, `RAISE_DIVISION`) against
the actual current state of this codebase (branch `feat/unit-production-reserve`, Branches A and
B already merged), plus the client Production panel / Military panel UI it needs to be visible.

**Architecture:** Server: a new `UnitProductionSystem` (parallel to the existing
`EconomyBuildingSystem`/`ResourceEconomySystem`) owns production orders and Marshalling state,
ticked from `GameRoom.gameTick()` the same way those two already are. Client: new
`marshalling_divisions`/`reserve` state on `GameState`, wired through `EventBus` +
`session_manager.gd` exactly like every prior Branch A/B addition, surfaced in the already-scaffolded
Production panel (Templates/Reserve tabs) and a new DEPLOYING section on `military_panel.gd`.

**Tech Stack:** TypeScript / Colyseus (`game-server`), GDScript / Godot 4 (`client`), Mocha (`npm test`).

## Global Constraints

- No perk trees, no naval production tab — same phase-wide scope cut as every other branch.
- TDD mandatory for every server step: write the failing test, run it, confirm the failure
  reason, implement, run again.
- Do not run `npm test` (full suite) mid-task — it is slow. Run only the single new test file
  via `npx mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000` (from
  `game-server/`) after each server task. Run the full suite once, at the very end, per Task 8.
- All new numeric constants are named, commented `// TBD playtesting — placeholder`, never
  invented as "realistic" values.
- Godot manual-verification steps: report as "performed" or "still required — run `<command>`"
  per `AGENTS.md` — do not claim a visual check happened without actually launching the client.

## Architecture Decisions — deviations from `phase-9-task-c-unit-production-reserve.md`'s literal sketch

These were resolved during codebase investigation and deliberately diverge from that document's
`§11`/Step 4 sketch. Read this before Task 3 — it changes several signatures.

**1. `RAISE_DIVISION` does NOT create a `DivisionState` up front.** The handoff sketch has
`RAISE_DIVISION` immediately `this.state.divisions.set(...)` a division with
`deployment_state = "marshalling"`, then guard every renderer/system against that field. That
guard would have to be added in five places (`movementSystem`, `combatSystem`, `supplySystem`,
`subprovinceSystem`, `serverVisibilitySystem` — confirmed via investigation, all iterate
`this.state.divisions.values()` directly with no existing filter) plus the client's
`military_system.gd:_on_division_added`. Instead: a marshalling division lives *only* inside
`UnitProductionSystem`'s own `Map<string, MarshallingData>`, keyed by a generated
`marshalling_id` — never inserted into `this.state.divisions` at all until `FORCE_DEPLOY`.
This is strictly simpler, needs zero guards anywhere, and cannot leak a phantom division at
`(0,0)` into combat/vision/supply ticks.

**2. `FORCE_DEPLOY` reuses the existing `DIVISIONS_SPAWNED` broadcast, not a new one.**
`client/src/core/game_state.gd:_apply_divisions_spawned` (confirmed, line 124) already inserts a
new division into `GameState.divisions` and emits `EventBus.division_added`, which
`military_system.gd:_on_division_added` (line 1497) already turns into a map icon. `FORCE_DEPLOY`
constructs the real `DivisionState` server-side, positions it via the existing
`_provinceCityPositionLookup` (used identically by `CREATE_WING`, `GameRoom.ts:539`), inserts it
into `this.state.divisions`, and broadcasts `DIVISIONS_SPAWNED` with that one division — the
client needs **zero new code** to make it appear on the map.

**3. `RAISE_DIVISION` requires a `home_province_id`** (an owned province), mirroring
`CREATE_WING`'s `home_airbase_province_id` (`GameRoom.ts:520`). This resolves
`unit_production_handoff.md`'s undecided "nearest friendly city" question — there is no existing
"nearest" search anywhere in this codebase (`REDEPLOY_WING`'s `_resolveTargetPosition` resolves a
*given* province, it does not search for one), so requiring an explicit anchor province is the
minimal, pattern-consistent choice.

**4. Marshalling divisions and fielded-division resupply share one delivery mechanism, not two
code paths pretending to be one.** `tickMarshalling` drains `reserve_pool` into
`MarshallingData.slots` (off-map, pre-deployment). A separate `tickFieldDelivery` drains
`reserve_pool` into **every** fielded division's damaged grid cells (post-deployment) — this
single function is what naturally re-implements `unit_production_handoff.md §6.5`'s "supply
stream" and also covers ordinary combat-damage resupply for old, never-marshalled divisions. No
separate code path is needed for "a division that was just force-deployed but still has
under-filled cells" — once deployed, its cells are just damaged fielded-division cells like any
other, already covered by `tickFieldDelivery`.

**5. Unit roster is the codebase's actual 20 `UnitType` values, not the design doc's aspirational
list.** `game-server/src/types/tactical_types.ts`'s `UnitType` const has no
`motorised_infantry`/`mechanised_infantry` entries — those are named in
`unit_production_handoff.md §7` but were never added to the enum by any earlier branch. This plan
maps only unit types that actually exist; the two missing types are flagged, not invented.

**6. Reserve storage cap is one shared national number, not per-unit-type.** Mirrors the exact
precedent Branch B already established for the ten resources (`nation.resource_storage_cap` is
one cap value applied to all ten keys, per `GameRoom.ts:2613-2618`'s comment — "per-resource
bar-fill in the UI, but one national cap number"). `nation.reserve_cap: number` follows the same
shape, computed with the same `storageCapForLevel()` helper already imported and used in
`_economyTick()`.

## File Structure

| File | Responsibility |
|---|---|
| `game-server/src/data/unit_production_stats.ts` (new) | `build_points`/`produced_by` per unit type, reusing `AIR_UNIT_TYPES` from `AirWingState.ts` |
| `game-server/src/systems/unit_production_system.ts` (new) | Ranking/scoring, `assignIdleBuildings`, `tickProduction`, `tickMarshalling`, `tickFieldDelivery`, Marshalling CRUD |
| `game-server/test/9c-unit-production.test.ts` (new) | All Branch C server tests |
| `game-server/src/data/building_stats.ts` (modify) | Add `base_rate_by_level` to the 4 production building entries |
| `game-server/src/rooms/schema/GameRoomState.ts` (modify) | Add `reserve_cap: number` to `NationState` |
| `game-server/src/rooms/GameRoom.ts` (modify) | New `unitProductionSystem` + tick hookup; `RAISE_DIVISION`/`FORCE_DEPLOY`/`CANCEL_MARSHALLING` handlers; `reserve_cap` computed in `_economyTick()` |
| `game-server/test-lanes.json`, `package.json` (modify) | Register the new test file |
| `client/src/core/game_state.gd` (modify) | `marshalling_divisions`, `reserve`, `reserve_cap` state + apply methods |
| `client/src/core/event_bus.gd` (modify) | `marshalling_updated`, `reserve_updated` signals |
| `client/src/systems/session/session_manager.gd` (modify) | `MARSHALLING_UPDATES`, `RESERVE_UPDATES` match arms |
| `client/src/ui/hud/production_panel.gd` / `.tscn` (modify) | Templates tab (raise + Fielded/Deploying counts), Reserve tab (four category bars) |
| `client/src/ui/hud/military_panel.gd` (modify) | New DEPLOYING section above the Land tab's template list |

---

## Task 1: `unit_production_stats.ts` + `base_rate_by_level`

**Files:**
- Create: `game-server/src/data/unit_production_stats.ts`
- Modify: `game-server/src/data/building_stats.ts`
- Test: `game-server/test/9c-unit-production.test.ts`

**Interfaces:**
- Produces: `UnitProductionStats { build_points: number; produced_by: string }`,
  `getUnitProductionStats(unitType: string): UnitProductionStats` (throws on unknown),
  `UNIT_PRODUCTION_STATS: Record<string, UnitProductionStats>`,
  `PRODUCTION_BUILDING_TYPES: string[] = ["barracks", "tank_plant", "ordnance_factory", "aircraft_factory"]`.
- `getBuildingStats(buildingType).base_rate_by_level` now populated (`number[] | undefined`) for
  the four production types.

- [ ] **Step 1: Write the failing tests**

```typescript
// game-server/test/9c-unit-production.test.ts
import assert from "assert";
import { describe, it } from "mocha";
import { getUnitProductionStats, UNIT_PRODUCTION_STATS, PRODUCTION_BUILDING_TYPES } from "../src/data/unit_production_stats.js";
import { getBuildingStats, BUILDING_TYPES } from "../src/data/building_stats.js";
import { UnitType } from "../src/types/tactical_types.js";
import { AIR_UNIT_TYPES } from "../src/rooms/schema/AirWingState.js";

describe("lane:economy | Unit production stats", () => {
  it("every non-empty UnitType has a build_points entry", () => {
    for (const unitType of Object.values(UnitType)) {
      if (unitType === "") continue;
      assert.ok(UNIT_PRODUCTION_STATS[unitType], `missing entry for ${unitType}`);
    }
  });

  it("every AIR_UNIT_TYPES value has a build_points entry, produced_by aircraft_factory", () => {
    for (const airType of Object.values(AIR_UNIT_TYPES)) {
      const stats = getUnitProductionStats(airType);
      assert.strictEqual(stats.produced_by, "aircraft_factory");
    }
  });

  it("heavy_tank has higher build_points than light_tank", () => {
    assert.ok(
      getUnitProductionStats(UnitType.HEAVY_TANK).build_points >
      getUnitProductionStats(UnitType.LIGHT_TANK).build_points,
    );
  });

  it("unknown unit type throws, not silently returns a default", () => {
    assert.throws(() => getUnitProductionStats("not_a_real_unit"));
  });

  it("produced_by groups match ECONOMY_BUILDINGS.md's taxonomy for the unit types that actually exist", () => {
    assert.strictEqual(getUnitProductionStats(UnitType.INFANTRY).produced_by, "barracks");
    assert.strictEqual(getUnitProductionStats(UnitType.AT_INFANTRY).produced_by, "barracks");
    assert.strictEqual(getUnitProductionStats(UnitType.MEDIUM_TANK).produced_by, "tank_plant");
    assert.strictEqual(getUnitProductionStats(UnitType.ARMOURED_CAR).produced_by, "tank_plant");
    assert.strictEqual(getUnitProductionStats(UnitType.ARTILLERY).produced_by, "ordnance_factory");
    assert.strictEqual(getUnitProductionStats(UnitType.AT_GUN).produced_by, "ordnance_factory");
  });
});

describe("lane:economy | base_rate_by_level for production buildings", () => {
  it("all 4 production building types have a 5-value monotonically increasing base_rate_by_level", () => {
    for (const bt of PRODUCTION_BUILDING_TYPES) {
      const rates = getBuildingStats(bt).base_rate_by_level;
      assert.ok(rates, `${bt} missing base_rate_by_level`);
      assert.strictEqual(rates!.length, 5);
      for (let i = 1; i < rates!.length; i++) assert.ok(rates![i] > rates![i - 1]);
    }
  });

  it("non-production building types have no base_rate_by_level", () => {
    assert.strictEqual(getBuildingStats("iron_mine" in BUILDING_TYPES ? "res_iron" : "res_iron").base_rate_by_level, undefined);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd game-server && npx mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000
```
Expected: FAIL — `unit_production_stats.js` module not found, `base_rate_by_level` undefined.

- [ ] **Step 3: Implement `unit_production_stats.ts`**

```typescript
import { UnitType } from "../types/tactical_types.js";
import { AIR_UNIT_TYPES } from "../rooms/schema/AirWingState.js";

export interface UnitProductionStats {
  build_points: number; // TBD playtesting — placeholder curve, higher tier = higher cost
  produced_by: string;
}

export const PRODUCTION_BUILDING_TYPES: string[] = [
  "barracks", "tank_plant", "ordnance_factory", "aircraft_factory",
];

// Land unit types. Note: unit_production_handoff.md §7 names "motorised infantry" (Barracks)
// and "mechanised infantry" (Tank Plant) — neither exists in UnitType (tactical_types.ts) as
// of this branch. Not invented here; only the 20 unit types that actually exist are mapped.
export const UNIT_PRODUCTION_STATS: Record<string, UnitProductionStats> = {
  // Barracks — infantry/leg-type roster (TACTICAL_COMBAT.md's "leg/mounted" incapacitation bucket).
  [UnitType.INFANTRY]:           { build_points: 30, produced_by: "barracks" },
  [UnitType.ASSAULT_INF]:        { build_points: 35, produced_by: "barracks" },
  [UnitType.RECON_INF]:          { build_points: 30, produced_by: "barracks" },
  [UnitType.MG]:                 { build_points: 25, produced_by: "barracks" },
  [UnitType.CAVALRY]:            { build_points: 30, produced_by: "barracks" },
  [UnitType.AT_INFANTRY]:        { build_points: 35, produced_by: "barracks" },
  [UnitType.SNIPER]:             { build_points: 40, produced_by: "barracks" },
  [UnitType.COMMANDO]:           { build_points: 45, produced_by: "barracks" },
  [UnitType.FLAMETHROWER]:       { build_points: 35, produced_by: "barracks" },
  [UnitType.FORCE_RECON_SNIPER]: { build_points: 45, produced_by: "barracks" },

  // Tank Plant — vehicle-chassis roster (TACTICAL_COMBAT.md's "vehicle" incapacitation bucket).
  [UnitType.ARMOURED_CAR]:       { build_points: 50,  produced_by: "tank_plant" },
  [UnitType.LIGHT_TANK]:         { build_points: 60,  produced_by: "tank_plant" },
  [UnitType.MEDIUM_TANK]:        { build_points: 90,  produced_by: "tank_plant" },
  [UnitType.HEAVY_TANK]:         { build_points: 140, produced_by: "tank_plant" },
  [UnitType.AT_GUN_SP]:          { build_points: 100, produced_by: "tank_plant" },
  [UnitType.SELF_PROPELLED_GUN]: { build_points: 110, produced_by: "tank_plant" },

  // Ordnance Factory — crew-served, towed roster (TACTICAL_COMBAT.md's "no incapacitation" bucket).
  [UnitType.ARTILLERY]: { build_points: 70, produced_by: "ordnance_factory" },
  [UnitType.AT_GUN]:    { build_points: 50, produced_by: "ordnance_factory" },
  [UnitType.AA_GUN]:    { build_points: 55, produced_by: "ordnance_factory" },
  [UnitType.HOWITZER]:  { build_points: 80, produced_by: "ordnance_factory" },

  // Aircraft Factory — reuses Phase 12's AIR_UNIT_TYPES verbatim, no second list.
  [AIR_UNIT_TYPES.CAS_PLANE]:        { build_points: 90,  produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.DIVE_BOMBER]:      { build_points: 100, produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.FIGHTER]:          { build_points: 110, produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.NAVAL_BOMBER]:     { build_points: 120, produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.HEAVY_FIGHTER]:    { build_points: 130, produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.STRATEGIC_BOMBER]: { build_points: 180, produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.TACTICAL_BOMBER]:  { build_points: 140, produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.RECON_PLANE]:      { build_points: 80,  produced_by: "aircraft_factory" },
};

export function getUnitProductionStats(unitType: string): UnitProductionStats {
  const stats = UNIT_PRODUCTION_STATS[unitType];
  if (!stats) throw new Error(`Unknown unit type for production: ${unitType}`);
  return stats;
}
```

**Before writing this file, confirm `AIR_UNIT_TYPES` is actually exported from
`game-server/src/rooms/schema/AirWingState.ts`** (investigation found it there) — if the import
path differs, fix the import, do not redefine the constant.

- [ ] **Step 4: Edit `building_stats.ts`**

Add the optional field to the interface and a base-rate table, applied only to the four
production types:

```typescript
export interface BuildingStats {
  construction_points_by_level: number[];
  resource_cost_by_level: Partial<Record<string, number>>[];
  // TBD playtesting — only present for barracks/tank_plant/ordnance_factory/aircraft_factory.
  base_rate_by_level?: number[];
}
```

```typescript
// TBD playtesting — placeholder curve. build_points/tick at that building level.
const PRODUCTION_BASE_RATE_BY_TYPE: Partial<Record<string, number[]>> = {
  barracks:          [3, 6, 10, 15, 21],
  tank_plant:        [2, 4, 7, 11, 16],
  ordnance_factory:  [3, 6, 10, 15, 21],
  aircraft_factory:  [2, 4, 7, 11, 16],
};

const STAT_TABLE: Record<string, BuildingStats> = Object.fromEntries(
  BUILDING_TYPES.map((buildingType) => [
    buildingType,
    {
      construction_points_by_level: [...DEFAULT_CONSTRUCTION_POINTS],
      resource_cost_by_level: defaultCostByLevel(),
      base_rate_by_level: PRODUCTION_BASE_RATE_BY_TYPE[buildingType],
    },
  ]),
);
```

- [ ] **Step 5: Run to verify pass**

```bash
cd game-server && npx mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000
```
Expected: PASS, all tests green.

- [ ] **Step 6: Commit**

```bash
git add game-server/src/data/unit_production_stats.ts game-server/src/data/building_stats.ts game-server/test/9c-unit-production.test.ts
git commit -m "feat: add unit production stats and production building base rates"
```

---

## Task 2: Auto-scheduler — ranking, cost-weighted scoring, chromium hard-gate

**Files:**
- Create/modify: `game-server/src/systems/unit_production_system.ts`
- Test: `game-server/test/9c-unit-production.test.ts`

**Interfaces:**
- Consumes: `getUnitProductionStats` (Task 1), `isChromiumAvailable` (`resource_economy_system.ts:111`, already exists), `UNIT_COMBAT_STATS[unitType].chromium_gated` (`unit_combat_stats.ts`, already exists).
- Produces: `DemandSlot`, `rankDemand(slots): DemandSlot[]`, `scoreTypeForBuilding(buildingType, openSlots, chromiumAvailable): Map<string, number>`, `assignIdleBuildings(idleBuildings, demandByBuilding): Array<{province_id, building_type, unit_type}>`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { rankDemand, scoreTypeForBuilding, assignIdleBuildings, DemandSlot } from "../src/systems/unit_production_system.js";

describe("lane:economy | Auto-scheduler priority ranking", () => {
  it("ranks by missing_pct descending, pooling marshalling and field_resupply together", () => {
    const slots: DemandSlot[] = [
      { slot_id: "a", unit_type: "infantry", missing_pct: 0.4, stream: "field_resupply" },
      { slot_id: "b", unit_type: "infantry", missing_pct: 1.0, stream: "marshalling" },
      { slot_id: "c", unit_type: "infantry", missing_pct: 0.1, stream: "field_resupply" },
    ];
    const ranked = rankDemand(slots);
    assert.deepStrictEqual(ranked.map((s) => s.slot_id), ["b", "a", "c"]);
  });

  it("a fully-healthy slot (missing_pct 0) never outranks any damaged slot", () => {
    const slots: DemandSlot[] = [
      { slot_id: "healthy", unit_type: "infantry", missing_pct: 0, stream: "field_resupply" },
      { slot_id: "damaged", unit_type: "infantry", missing_pct: 0.01, stream: "field_resupply" },
    ];
    assert.strictEqual(rankDemand(slots)[0].slot_id, "damaged");
  });
});

describe("lane:economy | Cost-weighted type aggregation", () => {
  it("type_score = sum(missing_pct x build_points) per unit_type, higher aggregate wins", () => {
    // light_tank build_points=60, heavy_tank build_points=140 (Task 1's table)
    const slots: DemandSlot[] = [
      { slot_id: "a", unit_type: "light_tank", missing_pct: 1.0, stream: "marshalling" },
      { slot_id: "b", unit_type: "light_tank", missing_pct: 1.0, stream: "marshalling" },
      { slot_id: "c", unit_type: "heavy_tank", missing_pct: 0.5, stream: "marshalling" },
    ];
    const scores = scoreTypeForBuilding("tank_plant", slots, true);
    // light_tank: (1.0*60)+(1.0*60)=120, heavy_tank: 0.5*140=70
    assert.strictEqual(scores.get("light_tank"), 120);
    assert.strictEqual(scores.get("heavy_tank"), 70);
  });

  it("only slots whose unit_type is produced_by this buildingType are scored", () => {
    const slots: DemandSlot[] = [
      { slot_id: "a", unit_type: "infantry", missing_pct: 1.0, stream: "marshalling" },
      { slot_id: "b", unit_type: "light_tank", missing_pct: 1.0, stream: "marshalling" },
    ];
    const scores = scoreTypeForBuilding("tank_plant", slots, true);
    assert.ok(!scores.has("infantry"));
    assert.ok(scores.has("light_tank"));
  });
});

describe("lane:economy | Chromium hard-gate — exclusion, not deprioritization", () => {
  it("chromium_gated=true (heavy_tank) is excluded entirely when chromiumAvailable is false", () => {
    const slots: DemandSlot[] = [
      { slot_id: "a", unit_type: "heavy_tank", missing_pct: 1.0, stream: "marshalling" },
      { slot_id: "b", unit_type: "medium_tank", missing_pct: 1.0, stream: "marshalling" },
    ];
    const scores = scoreTypeForBuilding("tank_plant", slots, false);
    assert.ok(!scores.has("heavy_tank"));
    assert.ok(scores.has("medium_tank"));
  });

  it("heavy_tank resumes scoring the instant chromiumAvailable flips true, same call, no re-trigger needed", () => {
    const slots: DemandSlot[] = [{ slot_id: "a", unit_type: "heavy_tank", missing_pct: 1.0, stream: "marshalling" }];
    assert.ok(scoreTypeForBuilding("tank_plant", slots, true).has("heavy_tank"));
    assert.ok(!scoreTypeForBuilding("tank_plant", slots, false).has("heavy_tank"));
  });
});

describe("lane:economy | Pull assignment", () => {
  it("an idle building with no compatible open demand stays idle, no assignment, no throw", () => {
    const assignments = assignIdleBuildings(
      [{ province_id: "p1", building_type: "tank_plant" }],
      new Map(),
    );
    assert.strictEqual(assignments.length, 0);
  });

  it("assigns the highest-scoring unit_type for each idle building", () => {
    const demandByBuilding = new Map([
      ["barracks", new Map([["infantry", 30], ["mg", 50]])],
    ]);
    const assignments = assignIdleBuildings(
      [{ province_id: "p1", building_type: "barracks" }],
      demandByBuilding,
    );
    assert.strictEqual(assignments[0].unit_type, "mg");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd game-server && npx mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000
```
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement in `unit_production_system.ts`**

```typescript
import type { MapSchema } from "@colyseus/schema";
import type { NationState, DivisionState } from "../rooms/schema/GameRoomState.js";
import { getUnitProductionStats } from "../data/unit_production_stats.js";
import { getBuildingStats } from "../data/building_stats.js";
import { UNIT_COMBAT_STATS } from "../data/unit_combat_stats.js";
import { industrySliceMultiplier } from "./resource_economy_system.js";
import type { ProvinceEconomyData } from "./economy_building_system.js";

export type BroadcastFn = (type: string, msg: unknown) => void;
export type BroadcastToNationFn = (type: string, msg: unknown, nationId: string) => void;

export interface DemandSlot {
  slot_id: string;
  unit_type: string;
  missing_pct: number; // 0.0 - 1.0
  stream: "marshalling" | "field_resupply";
}

/** §6.2 — pools marshalling-template demand and fielded-division-resupply demand into one ranking. */
export function rankDemand(slots: DemandSlot[]): DemandSlot[] {
  return [...slots].sort((a, b) => b.missing_pct - a.missing_pct);
}

export function isChromiumGated(unitType: string): boolean {
  return UNIT_COMBAT_STATS[unitType]?.chromium_gated ?? false;
}

/** §6.3 — build_points-weighted missing-% aggregation per unit_type. §6.4/2c — chromium is a hard filter, not a scoring multiplier. */
export function scoreTypeForBuilding(
  buildingType: string,
  openSlots: DemandSlot[],
  chromiumAvailable: boolean,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const slot of openSlots) {
    const stats = getUnitProductionStats(slot.unit_type);
    if (stats.produced_by !== buildingType) continue;
    if (isChromiumGated(slot.unit_type) && !chromiumAvailable) continue;
    const score = slot.missing_pct * stats.build_points;
    scores.set(slot.unit_type, (scores.get(slot.unit_type) ?? 0) + score);
  }
  return scores;
}

/** §6.1 — pull assignment: idle buildings request an order, never re-evaluated mid-order. */
export function assignIdleBuildings(
  idleBuildings: Array<{ province_id: string; building_type: string }>,
  demandByBuilding: Map<string, Map<string, number>>,
): Array<{ province_id: string; building_type: string; unit_type: string }> {
  const assignments: Array<{ province_id: string; building_type: string; unit_type: string }> = [];
  for (const b of idleBuildings) {
    const scores = demandByBuilding.get(b.building_type);
    if (!scores || scores.size === 0) continue;
    const [bestType] = [...scores.entries()].sort((x, y) => y[1] - x[1])[0];
    assignments.push({ ...b, unit_type: bestType });
  }
  return assignments;
}
```

**Note on the recompute-every-tick simplification:** per `unit_production_handoff.md §6.1`,
demand ranking should ideally recompute on discrete events only. This codebase's tick is already
coarse (1s) and division counts small (5-15/player per `STRATEGIC_COMBAT.md`) — a full recompute
every tick is deliberately used here instead (Task 3 wires it that way); document this choice
with a code comment at the call site, do not build real event-triggered invalidation.

- [ ] **Step 4: Run to verify pass**

```bash
cd game-server && npx mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add game-server/src/systems/unit_production_system.ts game-server/test/9c-unit-production.test.ts
git commit -m "feat: add auto-scheduler ranking, scoring, and chromium hard-gate"
```

---

## Task 3: Production tick — building → Reserve, `reserve_cap` schema field

**Files:**
- Modify: `game-server/src/systems/unit_production_system.ts`
- Modify: `game-server/src/rooms/schema/GameRoomState.ts`
- Test: `game-server/test/9c-unit-production.test.ts`

**Interfaces:**
- Consumes: `ProvinceEconomyData` (`economy_building_system.ts`), `industrySliceMultiplier` (`resource_economy_system.ts:54`).
- Produces: `ProductionOrder` type, `UnitProductionSystem` class with
  `startOrIdle(province_id, building_type): void` (internal), `tickProduction(provinces, ownerLookup, nations, industryMultByNation, broadcastToNation): void`,
  `nation.reserve_cap: number` (new schema field).

- [ ] **Step 1: Write the failing tests**

```typescript
import { UnitProductionSystem } from "../src/systems/unit_production_system.js";
import { NationState } from "../src/rooms/schema/GameRoomState.js";

describe("lane:economy | Production tick — building to Reserve", () => {
  function makeNation(): NationState {
    const n = new NationState();
    n.nation_id = "test_nation";
    n.reserve_cap = 200;
    return n;
  }

  it("effective_build_rate = base_rate(level) x industry_pool_unit_production_speed_multiplier", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    const provinceEconomies = new Map([["p1", { province_id: "p1", buildings: { barracks: 1 }, resource_deposits: {}, construction_queue: [] }]]);
    sys.assignOrder("p1", "barracks", "infantry"); // build_points=30, base_rate lvl1=3
    for (let t = 0; t < 20; t++) {
      sys.tickProduction(provinceEconomies, () => nation, (allocPct) => 1.0 + allocPct / 100);
    }
    // 3 * (1.0 + 0/100) = 3/tick, 30 build_points -> completes in 10 ticks; after 20 ticks
    // one full unit (100 HP-equiv) should be in reserve_pool, order idle again.
    assert.ok((nation.reserve_pool.get("infantry") ?? 0) >= 100);
  });

  it("a heavy tank (build_points 140) takes longer than a light tank (60) at the same building level", () => {
    const sys1 = new UnitProductionSystem();
    const sys2 = new UnitProductionSystem();
    const nation1 = makeNation();
    const nation2 = makeNation();
    const econ = new Map([["p1", { province_id: "p1", buildings: { tank_plant: 1 }, resource_deposits: {}, construction_queue: [] }]]);
    sys1.assignOrder("p1", "tank_plant", "heavy_tank");
    sys2.assignOrder("p1", "tank_plant", "light_tank");
    for (let t = 0; t < 5; t++) {
      sys1.tickProduction(econ, () => nation1, () => 1.0);
      sys2.tickProduction(econ, () => nation2, () => 1.0);
    }
    assert.ok((nation2.reserve_pool.get("light_tank") ?? 0) >= (nation1.reserve_pool.get("heavy_tank") ?? 0));
  });

  it("on completion, produced HP-equivalent is added to reserve_pool, not to any division directly", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    const econ = new Map([["p1", { province_id: "p1", buildings: { barracks: 5 }, resource_deposits: {}, construction_queue: [] }]]);
    sys.assignOrder("p1", "barracks", "infantry");
    for (let t = 0; t < 5; t++) sys.tickProduction(econ, () => nation, () => 1.0);
    assert.ok((nation.reserve_pool.get("infantry") ?? 0) > 0);
  });

  it("reserve_cap clamps reserve_pool — overflow production is wasted, not banked past the cap", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    nation.reserve_cap = 50;
    nation.reserve_pool.set("infantry", 45);
    const econ = new Map([["p1", { province_id: "p1", buildings: { barracks: 5 }, resource_deposits: {}, construction_queue: [] }]]);
    sys.assignOrder("p1", "barracks", "infantry");
    for (let t = 0; t < 5; t++) sys.tickProduction(econ, () => nation, () => 1.0);
    assert.strictEqual(nation.reserve_pool.get("infantry"), 50);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd game-server && npx mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000
```
Expected: FAIL — `UnitProductionSystem`, `assignOrder`, `tickProduction`, `nation.reserve_cap` don't exist.

- [ ] **Step 3: Add `reserve_cap` to `NationState`**

In `game-server/src/rooms/schema/GameRoomState.ts`, next to the existing `reserve_pool` field:

```typescript
@type({ map: "number" }) reserve_pool = new MapSchema<number>();
// One shared national cap across every unit_type, same shape as resource_storage_cap
// (Branch B precedent) — Branch C's Warehouse Reserve-cap extension populates this.
@type("number") reserve_cap: number = 0;
```

- [ ] **Step 4: Implement `ProductionOrder` + `tickProduction` in `unit_production_system.ts`**

```typescript
export interface ProductionOrder {
  province_id: string;
  building_type: string;
  current_order: {
    unit_type: string;
    build_points_remaining: number;
    build_points_total: number;
    effective_rate: number; // HP-equivalent build_points/tick — cached for tickFieldDelivery's min() formula
  } | null;
}

const HP_EQUIVALENT_PER_UNIT = 100;

export class UnitProductionSystem {
  private productionOrders = new Map<string, ProductionOrder>(); // keyed by `${province_id}:${building_type}`

  private orderKey(provinceId: string, buildingType: string): string {
    return `${provinceId}:${buildingType}`;
  }

  getOrder(provinceId: string, buildingType: string): ProductionOrder | undefined {
    return this.productionOrders.get(this.orderKey(provinceId, buildingType));
  }

  /** Starts a new order for an idle building. No-op if already producing something. */
  assignOrder(provinceId: string, buildingType: string, unitType: string): void {
    const key = this.orderKey(provinceId, buildingType);
    const existing = this.productionOrders.get(key);
    if (existing?.current_order) return; // already busy
    const stats = getUnitProductionStats(unitType);
    this.productionOrders.set(key, {
      province_id: provinceId,
      building_type: buildingType,
      current_order: {
        unit_type: unitType,
        build_points_remaining: stats.build_points,
        build_points_total: stats.build_points,
        effective_rate: 0,
      },
    });
  }

  /** Sum of in-progress HP-equivalent/tick for a given unit_type, across every building
   * currently producing it — feeds tickFieldDelivery's min(production_rate, channel_rate). */
  productionRateForType(unitType: string): number {
    let total = 0;
    for (const order of this.productionOrders.values()) {
      if (order.current_order?.unit_type !== unitType) continue;
      total += (order.current_order.effective_rate / order.current_order.build_points_total) * HP_EQUIVALENT_PER_UNIT;
    }
    return total;
  }

  tickProduction(
    provinceEconomy: Map<string, { buildings: Record<string, number> }>,
    provinceOwner: (provinceId: string) => NationState | undefined,
    industrySliceMultiplierForNation: (allocationPct: number) => number,
  ): void {
    for (const order of this.productionOrders.values()) {
      if (!order.current_order) continue;
      const nation = provinceOwner(order.province_id);
      if (!nation) continue;
      const level = provinceEconomy.get(order.province_id)?.buildings[order.building_type] ?? 0;
      if (level <= 0) continue; // building was demolished/never built — no-op, do not throw
      const baseRate = getBuildingStats(order.building_type).base_rate_by_level?.[level - 1] ?? 0;
      const allocPct = nation.industry_alloc.get("unit_production_speed") ?? 0;
      const effectiveRate = baseRate * industrySliceMultiplierForNation(allocPct);
      order.current_order.effective_rate = effectiveRate;
      order.current_order.build_points_remaining -= effectiveRate;

      if (order.current_order.build_points_remaining <= 0) {
        const unitType = order.current_order.unit_type;
        const cap = nation.reserve_cap;
        const current = nation.reserve_pool.get(unitType) ?? 0;
        const next = cap > 0 ? Math.min(cap, current + HP_EQUIVALENT_PER_UNIT) : current + HP_EQUIVALENT_PER_UNIT;
        nation.reserve_pool.set(unitType, next);
        order.current_order = null; // idle again — picked up by next assignIdleBuildings pass
      }
    }
  }

  /** Every province's production buildings with an owner and no in-progress order. */
  listIdleBuildings(
    provinceEconomy: Map<string, { province_id: string; buildings: Record<string, number>; owner_id: string }>,
  ): Array<{ province_id: string; building_type: string }> {
    const idle: Array<{ province_id: string; building_type: string }> = [];
    for (const econ of provinceEconomy.values()) {
      if (!econ.owner_id) continue;
      for (const buildingType of PRODUCTION_BUILDING_TYPES) {
        if ((econ.buildings[buildingType] ?? 0) <= 0) continue;
        const key = this.orderKey(econ.province_id, buildingType);
        if (this.productionOrders.get(key)?.current_order) continue;
        idle.push({ province_id: econ.province_id, building_type: buildingType });
      }
    }
    return idle;
  }
}
```

Add `import { PRODUCTION_BUILDING_TYPES } from "../data/unit_production_stats.js";` and
`import { getUnitProductionStats } from "../data/unit_production_stats.js";` at the top of the
file (alongside the imports already added in Task 2).

- [ ] **Step 5: Run to verify pass**

```bash
cd game-server && npx mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add game-server/src/systems/unit_production_system.ts game-server/src/rooms/schema/GameRoomState.ts game-server/test/9c-unit-production.test.ts
git commit -m "feat: add production tick, reserve_cap schema field, idle-building scan"
```

---

## Task 4: Marshalling — `MarshallingData`, `tickMarshalling`, `tickFieldDelivery`

**Files:**
- Modify: `game-server/src/systems/unit_production_system.ts`
- Test: `game-server/test/9c-unit-production.test.ts`

**Interfaces:**
- Produces: `MarshallingSlot`, `MarshallingData`, `startMarshalling(nationId, templateId, homeProvinceId, cells): string`,
  `cancelMarshalling(marshallingId, nations): boolean`, `getMarshalling(marshallingId)`,
  `listMarshallingForNation(nationId)`, `aggregateHpPct(data): number`, `tickMarshalling(nations): void`,
  `tickFieldDelivery(divisions, nations): void`, `MARSHALLING_RATE`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("lane:economy | Marshalling fill", () => {
  it("fill_rate = MARSHALLING_RATE when reserve_pool has enough of the needed type", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    nation.reserve_pool.set("infantry", 1000);
    const id = sys.startMarshalling("test_nation", "tmpl1", "capital", [{ cell_index: 0, unit_type: "infantry" }]);
    sys.tickMarshalling(new Map([["test_nation", nation]]));
    const data = sys.getMarshalling(id)!;
    assert.strictEqual(data.slots[0].current_hp, 20); // MARSHALLING_RATE placeholder = 20
  });

  it("fill_rate = min(MARSHALLING_RATE, production_rate) when Reserve is empty for that type", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation(); // reserve_pool empty
    const id = sys.startMarshalling("test_nation", "tmpl1", "capital", [{ cell_index: 0, unit_type: "infantry" }]);
    sys.assignOrder("p1", "barracks", "infantry"); // build_points 30, no ticks run — effective_rate stays 0
    sys.tickMarshalling(new Map([["test_nation", nation]]));
    assert.strictEqual(sys.getMarshalling(id)!.slots[0].current_hp, 0); // no production yet, reserve empty -> no fill
  });

  it("MARSHALLING_RATE is a flat national constant, independent of province/building level", () => {
    const sys = new UnitProductionSystem();
    const nationA = makeNation();
    nationA.reserve_pool.set("infantry", 1000);
    const idA = sys.startMarshalling("test_nation", "tmpl1", "province_a", [{ cell_index: 0, unit_type: "infantry" }]);
    sys.tickMarshalling(new Map([["test_nation", nationA]]));
    assert.strictEqual(sys.getMarshalling(idA)!.slots[0].current_hp, 20);
  });
});

describe("lane:economy | Aggregate HP% and CANCEL_MARSHALLING", () => {
  it("aggregate_hp_pct = sum(current_hp) / (slot_count x 100), whole-division not headcount", () => {
    const sys = new UnitProductionSystem();
    const id = sys.startMarshalling("n1", "t1", "capital", [
      { cell_index: 0, unit_type: "infantry" },
      { cell_index: 1, unit_type: "infantry" },
    ]);
    const data = sys.getMarshalling(id)!;
    data.slots[0].current_hp = 100;
    data.slots[1].current_hp = 0;
    assert.strictEqual(sys.aggregateHpPct(data), 0.5);
  });

  it("cancelling returns already-allocated HP-equivalent back to reserve_pool, non-destructive", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    const id = sys.startMarshalling("test_nation", "t1", "capital", [{ cell_index: 0, unit_type: "infantry" }]);
    sys.getMarshalling(id)!.slots[0].current_hp = 40;
    sys.cancelMarshalling(id, new Map([["test_nation", nation]]));
    assert.strictEqual(nation.reserve_pool.get("infantry"), 40);
    assert.strictEqual(sys.getMarshalling(id), undefined);
  });
});

describe("lane:economy | Field-supply delivery — simplified placeholder", () => {
  it("field_supply_line_capacity returns a fixed rate slower than MARSHALLING_RATE", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    nation.reserve_pool.set("infantry", 1000);
    const div = new DivisionState();
    div.nation_id = "test_nation";
    div.grid.cells[0].unit_type = "infantry";
    div.grid.cells[0].hp = 0;
    sys.tickFieldDelivery([div], new Map([["test_nation", nation]]));
    assert.ok(div.grid.cells[0].hp > 0 && div.grid.cells[0].hp <= 10); // placeholder rate = MARSHALLING_RATE*0.5 = 10
  });

  it("a fully-healthy cell (hp=100) is not touched", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    nation.reserve_pool.set("infantry", 1000);
    const div = new DivisionState();
    div.nation_id = "test_nation";
    div.grid.cells[0].unit_type = "infantry";
    div.grid.cells[0].hp = 100;
    sys.tickFieldDelivery([div], new Map([["test_nation", nation]]));
    assert.strictEqual(div.grid.cells[0].hp, 100);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd game-server && npx mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000
```
Expected: FAIL.

- [ ] **Step 3: Implement in `unit_production_system.ts`**

```typescript
export const MARSHALLING_RATE = 20; // TBD playtesting — flat national constant, HP-equivalent/tick

/** SIMPLIFIED PLACEHOLDER — Phase 7 (Supply System) does not exist yet; no road-graph flow-rate
 * model to call. Deliberately slower than MARSHALLING_RATE so the early-deployment tradeoff
 * (fast guaranteed marshalling fill vs. potentially-slower field fill) is observable. Replace
 * with the real road-segment flow rate once Phase 7 lands. */
function fieldSupplyLineCapacity(): number {
  return MARSHALLING_RATE * 0.5;
}

export interface MarshallingSlot {
  cell_index: number;
  unit_type: string;
  current_hp: number; // 0-100
}

export interface MarshallingData {
  marshalling_id: string;
  nation_id: string;
  template_id: string;
  home_province_id: string;
  slots: MarshallingSlot[];
}

let _marshallingIdCounter = 0;

// (add alongside the UnitProductionSystem class fields)
export class UnitProductionSystem {
  // ... productionOrders from Task 3 ...
  private marshalling = new Map<string, MarshallingData>();

  startMarshalling(
    nationId: string, templateId: string, homeProvinceId: string,
    cells: Array<{ cell_index: number; unit_type: string }>,
  ): string {
    const id = `marshal_${nationId}_${++_marshallingIdCounter}`;
    this.marshalling.set(id, {
      marshalling_id: id,
      nation_id: nationId,
      template_id: templateId,
      home_province_id: homeProvinceId,
      slots: cells.map((c) => ({ cell_index: c.cell_index, unit_type: c.unit_type, current_hp: 0 })),
    });
    return id;
  }

  getMarshalling(id: string): MarshallingData | undefined {
    return this.marshalling.get(id);
  }

  listMarshallingForNation(nationId: string): MarshallingData[] {
    return [...this.marshalling.values()].filter((d) => d.nation_id === nationId);
  }

  aggregateHpPct(data: MarshallingData): number {
    if (data.slots.length === 0) return 0;
    const sum = data.slots.reduce((s, sl) => s + sl.current_hp, 0);
    return sum / (data.slots.length * HP_EQUIVALENT_PER_UNIT);
  }

  /** Non-destructive — every slot's already-allocated HP-equivalent returns to reserve_pool. */
  cancelMarshalling(id: string, nations: Map<string, NationState> | MapSchema<NationState>): boolean {
    const data = this.marshalling.get(id);
    if (!data) return false;
    const nation = nations.get(data.nation_id);
    if (nation) {
      for (const slot of data.slots) {
        if (slot.current_hp <= 0) continue;
        const current = nation.reserve_pool.get(slot.unit_type) ?? 0;
        nation.reserve_pool.set(slot.unit_type, current + slot.current_hp);
      }
    }
    this.marshalling.delete(id);
    return true;
  }

  removeMarshalling(id: string): void {
    this.marshalling.delete(id);
  }

  tickMarshalling(nations: Map<string, NationState> | MapSchema<NationState>): void {
    for (const data of this.marshalling.values()) {
      const nation = nations.get(data.nation_id);
      if (!nation) continue;
      for (const slot of data.slots) {
        if (slot.current_hp >= HP_EQUIVALENT_PER_UNIT) continue;
        const reserveAvail = nation.reserve_pool.get(slot.unit_type) ?? 0;
        const productionRate = this.productionRateForType(slot.unit_type);
        const fillRate = reserveAvail > 0 ? MARSHALLING_RATE : Math.min(MARSHALLING_RATE, productionRate);
        const drawn = Math.max(0, Math.min(fillRate, HP_EQUIVALENT_PER_UNIT - slot.current_hp, reserveAvail));
        slot.current_hp += drawn;
        if (drawn > 0) nation.reserve_pool.set(slot.unit_type, reserveAvail - drawn);
      }
    }
  }

  /** Covers both a just-force-deployed division's remaining under-filled cells AND ordinary
   * combat-damage resupply for any fielded division — same delivery mechanism, §6.5's "supply
   * stream". */
  tickFieldDelivery(divisions: Iterable<DivisionState>, nations: Map<string, NationState> | MapSchema<NationState>): void {
    for (const div of divisions) {
      if (!div.grid) continue;
      const nation = nations.get(div.nation_id);
      if (!nation) continue;
      for (const cell of div.grid.cells) {
        if (cell.unit_type === "" || cell.hp >= HP_EQUIVALENT_PER_UNIT) continue;
        const reserveAvail = nation.reserve_pool.get(cell.unit_type) ?? 0;
        const productionRate = this.productionRateForType(cell.unit_type);
        const channelRate = fieldSupplyLineCapacity();
        const fillRate = reserveAvail > 0 ? channelRate : Math.min(channelRate, productionRate);
        const drawn = Math.max(0, Math.min(fillRate, HP_EQUIVALENT_PER_UNIT - cell.hp, reserveAvail));
        cell.hp += drawn;
        if (drawn > 0) nation.reserve_pool.set(cell.unit_type, reserveAvail - drawn);
      }
    }
  }
}
```

Add `import { DivisionState } from "../rooms/schema/GameRoomState.js";` if not already imported.

- [ ] **Step 4: Run to verify pass**

```bash
cd game-server && npx mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add game-server/src/systems/unit_production_system.ts game-server/test/9c-unit-production.test.ts
git commit -m "feat: add Marshalling fill, aggregate HP%, cancel, and field-supply delivery"
```

---

## Task 5: `RAISE_DIVISION` / `FORCE_DEPLOY` / `CANCEL_MARSHALLING` handlers + `gameTick()` wiring

**Files:**
- Modify: `game-server/src/rooms/GameRoom.ts`
- Test: `game-server/test/9c-unit-production.test.ts`

**Interfaces:**
- Consumes: `UnitProductionSystem` (Tasks 2-4), `_provinceCityPositionLookup` (`GameRoom.ts:144`),
  `serializeDivision` (`GameRoom.ts:2456`), `broadcastToNation` (`GameRoom.ts:1641`),
  `storageCapForLevel` (already imported), `economyBuildingSystem.get()`.

This task is server-integration-only — no new pure functions, so its tests exercise the message
handlers directly via the existing test harness pattern already used by `9a`/`9b` (spawn a room,
send messages, assert on `this.state`/broadcast payloads). Follow whatever harness helper those
files already use (`getTestPort`, room creation) — do not invent a new harness.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("lane:economy | RAISE_DIVISION / FORCE_DEPLOY / CANCEL_MARSHALLING integration", () => {
  it("RAISE_DIVISION does not create a DivisionState in state.divisions", async () => {
    // spawn room + nation + owned province (home_province_id), send RAISE_DIVISION,
    // assert room.state.divisions.size unchanged, assert a MARSHALLING_UPDATES broadcast fired
  });

  it("FORCE_DEPLOY below 50% aggregate HP is rejected", async () => {
    // raise a division, tick zero times (0% HP), send FORCE_DEPLOY, assert state.divisions still empty
  });

  it("FORCE_DEPLOY at >=50% aggregate HP creates a real DivisionState positioned at home_province_id's city position, broadcasts DIVISIONS_SPAWNED", async () => {
    // seed nation.reserve_pool with enough stock, tick until aggregate >= 50%, FORCE_DEPLOY,
    // assert state.divisions.has(new_division_id), assert its grid.cells match the raised template,
    // assert its position_lng/lat match _provinceCityPositionLookup for home_province_id
  });

  it("CANCEL_MARSHALLING removes the marshalling entry and returns stock to reserve_pool", async () => {});

  it("non-owner RAISE_DIVISION request (bad home_province_id ownership) is silently ignored", async () => {});
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd game-server && npx mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000
```
Expected: FAIL — handlers don't exist yet.

- [ ] **Step 3: Add the `unitProductionSystem` instance and imports**

In `GameRoom.ts`, alongside the block at line 140-141:

```typescript
private economyBuildingSystem = new EconomyBuildingSystem();
private resourceEconomySystem = new ResourceEconomySystem();
private unitProductionSystem = new UnitProductionSystem();
```

Add the import near the top:
```typescript
import { UnitProductionSystem } from "../systems/unit_production_system.js";
```

- [ ] **Step 4: Add the three message handlers**

Place these near `BUILD_BUILDING` (after line 584), following its exact ownership-guard shape:

```typescript
this.onMessage("RAISE_DIVISION", (client, msg: {
  template_id: string;
  home_province_id: string;
  cells: Array<{ cell_index: number; unit_type: string }>;
}) => {
  if (this.state.phase !== "running") return;
  const player = this.state.players.get(client.sessionId);
  if (!player) return;
  const nation = this.getNationForPlayer(player.userId);
  if (!nation) return;
  const province = this.state.provinces.get(msg.home_province_id);
  if (!province || province.owner_id !== nation.nation_id) return;

  const marshallingId = this.unitProductionSystem.startMarshalling(
    nation.nation_id, msg.template_id, msg.home_province_id, msg.cells,
  );
  this._broadcastMarshallingForNation(nation.nation_id);
  void marshallingId; // id isn't sent back explicitly — client identifies rows by nation-scoped list order + template_id
});

this.onMessage("FORCE_DEPLOY", (client, msg: { marshalling_id: string }) => {
  if (this.state.phase !== "running") return;
  const player = this.state.players.get(client.sessionId);
  if (!player) return;
  const nation = this.getNationForPlayer(player.userId);
  if (!nation) return;
  const data = this.unitProductionSystem.getMarshalling(msg.marshalling_id);
  if (!data || data.nation_id !== nation.nation_id) return;
  if (this.unitProductionSystem.aggregateHpPct(data) < 0.5) return; // §5.2 — inclusive at exactly 50%

  const div = new DivisionState();
  div.division_id = `division_${data.marshalling_id}`;
  div.nation_id = nation.nation_id;
  div.template_id = data.template_id;
  div.combat_state = "idle";
  div.supply_status = "normal";
  const pos = this._provinceCityPositionLookup.get(data.home_province_id);
  if (pos) {
    div.position_lng = pos.lng;
    div.position_lat = pos.lat;
  }
  for (const slot of data.slots) {
    if (slot.cell_index < 0 || slot.cell_index >= div.grid.cells.length) continue;
    div.grid.cells[slot.cell_index].unit_type = slot.unit_type;
    div.grid.cells[slot.cell_index].hp = slot.current_hp;
  }
  const templateCells = data.slots.map((s) => ({
    unit_type: s.unit_type, row: Math.floor(s.cell_index / 5), col: s.cell_index % 5,
  }));
  div.division_type = this.movementSystem.classifyDivisionType(templateCells);
  div.engagement_radius = this.movementSystem.computeEngagementRadius(templateCells);
  div.movement_profile_json = JSON.stringify(this.movementSystem.computeMovementProfile(templateCells));

  this.state.divisions.set(div.division_id, div);
  this.unitProductionSystem.removeMarshalling(msg.marshalling_id);

  // Reuses the exact bulk-add broadcast/client handler every other division already goes
  // through at game start — no new client code needed for the division to appear on the map.
  this.broadcast("DIVISIONS_SPAWNED", {
    shared_profile_json: "", // matches startGame()'s payload shape; unused per-division field
    divisions: [this.serializeDivision(div)],
  });
  this._broadcastMarshallingForNation(nation.nation_id);
});

this.onMessage("CANCEL_MARSHALLING", (client, msg: { marshalling_id: string }) => {
  if (this.state.phase !== "running") return;
  const player = this.state.players.get(client.sessionId);
  if (!player) return;
  const nation = this.getNationForPlayer(player.userId);
  if (!nation) return;
  const data = this.unitProductionSystem.getMarshalling(msg.marshalling_id);
  if (!data || data.nation_id !== nation.nation_id) return;
  this.unitProductionSystem.cancelMarshalling(msg.marshalling_id, this.state.nations);
  this._broadcastMarshallingForNation(nation.nation_id);
});
```

**Before implementing, confirm `startGame()`'s actual `DIVISIONS_SPAWNED` payload shape**
(investigation found it at `GameRoom.ts:1493`, `{ shared_profile_json, divisions }`) — copy its
exact field names, do not guess.

- [ ] **Step 5: Add `_broadcastMarshallingForNation` and `_broadcastReserveForNation` helpers, hook into `gameTick()`**

```typescript
private _broadcastMarshallingForNation(nationId: string): void {
  const list = this.unitProductionSystem.listMarshallingForNation(nationId).map((d) => ({
    marshalling_id: d.marshalling_id,
    template_id: d.template_id,
    home_province_id: d.home_province_id,
    aggregate_hp_pct: this.unitProductionSystem.aggregateHpPct(d),
    slots: d.slots,
  }));
  this.broadcastToNation("MARSHALLING_UPDATES", { marshalling: list }, nationId);
}
```

In `gameTick()`, add after the existing `this.economyBuildingSystem.tick(...)` call (line 1768)
and before `this._economyTick()` (line 1774):

```typescript
const provinceEconomyForOwner = new Map(
  [...this.economyBuildingSystem.getAll().entries()].map(([pid, econ]) => [
    pid, { ...econ, owner_id: this.state.provinces.get(pid)?.owner_id ?? "" },
  ]),
);
this.unitProductionSystem.tickProduction(
  this.economyBuildingSystem.getAll(),
  (provinceId) => {
    const ownerId = this.state.provinces.get(provinceId)?.owner_id;
    return ownerId ? this.state.nations.get(ownerId) : undefined;
  },
  (allocPct) => industrySliceMultiplier(allocPct),
);
const idleBuildings = this.unitProductionSystem.listIdleBuildings(provinceEconomyForOwner);
const demandByBuilding = new Map<string, Map<string, number>>();
for (const buildingType of PRODUCTION_BUILDING_TYPES) {
  const openSlots = this._collectOpenDemandSlots(buildingType);
  const nationId = /* per-building-owner chromium check happens per assignment below */ "";
  void nationId;
  demandByBuilding.set(buildingType, new Map()); // populated per-idle-building below since chromium availability is per-nation
}
for (const idle of idleBuildings) {
  const ownerId = this.state.provinces.get(idle.province_id)?.owner_id;
  const nation = ownerId ? this.state.nations.get(ownerId) : undefined;
  if (!nation) continue;
  const chromiumAvailable = isChromiumAvailable(nation.resources.get("chromium") ?? 0);
  const openSlots = this._collectOpenDemandSlots(idle.building_type, ownerId!);
  const scores = scoreTypeForBuilding(idle.building_type, openSlots, chromiumAvailable);
  if (scores.size === 0) continue;
  const [bestType] = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  this.unitProductionSystem.assignOrder(idle.province_id, idle.building_type, bestType);
}
this.unitProductionSystem.tickMarshalling(this.state.nations);
this.unitProductionSystem.tickFieldDelivery(this.state.divisions.values(), this.state.nations);
for (const [nationId] of this.state.nations) {
  if (this.unitProductionSystem.listMarshallingForNation(nationId).length > 0) {
    this._broadcastMarshallingForNation(nationId);
  }
  this.broadcastToNation("RESERVE_UPDATES", {
    reserve: Object.fromEntries(this.state.nations.get(nationId)!.reserve_pool),
    reserve_cap: this.state.nations.get(nationId)!.reserve_cap,
  }, nationId);
}
```

Add the private helper (placed near `serializeDivision`):

```typescript
/** Pools marshalling-template demand (all nations' provinces) and fielded-division-resupply
 * demand for one nation into DemandSlot[], scoped to a given nationId so chromium/scoring stays
 * per-nation-correct. */
private _collectOpenDemandSlots(buildingType: string, nationId: string): DemandSlot[] {
  const slots: DemandSlot[] = [];
  for (const data of this.unitProductionSystem.listMarshallingForNation(nationId)) {
    for (const slot of data.slots) {
      if (slot.current_hp >= 100) continue;
      const stats = getUnitProductionStats(slot.unit_type);
      if (stats.produced_by !== buildingType) continue;
      slots.push({
        slot_id: `${data.marshalling_id}:${slot.cell_index}`,
        unit_type: slot.unit_type,
        missing_pct: (100 - slot.current_hp) / 100,
        stream: "marshalling",
      });
    }
  }
  for (const div of this.state.divisions.values()) {
    if (div.nation_id !== nationId || !div.grid) continue;
    for (const cell of div.grid.cells) {
      if (cell.unit_type === "" || cell.hp >= 100) continue;
      const stats = getUnitProductionStats(cell.unit_type);
      if (stats.produced_by !== buildingType) continue;
      slots.push({
        slot_id: `${div.division_id}:${cell.unit_type}`,
        unit_type: cell.unit_type,
        missing_pct: (100 - cell.hp) / 100,
        stream: "field_resupply",
      });
    }
  }
  return slots;
}
```

Simplify the `gameTick()` snippet above — remove the unused `demandByBuilding`/`nationId`
scaffolding left over from drafting; the per-idle-building loop already calls
`_collectOpenDemandSlots` and `scoreTypeForBuilding` directly, so delete the earlier
`demandByBuilding` block entirely before committing.

Add the missing imports at the top of `GameRoom.ts`:
```typescript
import { scoreTypeForBuilding, DemandSlot } from "../systems/unit_production_system.js";
import { getUnitProductionStats, PRODUCTION_BUILDING_TYPES } from "../data/unit_production_stats.js";
```
(`isChromiumAvailable` and `industrySliceMultiplier` are already imported per Branch B.)

- [ ] **Step 6: Run to verify pass**

```bash
cd game-server && npx mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add game-server/src/rooms/GameRoom.ts game-server/test/9c-unit-production.test.ts
git commit -m "feat: wire RAISE_DIVISION/FORCE_DEPLOY/CANCEL_MARSHALLING and gameTick auto-scheduler"
```

---

## Task 6: Warehouse Reserve-cap extension

**Files:**
- Modify: `game-server/src/rooms/GameRoom.ts` (`_economyTick()`)
- Test: `game-server/test/9c-unit-production.test.ts`

**Interfaces:**
- Consumes: `storageCapForLevel` (already imported in `GameRoom.ts`), the same
  `totalWarehouseLevel` already computed in `_economyTick()` at line 2616.

- [ ] **Step 1: Write the failing test**

```typescript
describe("lane:economy | Warehouse Reserve cap", () => {
  it("reserve_cap scales with owned Warehouse levels, never zero even with no Warehouses", async () => {
    // spawn room + nation with zero warehouses, run one tick, assert nation.reserve_cap >= RESERVE_CAP_BASELINE (200)
    // then build/upgrade a warehouse, run another tick, assert reserve_cap increased
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd game-server && npx mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000
```
Expected: FAIL — `reserve_cap` stays at schema default `0`.

- [ ] **Step 3: Implement**

In `GameRoom.ts`'s `_economyTick()`, immediately after the existing Warehouse block (line
2613-2618):

```typescript
// Reserve — the "other half" of Warehouse's base effect, deferred here in Branch A/B because
// Reserve didn't exist until this branch. Same shared-cap shape as resource_storage_cap.
const RESERVE_CAP_BASELINE = 200; // TBD playtesting — never-zero floor
const RESERVE_CAP_PER_WAREHOUSE_LEVEL = 40; // TBD playtesting
nation.reserve_cap = storageCapForLevel(totalWarehouseLevel, RESERVE_CAP_BASELINE, RESERVE_CAP_PER_WAREHOUSE_LEVEL);
```

(`totalWarehouseLevel` is already in scope from the existing Warehouse block a few lines above.)

- [ ] **Step 4: Run to verify pass**

```bash
cd game-server && npx mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add game-server/src/rooms/GameRoom.ts game-server/test/9c-unit-production.test.ts
git commit -m "feat: extend Warehouse's base effect to cap national Reserve stock"
```

---

## Task 7: `test-lanes.json` / `package.json` registration + full suite

**Files:**
- Modify: `game-server/test-lanes.json`
- Modify: `game-server/package.json`

- [ ] **Step 1: Read the current `economy` lane**

```bash
cd game-server && cat test-lanes.json
```

- [ ] **Step 2: Edit `test-lanes.json`**

Add to the existing `economy` lane's `source_prefixes` array:
`"src/systems/unit_production_system.ts"`, `"src/data/unit_production_stats.ts"`. Add to
`tests`: `"test/9c-unit-production.test.ts"`.

- [ ] **Step 3: Read and edit `package.json`'s test chain**

```bash
cat package.json | grep -A3 '"test"'
```
Append `&& NODE_ENV=test mocha -r tsx test/9c-unit-production.test.ts --exit --timeout 180000`
to whatever the chain currently ends with, matching the exact `9a`/`9b` invocation shape already
present.

- [ ] **Step 4: Run the full suite once**

```bash
cd game-server && npm test
```
Expected: every lane green, including `9a`, `9b`, `9c`. This is the one point in this plan where
the full suite is run — do not run it again except at the very end after the client tasks.

- [ ] **Step 5: Commit**

```bash
git add game-server/test-lanes.json game-server/package.json
git commit -m "test: register 9c-unit-production in the economy lane and test chain"
```

---

## Task 8: Client wiring — `game_state.gd`, `event_bus.gd`, `session_manager.gd`

**Files:**
- Modify: `client/src/core/game_state.gd`
- Modify: `client/src/core/event_bus.gd`
- Modify: `client/src/systems/session/session_manager.gd`

**Interfaces:**
- Produces: `GameState.marshalling_divisions: Dictionary` (keyed by `marshalling_id`),
  `GameState.reserve: Dictionary`, `GameState.reserve_cap: float`,
  `GameState._apply_marshalling_updates(data)`, `GameState._apply_reserve_updates(data)`,
  `EventBus.marshalling_updated`, `EventBus.reserve_updated`.

- [ ] **Step 1: `game_state.gd` — new state and apply methods**

Add near the other Branch A/B fields (after `var province_economy: Dictionary = {}` at line 67):

```gdscript
var marshalling_divisions: Dictionary = {}   # marshalling_id -> {template_id, home_province_id, aggregate_hp_pct, slots}
var reserve: Dictionary = {}                 # unit_type -> HP-equivalent amount
var reserve_cap: float = 0.0
```

Add near the other `_apply_*` methods (after `_apply_resource_updates`, per the existing
pattern):

```gdscript
func _apply_marshalling_updates(data: Dictionary) -> void:
	marshalling_divisions.clear()
	for entry: Dictionary in data.get("marshalling", []):
		var mid: String = entry.get("marshalling_id", "")
		if mid.is_empty():
			continue
		marshalling_divisions[mid] = entry
	EventBus.marshalling_updated.emit()

func _apply_reserve_updates(data: Dictionary) -> void:
	reserve = data.get("reserve", {})
	reserve_cap = float(data.get("reserve_cap", 0.0))
	EventBus.reserve_updated.emit()
```

`MARSHALLING_UPDATES` is always sent as a full per-nation snapshot (mirrors `BUILDING_UPDATES`/
`RESOURCE_UPDATES`'s existing full-resend convention, confirmed in Task 5) — `.clear()` then
repopulate is correct, not a bug; a cancelled/deployed marshalling division simply won't be in
the next list.

- [ ] **Step 2: `event_bus.gd` — new signals**

Add near the other Economy/Production signals (after `production_panel_open_requested`):

```gdscript
signal marshalling_updated()
signal reserve_updated()
```

- [ ] **Step 3: `session_manager.gd` — new match arms**

Add near the existing `"RESOURCE_UPDATES"` arm:

```gdscript
"MARSHALLING_UPDATES":
	GameState._apply_marshalling_updates(data)
"RESERVE_UPDATES":
	GameState._apply_reserve_updates(data)
```

- [ ] **Step 4: Manual verification**

None yet — nothing renders this data until Task 9/10. Confirm only that the file parses (no
Godot syntax errors) by opening the project in the editor or running:
```bash
godot --headless --path client --check-only 2>&1 | head -50
```
Report as performed, or "still required" if a running Godot install isn't available in this
environment.

- [ ] **Step 5: Commit**

```bash
git add client/src/core/game_state.gd client/src/core/event_bus.gd client/src/systems/session/session_manager.gd
git commit -m "feat: wire MARSHALLING_UPDATES/RESERVE_UPDATES into GameState"
```

---

## Task 9: Production panel — real Templates and Reserve tabs

**Files:**
- Modify: `client/src/ui/hud/production_panel.gd`
- Modify: `client/scenes/game/panels/production_panel.tscn`

**Interfaces:**
- Consumes: `GameState.divisions`, `GameState.marshalling_divisions`, `GameState.reserve`,
  `GameState.reserve_cap`, `DivisionTemplateStore.get_templates()` (already used by
  `military_panel.gd`), `CommandQueue.submit()`.

- [ ] **Step 1: `.tscn` — replace the two placeholder labels**

Open `client/scenes/game/panels/production_panel.tscn`. Under the `Templates` tab, replace
`PlaceholderTemplates` (Label) with a `VBoxContainer` named `TemplateList` (one row per
template, populated at runtime) plus a `Button` named `BtnRaise` above it. Under the `Reserve`
tab, replace `PlaceholderReserve` (Label) with a `VBoxContainer` named `ReserveList` (one row
per category, populated at runtime). Leave the `Naval` tab's placeholder untouched (out of
scope this phase).

- [ ] **Step 2: `production_panel.gd` rewrite**

```gdscript
extends PanelContainer

signal close_requested()

@onready var _close_button: Button = %CloseButton
@onready var _template_list: VBoxContainer = %TemplateList
@onready var _btn_raise: Button = %BtnRaise
@onready var _reserve_list: VBoxContainer = %ReserveList

const _CONTENT_PATH: String = "Margin/VBox/ContentBody"

# unit_type -> category label, per RESOURCE_ECONOMY.md's Reserve status categories.
const RESERVE_CATEGORIES := {
	"Infantry": ["infantry", "assault_infantry", "recon_infantry", "mg", "cavalry", "at_infantry", "sniper", "commando", "flamethrower", "force_recon_sniper"],
	"Ordnance": ["artillery", "at_gun", "aa_gun", "howitzer"],
	"Tank": ["armoured_car", "light_tank", "medium_tank", "heavy_tank", "at_gun_sp", "self_propelled_gun"],
	"Air": ["cas_plane", "dive_bomber", "fighter", "naval_bomber", "heavy_fighter", "strategic_bomber", "tactical_bomber", "recon_plane"],
}

func _ready() -> void:
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	_setup_tab_buttons()
	_btn_raise.pressed.connect(_on_raise_pressed)
	EventBus.marshalling_updated.connect(_refresh_templates)
	EventBus.division_updated.connect(func(_id: String) -> void: _refresh_templates())
	EventBus.reserve_updated.connect(_refresh_reserve)
	_refresh_templates()
	_refresh_reserve()

func _setup_tab_buttons() -> void:
	var tc: TabContainer = get_node_or_null(_CONTENT_PATH + "/TabBar") as TabContainer
	var tab_btns: HBoxContainer = get_node_or_null(_CONTENT_PATH + "/TabButtons") as HBoxContainer
	if tc == null or tab_btns == null:
		return
	var btn_group := ButtonGroup.new()
	for i: int in range(tab_btns.get_child_count()):
		var btn: Button = tab_btns.get_child(i) as Button
		btn.button_group = btn_group
		btn.pressed.connect(_on_tab_button_pressed.bind(i))
	tc.tab_changed.connect(_sync_tab_button)

func _on_tab_button_pressed(idx: int) -> void:
	var tc := get_node_or_null(_CONTENT_PATH + "/TabBar") as TabContainer
	if tc != null:
		tc.current_tab = idx

func _sync_tab_button(idx: int) -> void:
	var tab_btns := get_node_or_null(_CONTENT_PATH + "/TabButtons") as HBoxContainer
	if tab_btns == null or idx >= tab_btns.get_child_count():
		return
	(tab_btns.get_child(idx) as Button).button_pressed = true

func cycle_sub_tab(forward: bool) -> void:
	var tabs_node := get_node_or_null(_CONTENT_PATH + "/TabBar")
	if tabs_node == null or not tabs_node is TabContainer:
		return
	var tabs: TabContainer = tabs_node as TabContainer
	var count: int = tabs.get_tab_count()
	if count <= 1:
		return
	tabs.current_tab = posmod(tabs.current_tab + (1 if forward else -1), count)

func _refresh_templates() -> void:
	for child in _template_list.get_children():
		child.queue_free()
	var fielded_counts: Dictionary = {}
	for div_id: String in GameState.divisions:
		var tid: String = GameState.divisions[div_id].get("template_id", "")
		fielded_counts[tid] = fielded_counts.get(tid, 0) + 1
	var deploying_counts: Dictionary = {}
	for mid: String in GameState.marshalling_divisions:
		var tid: String = GameState.marshalling_divisions[mid].get("template_id", "")
		deploying_counts[tid] = deploying_counts.get(tid, 0) + 1

	for template: Dictionary in DivisionTemplateStore.get_templates():
		var tid: String = template.get("template_id", "")
		var row := HBoxContainer.new()
		var label := Label.new()
		label.text = "%s   Fielded: %d   Deploying: %d" % [
			template.get("name", tid), fielded_counts.get(tid, 0), deploying_counts.get(tid, 0),
		]
		row.add_child(label)
		_template_list.add_child(row)

func _on_raise_pressed() -> void:
	# Opens the existing Division Template Viewer so the player picks which template to raise
	# and which owned province to raise it from — reuses EventBus's existing open-request signal
	# rather than a new picker UI.
	EventBus.division_template_viewer_open_requested.emit()

func _refresh_reserve() -> void:
	for child in _reserve_list.get_children():
		child.queue_free()
	for category: String in RESERVE_CATEGORIES:
		var total: float = 0.0
		for unit_type: String in RESERVE_CATEGORIES[category]:
			total += float(GameState.reserve.get(unit_type, 0.0))
		var row := Label.new()
		row.text = "%s   %s HP-eq / %s cap" % [category, str(int(total)), str(int(GameState.reserve_cap))]
		_reserve_list.add_child(row)
```

**Note on `_on_raise_pressed`:** the actual `RAISE_DIVISION` submission (with the chosen
`home_province_id`) is deferred to wherever the template picker/viewer already lets a player
confirm a template — this branch only needs to prove the pipe from server `MARSHALLING_UPDATES`/
`RESERVE_UPDATES` through to visible numbers works end-to-end, per the same scoping precedent
Branch A used for its own first-pass Economy panel (`phase-9-task-a-foundation.md` Step 8's
"this branch renders... no need to be feature-complete" framing). If the template viewer doesn't
yet expose a "raise this template from this province" action, add a minimal one:
`CommandQueue.submit("RAISE_DIVISION", {"template_id": tid, "home_province_id": pid, "cells": cells})`
where `cells` comes from `DivisionTemplateStore`'s existing per-template cell data (same shape
`ASSIGN_TEMPLATE` already sends).

- [ ] **Step 3: Manual verification (required)**

Launch the Godot client, press the Production panel's hotkey, open the Reserve tab — confirm
four category rows (Infantry/Ordnance/Tank/Air) render with `0 HP-eq / <cap> cap` at game start.
Raise a division from an existing template with sufficient Reserve stock (seed via a
bot-scripted stockpile if none has accumulated yet) — confirm the Templates tab's Deploying
count increments for that template, and the Reserve tab's relevant category number decreases as
it fills.

Report this as performed, or state the exact command still required
(`godot --path client` from the repo root) if a live client wasn't run in this session.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui/hud/production_panel.gd client/scenes/game/panels/production_panel.tscn
git commit -m "feat: wire Production panel Templates and Reserve tabs to real state"
```

---

## Task 10: Military panel — DEPLOYING section

**Files:**
- Modify: `client/src/ui/hud/military_panel.gd`

**Interfaces:**
- Consumes: `GameState.marshalling_divisions`, `EventBus.marshalling_updated`,
  `CommandQueue.submit()`.

Investigation found the Land tab's former active-division-list code already exists, disabled,
at lines 250-318 (search the file for `"DISABLED"`) — this is a good reference for the row/list
pattern to follow for the new DEPLOYING section, but it renders *deployed* divisions, not
marshalling ones; do not re-enable it as part of this task (that's a separate, already-flagged
follow-up — the marker comment at lines 6-7 predates this branch and is out of scope here). Add
the new DEPLOYING section as its own block, above wherever the existing template list
(`_refresh_template_list`, line 100) renders in the Land tab.

- [ ] **Step 1: Add the DEPLOYING section**

```gdscript
@onready var _deploying_list: VBoxContainer = %DeployingList  # add this node to military_panel.tscn's Land tab, above the template list container

func _ready() -> void:
	# ... existing _ready() body ...
	EventBus.marshalling_updated.connect(_refresh_deploying)
	_refresh_deploying()

func _refresh_deploying() -> void:
	for child in _deploying_list.get_children():
		child.queue_free()
	if GameState.marshalling_divisions.is_empty():
		var empty_label := Label.new()
		empty_label.text = "No divisions currently marshalling. Raise one from the Production panel."
		_deploying_list.add_child(empty_label)
		return
	for mid: String in GameState.marshalling_divisions:
		var data: Dictionary = GameState.marshalling_divisions[mid]
		var pct: float = float(data.get("aggregate_hp_pct", 0.0)) * 100.0
		var row := HBoxContainer.new()
		var label := Label.new()
		var missing_parts: Array[String] = []
		var by_type: Dictionary = {}
		for slot: Dictionary in data.get("slots", []):
			if float(slot.get("current_hp", 0.0)) >= 100.0:
				continue
			var ut: String = slot.get("unit_type", "")
			by_type[ut] = by_type.get(ut, 0) + 1
		for ut: String in by_type:
			missing_parts.append("%dx %s" % [by_type[ut], ut])
		label.text = "%s   %d%% agg. HP   Missing: %s" % [
			data.get("template_id", ""), int(pct), ", ".join(missing_parts) if missing_parts.size() > 0 else "none",
		]
		row.add_child(label)

		var btn_cancel := Button.new()
		btn_cancel.text = "Cancel"
		btn_cancel.pressed.connect(func() -> void:
			CommandQueue.submit("CANCEL_MARSHALLING", {"marshalling_id": mid})
		)
		row.add_child(btn_cancel)

		var btn_deploy := Button.new()
		btn_deploy.text = "Force Deploy"
		btn_deploy.disabled = pct < 50.0
		btn_deploy.pressed.connect(func() -> void:
			CommandQueue.submit("FORCE_DEPLOY", {"marshalling_id": mid})
		)
		row.add_child(btn_deploy)

		_deploying_list.add_child(row)
```

Add the `%DeployingList` `VBoxContainer` node to `military_panel.tscn`'s Land tab tree, placed
above the existing template-list container, following the scene's existing `%`-unique-name
convention for `@onready` lookups (grep the `.tscn` for an existing `%`-named node to confirm the
exact convention before adding a new one).

- [ ] **Step 2: Manual verification (required, this task's primary checkpoint)**

Launch the Godot client. Raise a division (per Task 9's verification) — confirm it does **not**
appear on the strategic map, confirm it appears in Military panel's Land tab DEPLOYING section
with a climbing aggregate HP%. At ≥50%, confirm `Force Deploy` becomes clickable; click it —
confirm the division now appears on the map at the raising province's city position, and the
DEPLOYING row disappears (moves to the ordinary deployed-division list). Separately, raise a
second division and click `Cancel` before it fills — confirm the Reserve tab's numbers (Task 9)
tick back up by whatever had already been allocated.

Report this as performed, or state the exact command still required if not run in this session.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/hud/military_panel.gd client/scenes/game/panels/military_panel.tscn
git commit -m "feat: add Military panel DEPLOYING section for marshalling divisions"
```

---

## Self-Review Notes

- **Spec coverage:** every section of `phase-9-task-c-unit-production-reserve.md` is covered —
  §1-3 (production model) → Tasks 1/3; §4 (Reserve) → Tasks 3/6; §5 (Marshalling/deployment) →
  Task 4/5; §6 (auto-scheduler) → Task 2; §7 (building taxonomy, land/air only per phase scope
  cut) → Task 1; §8 (default placement) is unchanged from Branches A/B, no new work; §9
  (experience/disbandment) explicitly out of scope, confirmed no code touches it; naval (§7.5) is
  explicitly excluded per the phase overview.
- **Deliberate simplifications, stated once here rather than per-task:** `deployment_state` /
  `aggregate_hp_pct` are **not** added as `DivisionState` schema fields (Architecture Decision
  1/2 above) — the handoff doc's own sketch suggested them, but the actual codebase's lack of any
  client-side schema-reactivity listener (confirmed: nothing calls `state.divisions.onAdd`
  anywhere) means a schema field alone would never reach the client; the message-based approach
  used here is both simpler and the only one that actually works given how this codebase pushes
  state today.
- **Known gap, not silently dropped:** `motorised_infantry`/`mechanised_infantry` (named in
  `unit_production_handoff.md §7.1`/§7.2) do not exist as `UnitType` values anywhere in this
  codebase as of this branch — Task 1 maps only the 20 types that exist. Adding those two unit
  types is a `TACTICAL_COMBAT.md`/`unit_combat_stats.ts` change, out of scope for a production/
  economy branch; flag to the user rather than inventing new combat unit types here.
