import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, MISSION_TYPES, AIR_UNIT_TYPES } from "../src/rooms/schema/AirWingState.js";
import { DubinsPathfinder, setWingSpeedForTesting, setTurnRadiusForTesting } from "../src/systems/air_dubins_pathfinder.js";
import { AirSpatialBucket } from "../src/systems/air_spatial_bucket.js";

const pf = new DubinsPathfinder();
const SPEED = 0.001;
const RADIUS = 0.2;

before(() => {
  setWingSpeedForTesting(SPEED);
  setTurnRadiusForTesting(RADIUS);
});

function headingDiff(a: number, b: number): number {
  const d = Math.abs((a - b + 360) % 360);
  return d > 180 ? 360 - d : d;
}

function dist(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  return Math.sqrt((a.lng - b.lng) ** 2 + (a.lat - b.lat) ** 2);
}

describe("lane:air-combat | 12c — Dubins pathfinding", () => {
  it("computeTransitPath: evaluatePosition at t=0 returns start heading", () => {
    const path = pf.computeTransitPath({ lng: 10, lat: 50 }, 0, { lng: 11, lat: 50 });
    const start = pf.evaluatePosition(path, 0);
    assert.ok(headingDiff(start.heading_compass_deg, 0) < 1,
      `start heading must be 0 (north), got ${start.heading_compass_deg}`);
  });

  it("computeTransitPath: evaluatePosition at total time reaches end position", () => {
    const endPos = { lng: 11, lat: 50 };
    const path = pf.computeTransitPath({ lng: 10, lat: 50 }, 90, endPos);
    const totalMs = path.total_length_deg / SPEED;
    const end = pf.evaluatePosition(path, totalMs);
    assert.ok(dist(end, endPos) < 0.05, `end position dist=${dist(end, endPos).toFixed(4)} must be < 0.05`);
  });

  it("computeRtbPath: start heading matches current wing heading (no instant flip)", () => {
    const path = pf.computeRtbPath({ lng: 10, lat: 51 }, 180, { lng: 10, lat: 50 }, 0);
    const start = pf.evaluatePosition(path, 0);
    assert.ok(headingDiff(start.heading_compass_deg, 180) < 1,
      `RTB start heading must be 180 (south), got ${start.heading_compass_deg}`);
  });

  it("computeLoiterArc: is a closed circle (start and end positions match)", () => {
    // entryPos is one radius east of center with heading=0 (north), so actualCenter=(10,50)
    const entry = { lng: 10 + RADIUS, lat: 50 };
    const loiter = pf.computeLoiterArc(entry, 0, RADIUS);
    assert.strictEqual(loiter.path_type, "LOITER");
    assert.strictEqual(loiter.segments.length, 1, "loiter must be one arc segment");
    const totalMs = loiter.total_length_deg / SPEED;
    const startPos = pf.evaluatePosition(loiter, 0);
    const endPos = pf.evaluatePosition(loiter, totalMs);
    assert.ok(dist(startPos, endPos) < 0.01,
      `loiter must be closed, gap=${dist(startPos, endPos).toFixed(4)}`);
  });

  it("computeLoiterArc: all sampled points are at constant radius from center", () => {
    // entryPos is one radius east of center with heading=0 (north), so actualCenter=(10,50)
    const center = { lng: 10, lat: 50 };
    const entry  = { lng: 10 + RADIUS, lat: 50 };
    const loiter = pf.computeLoiterArc(entry, 0, RADIUS);
    const totalMs = loiter.total_length_deg / SPEED;
    for (let i = 0; i <= 8; i++) {
      const p = pf.evaluatePosition(loiter, (i / 8) * totalMs);
      const d = dist(p, center);
      assert.ok(Math.abs(d - RADIUS) < 0.01,
        `loiter point at t=${i}/8 is distance ${d.toFixed(4)} from center, expected ${RADIUS}`);
    }
  });

  it("evaluatePosition: position changes continuously (no teleport between segments)", () => {
    const path = pf.computeTransitPath({ lng: 10, lat: 50 }, 45, { lng: 11, lat: 51 });
    const totalMs = path.total_length_deg / SPEED;
    let prev = pf.evaluatePosition(path, 0);
    for (let i = 1; i <= 20; i++) {
      const cur = pf.evaluatePosition(path, (i / 20) * totalMs);
      const jump = dist(cur, prev);
      assert.ok(jump < 0.15,
        `position jump ${jump.toFixed(4)} at step ${i}/20 is too large — likely segment discontinuity`);
      prev = cur;
    }
  });

  it("sweepCheck: crossing paths within window → true", () => {
    const pathA = pf.computeTransitPath({ lng: 9.5, lat: 50 }, 90, { lng: 10.5, lat: 50 });
    const pathB = pf.computeTransitPath({ lng: 10, lat: 49.5 }, 0, { lng: 10, lat: 50.5 });
    assert.strictEqual(pf.sweepCheck(pathA, 0, pathB, 0, 0.08, 2000), true,
      "crossing paths must be detected");
  });

  it("sweepCheck: parallel paths 0.5° apart → false", () => {
    const pathA = pf.computeTransitPath({ lng: 9.5, lat: 50.0 }, 90, { lng: 10.5, lat: 50.0 });
    const pathB = pf.computeTransitPath({ lng: 9.5, lat: 50.5 }, 90, { lng: 10.5, lat: 50.5 });
    assert.strictEqual(pf.sweepCheck(pathA, 0, pathB, 0, 0.08, 2000), false,
      "parallel paths 0.5° apart must not trigger contact");
  });

  it("sweepCheck: paths that already passed each other → false in this window", () => {
    const pathA = pf.computeTransitPath({ lng: 9.5, lat: 50 }, 90, { lng: 10.5, lat: 50 });
    const pathB = pf.computeTransitPath({ lng: 10, lat: 49.5 }, 0, { lng: 10, lat: 50.5 });
    assert.strictEqual(pf.sweepCheck(pathA, 10_000, pathB, 0, 0.08, 500), false,
      "past crossing must not trigger in current window");
  });

  it("AirSpatialBucket: wings in same cell produce exactly one pair", () => {
    const b = new AirSpatialBucket(1.0);
    b.add("wing-1", 10.2, 50.3);
    b.add("wing-2", 10.7, 50.8);
    const pairs = b.getLocalPairs();
    assert.strictEqual(pairs.length, 1);
    const [a, x] = pairs[0];
    assert.ok((a === "wing-1" && x === "wing-2") || (a === "wing-2" && x === "wing-1"));
  });

  it("AirSpatialBucket: wings in diagonally adjacent cells produce a pair", () => {
    const b = new AirSpatialBucket(1.0);
    b.add("wing-1", 10.5, 50.5);
    b.add("wing-2", 11.5, 51.5);
    const pairs = b.getLocalPairs();
    assert.strictEqual(pairs.length, 1, "diagonal neighbors must produce a pair");
  });

  it("AirSpatialBucket: wings two cells apart produce no pair", () => {
    const b = new AirSpatialBucket(1.0);
    b.add("wing-1", 10.5, 50.5);
    b.add("wing-2", 12.5, 50.5);
    assert.strictEqual(b.getLocalPairs().length, 0, "two cells apart must not produce a pair");
  });

  it("AirSpatialBucket: three wings in same cell → 3 unique pairs, no duplicates", () => {
    const b = new AirSpatialBucket(1.0);
    b.add("wing-1", 10.2, 50.3);
    b.add("wing-2", 10.5, 50.5);
    b.add("wing-3", 10.8, 50.7);
    assert.strictEqual(b.getLocalPairs().length, 3);
  });

  it("AirSpatialBucket: clear() resets all assignments", () => {
    const b = new AirSpatialBucket(1.0);
    b.add("wing-1", 10.2, 50.3);
    b.add("wing-2", 10.7, 50.8);
    b.clear();
    b.add("wing-1", 10.2, 50.3);
    assert.strictEqual(b.getLocalPairs().length, 0);
  });
});

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("lane:air-combat | 12c — Air wing path integration", function () {
  this.timeout(180_000);

  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setWingSpeedForTesting(0.0005);
    setTurnRadiusForTesting(0.1);
    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    setWingSpeedForTesting(SPEED);
    setTurnRadiusForTesting(RADIUS);
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

  async function spawnWing(client: any, room: any, overrides: Record<string, unknown> = {}) {
    client.send("SPAWN_WING", {
      wing_id: "wing-1",
      nation_id: "germany",
      aircraft_type: AIR_UNIT_TYPES.FIGHTER,
      count: 10,
      position_lng: 13.385771,
      position_lat: 52.483566,
      heading_deg: 0,
      lifecycle_state: WING_LIFECYCLE.IDLE,
      mission: MISSION_TYPES.INTERCEPTION,
      home_airbase_province_id: "we6_germany_06",
      ...overrides,
    });
    await room.waitForNextPatch();
  }

  async function waitForWingPredicate(
    room: any,
    wingId: string,
    predicate: (wing: any | undefined) => boolean,
    timeoutMs = 1_500,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const wing = room.state.air_wings.get(wingId);
      if (predicate(wing)) return;
      await Promise.race([
        room.waitForNextPatch(),
        new Promise<void>((resolve) => setTimeout(resolve, 50)),
      ]);
    }
    const wing = room.state.air_wings.get(wingId);
    throw new Error(`timed out waiting for wing ${wingId}; last state=${wing?.lifecycle_state}`);
  }

  async function waitForWingState(room: any, wingId: string, expectedState: string, timeoutMs = 1_500): Promise<void> {
    await waitForWingPredicate(room, wingId, (wing) => wing?.lifecycle_state === expectedState, timeoutMs);
  }

  async function waitForMessage<T>(promise: Promise<T>, timeoutMs = 1_500): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  it("SUBMIT_AIR_WING_MOVE sets a path, transitions to TRANSIT, and broadcasts AIR_WING_PATH", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    const pathPromise = new Promise<any>(resolve => client.onMessage("AIR_WING_PATH", resolve));

    client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-1", target_lng: 15, target_lat: 55 });
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);

    const wing = room.state.air_wings.get("wing-1");
    assert.ok(wing.path_gen_id !== "", "path_gen_id must be set");
    assert.ok(wing.path_elapsed_ms >= 0, "path_elapsed_ms must be initialized");

    const pathMsg = await waitForMessage(pathPromise);
    assert.strictEqual(pathMsg.wing_id, "wing-1");
    assert.strictEqual(pathMsg.path_gen_id, wing.path_gen_id);
    assert.ok(Array.isArray(pathMsg.segments) && pathMsg.segments.length > 0);
  });

  it("SUBMIT_AIR_WING_MOVE is rejected for the wrong nation", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_WING", {
      wing_id: "wing-france",
      nation_id: "france",
      aircraft_type: AIR_UNIT_TYPES.FIGHTER,
      count: 10,
      position_lng: 2.335453,
      position_lat: 48.896725,
      heading_deg: 0,
      lifecycle_state: WING_LIFECYCLE.IDLE,
      mission: MISSION_TYPES.INTERCEPTION,
      home_airbase_province_id: "we6_france_03",
    });
    await room.waitForNextPatch();

    client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-france", target_lng: 10, target_lat: 50 });
    await new Promise(r => setTimeout(r, 200));

    const wing = room.state.air_wings.get("wing-france");
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.IDLE);
    assert.strictEqual(wing.path_gen_id, "");
  });

  it("path_elapsed_ms advances each game tick while TRANSIT", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);

    client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-1", target_lng: 20, target_lat: 50 });
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);
    (room as any).gameTick();
    await waitForWingPredicate(room, "wing-1", (wing) => (wing?.path_elapsed_ms ?? 0) > 0);
  });

  it("wing position_lng changes each tick while moving", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);

    client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-1", target_lng: 20, target_lat: 50 });
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);

    const startLng = room.state.air_wings.get("wing-1").position_lng;
    (room as any).gameTick();
    await waitForWingPredicate(room, "wing-1", (wing) => (wing?.position_lng ?? 0) > startLng);
  });

  it("TRANSIT wing transitions to LOITER when the path completes", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);

    client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-1", target_lng: 10.1, target_lat: 50 });
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);
    client.send("SET_PATH_ELAPSED", { wing_id: "wing-1", elapsed_ms: 999_999 });

    (room as any).gameTick();
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.LOITER);
  });

  it("REDEPLOY_WING arrival updates home_airbase_province_id and transitions to REFUEL", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);

    client.send("REDEPLOY_WING", { wing_id: "wing-1", new_province_id: "we6_germany_01" });
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.RELOCATE);

    client.send("SET_PATH_ELAPSED", { wing_id: "wing-1", elapsed_ms: 999_999 });
    (room as any).gameTick();
    await waitForWingPredicate(room, "wing-1", (wing) => wing?.home_airbase_province_id === "we6_germany_01"
      && (wing.lifecycle_state === WING_LIFECYCLE.REFUEL || wing.lifecycle_state === WING_LIFECYCLE.IDLE));
  });

  it("redirect mid-TRANSIT generates a new path_gen_id and resets elapsed", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);

    // Use targets within max range (~2.8 deg from we6_germany_06 home at 13.39,52.48)
    client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-1", target_lng: 14, target_lat: 52.5 });
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);
    const firstId = room.state.air_wings.get("wing-1").path_gen_id;

    client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-1", target_lng: 13.5, target_lat: 52.0 });
    await waitForWingPredicate(room, "wing-1", (wing) => wing?.path_gen_id !== firstId && wing.path_elapsed_ms === 0);
  });

  it("ASSIGN_WING_MISSION generates an AIR_WING_PATH broadcast", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    const pathPromise = new Promise<any>(resolve => client.onMessage("AIR_WING_PATH", resolve));

    client.send("ASSIGN_WING_MISSION", { wing_id: "wing-1", mission: MISSION_TYPES.INTERCEPTION, target_id: "we6_germany_01" });
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);
    assert.ok(room.state.air_wings.get("wing-1").path_gen_id !== "");

    const pathMsg = await waitForMessage(pathPromise);
    assert.strictEqual(pathMsg.wing_id, "wing-1");
  });
});
