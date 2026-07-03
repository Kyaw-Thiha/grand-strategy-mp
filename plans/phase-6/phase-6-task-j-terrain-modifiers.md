# Plan: Phase 6 — Branch J: Terrain Modifier System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Save this plan to:** `plans/phase-6-task-j-terrain-modifiers.md`

**Goal:** Build an extensible per-cell, per-unit-type terrain modifier engine that applies tactical bonuses/penalties based on the battle's terrain cover each combat round. Includes stealth delta and a flanking gate for armour. Ships with **zero active rules** — the engine is a proven no-op when the rule list is empty. Concrete terrain rules are added later via perk research or balance pass.

Second sub-goal: write verification tests for the suppression → strategic `Suppressed` state bridge (attacker 80% / defender 60% thresholds, stealthed + incapacitated exclusions).

**Context:** `battle_cover` (e.g. "dense_forest", "plains") is already on `ActivePair` and available every combat round. The existing terrain system is two flat scalars (`terrain_mult_atk`, `terrain_mult_def`) applied at division level — these are **kept as-is**. Branch J adds a **per-cell, per-unit-type** layer on top. The existing `resolveTerrainStealthBonuses` in `perks.ts` (perk-gated stealth bonuses) is also **not replaced** — the new system adds a parallel extensible layer that merges into it.

**Architecture mirrors Branch I** (`formation_rule_system.ts`): a `terrain_modifier_system.ts` with `getActiveTerrainModifierRules()` returning `[]` initially, and `evaluateTerrainModifiers(cells, battle_cover, activeRules)` returning an empty Map → all `?? IDENTITY_TERRAIN_MODIFIERS` fallbacks → pure no-op.

**Stacking rules:**
- `hp_dealt_mult`, `supp_dealt_mult`, `supp_resist_mult`, `supp_decay_mult` — **multiplicative** across rules
- `stealth_delta` — **additive** across rules
- `flanking_enabled` — **AND** across rules (one `false` disables flanking)

---

## Key Existing Files (DO NOT recreate)

| File | Purpose |
|---|---|
| `game-server/src/systems/formation_rule_system.ts` | **Primary reference** — copy module structure exactly |
| `game-server/src/systems/combat_system.ts` | Modify: add import + 3 wiring points |
| `game-server/test/6h-row-perks.test.ts` | **Primary test reference** — copy integration test structure |
| `game-server/src/data/perks.ts` | `resolveTerrainStealthBonuses` — do NOT replace |
| `game-server/src/systems/attack_patterns.ts` | `_resolveStealthForRound`, `_computeEffectiveStealths` — do NOT modify |

## Files to Create

- `game-server/src/systems/terrain_modifier_system.ts`
- `game-server/test/6j-terrain-modifiers.test.ts`

## Files to Modify

- `game-server/src/systems/combat_system.ts` (import + 3 wiring points)

---

## Full Type Reference

The execution agent must use these exact type definitions:

```typescript
export interface TerrainCellModifiers {
  hp_dealt_mult:    number;   // multiplier on outgoing HP damage
  supp_dealt_mult:  number;   // multiplier on outgoing suppression
  supp_resist_mult: number;   // multiplier on incoming suppression (< 1 = receive less)
  supp_decay_mult:  number;   // multiplier on suppression decay rate
  stealth_delta:    number;   // additive bonus to base stealth_level (0 = no change)
  flanking_enabled: boolean;  // false = skip armour column shift for this cell
}

export interface TerrainModifierRule {
  id: string;
  unit_types: string | string[];   // unit type(s) this rule applies to
  terrain:    string | string[];   // cover string(s) this rule applies to
  modifiers:  Partial<TerrainCellModifiers>;
}

export interface TerrainCellInput {
  unit_type:     string;
  incapacitated: boolean;
}

export const IDENTITY_TERRAIN_MODIFIERS: TerrainCellModifiers = {
  hp_dealt_mult: 1.0, supp_dealt_mult: 1.0,
  supp_resist_mult: 1.0, supp_decay_mult: 1.0,
  stealth_delta: 0, flanking_enabled: true,
};
```

---

## Known terrain cover values (from `COVER_MOD` in combat_system.ts)

```
plains, farmland, grassland, steppe, open_forest, temperate_forest,
boreal_forest, dense_forest, urban, mediterranean_scrub, heathland,
hot_desert, cold_desert, tundra, wetland
```

---

## Wiring overview (combat_system.ts)

### Wiring point 1 — `_applyPerCellDamage`

At the **very top** of `_applyPerCellDamage`, after the Branch I formation bonus declarations, add:

```typescript
const _activeTerrainRules = getActiveTerrainModifierRules();
const attackerTerrainMods = evaluateTerrainModifiers(
  [...attacker.grid.cells].map(c => ({ unit_type: c.unit_type, incapacitated: c.incapacitated })),
  pair.battle_cover,
  _activeTerrainRules,
);
const defenderTerrainMods = evaluateTerrainModifiers(
  [...defender.grid.cells].map(c => ({ unit_type: c.unit_type, incapacitated: c.incapacitated })),
  pair.battle_cover,
  _activeTerrainRules,
);
```

In the **attacker cell loop**, after `attackerFormationBonus` (Branch I):

```typescript
const attackerTerrainMod = attackerTerrainMods.get(idx) ?? IDENTITY_TERRAIN_MODIFIERS;
```

**Flanking gate** — wrap the existing `_resolveArmourColumn` call. The current code is:

```typescript
if (utype === "light_tank" || utype === "medium_tank" || utype === "heavy_tank" || utype === "armoured_car") {
  const shift = _resolveArmourColumn(attCol, defender.grid.cells, attRow, cover);
  if (shift?.shift_type === "flank")            { sideArmourActive = true; tacticalHpBonus = TACTICAL_FLANK_BONUS; }
  else if (shift?.shift_type === "envelopment") { sideArmourActive = true; tacticalHpBonus = TACTICAL_ENVELOPMENT_BONUS; }
}
```

Replace with:

```typescript
if (utype === "light_tank" || utype === "medium_tank" || utype === "heavy_tank" || utype === "armoured_car") {
  if (attackerTerrainMod.flanking_enabled) {
    const shift = _resolveArmourColumn(attCol, defender.grid.cells, attRow, cover);
    if (shift?.shift_type === "flank")            { sideArmourActive = true; tacticalHpBonus = TACTICAL_FLANK_BONUS; }
    else if (shift?.shift_type === "envelopment") { sideArmourActive = true; tacticalHpBonus = TACTICAL_ENVELOPMENT_BONUS; }
  }
}
```

NOTE: `_resolveArmourColumn` in `attack_patterns.ts` already returns early at line 168 for `dense_forest` and `urban` — so the gate above is redundant for those two terrains specifically. Keep the gate regardless: it is the extension point for future perk rules that may disable flanking for other terrain types (e.g. `wetland`, `boreal_forest`).

**Updated damage lines** (add terrain mods multiplicatively):

```typescript
tCell.hp = Math.max(0, tCell.hp - (perTargetHp * penMult * tacticalHpBonus * artyMult
  * attackerRowPerk.hp_dealt_mult * attackerFormationBonus.hp_dealt_mult * attackerTerrainMod.hp_dealt_mult
) / xpHpMult);

tCell.suppression = Math.min(100, tCell.suppression + (perTargetSupp * cavMult
  * attackerRowPerk.supp_dealt_mult * attackerFormationBonus.supp_dealt_mult * attackerTerrainMod.supp_dealt_mult
  * defenderRowPerk.supp_resist_mult * defenderFormationBonus.supp_resist_mult * defenderTerrainMod.supp_resist_mult
) / xpSuppResist);
```

In the **target cell loop**, after `defenderFormationBonus`:

```typescript
const defenderTerrainMod = defenderTerrainMods.get(tIdx) ?? IDENTITY_TERRAIN_MODIFIERS;
```

### Wiring point 2 — `_decayCellSuppression`

`_decayCellSuppression` currently has no access to `battle_cover`. Add it as a parameter.

Change signature from:
```typescript
private _decayCellSuppression(div: DivisionState, isRetreating: boolean): void {
```
To:
```typescript
private _decayCellSuppression(div: DivisionState, isRetreating: boolean, battle_cover: string): void {
```

Find all call sites of `_decayCellSuppression` — they are in `_applyDamage` (lines ~840 and ~844), not `_resolveCombat`. Add `pair.battle_cover` as the third argument at both call sites (`pair` is available in `_applyDamage`).

Inside the method body, after `baseDecay`, before the `forEach`:

```typescript
const decayTerrainMods = evaluateTerrainModifiers(
  [...div.grid.cells].map(c => ({ unit_type: c.unit_type, incapacitated: c.incapacitated })),
  battle_cover,
  getActiveTerrainModifierRules(),
);
```

Inside `forEach`, after `formationBonus` (Branch I):

```typescript
const terrainDecayMod = decayTerrainMods.get(cellIdx) ?? IDENTITY_TERRAIN_MODIFIERS;
cell.suppression = Math.max(0, cell.suppression
  - baseDecay * decayPerk.supp_decay_mult * formationBonus.supp_decay_mult * terrainDecayMod.supp_decay_mult);
```

### Wiring point 3 — Stealth block (~lines 545–553)

Find this existing stealth block in `_resolveCombat`:

```typescript
const terrain    = pair.battle_cover ?? "";
const perksA     = Array.from(state.nations.get(divA.nation_id)?.researched_perks ?? []);
const perksB     = Array.from(state.nations.get(divB.nation_id)?.researched_perks ?? []);
const bonusesA   = resolveTerrainStealthBonuses(terrain, perksA);
const bonusesB   = resolveTerrainStealthBonuses(terrain, perksB);
const cellsA     = Array.from(divA.grid.cells);
const cellsB     = Array.from(divB.grid.cells);
_resolveStealthForRound(cellsA, this._computeMaxAntiStealth(cellsB), this._computeEffectiveStealths(cellsA, bonusesA));
_resolveStealthForRound(cellsB, this._computeMaxAntiStealth(cellsA), this._computeEffectiveStealths(cellsB, bonusesB));
```

After `bonusesB` is computed, add terrain modifier computation and fold `stealth_delta` into the existing perk-based bonuses records:

```typescript
const _activeTerrainRulesS = getActiveTerrainModifierRules();
const terrainModsStealthA  = evaluateTerrainModifiers(
  [...divA.grid.cells].map(c => ({ unit_type: c.unit_type, incapacitated: c.incapacitated })),
  terrain, _activeTerrainRulesS,
);
const terrainModsStealthB  = evaluateTerrainModifiers(
  [...divB.grid.cells].map(c => ({ unit_type: c.unit_type, incapacitated: c.incapacitated })),
  terrain, _activeTerrainRulesS,
);
const augmentedBonusesA = { ...bonusesA };
terrainModsStealthA.forEach((mods, cellIdx) => {
  if (mods.stealth_delta !== 0) {
    const utype = divA.grid.cells[cellIdx]?.unit_type ?? "";
    if (utype) augmentedBonusesA[utype] = (augmentedBonusesA[utype] ?? 0) + mods.stealth_delta;
  }
});
const augmentedBonusesB = { ...bonusesB };
terrainModsStealthB.forEach((mods, cellIdx) => {
  if (mods.stealth_delta !== 0) {
    const utype = divB.grid.cells[cellIdx]?.unit_type ?? "";
    if (utype) augmentedBonusesB[utype] = (augmentedBonusesB[utype] ?? 0) + mods.stealth_delta;
  }
});
```

Then update the `_resolveStealthForRound` calls to use augmented bonuses (replace `bonusesA`/`bonusesB`):

```typescript
_resolveStealthForRound(cellsA, this._computeMaxAntiStealth(cellsB), this._computeEffectiveStealths(cellsA, augmentedBonusesA));
_resolveStealthForRound(cellsB, this._computeMaxAntiStealth(cellsA), this._computeEffectiveStealths(cellsB, augmentedBonusesB));
```

---

## Task 1: Create `terrain_modifier_system.ts` with unit tests (RED → GREEN)

- [ ] **Step 1: Write the unit test file first (RED)**

Create `game-server/test/6j-terrain-modifiers.test.ts` with the unit tests below. Do NOT add integration tests yet — those come in Task 2.

```typescript
import { describe, it } from "mocha";
import assert from "assert";
import {
  evaluateTerrainModifiers,
  getActiveTerrainModifierRules,
  IDENTITY_TERRAIN_MODIFIERS,
} from "../src/systems/terrain_modifier_system.js";
import type { TerrainModifierRule, TerrainCellInput } from "../src/systems/terrain_modifier_system.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGrid(overrides: Record<number, string>): TerrainCellInput[] {
  return Array.from({ length: 25 }, (_, i) => ({
    unit_type:     overrides[i] ?? "",
    incapacitated: false,
  }));
}

function makeRule(
  id: string,
  unit_types: string | string[],
  terrain: string | string[],
  modifiers: Partial<typeof IDENTITY_TERRAIN_MODIFIERS>,
): TerrainModifierRule {
  return { id, unit_types, terrain, modifiers };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("terrain-modifier-system — unit tests", () => {

  // ── getActiveTerrainModifierRules ─────────────────────────────────────────

  it("getActiveTerrainModifierRules() returns empty array", () => {
    assert.deepStrictEqual(getActiveTerrainModifierRules(), []);
  });

  it("getActiveTerrainModifierRules([]) returns empty array", () => {
    assert.deepStrictEqual(getActiveTerrainModifierRules([]), []);
  });

  // ── Fast paths ────────────────────────────────────────────────────────────

  it("returns empty Map when activeRules is empty", () => {
    assert.strictEqual(evaluateTerrainModifiers(makeGrid({ 12: "infantry" }), "dense_forest", []).size, 0);
  });

  it("returns empty Map when grid has no units", () => {
    const rule = makeRule("r1", "infantry", "dense_forest", { hp_dealt_mult: 1.2 });
    assert.strictEqual(evaluateTerrainModifiers(makeGrid({}), "dense_forest", [rule]).size, 0);
  });

  // ── Terrain and unit matching ─────────────────────────────────────────────

  it("grants modifier when unit_type and terrain both match", () => {
    const grid = makeGrid({ 12: "infantry" });
    const rule = makeRule("r1", "infantry", "dense_forest", { supp_resist_mult: 0.8 });
    const result = evaluateTerrainModifiers(grid, "dense_forest", [rule]);
    assert.ok(result.has(12));
    assert.strictEqual(result.get(12)!.supp_resist_mult, 0.8);
  });

  it("no modifier when terrain does NOT match", () => {
    const grid = makeGrid({ 12: "infantry" });
    const rule = makeRule("r1", "infantry", "dense_forest", { supp_resist_mult: 0.8 });
    assert.strictEqual(evaluateTerrainModifiers(grid, "plains", [rule]).size, 0);
  });

  it("no modifier when unit_type does NOT match", () => {
    const grid = makeGrid({ 12: "artillery" });
    const rule = makeRule("r1", "infantry", "dense_forest", { supp_resist_mult: 0.8 });
    assert.strictEqual(evaluateTerrainModifiers(grid, "dense_forest", [rule]).size, 0);
  });

  // ── unit_types and terrain as arrays ─────────────────────────────────────

  it("unit_types as string[]: matches any listed unit type", () => {
    const grid = makeGrid({ 5: "commando" });
    const rule = makeRule("r1", ["infantry", "commando", "recon_infantry"], "temperate_forest", { supp_resist_mult: 0.85 });
    const result = evaluateTerrainModifiers(grid, "temperate_forest", [rule]);
    assert.ok(result.has(5));
  });

  it("terrain as string[]: matches any listed terrain", () => {
    const grid = makeGrid({ 5: "infantry" });
    const rule = makeRule("r1", "infantry", ["temperate_forest", "boreal_forest", "dense_forest"], { supp_resist_mult: 0.85 });
    const result = evaluateTerrainModifiers(grid, "boreal_forest", [rule]);
    assert.ok(result.has(5));
  });

  it("terrain as string[]: no match when none of the listed terrains match", () => {
    const grid = makeGrid({ 5: "infantry" });
    const rule = makeRule("r1", "infantry", ["temperate_forest", "dense_forest"], { supp_resist_mult: 0.85 });
    assert.strictEqual(evaluateTerrainModifiers(grid, "plains", [rule]).size, 0);
  });

  // ── flanking_enabled ──────────────────────────────────────────────────────

  it("flanking_enabled: false propagates for matching cell", () => {
    const grid = makeGrid({ 20: "heavy_tank" });
    const rule = makeRule("r1", ["light_tank", "medium_tank", "heavy_tank", "armoured_car"], ["dense_forest", "urban"], { flanking_enabled: false });
    const result = evaluateTerrainModifiers(grid, "urban", [rule]);
    assert.ok(result.has(20));
    assert.strictEqual(result.get(20)!.flanking_enabled, false);
  });

  it("flanking_enabled: no rule matched → cell not in map → caller uses IDENTITY (flanking_enabled: true)", () => {
    const grid = makeGrid({ 20: "heavy_tank" });
    const rule = makeRule("r1", ["light_tank", "medium_tank", "heavy_tank", "armoured_car"], ["dense_forest", "urban"], { flanking_enabled: false });
    const result = evaluateTerrainModifiers(grid, "plains", [rule]);
    assert.strictEqual(result.has(20), false);
    // Caller does: result.get(20) ?? IDENTITY_TERRAIN_MODIFIERS → flanking_enabled: true
  });

  // ── stealth_delta ─────────────────────────────────────────────────────────

  it("stealth_delta: positive delta granted for matching unit+terrain", () => {
    const grid = makeGrid({ 3: "sniper" });
    const rule = makeRule("r1", ["sniper", "commando", "recon_infantry"], "dense_forest", { stealth_delta: 1 });
    const result = evaluateTerrainModifiers(grid, "dense_forest", [rule]);
    assert.ok(result.has(3));
    assert.strictEqual(result.get(3)!.stealth_delta, 1);
  });

  it("stealth_delta: stacks additively across multiple matching rules", () => {
    const grid = makeGrid({ 3: "sniper" });
    const rule1 = makeRule("r1", "sniper", "dense_forest", { stealth_delta: 1 });
    const rule2 = makeRule("r2", "sniper", "dense_forest", { stealth_delta: 1 });
    const result = evaluateTerrainModifiers(grid, "dense_forest", [rule1, rule2]);
    assert.strictEqual(result.get(3)!.stealth_delta, 2);
  });

  // ── Multiplicative stacking (combat mods) ─────────────────────────────────

  it("hp_dealt_mult stacks multiplicatively across multiple rules", () => {
    const grid = makeGrid({ 12: "infantry" });
    const rule1 = makeRule("r1", "infantry", "plains", { hp_dealt_mult: 1.2 });
    const rule2 = makeRule("r2", "infantry", "plains", { hp_dealt_mult: 1.1 });
    const combined = evaluateTerrainModifiers(grid, "plains", [rule1, rule2]).get(12)!.hp_dealt_mult;
    assert.ok(Math.abs(combined - 1.32) < 0.001, `expected 1.32, got ${combined}`);
  });

  // ── flanking AND stacking ─────────────────────────────────────────────────

  it("flanking_enabled AND stacking: one false rule disables flanking even with other rules active", () => {
    const grid = makeGrid({ 20: "heavy_tank" });
    const ruleFlankDisable = makeRule("r1", "heavy_tank", "dense_forest", { flanking_enabled: false });
    const ruleHpBonus      = makeRule("r2", "heavy_tank", "dense_forest", { hp_dealt_mult: 1.1 });
    const result = evaluateTerrainModifiers(grid, "dense_forest", [ruleFlankDisable, ruleHpBonus]);
    assert.strictEqual(result.get(20)!.flanking_enabled, false, "flanking should be disabled");
    assert.ok(Math.abs(result.get(20)!.hp_dealt_mult - 1.1) < 0.001, "hp_dealt_mult should still apply");
  });

  // ── Incapacitated excluded ────────────────────────────────────────────────

  it("incapacitated cells are excluded from terrain matching", () => {
    const cells: TerrainCellInput[] = Array.from({ length: 25 }, (_, i) => ({
      unit_type:     i === 12 ? "infantry" : "",
      incapacitated: i === 12,
    }));
    const rule = makeRule("r1", "infantry", "dense_forest", { supp_resist_mult: 0.8 });
    assert.strictEqual(evaluateTerrainModifiers(cells, "dense_forest", [rule]).size, 0);
  });

  // ── IDENTITY_TERRAIN_MODIFIERS ────────────────────────────────────────────

  it("IDENTITY_TERRAIN_MODIFIERS: all combat mults = 1.0, stealth_delta = 0, flanking_enabled = true", () => {
    assert.strictEqual(IDENTITY_TERRAIN_MODIFIERS.hp_dealt_mult,    1.0);
    assert.strictEqual(IDENTITY_TERRAIN_MODIFIERS.supp_dealt_mult,  1.0);
    assert.strictEqual(IDENTITY_TERRAIN_MODIFIERS.supp_resist_mult, 1.0);
    assert.strictEqual(IDENTITY_TERRAIN_MODIFIERS.supp_decay_mult,  1.0);
    assert.strictEqual(IDENTITY_TERRAIN_MODIFIERS.stealth_delta,    0);
    assert.strictEqual(IDENTITY_TERRAIN_MODIFIERS.flanking_enabled, true);
  });
});
```

- [ ] **Step 2: Run tests → expect RED (module not found)**

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server
NODE_ENV=test npx mocha -r tsx test/6j-terrain-modifiers.test.ts --exit --timeout 30000 2>&1 | tail -20
```

Expected: `Cannot find module '../src/systems/terrain_modifier_system.js'`

- [ ] **Step 3: Create `game-server/src/systems/terrain_modifier_system.ts`**

```typescript
/**
 * Terrain Modifier System.
 *
 * Per-cell, per-unit-type terrain modifiers evaluated each combat round.
 * Ships with no active rules — rules are added later via perk research.
 *
 * battle_cover values (from ActivePair.battle_cover, set via COVER_MOD in combat_system.ts):
 *   plains, farmland, grassland, steppe, open_forest, temperate_forest,
 *   boreal_forest, dense_forest, urban, mediterranean_scrub, heathland,
 *   hot_desert, cold_desert, tundra, wetland
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface TerrainCellModifiers {
  hp_dealt_mult:    number;
  supp_dealt_mult:  number;
  supp_resist_mult: number;
  supp_decay_mult:  number;
  stealth_delta:    number;
  flanking_enabled: boolean;
}

export interface TerrainModifierRule {
  id: string;
  unit_types: string | string[];
  terrain:    string | string[];
  modifiers:  Partial<TerrainCellModifiers>;
}

export interface TerrainCellInput {
  unit_type:     string;
  incapacitated: boolean;
}

// ── Identity constant ─────────────────────────────────────────────────────────

export const IDENTITY_TERRAIN_MODIFIERS: TerrainCellModifiers = {
  hp_dealt_mult:    1.0,
  supp_dealt_mult:  1.0,
  supp_resist_mult: 1.0,
  supp_decay_mult:  1.0,
  stealth_delta:    0,
  flanking_enabled: true,
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function _matchesUnit(unit_type: string, pattern: string | string[]): boolean {
  return Array.isArray(pattern) ? pattern.includes(unit_type) : unit_type === pattern;
}

function _matchesTerrain(battle_cover: string, pattern: string | string[]): boolean {
  return Array.isArray(pattern) ? pattern.includes(battle_cover) : battle_cover === pattern;
}

function _mergeModifiers(
  existing: TerrainCellModifiers,
  bonus: Partial<TerrainCellModifiers>,
): TerrainCellModifiers {
  return {
    hp_dealt_mult:    existing.hp_dealt_mult    * (bonus.hp_dealt_mult    ?? 1.0),
    supp_dealt_mult:  existing.supp_dealt_mult  * (bonus.supp_dealt_mult  ?? 1.0),
    supp_resist_mult: existing.supp_resist_mult * (bonus.supp_resist_mult ?? 1.0),
    supp_decay_mult:  existing.supp_decay_mult  * (bonus.supp_decay_mult  ?? 1.0),
    stealth_delta:    existing.stealth_delta    + (bonus.stealth_delta    ?? 0),
    flanking_enabled: existing.flanking_enabled && (bonus.flanking_enabled ?? true),
  };
}

function _applyModifier(
  modMap: Map<number, TerrainCellModifiers>,
  cellIdx: number,
  bonus: Partial<TerrainCellModifiers>,
): void {
  const existing = modMap.get(cellIdx) ?? { ...IDENTITY_TERRAIN_MODIFIERS };
  modMap.set(cellIdx, _mergeModifiers(existing, bonus));
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getActiveTerrainModifierRules(_researchedPerks?: string[]): TerrainModifierRule[] {
  return [];
}

export function evaluateTerrainModifiers(
  cells: TerrainCellInput[],
  battle_cover: string,
  activeRules: TerrainModifierRule[],
): Map<number, TerrainCellModifiers> {
  const modMap = new Map<number, TerrainCellModifiers>();
  if (activeRules.length === 0) return modMap;

  for (const rule of activeRules) {
    if (!_matchesTerrain(battle_cover, rule.terrain)) continue;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell.unit_type === "" || cell.incapacitated) continue;
      if (!_matchesUnit(cell.unit_type, rule.unit_types)) continue;
      _applyModifier(modMap, i, rule.modifiers);
    }
  }

  return modMap;
}
```

- [ ] **Step 4: Run tests → expect GREEN**

```bash
NODE_ENV=test npx mocha -r tsx test/6j-terrain-modifiers.test.ts --exit --timeout 30000 2>&1 | tail -20
```

Expected: `15 passing`

- [ ] **Step 5: Commit**

```bash
git add game-server/src/systems/terrain_modifier_system.ts game-server/test/6j-terrain-modifiers.test.ts
git commit -m "feat: add terrain_modifier_system with per-cell unit-type terrain modifiers and unit tests"
```

---

## Task 2: Wire into `combat_system.ts` + integration regression tests

- [ ] **Step 6: Add import to `combat_system.ts`**

Find the formation_rule_system import (added in Branch I):

```typescript
import {
  evaluateFormationRules,
  getActiveFormationRules,
  IDENTITY_FORMATION_BONUS,
} from "./formation_rule_system.js";
```

Add immediately after it:

```typescript
import {
  evaluateTerrainModifiers,
  getActiveTerrainModifierRules,
  IDENTITY_TERRAIN_MODIFIERS,
} from "./terrain_modifier_system.js";
```

- [ ] **Step 7: Wire `_applyPerCellDamage`**

Follow the exact wiring described in the Wiring overview section above:
1. Add `attackerTerrainMods` and `defenderTerrainMods` at top of function
2. Add `attackerTerrainMod` lookup in attacker cell loop
3. Add flanking gate wrapping the `_resolveArmourColumn` block
4. Add `defenderTerrainMod` lookup in target cell loop
5. Update both damage lines to multiply in terrain mods

- [ ] **Step 8: Wire `_decayCellSuppression`**

Follow the exact wiring described in the Wiring overview section above:
1. Add `battle_cover: string` as third parameter to method signature
2. Find both call sites in `_applyDamage` (lines ~840 and ~844) and pass `pair.battle_cover` as third argument
3. Add `decayTerrainMods` evaluation at top of method body
4. Add `terrainDecayMod` lookup inside `forEach`, multiply into suppression decay line

- [ ] **Step 9: Wire stealth block**

Follow the exact wiring described in the Wiring overview section above:
1. Compute `terrainModsStealthA` and `terrainModsStealthB`
2. Build `augmentedBonusesA` and `augmentedBonusesB` by folding `stealth_delta` values into the existing perk bonuses records
3. Replace `bonusesA`/`bonusesB` with `augmentedBonusesA`/`augmentedBonusesB` in the two `_resolveStealthForRound` calls

- [ ] **Step 10: Write integration regression tests — append to `6j-terrain-modifiers.test.ts`**

Add these imports at the top of the file (after existing unit test imports):

```typescript
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { setRoundTicksForTesting, setCombatGraceTicksForTesting } from "../src/systems/combat_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret  = new TextEncoder().encode(JWT_SECRET);
```

Append the integration describe block at the bottom:

```typescript
describe("terrain-modifier-system — integration (no active rules = no change)", function () {
  this.timeout(180_000);

  async function makeToken(sub = "test-user") {
    return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("24h")
      .sign(jwtSecret);
  }

  function waitForEngagementRound(client: any, engagementId: string, timeoutMs = 60_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { unbind(); reject(new Error(`Timeout: ${engagementId}`)); }, timeoutMs);
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

    client.send("SPAWN_DIVISION", { division_id: "div-a", nation_id: "germany", position_lng: 0,     position_lat: 0     });
    client.send("SPAWN_DIVISION", { division_id: "div-b", nation_id: "france",  position_lng: 0.001, position_lat: 0.001 });
    await room.waitForNextPatch();

    for (const [idx, utype] of Object.entries(divAUnits))
      client.send("SET_CELL", { division_id: "div-a", cell_index: +idx, unit_type: utype });
    for (const [idx, utype] of Object.entries(divBUnits))
      client.send("SET_CELL", { division_id: "div-b", cell_index: +idx, unit_type: utype });
    await room.waitForNextPatch();

    await (room as any).startGame();
    await room.waitForNextPatch();
    await client.waitForMessage("COMBAT_STARTED", 60_000);

    return { room, client, engagementId: "div-a_vs_div-b_" };
  }

  it("ROUND_RESOLVED fires correctly with no active terrain rules (regression)", async () => {
    const { client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    const msg = await waitForEngagementRound(client, engagementId);
    const hasDeltas = (msg.attacker_grid_delta?.length ?? 0) > 0 || (msg.defender_grid_delta?.length ?? 0) > 0;
    assert.ok(hasDeltas, "at least one grid delta should be present");
  });

  it("defender HP decreases after one round — no terrain rule interference (regression)", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    await waitForEngagementRound(client, engagementId);
    const cell = room.state.divisions.get("div-b")!.grid.cells[12];
    assert.ok(cell.hp < 100, `defender HP should drop from 100, got ${cell.hp}`);
  });

  it("defender suppression increases after one round — no terrain rule interference (regression)", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    await waitForEngagementRound(client, engagementId);
    const cell = room.state.divisions.get("div-b")!.grid.cells[12];
    assert.ok(cell.suppression > 0, `suppression should be > 0, got ${cell.suppression}`);
  });
});
```

- [ ] **Step 11: Run 6j tests — expect GREEN**

```bash
NODE_ENV=test npx mocha -r tsx test/6j-terrain-modifiers.test.ts --exit --timeout 180000 2>&1 | tail -30
```

Expected: `18 passing` (15 unit + 3 integration)

- [ ] **Step 12: Run full test suite — no regressions**

```bash
NODE_ENV=test npx mocha -r tsx "test/**/*.test.ts" --exit --timeout 180000 2>&1 | tail -30
```

Expected: all previously-passing tests still pass.

- [ ] **Step 13: Commit wiring**

```bash
git add game-server/src/systems/combat_system.ts game-server/test/6j-terrain-modifiers.test.ts
git commit -m "feat: wire terrain_modifier_system into combat rounds (per-cell terrain mods, stealth delta, flanking gate)"
```

---

## Task 3: Suppression → strategic bridge verification

The second goal of Branch J: confirm the division-level suppression threshold correctly feeds the Phase 4 `Suppressed` strategic state, with proper attacker (80%) / defender (60%) thresholds and correct exclusions.

- [ ] **Step 14: Locate and read the suppression threshold logic in `combat_system.ts`**

Search for: `suppression_threshold`, `"suppressed"`, `_checkSuppressionState`, or the code that averages cell suppression and compares to 60% / 80%. Read the relevant block to understand:
- Which cells are included/excluded (stealthed, incapacitated)
- How attacker vs defender thresholds are applied
- Where `combat_state` is set to `"suppressed"` (or equivalent)
- Whether division `hp` (not cell HP) plays a role

This read is required before writing the tests below.

- [ ] **Step 15: Write suppression bridge verification tests**

Append a new describe block inside `6j-terrain-modifiers.test.ts`. Write these 4 tests:

**Test 1 — stealthed cell excluded from suppression average:**
Use direct state mutation to force `stealthed = true` on a sniper cell **after** `spawnCombat` returns but before asserting — stealth is only resolved per-round via `_resolveStealthForRound`, so a freshly spawned sniper is not yet stealthed. Pattern: `(room.state.divisions.get("div-a")!.grid.cells[cellIdx] as any).stealthed = true`. Then set suppression values directly on the non-sniper cells so that: (a) including the sniper's suppression would push average above threshold, (b) excluding it keeps it below. Assert `Suppressed` state is NOT triggered after one round. Check `6c-combat-stats.test.ts` for the direct state mutation pattern.

**Test 2 — incapacitated cell excluded from suppression average:**
Place an incapacitated infantry (bring HP to its incapacitation floor) + a healthy infantry. Set healthy infantry's suppression near but below threshold. Assert `Suppressed` not triggered when incapacitated cell would have pushed average above threshold.

**Test 3 — defender threshold is 60%:**
Push the **defender** division's non-excluded cells to average ≥ 60% suppression. Assert `combat_state` changes to `"suppressed"` (or the corresponding Colyseus schema field that feeds the Phase 4 `Suppressed` state).

**Test 4 — attacker threshold is 80%:**
Same but for the **attacker** side at 80% threshold.

NOTE: If direct state mutation of cell suppression is not available via the test server, use `waitForEngagementRound` in a loop accumulating suppression naturally, then assert the state change. Check `6c-combat-stats.test.ts` for how it handles pre-seeding cell values.

- [ ] **Step 16: Commit verification tests**

```bash
git add game-server/test/6j-terrain-modifiers.test.ts
git commit -m "test: verify suppression threshold bridge to strategic Suppressed state (attacker 80%, defender 60%, stealthed/incapacitated excluded)"
```

---

## Verification Checklist

- [ ] `terrain_modifier_system.ts` exports: `TerrainCellModifiers`, `TerrainModifierRule`, `TerrainCellInput`, `IDENTITY_TERRAIN_MODIFIERS`, `getActiveTerrainModifierRules`, `evaluateTerrainModifiers`
- [ ] `getActiveTerrainModifierRules()` returns `[]`
- [ ] Unit tests: 15 passing — terrain/unit matching, arrays, flanking gate, stealth_delta, multiplicative stacking, AND stacking, incapacitated exclusion, identity constant
- [ ] Integration tests: 3 passing — combat regression with no active rules
- [ ] Suppression bridge tests: thresholds and exclusions verified
- [ ] Full test suite: no regressions in 6a–6i tests
- [ ] `_decayCellSuppression` now has `battle_cover: string` as third parameter; both call sites updated with `pair.battle_cover`
- [ ] Stealth block uses `augmentedBonusesA`/`augmentedBonusesB` in `_computeEffectiveStealths` calls
- [ ] When `getActiveTerrainModifierRules()` returns `[]`, all `evaluateTerrainModifiers` calls return empty Map → all `?? IDENTITY_TERRAIN_MODIFIERS` fallbacks → math unchanged from pre-branch
