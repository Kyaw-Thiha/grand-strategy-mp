import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { Encoder } from "@colyseus/schema";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE } from "../src/rooms/schema/AirWingState.js";
import { setEngagementRangeForTesting } from "../src/systems/air_dubins_pathfinder.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("lane:visibility | 12j — ServerVisibilitySystem AOI", function () {

  let colyseus: ColyseusTestServer<typeof appConfig>;
  let previousDevMode: string | undefined;

  before(async () => {
    previousDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = "true";
    Encoder.BUFFER_SIZE = 256 * 1024;
    setEngagementRangeForTesting(0); // visibility tests must not trigger combat
    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    if (previousDevMode === undefined) delete process.env.DEV_MODE;
    else process.env.DEV_MODE = previousDevMode;
    setEngagementRangeForTesting(0.3);
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  // ─── helpers ─────────────────────────────────────────────────────────────

  /** Single-player room — joins as germany by default. */
  async function joinRoom(nationId = "germany") {
    process.env.DEV_MODE = "true";
    const token = await makeToken();
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    client.send("SELECT_NATION", { nation_id: nationId });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    return { client, room };
  }

  /** Two-player room — follows the same pre-startGame pattern as 12d multi-client tests. */
  async function joinTwoClients(nation1 = "germany", nation2 = "france") {
    process.env.DEV_MODE = "true";
    const token1 = await makeToken("user-1");
    const token2 = await makeToken("user-2");
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client1 = await colyseus.connectTo(room, { token: token1 });
    const client2 = await colyseus.connectTo(room, { token: token2 });
    await room.waitForNextPatch();
    client1.send("SELECT_NATION", { nation_id: nation1 });
    client2.send("SELECT_NATION", { nation_id: nation2 });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    return { client1, client2, room };
  }

  /** Three-player room. */
  async function joinThreeClients(nation1 = "germany", nation2 = "france", nation3 = "united_kingdom") {
    process.env.DEV_MODE = "true";
    const token1 = await makeToken("user-1");
    const token2 = await makeToken("user-2");
    const token3 = await makeToken("user-3");
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client1 = await colyseus.connectTo(room, { token: token1 });
    const client2 = await colyseus.connectTo(room, { token: token2 });
    const client3 = await colyseus.connectTo(room, { token: token3 });
    await room.waitForNextPatch();
    client1.send("SELECT_NATION", { nation_id: nation1 });
    client2.send("SELECT_NATION", { nation_id: nation2 });
    client3.send("SELECT_NATION", { nation_id: nation3 });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    return { client1, client2, client3, room };
  }

  function setRelation(room: any, nationA: string, nationB: string, stance: string): void {
    const relation = room.state.relations.get(`${nationA}|${nationB}`)
      ?? room.state.relations.get(`${nationB}|${nationA}`);
    assert.ok(relation, `missing relation ${nationA}|${nationB}`);
    relation.stance = stance;
  }

  async function tickRoom(room: any): Promise<void> {
    (room as any).gameTick();
    await room.waitForNextPatch();
  }

  // ─── Division visibility tests ───────────────────────────────────────────

  describe("Division visibility", () => {

    it("own nation always sees own divisions", async () => {
      const { client, room } = await joinRoom("germany");

      const appeared: any[] = [];
      const updates: any[] = [];
      client.onMessage("DIVISION_APPEARED", (data: any) => appeared.push(data));
      client.onMessage("DIVISION_UPDATES", (data: any) => updates.push(data));

      // Spawn a german division
      client.send("SPAWN_DIVISION", {
        division_id: "ger_div_01",
        nation_id: "germany",
        position_lng: 10.0,
        position_lat: 51.0,
      });
      await room.waitForNextPatch();

      await tickRoom(room);

      // Germany should see its own division via DIVISION_APPEARED or DIVISION_UPDATES
      const sawOwnDivision =
        appeared.some((d: any) => d.division_id === "ger_div_01") ||
        updates.some((d: any) =>
          Array.isArray(d.divisions) && d.divisions.some((div: any) => div.division_id === "ger_div_01")
        );
      assert.ok(sawOwnDivision, "Germany should receive its own division after tick");
    });

    it("enemy division not visible without detection", async () => {
      const { client1, room } = await joinTwoClients("germany", "france");

      setRelation(room, "germany", "france", "war");

      const germanyAppeared: any[] = [];
      const germanyDivUpdates: any[] = [];
      client1.onMessage("DIVISION_APPEARED", (data: any) => germanyAppeared.push(data));
      client1.onMessage("DIVISION_UPDATES", (data: any) => germanyDivUpdates.push(data));

      // Spawn french division far from any german units (lng=50, lat=50)
      client1.send("SPAWN_DIVISION", {
        division_id: "fra_div_far",
        nation_id: "france",
        position_lng: 50.0,
        position_lat: 50.0,
      });
      await room.waitForNextPatch();

      await tickRoom(room);

      // Germany should NOT see the far away french division
      const sawEnemy =
        germanyAppeared.some((d: any) => d.division_id === "fra_div_far") ||
        germanyDivUpdates.some((d: any) =>
          Array.isArray(d.divisions) && d.divisions.some((div: any) => div.division_id === "fra_div_far")
        );
      assert.strictEqual(sawEnemy, false, "Germany must not see undetected enemy division");
    });

    it("land-to-land observation reveals enemy division", async () => {
      const { client1, room } = await joinTwoClients("germany", "france");

      setRelation(room, "germany", "france", "war");

      // Spawn german division with observation radius at (10, 50)
      client1.send("SPAWN_DIVISION", {
        division_id: "ger_div_obs",
        nation_id: "germany",
        position_lng: 10.0,
        position_lat: 50.0,
        observation_radius: 1.0,
      });
      await room.waitForNextPatch();

      // Spawn french division at (10.5, 50) — within 1.0 deg observation radius
      client1.send("SPAWN_DIVISION", {
        division_id: "fra_div_near",
        nation_id: "france",
        position_lng: 10.5,
        position_lat: 50.0,
      });
      await room.waitForNextPatch();

      const germanyAppeared: any[] = [];
      client1.onMessage("DIVISION_APPEARED", (data: any) => germanyAppeared.push(data));

      await tickRoom(room);

      assert.ok(
        germanyAppeared.some((d: any) => d.division_id === "fra_div_near"),
        "Germany should receive DIVISION_APPEARED for nearby french division",
      );
    });

    it("province ownership reveals enemy division", async () => {
      const { client1, room } = await joinTwoClients("germany", "france");

      setRelation(room, "germany", "france", "war");

      // Spawn german division far away from the province
      client1.send("SPAWN_DIVISION", {
        division_id: "ger_div_far2",
        nation_id: "germany",
        position_lng: 0.0,
        position_lat: 0.0,
      });
      await room.waitForNextPatch();

      // Set a province owned by germany (berlin area)
      client1.send("SET_PROVINCE_OWNER", { province_id: "province-berlin", owner_id: "germany" });
      await room.waitForNextPatch();

      // Spawn french division inside that province (berlin coords approx 13.4, 52.5)
      client1.send("SPAWN_DIVISION", {
        division_id: "fra_div_in_ger_province",
        nation_id: "france",
        position_lng: 13.4,
        position_lat: 52.5,
      });
      await room.waitForNextPatch();

      const germanyAppeared: any[] = [];
      client1.onMessage("DIVISION_APPEARED", (data: any) => germanyAppeared.push(data));

      await tickRoom(room);

      assert.ok(
        germanyAppeared.some((d: any) => d.division_id === "fra_div_in_ger_province"),
        "Germany should see french division in german-owned province",
      );
    });

    it("division vanishes when out of range", async () => {
      const { client1, room } = await joinTwoClients("germany", "france");

      setRelation(room, "germany", "france", "war");

      // Ensure the test area is a french-owned province so province ownership
      // does not interfere with the vanish check.
      client1.send("SET_PROVINCE_OWNER", { province_id: "we6_france_01", owner_id: "france" });
      await room.waitForNextPatch();

      // Spawn german division with observation radius — at a position that
      // PIP maps to we6_france_01 (french-owned), so province ownership does
      // not provide detection to germany.
      client1.send("SPAWN_DIVISION", {
        division_id: "ger_div_watch",
        nation_id: "germany",
        position_lng: 2.0,
        position_lat: 48.0,
        observation_radius: 100.0,
      });
      await room.waitForNextPatch();

      // Spawn french division within german observation range
      client1.send("SPAWN_DIVISION", {
        division_id: "fra_div_vanish",
        nation_id: "france",
        position_lng: 2.3,
        position_lat: 48.0,
      });
      await room.waitForNextPatch();

      const firstTickAppeared: any[] = [];
      client1.onMessage("DIVISION_APPEARED", (data: any) => firstTickAppeared.push(data));

      // First tick — french division should appear via land-to-land obs
      await tickRoom(room);

      assert.ok(
        firstTickAppeared.some((d: any) => d.division_id === "fra_div_vanish"),
        "German client should see french division on first tick",
      );

      // Move french division far outside observation range
      client1.send("SET_DIVISION_POSITION", {
        division_id: "fra_div_vanish",
        lng: 0.0,
        lat: 0.0,
      });
      await room.waitForNextPatch();

      const vanished: any[] = [];
      client1.onMessage("DIVISION_VANISHED", (data: any) => vanished.push(data));

      // Second tick — french division should vanish
      await tickRoom(room);

      assert.ok(
        vanished.some((d: any) => d.division_id === "fra_div_vanish"),
        "Germany should receive DIVISION_VANISHED after enemy division moves out of range",
      );
    });

    it("allied nations share vision", async () => {
      const { client1, client2, client3, room } = await joinThreeClients("germany", "france", "united_kingdom");

      // Germany and UK allied; France at war with germany and UK
      setRelation(room, "germany", "united_kingdom", "alliance");
      setRelation(room, "germany", "france", "war");
      setRelation(room, "france", "united_kingdom", "war");

      // Spawn german division with observation radius
      client1.send("SPAWN_DIVISION", {
        division_id: "ger_div_ally",
        nation_id: "germany",
        position_lng: 10.0,
        position_lat: 50.0,
        observation_radius: 1.0,
      });
      await room.waitForNextPatch();

      // Spawn french division within german observation range
      client1.send("SPAWN_DIVISION", {
        division_id: "fra_div_ally_visible",
        nation_id: "france",
        position_lng: 10.3,
        position_lat: 50.0,
      });
      await room.waitForNextPatch();

      const ukAppeared: any[] = [];
      const ukUpdates: any[] = [];
      client3.onMessage("DIVISION_APPEARED", (data: any) => ukAppeared.push(data));
      client3.onMessage("DIVISION_UPDATES", (data: any) => ukUpdates.push(data));

      await tickRoom(room);

      // UK (ally of germany) should also see the french division
      const ukSawFrench =
        ukAppeared.some((d: any) => d.division_id === "fra_div_ally_visible") ||
        ukUpdates.some((d: any) =>
          Array.isArray(d.divisions) && d.divisions.some((div: any) => div.division_id === "fra_div_ally_visible")
        );
      assert.ok(ukSawFrench, "UK (german ally) should see french division detected by germany");
    });
  });

  // ─── Wing visibility tests ───────────────────────────────────────────────

  describe("Wing visibility", () => {

    it("own wings always visible (idle)", async () => {
      const { client, room } = await joinRoom("germany");

      const wingUpdates: any[] = [];
      client.onMessage("AIR_WING_UPDATES", (data: any) => wingUpdates.push(data));

      // Spawn german wing in IDLE lifecycle
      client.send("SPAWN_WING", {
        wing_id: "ger_wing_vis_01",
        nation_id: "germany",
        lifecycle_state: WING_LIFECYCLE.IDLE,
        position_lng: 13.4,
        position_lat: 52.5,
      });
      await room.waitForNextPatch();

      await tickRoom(room);

      const sawOwnWing = wingUpdates.some((msg: any) =>
        Array.isArray(msg.wings) && msg.wings.some((w: any) => w.wing_id === "ger_wing_vis_01")
      );
      assert.ok(sawOwnWing, "Germany should receive AIR_WING_UPDATES for its own idle wing");
    });

    it("idle enemy wing not sent to hostile", async () => {
      const { client1, room } = await joinTwoClients("germany", "france");

      setRelation(room, "germany", "france", "war");

      const germanyWingUpdates: any[] = [];
      client1.onMessage("AIR_WING_UPDATES", (data: any) => germanyWingUpdates.push(data));

      // Spawn french wing in IDLE state
      client1.send("SPAWN_WING", {
        wing_id: "fra_wing_idle",
        nation_id: "france",
        lifecycle_state: WING_LIFECYCLE.IDLE,
        position_lng: 2.3,
        position_lat: 48.9,
      });
      await room.waitForNextPatch();

      await tickRoom(room);

      const germanySawFrenchWing = germanyWingUpdates.some((msg: any) =>
        Array.isArray(msg.wings) && msg.wings.some((w: any) => w.wing_id === "fra_wing_idle")
      );
      assert.strictEqual(
        germanySawFrenchWing,
        false,
        "Germany must NOT receive AIR_WING_UPDATES for idle enemy wing",
      );
    });

    it("airborne detected wing is sent to hostile", async () => {
      const { client1, room } = await joinTwoClients("germany", "france");

      setRelation(room, "germany", "france", "war");

      // Spawn french wing in TRANSIT at (10, 50)
      client1.send("SPAWN_WING", {
        wing_id: "fra_wing_transit",
        nation_id: "france",
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
        position_lng: 10.0,
        position_lat: 50.0,
      });
      await room.waitForNextPatch();

      // Spawn german division very close to french wing — within detection radius
      client1.send("SPAWN_DIVISION", {
        division_id: "ger_div_detect",
        nation_id: "germany",
        position_lng: 10.1,
        position_lat: 50.0,
        observation_radius: 1.0,
      });
      await room.waitForNextPatch();

      const germanyWingUpdates: any[] = [];
      client1.onMessage("AIR_WING_UPDATES", (data: any) => germanyWingUpdates.push(data));

      await tickRoom(room);

      const germanySawFrenchWing = germanyWingUpdates.some((msg: any) =>
        Array.isArray(msg.wings) && msg.wings.some((w: any) => w.wing_id === "fra_wing_transit")
      );
      assert.ok(germanySawFrenchWing, "Germany should receive AIR_WING_UPDATES for detected airborne french wing");
    });

    it("wing vanishes when detection lost", async () => {
      const { client1, room } = await joinTwoClients("germany", "france");

      setRelation(room, "germany", "france", "war");

      // Set province to french ownership so province ownership does not
      // keep the wing visible after the german division moves.
      client1.send("SET_PROVINCE_OWNER", { province_id: "we6_france_01", owner_id: "france" });
      await room.waitForNextPatch();

      // Spawn french wing in TRANSIT inside french-owned province
      client1.send("SPAWN_WING", {
        wing_id: "fra_wing_vanish",
        nation_id: "france",
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
        position_lng: 2.0,
        position_lat: 48.0,
      });
      await room.waitForNextPatch();

      // Spawn german division near the wing with large obs radius
      client1.send("SPAWN_DIVISION", {
        division_id: "ger_div_detect2",
        nation_id: "germany",
        position_lng: 2.3,
        position_lat: 48.0,
        observation_radius: 100.0,
      });
      await room.waitForNextPatch();

      const firstTickUpdates: any[] = [];
      client1.onMessage("AIR_WING_UPDATES", (data: any) => firstTickUpdates.push(data));

      // First tick — french wing detected, should flow to germany
      await tickRoom(room);

      const detectedOnFirstTick = firstTickUpdates.some((msg: any) =>
        Array.isArray(msg.wings) && msg.wings.some((w: any) => w.wing_id === "fra_wing_vanish")
      );
      assert.ok(detectedOnFirstTick, "German client should see french wing on first tick");

      // Move the french wing far away so it leaves detection range
      client1.send("SET_WING_POSITION", {
        wing_id: "fra_wing_vanish",
        lng: 0.0,
        lat: 0.0,
      });
      await room.waitForNextPatch();

      const vanishedMsgs: any[] = [];
      client1.onMessage("AIR_WING_VANISHED", (data: any) => vanishedMsgs.push(data));

      // Second tick — wing should vanish
      await tickRoom(room);

      assert.ok(
        vanishedMsgs.some((d: any) => d.wing_id === "fra_wing_vanish"),
        "Germany should receive AIR_WING_VANISHED after losing detection of french wing",
      );
    });

    it("province ownership reveals flying wing", async () => {
      const { client1, room } = await joinTwoClients("germany", "france");

      setRelation(room, "germany", "france", "war");

      // Set a province owner to germany (berlin area)
      client1.send("SET_PROVINCE_OWNER", { province_id: "province-berlin", owner_id: "germany" });
      await room.waitForNextPatch();

      // Spawn french wing in TRANSIT over german-owned province (berlin approx 13.4, 52.5)
      client1.send("SPAWN_WING", {
        wing_id: "fra_wing_prov",
        nation_id: "france",
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
        position_lng: 13.4,
        position_lat: 52.5,
      });
      await room.waitForNextPatch();

      const germanyWingUpdates: any[] = [];
      client1.onMessage("AIR_WING_UPDATES", (data: any) => germanyWingUpdates.push(data));

      await tickRoom(room);

      const germanySawFrenchWing = germanyWingUpdates.some((msg: any) =>
        Array.isArray(msg.wings) && msg.wings.some((w: any) => w.wing_id === "fra_wing_prov")
      );
      assert.ok(germanySawFrenchWing, "Germany should receive AIR_WING_UPDATES for wing over owned province");
    });
  });
});
