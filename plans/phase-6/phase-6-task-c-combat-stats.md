# Plan C — `feat/tactical-combat-stats`

## Context

Branch B added the round engine (20s rounds, lethality phases, `ROUND_RESOLVED` broadcast). Both branches A and B still apply damage at the **division aggregate level** — a single `hp` and `suppression` number per division. Branch C changes combat resolution to operate **per cell**: damage is distributed across the 5×5 grid, each cell tracks its own HP (permanent) and suppression (decaying), incapacitation fires at unit-class-specific HP floors, armour penetration limits damage to armoured cells, and `ROUND_RESOLVED` is now broadcast with **non-empty** `attacker_grid_delta` / `defender_grid_delta` arrays. Division-level `hp` and `suppression` are then recomputed as averages of eligible cells, which feeds back into the existing retreat logic.

**TDD**: write the test file first, confirm all tests are RED, then implement until GREEN.

---

## Files to Create

### 1. `game-server/src/data/unit_combat_stats.ts` (NEW)

Defines pen (penetration power), armour rating, and HP-floor percentage per unit type. These drive armour penetration checks and incapacitation logic.

```typescript
import { UnitType } from "../types/tactical_types.js";

export interface UnitCombatStats {
  pen:          number;  // penetration rating (0–100+)
  armour:       number;  // armour rating (0–100); 0 = soft target
  hp_floor_pct: number;  // HP % below which unit incapacitates; 0 = no floor
}

export const UNIT_COMBAT_STATS: Record<string, UnitCombatStats> = {
  // ── Soft infantry (floor 20%) ──────────────────────────────────────────
  [UnitType.INFANTRY]:        { pen: 10,  armour: 0,  hp_floor_pct: 20 },
  [UnitType.ASSAULT_INF]:     { pen: 15,  armour: 0,  hp_floor_pct: 20 },
  [UnitType.RECON_INF]:       { pen: 10,  armour: 0,  hp_floor_pct: 20 },
  [UnitType.MG]:              { pen: 10,  armour: 0,  hp_floor_pct: 20 },
  [UnitType.CAVALRY]:         { pen: 10,  armour: 0,  hp_floor_pct: 20 },
  [UnitType.AT_INFANTRY]:     { pen: 40,  armour: 0,  hp_floor_pct: 20 },
  [UnitType.SNIPER]:          { pen: 15,  armour: 0,  hp_floor_pct: 20 },
  [UnitType.COMMANDO]:        { pen: 15,  armour: 0,  hp_floor_pct: 20 },
  [UnitType.FLAMETHROWER]:    { pen: 10,  armour: 0,  hp_floor_pct: 20 },
  // ── Armoured (floor 30%) ───────────────────────────────────────────────
  [UnitType.ARMOURED_CAR]:    { pen: 25,  armour: 15, hp_floor_pct: 30 },
  [UnitType.LIGHT_TANK]:      { pen: 45,  armour: 30, hp_floor_pct: 30 },
  [UnitType.MEDIUM_TANK]:     { pen: 65,  armour: 50, hp_floor_pct: 30 },
  [UnitType.HEAVY_TANK]:      { pen: 85,  armour: 75, hp_floor_pct: 30 },
  [UnitType.AT_GUN_SP]:       { pen: 75,  armour: 25, hp_floor_pct: 30 },
  // ── Towed / no floor ──────────────────────────────────────────────────
  [UnitType.AT_GUN]:          { pen: 70,  armour: 0,  hp_floor_pct: 0  },
  [UnitType.AA_GUN]:          { pen: 20,  armour: 0,  hp_floor_pct: 0  },
  [UnitType.ARTILLERY]:       { pen: 50,  armour: 0,  hp_floor_pct: 0  },
};
```

---

### 2. `game-server/test/6c-combat-stats.test.ts` (NEW — write FIRST, all tests must be RED before implementation)

Split into two `describe` blocks:

**Block 1 — Pure function tests** (no server; import and call directly):

```typescript
import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import {
  _armorPenMultiplier,
  _getIncapFloor,
  _computeDivisionSuppression,
  setRoundTicksForTesting,
  setCombatGraceTicksForTesting,
} from "../src/systems/combat_system.js";

// Helper: build a partial 25-cell GridCellState array for pure-function tests.
// Only the cells listed in `overrides` are populated; remaining cells have unit_type="".
function buildMockCells(
  overrides: Array<{ unit_type: string; suppression?: number; stealthed?: boolean; incapacitated?: boolean; hp?: number }>,
): any[] {
  const cells = Array.from({ length: 25 }, () => ({
    unit_type: "", hp: 100, suppression: 0, stealthed: false, incapacitated: false,
  }));
  overrides.forEach((o, i) => { cells[i] = { ...cells[i], ...o }; });
  return cells;
}

describe("6c — Unit combat stats: pure functions", function () {
  // Test 1: ratio < 0.6 → 0% damage
  it("_armorPenMultiplier: pen=30 vs armour=60 → 0%", () => {
    assert.strictEqual(_armorPenMultiplier(30, 60), 0);
  });

  // Test 2: ratio 0.65 → 20%
  it("_armorPenMultiplier: pen=65 vs armour=100 → 0.20", () => {
    assert.strictEqual(_armorPenMultiplier(65, 100), 0.20);
  });

  // Test 3: ratio ≥ 1.0 → 100%
  it("_armorPenMultiplier: pen=90 vs armour=80 → 1.0", () => {
    assert.strictEqual(_armorPenMultiplier(90, 80), 1.0);
  });

  // Test 4: armour = 0 (soft target) → always 100%
  it("_armorPenMultiplier: armour=0 → 1.0 regardless of pen", () => {
    assert.strictEqual(_armorPenMultiplier(5, 0), 1.0);
  });

  // Test 5: infantry-class floor = 20
  it("_getIncapFloor: infantry, mg, cavalry, flamethrower → 20", () => {
    for (const t of ["infantry","mg","cavalry","flamethrower","at_infantry","sniper","commando","recon_infantry","assault_infantry"]) {
      assert.strictEqual(_getIncapFloor(t), 20, `expected 20 for ${t}`);
    }
  });

  // Test 6: armour-class floor = 30
  it("_getIncapFloor: light_tank, medium_tank, heavy_tank, armoured_car, at_gun_sp → 30", () => {
    for (const t of ["light_tank","medium_tank","heavy_tank","armoured_car","at_gun_sp"]) {
      assert.strictEqual(_getIncapFloor(t), 30, `expected 30 for ${t}`);
    }
  });

  // Test 7: no-floor units
  it("_getIncapFloor: artillery, at_gun, aa_gun → 0", () => {
    for (const t of ["artillery","at_gun","aa_gun"]) {
      assert.strictEqual(_getIncapFloor(t), 0, `expected 0 for ${t}`);
    }
  });

  // Test 8: stealthed cells excluded from division suppression
  it("_computeDivisionSuppression: excludes stealthed cells", () => {
    const cells = buildMockCells([
      { unit_type: "infantry",   suppression: 80, stealthed: true  },
      { unit_type: "mg",         suppression: 20, stealthed: false },
    ]);
    assert.strictEqual(_computeDivisionSuppression(cells), 20);
  });

  // Test 9: incapacitated cells excluded
  it("_computeDivisionSuppression: excludes incapacitated cells", () => {
    const cells = buildMockCells([
      { unit_type: "infantry",   suppression: 90, incapacitated: true  },
      { unit_type: "mg",         suppression: 10, incapacitated: false },
    ]);
    assert.strictEqual(_computeDivisionSuppression(cells), 10);
  });

  // Test 10: no eligible cells → 0
  it("_computeDivisionSuppression: returns 0 when all cells empty", () => {
    const cells = buildMockCells([]);
    assert.strictEqual(_computeDivisionSuppression(cells), 0);
  });
});
```

**Block 2 — Integration tests** (uses `@colyseus/testing`, needs Branch B's `setRoundTicksForTesting`):

```typescript
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret  = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

/**
 * Wait for ROUND_RESOLVED whose engagement_id starts with engagementId.
 * Filters out auto-engagements from startGame()'s default divisions.
 */
function waitForEngagementRound(client: any, engagementId: string, timeoutMs = 60_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unbind(); reject(new Error(`Timeout waiting for ROUND_RESOLVED for ${engagementId}`)); }, timeoutMs);
    const unbind = client.onMessage("ROUND_RESOLVED", (msg: any) => {
      if (typeof msg.engagement_id === "string" && msg.engagement_id.startsWith(engagementId)) {
        clearTimeout(timer); unbind(); resolve(msg);
      }
    });
  });
}

/** Wait for any message of the given type (used for non-ROUND_RESOLVED events). */
function waitForMessage(client: any, type: string, timeoutMs = 60_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unbind(); reject(new Error(`Timeout waiting for ${type}`)); }, timeoutMs);
    const unbind = client.onMessage(type, (msg: any) => { clearTimeout(timer); unbind(); resolve(msg); });
  });
}

describe("6c — Combat stats: integration", function () {
  this.timeout(180_000);
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setRoundTicksForTesting(3);
    setCombatGraceTicksForTesting(1);   // don't wait 10 ticks before engaging
    colyseus = await boot(appConfig);
  });
  after(async () => {
    setRoundTicksForTesting(20);
    setCombatGraceTicksForTesting(10);
    await new Promise(r => setTimeout(r, 300));
    await colyseus.shutdown();
  });
  beforeEach(async () => { await colyseus.cleanup(); });

  /**
   * Create room, set cell units, start game loop, wait for COMBAT_STARTED.
   * SET_CELL must be sent BEFORE startGame() because _isGridLocked rejects them
   * on engaged divisions. startGame() loads default divisions and may trigger
   * auto-engagements — our engagementId filter isolates our test divisions.
   */
  async function spawnCombat(divAUnits: Record<number,string>, divBUnits: Record<number,string>) {
    const token  = await makeToken();
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const divA = "div-a";
    const divB = "div-b";

    client.send("SPAWN_DIVISION", { division_id: divA, nation_id: "germany", position_lng: 0, position_lat: 0 });
    client.send("SPAWN_DIVISION", { division_id: divB, nation_id: "france",  position_lng: 0.001, position_lat: 0.001 });
    await room.waitForNextPatch();

    // SET_CELL before startGame() — grid lock only applies once divisions are engaged
    for (const [idx, utype] of Object.entries(divAUnits)) {
      client.send("SET_CELL", { division_id: divA, cell_index: +idx, unit_type: utype });
    }
    for (const [idx, utype] of Object.entries(divBUnits)) {
      client.send("SET_CELL", { division_id: divB, cell_index: +idx, unit_type: utype });
    }
    await room.waitForNextPatch();

    // Start game loop — required for gameTick() / combatSystem.tick() to fire
    await (room as any).startGame();
    await room.waitForNextPatch();
    await client.waitForMessage("COMBAT_STARTED", 60_000);

    const engagementId = `${divA}_vs_${divB}_`;
    return { room, client, engagementId };
  }

  // Test 11: ROUND_RESOLVED has non-empty deltas when cells are occupied
  it("ROUND_RESOLVED attacker_grid_delta is non-empty when divisions have units", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    const msg = await waitForEngagementRound(client, engagementId, 60_000) as any;
    assert.ok(msg.attacker_grid_delta.length > 0 || msg.defender_grid_delta.length > 0,
      "at least one delta array must be non-empty");
  });

  // Test 12: cell HP decreases after a round of combat
  it("defender cell HP decreases after one round", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    await waitForEngagementRound(client, engagementId, 60_000);
    const cell = room.state.divisions.get("div-b").grid.cells[12];
    assert.ok(cell.hp < 100, `expected hp < 100, got ${cell.hp}`);
  });

  // Test 13: cell suppression increases after a round
  it("defender cell suppression increases after one round", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    await waitForEngagementRound(client, engagementId, 60_000);
    const cell = room.state.divisions.get("div-b").grid.cells[12];
    assert.ok(cell.suppression > 0, `expected suppression > 0, got ${cell.suppression}`);
  });

  // Test 14: UNIT_INCAPACITATED fires when infantry HP ≤ 20
  it("UNIT_INCAPACITATED fires when infantry cell HP reaches floor", async () => {
    const { room, client } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    // SET_CELL is blocked on engaged divisions — mutate server state directly.
    // Set hp=19 (below the 20% floor) so the very next round's damage triggers incapacitation.
    // hp=21 is NOT enough: contact-phase damage = 2.5 * 0.5 * 0.3 / 1 = 0.375 → 21-0.375=20.625 > 20.
    (room.state.divisions.get("div-b").grid.cells[12] as any).hp = 19;
    const msg = await waitForMessage(client, "UNIT_INCAPACITATED", 60_000) as any;
    assert.strictEqual(msg.division_id, "div-b");
    assert.strictEqual(msg.cell_index,  12);
  });

  // Test 15: cell suppression decays between rounds
  it("cell suppression decays each round during active combat", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    // SET_CELL is blocked on engaged divisions — mutate server state directly.
    (room.state.divisions.get("div-b").grid.cells[12] as any).suppression = 80;
    // Wait two rounds: decay should fire each round; net suppression should change
    await waitForEngagementRound(client, engagementId, 60_000);
    await waitForEngagementRound(client, engagementId, 60_000);
    const cellAfter = room.state.divisions.get("div-b").grid.cells[12];
    assert.ok(typeof cellAfter.suppression === "number");
  });

  // Test 16: division suppression threshold excludes incapacitated cells
  it("division.suppression excludes incapacitated cells from average", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry", 13: "mg" });
    // SET_CELL is blocked on engaged divisions — mutate server state directly.
    const divB = room.state.divisions.get("div-b");
    (divB.grid.cells[13] as any).suppression   = 0;
    (divB.grid.cells[13] as any).incapacitated = true;
    (divB.grid.cells[12] as any).suppression   = 70;
    // Wait for next round so _computeDivisionSuppression runs and writes divB.suppression
    await waitForEngagementRound(client, engagementId, 60_000);
    assert.ok(divB.suppression >= 60, `expected division suppression ≥ 60, got ${divB.suppression}`);
  });

  // Test 17: armoured cell takes reduced damage vs soft-pen attacker
  it("armoured cell takes less damage than soft cell from infantry pen", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 5: "infantry", 20: "heavy_tank" });
    await waitForEngagementRound(client, engagementId, 60_000);
    const div        = room.state.divisions.get("div-b");
    const softDmg    = 100 - div.grid.cells[5].hp;
    const armoredDmg = 100 - div.grid.cells[20].hp;
    assert.ok(armoredDmg < softDmg,
      `heavy_tank hp loss ${armoredDmg} should be less than infantry hp loss ${softDmg}`);
  });
});
```

**Expected before implementation**: all 17 tests RED — exported functions don't exist, grid deltas are empty, `UNIT_INCAPACITATED` never fires.

---

## Files to Modify

### 3. `game-server/src/systems/combat_system.ts`

#### A. New imports

```typescript
import { UNIT_COMBAT_STATS } from "../data/unit_combat_stats.js";
import type { GridCellState } from "../rooms/schema/GameRoomState.js";
import type { GridCellDelta, UnitIncapacitatedPayload } from "../types/tactical_types.js";
```

#### B. New constants (add near existing attrition constants)

```typescript
// ── Per-cell stat constants ───────────────────────────────────────────────────
const CELL_SUPP_DECAY_BASE    = 8;    // suppression points decayed per round during active combat
const CELL_SUPP_DECAY_RETREAT = 20;   // 2.5× faster during retreat

// Armour penetration table: [pen/armour ratio threshold, damage multiplier]
// Apply first entry where ratio ≥ threshold (table must be sorted descending).
const ARMOUR_PEN_TABLE: Array<[number, number]> = [
  [1.00, 1.00],
  [0.90, 0.70],
  [0.80, 0.40],
  [0.70, 0.30],
  [0.60, 0.20],
  [0.00, 0.00],
];
```

#### C. New exported pure functions (add after constants, before the class)

```typescript
// Exported for unit tests.
export function _armorPenMultiplier(pen: number, armour: number): number {
  if (armour <= 0) return 1.0;
  const ratio = pen / armour;
  for (const [threshold, mult] of ARMOUR_PEN_TABLE) {
    if (ratio >= threshold) return mult;
  }
  return 0.0;
}

export function _getIncapFloor(unit_type: string): number {
  const stats = UNIT_COMBAT_STATS[unit_type];
  return stats?.hp_floor_pct ?? 0;
}

export function _computeDivisionSuppression(cells: GridCellState[]): number {
  const eligible = cells.filter(c => c.unit_type !== "" && !c.stealthed && !c.incapacitated);
  if (eligible.length === 0) return 0;
  return eligible.reduce((sum, c) => sum + c.suppression, 0) / eligible.length;
}
```

#### D. New private helper: `_getBestPenValue(div)` (stub for Branch C)

```typescript
private _getBestPenValue(div: DivisionState): number {
  if (!div.grid) return 10;
  let best = 0;
  for (const cell of div.grid.cells) {
    if (cell.unit_type === "" || cell.incapacitated) continue;
    const stats = UNIT_COMBAT_STATS[cell.unit_type];
    if (stats && stats.pen > best) best = stats.pen;
  }
  return best > 0 ? best : 10;  // fallback: infantry pen
}
```

**Note on stub**: Branches D/E/F will replace this with proper per-cell attacker→target assignments. For Branch C, the max pen from any non-incapacitated attacker cell is used for ALL target cells.

#### E. New private method: `_decayCellSuppression(div, isRetreating)`

Called at the **start** of each round resolution (before applying new damage), so cells decay first, then receive new suppression.

```typescript
private _decayCellSuppression(div: DivisionState, isRetreating: boolean): void {
  if (!div.grid) return;
  const decay = isRetreating ? CELL_SUPP_DECAY_RETREAT : CELL_SUPP_DECAY_BASE;
  for (const cell of div.grid.cells) {
    if (cell.unit_type === "") continue;
    cell.suppression = Math.max(0, cell.suppression - decay);
  }
}
```

#### F. New private method: `_applyPerCellDamage(attacker, defender, rawDamage, pair, broadcast)` → `GridCellDelta[]`

This **replaces** the per-division lines inside `_applyDamage()` (the `divB.hp -= ...` and `divB.suppression += ...` lines). Returns an array of changed cell deltas.

```typescript
private _applyPerCellDamage(
  attacker: DivisionState,
  defender: DivisionState,
  rawDamage: number,          // scalar output of computeDamage()
  pair: ActivePair,
  broadcast: (type: string, msg: unknown) => void,
): GridCellDelta[] {
  if (!defender.grid) return [];

  const eligibleCells = defender.grid.cells
    .map((cell, idx) => ({ cell, idx }))
    .filter(({ cell }) => cell.unit_type !== "" && !cell.incapacitated);

  if (eligibleCells.length === 0) return [];

  const attackerPen    = this._getBestPenValue(attacker);
  const perCellHpDmg   = (rawDamage * HP_DAMAGE_FRACTION)   / eligibleCells.length;
  const perCellSuppDmg = (rawDamage * SUPPRESSION_FRACTION) / eligibleCells.length;
  const deltas: GridCellDelta[] = [];

  for (const { cell, idx } of eligibleCells) {
    const stats    = UNIT_COMBAT_STATS[cell.unit_type];
    const penMult  = _armorPenMultiplier(attackerPen, stats?.armour ?? 0);
    const hpDelta  = perCellHpDmg * penMult;

    cell.hp          = Math.max(0, cell.hp - hpDelta);
    cell.suppression = Math.min(100, cell.suppression + perCellSuppDmg);

    // Incapacitation check
    const floor = _getIncapFloor(cell.unit_type);
    if (floor > 0 && cell.hp <= floor && !cell.incapacitated) {
      cell.incapacitated = true;
      broadcast("UNIT_INCAPACITATED", {
        engagement_id: pair.engagement_id,
        division_id:   defender.division_id,
        cell_index:    idx,
        unit_type:     cell.unit_type,
        xp_retained:   0,  // XP system in Branch G
      } satisfies UnitIncapacitatedPayload);
    }

    deltas.push({
      cell_index:   idx,
      hp:           cell.hp,
      suppression:  cell.suppression,
      incapacitated: cell.incapacitated,
    });
  }

  return deltas;
}
```

#### G. Update `_applyDamage()` — replace division-level HP/suppression mutations with per-cell calls

Find the two blocks:
```typescript
divB.hp           = Math.max(0, divB.hp           - damageByA * HP_DAMAGE_FRACTION);
divB.suppression  = Math.min(100, divB.suppression + damageByA * SUPPRESSION_FRACTION);

divA.hp           = Math.max(0, divA.hp           - damageByB * HP_DAMAGE_FRACTION);
divA.suppression  = Math.min(100, divA.suppression + damageByB * SUPPRESSION_FRACTION);
```

Replace with:
```typescript
// Per-cell damage (returns deltas for ROUND_RESOLVED; stored on pair for collection)
this._decayCellSuppression(divB, divB.combat_state === "retreating");
const deltasB = this._applyPerCellDamage(divA, divB, damageByA, pair, broadcast);
this._decayCellSuppression(divA, divA.combat_state === "retreating");
const deltasA = this._applyPerCellDamage(divB, divA, damageByB, pair, broadcast);

// Recompute division-level aggregates from cell data
divB.hp           = this._computeDivisionHp(divB.grid?.cells ?? []);
divB.suppression  = _computeDivisionSuppression(divB.grid?.cells ?? []);
divA.hp           = this._computeDivisionHp(divA.grid?.cells ?? []);
divA.suppression  = _computeDivisionSuppression(divA.grid?.cells ?? []);

// Store deltas on pair so _resolveCombat can include them in ROUND_RESOLVED
pair._lastDeltaAttacker = deltasA;
pair._lastDeltaDefender = deltasB;
```

Add `_computeDivisionHp` helper:
```typescript
private _computeDivisionHp(cells: GridCellState[]): number {
  const occupied = cells.filter(c => c.unit_type !== "");
  if (occupied.length === 0) return 100;
  return occupied.reduce((sum, c) => sum + c.hp, 0) / occupied.length;
}
```

Also add `_lastDeltaAttacker` and `_lastDeltaDefender` to the `ActivePair` interface:
```typescript
_lastDeltaAttacker: GridCellDelta[];
_lastDeltaDefender: GridCellDelta[];
```
Initialize both to `[]` in `_detectEngagements()`.

#### H. Update `ROUND_RESOLVED` broadcast in `_resolveCombat()` — include collected deltas

Find the `broadcast("ROUND_RESOLVED", ...)` call added by Branch B and update:

```typescript
broadcast("ROUND_RESOLVED", {
  engagement_id:          pair.engagement_id,
  round_number:           roundNumber,
  lethality_phase:        pair.lethality_phase as any,
  attacker_grid_delta:    pair._lastDeltaAttacker,  // was []
  defender_grid_delta:    pair._lastDeltaDefender,  // was []
  formation_bonuses_active: [],
  xp_changes:             [],
} satisfies RoundResolvedPayload);

// Reset for next round
pair._lastDeltaAttacker = [];
pair._lastDeltaDefender = [];
```

---

## Verification Gate

```bash
NODE_ENV=test npx mocha -r tsx test/6c-combat-stats.test.ts --exit --timeout 90000
```

All 17 tests must pass. Then:

1. `npx tsc --noEmit` — zero TypeScript errors.
2. Existing `6a-grid-schema.test.ts` still passes (schema unchanged).
3. Existing `4c-combat.e2e.ts` still passes — `COMBAT_RESULT` still fires, retreat still triggers.
4. Manually: spawn two bots, watch `ROUND_RESOLVED` in console — `attacker_grid_delta` should now have entries; `UNIT_INCAPACITATED` should fire when a cell is worn down.

---

## Common Errors to Avoid

1. **`pair.engagement_id` may not exist yet** if Branch B hasn't been fully merged. The `ActivePair` fields `engagement_id`, `round_tick_counter`, `lethality_phase`, `lethality_multiplier` are added by Branch B. Branch C assumes these exist.
2. **`div.grid` may be undefined** for divisions spawned before Branch A code runs. Always guard: `if (!div.grid) return []`.
3. **Division-level suppression now cell-derived** — do NOT keep manually incrementing `div.suppression` after replacing with per-cell calls; double-application will break retreat logic.
4. **Decay before damage, not after** — `_decayCellSuppression` must be called at the start of each round (before applying new damage), so that the round's new suppression lands cleanly.
5. **`_lastDeltaAttacker/Defender` swap**: `deltasA` = cells of `divA` that were hit by `divB`'s damage (defender's perspective). Check `attacker_id` vs `defender_id` carefully — the `attacker_grid_delta` in `ROUND_RESOLVED` refers to the attacker division's grid state, not the damage source.
6. **`ARMOUR_PEN_TABLE` must be sorted descending** — the first matching threshold wins; if sorted ascending, every ratio would hit the 0.0 fallback.
7. **Empty cells are skipped** — `unit_type === ""` cells must not receive damage or suppression and must not count in division-level averages. Artillery/AT-gun/AA with `hp_floor_pct: 0` can still reach hp=0 (destroyed, not incapacitated); this is correct.
8. **`SET_CELL` is blocked on engaged divisions** — `_isGridLocked` rejects `SET_CELL` messages once divisions are engaged. Tests that need specific starting cell states (tests 14–16) must mutate `room.state` directly via `(room.state.divisions.get(...).grid.cells[idx] as any).field = value` rather than sending `SET_CELL` through the client.
9. **`BroadcastFn` type does not exist** — the codebase uses the inline type `(type: string, msg: unknown) => void` everywhere. Do NOT create a `BroadcastFn` alias; use the inline type in `_applyPerCellDamage` and any other new methods.
10. **`startGame()` is required** — the game loop only starts via `await (room as any).startGame()`. Without it, `gameTick()` never fires and `ROUND_RESOLVED` is never broadcast. All integration tests will time out. Call it after `SET_CELL` messages (pre-engagement setup) and before waiting for `COMBAT_STARTED`.
11. **Filter `ROUND_RESOLVED` by `engagement_id`** — `startGame()` spawns default nation divisions; some auto-engage and emit `ROUND_RESOLVED` with different engagement IDs. Use `waitForEngagementRound(client, engagementId, ...)` (filters by `engagement_id.startsWith(eid)`) not bare `waitForMessage`. See 6b test pattern.
12. **`.js` extensions required on all relative imports** — `tsconfig.json` uses `moduleResolution: "NodeNext"`. Omitting `.js` causes `TS2835`. All existing tests and source files use `.js`; follow that pattern.
13. **Test 14 hp floor arithmetic** — infantry floor = 20%. Contact-phase damage = `2.5 × 0.5 × 0.3 / 1 cell = 0.375` per round. `hp=21` survives round 1 (21 − 0.375 = 20.625 > 20). Use `hp=19` (already ≤ floor) so the very next damage application triggers incapacitation.
