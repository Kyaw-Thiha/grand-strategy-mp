import assert from "assert";
import { describe, it } from "mocha";
import { getUnitProductionStats, UNIT_PRODUCTION_STATS, PRODUCTION_BUILDING_TYPES } from "../src/data/unit_production_stats.js";
import { getBuildingStats, BUILDING_TYPES } from "../src/data/building_stats.js";
import { UnitType } from "../src/types/tactical_types.js";
import { AIR_UNIT_TYPES } from "../src/rooms/schema/AirWingState.js";

describe("lane:economy | Unit production stats", () => {
  it("every non-empty UnitType has a build_points entry", () => {
    for (const unitType of Object.values(UnitType)) {
      if (unitType === "") continue;
      assert.ok(UNIT_PRODUCTION_STATS[unitType], `missing entry for ${unitType}`);
    }
  });

  it("every AIR_UNIT_TYPES value has a build_points entry, produced_by aircraft_factory", () => {
    for (const airType of Object.values(AIR_UNIT_TYPES)) {
      const stats = getUnitProductionStats(airType);
      assert.strictEqual(stats.produced_by, "aircraft_factory");
    }
  });

  it("heavy_tank has higher build_points than light_tank", () => {
    assert.ok(
      getUnitProductionStats(UnitType.HEAVY_TANK).build_points >
      getUnitProductionStats(UnitType.LIGHT_TANK).build_points,
    );
  });

  it("unknown unit type throws, not silently returns a default", () => {
    assert.throws(() => getUnitProductionStats("not_a_real_unit"));
  });

  it("produced_by groups match ECONOMY_BUILDINGS.md's taxonomy", () => {
    assert.strictEqual(getUnitProductionStats(UnitType.INFANTRY).produced_by, "barracks");
    assert.strictEqual(getUnitProductionStats(UnitType.AT_INFANTRY).produced_by, "barracks");
    assert.strictEqual(getUnitProductionStats(UnitType.MOTORISED_INF).produced_by, "barracks");
    assert.strictEqual(getUnitProductionStats(UnitType.MEDIUM_TANK).produced_by, "tank_plant");
    assert.strictEqual(getUnitProductionStats(UnitType.ARMOURED_CAR).produced_by, "tank_plant");
    assert.strictEqual(getUnitProductionStats(UnitType.MECHANISED_INF).produced_by, "tank_plant");
    assert.strictEqual(getUnitProductionStats(UnitType.ARTILLERY).produced_by, "ordnance_factory");
    assert.strictEqual(getUnitProductionStats(UnitType.AT_GUN).produced_by, "ordnance_factory");
  });
});

describe("lane:economy | base_rate_by_level for production buildings", () => {
  it("all 4 production building types have a 5-value monotonically increasing base_rate_by_level", () => {
    for (const bt of PRODUCTION_BUILDING_TYPES) {
      const rates = getBuildingStats(bt).base_rate_by_level;
      assert.ok(rates, `${bt} missing base_rate_by_level`);
      assert.strictEqual(rates!.length, 5);
      for (let i = 1; i < rates!.length; i++) assert.ok(rates![i] > rates![i - 1]);
    }
  });

  it("non-production building types have no base_rate_by_level", () => {
    const nonProduction = BUILDING_TYPES.find((t) => !PRODUCTION_BUILDING_TYPES.includes(t));
    assert.ok(nonProduction, "expected at least one non-production building type");
    assert.strictEqual(getBuildingStats(nonProduction!).base_rate_by_level, undefined);
  });
});
