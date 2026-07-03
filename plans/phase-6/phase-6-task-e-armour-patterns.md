# Plan E — `feat/tactical-armour-patterns`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add column attack patterns for armour units (depth rule + column shift), AT units (armoured-targets-only column selection), and AA (no-op) to `attack_patterns.ts`, and wire side-armour / tactical-flank damage into `_applyPerCellDamage`.

**Architecture:** Pure TypeScript helpers in `attack_patterns.ts` (fully unit-testable); minimal changes to `combat_system.ts` to store `battle_cover` in `ActivePair` and pass it through; matching GDScript stubs in `attack_pattern_registry.gd`. TDD: write all tests first (RED), implement until GREEN.

**Tech Stack:** TypeScript + Colyseus/schema, Mocha + tsx, GDScript 4

## Global Constraints

- `moduleResolution: "NodeNext"` — ALL relative TypeScript imports must end in `.js`
- `GridCellState` is a Colyseus schema object — never spread `{...c}`; copy fields explicitly
- All constants must stay in sync between `combat_constants.ts` (server) and `attack_pattern_registry.gd` (client)
- TDD: test file created first, all tests RED, then implement until GREEN
- Branch D's existing tests (`6d-infantry-patterns.test.ts`, `6c-combat-stats.test.ts`, `6a-grid-schema.test.ts`) must still pass after Branch E

---

## Grid Indexing Reference

```
cell_index = row * 5 + col
row 0 = R1 (rear)    row 4 = R5 (vanguard/front — closest to enemy)
col 0 = C1           col 4 = C5

R5 cells: 20 21 22 23 24
R4 cells: 15 16 17 18 19
R3 cells: 10 11 12 13 14
R2 cells:  5  6  7  8  9
R1 cells:  0  1  2  3  4
```

Both grids face each other at their R5 rows. Higher row index = closer to contact line.

---

## Design Decisions

### Armour depth rule

A tank at attacker row `r` can only target enemy rows where `row_index >= 4 - r`:

| Attacker pos | Formula | Can reach |
|---|---|---|
| R5 (r=4) | min_row=0 | All 5 rows |
| R4 (r=3) | min_row=1 | R2–R5 |
| R3 (r=2) | min_row=2 | R3–R5 |
| R2 (r=1) | min_row=3 | R4–R5 |
| R1 (r=0) | min_row=4 | R5 only |

Rationale: a tank deep in own formation cannot fire through own front rows into enemy rear.

### Armour column shift direction (when own column has no reachable cells)

- col 0 (C1) or col 1 (C2) → shift **RIGHT** (search col+1, then col+2)
- col 3 (C4) or col 4 (C5) → shift **LEFT** (search col-1, then col-2)
- col 2 (C3, center) → prefer **LEFT** first (col=1), then right (col=3) — deterministic tie-break

Max shift: **2 columns**. First found = `"flank"`. Second shift if first also empty = `"envelopment"`.

**In `dense_forest` or `urban`: no shift at all.** If own column empty in these terrains, return null (no targets).

### AT targeting (anti-tank units)

AT targets cells where `UNIT_COMBAT_STATS[cell.unit_type]?.armour > 0`. The set is:
`light_tank, medium_tank, heavy_tank, armoured_car, at_gun_sp`

1. Check own column for armoured cells (ALL rows — AT has NO depth rule)
2. If found → attack own column, `is_side: false`
3. If not → search all other columns by nearest distance; ties broken by lower column index (prefer left)
4. Found elsewhere → `is_side: true`
5. No armour anywhere → `[]`

AT does NOT check terrain cover — AT guns can reposition to engage armour regardless of terrain.

### Side armour and damage bonuses

| Condition | `effective_armour` | HP damage multiplier |
|---|---|---|
| No shift (own column) | `base_armour * 1.0` | `1.0` |
| Armour flank (1-col shift) | `base_armour * SIDE_ARMOUR_MULT` | `TACTICAL_FLANK_BONUS` |
| Armour envelopment (2-col shift) | `base_armour * SIDE_ARMOUR_MULT` | `TACTICAL_ENVELOPMENT_BONUS` |
| AT side (shifted column) | `base_armour * SIDE_ARMOUR_MULT` | `1.0` (no bonus for AT) |

### `battle_cover` propagation

`ActivePair` currently stores only float terrain multipliers. Branch E adds `battle_cover: string` so `_applyPerCellDamage` can pass the raw cover string to `getTargetCells` and `_resolveArmourColumn`. The cover string is obtained from `_terrainModifiers()` (updated to return it alongside `atk`/`def`). When no province is found, defaults to `"plains"`.

---

## Files to Create

### Task 1: Test file `game-server/test/6e-armour-patterns.test.ts` (write FIRST — all RED)

- [ ] **Step 1: Create the test file**

```typescript
import assert from "assert";
import { describe, it } from "mocha";
import {
  getTargetCells,
  getDamageProfile,
  simulateRound,
  _resolveArmourColumn,
  _columnTargets,
  _resolveATColumn,
} from "../src/systems/attack_patterns.js";
import { GridCellState } from "../src/rooms/schema/GameRoomState.js";

// 25-cell mock grid. All cells start hp=100, suppression=0, incapacitated=false.
function makeGrid(occupied: Record<number, string>): GridCellState[] {
  return Array.from({ length: 25 }, (_, i) => {
    const c         = new GridCellState();
    c.unit_type     = occupied[i] ?? "";
    c.hp            = 100;
    c.suppression   = 0;
    c.incapacitated = false;
    c.stealthed     = false;
    return c;
  });
}

describe("6e — Armour, AT, and AA attack patterns", function () {

  // ── _columnTargets ─────────────────────────────────────────────────────────

  it("_columnTargets: empty column returns []", () => {
    const grid = makeGrid({ 20: "infantry" }); // only C1, not C3
    assert.deepStrictEqual(_columnTargets(2, 0, grid), []);
  });

  it("_columnTargets: returns all living cells in column when min_row=0", () => {
    // C3 (col=2): indices 2,7,12,17,22
    const grid = makeGrid({ 2: "infantry", 7: "infantry", 12: "infantry", 17: "infantry", 22: "infantry" });
    const targets = _columnTargets(2, 0, grid);
    assert.deepStrictEqual([...targets].sort((a, b) => a - b), [2, 7, 12, 17, 22]);
  });

  it("_columnTargets: depth rule — R3 tank (min_row=2) excludes enemy R1 and R2", () => {
    // C2 (col=1): indices 1,6,11,16,21
    const grid = makeGrid({ 1: "infantry", 6: "infantry", 11: "infantry", 16: "infantry", 21: "infantry" });
    const targets = _columnTargets(1, 2, grid); // min_row=2 → exclude rows 0,1 (idx 1,6)
    assert.deepStrictEqual([...targets].sort((a, b) => a - b), [11, 16, 21]);
  });

  it("_columnTargets: depth rule — R1 tank (min_row=4) only hits enemy R5", () => {
    const grid = makeGrid({ 1: "infantry", 6: "infantry", 11: "infantry", 16: "infantry", 21: "infantry" });
    const targets = _columnTargets(1, 4, grid);
    assert.deepStrictEqual(targets, [21]);
  });

  it("_columnTargets: incapacitated cells excluded", () => {
    const grid = makeGrid({ 21: "infantry", 16: "infantry" });
    grid[21].incapacitated = true;
    assert.deepStrictEqual(_columnTargets(1, 0, grid), [16]);
  });

  it("_columnTargets: empty cells (unit_type='') excluded", () => {
    const grid = makeGrid({ 22: "infantry" }); // only R5 C3
    assert.deepStrictEqual(_columnTargets(2, 0, grid), [22]);
  });

  // ── _resolveArmourColumn ───────────────────────────────────────────────────

  it("_resolveArmourColumn: own column has living cells → shift_type=none", () => {
    const grid = makeGrid({ 22: "infantry" }); // C3 R5
    assert.deepStrictEqual(_resolveArmourColumn(2, grid, 4, ""), { col: 2, shift_type: "none" });
  });

  it("_resolveArmourColumn: own column empty, C1 (col=0) → shifts right to C2 (col=1)", () => {
    const grid = makeGrid({ 21: "infantry" }); // C2 R5
    assert.deepStrictEqual(_resolveArmourColumn(0, grid, 4, ""), { col: 1, shift_type: "flank" });
  });

  it("_resolveArmourColumn: own column empty, C2 (col=1) → shifts right to C3 (col=2)", () => {
    const grid = makeGrid({ 22: "infantry" }); // C3 R5
    assert.deepStrictEqual(_resolveArmourColumn(1, grid, 4, ""), { col: 2, shift_type: "flank" });
  });

  it("_resolveArmourColumn: own column empty, C5 (col=4) → shifts left to C4 (col=3)", () => {
    const grid = makeGrid({ 18: "infantry" }); // C4 R4
    assert.deepStrictEqual(_resolveArmourColumn(4, grid, 4, ""), { col: 3, shift_type: "flank" });
  });

  it("_resolveArmourColumn: own column empty, C4 (col=3) → shifts left to C3 (col=2)", () => {
    const grid = makeGrid({ 22: "infantry" }); // C3 R5
    assert.deepStrictEqual(_resolveArmourColumn(3, grid, 4, ""), { col: 2, shift_type: "flank" });
  });

  it("_resolveArmourColumn: C1 empty, first shift C2 also empty → envelopment at C3", () => {
    const grid = makeGrid({ 22: "infantry" }); // C3 R5 only
    assert.deepStrictEqual(_resolveArmourColumn(0, grid, 4, ""), { col: 2, shift_type: "envelopment" });
  });

  it("_resolveArmourColumn: C5 empty, first shift C4 also empty → envelopment at C3", () => {
    const grid = makeGrid({ 22: "infantry" }); // C3 R5 only
    assert.deepStrictEqual(_resolveArmourColumn(4, grid, 4, ""), { col: 2, shift_type: "envelopment" });
  });

  it("_resolveArmourColumn: center C3 equidistant → prefers left (col=1)", () => {
    const grid = makeGrid({ 21: "infantry", 18: "infantry" }); // C2 R5 and C4 R4
    assert.deepStrictEqual(_resolveArmourColumn(2, grid, 4, ""), { col: 1, shift_type: "flank" });
  });

  it("_resolveArmourColumn: dense_forest, own column empty → null (shift disabled)", () => {
    const grid = makeGrid({ 21: "infantry" }); // C2 has enemy; attacker at C1
    assert.strictEqual(_resolveArmourColumn(0, grid, 4, "dense_forest"), null);
  });

  it("_resolveArmourColumn: urban, own column empty → null (shift disabled)", () => {
    const grid = makeGrid({ 21: "infantry" });
    assert.strictEqual(_resolveArmourColumn(0, grid, 4, "urban"), null);
  });

  it("_resolveArmourColumn: dense_forest, own column HAS cells → shift_type=none", () => {
    const grid = makeGrid({ 20: "infantry" }); // C1 R5
    assert.deepStrictEqual(_resolveArmourColumn(0, grid, 4, "dense_forest"), { col: 0, shift_type: "none" });
  });

  it("_resolveArmourColumn: all enemy cells empty → null", () => {
    assert.strictEqual(_resolveArmourColumn(2, makeGrid({}), 4, ""), null);
  });

  it("_resolveArmourColumn: C1 with only C4/C5 occupied → null (exceeds 2-col max)", () => {
    // Max shift 2 cols from col=0: can reach col=1 and col=2 only
    const grid = makeGrid({ 18: "infantry", 19: "infantry" }); // C4 and C5 only
    assert.strictEqual(_resolveArmourColumn(0, grid, 4, ""), null);
  });

  it("_resolveArmourColumn: depth rule in shift — R3 tank, shift col only has below-min_row cells → null", () => {
    // Tank at R3 (row=2) → min_row=2. Own C1 empty. Shift to C2 (col=1).
    // C2 only has enemy at R1 (idx=6, row=1 < min_row=2) → unreachable. C3 also empty → null.
    const grid = makeGrid({ 6: "infantry" }); // C2 R1 only
    assert.strictEqual(_resolveArmourColumn(0, grid, 2, ""), null);
  });

  // ── _resolveATColumn ───────────────────────────────────────────────────────

  it("_resolveATColumn: armoured cell in own column → { col: own, is_side: false }", () => {
    const grid = makeGrid({ 22: "light_tank" }); // C3 R5
    assert.deepStrictEqual(_resolveATColumn(2, grid), { col: 2, is_side: false });
  });

  it("_resolveATColumn: non-armour in own column → ignores, finds armour elsewhere", () => {
    const grid = makeGrid({ 22: "infantry", 21: "heavy_tank" }); // C3 infantry, C2 heavy_tank
    assert.deepStrictEqual(_resolveATColumn(2, grid), { col: 1, is_side: true });
  });

  it("_resolveATColumn: no armour anywhere → null", () => {
    assert.strictEqual(_resolveATColumn(2, makeGrid({ 20: "infantry", 22: "mg" })), null);
  });

  it("_resolveATColumn: armour in own col + others → picks own (is_side=false)", () => {
    const grid = makeGrid({ 22: "medium_tank", 21: "heavy_tank" });
    assert.deepStrictEqual(_resolveATColumn(2, grid), { col: 2, is_side: false });
  });

  it("_resolveATColumn: equidistant armour at C2 and C4, AT at C3 → prefer left (col=1)", () => {
    const grid = makeGrid({ 21: "light_tank", 18: "medium_tank" }); // C2 R5, C4 R4
    assert.deepStrictEqual(_resolveATColumn(2, grid), { col: 1, is_side: true });
  });

  it("_resolveATColumn: at_gun_sp counts as armoured target (armour=25)", () => {
    const grid = makeGrid({ 22: "at_gun_sp" });
    assert.deepStrictEqual(_resolveATColumn(2, grid), { col: 2, is_side: false });
  });

  it("_resolveATColumn: armoured_car counts as armoured target (armour=15)", () => {
    const grid = makeGrid({ 21: "armoured_car" }); // C2 — AT at C3
    assert.deepStrictEqual(_resolveATColumn(2, grid), { col: 1, is_side: true });
  });

  it("_resolveATColumn: AT has no depth rule — targets armour in any row", () => {
    // Armour at R1 col 1 (idx=6). AT at col=2. Own col empty.
    const grid = makeGrid({ 6: "medium_tank" }); // C2 R1 (row=0)
    assert.deepStrictEqual(_resolveATColumn(2, grid), { col: 1, is_side: true });
  });

  // ── getTargetCells — armour ────────────────────────────────────────────────

  it("getTargetCells: light_tank at R5 C3 targets all living cells in C3", () => {
    const grid = makeGrid({ 2: "infantry", 12: "mg", 22: "infantry" }); // C3 rows 0,2,4
    const targets = getTargetCells("light_tank", 4, 2, grid, 1, Infinity, "");
    assert.deepStrictEqual([...targets].sort((a, b) => a - b), [2, 12, 22]);
  });

  it("getTargetCells: heavy_tank at R3 C2 only reaches enemy R3–R5 (depth rule)", () => {
    // C2 (col=1): all 5 rows. R3 (row=2) → min_row=2 → exclude rows 0,1 (idx 1,6)
    const grid = makeGrid({ 1: "infantry", 6: "infantry", 11: "infantry", 16: "infantry", 21: "infantry" });
    const targets = getTargetCells("heavy_tank", 2, 1, grid, 1, Infinity, "");
    assert.deepStrictEqual([...targets].sort((a, b) => a - b), [11, 16, 21]);
  });

  it("getTargetCells: armoured_car at C1 with C1 empty → shifts right to C2", () => {
    const grid = makeGrid({ 21: "infantry" }); // C2 R5
    const targets = getTargetCells("armoured_car", 4, 0, grid, 1, Infinity, "");
    assert.deepStrictEqual(targets, [21]);
  });

  it("getTargetCells: medium_tank in dense_forest with empty own column → []", () => {
    const grid = makeGrid({ 21: "infantry" }); // C2 has enemy; tank at C1
    assert.deepStrictEqual(getTargetCells("medium_tank", 4, 0, grid, 1, Infinity, "dense_forest"), []);
  });

  it("getTargetCells: armour respects n parameter (limits cells returned)", () => {
    const grid = makeGrid({ 12: "infantry", 17: "mg", 22: "infantry" }); // C3: 3 cells
    const targets = getTargetCells("light_tank", 4, 2, grid, 1, 2, "");
    assert.strictEqual(targets.length, 2);
  });

  // ── getTargetCells — AT ────────────────────────────────────────────────────

  it("getTargetCells: at_gun targets armoured cell in column, ignores infantry", () => {
    const grid = makeGrid({ 22: "infantry", 12: "medium_tank" }); // C3: inf at R5, tank at R3
    const targets = getTargetCells("at_gun", 4, 2, grid, 1, Infinity, "");
    assert.deepStrictEqual(targets, [12]); // tank only
  });

  it("getTargetCells: at_infantry same column targeting as at_gun", () => {
    const grid = makeGrid({ 22: "infantry", 12: "medium_tank" });
    assert.deepStrictEqual(getTargetCells("at_infantry", 4, 2, grid, 1, Infinity, ""), [12]);
  });

  it("getTargetCells: at_gun_sp same column targeting as at_gun", () => {
    const grid = makeGrid({ 22: "infantry", 12: "heavy_tank" });
    assert.deepStrictEqual(getTargetCells("at_gun_sp", 4, 2, grid, 1, Infinity, ""), [12]);
  });

  it("getTargetCells: at_gun with no armour in own column → shifts, targets armour elsewhere", () => {
    const grid = makeGrid({ 22: "infantry", 21: "heavy_tank" }); // C3 infantry, C2 tank
    const targets = getTargetCells("at_gun", 4, 2, grid, 1, Infinity, "");
    assert.deepStrictEqual(targets, [21]); // shifted to C2
  });

  it("getTargetCells: at_gun with no armour anywhere → []", () => {
    assert.deepStrictEqual(
      getTargetCells("at_gun", 4, 2, makeGrid({ 20: "infantry", 22: "mg" }), 1, Infinity, ""),
      [],
    );
  });

  it("getTargetCells: AT has no depth rule — targets armour in any row", () => {
    // AT at R1 C3 (row=0). Armour at C2 R1 (idx=6). No depth restriction for AT.
    const grid = makeGrid({ 6: "medium_tank" }); // C2 R1
    const targets = getTargetCells("at_gun", 0, 2, grid, 1, Infinity, "");
    assert.deepStrictEqual(targets, [6]);
  });

  // ── getTargetCells — AA ────────────────────────────────────────────────────

  it("getTargetCells: aa_gun always returns [] (no ground attack role)", () => {
    const grid = makeGrid({ 20: "infantry", 22: "heavy_tank" });
    assert.deepStrictEqual(getTargetCells("aa_gun", 4, 0, grid, 1, Infinity, ""), []);
    assert.deepStrictEqual(getTargetCells("aa_gun", 4, 0, grid, 1), []); // no cover param = default
  });

  // ── simulateRound — column targeting ─────────────────────────────────────

  it("simulateRound: light_tank targets own column (not frontmost row)", () => {
    // Tank at R5 C3 (idx=22). Enemy: infantry at R5 C1 (idx=20), infantry at R3 C3 (idx=12)
    const attackers = makeGrid({ 22: "light_tank" });
    const enemy     = makeGrid({ 20: "infantry", 12: "infantry" });
    const result    = simulateRound(attackers, enemy, 1, [], Infinity, "");
    const tankTargets = result.get(22)!;
    assert.ok(tankTargets.includes(12),  "tank targets own column C3");
    assert.ok(!tankTargets.includes(20), "tank ignores C1 infantry (wrong column)");
  });

  it("simulateRound: AT gun targets armour in column, ignores infantry", () => {
    // AT at R5 C2 (idx=21). Enemy: infantry at R5 C2, medium_tank at R3 C2 (idx=11)
    const attackers = makeGrid({ 21: "at_gun" });
    const enemy     = makeGrid({ 21: "infantry", 11: "medium_tank" });
    const result    = simulateRound(attackers, enemy, 1, [], Infinity, "");
    const atTargets = result.get(21)!;
    assert.ok(atTargets.includes(11),  "AT targets armoured cell");
    assert.ok(!atTargets.includes(21), "AT ignores infantry");
  });

  // ── getDamageProfile — AT and armour profiles ─────────────────────────────

  it("getDamageProfile: at_gun returns PROFILE_AT (high HP, low suppression)", () => {
    const p = getDamageProfile("at_gun", 1);
    assert.strictEqual(p.hp_fraction,   0.75);
    assert.strictEqual(p.supp_fraction, 0.25);
    assert.strictEqual(p.bypasses_armour, false);
  });

  it("getDamageProfile: at_infantry returns same PROFILE_AT as at_gun", () => {
    assert.deepStrictEqual(getDamageProfile("at_infantry", 1), getDamageProfile("at_gun", 1));
  });

  it("getDamageProfile: at_gun_sp returns same PROFILE_AT as at_gun", () => {
    assert.deepStrictEqual(getDamageProfile("at_gun_sp", 1), getDamageProfile("at_gun", 1));
  });

  it("getDamageProfile: light_tank returns PROFILE_ARMOUR (balanced HP/suppression)", () => {
    const p = getDamageProfile("light_tank", 1);
    assert.strictEqual(p.hp_fraction,   0.50);
    assert.strictEqual(p.supp_fraction, 0.50);
    assert.strictEqual(p.bypasses_armour, false);
  });

  it("getDamageProfile: medium_tank returns same PROFILE_ARMOUR as light_tank", () => {
    assert.deepStrictEqual(getDamageProfile("medium_tank", 1), getDamageProfile("light_tank", 1));
  });

  it("getDamageProfile: heavy_tank returns same PROFILE_ARMOUR as light_tank", () => {
    assert.deepStrictEqual(getDamageProfile("heavy_tank", 1), getDamageProfile("light_tank", 1));
  });

  it("getDamageProfile: armoured_car returns same PROFILE_ARMOUR as light_tank", () => {
    assert.deepStrictEqual(getDamageProfile("armoured_car", 1), getDamageProfile("light_tank", 1));
  });

  it("getDamageProfile: aa_gun still falls to PROFILE_INFANTRY default (AA never fires ground)", () => {
    const p = getDamageProfile("aa_gun", 1);
    assert.strictEqual(p.hp_fraction,   0.30); // PROFILE_INFANTRY unchanged
    assert.strictEqual(p.supp_fraction, 0.70);
  });
});
```

- [ ] **Step 2: Run test to verify all RED**

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server
NODE_ENV=test npx mocha -r tsx test/6e-armour-patterns.test.ts --exit --timeout 15000
```

Expected: all tests fail (`_resolveArmourColumn is not a function`, etc.).

---

## Files to Modify

### Task 2: `game-server/src/data/combat_constants.ts` — 3 new constants

Current content:
```typescript
export const BASE_ATTRITION       = 2.5;
export const HP_DAMAGE_FRACTION   = 0.3;
export const SUPPRESSION_FRACTION = 0.7;
```

- [ ] **Step 3: Append 3 new exports (do NOT overwrite existing lines)**

```typescript
export const SIDE_ARMOUR_MULT           = 0.5;   // armour effectiveness when hit from column shift
export const TACTICAL_FLANK_BONUS       = 1.25;  // HP damage bonus for armour 1-col shift
export const TACTICAL_ENVELOPMENT_BONUS = 1.5;   // HP damage bonus for armour 2-col shift
```

---

### Task 3: `game-server/src/systems/attack_patterns.ts` — column targeting logic

#### Step 4: Update import from `combat_constants.js`

No change needed — `BASE_ATTRITION` is the only constant used in `attack_patterns.ts`. `SIDE_ARMOUR_MULT`, `TACTICAL_FLANK_BONUS`, and `TACTICAL_ENVELOPMENT_BONUS` are used exclusively in `combat_system.ts` (Step 13).

#### Step 5: Add unit-type sets after imports, before first `const PROFILE_*`

```typescript
const ARMOUR_TYPES = new Set(["light_tank", "medium_tank", "heavy_tank", "armoured_car"]);
const AT_TYPES     = new Set(["at_infantry", "at_gun", "at_gun_sp"]);

// Cells with armour > 0 per UNIT_COMBAT_STATS — valid armoured targets for AT.
// at_gun_sp: armour=25. at_gun/at_infantry: armour=0 (NOT armoured targets).
const ARMOURED_TARGET_TYPES = new Set([
  "light_tank", "medium_tank", "heavy_tank", "armoured_car", "at_gun_sp",
]);
```

#### Step 5b: Add PROFILE_AT and PROFILE_ARMOUR constants alongside existing profiles

Find the last existing `const PROFILE_*` line (e.g., `const PROFILE_FLAMETHROWER = ...`). Add immediately after it:

```typescript
// AT: primary effect is penetration/HP damage; minimal crew suppression
const PROFILE_AT: DamageProfile = {
  hp_fraction:       0.75,
  supp_fraction:     0.25,
  bypasses_armour:   false,
  cavalry_supp_mult: 1.0,
};

// Armour: cannon + machine gun combo — balanced HP and suppression
const PROFILE_ARMOUR: DamageProfile = {
  hp_fraction:       0.50,
  supp_fraction:     0.50,
  bypasses_armour:   false,
  cavalry_supp_mult: 1.5,  // tank MG effective against cavalry
};
```

#### Step 5c: Add cases to `getDamageProfile` switch

Find the `getDamageProfile` function. Its current switch:
```typescript
  switch (unit_type) {
    case "mg":           return PROFILE_MG;
    case "cavalry":      return round_number === 1 ? PROFILE_CAVALRY_CHARGE : PROFILE_INFANTRY;
    case "flamethrower": return PROFILE_FLAMETHROWER;
    default:             return PROFILE_INFANTRY;
  }
```

Replace with:
```typescript
  switch (unit_type) {
    case "mg":           return PROFILE_MG;
    case "cavalry":      return round_number === 1 ? PROFILE_CAVALRY_CHARGE : PROFILE_INFANTRY;
    case "flamethrower": return PROFILE_FLAMETHROWER;
    case "at_infantry":
    case "at_gun":
    case "at_gun_sp":    return PROFILE_AT;
    case "light_tank":
    case "medium_tank":
    case "heavy_tank":
    case "armoured_car": return PROFILE_ARMOUR;
    default:             return PROFILE_INFANTRY;
  }
```

#### Step 6: Add 3 exported helper functions after `_flamethrowerTargets`, before `getTargetCells`

```typescript
/**
 * Returns living enemy cell indices in `col` where row_index >= min_row.
 * Ordered R5 first (row=4 descending to min_row). Used by armour (depth rule)
 * and AT (min_row=0, all rows).
 */
export function _columnTargets(col: number, min_row: number, cells: GridCellState[]): number[] {
  const result: number[] = [];
  for (let row = 4; row >= min_row; row--) {
    const idx  = row * 5 + col;
    const cell = cells[idx];
    if (cell && cell.unit_type !== "" && !cell.incapacitated) result.push(idx);
  }
  return result;
}

/**
 * Determines the effective column and shift type for an armour unit's column attack.
 *
 * Returns { col, shift_type } or null (no targets reachable).
 *   shift_type "none"        — own column has reachable cells
 *   shift_type "flank"       — shifted 1 col (TACTICAL_FLANK_BONUS + side armour)
 *   shift_type "envelopment" — shifted 2 cols (TACTICAL_ENVELOPMENT_BONUS + side armour)
 *
 * Shift direction:
 *   col 0,1 → RIGHT (col+1, col+2)
 *   col 3,4 → LEFT  (col-1, col-2)
 *   col 2   → LEFT first (col=1), then RIGHT (col=3) — deterministic tie-break
 *
 * "Reachable" applies depth rule: only rows where row_index >= 4 - attacker_row.
 * In dense_forest or urban: no shift even if own column is empty → return null.
 * Max shift: 2 columns.
 */
export function _resolveArmourColumn(
  attacker_col: number,
  cells:         GridCellState[],
  attacker_row:  number,
  cover:         string,
): { col: number; shift_type: "none" | "flank" | "envelopment" } | null {
  const min_row = 4 - attacker_row;

  if (_columnTargets(attacker_col, min_row, cells).length > 0) {
    return { col: attacker_col, shift_type: "none" };
  }

  if (cover === "dense_forest" || cover === "urban") {
    return null;
  }

  let searchOrder: number[];
  if (attacker_col === 0 || attacker_col === 1) {
    searchOrder = [attacker_col + 1, attacker_col + 2].filter(c => c <= 4);
  } else if (attacker_col === 3 || attacker_col === 4) {
    searchOrder = [attacker_col - 1, attacker_col - 2].filter(c => c >= 0);
  } else {
    // center (col=2): prefer left (col=1) first
    searchOrder = [attacker_col - 1, attacker_col + 1].filter(c => c >= 0 && c <= 4);
  }

  const [first, second] = searchOrder;
  if (first !== undefined && _columnTargets(first, min_row, cells).length > 0) {
    return { col: first, shift_type: "flank" };
  }
  if (second !== undefined && _columnTargets(second, min_row, cells).length > 0) {
    return { col: second, shift_type: "envelopment" };
  }
  return null;
}

/**
 * Determines the effective column for an AT unit's column attack.
 *
 * Only considers ARMOURED_TARGET_TYPES cells (armour > 0).
 * AT has NO depth rule (min_row=0) and NO terrain restriction.
 *
 * Returns { col, is_side: false } if armour in own column.
 * Returns { col, is_side: true }  if armour found in another column.
 * Returns null if no armoured targets anywhere.
 *
 * Tie-break for equidistant columns: prefer lower column index (left).
 */
export function _resolveATColumn(
  attacker_col: number,
  cells:         GridCellState[],
): { col: number; is_side: boolean } | null {
  const hasArmourInCol = (col: number): boolean => {
    for (let row = 4; row >= 0; row--) {
      const cell = cells[row * 5 + col];
      if (cell && ARMOURED_TARGET_TYPES.has(cell.unit_type) && !cell.incapacitated) return true;
    }
    return false;
  };

  if (hasArmourInCol(attacker_col)) {
    return { col: attacker_col, is_side: false };
  }

  const others = Array.from({ length: 5 }, (_, c) => c)
    .filter(c => c !== attacker_col)
    .sort((a, b) => {
      const da = Math.abs(a - attacker_col);
      const db = Math.abs(b - attacker_col);
      return da !== db ? da - db : a - b; // nearest first; ties: lower col index
    });

  for (const col of others) {
    if (hasArmourInCol(col)) return { col, is_side: true };
  }
  return null;
}
```

#### Step 7: Update `getTargetCells` — add `cover` param and new cases

Change function signature (add `cover: string = ""`):

```typescript
export function getTargetCells(
  unit_type:    string,
  attacker_row: number,
  attacker_col: number,
  enemy_cells:  GridCellState[],
  round_number: number,
  n:            number = Infinity,
  cover:        string = "",
): number[] {
```

Inside `switch (unit_type)`, after the `case "flamethrower":` block and before `default:`, add:

```typescript
    case "light_tank":
    case "medium_tank":
    case "heavy_tank":
    case "armoured_car": {
      const shift = _resolveArmourColumn(attacker_col, enemy_cells, attacker_row, cover);
      if (!shift) return [];
      const min_row = 4 - attacker_row;
      const raw     = _columnTargets(shift.col, min_row, enemy_cells);
      return isFinite(n) ? raw.slice(0, n) : raw;
    }
    case "at_infantry":
    case "at_gun":
    case "at_gun_sp": {
      const atShift = _resolveATColumn(attacker_col, enemy_cells);
      if (!atShift) return [];
      // min_row=0: AT has no depth rule
      const raw = _columnTargets(atShift.col, 0, enemy_cells)
        .filter(idx => {
          const cell = enemy_cells[idx];
          return cell && ARMOURED_TARGET_TYPES.has(cell.unit_type);
        });
      return isFinite(n) ? raw.slice(0, n) : raw;
    }
    case "aa_gun":
      return [];
```

#### Step 8: Update `simulateRound` to accept and pass `cover`

Add `cover: string = ""` as 6th parameter to `simulateRound`:

```typescript
export function simulateRound(
  attacker_cells: GridCellState[],
  enemy_cells:    GridCellState[],
  round_number:   number,
  priority_types: string[] = [],
  n:              number   = Infinity,
  cover:          string   = "",
): Map<number, number[]> {
```

Inside the function body, find the `getTargetCells` call and add `cover`:
```typescript
    const targets = getTargetCells(attCell.unit_type, attRow, attCol, virtual, round_number, n, cover);
```

- [ ] **Step 9: Run 6e tests — expect GREEN**

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server
NODE_ENV=test npx mocha -r tsx test/6e-armour-patterns.test.ts --exit --timeout 15000
```

---

### Task 4: `game-server/src/systems/combat_system.ts` — `battle_cover` + side armour

#### Step 10: Add `battle_cover` to `ActivePair` interface

Find the `ActivePair` interface (around line 172). Add after `terrain_mult_def`:

```typescript
  terrain_mult_atk: number;
  terrain_mult_def: number;
  battle_cover: string;   // ADD: raw cover string for armour column shift rules
  round: number;
```

#### Step 11: Update `_terrainModifiers` return type

Find `_terrainModifiers` (around line 1021). Change return type and body:

```typescript
private _terrainModifiers(midLng: number, midLat: number): { atk: number; def: number; cover: string } {
  const prov = this._nearestProvince(midLng, midLat);
  if (!prov) return { atk: 1.0, def: 1.0, cover: "plains" };

  const [elevPenalty, elevBonus]   = ELEV_MOD[prov.elevation] ?? [0, 0];
  const [coverPenalty, coverBonus] = COVER_MOD[prov.cover]    ?? [0, 0];

  const atk = Math.max(0.3, 1.0 - elevPenalty - coverPenalty);
  const def  = 1.0 + elevBonus + coverBonus;

  return { atk, def, cover: prov.cover };
}
```

#### Step 12: Populate `battle_cover` in `_detectEngagements`

Find (around line 327):
```typescript
let { atk, def } = this._terrainModifiers(midLng, midLat);
```
Replace with:
```typescript
let { atk, def, cover: battle_cover } = this._terrainModifiers(midLng, midLat);
```

In the `const pair: ActivePair = { ... }` object literal, add `battle_cover` after `terrain_mult_def`:
```typescript
      terrain_mult_atk: atk,
      terrain_mult_def: def,
      battle_cover,        // ADD
      round: 0,
```

#### Step 13: Update imports in `combat_system.ts`

Expand the `attack_patterns.js` import:
```typescript
import {
  getTargetCells,
  getDamageProfile,
  getFireOrder,
  _resolveArmourColumn,   // ADD
  _resolveATColumn,        // ADD
} from "./attack_patterns.js";
```

Expand the `combat_constants.js` import:
```typescript
import {
  BASE_ATTRITION,
  HP_DAMAGE_FRACTION,
  SUPPRESSION_FRACTION,
  SIDE_ARMOUR_MULT,             // ADD
  TACTICAL_FLANK_BONUS,         // ADD
  TACTICAL_ENVELOPMENT_BONUS,   // ADD
} from "../data/combat_constants.js";
```

#### Step 14: Update `_applyPerCellDamage` for cover + side armour

In `_applyPerCellDamage` (around line 566), after `const roundNumber = pair.round;`, add:
```typescript
    const cover = pair.battle_cover ?? "";
```

In the attacker loop, update the `getTargetCells` call:
```typescript
    const targets = getTargetCells(attCell.unit_type, attRow, attCol, defender.grid.cells, roundNumber, Infinity, cover);
```

After `const attackerPen = ...;` and before `if (targets.length === 0) continue;`, add:

```typescript
    // Column-shift modifiers: attacker-level (apply to all targets uniformly)
    let sideArmourActive = false;
    let tacticalHpBonus  = 1.0;
    const utype = attCell.unit_type;
    if (utype === "light_tank" || utype === "medium_tank" || utype === "heavy_tank" || utype === "armoured_car") {
      const shift = _resolveArmourColumn(attCol, defender.grid.cells, attRow, cover);
      if (shift?.shift_type === "flank")       { sideArmourActive = true; tacticalHpBonus = TACTICAL_FLANK_BONUS; }
      else if (shift?.shift_type === "envelopment") { sideArmourActive = true; tacticalHpBonus = TACTICAL_ENVELOPMENT_BONUS; }
    } else if (utype === "at_infantry" || utype === "at_gun" || utype === "at_gun_sp") {
      if (_resolveATColumn(attCol, defender.grid.cells)?.is_side) sideArmourActive = true;
    }
```

In the inner target loop, replace:
```typescript
        const armour  = UNIT_COMBAT_STATS[tCell.unit_type]?.armour ?? 0;
        const penMult = profile.bypasses_armour ? 1.0 : _armorPenMultiplier(attackerPen, armour);
```
With:
```typescript
        const baseArmour      = UNIT_COMBAT_STATS[tCell.unit_type]?.armour ?? 0;
        const effectiveArmour = sideArmourActive ? baseArmour * SIDE_ARMOUR_MULT : baseArmour;
        const penMult         = profile.bypasses_armour ? 1.0 : _armorPenMultiplier(attackerPen, effectiveArmour);
```

And replace:
```typescript
        tCell.hp = Math.max(0, tCell.hp - perTargetHp * penMult);
```
With:
```typescript
        tCell.hp = Math.max(0, tCell.hp - perTargetHp * penMult * tacticalHpBonus);
```

- [ ] **Step 15: TypeScript compilation — zero errors**

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server && npx tsc --noEmit
```

---

### Task 5: `client/src/ui/hud/attack_pattern_registry.gd` — add armour/AT/AA

#### Step 16: Add constants after `const BASE_ATTRITION`

```gdscript
const ARMOURED_TARGET_TYPES := {
    "light_tank": true, "medium_tank": true, "heavy_tank": true,
    "armoured_car": true, "at_gun_sp": true,
}
```

#### Step 17: Add cases to `get_targets` match block (before `_:` default)

```gdscript
        "light_tank", "medium_tank", "heavy_tank", "armoured_car":
            return _armour_column_targets(att_row, att_col, enemy_cells, n)
        "at_infantry", "at_gun", "at_gun_sp":
            return _at_column_targets(att_col, enemy_cells, n)
        "aa_gun":
            return []
```

Add the same 3 cases to the `match utype:` block inside `simulate_round`.

#### Step 18: Add helper functions

```gdscript
# Returns living cells in `col` where row >= min_row. R5 first (row 4 → min_row).
static func _column_targets(col: int, min_row: int, cells: Array) -> Array[int]:
    var result: Array[int] = []
    for row in range(4, min_row - 1, -1):
        var idx := row * 5 + col
        var cell = cells[idx]
        if cell.get("unit_type", "") != "" and not cell.get("incapacitated", false):
            result.append(idx)
    return result

static func _has_armour_in_col(col: int, cells: Array) -> bool:
    for row in range(4, -1, -1):
        var cell = cells[row * 5 + col]
        if ARMOURED_TARGET_TYPES.has(cell.get("unit_type", "")) and not cell.get("incapacitated", false):
            return true
    return false

# Armour column attack. Client does not check cover — preview approximation is acceptable.
# TODO: pass cover_string from engagement state once exposed to client (Branch K)
static func _armour_column_targets(att_row: int, att_col: int, cells: Array, n: int) -> Array[int]:
    var min_row: int = 4 - att_row
    var own := _column_targets(att_col, min_row, cells)
    if own.size() > 0:
        return own.slice(0, n) if n > 0 else own
    var search: Array[int] = []
    if att_col == 0 or att_col == 1:
        search = [att_col + 1, att_col + 2]
    elif att_col == 3 or att_col == 4:
        search = [att_col - 1, att_col - 2]
    else:
        search = [att_col - 1, att_col + 1]
    search = search.filter(func(c): return c >= 0 and c <= 4)
    for shifted_col in search:
        var col_targets := _column_targets(shifted_col, min_row, cells)
        if col_targets.size() > 0:
            return col_targets.slice(0, n) if n > 0 else col_targets
    return []

# AT column attack: armoured targets only, no depth rule.
static func _at_column_targets(att_col: int, cells: Array, n: int) -> Array[int]:
    var target_col := -1
    if _has_armour_in_col(att_col, cells):
        target_col = att_col
    else:
        var best_dist := 999
        for c in range(5):
            if c == att_col: continue
            var dist := abs(c - att_col)
            if _has_armour_in_col(c, cells):
                if dist < best_dist or (dist == best_dist and (target_col < 0 or c < target_col)):
                    best_dist = dist
                    target_col = c
    if target_col < 0:
        return []
    var all_in_col := _column_targets(target_col, 0, cells)
    var armoured: Array[int] = []
    for idx in all_in_col:
        if ARMOURED_TARGET_TYPES.has(cells[idx].get("unit_type", "")):
            armoured.append(idx)
    return armoured.slice(0, n) if n > 0 else armoured
```

---

## Verification

- [ ] **Step 19: All 6e tests GREEN**

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server
NODE_ENV=test npx mocha -r tsx test/6e-armour-patterns.test.ts --exit --timeout 15000
```

- [ ] **Step 20: Regression — prior test suites still GREEN**

```bash
NODE_ENV=test npx mocha -r tsx \
  test/6d-infantry-patterns.test.ts \
  test/6c-combat-stats.test.ts \
  test/6a-grid-schema.test.ts \
  --exit --timeout 30000
```

- [ ] **Step 21: TypeScript clean**

```bash
npx tsc --noEmit
```

---

## Common Errors to Avoid

1. **Depth rule direction.** `min_row = 4 - attacker_row`. R5(r=4)→min=0. R3(r=2)→min=2. R1(r=0)→min=4. Higher row index = closer to enemy front.

2. **`_columnTargets` iterates DESCENDING: `for row = 4; row >= min_row; row--`.** Never start at row=5. Never ascending.

3. **AT filter required.** After `_columnTargets(col, 0, cells)`, filter by `ARMOURED_TARGET_TYPES.has(cell.unit_type)`. Without this, AT hits infantry too.

4. **`ARMOURED_TARGET_TYPES` includes `at_gun_sp` (armour=25) but NOT `at_gun` or `at_infantry` (armour=0).** Never add `at_gun` or `at_infantry` to this set.

5. **`_resolveArmourColumn` is called twice in `_applyPerCellDamage`** (once inside `getTargetCells`, once for `shift_type` metadata). This is acceptable — 25-cell scan is cheap. Don't try to cache across the two calls.

6. **`battle_cover` default when no province loaded.** `_terrainModifiers` returns `cover: "plains"`. Use `pair.battle_cover ?? ""` in `_applyPerCellDamage` as backup.

7. **C3 center shift: prefer LEFT first.** `searchOrder = [attacker_col - 1, attacker_col + 1]`. Tests verify this.

8. **All TypeScript relative imports end in `.js`:**
   - `import { ..., _resolveArmourColumn, _resolveATColumn } from "./attack_patterns.js";`
   - `import { ..., SIDE_ARMOUR_MULT, TACTICAL_FLANK_BONUS, TACTICAL_ENVELOPMENT_BONUS } from "../data/combat_constants.js";`
   - Test file: `import { ... } from "../src/systems/attack_patterns.js";` and `"../src/rooms/schema/GameRoomState.js"`

9. **GDScript `n=0` = all.** Always guard: `arr.slice(0, n) if n > 0 else arr`. `arr.slice(0, 0)` = `[]`.

10. **`simulateRound` cover param default = `""`.** Empty string = no terrain restriction = shift allowed. Pass `""` in non-terrain tests.

11. **`PROFILE_AT` and `PROFILE_ARMOUR` must be defined BEFORE they are used.** Place them immediately after `PROFILE_FLAMETHROWER` — do not add them after `getDamageProfile`. TypeScript hoists `function` declarations but NOT `const` declarations.

12. **Do NOT add `aa_gun` to `getDamageProfile`.** AA returns `[]` from `getTargetCells` so its profile is never consulted during real combat. Leave it falling to `default: return PROFILE_INFANTRY`. Adding a case wastes a line and implies AA has a ground attack role.
