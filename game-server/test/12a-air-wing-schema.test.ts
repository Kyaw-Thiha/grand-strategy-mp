import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import {
  AirWingState,
  AirWingTemplate,
  AIR_UNIT_TYPES,
  MISSION_TYPES,
  WING_LIFECYCLE,
} from "../src/rooms/schema/AirWingState.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: false })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("lane:air-combat | 12a — Air Wing Schema", function () {
  this.timeout(15_000);

  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => { colyseus = await boot(appConfig, getTestPort()); });
  after(async () => {
    await colyseus.shutdown();
  });
  beforeEach(async () => { await colyseus.cleanup(); });

  async function joinRoom() {
    const token  = await makeToken();
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    return { client, room };
  }

  // ── Schema unit tests (no server needed) ─────────────────────────────────────

  it("AirWingState has correct default field values", () => {
    const wing = new AirWingState();
    assert.strictEqual(wing.wing_id,                   "");
    assert.strictEqual(wing.nation_id,                 "");
    assert.strictEqual(wing.aircraft_type,             AIR_UNIT_TYPES.FIGHTER);
    assert.strictEqual(wing.count,                     10);
    assert.strictEqual(wing.fuel,                       1.0);
    assert.strictEqual(wing.combat_readiness,          1.0);
    assert.strictEqual(wing.position_lng,              0);
    assert.strictEqual(wing.position_lat,              0);
    assert.strictEqual(wing.heading_deg,               0);
    assert.strictEqual(wing.lifecycle_state,           WING_LIFECYCLE.IDLE);
    assert.strictEqual(wing.mission,                   MISSION_TYPES.INTERCEPTION);
    assert.strictEqual(wing.target_id,                 "");
    assert.strictEqual(wing.home_airbase_province_id,  "");
    assert.strictEqual(wing.path_gen_id,               "");
    assert.strictEqual(wing.path_elapsed_ms,           0);
    assert.strictEqual(wing.weapon_ready,              true);
    assert.strictEqual(wing.perk_multi_sortie,         false);
    assert.strictEqual(wing.perk_strafing,             false);
    assert.strictEqual(wing.perk_extended_range,       false);
    assert.strictEqual(wing.perk_precision_bombing,    false);
  });

  it("AirWingTemplate has correct default field values", () => {
    const tmpl = new AirWingTemplate();
    assert.strictEqual(tmpl.aircraft_type, AIR_UNIT_TYPES.FIGHTER);
    assert.strictEqual(tmpl.count,         10);
  });

  it("AIR_UNIT_TYPES contains all eight aircraft type values", () => {
    const expected = [
      "cas_plane", "dive_bomber", "fighter", "naval_bomber",
      "heavy_fighter", "strategic_bomber", "tactical_bomber", "recon_plane",
    ];
    const actual = Object.values(AIR_UNIT_TYPES);
    assert.strictEqual(actual.length, expected.length);
    for (const v of expected) {
      assert.ok(actual.includes(v as any), `AIR_UNIT_TYPES missing "${v}"`);
    }
  });

  it("MISSION_TYPES contains all twelve mission values", () => {
    const expected = [
      "tactical_bombing", "interception", "air_superiority", "escort",
      "logistics", "area", "industry", "oil",
      "recon", "trade_interdiction", "anti_submarine", "anti_ship",
    ];
    const actual = Object.values(MISSION_TYPES);
    assert.strictEqual(actual.length, expected.length);
    for (const v of expected) {
      assert.ok(actual.includes(v as any), `MISSION_TYPES missing "${v}"`);
    }
  });

  it("WING_LIFECYCLE enum contains all seven states", () => {
    const expected = ["idle", "transit", "engaged", "loiter", "rtb", "refuel", "relocate"];
    const actual = Object.values(WING_LIFECYCLE);
    assert.strictEqual(actual.length, expected.length);
    for (const v of expected) {
      assert.ok(actual.includes(v as any), `WING_LIFECYCLE missing "${v}"`);
    }
  });

  it("AirWingState is NOT a schema-tracked field 'grid' (grid field does not exist on wing)", () => {
    const wing = new AirWingState();
    assert.ok(!("grid" in wing), "AirWingState must not have a grid field");
  });

  // ── Server round-trip tests ───────────────────────────────────────────────────

  it("GameRoomState exposes an air_wings MapSchema", async () => {
    const { room } = await joinRoom();
    assert.ok(room.state.air_wings, "air_wings must exist on GameRoomState");
    assert.strictEqual(room.state.air_wings.size, 0, "air_wings starts empty");
  });

  it("wing spawned via SPAWN_WING appears in air_wings and all fields survive Colyseus patch", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_WING", {
      wing_id:                  "wing-test-1",
      nation_id:                "germany",
      aircraft_type:            AIR_UNIT_TYPES.FIGHTER,
      count:                    24,
      position_lng:             13.4,
      position_lat:             52.5,
      heading_deg:              270,
      lifecycle_state:          WING_LIFECYCLE.TRANSIT,
      mission:                  MISSION_TYPES.AIR_SUPERIORITY,
      home_airbase_province_id: "province-berlin",
    });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get("wing-test-1");
    assert.ok(wing, "wing-test-1 must be in air_wings after SPAWN_WING");
    assert.strictEqual(wing.wing_id,                   "wing-test-1");
    assert.strictEqual(wing.nation_id,                 "germany");
    assert.strictEqual(wing.aircraft_type,             AIR_UNIT_TYPES.FIGHTER);
    assert.strictEqual(wing.count,                     24);
    assert.strictEqual(wing.position_lng,              13.4);
    assert.strictEqual(wing.position_lat,              52.5);
    assert.strictEqual(wing.heading_deg,               270);
    assert.strictEqual(wing.lifecycle_state,           WING_LIFECYCLE.TRANSIT);
    assert.strictEqual(wing.mission,                   MISSION_TYPES.AIR_SUPERIORITY);
    assert.strictEqual(wing.home_airbase_province_id,  "province-berlin");
  });

  it("all AIR_UNIT_TYPE values survive a Colyseus round-trip via SPAWN_WING", async () => {
    const { client, room } = await joinRoom();
    for (const [key, aircraftType] of Object.entries(AIR_UNIT_TYPES)) {
      const wingId = `wing-type-${key}`;
      client.send("SPAWN_WING", { wing_id: wingId, nation_id: "test", aircraft_type: aircraftType });
      await room.waitForNextPatch();
      const wing = room.state.air_wings.get(wingId);
      assert.ok(wing, `wing for AIR_UNIT_TYPES.${key} must exist`);
      assert.strictEqual(wing.aircraft_type, aircraftType, `AIR_UNIT_TYPES.${key} must round-trip`);
    }
  });

  it("all MISSION_TYPE values survive a Colyseus round-trip via SPAWN_WING", async () => {
    const { client, room } = await joinRoom();
    for (const [key, mission] of Object.entries(MISSION_TYPES)) {
      const wingId = `wing-mission-${key}`;
      client.send("SPAWN_WING", { wing_id: wingId, nation_id: "test", mission });
      await room.waitForNextPatch();
      const wing = room.state.air_wings.get(wingId);
      assert.ok(wing, `wing for MISSION_TYPES.${key} must exist`);
      assert.strictEqual(wing.mission, mission, `MISSION_TYPES.${key} must round-trip`);
    }
  });

  it("SPAWN_WING broadcasts AIR_WING_UPDATES with correct wing data", async () => {
    const { client, room } = await joinRoom();

    const broadcastReceived = new Promise<any>((resolve) => {
      client.onMessage("AIR_WING_UPDATES", resolve);
    });

    client.send("SPAWN_WING", {
      wing_id:       "wing-broadcast-test",
      nation_id:     "france",
      aircraft_type: AIR_UNIT_TYPES.FIGHTER,
      count:         18,
      position_lng:  2.35,
      position_lat:  48.85,
    });

    const msg = await broadcastReceived;
    assert.ok(Array.isArray(msg.wings), "AIR_WING_UPDATES.wings must be an array");
    assert.strictEqual(msg.wings.length, 1);
    const w = msg.wings[0];
    assert.strictEqual(w.wing_id,       "wing-broadcast-test");
    assert.strictEqual(w.nation_id,     "france");
    assert.strictEqual(w.aircraft_type, AIR_UNIT_TYPES.FIGHTER);
    assert.strictEqual(w.count,         18);
    assert.strictEqual(w.position_lng,  2.35);
    assert.strictEqual(w.position_lat,  48.85);
    assert.strictEqual(w.weapon_ready,  true);
  });

  it("multiple wings coexist in air_wings without colliding", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_WING", { wing_id: "wing-a", nation_id: "germany", aircraft_type: AIR_UNIT_TYPES.FIGHTER });
    client.send("SPAWN_WING", { wing_id: "wing-b", nation_id: "france",  aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER });
    await room.waitForNextPatch();
    await room.waitForNextPatch();

    assert.strictEqual(room.state.air_wings.size, 2);
    assert.strictEqual(room.state.air_wings.get("wing-a")?.aircraft_type, AIR_UNIT_TYPES.FIGHTER);
    assert.strictEqual(room.state.air_wings.get("wing-b")?.aircraft_type, AIR_UNIT_TYPES.STRATEGIC_BOMBER);
  });
});
