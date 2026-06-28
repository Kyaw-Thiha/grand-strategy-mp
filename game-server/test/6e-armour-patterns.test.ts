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
