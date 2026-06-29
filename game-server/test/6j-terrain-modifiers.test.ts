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
