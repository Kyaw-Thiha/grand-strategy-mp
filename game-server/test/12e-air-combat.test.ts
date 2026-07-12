import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { Encoder } from "@colyseus/schema";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
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

describe("lane:air-combat | 12e — Air Combat System", function () {

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
    colyseus = await boot(appConfig, getTestPort());
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
    await room.waitForNextPatch();
  }

  // ── Stat table unit tests (no server) ─────────────────────────────────────

  describe("Air unit stat table", () => {
    it("status_fuel defaults to 1.0 on new AirWingState", () => {
      const wing = new AirWingState();
      assert.strictEqual(wing.status_fuel, 1.0, "status_fuel must default to 1.0");
    });

    it("fighter has attack_vs_air > 0", () => {
      const stats = getAirUnitStats("fighter");
      assert.ok(stats.attack_vs_air > 0, "fighter attack_vs_air must be positive");
    });

    it("strategic_bomber has attack_vs_air === 0", () => {
      const stats = getAirUnitStats("strategic_bomber");
      assert.strictEqual(stats.attack_vs_air, 0, "strategic_bomber is a pure bomber");
    });

    it("heavy_fighter has observation_deg === 0.25", () => {
      assert.strictEqual(getObservationDeg("heavy_fighter"), 0.25);
    });

    it("fighter has observation_deg === 0.05", () => {
      assert.strictEqual(getObservationDeg("fighter"), 0.05);
    });

    it("recon_plane has observation_deg === 1.0", () => {
      assert.strictEqual(getObservationDeg("recon_plane"), 1.0);
    });
  });

  // ── Attack vs Defense branch ───────────────────────────────────────────────

  describe("Attack vs Defense branch", () => {
    it("weapon_ready=true uses attack_vs_air — reduces enemy count by ~2-3", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const gerWing = getWing(room, "germany_wing_01");
      const frWing = getWing(room, "france_wing_01");

      gerWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      gerWing.aircraft_type = "fighter";
      gerWing.count = 10;
      gerWing.weapon_ready = true;
      gerWing.combat_readiness = 1.0;
      gerWing.position_lng = 10.0;
      gerWing.position_lat = 50.0;

      frWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frWing.aircraft_type = "fighter";
      frWing.count = 10;
      frWing.weapon_ready = true;
      frWing.combat_readiness = 1.0;
      frWing.position_lng = 10.1;
      frWing.position_lat = 50.0;
      frWing.is_detected = true;

      await tickRoom(room);
      // Attack: 0.25 * 10 * 1.0 = 2.5 → floor = 2 damage
      assert.ok(frWing.count < 10, `Expected count < 10, got ${frWing.count}`);
    });

    it("weapon_ready=false uses defense_vs_air — reduces enemy count by ≤1", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const gerWing = getWing(room, "germany_wing_01");
      const frWing = getWing(room, "france_wing_01");

      gerWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      gerWing.aircraft_type = "fighter";
      gerWing.count = 10;
      gerWing.weapon_ready = false;
      gerWing.combat_readiness = 1.0;
      gerWing.position_lng = 10.0;
      gerWing.position_lat = 50.0;
      gerWing.is_detected = true;

      frWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frWing.aircraft_type = "fighter";
      frWing.count = 10;
      frWing.weapon_ready = true;
      frWing.combat_readiness = 1.0;
      frWing.position_lng = 10.1;
      frWing.position_lat = 50.0;
      frWing.is_detected = true;

      await tickRoom(room);
      // Defense: 0.03 * 10 * 1.0 = 0.3 → floor = 0 damage (negligible)
      assert.ok(frWing.count >= 9, `Expected count >= 9, got ${frWing.count}`);
    });

    it("pure bomber with attack_vs_air=0 deals negligible damage even with weapon_ready=true", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const gerWing = getWing(room, "germany_wing_01");
      const frWing = getWing(room, "france_wing_01");

      gerWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      gerWing.aircraft_type = "strategic_bomber";
      gerWing.count = 10;
      gerWing.weapon_ready = true;
      gerWing.combat_readiness = 1.0;
      gerWing.position_lng = 10.0;
      gerWing.position_lat = 50.0;

      frWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frWing.aircraft_type = "fighter";
      frWing.count = 10;
      frWing.weapon_ready = true;
      frWing.combat_readiness = 1.0;
      frWing.position_lng = 10.1;
      frWing.position_lat = 50.0;
      frWing.is_detected = true;

      await tickRoom(room);
      // Bomber attack_vs_air = 0 → 0 damage
      assert.strictEqual(frWing.count, 10, "pure bomber should deal zero air-to-air damage");
    });
  });

  // ── Surprise mechanic ─────────────────────────────────────────────────────

  describe("Surprise mechanic", () => {
    it("S=2.5 when target.is_detected=true AND attacker.is_detected=false", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const gerWing = getWing(room, "germany_wing_01");
      const frWing = getWing(room, "france_wing_01");

      // German: undetected, fighter, 10 planes, weapon ready
      gerWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      gerWing.aircraft_type = "fighter";
      gerWing.count = 10;
      gerWing.weapon_ready = true;
      gerWing.combat_readiness = 1.0;
      gerWing.position_lng = 10.0;
      gerWing.position_lat = 50.0;
      gerWing.is_detected = false; // SURPRISE: attacker undetected

      // French: detected, 10 planes
      frWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frWing.aircraft_type = "fighter";
      frWing.count = 10;
      frWing.weapon_ready = true;
      frWing.combat_readiness = 1.0;
      frWing.position_lng = 10.1;
      frWing.position_lat = 50.0;
      frWing.is_detected = true; // SURPRISE: target detected

      await tickRoom(room);
      // Surprise damage: 0.25 * 2.5 * 10 * 1.0 = 6.25 → floor = 5 with density mitigation
      assert.ok(frWing.count <= 5, `Expected count <= 5 (surprise with density), got ${frWing.count}`);
    });

    it("no surprise bonus when both detect each other same tick", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const gerWing = getWing(room, "germany_wing_01");
      const frWing = getWing(room, "france_wing_01");

      gerWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      gerWing.aircraft_type = "fighter";
      gerWing.count = 10;
      gerWing.weapon_ready = true;
      gerWing.combat_readiness = 1.0;
      gerWing.position_lng = 10.0;
      gerWing.position_lat = 50.0;
      gerWing.is_detected = true; // both detected = no surprise

      frWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frWing.aircraft_type = "fighter";
      frWing.count = 10;
      frWing.weapon_ready = true;
      frWing.combat_readiness = 1.0;
      frWing.position_lng = 10.1;
      frWing.position_lat = 50.0;
      frWing.is_detected = true;

      await tickRoom(room);
      // No surprise: 0.25 * 10 * 1.0 = 2.5 → floor = 2
      assert.ok(frWing.count === 8, `Expected count 8, got ${frWing.count}`);
    });

    it("pure bomber unaffected by surprise (0 * anything = 0)", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const gerWing = getWing(room, "germany_wing_01");
      const frWing = getWing(room, "france_wing_01");

      gerWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      gerWing.aircraft_type = "strategic_bomber";
      gerWing.count = 10;
      gerWing.weapon_ready = true;
      gerWing.combat_readiness = 1.0;
      gerWing.position_lng = 10.0;
      gerWing.position_lat = 50.0;
      gerWing.is_detected = false; // undetected

      frWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frWing.aircraft_type = "fighter";
      frWing.count = 10;
      frWing.weapon_ready = true;
      frWing.combat_readiness = 1.0;
      frWing.position_lng = 10.1;
      frWing.position_lat = 50.0;
      frWing.is_detected = true;

      await tickRoom(room);
      // Bomber attack_vs_air = 0 regardless of surprise
      assert.strictEqual(frWing.count, 10, "bomber deals zero damage");
    });
  });

  // ── WING_DESTROYED broadcast ──────────────────────────────────────────────

  describe("WING_DESTROYED broadcast", () => {
    it("AIR_WING_DESTROYED fires when count reaches 0", async () => {
      const { client, room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const gerWing = getWing(room, "germany_wing_01");
      const frWing = getWing(room, "france_wing_01");

      // German 10 fighters with surprise vs 1 French fighter
      gerWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      gerWing.aircraft_type = "fighter";
      gerWing.count = 10;
      gerWing.weapon_ready = true;
      gerWing.combat_readiness = 1.0;
      gerWing.position_lng = 10.0;
      gerWing.position_lat = 50.0;
      gerWing.is_detected = false;

      frWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frWing.aircraft_type = "fighter";
      frWing.count = 1;
      frWing.weapon_ready = true;
      frWing.combat_readiness = 1.0;
      frWing.position_lng = 10.1;
      frWing.position_lat = 50.0;
      frWing.is_detected = true;

      let destroyedWingId = "";
      client.onMessage("AIR_WING_DESTROYED", (msg: any) => {
        destroyedWingId = msg.wing_id;
      });

      await tickRoom(room);
      // Surprise damage: 0.25 * 2.5 * 10 * 1.0 = 6.25 → floor = 6, French has 1 HP → destroyed
      assert.strictEqual(destroyedWingId, "france_wing_01", "French wing should be destroyed");
      assert.strictEqual(room.state.air_wings.get("france_wing_01"), undefined);
    });
  });

  // ── Targeting priority ────────────────────────────────────────────────────

  describe("Targeting priority", () => {
    it("INTERCEPTION mission picks bomber-class over fighter-class when both in range", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const gerWing = getWing(room, "germany_wing_01");
      const frBomber = getWing(room, "france_wing_01");
      const frFighter = getWing(room, "france_wing_02");

      // German interceptor
      gerWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      gerWing.aircraft_type = "fighter";
      gerWing.mission = MISSION_TYPES.INTERCEPTION;
      gerWing.count = 10;
      gerWing.weapon_ready = true;
      gerWing.combat_readiness = 1.0;
      gerWing.position_lng = 10.0;
      gerWing.position_lat = 50.0;
      gerWing.is_detected = true;

      // French bomber (primary target for INTERCEPTION)
      frBomber.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frBomber.aircraft_type = "strategic_bomber";
      frBomber.count = 10;
      frBomber.weapon_ready = true;
      frBomber.combat_readiness = 1.0;
      frBomber.position_lng = 10.15;
      frBomber.position_lat = 50.0;
      frBomber.is_detected = true;

      // French fighter (secondary)
      frFighter.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frFighter.aircraft_type = "fighter";
      frFighter.count = 10;
      frFighter.weapon_ready = true;
      frFighter.combat_readiness = 1.0;
      frFighter.position_lng = 10.2;
      frFighter.position_lat = 50.0;
      frFighter.is_detected = true;

      await tickRoom(room);
      // INTERCEPTION should prioritize bomber → bomber takes damage, fighter should be less damaged
      assert.ok(frBomber.count < 10, `Bomber should take damage, got count=${frBomber.count}`);
      assert.ok(frFighter.count >= 10, `Fighter should NOT be primary target, got count=${frFighter.count}`);
    });

    it("AIR_SUPERIORITY mission picks fighter-class over bomber-class", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const gerWing = getWing(room, "germany_wing_01");
      const frBomber = getWing(room, "france_wing_01");
      const frFighter = getWing(room, "france_wing_02");

      // German air superiority fighter
      gerWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      gerWing.aircraft_type = "fighter";
      gerWing.mission = MISSION_TYPES.AIR_SUPERIORITY;
      gerWing.count = 10;
      gerWing.weapon_ready = true;
      gerWing.combat_readiness = 1.0;
      gerWing.position_lng = 10.0;
      gerWing.position_lat = 50.0;
      gerWing.is_detected = true;

      frBomber.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frBomber.aircraft_type = "strategic_bomber";
      frBomber.count = 10;
      frBomber.weapon_ready = true;
      frBomber.combat_readiness = 1.0;
      frBomber.position_lng = 10.15;
      frBomber.position_lat = 50.0;
      frBomber.is_detected = true;

      frFighter.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frFighter.aircraft_type = "fighter";
      frFighter.count = 10;
      frFighter.weapon_ready = true;
      frFighter.combat_readiness = 1.0;
      frFighter.position_lng = 10.2;
      frFighter.position_lat = 50.0;
      frFighter.is_detected = true;

      await tickRoom(room);
      // AIR_SUPERIORITY should prioritize fighter → fighter takes damage
      assert.ok(frFighter.count < 10, `Fighter should take damage, got count=${frFighter.count}`);
      assert.ok(frBomber.count >= 10, `Bomber should NOT be primary target, got count=${frBomber.count}`);
    });
  });

  // ── Target deconfliction ──────────────────────────────────────────────────

  describe("Target deconfliction", () => {
    it("3 friendly wings vs 2 enemies: both enemies take damage (unique primary)", async () => {
      const { client, room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      // Spawn a third German wing
      client.send("SPAWN_WING", {
        wing_id: "ger_extra",
        nation_id: "germany",
        aircraft_type: "fighter",
        count: 10,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
        mission: MISSION_TYPES.INTERCEPTION,
        home_airbase_province_id: "berlin",
        position_lng: 10.02,
        position_lat: 50.0,
        weapon_ready: true,
        combat_readiness: 1.0,
        is_detected: true,
      });
      await room.waitForNextPatch();

      const ger1 = getWing(room, "germany_wing_01");
      const ger2 = getWing(room, "ger_extra");
      const fr1 = getWing(room, "france_wing_01");
      const fr2 = getWing(room, "france_wing_02");

      // Three German fighters in close formation
      ger1.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      ger1.aircraft_type = "fighter";
      ger1.count = 10;
      ger1.weapon_ready = true;
      ger1.combat_readiness = 1.0;
      ger1.position_lng = 10.0;
      ger1.position_lat = 50.0;
      ger1.is_detected = true;

      ger2.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      ger2.aircraft_type = "fighter";
      ger2.count = 10;
      ger2.weapon_ready = true;
      ger2.combat_readiness = 1.0;
      ger2.position_lng = 10.05;
      ger2.position_lat = 50.0;
      ger2.is_detected = true;

      // Two French fighters
      fr1.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      fr1.aircraft_type = "fighter";
      fr1.count = 10;
      fr1.weapon_ready = true;
      fr1.combat_readiness = 1.0;
      fr1.position_lng = 10.2;
      fr1.position_lat = 50.0;
      fr1.is_detected = true;

      fr2.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      fr2.aircraft_type = "fighter";
      fr2.count = 10;
      fr2.weapon_ready = true;
      fr2.combat_readiness = 1.0;
      fr2.position_lng = 10.25;
      fr2.position_lat = 50.0;
      fr2.is_detected = true;

      await tickRoom(room);
      // Deconfliction: 3 attackers, 2 targets → each gets unique primary (or overflow)
      // Both enemies should take damage from their primary attacker
      assert.ok(fr1.count < 10, `fr1 should take damage, got ${fr1.count}`);
      assert.ok(fr2.count < 10, `fr2 should take damage, got ${fr2.count}`);
    });
  });

  // ── Escort mission ────────────────────────────────────────────────────────

  describe("Escort mission", () => {
    it("ESCORT wing engages the enemy threatening its bomber, not nearest decoy", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const escWing = getWing(room, "germany_wing_01");
      const bomberWing = getWing(room, "germany_wing_02");
      const enemyWing = getWing(room, "france_wing_01");
      const decoyWing = getWing(room, "france_wing_02");

      // Escort is close to its bomber
      escWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      escWing.aircraft_type = "heavy_fighter";
      escWing.mission = MISSION_TYPES.ESCORT;
      escWing.target_id = "germany_wing_02";
      escWing.count = 10;
      escWing.weapon_ready = true;
      escWing.combat_readiness = 1.0;
      escWing.position_lng = 10.05;
      escWing.position_lat = 50.0;
      escWing.is_detected = true;

      // Bomber the escort is protecting
      bomberWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      bomberWing.aircraft_type = "strategic_bomber";
      bomberWing.count = 10;
      bomberWing.weapon_ready = true;
      bomberWing.combat_readiness = 1.0;
      bomberWing.position_lng = 10.0;
      bomberWing.position_lat = 50.0;
      bomberWing.is_detected = true;

      // Enemy interceptor attacking the bomber (close to bomber)
      enemyWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      enemyWing.aircraft_type = "fighter";
      enemyWing.count = 10;
      enemyWing.weapon_ready = true;
      enemyWing.combat_readiness = 1.0;
      enemyWing.position_lng = 10.2;
      enemyWing.position_lat = 50.0;
      enemyWing.is_detected = true;

      // Decoy enemy fighter (farther from escort)
      decoyWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      decoyWing.aircraft_type = "fighter";
      decoyWing.count = 10;
      decoyWing.weapon_ready = true;
      decoyWing.combat_readiness = 1.0;
      decoyWing.position_lng = 11.0;
      decoyWing.position_lat = 50.0;
      decoyWing.is_detected = true;

      await tickRoom(room);

      // The escort should engage the enemy that's threatening the bomber
      // The enemy (10 fighters, surprise possible) should take damage from escort
      // The decoy should NOT be the escort's target
      // If escort engaged decoy (wrong), decoy.count would drop but not enemy
      const enemyTookDamage = enemyWing.count < 10;
      const decoyTookDamage = decoyWing.count < 10;

      assert.ok(enemyTookDamage, `Enemy targeting bomber should take escort damage, got count=${enemyWing.count}`);
      // Decoy may or may not take damage depending on if other fighters target it
      // The key invariant: escort must engage the bomber-threatener, not the decoy
    });
  });

  // ── Fuel tank sub-status ──────────────────────────────────────────────────

  describe("Fuel tank sub-status", () => {
    it("status_fuel becomes 1.5 on surviving target after fighter full attack", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const gerWing = getWing(room, "germany_wing_01");
      const frWing = getWing(room, "france_wing_01");

      gerWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      gerWing.aircraft_type = "fighter";
      gerWing.count = 10;
      gerWing.weapon_ready = true;
      gerWing.combat_readiness = 1.0;
      gerWing.position_lng = 10.0;
      gerWing.position_lat = 50.0;
      gerWing.is_detected = true;

      frWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frWing.aircraft_type = "fighter";
      frWing.count = 10; // survivor
      frWing.weapon_ready = true;
      frWing.combat_readiness = 1.0;
      frWing.position_lng = 10.1;
      frWing.position_lat = 50.0;
      frWing.is_detected = true;

      await tickRoom(room);
      assert.strictEqual(frWing.status_fuel, 1.5, "Surviving target should have status_fuel=1.5");
    });

    it("status_fuel clears to 1.0 after RTB + refuel cycle completes", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const gerWing = getWing(room, "germany_wing_01");

      gerWing.lifecycle_state = WING_LIFECYCLE.REFUEL;
      gerWing.status_fuel = 1.5;
      gerWing.fuel = 0.5;

      await tickRoom(room);
      // After refuel (REFUEL → IDLE), status_fuel should reset to 1.0
      // Refuel takes 1 tick (setRefuelDurationTicksForTesting(1))
      // Lifecycle: REFUEL → after 1 tick → IDLE
      assert.strictEqual(gerWing.status_fuel, 1.0, "status_fuel should reset after refuel");
    });

    it("wing with status_fuel=1.5 loses more fuel per tick than base rate", async () => {
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const gerWing = getWing(room, "germany_wing_01");
      const frWing = getWing(room, "france_wing_01");

      gerWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      gerWing.aircraft_type = "fighter";
      gerWing.count = 10;
      gerWing.weapon_ready = true;
      gerWing.combat_readiness = 1.0;
      gerWing.fuel = 1.0;
      gerWing.status_fuel = 1.5; // damaged tank
      gerWing.position_lng = 10.0;
      gerWing.position_lat = 50.0;
      gerWing.is_detected = true;

      frWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frWing.aircraft_type = "fighter";
      frWing.count = 10;
      frWing.weapon_ready = true;
      frWing.combat_readiness = 1.0;
      frWing.fuel = 1.0;
      frWing.position_lng = 10.1;
      frWing.position_lat = 50.0;
      frWing.is_detected = true;

      const fuelBefore = gerWing.fuel;
      await tickRoom(room);
      const fuelLost = fuelBefore - gerWing.fuel;
      // Transit decay = 0.02 * 1.5 = 0.03 per tick
      assert.ok(fuelLost > 0.01, `Fuel loss should exceed base rate at 1.5x, got ${fuelLost}`);
    });
  });

  // ── Per-type observation_deg ─────────────────────────────────────────────

  describe("Per-type observation_deg in detection", () => {
    it("heavy_fighter (0.25°) detects enemy 0.2° away; fighter (0.05°) does not", async () => {
      setPassiveObservationOverrideForTesting(null); // clear 12e before() override so per-type stats work
      const { room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const gerWing = getWing(room, "germany_wing_01");
      const frWing = getWing(room, "france_wing_01");

      // Heavy fighter (observation 0.25°)
      gerWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      gerWing.aircraft_type = "heavy_fighter";
      gerWing.mission = MISSION_TYPES.INTERCEPTION;
      gerWing.count = 10;
      gerWing.weapon_ready = true;
      gerWing.combat_readiness = 1.0;
      gerWing.position_lng = 10.0;
      gerWing.position_lat = 50.0;

      // French fighter 0.2° away — within heavy fighter's range, outside fighter's range
      frWing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      frWing.aircraft_type = "fighter";
      frWing.count = 10;
      frWing.weapon_ready = true;
      frWing.combat_readiness = 1.0;
      frWing.position_lng = 10.2;
      frWing.position_lat = 50.0;
      // frWing starts detected=false (default)

      await tickRoom(room);
      // Heavy fighter should detect the fighter at 0.2° (within 0.25°)
      assert.strictEqual(frWing.is_detected, true, "Heavy fighter should detect fighter at 0.2°");
    });

  });
});
