# Phase 9 — Resource Economy & Buildings Branch Plan

## Context

Phase 9 in `DEV_PHASES.md` (line 1056, "Resource Economy + Buildings"). Diplomacy and
General Technology were split out to Phase 10 specifically because Economy alone grew too
large to bundle with them — the same reasoning applies one level down here: this phase is
split into five branches instead of building it as one continuous effort, and each branch
is scoped so it can be tested and merged independently before the next one starts.

**Starting point (from codebase survey, confirmed by direct file reads — see `plans/phase-9`
task files for exact line numbers):**

- Server: `ProvinceState` has only `industry`, `population`, `infrastructure` (flat numbers,
  default 50), `oil_bombed_until_ms`, `naval_base_level`. No `resources`, no `buildings`, no
  Reserve, no market state anywhere. `NationState` has only `nation_id`, `player_id`,
  `is_ready`, `researched_perks`. Zero economy-related files exist in `game-server/src/systems/`
  or `game-server/src/data/`. No `economy` test lane exists in `test-lanes.json`.
- Client: `economy_panel.gd/.tscn` is a registered stub (close button only, `E` hotkey,
  `cycle_sub_tab()` is a no-op). `friendly_province_panel.gd` already has dead placeholder
  fields (`_steel_val`, `_manpower_val`, `_buildings_val` always render `"--"`) and three
  unwired buttons (`BtnUpgrade`, `BtnBuildRadar`, `BtnManageProd` — no `.pressed.connect`
  anywhere). No Production sidebar panel, no Province Detail modal, no Market modal exist.
- **Map data:** `MAP_DATA_CONTRACT.md` already fully documents the target per-province
  schema — a 10-key `resources` abundance envelope (`res_money`...`res_uranium`) and an
  18-key `buildings` dict split into generic buildings (`bld_fort`...`bld_town_hall`,
  including all four production buildings) and resource-extraction building levels kept in
  a separate `bld_res_*` namespace. **These branches assume `map_data.json` already reflects
  this documented schema with real, non-zero per-province values** — that map-authoring work
  (updating `map/tools/map_pipeline/pipeline.py`'s stale 6-key/5-key output and re-authoring
  `provinces.geojson`) is being done separately, outside this branch plan. If a branch's
  execution agent finds `map_data.json` still has the old 6-key placeholder envelope or the
  old 5-key buildings dict, **stop and flag it** — do not silently work around a schema
  mismatch.
- **Phase 7 (Supply System) is 0/18 checked in `DEV_PHASES.md` — entirely unbuilt.**
  Divisions currently have no supply mechanic and no HP-recovery tick at all (confirmed:
  `supply_system.ts` only drains HP for out-of-supply attrition, never restores it — there is
  no healing code anywhere in `game-server/src/systems/` today). Every branch below that would
  naturally lean on "the division heals via supply" ships a documented, named placeholder
  instead, mirroring exactly how Phase 12 (Air Combat) handled the same gap for readiness
  recovery.

**Scope cuts agreed for this phase, both deliberate and both explicitly deferred, not
dropped:**

1. **No perk trees / research paths.** Every building in `ECONOMY_BUILDINGS.md` ships with
   only its **base effect** — the one thing that scales with level 1→5. No paths, no tier
   locks, no adjacency web, no `[Path >]` UI element at all. The perk-tree layer is deferred
   to a later phase that finalizes the research system project-wide (unit specialization
   research included) — implementing 18 separate perk trees now, before that system's shape
   is settled, would mean redoing this work twice.
2. **No naval production tab.** `unit_production_handoff.md` §7.3 / the UI handoff §7 Tab 3
   describe this as "a forward-planning UI spec, since naval combat itself isn't implemented
   yet" — it stays that way. Not started in this phase.

**The one structural change from the Phase 12 precedent:** Phase 12's plan put nearly all
client work in one late `K-ui` branch after ~8 server branches had already merged, which
delayed the feedback loop and hid bugs until very late. No branch below ships server-only —
each branch pairs its mechanic with the UI slice that makes it visually verifiable in the
same merge, including fixing the two already-dead placeholder UI elements
(`economy_panel`'s stub content, `friendly_province_panel`'s `"--"` labels) in the very
first branch rather than the last.

---

## Data Model — decided once here, referenced by every branch

Two different sync strategies are used, matching an existing split already present in the
codebase: `DivisionState.grid` (25 cells, TACTICAL_COMBAT.md's 5×5 grid) is explicitly
**not** part of the Colyseus-synced schema — comment in `GameRoomState.ts`:
`grid: DivisionGridState = new DivisionGridState(); // server-side only — not schema-synced`
— it's kept as a plain server-side object and pushed to clients via an explicit
`DIVISION_UPDATES` broadcast + `GameState._apply_division_updates()`, not native Colyseus
field reactivity. That precedent is reused directly below.

**On `NationState` (real Colyseus schema fields — small, flat, needed live everywhere,
same shape as `ProvinceState`'s existing `industry`/`population`/`infrastructure`):**

```typescript
@type({ map: "number" }) resources    = new MapSchema<number>();  // 10 keys: money, grain, iron, oil, rubber, nitrates, tungsten, chromium, aluminium, uranium
@type("number")           manpower_available: number = 0;         // cached/derived, refreshed each economy tick
@type("number")           manpower_ceiling:   number = 0;
@type({ map: "number" }) reserve_pool  = new MapSchema<number>(); // keyed by unit_type string, HP-equivalent pool — land/air only, Branch C
@type({ map: "number" }) industry_alloc = new MapSchema<number>(); // keyed by resource type + "construction_speed" + "unit_production_speed", 0-100 slider values, Branch B
```

**Per province (plain server-side structure, NOT added to `ProvinceState`'s Colyseus schema
— mirrors the `DivisionState.grid` precedent exactly, synced via explicit broadcast +
`GameState._apply_*` instead):**

```typescript
interface ProvinceEconomyData {
  buildings: Record<string, number>;          // 18 keys, bld_* + bld_res_*, from map_data.json at init, mutated by BUILD/UPGRADE
  resource_deposits: Record<string, number>;  // 10 keys, res_*, read-only after map load — the map-authored abundance values
  construction_queue: ConstructionProjectData[]; // active parallel construction/upgrade projects, Branch A
}
```
Stored server-side as `Map<province_id, ProvinceEconomyData>` on `GameRoom`, populated at
`_initProvinces()` from `map_data.json`, broadcast via new message types
(`PROVINCE_ECONOMY_INIT` at game start, `BUILDING_UPDATES` on change) applied client-side to
a new `GameState.province_economy: Dictionary` keyed by `province_id`.

**Why the split:** ten national resource numbers are small, flat, and every player needs
their own nation's live value constantly (top bar, Economy panel) — real Colyseus field
reactivity is the right tool, same as `industry`/`population`/`infrastructure` already are.
Eighteen building levels **times every province a player owns** is a much larger, much more
sparsely-viewed surface (only matters when a specific province panel is open) — the same
shape of tradeoff that already pushed `DivisionState.grid`'s 25 cells off schema and onto
explicit broadcast. Reusing that precedent avoids inventing a second data-sync philosophy in
the same codebase.

---

## Branches

### Branch A — `feat/economy-foundation`

Schema (above) lands; buildings exist, are constructible, and level up. `BUILD`/`UPGRADE`
handler, `construction_points` formula, parallel per-slot construction. Client: Province
Detail modal (build/upgrade rows, no `[Path>]`), Production sidebar panel registered (empty
tab shells), Economy panel wired to real (still father mostly-static) numbers, the two dead
UI elements (`economy_panel` stub, `friendly_province_panel`'s `"--"` labels) fixed for real.
See `phase-9-task-a-foundation.md`.

### Branch B — `feat/resource-and-building-economy`

The large one, by design. All ten resources' distinct mechanics (oil debuff curve,
rubber/nitrate combat attrition, tungsten stat-shift, chromium/aluminium hard-block, uranium
research-currency stub), population/manpower, every civilian and resource-extraction
building's base effect, and the national Industry Pool allocation layer. One topic because
the Industry Pool has nothing to multiply until extraction produces something, and "does
this building do its one designed thing at base level" is a single coherent verification
pass — matching how `DEV_PHASES.md`'s own Phase 9 gate paragraph is written as one gate
covering all of it. See `phase-9-task-b-resource-building-economy.md`.

### Branch C — `feat/unit-production-reserve`

Four new production buildings (base throughput only), `build_points`/auto-scheduler,
national Reserve, Marshalling + early deployment, Warehouse's Reserve-cap extension (the
other half of Warehouse's base effect, split from Branch B only because Reserve doesn't
exist until now). See `phase-9-task-c-unit-production-reserve.md`.

### Branch D — `feat/economy-market`

Spot market (order book, spread, NPC floor) and standing trade routes together — one
"players trading resources" topic, sharing the Market/Diplomacy UI surface. War-eligibility
uses the existing neutral-stance `relations` map (Phase 4); blockade-percentage and
transit-rights routing stay the already-documented Phase 14 placeholders. See
`phase-9-task-d-economy-market.md`.

### Branch E — `feat/economy-verification` (must be last)

Full bot-driven run of the actual `DEV_PHASES.md` Phase 9 verification gate, end to end,
against a second bot nation for market/trade matching. See `phase-9-task-e-verification.md`.

---

## Merge Order

```
A ── B ── ┬── C ──┐
          └── D ──┴── E
```

B needs A (buildings must exist before their base effects can be implemented, and before the
Industry Pool has anything to multiply). C needs B (the unit-production-speed Industry Pool
slice must be real before `build_points`' formula has something other than 1.0× to read). D
only needs A (resources) + B (money/resources actually moving) — it does not need C, so C and
D can run in parallel if two people pick them up at once.

---

## Deferred Scope — explicitly out of this phase, not overlooked

| Item | Deferred to | Why not now |
|---|---|---|
| Perk trees / research paths for all 18 buildings | Later research-system-finalization phase | Implementing 18 trees before the project-wide research system shape is settled means redoing this work once that system lands |
| Naval production tab (Production panel Tab 3) | Later, alongside Naval Combat (Phase 13) | Naval combat itself doesn't exist yet; the tab would be inert UI with nothing real to show |
| Reserve field-resupply via the real road-segment supply graph | Phase 7 (Supply System) integration | Phase 7 is 0/18 unbuilt; Branch C ships a documented simplified stand-in, same pattern Air used |
| Standing trade route real blockade-percentage disruption | Phase 14 (Economy Integration), same deferral already documented in `DEV_PHASES.md` Phase 9's own verification gate | Needs Phase 13 (Naval Combat)'s real blockade system; Branch D ships the flat placeholder check the doc already specifies |
| Standing trade route third-party transit-rights routing | Phase 14 (Economy Integration), same as above | Needs Phase 10 (Diplomacy)'s transit-rights flag, which doesn't exist yet |
| Aluminium's real air-doctrine-tier ceiling | Phase 14 (Economy Integration), same as above | Needs Phase 11's Air specialization tree to have real content; Branch B ships the documented placeholder research flag |
| Real war/alliance-aware trade route eligibility beyond "not at war" | Phase 10 (Diplomacy) | Full diplomacy (proposals, alliances) doesn't exist yet; Branch D uses the existing neutral-stance `relations` map, which already supports an eligibility check this coarse |
| Per-province resource deposit authoring (`res_*` values in `provinces.geojson`, `pipeline.py` schema catch-up) | Being done separately, outside this branch plan | User is handling map-authoring directly; these branches assume it is already correct by the time each branch is implemented |

---

## Verification Split (applies across all branches)

Each task file below marks individual steps as one of:

- **Automated (unit/mocha)** — a `game-server/test/9*.test.ts` case, runnable headlessly,
  no Godot required.
- **Automated (bot client)** — a scripted Colyseus client exercising a multi-nation scenario
  (market matching, trade routes), per `DEV_PHASES.md`'s Bot client pattern.
- **Manual (visual)** — requires a running Godot client; the task file states exactly what
  to click and what should be visible on screen. These cannot be scripted away and should be
  reported as "performed" or "still required — run `<command>`" per `AGENTS.md`'s UI
  reporting rule.

New `game-server` test files must use `getTestPort`, belong to the new `economy` lane in
`test-lanes.json` (added in Branch A), and prefix their top-level `describe()` with
`lane:economy | `, per `AGENTS.md`.
