# Plan D — `feat/tactical-infantry-patterns`

## Context

Branches A–C established the grid schema, round engine, and per-cell stat tracking.
Branch C's `_applyPerCellDamage` still uses a stub: it distributes total division damage
evenly across all living defender cells regardless of unit type. Branch D replaces that
stub with real attack patterns for the horizontal-attack family (infantry, MG, assault
infantry, recon infantry, commando, cavalry) and the flamethrower AOE, plus the fire
order and spillover mechanics.

Patterns are **pure TypeScript functions** in a new file so they can be unit-tested with
zero server overhead, then wired into the combat loop. Client-side round-preview and hover
overlays in `AttackPatternRegistry` are also filled in.

**TDD**: write the test file first, confirm all tests RED, then implement until GREEN.

---

## Grid Indexing Reference (critical — every function depends on this)

```
cell_index = row * 5 + col
row 0 = R1 (rear/back, deepest)
row 4 = R5 (vanguard/front, closest to enemy)
col 0 = C1 … col 4 = C5

R5 cells: 20 21 22 23 24   ← frontmost (vanguard)
R4 cells: 15 16 17 18 19
R3 cells: 10 11 12 13 14
R2 cells:  5  6  7  8  9
R1 cells:  0  1  2  3  4   ← deepest (rear)

row_of(idx) = Math.floor(idx / 5)
col_of(idx) = idx % 5
```

Both grids face each other at their R5 rows.

---

## New Mechanics Summary

### n Parameter (Target Count Cap)

`_horizontalTargets` accepts `n: number = Infinity`. Returns the `n` leftmost living
cells in the frontmost occupied row. If only k < n living cells exist, returns all k —
no spillover to the next row. Flamethrower AOE ignores n entirely.

### Firing Order

Units fire R5→R1, left→right within each row by default. Units listed in `priority_types`
fire first (in listed order). Priority types are researchable perks (future feature) —
for Branch D, always pass `priority_types = []`.

```
Example — default order for this attacker grid:
     C1    C2    C3    C4    C5
R5 [ INF][    ][ MG ][    ][ CAV]   → fires: idx 20, 22, 24
R4 [    ][ INF][    ][ INF][    ]   → fires: idx 16, 18
R3 [ ART][    ][    ][    ][    ]   → fires: idx 10

With priority_types = ["artillery"]:
  idx 10 (ART) fires FIRST, then 20, 22, 24, 16, 18
```

### Spillover (Row-Cleared Redirect)

When earlier attackers in the fire order fully clear the frontmost enemy row (all cells
incapacitated/destroyed), subsequent attackers redirect to the next occupied row.

**Server:** implicit — `defender.grid.cells` is mutated in-place; later attackers call
`getTargetCells` on the updated grid and `_getFrontmostOccupiedRow` naturally skips
cleared rows.

**Client (`simulateRound`):** explicit — deep-copies enemy grid, applies virtual HP
damage after each attacker fires, so subsequent attackers see the clearing.

### Simultaneous Resolution

The fire order list is snapshotted at round start. A unit incapacitated mid-round by
enemy fire still fires — it was alive when the round began.

---

## Files to Create

### 1. `game-server/src/data/combat_constants.ts` — **ALREADY EXISTS, SKIP**

This file was created as part of the pre-work for Branch D. Content is correct:
```typescript
export const BASE_ATTRITION       = 2.5;
export const HP_DAMAGE_FRACTION   = 0.3;
export const SUPPRESSION_FRACTION = 0.7;
```
`combat_system.ts` already imports from it. **Do not recreate or modify.**

---

### 2. `game-server/test/6d-infantry-patterns.test.ts` (NEW — write FIRST, all RED)

```typescript
import assert from "assert";
import { describe, it } from "mocha";
import {
  getTargetCells,
  getDamageProfile,
  getFireOrder,
  simulateRound,
  _getFrontmostOccupiedRow,
} from "../src/systems/attack_patterns.js";
import { GridCellState } from "../src/rooms/schema/GameRoomState.js";

// Helper: 25-cell mock grid. occupied = { cell_index: unit_type }
// All cells: hp=100, suppression=0, incapacitated=false, stealthed=false.
function makeGrid(occupied: Record<number, string>): GridCellState[] {
  return Array.from({ length: 25 }, (_, i) => {
    const c = new GridCellState();
    c.unit_type     = occupied[i] ?? "";
    c.hp            = 100;
    c.suppression   = 0;
    c.incapacitated = false;
    c.stealthed     = false;
    return c;
  });
}

describe("6d — Infantry attack patterns", function () {

  // ── _getFrontmostOccupiedRow ───────────────────────────────────────────────

  it("_getFrontmostOccupiedRow: returns 4 when R5 is occupied", () => {
    const grid = makeGrid({ 20: "infantry", 22: "mg" });
    assert.strictEqual(_getFrontmostOccupiedRow(grid), 4);
  });

  it("_getFrontmostOccupiedRow: falls back to R4 when R5 empty", () => {
    const grid = makeGrid({ 15: "mg", 17: "at_gun" });
    assert.strictEqual(_getFrontmostOccupiedRow(grid), 3);
  });

  it("_getFrontmostOccupiedRow: returns -1 when all cells empty", () => {
    assert.strictEqual(_getFrontmostOccupiedRow(makeGrid({})), -1);
  });

  it("_getFrontmostOccupiedRow: skips rows where every cell is incapacitated", () => {
    const grid = makeGrid({ 20: "infantry", 15: "mg" });
    grid[20].incapacitated = true;
    assert.strictEqual(_getFrontmostOccupiedRow(grid), 3);
  });

  // ── getTargetCells — n defaults to Infinity (all) ─────────────────────────

  it("getTargetCells: infantry targets all living cells in frontmost occupied row", () => {
    const grid = makeGrid({ 20: "infantry", 22: "mg", 10: "infantry" });
    const targets = getTargetCells("infantry", 4, 0, grid, 1);
    assert.deepStrictEqual([...targets].sort((a,b)=>a-b), [20, 22]);
  });

  it("getTargetCells: infantry returns [] when all enemy cells empty/incapacitated", () => {
    const grid = makeGrid({ 20: "infantry" });
    grid[20].incapacitated = true;
    assert.deepStrictEqual(getTargetCells("infantry", 4, 0, grid, 1), []);
  });

  it("getTargetCells: assault_infantry targets same frontmost row as infantry", () => {
    const grid = makeGrid({ 20: "mg", 21: "infantry" });
    const inf = getTargetCells("infantry",        4, 0, grid, 1);
    const ass = getTargetCells("assault_infantry", 4, 0, grid, 1);
    assert.deepStrictEqual([...ass].sort((a,b)=>a-b), [...inf].sort((a,b)=>a-b));
  });

  it("getTargetCells: recon_infantry targets same frontmost row as infantry", () => {
    const grid = makeGrid({ 20: "mg" });
    assert.deepStrictEqual(
      getTargetCells("recon_infantry", 4, 0, grid, 1),
      getTargetCells("infantry",       4, 0, grid, 1),
    );
  });

  it("getTargetCells: commando targets same frontmost row as infantry", () => {
    const grid = makeGrid({ 20: "mg" });
    assert.deepStrictEqual(
      getTargetCells("commando", 4, 0, grid, 1),
      getTargetCells("infantry", 4, 0, grid, 1),
    );
  });

  // ── n parameter ───────────────────────────────────────────────────────────

  it("getTargetCells: n=2 returns 2 leftmost living cells from frontmost row", () => {
    // R5 has 4 living cells: idx 20, 21, 22, 23
    const grid = makeGrid({ 20: "infantry", 21: "mg", 22: "infantry", 23: "cavalry" });
    const targets = getTargetCells("infantry", 4, 0, grid, 1, 2);
    assert.deepStrictEqual(targets, [20, 21]);
  });

  it("getTargetCells: n=3 with only 1 living cell — returns [that 1], no spillover to next row", () => {
    // R5 has 1 unit, R4 has units; n=3 but no redirect
    const grid = makeGrid({ 20: "infantry", 15: "mg", 16: "infantry" });
    const targets = getTargetCells("infantry", 4, 0, grid, 1, 3);
    assert.deepStrictEqual(targets, [20]);
  });

  it("getTargetCells: n=Infinity (default) returns all living cells in frontmost row", () => {
    const grid = makeGrid({ 20: "infantry", 21: "mg", 22: "infantry", 23: "cavalry", 24: "mg" });
    const targets = getTargetCells("infantry", 4, 0, grid, 1);
    assert.deepStrictEqual([...targets].sort((a,b)=>a-b), [20, 21, 22, 23, 24]);
  });

  // ── MG ────────────────────────────────────────────────────────────────────

  it("getTargetCells: mg targets same frontmost row as infantry", () => {
    const grid = makeGrid({ 22: "at_gun", 10: "infantry" });
    const inf = getTargetCells("infantry", 4, 0, grid, 1);
    const mg  = getTargetCells("mg",       4, 0, grid, 1);
    assert.deepStrictEqual([...mg].sort((a,b)=>a-b), [...inf].sort((a,b)=>a-b));
  });

  it("getDamageProfile: mg has higher supp_fraction than infantry", () => {
    const mgp  = getDamageProfile("mg",       1);
    const infp = getDamageProfile("infantry", 1);
    assert.ok(mgp.supp_fraction > infp.supp_fraction);
    assert.ok(mgp.hp_fraction   < infp.hp_fraction);
  });

  it("getDamageProfile: mg cavalry_supp_mult > 1.0", () => {
    assert.ok(getDamageProfile("mg", 1).cavalry_supp_mult > 1.0);
  });

  // ── Cavalry ───────────────────────────────────────────────────────────────

  it("getTargetCells: cavalry targets frontmost row same as infantry", () => {
    const grid = makeGrid({ 20: "infantry", 22: "mg" });
    const inf = getTargetCells("infantry", 4, 2, grid, 1);
    const cav = getTargetCells("cavalry",  4, 2, grid, 1);
    assert.deepStrictEqual([...cav].sort((a,b)=>a-b), [...inf].sort((a,b)=>a-b));
  });

  it("getDamageProfile: cavalry round 1 has higher hp_fraction than round 2 (charge bonus)", () => {
    const r1 = getDamageProfile("cavalry", 1);
    const r2 = getDamageProfile("cavalry", 2);
    assert.ok(r1.hp_fraction   > r2.hp_fraction);
    assert.ok(r1.supp_fraction > r2.supp_fraction);
  });

  it("getDamageProfile: cavalry round 2+ equals standard infantry profile", () => {
    const cav2 = getDamageProfile("cavalry",  2);
    const inf1 = getDamageProfile("infantry", 1);
    assert.strictEqual(cav2.hp_fraction,   inf1.hp_fraction);
    assert.strictEqual(cav2.supp_fraction, inf1.supp_fraction);
  });

  // ── Flamethrower ──────────────────────────────────────────────────────────

  it("getTargetCells: flamethrower at R5,C3 hits 3×2 AOE (R5+R4, C2–C4)", () => {
    // Fill R4 and R5 completely
    const occ: Record<number, string> = {};
    for (let i = 15; i < 25; i++) occ[i] = "infantry";
    const grid = makeGrid(occ);
    // FLM at row=4 (R5), col=2 (C3): zone = rows[4,3] × cols[1,2,3]
    // R5 cols 1,2,3 = idx 21,22,23; R4 cols 1,2,3 = idx 16,17,18
    const targets = getTargetCells("flamethrower", 4, 2, grid, 1);
    assert.deepStrictEqual([...targets].sort((a,b)=>a-b), [16, 17, 18, 21, 22, 23]);
  });

  it("getTargetCells: flamethrower at C1 clamps left (no negative column)", () => {
    const grid = makeGrid({ 20: "infantry", 21: "infantry", 15: "infantry", 16: "infantry" });
    // FLM at row=4 (R5), col=0 (C1) → cols [0,1] only (col -1 clamped out)
    const targets = getTargetCells("flamethrower", 4, 0, grid, 1);
    assert.deepStrictEqual([...targets].sort((a,b)=>a-b), [15, 16, 20, 21]);
  });

  it("getTargetCells: flamethrower at C5 clamps right (no column beyond 4)", () => {
    const grid = makeGrid({ 23: "infantry", 24: "infantry", 18: "infantry", 19: "infantry" });
    // FLM at row=4 (R5), col=4 (C5) → cols [3,4] only (col 5 clamped out)
    const targets = getTargetCells("flamethrower", 4, 4, grid, 1);
    assert.deepStrictEqual([...targets].sort((a,b)=>a-b), [18, 19, 23, 24]);
  });

  it("getTargetCells: flamethrower at R1 only hits one row (no row below R1)", () => {
    const grid = makeGrid({ 0: "infantry", 1: "mg", 2: "infantry" });
    // FLM at row=0 (R1), col=1 (C2) → rows [0] only (row -1 clamped out)
    const targets = getTargetCells("flamethrower", 0, 1, grid, 1);
    assert.deepStrictEqual([...targets].sort((a,b)=>a-b), [0, 1, 2]);
  });

  it("getTargetCells: flamethrower skips incapacitated cells in AOE zone", () => {
    const grid = makeGrid({ 21: "infantry", 22: "infantry", 16: "infantry", 17: "infantry" });
    grid[22].incapacitated = true;
    const targets = getTargetCells("flamethrower", 4, 2, grid, 1);
    assert.ok(!targets.includes(22), "incapacitated cell must not be targeted");
  });

  it("getDamageProfile: flamethrower bypasses_armour is true", () => {
    assert.strictEqual(getDamageProfile("flamethrower", 1).bypasses_armour, true);
  });

  it("getDamageProfile: infantry bypasses_armour is false", () => {
    assert.strictEqual(getDamageProfile("infantry", 1).bypasses_armour, false);
  });

  it("getDamageProfile: flamethrower has higher supp_fraction than infantry", () => {
    assert.ok(getDamageProfile("flamethrower", 1).supp_fraction > getDamageProfile("infantry", 1).supp_fraction);
  });

  // ── getFireOrder ──────────────────────────────────────────────────────────

  it("getFireOrder: empty grid returns []", () => {
    assert.deepStrictEqual(getFireOrder(makeGrid({}), []), []);
  });

  it("getFireOrder: default order is R5→R1, left→right, skipping empty/incapacitated", () => {
    // R5C1=idx20 (inf), R5C3=idx22 (mg), R4C2=idx16 (cav)
    const grid = makeGrid({ 20: "infantry", 22: "mg", 16: "cavalry" });
    const order = getFireOrder(grid, []);
    assert.deepStrictEqual(order.map(e => e.idx), [20, 22, 16]);
  });

  it("getFireOrder: priority_types fires those units first", () => {
    // R5: idx20=inf, idx22=mg; R3: idx10=artillery
    const grid = makeGrid({ 20: "infantry", 22: "mg", 10: "artillery" });
    const order = getFireOrder(grid, ["artillery"]);
    assert.strictEqual(order[0].idx, 10); // artillery first
    assert.deepStrictEqual(order.slice(1).map(e => e.idx), [20, 22]);
  });

  it("getFireOrder: multiple priority_types respect their given order", () => {
    const grid = makeGrid({ 20: "infantry", 22: "sniper", 10: "artillery" });
    // artillery first, sniper second
    const order = getFireOrder(grid, ["artillery", "sniper"]);
    assert.strictEqual(order[0].idx, 10); // artillery
    assert.strictEqual(order[1].idx, 22); // sniper
    assert.strictEqual(order[2].idx, 20); // infantry (default sequential)
  });

  it("getFireOrder: incapacitated cells are excluded", () => {
    const grid = makeGrid({ 20: "infantry", 22: "mg" });
    grid[20].incapacitated = true;
    const order = getFireOrder(grid, []);
    assert.deepStrictEqual(order.map(e => e.idx), [22]);
  });

  // ── simulateRound ─────────────────────────────────────────────────────────

  it("simulateRound: all attackers target frontmost enemy row when no clearing happens", () => {
    // 3 attacker infantry in R5; enemy has 2 cells in R5 and 1 in R4
    // At hp=100, a few hits won't clear R5 → all 3 attackers target R5
    const attackers = makeGrid({ 20: "infantry", 21: "infantry", 22: "infantry" });
    const enemy     = makeGrid({ 20: "infantry", 22: "infantry", 15: "mg" });
    const result    = simulateRound(attackers, enemy, 1, [], Infinity);
    assert.deepStrictEqual([...result.get(20)!].sort((a,b)=>a-b), [20, 22]);
    assert.deepStrictEqual([...result.get(21)!].sort((a,b)=>a-b), [20, 22]);
    assert.deepStrictEqual([...result.get(22)!].sort((a,b)=>a-b), [20, 22]);
  });

  it("simulateRound: later attacker redirects to R4 after R5 fully cleared", () => {
    // Enemy R5: 1 infantry at idx20, hp=1 (below incap floor of 20 → first hit clears it)
    // Enemy R4: 1 mg at idx15
    const attackers = makeGrid({ 20: "infantry", 21: "infantry" });
    const enemy     = makeGrid({ 20: "infantry", 15: "mg" });
    enemy[20].hp    = 1; // critically low — first hit incapacitates (hp 1 ≤ floor 20)
    const result    = simulateRound(attackers, enemy, 1, [], Infinity);
    // First attacker (idx20) hits enemy[20] → incapacitated
    // Second attacker (idx21) → R5 empty → redirects to R4 → hits enemy[15]
    assert.ok(result.get(20)!.includes(20),  "first attacker hits R5 enemy[20]");
    assert.ok(result.get(21)!.includes(15),  "second attacker redirects to R4");
    assert.ok(!result.get(21)!.includes(20), "second attacker does NOT target cleared R5");
  });

  it("simulateRound: n=3 with 1 enemy in R5 — no spillover, both attackers hit R5", () => {
    // Enemy: 1 unit in R5 (hp=100), 1 in R4; 2 attackers; n=3
    // n > available targets → concentrate on that 1, no redirect
    const attackers = makeGrid({ 20: "infantry", 21: "infantry" });
    const enemy     = makeGrid({ 20: "infantry", 15: "mg" });
    const result    = simulateRound(attackers, enemy, 1, [], 3);
    assert.deepStrictEqual(result.get(20), [20]); // only 1 target available
    assert.deepStrictEqual(result.get(21), [20]); // still R5, NOT R4
  });

  it("simulateRound: priority unit fires first and may enable spillover for default units", () => {
    // Artillery (priority) in R3; infantry in R5
    // Enemy R5: 1 infantry at idx20, hp=1
    const attackers = makeGrid({ 10: "artillery", 20: "infantry" });
    const enemy     = makeGrid({ 20: "infantry", 15: "mg" });
    enemy[20].hp    = 1;
    const result    = simulateRound(attackers, enemy, 1, ["artillery"], Infinity);
    // artillery (idx10) fires first → clears enemy R5
    // infantry (idx20) fires second → R5 empty → redirects to R4 → hits enemy[15]
    assert.ok(result.get(10)!.includes(20), "artillery hits R5 enemy[20]");
    assert.ok(result.get(20)!.includes(15), "infantry redirects to R4 after artillery clears R5");
  });
});
```

**Expected before implementation**: all ~35 tests RED — `attack_patterns` module does not exist.

---

### 3. `game-server/src/systems/attack_patterns.ts` (NEW)

```typescript
import { GridCellState } from "../rooms/schema/GameRoomState.js";
import { UNIT_COMBAT_STATS } from "../data/unit_combat_stats.js";
import { BASE_ATTRITION } from "../data/combat_constants.js";

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface DamageProfile {
  hp_fraction:       number;   // fraction of BASE_ATTRITION going to HP (0–1)
  supp_fraction:     number;   // fraction going to suppression (0–1)
  bypasses_armour:   boolean;  // if true, skip armour pen check in _applyPerCellDamage
  cavalry_supp_mult: number;   // extra suppression multiplier when target.unit_type === "cavalry"
}

export interface FireOrderEntry {
  cell: GridCellState;
  idx:  number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Damage profiles
// ─────────────────────────────────────────────────────────────────────────────

const PROFILE_INFANTRY: DamageProfile = {
  hp_fraction: 0.30, supp_fraction: 0.70, bypasses_armour: false, cavalry_supp_mult: 1.0,
};
const PROFILE_MG: DamageProfile = {
  hp_fraction: 0.08, supp_fraction: 0.92, bypasses_armour: false, cavalry_supp_mult: 2.0,
};
const PROFILE_CAVALRY_CHARGE: DamageProfile = {   // Round 1 only
  hp_fraction: 0.55, supp_fraction: 0.45, bypasses_armour: false, cavalry_supp_mult: 1.0,
};
const PROFILE_FLAMETHROWER: DamageProfile = {
  hp_fraction: 0.20, supp_fraction: 0.80, bypasses_armour: true, cavalry_supp_mult: 1.0,
};

export function getDamageProfile(unit_type: string, round_number: number): DamageProfile {
  switch (unit_type) {
    case "mg":           return PROFILE_MG;
    case "cavalry":      return round_number === 1 ? PROFILE_CAVALRY_CHARGE : PROFILE_INFANTRY;
    case "flamethrower": return PROFILE_FLAMETHROWER;
    default:             return PROFILE_INFANTRY;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid helpers
// ─────────────────────────────────────────────────────────────────────────────

// Returns row index (4=R5…0=R1) of frontmost row with ≥1 living cell.
// "Living" = unit_type !== "" AND NOT incapacitated.
// Returns -1 if all cells are empty or incapacitated.
export function _getFrontmostOccupiedRow(cells: GridCellState[]): number {
  for (let row = 4; row >= 0; row--) {
    for (let col = 0; col < 5; col++) {
      const cell = cells[row * 5 + col];
      if (cell && cell.unit_type !== "" && !cell.incapacitated) return row;
    }
  }
  return -1;
}

// Returns indices of living cells in `row`, left-to-right (C1→C5) order.
function _getLivingCellsInRow(cells: GridCellState[], row: number): number[] {
  if (row < 0) return [];
  const result: number[] = [];
  for (let col = 0; col < 5; col++) {
    const idx  = row * 5 + col;
    const cell = cells[idx];
    if (cell && cell.unit_type !== "" && !cell.incapacitated) result.push(idx);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attack pattern implementations
// ─────────────────────────────────────────────────────────────────────────────

// Returns up to n leftmost living cells in the frontmost occupied enemy row.
// If only k < n cells exist, returns all k — no spillover to next row.
function _horizontalTargets(cells: GridCellState[], n: number = Infinity): number[] {
  const row    = _getFrontmostOccupiedRow(cells);
  const living = _getLivingCellsInRow(cells, row);
  return isFinite(n) ? living.slice(0, n) : living;
}

// 3-column × 2-row AOE centred on attacker position.
// Zone = [attacker_row, attacker_row-1] × [col-1, col, col+1], both clamped to grid.
// Does NOT use the n parameter.
function _flamethrowerTargets(
  attacker_row: number,
  attacker_col: number,
  cells: GridCellState[],
): number[] {
  const rows = [attacker_row, attacker_row - 1].filter(r => r >= 0);
  const cols = [attacker_col - 1, attacker_col, attacker_col + 1].filter(c => c >= 0 && c <= 4);
  const targets: number[] = [];
  for (const r of rows) {
    for (const c of cols) {
      const idx  = r * 5 + c;
      const cell = cells[idx];
      if (cell && cell.unit_type !== "" && !cell.incapacitated) targets.push(idx);
    }
  }
  return targets;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns enemy cell_indices this attacker unit should target.
 *
 * @param unit_type      attacker's unit_type
 * @param attacker_row   attacker's row index (0=R1, 4=R5)
 * @param attacker_col   attacker's column index (0=C1, 4=C5)
 * @param enemy_cells    25-cell enemy GridCellState array (may be a virtual copy in simulateRound)
 * @param round_number   1-indexed round number (used for cavalry charge check)
 * @param n              max targets to select left-to-right (default Infinity = all);
 *                       flamethrower ignores n and always returns its full AOE zone
 */
export function getTargetCells(
  unit_type:    string,
  attacker_row: number,
  attacker_col: number,
  enemy_cells:  GridCellState[],
  round_number: number,
  n:            number = Infinity,
): number[] {
  switch (unit_type) {
    case "infantry":
    case "assault_infantry":
    case "recon_infantry":    // Branch F adds recon accumulation; targeting is identical here
    case "commando":
    case "mg":
    case "cavalry":
      return _horizontalTargets(enemy_cells, n);
    case "flamethrower":
      return _flamethrowerTargets(attacker_row, attacker_col, enemy_cells);
    default:
      return []; // Branch E handles armour/AT/AA; Branch F handles sniper/artillery
  }
}

/**
 * Returns attacker cells sorted into fire order.
 *
 * Sorting rules (in priority):
 *   1. Units whose unit_type is in priority_types[] fire first, in listed order.
 *      These are unlocked via research perks (future feature).
 *   2. All other units: R5 first (row=4 → row=0), left-to-right (col 0→4) within each row.
 *
 * Incapacitated and empty cells are excluded.
 *
 * For Branch D: always call with priority_types = [] (no perks implemented yet).
 *
 * @param attacker_cells  25-cell attacker GridCellState array (round-start snapshot)
 * @param priority_types  unit types that fire before all others, in listed order
 */
export function getFireOrder(
  attacker_cells: GridCellState[],
  priority_types: string[] = [],
): FireOrderEntry[] {
  const living: FireOrderEntry[] = attacker_cells
    .map((cell, idx) => ({ cell, idx }))
    .filter(({ cell }) => cell.unit_type !== "" && !cell.incapacitated);

  return living.sort((a, b) => {
    const aP = priority_types.indexOf(a.cell.unit_type);
    const bP = priority_types.indexOf(b.cell.unit_type);
    if (aP >= 0 && bP >= 0) return aP - bP;   // both priority: respect listed order
    if (aP >= 0)             return -1;         // only a: a first
    if (bP >= 0)             return  1;         // only b: b first
    // neither: R5 (row=4) first, lower col first
    const aRow = Math.floor(a.idx / 5);
    const bRow = Math.floor(b.idx / 5);
    if (aRow !== bRow) return bRow - aRow;
    return (a.idx % 5) - (b.idx % 5);
  });
}

/**
 * Simulates a full round and returns which enemy cells each attacker targets,
 * accounting for fire order and spillover (row-cleared redirect).
 *
 * Used by the client (via GDScript mirror) to preview the next round during the
 * inter-round timer window. Produces the same target assignments as the server's
 * _applyPerCellDamage, which achieves spillover implicitly by mutating
 * defender.grid.cells in-place. Here we replicate that with a deep-copied virtual grid.
 *
 * Simplified damage model for clearing detection:
 *   virtual_hp_damage = BASE_ATTRITION * profile.hp_fraction / targets.length
 *   Cell marked incapacitated when virtual_hp <= hp_floor_pct (from UNIT_COMBAT_STATS)
 *   or virtual_hp <= 0 (artillery/towed AT/AA — no floor but can be destroyed).
 * Pen/armour multipliers are NOT applied (acceptable approximation for the preview).
 *
 * @param attacker_cells   25-cell attacker grid (round-start snapshot; NOT mutated)
 * @param enemy_cells      25-cell enemy grid (round-start snapshot; NOT mutated)
 * @param round_number     1-indexed round number
 * @param priority_types   unit types with attack priority (default [])
 * @param n                max targets per attacker per row (default Infinity)
 * @returns Map: attacker cell_index → Array of target enemy cell_indices
 */
export function simulateRound(
  attacker_cells: GridCellState[],
  enemy_cells:    GridCellState[],
  round_number:   number,
  priority_types: string[] = [],
  n:              number   = Infinity,
): Map<number, number[]> {
  // Deep-copy enemy grid — never mutate the originals
  const virtual: GridCellState[] = enemy_cells.map(c => {
    const v         = new GridCellState();
    v.unit_type     = c.unit_type;
    v.hp            = c.hp;
    v.suppression   = c.suppression;
    v.incapacitated = c.incapacitated;
    v.stealthed     = c.stealthed;
    return v;
  });

  const result = new Map<number, number[]>();
  const order  = getFireOrder(attacker_cells, priority_types);

  for (const { cell: attCell, idx } of order) {
    const attRow = Math.floor(idx / 5);
    const attCol = idx % 5;

    // Re-evaluate targets against VIRTUAL grid so cleared rows redirect subsequent attackers
    const targets = getTargetCells(attCell.unit_type, attRow, attCol, virtual, round_number, n);
    result.set(idx, targets);
    if (targets.length === 0) continue;

    // Apply simplified virtual HP damage for clearing detection (no pen/armour)
    const profile     = getDamageProfile(attCell.unit_type, round_number);
    const perTargetHp = (BASE_ATTRITION * profile.hp_fraction) / targets.length;

    for (const tIdx of targets) {
      const tCell = virtual[tIdx];
      if (!tCell || tCell.incapacitated) continue;
      tCell.hp = Math.max(0, tCell.hp - perTargetHp);
      const floorPct = UNIT_COMBAT_STATS[tCell.unit_type]?.hp_floor_pct ?? 0;
      if ((floorPct > 0 && tCell.hp <= floorPct) || tCell.hp <= 0) {
        tCell.incapacitated = true;
      }
    }
  }

  return result;
}
```

---

## Files to Modify

### 4. `game-server/src/systems/combat_system.ts`

#### A. Constants import — **ALREADY DONE, SKIP**

`combat_system.ts` already imports `BASE_ATTRITION`, `HP_DAMAGE_FRACTION`, and
`SUPPRESSION_FRACTION` from `../data/combat_constants.js`. There are no local
`const` declarations to remove.

#### B. Add import for attack_patterns

`UNIT_COMBAT_STATS` is already imported at line 7. Only add this one line:

```typescript
import { getTargetCells, getDamageProfile, getFireOrder } from "./attack_patterns.js";
```

#### C. Replace `_applyPerCellDamage()` body

Find the `_applyPerCellDamage` method added in Branch C (stub that distributes evenly).
Replace its ENTIRE body with:

```typescript
private _applyPerCellDamage(
  attacker: DivisionState,
  defender: DivisionState,
  rawDamage: number,
  pair: ActivePair,
  broadcast: (type: string, msg: unknown) => void,
): GridCellDelta[] {
  if (!attacker.grid || !defender.grid) return [];

  // Snapshot fire order from round-start attacker state.
  // Units incapacitated mid-round by enemy fire still fire — simultaneous resolution.
  const fireOrder = getFireOrder(attacker.grid.cells, []); // [] = no perk priority yet
  if (fireOrder.length === 0) return [];

  const perAttackerBudget = rawDamage / fireOrder.length;
  const roundNumber       = pair.round; // 1-indexed (Branch B)
  const deltasMap         = new Map<number, GridCellDelta>();

  for (const { cell: attCell, idx } of fireOrder) {
    const attRow      = Math.floor(idx / 5);
    const attCol      = idx % 5;
    const profile     = getDamageProfile(attCell.unit_type, roundNumber);

    // Re-evaluate targets against the LIVE defender grid each iteration.
    // defender.grid.cells is mutated in-place below, so later attackers in the fire
    // order naturally see cleared rows via _getFrontmostOccupiedRow — this is how
    // spillover works on the server without any explicit redirect logic.
    const targets     = getTargetCells(attCell.unit_type, attRow, attCol, defender.grid.cells, roundNumber);
    const attackerPen = UNIT_COMBAT_STATS[attCell.unit_type]?.pen ?? 10;

    if (targets.length === 0) continue;

    const perTargetHp   = (perAttackerBudget * profile.hp_fraction)   / targets.length;
    const perTargetSupp = (perAttackerBudget * profile.supp_fraction) / targets.length;

    for (const tIdx of targets) {
      const tCell  = defender.grid.cells[tIdx];
      if (!tCell) continue;

      const armour  = UNIT_COMBAT_STATS[tCell.unit_type]?.armour ?? 0;
      const penMult = profile.bypasses_armour ? 1.0 : _armorPenMultiplier(attackerPen, armour);
      const cavMult = (tCell.unit_type === "cavalry") ? profile.cavalry_supp_mult : 1.0;

      tCell.hp          = Math.max(0, tCell.hp - perTargetHp * penMult);
      tCell.suppression = Math.min(100, tCell.suppression + perTargetSupp * cavMult);

      const floor = _getIncapFloor(tCell.unit_type);
      if (floor > 0 && tCell.hp <= floor && !tCell.incapacitated) {
        tCell.incapacitated = true;
        broadcast("UNIT_INCAPACITATED", {
          engagement_id: pair.engagement_id,
          division_id:   defender.division_id,
          cell_index:    tIdx,
          unit_type:     tCell.unit_type as UnitTypeValue,
          xp_retained:   0,
        } satisfies UnitIncapacitatedPayload);
      }

      // Overwrite: last write reflects all accumulated in-place mutations
      deltasMap.set(tIdx, {
        cell_index:    tIdx,
        hp:            tCell.hp,
        suppression:   tCell.suppression,
        incapacitated: tCell.incapacitated,
      });
    }
  }

  return Array.from(deltasMap.values());
}
```

**Also remove** `_getBestPenValue()` — Branch C stub now replaced by per-cell pen lookup.

---

### 5. `client/src/ui/hud/attack_pattern_registry.gd` (CREATE — file does not exist yet)

Branch K created this as a stub returning `[]`. Branch D fills it in. The `get_targets`
signature changes: replaces `is_attacker: bool` with `enemy_cells: Array` and adds `n: int`.

Full file content — overwrite the stub entirely:

```gdscript
class_name AttackPatternRegistry

# ─────────────────────────────────────────────────────────────────────────────
# Constants — must stay in sync with:
#   game-server/src/data/combat_constants.ts
#   game-server/src/data/unit_combat_stats.ts
# ─────────────────────────────────────────────────────────────────────────────

const BASE_ATTRITION := 2.5

# hp_floor_pct per unit type. 0 = no floor (artillery, towed AT, AA).
const HP_FLOOR_PCT : Dictionary = {
    "infantry": 20, "assault_infantry": 20, "recon_infantry": 20,
    "mg": 20, "cavalry": 20, "sniper": 20, "commando": 20, "flamethrower": 20,
    "light_tank": 30, "medium_tank": 30, "heavy_tank": 30, "armoured_car": 30,
    "at_infantry": 20, "at_gun": 0, "at_gun_sp": 30,
    "aa_gun": 0, "artillery": 0,
}

# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

# Returns enemy cell indices that the unit at cell_index would target.
#
# enemy_cells: Array of 25 Dictionaries, each with keys:
#   unit_type (String), hp (float), suppression (float),
#   incapacitated (bool), stealthed (bool)
#
# n: max targets to select left-to-right (0 = all / Infinity equivalent).
#
# NOTE: signature changed from Branch K stub (which had is_attacker: bool).
# Update all callers in tactical_combat_panel.gd accordingly.
static func get_targets(
    unit_type: String,
    cell_index: int,
    enemy_cells: Array,
    n: int = 0,
) -> Array[int]:
    var att_row : int = cell_index / 5
    var att_col : int = cell_index % 5
    match unit_type:
        "infantry", "assault_infantry", "recon_infantry", "commando", "mg", "cavalry":
            return _horizontal_targets(enemy_cells, n)
        "flamethrower":
            return _flamethrower_targets(att_row, att_col, enemy_cells)
        _:
            return []  # Branch E fills armour/AT/AA; Branch F fills sniper/artillery

# Simulates a full round. Returns Dictionary: int attacker_idx → Array[int] target_indices.
# Accounts for fire order and spillover (row-cleared redirect).
#
# attacker_cells, enemy_cells: Array of 25 Dicts (same format as get_targets).
# priority_types: Array[String] of unit types that fire before others (perk system; default []).
# n: max targets per attacker (0 = all).
static func simulate_round(
    attacker_cells: Array,
    enemy_cells: Array,
    round_number: int,
    priority_types: Array = [],
    n: int = 0,
) -> Dictionary:
    # Deep-copy enemy cells for virtual damage tracking (do not mutate originals)
    var virtual : Array = []
    for c in enemy_cells:
        virtual.append({
            "unit_type":     c.get("unit_type", ""),
            "hp":            float(c.get("hp", 100)),
            "suppression":   float(c.get("suppression", 0)),
            "incapacitated": c.get("incapacitated", false),
            "stealthed":     c.get("stealthed", false),
        })

    var result     : Dictionary = {}
    var fire_order : Array      = _get_fire_order(attacker_cells, priority_types)

    for entry in fire_order:
        var att_idx  : int    = entry["idx"]
        var att_row  : int    = att_idx / 5
        var att_col  : int    = att_idx % 5
        var utype    : String = entry["unit_type"]

        var targets : Array[int] = []
        match utype:
            "infantry", "assault_infantry", "recon_infantry", "commando", "mg", "cavalry":
                targets = _horizontal_targets(virtual, n)
            "flamethrower":
                targets = _flamethrower_targets(att_row, att_col, virtual)
            _:
                targets = []

        result[att_idx] = targets
        if targets.is_empty():
            continue

        # Apply virtual HP damage for clearing detection (no pen/armour, approximation is fine)
        var hp_frac : float = _hp_fraction_for(utype, round_number)
        var per_hp  : float = (BASE_ATTRITION * hp_frac) / float(targets.size())

        for t_idx in targets:
            if t_idx < 0 or t_idx >= 25:
                continue
            var tc = virtual[t_idx]
            if tc.get("incapacitated", false):
                continue
            var new_hp    : float = maxf(0.0, float(tc.get("hp", 100)) - per_hp)
            tc["hp"]              = new_hp
            var floor_pct : float = float(HP_FLOOR_PCT.get(tc.get("unit_type", ""), 0))
            if (floor_pct > 0.0 and new_hp <= floor_pct) or new_hp <= 0.0:
                tc["incapacitated"] = true

    return result

# ─────────────────────────────────────────────────────────────────────────────
# Private helpers
# ─────────────────────────────────────────────────────────────────────────────

static func _frontmost_occupied_row(cells: Array) -> int:
    for row in range(4, -1, -1):
        for col in range(5):
            var cell = cells[row * 5 + col]
            if cell.get("unit_type", "") != "" and not cell.get("incapacitated", false):
                return row
    return -1

# n=0 means all (no cap). n>0 returns at most n leftmost cells.
static func _horizontal_targets(cells: Array, n: int) -> Array[int]:
    var row := _frontmost_occupied_row(cells)
    if row < 0:
        return []
    var result : Array[int] = []
    for col in range(5):
        var idx  := row * 5 + col
        var cell  = cells[idx]
        if cell.get("unit_type", "") != "" and not cell.get("incapacitated", false):
            result.append(idx)
        if n > 0 and result.size() >= n:
            break
    return result

static func _flamethrower_targets(att_row: int, att_col: int, cells: Array) -> Array[int]:
    var rows : Array[int] = []
    if att_row >= 0:      rows.append(att_row)
    if att_row - 1 >= 0: rows.append(att_row - 1)
    var cols : Array[int] = []
    for c in [att_col - 1, att_col, att_col + 1]:
        if c >= 0 and c <= 4: cols.append(c)
    var result : Array[int] = []
    for r in rows:
        for c in cols:
            var idx  := r * 5 + c
            var cell  = cells[idx]
            if cell.get("unit_type", "") != "" and not cell.get("incapacitated", false):
                result.append(idx)
    return result

# Returns fire order as Array[{idx: int, unit_type: String}].
# Priority units first (in listed order), then R5→R1, left→right.
static func _get_fire_order(attacker_cells: Array, priority_types: Array) -> Array:
    var living : Array = []
    for i in range(attacker_cells.size()):
        var cell = attacker_cells[i]
        if cell.get("unit_type", "") != "" and not cell.get("incapacitated", false):
            living.append({ "idx": i, "unit_type": cell.get("unit_type", "") })

    living.sort_custom(func(a, b) -> bool:
        var aP : int = priority_types.find(a["unit_type"])
        var bP : int = priority_types.find(b["unit_type"])
        if aP >= 0 and bP >= 0: return aP < bP
        if aP >= 0:              return true
        if bP >= 0:              return false
        var aRow : int = a["idx"] / 5
        var bRow : int = b["idx"] / 5
        if aRow != bRow: return aRow > bRow   # higher row = closer to front = fires first
        return (a["idx"] % 5) < (b["idx"] % 5)  # lower col = C1 first
    )
    return living

# Returns hp_fraction from damage profile for a given unit type and round.
static func _hp_fraction_for(unit_type: String, round_number: int) -> float:
    match unit_type:
        "mg":           return 0.08
        "flamethrower": return 0.20
        "cavalry":      return 0.55 if round_number == 1 else 0.30
        _:              return 0.30  # infantry, assault, recon, commando, default
```

---

## Verification Gate

```bash
cd game-server && NODE_ENV=test npx mocha -r tsx test/6d-infantry-patterns.test.ts --exit --timeout 15000
```

All ~35 tests must pass. Then:
1. `npx tsc --noEmit` — zero TypeScript errors.
2. Existing tests still pass: `6a-grid-schema.test.ts`, `6c-combat-stats.test.ts`.
3. Manual smoke: two bots with 5 infantry in R5 vs 5 infantry in R5. `ROUND_RESOLVED`
   `defender_grid_delta` should contain only cells 20–24 (R5).
4. Spillover smoke: one bot with many infantry vs 1 enemy infantry in R5 and 1 in R4.
   After R5 cell incapacitates, subsequent attackers' delta entries should show the R4
   cell taking damage.

---

## Common Errors to Avoid

1. **`pair.round` is 1-indexed.** Cavalry charge fires on `round_number === 1`. Verify
   Branch B increments before calling `_applyDamage`, not after.

2. **Off-by-one in row index.** `row 4 = R5 (front)`. `_getFrontmostOccupiedRow` starts
   at `row = 4`, never `row = 5` (index 25 is out of bounds).

3. **DeltasMap last-write semantics.** Multiple attackers hit the same defender cell.
   `deltasMap.set(tIdx, ...)` overwrites. This is correct — the cell is mutated in-place
   cumulatively, so the last write captures the final state after all hits.

4. **Flamethrower row direction.** AOE = `[attacker_row, attacker_row - 1]`, NOT `+1`.
   Row 4 is front. FLM at R5 (row=4) hits rows 4 and 3.

5. **Circular import guard.** `attack_patterns.ts` imports from `combat_constants.ts`
   and `unit_combat_stats.ts`. It must NOT import from `combat_system.ts`.

6. **`_getBestPenValue` removed.** Branch C stub replaced by per-cell pen lookup.
   Delete `_getBestPenValue` from `combat_system.ts`.

7. **`simulateRound` deep-copy.** Use `new GridCellState()` and copy fields explicitly —
   do NOT spread `{...c}` on a Colyseus schema object.

8. **`recon_infantry` recon accumulation deferred.** `getTargetCells` for `recon_infantry`
   returns horizontal targets only. Add comment: `// Branch F adds recon accumulation`.

9. **GDScript `n=0` means "all".** TypeScript uses `Infinity`; GDScript uses `0` as the
   "no cap" sentinel. `_horizontal_targets` only slices when `n > 0`.

10. **GDScript constants must stay in sync with TypeScript.** `BASE_ATTRITION = 2.5`,
    `HP_FLOOR_PCT`, `_hp_fraction_for` values — update GDScript in the same PR if server
    constants change.

11. **Meeting battle symmetry.** `getFireOrder` runs independently for each direction.
    No change to meeting battle handling from Branch C.
