import { describe, it } from "mocha";
import assert from "assert";
import {
  getRowPerkModifiers,
  ROW_PERK_SUPP_DEALT_MULT,
  ROW_PERK_HP_DEALT_MULT,
  ROW_PERK_SUPP_RESIST,
  ROW_PERK_DECAY_MULT,
} from "../src/systems/row_perk_system.js";

describe("row-perk-system — unit tests", () => {

  it("VANGUARD (row 4): supp_dealt_mult > 1, hp/resist/decay all identity", () => {
    const m = getRowPerkModifiers(4);
    assert.strictEqual(m.supp_dealt_mult, ROW_PERK_SUPP_DEALT_MULT);
    assert.strictEqual(m.hp_dealt_mult,   1.0);
    assert.strictEqual(m.supp_resist_mult, 1.0);
    assert.strictEqual(m.supp_decay_mult,  1.0);
  });

  it("ASSAULT (row 3): hp_dealt_mult > 1, others identity", () => {
    const m = getRowPerkModifiers(3);
    assert.strictEqual(m.hp_dealt_mult,    ROW_PERK_HP_DEALT_MULT);
    assert.strictEqual(m.supp_dealt_mult,  1.0);
    assert.strictEqual(m.supp_resist_mult, 1.0);
    assert.strictEqual(m.supp_decay_mult,  1.0);
  });

  it("SUPPORT (row 2): supp_resist_mult < 1 (defender receives less supp), others identity", () => {
    const m = getRowPerkModifiers(2);
    assert.strictEqual(m.supp_resist_mult, ROW_PERK_SUPP_RESIST);
    assert.ok(m.supp_resist_mult < 1.0, "SUPPORT resist mult must be < 1");
    assert.strictEqual(m.supp_dealt_mult,  1.0);
    assert.strictEqual(m.hp_dealt_mult,    1.0);
    assert.strictEqual(m.supp_decay_mult,  1.0);
  });

  it("RESERVE (row 1): supp_decay_mult > 1, others identity", () => {
    const m = getRowPerkModifiers(1);
    assert.strictEqual(m.supp_decay_mult,  ROW_PERK_DECAY_MULT);
    assert.strictEqual(m.supp_dealt_mult,  1.0);
    assert.strictEqual(m.hp_dealt_mult,    1.0);
    assert.strictEqual(m.supp_resist_mult, 1.0);
  });

  it("REAR (row 0): all identity (no bonus)", () => {
    const m = getRowPerkModifiers(0);
    assert.strictEqual(m.supp_dealt_mult,  1.0);
    assert.strictEqual(m.hp_dealt_mult,    1.0);
    assert.strictEqual(m.supp_resist_mult, 1.0);
    assert.strictEqual(m.supp_decay_mult,  1.0);
  });

  it("out-of-range row (e.g. -1, 5) returns identity", () => {
    for (const row of [-1, 5, 99]) {
      const m = getRowPerkModifiers(row);
      assert.strictEqual(m.supp_dealt_mult,  1.0, `row ${row} supp_dealt should be 1`);
      assert.strictEqual(m.hp_dealt_mult,    1.0, `row ${row} hp_dealt should be 1`);
      assert.strictEqual(m.supp_resist_mult, 1.0, `row ${row} supp_resist should be 1`);
      assert.strictEqual(m.supp_decay_mult,  1.0, `row ${row} decay should be 1`);
    }
  });

  it("cell_index helper: correct logical_row for boundary cells", () => {
    // Test that Math.floor(cell_index / 5) gives the right row
    assert.strictEqual(Math.floor(0  / 5), 0);  // REAR first cell
    assert.strictEqual(Math.floor(4  / 5), 0);  // REAR last cell
    assert.strictEqual(Math.floor(5  / 5), 1);  // RESERVE first cell
    assert.strictEqual(Math.floor(19 / 5), 3);  // ASSAULT last cell
    assert.strictEqual(Math.floor(20 / 5), 4);  // VANGUARD first cell
    assert.strictEqual(Math.floor(24 / 5), 4);  // VANGUARD last cell
  });
});
