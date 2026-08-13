# Branch C — `feat/unit-production-reserve`

## Context

**Prerequisite: Branches A and B merged.** This branch assumes `NationState.reserve_pool`
and `industry_alloc` exist (Branch A schema, Branch B populates `industry_alloc` for real),
`isChromiumAvailable()` and the `chromium_available` broadcast flag exist (Branch B Step 7),
and the Economy panel / Production panel shells exist.

Implements `unit_production_handoff.md` in full — that document is the primary source for
this branch's mechanics (production model, Reserve, Marshalling, the auto-scheduler) and is
already fully worked out at the formula level; **this plan translates it into this specific
codebase's actual schema and hook points rather than re-deriving the mechanics from
scratch.** Read `unit_production_handoff.md` alongside this file — sections are cited by
number below instead of being re-quoted in full.

**No perk trees** — Tank Plant's and Aircraft Factory's Resilience path (bombing-disruption
mitigation) is out of scope this phase, same blanket cut as every other building's perk
layer. Only the Throughput base effect (`base_rate` scaling with level) is implemented for
all four production buildings.

**No naval production.** Per the phase overview's scope cut, the Production panel's Naval tab
stays exactly as Branch A left it (an empty placeholder label) — this branch does not touch
`naval_base_level`, does not create a Naval Reserve, does not implement ship construction.
`unit_production_handoff.md` §7.5 itself frames naval as "not a new building, no new design
needed" for the *mechanics*, but the *UI* work to surface it is explicitly deferred, per the
phase overview — do not build it as a side effect of this branch.

**Genuinely new gameplay surface, not just backend plumbing:** before this branch, there is no
way to create a new division mid-game at all — `DEV_PHASES.md` Phase 4 only spawns divisions
at game start from a fixed starting-positions config. `RAISE_DIVISION` (Step 4 below) is the
first "raise a division from a template mid-session" code path this codebase has ever had.

**Test-Driven Development is mandatory for every server step below.**

---

## Critical Pre-Read

### Demand-slot HP model — confirm before assuming

`GridCellState.hp` defaults to `100` (`GameRoomState.ts:7`), and no separate `max_hp`/
`full_hp` field exists anywhere in `unit_combat_stats.ts` or the grid schema. **Working
assumption for this branch: HP is already a normalized 0-100 value per cell, not a per-unit-
type absolute** — so "missing %" for a filled, fielded cell is simply `(100 -
cell.hp) / 100`, no lookup table needed. **Verify this assumption is actually true by
grepping for any code that treats `hp` as anything other than a 0-100 range (e.g. a
`max_hp`-style multiplier applied elsewhere in `combat_system.ts`) before implementing Step
2's priority ranking on top of it** — if unit types do carry different absolute HP pools
somewhere not yet surfaced in this plan's research, the ranking formula in
`unit_production_handoff.md` §6.2 needs a real `full_hp` divisor instead of the flat `100`
assumed below.

### `ASSIGN_TEMPLATE` — confirms templates are client-authored, not server-stored (`GameRoom.ts:140-176`)

```typescript
this.onMessage("ASSIGN_TEMPLATE", (_client, msg: {
  division_id: string; template_id: string;
  cells: Array<{ cell_index: number; unit_type: string }>;
}) => { /* ... */ });
```
The `cells` array **is** the template content, sent inline by the client every time — there
is no server-side template registry to look up. `RAISE_DIVISION` (Step 4) follows the
identical shape: the client sends the target composition directly, the server does not need
to resolve a `template_id` against any stored definition.

### `CREATE_WING` — ownership-guard shape, reused for `RAISE_DIVISION` (`GameRoom.ts:462-493`)

```typescript
const player = this.state.players.get(client.sessionId);
if (!player) return;
const nation = this.getNationForPlayer(player.userId);
if (!nation) return;
```
No province lookup needed for `RAISE_DIVISION` itself (raising is a national action, not
province-scoped) — but Marshalling's `MARSHALLING_RATE` fill and the auto-scheduler's
province-level production buildings very much are province-scoped; keep the two concerns
separate in the implementation.

### `AirWingState.count` — the fungible-HP-pool precedent (`AirWingState.ts:62-64`)

```typescript
// HP pool — count of operational aircraft in the wing
@type("number") count: number = 10;
```
`unit_production_handoff.md` §4.1 cites this exact field as the precedent for Reserve's
fungible model — "mirrors the already-built Air Wing model, where a wing already tracks
`count (doubles as HP pool)` rather than individual aircraft." `NationState.reserve_pool`
(`MapSchema<number>`, Branch A) is the same idea at the national-stockpile level instead of
per-wing.

### Server tick loop (`GameRoom.ts`, unchanged shape from Branches A/B)

`TICK_MS = 1000`, `gameTick()` at line 1473, systems instantiated as class properties and
called in sequence inside the `try` block with a `(type, msg) => this.broadcast(type, msg)`
callback. New system this branch: `private unitProductionSystem = new UnitProductionSystem();`,
`.tick()` call added after Branch B's resource-economy tick block.

### `DivisionState` — no deployment-lifecycle field exists yet

Current fields (`GameRoomState.ts:47-71`) track `combat_state` (`idle/engaged/retreating/
suppressed`) but nothing distinguishes "not yet on the map" from "on the map." This branch
adds `@type("string") deployment_state: string = "deployed";` (values: `"marshalling"` |
`"deployed"`) — **existing pre-spawned divisions from `spawnDivisions()` must explicitly set
this to `"deployed"`** (the schema default already covers this, but confirm `spawnDivisions()`
doesn't need an explicit assignment either way — it shouldn't, since `"deployed"` is the
default, but state this explicitly in the diff so a reviewer doesn't wonder why pre-existing
divisions weren't touched).

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/src/data/unit_production_stats.ts` | `build_points` per unit type, `produced_by` building-type mapping — per `unit_production_handoff.md` §11's `UnitTypeProductionData` sketch |
| `game-server/src/systems/unit_production_system.ts` | Marshalling state map, production-order tracking per building, the auto-scheduler, `tick()` |
| `game-server/test/9c-unit-production.test.ts` | All Branch C server tests |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/schema/GameRoomState.ts` | `DivisionState`: add `deployment_state`, `aggregate_hp_pct` (cached, for UI); confirm `reserve_pool` cap logic references `NationState` correctly |
| `game-server/src/data/building_stats.ts` | Add `base_rate_by_level` (5 values) for `barracks`, `tank_plant`, `ordnance_factory`, `aircraft_factory` |
| `game-server/src/rooms/GameRoom.ts` | New `unitProductionSystem` instance + `gameTick()` hookup; `RAISE_DIVISION`, `FORCE_DEPLOY`, `CANCEL_MARSHALLING` handlers; `spawnDivisions()` note (no change needed, confirm default) |
| `game-server/test-lanes.json` | `economy` lane: add `9c-unit-production.test.ts`, new source prefixes |
| `client/src/ui/hud/production_panel.gd` | Tab 1 (Templates: Fielded/Deploying counts), Tab 2 (Reserve bars) — replace Branch A's empty placeholders |
| `client/src/ui/hud/military_panel.gd` (Land tab) | New DEPLOYING section (aggregate HP%, missing units, Cancel/Force Deploy) above the existing deployed-division list |
| `client/src/core/game_state.gd` | New `marshalling_divisions: Dictionary`, `reserve: Dictionary`; `_apply_marshalling_updates()`, `_apply_reserve_updates()` |
| `client/src/core/event_bus.gd` | New `marshalling_updated`, `reserve_updated` signals |
| `client/src/systems/session/session_manager.gd` | New `match` arms |

---

## Step 1: `unit_production_stats.ts` and `building_stats.ts` production rates (TDD)

### 1a. Tests first

```typescript
describe("lane:economy | Unit production stats", () => {
  it("every unit_type producible by a template has a build_points entry", () => {
    // cross-check against whatever the template builder's known unit type list is —
    // locate that list (likely in a division-builder-related data file or the client's
    // nation_config-adjacent data) before writing this test; do not hardcode a guessed list
  });
  it("higher-tier units have higher build_points than their lower-tier counterpart (e.g. heavy_tank > light_tank)", () => {});
  it("produced_by correctly groups units per unit_production_handoff.md §7's taxonomy", () => {
    // barracks: standard/motorised infantry, MG, AT infantry, sniper, commando,
    //   flamethrower, recon infantry, cavalry
    // tank_plant: light/medium/heavy tank, armoured car, mechanised infantry
    // ordnance_factory: artillery, towed AT gun, AA gun
    // aircraft_factory: all air wing types (cross-reference AIR_UNIT_TYPES from
    //   game-server/src/rooms/schema/AirWingState.ts or wherever it's defined, do not
    //   redefine a second air unit type list that could drift from Phase 12's)
  });
});
```

### 1b. Implement

```typescript
export interface UnitProductionStats { build_points: number; produced_by: string; }
export const UNIT_PRODUCTION_STATS: Record<string, UnitProductionStats> = { /* ... */ };
export function getUnitProductionStats(unitType: string): UnitProductionStats { /* throw on unknown */ }
```
**Air unit types must reuse Phase 12's existing `AIR_UNIT_TYPES` constant, not redefine it** —
import from wherever it's already declared (`AirWingState.ts` per the phase-12 plan's own
Branch A summary: "`AIR_UNIT_TYPES` const (CAS_PLANE, DIVE_BOMBER, FIGHTER, NAVAL_BOMBER,
HEAVY_FIGHTER, STRATEGIC_BOMBER, TACTICAL_BOMBER, RECON_PLANE)"). Land unit type strings: cross-
check spelling against `unit_combat_stats.ts`'s actual keys (Branch B already flagged this
same verification need for its own unit-type sets — do not introduce a second inconsistent
spelling).

Extend `building_stats.ts`: add `base_rate_by_level: number[]` (5 values, TBD-playtesting
placeholder, monotonically increasing) to the four production building types' entries.

### 1c. Run — must PASS. No manual verification (pure data).

---

## Step 2: Priority ranking and the auto-scheduler (`unit_production_handoff.md` §6)

### 2a. Tests first

```typescript
describe("lane:economy | Auto-scheduler priority ranking (§6.2)", () => {
  it("priority(slot) = (100 - current_hp) / 100 for a fielded division's damaged cell", () => {});
  it("a fully-healthy cell (hp=100) has priority 0, never selected while any damaged slot exists", () => {});
  it("marshalling-template demand and fielded-resupply demand are pooled into one ranking, not two separate lists", () => {
    // a marshalling slot at 0% filled and a fielded cell at 40% missing both appear in the
    // same ranked list; the marshalling slot (100% missing) ranks higher
  });
});
describe("lane:economy | Cost-weighted type aggregation (§6.3)", () => {
  it("type_score(unit_type) = sum over open slots of that type: missing_pct x build_points", () => {});
  it("an idle Tank Plant with both light_tank and heavy_tank demand picks whichever has the higher aggregate type_score, not the higher raw slot count", () => {});
});
describe("lane:economy | Resource scarcity deprioritization (§6.4)", () => {
  it("a candidate type needing a scarce resource is deprioritized by a multiplier, not removed from consideration entirely", () => {});
  it("chromium_gated=true unit types are EXCLUDED entirely (hard filter, not a scarcity multiplier) when chromium_available is false", () => {
    // this is the Branch B TODO finally consumed — see Step 2c
  });
});
describe("lane:economy | Deploy-stream vs supply-stream split (§6.5)", () => {
  it("when Reserve is empty for a contested type and both a marshalling and a fielded division want it, fresh production splits 50/50 between the two streams", () => {});
  it("when Reserve covers both streams, there is no contention and the split does not activate", () => {});
});
```

### 2b. Implement — event-triggered ranking recompute, pull-only assignment (§6.1)

```typescript
export interface DemandSlot {
  slot_id: string;                 // `${division_id}:${cell_index}`
  division_id: string;
  cell_index: number;
  unit_type: string;
  missing_pct: number;             // 0.0 - 1.0
  stream: "marshalling" | "field_resupply";
}

export function rankDemand(marshallingSlots: DemandSlot[], fieldResupplySlots: DemandSlot[]): DemandSlot[] {
  return [...marshallingSlots, ...fieldResupplySlots].sort((a, b) => b.missing_pct - a.missing_pct);
}

export function scoreTypeForBuilding(
  buildingType: string, openSlots: DemandSlot[], chromiumAvailable: boolean,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const slot of openSlots) {
    const stats = getUnitProductionStats(slot.unit_type);
    if (stats.produced_by !== buildingType) continue;
    if (isChromiumGated(slot.unit_type) && !chromiumAvailable) continue; // hard filter, Step 2c
    const resourceMult = resourceScarcityMultiplier(slot.unit_type); // §6.4
    const score = slot.missing_pct * stats.build_points * resourceMult;
    scores.set(slot.unit_type, (scores.get(slot.unit_type) ?? 0) + score);
  }
  return scores;
}
```
**Event-triggered recompute, not per-tick full rescan:** `unit_production_handoff.md` §6.1 is
explicit this should recompute "on discrete triggering events only... not on a fixed poll."
Given this codebase's tick is already coarse (1 second), and the full province/division count
in this game is deliberately small (`STRATEGIC_COMBAT.md`: "roughly 5-15 divisions per
player"), **a full recompute every `gameTick()` is acceptable performance-wise and much
simpler to implement and test correctly than true event-triggered invalidation** — implement
it as a full recompute each tick, but structure the code so a future optimization pass could
swap in real event-triggering without changing the ranking/scoring functions themselves. Note
this deliberate simplification in a code comment; it is a legitimate engineering call for this
game's scale, not a corner cut that changes behavior.

### 2c. Chromium hard-gate — finally implemented (Branch B's TODO)

```typescript
export function isChromiumGated(unitType: string): boolean {
  return UNIT_COMBAT_STATS[unitType]?.chromium_gated ?? false; // field added in Branch B Step 7a
}
```
Consumed exactly where flagged in Branch B's Step 7c comment: in `scoreTypeForBuilding`
above, a `chromium_gated` type is filtered out of scoring entirely (not merely
deprioritized) when `isChromiumAvailable(nation.resources.get("chromium") ?? 0)` (Branch B
Step 7c) is false — matching `RESOURCE_ECONOMY.md`'s "cannot be built at all," a hard
exclusion, not a soft multiplier. Test explicitly that a chromium-starved nation's Tank Plant
building a mix of `medium_tank` (not gated) and `heavy_tank` (gated) demand only ever
produces `medium_tank` while starved, and resumes `heavy_tank` production the instant
`chromium_available` flips true — **no manual re-trigger needed, the recompute-every-tick
design from 2b means this self-corrects automatically next tick.**

### 2d. Pull assignment — idle buildings request an order

```typescript
export function assignIdleBuildings(
  idleBuildings: Array<{ province_id: string; building_type: string }>,
  demandByBuilding: Map<string, Map<string, number>>, // building_type -> unit_type -> score
): Array<{ province_id: string; building_type: string; unit_type: string }> {
  const assignments = [];
  for (const b of idleBuildings) {
    const scores = demandByBuilding.get(b.building_type);
    if (!scores || scores.size === 0) continue; // no demand — building stays idle, does not error
    const [bestType] = [...scores.entries()].sort((a, z) => z[1] - a[1])[0];
    assignments.push({ ...b, unit_type: bestType });
  }
  return assignments;
}
```
**Edge case — zero demand.** A building with no open compatible demand slots stays idle,
produces nothing, does not throw and does not default to an arbitrary unit type "just to stay
busy" — matches the Reserve severity system's own "zero demand reads as Neutral, never a
deficit" principle used elsewhere in this design.

---

## Step 3: Production tick — building → Reserve

### 3a. Tests first

```typescript
describe("lane:economy | Production building tick", () => {
  it("effective_build_rate = base_rate(level) x industry_pool_unit_production_speed_multiplier", () => {
    // finally consumes Branch B's declared-but-inert industry_alloc.get('unit_production_speed')
  });
  it("time_to_complete = unit.build_points / effective_build_rate — a heavy tank takes longer than a light tank at the same building level", () => {});
  it("on order completion, produced HP-equivalent is added to reserve_pool[unit_type], not directly to any division", () => {
    // this is the load-bearing "Reserve is the buffer" rule from unit_production_handoff.md §3.1/§4
  });
  it("Reserve storage cap (Warehouse extension) clamps reserve_pool — overflow production is wasted, not banked past the cap", () => {});
});
```

### 3b. Implement

```typescript
export function tickProduction(
  provinceEconomy: Map<string, ProvinceEconomyData>,
  provinceOwner: (provinceId: string) => NationState | undefined,
  productionOrders: Map<string, ProductionOrder>, // keyed by `${province_id}:${building_type}`, per §11's sketch
  broadcast: BroadcastFn,
): void {
  for (const [key, order] of productionOrders) {
    if (!order.current_order) continue;
    const nation = provinceOwner(order.province_id);
    if (!nation) continue;
    const level = provinceEconomy.get(order.province_id)?.buildings[order.building_type] ?? 0;
    const baseRate = getBuildingStats(order.building_type).base_rate_by_level[level - 1] ?? 0;
    const industryMult = nation.industry_alloc.get("unit_production_speed") ?? 0; // 0-100 raw alloc; convert via industrySliceMultiplier (Branch B, imported)
    const effectiveRate = baseRate * industrySliceMultiplier(industryMult);
    order.current_order.build_points_remaining -= effectiveRate;
    if (order.current_order.build_points_remaining <= 0) {
      const unitType = order.current_order.unit_type;
      const cap = getReserveCap(nation, unitType); // Warehouse extension, Step 6
      const current = nation.reserve_pool.get(unitType) ?? 0;
      nation.reserve_pool.set(unitType, Math.min(cap, current + 100)); // one unit's worth = 100 HP-equivalent
      order.current_order = null; // building goes idle, picked up by next assignIdleBuildings pass
      broadcast("RESERVE_UPDATES", { nation_id: nation.nation_id, reserve: Object.fromEntries(nation.reserve_pool) });
    }
  }
}
```
**`ProductionOrder` type** — lift directly from `unit_production_handoff.md` §11's sketch
(`province_id`, `building_type`, `current_order: { unit_type, build_points_remaining,
target_slot_id } | null`). **Note on `target_slot_id`:** the sketch includes it, but §6.3's
type-aggregation model means a building produces *a type*, not a specific pre-committed slot
— the produced HP-equivalent goes to the national Reserve pool, and *which* slot eventually
draws it is resolved separately in Step 4's delivery tick, not decided at production time.
**Treat `target_slot_id` as informational/unused in this implementation** (leave the field in
the interface for schema-sketch fidelity, but do not build logic that depends on it being
accurate — the actual draw happens via Step 4's independent delivery-channel logic against
whatever demand is highest-ranked *at the time Reserve has stock*, which may have changed
since the order was placed).

---

## Step 4: Marshalling and delivery — Reserve → demand slots

### 4a. Tests first

```typescript
describe("lane:economy | Marshalling fill (§5.1 Phase 1)", () => {
  it("fill_rate = MARSHALLING_RATE when reserve_pool has enough of the needed type", () => {});
  it("fill_rate = min(MARSHALLING_RATE, production_rate) when Reserve is empty for that type", () => {});
  it("MARSHALLING_RATE is a single flat national constant — same value regardless of province or building level", () => {});
});
describe("lane:economy | Early deployment (§5.2)", () => {
  it("aggregate_hp_pct = sum(current_hp across present slots) / sum(100 across ALL template-target slots), not headcount", () => {
    // the exact non-obvious edge case from the design doc: a 40%-by-slot-count template
    // whose filled slots are all full-HP can cross 50% before a 60%-by-slot-count template
    // whose filled slots are half-strength
  });
  it("FORCE_DEPLOY is rejected below 50% aggregate HP", () => {});
  it("FORCE_DEPLOY at exactly 50% succeeds (threshold is inclusive, not exclusive)", () => {});
  it("after FORCE_DEPLOY, remaining unfilled slots switch permanently to the field-supply channel, never revert to MARSHALLING_RATE even if the division retreats", () => {});
});
describe("lane:economy | Field-supply channel — simplified placeholder (Phase 7 absent)", () => {
  it("field_supply_line_capacity() returns a fixed simplified rate for now, documented as a placeholder", () => {
    // mirror the exact pattern phase-12-air-combat.md used for readiness recovery when
    // Phase 7 was absent: "Readiness recovery at home base uses a simplified rate, not the
    // full road-graph supply tick. Interface is designed for the future wire-up."
  });
});
describe("lane:economy | CANCEL_MARSHALLING", () => {
  it("cancelling returns whatever HP-equivalent was already allocated back to reserve_pool, origin-agnostic, non-destructive", () => {});
});
```

### 4b. Implement

```typescript
const MARSHALLING_RATE = 20; // TBD playtesting — flat national constant, HP-equivalent per tick

function fieldSupplyLineCapacity(_division: DivisionState): number {
  // SIMPLIFIED PLACEHOLDER — Phase 7 (Supply System) does not exist yet. Real implementation
  // needs the road-segment flow-rate model from STRATEGIC_COMBAT.md's Supply System, which
  // requires a working supply graph this codebase does not have. Returns a flat rate,
  // deliberately slower than MARSHALLING_RATE (per the design doc's "may be slower" framing
  // for the early-deployment tradeoff to be meaningful even in placeholder form).
  return MARSHALLING_RATE * 0.5; // TBD — placeholder, replace when Phase 7 lands
}

export function tickMarshalling(
  marshallingDivisions: Map<string, MarshallingData>,
  nations: MapSchema<NationState>,
  broadcast: BroadcastFn,
): void {
  for (const [divisionId, data] of marshallingDivisions) {
    const nation = nations.get(data.nation_id);
    if (!nation) continue;
    for (const slot of data.slots) {
      if (slot.current_hp >= 100) continue;
      const reserveAvail = nation.reserve_pool.get(slot.unit_type) ?? 0;
      const channelRate = data.deployed ? fieldSupplyLineCapacity(/* division */ null!) : MARSHALLING_RATE;
      const productionRate = 0; // not directly observable here — see note below
      const fillRate = reserveAvail > 0 ? channelRate : Math.min(channelRate, productionRate);
      const drawn = Math.min(fillRate, 100 - slot.current_hp, reserveAvail);
      slot.current_hp += drawn;
      nation.reserve_pool.set(slot.unit_type, reserveAvail - drawn);
    }
    const aggregate = data.slots.reduce((s, sl) => s + sl.current_hp, 0) / (data.slots.length * 100);
    // broadcast MARSHALLING_UPDATES with aggregate + per-slot state
  }
}
```
**Note on `productionRate` in the `fillRate` formula:** `unit_production_handoff.md`'s
`min(production_rate, delivery_channel_rate)` branch only matters when Reserve is *empty* —
at that point the real bottleneck is "how fast is a building currently producing this exact
type," which requires cross-referencing Step 3's live production orders for a matching
`unit_type`, not a constant. **Do not ship the `productionRate = 0` placeholder above as
final** — wire it to `productionOrders`' currently-in-progress rate for a matching
`current_order.unit_type` before merging; the sketch above marks exactly where that lookup
must go. Leaving it at `0` would make the whole formula collapse to "no fill at all whenever
Reserve is empty," which is wrong and would fail Step 4a's own tests.

**Deployment-state switch, once and permanently (§5.2):** `data.deployed` flips `true` on
`FORCE_DEPLOY` and never flips back — re-read `unit_production_handoff.md` §5.2's explicit
"Once deployed... permanently switches" rule before touching this, it's a one-way transition
even if the division later retreats or re-enters Marshalling-like states for any other reason
(none currently exist, but do not write code that could accidentally reset this flag).

### 4c. `RAISE_DIVISION`, `FORCE_DEPLOY`, `CANCEL_MARSHALLING` handlers

```typescript
this.onMessage("RAISE_DIVISION", (client, msg: { template_id: string; cells: Array<{ cell_index: number; unit_type: string }> }) => {
  const player = this.state.players.get(client.sessionId);
  if (!player) return;
  const nation = this.getNationForPlayer(player.userId);
  if (!nation) return;
  const div = new DivisionState();
  div.division_id = /* generate */;
  div.nation_id = nation.nation_id;
  div.template_id = msg.template_id;
  div.deployment_state = "marshalling";
  this.state.divisions.set(div.division_id, div);
  this.unitProductionSystem.startMarshalling(div.division_id, nation.nation_id, msg.cells);
  this.broadcast("DIVISION_UPDATES", { divisions: [this.serializeDivision(div)] }); // existing broadcast, division just won't render on-map client-side (see Step 8)
});

this.onMessage("FORCE_DEPLOY", (client, msg: { division_id: string }) => {
  // ownership guard, then: reject if aggregate_hp_pct < 0.5, else:
  //   div.deployment_state = "deployed"; populate div.grid.cells from currently-filled slots;
  //   position div at nearest friendly city (reuse whatever spawnDivisions() or REDEPLOY_WING-
  //   equivalent nearest-friendly-position logic already exists — do not write new geo logic);
  //   this.unitProductionSystem.markDeployed(msg.division_id);
});

this.onMessage("CANCEL_MARSHALLING", (client, msg: { division_id: string }) => {
  // ownership guard, then: return each slot's current_hp back to nation.reserve_pool,
  // delete the division entirely (this.state.divisions.delete + this.broadcast a removal event
  // — check whether a DIVISION_REMOVED-style event already exists from some other flow, e.g.
  // division destruction, and reuse its exact name/shape rather than inventing a new one)
});
```
**"Nearest friendly city" positioning for `FORCE_DEPLOY`:** do not write new geography code —
`REDEPLOY_WING` (Phase 12) already solves an equivalent "move this entity to a chosen
friendly base" problem; locate its position-resolution logic and reuse the same lookup
(`_provinceCityPositionLookup`, already used elsewhere in `GameRoom.ts` per Branch A's
Critical Pre-Read) rather than re-deriving nearest-province logic from scratch.

---

## Step 5: Four production buildings — no new mechanics, just building-type coverage

Barracks, Tank Plant, Ordnance Factory, Aircraft Factory need no bespoke logic beyond Steps
1-3 already being generic over `building_type` — confirm this with one integration test per
building type rather than writing four separate implementations:

```typescript
describe("lane:economy | All four production buildings function through the generic pipeline", () => {
  it("Barracks produces infantry-category units with no second research path (Simple complexity — n/a this phase, no perks anywhere)", () => {});
  it("Tank Plant produces armour-category units including mechanised_infantry (gated behind armour research branch per TACTICAL_COMBAT.md — confirm this gate is enforced by whatever EXISTING research-check code governs template cell assignment, not something this branch needs to add)", () => {});
  it("Ordnance Factory produces artillery/AT-gun/AA-gun", () => {});
  it("Aircraft Factory produces air wing types — CREATE_WING (Phase 12) still exists as a separate, direct wing-creation path; confirm RAISE_DIVISION's land-division flow and Aircraft Factory's production do NOT attempt to also spawn a DivisionState for air units — air wings stay on AirWingState exclusively", () => {});
});
```
**Aircraft Factory is the one genuine cross-cutting integration risk in this step.** Air wings
are created via `CREATE_WING` (Phase 12, already working, creates an `AirWingState` directly,
no Marshalling concept). This branch's job for Aircraft Factory is only the *production* side
(building produces air-unit-type HP-equivalent into `reserve_pool`) — **it does not change
how wings are created.** Whether a produced air-unit-type Reserve stock is ever consumed by
`CREATE_WING` (e.g. requiring Reserve stock to exist before a wing can be created) is an
**open integration question this plan does not resolve** — `CREATE_WING`'s current guard only
checks province ownership, not Reserve stock. Flag this explicitly rather than silently
wiring a Reserve check into Phase 12's working, tested code as an incidental side effect of
this branch — if a Reserve-gate on `CREATE_WING` is wanted, that's a deliberate follow-up
decision, not something to slip in here.

---

## Step 6: Warehouse Reserve-cap extension

### 6a. Tests first

```typescript
describe("lane:economy | Warehouse Reserve storage cap", () => {
  it("getReserveCap scales with owned Warehouse levels, same shape as Branch B's resource storage cap", () => {});
  it("a nation with zero Warehouses has a nonzero baseline Reserve cap (never a hard zero — matches the phase's 'building is never a precondition for baseline function' guarantee)", () => {});
});
```

### 6b. Implement

```typescript
const RESERVE_CAP_BASELINE = 200; // TBD playtesting — never-zero floor
export function getReserveCap(nation: NationState, _unitType: string, warehouseLevelSum: number): number {
  return RESERVE_CAP_BASELINE + warehouseLevelSum * RESERVE_CAP_PER_WAREHOUSE_LEVEL; // TBD constant
}
```
Reuses the exact per-resource cap *shape* Branch B's Warehouse Step 9 already implemented for
the ten tradeable resources — **this is the "other half" of Warehouse's base effect** that
Branch B explicitly deferred here because Reserve didn't exist yet.

---

## Step 7: `test-lanes.json` / test chain

Add `source_prefixes`: `src/systems/unit_production_system.ts`, `src/data/
unit_production_stats.ts`; add `test/9c-unit-production.test.ts` to the `economy` lane's
`tests`. Append to `package.json`'s chain. `cd game-server && npm test` — full suite green.

---

## Step 8: Client — Production panel real content, Military panel DEPLOYING section

### 8a. `game_state.gd` / `event_bus.gd` / `session_manager.gd`

Follow Branch A's exact `_apply_*` + `EventBus` signal + `session_manager.gd match arm`
pattern (see `phase-9-task-a-foundation.md` Step 7 for the template) for:
`_apply_marshalling_updates(data)` (keyed by `division_id`, storing `aggregate_hp_pct`,
`missing_units: Array[{unit_type, count}]`, `deployed: bool`), `_apply_reserve_updates(data)`
(keyed by `unit_type`, storing `amount`).

**Marshalling divisions must NOT render on the strategic map.** `MilitarySystem`'s existing
division-icon spawn logic (wherever `DIVISION_UPDATES` currently triggers icon creation)
needs a guard: skip icon creation/update for any division whose `deployment_state ==
"marshalling"`. Locate that exact spawn/update site before implementing — do not guess the
function name.

### 8b. Production panel Tab 1 — Templates

Per `plans/economy_production_ui_handoff.md` §7 Tab 1's mockup: existing Division Templates
list (relocated from Military → Land per that doc — **confirm where the template list
currently lives client-side before moving it**, this branch is the first to actually need to
locate and relocate it, prior branches only referenced its target location) with **Fielded**
(count of `deployment_state == "deployed"` divisions using this `template_id`) and
**Deploying** (count of `deployment_state == "marshalling"`) columns added, computed
client-side from `GameState.divisions` (already-synced Colyseus schema, no new server work
needed for these counts — they're a client-side aggregation over existing data).

### 8c. Production panel Tab 2 — Reserve

Four fixed subheadings (Infantry/Ordnance/Tank/Air, mapping 1:1 to the four production
buildings) per `plans/economy_production_ui_handoff.md` §7 Tab 2's mockup — five-band
gradient bar (Red/Amber/Neutral/Green/Blue), center-anchored at zero net rate, per
`RESOURCE_ECONOMY.md`'s "Reserve status — deficit/excess severity" formula:
```
severity = (production_rate - consumption_rate) / reserve_cap_per_tick
```
**Zero-demand edge case (already tested server-side in Step 2's ranking, restated here for
UI):** a category with no current demand reads as Neutral with a distinct label (`— no
demand —`) per the UI handoff's explicit note, not the same "(balanced)" wording used for
genuinely-matched active demand.

```
+-----------------------------------------------------------------+
| INFANTRY              340 HP-eq              Prod 12/t             |
|  RED    AMBER   neutral   GREEN    BLUE                              |
|  |-------|-------|---▲----|--------|--------|   (balanced, tiny deficit)
+-----------------------------------------------------------------+
| TANK                   0 HP-eq               Prod 0/t                         |
|  |--▲----|-------|--------|--------|--------|   (— no demand —)
+-----------------------------------------------------------------+
```

### 8d. Military panel — DEPLOYING section

Per `plans/economy_production_ui_handoff.md` §8's mockup: one row per marshalling division
(aggregate HP%, missing units by type/count, `[Cancel]` always enabled, `[Force Deploy]`
disabled below 50%/enabled at ≥50% exactly). Empty state ("No divisions currently
marshalling. Raise one from the Production panel.") when none exist, per that doc's explicit
empty-state text. `[Cancel]` submits `CANCEL_MARSHALLING`, `[Force Deploy]` submits
`FORCE_DEPLOY`, both via `CommandQueue.submit(...)` (Branch A's already-established pattern).

**Manual verification (required, the branch's primary visual checkpoint):** open Production
panel Templates tab, raise a division from an existing template (need a `[+]`/raise entry
point wired to `RAISE_DIVISION` — confirm one exists in the Templates tab per the UI handoff's
`[+]` icon at §7 Tab 1, wire it) — confirm it does **not** appear on the strategic map, confirm
it appears in Military panel's DEPLOYING section with a climbing aggregate HP% as Reserve
(seeded via a bot-scripted stockpile, or from Barracks actually producing over real time —
either is an acceptable verification path) fills its slots. At ≥50%, confirm `[Force Deploy]`
becomes clickable; click it — division now appears on the map at a friendly city, Military
panel moves it from DEPLOYING to DEPLOYED. Separately, raise a second division and click
`[Cancel]` before it fills — confirm Reserve numbers in Production panel Tab 2 tick back up
by whatever had already been allocated.

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| A produced unit attaches directly to the division that requested it | **Wrong** — production always flows into the national `reserve_pool` first; delivery to a specific demand slot is a separate tick (§4), decoupled from production (§3) |
| `target_slot_id` in `ProductionOrder` should be used to route output to a specific division | **Wrong** — per §6.3's type-aggregation model, a building commits to producing *a type*, not a pre-reserved slot; treat `target_slot_id` as informational only in this implementation |
| Chromium-gated units should be deprioritized like a scarce-resource type (§6.4) | **Wrong** — chromium-gated types are a hard exclusion filter (RESOURCE_ECONOMY.md: "cannot be built at all" below threshold), not a scoring multiplier; do not conflate the two mechanisms |
| Marshalling divisions should render as dimmed/ghost icons on the map | **Wrong** — per Marshalling's design ("off-map, no dot, no position"), they must not render at all, not even a faded version |
| `FORCE_DEPLOY`'s field-supply fallback should be left unimplemented until Phase 7 | **Wrong** — a documented simplified placeholder rate is required now (mirroring Air's Phase-7-absence handling), specifically so the early-deployment tradeoff (fast guaranteed rate vs. potentially slower field rate) is actually observable in this branch's own verification gate, not silently inert |
| Once deployed, a division can somehow revert to `MARSHALLING_RATE` (e.g. on retreat) | **Wrong** — the Marshalling→field-supply switch is explicitly one-way and permanent per §5.2, regardless of any later combat state change |
| Aircraft Factory production should require Reserve stock before `CREATE_WING` can fire | **Unresolved, not decided by this plan** — flagged as an open integration question, not silently implemented either way |
| Cancelling a marshalling division wastes the resources already spent on it | **Wrong** — Reserve is origin-agnostic; cancellation returns already-allocated HP-equivalent stock back to `reserve_pool`, non-destructive, per `unit_production_handoff.md` §9's explicit framing |
