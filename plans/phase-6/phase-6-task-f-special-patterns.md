# Plan F — `feat/tactical-special-patterns`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sniper (configurable priority targeting across full grid) and artillery (recon-proportional weighted area targeting with damage falloff) attack patterns, wire them to the perk system so research can change priority lists, target counts, and area radius, and accumulate `recon_value` per engagement round.

**Architecture:** Pure TypeScript helpers (`_sniperTargets`, `_artilleryTargets`, `getArtilleryDamageMultipliers`, `_reconContribution`) added to `attack_patterns.ts`; a new `SpecialAttackConfig` struct in `perk_types.ts` extended by `PerkDefinition`; `resolveAttackConfig` in `perks.ts` that stacks perk overrides multiplicatively (integers take `max`) or by full replacement (priority lists); `combat_system.ts` resolves per-player configs from `state.nations` before passing them down to `_applyPerCellDamage`; `recon_value` accumulated on `DivisionState` after each round. GDScript stubs use default configs (perk-aware preview is a future Branch K concern).

**Tech Stack:** TypeScript + Colyseus/schema, Mocha + tsx, GDScript 4

## Global Constraints

- `moduleResolution: "NodeNext"` — ALL relative TypeScript imports must end in `.js`
- `GridCellState` is a Colyseus schema object — NEVER spread `{...c}`; copy fields explicitly
- All constants must stay in sync between `combat_constants.ts` (server) and `attack_pattern_registry.gd` (client)
- TDD: test file created first, all tests RED, then implement until GREEN
- Branches A–E existing tests (`6a`, `6b`, `6c`, `6d`, `6e`) must still pass after Branch F
- `SpecialAttackConfig.recon_value` and `SpecialAttackConfig.rng_seed` are runtime fields — never set by perks, always set by `combat_system.ts` / `simulateRound` caller before passing to `getTargetCells`

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

---

## Design Decisions

### Sniper targeting

Snipers ignore row/column position entirely. They scan the full 25-cell enemy grid and pick targets by priority type. The priority list is ordered — all living cells of `priority[0]` type are selected first, then `priority[1]`, etc., until `n_targets` cells are collected.

**Default priority list:**
```
["sniper", "force_recon_sniper", "flamethrower", "recon_infantry", "mg", "at_gun", "at_gun_sp", "at_infantry", "commando", "infantry"]
```

Perks can replace this list entirely (e.g. `"sniper_counter_armour_doctrine"` gives tanks highest priority). `n_targets` defaults to 1; perks can raise it.

### Artillery targeting

Artillery picks a column via weighted random, then damages all living cells in the area (`center_col ± area_radius` columns).

**Column weight formula:**
```
weight(col) = (1 - recon_value) * occupied_count(col)
            + recon_value       * value_score(col)
```
Where `value_score` sums `ARTY_UNIT_VALUE[unit_type]` for each living cell in that column (default value = 1 for unknown types).

- At `recon_value = 0`: all occupied columns equally likely (by cell count)
- At `recon_value = 1`: high-value columns strongly preferred

**Damage falloff:** `damage_mult(col) = max(0, 1.0 - falloff_per_col × |col − center_col|)`. Default `falloff_per_col = 0.3`. Center column always gets 1.0×.

**Deterministic RNG:** seed = `_hashString(engagement_id) XOR round_number`. Both server and GDScript client use the same seed. `_hashString` uses djb2.

### `SpecialAttackConfig` — perk-driven vs runtime fields

`SpecialAttackConfig` is a single struct passed to `getTargetCells`. It has two kinds of fields:
- **Perk-driven** (`priority_list`, `n_targets`, `area_radius`, `falloff_per_col`): resolved from `PERK_REGISTRY` by `resolveAttackConfig`. Never mutated after resolution.
- **Runtime** (`recon_value`, `rng_seed`): set by `_applyPerCellDamage` / `simulateRound` caller right before passing to `getTargetCells`. Never in `PerkDefinition.attack_config`.

`resolveAttackConfig(unitType, activePerkIds)` returns a mutable copy. Caller populates runtime fields.

### Perk stacking rules for `attack_config`

| Field | Stacking rule |
|---|---|
| `n_targets` | `max()` across all applicable perks |
| `area_radius` | `max()` across all applicable perks |
| `falloff_per_col` | last applicable perk wins (full override) |
| `priority_list` | last applicable perk wins (full list replacement) |

### Recon accumulation

After each round per engagement, for each side:
```
reconGain = RECON_BASE_PER_ROUND + Σ _reconContribution(cell.unit_type) for each living cell
division.recon_value = min(RECON_MAX, division.recon_value + reconGain)
```

`recon_value` is on `DivisionState` (schema-synced float, 0.0–1.0). `_reconContribution` returns the per-round contribution for a unit type (non-recon units return 0; baseline is added separately).

### How `combat_system.ts` gets nation perks

`DivisionState` has `nation_id: string`. `NationState` has `researched_perks: ArraySchema<string>` and is stored in `state.nations` (check `GameRoomState.ts` to confirm the collection type — it is either a `MapSchema<NationState>` keyed by nation_id or an `ArraySchema<NationState>`). Look up by `n.nation_id === attacker.nation_id`.

### `_applyPerCellDamage` — new parameter

Add `attackerPerkIds: string[]` as a new parameter. Find all call sites with:
```bash
grep -n "_applyPerCellDamage" game-server/src/systems/combat_system.ts
```
Update each call site to extract perk IDs from `state.nations` and pass them.

---

## Files to Create

### Task 1: Test file `game-server/test/6f-special-patterns.test.ts` (write FIRST — all RED)

- [ ] **Step 1: Create the test file**

```typescript
import assert from "assert";
import { describe, it } from "mocha";
import {
  getTargetCells,
  getDamageProfile,
  simulateRound,
  _sniperTargets,
  _artilleryTargets,
  getArtilleryDamageMultipliers,
  _reconContribution,
  _hashString,
} from "../src/systems/attack_patterns.js";
import { GridCellState } from "../src/rooms/schema/GameRoomState.js";
import { resolveAttackConfig } from "../src/data/perks.js";
import type { SpecialAttackConfig } from "../src/types/perk_types.js";

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

const DEFAULT_SNIPER_CFG: SpecialAttackConfig = {
  priority_list:    ["sniper","force_recon_sniper","flamethrower","recon_infantry","mg","at_gun","at_gun_sp","at_infantry","commando","infantry"],
  n_targets:        1,
  area_radius:      0,
  falloff_per_col:  0.0,
  recon_value:      0.0,
  rng_seed:         0,
};

const DEFAULT_ARTY_CFG: SpecialAttackConfig = {
  priority_list:    [],
  n_targets:        1,
  area_radius:      0,
  falloff_per_col:  0.3,
  recon_value:      0.0,
  rng_seed:         42,
};

describe("6f — Sniper, artillery, and recon patterns", function () {

  // ── _hashString ────────────────────────────────────────────────────────────

  it("_hashString: same input always returns same number", () => {
    assert.strictEqual(_hashString("abc"), _hashString("abc"));
  });

  it("_hashString: different inputs return different numbers", () => {
    assert.notStrictEqual(_hashString("engagement-1"), _hashString("engagement-2"));
  });

  it("_hashString: returns non-negative integer", () => {
    const h = _hashString("test");
    assert.ok(h >= 0 && Number.isInteger(h));
  });

  // ── _sniperTargets ─────────────────────────────────────────────────────────

  it("_sniperTargets: selects highest priority living unit", () => {
    // mg (priority 4) and infantry (priority 9). Sniper should pick mg.
    const grid = makeGrid({ 22: "mg", 12: "infantry" });
    const targets = _sniperTargets(DEFAULT_SNIPER_CFG.priority_list, 1, grid);
    assert.deepStrictEqual(targets, [22]);
  });

  it("_sniperTargets: skips to next priority when top not present", () => {
    // No sniper/flamethrower/recon in grid. mg at idx 10.
    const grid = makeGrid({ 10: "mg" });
    assert.deepStrictEqual(_sniperTargets(DEFAULT_SNIPER_CFG.priority_list, 1, grid), [10]);
  });

  it("_sniperTargets: n_targets=2 returns two cells across priority tiers", () => {
    // One flamethrower, one mg. n_targets=2 → both selected.
    const grid = makeGrid({ 20: "flamethrower", 22: "mg" });
    const targets = _sniperTargets(DEFAULT_SNIPER_CFG.priority_list, 2, grid);
    assert.strictEqual(targets.length, 2);
    assert.ok(targets.includes(20));
    assert.ok(targets.includes(22));
  });

  it("_sniperTargets: n_targets=2 returns two of the same type if multiple exist", () => {
    // Two mg teams. n_targets=2 → both returned.
    const grid = makeGrid({ 20: "mg", 22: "mg" });
    const targets = _sniperTargets(DEFAULT_SNIPER_CFG.priority_list, 2, grid);
    assert.strictEqual(targets.length, 2);
    assert.ok(targets.includes(20) && targets.includes(22));
  });

  it("_sniperTargets: skips incapacitated cells", () => {
    const grid = makeGrid({ 20: "mg", 22: "mg" });
    grid[20].incapacitated = true;
    assert.deepStrictEqual(_sniperTargets(DEFAULT_SNIPER_CFG.priority_list, 1, grid), [22]);
  });

  it("_sniperTargets: empty grid returns []", () => {
    assert.deepStrictEqual(_sniperTargets(DEFAULT_SNIPER_CFG.priority_list, 1, makeGrid({})), []);
  });

  it("_sniperTargets: falls back to infantry when no priority targets", () => {
    const grid = makeGrid({ 15: "infantry" });
    assert.deepStrictEqual(_sniperTargets(DEFAULT_SNIPER_CFG.priority_list, 1, grid), [15]);
  });

  it("_sniperTargets: custom priority_list fully replaces default order", () => {
    // Custom list: infantry first, then mg. Grid has both.
    const grid = makeGrid({ 20: "mg", 22: "infantry" });
    const custom = ["infantry", "mg"];
    assert.deepStrictEqual(_sniperTargets(custom, 1, grid), [22]); // infantry wins
  });

  it("_sniperTargets: returns [] when no cells match any priority type in list", () => {
    const grid = makeGrid({ 20: "cavalry" }); // cavalry not in priority list
    assert.deepStrictEqual(_sniperTargets(DEFAULT_SNIPER_CFG.priority_list, 1, grid), []);
  });

  it("_sniperTargets: targets anywhere in grid (ignores row/col position)", () => {
    // Unit deep in R1 (idx=2, row=0). Sniper should still reach it.
    const grid = makeGrid({ 2: "mg" });
    assert.deepStrictEqual(_sniperTargets(DEFAULT_SNIPER_CFG.priority_list, 1, grid), [2]);
  });

  // ── _artilleryTargets ──────────────────────────────────────────────────────

  it("_artilleryTargets: empty grid returns { center_col:0, targets:[] }", () => {
    const result = _artilleryTargets(makeGrid({}), 0.0, 0, 42);
    assert.deepStrictEqual(result, { center_col: 0, targets: [] });
  });

  it("_artilleryTargets: area_radius=0 returns only cells in center_col", () => {
    // Force recon_value=1 so highest-value column is picked deterministically.
    // Column 2 (C3) has heavy_tank (value=5). Other columns have infantry (value=1).
    const grid = makeGrid({ 20: "infantry", 22: "heavy_tank", 24: "infantry" });
    const { center_col, targets } = _artilleryTargets(grid, 1.0, 0, 1337);
    assert.strictEqual(center_col, 2); // C3 wins (highest value score)
    assert.deepStrictEqual(targets, [22]);
  });

  it("_artilleryTargets: area_radius=1 includes center_col ±1 columns", () => {
    // C3 (col=2) as center. area_radius=1 → cols 1,2,3 all included.
    const grid = makeGrid({ 21: "infantry", 22: "heavy_tank", 23: "infantry" });
    const { center_col, targets } = _artilleryTargets(grid, 1.0, 1, 1337);
    assert.strictEqual(center_col, 2);
    assert.ok(targets.includes(21));
    assert.ok(targets.includes(22));
    assert.ok(targets.includes(23));
  });

  it("_artilleryTargets: area_radius=2 can span full 5-column width", () => {
    // C3 center. area_radius=2 → cols 0–4 all reachable.
    const grid = makeGrid({ 20: "infantry", 21: "infantry", 22: "heavy_tank", 23: "infantry", 24: "infantry" });
    const { center_col, targets } = _artilleryTargets(grid, 1.0, 2, 1337);
    assert.strictEqual(center_col, 2);
    assert.strictEqual(targets.length, 5);
  });

  it("_artilleryTargets: area_radius clamped at grid edge (C1 center + radius=2 → cols 0–2 only)", () => {
    const grid = makeGrid({ 20: "infantry", 21: "infantry", 22: "infantry" });
    // Force C1 (col=0) to be selected: highest value at col=0
    const highValueGrid = makeGrid({ 20: "heavy_tank" }); // only col 0 occupied
    const { center_col, targets } = _artilleryTargets(highValueGrid, 1.0, 2, 999);
    assert.strictEqual(center_col, 0);
    // Only col 0 has cells; cols 1–2 are empty → targets just col 0
    assert.deepStrictEqual(targets, [20]);
  });

  it("_artilleryTargets: excludes incapacitated cells", () => {
    const grid = makeGrid({ 22: "heavy_tank", 12: "infantry" });
    grid[22].incapacitated = true;
    const { targets } = _artilleryTargets(grid, 1.0, 0, 1337);
    assert.ok(!targets.includes(22));
  });

  it("_artilleryTargets: same seed + same state → same center_col (deterministic)", () => {
    const grid = makeGrid({ 20: "infantry", 22: "infantry", 24: "infantry" });
    const r1 = _artilleryTargets(grid, 0.5, 0, 77);
    const r2 = _artilleryTargets(grid, 0.5, 0, 77);
    assert.strictEqual(r1.center_col, r2.center_col);
  });

  it("_artilleryTargets: different seed → potentially different center_col", () => {
    // This test verifies the seed actually influences output. With enough cell distribution
    // and different seeds, different columns can be selected. We test with 5 distinct seeds.
    const grid = makeGrid({ 20: "infantry", 21: "infantry", 22: "infantry", 23: "infantry", 24: "infantry" });
    const cols = new Set([1,2,3,4,5].map(seed => _artilleryTargets(grid, 0.0, 0, seed * 1000).center_col));
    assert.ok(cols.size >= 2, "different seeds should produce different columns given uniform distribution");
  });

  // ── getArtilleryDamageMultipliers ──────────────────────────────────────────

  it("getArtilleryDamageMultipliers: center col cells get mult=1.0", () => {
    const map = getArtilleryDamageMultipliers([22], 2, 0.3); // idx 22 = col 2 = center
    assert.strictEqual(map.get(22), 1.0);
  });

  it("getArtilleryDamageMultipliers: ±1 col cells reduced by falloff_per_col", () => {
    const map = getArtilleryDamageMultipliers([21, 22, 23], 2, 0.3);
    assert.strictEqual(map.get(21), 0.7); // col 1 → dist=1 → 1.0 - 0.3
    assert.strictEqual(map.get(23), 0.7); // col 3 → dist=1 → 1.0 - 0.3
  });

  it("getArtilleryDamageMultipliers: ±2 col cells reduced by 2*falloff_per_col", () => {
    const map = getArtilleryDamageMultipliers([20, 21, 22, 23, 24], 2, 0.3);
    assert.ok(Math.abs((map.get(20) ?? 0) - 0.4) < 1e-9); // col 0 → dist=2 → 1.0 - 0.6
    assert.ok(Math.abs((map.get(24) ?? 0) - 0.4) < 1e-9); // col 4 → dist=2 → 1.0 - 0.6
  });

  it("getArtilleryDamageMultipliers: mult never below 0", () => {
    // falloff=1.0, center col=2, far cells → would be negative without clamp
    const map = getArtilleryDamageMultipliers([20, 24], 2, 1.0);
    assert.ok((map.get(20) ?? -1) >= 0);
    assert.ok((map.get(24) ?? -1) >= 0);
  });

  it("getArtilleryDamageMultipliers: falloff=0 → all cells 1.0", () => {
    const map = getArtilleryDamageMultipliers([20, 21, 22, 23, 24], 2, 0.0);
    for (const [, mult] of map) assert.strictEqual(mult, 1.0);
  });

  it("getArtilleryDamageMultipliers: empty targets → empty map", () => {
    assert.strictEqual(getArtilleryDamageMultipliers([], 2, 0.3).size, 0);
  });

  // ── _reconContribution ────────────────────────────────────────────────────

  it("_reconContribution: recon_infantry returns highest non-zero rate", () => {
    assert.ok(_reconContribution("recon_infantry") > 0);
    assert.ok(_reconContribution("recon_infantry") > _reconContribution("armoured_car"));
  });

  it("_reconContribution: armoured_car returns non-zero rate", () => {
    assert.ok(_reconContribution("armoured_car") > 0);
  });

  it("_reconContribution: infantry returns 0 (baseline handled separately)", () => {
    assert.strictEqual(_reconContribution("infantry"), 0);
  });

  it("_reconContribution: mg returns 0", () => {
    assert.strictEqual(_reconContribution("mg"), 0);
  });

  it("_reconContribution: unknown type returns 0", () => {
    assert.strictEqual(_reconContribution("banana"), 0);
  });

  // ── getDamageProfile — sniper and arty ────────────────────────────────────

  it("getDamageProfile: sniper returns PROFILE_SNIPER (high HP, low supp)", () => {
    const p = getDamageProfile("sniper", 1);
    assert.strictEqual(p.hp_fraction,   0.80);
    assert.strictEqual(p.supp_fraction, 0.20);
  });

  it("getDamageProfile: force_recon_sniper returns same as sniper", () => {
    assert.deepStrictEqual(getDamageProfile("force_recon_sniper", 1), getDamageProfile("sniper", 1));
  });

  it("getDamageProfile: artillery returns PROFILE_ARTILLERY (high HP, moderate supp)", () => {
    const p = getDamageProfile("artillery", 1);
    assert.strictEqual(p.hp_fraction,   0.65);
    assert.strictEqual(p.supp_fraction, 0.35);
  });

  it("getDamageProfile: howitzer returns same as artillery", () => {
    assert.deepStrictEqual(getDamageProfile("howitzer", 1), getDamageProfile("artillery", 1));
  });

  it("getDamageProfile: self_propelled_gun returns same as artillery", () => {
    assert.deepStrictEqual(getDamageProfile("self_propelled_gun", 1), getDamageProfile("artillery", 1));
  });

  // ── resolveAttackConfig ───────────────────────────────────────────────────

  it("resolveAttackConfig: no perks → default sniper config for sniper", () => {
    const cfg = resolveAttackConfig("sniper", []);
    assert.strictEqual(cfg.n_targets, 1);
    assert.deepStrictEqual(cfg.priority_list, DEFAULT_SNIPER_CFG.priority_list);
    assert.strictEqual(cfg.area_radius, 0);
  });

  it("resolveAttackConfig: no perks → default arty config for artillery", () => {
    const cfg = resolveAttackConfig("artillery", []);
    assert.strictEqual(cfg.area_radius,     0);
    assert.strictEqual(cfg.falloff_per_col, 0.3);
    assert.strictEqual(cfg.n_targets,       1);
  });

  it("resolveAttackConfig: sniper_multitarget_1 perk → n_targets=2", () => {
    const cfg = resolveAttackConfig("sniper", ["sniper_multitarget_1"]);
    assert.strictEqual(cfg.n_targets, 2);
  });

  it("resolveAttackConfig: sniper_counter_armour_doctrine → priority_list fully replaced", () => {
    const cfg = resolveAttackConfig("sniper", ["sniper_counter_armour_doctrine"]);
    assert.ok(cfg.priority_list[0] === "light_tank" || cfg.priority_list[0] === "medium_tank" || cfg.priority_list[0] === "heavy_tank");
    assert.ok(!cfg.priority_list.includes("mg")); // default mg not in this doctrine
  });

  it("resolveAttackConfig: arty_area_1 → area_radius=1", () => {
    const cfg = resolveAttackConfig("artillery", ["arty_area_1"]);
    assert.strictEqual(cfg.area_radius, 1);
  });

  it("resolveAttackConfig: arty_area_2 → area_radius=2", () => {
    const cfg = resolveAttackConfig("artillery", ["arty_area_2"]);
    assert.strictEqual(cfg.area_radius, 2);
  });

  it("resolveAttackConfig: arty_area_1 + arty_area_2 → area_radius=2 (max wins)", () => {
    const cfg = resolveAttackConfig("artillery", ["arty_area_1", "arty_area_2"]);
    assert.strictEqual(cfg.area_radius, 2);
  });

  it("resolveAttackConfig: arty_precision_fire → falloff_per_col=0.5", () => {
    const cfg = resolveAttackConfig("artillery", ["arty_precision_fire"]);
    assert.strictEqual(cfg.falloff_per_col, 0.5);
  });

  it("resolveAttackConfig: unknown perk ID → ignored, defaults unchanged", () => {
    const cfg = resolveAttackConfig("sniper", ["nonexistent_perk_xyz"]);
    assert.strictEqual(cfg.n_targets, 1);
  });

  it("resolveAttackConfig: returns mutable copy (mutating result does not affect next call)", () => {
    const cfg1 = resolveAttackConfig("sniper", []);
    cfg1.n_targets = 99;
    const cfg2 = resolveAttackConfig("sniper", []);
    assert.strictEqual(cfg2.n_targets, 1);
  });

  // ── getTargetCells — sniper ───────────────────────────────────────────────

  it("getTargetCells: sniper targets highest-priority unit, not frontmost row", () => {
    // Enemy: infantry at R5 C1 (idx=20), mg at R1 C3 (idx=2).
    // Sniper should pick mg (higher priority) even though infantry is in front.
    const grid = makeGrid({ 20: "infantry", 2: "mg" });
    const targets = getTargetCells("sniper", 4, 2, grid, 1, Infinity, "", DEFAULT_SNIPER_CFG);
    assert.deepStrictEqual(targets, [2]); // mg wins
  });

  it("getTargetCells: force_recon_sniper same targeting as sniper", () => {
    const grid = makeGrid({ 20: "infantry", 2: "mg" });
    assert.deepStrictEqual(
      getTargetCells("force_recon_sniper", 4, 2, grid, 1, Infinity, "", DEFAULT_SNIPER_CFG),
      getTargetCells("sniper",             4, 2, grid, 1, Infinity, "", DEFAULT_SNIPER_CFG),
    );
  });

  it("getTargetCells: sniper with n_targets=2 config returns 2 cells", () => {
    const cfg: SpecialAttackConfig = { ...DEFAULT_SNIPER_CFG, n_targets: 2 };
    const grid = makeGrid({ 20: "flamethrower", 22: "mg" });
    assert.strictEqual(getTargetCells("sniper", 4, 2, grid, 1, Infinity, "", cfg).length, 2);
  });

  it("getTargetCells: sniper with no config uses default priority list", () => {
    // Called without 8th param — should still work (default sniper priority)
    const grid = makeGrid({ 20: "mg" });
    const targets = getTargetCells("sniper", 4, 2, grid, 1);
    assert.deepStrictEqual(targets, [20]);
  });

  // ── getTargetCells — artillery ────────────────────────────────────────────

  it("getTargetCells: artillery returns living cells in area (area_radius=0)", () => {
    // All cells in center_col. With recon=1, heavy_tank col wins deterministically.
    const cfg: SpecialAttackConfig = { ...DEFAULT_ARTY_CFG, recon_value: 1.0, rng_seed: 1337 };
    const grid = makeGrid({ 22: "heavy_tank", 12: "infantry" }); // C3: R5+R3
    const targets = getTargetCells("artillery", 4, 2, grid, 1, Infinity, "", cfg);
    assert.ok(targets.includes(22));
    assert.ok(targets.includes(12));
  });

  it("getTargetCells: howitzer same as artillery", () => {
    const cfg: SpecialAttackConfig = { ...DEFAULT_ARTY_CFG, recon_value: 1.0, rng_seed: 1337 };
    const grid = makeGrid({ 22: "heavy_tank" });
    assert.deepStrictEqual(
      getTargetCells("howitzer",  4, 2, grid, 1, Infinity, "", cfg),
      getTargetCells("artillery", 4, 2, grid, 1, Infinity, "", cfg),
    );
  });

  it("getTargetCells: self_propelled_gun same as artillery", () => {
    const cfg: SpecialAttackConfig = { ...DEFAULT_ARTY_CFG, recon_value: 1.0, rng_seed: 1337 };
    const grid = makeGrid({ 22: "heavy_tank" });
    assert.deepStrictEqual(
      getTargetCells("self_propelled_gun", 4, 2, grid, 1, Infinity, "", cfg),
      getTargetCells("artillery",          4, 2, grid, 1, Infinity, "", cfg),
    );
  });

  it("getTargetCells: artillery with no config uses defaults (seed=0, recon=0, radius=0)", () => {
    const grid = makeGrid({ 22: "infantry" });
    const targets = getTargetCells("artillery", 4, 2, grid, 1);
    // Just verify it doesn't throw and returns an array
    assert.ok(Array.isArray(targets));
  });

  // ── simulateRound — sniper and arty ──────────────────────────────────────

  it("simulateRound: sniper targets priority unit, not frontmost", () => {
    // Sniper at R5 C3 (idx=22). Enemy: infantry at R5 C1 (idx=20), mg at R3 C3 (idx=12).
    const attackers = makeGrid({ 22: "sniper" });
    const enemy     = makeGrid({ 20: "infantry", 12: "mg" });
    const result    = simulateRound(attackers, enemy, 1, [], Infinity, "", 0);
    const targets   = result.get(22)!;
    assert.ok(targets.includes(12),  "sniper targets mg (higher priority)");
    assert.ok(!targets.includes(20), "sniper ignores infantry when mg present");
  });

  it("simulateRound: artillery targets living cells in area", () => {
    const attackers = makeGrid({ 0: "artillery" });
    const enemy     = makeGrid({ 22: "infantry", 12: "infantry" });
    const result    = simulateRound(attackers, enemy, 1, [], Infinity, "", 1337);
    const targets   = result.get(0)!;
    assert.ok(Array.isArray(targets));
    assert.ok(targets.length > 0, "artillery hits something");
  });
});
```

- [ ] **Step 2: Run test to verify all RED**

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server
NODE_ENV=test npx mocha -r tsx test/6f-special-patterns.test.ts --exit --timeout 15000
```

Expected: all tests fail (`_sniperTargets is not a function`, `resolveAttackConfig is not exported`, etc.).

---

## Files to Modify

### Task 2: `game-server/src/types/perk_types.ts` — add `SpecialAttackConfig`, extend `PerkDefinition`

- [ ] **Step 3: Add `SpecialAttackConfig` and defaults, extend `PerkDefinition`**

Find the end of `perk_types.ts` (currently 27 lines). Append:

```typescript
export interface SpecialAttackConfig {
  // ── perk-driven fields (set by resolveAttackConfig) ──
  priority_list:    string[];  // sniper target priority — ordered unit_type list
  n_targets:        number;    // sniper: how many priority targets to select
  area_radius:      number;    // arty: ±cols from center (0=single col, 1=3-wide, 2=5-wide)
  falloff_per_col:  number;    // arty: damage_mult reduction per col from center
  // ── runtime fields (set by caller before passing to getTargetCells) ──
  recon_value:      number;    // arty: normalized 0.0–1.0 from DivisionState.recon_value
  rng_seed:         number;    // arty: deterministic RNG seed; never in PerkDefinition
}

export const DEFAULT_SNIPER_CONFIG: Readonly<SpecialAttackConfig> = {
  priority_list:   ["sniper","force_recon_sniper","flamethrower","recon_infantry","mg","at_gun","at_gun_sp","at_infantry","commando","infantry"],
  n_targets:        1,
  area_radius:      0,
  falloff_per_col:  0.0,
  recon_value:      0.0,
  rng_seed:         0,
};

export const DEFAULT_ARTILLERY_CONFIG: Readonly<SpecialAttackConfig> = {
  priority_list:    [],
  n_targets:        1,
  area_radius:      0,
  falloff_per_col:  0.3,
  recon_value:      0.0,
  rng_seed:         0,
};
```

Also update `PerkDefinition` — find:
```typescript
export interface PerkDefinition {
  perk_id: string;
  scope: PerkScope;
  applies_to_unit?: string;
  synergy_units?: [string, string];
  modifiers: Partial<PerkModifiers>;
}
```
Replace with:
```typescript
export interface PerkDefinition {
  perk_id:         string;
  scope:           PerkScope;
  applies_to_unit?: string;
  synergy_units?:  [string, string];
  modifiers:       Partial<PerkModifiers>;
  // Structural attack overrides (sniper/arty only). NEVER include recon_value or rng_seed here.
  attack_config?:  Partial<Pick<SpecialAttackConfig, "priority_list" | "n_targets" | "area_radius" | "falloff_per_col">>;
}
```

---

### Task 3: `game-server/src/data/perks.ts` — add `resolveAttackConfig` + 5 new perks

- [ ] **Step 4: Update import to include `SpecialAttackConfig` and defaults**

Find the current import at line 1:
```typescript
import type { PerkDefinition, PerkModifiers } from "../types/perk_types.js";
import { IDENTITY_MODIFIERS } from "../types/perk_types.js";
```
Replace with:
```typescript
import type { PerkDefinition, PerkModifiers, SpecialAttackConfig } from "../types/perk_types.js";
import { IDENTITY_MODIFIERS, DEFAULT_SNIPER_CONFIG, DEFAULT_ARTILLERY_CONFIG } from "../types/perk_types.js";
```

- [ ] **Step 5: Add 5 new entries to `PERK_REGISTRY`** — append inside the existing `PERK_REGISTRY` object before the closing `}`:

```typescript
  // Sniper doctrine tree
  "sniper_multitarget_1": {
    perk_id:         "sniper_multitarget_1",
    scope:           "unit_type",
    applies_to_unit: "sniper",
    modifiers:       {},
    attack_config:   { n_targets: 2 },
  },
  "sniper_counter_armour_doctrine": {
    perk_id:         "sniper_counter_armour_doctrine",
    scope:           "unit_type",
    applies_to_unit: "sniper",
    modifiers:       {},
    attack_config: {
      priority_list: ["heavy_tank","medium_tank","light_tank","armoured_car","at_gun_sp","at_gun","mg"],
    },
  },

  // Artillery doctrine tree
  "arty_area_1": {
    perk_id:         "arty_area_1",
    scope:           "unit_type",
    applies_to_unit: "artillery",
    modifiers:       {},
    attack_config:   { area_radius: 1 },
  },
  "arty_area_2": {
    perk_id:         "arty_area_2",
    scope:           "unit_type",
    applies_to_unit: "artillery",
    modifiers:       {},
    attack_config:   { area_radius: 2 },
  },
  "arty_precision_fire": {
    perk_id:         "arty_precision_fire",
    scope:           "unit_type",
    applies_to_unit: "artillery",
    modifiers:       {},
    attack_config:   { falloff_per_col: 0.5 },
  },
```

- [ ] **Step 6: Add `resolveAttackConfig` function** — append after `resolvePerkModifiers`:

```typescript
const _ARTY_UNIT_TYPES = new Set(["artillery", "howitzer", "self_propelled_gun"]);

/**
 * Resolves SpecialAttackConfig for a unit type given active perk IDs.
 * Returns a MUTABLE COPY — caller must set recon_value and rng_seed before use.
 *
 * Stacking rules:
 *   n_targets, area_radius   → max() across all applicable perks
 *   falloff_per_col          → last applicable perk wins
 *   priority_list            → last applicable perk fully replaces default
 */
export function resolveAttackConfig(
  unitType:      string,
  activePerkIds: string[],
): SpecialAttackConfig {
  const result: SpecialAttackConfig = _ARTY_UNIT_TYPES.has(unitType)
    ? { ...DEFAULT_ARTILLERY_CONFIG }
    : { ...DEFAULT_SNIPER_CONFIG, priority_list: [...DEFAULT_SNIPER_CONFIG.priority_list] };

  for (const id of activePerkIds) {
    const def = PERK_REGISTRY[id];
    if (!def)                           continue;
    if (def.scope !== "unit_type")      continue;
    if (def.applies_to_unit !== unitType) continue;
    if (!def.attack_config)             continue;

    const ac = def.attack_config;
    if (ac.n_targets      !== undefined) result.n_targets      = Math.max(result.n_targets, ac.n_targets);
    if (ac.area_radius    !== undefined) result.area_radius    = Math.max(result.area_radius, ac.area_radius);
    if (ac.falloff_per_col !== undefined) result.falloff_per_col = ac.falloff_per_col;
    if (ac.priority_list  !== undefined) result.priority_list  = [...ac.priority_list];
  }

  return result;
}
```

---

### Task 4: `game-server/src/data/combat_constants.ts` — add recon constants

Current file ends at `export const TACTICAL_ENVELOPMENT_BONUS = 1.5;`. Append:

- [ ] **Step 7: Append recon constants**

```typescript
export const RECON_MAX            = 1.0;   // recon_value is capped at this
export const RECON_BASE_PER_ROUND = 0.02;  // every engagement side gains this baseline per round

// Per-round recon contribution per living cell of this unit_type (0 = no contribution).
// Baseline (RECON_BASE_PER_ROUND) is added separately in combat_system.ts.
export const RECON_CONTRIB_RATES: Record<string, number> = {
  recon_infantry: 0.12,
  armoured_car:   0.06,
};

// Unit type value used for artillery column weighting.
// At high recon, columns with high-value units are targeted preferentially.
export const ARTY_UNIT_VALUE: Record<string, number> = {
  sniper:            5,
  force_recon_sniper:5,
  flamethrower:      4,
  heavy_tank:        5,
  medium_tank:       4,
  light_tank:        3,
  armoured_car:      3,
  mg:                3,
  at_gun:            3,
  at_gun_sp:         3,
  at_infantry:       2,
  howitzer:          3,
  self_propelled_gun:3,
};
```

---

### Task 5: `game-server/src/rooms/schema/GameRoomState.ts` — add `recon_value` to `DivisionState`

- [ ] **Step 8: Add `recon_value` field to `DivisionState`**

Find `DivisionState` class. Locate the block of `@type("number")` fields (e.g. after `engagement_radius`). Add one new line:

```typescript
  @type("number") recon_value: number = 0;    // 0.0–1.0; accumulated per engagement round
```

Place it after `engagement_radius` and before `movement_profile_json`. Keep existing field order intact.

---

### Task 6: `game-server/src/systems/attack_patterns.ts` — all new functions + extensions

**Verify first:** Read the top of `attack_patterns.ts` to confirm current imports:
```bash
grep -n "^import" game-server/src/systems/attack_patterns.ts
```

- [ ] **Step 9: Update import from `combat_constants.js`**

Find:
```typescript
import { BASE_ATTRITION } from "../data/combat_constants.js";
```
Replace with:
```typescript
import {
  BASE_ATTRITION,
  RECON_CONTRIB_RATES,
  ARTY_UNIT_VALUE,
} from "../data/combat_constants.js";
```

- [ ] **Step 10: Add import for `SpecialAttackConfig` and defaults from `perk_types.js`**

Add after the existing imports:
```typescript
import type { SpecialAttackConfig } from "../types/perk_types.js";
import { DEFAULT_SNIPER_CONFIG, DEFAULT_ARTILLERY_CONFIG } from "../types/perk_types.js";
```

- [ ] **Step 11: Add `ARTY_TYPES` and `SNIPER_TYPES` exported sets** — add after the existing `ARMOURED_TARGET_TYPES` set:

```typescript
export const SNIPER_TYPES = new Set(["sniper", "force_recon_sniper"]);
export const ARTY_TYPES   = new Set(["artillery", "howitzer", "self_propelled_gun"]);
```

- [ ] **Step 12: Add `PROFILE_SNIPER` and `PROFILE_ARTILLERY` constants** — add after `PROFILE_ARMOUR`:

```typescript
const PROFILE_SNIPER: DamageProfile = {
  hp_fraction:       0.80,
  supp_fraction:     0.20,
  bypasses_armour:   false,
  cavalry_supp_mult: 1.0,
};

const PROFILE_ARTILLERY: DamageProfile = {
  hp_fraction:       0.65,
  supp_fraction:     0.35,
  bypasses_armour:   false,
  cavalry_supp_mult: 1.0,
};
```

- [ ] **Step 13: Add cases to `getDamageProfile` switch** — insert before `default:`:

```typescript
    case "sniper":
    case "force_recon_sniper": return PROFILE_SNIPER;
    case "artillery":
    case "howitzer":
    case "self_propelled_gun": return PROFILE_ARTILLERY;
```

- [ ] **Step 14: Add `_hashString` helper** — add before `_columnTargets` (or at end of helpers section):

```typescript
/** djb2 string hash → non-negative 32-bit integer. Deterministic across runtimes. */
export function _hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0xFFFFFFFF;
  return h >>> 0;
}
```

- [ ] **Step 15: Add `_sniperTargets` helper** — add after `_hashString`:

```typescript
/**
 * Priority-based full-grid targeting for snipers.
 * Scans all 25 enemy cells in priority_list order, collecting up to n_targets living cells.
 * Returns cells in priority order (first matching priority type first).
 */
export function _sniperTargets(
  priority_list: string[],
  n_targets:     number,
  cells:         GridCellState[],
): number[] {
  const result: number[] = [];
  for (const type of priority_list) {
    if (result.length >= n_targets) break;
    for (let i = 0; i < cells.length; i++) {
      if (result.length >= n_targets) break;
      const c = cells[i];
      if (c.unit_type === type && !c.incapacitated && c.unit_type !== "") {
        result.push(i);
      }
    }
  }
  return result;
}
```

- [ ] **Step 16: Add `_artilleryTargets` helper** — add after `_sniperTargets`:

```typescript
/**
 * Weighted-random column selection followed by area expansion.
 *
 * Column weight formula:
 *   weight(col) = (1 - recon_value) * occupied_count(col)
 *               + recon_value       * value_score(col)
 * where value_score sums ARTY_UNIT_VALUE[unit_type] per living cell in col.
 *
 * center_col is chosen via seeded LCG random. Targets = all living cells in
 * columns [center_col - area_radius, center_col + area_radius] clamped to [0,4].
 * Ordered R5-first (row 4 descending) within each column.
 *
 * Returns { center_col: 0, targets: [] } if grid is empty.
 */
export function _artilleryTargets(
  cells:       GridCellState[],
  recon_value: number,    // 0.0–1.0 normalized
  area_radius: number,
  rng_seed:    number,
): { center_col: number; targets: number[] } {
  const colOccupied = [0, 0, 0, 0, 0];
  const colValue    = [0, 0, 0, 0, 0];

  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      const cell = cells[row * 5 + col];
      if (cell && cell.unit_type !== "" && !cell.incapacitated) {
        colOccupied[col]++;
        colValue[col] += ARTY_UNIT_VALUE[cell.unit_type] ?? 1;
      }
    }
  }

  const totalOccupied = colOccupied.reduce((s, n) => s + n, 0);
  if (totalOccupied === 0) return { center_col: 0, targets: [] };

  // Build final weights: lerp between occupied count and value score by recon_value
  const colWeights = colOccupied.map((oc, i) =>
    (1 - recon_value) * oc + recon_value * colValue[i],
  );

  const totalWeight = colWeights.reduce((s, w) => s + w, 0);
  // LCG step for deterministic random in [0, 1)
  const r = ((rng_seed * 1664525 + 1013904223) >>> 0) / 0x100000000;

  let center_col = 4; // fallback to last col
  let cumulative = 0;
  for (let c = 0; c < 5; c++) {
    cumulative += colWeights[c] / totalWeight;
    if (r < cumulative) { center_col = c; break; }
  }

  // Collect living cells in [center_col - area_radius, center_col + area_radius]
  const minCol = Math.max(0, center_col - area_radius);
  const maxCol = Math.min(4, center_col + area_radius);
  const targets: number[] = [];

  for (let col = minCol; col <= maxCol; col++) {
    for (let row = 4; row >= 0; row--) { // R5 first
      const idx  = row * 5 + col;
      const cell = cells[idx];
      if (cell && cell.unit_type !== "" && !cell.incapacitated) targets.push(idx);
    }
  }

  return { center_col, targets };
}
```

- [ ] **Step 17: Add `getArtilleryDamageMultipliers`** — add after `_artilleryTargets`:

```typescript
/**
 * Returns per-cell damage multipliers for an artillery strike.
 * mult(idx) = max(0, 1.0 - falloff_per_col × |col(idx) − center_col|)
 * Center column always gets 1.0. Multiplier never goes below 0.
 */
export function getArtilleryDamageMultipliers(
  targets:         number[],
  center_col:      number,
  falloff_per_col: number,
): Map<number, number> {
  const result = new Map<number, number>();
  for (const idx of targets) {
    const col  = idx % 5;
    const dist = Math.abs(col - center_col);
    result.set(idx, Math.max(0, 1.0 - falloff_per_col * dist));
  }
  return result;
}
```

- [ ] **Step 18: Add `_reconContribution`** — add after `getArtilleryDamageMultipliers`:

```typescript
/**
 * Per-round recon contribution for a single living cell of unit_type.
 * Returns 0 for non-recon units (combat_system adds RECON_BASE_PER_ROUND separately).
 */
export function _reconContribution(unit_type: string): number {
  return RECON_CONTRIB_RATES[unit_type] ?? 0;
}
```

- [ ] **Step 19: Update `getTargetCells` signature and add sniper/arty cases**

Find the function signature:
```typescript
export function getTargetCells(
  unit_type:    string,
  attacker_row: number,
  attacker_col: number,
  enemy_cells:  GridCellState[],
  round_number: number,
  n:            number = Infinity,
  cover:        string = "",
): number[]
```
Replace with:
```typescript
export function getTargetCells(
  unit_type:    string,
  attacker_row: number,
  attacker_col: number,
  enemy_cells:  GridCellState[],
  round_number: number,
  n:            number              = Infinity,
  cover:        string              = "",
  config?:      SpecialAttackConfig,
): number[]
```

Inside the switch, add these two cases BEFORE the `default: return [];` line:

```typescript
    case "sniper":
    case "force_recon_sniper": {
      const cfg = config ?? { ...DEFAULT_SNIPER_CONFIG, priority_list: [...DEFAULT_SNIPER_CONFIG.priority_list] };
      const raw = _sniperTargets(cfg.priority_list, cfg.n_targets, enemy_cells);
      return isFinite(n) ? raw.slice(0, n) : raw;
    }
    case "artillery":
    case "howitzer":
    case "self_propelled_gun": {
      const cfg = config ?? { ...DEFAULT_ARTILLERY_CONFIG };
      const { targets } = _artilleryTargets(enemy_cells, cfg.recon_value, cfg.area_radius, cfg.rng_seed);
      return isFinite(n) ? targets.slice(0, n) : targets;
    }
```

- [ ] **Step 20: Update `simulateRound` signature — add `seed` parameter**

Find:
```typescript
export function simulateRound(
  attacker_cells: GridCellState[],
  enemy_cells:    GridCellState[],
  round_number:   number,
  priority_types: string[] = [],
  n:              number   = Infinity,
  cover:          string   = "",
): Map<number, number[]>
```
Replace with:
```typescript
export function simulateRound(
  attacker_cells: GridCellState[],
  enemy_cells:    GridCellState[],
  round_number:   number,
  priority_types: string[] = [],
  n:              number   = Infinity,
  cover:          string   = "",
  seed:           number   = 0,
): Map<number, number[]>
```

Inside `simulateRound`, find the `getTargetCells(...)` call. Replace it with:

```typescript
      // Build special config for sniper/arty — default perks, runtime fields from params.
      let specialCfg: SpecialAttackConfig | undefined;
      if (SNIPER_TYPES.has(attCell.unit_type)) {
        specialCfg = { ...DEFAULT_SNIPER_CONFIG, priority_list: [...DEFAULT_SNIPER_CONFIG.priority_list] };
      } else if (ARTY_TYPES.has(attCell.unit_type)) {
        specialCfg = { ...DEFAULT_ARTILLERY_CONFIG, rng_seed: seed };
      }
      const targets = getTargetCells(attCell.unit_type, attRow, attCol, virtual, round_number, n, cover, specialCfg);
```

- [ ] **Step 21: Run 6f tests — expect GREEN for all attack_patterns.ts and perks.ts tests**

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server
NODE_ENV=test npx mocha -r tsx test/6f-special-patterns.test.ts --exit --timeout 15000
```

Tests in the `resolveAttackConfig`, `_sniperTargets`, `_artilleryTargets`, `getArtilleryDamageMultipliers`, `_reconContribution`, `getDamageProfile`, and `getTargetCells` describe blocks should all be GREEN. The `simulateRound` tests will also be GREEN now.

---

### Task 7: `game-server/src/systems/combat_system.ts` — wire perk config, recon, arty falloff

**Before starting: find key line numbers**

```bash
grep -n "_applyPerCellDamage\|pair\.round\|RECON\|recon_value" game-server/src/systems/combat_system.ts | head -30
grep -n "^import" game-server/src/systems/combat_system.ts | head -20
```

- [ ] **Step 22: Update imports in `combat_system.ts`**

Find the existing import from `attack_patterns.js`. Extend it:

```typescript
import {
  getTargetCells,
  getDamageProfile,
  getFireOrder,
  _resolveArmourColumn,
  _resolveATColumn,
  _artilleryTargets,        // ADD
  getArtilleryDamageMultipliers, // ADD
  _hashString,              // ADD
  _reconContribution,       // ADD
  ARTY_TYPES,               // ADD
  SNIPER_TYPES,             // ADD
} from "./attack_patterns.js";
```

Find the existing import from `combat_constants.js`. Extend it:

```typescript
import {
  BASE_ATTRITION,
  HP_DAMAGE_FRACTION,
  SUPPRESSION_FRACTION,
  SIDE_ARMOUR_MULT,
  TACTICAL_FLANK_BONUS,
  TACTICAL_ENVELOPMENT_BONUS,
  RECON_BASE_PER_ROUND,     // ADD
  RECON_MAX,                // ADD
} from "../data/combat_constants.js";
```

Add a new import for perks:
```typescript
import { resolvePerkModifiers, resolveAttackConfig } from "../data/perks.js";
import type { SpecialAttackConfig } from "../types/perk_types.js";
```

- [ ] **Step 23: Find how `state.nations` is structured**

Run:
```bash
grep -n "nations\|NationState" game-server/src/rooms/schema/GameRoomState.ts | head -20
grep -n "NationState\|\.nations" game-server/src/rooms/GameRoom.ts | head -10
```

This tells you whether `state.nations` is a `MapSchema<NationState>` (keyed by nation_id) or `ArraySchema<NationState>`. Use the correct access pattern in Step 24.

- [ ] **Step 24: Add `attackerPerkIds` parameter to `_applyPerCellDamage`**

Find the `_applyPerCellDamage` signature:
```typescript
private _applyPerCellDamage(
  attacker: DivisionState,
  defender: DivisionState,
  rawDamage: number,
  pair: ActivePair,
  broadcast: (type: string, msg: unknown) => void,
): GridCellDelta[]
```
Replace with:
```typescript
private _applyPerCellDamage(
  attacker:       DivisionState,
  defender:       DivisionState,
  rawDamage:      number,
  pair:           ActivePair,
  broadcast:      (type: string, msg: unknown) => void,
  attackerPerkIds: string[],
): GridCellDelta[]
```

- [ ] **Step 25: Add perk config resolution and arty falloff inside `_applyPerCellDamage`**

The existing outer attacker loop looks like this (line ~585):
```typescript
    for (const { cell: attCell, idx } of fireOrder) {
      const attRow  = Math.floor(idx / 5);
      const attCol  = idx % 5;
      const profile = getDamageProfile(attCell.unit_type, roundNumber);

      const targets     = getTargetCells(attCell.unit_type, attRow, attCol, defender.grid.cells, roundNumber, Infinity, cover);
      const attackerPen = UNIT_COMBAT_STATS[attCell.unit_type]?.pen ?? 10;
      // ... column-shift block ...
      for (const tIdx of targets) { ... }
    }
```

**Replace** the `const targets = getTargetCells(...)` line (only that one line) with the following block. Place it directly after `const profile = getDamageProfile(...)` and before `const attackerPen = ...`:

```typescript
      // Resolve targets — arty calls _artilleryTargets directly (avoids double call);
      // sniper uses getTargetCells with perk config; all others use getTargetCells as before.
      let specialCfg: SpecialAttackConfig | undefined;
      let targets: number[];
      let artyMultMap: Map<number, number> | null = null;

      if (ARTY_TYPES.has(attCell.unit_type)) {
        specialCfg             = resolveAttackConfig(attCell.unit_type, attackerPerkIds);
        specialCfg.recon_value = attacker.recon_value ?? 0;
        specialCfg.rng_seed    = _hashString(pair.engagement_id) ^ pair.round;
        const artyResult       = _artilleryTargets(defender.grid.cells, specialCfg.recon_value, specialCfg.area_radius, specialCfg.rng_seed);
        targets    = artyResult.targets;
        artyMultMap = getArtilleryDamageMultipliers(targets, artyResult.center_col, specialCfg.falloff_per_col);
      } else if (SNIPER_TYPES.has(attCell.unit_type)) {
        specialCfg          = resolveAttackConfig(attCell.unit_type, attackerPerkIds);
        specialCfg.rng_seed = 0; // snipers don't use RNG
        targets = getTargetCells(attCell.unit_type, attRow, attCol, defender.grid.cells, roundNumber, Infinity, cover, specialCfg);
      } else {
        targets = getTargetCells(attCell.unit_type, attRow, attCol, defender.grid.cells, roundNumber, Infinity, cover);
      }
```

Then find the inner target loop line where `tCell.hp` is modified (the variable is `tIdx`, not `idx` — `idx` is the outer loop's **attacker** cell index):
```typescript
        tCell.hp = Math.max(0, tCell.hp - perTargetHp * penMult * tacticalHpBonus);
```
Replace with:
```typescript
        const artyMult = artyMultMap?.get(tIdx) ?? 1.0;
        tCell.hp = Math.max(0, tCell.hp - perTargetHp * penMult * tacticalHpBonus * artyMult);
```

- [ ] **Step 26: Update all call sites of `_applyPerCellDamage` to pass perk IDs**

```bash
grep -n "_applyPerCellDamage" game-server/src/systems/combat_system.ts
```

For each call site, add the `attackerPerkIds` argument. The call site has access to `state` (it's reachable from `tick(state, ...)`). Look up the attacker's nation:

```typescript
// How to get perk IDs from state — check state.nations type from Step 23:
// If MapSchema<NationState> keyed by nation_id:
const attackerNation = state.nations.get(attacker.nation_id);
// If ArraySchema<NationState>:
// const attackerNation = Array.from(state.nations).find(n => n.nation_id === attacker.nation_id);

const attackerPerkIds = attackerNation ? Array.from(attackerNation.researched_perks) : [];
```

Pass `attackerPerkIds` as the 6th argument to the `_applyPerCellDamage` call.

- [ ] **Step 27: Add recon accumulation after each round**

Recon must accumulate AFTER `_applyDamage` — units incapacitated during this round should NOT contribute recon for this round. Using pre-damage cell state would over-count destroyed recon units.

The round resolution sequence (lines ~511–520) looks like:
```typescript
      pair.round++;
      const roundNumber = pair.round;
      // ... lethality phase update ...
      this._applyDamage(divA, divB, pair, state, changed, broadcast);  // line 520
```

Add the following block immediately AFTER the `this._applyDamage(...)` call (line 520). `divA` and `divB` are the `DivisionState` objects already in scope at that line:

```typescript
      // Accumulate recon_value after damage — only surviving units contribute
      const _accumulateRecon = (division: DivisionState): void => {
        let gain = RECON_BASE_PER_ROUND;
        for (const cell of Array.from(division.grid.cells)) {
          if (cell.unit_type !== "" && !cell.incapacitated) {
            gain += _reconContribution(cell.unit_type);
          }
        }
        division.recon_value = Math.min(RECON_MAX, (division.recon_value ?? 0) + gain);
      };
      _accumulateRecon(divA);
      _accumulateRecon(divB);
```

Verify that `divA` and `divB` are the correct variable names at that call site with:
```bash
grep -n "divA\|divB\|_applyDamage" game-server/src/systems/combat_system.ts | head -10
```
If the variable names differ, substitute the correct names.

- [ ] **Step 28: TypeScript compilation — zero errors**

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server && npx tsc --noEmit
```

---

### Task 8: `client/src/ui/hud/attack_pattern_registry.gd` — sniper/arty stubs

- [ ] **Step 29: Add sniper and arty cases to `get_targets`**

In `attack_pattern_registry.gd`, find the `get_targets` match block. Add before `_: return []`:

```gdscript
        "sniper", "force_recon_sniper":
            return _sniper_targets(enemy_cells, n)
        "artillery", "howitzer", "self_propelled_gun":
            return _artillery_area_targets(cell_index, enemy_cells, n)
```

Also add the same two cases inside `simulate_round`'s inner `match utype:` block (same placement, before the `_:` default).

- [ ] **Step 30: Add `_hp_fraction_for` cases for sniper and arty**

Find the `_hp_fraction_for` function (line ~160). Add before `_: return 0.30`:

```gdscript
        "sniper", "force_recon_sniper":
            return 0.80
        "artillery", "howitzer", "self_propelled_gun":
            return 0.65
```

- [ ] **Step 31: Add `_sniper_targets` helper function**

```gdscript
# Priority-based full-grid scan. Uses default priority list (perk overrides not available client-side).
# Ignores row/col position entirely.
static func _sniper_targets(cells: Array, n: int) -> Array[int]:
    const PRIORITY := ["sniper","force_recon_sniper","flamethrower","recon_infantry",
                       "mg","at_gun","at_gun_sp","at_infantry","commando","infantry"]
    var result: Array[int] = []
    for utype in PRIORITY:
        if n > 0 and result.size() >= n:
            break
        for i in range(cells.size()):
            if n > 0 and result.size() >= n:
                break
            var cell = cells[i]
            if cell.get("unit_type","") == utype and not cell.get("incapacitated",false):
                result.append(i)
    return result
```

- [ ] **Step 32: Add `_artillery_area_targets` helper function**

```gdscript
# Client-side arty preview: shows all occupied cells in the target area.
# Uses area_radius=0 (default, no perk awareness) and the cell_index column as center.
# This is a preview approximation — actual center_col is determined server-side by seeded RNG.
static func _artillery_area_targets(att_cell_index: int, cells: Array, n: int) -> Array[int]:
    # Default: show own column as potential target area (radius=0 approximation)
    var center_col := att_cell_index % 5
    var area_radius := 0  # TODO: pass researched area_radius from client state in Branch K
    var min_col := max(0, center_col - area_radius)
    var max_col := min(4, center_col + area_radius)
    var result: Array[int] = []
    for col in range(min_col, max_col + 1):
        for row in range(4, -1, -1):  # R5 first
            var idx := row * 5 + col
            var cell = cells[idx]
            if cell.get("unit_type","") != "" and not cell.get("incapacitated",false):
                result.append(idx)
                if n > 0 and result.size() >= n:
                    return result
    return result
```

---

## Verification

- [ ] **Step 33: All 6f tests GREEN**

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server
NODE_ENV=test npx mocha -r tsx test/6f-special-patterns.test.ts --exit --timeout 15000
```

- [ ] **Step 34: Regression — all prior test suites still GREEN**

```bash
NODE_ENV=test npx mocha -r tsx \
  test/6e-armour-patterns.test.ts \
  test/6d-infantry-patterns.test.ts \
  test/6c-combat-stats.test.ts \
  test/6a-grid-schema.test.ts \
  --exit --timeout 30000
```

- [ ] **Step 35: TypeScript clean**

```bash
npx tsc --noEmit
```

- [ ] **Step 36: Commit**

```bash
git add \
  game-server/test/6f-special-patterns.test.ts \
  game-server/src/types/perk_types.ts \
  game-server/src/data/perks.ts \
  game-server/src/data/combat_constants.ts \
  game-server/src/rooms/schema/GameRoomState.ts \
  game-server/src/systems/attack_patterns.ts \
  game-server/src/systems/combat_system.ts \
  client/src/ui/hud/attack_pattern_registry.gd
git commit -m "feat: sniper priority targeting, arty recon-weighted area attack, perk config system"
```

---

## Common Errors to Avoid

1. **`SpecialAttackConfig.rng_seed` and `recon_value` must NEVER appear in `PerkDefinition.attack_config`.** These are runtime values. If you add them to a perk, `resolveAttackConfig` will overwrite them and break determinism.

2. **`resolveAttackConfig` returns a MUTABLE COPY.** Always call it once per attacker cell, not once per engagement. Two cells of the same unit_type in the same engagement get the same config, but the copy must be separate so callers can set runtime fields without aliasing.

3. **`_applyPerCellDamage` has TWO loop variables named similarly — do not confuse them.** The outer loop is `for (const { cell: attCell, idx } of fireOrder)` — `idx` is the **attacker** cell index. The inner loop is `for (const tIdx of targets)` — `tIdx` is the **defender** cell index. The arty falloff lookup is `artyMultMap?.get(tIdx)` (defender), not `artyMultMap?.get(idx)` (attacker). Using `idx` silently returns `undefined` → fallback 1.0 → no falloff applied.

4. **`priority_list` in `resolveAttackConfig` defaults to a COPY of the default array.** Do not assign the `Readonly` constant directly — always spread or copy. Otherwise, a perk that replaces the list could corrupt the constant for other calls.

5. **`_sniperTargets` iterates priority list first, then scans all 25 cells for each type.** This is O(priority_list.length × 25) = at most O(10 × 25) = 250 operations — negligible. Do NOT try to build a type→indices map first; the simple nested loop is correct and fast enough.

6. **`_artilleryTargets` column weight at `recon_value=0` is `occupied_count` not `value_score`.** At zero recon, `colWeights[col] = (1 - 0) * occupied_count + 0 * value_score = occupied_count`. Columns with 3 units get weight 3; columns with 1 unit get weight 1. This is intentional — more units = larger target even at blind recon.

7. **LCG produces values in `[0, 0x100000000)` after `>>> 0`; divide by `0x100000000` (not `0xFFFFFFFF`) to get `[0, 1)`.** Using `0xFFFFFFFF` gives max value ~1.0000000002 which can cause the column selection loop to fall through and use the fallback `center_col = 4`.

8. **`DivisionState.recon_value` initialises to `0` (not undefined).** Code like `attacker.recon_value ?? 0` is a safety net, not the normal path. Do not assume it starts null.

9. **`state.nations` access pattern depends on the collection type** (MapSchema vs ArraySchema). Verify in Step 23 before writing the lookup in Step 26. Getting this wrong produces `undefined` perk IDs silently (perk-driven config falls back to defaults — not a crash, just wrong behavior).

10. **GDScript `_artillery_area_targets` is an APPROXIMATION.** It uses the attacker's own column as the center (no RNG) and defaults `area_radius=0`. The TODO comment is intentional — perk-accurate client preview requires the client to know the player's resolved attack configs, which is a Branch K concern.

11. **All TypeScript relative imports must end in `.js`:**
    - `import { ... } from "../types/perk_types.js";`
    - `import { resolveAttackConfig } from "../data/perks.js";`
    - Test file: `import { ... } from "../src/systems/attack_patterns.js";`
