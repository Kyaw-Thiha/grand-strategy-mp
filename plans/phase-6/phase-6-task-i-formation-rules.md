# Plan: Phase 6 — Branch I: Formation Rule System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Save this plan to:** `plans/phase-6-task-i-formation-rules.md`

**Goal:** Build an extensible formation bonus engine that detects positional relationships between units on a division's 5×5 grid and applies per-cell stat modifiers each combat round. Ships with **zero active rules** — the engine exists, is wired into combat, and is proven to be a no-op when the rule list is empty. Concrete formation rules are added later via perk research or balance pass.

**Architecture:**
- New pure module `formation_rule_system.ts` owns all types, proximity detection helpers, and the two exported functions: `getActiveFormationRules()` and `evaluateFormationRules()`.
- `evaluateFormationRules(cells, activeRules)` scans a division's 25 cells against the active rule set and returns a `Map<cellIndex, FormationBonusModifiers>` — a per-cell combined bonus that multiplies with existing row perk modifiers.
- When the active rule list is empty (as it starts), the function returns an empty Map and the combat math is identical to before this branch.
- `getActiveFormationRules(researchedPerks?)` is the extension point: starts returning `[]`, future perk research calls it with a perk list to unlock rules.
- Two wiring points in `combat_system.ts`: `_applyPerCellDamage` (for HP and suppression dealt/received) and `_decayCellSuppression` (for suppression decay rate).
- `ROUND_RESOLVED` already has `formation_bonuses_active: []` placeholder — leave it as `[]` for now (no UI change needed).

**Tech Stack:** TypeScript + Mocha/tsx (server only — no client changes in this branch).

---

## Proximity Spec Reference

```
ProximitySpec variants:

  { type: "adjacent" }
    — 8-directional neighbours: |rowA - rowB| <= 1 AND |colA - colB| <= 1 AND idxA !== idxB
    — Chebyshev distance exactly = 1
    — e.g. cell 12 (row2,col2) is adjacent to cells 6,7,8,11,13,16,17,18

  { type: "same_row" }
    — Math.floor(idxA / 5) === Math.floor(idxB / 5) AND idxA !== idxB

  { type: "same_col" }
    — (idxA % 5) === (idxB % 5) AND idxA !== idxB

  { type: "distance"; max: number }
    — Chebyshev distance <= max AND idxA !== idxB
    — Chebyshev distance = Math.max(|rowA-rowB|, |colA-colB|)
    — "adjacent" is equivalent to distance.max = 1

  { type: "self_in_row"; row: number }
    — No pair partner needed. Bonus applies when Math.floor(cellIdx / 5) === row.
    — unitB field ignored for this proximity type.

Grid cell index layout:
  Row 0 = REAR     (cells  0– 4, logical_row 0)
  Row 1 = RESERVE  (cells  5– 9, logical_row 1)
  Row 2 = SUPPORT  (cells 10–14, logical_row 2)
  Row 3 = ASSAULT  (cells 15–19, logical_row 3)
  Row 4 = VANGUARD (cells 20–24, logical_row 4)
  Col 0–4 left to right.
  cell_index = logical_row * 5 + col
```

---

## Key Existing Files (DO NOT recreate)

| File | Purpose |
|---|---|
| `game-server/src/systems/row_perk_system.ts` | **Primary reference** — copy module structure exactly |
| `game-server/src/systems/combat_system.ts` | Modify: add import + wire 2 call sites |
| `game-server/test/6h-row-perks.test.ts` | **Primary test reference** — copy test structure exactly |
| `game-server/src/rooms/schema/GameRoomState.ts` | `GridCellState` type (unit_type, hp, suppression, incapacitated, stealthed) |
| `game-server/src/types/tactical_types.ts` | `GridCellDelta` interface (cell_index, hp, suppression) |

---

## Files to Create

- `game-server/src/systems/formation_rule_system.ts`
- `game-server/test/6i-formation-rules.test.ts`

## Files to Modify

- `game-server/src/systems/combat_system.ts` (add import + 2 wiring edits)

---

## Full Type Reference

The execution agent must use these exact type definitions — do not invent alternatives.

```typescript
// ── Proximity ───────────────────────────────────────────────────────────────

export type ProximitySpec =
  | { type: "adjacent" }
  | { type: "same_row" }
  | { type: "same_col" }
  | { type: "distance"; max: number }
  | { type: "self_in_row"; row: number };

// ── Bonus modifiers (same shape as RowPerkModifiers) ───────────────────────

export interface FormationBonusModifiers {
  hp_dealt_mult:    number;   // multiplier on outgoing HP damage
  supp_dealt_mult:  number;   // multiplier on outgoing suppression
  supp_resist_mult: number;   // multiplier on incoming suppression (< 1 = receive less)
  supp_decay_mult:  number;   // multiplier on suppression decay rate (> 1 = decay faster)
}

// ── Rule definition ─────────────────────────────────────────────────────────

export interface FormationRule {
  id: string;
  unitA: string | string[];             // unit type(s) for participant A
  unitB: string | string[];             // unit type(s) for participant B (ignored for self_in_row)
  proximity: ProximitySpec;
  bonusForA: Partial<FormationBonusModifiers>;  // bonus applied to cells matching unitA
  bonusForB?: Partial<FormationBonusModifiers>; // bonus applied to cells matching unitB (optional)
}

// ── Input cell shape used by evaluateFormationRules ─────────────────────────

export interface FormationCellInput {
  unit_type:     string;
  incapacitated: boolean;
}
```

---

## Task 1: Create `formation_rule_system.ts` with unit tests (RED → GREEN)

**Files:**
- Create: `game-server/src/systems/formation_rule_system.ts`
- Create: `game-server/test/6i-formation-rules.test.ts` (unit test portion)

- [ ] **Step 1: Write the unit test file first (RED)**

Create `game-server/test/6i-formation-rules.test.ts` with the unit tests only. Do NOT add integration tests yet — those come in Task 2.

```typescript
import { describe, it } from "mocha";
import assert from "assert";
import {
  evaluateFormationRules,
  getActiveFormationRules,
  IDENTITY_FORMATION_BONUS,
} from "../src/systems/formation_rule_system.js";
import type { FormationRule, FormationCellInput } from "../src/systems/formation_rule_system.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGrid(overrides: Record<number, string>): FormationCellInput[] {
  return Array.from({ length: 25 }, (_, i) => ({
    unit_type:     overrides[i] ?? "",
    incapacitated: false,
  }));
}

function makeRule(
  id: string,
  unitA: string | string[],
  unitB: string | string[],
  proximity: FormationRule["proximity"],
  bonusForA: Partial<typeof IDENTITY_FORMATION_BONUS>,
  bonusForB?: Partial<typeof IDENTITY_FORMATION_BONUS>,
): FormationRule {
  return { id, unitA, unitB, proximity, bonusForA, bonusForB };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("formation-rule-system — unit tests", () => {

  // ── getActiveFormationRules ────────────────────────────────────────────────

  it("getActiveFormationRules() returns an empty array when no perks provided", () => {
    const rules = getActiveFormationRules();
    assert.deepStrictEqual(rules, []);
  });

  it("getActiveFormationRules([]) returns an empty array", () => {
    const rules = getActiveFormationRules([]);
    assert.deepStrictEqual(rules, []);
  });

  // ── evaluateFormationRules — empty ────────────────────────────────────────

  it("returns empty Map when activeRules is empty", () => {
    const grid = makeGrid({ 12: "infantry" });
    const result = evaluateFormationRules(grid, []);
    assert.strictEqual(result.size, 0, "should return empty Map with no rules");
  });

  it("returns empty Map when grid has no units", () => {
    const grid = makeGrid({});
    const rule = makeRule("r1", "infantry", "mg", { type: "adjacent" }, { hp_dealt_mult: 1.2 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0, "no units means no matches");
  });

  // ── Adjacent proximity ─────────────────────────────────────────────────────

  it("adjacent: grants bonus to both cells when matching units are neighbours", () => {
    // cell 12 (row2,col2) and cell 13 (row2,col3) are adjacent
    const grid = makeGrid({ 12: "infantry", 13: "mg" });
    const rule = makeRule("r1", "infantry", "mg", { type: "adjacent" },
      { hp_dealt_mult: 1.2 }, { supp_dealt_mult: 1.15 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.ok(result.has(12), "infantry cell (12) should receive bonusForA");
    assert.ok(result.has(13), "mg cell (13) should receive bonusForB");
    assert.strictEqual(result.get(12)!.hp_dealt_mult, 1.2);
    assert.strictEqual(result.get(13)!.supp_dealt_mult, 1.15);
  });

  it("adjacent: no bonus when matching units are NOT neighbours", () => {
    // cell 0 (row0,col0) and cell 24 (row4,col4) are far apart
    const grid = makeGrid({ 0: "infantry", 24: "mg" });
    const rule = makeRule("r1", "infantry", "mg", { type: "adjacent" }, { hp_dealt_mult: 1.2 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0, "non-adjacent cells should not match");
  });

  it("adjacent: cell is not adjacent to itself", () => {
    const grid = makeGrid({ 12: "infantry" });
    const rule = makeRule("r1", "infantry", "infantry", { type: "adjacent" }, { hp_dealt_mult: 1.2 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0, "a cell cannot pair with itself");
  });

  // ── same_row proximity ─────────────────────────────────────────────────────

  it("same_row: grants bonus when matching units share a row", () => {
    // cells 10 (row2,col0) and 14 (row2,col4) — same row, not adjacent
    const grid = makeGrid({ 10: "mg", 14: "mg" });
    const rule = makeRule("r1", "mg", "mg", { type: "same_row" },
      { supp_dealt_mult: 1.1 }, { supp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.ok(result.has(10), "cell 10 should get bonus");
    assert.ok(result.has(14), "cell 14 should get bonus");
  });

  it("same_row: no bonus when matching units are in different rows", () => {
    // cell 10 (row2) and cell 15 (row3)
    const grid = makeGrid({ 10: "mg", 15: "mg" });
    const rule = makeRule("r1", "mg", "mg", { type: "same_row" }, { supp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0);
  });

  // ── same_col proximity ─────────────────────────────────────────────────────

  it("same_col: grants bonus when matching units share a column", () => {
    // cell 2 (row0,col2) and cell 22 (row4,col2) — same col
    const grid = makeGrid({ 2: "artillery", 22: "recon_infantry" });
    const rule = makeRule("r1", "artillery", "recon_infantry", { type: "same_col" },
      { hp_dealt_mult: 1.15 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.ok(result.has(2), "artillery cell should get bonusForA");
  });

  it("same_col: no bonus when same unit types are in different columns", () => {
    // cell 0 (row0,col0) and cell 21 (row4,col1)
    const grid = makeGrid({ 0: "artillery", 21: "recon_infantry" });
    const rule = makeRule("r1", "artillery", "recon_infantry", { type: "same_col" },
      { hp_dealt_mult: 1.15 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0);
  });

  // ── distance proximity ─────────────────────────────────────────────────────

  it("distance: grants bonus when Chebyshev distance <= max", () => {
    // cell 12 (row2,col2) and cell 14 (row2,col4): Chebyshev = max(0,2) = 2
    const grid = makeGrid({ 12: "infantry", 14: "mg" });
    const rule = makeRule("r1", "infantry", "mg", { type: "distance", max: 2 }, { hp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.ok(result.has(12), "within distance 2 should match");
  });

  it("distance: no bonus when Chebyshev distance > max", () => {
    // cell 12 (row2,col2) and cell 14 (row2,col4): Chebyshev = 2, max=1 → no match
    const grid = makeGrid({ 12: "infantry", 14: "mg" });
    const rule = makeRule("r1", "infantry", "mg", { type: "distance", max: 1 }, { hp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0);
  });

  // ── self_in_row proximity ─────────────────────────────────────────────────

  it("self_in_row: grants bonus when unit is in the specified row", () => {
    // cell 20 (row4 = VANGUARD) has a heavy_tank
    const grid = makeGrid({ 20: "heavy_tank" });
    const rule = makeRule("r1", "heavy_tank", "", { type: "self_in_row", row: 4 },
      { hp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.ok(result.has(20), "heavy_tank in VANGUARD should get bonus");
    assert.strictEqual(result.get(20)!.hp_dealt_mult, 1.1);
  });

  it("self_in_row: no bonus when unit is in a different row", () => {
    // cell 0 (row0 = REAR) has a heavy_tank, but rule targets row 4
    const grid = makeGrid({ 0: "heavy_tank" });
    const rule = makeRule("r1", "heavy_tank", "", { type: "self_in_row", row: 4 },
      { hp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0);
  });

  // ── unitA as array ─────────────────────────────────────────────────────────

  it("unitA as string[]: matches any of the listed types", () => {
    const grid = makeGrid({ 12: "assault_infantry", 13: "mg" });
    const rule = makeRule("r1", ["infantry", "assault_infantry"], "mg",
      { type: "adjacent" }, { hp_dealt_mult: 1.2 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.ok(result.has(12), "assault_infantry should match unitA array");
  });

  // ── Incapacitated cells ignored ────────────────────────────────────────────

  it("incapacitated cells are excluded from formation matching", () => {
    const cells: FormationCellInput[] = Array.from({ length: 25 }, (_, i) => ({
      unit_type:     i === 12 ? "infantry" : i === 13 ? "mg" : "",
      incapacitated: i === 12,  // infantry at 12 is incapacitated
    }));
    const rule = makeRule("r1", "infantry", "mg", { type: "adjacent" }, { hp_dealt_mult: 1.2 });
    const result = evaluateFormationRules(cells, [rule]);
    assert.strictEqual(result.size, 0, "incapacitated units should not participate in formation bonuses");
  });

  // ── Multiple rules stack multiplicatively ──────────────────────────────────

  it("multiple matching rules stack modifiers multiplicatively on the same cell", () => {
    // cell 12 infantry + cell 13 mg → rule1 gives infantry hp_dealt_mult 1.2
    // cell 12 infantry + cell 11 mg → rule2 gives infantry hp_dealt_mult 1.1
    // Combined: 1.2 * 1.1 = 1.32 on cell 12
    const grid = makeGrid({ 12: "infantry", 13: "mg", 11: "mg" });
    const rule1 = makeRule("r1", "infantry", "mg", { type: "adjacent" }, { hp_dealt_mult: 1.2 });
    const rule2 = makeRule("r2", "infantry", "mg", { type: "adjacent" }, { hp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule1, rule2]);
    const combined = result.get(12)!.hp_dealt_mult;
    assert.ok(Math.abs(combined - 1.32) < 0.001,
      `expected 1.32 (1.2 * 1.1), got ${combined}`);
  });

  // ── IDENTITY_FORMATION_BONUS ───────────────────────────────────────────────

  it("IDENTITY_FORMATION_BONUS has all fields equal to 1.0", () => {
    assert.strictEqual(IDENTITY_FORMATION_BONUS.hp_dealt_mult,    1.0);
    assert.strictEqual(IDENTITY_FORMATION_BONUS.supp_dealt_mult,  1.0);
    assert.strictEqual(IDENTITY_FORMATION_BONUS.supp_resist_mult, 1.0);
    assert.strictEqual(IDENTITY_FORMATION_BONUS.supp_decay_mult,  1.0);
  });
});
```

- [ ] **Step 2: Run unit tests — expect RED (module not found)**

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server
NODE_ENV=test npx mocha -r tsx test/6i-formation-rules.test.ts --exit --timeout 30000 2>&1 | tail -20
```

Expected: `Cannot find module '../src/systems/formation_rule_system.js'`

- [ ] **Step 3: Create `game-server/src/systems/formation_rule_system.ts`**

Create the file with the following content exactly:

```typescript
/**
 * Formation Rule System.
 *
 * Detects positional relationships between units on a 5×5 division grid
 * and returns per-cell stat modifier maps. Ships with no active rules;
 * concrete rules are added later via perk research.
 *
 * Grid layout:
 *   logical_row = Math.floor(cell_index / 5)
 *   col         = cell_index % 5
 *   Row 0 = REAR (cells 0–4), Row 4 = VANGUARD (cells 20–24)
 */

// ── Public types ─────────────────────────────────────────────────────────────

export type ProximitySpec =
  | { type: "adjacent" }
  | { type: "same_row" }
  | { type: "same_col" }
  | { type: "distance"; max: number }
  | { type: "self_in_row"; row: number };

export interface FormationBonusModifiers {
  hp_dealt_mult:    number;
  supp_dealt_mult:  number;
  supp_resist_mult: number;
  supp_decay_mult:  number;
}

export interface FormationRule {
  id: string;
  unitA: string | string[];
  unitB: string | string[];
  proximity: ProximitySpec;
  bonusForA: Partial<FormationBonusModifiers>;
  bonusForB?: Partial<FormationBonusModifiers>;
}

export interface FormationCellInput {
  unit_type:     string;
  incapacitated: boolean;
}

// ── Identity constant (exported for combat_system default) ───────────────────

export const IDENTITY_FORMATION_BONUS: FormationBonusModifiers = {
  hp_dealt_mult:    1.0,
  supp_dealt_mult:  1.0,
  supp_resist_mult: 1.0,
  supp_decay_mult:  1.0,
};

// ── Internal helpers ─────────────────────────────────────────────────────────

function _row(idx: number): number { return Math.floor(idx / 5); }
function _col(idx: number): number { return idx % 5; }

function _chebyshev(idxA: number, idxB: number): number {
  return Math.max(Math.abs(_row(idxA) - _row(idxB)), Math.abs(_col(idxA) - _col(idxB)));
}

function _matchesUnit(unit_type: string, pattern: string | string[]): boolean {
  if (Array.isArray(pattern)) return pattern.includes(unit_type);
  return unit_type === pattern;
}

function _matchesProximity(idxA: number, idxB: number, spec: ProximitySpec): boolean {
  if (idxA === idxB) return false;
  switch (spec.type) {
    case "adjacent":     return _chebyshev(idxA, idxB) === 1;
    case "same_row":     return _row(idxA) === _row(idxB);
    case "same_col":     return _col(idxA) === _col(idxB);
    case "distance":     return _chebyshev(idxA, idxB) <= spec.max;
    case "self_in_row":  return false; // handled separately
  }
}

function _mergeBonus(
  existing: FormationBonusModifiers,
  bonus: Partial<FormationBonusModifiers>,
): FormationBonusModifiers {
  return {
    hp_dealt_mult:    existing.hp_dealt_mult    * (bonus.hp_dealt_mult    ?? 1.0),
    supp_dealt_mult:  existing.supp_dealt_mult  * (bonus.supp_dealt_mult  ?? 1.0),
    supp_resist_mult: existing.supp_resist_mult * (bonus.supp_resist_mult ?? 1.0),
    supp_decay_mult:  existing.supp_decay_mult  * (bonus.supp_decay_mult  ?? 1.0),
  };
}

function _applyBonus(
  bonusMap: Map<number, FormationBonusModifiers>,
  cellIdx: number,
  bonus: Partial<FormationBonusModifiers>,
): void {
  const existing = bonusMap.get(cellIdx) ?? { ...IDENTITY_FORMATION_BONUS };
  bonusMap.set(cellIdx, _mergeBonus(existing, bonus));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the list of currently-active formation rules.
 * Starts empty — rules are added via perk research in future branches.
 * The researchedPerks parameter is accepted now for forward-compatibility.
 */
export function getActiveFormationRules(_researchedPerks?: string[]): FormationRule[] {
  return [];
}

/**
 * Evaluates all active formation rules against a division's cell grid.
 * Returns a Map of cell_index → combined FormationBonusModifiers.
 * Cells not in the Map receive IDENTITY_FORMATION_BONUS (no effect).
 * Incapacitated cells are excluded from matching.
 */
export function evaluateFormationRules(
  cells: FormationCellInput[],
  activeRules: FormationRule[],
): Map<number, FormationBonusModifiers> {
  const bonusMap = new Map<number, FormationBonusModifiers>();
  if (activeRules.length === 0) return bonusMap;

  for (const rule of activeRules) {
    if (rule.proximity.type === "self_in_row") {
      // Self-referential: no pair needed — just check each cell's own row
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (cell.unit_type === "" || cell.incapacitated) continue;
        if (_row(i) === rule.proximity.row && _matchesUnit(cell.unit_type, rule.unitA)) {
          _applyBonus(bonusMap, i, rule.bonusForA);
        }
      }
      continue;
    }

    // Pair-based: scan all A×B cell pairs
    for (let idxA = 0; idxA < cells.length; idxA++) {
      const cellA = cells[idxA];
      if (cellA.unit_type === "" || cellA.incapacitated) continue;
      if (!_matchesUnit(cellA.unit_type, rule.unitA)) continue;

      for (let idxB = 0; idxB < cells.length; idxB++) {
        if (idxA === idxB) continue;
        const cellB = cells[idxB];
        if (cellB.unit_type === "" || cellB.incapacitated) continue;
        if (!_matchesUnit(cellB.unit_type, rule.unitB)) continue;
        if (!_matchesProximity(idxA, idxB, rule.proximity)) continue;

        // Match found: apply bonuses to both cells
        _applyBonus(bonusMap, idxA, rule.bonusForA);
        if (rule.bonusForB) {
          _applyBonus(bonusMap, idxB, rule.bonusForB);
        }
      }
    }
  }

  return bonusMap;
}
```

- [ ] **Step 4: Run unit tests — expect GREEN**

```bash
NODE_ENV=test npx mocha -r tsx test/6i-formation-rules.test.ts --exit --timeout 30000 2>&1 | tail -20
```

Expected: `16 passing` (all unit tests pass)

- [ ] **Step 5: Commit**

```bash
git add game-server/src/systems/formation_rule_system.ts game-server/test/6i-formation-rules.test.ts
git commit -m "feat: add formation_rule_system with proximity detection and unit tests"
```

---

## Task 2: Wire formation bonuses into combat_system.ts + integration tests

**Files:**
- Modify: `game-server/src/systems/combat_system.ts`
- Modify: `game-server/test/6i-formation-rules.test.ts` (add integration tests to the existing file)

### Wiring overview

There are exactly **two** call sites in `combat_system.ts` where formation bonuses must be applied:

**Call site 1 — `_applyPerCellDamage` (around line 663):**
- Compute `attackerFormationBonuses` and `defenderFormationBonuses` maps once at the top of the function (before any loops)
- In the attacker cell loop: look up `attackerFormationBonuses.get(idx) ?? IDENTITY_FORMATION_BONUS`
- In the target cell loop: look up `defenderFormationBonuses.get(tIdx) ?? IDENTITY_FORMATION_BONUS`
- Apply multiplicatively alongside existing row perk multipliers on lines 744–745

**Call site 2 — `_decayCellSuppression` (around line 649):**
- Compute `decayFormationBonuses` map at the top of the function
- Inside the `forEach`, look up `decayFormationBonuses.get(cellIdx) ?? IDENTITY_FORMATION_BONUS`
- Apply `formationBonus.supp_decay_mult` multiplicatively alongside `decayPerk.supp_decay_mult` on line 656

- [ ] **Step 6: Write integration tests (RED — will pass once wiring is done in Steps 7–9)**

Append the integration test block to `game-server/test/6i-formation-rules.test.ts`. Add these imports at the top of the file (after existing imports):

```typescript
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { setRoundTicksForTesting, setCombatGraceTicksForTesting } from "../src/systems/combat_system.js";
```

Then append the integration describe block at the bottom of the file:

```typescript
// ── Integration tests ─────────────────────────────────────────────────────────
// These tests verify that wiring the formation rule system into combat does NOT
// break existing combat behaviour. Since getActiveFormationRules() returns [],
// formation bonuses are identity (1.0) and all damage/suppression is unchanged.

describe("formation-rule-system — integration (no active rules = no change)", function () {
  this.timeout(180_000);

  const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
  const jwtSecret  = new TextEncoder().encode(JWT_SECRET);

  async function makeToken(sub = "test-user") {
    return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("24h")
      .sign(jwtSecret);
  }

  function waitForEngagementRound(client: any, engagementId: string, timeoutMs = 60_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unbind();
        reject(new Error(`Timeout waiting for ROUND_RESOLVED for ${engagementId}`));
      }, timeoutMs);
      const unbind = client.onMessage("ROUND_RESOLVED", (msg: any) => {
        if (typeof msg.engagement_id === "string" && msg.engagement_id.startsWith(engagementId)) {
          clearTimeout(timer); unbind(); resolve(msg);
        }
      });
    });
  }

  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setRoundTicksForTesting(3);
    setCombatGraceTicksForTesting(1);
    colyseus = await boot(appConfig);
  });
  after(async () => {
    setRoundTicksForTesting(20);
    setCombatGraceTicksForTesting(10);
    await new Promise(r => setTimeout(r, 300));
    await colyseus.shutdown();
  });
  beforeEach(async () => { await colyseus.cleanup(); });

  async function spawnCombat(
    divAUnits: Record<number, string>,
    divBUnits: Record<number, string>,
  ) {
    const token  = await makeToken();
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const divA = "div-a";
    const divB = "div-b";

    client.send("SPAWN_DIVISION", { division_id: divA, nation_id: "germany", position_lng: 0,     position_lat: 0     });
    client.send("SPAWN_DIVISION", { division_id: divB, nation_id: "france",  position_lng: 0.001, position_lat: 0.001 });
    await room.waitForNextPatch();

    for (const [idx, utype] of Object.entries(divAUnits)) {
      client.send("SET_CELL", { division_id: divA, cell_index: +idx, unit_type: utype });
    }
    for (const [idx, utype] of Object.entries(divBUnits)) {
      client.send("SET_CELL", { division_id: divB, cell_index: +idx, unit_type: utype });
    }
    await room.waitForNextPatch();

    await (room as any).startGame();
    await room.waitForNextPatch();
    await client.waitForMessage("COMBAT_STARTED", 60_000);

    const engagementId = `${divA}_vs_${divB}_`;
    return { room, client, engagementId };
  }

  it("ROUND_RESOLVED fires and defender cell takes HP damage (regression — no formation rules active)", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    const msg = await waitForEngagementRound(client, engagementId, 60_000);
    // Basic sanity: at least one delta exists
    const hasDeltas = (msg.attacker_grid_delta?.length ?? 0) > 0 ||
                      (msg.defender_grid_delta?.length ?? 0) > 0;
    assert.ok(hasDeltas, "at least one grid delta should be present");
  });

  it("defender cell HP decreases after one round (regression)", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    await waitForEngagementRound(client, engagementId, 60_000);
    const cell = room.state.divisions.get("div-b")!.grid.cells[12];
    assert.ok(cell.hp < 100, `defender HP should have decreased from 100, got ${cell.hp}`);
  });

  it("defender cell suppression increases after one round (regression)", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    await waitForEngagementRound(client, engagementId, 60_000);
    const cell = room.state.divisions.get("div-b")!.grid.cells[12];
    assert.ok(cell.suppression > 0, `defender suppression should be > 0, got ${cell.suppression}`);
  });
});
```

- [ ] **Step 7: Run tests — integration tests should FAIL (wiring not done yet)**

```bash
NODE_ENV=test npx mocha -r tsx test/6i-formation-rules.test.ts --exit --timeout 180000 2>&1 | tail -30
```

Expected: unit tests still pass (16); integration tests fail because the module isn't imported in `combat_system.ts` yet. If they pass without wiring, that's also acceptable (it means the combat system still works — proceed to Step 8 anyway).

- [ ] **Step 8: Add import to `combat_system.ts`**

Open `game-server/src/systems/combat_system.ts`. Find the existing import of `row_perk_system`:

```typescript
import { getRowPerkModifiers } from "./row_perk_system.js";
```

Add the formation system import immediately after it:

```typescript
import { getRowPerkModifiers } from "./row_perk_system.js";
import {
  evaluateFormationRules,
  getActiveFormationRules,
  IDENTITY_FORMATION_BONUS,
} from "./formation_rule_system.js";
```

- [ ] **Step 9: Wire call site 1 — `_applyPerCellDamage`**

Open `combat_system.ts`. Find `_applyPerCellDamage` (around line 663). At the very start of the function body (before any existing local variable declarations inside the function), add:

```typescript
const _activeRules = getActiveFormationRules();
const attackerFormationBonuses = evaluateFormationRules(
  [...attacker.grid.cells].map(c => ({ unit_type: c.unit_type, incapacitated: c.incapacitated })),
  _activeRules,
);
const defenderFormationBonuses = evaluateFormationRules(
  [...defender.grid.cells].map(c => ({ unit_type: c.unit_type, incapacitated: c.incapacitated })),
  _activeRules,
);
```

Then find the line where `attackerRowPerk` is used (line ~686). Immediately after:

```typescript
const attackerRowPerk = getRowPerkModifiers(attRow);
```

Add:

```typescript
const attackerFormationBonus = attackerFormationBonuses.get(idx) ?? IDENTITY_FORMATION_BONUS;
```

Then find the line where `defenderRowPerk` is computed (line ~742). Immediately after:

```typescript
const defenderRowPerk = getRowPerkModifiers(defRow);
```

Add:

```typescript
const defenderFormationBonus = defenderFormationBonuses.get(tIdx) ?? IDENTITY_FORMATION_BONUS;
```

Then find the two mutation lines (lines ~744–745):

```typescript
tCell.hp          = Math.max(0, tCell.hp - (perTargetHp * penMult * tacticalHpBonus * artyMult * attackerRowPerk.hp_dealt_mult) / xpHpMult);
tCell.suppression = Math.min(100, tCell.suppression + (perTargetSupp * cavMult * attackerRowPerk.supp_dealt_mult * defenderRowPerk.supp_resist_mult) / xpSuppResist);
```

Replace with:

```typescript
tCell.hp          = Math.max(0, tCell.hp - (perTargetHp * penMult * tacticalHpBonus * artyMult * attackerRowPerk.hp_dealt_mult * attackerFormationBonus.hp_dealt_mult) / xpHpMult);
tCell.suppression = Math.min(100, tCell.suppression + (perTargetSupp * cavMult * attackerRowPerk.supp_dealt_mult * attackerFormationBonus.supp_dealt_mult * defenderRowPerk.supp_resist_mult * defenderFormationBonus.supp_resist_mult) / xpSuppResist);
```

- [ ] **Step 10: Wire call site 2 — `_decayCellSuppression`**

Find `_decayCellSuppression` (around line 649). The current method looks like:

```typescript
private _decayCellSuppression(div: DivisionState, isRetreating: boolean): void {
  if (!div.grid) return;
  const baseDecay = isRetreating ? CELL_SUPP_DECAY_RETREAT : CELL_SUPP_DECAY_BASE;
  div.grid.cells.forEach((cell, cellIdx) => {
    if (cell.unit_type === "") return;
    const cellRow = Math.floor(cellIdx / 5);
    const decayPerk = getRowPerkModifiers(cellRow);
    cell.suppression = Math.max(0, cell.suppression - baseDecay * decayPerk.supp_decay_mult);
  });
}
```

Add the formation bonus evaluation after the `baseDecay` line, and look up per-cell inside `forEach`:

```typescript
private _decayCellSuppression(div: DivisionState, isRetreating: boolean): void {
  if (!div.grid) return;
  const baseDecay = isRetreating ? CELL_SUPP_DECAY_RETREAT : CELL_SUPP_DECAY_BASE;
  const decayFormationBonuses = evaluateFormationRules(
    [...div.grid.cells].map(c => ({ unit_type: c.unit_type, incapacitated: c.incapacitated })),
    getActiveFormationRules(),
  );
  div.grid.cells.forEach((cell, cellIdx) => {
    if (cell.unit_type === "") return;
    const cellRow = Math.floor(cellIdx / 5);
    const decayPerk = getRowPerkModifiers(cellRow);
    const formationBonus = decayFormationBonuses.get(cellIdx) ?? IDENTITY_FORMATION_BONUS;
    cell.suppression = Math.max(0, cell.suppression - baseDecay * decayPerk.supp_decay_mult * formationBonus.supp_decay_mult);
  });
}
```

- [ ] **Step 11: Run all tests — expect GREEN**

```bash
NODE_ENV=test npx mocha -r tsx test/6i-formation-rules.test.ts --exit --timeout 180000 2>&1 | tail -30
```

Expected: `19 passing` (16 unit + 3 integration)

- [ ] **Step 12: Run full server test suite — no regressions**

```bash
NODE_ENV=test npx mocha -r tsx "test/**/*.test.ts" --exit --timeout 180000 2>&1 | tail -30
```

Expected: all previously-passing tests still pass.

- [ ] **Step 13: Commit**

```bash
git add game-server/src/systems/combat_system.ts game-server/test/6i-formation-rules.test.ts
git commit -m "feat: wire formation_rule_system into combat rounds (no active rules — identity no-op)"
```

---

## Verification Checklist

- [ ] `formation_rule_system.ts` exports: `ProximitySpec`, `FormationBonusModifiers`, `FormationRule`, `FormationCellInput`, `IDENTITY_FORMATION_BONUS`, `getActiveFormationRules`, `evaluateFormationRules`
- [ ] `getActiveFormationRules()` returns `[]`
- [ ] Unit tests: 16 passing — all proximity types covered, incapacitated exclusion, stacking, identity constant
- [ ] Integration tests: 3 passing — combat still works as before (regression)
- [ ] Full test suite: no regressions in any 6a–6h tests
- [ ] TypeScript compiles with no errors (`npx tsc --noEmit` if available)
- [ ] `_applyPerCellDamage` applies `attackerFormationBonus.hp_dealt_mult` and both `supp_dealt/resist_mult`
- [ ] `_decayCellSuppression` applies `formationBonus.supp_decay_mult`
- [ ] When `getActiveFormationRules()` returns `[]`, `evaluateFormationRules` returns an empty Map, and all lookups hit the `?? IDENTITY_FORMATION_BONUS` fallback — combat math is identical to pre-branch behavior
