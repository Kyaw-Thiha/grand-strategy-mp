# Phase 11 — Unit Specialization Research Branch Plan

## Context

Phase 11 in `DEV_PHASES.md` (line 1409, "Unit Specialization Research (Minimal)"). The
documented goal is narrow — wire the adjacency-web research mechanism (`RESEARCH.md`) against
the one unit branch with real designed content, the Armoured lineage chain
(`TACTICAL_COMBAT.md`'s motorisation → mechanisation → APC → improved APC → IFV), leaving
Infantry/Artillery/Air/Naval as empty stub trees. In practice this phase also has to close two
gaps the docs themselves flag as blocking:

1. **The research-currency pool is formally Phase 10 scope** (`DEV_PHASES.md` line ~1432: *"this
   phase's research draws from the same research-currency pool Phase 10 establishes... Building
   the unit-tree mechanism before that currency model exists would mean stubbing the funding
   side"*), and Phase 10 (Diplomacy + General Technology) is entirely unbuilt. **User decision:**
   Phase 10 is not a full prerequisite here — but the slice of it that funds research (shared
   money+science pool, concurrency cost curve, anti-snowball floor) is 100% in scope for this
   plan. Diplomacy, alliances, and map-sharing (the rest of Phase 10) are explicitly out.
2. **Phase 9 deferred all 18 economy-building perk trees** to "a later phase that finalizes the
   research system project-wide" (`plans/phase-9/phase-9-economy-buildings.md` line 46-51) with
   no phase ever named as the landing point. **User decision:** this phase lays down the generic
   mechanism + UI only, populated with sample/placeholder content (a few illustrative nodes per
   branch, not final balance) so that a later, separate pass only has to author real content —
   real building-perk-tree content and real Infantry/Artillery/Air/Naval doctrine content are
   both out of scope here. Because of this, **the whole tree definition must be authored as
   easily-editable external data (JSON), not hardcoded** — see Data Model below.

**Starting point (from codebase survey, confirmed by direct file reads):**

- **Server has no real research mechanism**, but it already has the pieces a real mechanism
  slots into cleanly:
  - `NationState.researched_perks: ArraySchema<string>` (`GameRoomState.ts:35`) is **already
    live-consumed** by `combat_system.ts` on every combat calculation (`combat_system.ts:706-707,
    766-767, 1050, 1057, 1144` — reads `nation.researched_perks` fresh each time, never
    snapshotted). This already satisfies `RESEARCH.md`'s "Live Effective Stats" requirement for
    perk-shaped effects; the only missing piece is a real mechanism that populates this array
    instead of the debug-only `APPLY_PERKS` message handler (`GameRoom.ts:1032-1044`, which
    directly clears and pushes `perk_ids` from a client message with no cost/prerequisite check
    at all — a test seam, not gameplay).
  - `game-server/src/data/perks.ts`'s `PERK_REGISTRY` and `game-server/src/types/perk_types.ts`'s
    `PerkDefinition` are **already the exact effect schema `RESEARCH.md`'s Perk Taxonomy
    describes** — `modifiers: Partial<PerkModifiers>` covers redistribute/additive effects,
    `attack_config`/`terrain_stealth_bonus`/`xp_config` cover mechanic-unlock structural changes.
    It already has sample content (`infantry_suppression_resist_1-3`,
    `cavalry_charge_damage_1-3`, `armour_flank_resist_1`) consumed live by combat. **This phase
    does not need to invent a new effects system** — a research node's completion effect is
    "push this `perk_id` into `researched_perks`," full stop, for anything shaped like a
    modifier/mechanic-unlock perk.
  - `NationState.science_points: number` (`GameRoomState.ts:57`) accumulates every tick from
    School building levels (`GameRoom.ts:3147`) with an explicit "no sink yet" comment, and is
    broadcast read-only (`GameRoom.ts:3220`). No money+science shared pool, concurrency cost
    curve, or anti-snowball floor exists anywhere.
  - No adjacency-web tree data structure, no `TechSystem`, no research command handlers
    (start/cancel/respec), anywhere in `game-server/src/`.
  - Lineage-chain unit types are incomplete: `UnitType` (`tactical_types.ts:1-27`) has
    `LIGHT_TANK`/`MEDIUM_TANK`/`HEAVY_TANK`/`MECHANISED_INF` but **no `IMPROVED_APC` or `IFV`**
    — the last two rungs of the documented Armoured chain don't exist as grid entities yet.
  - No `research` lane exists in `game-server/test-lanes.json` (current lanes: `air-combat,
    tactical, movement, core, subprovince, economy`).
- **Client is further ahead, but as a self-contained local prototype, not server-synced:**
  - `client/src/systems/research/research_system.gd` (320 lines) is a real, working row/tier +
    mutex-exclusivity + progress state machine, explicitly commented *"client-local until
    server-side research authority is implemented."* Its `load_from_definitions(definitions:
    Array)` already accepts an array of plain Dictionaries (`id, column, row, title, description,
    science_value, exclusive_group, effects`) — this shape is already JSON-compatible, currently
    just fed from inspector-authored `research_entry_card.gd` scene nodes instead of a data file.
  - `client/src/ui/hud/research_panel.gd` (Full Tree, full-center overlay, Infantry/Artillery/
    Armoured/Air/Naval/Economy sub-tabs already stubbed) and
    `client/src/ui/hud/research_drawer_panel.gd` (sidebar, flat available-list) exist and render,
    but neither matches `plans/phase-11/RESEARCH_UI_HANDOFF.md`'s actual spec — no IN
    PROGRESS/NEW/AVAILABLE sidebar sections, no badge system, no Confirm/Cancel/mutex/locked
    popups, no Full Tree branch-tab switching, no fit/edge-fade view. The underlying data model
    (rows, mutex, progress) is closer to spec than the visual/interaction layer, which is
    essentially unbuilt.
  - Authored tree content (`client/scenes/systems/research/research_tree.tscn`) is generic toy
    placeholder (Infantry/Tank/Air basic-training-style nodes) — no real Armoured lineage content
    anywhere client-side either.
  - `client/src/autoload/event_bus.gd:65-68` already declares `research_started`,
    `research_progress_changed`, `research_completed`, `research_rejected` signals, but they're
    only ever emitted by the local prototype — nothing wires server broadcasts into `GameState`
    for research yet.
  - `client/src/ui/hud/division_builder_panel.gd` has zero research awareness — no chain-tier
    slot selection UI exists.
- **Assets:** `client/assets/icons/` has only generic FontAwesome-style SVGs (gear, cubes-stacked,
  table-cells, atom, etc.) — nothing purpose-built for the badge set (⚙▣⇄➕) or node/unit
  portraits, usable only as rough placeholders per branch task files' discretion.

---

## Scope cuts agreed for this phase

1. **No real building-perk-tree content, no real Infantry/Artillery/Air/Naval doctrine content.**
   Every branch except Armoured gets a small illustrative sample tree (a handful of nodes,
   placeholder costs/effects) whose only job is to prove the generic engine/UI handles multiple
   branches, mutex tiers, and badge combinations correctly. Armoured gets real content because
   `TACTICAL_COMBAT.md` already fully specifies it — real content and "sample data to exercise the
   engine" happen to coincide there.
2. **No full Phase 10.** Diplomacy proposals, alliances, map-sharing, and transit-rights are not
   built here. Only the currency slice research needs (shared money+science pool, concurrency
   cost curve, anti-snowball floor, respec/cancel refund math) is pulled forward.
3. **No naval doctrine, no naval anything** — Naval branch stays an empty stub, same as
   Infantry/Artillery/Air per `DEV_PHASES.md`'s own Phase 11 scope.
4. **The one structural rule carried over from Phase 9:** no branch ships server-only. Every
   branch below pairs its mechanic with a real, visually-verifiable UI slice in the same merge.

---

## Data Model — decided once here, referenced by every branch

### Tree definitions: external JSON, not hardcoded — the actual "foundation" deliverable

Mirrors the existing `map_data.json` precedent already used throughout this codebase (a static
JSON file under `client/assets/data/`, loaded independently by both the Godot client and the
Node game-server via their own file reads — see `building_stats.ts`'s comment pattern and
`GameRoom.ts`'s `_initProvinces()` — no network sync needed for *static* definitions, only live
per-node state travels over the wire). New files:

```
client/assets/data/research/
  armour.json            # real content: motorisation, mechanisation, APC, improved_apc, IFV
  infantry.json          # sample content only
  ordnance.json          # sample content only
  air.json               # sample content only
  naval.json             # empty stub (zero nodes) — Phase 11's own scope explicitly excludes Naval
  economy_buildings.json # sample content only (School's 2-path/4-tier shape from
                          # ECONOMY_BUILDINGS.md is a good sample candidate — real numbers deferred)
  general.json           # sample content only (motorisation could live here structurally, or in
                          # armour.json — exact placement is a Branch A implementation decision)
```

Each file is an array of node objects. Field shape follows
`plans/phase-11/RESEARCH_UI_HANDOFF.md` §7 (`id, branch, unit_id/building_id, path_id, tier,
mutex_group_id, name, description, cost: {money, science}, badges[], size, requires[],
image_asset`), plus one addition this plan makes explicit: an `effects` array of either
`{ "type": "perk", "perk_id": "..." }` (pushes into `NationState.researched_perks`, resolved by
the *already-existing* `PERK_REGISTRY`/`combat_system.ts` pipeline — no new effect-resolution
code needed for this shape) or `{ "type": "unlocks_unit_type", "unit_type": "..." }` (lineage-
chain reveal, resolved via the fallback-to-highest-researched-tier rule, for chain steps like
Improved APC / IFV that are new grid entities rather than stat modifiers).

Server gets a loader (`game-server/src/data/research_tree_loader.ts`) reading these same files
by relative path, same defensive "throw on bad/missing schema" pattern `building_stats.ts`
already establishes. Client gets an equivalent GDScript loader that replaces
`research_tree_view.gd`'s current inspector-authored-node collection with a JSON read, feeding
the exact same `load_from_definitions()` entry point `research_system.gd` already exposes (small
change, not a rearchitecture, since that method's Dictionary shape already matches). **This
JSON format is the actual foundation artifact of this phase** — a future content-authoring pass
for building perk trees or the other doctrine branches only ever touches these files, never
engine code.

### Currency: new `NationState` fields (real Colyseus schema, same tier as `resources`/`science_points`)

```typescript
// Concurrency-cost-curve state — how many research projects this nation currently has active,
// used to compute the rising per-project cost multiplier (RESEARCH.md's soft cap).
@type("number") active_research_count: number = 0; // derived/cached, recomputed each tick
```
`science_points` (already exists) plus `nation.resources.get("money")` (already exists, Phase 9)
together form the "shared pool" — a node's `cost` is a `{money, science}` vector, deducted from
each stockpile directly, the same vector-cost pattern `building_stats.ts`'s
`resource_cost_by_level` already establishes elsewhere in this codebase. No new abstract
"research points" currency is invented.

### Per-node research state: plain server-side structure, not Colyseus schema

Mirrors `DivisionState.grid`'s precedent exactly (`GameRoomState.ts:143`, *"server-side only —
not schema-synced"*) — per-nation research progress (which nodes are researched/in-progress,
progress amount, active concurrent set) is a much larger, more sparsely-viewed surface than the
ten flat resource numbers, so it stays a plain `Map<nation_id, NationResearchData>` object
broadcast via explicit `RESEARCH_UPDATES` messages, applied client-side to a new
`GameState.research: Dictionary`, not native Colyseus reactivity.

---

## Branches

### Branch A — `feat/research-tree-foundation`

JSON schema + loaders (server & client), server adjacency-web tree structure, `compute_stats`/
live-recompute (reusing the already-live `researched_perks` → `combat_system.ts` pipeline),
lineage-chain fallback (new `improved_apc`/`ifv` unit types), respec state machine. Sample
content across every branch file, real content for Armoured. Client: replace the local-only
prototype's data source with the real JSON loader + real server sync (`RESEARCH_UPDATES`
broadcast → `GameState.research` → `EventBus`), retiring the toy placeholder tree content.
Currency is a flat placeholder here (free or a small flat seed) — proving the tree mechanism is
this branch's job, not the economy. **UI checkpoint:** open the research panel, see the real
synced Armoured tree (not toy nodes), research motorisation → mechanisation → APC, watch
progress tick and complete, see a fielded division's stats update live without re-saving its
template; confirm Infantry/Artillery/Air/Naval render the documented empty-stub state.
Task file: `phase-11-task-a-tree-foundation.md` (to be written).

### Branch B — `feat/research-currency`

The real shared money+science pool: per-node `{money, science}` cost deduction, concurrency
cost curve (rising cost per additional simultaneous project), anti-snowball floor (asymptotic
minimum completion time regardless of funding), respec's no-refund rule, cancel's fixed-rate
partial refund. Gives `science_points` its first real sink and finally resolves Phase 9's
stubbed Uranium research-currency injection. **UI checkpoint:** Economy panel shows science
alongside money; a node's popup shows real cost and an insufficient-funds state; starting a
second concurrent project visibly costs more; cancelling an in-progress node shows the exact
invested/refunded/forfeited numbers from `RESEARCH_UI_HANDOFF.md` §6.6.
Task file: `phase-11-task-b-currency.md` (to be written).

### Branch C — `feat/research-ui-interaction`

The full `RESEARCH_UI_HANDOFF.md` visual/interaction layer on top of A+B's real data: sidebar IN
PROGRESS/NEW/AVAILABLE sections with search/branch-filter, composable node badges (⚙▣⇄➕) +
mutex bracket container, hover tooltip, click popups for every state (Available Confirm/Cancel,
mutex-conflict warning, Locked read-only with requirement list, Researched read-only,
Researching progress + Cancel-with-refund), Full Tree branch tabs + default (frontier-zoomed)
view + `[Fit]` + edge-fade directional indicators. **UI checkpoint:** the handoff doc's mockups,
live, end to end.
Task file: `phase-11-task-c-ui-interaction.md` (to be written).

### Branch D — `feat/research-division-builder`

DivisionBuilder chain-tier selection at the unit-slot level (a slot with no research yet shows
the base unit only, never broken/greyed; once Improved APC is researched, the slot's eligible
list offers it). Unit Profile tie-in for structural (non-stat-delta) research changes per
`UI_UX_DESIGN.md` §6.6. Motorisation's DivisionBuilder toggle effect (per-unit-type motorised
variant, `TACTICAL_COMBAT.md`'s "Motorisation and Mechanisation" section) also lands here, since
it's the same "research state changes what the builder offers" surface — no separate branch
needed for it. **UI checkpoint:** research Improved APC, open the builder, see the new variant
available in a mechanised-infantry slot; toggle a motorisable unit type after researching
Motorisation.
Task file: `phase-11-task-d-division-builder.md` (to be written).

### Branch E — `feat/research-verification` (must be last, optional to actually run)

Full bot-driven run of `DEV_PHASES.md`'s Phase 11 verification gate end to end. Per the
phase-9 precedent, running this branch is optional at the user's discretion.
Task file: `phase-11-task-e-verification.md` (to be written).

---

## Merge Order

```
A ── B ── C ── D ── E
```

B needs A (a currency system has nothing to charge against until real nodes/costs exist). C
needs A+B (the full interaction layer needs real cost data to render popups meaningfully — a
Confirm popup with no real cost is a lie). D needs A at minimum (chain-tier unit types must
exist) and benefits from being after C (so DivisionBuilder's research-driven UI has the same
visual language already established), but does not strictly need B or C's currency/polish —
flag in the task file if an execution agent finds a reason to reorder D earlier.

---

## Deferred Scope — explicitly out of this phase, not overlooked

| Item | Deferred to | Why not now |
|---|---|---|
| Real building-perk-tree content for all 18 economy buildings | A future, separate content-authoring pass | This phase lays down the generic JSON-driven engine + UI only; real numbers/paths are explicitly a different pass per user decision |
| Real Infantry/Artillery/Air/Naval doctrine tree content | Same future content-authoring pass | Same reasoning — this phase ships sample/placeholder nodes only, proving the mechanism, not final balance |
| Full Phase 10 (diplomacy proposals, alliances, map-sharing, transit-rights, General Technology panel as its own diplomacy-adjacent surface) | Phase 10, whenever it's picked up | Only the currency slice research needs is pulled forward here; the rest of Phase 10 is unrelated to research mechanics/UI |
| Manual perk-mode toggle UI (per-template active/inactive perk selection) | Explicitly deferred by `RESEARCH.md` itself | The data seam (`perk_mode: "auto"\|"manual"`) exists by design for later; no UI for it is in scope per `RESEARCH_UI_HANDOFF.md` §9 |
| Aluminium's real air-doctrine-tier ceiling | Phase 14 (Economy Integration), unchanged from Phase 9's own deferral | Still needs the Air tree to have *real* (not sample/placeholder) content, which this phase explicitly does not provide |
| Naval doctrine tree, any content | Whenever Naval Combat (Phase 13) and its doctrine design land | `DEV_PHASES.md`'s own Phase 11 scope excludes Naval entirely; this plan does not relitigate that |

---

## Verification Split (applies across all branches)

Each task file below marks individual steps as one of:

- **Automated (unit/mocha)** — a `game-server/test/11*.test.ts` case, runnable headlessly, no
  Godot required.
- **Automated (bot client)** — a scripted Colyseus client exercising research-to-combat
  integration (e.g. confirming a live-recomputed division's stats), per `DEV_PHASES.md`'s Bot
  client pattern.
- **Manual (visual)** — requires a running Godot client; the task file states exactly what to
  click and what should be visible on screen. Report as "performed" or "still required — run
  `<command>`" per `AGENTS.md`'s UI reporting rule.

New `game-server` test files must use `getTestPort`, belong to a new `research` lane added to
`test-lanes.json` in Branch A, and prefix their top-level `describe()` with `lane:research | `,
per `AGENTS.md`.

---

## Next Steps

Per-branch task files (`phase-11-task-a-tree-foundation.md` through
`phase-11-task-e-verification.md`), each following the `plans/phase-9/phase-9-task-*.md` format
(Critical Pre-Read with exact file:line citations, Files to Create/Modify, TDD steps, Common
Misassumptions table), to be written together with the user next, one branch at a time.
