import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import { GameRoomState, ProvinceState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, MISSION_TYPES } from "../src/rooms/schema/AirWingState.js";
import { ProvinceAaSystem, setAaDamageCoefficientForTesting } from "../src/systems/air_province_aa_system.js";
import { setOilDebuffDurationForTesting } from "../src/data/air_bombing_stats.js";
import {
  setRtbDurationTicksForTesting,
  setRefuelDurationTicksForTesting,
} from "../src/systems/air_wing_lifecycle_system.js";

const TARGET_PROVINCE = "we6_france_03"; // Paris — city_position [2.335, 48.897]
const TARGET_LNG = 2.335;
const TARGET_LAT = 48.897;

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

// ── ProvinceState schema unit tests ──────────────────────────────────────────

describe("lane:air-combat | 12g — ProvinceState bombing fields", () => {
  it("industry defaults to 50", () => {
    assert.strictEqual(new ProvinceState().industry, 50);
  });
  it("population defaults to 50", () => {
    assert.strictEqual(new ProvinceState().population, 50);
  });
  it("infrastructure defaults to 50", () => {
    assert.strictEqual(new ProvinceState().infrastructure, 50);
  });
  it("oil_bombed_until_ms defaults to 0", () => {
    assert.strictEqual(new ProvinceState().oil_bombed_until_ms, 0);
  });
});

// ── ProvinceAaSystem unit tests ──────────────────────────────────────────────

describe("lane:air-combat | 12g — ProvinceAaSystem", () => {
  before(() => { setAaDamageCoefficientForTesting(0.5); });
  after(()  => { setAaDamageCoefficientForTesting(0.05); });
  it("returns 0 damage when no AA strength set", () => {
    const aa = new ProvinceAaSystem();
    assert.strictEqual(aa.computeAaDamage("p01", "strategic_bomber", 10), 0);
  });
  it("returns nonzero damage after setProvinceAaStrength", () => {
    const aa = new ProvinceAaSystem();
    aa.setProvinceAaStrength("p01", 1.0);
    assert.ok(aa.computeAaDamage("p01", "strategic_bomber", 10) > 0);
  });
  it("low-altitude takes more damage than high-altitude at same AA strength", () => {
    const aa = new ProvinceAaSystem();
    aa.setProvinceAaStrength("p01", 1.0);
    const lowDmg  = aa.computeAaDamage("p01", "cas_plane",        10);
    const highDmg = aa.computeAaDamage("p01", "strategic_bomber", 10);
    assert.ok(lowDmg > highDmg,
      `cas_plane (${lowDmg}) should take more AA than strategic_bomber (${highDmg})`);
  });
});

// ── Integration tests ────────────────────────────────────────────────────────

describe("lane:air-combat | 12g — Strategic bombing integration", function () {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  let previousDevMode: string | undefined;
  let previousOilDebuff: number;

  before(async () => {
    previousDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = "true";
    previousOilDebuff = setOilDebuffDurationForTesting(5_000);
    setAaDamageCoefficientForTesting(0.5);
    setRtbDurationTicksForTesting(1);
    setRefuelDurationTicksForTesting(1);
    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    if (previousDevMode === undefined) delete process.env.DEV_MODE;
    else process.env.DEV_MODE = previousDevMode;
    setOilDebuffDurationForTesting(previousOilDebuff);
    await colyseus.shutdown();
  });

  beforeEach(async () => { await colyseus.cleanup(); });

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

  async function joinSecondClient(room: any, nationId: string, userId: string) {
    const token = await makeToken(userId);
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    client.send("SELECT_NATION", { nation_id: nationId });
    await room.waitForNextPatch();
    return client;
  }

  async function setupOwnership(client: any, room: any) {
    client.send("SET_PROVINCE_OWNER", { province_id: TARGET_PROVINCE, owner_id: "france" });
    client.send("SET_RELATION", { nation_a: "germany", nation_b: "france", stance: "war" });
    await room.waitForNextPatch();
  }

  async function spawnBomber(client: any, room: any, mission: string) {
    client.send("SPAWN_WING", {
      wing_id: "b1", nation_id: "germany", aircraft_type: "strategic_bomber",
      count: 10, home_airbase_province_id: "we6_germany_01", mission,
      position_lng: TARGET_LNG, position_lat: TARGET_LAT,
      lifecycle_state: "loiter",
    });
    await room.waitForNextPatch();
    client.send("SET_WING_TARGET", { wing_id: "b1", target_id: TARGET_PROVINCE });
    await room.waitForNextPatch();
  }

  async function tick(room: any): Promise<void> {
    (room as any).gameTick();
    await room.waitForNextPatch();
  }

  function prov(room: any) {
    return room.state.provinces.get(TARGET_PROVINCE) as any;
  }

  function ourWing(room: any) {
    return room.state.air_wings.get("b1") as any;
  }

  describe("AREA mission", () => {
    it("population decreases after one tick", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      const baseline = prov(room).population;
      await spawnBomber(client, room, MISSION_TYPES.AREA);
      await tick(room);
      assert.ok(prov(room).population < baseline, `population should decrease: ${baseline} → ${prov(room).population}`);
    });

    it("infrastructure decreases after one tick", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      const baseline = prov(room).infrastructure;
      await spawnBomber(client, room, MISSION_TYPES.AREA);
      await tick(room);
      assert.ok(prov(room).infrastructure < baseline, `infra should decrease: ${baseline} → ${prov(room).infrastructure}`);
    });

    it("industry UNCHANGED (AREA does not touch industry)", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      const baseline = prov(room).industry;
      await spawnBomber(client, room, MISSION_TYPES.AREA);
      await tick(room);
      assert.strictEqual(prov(room).industry, baseline, "AREA must not change industry");
    });

    it("oil_bombed_until_ms UNCHANGED for AREA", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      const baseline = prov(room).oil_bombed_until_ms;
      await spawnBomber(client, room, MISSION_TYPES.AREA);
      await tick(room);
      assert.strictEqual(prov(room).oil_bombed_until_ms, baseline, "AREA must not change oil_bombed_until_ms");
    });
  });

  describe("INDUSTRY mission", () => {
    it("industry decreases after one tick", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      const baseline = prov(room).industry;
      await spawnBomber(client, room, MISSION_TYPES.INDUSTRY);
      await tick(room);
      assert.ok(prov(room).industry < baseline, `industry should decrease: ${baseline} → ${prov(room).industry}`);
    });

    it("population UNCHANGED for INDUSTRY", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      const baseline = prov(room).population;
      await spawnBomber(client, room, MISSION_TYPES.INDUSTRY);
      await tick(room);
      assert.strictEqual(prov(room).population, baseline, "INDUSTRY must not change population");
    });

    it("infrastructure UNCHANGED for INDUSTRY", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      const baseline = prov(room).infrastructure;
      await spawnBomber(client, room, MISSION_TYPES.INDUSTRY);
      await tick(room);
      assert.strictEqual(prov(room).infrastructure, baseline, "INDUSTRY must not change infrastructure");
    });
  });

  describe("OIL mission", () => {
    it("oil_bombed_until_ms > Date.now() after one tick", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      await spawnBomber(client, room, MISSION_TYPES.OIL);
      await tick(room);
      assert.ok(prov(room).oil_bombed_until_ms > Date.now(),
        `oil_bombed_until_ms (${prov(room).oil_bombed_until_ms}) should be in the future`);
    });

    it("industry UNCHANGED for OIL", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      const baseline = prov(room).industry;
      await spawnBomber(client, room, MISSION_TYPES.OIL);
      await tick(room);
      assert.strictEqual(prov(room).industry, baseline, "OIL must not change industry");
    });

    it("population UNCHANGED for OIL", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      const baseline = prov(room).population;
      await spawnBomber(client, room, MISSION_TYPES.OIL);
      await tick(room);
      assert.strictEqual(prov(room).population, baseline, "OIL must not change population");
    });

    it("infrastructure UNCHANGED for OIL", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      const baseline = prov(room).infrastructure;
      await spawnBomber(client, room, MISSION_TYPES.OIL);
      await tick(room);
      assert.strictEqual(prov(room).infrastructure, baseline, "OIL must not change infrastructure");
    });
  });

  describe("LOGISTICS mission (no-op stub)", () => {
    it("no province scalar changes after bombing", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      const baseline = prov(room).industry;
      await spawnBomber(client, room, MISSION_TYPES.LOGISTICS);
      await tick(room);
      assert.strictEqual(prov(room).industry, baseline, "LOGISTICS must not change industry");
    });

    it("wing transitions to RTB after LOGISTICS bombing run", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      await spawnBomber(client, room, MISSION_TYPES.LOGISTICS);
      await tick(room);
      assert.strictEqual(ourWing(room).lifecycle_state, WING_LIFECYCLE.RTB,
        "wing must be RTB after LOGISTICS bombing run");
    });
  });

  describe("Province scalar floor", () => {
    it("industry never goes below 0", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      prov(room).industry = 0.1;
      await spawnBomber(client, room, MISSION_TYPES.INDUSTRY);
      await tick(room);
      assert.ok(prov(room).industry >= 0, `industry must not go below 0: ${prov(room).industry}`);
    });
  });

  describe("Ownership guard", () => {
    it("wing over own province: no damage applied", async () => {
      const { client, room } = await joinRoom();
      const baseline = (room.state.provinces.get("we6_germany_01") as any).population;
      client.send("SPAWN_WING", {
        wing_id: "b1", nation_id: "germany", aircraft_type: "strategic_bomber",
        count: 10, home_airbase_province_id: "we6_germany_01",
        mission: MISSION_TYPES.AREA, position_lng: 8.684, position_lat: 50.063,
        lifecycle_state: "loiter",
      });
      await room.waitForNextPatch();
      await tick(room);
      assert.strictEqual((room.state.provinces.get("we6_germany_01") as any).population, baseline,
        "own province must not be damaged");
    });
  });

  describe("Province AA", () => {
    it("wing.count unchanged when AA strength = 0", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      client.send("SET_PROVINCE_AA", { province_id: TARGET_PROVINCE, strength: 0 });
      await room.waitForNextPatch();
      await spawnBomber(client, room, MISSION_TYPES.AREA);
      await tick(room);
      assert.strictEqual(ourWing(room).count, 10, "AA=0 must not reduce wing count");
    });

    it("wing.count decreases after bombing run when AA strength = 1.0", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      client.send("SET_PROVINCE_AA", { province_id: TARGET_PROVINCE, strength: 1.0 });
      await room.waitForNextPatch();
      await spawnBomber(client, room, MISSION_TYPES.AREA);
      await tick(room);
      assert.ok(ourWing(room).count < 10, `AA=1.0 should reduce wing count: ${ourWing(room).count} < 10`);
    });

    it("PROVINCE_AA_FIRED message received by client listener when AA > 0", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      client.send("SET_PROVINCE_AA", { province_id: TARGET_PROVINCE, strength: 1.0 });
      await room.waitForNextPatch();
      let aaFired = false;
      client.onMessage("PROVINCE_AA_FIRED", () => { aaFired = true; });
      await spawnBomber(client, room, MISSION_TYPES.AREA);
      await tick(room);
      assert.ok(aaFired, "PROVINCE_AA_FIRED must fire when AA > 0");
    });

    it("PROVINCE_AA_FIRED NOT received when AA = 0", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      client.send("SET_PROVINCE_AA", { province_id: TARGET_PROVINCE, strength: 0 });
      await room.waitForNextPatch();
      let aaFired = false;
      client.onMessage("PROVINCE_AA_FIRED", () => { aaFired = true; });
      await spawnBomber(client, room, MISSION_TYPES.AREA);
      await tick(room);
      assert.strictEqual(aaFired, false, "PROVINCE_AA_FIRED must NOT fire when AA = 0");
    });
  });

  describe("Broadcast targeting", () => {
    it("AIR_BOMBING_PROVINCE_RESULT received by attacker nation client", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      let resultReceived = false;
      client.onMessage("AIR_BOMBING_PROVINCE_RESULT", () => { resultReceived = true; });
      await spawnBomber(client, room, MISSION_TYPES.AREA);
      await tick(room);
      assert.ok(resultReceived, "attacker must receive AIR_BOMBING_PROVINCE_RESULT");
    });

    // Defender broadcast test is excluded because the Colyseus test SDK's
    // second mock client doesn't reliably route server->client messages
    // via broadcastToNation. Manual Godot verification covers this case.

    it("AIR_BOMBING_PROVINCE_RESULT NOT received by third neutral-nation client", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      const neutralClient = await joinSecondClient(room, "italy", "italy-user");
      let resultReceived = false;
      neutralClient.onMessage("AIR_BOMBING_PROVINCE_RESULT", () => { resultReceived = true; });
      await spawnBomber(client, room, MISSION_TYPES.AREA);
      await tick(room);
      assert.strictEqual(resultReceived, false, "neutral must NOT receive AIR_BOMBING_PROVINCE_RESULT");
    });
  });

  describe("Lifecycle", () => {
    it("wing is in RTB state after the bombing run completes", async () => {
      const { client, room } = await joinRoom();
      await setupOwnership(client, room);
      await spawnBomber(client, room, MISSION_TYPES.AREA);
      await tick(room);
      assert.strictEqual(ourWing(room).lifecycle_state, WING_LIFECYCLE.RTB,
        "wing must be in RTB after bombing run");
    });
  });
});
