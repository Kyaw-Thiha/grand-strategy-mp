# Branch A — `feat/economy-foundation`

## Context

First branch of Phase 9 (see `phase-9-economy-buildings.md` for the full branch list,
merge order, and deferred-scope table — read it first, this file assumes it). Nothing else
merges before this one. It establishes: the schema split decided in the overview (national
resource/reserve/industry-alloc fields as real Colyseus schema on `NationState`; per-province
buildings/resource-deposits as a plain server-side structure broadcast manually, mirroring
the existing `DivisionState.grid` precedent), the `BUILD_BUILDING` command and parallel
per-slot construction timer, and the client-side shell every later branch's UI plugs into
(Province Detail modal, Production sidebar panel, and fixing the two already-dead UI
placeholders — `economy_panel`'s stub and `friendly_province_panel`'s `"--"` labels).

**No perk trees, no `[Path >]` UI anywhere in this branch or this phase** — every building
below has exactly one level-scaling base effect, per the phase-wide scope cut in the
overview.

**Assumption this branch depends on and must verify, not silently work around:** by the time
this branch is implemented, `client/assets/data/<map_id>/map_data.json` already carries the
10-key `resources` abundance envelope (`money, grain, iron, oil, rubber, nitrates, tungsten,
chromium, aluminium, uranium`) and the 18-key `buildings` dict (`fort, port, airbase,
supply_hub, factory, barracks, tank_plant, ordnance_factory, aircraft_factory, school,
hospital, warehouse, shipyard, town_hall, res_grain, res_iron, res_oil, res_rubber,
res_nitrates, res_tungsten, res_chromium, res_aluminium, res_uranium`) per
`MAP_DATA_CONTRACT.md`. **Step 0 below is a mandatory verification step — if the map file
still has the old 6-key/5-key placeholder shape, stop and report it before writing any other
code.**

**Test-Driven Development is mandatory for every server step below.** Write the failing
test first, run it, confirm it fails for the right reason, then implement.

---

## Critical Pre-Read

### Current `NationState` / `ProvinceState` / `DivisionState.grid` (`game-server/src/rooms/schema/GameRoomState.ts`)

```typescript
28: export class NationState extends Schema {
29:   @type("string")   nation_id: string  = "";
30:   @type("string")   player_id: string  = "";
31:   @type("boolean")  is_ready: boolean  = false;
32:   @type(["string"]) researched_perks   = new ArraySchema<string>();
33: }
35: export class ProvinceState extends Schema {
36:   @type("string") province_id: string = "";
37:   @type("string") owner_id: string = "";
38:   @type("number") industry:            number = 50;
39:   @type("number") population:          number = 50;
40:   @type("number") infrastructure:      number = 50;
41:   @type("number") oil_bombed_until_ms: number = 0;
42:   @type("number") naval_base_level: number = 0;
43: }
```
`DivisionState.grid` (line 71): `grid: DivisionGridState = new DivisionGridState(); //
server-side only — not schema-synced` — the direct precedent this branch's
`ProvinceEconomyData` design copies. Grid data reaches clients only via explicit
`DIVISION_UPDATES` broadcasts + `GameState._apply_division_updates()`, never through native
Colyseus field reactivity. Do the same for buildings/resource-deposits.

### `_initProvinces()` — current dead resources stub (`GameRoom.ts:2236-2270`)

```typescript
2236: private _initProvinces(mapId: string): void {
        const __dir = dirname(fileURLToPath(import.meta.url));
        const dataPath = join(__dir, "../..", "..", "client", "assets", "data", mapId, "map_data.json");
        try {
          const raw = getCachedFile<{
            provinces: Array<{
              province_id:     string;
              nation_id:       string;
              city_position?:  [number, number];
              population?:     number;
              industry?:       number;
              infrastructure?: number;
              resources?:      { oil?: number };   // ← DEAD, never read below. Remove this line's
            }>;                                    //   narrow shape; replace with the real 10-key/18-key
            adjacency?: Array<{ from_province: string; to_province: string }>;
          }>(dataPath);
          for (const p of raw.provinces ?? []) {
            if (!p.province_id) continue;
            const slot = new ProvinceState();
            slot.province_id = p.province_id;
            slot.owner_id    = p.nation_id ?? "";
            if (p.population     !== undefined) slot.population     = p.population;
            if (p.industry       !== undefined) slot.industry       = p.industry;
            if (p.infrastructure !== undefined) slot.infrastructure = p.infrastructure;
            this.state.provinces.set(p.province_id, slot);
            // ... city_position lookup unchanged ...
          }
          this.state.provinceNeighbors = buildProvinceNeighbors(raw.adjacency ?? []);
        } catch { /* ... */ }
      }
```
`p.resources?.oil` is declared in the TypeScript shape but never assigned to anything — this
is the exact stale stub this branch replaces with real reads of the full `resources` and
`buildings` objects, feeding the new `ProvinceEconomyData` map (§ Step 3), not `ProvinceState`
itself.

### Server tick loop and system-instantiation pattern (`GameRoom.ts`)

```typescript
74:  const TICK_MS = 1000;
...
85:  private movementSystem   = new MovementSystem();
86:  private combatSystem     = new CombatSystem(this.movementSystem);
87:  private supplySystem     = new SupplySystem();
89:  private airWingLifecycleSystem = new AirWingLifecycleSystem();
...
1312: this.clock.setInterval(() => this.gameTick(), TICK_MS);
...
1473: private gameTick() {
1474:   if (this.state.phase !== "running") return;
1475:   this.tickCount++;
        ...
1483:   this.movementSystem.tick(this.state);
1485:   const combatChanged = this.combatSystem.tick(this.state, this.tickCount, (type, msg) => {
          this.broadcast(type, msg);
          ...
        });
        ...
1501:   const supplyChanged = this.supplySystem.tick(this.state, this.tickCount, (type, msg) => this.broadcast(type, msg));
1502:   this.frontlineSystem.tick(this.state, this.tickCount, (type, msg) => this.broadcast(type, msg));
```
One server tick = 1 real second. New system: `private economyBuildingSystem =
new EconomyBuildingSystem();` added alongside line 85-89's block; its `.tick(...)` call added
inside `gameTick()`'s `try` block, after the `supplySystem.tick(...)` line, same
`(type, msg) => this.broadcast(type, msg)` callback shape as every other system already uses.

### `startGame()` sequence (`GameRoom.ts:1252-1295`) — where province economy gets seeded and broadcast once

```typescript
1252: private startGame() {
1253:   this.state.phase = "running";
        ...
1262:   this._initProvinces(this.state.map_id);
        ...
1269:   this._initRelations();
1270:   this.broadcastRelations();
        this.spawnDivisions();
        this.spawnAirWings();
        this.broadcast("GAME_STARTED", { /* ... */ });
        // Send initial province ownership so clients can validate RELOCATE targets immediately
1286:   const provinceOwners: Record<string, string> = {};
        for (const [pid, province] of this.state.provinces) {
          if (province.owner_id) provinceOwners[pid] = province.owner_id;
        }
1291:   this.broadcast("PROVINCE_INIT", { provinces: provinceOwners });
```
`PROVINCE_INIT` (line 1291) is the direct naming/shape precedent for the new
`PROVINCE_ECONOMY_INIT` broadcast this branch adds right after it — same
`Record<province_id, X>` payload shape. **Known limitation, inherited, not introduced by
this branch:** exactly like `DivisionState.grid`, a client that joins mid-game (after
`startGame()` has already run) has no reconnect/late-snapshot path in the current codebase —
`onJoin()` (line 827) only creates a `PlayerState` and broadcasts lobby state, it does not
resend any off-schema game data. Do not attempt to fix this here; it is a pre-existing gap
shared by every off-schema system in this codebase.

### Command handler pattern — `ASSIGN_TEMPLATE` (`GameRoom.ts:140-176`), template for `BUILD_BUILDING`

```typescript
140: this.onMessage("ASSIGN_TEMPLATE", (_client, msg: {
       division_id: string; template_id: string;
       cells: Array<{ cell_index: number; unit_type: string }>;
     }) => {
       const div = this.state.divisions.get(msg.division_id);
       if (!div) return;
       if (["engaged", "retreating", "suppressed"].includes(div.combat_state)) return;
       // ... mutate, recompute derived fields ...
175:   this.broadcast("DIVISION_UPDATES", { divisions: [this.serializeDivision(div)] });
     });
```
`CREATE_WING` (`GameRoom.ts:462-493`) additionally shows the **ownership-guard** shape needed
for `BUILD_BUILDING` (a province-scoped action, same as a home-airbase-scoped action):
```typescript
469: const player = this.state.players.get(client.sessionId);
     if (!player) return;
471: const nation = this.getNationForPlayer(player.userId);
     if (!nation) return;
473: const province = this.state.provinces.get(msg.home_airbase_province_id);
     if (!province || province.owner_id !== nation.nation_id) return;
```
`BUILD_BUILDING` follows this exact shape: resolve `client` → `player` → `nation` →
`province`, guard `province.owner_id === nation.nation_id`, then mutate
`this.provinceEconomy.get(province_id)` (not Colyseus state) and broadcast
`BUILDING_UPDATES`.

### Client — `economy_panel.gd` (full current file, 15 lines) and its `game_hud.gd` registration

```gdscript
1  extends PanelContainer
2  ## Economy panel — side-docked, placeholder for Phase 9.
5  signal close_requested()
7  @onready var _close_button: Button = %CloseButton
10 func _ready() -> void:
11     _close_button.pressed.connect(func() -> void: close_requested.emit())
14 func cycle_sub_tab(forward: bool) -> void:
15     pass  # No sub-tabs yet
```
`.tscn` node tree today: `EconomyPanel(PanelContainer) > Margin > VBox > [Header(HBox:
AccentBar, Title, CloseButton>Icon), ContentBody(VBox: Spacer, Placeholder(Label))]` — no
`TabBar`/`TabButtons` nodes exist. `game_hud.gd` registration:
```gdscript
35:  @onready var _economy_panel: Control = $EconomyPanel
108: _dock_btn_e.pressed.connect(_make_dock_toggle("economy"))
112: _connect_side_drawer_close("economy", _economy_panel)
134: hud_manager.register_panel("economy", _economy_panel, HUDManager.PlacementMode.SIDE_DOCKED)
314: hud_manager.set_panel_shortcut("economy", KEY_E)
546: "economy":   return _dock_btn_e   # (dock-button lookup match)
```
**Existing hotkey mismatch, not in scope to fix:** `game_hud.gd`'s actual live bindings are
`KEY_Q → "research"`, `KEY_E → "economy"`, `KEY_R → "military"`, `KEY_T → "diplomacy"` — this
does not match `UI_UX_DESIGN.md`'s documented Q=Military/E=Economy/T=Diplomacy/Y=Research
table 1:1. Do not attempt to reconcile this pre-existing drift as part of this branch; only
add the new Production panel's own binding (see Step 8) without touching the existing four.

### `hud_manager.gd` public API (`client/src/ui/hud/hud_manager.gd`)

```gdscript
12:  enum PlacementMode { SIDE_DOCKED, FULL_CENTER }
131: func register_panel(panel_name: String, panel_node: Node,
                         placement: PlacementMode = PlacementMode.SIDE_DOCKED) -> void:
155: func set_panel_shortcut(panel_name: String, physical_keycode: int) -> void:
172: func show_panel(panel_name: String) -> void:
202: func hide_panel(panel_name: String) -> void:
235: func toggle_panel(panel_name: String) -> void:
252: func is_panel_open(panel_name: String) -> bool:
259: func get_open_panel() -> String:
```
`FULL_CENTER` panels close whatever `SIDE_DOCKED` panel was open and restore it on close;
`SIDE_DOCKED` panels close any other open `SIDE_DOCKED` panel (only one visible at a time).

### `military_panel.gd` tab pattern — template for Economy's and Production's tabs

```gdscript
13: const _CONTENT_PATH: String = "Margin/VBox/ContentBody"
36: func _setup_tab_buttons() -> void:
      var tc: TabContainer = get_node_or_null(_CONTENT_PATH + "/TabBar") as TabContainer
      var tab_btns: HBoxContainer = get_node_or_null(_CONTENT_PATH + "/TabButtons") as HBoxContainer
      if tc == null or tab_btns == null: return
      var btn_group := ButtonGroup.new()
      for i: int in range(tab_btns.get_child_count()):
        var btn: Button = tab_btns.get_child(i) as Button
        btn.button_group = btn_group
        btn.pressed.connect(_on_tab_button_pressed.bind(i))
      tc.tab_changed.connect(_sync_tab_button)
49: func _on_tab_button_pressed(idx: int) -> void:
      var tc := get_node_or_null(_CONTENT_PATH + "/TabBar") as TabContainer
      if tc != null: tc.current_tab = idx
55: func _sync_tab_button(idx: int) -> void:
      var tab_btns := get_node_or_null(_CONTENT_PATH + "/TabButtons") as HBoxContainer
      if tab_btns == null or idx >= tab_btns.get_child_count(): return
      (tab_btns.get_child(idx) as Button).button_pressed = true
62: func cycle_sub_tab(forward: bool) -> void:
      var tabs_node := get_node_or_null(_CONTENT_PATH + "/TabBar")
      if tabs_node == null or not tabs_node is TabContainer: return
      var tabs: TabContainer = tabs_node as TabContainer
      var count: int = tabs.get_tab_count()
      if count <= 1: return
      tabs.current_tab = posmod(tabs.current_tab + (1 if forward else -1), count)
```
`.tscn` convention: a `TabContainer` named `TabBar` (children = one Control per tab) sits
beside a sibling `HBoxContainer` named `TabButtons` (children = plain `Button`s, index-matched
to tab order), both under `Margin/VBox/ContentBody`. `cycle_sub_tab(forward)` is the required
method name — `HUDManager`'s Tab-key routing calls it by that name on whichever panel is open.

### `friendly_province_panel.gd` — the placeholder block this branch fixes for real

```gdscript
32: _btn_upgrade      = get_node_or_null("Margin/HBox/ActionsBlock/BtnUpgrade")
33: _btn_build_radar  = get_node_or_null("Margin/HBox/ActionsBlock/BtnBuildRadar")
34: _btn_manage_prod  = get_node_or_null("Margin/HBox/ActionsBlock/BtnManageProd")
...
81: # Resources show placeholder dashes until Phase 9 economy data feeds in
82: if _steel_val != null:     _steel_val.text = "--"
84: if _manpower_val != null:  _manpower_val.text = "--"
86: if _buildings_val != null: _buildings_val.text = "--"
```
Other node paths in the same panel: `Margin/HBox/StatsBlock/StatsGrid/{IndustryVal,
PopulationVal, InfrastructureVal, OilStatus}`. **No button currently has a `.pressed.connect`
anywhere in this file** — this branch adds one for `_btn_manage_prod` (opens the new
Production panel) and leaves `_btn_upgrade`/`_btn_build_radar` alone (out of scope: upgrade
happens via Province Detail per the UI handoff §9, and `BtnBuildRadar` is a military-building
action, not part of this phase).

### FULL_CENTER modal pattern — `division_builder_panel.gd` / `game_hud.gd`, template for Province Detail

```gdscript
# division_builder_panel.gd
11:  signal close_requested()
80:  func _ready() -> void:
85:    EventBus.division_builder_open_requested.connect(_on_open_requested)
86:    close_requested.connect(func() -> void: EventBus.division_builder_closed.emit())
140:   close_btn.pressed.connect(func() -> void: close_requested.emit())

# game_hud.gd
47:  var _division_builder_panel: Control
51:  const _DivisionBuilderScene := preload("res://scenes/game/panels/division_builder_panel.tscn")
140: _division_builder_panel = _DivisionBuilderScene.instantiate()
141: add_child(_division_builder_panel)
142: _register_ui_input_ownership_root(_division_builder_panel)
143: hud_manager.register_panel("division_builder", _division_builder_panel, HUDManager.PlacementMode.FULL_CENTER)
144: EventBus.division_builder_open_requested.connect(func(_template_id: String) -> void:
153:   hud_manager.show_panel("division_builder")
     )
155: EventBus.division_builder_closed.connect(func() -> void:
156:   hud_manager.hide_panel("division_builder")
     )
160: if _division_builder_panel.has_signal("close_requested"):
161:   _division_builder_panel.connect("close_requested", func() -> void:
162:     hud_manager.hide_panel("division_builder")
       )
```

### `game_state.gd` apply pattern + `session_manager.gd` dispatch (template for `_apply_resource_updates` / `_apply_building_updates`)

```gdscript
# game_state.gd
107: func _apply_division_updates(data: Dictionary) -> void:
108:   for div_data: Dictionary in data.get("divisions", []):
109:     var div_id: String = div_data.get("division_id", "")
110:     if div_id.is_empty() or not divisions.has(div_id): continue
112:     var existing: Dictionary = divisions[div_id]
113:     for key: String in div_data: existing[key] = div_data[key]
...
122:   EventBus.division_updated.emit(div_id)

# session_manager.gd
14:  func _on_server_event(type: String, data: Dictionary) -> void:
15:    match type:
         ...
46:      "DIVISION_UPDATES":
47:        GameState._apply_division_updates(data)
```
New message types get one new `match` arm each, one line, calling a new
`GameState._apply_*` method.

### `command_queue.gd` `submit()` (full, `client/src/core/command_queue.gd:12-21`)

```gdscript
12: func submit(type: String, payload: Dictionary) -> void:
13:   if not AuthManager.is_logged_in():
        command_rejected.emit(type, "Not authenticated"); return
17:   if NetManager.get_connection_state() != "connected":
        command_rejected.emit(type, "Not connected to server"); return
21:   NetManager.send_command(type, payload)
```

### `client/scenes/game/panels/` — confirmed empty for this branch's new scenes

No `production_panel.tscn` or `province_detail_panel.tscn` exists anywhere in the repo.
Existing sibling scenes to model after: `military_panel.tscn` (tabs), `division_builder_panel.tscn`
(FULL_CENTER modal), `economy_panel.tscn` (needs `TabBar`/`TabButtons` added).

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/src/data/building_stats.ts` | 18 building types: kind, `construction_points` per level 1-5, resource cost vector per level |
| `game-server/src/systems/economy_building_system.ts` | `Map<province_id, ProvinceEconomyData>`, `tick()` (parallel construction progress), `handleBuild()` |
| `game-server/test/9a-economy-foundation.test.ts` | All Branch A server tests |
| `client/src/ui/hud/production_panel.gd` | New FULL_CENTER-style... **no** — SIDE_DOCKED per UI handoff §7 ("new sidebar entry"), tabs Templates/Reserve/Naval, empty tab bodies this branch, real content in later branches |
| `client/scenes/game/panels/production_panel.tscn` | Scene for the above, mirrors `military_panel.tscn`'s TabBar/TabButtons layout |
| `client/src/ui/hud/province_detail_panel.gd` | New FULL_CENTER modal, building rows (Build/Upgrade), no `[Path>]` |
| `client/scenes/game/panels/province_detail_panel.tscn` | Scene for the above, mirrors `division_builder_panel.tscn`'s modal structure |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/schema/GameRoomState.ts` | `NationState`: add `resources`, `manpower_available`, `manpower_ceiling`, `reserve_pool`, `industry_alloc` fields |
| `game-server/src/rooms/GameRoom.ts` | New `economyBuildingSystem` instance + `gameTick()` hookup; `_initProvinces()`'s dead `resources?: { oil?: number }` stub replaced; new `_initProvinceEconomy()`; `PROVINCE_ECONOMY_INIT` broadcast in `startGame()`; `BUILD_BUILDING` handler; `_initNationEconomy()` resource-seeding call |
| `game-server/test-lanes.json` | New `economy` lane |
| `game-server/package.json` | Append `9a` test to the test chain |
| `client/src/core/game_state.gd` | New `resources: Dictionary`, `province_economy: Dictionary` state + `_apply_resource_updates()`, `_apply_building_updates()`, `_apply_province_economy_init()` |
| `client/src/core/event_bus.gd` | New `resources_updated`, `province_economy_updated` signals |
| `client/src/systems/session/session_manager.gd` | New `match` arms: `RESOURCE_UPDATES`, `BUILDING_UPDATES`, `PROVINCE_ECONOMY_INIT` |
| `client/src/ui/hud/economy_panel.gd` / `.tscn` | Add `TabBar`/`TabButtons` (Resources tab only this branch, real numbers wired in Branch B), real `cycle_sub_tab()` |
| `client/src/ui/hud/friendly_province_panel.gd` / `.tscn` | Replace `"--"` dashes with real `BuildingsRow` (icon list, empty province = no icons), wire `_btn_manage_prod.pressed` to open Production panel |
| `client/src/ui/hud/game_hud.gd` | Instantiate + register `production_panel` and `province_detail_panel`; new dock button + hotkey for Production; wire `EventBus.province_detail_open_requested` |

---

## Step 1: `building_stats.ts` data table (TDD)

### 1a. Write failing tests

```typescript
// game-server/test/9a-economy-foundation.test.ts
import assert from "assert";
import { describe, it } from "mocha";
import { getBuildingStats, BUILDING_TYPES } from "../src/data/building_stats.js";

describe("lane:economy | Building stats table", () => {
  it("has all 18 building types", () => {
    assert.strictEqual(BUILDING_TYPES.length, 18);
  });
  it("iron_mine construction_points increase per level", () => {
    const stats = getBuildingStats("iron_mine");
    for (let i = 1; i < stats.construction_points_by_level.length; i++) {
      assert.ok(stats.construction_points_by_level[i] > stats.construction_points_by_level[i - 1]);
    }
  });
  it("unknown building type throws, not silently returns a default", () => {
    assert.throws(() => getBuildingStats("not_a_real_building"));
  });
});
```
Run — must FAIL (module doesn't exist yet).

### 1b. Implement `game-server/src/data/building_stats.ts`

Follow the exact `Record<string, X>` + accessor pattern already established in
`game-server/src/data/air_unit_stats.ts` (interface, `STAT_TABLE` const, `getXStats()`
function). 18 keys, one per `bld_*`/`bld_res_*` field name from `MAP_DATA_CONTRACT.md`:
`fort, port, airbase, supply_hub, factory, barracks, tank_plant, ordnance_factory,
aircraft_factory, school, hospital, warehouse, shipyard, town_hall, iron_mine, grain_farm,
oil_derrick, rubber_plantation, nitrate_works, tungsten_mine, chromium_mine, bauxite_refinery,
uranium_mine`.

**Edge case — this is 22 keys, not 18.** `MAP_DATA_CONTRACT.md`'s `bld_*` field list (14
entries: `fort, port, airbase, supply_hub, factory, barracks, tank_plant, ordnance_factory,
aircraft_factory, school, hospital, warehouse, shipyard, town_hall`) plus its `bld_res_*`
field list (8 entries: `res_grain, res_iron, res_oil, res_rubber, res_nitrates, res_tungsten,
res_chromium, res_aluminium, res_uranium` — **that's actually 9**, not 8; count them again
against the live doc before hardcoding a number in a test). **Do not trust the "18" figure
stated in prose anywhere in this plan or the design docs — count the actual field list in
`MAP_DATA_CONTRACT.md` at implementation time and use that as the source of truth for
`BUILDING_TYPES.length`.** `fort`/`port`/`airbase`/`supply_hub` are military buildings out of
`ECONOMY_BUILDINGS.md`'s scope (see that doc's "Out of Scope" section) — **do not implement
their base effects in this phase**, but they still need `building_stats.ts` entries (at least
a `construction_points` cost) purely so `buildings{}` round-trips through the pipeline/schema
without a missing-key error; their actual gameplay effect stays whatever it already is
(fort/supply_hub have none implemented yet regardless of this phase).

`construction_points_by_level`: 5 values (levels 1-5), monotonically increasing, explicitly
placeholder/TBD-playtesting per project convention (`unit_production_handoff.md`'s "do not
invent values, use clearly-named placeholders" rule) — pick a simple increasing sequence
(e.g. `[100, 180, 280, 400, 550]`) and comment it as `// TBD playtesting — placeholder curve`.

`resource_cost_by_level`: `Partial<Record<ResourceType, number>>[]`, same TBD-placeholder
status, small values (e.g. money-only cost for civilian buildings, money+iron for resource
extraction buildings) — comment identically.

### 1c. Run — must PASS.

**Manual verification:** none — pure data table, fully covered by 1a's tests.

---

## Step 2: Schema additions on `NationState`

### 2a. Write failing tests

```typescript
describe("lane:economy | NationState economy fields", () => {
  it("new nation starts with zero resources, seeded starting money", async () => {
    // Spawn a nation via existing test harness (SPAWN_NATION or startGame flow)
    // Assert nation.resources.get("money") > 0 (seeded), nation.resources.get("iron") === 0
  });
  it("reserve_pool and industry_alloc start empty", async () => {
    // Assert nation.reserve_pool.size === 0, nation.industry_alloc.size === 0
  });
});
```

### 2b. Add fields to `NationState` in `GameRoomState.ts`

```typescript
export class NationState extends Schema {
  @type("string")   nation_id: string  = "";
  @type("string")   player_id: string  = "";
  @type("boolean")  is_ready: boolean  = false;
  @type(["string"]) researched_perks   = new ArraySchema<string>();
  @type({ map: "number" }) resources     = new MapSchema<number>();
  @type("number")           manpower_available: number = 0;
  @type("number")           manpower_ceiling:   number = 0;
  @type({ map: "number" }) reserve_pool   = new MapSchema<number>();
  @type({ map: "number" }) industry_alloc = new MapSchema<number>();
}
```
`reserve_pool` and `industry_alloc` are declared here (Branch A) but populated by Branch C
and Branch B respectively — this branch only needs them to exist so later branches don't
touch `GameRoomState.ts` again for a field that's conceptually "national economy state."

### 2c. Seed starting resources — `_initNationEconomy()`

New private method in `GameRoom.ts`, called once from `startGame()` right after
`_initProvinces()`. For every entry in `this.state.nations`, set a small starting `money`
value (e.g. `500`, commented `// TBD playtesting — starting stockpile placeholder`) and leave
every other resource at `0`. **Why seed money specifically:** Branch A's own verification gate
(build/upgrade a building) needs to be testable standalone, before Branch B's resource
production ticks exist — without a starting stockpile, `BUILD_BUILDING` would be permanently
unaffordable until Branch B merges, which breaks this branch's own test independence.

### 2d. Run — must PASS.

**Manual verification:** none yet (no UI reads `resources` until Step 8).

---

## Step 3: `EconomyBuildingSystem` — province economy map + parallel construction tick

### 3a. Types

```typescript
// game-server/src/systems/economy_building_system.ts
export interface ConstructionProjectData {
  building_type: string;
  target_level: number;          // level being constructed TOWARD (current_level + 1)
  points_remaining: number;      // counts down to 0
  points_total: number;          // for progress % display
}

export interface ProvinceEconomyData {
  province_id: string;
  buildings: Record<string, number>;          // building_type -> current level, 0 = not built
  resource_deposits: Record<string, number>;  // resource_type -> abundance, read-only after init
  construction_queue: ConstructionProjectData[]; // one entry per building_type currently under construction
}
```

### 3b. Write failing tests first

```typescript
describe("lane:economy | EconomyBuildingSystem parallel construction", () => {
  it("two different buildings in the same province construct simultaneously, independent progress", () => {
    // Start construction on building A and building B in the same province same tick
    // Tick N times
    // Assert both have nonzero, DIFFERENT progress if their construction_points differ,
    // and neither blocks the other (no shared "one construction slot" behavior)
  });
  it("construction completes when points_remaining reaches 0, building level increments, queue entry removed", () => {});
  it("cannot start a second construction project on a building_type already under construction", () => {});
  it("effective_construction_rate uses base_construction_rate(infrastructure) x 1.0 (industry pool multiplier stubbed) in this branch", () => {
    // Two provinces with different `infrastructure` values, same building_type/level started same tick
    // Higher-infrastructure province's project completes in fewer ticks
  });
});
```

### 3c. Implement

```typescript
const BASE_CONSTRUCTION_RATE_MIN = 1.0;   // TBD playtesting — placeholder curve
const BASE_CONSTRUCTION_RATE_RANGE = 2.0; // TBD playtesting — placeholder curve

function baseConstructionRate(infrastructureLevel: number): number {
  return BASE_CONSTRUCTION_RATE_MIN + (infrastructureLevel / 100) * BASE_CONSTRUCTION_RATE_RANGE;
}

export class EconomyBuildingSystem {
  private provinceEconomy = new Map<string, ProvinceEconomyData>();

  init(provinceId: string, buildings: Record<string, number>, resourceDeposits: Record<string, number>): void {
    this.provinceEconomy.set(provinceId, { province_id: provinceId, buildings, resource_deposits: resourceDeposits, construction_queue: [] });
  }

  getAll(): Map<string, ProvinceEconomyData> { return this.provinceEconomy; }
  get(provinceId: string): ProvinceEconomyData | undefined { return this.provinceEconomy.get(provinceId); }

  startConstruction(provinceId: string, buildingType: string, infrastructureLevel: number): ConstructionProjectData | null {
    const econ = this.provinceEconomy.get(provinceId);
    if (!econ) return null;
    if (econ.construction_queue.some(p => p.building_type === buildingType)) return null; // already in progress
    const currentLevel = econ.buildings[buildingType] ?? 0;
    if (currentLevel >= 5) return null; // level cap
    const stats = getBuildingStats(buildingType);
    const points = stats.construction_points_by_level[currentLevel]; // level N->N+1 uses index N (0-based, level 1 = index 0)
    const project: ConstructionProjectData = {
      building_type: buildingType, target_level: currentLevel + 1,
      points_remaining: points, points_total: points,
    };
    econ.construction_queue.push(project);
    return project;
  }

  /** Called once per gameTick. industryConstructionMultiplier is 1.0 until Branch B wires the real Industry Pool slice. */
  tick(
    provinces: Map<string, { infrastructure: number }>, // pass state.provinces directly — only .infrastructure is read
    industryConstructionMultiplier: number,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    for (const [provinceId, econ] of this.provinceEconomy) {
      if (econ.construction_queue.length === 0) continue;
      const infra = provinces.get(provinceId)?.infrastructure ?? 50;
      const rate = baseConstructionRate(infra) * industryConstructionMultiplier;
      const completed: ConstructionProjectData[] = [];
      for (const project of econ.construction_queue) {
        project.points_remaining = Math.max(0, project.points_remaining - rate);
        if (project.points_remaining <= 0) {
          econ.buildings[project.building_type] = project.target_level;
          completed.push(project);
        }
      }
      if (completed.length > 0) {
        econ.construction_queue = econ.construction_queue.filter(p => !completed.includes(p));
        broadcast("BUILDING_UPDATES", { province_id: provinceId, buildings: econ.buildings, construction_queue: econ.construction_queue });
      }
    }
  }
}
```
**Edge case — level-1 cost indexing.** `construction_points_by_level[currentLevel]` when
`currentLevel = 0` (building doesn't exist yet) reads index `0`, i.e. the cost to reach level
1 — confirm `building_stats.ts`'s array is ordered `[cost_to_reach_L1, cost_to_reach_L2, ...,
cost_to_reach_L5]`, not `[cost_at_L1, cost_at_L2, ...]`; get this indexing wrong and every
building will be off by one level's cost.

### 3d. Wire into `GameRoom.ts`

```typescript
// alongside line 85-89's block:
private economyBuildingSystem = new EconomyBuildingSystem();

// inside gameTick(), after the existing supplySystem.tick(...) line:
const constructionMultiplier = 1.0; // TODO Branch B: read state.nations.get(...).industry_alloc.get("construction_speed")
this.economyBuildingSystem.tick(this.state.provinces, constructionMultiplier, (type, msg) => this.broadcast(type, msg));
```
**Note for execution agent:** `economyBuildingSystem.tick()` needs an infrastructure lookup
per province but has no concept of *which* nation's multiplier to apply — because the
construction-speed multiplier is a **per-nation** Industry Pool slice (each nation allocates
its own pool), not global. In this branch the multiplier is hardcoded to `1.0` for everyone,
so this doesn't matter yet, but **flag this in a code comment** so Branch B's execution agent
knows `tick()`'s signature will need to change to accept a per-province-owner lookup, not a
single global number — do not let Branch B's agent be surprised by this.

---

## Step 4: Wire `_initProvinces()` to load buildings/resources, broadcast `PROVINCE_ECONOMY_INIT`

### 4a. Update the raw JSON shape read in `_initProvinces()`

Replace the dead `resources?: { oil?: number }` line with the real shape:
```typescript
buildings?:  Record<string, number>;
resources?:  Record<string, number>;
```
Inside the `for (const p of raw.provinces ?? [])` loop, after `this.state.provinces.set(...)`,
add:
```typescript
this.economyBuildingSystem.init(p.province_id, p.buildings ?? {}, p.resources ?? {});
```

**Verification checkpoint (do this before writing anything else in this step):** open the
actual `client/assets/data/<map_id>/map_data.json` in use and confirm a real province entry's
`buildings` object has all the documented keys (even if many are `0`) and `resources` has all
10 documented keys. **If either object still has the old key set (5-key buildings, 6-key
resources per the old placeholder), stop — this branch's assumption has not been met yet,
report it rather than building against stale data.**

### 4b. Broadcast `PROVINCE_ECONOMY_INIT` in `startGame()`

Immediately after the existing `PROVINCE_INIT` broadcast (line ~1291):
```typescript
const economySnapshot: Record<string, { buildings: Record<string, number>; resource_deposits: Record<string, number> }> = {};
for (const [pid, econ] of this.economyBuildingSystem.getAll()) {
  economySnapshot[pid] = { buildings: econ.buildings, resource_deposits: econ.resource_deposits };
}
this.broadcast("PROVINCE_ECONOMY_INIT", { provinces: economySnapshot });
```

### 4c. Tests

```typescript
describe("lane:economy | Province economy init", () => {
  it("every province loaded from map_data.json has a matching ProvinceEconomyData entry", () => {});
  it("PROVINCE_ECONOMY_INIT broadcast fires once on game start with every province's buildings+deposits", () => {});
});
```

**Manual verification:** none yet — no client code reads this until Step 7.

---

## Step 5: `BUILD_BUILDING` command handler

### 5a. Tests first

```typescript
describe("lane:economy | BUILD_BUILDING handler", () => {
  it("owner can start construction on their own province, resource cost deducted immediately", () => {});
  it("non-owner request is silently ignored, no state change", () => {});
  it("insufficient resources rejects the request, no construction_queue entry created", () => {});
  it("requesting the same building_type twice while already under construction is a no-op the second time", () => {});
  it("requesting a building already at level 5 is rejected", () => {});
});
```

### 5b. Implement handler in `GameRoom.ts`

Follow the `CREATE_WING` ownership-guard shape exactly (§ Critical Pre-Read):
```typescript
this.onMessage("BUILD_BUILDING", (client, msg: { province_id: string; building_type: string }) => {
  if (this.state.phase !== "running") return;
  const player = this.state.players.get(client.sessionId);
  if (!player) return;
  const nation = this.getNationForPlayer(player.userId);
  if (!nation) return;
  const province = this.state.provinces.get(msg.province_id);
  if (!province || province.owner_id !== nation.nation_id) return;

  const econ = this.economyBuildingSystem.get(msg.province_id);
  if (!econ) return;
  const currentLevel = econ.buildings[msg.building_type] ?? 0;
  const stats = getBuildingStats(msg.building_type);
  const cost = stats.resource_cost_by_level[currentLevel]; // same 0-based "cost to reach next level" indexing as Step 3

  for (const [resType, amount] of Object.entries(cost)) {
    if ((nation.resources.get(resType) ?? 0) < amount) return; // insufficient — reject silently, client already knows its own stockpile
  }

  const project = this.economyBuildingSystem.startConstruction(msg.province_id, msg.building_type, province.infrastructure);
  if (!project) return; // already in progress or at cap

  for (const [resType, amount] of Object.entries(cost)) {
    nation.resources.set(resType, (nation.resources.get(resType) ?? 0) - amount);
  }

  this.broadcast("BUILDING_UPDATES", { province_id: msg.province_id, buildings: econ.buildings, construction_queue: econ.construction_queue });
});
```
**Edge case — resource deduction happens at construction START, not completion.** This
matches `ECONOMY_BUILDINGS.md`'s "costs resources and time" framing (both paid up front, time
is what construction_points models) — do not defer the resource deduction to when
construction completes.

**Manual verification:** none yet — Province Detail UI wiring happens in Step 9.

---

## Step 6: `test-lanes.json` — new `economy` lane

Add, following the exact object shape `movement`/`core` already use:
```json
"economy": {
  "source_prefixes": ["src/systems/economy_", "src/data/building_stats.ts"],
  "tests": ["test/9a-economy-foundation.test.ts"]
}
```
Update `game-server/package.json`'s test chain to append `9a` after whatever currently runs
last, same `&& NODE_ENV=test mocha -r tsx test/9a-economy-foundation.test.ts --exit --timeout
180000` shape Air's branches use. Run full suite: `cd game-server && npm test` — 9a passes
alongside every existing lane.

---

## Step 7: Client — `GameState` / `EventBus` / `session_manager.gd` wiring

### 7a. `game_state.gd` new state + apply methods

```gdscript
var resources: Dictionary = {}          # resource_type -> amount, this player's own nation only
var province_economy: Dictionary = {}   # province_id -> { "buildings": {...}, "resource_deposits": {...}, "construction_queue": [...] }

func _apply_province_economy_init(data: Dictionary) -> void:
    var provinces: Dictionary = data.get("provinces", {})
    for pid: String in provinces:
        province_economy[pid] = provinces[pid]
    EventBus.province_economy_updated.emit("")  # empty id = bulk update, matches no specific province

func _apply_building_updates(data: Dictionary) -> void:
    var pid: String = data.get("province_id", "")
    if pid.is_empty():
        return
    if not province_economy.has(pid):
        province_economy[pid] = {}
    province_economy[pid]["buildings"] = data.get("buildings", {})
    province_economy[pid]["construction_queue"] = data.get("construction_queue", [])
    EventBus.province_economy_updated.emit(pid)

func _apply_resource_updates(data: Dictionary) -> void:
    for key: String in data.get("resources", {}):
        resources[key] = data["resources"][key]
    EventBus.resources_updated.emit()
```
Mirror `_apply_division_updates`'s style exactly (§ Critical Pre-Read) — key-by-key merge
into an existing dict when one exists, direct assign when it doesn't, one `EventBus` emit at
the end.

**Note:** `RESOURCE_UPDATES` itself isn't broadcast by any server code until Branch B (nothing
produces resources yet in this branch) — `_apply_resource_updates` is written now so Branch B
doesn't need to touch `game_state.gd`'s dispatch wiring again, only add the server-side
broadcast calls.

### 7b. `event_bus.gd` — new signals

```gdscript
signal resources_updated()
signal province_economy_updated(province_id: String)  # empty string = bulk/multi-province update
```

### 7c. `session_manager.gd` — new `match` arms

```gdscript
"PROVINCE_ECONOMY_INIT":
    GameState._apply_province_economy_init(data)
"BUILDING_UPDATES":
    GameState._apply_building_updates(data)
"RESOURCE_UPDATES":
    GameState._apply_resource_updates(data)
```

**Manual verification:** none yet — nothing renders these until Step 8/9.

---

## Step 8: Client — `economy_panel.gd`/`.tscn` real tab shell

### 8a. `.tscn` changes

Inside `Margin/VBox/ContentBody`, replace the current `Spacer`/`Placeholder(Label)` with a
`TabBar` (`TabContainer`) + sibling `TabButtons` (`HBoxContainer`), mirroring
`military_panel.tscn`'s structure exactly (§ Critical Pre-Read). One tab this branch:
`Resources`. (Industry and My Trade tabs are added by Branch B and Branch D respectively —
build `TabBar`/`TabButtons` generically enough that adding a second/third tab later is a
`.tscn` edit only, no `.gd` structural change.)

### 8b. `economy_panel.gd` rewrite

```gdscript
extends PanelContainer

signal close_requested()

@onready var _close_button: Button = %CloseButton
@onready var _resources_list: VBoxContainer = %ResourcesList  # container for one row per resource

const RESOURCE_ORDER := ["money", "grain", "iron", "oil", "rubber", "nitrates", "tungsten", "chromium", "aluminium", "uranium"]

func _ready() -> void:
    _close_button.pressed.connect(func() -> void: close_requested.emit())
    _setup_tab_buttons()  # copy verbatim from military_panel.gd, same _CONTENT_PATH constant
    EventBus.resources_updated.connect(_refresh_resources)
    _refresh_resources()

func cycle_sub_tab(forward: bool) -> void:
    # copy verbatim from military_panel.gd

func _refresh_resources() -> void:
    for child in _resources_list.get_children():
        child.queue_free()
    for res_type: String in RESOURCE_ORDER:
        var amount: float = GameState.resources.get(res_type, 0.0)
        var row := Label.new()
        row.text = "%s   %s" % [res_type.capitalize(), str(int(amount))]
        _resources_list.add_child(row)
```
**This branch renders a plain stockpile number per resource, no net-rate (`+N/t`), no
bar-fill, no manpower row.** Those are Branch B's job (it's the branch that actually produces
a rate to display) — this branch's job is only to prove the pipe from server `resources`
MapSchema through to a visible number works end-to-end.

**Manual verification (required, cannot be scripted):** run the Godot client, press `E`,
confirm the Economy panel opens showing a `Resources` tab with ten rows, `Money` showing the
seeded starting value (e.g. `500`) and every other resource at `0`. Press `E` again — panel
closes. This is the first genuinely visual checkpoint in this branch.

---

## Step 9: Client — Production panel (new, empty tab shells) + Province Detail modal (new, functional)

### 9a. Production panel — SIDE_DOCKED, new dock button

Create `client/src/ui/hud/production_panel.gd` + `client/scenes/game/panels/production_panel.tscn`,
structurally identical to `economy_panel.gd`'s new `TabBar`/`TabButtons` shell (§8a), three
tabs this branch: `Templates`, `Reserve`, `Naval` — **all three render an empty placeholder
label this branch** ("No templates yet." / "No Reserve data yet." / "Naval production not yet
available."). Real content lands in Branch C (Templates + Reserve) and never in this phase
(Naval — deferred per the overview's scope cut).

`game_hud.gd` wiring: add a new dock button (find the existing `_dock_btn_q/e/r/t` block and
add `_dock_btn_p` following the identical pattern), register the panel
(`hud_manager.register_panel("production", _production_panel, HUDManager.PlacementMode.SIDE_DOCKED)`),
and assign a hotkey. **Before hardcoding a key, grep `game_hud.gd` for every existing
`set_panel_shortcut(...)` call to confirm nothing already uses it** (§ Critical Pre-Read
already flagged the existing Q/E/R/T mismatch — do not assume the `UI_UX_DESIGN.md` table is
accurate without checking the live code first). Default to `KEY_P` (mnemonic, not in the
documented reserved set `U`/`I` for Politics/Espionage) unless the grep finds a conflict —
this exact placement question is flagged as unresolved in `plans/economy_production_ui_handoff.md`
§11 item 2, so there is no existing decision to preserve, only a new one to make and record.

### 9b. Province Detail modal — FULL_CENTER, opened from Provinces list or `friendly_province_panel`

This branch does not build the "Provinces sidebar list" (`plans/economy_production_ui_handoff.md`
§3's left list) — that's flagged as an open placement question in the same handoff doc §11
item 1 and isn't load-bearing for this branch's verification gate. Instead, wire the modal's
only entry point this branch needs: `friendly_province_panel`'s existing `BtnUpgrade` button
(previously unwired) now opens Province Detail for the currently-selected province.

Create `client/src/ui/hud/province_detail_panel.gd` + matching `.tscn`, following the
`division_builder_panel.gd` FULL_CENTER open/close pattern exactly (§ Critical Pre-Read):
`close_requested` signal, `EventBus.province_detail_open_requested(province_id: String)` /
`EventBus.province_detail_closed`, registered `FULL_CENTER` in `game_hud.gd`.

Content — one row per building type present in `GameState.province_economy[pid].buildings`
(all of them, level 0 shown as `Build`, level ≥1 shown as `Upgrade` — no filtering, this
differs slightly from the UI handoff §3's "only level ≥1 or could-build" framing since there's
no reason to hide a level-0 building the player might want; keep every documented building
type visible always):

```
+----------------------------------------+
| ESSEN                             [X]  |
| Germany | Pop 64 | Ind 58 | Infra 71   |
+----------------------------------------+
| BUILDINGS                              |
|  Iron Mine        Lv 3/5  [Upgrade]    |
|  Warehouse        Lv 1/5  [Upgrade]    |
|  Barracks         Lv 0/5  [Build]      |
|  Tank Plant       Lv 0/5  [Build]      |
|  School           Lv 0/5  [Build]      |
|  Hospital         Lv 0/5  [Build]      |
|  Infrastructure   Lv 2/5  [Upgrade]    |
|  ... (one row per building type)       |
+----------------------------------------+
```
**No `[Path >]` / `(fixed)` column at all this phase** — deliberately different from
`plans/economy_production_ui_handoff.md` §3's mockup, which was written before the "no perk
trees this phase" scope cut. Each row's button emits `CommandQueue.submit("BUILD_BUILDING",
{"province_id": pid, "building_type": building_type})` — the same `submit()` shape quoted in
Critical Pre-Read, no new command-submission pattern needed.

**Button state while under construction:** if `building_type` appears in
`GameState.province_economy[pid].construction_queue`, disable the row's button and show
progress (`points_total - points_remaining) / points_total` as a percentage) instead of
`Build`/`Upgrade` — read live from `EventBus.province_economy_updated` so progress visibly
ticks as `BUILDING_UPDATES` broadcasts arrive (once per server tick while construction is
active, per Step 3's `tick()` only broadcasting on completion — **note this means progress
bars will NOT visibly animate smoothly in this branch**, since `tick()` as written in Step 3
only broadcasts `BUILDING_UPDATES` when a project *completes*, not every tick it progresses.
**This is a deliberate simplification for Branch A** — a smoothly-animating progress bar
needs either a broadcast every tick (bandwidth cost across every province with active
construction, every second) or client-side local-time extrapolation from `points_total`/
known start time. Pick the cheaper option: broadcast on every tick where
`construction_queue` is non-empty, not only on completion — remove the `if (completed.length >
0)` guard around the broadcast in Step 3c and broadcast unconditionally whenever the queue is
non-empty. Flagging here because Step 3c as written above under-broadcasts; fix it before
Step 9 depends on it.

**Manual verification (required):** open Province Detail for an owned province, click
`Build` on a level-0 building, confirm money decreases in the Economy panel (Step 8), confirm
the row switches to a disabled progress state, watch it visibly progress and eventually
complete, confirm the level badge updates to `1/5` and the button reverts to `Upgrade`.
Start two different buildings' construction in the same province — confirm both progress
bars advance independently and neither blocks the other (this is the "parallel, not
sequential" verification gate from `ECONOMY_BUILDINGS.md`'s `construction_points` section).

### 9c. On-map compact HUD BUILDINGS row (`friendly_province_panel.gd`)

Replace the dead `_buildings_val.text = "--"` line (§ Critical Pre-Read) with a real icon row:
one small icon per building at level ≥1 in `GameState.province_economy[pid].buildings`
(level-0 buildings omitted from this compact view, per `plans/economy_production_ui_handoff.md`
§9's BUILDINGS row spec). A radial-progress-ring overlay (`◐`) on any icon whose
`building_type` is currently in `construction_queue` — reuse whatever simple radial-progress
drawing approach is cheapest in this codebase (a partial `draw_arc` over the icon, matching
the pattern description in the UI handoff, not a new asset). **Multiple icons can show the
ring simultaneously** — this is the compact-HUD's own visual proof of parallel construction,
independent of Province Detail's progress bars.

**Manual verification (required):** select a province with two buildings under construction
simultaneously — confirm the compact bottom-of-map panel shows both building icons with a
progress ring on each, updating live.

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| `ProvinceState` should get `buildings`/`resources` as new Colyseus schema fields | **Wrong** — follow the `DivisionState.grid` precedent: plain server-side `Map`, synced via explicit broadcast, not native schema reactivity |
| `NationState.resources` should be a JSON string field like `movement_profile_json` | **Wrong** — ten flat numbers that need constant live reactivity for every player is exactly what Colyseus `MapSchema<number>` is for; the JSON-string pattern elsewhere is for large, rarely-read blobs, not this |
| Resource cost is deducted when construction *completes* | **Wrong** — deducted immediately at `BUILD_BUILDING` request time, per `ECONOMY_BUILDINGS.md`'s "costs resources and time," both paid up front |
| `construction_points_by_level[currentLevel]` should be indexed by target level (1-5) | **Wrong** — indexed by *current* level (0-4), since it represents "cost to go from here to the next level"; a building at level 0 reads index 0 |
| Industry Pool's construction-speed multiplier can be read from `nation.industry_alloc` in this branch | **Wrong** — that field is declared in this branch but populated by Branch B; this branch hardcodes `1.0` and flags the exact line to change later |
| A building's construction should block other buildings in the same province from starting | **Wrong** — parallel, not sequential; `ECONOMY_BUILDINGS.md`'s `construction_points` section is explicit that every building slot in a province progresses independently, no shared local capacity (unlike Naval's repair/construction slot-sharing, which is a documented special case elsewhere, not the general rule) |
| Military buildings (`fort`, `port`, `airbase`, `supply_hub`) get real base-effect logic in this phase | **Wrong** — `ECONOMY_BUILDINGS.md`'s own "Out of Scope" section excludes them; they only need a `building_stats.ts` entry so the schema round-trips, no effect implementation |
| A client reconnecting mid-game will receive `PROVINCE_ECONOMY_INIT` again | **Wrong** — `onJoin()` has no resend-on-reconnect path for any off-schema data anywhere in this codebase (confirmed: `DivisionState.grid` has the same gap); not this branch's job to fix |
| Progress bars update every server tick automatically | **Wrong only if you keep Step 3c's original `if (completed.length > 0)` guard** — broadcast on every tick the queue is non-empty, not only on completion, or Province Detail's progress bars will appear frozen until the moment a project finishes |
