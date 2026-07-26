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
