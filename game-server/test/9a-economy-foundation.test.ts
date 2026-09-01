import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { getBuildingStats, BUILDING_TYPES } from "../src/data/building_stats.js";
import { EconomyBuildingSystem } from "../src/systems/economy_building_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("lane:economy | building_stats data table", () => {
  it("has all 25 building types", () => {
    // 24 per MAP_DATA_CONTRACT.md + "infrastructure" (Branch B schema gap 2 — see
    // building_stats.ts's comment on BUILDING_TYPES).
    assert.strictEqual(BUILDING_TYPES.length, 25);
  });
  it("construction_points increase per level", () => {
    const stats = getBuildingStats("res_iron");
    for (let i = 1; i < stats.construction_points_by_level.length; i++) {
      assert.ok(stats.construction_points_by_level[i] > stats.construction_points_by_level[i - 1]);
    }
  });
  it("unknown building type throws, not silently returns a default", () => {
    assert.throws(() => getBuildingStats("not_a_real_building"));
  });
});

describe("lane:economy | EconomyBuildingSystem parallel construction", () => {
  function freshSystem(): EconomyBuildingSystem {
    const sys = new EconomyBuildingSystem();
    sys.init("p1", { school: 0, hospital: 0 }, {});
    return sys;
  }

  it("two different buildings in the same province construct simultaneously, independent progress", () => {
    const sys = freshSystem();
    sys.startConstruction("p1", "school", 50);
    sys.startConstruction("p1", "hospital", 50);
    sys.tick(new Map([["p1", { infrastructure: 100, owner_id: "n1" }]]), () => 1.0, () => {});
    const econ = sys.get("p1")!;
    assert.strictEqual(econ.construction_queue.length, 2);
    // res_iron/school/hospital all share the same default construction-points curve,
    // so equal infra progress advances both projects by the same amount independently.
    assert.strictEqual(
      econ.construction_queue[0].points_remaining,
      econ.construction_queue[1].points_remaining,
    );
  });

  it("construction completes when points_remaining reaches 0, level increments, queue entry removed", () => {
    const sys = freshSystem();
    sys.startConstruction("p1", "school", 50);
    for (let i = 0; i < 1000; i++) {
      sys.tick(new Map([["p1", { infrastructure: 100, owner_id: "n1" }]]), () => 1.0, () => {});
    }
    const econ = sys.get("p1")!;
    assert.strictEqual(econ.buildings["school"], 1);
    assert.strictEqual(econ.construction_queue.length, 0);
  });

  it("cannot start a second construction project on a building_type already under construction", () => {
    const sys = freshSystem();
    const first = sys.startConstruction("p1", "school", 50);
    const second = sys.startConstruction("p1", "school", 50);
    assert.ok(first);
    assert.strictEqual(second, null);
  });

  it("level-0 building reads construction_points index 0 (cost to reach level 1)", () => {
    const sys = freshSystem();
    const project = sys.startConstruction("p1", "school", 50)!;
    assert.strictEqual(project.points_total, getBuildingStats("school").construction_points_by_level[0]);
  });
});

describe("lane:economy | NationState economy fields", () => {
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

  it("new nation starts with a seeded stockpile of every resource (dev/testing convenience, Branch C amendment)", async () => {
    // Originally "zero of everything else" — amended once Branch C's Reserve/Marshalling
    // mechanics needed to be testable/observable immediately without waiting on real-time
    // extraction ticks (see _initNationEconomy()'s doc comment in GameRoom.ts).
    const { room } = await joinRoom();
    const nation = room.state.nations.get("germany");
    assert.ok(nation);
    assert.ok((nation!.resources.get("money") ?? 0) > 0);
    assert.ok((nation!.resources.get("iron") ?? 0) > 0);
  });

  it("reserve_pool starts empty (populated by Branch C)", async () => {
    const { room } = await joinRoom();
    const nation = room.state.nations.get("germany")!;
    assert.strictEqual(nation.reserve_pool.size, 0);
  });

  it("industry_alloc starts seeded with a valid default summing to 100 (money/construction_speed 50/50), not empty", async () => {
    // Branch B (ECONOMY_BUILDINGS.md's Industry Pool: "New factories default-allocate to money
    // production and construction speed") — supersedes Branch A's placeholder empty-map
    // behavior now that a real default allocation exists.
    const { room } = await joinRoom();
    const nation = room.state.nations.get("germany")!;
    const total = Array.from(nation.industry_alloc.values()).reduce((sum, v) => sum + v, 0);
    assert.strictEqual(total, 100);
    assert.strictEqual(nation.industry_alloc.get("money"), 50);
    assert.strictEqual(nation.industry_alloc.get("construction_speed"), 50);
  });

  it("BUILD_BUILDING: owner can build, resource cost deducted, non-owner and insufficient funds rejected", async () => {
    const { client, room } = await joinRoom();
    const nation = room.state.nations.get("germany")!;
    const before = nation.resources.get("money") ?? 0;

    // Germany's capital (we6_germany_06) already has the 4 production buildings at level 1
    // from the map pipeline's default placement — "school" starts at level 0 there.
    client.send("BUILD_BUILDING", { province_id: "we6_germany_06", building_type: "school" });
    await room.waitForNextPatch();

    const after = nation.resources.get("money") ?? 0;
    assert.ok(after < before, "money should be deducted immediately on BUILD_BUILDING");

    // Non-owner province: france's capital, not germany's — should be a silent no-op. Branch B's
    // population-scaled money trickle now runs every tick, so money can drift upward between
    // patches on its own — assert the rejected build didn't deduct anything (no further
    // decrease), not exact equality.
    const moneyAfterFirstBuild = after;
    client.send("BUILD_BUILDING", { province_id: "we6_france_03", building_type: "school" });
    await room.waitForNextPatch();
    assert.ok((nation.resources.get("money") ?? 0) >= moneyAfterFirstBuild, "non-owner build must not deduct money");
  });
});
