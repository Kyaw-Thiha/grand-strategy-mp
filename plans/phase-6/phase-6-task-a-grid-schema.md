# Plan A — `feat/tactical-grid-schema`

## Context

Phase 6 tactical combat requires each division to carry a 5×5 grid of individual unit cells. Right now `DivisionState` (in `game-server/src/rooms/schema/GameRoomState.ts`) only has aggregate `hp` and `suppression` fields. This branch adds the cell-level schema so all later branches have a stable data contract to build against. Nothing is wired to gameplay logic yet — this branch is purely additive schema + type definitions + a working test that proves serialization round-trips through Colyseus.

**Goal**: Write failing tests first, then implement, until the verification gate passes.

**Must merge before**: Task B-G, Task H-I-J, Task K, Task L-M (all depend on this schema and event contracts).

---

## Files to Create

### 1. `game-server/src/types/tactical_types.ts` (NEW FILE)

```typescript
export const UnitType = {
  INFANTRY:        "infantry",
  ASSAULT_INF:     "assault_infantry",
  RECON_INF:       "recon_infantry",
  MG:              "mg",
  CAVALRY:         "cavalry",
  LIGHT_TANK:      "light_tank",
  MEDIUM_TANK:     "medium_tank",
  HEAVY_TANK:      "heavy_tank",
  ARMOURED_CAR:    "armoured_car",
  AT_INFANTRY:     "at_infantry",
  AT_GUN:          "at_gun",
  AT_GUN_SP:       "at_gun_sp",
  AA_GUN:          "aa_gun",
  SNIPER:          "sniper",
  FLAMETHROWER:    "flamethrower",
  ARTILLERY:       "artillery",
  COMMANDO:        "commando",
  EMPTY:           "",
} as const;

export type UnitTypeValue = typeof UnitType[keyof typeof UnitType];

export const XpTier = {
  GREEN:    "green",
  SEASONED: "seasoned",
  VETERAN:  "veteran",
  ELITE:    "elite",
} as const;

export type XpTierValue = typeof XpTier[keyof typeof XpTier];

// ── Event payload interfaces ───────────────────────────────────────────────

export interface RoundResolvedPayload {
  engagement_id: string;
  round_number: number;
  lethality_phase: "contact" | "firefight" | "intense" | "decisive" | "annihilation";
  attacker_grid_delta: GridCellDelta[];
  defender_grid_delta: GridCellDelta[];
  formation_bonuses_active: FormationBonusActive[];
  xp_changes: XpChangeEntry[];
}

export interface GridCellDelta {
  cell_index: number;   // 0–24; row*5+col where row 0=R1(back), row 4=R5(vanguard/front)
  hp?: number;
  suppression?: number;
  xp_tier?: XpTierValue;
  incapacitated?: boolean;
  stealthed?: boolean;
  unit_type?: UnitTypeValue;
}

export interface FormationBonusActive {
  cell_a: number;
  cell_b: number;
  bonus_type: "at_mg" | "sniper_recon" | "flm_assault" | "mg_mg" | "arty_recon";
}

export interface XpChangeEntry {
  division_id: string;
  cell_index: number;
  xp_before: XpTierValue;
  xp_after: XpTierValue;
}

export interface UnitIncapacitatedPayload {
  engagement_id: string;
  division_id: string;
  cell_index: number;
  unit_type: UnitTypeValue;
  xp_retained: number;
}

export interface UnitRecoveredPayload {
  engagement_id: string;
  division_id: string;
  cell_index: number;
}

export interface UnitExperienceGainedPayload {
  engagement_id: string;
  division_id: string;
  cell_index: number;
  new_tier: XpTierValue;
}

export interface UnitEliteReachedPayload {
  engagement_id: string;
  division_id: string;
  cell_index: number;
}

export interface TacticalBreakthroughPayload {
  engagement_id: string;
  division_id: string;
}
```

---

### 2. `game-server/test/6a-grid-schema.test.ts` (NEW FILE — write FIRST, tests must be RED before implementation)

Pattern: copy structure from `game-server/test/4c-combat.e2e.ts`. Uses Mocha + tsx. No Jest, no Chai — raw `assert` from Node built-in.

```typescript
import assert from "assert";
import { describe, it, before, after } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../src/app.config";
import { UnitType, XpTier } from "../src/types/tactical_types";

describe("6a — Tactical Grid Schema", function () {
  this.timeout(15_000);

  let colyseus: ColyseusTestServer;

  before(async () => { colyseus = await boot(appConfig); });
  after(async ()  => { await colyseus.shutdown(); });

  async function joinRoom() {
    const client = await colyseus.createClient();
    const room   = await client.joinOrCreate("game_room", { userId: "test-user" });
    await room.waitForNextPatch();
    return { client, room };
  }

  it("DivisionState carries a grid field with 25 cells after division spawns", async () => {
    const { room } = await joinRoom();
    room.send("SPAWN_DIVISION", {
      division_id: "div-test-1",
      nation_id:   "nation-1",
      position_lng: 0,
      position_lat: 0,
    });
    await room.waitForNextPatch();

    const div = room.state.divisions.get("div-test-1");
    assert.ok(div, "division should exist in state");
    assert.ok(div.grid, "division.grid should exist");
    assert.strictEqual(div.grid.cells.length, 25, "grid must have exactly 25 cells");
  });

  it("GridCellState defaults: empty unit_type, hp=100, suppression=0, xp_tier=green, not incapacitated", async () => {
    const { room } = await joinRoom();
    room.send("SPAWN_DIVISION", { division_id: "div-defaults", nation_id: "n1", position_lng: 0, position_lat: 0 });
    await room.waitForNextPatch();

    const div  = room.state.divisions.get("div-defaults");
    const cell = div.grid.cells[0];
    assert.strictEqual(cell.unit_type,     UnitType.EMPTY);
    assert.strictEqual(cell.hp,            100);
    assert.strictEqual(cell.suppression,   0);
    assert.strictEqual(cell.xp_tier,       XpTier.GREEN);
    assert.strictEqual(cell.incapacitated, false);
    assert.strictEqual(cell.stealthed,     false);
  });

  it("unit_type can be set to every valid UnitType value and round-trips through Colyseus", async () => {
    const { room } = await joinRoom();
    room.send("SPAWN_DIVISION", { division_id: "div-types", nation_id: "n1", position_lng: 0, position_lat: 0 });
    await room.waitForNextPatch();

    for (const [key, unitType] of Object.entries(UnitType)) {
      if (unitType === UnitType.EMPTY) continue;
      room.send("SET_CELL", { division_id: "div-types", cell_index: 0, unit_type: unitType });
      await room.waitForNextPatch();
      const cell = room.state.divisions.get("div-types").grid.cells[0];
      assert.strictEqual(cell.unit_type, unitType, `UnitType.${key} should survive serialization`);
    }
  });

  it("cell index 0 = R1 back-left, cell 24 = R5 vanguard-right; both survive round-trip", async () => {
    const { room } = await joinRoom();
    room.send("SPAWN_DIVISION", { division_id: "div-idx", nation_id: "n1", position_lng: 0, position_lat: 0 });
    await room.waitForNextPatch();

    room.send("SET_CELL", { division_id: "div-idx", cell_index: 0,  unit_type: "infantry" });
    room.send("SET_CELL", { division_id: "div-idx", cell_index: 24, unit_type: "artillery" });
    await room.waitForNextPatch();

    const div = room.state.divisions.get("div-idx");
    assert.strictEqual(div.grid.cells[0].unit_type,  "infantry");
    assert.strictEqual(div.grid.cells[24].unit_type, "artillery");
  });

  it("hp and suppression can be set independently per cell", async () => {
    const { room } = await joinRoom();
    room.send("SPAWN_DIVISION", { division_id: "div-bars", nation_id: "n1", position_lng: 0, position_lat: 0 });
    await room.waitForNextPatch();

    room.send("SET_CELL", { division_id: "div-bars", cell_index: 5, hp: 42, suppression: 67 });
    await room.waitForNextPatch();

    const cell = room.state.divisions.get("div-bars").grid.cells[5];
    assert.strictEqual(cell.hp,          42);
    assert.strictEqual(cell.suppression, 67);
  });

  it("xp_tier cycles through all four tiers and serializes correctly", async () => {
    const { room } = await joinRoom();
    room.send("SPAWN_DIVISION", { division_id: "div-xp", nation_id: "n1", position_lng: 0, position_lat: 0 });
    await room.waitForNextPatch();

    for (const tier of [XpTier.GREEN, XpTier.SEASONED, XpTier.VETERAN, XpTier.ELITE]) {
      room.send("SET_CELL", { division_id: "div-xp", cell_index: 12, xp_tier: tier });
      await room.waitForNextPatch();
      const cell = room.state.divisions.get("div-xp").grid.cells[12];
      assert.strictEqual(cell.xp_tier, tier);
    }
  });

  it("DivisionState.template_id exists and defaults to empty string", async () => {
    const { room } = await joinRoom();
    room.send("SPAWN_DIVISION", { division_id: "div-tmpl", nation_id: "n1", position_lng: 0, position_lat: 0 });
    await room.waitForNextPatch();

    const div = room.state.divisions.get("div-tmpl");
    assert.ok("template_id" in div, "template_id field must exist on DivisionState");
    assert.strictEqual(div.template_id, "");
  });

  it("unit_terrain_costs covers all UnitType values (except EMPTY)", async () => {
    const { UNIT_TERRAIN_COSTS } = await import("../src/data/unit_terrain_costs");
    for (const [key, unitType] of Object.entries(UnitType)) {
      if (unitType === UnitType.EMPTY) continue;
      assert.ok(
        unitType in UNIT_TERRAIN_COSTS,
        `unit_terrain_costs is missing entry for UnitType.${key} ("${unitType}")`
      );
    }
  });
});
```

**Expected before implementation**: all 7 tests RED with "division.grid is undefined" or import errors.

---

## Files to Modify

### 3. `game-server/src/rooms/schema/GameRoomState.ts`

Add two new schema classes **above** the existing `DivisionState` class, and two new fields inside `DivisionState`.

**Add this import at the top of the file (only if `schema` decorator is not already imported):**
```typescript
import { schema } from "@colyseus/schema";
```
Check the existing imports — `Schema`, `MapSchema`, `ArraySchema`, `type` are already present.

**Add these two classes BEFORE the DivisionState class:**
```typescript
@schema({})
export class GridCellState extends Schema {
  @type("string")  unit_type: string     = "";
  @type("number")  hp: number            = 100;
  @type("number")  suppression: number   = 0;
  @type("string")  xp_tier: string       = "green";
  @type("boolean") incapacitated: boolean = false;
  @type("boolean") stealthed: boolean     = false;
}

@schema({})
export class DivisionGridState extends Schema {
  @type([GridCellState]) cells = new ArraySchema<GridCellState>(
    ...Array.from({ length: 25 }, () => new GridCellState())
  );
}
```

**Add these two fields at the bottom of `DivisionState`'s field list (before the closing brace):**
```typescript
  @type("string")          template_id: string = "";
  @type(DivisionGridState) grid = new DivisionGridState();
```

**PITFALL — Colyseus schema decorators:**
- `@schema({})` must be on each Schema subclass. If the existing `PlayerState`, `DivisionState` etc. don't have it, they rely on a different Colyseus version's auto-detection. Check whether existing classes in the file use `@schema({})` — if they don't, you likely don't need it either and the decorator pattern for this project is just `extends Schema` with `@type()` on fields.
- `@type` must appear directly before the field with no blank line.
- ArraySchema initializer with spread: `new ArraySchema<GridCellState>(...Array.from({length:25}, () => new GridCellState()))` is the correct pattern. Do NOT push cells lazily in a constructor — Colyseus needs the array populated at construction time.

### 4. `game-server/src/data/unit_terrain_costs.ts`

The existing file has entries for `standard_infantry` and `cavalry`. The export name may differ — check the file and add a named export `UNIT_TERRAIN_COSTS` that maps every `UnitType` value (from `tactical_types.ts`, excluding EMPTY) to a terrain cost object.

Terrain cost object format: `{ [terrain_key: string]: number }` where 1 = normal cost, >1 = slower, 0 = impassable. Use the existing entry structure as the template.

New entries to add (base each on the closest existing unit if possible):
- `assault_infantry` — same profile as infantry
- `recon_infantry` — infantry profile but cost 1 on all passable terrain (fastest infantry)
- `mg` — same as infantry
- `light_tank` — impassable: dense_forest, urban; high cost in forest/swamp
- `medium_tank` — impassable: dense_forest, urban, forest; lower cost in plains/roads
- `heavy_tank` — impassable: dense_forest, urban, forest, hills; optimal plains/roads only
- `armoured_car` — impassable: dense_forest, forest, swamp; fast on roads/plains
- `at_infantry` — same as infantry
- `at_gun` — impassable: dense_forest; high cost all rough terrain (towed)
- `at_gun_sp` — same profile as light_tank (self-propelled)
- `aa_gun` — same as at_gun (towed)
- `sniper` — same as recon_infantry
- `flamethrower` — same as infantry
- `artillery` — impassable: dense_forest; very high cost rough terrain (towed, slowest)
- `commando` — same as recon_infantry

**The export must be named `UNIT_TERRAIN_COSTS`** — the test imports it by that exact name. If the existing file exports under a different name, add:
```typescript
export const UNIT_TERRAIN_COSTS = { ...existingExport, ...newEntries };
```

### 5. `game-server/src/rooms/GameRoom.ts` — Test-Only SET_CELL Handler

Find where `onMessage` handlers are registered (search for `this.onMessage`). Add the following block **after** the existing handlers:

```typescript
if (process.env.NODE_ENV === "test") {
  this.onMessage("SET_CELL", (client, msg: {
    division_id: string;
    cell_index: number;
    unit_type?: string;
    hp?: number;
    suppression?: number;
    xp_tier?: string;
    incapacitated?: boolean;
    stealthed?: boolean;
  }) => {
    const div = this.state.divisions.get(msg.division_id);
    if (!div?.grid) return;
    const cell = div.grid.cells[msg.cell_index];
    if (!cell) return;
    if (msg.unit_type    !== undefined) cell.unit_type    = msg.unit_type;
    if (msg.hp           !== undefined) cell.hp           = msg.hp;
    if (msg.suppression  !== undefined) cell.suppression  = msg.suppression;
    if (msg.xp_tier      !== undefined) cell.xp_tier      = msg.xp_tier;
    if (msg.incapacitated !== undefined) cell.incapacitated = msg.incapacitated;
    if (msg.stealthed    !== undefined) cell.stealthed    = msg.stealthed;
  });
}
```

Also verify the existing `SPAWN_DIVISION` handler does not overwrite the division object with a plain object — it must set fields on an existing `DivisionState` instance (or create one using `new DivisionState()`) so that the `grid` field (initialized in the class body) is preserved.

---

## Verification Gate

```bash
cd game-server && npx mocha --require tsx/cjs test/6a-grid-schema.test.ts
```
(Check `package.json` scripts for the exact test runner command — look for how `4c-combat.e2e.ts` is run and use the same invocation.)

All 7 tests must pass. Then:
1. `npx tsc --noEmit` — zero TypeScript errors.
2. `npm run dev` — server starts without error.
3. Any existing test suite still passes (no regressions).

**Do not touch**: `combat_system.ts`, any Godot client files. This branch is server-schema only.

---

## Common Errors to Avoid

1. `@type` decorator and field must have no blank line between them.
2. `ArraySchema<GridCellState>` generic is required — bare `ArraySchema` breaks patch diffing.
3. `GridCellState` and `DivisionGridState` must extend `Schema` (not just be plain objects).
4. Do NOT import `GameRoomState.ts` from `tactical_types.ts` — only the reverse direction is allowed (circular import will crash at runtime).
5. Each `it()` block must call `joinRoom()` independently — never share room state between tests.
6. When checking if `schema` decorator is needed: look at the first class in `GameRoomState.ts` (`PlayerState`). If it has `@schema({})`, add it to your new classes too. If it doesn't, omit it.
