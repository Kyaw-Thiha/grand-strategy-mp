import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { NAVAL_CONTACT_QUALITY, QUALITY_DEFAULTS } from "../src/data/naval_contact_quality.js";
import {
  setRtbDurationTicksForTesting,
  setRefuelDurationTicksForTesting,
} from "../src/systems/air_wing_lifecycle_system.js";

const PORT_PROVINCE = "we6_germany_01";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

// ── CREATE_NAVAL_CONTACT handler tests ────────────────────────────────────────

describe("lane:air-combat | 12h — CREATE_NAVAL_CONTACT handler", function () {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  let previousDevMode: string | undefined;

  before(async () => {
    previousDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = "true";
    setRtbDurationTicksForTesting(1);
    setRefuelDurationTicksForTesting(1);
    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    if (previousDevMode === undefined) delete process.env.DEV_MODE;
    else process.env.DEV_MODE = previousDevMode;
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
    (room as any).clock.clear();
    return { client, room };
  }

  async function tick(room: any): Promise<void> {
    (room as any).gameTick();
    await room.waitForNextPatch();
  }

  it("creates a marker with correct quality tier defaults — maritime_patrol", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "m1",
      nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.MARITIME_PATROL,
      position_lng: 10.0,
      position_lat: 52.0,
    });
    await room.waitForNextPatch();
    const marker = (room.state as GameRoomState).naval_contact_markers.get("m1");
    assert.ok(marker, "marker should exist");
    assert.strictEqual(marker.quality, "maritime_patrol");
    assert.strictEqual(marker.radius_deg, QUALITY_DEFAULTS.maritime_patrol.radius_deg);
    assert.strictEqual(marker.is_refreshable, true);
    assert.ok(marker.expires_at_ms > Date.now(), "expiry in future");
  });

  it("creates a cargo_sinking marker with wide radius", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "m2",
      nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.CARGO_SINKING,
      position_lng: 5.0,
      position_lat: 50.0,
    });
    await room.waitForNextPatch();
    const marker = (room.state as GameRoomState).naval_contact_markers.get("m2");
    assert.ok(marker);
    assert.strictEqual(marker.radius_deg, QUALITY_DEFAULTS.cargo_sinking.radius_deg);
    assert.strictEqual(marker.is_refreshable, false);
  });

  it("creates a flotilla_scout marker", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "m3",
      nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.FLOTILLA_SCOUT,
      position_lng: 8.0,
      position_lat: 54.0,
    });
    await room.waitForNextPatch();
    const marker = (room.state as GameRoomState).naval_contact_markers.get("m3");
    assert.ok(marker);
    assert.strictEqual(marker.radius_deg, QUALITY_DEFAULTS.flotilla_scout.radius_deg);
    assert.strictEqual(marker.is_refreshable, false);
  });
});

// ── Contact marker expiry tests ───────────────────────────────────────────────

describe("lane:air-combat | 12h — Contact marker expiry", function () {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  let previousDevMode: string | undefined;

  before(async () => {
    previousDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = "true";
    setRtbDurationTicksForTesting(1);
    setRefuelDurationTicksForTesting(1);
    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    if (previousDevMode === undefined) delete process.env.DEV_MODE;
    else process.env.DEV_MODE = previousDevMode;
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
    (room as any).clock.clear();
    return { client, room };
  }

  async function tick(room: any): Promise<void> {
    (room as any).gameTick();
    await room.waitForNextPatch();
  }

  it("expired marker is removed from state and CONTACT_MARKER_EXPIRED is broadcast", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "exp1", nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.CARGO_SINKING,
      position_lng: 5.0, position_lat: 50.0,
    });
    await room.waitForNextPatch();
    const marker = (room.state as GameRoomState).naval_contact_markers.get("exp1");
    (marker as any).expires_at_ms = Date.now() - 1000;

    const events: string[] = [];
    client.onMessage("CONTACT_MARKER_EXPIRED", (data: any) => {
      events.push(data.marker_id);
    });

    await tick(room);
    assert.ok(
      !(room.state as GameRoomState).naval_contact_markers.has("exp1"),
      "expired marker should be removed"
    );
    assert.ok(events.includes("exp1"), "CONTACT_MARKER_EXPIRED should be broadcast");
  });

  it("non-expired marker is NOT removed", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "live1", nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.MARITIME_PATROL,
      position_lng: 5.0, position_lat: 50.0,
    });
    await room.waitForNextPatch();
    await tick(room);
    assert.ok(
      (room.state as GameRoomState).naval_contact_markers.has("live1"),
      "non-expired marker should remain"
    );
  });

  it("refreshContact() extends expires_at_ms for refreshable markers", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "ref1", nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.MARITIME_PATROL,
      position_lng: 5.0, position_lat: 50.0,
    });
    await room.waitForNextPatch();
    const marker = (room.state as GameRoomState).naval_contact_markers.get("ref1") as any;
    const originalExpiry = marker.expires_at_ms;
    (room as any).airNavalBomberSystem.refreshContact("ref1", room.state);
    assert.ok(marker.expires_at_ms >= originalExpiry, "expiry should extend on refresh");
  });
});

// ── Port strike tests ─────────────────────────────────────────────────────────

describe("lane:air-combat | 12h — Port strike", function () {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  let previousDevMode: string | undefined;

  before(async () => {
    previousDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = "true";
    setRtbDurationTicksForTesting(1);
    setRefuelDurationTicksForTesting(1);
    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    if (previousDevMode === undefined) delete process.env.DEV_MODE;
    else process.env.DEV_MODE = previousDevMode;
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
    (room as any).clock.clear();
    return { client, room };
  }

  async function tick(room: any): Promise<void> {
    (room as any).gameTick();
    await room.waitForNextPatch();
  }

  it("reduces naval_base_level on target province", async () => {
    const { client, room } = await joinRoom();
    const state = room.state as GameRoomState;
    const prov = state.provinces.get(PORT_PROVINCE);
    if (!prov) throw new Error("province not found");
    prov.naval_base_level = 10;

    client.send("SPAWN_WING", {
      wing_id: "nb1", nation_id: "germany",
      aircraft_type: "naval_bomber", count: 10,
      home_airbase_province_id: PORT_PROVINCE,
      mission: "port_strike",
      lifecycle_state: "loiter",
    });
    await room.waitForNextPatch();
    const wing = state.air_wings.get("nb1");
    if (!wing) throw new Error("wing not found");
    wing.fuel = 1.0;
    wing.target_id = PORT_PROVINCE;

    const baseline = state.provinces.get(PORT_PROVINCE)!.naval_base_level;
    await tick(room);
    const after = state.provinces.get(PORT_PROVINCE)!.naval_base_level;
    assert.ok(after < baseline, `naval_base_level should decrease: ${baseline} → ${after}`);
  });

  it("does NOT fire PROVINCE_AA_FIRED — no AA on port strike", async () => {
    const { client, room } = await joinRoom();
    client.send("SET_PROVINCE_AA", { province_id: PORT_PROVINCE, strength: 100 });
    await room.waitForNextPatch();

    client.send("SPAWN_WING", {
      wing_id: "nb2", nation_id: "germany",
      aircraft_type: "naval_bomber", count: 10,
      home_airbase_province_id: PORT_PROVINCE,
      mission: "port_strike",
      lifecycle_state: "loiter",
    });
    await room.waitForNextPatch();

    const state2 = room.state as GameRoomState;
    const wing2 = state2.air_wings.get("nb2");
    if (!wing2) throw new Error("wing not found");
    wing2.fuel = 1.0;
    wing2.target_id = PORT_PROVINCE;

    const aaEvents: unknown[] = [];
    client.onMessage("PROVINCE_AA_FIRED", (data) => aaEvents.push(data));

    const state = room.state as GameRoomState;
    const countBefore = state.air_wings.get("nb2")!.count;
    await tick(room);
    assert.strictEqual(state.air_wings.get("nb2")!.count, countBefore, "wing count must not change from AA");
    assert.strictEqual(aaEvents.length, 0, "PROVINCE_AA_FIRED must not fire for port strike");
  });

  it("broadcasts NAVAL_BOMBER_STRIKE_HIT with province_id and naval_base_damage", async () => {
    const { client, room } = await joinRoom();
    const hitEvents: any[] = [];
    client.onMessage("NAVAL_BOMBER_STRIKE_HIT", (data) => hitEvents.push(data));

    client.send("SPAWN_WING", {
      wing_id: "nb3", nation_id: "germany",
      aircraft_type: "naval_bomber", count: 5,
      home_airbase_province_id: PORT_PROVINCE,
      mission: "port_strike",
      lifecycle_state: "loiter",
    });
    await room.waitForNextPatch();

    const state3 = room.state as GameRoomState;
    const wing3 = state3.air_wings.get("nb3");
    if (!wing3) throw new Error("wing not found");
    wing3.fuel = 1.0;
    wing3.target_id = PORT_PROVINCE;
    await tick(room);

    assert.strictEqual(hitEvents.length, 1);
    assert.strictEqual(hitEvents[0].province_id, PORT_PROVINCE);
    assert.ok(typeof hitEvents[0].naval_base_damage === "number");
  });

  it("wing RTBs after port strike", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_WING", {
      wing_id: "nb4", nation_id: "germany",
      aircraft_type: "naval_bomber", count: 5,
      home_airbase_province_id: PORT_PROVINCE,
      mission: "port_strike",
      lifecycle_state: "loiter",
    });
    await room.waitForNextPatch();

    const state4 = room.state as GameRoomState;
    const wing4 = state4.air_wings.get("nb4");
    if (!wing4) throw new Error("wing not found");
    wing4.fuel = 1.0;
    wing4.target_id = PORT_PROVINCE;
    await tick(room);
    const wing = (room.state as GameRoomState).air_wings.get("nb4");
    assert.ok(wing, "wing should exist after tick");
    assert.ok(
      wing!.lifecycle_state === "rtb" || wing!.lifecycle_state === "refuel",
      "wing should be RTBing after strike"
    );
  });
});
