# Unit Production System — Implementation Handoff

**Status:** Design-complete on shape and rules. Numeric constants are explicitly
TBD (marked below) pending playtesting — do not invent values, use clearly-named
placeholders and surface them as tunable config.

**Not part of the project design docs.** This is a supplementary handoff written
for implementation purposes — it captures decisions made in design discussion
that the project docs (`ECONOMY_BUILDINGS.md`, `RESOURCE_ECONOMY.md`,
`TACTICAL_COMBAT.md`, `STRATEGIC_COMBAT.md`, `MAP_DATA_CONTRACT.md`,
`DATA_CONTRACTS.md`) do not yet reflect. Section 13 maps each piece back to
which project doc it extends, for whoever eventually updates those docs
properly.

---

## 1. System Overview

Players raise divisions from templates — that one-click action stays exactly
as simple as it already is. Underneath that action, unit creation happens at
the level of **individual units**, not as a single lump-sum division purchase.
Each unit is produced by a category-specific building, flows into a national
**Reserve**, and divisions (both newly-forming and already in the field) draw
from that Reserve to fill their grid slots. When Reserve can't cover demand,
fresh production becomes the bottleneck instead.

A national **auto-scheduler** decides what every idle production building
builds next, so a player who never opens the production panel still gets a
functional (if suboptimal) military — the same accessibility guarantee every
other system in this game already makes.

---

## 2. Terminology

| Term | Meaning |
|---|---|
| **Slot** | One cell in a division's 5×5 grid (or one line in a not-yet-deployed template). May be filled, partially filled (damaged), or empty. |
| **Reserve** | National, per-unit-type stockpile of produced-but-unassigned unit capacity. Land/air: fungible HP-pool per unit type. Naval: pool of discrete ship objects. |
| **Marshalling** | The pre-deployment phase of a newly-raised division: it exists off-map, filling from Reserve at a fixed national rate, before the player sends it to the front. |
| **Order** | A single production assignment given to one idle building: "build N build-points of unit type X." |
| **`build_points`** | Abstract time-cost of producing one unit of a given type. Distinct from the unit's resource-cost vector (money/iron/manpower/etc.). Higher-tier units cost more `build_points`. |
| **Missing %** | `(unit's full HP − unit's current HP) / unit's full HP`. The core priority signal, always relative, never absolute. |

---

## 3. Production Model

### 3.1 Division-raise vs. unit-level production (resolved: hybrid)

- Player-facing action: "raise this division template" — unchanged, one click.
- Internally: this creates a set of **demand slots** (one per template line),
  each independently fillable. It does **not** deduct a lump resource cost at
  raise time the way earlier drafts assumed — deduction now happens per-unit,
  as each slot is actually filled (see §3.2, §5).
- Every unit created, whether for a fresh template or as a resupply for a
  damaged fielded division, is tracked with individual identity from the
  moment of creation, so it can be returned to Reserve independently later
  (see §9 on why this matters and what it does *not* imply about experience).

### 3.2 `build_points` and production rate

```
effective_build_rate(building) = base_rate(building_type, building_level) × industry_pool_unit_speed_multiplier

time_to_complete(unit) = unit.build_points / effective_build_rate(assigned_building)
```

- `base_rate` scales with **building level only** — same "level scales
  magnitude, research adds perks" rule every other building in the game
  already follows. Not derived from research level.
- `industry_pool_unit_speed_multiplier` is the national Industry Pool's
  existing (currently-dormant) "unit production speed" slice — this finally
  gives it a real formula to act on.
- `build_points` is a **new field per unit type**, orthogonal to the existing
  resource-cost vector. Resource cost answers "what does this consume";
  `build_points` answers "how long does this take." Both apply — a unit
  build/resupply always draws down its resource-cost vector too (unchanged
  from the existing `(missing HP%) × build-cost vector` supply-draw formula).
- **TBD (playtesting):** exact `build_points` value per unit type/tier, exact
  `base_rate` per building level.

### 3.3 Three-axis responsibility split (already-consistent, now explicit)

| Axis | Governs | Mechanism |
|---|---|---|
| Research | Which tiers/variants are unlockable at all | Existing unit-tier/doctrine research trees (chromium gate, tungsten substitution, aluminium tech ceiling, armour branch, etc.) — unchanged |
| Building **type** | Which broad category is buildable at all | §7 taxonomy — need a Tank Plant to build any tank |
| Building **level** | How fast that category can be built | §3.2 formula |

These are orthogonal and don't need reconciling — each new production
building slots into an axis that already exists for every other building.

---

## 4. Reserve

### 4.1 Land / air — fungible HP-pool

Reserve for a land/air unit type is a single number: total HP-equivalent
banked, not a list of discrete unit objects. Producing 100 HP-equivalent of
Medium Tank and later needing 60 HP-equivalent for a template slot is just
subtraction — there's no "unit #4172" to track. This mirrors the already-built
Air Wing model, where a wing already tracks `count (doubles as HP pool)`
rather than individual aircraft.

### 4.2 Naval — discrete ship objects

Ships are **not** fungible. Naval Reserve is a pool of individual ship
objects, each with its own current HP (some full, some damaged, awaiting
repair). This matches the naval domain's existing design in full — see §7.5,
nothing new needed there, it already works this way.

### 4.3 Scope: national for deployment, spatial for field resupply

- **Marshalling draw** (filling a not-yet-deployed division): Reserve is
  treated as instantly available nationwide, wherever it was produced. This
  is a deliberate simplification (mirrors HOI4's national equipment
  stockpile), not a spatial simulation.
- **Field resupply draw** (topping up an already-deployed division): must
  travel the real supply graph (hub → road → division) regardless of where
  the Reserve stock originated. Spatially gated, using the existing flow-rate
  model from `STRATEGIC_COMBAT.md`'s Supply System.

### 4.4 Storage cap

Reserve stock is not unlimited. This is **not** a new building — it extends
Warehouse's existing "Bulk Storage" path (today scoped to the ten resources)
to also cap/buffer unit-type Reserve stock. No new building or path invented
for this.

---

## 5. Marshalling & Deployment

### 5.1 Two-phase fill model

**Phase 1 — Marshalling (off-map).**
```
if reserve[unit_type] >= demand:
    fill_rate = MARSHALLING_RATE                          # flat national constant
else:
    fill_rate = min(MARSHALLING_RATE, production_rate)    # bottlenecked by whichever is slower
```
`MARSHALLING_RATE` is a **single flat national constant** — not per-province,
not scaled by building level. Deliberately fast relative to normal field
supply. **TBD (playtesting):** exact value.

**Phase 2 — Field supply (on-map, after deployment).**
```
if reserve[unit_type] >= demand:
    fill_rate = field_supply_line_capacity(division)      # existing road-graph flow-rate model
else:
    fill_rate = min(field_supply_line_capacity(division), production_rate)
```
Identical mechanic to existing combat-damage healing — no new supply system,
just a new upstream source feeding into the one that already exists.

**Why `min()` and not `+` or `×`:** production and the delivery channel
(marshalling or field-supply) are sequential pipeline stages, not independent
contributions. A fast factory behind a slow channel is still slow; a fast
channel behind an empty factory is still empty. `min()` is the correct model
of a bottlenecked serial pipeline and is the same mental model
`STRATEGIC_COMBAT.md`'s road-segment flow rate already uses elsewhere.

### 5.2 Early deployment threshold

A player may manually deploy a marshalling division once it reaches **≥50%
aggregate HP**:

```
aggregate_hp_pct = sum(current_hp of present units) / sum(full_hp of all template-target units)
```

This is a whole-division percentage against total HP, **not** a headcount
threshold ("half the slots filled") and **not** computed per-slot. A template
that's 40% full by slot-count but whose filled slots are all full-HP units
could cross 50% before a template that's 60% full by slot-count but whose
units are mostly half-strength — HP is the only currency that matters here.

Deploying early trades the fast guaranteed `MARSHALLING_RATE` for whatever the
local front's actual field-supply infrastructure can support, which may be
slower — a real, legible strategic tradeoff, not just "the number goes up
faster or slower."

Once deployed, the division switches permanently to Phase 2 (field supply)
for any remaining fill, even if it's still below 100%.

---

## 6. Auto-Scheduling Algorithm

### 6.1 Architecture — pull-based, event-driven

Do **not** re-scan every building every tick. Instead:

- Maintain a single, continuously-updated **priority ranking** of open demand
  slots. Recompute this ranking on discrete triggering events only (new
  template queued, resource stock crosses a scarcity threshold, a unit takes
  combat damage, a building's order completes) — not on a fixed poll.
- When a building goes **idle** (its current order completes, or it has no
  order), it pulls the current top-ranked compatible demand off the ranking
  and starts an order for it.
- The building does not re-evaluate anything mid-order. It reports back and
  requests a new order only once its current order finishes.

This separation (cheap event-triggered recompute of *what's needed* vs.
pull-only assignment of *who builds it next*) keeps the system reactive
without ever touching buildings that are still busy.

### 6.2 Priority ranking — the core signal

Every open demand slot (whether in an already-fielded division needing
resupply, or in a marshalling template needing its first fill) is ranked by
**missing %**, descending:

```
priority(slot) = (slot.full_hp - slot.current_hp) / slot.full_hp
```

Pool fielded-division-resupply demand and marshalling-template demand
**together** into one ranking — do not maintain them as separate ranked
lists. This single relative signal already subsumes two things that might
otherwise need separate tracking:

- **Composition preference falls out for free.** A template wanting 80%
  medium tanks simply generates more medium-tank demand slots than
  heavy-tank slots — no separate "desired ratio" variable needs to be
  tracked.
- **Frontline urgency falls out for free.** A unit actively taking damage
  will always have higher missing-% than a healthy rear unit — no separate
  "is this the front" flag needed.

### 6.3 Choosing between unit types — cost-weighted aggregation

When an idle building can produce more than one type (e.g. Tank Plant
choosing between light/medium/heavy tank), aggregate demand per type using
**`build_points`-weighted missing-%**, not resource cost and not raw slot
count:

```
type_score(unit_type) = Σ over all open slots of that type: (slot.missing_pct × unit_type.build_points)
```

This reflects real production effort represented by each slot, consistent
with `build_points` being the actual scarce thing a building allocates (its
own tick-capacity), which is a different scarcity than money.

### 6.4 Resource scarcity — orthogonal deprioritization

Layered on top of §6.2/§6.3, **not** merged into the same score: if a
resource needed by a candidate unit type is running low, apply a
deprioritization multiplier to that type's score. This is a feasibility
concern, separate from urgency — a badly-needed unit that can't actually be
resourced right now shouldn't block a resourceable but less-urgent one
forever.

### 6.5 Deploy-stream vs. supply-stream split (two-layer model)

**This is a synthesis of two design statements that weren't explicitly
reconciled in discussion — flagged here as an interpretation, confirm before
relying on it.**

- **Layer 1 (stream split):** When Reserve is insufficient for a given unit
  type and *both* a marshalling division and a fielded division want it,
  available fresh production for that type splits **50/50 by default**
  between the Deployment stream and the Supply stream. Fixed constant at
  launch; player-adjustable weighting is an explicit post-launch/pre-release
  item, not v1 scope.
- **Layer 2 (within-stream ranking):** Within each stream, §6.2's missing-%
  ranking (and §6.3's cost-weighted type aggregation) decides which specific
  slot/type gets the next unit.
- This split only activates when Reserve is empty for the contested type. If
  Reserve can cover both streams, there's no contention and the split is
  moot.

### 6.6 Standing Reserve production (amendment, confirmed 2026-08-31)

**This section amends §6.1/§6.2's original framing.** The system as originally
drafted was pure demand-pull: an idle production building with no open
marshalling/resupply demand slot anywhere stays idle and produces nothing —
explicitly not even "an arbitrary unit type just to stay busy"
(`phase-9-task-c-unit-production-reserve.md`'s own zero-demand edge case), and
RESOURCE_ECONOMY.md's Reserve severity section treats zero production against
zero consumption as the expected, non-problematic Neutral steady state. On
review, this was confirmed **not** the intended design: Reserve existing as a
buffer only makes sense if buildings actually bank toward it in the
background, not only in direct reaction to an active raise or a fresh combat
loss.

**Confirmed behavior:** an idle production building generates a third,
synthetic demand stream — **Standing Reserve demand** — sized off the
nation's currently-*fielded* roster (real, deployed divisions only; a
division still in Marshalling does not count toward its own type's Standing
Reserve target, since it already generates real marshalling demand):

```
standing_target(unit_type) = fielded_count(unit_type) × STANDING_RESERVE_BUFFER_FRACTION × 100  // HP-equivalent
standing_missing_pct(unit_type) = clamp01((standing_target − reserve_pool[unit_type]) / standing_target)
```

This slots into §6.2's existing pooled ranking as a third `stream` value
(alongside `"marshalling"` and `"field_resupply"`) — same missing-%/
`build_points`-weighted aggregation (§6.2/§6.3), same chromium hard-gate and
§6.4 resource-scarcity deprioritization, no separate mechanism needed. It
naturally tapers to zero (no synthetic demand at all) once Reserve reaches
the buffer target for that type, so this is not an unbounded background
sink — a building stops treating it as demand the moment the buffer's full,
and resumes if the buffer later drains (combat losses, a marshalling draw,
or storage-cap overflow waste). A unit type nobody currently fields yet still
generates zero Standing Reserve demand — consistent with the
zero-demand-reads-as-neutral principle for a type that's never been fielded
at all.

**`STANDING_RESERVE_BUFFER_FRACTION`** — TBD playtesting, same
named-placeholder convention as `MARSHALLING_RATE`/`build_points`. Implemented
placeholder value: `0.5` (Reserve target = half of what's currently fielded,
per unit type).

**Interaction with RESOURCE_ECONOMY.md's severity bands:** with Standing
Reserve active, `production_rate > 0` while `consumption_rate == 0` is now a
normal, frequent state (a nation quietly topping up its buffer) — this reads
as a *surplus* band, not Neutral, which is the correct signal ("Reserve is
growing, nothing to worry about"). Neutral is reached once the buffer is
genuinely full and no marshalling/resupply demand exists either — the
zero-demand-reads-as-neutral principle still holds, just for a narrower
condition than before this amendment.

---

## 7. Building Taxonomy

Five production categories. Four are genuinely new buildings; the fifth
already exists under a different name and needs no new design.

### 7.1 Barracks

- **Produces:** standard infantry, motorised infantry, MG, AT infantry,
  sniper, commando, flamethrower, recon infantry, cavalry.
- **Existing role retained:** XP-training acceleration (already specified in
  `TACTICAL_COMBAT.md`) — this building now has two jobs, not a replaced one.
- **Complexity:** Simple. **Yield-only, no second path.** Light infantry
  production was never a concentrated historical bombing target the way heavy
  industry was — there's no honest "resilience" specialization to offer here.
  The historical "mass-production vs. quality" story (T-34 vs. Tiger) is a
  unit-design/doctrine question, already owned by research trees, not a
  building-perk question.

### 7.2 Tank Plant

- **Produces:** light/medium/heavy tank, armoured car, **mechanised
  infantry**. Mechanised infantry belongs here despite its name — it's gated
  behind the armour research branch (post-medium-tank tier) per
  `TACTICAL_COMBAT.md`, not the infantry branch.
- **Complexity:** Simple/Standard. **Two paths: Throughput + Resilience.**
  Tank production was one of the two genuine prime strategic-bombing targets
  of WW2 (Tiger/88mm production was set back months by Allied bombing) —
  Resilience (reduced disruption from province-level industry bombing) is a
  historically-grounded second lever, mirroring the existing
  Throughput/Resilience shape already used by the civilian Shipyard.
- **Implementation note:** the existing bombing model (`AIR_COMBAT.md`
  Strategic Bombing) hits the whole province's undifferentiated `industry`
  scalar — there is no per-building targeting in the current map schema
  (confirmed explicitly in `AIR_COMBAT.md`: no building has a position
  distinct from the city point). The Resilience path therefore can't protect
  "this building specifically" from a strike; it needs to reduce how much of
  the general province-wide industry-bombing effect applies to *this
  building's own output*. Needs careful implementation, not a simple flat
  damage-reduction stat.

### 7.3 Ordnance Factory

- **Produces:** artillery, towed AT gun, AA gun. This exact grouping already
  exists as a mechanical bucket in `TACTICAL_COMBAT.md`'s Incapacitation
  table (the "no incapacitation, crew-served" category) — not an invented
  taxonomy. Also matches Call of War's own "Ordnance" category naming.
- **Complexity:** Simple. **Yield-only**, same reasoning as Barracks.

### 7.4 Aircraft Factory

- **Produces:** all air wing types.
- **New building, distinct from the existing `airbase`.** `airbase` is an
  *operations* building (basing, refuel, readiness recovery —
  `AIR_COMBAT.md`'s Airbase Capacity section is entirely about operating
  congestion, never production). Nothing currently produces aircraft.
  Deliberately kept separate, mirroring how the naval domain already keeps
  Naval Base (production/repair) distinct from Port (trade) and Coastal
  Battery (defense) rather than merging roles.
- **Complexity:** Simple/Standard. **Two paths: Throughput + Resilience.**
  The German aircraft industry was Allied strategic bombing's primary target,
  provoking a dedicated dispersal response (the Jaegerstab reorganization) —
  same historical justification as Tank Plant. Same implementation caveat
  about undifferentiated province-level bombing applies.

### 7.5 Naval — not a new building

Naval production/repair is **already fully specified** as "naval base level,"
one of three independent upgrade tracks on the existing `port` building (the
other two being `port level` for trade and `supply base level` for land
supply), per `NAVAL_COMBAT.md`. No new building, no new research tree needed:

- Repair rate and repair capacity (simultaneous slots) scale with naval base
  level.
- New construction shares the same capacity slots as repair; repair takes
  priority. Refit also shares the same slots, lowest priority.
- **Resilience is already baked directly into the single level number** —
  docked-ship damage reduction during port strikes scales from ~10-15% at
  level 1 to ~40-50% at max level. No separate archetype path required; this
  is the strongest existing precedent for *not* over-building a dedicated
  tree where one isn't earned.
- **Open question, not yet resolved:** does a newly-*constructed* ship
  auto-join its owner's assigned flotilla the same way a *repaired* ship
  already does (per the existing Automatic Repair spec), or does new
  construction require manual flotilla assignment? Flotillas are
  player-organized (variable size), which leans toward manual assignment
  being the more consistent answer, but this was never explicitly decided —
  needs a decision before implementation.

### 7.6 The test applied (for future buildings, not just these five)

A building earns a genuine multi-path research tree only if there's a second
lever that (a) isn't already owned by unit-research/doctrine trees, and (b)
creates a real opportunity-cost tradeoff rather than restating "more output"
under a different label. Every existing building in `ECONOMY_BUILDINGS.md`
was checked against this test and holds up — no changes recommended there.

---

## 8. Default Building Placement

- **Capital province:** starts with level-1 of all four land/air production
  buildings (Barracks, Ordnance Factory, Tank Plant, Aircraft Factory).
- **Other starting provinces:** each gets **one** of Barracks / Ordnance
  Factory / Tank Plant by default (distributed across the nation's starting
  territory), not all four.
- **Naval:** any non-landlocked nation gets naval base access seeded in at
  least one starting coastal province (same water-access constraint the
  civilian Shipyard already has).
- **Why level-1 can be deliberately weak:** this is the same "player who never
  opens the panel still has a complete, functional system" guarantee already
  used for every resource-extraction building in `ECONOMY_BUILDINGS.md`
  (a Level-0-industry Oil Derrick still produces full base-tier output).
  Making level-1 deliberately underwhelming is what makes free defaults safe
  to hand out — it guarantees *function*, not *abundance*. A player who never
  touches production buildings can still deploy and supply divisions, just
  suboptimally.

---

## 9. Experience & Disbandment — explicitly unchanged

- Experience belongs to the **division/grid-slot**, not the individual unit.
  A unit that enters Reserve (whether via a future disbandment feature, or by
  being reassigned) does **not** carry experience with it.
- `TACTICAL_COMBAT.md`'s existing Irreplaceability rule ("if a division is
  redeployed to a new template, its experienced units are disbanded and the
  experience is lost") and the matching (currently unchecked) `DEV_PHASES.md`
  checklist item are both **confirmed correct as written** — no doc changes
  needed here despite the new production/Reserve system.
- Player-directed division deletion (manual disband, with a time delay during
  which the division remains vulnerable to attack, after which its units
  return to Reserve) is a distinct mechanic from combat destruction, and is
  **explicitly out of scope for this implementation pass** — deferred to a
  future iteration. The Reserve model described here doesn't need to change
  when that feature eventually arrives; it already treats Reserve as
  origin-agnostic HP/ship stock.

---

## 10. Map / Position Representation

No building — old or new — has a position distinct from its province's city
point. This was already true for every existing building (`fort`, `port`,
`airbase`, `supply_hub`, `factory`) before this system existed, confirmed
explicitly in `AIR_COMBAT.md`'s Strategic Bombing section. The four new
production buildings follow the identical convention: a level integer keyed
by type in the province's `buildings{}` object, rendered at the city anchor,
no independent coordinate. See §7.2/§7.4 for the resulting implication on how
the Resilience path must be implemented against undifferentiated province
bombing.

---

## 11. Data Model Sketch

The existing `DATA_CONTRACTS.md` schema predates the Division/template/grid
system entirely (no Division entity, `resources` and `unit_type` still marked
`[TBD]`, buildings represented as flat booleans rather than the
`buildings{}` dict `MAP_DATA_CONTRACT.md` already uses). This system needs
real runtime state that doesn't currently exist anywhere, independent of
today's additions. Sketch below — treat as a starting point, not a final
schema; whoever does the `DATA_CONTRACTS.md` sync pass should reconcile this
against whatever Division/grid state gets defined for tactical combat.

```typescript
// National, per-player. NOT per-province.
interface ReserveState {
  owner_id: string
  land_air_pool: Record<UnitType, number>   // fungible HP-equivalent per type
  naval_ships: NavalReserveShip[]           // discrete objects, individual HP
}

interface NavalReserveShip {
  ship_id: string
  ship_class: string
  current_hp: number
  full_hp: number
}

// Per production building instance (keyed by province_id + building_type)
interface ProductionOrder {
  province_id: string
  building_type: "barracks" | "tank_plant" | "ordnance_factory" | "aircraft_factory"
  current_order: {
    unit_type: UnitType
    build_points_remaining: number
    target_slot_id: string   // which demand slot this order is destined for
  } | null
}

// New fields needed on the existing unit-type definition table
interface UnitTypeProductionData {
  unit_type: UnitType
  build_points: number             // NEW — distinct from existing resource cost vector
  produced_by: "barracks" | "tank_plant" | "ordnance_factory" | "aircraft_factory" | "naval_base"
}

// National constant
const MARSHALLING_RATE: number   // TBD — flat, not per-building, not per-province

// New buildings{} keys needed in MAP_DATA_CONTRACT.md's province schema
type NewBuildingKeys = "barracks" | "tank_plant" | "ordnance_factory" | "aircraft_factory"
// naval production/repair is NOT a new key — it's the pre-existing but
// still schema-unrepresented "naval base level" track on `port`
```

---

## 12. Open Questions Carried Into Implementation

1. **Naval new-construction flotilla assignment** — auto-join vs. manual
   (§7.5). Needs a decision.
2. **Resilience path mechanic for Tank Plant/Aircraft Factory** — must be
   implemented against the undifferentiated province-level `industry` bombing
   scalar, not per-building targeting (§7.2, §10). Needs careful design once
   we're implementing this specific path, not just a flat stat.
3. **General Technology panel has no owning doc/section yet.** The
   marshalling-speed research perk (a standalone nation-wide node, same shape
   as the existing Motorisation perk) needs a home — `TACTICAL_COMBAT.md`
   currently references the General Technology panel in passing but doesn't
   own it structurally.
4. **§6.5's two-layer split is an interpretation**, not a verbatim design
   statement — confirm with design before building it as specified.
5. **Numeric constants** — `build_points` per unit type/tier, `base_rate` per
   building level, `MARSHALLING_RATE`, `STANDING_RESERVE_BUFFER_FRACTION`
   (§6.6), exact Resilience/Throughput perk magnitudes. All explicitly
   deferred to playtesting; implement as named, tunable config, not
   hardcoded values.

---

## 13. Cross-Reference to Project Docs

| This handoff section | Extends / modifies |
|---|---|
| §3, §5 | `RESOURCE_ECONOMY.md` — "Unit Build Cost vs. Supply Draw" |
| §4 | `RESOURCE_ECONOMY.md` (new), `ECONOMY_BUILDINGS.md` Warehouse entry |
| §6 | `ECONOMY_BUILDINGS.md` — Industry Pool's dormant "unit production speed" slice |
| §7 | `ECONOMY_BUILDINGS.md` — four new building entries; `TACTICAL_COMBAT.md` Barracks cross-reference |
| §7.5 | `NAVAL_COMBAT.md` — already correct, no changes needed, just cross-reference |
| §8 | `ECONOMY_BUILDINGS.md` — new "Starting Buildings" subsection |
| §9 | `TACTICAL_COMBAT.md` — confirms no change needed |
| §10 | `MAP_DATA_CONTRACT.md`, `AIR_COMBAT.md` — confirms no change needed |
| §11 | `MAP_DATA_CONTRACT.md` (`buildings{}` keys), `DATA_CONTRACTS.md` (larger sync needed, see note above) |
