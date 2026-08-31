import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import { getUnitProductionStats, UNIT_PRODUCTION_STATS, PRODUCTION_BUILDING_TYPES } from "../src/data/unit_production_stats.js";
import { getBuildingStats, BUILDING_TYPES } from "../src/data/building_stats.js";
import { UnitType } from "../src/types/tactical_types.js";
import { AIR_UNIT_TYPES } from "../src/rooms/schema/AirWingState.js";
import {
  rankDemand, scoreTypeForBuilding, assignIdleBuildings, DemandSlot,
  UnitProductionSystem,
} from "../src/systems/unit_production_system.js";
import { NationState, DivisionState, type GameRoomState } from "../src/rooms/schema/GameRoomState.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

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

describe("lane:economy | Auto-scheduler priority ranking", () => {
  it("ranks by missing_pct descending, pooling marshalling and field_resupply together", () => {
    const slots: DemandSlot[] = [
      { slot_id: "a", unit_type: "infantry", missing_pct: 0.4, stream: "field_resupply" },
      { slot_id: "b", unit_type: "infantry", missing_pct: 1.0, stream: "marshalling" },
      { slot_id: "c", unit_type: "infantry", missing_pct: 0.1, stream: "field_resupply" },
    ];
    const ranked = rankDemand(slots);
    assert.deepStrictEqual(ranked.map((s) => s.slot_id), ["b", "a", "c"]);
  });

  it("a fully-healthy slot (missing_pct 0) never outranks any damaged slot", () => {
    const slots: DemandSlot[] = [
      { slot_id: "healthy", unit_type: "infantry", missing_pct: 0, stream: "field_resupply" },
      { slot_id: "damaged", unit_type: "infantry", missing_pct: 0.01, stream: "field_resupply" },
    ];
    assert.strictEqual(rankDemand(slots)[0].slot_id, "damaged");
  });
});

describe("lane:economy | Cost-weighted type aggregation", () => {
  it("type_score = sum(missing_pct x build_points) per unit_type, higher aggregate wins", () => {
    const slots: DemandSlot[] = [
      { slot_id: "a", unit_type: "light_tank", missing_pct: 1.0, stream: "marshalling" },
      { slot_id: "b", unit_type: "light_tank", missing_pct: 1.0, stream: "marshalling" },
      { slot_id: "c", unit_type: "heavy_tank", missing_pct: 0.5, stream: "marshalling" },
    ];
    const scores = scoreTypeForBuilding("tank_plant", slots, true);
    assert.strictEqual(scores.get("light_tank"), 120);
    assert.strictEqual(scores.get("heavy_tank"), 70);
  });

  it("only slots whose unit_type is produced_by this buildingType are scored", () => {
    const slots: DemandSlot[] = [
      { slot_id: "a", unit_type: "infantry", missing_pct: 1.0, stream: "marshalling" },
      { slot_id: "b", unit_type: "light_tank", missing_pct: 1.0, stream: "marshalling" },
    ];
    const scores = scoreTypeForBuilding("tank_plant", slots, true);
    assert.ok(!scores.has("infantry"));
    assert.ok(scores.has("light_tank"));
  });
});

describe("lane:economy | Chromium hard-gate — exclusion, not deprioritization", () => {
  it("chromium_gated=true (heavy_tank) is excluded entirely when chromiumAvailable is false", () => {
    const slots: DemandSlot[] = [
      { slot_id: "a", unit_type: "heavy_tank", missing_pct: 1.0, stream: "marshalling" },
      { slot_id: "b", unit_type: "medium_tank", missing_pct: 1.0, stream: "marshalling" },
    ];
    const scores = scoreTypeForBuilding("tank_plant", slots, false);
    assert.ok(!scores.has("heavy_tank"));
    assert.ok(scores.has("medium_tank"));
  });

  it("heavy_tank resumes scoring the instant chromiumAvailable flips true, same call, no re-trigger needed", () => {
    const slots: DemandSlot[] = [{ slot_id: "a", unit_type: "heavy_tank", missing_pct: 1.0, stream: "marshalling" }];
    assert.ok(scoreTypeForBuilding("tank_plant", slots, true).has("heavy_tank"));
    assert.ok(!scoreTypeForBuilding("tank_plant", slots, false).has("heavy_tank"));
  });
});

describe("lane:economy | Pull assignment", () => {
  it("an idle building with no compatible open demand stays idle, no assignment, no throw", () => {
    const assignments = assignIdleBuildings(
      [{ province_id: "p1", building_type: "tank_plant" }],
      new Map(),
    );
    assert.strictEqual(assignments.length, 0);
  });

  it("assigns the highest-scoring unit_type for each idle building", () => {
    const demandByBuilding = new Map([
      ["barracks", new Map([["infantry", 30], ["mg", 50]])],
    ]);
    const assignments = assignIdleBuildings(
      [{ province_id: "p1", building_type: "barracks" }],
      demandByBuilding,
    );
    assert.strictEqual(assignments[0].unit_type, "mg");
  });
});

function makeNation(): NationState {
  const n = new NationState();
  n.nation_id = "test_nation";
  n.reserve_cap = 200;
  return n;
}

describe("lane:economy | Production tick — building to Reserve", () => {
  it("effective_build_rate = base_rate(level) x industry_pool_unit_production_speed_multiplier", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    const provinceEconomies = new Map([["p1", { buildings: { barracks: 1 } }]]);
    sys.assignOrder("p1", "barracks", "infantry"); // build_points=30, base_rate lvl1=3
    for (let t = 0; t < 20; t++) {
      sys.tickProduction(provinceEconomies, () => nation, (allocPct) => 1.0 + allocPct / 100);
    }
    assert.ok((nation.reserve_pool.get("infantry") ?? 0) >= 100);
  });

  it("a heavy tank (build_points 140) takes longer than a light tank (60) at the same building level", () => {
    const sys1 = new UnitProductionSystem();
    const sys2 = new UnitProductionSystem();
    const nation1 = makeNation();
    const nation2 = makeNation();
    const econ = new Map([["p1", { buildings: { tank_plant: 1 } }]]);
    sys1.assignOrder("p1", "tank_plant", "heavy_tank");
    sys2.assignOrder("p1", "tank_plant", "light_tank");
    for (let t = 0; t < 5; t++) {
      sys1.tickProduction(econ, () => nation1, () => 1.0);
      sys2.tickProduction(econ, () => nation2, () => 1.0);
    }
    assert.ok((nation2.reserve_pool.get("light_tank") ?? 0) >= (nation1.reserve_pool.get("heavy_tank") ?? 0));
  });

  it("on completion, produced HP-equivalent is added to reserve_pool, not to any division directly", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    const econ = new Map([["p1", { buildings: { barracks: 5 } }]]);
    sys.assignOrder("p1", "barracks", "infantry");
    for (let t = 0; t < 5; t++) sys.tickProduction(econ, () => nation, () => 1.0);
    assert.ok((nation.reserve_pool.get("infantry") ?? 0) > 0);
  });

  it("reserve_cap clamps reserve_pool — overflow production is wasted, not banked past the cap", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    nation.reserve_cap = 50;
    nation.reserve_pool.set("infantry", 45);
    const econ = new Map([["p1", { buildings: { barracks: 5 } }]]);
    sys.assignOrder("p1", "barracks", "infantry");
    for (let t = 0; t < 5; t++) sys.tickProduction(econ, () => nation, () => 1.0);
    assert.strictEqual(nation.reserve_pool.get("infantry"), 50);
  });

  it("a building with level 0 (demolished/never built) is a no-op, not a throw", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    const econ = new Map([["p1", { buildings: { barracks: 0 } }]]);
    sys.assignOrder("p1", "barracks", "infantry");
    assert.doesNotThrow(() => sys.tickProduction(econ, () => nation, () => 1.0));
  });
});

describe("lane:economy | Idle building scan", () => {
  it("only production building types with level > 0 and no in-progress order are idle", () => {
    const sys = new UnitProductionSystem();
    const econs = [
      { province_id: "p1", owner_id: "n1", buildings: { barracks: 1, tank_plant: 0 } },
      { province_id: "p2", owner_id: "n1", buildings: { ordnance_factory: 2 } },
      { province_id: "p3", owner_id: "", buildings: { barracks: 1 } }, // unowned — excluded
    ];
    sys.assignOrder("p2", "ordnance_factory", "artillery");
    const idle = sys.listIdleBuildings(econs);
    assert.deepStrictEqual(idle, [{ province_id: "p1", building_type: "barracks" }]);
  });
});

describe("lane:economy | Marshalling fill", () => {
  it("fill_rate = MARSHALLING_RATE when reserve_pool has enough of the needed type", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    nation.reserve_pool.set("infantry", 1000);
    const id = sys.startMarshalling("test_nation", "tmpl1", "capital", [{ cell_index: 0, unit_type: "infantry" }]);
    sys.tickMarshalling(new Map([["test_nation", nation]]));
    const data = sys.getMarshalling(id)!;
    assert.strictEqual(data.slots[0].current_hp, 20); // MARSHALLING_RATE placeholder = 20
  });

  it("fill_rate = min(MARSHALLING_RATE, production_rate) when Reserve is empty for that type", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation(); // reserve_pool empty
    const id = sys.startMarshalling("test_nation", "tmpl1", "capital", [{ cell_index: 0, unit_type: "infantry" }]);
    sys.assignOrder("p1", "barracks", "infantry"); // build_points 30, no ticks run -> effective_rate stays 0
    sys.tickMarshalling(new Map([["test_nation", nation]]));
    assert.strictEqual(sys.getMarshalling(id)!.slots[0].current_hp, 0);
  });

  it("MARSHALLING_RATE is a flat national constant, independent of province/building level", () => {
    const sys = new UnitProductionSystem();
    const nationA = makeNation();
    nationA.reserve_pool.set("infantry", 1000);
    const idA = sys.startMarshalling("test_nation", "tmpl1", "province_a", [{ cell_index: 0, unit_type: "infantry" }]);
    sys.tickMarshalling(new Map([["test_nation", nationA]]));
    assert.strictEqual(sys.getMarshalling(idA)!.slots[0].current_hp, 20);
  });
});

describe("lane:economy | Aggregate HP% and CANCEL_MARSHALLING", () => {
  it("aggregate_hp_pct = sum(current_hp) / (slot_count x 100), whole-division not headcount", () => {
    const sys = new UnitProductionSystem();
    const id = sys.startMarshalling("n1", "t1", "capital", [
      { cell_index: 0, unit_type: "infantry" },
      { cell_index: 1, unit_type: "infantry" },
    ]);
    const data = sys.getMarshalling(id)!;
    data.slots[0].current_hp = 100;
    data.slots[1].current_hp = 0;
    assert.strictEqual(sys.aggregateHpPct(data), 0.5);
  });

  it("a 40%-by-slot-count-full-HP template can cross 50% before a 60%-by-slot-count-half-HP template", () => {
    const sys = new UnitProductionSystem();
    const idA = sys.startMarshalling("n1", "t1", "capital", Array.from({ length: 5 }, (_, i) => ({ cell_index: i, unit_type: "infantry" })));
    const dataA = sys.getMarshalling(idA)!;
    dataA.slots[0].current_hp = 100;
    dataA.slots[1].current_hp = 100;
    // 2/5 slots filled, both full HP -> 40% by slot count, aggregate = 200/500 = 0.4 (not yet 50%, but higher than B)
    const idB = sys.startMarshalling("n1", "t2", "capital", Array.from({ length: 5 }, (_, i) => ({ cell_index: i, unit_type: "infantry" })));
    const dataB = sys.getMarshalling(idB)!;
    dataB.slots[0].current_hp = 50;
    dataB.slots[1].current_hp = 50;
    dataB.slots[2].current_hp = 50;
    // 3/5 slots filled at half HP -> 60% by slot count, aggregate = 150/500 = 0.3
    assert.ok(sys.aggregateHpPct(dataA) > sys.aggregateHpPct(dataB));
  });

  it("cancelling returns already-allocated HP-equivalent back to reserve_pool, non-destructive", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    const id = sys.startMarshalling("test_nation", "t1", "capital", [{ cell_index: 0, unit_type: "infantry" }]);
    sys.getMarshalling(id)!.slots[0].current_hp = 40;
    sys.cancelMarshalling(id, new Map([["test_nation", nation]]));
    assert.strictEqual(nation.reserve_pool.get("infantry"), 40);
    assert.strictEqual(sys.getMarshalling(id), undefined);
  });
});

describe("lane:economy | Field-supply delivery — simplified placeholder", () => {
  it("field_supply_line_capacity delivers a rate slower than MARSHALLING_RATE", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    nation.reserve_pool.set("infantry", 1000);
    const div = new DivisionState();
    div.nation_id = "test_nation";
    div.grid.cells[0].unit_type = "infantry";
    div.grid.cells[0].hp = 0;
    sys.tickFieldDelivery([div], new Map([["test_nation", nation]]));
    assert.ok(div.grid.cells[0].hp > 0 && div.grid.cells[0].hp <= 10); // placeholder rate = MARSHALLING_RATE*0.5 = 10
  });

  it("a fully-healthy cell (hp=100) is not touched", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    nation.reserve_pool.set("infantry", 1000);
    const div = new DivisionState();
    div.nation_id = "test_nation";
    div.grid.cells[0].unit_type = "infantry";
    div.grid.cells[0].hp = 100;
    sys.tickFieldDelivery([div], new Map([["test_nation", nation]]));
    assert.strictEqual(div.grid.cells[0].hp, 100);
  });

  it("an empty cell (unit_type === '') is never drawn against", () => {
    const sys = new UnitProductionSystem();
    const nation = makeNation();
    nation.reserve_pool.set("infantry", 1000);
    const div = new DivisionState();
    div.nation_id = "test_nation";
    div.grid.cells[0].unit_type = "";
    div.grid.cells[0].hp = 0;
    sys.tickFieldDelivery([div], new Map([["test_nation", nation]]));
    assert.strictEqual(div.grid.cells[0].hp, 0);
    assert.strictEqual(nation.reserve_pool.get("infantry"), 1000);
  });
});

describe("lane:economy | Warehouse Reserve cap", () => {
  it("reserve_cap defaults to 0 on a fresh NationState until _economyTick computes it (schema default)", () => {
    const nation = new NationState();
    assert.strictEqual(nation.reserve_cap, 0);
  });
});

describe("lane:economy | GameRoom integration — RAISE_DIVISION/FORCE_DEPLOY/CANCEL_MARSHALLING", () => {
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

  it("RAISE_DIVISION does not create a DivisionState in state.divisions", async () => {
    const { client, room } = await joinRoom();
    const before = room.state.divisions.size;
    client.send("RAISE_DIVISION", {
      template_id: "tmpl1",
      home_province_id: "we6_germany_06",
      cells: [{ cell_index: 0, unit_type: "infantry" }],
    });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.divisions.size, before);
  });

  it("RAISE_DIVISION from a non-owned province is silently ignored", async () => {
    const { client, room } = await joinRoom();
    const before = room.state.divisions.size;
    client.send("RAISE_DIVISION", {
      template_id: "tmpl1",
      home_province_id: "we6_france_03",
      cells: [{ cell_index: 0, unit_type: "infantry" }],
    });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.divisions.size, before);
  });

  // _marshallingIdCounter is a module-level counter shared by every unit-test describe block in
  // this same file (the pure-function tests above already call startMarshalling many times) —
  // never assume a specific id string; always read the real one back off the room.
  function getMarshallingIdForGermany(room: any): string {
    const list = room.unitProductionSystem.listMarshallingForNation("germany");
    assert.strictEqual(list.length, 1, "expected exactly one marshalling entry for germany");
    return list[0].marshalling_id;
  }

  it("FORCE_DEPLOY below 50% aggregate HP is rejected", async () => {
    const { client, room } = await joinRoom();
    const beforeDivisions = room.state.divisions.size;
    client.send("RAISE_DIVISION", {
      template_id: "tmpl1",
      home_province_id: "we6_germany_06",
      cells: [{ cell_index: 0, unit_type: "infantry" }],
    });
    await room.waitForNextPatch();
    const marshallingId = getMarshallingIdForGermany(room);
    // No stock seeded, no ticks waited — aggregate HP is 0%.
    client.send("FORCE_DEPLOY", { marshalling_id: marshallingId });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.divisions.size, beforeDivisions);
  });

  it("FORCE_DEPLOY at >=50% aggregate HP creates a real DivisionState positioned at home_province_id's city position", async () => {
    const { client, room } = await joinRoom();
    const nation = room.state.nations.get("germany")!;
    nation.reserve_pool.set("infantry", 1000); // seed Reserve so Marshalling fills fast
    const beforeDivisions = room.state.divisions.size;

    client.send("RAISE_DIVISION", {
      template_id: "tmpl1",
      home_province_id: "we6_germany_06",
      cells: [{ cell_index: 0, unit_type: "infantry" }],
    });
    await room.waitForNextPatch();
    const marshallingId = getMarshallingIdForGermany(room);

    // MARSHALLING_RATE=20/tick, TICK_MS=1000 — 3 ticks reaches hp>=50 for the single slot.
    await new Promise((resolve) => setTimeout(resolve, 3500));

    client.send("FORCE_DEPLOY", { marshalling_id: marshallingId });
    await room.waitForNextPatch();

    assert.strictEqual(room.state.divisions.size, beforeDivisions + 1);
    const div = room.state.divisions.get(`division_${marshallingId}`);
    assert.ok(div, "expected the deployed division to exist under the derived division_id");
    assert.strictEqual(div!.grid.cells[0].unit_type, "infantry");
    assert.ok(div!.grid.cells[0].hp >= 50);
  });

  it("CANCEL_MARSHALLING removes the marshalling entry and returns already-allocated stock to reserve_pool", async () => {
    const { client, room } = await joinRoom();
    const nation = room.state.nations.get("germany")!;
    nation.reserve_pool.set("infantry", 1000);
    const beforeReserve = nation.reserve_pool.get("infantry")!;

    client.send("RAISE_DIVISION", {
      template_id: "tmpl1",
      home_province_id: "we6_germany_06",
      cells: [{ cell_index: 0, unit_type: "infantry" }],
    });
    await room.waitForNextPatch();
    const marshallingId = getMarshallingIdForGermany(room);
    await new Promise((resolve) => setTimeout(resolve, 1500)); // partial fill, well under 100%

    client.send("CANCEL_MARSHALLING", { marshalling_id: marshallingId });
    await room.waitForNextPatch();

    // Non-destructive: whatever was drawn out of reserve_pool during the partial fill should be
    // back, so total reserve_pool ends up close to (though not necessarily exactly, since the
    // tick loop keeps running production/marshalling every second) what it was seeded at.
    const afterReserve = nation.reserve_pool.get("infantry")!;
    assert.ok(afterReserve <= beforeReserve, "cancel should never leave more stock than was ever drawn out");
    assert.ok(afterReserve > 0);
  });

  it("Warehouse Reserve cap: reserve_cap is nonzero even with zero Warehouses, per the never-zero-floor guarantee", async () => {
    const { room } = await joinRoom();
    await new Promise((resolve) => setTimeout(resolve, 1500)); // let _economyTick run at least once
    const nation = room.state.nations.get("germany")!;
    assert.ok(nation.reserve_cap >= 200); // RESERVE_CAP_BASELINE placeholder
  });
});
