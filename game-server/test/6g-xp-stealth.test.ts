import assert from "assert";
import { describe, it } from "mocha";
import {
  getXpTier,
  getXpHpMult,
  getXpSuppResistMult,
  getXpReconMult,
  _computeXpRetention,
  _resolveStealthForRound,
} from "../src/systems/attack_patterns.js";
import { GridCellState } from "../src/rooms/schema/GameRoomState.js";

function makeCell(overrides: Partial<{
  unit_type: string; hp: number; xp_points: number; xp_pending: number;
  xp_tier: string; incapacitated: boolean; stealthed: boolean;
}> = {}): GridCellState {
  const c = new GridCellState();
  c.unit_type     = overrides.unit_type     ?? "";
  c.hp            = overrides.hp            ?? 100;
  c.xp_points     = overrides.xp_points     ?? 0;
  c.xp_pending    = overrides.xp_pending    ?? 0;
  c.xp_tier       = overrides.xp_tier       ?? "green";
  c.incapacitated = overrides.incapacitated ?? false;
  c.stealthed     = overrides.stealthed     ?? false;
  return c;
}

// ── getXpTier ─────────────────────────────────────────────────────────────

describe("6g — XP tier", function () {
  it("0 pts → green",    () => assert.strictEqual(getXpTier(0),    "green"));
  it("99 pts → green",   () => assert.strictEqual(getXpTier(99),   "green"));
  it("100 pts → seasoned",() => assert.strictEqual(getXpTier(100), "seasoned"));
  it("399 pts → seasoned",() => assert.strictEqual(getXpTier(399), "seasoned"));
  it("400 pts → veteran", () => assert.strictEqual(getXpTier(400), "veteran"));
  it("999 pts → veteran", () => assert.strictEqual(getXpTier(999), "veteran"));
  it("1000 pts → elite",  () => assert.strictEqual(getXpTier(1000),"elite"));
  it("9999 pts → elite",  () => assert.strictEqual(getXpTier(9999),"elite"));
});

// ── XP stat multipliers ───────────────────────────────────────────────────

describe("6g — XP stat multipliers", function () {
  it("getXpHpMult: green → 1.0",    () => assert.strictEqual(getXpHpMult(0),    1.0));
  it("getXpHpMult: seasoned → 1.10",() => assert.strictEqual(getXpHpMult(100),  1.10));
  it("getXpHpMult: veteran → 1.20", () => assert.strictEqual(getXpHpMult(400),  1.20));
  it("getXpHpMult: elite → 1.35",   () => assert.strictEqual(getXpHpMult(1000), 1.35));
  it("getXpHpMult: post-elite > 1.35 and < 1.45", () => {
    assert.ok(getXpHpMult(2000) > 1.35);
    assert.ok(getXpHpMult(2000) < 1.45);
  });

  it("getXpSuppResistMult: green → 1.0",    () => assert.strictEqual(getXpSuppResistMult(0),   1.0));
  it("getXpSuppResistMult: seasoned → 1.05",() => assert.strictEqual(getXpSuppResistMult(100), 1.05));
  it("getXpSuppResistMult: veteran → 1.15", () => assert.strictEqual(getXpSuppResistMult(400), 1.15));
  it("getXpSuppResistMult: elite → 1.25",   () => assert.strictEqual(getXpSuppResistMult(1000),1.25));

  it("getXpReconMult: green → 1.0",    () => assert.strictEqual(getXpReconMult(0),   1.0));
  it("getXpReconMult: seasoned → 1.10",() => assert.strictEqual(getXpReconMult(100), 1.10));
  it("getXpReconMult: veteran → 1.25", () => assert.strictEqual(getXpReconMult(400), 1.25));
  it("getXpReconMult: elite → 1.40",   () => assert.strictEqual(getXpReconMult(1000),1.40));
});

// ── _computeXpRetention ───────────────────────────────────────────────────
// _computeXpRetention(hp_ratio, is_incap, div_won, incap_ret, damaged_ret) → mult

describe("6g — XP retention", function () {
  it("HP > 0.5, healthy → 1.0",
    () => assert.strictEqual(_computeXpRetention(0.8,  false, true,  0.4, 0.6), 1.0));
  it("HP = 0.51 → 1.0",
    () => assert.strictEqual(_computeXpRetention(0.51, false, true,  0.4, 0.6), 1.0));
  it("HP = 0.5 (damaged) → 0.6",
    () => assert.strictEqual(_computeXpRetention(0.5,  false, true,  0.4, 0.6), 0.6));
  it("HP = 0.3 (damaged) → 0.6",
    () => assert.strictEqual(_computeXpRetention(0.3,  false, true,  0.4, 0.6), 0.6));
  it("incapacitated + division won → 0.4",
    () => assert.strictEqual(_computeXpRetention(0.15, true,  true,  0.4, 0.6), 0.4));
  it("incapacitated + division lost → 0.0",
    () => assert.strictEqual(_computeXpRetention(0.15, true,  false, 0.4, 0.6), 0.0));
  it("perk raises incap_ret to 0.55",
    () => assert.strictEqual(_computeXpRetention(0.15, true,  true,  0.55, 0.6), 0.55));
  it("perk raises damaged_ret to 0.75",
    () => assert.strictEqual(_computeXpRetention(0.3,  false, true,  0.4, 0.75), 0.75));
});

// ── _resolveStealthForRound ───────────────────────────────────────────────
// _resolveStealthForRound(cells, max_enemy_anti, effective_stealths) — mutates stealthed

describe("6g — stealth resolution", function () {
  it("stealth=0 → not stealthed (even with max_enemy_anti=0)", () => {
    const cells = [makeCell({ unit_type: "infantry" })];
    _resolveStealthForRound(cells, 0, [0]);
    assert.strictEqual(cells[0].stealthed, false);
  });

  it("stealth=2, max_anti=0 → stealthed", () => {
    const cells = [makeCell({ unit_type: "sniper" })];
    _resolveStealthForRound(cells, 0, [2]);
    assert.strictEqual(cells[0].stealthed, true);
  });

  it("stealth=2, max_anti=1 → stealthed (anti < stealth)", () => {
    const cells = [makeCell({ unit_type: "sniper" })];
    _resolveStealthForRound(cells, 1, [2]);
    assert.strictEqual(cells[0].stealthed, true);
  });

  it("stealth=2, max_anti=2 → REVEALED (anti >= stealth)", () => {
    const cells = [makeCell({ unit_type: "sniper" })];
    _resolveStealthForRound(cells, 2, [2]);
    assert.strictEqual(cells[0].stealthed, false);
  });

  it("stealth=2, max_anti=3 → REVEALED", () => {
    const cells = [makeCell({ unit_type: "sniper" })];
    _resolveStealthForRound(cells, 3, [2]);
    assert.strictEqual(cells[0].stealthed, false);
  });

  it("incapacitated cell → never stealthed", () => {
    const cells = [makeCell({ unit_type: "sniper", incapacitated: true })];
    _resolveStealthForRound(cells, 0, [2]);
    assert.strictEqual(cells[0].stealthed, false);
  });

  it("empty cell → never stealthed", () => {
    const cells = [makeCell({ unit_type: "" })];
    _resolveStealthForRound(cells, 0, [2]);
    assert.strictEqual(cells[0].stealthed, false);
  });

  it("25-cell grid — only sniper at index 22 stealthed, infantry not", () => {
    const cells = Array.from({ length: 25 }, (_, i) => {
      if (i === 22) return makeCell({ unit_type: "sniper" });
      if (i === 20) return makeCell({ unit_type: "infantry" });
      return makeCell();
    });
    const stealths = cells.map((_, i) => (i === 22 ? 2 : 0));
    _resolveStealthForRound(cells, 0, stealths);
    assert.strictEqual(cells[22].stealthed, true);
    assert.strictEqual(cells[20].stealthed, false);
  });
});
