import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, MISSION_TYPES, AIR_UNIT_TYPES } from "../src/rooms/schema/AirWingState.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("lane:air-combat | 12k — Wing management (ADJUST_WING_SIZE, CREATE_WING)", function () {

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
    const token  = await makeToken();
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    client.send("SELECT_NATION", { nation_id: "germany" });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    return { client, room };
  }

  async function spawnWing(client: any, room: any, overrides: Record<string, unknown> = {}) {
    const defaults: Record<string, unknown> = {
      wing_id:                  overrides.wing_id ?? "wing-1",
      nation_id:                "germany",
      aircraft_type:            AIR_UNIT_TYPES.FIGHTER,
      count:                    overrides.count ?? 20,
      lifecycle_state:          WING_LIFECYCLE.IDLE,
      mission:                  MISSION_TYPES.INTERCEPTION,
      home_airbase_province_id: "we6_germany_06",
    };
    client.send("SPAWN_WING", { ...defaults, ...overrides });
    await room.waitForNextPatch();
  }

  // ── ADJUST_WING_SIZE ─────────────────────────────────────────────────────

  it("ADJUST_WING_SIZE +10 increases count", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "wing-a", count: 20 });

    client.send("ADJUST_WING_SIZE", { wing_id: "wing-a", delta: 10 });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get("wing-a");
    assert.ok(wing);
    assert.strictEqual(wing.count, 30);
  });

  it("ADJUST_WING_SIZE -10 with count 5 clamps to 0", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "wing-a", count: 5 });

    client.send("ADJUST_WING_SIZE", { wing_id: "wing-a", delta: -10 });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get("wing-a");
    assert.ok(wing);
    assert.strictEqual(wing.count, 0);
  });

  it("ADJUST_WING_SIZE from non-owner nation is no-op", async () => {
    const token1 = await makeToken("user-a");
    const token2 = await makeToken("user-b");
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client1 = await colyseus.connectTo(room, { token: token1 });
    await room.waitForNextPatch();
    client1.send("SELECT_NATION", { nation_id: "germany" });
    await room.waitForNextPatch();
    const client2 = await colyseus.connectTo(room, { token: token2 });
    await room.waitForNextPatch();
    client2.send("SELECT_NATION", { nation_id: "france" });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();

    client1.send("SPAWN_WING", {
      wing_id: "wing-a", nation_id: "germany", aircraft_type: AIR_UNIT_TYPES.FIGHTER,
      count: 20, lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.INTERCEPTION,
      home_airbase_province_id: "we6_germany_06",
    });
    await room.waitForNextPatch();

    client2.send("ADJUST_WING_SIZE", { wing_id: "wing-a", delta: 10 });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get("wing-a");
    assert.ok(wing);
    assert.strictEqual(wing.count, 20);
  });

  // ── CREATE_WING ──────────────────────────────────────────────────────────

  it("CREATE_WING spawns a new wing at owned province with idle state", async () => {
    const { client, room } = await joinRoom();

    client.send("CREATE_WING", {
      wing_id: "new-wing",
      aircraft_type: AIR_UNIT_TYPES.FIGHTER,
      count: 10,
      home_airbase_province_id: "we6_germany_06",
    });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get("new-wing");
    assert.ok(wing);
    assert.strictEqual(wing.aircraft_type, AIR_UNIT_TYPES.FIGHTER);
    assert.strictEqual(wing.count, 10);
    assert.strictEqual(wing.nation_id, "germany");
    assert.strictEqual(wing.mission, MISSION_TYPES.IDLE);
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.IDLE);
    assert.strictEqual(wing.home_airbase_province_id, "we6_germany_06");
  });

  it("CREATE_WING to a province not owned by requesting nation is rejected", async () => {
    const { client, room } = await joinRoom();

    client.send("CREATE_WING", {
      wing_id: "new-wing",
      aircraft_type: AIR_UNIT_TYPES.FIGHTER,
      count: 10,
      home_airbase_province_id: "we6_france_03",
    });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get("new-wing");
    assert.strictEqual(wing, undefined);
  });

  it("CREATE_WING from client with no nation is rejected", async () => {
    const token = await makeToken("no-nation-user");
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();

    client.send("CREATE_WING", {
      wing_id: "new-wing",
      aircraft_type: AIR_UNIT_TYPES.FIGHTER,
      count: 10,
      home_airbase_province_id: "we6_germany_06",
    });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get("new-wing");
    assert.strictEqual(wing, undefined);
  });
});
