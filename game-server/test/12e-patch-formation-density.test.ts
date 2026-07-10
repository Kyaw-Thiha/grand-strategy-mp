import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { Encoder } from "@colyseus/schema";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { AirWingState, WING_LIFECYCLE, MISSION_TYPES } from "../src/rooms/schema/AirWingState.js";
import {
  setAttackRangeForTesting,
  setSurpriseMultiplierForTesting,
} from "../src/systems/air_combat_system.js";
import {
  setRtbDurationTicksForTesting,
  setRefuelDurationTicksForTesting,
  setReadinessDecayForTesting,
  setReadinessRecoveryForTesting,
  setFuelDecayTransitForTesting,
  setFuelDecayLoiterForTesting,
  setFuelRecoveryForTesting,
} from "../src/systems/air_wing_lifecycle_system.js";
import { setPassiveWingRadiusForTesting } from "../src/systems/air_detection_system.js";
import { getAirUnitStats, getObservationDeg, setPassiveObservationOverrideForTesting } from "../src/data/air_unit_stats.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("12e-patch — Formation Density & Escort Path", function () {
  this.timeout(180_000);

  let colyseus: ColyseusTestServer<typeof appConfig>;
  let previousDevMode: string | undefined;

  before(async () => {
    previousDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = "true";
    Encoder.BUFFER_SIZE = 256 * 1024;
    setPassiveWingRadiusForTesting(0.01);
    setAttackRangeForTesting(0.3);
    setSurpriseMultiplierForTesting(2.5);
    setRtbDurationTicksForTesting(2);
    setRefuelDurationTicksForTesting(1);
    setReadinessDecayForTesting(0.001);
    setReadinessRecoveryForTesting(0.5);
    setFuelDecayTransitForTesting(0.02);
    setFuelDecayLoiterForTesting(0.008);
    setFuelRecoveryForTesting(0.2);
    colyseus = await boot(appConfig);
  });

  after(async () => {
    if (previousDevMode === undefined) delete process.env.DEV_MODE;
    else process.env.DEV_MODE = previousDevMode;
    setPassiveWingRadiusForTesting(0.1);
    setPassiveObservationOverrideForTesting(null);
    setAttackRangeForTesting(0.3);
    setSurpriseMultiplierForTesting(2.5);
    setRtbDurationTicksForTesting(5);
    setRefuelDurationTicksForTesting(5);
    setReadinessDecayForTesting(0.015);
    setReadinessRecoveryForTesting(0.04);
    setFuelDecayTransitForTesting(0.01);
    setFuelDecayLoiterForTesting(0.01);
    setFuelRecoveryForTesting(0.2);
    await new Promise(r => setTimeout(r, 300));
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
    setPassiveObservationOverrideForTesting(null);
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

  async function tickRoom(room: any): Promise<void> {
    (room as any).gameTick();
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Step 1: Escort Path Mirroring ─────────────────────────────────────────

  describe("Escort path mirroring", () => {
    it("escort wing.path_gen_id matches bomber wing.path_gen_id after tick", async () => {
      const { client, room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      // Use germany_wing_01 as bomber — move it to a known position
      const bomber = getWing(room, "germany_wing_01");
      bomber.aircraft_type = "strategic_bomber";
      bomber.position_lng = 10.0;
      bomber.position_lat = 50.0;
      bomber.is_detected = true;

      // Spawn escort that references the bomber
      client.send("SPAWN_WING", {
        wing_id: "escort_01",
        nation_id: "germany",
        aircraft_type: "heavy_fighter",
        count: 5,
        mission: MISSION_TYPES.ESCORT,
        home_airbase_province_id: "berlin",
        position_lng: 10.01,
        position_lat: 50.0,
        weapon_ready: true,
        combat_readiness: 1.0,
      });
      await room.waitForNextPatch();
      // SPAWN_WING does not set target_id; use the dedicated handler
      client.send("SET_WING_TARGET", { wing_id: "escort_01", target_id: "germany_wing_01" });
      await room.waitForNextPatch();

      const escort = getWing(room, "escort_01");
      escort.is_detected = true;

      // Assign a mission to the bomber to create a real Dubins transit path
      // Target another wing (france_wing_01) so _resolveTargetPosition finds it
      client.send("ASSIGN_WING_MISSION", {
        wing_id: "germany_wing_01",
        mission: MISSION_TYPES.TACTICAL_BOMBING,
        target_id: "france_wing_01",
      });
      await room.waitForNextPatch();

      // Now the bomber should have a path_gen_id and an active path
      assert.ok(bomber.path_gen_id, "bomber should have path_gen_id after ASSIGN_WING_MISSION");

      // Put escort in TRANSIT so path sync applies
      escort.lifecycle_state = WING_LIFECYCLE.TRANSIT;

      assert.ok(bomber.path_gen_id, `bomber path_gen_id before tick: "${bomber.path_gen_id}"`);
      await tickRoom(room);

      assert.ok(escort.path_gen_id, "escort should have a path_gen_id after tick");
      assert.strictEqual(escort.path_gen_id, bomber.path_gen_id,
        `escort path_gen_id (${escort.path_gen_id}) should match bomber (${bomber.path_gen_id})`);
      assert.strictEqual(escort.path_elapsed_ms, bomber.path_elapsed_ms,
        `escort path_elapsed_ms (${escort.path_elapsed_ms}) should match bomber (${bomber.path_elapsed_ms})`);
    });

    it("escort path_elapsed_ms follows bomber each tick", async () => {
      const { client, room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const bomber = getWing(room, "germany_wing_01");
      bomber.aircraft_type = "strategic_bomber";
      bomber.position_lng = 10.0;
      bomber.position_lat = 50.0;

      client.send("SPAWN_WING", {
        wing_id: "escort_01",
        nation_id: "germany",
        aircraft_type: "heavy_fighter",
        count: 5,
        mission: MISSION_TYPES.ESCORT,
        home_airbase_province_id: "berlin",
        position_lng: 10.01,
        position_lat: 50.0,
        weapon_ready: true,
        combat_readiness: 1.0,
      });
      await room.waitForNextPatch();
      client.send("SET_WING_TARGET", { wing_id: "escort_01", target_id: "germany_wing_01" });
      await room.waitForNextPatch();

      const escort = getWing(room, "escort_01");
      escort.lifecycle_state = WING_LIFECYCLE.TRANSIT;

      client.send("ASSIGN_WING_MISSION", {
        wing_id: "germany_wing_01",
        mission: MISSION_TYPES.TACTICAL_BOMBING,
        target_id: "france_wing_01",
      });
      await room.waitForNextPatch();

      assert.ok(bomber.path_gen_id, "bomber should have a path");

      await tickRoom(room);
      assert.strictEqual(escort.path_elapsed_ms, bomber.path_elapsed_ms,
        "tick 1: escort should match bomber");

      await tickRoom(room);
      assert.strictEqual(escort.path_elapsed_ms, bomber.path_elapsed_ms,
        "tick 2: escort should match bomber");

      await tickRoom(room);
      assert.strictEqual(escort.path_elapsed_ms, bomber.path_elapsed_ms,
        "tick 3: escort should match bomber");
    });

    it("non-ESCORT wing is unaffected by path sync", async () => {
      const { client, room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const bomber = getWing(room, "germany_wing_01");
      bomber.aircraft_type = "strategic_bomber";
      bomber.position_lng = 10.0;
      bomber.position_lat = 50.0;

      const interceptor = getWing(room, "germany_wing_02");
      interceptor.aircraft_type = "fighter";
      interceptor.position_lng = 10.02;
      interceptor.position_lat = 50.0;
      interceptor.lifecycle_state = WING_LIFECYCLE.TRANSIT;

      client.send("ASSIGN_WING_MISSION", {
        wing_id: "germany_wing_01",
        mission: MISSION_TYPES.TACTICAL_BOMBING,
        target_id: "france_wing_01",
      });
      await room.waitForNextPatch();

      assert.ok(bomber.path_gen_id, "bomber should have a path");

      const interceptorPathBefore = interceptor.path_gen_id;

      await tickRoom(room);

      assert.strictEqual(interceptor.path_gen_id, interceptorPathBefore,
        "non-ESCORT wing path should remain unchanged");
      assert.notStrictEqual(interceptor.path_gen_id, bomber.path_gen_id,
        "non-ESCORT wing should NOT match bomber's path");
    });
  });

  // ── Step 2: Sub-Status Schema Fields ──────────────────────────────────────

  describe("AirWingState sub-status fields", () => {
    it("status_engine defaults to 1.0", () => {
      assert.strictEqual(new AirWingState().status_engine, 1.0);
    });
    it("status_weapons defaults to 1.0", () => {
      assert.strictEqual(new AirWingState().status_weapons, 1.0);
    });
    it("status_instruments defaults to 1.0", () => {
      assert.strictEqual(new AirWingState().status_instruments, 1.0);
    });
  });
});
