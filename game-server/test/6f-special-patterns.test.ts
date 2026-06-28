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
