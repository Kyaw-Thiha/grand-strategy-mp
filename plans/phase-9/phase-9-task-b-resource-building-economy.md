# Branch B — `feat/resource-and-building-economy`

## Context

**Prerequisite: Branch A merged.** This branch assumes `NationState.resources`/`reserve_pool`/
`industry_alloc` fields exist, `EconomyBuildingSystem` and its `Map<province_id,
ProvinceEconomyData>` exist, `BUILD_BUILDING` works, and the Economy panel/Production panel
shells exist per `phase-9-task-a-foundation.md`.

The largest branch in this phase, deliberately: all ten resources' distinct mechanics,
population/manpower, every civilian and resource-extraction building's base effect, and the
national Industry Pool. One topic because the Industry Pool has nothing to multiply until
extraction produces something, and `DEV_PHASES.md`'s own Phase 9 verification gate treats all
of this as one paragraph, one gate. **No perk trees anywhere in this branch** — every
mechanic below is the *base* behavior only.

**Read this whole Context section before starting any step — it contains three schema gaps
this branch must resolve, discovered by cross-checking `ECONOMY_BUILDINGS.md` against the
actual `MAP_DATA_CONTRACT.md` field list, and an honest scoping note about which of the
"distinct resource mechanics" are actually fully implementable right now versus which are
partially stubbed because they depend on systems that don't exist until a later branch or a
later phase.**

### Schema gap 1 — no building produces money at base level

`ECONOMY_BUILDINGS.md`'s Infrastructure entry states money production is **perk-gated**
(Path A, T1: "unlocks money production as a new perk — not present at base level"). No other
building's base effect produces money either. With perk trees deferred this phase, **there is
currently no documented base-level money source at all**, which would make the economy inert
after the Branch A starting seed runs out. **Resolution for this branch:** add a small,
clearly-flagged national money trickle scaled by total population (see Step 3) as a
functional placeholder, replacing it with the real Infrastructure Trade Network perk once the
research-system phase lands. This is a scope decision made in this plan, not a silent
assumption — if you disagree with it, that's the one thing worth raising before implementing
Step 3.

### Schema gap 2 — Infrastructure has no `bld_*` field

`ECONOMY_BUILDINGS.md` documents "Infrastructure" as a full civilian building (Standard
complexity, its own level 1-5). `MAP_DATA_CONTRACT.md`'s enumerated `bld_*` list (`fort, port,
airbase, supply_hub, factory, barracks, tank_plant, ordnance_factory, aircraft_factory,
school, hospital, warehouse, shipyard, town_hall`) has no `bld_infrastructure` entry.
**Verify this against the live doc first** — if it's genuinely missing, add
`bld_infrastructure` to `building_stats.ts` (Branch A's file) following the identical pattern
as the other 14 entries, and treat its base effect as **raising the existing
`ProvinceState.infrastructure` 0-100 scalar** (already present, default 50) by a level-scaled
amount — not replacing that scalar, composing with it. This keeps every existing reader of
`province.infrastructure` (Branch A's `baseConstructionRate()`, movement speed elsewhere)
correct without needing to touch them.

### Schema gap 3 — `vp_value` is pipeline-only, never reaches `ProvinceState`

Confirmed by direct code read: `map_data.json` provinces already carry a `vp_value` field
(the pipeline writes it), but `ProvinceState` has no `vp_value` field and
`_initProvinces()` never reads it. Town Hall's base effect (population-to-VP weighting
multiplier) needs a real `vp_value` to multiply. This branch adds
`@type("number") vp_value: number = 0;` to `ProvinceState` and reads it in `_initProvinces()`
the same way `industry`/`population`/`infrastructure` already are (see Branch A's Critical
Pre-Read for that exact code block).

### Honest scoping — which resource mechanics are fully real in this branch vs. stubbed

| Resource | This branch | Why |
|---|---|---|
| Money, Grain, Iron | Fully real: extraction tick + stockpile | No cross-phase dependency |
| Oil | Fully real: continuous draw, debuff curve, allocation toggle, readiness/speed penalty | Readiness/speed is implementable now (movement system already reads division state); **HP-recovery degradation is a documented no-op** — no healing tick exists anywhere in this codebase yet (confirmed: `supply_system.ts` only drains HP, never restores it), so "oil-starved units heal slower" has nothing to slow down until Phase 7 |
| Rubber, Nitrates | Real: combat-round attrition drain, HP-recovery-degradation flag computed | Combat-round drain hooks into the existing `combat_system.ts` tick, fully real now. Vehicle/infantry **build-cost** depletion is deferred to Branch C (no per-unit production exists until then). HP-recovery degradation is the same Phase-7 no-op as Oil |
| Tungsten | Fully real: shifts the live armour-penetration table row | Hooks directly into `combat_system.ts`'s existing `_armorPenMultiplier` — no cross-phase dependency at all, this is the cleanest mechanic in the branch |
| Chromium | Partial: threshold flag computed and broadcast; the actual hard-gates (block premium-tier production, cut premium-tier supply) are **stubbed with an explicit TODO**, not implemented | Production-block has nothing to gate until Branch C's unit production exists; supply-cut has nothing to cut until Phase 7 exists |
| Aluminium | Stub only, exactly as `DEV_PHASES.md`'s own Phase 9 section specifies | The doc states outright: "gated on a placeholder research flag in this phase... flag starts false for every nation, so the mechanic is inert and untestable beyond 'ceiling exists' until [Phase 14]" — this branch implements exactly that placeholder, nothing more |
| Uranium | Extraction/stockpile only; the research-currency injection is stubbed | No research-currency system or tech-node concept exists yet (`unit_production_handoff.md`'s own open question #3 — "General Technology panel has no owning doc/section yet") |

Do not present Chromium, Aluminium, or Uranium as "done" in this branch's verification gate —
present them exactly as scoped above.

**Test-Driven Development is mandatory for every server step below.**

---

## Critical Pre-Read

### Armour penetration table — `combat_system.ts:89-98,192-199` (Tungsten's hook point)

```typescript
89:  const ARMOUR_PEN_TABLE: Array<[number, number]> = [
       [1.00, 1.00], [0.90, 0.70], [0.80, 0.40], [0.70, 0.30], [0.60, 0.20], [0.00, 0.00],
     ];
192: export function _armorPenMultiplier(pen: number, armour: number): number {
       if (armour <= 0) return 1.0;
       const ratio = pen / armour;
       for (const [threshold, mult] of ARMOUR_PEN_TABLE) {
         if (ratio >= threshold) return mult;
       }
       return 0.0;
     }
```
Called with `pen`/`armour` sourced from `UNIT_COMBAT_STATS[unit_type]` in
`game-server/src/data/unit_combat_stats.ts`. Tungsten's mechanic multiplies the effective
`pen` value fed into this function by a national tungsten-availability factor before the ratio
is computed — it does **not** change the table itself.

### `unit_combat_stats.ts` — current interface (no premium-tier tag exists)

```typescript
interface UnitCombatStats { pen: number; armour: number; hp_floor_pct: number; stealth_level: number; anti_stealth: number; }
```
No `tier`/`premium`/`chromium_gated` field anywhere. Chromium's Step 7 adds one.

### HP recovery — confirmed complete no-op

`game-server/src/systems/supply_system.ts` line ~110: `div.hp = Math.max(0, div.hp -
drain);` — pure attrition, one direction only. No other file in `src/systems/` restores HP.
**Any mechanic below described in the design docs as "slows HP recovery rate" has nothing to
act on right now** — implement it as a stored penalty value on division state (so Phase 7's
future healing tick has something to read once it exists) but do not attempt to build a
healing tick as a side effect of this branch; that is explicitly Phase 7's job.

### `DivisionState` relevant fields (`GameRoomState.ts:47-71`)

```typescript
47:  export class DivisionState extends Schema {
       ...
50:    @type("string") division_type: string = "infantry";
       ...
53:    @type("number") hp: number = 100;
       ...
56:    @type("string") supply_status: string = "normal";
       ...
71:    grid: DivisionGridState = new DivisionGridState(); // server-side only — not schema-synced
     }
```
`division_type` is the derived "armoured/motorised/infantry" classification, **not** a
per-unit-type list — oil/rubber/nitrate consumption is determined per-*unit-type* (per grid
cell), not per-division, per `RESOURCE_ECONOMY.md` ("motorised infantry, all armour, all
naval units, all air units" — a unit-type-level list, mixed within one division's grid). Read
`div.grid.cells[i].unit_type` per cell, not `div.division_type`, when computing oil/rubber/
nitrate exposure for a division.

### `NationState` (post-Branch-A, from `phase-9-task-a-foundation.md` Step 2)

```typescript
@type({ map: "number" }) resources     = new MapSchema<number>(); // 10 keys
@type("number")           manpower_available: number = 0;
@type("number")           manpower_ceiling:   number = 0;
@type({ map: "number" }) reserve_pool   = new MapSchema<number>(); // empty until Branch C
@type({ map: "number" }) industry_alloc = new MapSchema<number>(); // this branch populates it
```

### `ProvinceEconomyData` (Branch A, `economy_building_system.ts`)

```typescript
interface ProvinceEconomyData {
  province_id: string;
  buildings: Record<string, number>;          // building_type -> level 0-5
  resource_deposits: Record<string, number>;  // resource_type -> abundance, read-only
  construction_queue: ConstructionProjectData[];
}
```
Extraction rate formula for every resource-extraction building type: `output =
base_output(building_level) × (deposit_abundance / 100) × industry_multiplier`. **Zero
industry allocated still yields full base-tier output** — `industry_multiplier` floors at
`1.0`, never below (`ECONOMY_BUILDINGS.md`'s Design Philosophy #1, the "player who never opens
the panel still has a complete economy" guarantee — do not implement this as a multiplier that
can go *below* 1.0 for zero allocation; it is pure upside, `1.0` to `1.0+diminishing_curve`).

### `game_state.gd` / `session_manager.gd` dispatch (Branch A already wired the plumbing)

`GameState.resources`, `GameState._apply_resource_updates()`, `EventBus.resources_updated`,
and the `"RESOURCE_UPDATES"` match arm all already exist from Branch A — this branch only adds
the server-side code that actually calls `broadcast("RESOURCE_UPDATES", ...)`, and extends
`economy_panel.gd` to show rates, not just stockpiles.

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/src/data/resource_stats.ts` | Base extraction rate per building level, per resource-extraction building type; population growth constants; manpower soft-cap curve constants |
| `game-server/src/systems/resource_economy_system.ts` | The per-tick resource extraction/consumption/population system |
| `game-server/src/data/oil_consumption_table.ts` | Which unit types consume oil/rubber/nitrates (a static set per resource, since no such tag exists on `unit_combat_stats.ts` today) |
| `game-server/test/9b-resource-economy.test.ts` | All Branch B server tests (may split into multiple files by mechanic if it grows unwieldy — flag to reviewer if so, don't force one file past ~600 lines) |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/schema/GameRoomState.ts` | Add `vp_value` to `ProvinceState` (schema gap 3) |
| `game-server/src/data/building_stats.ts` | Add `bld_infrastructure` if genuinely missing (schema gap 2); add base-effect magnitude fields per building (science output, casualty-reduction %, movement bonus, storage ceiling, convoy capacity, vp multiplier — one new field per building's single base effect) |
| `game-server/src/data/unit_combat_stats.ts` | Add `chromium_gated: boolean` field |
| `game-server/src/systems/combat_system.ts` | Tungsten hook in `_armorPenMultiplier` call site; Hospital's national HP-damage-reduction multiplier in the damage-application step; rubber/nitrate combat-round attrition drain call |
| `game-server/src/rooms/GameRoom.ts` | New `resourceEconomySystem` instance + `gameTick()` hookup; `_initProvinces()` reads `vp_value`; `SET_OIL_PRIORITY` and `SET_INDUSTRY_ALLOCATION` handlers |
| `game-server/test-lanes.json` | `economy` lane: add `9b-resource-economy.test.ts`, add new source prefixes |
| `client/src/ui/hud/economy_panel.gd` / `.tscn` | Resources tab: real net rates (`+N/t`), bar-fill vs. Warehouse storage cap, oil `!` marker, manpower row; new Industry tab (sliders) |
| `client/src/ui/hud/game_hud.gd` (top bar, if it's a separate scene — locate it) | Always-4 (Money/Grain/Oil/Manpower) + hover flyout for the rest |
| `client/src/ui/hud/province_detail_panel.gd` | "RESOURCES PRODUCED HERE" block (Branch A built the modal without it; this branch adds the block) |

---

## Step 1: Data tables (TDD)

### 1a. `resource_stats.ts`

```typescript
export interface ExtractionStats {
  base_output_by_level: number[]; // 5 values, index 0 = level 1 output
}
export const EXTRACTION_STATS: Record<string, ExtractionStats> = {
  // one entry per resource-extraction building_type from building_stats.ts:
  // iron_mine, grain_farm, oil_derrick, rubber_plantation, nitrate_works,
  // tungsten_mine, chromium_mine, bauxite_refinery, uranium_mine
};
export function getExtractionStats(buildingType: string): ExtractionStats { /* throw on unknown, same as building_stats.ts's accessor */ }

export const MONEY_TRICKLE_PER_POPULATION = 0.02; // TBD playtesting — schema gap 1 placeholder
export const POPULATION_GROWTH_RATE = 0.5;        // TBD playtesting — flat per-tick growth, per-province
export const MANPOWER_RATIO = 0.15;                // fraction of population that is "ceiling" recruitable manpower
export const MANPOWER_SOFT_CAP_THRESHOLD = 0.2;    // below this available/ceiling ratio, cost multiplier kicks in
export const MANPOWER_SOFT_CAP_MAX_MULT = 3.0;     // cost multiplier at zero available manpower
```
All TBD-playtesting values, named and commented per project convention — do not invent
"realistic" numbers, use round placeholders.

### 1b. Write failing tests, then implement, run — must PASS.

```typescript
describe("lane:economy | resource_stats data table", () => {
  it("every resource-extraction building_type in building_stats.ts has a matching EXTRACTION_STATS entry", () => {
    // cross-check both tables' key sets match exactly
  });
  it("base_output_by_level is monotonically increasing", () => {});
});
```

---

## Step 2: Population & Manpower tick

### 2a. Tests first

```typescript
describe("lane:economy | Population and manpower", () => {
  it("province population grows by POPULATION_GROWTH_RATE per tick", () => {});
  it("nation manpower_ceiling = sum of owned provinces' population x MANPOWER_RATIO", () => {});
  it("manpower_available never exceeds manpower_ceiling", () => {});
  it("recruiting cost multiplier increases as available/ceiling ratio drops below MANPOWER_SOFT_CAP_THRESHOLD, caps at MANPOWER_SOFT_CAP_MAX_MULT", () => {});
  it("recruiting from empty manpower is expensive, never blocked (soft cap, not hard cap)", () => {
    // getManpowerCostMultiplier(available=0, ceiling=100) returns MANPOWER_SOFT_CAP_MAX_MULT, not Infinity
  });
});
```

### 2b. Implement in `resource_economy_system.ts`

```typescript
export function tickPopulation(provinces: Map<string, ProvinceState>): void {
  for (const province of provinces.values()) {
    province.population += POPULATION_GROWTH_RATE;
  }
}

export function computeManpower(nation: NationState, ownedProvinces: ProvinceState[]): void {
  const totalPop = ownedProvinces.reduce((sum, p) => sum + p.population, 0);
  nation.manpower_ceiling = totalPop * MANPOWER_RATIO;
  nation.manpower_available = Math.min(nation.manpower_available, nation.manpower_ceiling);
  // manpower_available is drawn down by unit build cost (Branch C) and regenerates toward
  // ceiling at a steady per-tick rate — this branch only computes the ceiling and clamps;
  // the regeneration-toward-ceiling tick belongs here too:
  const REGEN_RATE = nation.manpower_ceiling * 0.02; // TBD playtesting
  nation.manpower_available = Math.min(nation.manpower_ceiling, nation.manpower_available + REGEN_RATE);
}

export function getManpowerCostMultiplier(available: number, ceiling: number): number {
  if (ceiling <= 0) return 1.0; // no demand yet — same "zero-demand reads as neutral" principle used elsewhere in this design
  const ratio = available / ceiling;
  if (ratio >= MANPOWER_SOFT_CAP_THRESHOLD) return 1.0;
  const severity = 1 - (ratio / MANPOWER_SOFT_CAP_THRESHOLD);
  return 1.0 + severity * (MANPOWER_SOFT_CAP_MAX_MULT - 1.0);
}
```
`manpower_available` starts at `0` (Branch A default) — **edge case:** this means every
nation starts at `0/ceiling` manpower on game start, which reads as a heavy deficit (worst
soft-cap multiplier) before the regen-toward-ceiling tick has run even once. Seed
`manpower_available = manpower_ceiling` at the same point Branch A seeds starting money
(`_initNationEconomy()`), not left at the schema default.

### 2c. Manual verification

None yet — Economy panel's Manpower row is wired in Step 11.

---

## Step 3: Common extraction tick — Money (placeholder trickle), Grain, Iron

### 3a. Tests first

```typescript
describe("lane:economy | Common resource extraction", () => {
  it("money trickles in proportional to total national population even with zero buildings", () => {});
  it("zero-industry Iron Mine at level 1 still produces its full base-tier output", () => {
    // core Design Philosophy #1 guarantee — this is the single most important test in this branch
  });
  it("Iron Mine output scales with resource_deposits.iron abundance, not just building level", () => {
    // two identical-level mines, different deposit abundance -> different output
  });
  it("a province with zero iron deposit and a built Iron Mine produces zero iron, not a division-by-zero error", () => {});
});
```

### 3b. Implement extraction tick

```typescript
export function tickExtraction(
  nation: NationState,
  ownedProvinceEconomies: ProvinceEconomyData[],
  industryMultiplierByResource: (resourceType: string) => number, // Step 10 wires the real curve; 1.0 until then
): Record<string, number> {
  const gained: Record<string, number> = {};
  for (const econ of ownedProvinceEconomies) {
    for (const [buildingType, extraction] of Object.entries(EXTRACTION_STATS)) {
      const level = econ.buildings[buildingType] ?? 0;
      if (level === 0) continue;
      const resourceType = RESOURCE_TYPE_BY_BUILDING[buildingType]; // e.g. iron_mine -> "iron"
      const deposit = econ.resource_deposits[resourceType] ?? 0;
      const base = extraction.base_output_by_level[level - 1];
      const output = base * (deposit / 100) * industryMultiplierByResource(resourceType);
      gained[resourceType] = (gained[resourceType] ?? 0) + output;
    }
  }
  // Money placeholder trickle (schema gap 1) — population-scaled, not building-gated
  const totalPop = ownedProvinceEconomies.length; // placeholder — real impl sums actual ProvinceState.population, see note below
  gained["money"] = (gained["money"] ?? 0) + totalPop * MONEY_TRICKLE_PER_POPULATION;
  for (const [resType, amount] of Object.entries(gained)) {
    nation.resources.set(resType, (nation.resources.get(resType) ?? 0) + amount);
  }
  return gained; // for RESOURCE_UPDATES broadcast net-rate display
}
```
**Note on the money trickle's population sum:** `tickExtraction` as sketched only has
`ProvinceEconomyData` in scope, which does not carry `population` (that lives on
`ProvinceState`). Pass the actual owned `ProvinceState[]` alongside `ownedProvinceEconomies`
(or a pre-summed `totalPopulation: number`) rather than approximating with province *count* —
fix this before implementing, the sketch above is illustrative only, do not ship a
population-*count*-based trickle when the design intent is population-*sum*-based.

### 3c. Wire into `gameTick()`, broadcast `RESOURCE_UPDATES`

```typescript
// in gameTick(), new block after economyBuildingSystem.tick(...):
for (const [nationId, nation] of this.state.nations) {
  const ownedProvinceIds = [...this.state.provinces.values()].filter(p => p.owner_id === nationId).map(p => p.province_id);
  const ownedEconomies = ownedProvinceIds.map(pid => this.economyBuildingSystem.get(pid)).filter((e): e is ProvinceEconomyData => !!e);
  const gained = this.resourceEconomySystem.tickExtraction(nation, ownedEconomies, (resType) => 1.0 /* Step 10 wires real curve */);
  this.broadcastToNation("RESOURCE_UPDATES", { resources: Object.fromEntries(nation.resources), net_rates: gained }, nationId);
}
```
**Broadcast filtered per-nation, not global** — a nation's resource stockpile is private, same
reasoning `broadcastFilteredAirWingUpdates`/`broadcastToNation` already exist for elsewhere in
this codebase. Locate `broadcastToNation`'s exact signature before using it (used already for
`RADAR_UPDATED` at line ~736 per Branch A's Critical Pre-Read grep — confirm the parameter
order matches).

**Manual verification:** none yet — Step 11 wires the panel to show these numbers with rates.

---

## Step 4: Oil

### 4a. `oil_consumption_table.ts`

```typescript
export const OIL_CONSUMING_TYPES = new Set([
  "motorised_infantry", "mechanised_infantry",
  "light_tank", "medium_tank", "heavy_tank", "armoured_car",
  // + every naval unit type, every air unit type (air wings are a SEPARATE schema —
  //   AirWingState, not DivisionState.grid — apply the oil debuff to air wings' readiness
  //   separately, see 4d)
]);
```
**Verify this list against the actual `unit_type` strings used in `unit_combat_stats.ts`
and template-builder unit lists before finalizing** — do not guess string spelling
(`"medium_tank"` vs `"tank_medium"` etc.), grep for the real enum values.

### 4b. Tests first

```typescript
describe("lane:economy | Oil mechanic", () => {
  it("100-50% demand met: negligible-to-minor speed penalty on oil-consuming units only", () => {});
  it("50-20% demand met: steeper penalty", () => {});
  it("<20% demand met: severe but never a hard stop — speed never reaches zero", () => {});
  it("standard infantry (non-oil-consuming) unaffected regardless of national oil stock", () => {});
  it("military priority toggle: civilian construction-speed penalty applies before military speed penalty under scarcity", () => {});
  it("economy priority toggle: military speed penalty applies before civilian construction-speed penalty", () => {});
  it("balanced (default) toggle: both degrade together, proportionally", () => {});
});
```

### 4c. Implement

```typescript
export type OilPriority = "military" | "balanced" | "economy";

const OIL_DEMAND_TIERS: Array<[number, number]> = [ // [demand_met_floor, max_speed_penalty_pct]
  [0.50, 0.05],  // 100-50%: negligible-to-minor
  [0.20, 0.25],  // 50-20%: steepens
  [0.00, 0.60],  // <20%: severe, never 1.0 (never a hard stop)
]; // TBD playtesting — placeholder curve, shape confirmed (soft, monotonic, never reaches 100%) not exact numbers

export function oilSpeedMultiplier(demandMetRatio: number): number {
  for (const [floor, maxPenalty] of OIL_DEMAND_TIERS) {
    if (demandMetRatio >= floor) {
      // linear interpolation within the tier band, not a step function — avoids a visible
      // "cliff" exactly at 50%/20% boundaries, consistent with "soft, not a cliff" design intent
      return 1.0 - maxPenalty; // simplified — implement proper interpolation between tier boundaries, not a flat per-tier value
    }
  }
  return 1.0 - OIL_DEMAND_TIERS[OIL_DEMAND_TIERS.length - 1][1];
}

export function computeOilDemandMet(nation: NationState, totalOilDemand: number): number {
  if (totalOilDemand <= 0) return 1.0; // zero-demand edge case reads as fully met, not a deficit — same principle as Reserve severity bands elsewhere in this design
  const available = nation.resources.get("oil") ?? 0;
  return Math.min(1.0, available / totalOilDemand);
}
```
**Priority toggle implementation:** store `oil_priority: OilPriority` on `NationState` (add
this field in Step 4's schema edit, not Branch A — it belongs conceptually with this
mechanic). Under `military`, apply `oilSpeedMultiplier` scaled at, say, 50% strength to
military units and 150% strength to `constructionMultiplier` (Branch A's stub, now wired for
real per Step 10) — under `economy`, invert those weights — under `balanced`, both at 100%
strength. Exact weighting is a placeholder, but the *direction* (military priority protects
military speed at civilian construction's expense, and vice versa) is the load-bearing,
testable behavior.

New handler: `SET_OIL_PRIORITY` in `GameRoom.ts`, same ownership-guard shape as
`BUILD_BUILDING` (nation-scoped, not province-scoped — no province lookup needed, just
`nation.oil_priority = msg.priority`).

### 4d. HP-recovery degradation — documented no-op

```typescript
// Stored for Phase 7's future healing tick to read — computing it now costs nothing and
// avoids Phase 7 needing to invent this formula later, but nothing currently consumes it.
div.oil_recovery_penalty = 1.0 - oilSpeedMultiplier(demandMetRatio); // NEW field on DivisionState — see note below
```
**New `DivisionState` field:** `@type("number") oil_recovery_penalty: number = 0;` — cheap,
real Colyseus field (unlike the province economy data, this is a small per-division scalar
worth syncing live, same tier as `hp`/`suppression`). Document in the field's comment exactly
why it exists but currently does nothing: `// consumed by Phase 7's future HP-recovery tick;
no-op until then — supply_system.ts has no healing code yet`.

### 4e. Air wings — apply the same debuff to `AirWingState`

Air wings are their own schema (`AirWingState`), not part of `DivisionState.grid`. Apply
`oilSpeedMultiplier` to air wing transit speed the same way, by hooking into wherever
`air_dubins_pathfinder.ts` currently computes speed (locate the exact speed-source before
implementing — do not guess). **Scope boundary:** only the speed effect, not readiness decay
— readiness recovery for air wings already exists (Phase 12's `AirWingLifecycleSystem`, unlike
land divisions) but modifying that existing, working system is out of scope for this branch;
flag it as a follow-up rather than touching Phase 12 code as a side effect here.

**Manual verification (required):** bot-script a nation's oil stockpile to zero, observe (via
Godot client) an oil-consuming division (e.g. a division with medium tanks in its template)
visibly move slower than an oil-independent division (standard infantry) under the same move
order. Toggle oil priority to Military, confirm the same starved division moves noticeably
faster than under Economy priority at the same stock level (the toggle's effect must be
visible, not just internally computed).

---

## Step 5: Rubber / Nitrates — combat-round attrition

### 5a. Tests first

```typescript
describe("lane:economy | Rubber and Nitrate combat attrition", () => {
  it("rubber depletes each combat round proportional to engaged vehicle-type cell count", () => {});
  it("nitrates depletes each combat round proportional to engaged infantry/artillery-type cell count", () => {});
  it("a division with zero vehicle-type cells does not drain rubber even while engaged", () => {});
  it("rubber shortage sets a recovery-penalty flag on vehicle-type cells only, non-vehicle cells in the same division unaffected", () => {});
});
```

### 5b. Implement — hook into `combat_system.ts`'s existing round-resolution loop

Locate the exact per-round resolution function in `combat_system.ts` (it already runs once
per combat round per `TACTICAL_COMBAT.md`'s round system — find the function that iterates
`div.grid.cells` during an active engagement, likely the same one `_armorPenMultiplier` is
called from). Add a call at the end of round resolution:
```typescript
resourceEconomySystem.drainCombatAttrition(engagedDivisions, this.state.nations, (type, msg) => this.broadcast(type, msg));
```
```typescript
const RUBBER_DRAIN_PER_VEHICLE_CELL = 0.5; // TBD playtesting
const NITRATE_DRAIN_PER_INFANTRY_ARTY_CELL = 0.3; // TBD playtesting

export function drainCombatAttrition(engagedDivisions: DivisionState[], nations: MapSchema<NationState>, broadcast: BroadcastFn): void {
  const drainByNation = new Map<string, { rubber: number; nitrates: number }>();
  for (const div of engagedDivisions) {
    let rubberCells = 0, nitrateCells = 0;
    for (const cell of div.grid.cells) {
      if (cell.hp <= 0 || cell.incapacitated) continue;
      if (VEHICLE_TYPES.has(cell.unit_type)) rubberCells++;
      if (INFANTRY_ARTILLERY_TYPES.has(cell.unit_type)) nitrateCells++;
    }
    const drain = drainByNation.get(div.nation_id) ?? { rubber: 0, nitrates: 0 };
    drain.rubber   += rubberCells * RUBBER_DRAIN_PER_VEHICLE_CELL;
    drain.nitrates += nitrateCells * NITRATE_DRAIN_PER_INFANTRY_ARTY_CELL;
    drainByNation.set(div.nation_id, drain);
  }
  for (const [nationId, drain] of drainByNation) {
    const nation = nations.get(nationId);
    if (!nation) continue;
    nation.resources.set("rubber",   Math.max(0, (nation.resources.get("rubber")   ?? 0) - drain.rubber));
    nation.resources.set("nitrates", Math.max(0, (nation.resources.get("nitrates") ?? 0) - drain.nitrates));
  }
}
```
**`VEHICLE_TYPES`/`INFANTRY_ARTILLERY_TYPES` sets:** define alongside `OIL_CONSUMING_TYPES` in
`oil_consumption_table.ts` (rename the file or split into a more general
`unit_resource_tags.ts` if it grows past oil alone — reasonable to do given this step adds two
more tag sets to the same concept). **Excluded from combat-attrition drain:** `incapacitated`
cells (already out of the fight) — verify this against `TACTICAL_COMBAT.md`'s Incapacitated
state rules (incapacitated units "deal zero damage and zero suppression — completely out of
the fight") before assuming they still contribute wear.

**Vehicle build-cost depletion (the other documented half of Rubber's mechanic) is explicitly
Branch C's job** — do not attempt to implement it here; there is no per-unit production
system to deduct from yet.

**Manual verification (required):** run a bot-scripted engagement between two tank-heavy
divisions, watch national rubber stockpile visibly decrease round over round in the Economy
panel while the fight continues, independent of any new production.

---

## Step 6: Tungsten

### 6a. Tests first

```typescript
describe("lane:economy | Tungsten availability shifts pen table row", () => {
  it("full tungsten access: AT/tank-gun units resolve at unmodified pen value (top tier)", () => {});
  it("zero tungsten: same units resolve at a meaningfully lower effective pen value, still fully functional (never zero damage purely from tungsten scarcity)", () => {});
  it("tungsten scarcity applies identically to production and combat — no separate 'can't build' check exists for tungsten (only chromium/aluminium hard-gate)", () => {});
});
```

### 6b. Implement

```typescript
const TUNGSTEN_FULL_ACCESS_THRESHOLD = 50; // TBD playtesting — abundance/stock level counted as "full access"
const TUNGSTEN_PEN_FLOOR_MULT = 0.6;       // TBD playtesting — worst-case pen multiplier at zero tungsten

export function tungstenPenMultiplier(nationTungstenStock: number): number {
  const ratio = Math.min(1.0, nationTungstenStock / TUNGSTEN_FULL_ACCESS_THRESHOLD);
  return TUNGSTEN_PEN_FLOOR_MULT + ratio * (1.0 - TUNGSTEN_PEN_FLOOR_MULT);
}
```
In `combat_system.ts`, wherever `_armorPenMultiplier(pen, armour)` is currently called with
`pen` sourced straight from `UNIT_COMBAT_STATS`, change the call site to:
```typescript
const effectivePen = pen * tungstenPenMultiplier(attackerNation.resources.get("tungsten") ?? 0);
const mult = _armorPenMultiplier(effectivePen, armour);
```
**Only applies to units whose `pen` stat is nonzero** (AT infantry, AT guns, tank main guns) —
verify this is naturally already the case (a `pen = 0` unit's `effectivePen` stays `0`
regardless of the multiplier, so no separate type-check is needed — confirm this is actually
true by reading `UNIT_COMBAT_STATS` before assuming it, since a multiplier bug could
accidentally give a `pen = 0` unit a nonzero result only if the formula adds rather than
multiplies).

**This mechanic has zero cross-phase or cross-branch dependency — implement it fully, it is
the cleanest one in this branch.**

**Manual verification (required):** bot-script a nation to zero tungsten, engage its
AT-infantry-equipped division against an armoured target, confirm damage is reduced but
nonzero versus the same engagement at full tungsten stock.

---

## Step 7: Chromium — threshold flag only, hard-gates stubbed

### 7a. Add `chromium_gated: boolean` to `unit_combat_stats.ts`

Mark `heavy_tank` and any other explicitly "premium tier" unit type (per
`RESOURCE_ECONOMY.md`: "premium tier within each unit class — heavy tank tier, battleship
belt-armour tier, and equivalents") `true`; every other type `false`. **Verify the actual set
of premium-tier unit type strings against `TACTICAL_COMBAT.md`/the template builder's unit
list before finalizing** — do not guess beyond heavy_tank.

### 7b. Tests first

```typescript
describe("lane:economy | Chromium threshold flag", () => {
  it("chromium_available flag is true above CHROMIUM_THRESHOLD, false at or below it", () => {});
  it("flag is broadcast to the owning nation via RESOURCE_UPDATES or a dedicated event when it changes state", () => {});
});
describe("lane:economy | Chromium hard-gates — explicitly deferred, not implemented", () => {
  it.skip("below threshold, chromium-gated units cannot be built — deferred to Branch C, no production system exists yet", () => {});
  it.skip("chromium-gated units in the field stop drawing supply when flow is interrupted — deferred to Phase 7 integration, no supply system exists yet", () => {});
});
```
**The two `it.skip` tests above are intentional and must stay in the file** — they document
the deferred scope precisely, as a marker for whichever branch/phase eventually implements
them, rather than leaving the gap undocumented.

### 7c. Implement only the threshold computation

```typescript
const CHROMIUM_THRESHOLD = 20; // TBD playtesting

export function isChromiumAvailable(nationChromiumStock: number): boolean {
  return nationChromiumStock > CHROMIUM_THRESHOLD;
}
```
Compute this per-nation each tick alongside the resource extraction tick (Step 3), include it
in the same `RESOURCE_UPDATES` broadcast payload as a `chromium_available: boolean` field —
**do not gate anything with it in this branch.** Leave a code comment at the computation site:
`// TODO Branch C: block production of chromium_gated=true unit types when this is false. TODO
Phase 7 integration: cut supply draw to chromium_gated=true cells when this is false.`

**Manual verification:** none meaningful yet — nothing observable changes based on this flag
until Branch C consumes it. Confirm only that the flag itself appears correctly in a
`RESOURCE_UPDATES` payload inspection (dev tools / test assertion), not a visual check.

---

## Step 8: Aluminium and Uranium — documented stubs

### 8a. Aluminium

Exactly per `DEV_PHASES.md`'s own Phase 9 section (quoted in this branch's Context table):
add `@type("boolean") aluminium_air_doctrine_flag: boolean = false;` to `NationState` (always
false, no code anywhere sets it true in this phase), and a ceiling-check function that's a
no-op while the flag is false:
```typescript
export function aluminiumSupplyCeiling(flagEnabled: boolean, tier: number): number {
  if (!flagEnabled) return Infinity; // no ceiling — nation hasn't "unlocked" the mechanic yet
  return ALUMINIUM_CEILING_BY_TIER[tier] ?? Infinity;
}
```
Test: `it("ceiling is unlimited while the placeholder flag is false, for every nation, always, in this phase", ...)`.
**Do not build any UI, any air-unit-supply-draw-block, or any tier-derivation logic for this
in Branch B** — the flag existing and defaulting false, with the ceiling function documented
as inert, is the entire scope here.

### 8b. Uranium

Extraction/stockpile already covered by Step 3's generic extraction tick (`uranium_mine`
building type). The research-currency injection use case is stubbed:
```typescript
// TODO: General Technology panel / research-currency system has no owning doc/section yet
// (unit_production_handoff.md open question #3). Uranium's injection use case cannot be
// implemented until that system exists. Stockpile accumulation works today; the "spend it on
// a tech node for a research-currency boost" behavior does not exist anywhere yet.
```
No code to write here beyond the comment and confirming Step 3's generic extraction already
covers uranium correctly (it should, without any special-casing — write one test confirming
uranium accumulates via the same generic path as iron/grain, no separate code path needed).

**Manual verification:** none for either resource beyond confirming their stockpile numbers
tick up in the Economy panel via Step 3/11's general mechanism.

---

## Step 9: Civilian and resource-extraction building base effects

Nine buildings' single documented base effect, no perks. Each gets its own small
sub-implementation; group the TDD tests into one describe block per building to keep this
file navigable.

**School** — science output scaling with level. No science/research-points system exists yet
in this codebase (research panel is stubbed per Phase 5's placement, actual research-currency
mechanics are out of scope for this phase per the same General Technology gap noted in Step
8b). Implement as: `nation.science_points` — **new field, add to `NationState`** — accumulates
per tick from owned Schools' levels, same generic-tick pattern as Step 3's resource
extraction, but note in a comment that nothing currently *spends* `science_points` (no
research-tree consumption exists yet) — this is intentionally a stockpile with no sink yet,
consistent with how Uranium's currency-injection has no destination yet either.

**Hospital** — pooled national casualty reduction with hard diminishing returns. Implement as
a national `hp_damage_received_multiplier` (< 1.0 = less damage taken), computed from the sum
of owned Hospital levels via a saturating curve (`1 - k / (k + total_hospital_level)` shape,
`k` a TBD-playtesting constant controlling how fast it saturates — **must never approach 0**,
clamp the multiplier's floor at e.g. `0.5`, matching `ECONOMY_BUILDINGS.md`'s explicit
"asymptotically approaching a cap well short of making any unit unkillable" non-negotiable
constraint). Apply this multiplier in `combat_system.ts`'s HP-damage-application step,
sourced from the *defending* division's owning nation. Test: two nations, one with five
Hospitals and one with zero, take the same raw incoming damage in an identical engagement —
confirm the five-Hospital nation's units take measurably less HP damage, and confirm the
multiplier does not fall below the clamp floor even with an unrealistically large number of
Hospitals in the test.

**Infrastructure** (after resolving schema gap 2) — base effect raises
`ProvinceState.infrastructure` by a level-scaled flat bonus each tick (feeding into Branch
A's `baseConstructionRate()` and any existing movement-speed reader of that scalar — do not
re-derive movement speed logic here, it already exists and already reads this scalar).

**Warehouse** — raises the resource storage ceiling. **New field on `NationState`:**
`@type({ map: "number" }) resource_storage_cap = new MapSchema<number>();` (or a single
`resource_storage_cap: number` shared across all ten resources if a simpler shared-cap model
is preferred — `ECONOMY_BUILDINGS.md` doesn't explicitly say per-resource vs. shared cap;
**default to per-resource, matching the Economy panel's per-row bar-fill mockup in
`plans/economy_production_ui_handoff.md` §4 Tab 1**, which shows each resource with its own
independent bar-fill against a cap). Clamp `nation.resources.set(...)` in Step 3's extraction
tick against this cap — resources overflowing the cap are simply not added (not converted to
money, that's a documented *perk*, Path A T3, deferred). **Reserve-stock capping is explicitly
Branch C's job** — this branch only caps the ten tradeable resources.

**Shipyard** — convoy capacity number, tracked (`nation.convoy_capacity: number`, new field),
computed from owned Shipyards' levels **only in provinces with `has_port == true`** (per
`ECONOMY_BUILDINGS.md`: "Requires a port in the same province" — `ProvinceState` doesn't
currently have a `has_port` field either; verify and add if missing, following the same
pattern as `vp_value`'s schema gap 3, since `has_port` is confirmed present in `map_data.json`
per the earlier map-pipeline research but its presence on the live `ProvinceState` schema
was not independently verified — check before assuming). **Nothing consumes convoy capacity
in this branch** — Branch D's trade routes are the consumer; this branch only produces and
displays the number.

**Town Hall** — after resolving schema gap 3 (`vp_value` now real), apply a level-scaled
multiplier to the existing `vp_value` field's *effective* contribution. **No scoring system
currently reads `vp_value` at all** (confirmed — it was entirely dead before this branch);
implementing Town Hall's multiplier means computing `effective_vp_value = province.vp_value *
(1 + townHallLevel * TOWN_HALL_VP_MULT_PER_LEVEL)` and storing/broadcasting it, but **do not
build an end-of-session scoring system as a side effect of this step** — that's out of scope
for Phase 9 entirely (scoring is presumably a later, separate system). Just make the
multiplied value computable and visible (e.g. surfaced in Province Detail), not consumed by
anything yet.

**Iron Mine, Grain Farm, Oil Derrick, Rubber Plantation, Nitrate Works, Tungsten Mine,
Chromium Mine, Bauxite Mine+Refinery, Uranium Mine** — already fully covered by Steps 3-8's
extraction ticks reading `EXTRACTION_STATS` per building level; no additional work needed
here beyond what those steps already implement. **Exception — Rubber Plantation's ramp-up
mechanic** (`ECONOMY_BUILDINGS.md`: "a newly built plantation takes longer than other
extraction buildings to reach its full base-tier output"): add a `ramp_progress: number`
field to the relevant `ConstructionProjectData`-adjacent tracking (or a new small
per-building-instance state, since this isn't a construction project but a post-construction
ramp) — a plantation at level ≥1 produces `base_output × min(1.0, ticks_since_completion /
RAMP_TICKS)` instead of full output immediately. **Exception — Bauxite Mine+Refinery's
two-stage chain:** implement as two separate extraction entries in `EXTRACTION_STATS`
(`bauxite_mine` producing an intermediate `bauxite` value, `bauxite_refinery` converting
`bauxite` stock into `aluminium` stock at a conversion ratio) rather than one combined entry
— `ECONOMY_BUILDINGS.md` is explicit both stages scale independently. **`bauxite` itself is
not one of the ten tradeable resources** — it's an internal intermediate value, track it as a
non-tradeable field on `NationState` (e.g. `bauxite_stock: number`), not inside the
`resources` MapSchema (which should stay exactly the ten tradeable types).

---

## Step 10: National Industry Pool

### 10a. Tests first

```typescript
describe("lane:economy | Industry Pool allocation", () => {
  it("default new-nation allocation splits between money production and construction speed, per ECONOMY_BUILDINGS.md's documented default", () => {});
  it("diminishing returns: doubling allocation to a slice does not double that slice's output multiplier", () => {});
  it("100% allocation to one slice starves every other slice to their floor (never below 1.0x for extraction slices)", () => {});
  it("reallocation has a short cooldown, rejects a second SET_INDUSTRY_ALLOCATION within the cooldown window", () => {});
  it("SET_INDUSTRY_ALLOCATION rejects allocations that don't sum to 100 across all slices", () => {
    // or: silently normalizes — pick one behavior and test it explicitly, don't leave this ambiguous
  });
});
```

### 10b. Implement

```typescript
const INDUSTRY_DIMINISHING_K = 30; // TBD playtesting — saturation constant, per-slice independent curve
export function industrySliceMultiplier(allocationPct: number): number {
  // saturating curve: 0% allocation -> 1.0x (never a precondition), 100% -> asymptotic cap
  return 1.0 + (allocationPct / 100) * (INDUSTRY_DIMINISHING_K / (INDUSTRY_DIMINISHING_K + allocationPct));
}
```
`nation.industry_alloc` (`MapSchema<number>`, Branch A) keys: the ten resource types +
`"construction_speed"` + `"unit_production_speed"` (the latter stays inert until Branch C
exists to consume it — declare it, don't wire it here). New handler
`SET_INDUSTRY_ALLOCATION` with the same ownership-guard shape as `SET_OIL_PRIORITY`, plus a
cooldown timestamp check (`INDUSTRY_REALLOCATION_COOLDOWN_MS`, TBD playtesting, "near-instant"
per the design doc — a small value like `2000`ms is a reasonable placeholder).

**Wire the two previously-stubbed multipliers for real:**
- Step 3's `industryMultiplierByResource(resourceType)` callback: replace the `() => 1.0`
  placeholder with `industrySliceMultiplier(nation.industry_alloc.get(resourceType) ?? 0)`.
- Branch A's `gameTick()` construction multiplier stub
  (`const constructionMultiplier = 1.0; // TODO Branch B`): replace with
  `industrySliceMultiplier(nation.industry_alloc.get("construction_speed") ?? 0)` — **this
  needs to become per-nation, not global**, exactly the signature change Branch A's plan
  flagged in advance (`economyBuildingSystem.tick()`'s signature must change to accept a
  per-province-owner lookup function, not a single number — implement that change now).

**Manual verification (required):** open the Industry Pool tab (Step 11), drag the Oil slider
to a high value, confirm Oil Derrick output visibly rises in the Economy panel's Resources
tab on a visibly saturating (not linear) curve as you push the slider further — confirm
dragging Construction Speed similarly speeds up an in-progress building's completion ETA in
Province Detail.

---

## Step 11: Client — real Economy panel content, top bar, Province Detail resources block

### 11a. Economy panel Resources tab — real rates + bar-fill

Extend Branch A's plain-stockpile rows (`phase-9-task-a-foundation.md` Step 8) with:
net rate text (`+N/t`/`-N/t`, sourced from the `net_rates` field Step 3's `RESOURCE_UPDATES`
broadcast already includes), a bar-fill against `Warehouse`'s per-resource storage cap (Step
9), and an `!` marker on Oil specifically when `oil_recovery_penalty > 0` for at least one
national division (Step 4) — **not merely for low stock with no active penalty**, per
`plans/economy_production_ui_handoff.md` §2's explicit rule. Add the Manpower row
(`available / ceiling`, plain text, no bar-fill, per the same doc's explicit reasoning: not
tradeable, shouldn't imply market-buyable).

### 11b. New Industry tab

`TabBar`/`TabButtons` extended to two tabs (`Resources`, `Industry`), same structural pattern
as Branch A/Step 8a. Sliders per `plans/economy_production_ui_handoff.md` §4 Tab 2's ASCII
mockup — grouped Common/Restricted(nation has access)/National, live drag,
`CommandQueue.submit("SET_INDUSTRY_ALLOCATION", {...})` on release (not on every drag-frame —
respect the cooldown from Step 10, and don't spam the server mid-drag).

### 11c. Top bar

Locate the existing top bar scene/script (search `client/scenes/` / `client/src/ui/` for
whatever currently renders money/etc. at the top of the HUD — this wasn't covered in prior
research for this plan, **find it before assuming its file path**). Wire the always-4
(Money/Grain/Oil/Manpower per `plans/economy_production_ui_handoff.md` §2) plus the `[v N
more]` hover flyout showing every other resource **this nation has meaningful access to**
(nonzero `resource_deposits` somewhere in an owned province — a nation with zero aluminium
deposits anywhere never shows an aluminium row here, this is the top bar's own curation rule,
distinct from the Market's later "show all ten regardless" rule in Branch D).

### 11d. Province Detail — "RESOURCES PRODUCED HERE" block

In `province_detail_panel.gd` (Branch A), add the block above the buildings list, per
`plans/economy_production_ui_handoff.md` §3's mockup — **only shown if this province has at
least one resource-extraction building with output > 0**, omitted entirely otherwise (not an
empty placeholder). One row per active resource-extraction building: name, bar-fill, `base
X->Y` text showing base output vs. current (industry-multiplied) output.

**Manual verification (required, the branch's primary visual checkpoint):** open Economy
panel — Resources tab shows ten rows with real ticking `+N/t` rates and bar-fills; switch to
Industry tab, drag a slider, watch the corresponding resource's rate visibly respond over the
next few seconds. Open top bar hover flyout — confirm it only lists resources this nation
actually has deposits for. Open Province Detail on a province with an Iron Mine — confirm the
"RESOURCES PRODUCED HERE" block appears with a live bar; open it on a province with no
extraction buildings — confirm the block is entirely absent, not an empty box.

---

## Step 12: `test-lanes.json` / test chain

Add to the existing `economy` lane's `source_prefixes`: `src/data/resource_stats.ts`,
`src/data/oil_consumption_table.ts` (or its renamed superset), `src/systems/
resource_economy_system.ts`; add to `tests`: `test/9b-resource-economy.test.ts` (and any
split-out sibling files per this step's earlier note about not forcing one file past ~600
lines). Append to `package.json`'s test chain. Run `cd game-server && npm test` — full suite
green.

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| Some building produces money at base level | **Wrong** — `ECONOMY_BUILDINGS.md` gates money production behind Infrastructure's Trade Network *perk*; with perks deferred, this branch adds a documented population-scaled placeholder trickle instead |
| Industry allocation can push a resource's output below its zero-allocation baseline | **Wrong** — `industrySliceMultiplier` floors at `1.0`; industry is always upside, per the phase's core Design Philosophy #1, non-negotiable |
| Chromium's hard-gate (block production, cut supply) is implemented in this branch | **Wrong** — only the threshold *flag* is computed; both consumption points are explicitly deferred (Branch C, Phase 7) and marked with `it.skip` tests documenting the gap, not silently omitted |
| Oil/rubber/nitrate shortage visibly slows HP recovery in this branch | **Wrong** — no HP-recovery tick exists anywhere in this codebase yet (confirmed); the penalty value is computed and stored on `DivisionState` for Phase 7 to consume later, but nothing heals slower today because nothing heals at all today |
| Aluminium's ceiling should scale with something in this branch | **Wrong** — `DEV_PHASES.md` explicitly specifies a permanently-false placeholder flag for this phase; building any real scaling logic now contradicts the documented plan |
| Tungsten needs a production-block check like Chromium | **Wrong** — Tungsten is the *substitution* resource, explicitly never a hard block at any point (`RESOURCE_ECONOMY.md`), only a combat stat-table shift; do not add a build-gate for it |
| `vp_value` and `has_port` already exist on `ProvinceState` | **Wrong for `vp_value`, unverified for `has_port`** — `vp_value` is confirmed dead/absent from the live schema (pipeline-only); `has_port` needs verification before assuming it's already there |
| Reserve storage cap (Warehouse's other half) belongs in this branch | **Wrong** — Warehouse's *resource* storage cap is this branch's job; the *Reserve*-stock cap extension is explicitly Branch C's, since Reserve doesn't exist until then |
| The Industry Pool's `unit_production_speed` slice should be wired to something in this branch | **Wrong** — declared and allocatable, but stays inert until Branch C's `build_points` formula exists to consume it; wiring it now would have nothing to multiply |
