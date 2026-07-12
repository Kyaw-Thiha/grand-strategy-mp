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

describe("lane:tactical | 6d — Infantry attack patterns", function () {

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
    // supp_fraction is lower in round 1 — charge trades suppression for HP damage
    assert.ok(r1.supp_fraction < r2.supp_fraction);
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
    // Infantry (priority in R3); MG (non-priority in R5)
    // With priority=["infantry"], the R3 infantry fires before the R5 MG.
    // If R3 clears R5, MG redirects to R4.
    const attackers = makeGrid({ 10: "infantry", 22: "mg" });
    const enemy     = makeGrid({ 20: "infantry", 15: "mg" });
    enemy[20].hp    = 1; // critically low — first hit incapacitates
    const result    = simulateRound(attackers, enemy, 1, ["infantry"], Infinity);
    // infantry (idx10, priority) fires first → clears enemy R5
    // mg (idx22) fires second → R5 empty → redirects to R4 → hits enemy[15]
    assert.ok(result.get(10)!.includes(20), "priority infantry hits R5 enemy[20]");
    assert.ok(result.get(22)!.includes(15), "non-priority MG redirects to R4 after infantry clears R5");
    assert.ok(!result.get(22)!.includes(20), "non-priority MG does NOT target cleared R5");
  });
});
