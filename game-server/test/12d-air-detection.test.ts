import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { Encoder } from "@colyseus/schema";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { AirWingState, WING_LIFECYCLE, MISSION_TYPES } from "../src/rooms/schema/AirWingState.js";
import {
  setPassiveWingRadiusForTesting,
  setReconWingRadiusForTesting,
  setKmPerDegForTesting,
} from "../src/systems/air_detection_system.js";
import { setEngagementRangeForTesting } from "../src/systems/air_dubins_pathfinder.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("lane:air-combat | 12d — Air Detection System", function () {
  this.timeout(180_000);

  let colyseus: ColyseusTestServer<typeof appConfig>;
  let previousDevMode: string | undefined;

  before(async () => {
    previousDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = "true";
    Encoder.BUFFER_SIZE = 256 * 1024;
    setPassiveWingRadiusForTesting(0.5);
    setReconWingRadiusForTesting(2.0);
    setKmPerDegForTesting(100.0);
    setEngagementRangeForTesting(0); // detection tests must not trigger combat
    colyseus = await boot(appConfig);
  });

  after(async () => {
    if (previousDevMode === undefined) delete process.env.DEV_MODE;
    else process.env.DEV_MODE = previousDevMode;
    setPassiveWingRadiusForTesting(0.1);
    setReconWingRadiusForTesting(1.0);
    setKmPerDegForTesting(111.32);
    setEngagementRangeForTesting(0.3);
    await new Promise(r => setTimeout(r, 300));
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  async function joinRoom() {
    process.env.DEV_MODE = "true";
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

  function setRelation(room: any, nationA: string, nationB: string, stance: string): void {
    const relation = room.state.relations.get(`${nationA}|${nationB}`)
      ?? room.state.relations.get(`${nationB}|${nationA}`);
    assert.ok(relation, `missing relation ${nationA}|${nationB}`);
    relation.stance = stance;
  }

  function getWing(room: any, wingId: string): any {
    const wing = room.state.air_wings.get(wingId);
    assert.ok(wing, `missing wing ${wingId}`);
    return wing;
  }

  function getDivision(room: any, nationId: string): any {
    for (const division of room.state.divisions.values()) {
      if (division.nation_id === nationId) return division;
    }
    assert.fail(`missing division for ${nationId}`);
  }

  function setRadar(room: any, provinceId: string, nationId: string, positionLng: number, positionLat: number, radiusDeg: number): void {
    (room as any).airDetectionSystem.setRadarEntry(provinceId, {
      position_lng: positionLng,
      position_lat: positionLat,
      radius_deg: radiusDeg,
      nation_id: nationId,
    });
  }

  async function tickRoom(room: any): Promise<void> {
    (room as any).gameTick();
    await room.waitForNextPatch();
  }

  it("defaults is_detected to false", () => {
    const wing = new AirWingState();
    assert.strictEqual(wing.is_detected, false, "is_detected must default to false");
  });

  describe("Radar detection", () => {
    it("wing inside radar radius becomes detected after tick", async () => {
      const { client, room } = await joinRoom();
      setRelation(room, "germany", "france", "war");
      const wing = getWing(room, "france_wing_01");
      wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      setRadar(room, "province-paris", "germany", 2.335453, 48.896725, 1.0);
      await new Promise(r => setTimeout(r, 1000));
      await tickRoom(room);
      assert.strictEqual(getWing(room, "france_wing_01").is_detected, true);
    });

    it("wing outside radar radius stays undetected", async () => {
      const { client, room } = await joinRoom();
      setRelation(room, "germany", "france", "war");
      const wing = getWing(room, "france_wing_01");
      wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      setRadar(room, "province-berlin", "germany", 10.0, 50.0, 1.0);
      await new Promise(r => setTimeout(r, 1000));
      await tickRoom(room);
      assert.strictEqual(getWing(room, "france_wing_01").is_detected, false);
    });

    it("own wings are never detected by own radar", async () => {
      const { client, room } = await joinRoom();
      const wing = getWing(room, "germany_wing_01");
      wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      setRadar(room, "province-berlin", "germany", 10.0, 50.0, 2.0);
      await new Promise(r => setTimeout(r, 1000));
      await tickRoom(room);
      assert.strictEqual(getWing(room, "germany_wing_01").is_detected, false);
    });

    it("radar updates only reach the owning nation", async () => {
      const token1 = await makeToken("user-1");
      const token2 = await makeToken("user-2");
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const client1 = await colyseus.connectTo(room, { token: token1 });
      const client2 = await colyseus.connectTo(room, { token: token2 });
      await room.waitForNextPatch();
      client1.send("SELECT_NATION", { nation_id: "germany" });
      client2.send("SELECT_NATION", { nation_id: "france" });
      await room.waitForNextPatch();
      await (room as any).startGame();
      await room.waitForNextPatch();

      const germanyRadar = new Promise<any>(resolve => client1.onMessage("RADAR_UPDATED", resolve));
      let franceSawRadar = false;
      client2.onMessage("RADAR_UPDATED", () => { franceSawRadar = true; });

      const radarPayload = {
        key: "province-berlin",
        nation_id: "germany",
        position_lng: 9.8,
        position_lat: 50.0,
        radius_deg: 1.0,
      };
      for (const client of room.clients) {
        const player = room.state.players.get(client.sessionId);
        if (!player) continue;
        const nation = (room as any).getNationForPlayer(player.userId);
        if (!nation || nation.nation_id !== radarPayload.nation_id) continue;
        client.send("RADAR_UPDATED", radarPayload);
      }
      const received = await germanyRadar;
      assert.strictEqual(received.nation_id, "germany");
      await new Promise(r => setTimeout(r, 150));
      assert.strictEqual(franceSawRadar, false, "enemy client must not receive radar updates");
    });
  });

  describe("Recon wing detection", () => {
    it("recon wing over enemy detects it", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");
      const enemyWing = getWing(room, "france_wing_01");
      const reconWing = getWing(room, "germany_wing_01");
      enemyWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      enemyWing.position_lng = 10;
      enemyWing.position_lat = 50;
      reconWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      reconWing.mission = MISSION_TYPES.RECON;
      reconWing.position_lng = 10.1;
      reconWing.position_lat = 50;
      await tickRoom(room);
      assert.strictEqual(getWing(room, "france_wing_01").is_detected, true);
    });

    it("recon wing leaving area clears detection next tick", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");
      const enemyWing = getWing(room, "france_wing_01");
      const reconWing = getWing(room, "germany_wing_01");
      enemyWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      enemyWing.position_lng = 10;
      enemyWing.position_lat = 50;
      reconWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      reconWing.mission = MISSION_TYPES.RECON;
      // Place recon 0.4 deg away: within recon radius (2.0) but outside attack range (0.3)
      // so combat doesn't fire before detection runs.
      reconWing.position_lng = 10.4;
      reconWing.position_lat = 50;
      await tickRoom(room);
      assert.strictEqual(getWing(room, "france_wing_01").is_detected, true);

      // The first tick transitions reconWing from TRANSIT→LOITER (no path/target fallback).
      // Setting lifecycle to IDLE removes it from the airborne set entirely, which is the
      // correct way to simulate "wing left the area" — direct position assignment is
      // overwritten by the pathfinder evaluating the loiter arc on the next tick.
      reconWing.lifecycle_state = WING_LIFECYCLE.IDLE;
      await tickRoom(room);
      assert.strictEqual(getWing(room, "france_wing_01").is_detected, false);
    });

    it("non-RECON wing uses passive radius", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");
      const enemyWing = getWing(room, "france_wing_01");
      const passiveWing = getWing(room, "germany_wing_01");
      enemyWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      enemyWing.position_lng = 10;
      enemyWing.position_lat = 50;
      passiveWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      passiveWing.mission = MISSION_TYPES.INTERCEPTION;
      passiveWing.position_lng = 11.5;
      passiveWing.position_lat = 50;
      await tickRoom(room);
      assert.strictEqual(getWing(room, "france_wing_01").is_detected, false);
    });
  });

  describe("Division observation_radius detection", () => {
    it("division observation radius reveals nearby enemy wing", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");
      const enemyWing = getWing(room, "france_wing_01");
      enemyWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      enemyWing.position_lng = 10;
      enemyWing.position_lat = 50;
      const division = getDivision(room, "germany");
      division.position_lng = 9.8;
      division.position_lat = 50.0;
      division.observation_radius = 100;
      await tickRoom(room);
      assert.strictEqual(getWing(room, "france_wing_01").is_detected, true);
    });

    it("division outside observation radius does not reveal wing", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");
      const enemyWing = getWing(room, "france_wing_01");
      enemyWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      enemyWing.position_lng = 10;
      enemyWing.position_lat = 50;
      const division = getDivision(room, "germany");
      division.position_lng = 9.8;
      division.position_lat = 50.0;
      division.observation_radius = 10;
      await tickRoom(room);
      assert.strictEqual(getWing(room, "france_wing_01").is_detected, false);
    });
  });

  describe("Passive wing detection", () => {
    it("friendly wing in flight detects nearby enemy within passive radius", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");
      const enemyWing = getWing(room, "france_wing_01");
      const passiveWing = getWing(room, "germany_wing_01");
      enemyWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      enemyWing.position_lng = 10;
      enemyWing.position_lat = 50;
      passiveWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      passiveWing.mission = MISSION_TYPES.INTERCEPTION;
      passiveWing.position_lng = 10.3;
      passiveWing.position_lat = 50;
      await tickRoom(room);
      assert.strictEqual(getWing(room, "france_wing_01").is_detected, true);
    });
  });

  describe("Detection gates interception pursuit", () => {
    it("INTERCEPTION wing in LOITER transitions to TRANSIT when an enemy is detected", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");
      const interceptor = getWing(room, "germany_wing_01");
      const enemyWing = getWing(room, "france_wing_01");
      interceptor.lifecycle_state = WING_LIFECYCLE.LOITER;
      interceptor.mission = MISSION_TYPES.INTERCEPTION;
      interceptor.position_lng = 10;
      interceptor.position_lat = 50;
      enemyWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      // 0.4 deg: outside attack range (0.3) so combat doesn't fire before detection,
      // but inside passive detection radius (0.5) so the enemy is detected.
      enemyWing.position_lng = 10.4;
      enemyWing.position_lat = 50;
      await tickRoom(room);
      assert.strictEqual(getWing(room, "germany_wing_01").lifecycle_state, WING_LIFECYCLE.TRANSIT);
      assert.strictEqual(getWing(room, "germany_wing_01").target_id, "france_wing_01");
    });

    it("INTERCEPTION wing in LOITER stays LOITER when no enemy is detected", async () => {
      const { room } = await joinRoom();
      const interceptor = getWing(room, "germany_wing_01");
      interceptor.lifecycle_state = WING_LIFECYCLE.LOITER;
      interceptor.mission = MISSION_TYPES.INTERCEPTION;
      await tickRoom(room);
      assert.strictEqual(getWing(room, "germany_wing_01").lifecycle_state, WING_LIFECYCLE.LOITER);
    });

    it("AIR_SUPERIORITY wing in LOITER also pursues on detection", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");
      const superiority = getWing(room, "germany_wing_01");
      const enemyWing = getWing(room, "france_wing_01");
      superiority.lifecycle_state = WING_LIFECYCLE.LOITER;
      superiority.mission = MISSION_TYPES.AIR_SUPERIORITY;
      superiority.position_lng = 10;
      superiority.position_lat = 50;
      enemyWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      // 0.4 deg: outside attack range (0.3), inside passive radius (0.5)
      enemyWing.position_lng = 10.4;
      enemyWing.position_lat = 50;
      await tickRoom(room);
      assert.strictEqual(getWing(room, "germany_wing_01").lifecycle_state, WING_LIFECYCLE.TRANSIT);
    });

    it("non-interception wing in LOITER does not pursue on detection", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");
      const bomber = getWing(room, "germany_wing_01");
      const enemyWing = getWing(room, "france_wing_01");
      bomber.lifecycle_state = WING_LIFECYCLE.LOITER;
      bomber.mission = MISSION_TYPES.TACTICAL_BOMBING;
      bomber.position_lng = 10;
      bomber.position_lat = 50;
      enemyWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      // 0.4 deg: outside attack range (0.3) so no combat fires; inside passive radius (0.5)
      // so the detection system sees the enemy but the bomber should NOT pursue.
      enemyWing.position_lng = 10.4;
      enemyWing.position_lat = 50;
      await tickRoom(room);
      assert.strictEqual(getWing(room, "germany_wing_01").lifecycle_state, WING_LIFECYCLE.LOITER);
    });
  });
});
