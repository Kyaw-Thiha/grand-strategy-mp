# Branch A — `feat/research-tree-foundation`

## Context

First branch of Phase 11 (see `phase-11-unit-specialization-research.md` for the full branch
list, merge order, and deferred-scope table — read it first, this file assumes it). Nothing
else merges before this one. It establishes: the JSON-driven adjacency-web tree data format +
server/client loaders, real Armoured-branch content (motorisation → mechanisation → APC →
Improved APC → IFV, including two brand-new unit types), sample/placeholder content for every
other branch, the lineage-chain fallback rule, a respec state machine, and new command handlers
— replacing the debug-only `APPLY_PERKS` seam with a real mechanism. Client-side: retires the
current client-local-only research prototype's toy placeholder content and wires it to real
server-synced state.

**Currency is explicitly NOT this branch's job.** Research completes at a flat placeholder rate
(no per-node money/science cost check yet) — same trick Phase 9's Branch A used for buildings
(seeded starting money, real resource ticks came in Branch B). Branch B wires the real shared
money+science pool, concurrency cost curve, and anti-snowball floor on top of the mechanism this
branch builds.

**A genuinely good find from investigation, load-bearing for this branch's design:** live
effective-stats recompute for stat-modifier-shaped perks **already exists and already works** —
`NationState.researched_perks` (`GameRoomState.ts:35`) is read fresh, every combat calculation,
by `combat_system.ts` (lines 706-707, 766-767, 1050, 1057, 1144), resolved against
`game-server/src/data/perks.ts`'s `PERK_REGISTRY` via `resolvePerkModifiers()`
(`perks.ts:141-156`). This branch does **not** need to invent a stats-recompute pipeline for
that class of effect — it only needs to (a) populate `researched_perks` through a real
mechanism instead of the `APPLY_PERKS` debug handler, and (b) add the one genuinely new piece:
**lineage-chain fallback** (a template referencing a since-superseded chain tier resolves to the
highest currently-researched tier), which nothing in the codebase does yet today (confirmed
greenfield — no hits for "lineage"/"fallback"/"highest researched" anywhere in
`game-server/src`).

**Keep test runs minimal and targeted, per project preference.** Writing a failing test before
implementing is still the right discipline for the handful of genuinely load-bearing behaviors
below (lineage fallback, respec sequencing, mutex/prerequisite gating) — but do not run the full
suite after every small change, and do not write exhaustive test coverage for straightforward
data/plumbing steps (the JSON loader's happy path, schema wiring) where a single targeted
assertion is enough. Run only the specific new test file for this branch
(`npx mocha -r tsx test/11a-research-tree-foundation.test.ts --exit --timeout 180000` from
`game-server/`) while iterating — do not run the full `npm test` suite at all as part of this
branch, not even once at the end; that's a separate, deliberate decision for whoever's
integrating multiple branches later, not a default step here.

---

## Critical Pre-Read

### `NationState` — current full field list (`game-server/src/rooms/schema/GameRoomState.ts:28-72`)

```typescript
28: export class NationState extends Schema {
29:   @type("string")   nation_id: string  = "";
30:   @type("string")   player_id: string  = "";
31:   @type("boolean")  is_ready: boolean  = false;
34:   @type("string")   capital_province_id: string = "";
35:   @type(["string"]) researched_perks   = new ArraySchema<string>();
38:   @type({ map: "number" }) resources = new MapSchema<number>();
39:   @type("number") manpower_available: number = 0;
40:   @type("number") manpower_ceiling:   number = 0;
42:   @type({ map: "number" }) reserve_pool = new MapSchema<number>();
45:   @type("number") reserve_cap: number = 0;
48:   @type({ map: "number" }) industry_alloc = new MapSchema<number>();
      // ...oil_priority, aluminium_air_doctrine_flag, science_points (line 57),
      // convoy_capacity, bauxite_stock, resource_storage_cap, hospital_damage_mult follow
72: }
```
`researched_perks` is already the live sink every combat lookup reads — this branch's command
handlers write into it for real. `science_points: number` exists (line ~57) with an explicit
"no sink yet" comment; this branch leaves it alone except to note where Branch B will hook in.

### `DivisionState.grid` — the off-schema precedent this branch's per-nation research state copies (`GameRoomState.ts:143`)

```typescript
143: grid: DivisionGridState = new DivisionGridState(); // server-side only — not schema-synced
```
Per-nation research progress (which nodes are in-progress/researched, progress amount) is a
much larger, more sparsely-viewed surface than the flat `researched_perks` array — mirror this
exact pattern: a plain `Map<nation_id, NationResearchData>` on a new `ResearchSystem` class,
broadcast via explicit `RESEARCH_INIT`/`RESEARCH_UPDATES` messages, never native Colyseus
reactivity. (`researched_perks` itself stays real schema — it's small, flat, and every combat
calc needs it live, same reasoning `NationState.resources` already established in Phase 9.)

An existing `MapSchema<Schema>`-of-custom-class precedent, for contrast/context only (NOT the
pattern to use here, since we want off-schema): `ProposalState` (`GameRoomState.ts:154-160`),
registered as `state.proposals = new MapSchema<ProposalState>()` (line 199).

### `APPLY_PERKS` — the debug seam this branch replaces (`GameRoom.ts:1036-1044`)

```typescript
1036: this.onMessage("APPLY_PERKS", (client, msg: { perk_ids: string[] }) => {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;
        const nation = this.getNationForPlayer(player.userId);
        if (!nation) return;
1042:   nation.researched_perks.clear();
1043:   for (const id of msg.perk_ids) nation.researched_perks.push(id);
      });
```
No cost, no prerequisite check, no per-node tracking — a raw test seam. **Do not delete it**
(other systems' tests may depend on it for setup) but do not let it remain the only way
`researched_perks` gets populated; the new `START_RESEARCH` handler is the real path.

### `gameTick()` — system instantiation + tick ordering (`GameRoom.ts`)

```typescript
149-166: private movementSystem = new MovementSystem();
          ...
          private economyBuildingSystem = new EconomyBuildingSystem();
          private resourceEconomySystem = new ResourceEconomySystem();
          private unitProductionSystem = new UnitProductionSystem();
2031: private gameTick() {
2041:   this.movementSystem.tick(this.state);
2047-2072: // subprovince freeze/capture logic
2074:   this.supplyHubConstructionSystem.tick(...)
2080:   const combatChanged = this.combatSystem.tick(...)
2094:   this.supplySystem.tick(...)
2096:   this.economyBuildingSystem.tick(...)
2102-2103: this._economyTick(); this._unitProductionTick();
2106:   tickTradeRoutes(...)
```
New system: `private researchSystem = new ResearchSystem();` added alongside the block at
149-166; `this.researchSystem.tick(this.state, (type, msg) => this.broadcast(type, msg))` (or
`broadcastToNation` per-nation, see below) slots in **after** `this._unitProductionTick()`
(line 2103) — research is its own independent tick, order relative to economy doesn't matter
functionally in this branch since currency isn't wired yet, but keep it grouped with the other
per-nation economy-adjacent ticks for readability.

### `startGame()` — where to broadcast `RESEARCH_INIT` (pattern: `PROVINCE_ECONOMY_INIT`)

`PROVINCE_ECONOMY_INIT` broadcasts once, right after `PROVINCE_INIT` (line 1774), inside
`startGame()` (starts ~line 1713). Add a `RESEARCH_INIT` broadcast in the same block, same
`Record<nation_id, X>` shape precedent — one entry per nation, its currently-empty research
state (nothing researched at match start, per `RESEARCH.md`'s Session Scope — research is
fully session-local).

### `broadcastToNation` — per-nation filtered broadcast (`GameRoom.ts:1959-1967`)

Exists and is already used elsewhere (Phase 9's `RESOURCE_UPDATES`) for exactly this reason: a
nation's research progress is private, same as its resource stockpile. Use it for
`RESEARCH_UPDATES`; `RESEARCH_INIT` at game start can go out as one broadcast keyed by
`nation_id` (matching `PROVINCE_ECONOMY_INIT`'s shape) since every nation's initial state is
identical (empty) anyway — no privacy concern at that specific moment.

### Ownership-guard command-handler shape — `RAISE_DIVISION` (`GameRoom.ts:620-636`)

```typescript
620: this.onMessage("RAISE_DIVISION", (client, msg: {...}) => {
       if (this.state.phase !== "running") return;
       const player = this.state.players.get(client.sessionId);
       if (!player) return;
       const nation = this.getNationForPlayer(player.userId);
       if (!nation) return;
       // ...
     });
```
`START_RESEARCH`/`CANCEL_RESEARCH` follow this identical `phase check → player → nation`
resolution — research is a nation-scoped action, no province lookup needed. **Confirmed via
this same handler: `RAISE_DIVISION` does zero validation against `researched_perks` or
unit-type availability today** — this branch does not add that gate here; it only exposes a
query function (`isUnitTypeAvailable`/`resolveLineageUnitType`, see Step 4) for Branch D
(DivisionBuilder UI) to consume later.

### `PERK_REGISTRY` / `PerkDefinition` — the existing effect schema (`game-server/src/data/perks.ts`, `game-server/src/types/perk_types.ts`)

```typescript
// perk_types.ts
export interface PerkModifiers {
  damage_mult: number; suppression_mult: number; suppression_resist_mult: number;
  movement_mult: number; observation_mult: number; recon_mult: number; xp_gain_mult: number;
}
export type PerkScope = "unit_type" | "global" | "formation_synergy";
export interface PerkDefinition {
  perk_id: string; scope: PerkScope; applies_to_unit?: string;
  synergy_units?: [string, string]; modifiers: Partial<PerkModifiers>;
  attack_config?: Partial<Pick<SpecialAttackConfig, "priority_list" | "n_targets" | "area_radius" | "falloff_per_col">>;
  terrain_stealth_bonus?: Record<string, number>;
  xp_config?: { full_hp_threshold?: number; incap_retention?: number; damaged_retention?: number };
}

// perks.ts — PERK_REGISTRY, 14 entries today, unit types covered: infantry, cavalry,
// light_tank, sniper, artillery, commando. No armour-branch entries beyond
// "armour_flank_resist_1" (light_tank only). Example entry shape:
"armour_flank_resist_1": {
  perk_id: "armour_flank_resist_1", scope: "unit_type",
  applies_to_unit: "light_tank", modifiers: { damage_mult: 1.10 },
},
```
This is already `RESEARCH.md`'s Perk Taxonomy in code form: `modifiers` = redistribute/
additive, `attack_config`/`terrain_stealth_bonus`/`xp_config` = mechanic-unlock structural
changes. **A research node's `effects` field for a stat-modifier-shaped perk is just `{"type":
"perk", "perk_id": "..."}`** — completion pushes that id into `researched_perks`; resolution is
already handled. New Armoured-branch entries (mechanisation modifiers) get added to
`PERK_REGISTRY` here, not reinvented.

### `resolvePerkModifiers` — confirms live-recompute already works (`perks.ts:141-156`)

Called from `combat_system.ts:771` inside per-round resolution, reading
`nation.researched_perks` fresh every call (never cached/snapshotted) — this is the "Live
Effective Stats" guarantee from `RESEARCH.md` already satisfied for anything perk-shaped.
Nothing to change here.

### `UnitType` const and `unit_combat_stats.ts` — template for the two new lineage types (`game-server/src/types/tactical_types.ts:1-27`, `game-server/src/data/unit_combat_stats.ts`)

```typescript
export const UnitType = {
  INFANTRY: "infantry", ASSAULT_INF: "assault_infantry", RECON_INF: "recon_infantry",
  MG: "mg", CAVALRY: "cavalry", LIGHT_TANK: "light_tank", MEDIUM_TANK: "medium_tank",
  HEAVY_TANK: "heavy_tank", ARMOURED_CAR: "armoured_car", AT_INFANTRY: "at_infantry",
  AT_GUN: "at_gun", AT_GUN_SP: "at_gun_sp", AA_GUN: "aa_gun", SNIPER: "sniper",
  FLAMETHROWER: "flamethrower", ARTILLERY: "artillery", COMMANDO: "commando",
  EMPTY: "", FORCE_RECON_SNIPER: "force_recon_sniper", HOWITZER: "howitzer",
  SELF_PROPELLED_GUN: "self_propelled_gun",
  MOTORISED_INF: "motorised_infantry", MECHANISED_INF: "mechanised_infantry",
  // NEW this branch:
  IMPROVED_APC: "improved_apc", IFV: "ifv",
} as const;
```
`unit_combat_stats.ts`'s `MECHANISED_INF` entry (line 45) is the template to copy/upgrade from:
```typescript
[UnitType.MECHANISED_INF]: { pen: 15, armour: 10, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
```
Per `TACTICAL_COMBAT.md`, `improved_apc`/`ifv` should have progressively higher `armour` and
better `hp_floor_pct`/suppression-resistance framing than `mechanised_inf` — exact numbers are
TBD-playtesting placeholders per project convention, just monotonically improving up the chain.
`unit_production_stats.ts:30-31` already has a forward-looking comment: *"mechanised_infantry
belongs here despite its name — gated behind the armour research branch (post-medium-tank
tier)"* — confirms the design intent predates this branch; `improved_apc`/`ifv` need matching
`produced_by: "tank_plant"` entries too (Branch A only needs the data entries to exist so the
schema round-trips; Branch C-of-Phase-9's production system already knows how to consume any
`produced_by`-tagged type generically).

### `test-lanes.json` — lane shape template (`game-server/test-lanes.json:102-120`, `economy` lane)

```json
"economy": {
  "source_prefixes": [ "src/systems/economy_", "..." ],
  "tests": [ "test/9a-economy-foundation.test.ts", "..." ]
}
```
New `research` lane, identical shape, added this branch.

---

### Client — `research_tree_view.gd` (113 lines, full) — the piece that swaps data source

Key mechanics (`client/src/systems/research/research_tree_view.gd`):
- Line 8: `@onready var _research_system: Variant = %ResearchSystem` — grabs the shared
  `ResearchSystem` node by unique name, **not an autoload** (confirmed: zero `ResearchSystem`
  hits in `client/project.godot`'s `[autoload]` section — exactly one instance exists per
  session, owned by the `research_tree.tscn` scene, shared into the drawer by reference via
  `setup()`).
- `_ready()` (lines 18-35) calls `_collect_entry_cards(self)` (recursive scene walk, lines
  82-86) to gather inspector-authored `ResearchEntryCard` nodes, builds a `definitions: Array`
  from each `card.get_definition()`, feeds `_research_system.load_from_definitions(definitions)`.
  **This branch replaces lines 18-35's scene-walk with a JSON-file load** feeding the exact same
  `load_from_definitions()` entry point (no change needed to `research_system.gd` itself for
  this part).
- `_on_entry_pressed(entry_id)` (lines 111-113) currently calls
  `_research_system.start_research(entry_id)` **directly, fully client-local, no
  `CommandQueue`**. This branch reroutes it through
  `CommandQueue.submit("START_RESEARCH", {"node_id": entry_id})` instead — the local
  `research_system.gd` sim becomes a display cache reflecting server state, not the authority.

### `client/scenes/systems/research/research_tree.tscn` — placeholder content to strip

Root `ResearchTree` (script `research_tree_view.gd`) contains child `ResearchSystem`
(`unique_name_in_owner = true`, script `research_system.gd`), `DimOverlay`, and
`OuterMargin/Panel/ContentMargin/Layout/{TitleRow, StatusLabel, Scroll/ResearchGrid}`
(`GridContainer`, `columns = 3`). Under `ResearchGrid`: 3 header `Label`s (Infantry/Tank/Air) +
9 `PanelContainer` nodes (script `research_entry_card.gd`) with inspector-exported toy content
(`infantry_basic_training`, `tank_light_chassis`, `air_basic_airframes`, and two more rows —
full field list already captured in the phase-11 overview investigation). **This branch strips
all 9 cards + 3 headers**; the `ResearchSystem` child node, `DimOverlay`, and outer chrome stay
— they become populated live by the new JSON-driven loader instead of inspector authoring.

### **Discrepancy found — verify before touching, do not assume:** `research_panel.gd` vs `research_drawer_panel.gd`

Two different files, easy to conflate:
- **`research_drawer_panel.gd`** (189 lines) is the **real, live-wired sidebar** — has a
  `setup(research_system: Node)` method (lines 29-39) that `game_hud.gd:173` calls
  (`_research_panel.setup(_research_tree_panel.get_research_system())`), reads
  `_research_system.get_entries()`/`is_available()`, and its click handler
  (`_on_entry_card_input`, lines 181-189) calls `_research_system.start_research(entry_id)`
  directly — same client-local pattern as `research_tree_view.gd`, needs the same
  `CommandQueue.submit("START_RESEARCH", ...)` reroute.
- **`research_panel.gd`** (46 lines) has the Infantry/Artillery/Armoured/Air/Naval/Economy
  sub-tab shell (manual `HBoxContainer`/`Pages` visibility toggling, not a real `TabContainer`)
  but **has no `setup()` method and never references `ResearchSystem` at all** — `game_hud.gd`'s
  `_research_panel.setup(...)` call is guarded by `has_method("setup")`, so if `_research_panel`
  actually points at this file's scene, that call silently no-ops. **This means either (a)
  `research_panel.gd`'s scene is currently dead/unwired UI with sub-tabs that do nothing, or (b)
  `game_hud.gd`'s `_research_panel` variable is actually bound to `research_drawer_panel.gd`'s
  scene despite the name.** Confirm which by reading `game_hud.gd`'s exact `_research_panel`
  instantiation/preload line **before writing any code that touches either file** — this
  determines whether Branch A's "Full Tree" work targets `research_tree_view.gd`/
  `research_tree.tscn` (confirmed live, registered `"research_tree"` FULL_CENTER) plus fixing up
  `research_panel.gd`'s orphaned sub-tab shell, or something simpler.

### `game_hud.gd` — panel registration + hotkey (do not touch)

```gdscript
158: _dock_btn_q.pressed.connect(_make_dock_toggle("research"))
189: hud_manager.register_panel("research", _research_panel, HUDManager.PlacementMode.SIDE_DOCKED)
190: hud_manager.register_panel("research_tree", _research_tree_panel, HUDManager.PlacementMode.FULL_CENTER)
434: hud_manager.set_panel_shortcut("research", KEY_Q)
```
Live binding is `KEY_Q → "research"`, not `Y` per `UI_UX_DESIGN.md`'s documented table — same
pre-existing drift Phase 9 flagged and left alone. **This branch does not touch hotkeys or
panel registration**, only what each panel renders and how it talks to the server.

### `game_state.gd` / `event_bus.gd` / `session_manager.gd` — wiring pattern to follow

No `research`-related field or `_apply_research_updates` exists yet (confirmed, zero grep hits
in `game_state.gd`). Sibling pattern to copy exactly (`game_state.gd:160-199`-ish):
```gdscript
func _apply_reserve_updates(data: Dictionary) -> void:
    reserve = data.get("reserve", {})
```
New: `research: Dictionary = {}` state var + `_apply_research_init(data)` /
`_apply_research_updates(data)` methods, same one-line-unpack-then-emit shape.
`event_bus.gd:64-68` already has four **client-local-prototype** signals
(`research_started/progress_changed/completed/rejected`) — add one new **server-driven** signal,
`signal research_updated()` (parameterless, matching `resources_updated()`), right after line 68.
`session_manager.gd`'s `match type:` (starts line 15) gets two new arms:
```gdscript
"RESEARCH_INIT":
    GameState._apply_research_init(data)
"RESEARCH_UPDATES":
    GameState._apply_research_updates(data)
```
inserted the same way `"RESERVE_UPDATES"` (lines 101-102) sits before `"MARKET_UPDATES"` (104).

### Client JSON-load idiom to copy (`client/src/systems/map/map_loader.gd:596-610`)

```gdscript
func _load_json(path: String) -> Variant:
    if not FileAccess.file_exists(path):
        push_warning("MapLoader: file not found — %s" % path)
        return {}
    var file := FileAccess.open(path, FileAccess.READ)
    if file == null:
        push_warning("MapLoader: cannot open — %s" % path)
        return {}
    var text := file.get_as_text()
    file.close()
    var result: Variant = JSON.parse_string(text)
    if result == null:
        push_warning("MapLoader: JSON parse error — %s" % path)
        return null
    return result
```
The new research JSON loader (client-side) copies this exact idiom, reading
`res://assets/data/research/<branch>.json`.

### `command_queue.gd` — unchanged, reused as-is (`client/src/core/command_queue.gd:12-21`)

```gdscript
func submit(type: String, payload: Dictionary) -> void:
    if not AuthManager.is_logged_in():
        command_rejected.emit(type, "Not authenticated"); return
    if NetManager.get_connection_state() != "connected":
        command_rejected.emit(type, "Not connected to server"); return
    NetManager.send_command(type, payload)
```

### `division_builder_panel.gd` — hook point for Branch D, not touched this branch (`division_builder_panel.gd:24-30, 541-543`)

```gdscript
const ELIGIBLE_UNITS: Array = [
    ["recon_infantry", "force_recon_sniper", "cavalry", "armoured_car", "light_tank", "commando"],
    ["medium_tank", "heavy_tank", "assault_infantry", "infantry", "at_gun_sp", "self_propelled_gun"],
    ["artillery", "howitzer", "at_gun", "mg", "aa_gun", "flamethrower"],
    ["infantry", "assault_infantry", "at_infantry", "commando", "sniper"],
    ["infantry", "mg", "at_infantry", "sniper"],
]
```
Static, not data-driven — confirmed zero "research" references anywhere in this file. Branch D
will filter/extend these per-row lists against research-unlocked state; Branch A's job is only
to make sure the underlying query function exists (Step 4) for Branch D to call later.

---

## Files to Create

| File | Purpose |
|---|---|
| `client/assets/data/research/armour.json` | Real content: motorisation, mechanisation, APC, improved_apc, IFV nodes |
| `client/assets/data/research/infantry.json`, `ordnance.json`, `air.json`, `economy_buildings.json`, `general.json` | Sample/placeholder content, a handful of nodes each, proving the engine handles multiple branches/mutex/badges |
| `client/assets/data/research/naval.json` | Empty array — explicit stub, per Phase 11's own scope excluding Naval |
| `game-server/src/data/research_tree_loader.ts` | Reads the JSON files above, validates schema, builds in-memory node/adjacency structure; throws on bad/missing schema (same defensive pattern as `building_stats.ts`) |
| `game-server/src/systems/research_system.ts` | `Map<nation_id, NationResearchData>`, `tick()` (flat placeholder progress rate), `startResearch()`, `cancelResearch()`, respec handling, `resolveLineageUnitType()` |
| `game-server/test/11a-research-tree-foundation.test.ts` | All Branch A server tests |
| `client/src/systems/research/research_tree_data_loader.gd` | Client JSON loader, feeds `research_system.gd.load_from_definitions()` |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/schema/GameRoomState.ts` | `NationState`: add `active_research_count: number = 0` |
| `game-server/src/types/tactical_types.ts` | `UnitType`: add `IMPROVED_APC`, `IFV` |
| `game-server/src/data/unit_combat_stats.ts` | Add `improved_apc`, `ifv` entries |
| `game-server/src/data/unit_production_stats.ts` | Add matching `improved_apc`, `ifv` entries (`produced_by: "tank_plant"`) |
| `game-server/src/data/perks.ts` | Add Armoured-branch `PERK_REGISTRY` entries for mechanisation-chain modifier effects; add small sample entries for other branches' sample nodes |
| `game-server/src/rooms/GameRoom.ts` | New `researchSystem` instance + `gameTick()` hookup; `RESEARCH_INIT` broadcast in `startGame()`; `START_RESEARCH`/`CANCEL_RESEARCH` handlers |
| `game-server/test-lanes.json` | New `research` lane |
| `game-server/package.json` | Append `11a` test to the test chain |
| `client/src/systems/research/research_tree_view.gd` | Swap scene-walk data source (lines 18-35) for JSON loader; reroute `_on_entry_pressed` (line 111) through `CommandQueue.submit` |
| `client/src/systems/research/research_system.gd` | Becomes a display cache reflecting `GameState.research`, not sole authority (see Step 8) |
| `client/scenes/systems/research/research_tree.tscn` | Remove the 9 placeholder cards + 3 headers |
| `client/src/ui/hud/research_drawer_panel.gd` | Reroute `_on_entry_card_input` (line 188) through `CommandQueue.submit` |
| `client/src/core/game_state.gd` | New `research: Dictionary` + `_apply_research_init()`, `_apply_research_updates()` |
| `client/src/core/event_bus.gd` | New `research_updated()` signal |
| `client/src/systems/session/session_manager.gd` | New `match` arms: `RESEARCH_INIT`, `RESEARCH_UPDATES` |

---

## Step 1: JSON tree definition schema + sample content (TDD)

### 1a. Schema (documented, not enforced by a type system across the JSON boundary — validated at load time)

Each `client/assets/data/research/<branch>.json` is an array of:
```jsonc
{
  "id": "armour_mechanisation_apc",
  "branch": "armour",              // Infantry|Ordnance|Armour|Air|Naval|Economy|General
  "unit_id": "mechanised_infantry", // which sub-tree within the branch this belongs to
  "path_id": "mechanisation",
  "tier": 2,
  "mutex_group_id": null,           // non-null groups render as one bracketed choice row
  "name": "Armoured Personnel Carrier",
  "description": "Half-track transport for mechanised infantry...",
  "cost": { "money": 0, "science": 0 },   // Branch A placeholder — real values land in Branch B
  "badges": ["lineage"],            // any of: mechanic, lineage, redistribute, additive
  "size": "notable",                // minor | notable
  "requires": ["armour_mechanisation_medium_tank"],
  "image_asset": "res://assets/icons/table-cells-solid-full.svg", // placeholder, per user note
  "effects": [
    { "type": "unlocks_unit_type", "unit_type": "mechanised_infantry" }
  ]
}
```
`effects` entries are one of two shapes only, this branch:
- `{ "type": "perk", "perk_id": "..." }` — completion pushes `perk_id` into
  `nation.researched_perks`; resolution is already handled by the existing
  `PERK_REGISTRY`/`resolvePerkModifiers()` pipeline for anything stat-modifier-shaped. A
  `perk_id` used here **must** have a matching `PERK_REGISTRY` entry (Step 6 adds the Armoured
  ones) — the loader should warn (not throw) on a `perk_id` with no registry entry, since sample
  branches may deliberately reference not-yet-designed effects.
- `{ "type": "unlocks_unit_type", "unit_type": "..." }` — lineage-chain reveal; resolved by
  `resolveLineageUnitType()` (Step 4), not by `researched_perks`/`PERK_REGISTRY` at all.

### 1b. Write failing tests

Keep this to the load-bearing cases only — the loader's happy path doesn't need a test per
branch file, one is enough:

```typescript
// game-server/test/11a-research-tree-foundation.test.ts
describe("lane:research | Research tree JSON loader", () => {
  it("loads every branch file without throwing, naval.json included as a valid empty array", () => {});
  it("throws on a node whose 'requires' references a nonexistent node_id", () => {});
  it("armour.json contains the full motorisation->mechanisation->apc->improved_apc->ifv chain, each requiring the previous", () => {});
});
```
Run just this file (see Context's test-running note) — must FAIL (module doesn't exist yet).

### 1c. Implement `game-server/src/data/research_tree_loader.ts`

Follow `building_stats.ts`'s defensive accessor pattern. Reads each JSON file via the same
relative-path idiom `_initProvinces()`/`subprovince_loader.ts` already use
(`join(__dir, "../..", "..", "client", "assets", "data", "research", "<branch>.json")`), builds
`Map<node_id, ResearchNodeDef>` plus per-branch adjacency (which tier-N node's completion
unlocks which tier-N+1 nodes, same-path and same-tier-adjacent-path, per `RESEARCH.md`'s
adjacency-web rule), throws on the failure modes in 1b's tests.

### 1d. Author content

**Armour (real):** motorisation is a General-Technology-flavored standalone node (per
`TACTICAL_COMBAT.md`, not part of the Armoured branch's own path structure) — place it in
`general.json` with `unit_id: "motorisation"`, `effects: [{"type":"perk","perk_id":"motorisation_unlocked"}]`
(Branch D's DivisionBuilder toggle checks for this perk id, no `PERK_REGISTRY` entry needed
since it's a pure existence-check, not a stat modifier). Armoured branch itself
(`armour.json`): Light Tank / Medium Tank / Heavy Tank as three tier-1 paths (mirroring
`TACTICAL_COMBAT.md`'s tree diagram), Medium Tank's path continuing into Mechanised Infantry
(APC half-track) → Improved APC → IFV as a lineage chain (`badges: ["lineage"]` on all three,
`effects: [{"type":"unlocks_unit_type", ...}]`).

**Every other branch (sample only):** 3-5 nodes each, deliberately exercising different
features — at least one `mutex_group_id` choice point somewhere in the sample set (to prove the
UI/mechanism handles it), a mix of badge combinations, one `minor` and one `notable` size. Do
not present these as balanced or final — a code comment atop each sample file should say so
explicitly (`// SAMPLE CONTENT — placeholder, not final balance. Real content: a future,
separate authoring pass.`).

### 1e. Run — must PASS.

**Manual verification:** none — pure data, fully covered by 1b's tests.

---

## Step 2: `NationState.active_research_count` + off-schema `NationResearchData`

### 2a. Tests

```typescript
describe("lane:research | NationState + ResearchSystem state", () => {
  it("new nation starts with active_research_count 0 and empty NationResearchData", () => {});
});
```
(`init()` idempotency is trivial plumbing — verify it by reading the implementation, not a
dedicated test.)

### 2b. Implement

`GameRoomState.ts`: add `@type("number") active_research_count: number = 0;` to `NationState`
(declared here, meaningfully populated once Branch B's concurrency cost curve reads it — this
branch just needs it to exist and increment/decrement correctly).

```typescript
// research_system.ts
export interface ResearchProgress {
  node_id: string;
  points_remaining: number;
  points_total: number;
}
export interface NationResearchData {
  nation_id: string;
  researched_node_ids: Set<string>;   // distinct from researched_perks — tracks NODES, not perk_ids,
                                        // since a node's effect may be unlocks_unit_type, not a perk
  active_projects: ResearchProgress[]; // concurrent research, no hard slot limit (RESEARCH.md)
}
```

**Manual verification:** none yet.

---

## Step 3: `ResearchSystem.tick()` — flat placeholder progress rate

### 3a. Tests

```typescript
describe("lane:research | Research tick (placeholder rate, no currency)", () => {
  it("multiple concurrent projects for the same nation all progress simultaneously, independently — no hard slot limit", () => {
    // RESEARCH.md: concurrency is a soft cost cap (Branch B), never a hard slot limit this branch
  });
  it("on completion: node added to researched_node_ids, and a perk effect pushes perk_id into nation.researched_perks", () => {});
});
```
(Flat per-tick decrement and the per-nation-only broadcast are simple enough to confirm by
reading the implementation once it's written, rather than asserting separately.)

### 3b. Implement

```typescript
const RESEARCH_PROGRESS_PER_TICK_PLACEHOLDER = 1.0; // TBD — replaced by Branch B's real
                                                       // currency-funded rate; flat so this
                                                       // branch's mechanism is independently testable

export class ResearchSystem {
  private data = new Map<string, NationResearchData>();
  init(nationId: string): void { /* idempotent */ }
  startResearch(nationId: string, nodeId: string): boolean { /* prerequisite + mutex checks, see Step 5 */ }
  cancelResearch(nationId: string, nodeId: string): void { /* removes from active_projects, no refund this branch — Branch B adds the refund math */ }
  tick(state: GameRoomState, broadcast: BroadcastFn): void {
    for (const [nationId, data] of this.data) {
      const completed: ResearchProgress[] = [];
      for (const project of data.active_projects) {
        project.points_remaining = Math.max(0, project.points_remaining - RESEARCH_PROGRESS_PER_TICK_PLACEHOLDER);
        if (project.points_remaining <= 0) completed.push(project);
      }
      if (completed.length === 0) continue;
      data.active_projects = data.active_projects.filter(p => !completed.includes(p));
      const nation = state.nations.get(nationId);
      for (const project of completed) {
        data.researched_node_ids.add(project.node_id);
        this._applyNodeEffects(nation, project.node_id); // pushes perk_ids into researched_perks
      }
      nation.active_research_count = data.active_projects.length;
      broadcast("RESEARCH_UPDATES", { nation_id: nationId, /* serialized data */ });
    }
  }
}
```

**Manual verification:** none yet — Step 8 wires the UI.

---

## Step 4: Lineage-chain fallback — `resolveLineageUnitType()`

### 4a. Tests

```typescript
describe("lane:research | Lineage-chain fallback (RESEARCH.md's 'no template ever breaks' guarantee)", () => {
  it("a template referencing mechanised_infantry with nothing researched resolves to mechanised_infantry (the base)", () => {});
  it("after researching improved_apc, the same template resolves to improved_apc, live, no re-save needed", () => {});
  it("after researching ifv, resolves to ifv — the highest currently-researched tier, never a mid-chain value if the top is researched", () => {});
  it("un-researching improved_apc (hypothetically, e.g. future respec) falls back to mechanised_infantry, never straight to an unspecialised non-chain base", () => {});
});
```

### 4b. Implement

```typescript
// Ordered lineage chains — a template referencing ANY entry resolves to the highest
// currently-researched entry in its chain. Explicit array (not derived from JSON at runtime)
// keeps this fast and simple; the JSON tree defines WHEN each tier unlocks, this defines the
// chain ORDER once unlocked — two different concerns, deliberately not merged.
const LINEAGE_CHAINS: Record<string, string[]> = {
  mechanised_infantry: ["mechanised_infantry", "improved_apc", "ifv"],
};

export function resolveLineageUnitType(researchedNodeIds: Set<string>, requestedUnitType: string): string {
  const chain = Object.values(LINEAGE_CHAINS).find(c => c.includes(requestedUnitType));
  if (!chain) return requestedUnitType; // not a lineage type at all — pass through unchanged
  let resolved = chain[0];
  for (const tier of chain) {
    if (tier === chain[0] || researchedNodeIds.has(/* the node_id that unlocks `tier` */ tier)) {
      resolved = tier;
    }
  }
  return resolved;
}
```
**Call site — locate before implementing, do not guess.** Grep `game-server/src` for
`UNIT_COMBAT_STATS\[` and every other direct consumer of a grid cell's `unit_type` for combat/
movement stat lookups. If a single shared accessor function already exists (mirroring
`getBuildingStats`/`getExtractionStats`'s pattern), wrap resolution there — one choke point. If
call sites are inconsistent, wrap at the highest common entry point you can find (likely
wherever a `DivisionState.grid` cell's `unit_type` is first read for combat resolution) and flag
in a code comment any call site you could not route through the wrapper, so a later branch does
not assume 100% coverage silently.

**Manual verification (required):** bot-script or manually drive: raise a division templated
with `mechanised_infantry`, confirm it fields as `mechanised_infantry`. Research `improved_apc`
(via `APPLY_PERKS`-equivalent test harness or the real `START_RESEARCH` flow once Step 5 lands)
— confirm the same division's effective combat stats update to `improved_apc`'s values without
re-saving the template.

---

## Step 5: `START_RESEARCH` / `CANCEL_RESEARCH` handlers, prerequisite + mutex + respec logic

### 5a. Tests

Only the genuinely load-bearing, easy-to-get-wrong cases — skip the trivially-obvious ones
(no-op on an already-active node, rejecting a cancel on a non-active node) unless implementation
reveals they're not actually trivial:

```typescript
describe("lane:research | START_RESEARCH prerequisites and adjacency", () => {
  it("a tier-2 node is rejected until its requires[] node is researched", () => {});
  it("unlocking a tier unlocks the next tier same-path AND the same-tier adjacent-path node, per RESEARCH.md's adjacency-web rule", () => {});
});
describe("lane:research | Mutex tiers and respec", () => {
  it("starting a mutex-group node when a DIFFERENT option in that group is already RESEARCHED (respec case): the old node stays in researched_node_ids/researched_perks for the full duration of the new research — no downtime", () => {});
  it("on the new node's completion, the old mutex sibling is atomically removed from researched_node_ids and, if it had a perk effect, from researched_perks — live-recompute drops it immediately from every division using it", () => {});
});
describe("lane:research | CANCEL_RESEARCH", () => {
  it("cancelling an in-progress (not yet completed) project removes it from active_projects, progress resets to 0 — re-starting later begins from scratch", () => {});
});
```

### 5b. Implement

Ownership-guard shape identical to `RAISE_DIVISION` (Critical Pre-Read). `startResearch`
prerequisite check reads `requires[]` against `researched_node_ids`; mutex check finds any other
`researched_node_ids` member sharing `mutex_group_id` and, if found, marks the *new* project with
a `respec_displaces: node_id` field (not a separate code path — same `active_projects` list,
just carrying one extra field) so `tick()`'s completion handler (Step 3b) knows to atomically
remove the old node/perk at that exact moment, matching `RESEARCH.md`'s respec sequencing
precisely: *old perk stays fully active for the entire duration, un-researched only the instant
the new one completes, no refund.*

**Manual verification:** covered together with Step 8's UI checkpoint below.

---

## Step 6: `PERK_REGISTRY` additions for Armoured mechanisation effects

Add entries for whichever Armoured-chain nodes carry stat-modifier effects (e.g. a
`mechanisation_suppression_resist` perk for the APC step, matching `TACTICAL_COMBAT.md`'s
"cannot be fully suppressed by MG fire alone" description) — reuse the exact
`PerkDefinition`/`modifiers` shape already in `perks.ts`, `applies_to_unit` targeting the
relevant lineage unit type. Add a small number of sample entries for other branches' sample
nodes too, enough to prove a non-Armoured node can carry a real, live-resolved perk effect.

**Manual verification:** covered by Step 8.

---

## Step 7: `test-lanes.json` / test chain

```json
"research": {
  "source_prefixes": ["src/systems/research_system.ts", "src/data/research_tree_loader.ts"],
  "tests": ["test/11a-research-tree-foundation.test.ts"]
}
```
Append to `package.json`'s test chain (for whenever a later branch/integration pass does run the
full suite) but do not run `npm test` yourself as part of this branch — confirm this branch's
own work with the targeted `research` lane file only
(`npx mocha -r tsx test/11a-research-tree-foundation.test.ts --exit --timeout 180000`).

---

## Step 8: Client — JSON loader, real server sync, retire toy content

### 8a. `research_tree_data_loader.gd` (new)

```gdscript
extends RefCounted
## Loads research tree node definitions from client/assets/data/research/<branch>.json,
## mirroring MapLoader._load_json's exact idiom.

const RESEARCH_DATA_DIR := "res://assets/data/research/"
const BRANCHES := ["armour", "infantry", "ordnance", "air", "naval", "economy_buildings", "general"]

static func load_all_definitions() -> Array:
    var all_definitions: Array = []
    for branch: String in BRANCHES:
        var path := RESEARCH_DATA_DIR + branch + ".json"
        if not FileAccess.file_exists(path):
            push_warning("ResearchTreeDataLoader: file not found — %s" % path)
            continue
        var file := FileAccess.open(path, FileAccess.READ)
        var text := file.get_as_text()
        file.close()
        var parsed: Variant = JSON.parse_string(text)
        if not parsed is Array:
            push_warning("ResearchTreeDataLoader: expected array — %s" % path)
            continue
        all_definitions.append_array(parsed)
    return all_definitions
```
Field-name note: the JSON schema (Step 1a) uses `name`/`branch` where the existing
`research_system.gd.load_from_definitions()` expects `title`/`column` (its current Dictionary
shape, per the Critical Pre-Read of the parent overview) — either add a small key-remap here, or
extend `load_from_definitions()` to accept both. Prefer the remap (keeps `research_system.gd`
untouched, smaller diff) unless the remap starts feeling like it's fighting the schema, in which
case updating `load_from_definitions()`'s expected keys directly is also fine — execution
agent's call, but pick one and be consistent, don't support both key sets silently.

### 8b. `research_tree_view.gd` — swap source, reroute clicks

Replace `_ready()`'s scene-walk (lines 18-35) with a call to
`ResearchTreeDataLoader.load_all_definitions()` fed into the existing
`_research_system.load_from_definitions(definitions)`. Change `_on_entry_pressed` (line 111)
from calling `_research_system.start_research(entry_id)` directly to
`CommandQueue.submit("START_RESEARCH", {"node_id": entry_id})`. The local `research_system.gd`
sim's own `start_research()` becomes unused for the real flow (keep it — `client/test/
research_system_test.gd` still exercises it directly, and it remains useful as an offline/
preview tool) but **the live click path no longer calls it**.

### 8c. `research_drawer_panel.gd` — same reroute

`_on_entry_card_input` (line 188): `_research_system.start_research(entry_id)` →
`CommandQueue.submit("START_RESEARCH", {"node_id": entry_id})`.

### 8d. `game_state.gd` / `event_bus.gd` / `session_manager.gd` wiring

Per the Critical Pre-Read section above — `research: Dictionary`, `_apply_research_init()`,
`_apply_research_updates()`, `research_updated()` signal, two new `match` arms.

### 8e. Reconcile local prototype display with server truth

`research_system.gd`'s `get_entry_state()`/`is_researched()`/`get_progress_ratio()` currently
read its own `_completed_entries`/`_progress_by_id` dicts, populated only by its own
`start_research()`/`advance()`. Once clicks route through the server (8b/8c) instead, those
local dicts stop updating from local play — **this branch must also make `research_system.gd`
consume `GameState.research`/`EventBus.research_updated` to refresh its display state**, so the
UI reflects server truth, not a frozen local snapshot. Smallest correct change: connect to
`EventBus.research_updated` and, on fire, overwrite `_completed_entries`/`_progress_by_id`
from `GameState.research`'s contents (a sync, not a re-simulation) — do not attempt to make the
server drive `advance()`/tick timing locally; the server's `RESEARCH_UPDATES` broadcasts are the
only source of progress-bar truth now.

### 8f. Resolve the `research_panel.gd` vs `research_drawer_panel.gd` discrepancy

Per the Critical Pre-Read flag — read `game_hud.gd`'s actual `_research_panel` instantiation
before writing 8c. If `research_panel.gd`'s scene turns out to be genuinely dead/unregistered
code, note that finding plainly (do not silently delete it — flag it for the user to decide,
same "investigate before deleting" caution as unfamiliar files anywhere else) and proceed with
`research_drawer_panel.gd` as the real sidebar. If instead `_research_panel` really is bound to
`research_panel.gd`'s scene, its dead sub-tab shell needs *some* minimal wiring this branch to
avoid regressing what currently renders — smallest fix: make it delegate to the same
`ResearchSystem`/`GameState.research` data source the drawer uses, sub-tabs filtering by
`branch`. Report which case was true in the branch's completion notes either way.

**Manual verification (required, this branch's primary visual checkpoint):** run the Godot
client, open the Research sidebar (`Q`, per the live — not documented — binding), confirm real
Armoured content renders (not the old Infantry/Tank/Air toy nodes), confirm Infantry/Ordnance/
Air/Naval/Economy render their sample content (not empty, not crashed) and Naval renders the
explicit empty-stub state. Click a real Available node (e.g. Light Tank Chassis) — confirm it
starts, progress ticks visibly (flat rate, no cost check), and completes. Open Full Tree, select
the Armour unit, confirm the same real chain is visible there too. Research Mechanised Infantry
→ Improved APC — confirm (per Step 4's verification) a fielded division's stats update live.

---

## Manual UI Checkpoint — ASCII reference (Branch A's minimal, not-yet-polished state)

Branch A does **not** implement `RESEARCH_UI_HANDOFF.md`'s IN PROGRESS/NEW/AVAILABLE sections,
badges, or popups (that's Branch C) — the existing flat sidebar list and grid-based Full Tree
stay structurally as they are today, just fed real data. What you should actually see:

```
Sidebar (research_drawer_panel.gd) — existing flat "available" list, real data:
┌─ RESEARCH ─────────────────┐
│ [Full Tree]            [X] │
├─────────────────────────────┤
│ Light Tank Chassis          │
│ Armour · Tier 1 · RP 4      │
├─────────────────────────────┤
│ Medium Tank Chassis         │
│ Armour · Tier 1 · RP 4      │
├─────────────────────────────┤
│ Heavy Tank Chassis          │
│ Armour · Tier 1 · RP 4      │
├─────────────────────────────┤
│ Motorisation                │
│ General · Tier 1 · RP 4     │
└─────────────────────────────┘
  (click starts research immediately — Branch C adds the Confirm/Cancel popup)
```

```
Full Tree (research_tree_view.gd) — existing 3-column grid, real Armour content replaces toy nodes:
┌─ RESEARCH TREE ──────────────────────────────────────────┐
│                                                       [X] │
├────────────────────────────────────────────────────────┤
│  Light Tank      Medium Tank      Heavy Tank              │
│  ┌────────┐      ┌────────┐      ┌────────┐               │
│  │Chassis │      │Chassis │      │Chassis │               │
│  └───┬────┘      └───┬────┘      └────────┘               │
│      │               │                                     │
│  ┌───┴────┐      ┌───┴──────────┐                          │
│  │ Rough  │      │ Mechanised   │ ← unlocks_unit_type       │
│  │Terrain │      │ Infantry(APC)│    effect                │
│  └────────┘      └───┬──────────┘                          │
│                       │                                     │
│                   ┌───┴──────────┐                          │
│                   │ Improved APC │ ← lineage badge ▣         │
│                   └───┬──────────┘                          │
│                       │                                     │
│                   ┌───┴──────────┐                          │
│                   │     IFV      │                          │
│                   └──────────────┘                          │
└────────────────────────────────────────────────────────────┘
  (still the existing GridContainer layout, no pan/zoom/Fit yet — Branch C adds that)
```

```
Naval branch — explicit empty stub (per RESEARCH_UI_HANDOFF.md §4.5's intent, minimal form):
┌─ RESEARCH TREE — Naval ─────────────────────────────┐
│                                                  [X] │
├───────────────────────────────────────────────────┤
│              No research content yet.                │
│         Naval doctrine trees are not in scope         │
│                for this build.                        │
└───────────────────────────────────────────────────┘
```

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| `compute_stats` needs to be built from scratch as a new stats pipeline | **Wrong** — `resolvePerkModifiers()`/`combat_system.ts` already live-recompute perk-shaped effects from `researched_perks` on every read; this branch only adds the lineage-chain resolution layer on top, it does not replace or duplicate the existing pipeline |
| Per-node research progress belongs on `NationState` as new Colyseus schema fields | **Wrong** — mirrors `DivisionState.grid`'s precedent exactly: plain server-side `Map`, broadcast via explicit `RESEARCH_INIT`/`RESEARCH_UPDATES`, not native schema reactivity. Only `researched_perks` (already existed) and the new `active_research_count` are real schema |
| `research_panel.gd` is the live "Full Tree" panel | **Unconfirmed, possibly wrong** — investigation found it has no `setup()` and never touches `ResearchSystem`; `research_tree_view.gd`/`research_tree.tscn` (registered `"research_tree"`, FULL_CENTER) is the confirmed-live Full Tree. Verify `game_hud.gd`'s actual `_research_panel` binding before assuming either way (§ Critical Pre-Read) |
| `ResearchSystem` (client) is an autoload/singleton | **Wrong** — confirmed zero autoload entries; it's one scene-owned instance (`research_tree.tscn`'s `%ResearchSystem` child), shared into the drawer via `setup()` injection |
| A node's `effects` need a brand-new effect-resolution system | **Wrong** — `{"type":"perk",...}` reuses the existing `PERK_REGISTRY` pipeline entirely; only `{"type":"unlocks_unit_type",...}` (lineage reveal) is genuinely new, and that's a lookup-table resolution, not a modifier system |
| Motorisation belongs inside `armour.json` since `TACTICAL_COMBAT.md` discusses it in the same section | **Wrong per that same doc** — Motorisation is explicitly "a standalone research node in the General Technology panel (not part of any unit specialisation tree)" — place it in `general.json` |
| Branch A should implement the real money+science cost check | **Wrong, deliberately** — Branch A uses a flat placeholder progress rate with zero cost, proving the tree mechanism stands on its own before Branch B wires real currency on top, mirroring Phase 9 Branch A's seeded-placeholder-money pattern |
| `DivisionBuilder`'s `ELIGIBLE_UNITS` list should be gated by research in this branch | **Wrong** — that's explicitly Branch D's job; this branch only needs to expose `resolveLineageUnitType`/an availability query function for Branch D to call later |
