import assert from "assert";
import { describe, it } from "mocha";
import { getAirUnitStats } from "../src/data/air_unit_stats.js";

describe("lane:air-combat | 12h — Per-type turn radius", () => {
  it("fighter has min_turn_radius_deg = 0.3", () => {
    assert.strictEqual(getAirUnitStats("fighter").min_turn_radius_deg, 0.30);
  });
  it("dive_bomber has min_turn_radius_deg = 0.4", () => {
    assert.strictEqual(getAirUnitStats("dive_bomber").min_turn_radius_deg, 0.40);
  });
  it("heavy_fighter has min_turn_radius_deg = 0.5", () => {
    assert.strictEqual(getAirUnitStats("heavy_fighter").min_turn_radius_deg, 0.50);
  });
  it("strategic_bomber has min_turn_radius_deg = 0.65", () => {
    assert.strictEqual(getAirUnitStats("strategic_bomber").min_turn_radius_deg, 0.65);
  });
  it("recon_plane has min_turn_radius_deg = 0.3", () => {
    assert.strictEqual(getAirUnitStats("recon_plane").min_turn_radius_deg, 0.30);
  });
});
