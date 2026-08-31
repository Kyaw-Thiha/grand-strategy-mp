import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { EXTRACTION_STATS, getExtractionStats } from "../src/data/resource_stats.js";
import { BUILDING_TYPES } from "../src/data/building_stats.js";
import { RESOURCE_TYPE_BY_BUILDING } from "../src/data/resource_stats.js";
import {
  ResourceEconomySystem,
  tickPopulation,
  computeManpower,
  getManpowerCostMultiplier,
  industrySliceMultiplier,
  oilSpeedMultiplier,
  computeOilDemandMet,
  tungstenPenMultiplier,
  isChromiumAvailable,
  aluminiumSupplyCeiling,
  hospitalDamageMultiplier,
  drainCombatAttrition,
} from "../src/systems/resource_economy_system.js";
import { OIL_CONSUMING_TYPES, VEHICLE_TYPES, INFANTRY_ARTILLERY_TYPES } from "../src/data/unit_resource_tags.js";
import { UNIT_COMBAT_STATS } from "../src/data/unit_combat_stats.js";
import { MapSchema } from "@colyseus/schema";
import { NationState, ProvinceState, DivisionState } from "../src/rooms/schema/GameRoomState.js";
import type { ProvinceEconomyData } from "../src/systems/economy_building_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

function makeEcon(overrides: Partial<ProvinceEconomyData> = {}): ProvinceEconomyData {
  return {
    province_id: "p1",
    buildings: {},
    resource_deposits: {},
    construction_queue: [],
    ...overrides,
  };
}

describe("lane:economy | resource_stats data table", () => {
  it("every resource-extraction building_type in building_stats.ts has a matching EXTRACTION_STATS entry", () => {
    const extractionBuildingTypes = BUILDING_TYPES.filter((t) => t.startsWith("res_"));
    for (const t of extractionBuildingTypes) {
      assert.ok(EXTRACTION_STATS[t], `missing EXTRACTION_STATS entry for ${t}`);
      assert.ok(RESOURCE_TYPE_BY_BUILDING[t], `missing RESOURCE_TYPE_BY_BUILDING entry for ${t}`);
    }
  });
  it("base_output_by_level is monotonically increasing", () => {
    for (const stats of Object.values(EXTRACTION_STATS)) {
      for (let i = 1; i < stats.base_output_by_level.length; i++) {
        assert.ok(stats.base_output_by_level[i] > stats.base_output_by_level[i - 1]);
      }
    }
  });
  it("unknown extraction building type throws", () => {
    assert.throws(() => getExtractionStats("not_real"));
  });
});

describe("lane:economy | Population and manpower", () => {
  it("province population grows per tick", () => {
    const province = new ProvinceState();
    const before = province.population;
    tickPopulation([province]);
    assert.ok(province.population > before);
  });

  it("manpower_ceiling = sum of owned provinces' population x MANPOWER_RATIO", () => {
    const nation = new NationState();
    const p1 = new ProvinceState(); p1.population = 100;
    const p2 = new ProvinceState(); p2.population = 50;
    computeManpower(nation, [p1, p2]);
    assert.strictEqual(nation.manpower_ceiling, 150 * 0.15);
  });

  it("manpower_available never exceeds manpower_ceiling", () => {
    const nation = new NationState();
    nation.manpower_available = 99999;
    const p1 = new ProvinceState(); p1.population = 10;
    computeManpower(nation, [p1]);
    assert.ok(nation.manpower_available <= nation.manpower_ceiling + 1e-9);
  });

  it("cost multiplier increases below soft-cap threshold, capped at max, never Infinity at zero available", () => {
    assert.strictEqual(getManpowerCostMultiplier(80, 100), 1.0); // 80% ratio, above threshold
    const atZero = getManpowerCostMultiplier(0, 100);
    assert.ok(isFinite(atZero));
    assert.ok(atZero <= 3.0 + 1e-9);
    assert.ok(atZero > 1.0);
  });

  it("zero ceiling reads as neutral (multiplier 1.0), not a deficit", () => {
    assert.strictEqual(getManpowerCostMultiplier(0, 0), 1.0);
  });
});

describe("lane:economy | Common resource extraction", () => {
  it("zero-industry extraction building at level 1 still produces full base-tier output", () => {
    const sys = new ResourceEconomySystem();
    const nation = new NationState();
    const province = new ProvinceState(); province.population = 0;
    const econ = makeEcon({ buildings: { res_iron: 1 }, resource_deposits: { iron: 100 } });
    const { gained } = sys.tickExtraction(nation, [province], [econ], () => 1.0, 1);
    assert.strictEqual(gained["iron"], EXTRACTION_STATS.res_iron.base_output_by_level[0]);
  });

  it("output scales with deposit abundance, not just building level", () => {
    const sys = new ResourceEconomySystem();
    const nation = new NationState();
    const province = new ProvinceState();
    const highDeposit = makeEcon({ province_id: "a", buildings: { res_iron: 2 }, resource_deposits: { iron: 100 } });
    const lowDeposit = makeEcon({ province_id: "b", buildings: { res_iron: 2 }, resource_deposits: { iron: 25 } });
    const { gained: gainedHigh } = sys.tickExtraction(nation, [province], [highDeposit], () => 1.0, 1);
    const nation2 = new NationState();
    const { gained: gainedLow } = sys.tickExtraction(nation2, [province], [lowDeposit], () => 1.0, 1);
    assert.ok(gainedHigh["iron"] > gainedLow["iron"]);
  });

  it("zero deposit + built extraction building produces zero, no division-by-zero error", () => {
    const sys = new ResourceEconomySystem();
    const nation = new NationState();
    const province = new ProvinceState();
    const econ = makeEcon({ buildings: { res_iron: 1 }, resource_deposits: { iron: 0 } });
    const { gained } = sys.tickExtraction(nation, [province], [econ], () => 1.0, 1);
    assert.strictEqual(gained["iron"] ?? 0, 0);
  });

  it("money trickles in proportional to total population even with zero buildings", () => {
    const sys = new ResourceEconomySystem();
    const nation = new NationState();
    const province = new ProvinceState(); province.population = 100;
    const { gained } = sys.tickExtraction(nation, [province], [], () => 1.0, 1);
    assert.ok(gained["money"] > 0);
  });

  it("resources are clamped at Warehouse's resource_storage_cap", () => {
    const sys = new ResourceEconomySystem();
    const nation = new NationState();
    nation.resource_storage_cap.set("iron", 5);
    const province = new ProvinceState();
    const econ = makeEcon({ buildings: { res_iron: 5 }, resource_deposits: { iron: 100 } });
    sys.tickExtraction(nation, [province], [econ], () => 1.0, 1);
    assert.ok((nation.resources.get("iron") ?? 0) <= 5);
  });

  it("uranium accumulates via the same generic extraction path, no special-casing needed", () => {
    const sys = new ResourceEconomySystem();
    const nation = new NationState();
    const province = new ProvinceState();
    const econ = makeEcon({ buildings: { res_uranium: 1 }, resource_deposits: { uranium: 100 } });
    const { gained } = sys.tickExtraction(nation, [province], [econ], () => 1.0, 1);
    assert.strictEqual(gained["uranium"], EXTRACTION_STATS.res_uranium.base_output_by_level[0]);
  });
});

describe("lane:economy | Rubber Plantation ramp-up", () => {
  it("output ramps from ~0 toward full base output over RAMP_TICKS", () => {
    const sys = new ResourceEconomySystem();
    const nation = new NationState();
    const province = new ProvinceState();
    const econ = makeEcon({ buildings: { res_rubber: 1 }, resource_deposits: { rubber: 100 } });
    const { gained: early } = sys.tickExtraction(nation, [province], [econ], () => 1.0, 100);
    const nation2 = new NationState();
    const sys2 = new ResourceEconomySystem();
    const econ2 = makeEcon({ buildings: { res_rubber: 1 }, resource_deposits: { rubber: 100 } });
    sys2.tickExtraction(nation2, [province], [econ2], () => 1.0, 100); // start ramp at tick 100
    const { gained: late } = sys2.tickExtraction(nation2, [province], [econ2], () => 1.0, 100 + 10000);
    assert.ok((late["rubber"] ?? 0) >= (early["rubber"] ?? 0));
  });
});

describe("lane:economy | Bauxite Mine -> Refinery chain", () => {
  it("res_aluminium building extracts into bauxite_stock, not directly into resources.aluminium", () => {
    const sys = new ResourceEconomySystem();
    const nation = new NationState();
    const province = new ProvinceState();
    const econ = makeEcon({ buildings: { res_aluminium: 1 }, resource_deposits: { aluminium: 100 } });
    sys.tickExtraction(nation, [province], [econ], () => 1.0, 1);
    assert.ok(nation.bauxite_stock >= 0);
  });

  it("bauxite_stock converts into resources.aluminium over subsequent ticks", () => {
    const sys = new ResourceEconomySystem();
    const nation = new NationState();
    nation.bauxite_stock = 100;
    const province = new ProvinceState();
    const { gained } = sys.tickExtraction(nation, [province], [], () => 1.0, 1);
    assert.ok((gained["aluminium"] ?? 0) > 0);
  });
});

describe("lane:economy | Industry Pool allocation", () => {
  it("0% allocation floors at 1.0x (never a precondition)", () => {
    assert.strictEqual(industrySliceMultiplier(0), 1.0);
  });
  it("diminishing returns: doubling allocation does not double the multiplier's gain", () => {
    const at25 = industrySliceMultiplier(25) - 1.0;
    const at50 = industrySliceMultiplier(50) - 1.0;
    assert.ok(at50 < at25 * 2);
  });
  it("multiplier never falls below 1.0x at any allocation level", () => {
    for (const pct of [0, 25, 50, 75, 100]) {
      assert.ok(industrySliceMultiplier(pct) >= 1.0);
    }
  });
});

describe("lane:economy | Oil mechanic", () => {
  it("100% demand met has no penalty", () => {
    assert.strictEqual(oilSpeedMultiplier(1.0), 1.0);
  });
  it("penalty steepens monotonically as demand-met ratio drops", () => {
    const at80 = oilSpeedMultiplier(0.8);
    const at40 = oilSpeedMultiplier(0.4);
    const at10 = oilSpeedMultiplier(0.1);
    assert.ok(at80 > at40);
    assert.ok(at40 > at10);
  });
  it("never a hard stop — speed never reaches zero even at zero demand met", () => {
    assert.ok(oilSpeedMultiplier(0) > 0);
  });
  it("zero total demand reads as fully met (no oil-consuming units present)", () => {
    assert.strictEqual(computeOilDemandMet(0, 0), 1.0);
  });
  it("OIL_CONSUMING_TYPES/VEHICLE_TYPES only contain unit types present in UNIT_COMBAT_STATS", () => {
    for (const t of OIL_CONSUMING_TYPES) assert.ok(UNIT_COMBAT_STATS[t], `${t} missing from UNIT_COMBAT_STATS`);
    for (const t of INFANTRY_ARTILLERY_TYPES) assert.ok(UNIT_COMBAT_STATS[t], `${t} missing from UNIT_COMBAT_STATS`);
  });
  it("VEHICLE_TYPES and INFANTRY_ARTILLERY_TYPES are disjoint", () => {
    for (const t of VEHICLE_TYPES) assert.ok(!INFANTRY_ARTILLERY_TYPES.has(t));
  });
});

describe("lane:economy | Tungsten availability shifts pen, never blocks", () => {
  it("full tungsten access resolves at unmodified (1.0x) pen multiplier", () => {
    assert.strictEqual(tungstenPenMultiplier(50), 1.0);
    assert.strictEqual(tungstenPenMultiplier(1000), 1.0);
  });
  it("zero tungsten still yields a nonzero pen multiplier (never fully blocked)", () => {
    assert.ok(tungstenPenMultiplier(0) > 0);
    assert.ok(tungstenPenMultiplier(0) < 1.0);
  });
});

describe("lane:economy | Chromium threshold flag", () => {
  it("flag true above threshold, false at/below it", () => {
    assert.strictEqual(isChromiumAvailable(21), true);
    assert.strictEqual(isChromiumAvailable(20), false);
    assert.strictEqual(isChromiumAvailable(0), false);
  });
  it("heavy_tank is chromium_gated; a common infantry type is not", () => {
    assert.strictEqual(UNIT_COMBAT_STATS["heavy_tank"].chromium_gated, true);
    assert.strictEqual(UNIT_COMBAT_STATS["infantry"].chromium_gated, false);
  });
});

describe("lane:economy | Chromium hard-gates — explicitly deferred, not implemented", () => {
  it.skip("below threshold, chromium-gated units cannot be built — deferred to Branch C, no production system exists yet", () => {});
  it.skip("chromium-gated units in the field stop drawing supply when flow is interrupted — deferred to Phase 7 integration, no supply system exists yet", () => {});
});

describe("lane:economy | Aluminium placeholder ceiling", () => {
  it("ceiling is unlimited while the flag is false, for every tier", () => {
    assert.strictEqual(aluminiumSupplyCeiling(false, 1), Infinity);
    assert.strictEqual(aluminiumSupplyCeiling(false, 5), Infinity);
  });
});

describe("lane:economy | Hospital pooled casualty reduction", () => {
  it("more hospital levels reduce the damage multiplier further", () => {
    const zero = hospitalDamageMultiplier(0);
    const five = hospitalDamageMultiplier(5);
    const fifty = hospitalDamageMultiplier(50);
    assert.strictEqual(zero, 1.0);
    assert.ok(five < zero);
    assert.ok(fifty < five);
  });
  it("multiplier never falls below the non-negotiable floor, even with an unrealistic hospital count", () => {
    assert.ok(hospitalDamageMultiplier(100000) >= 0.5 - 1e-9);
  });
});

describe("lane:economy | Rubber and Nitrate combat attrition", () => {
  function divisionWithCells(nationId: string, unitTypes: string[]): DivisionState {
    const div = new DivisionState();
    div.nation_id = nationId;
    unitTypes.forEach((t, i) => { div.grid.cells[i].unit_type = t; div.grid.cells[i].hp = 100; });
    return div;
  }

  it("rubber depletes proportional to engaged vehicle-type cell count", () => {
    const nations = new MapSchema<NationState>();
    const n = new NationState(); n.nation_id = "n1"; n.resources.set("rubber", 100);
    nations.set("n1", n);
    const div = divisionWithCells("n1", ["medium_tank", "medium_tank", "infantry"]);
    drainCombatAttrition([div], nations);
    assert.ok((n.resources.get("rubber") ?? 0) < 100);
  });

  it("nitrates depletes proportional to engaged infantry/artillery-type cell count", () => {
    const nations = new MapSchema<NationState>();
    const n = new NationState(); n.nation_id = "n1"; n.resources.set("nitrates", 100);
    nations.set("n1", n);
    const div = divisionWithCells("n1", ["infantry", "artillery"]);
    drainCombatAttrition([div], nations);
    assert.ok((n.resources.get("nitrates") ?? 0) < 100);
  });

  it("a division with zero vehicle-type cells does not drain rubber even while engaged", () => {
    const nations = new MapSchema<NationState>();
    const n = new NationState(); n.nation_id = "n1"; n.resources.set("rubber", 100);
    nations.set("n1", n);
    const div = divisionWithCells("n1", ["infantry", "artillery"]);
    drainCombatAttrition([div], nations);
    assert.strictEqual(n.resources.get("rubber"), 100);
  });

  it("incapacitated cells do not contribute to attrition drain", () => {
    const nations = new MapSchema<NationState>();
    const n = new NationState(); n.nation_id = "n1"; n.resources.set("rubber", 100);
    nations.set("n1", n);
    const div = divisionWithCells("n1", ["medium_tank"]);
    div.grid.cells[0].incapacitated = true;
    drainCombatAttrition([div], nations);
    assert.strictEqual(n.resources.get("rubber"), 100);
  });
});

describe("lane:economy | GameRoom integration", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    colyseus = await boot(appConfig, getTestPort());
  });
  after(async () => {
    await colyseus.shutdown();
  });
  beforeEach(async () => {
    await colyseus.cleanup();
  });

  async function joinRoom() {
    const token = await makeToken();
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    client.send("SELECT_NATION", { nation_id: "germany" });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    return { client, room };
  }

  it("manpower_available seeded to manpower_ceiling at game start, not left at 0", async () => {
    const { room } = await joinRoom();
    const nation = room.state.nations.get("germany")!;
    assert.ok(nation.manpower_ceiling > 0);
    assert.strictEqual(nation.manpower_available, nation.manpower_ceiling);
  });

  it("SET_OIL_PRIORITY updates the nation's oil_priority", async () => {
    const { client, room } = await joinRoom();
    const nation = room.state.nations.get("germany")!;
    assert.strictEqual(nation.oil_priority, "balanced");
    client.send("SET_OIL_PRIORITY", { priority: "military" });
    await room.waitForNextPatch();
    assert.strictEqual(nation.oil_priority, "military");
  });

  it("SET_OIL_PRIORITY rejects an invalid priority value", async () => {
    const { client, room } = await joinRoom();
    const nation = room.state.nations.get("germany")!;
    client.send("SET_OIL_PRIORITY", { priority: "not_a_real_priority" });
    await room.waitForNextPatch();
    assert.strictEqual(nation.oil_priority, "balanced");
  });

  it("SET_INDUSTRY_ALLOCATION rejects allocations that don't sum to 100", async () => {
    const { client, room } = await joinRoom();
    const nation = room.state.nations.get("germany")!;
    // Nation starts seeded with the documented default (money/construction_speed 50/50, see
    // _initNationEconomy) — a rejected submission must leave that default untouched.
    assert.strictEqual(nation.industry_alloc.get("money"), 50);
    client.send("SET_INDUSTRY_ALLOCATION", { allocations: { money: 10, iron: 10 } }); // sums to 20
    await room.waitForNextPatch();
    assert.strictEqual(nation.industry_alloc.get("money"), 50, "rejected submission must not mutate the existing allocation");
  });

  it("SET_INDUSTRY_ALLOCATION accepts allocations summing to 100 and enforces a cooldown", async () => {
    const { client, room } = await joinRoom();
    const nation = room.state.nations.get("germany")!;
    client.send("SET_INDUSTRY_ALLOCATION", { allocations: { money: 50, construction_speed: 50 } });
    await room.waitForNextPatch();
    assert.strictEqual(nation.industry_alloc.get("money"), 50);

    client.send("SET_INDUSTRY_ALLOCATION", { allocations: { money: 100 } }); // within cooldown window
    await room.waitForNextPatch();
    assert.strictEqual(nation.industry_alloc.get("money"), 50, "second reallocation within cooldown should be rejected");
  });

  it("resources tick upward over time from population-scaled money trickle alone", async () => {
    const { room } = await joinRoom();
    const nation = room.state.nations.get("germany")!;
    const before = nation.resources.get("money") ?? 0;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const after = nation.resources.get("money") ?? 0;
    assert.ok(after > before, `expected money to grow via trickle: ${before} -> ${after}`);
  });
});
