import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE } from "../src/rooms/schema/AirWingState.js";
import {
  setRtbDurationTicksForTesting,
  setRefuelDurationTicksForTesting,
  setReadinessDecayForTesting,
  setReadinessRecoveryForTesting,
} from "../src/systems/air_wing_lifecycle_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("lane:air-combat | 12b-patch — Air wing lifecycle handlers", function () {

  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setRtbDurationTicksForTesting(2);
    setRefuelDurationTicksForTesting(1);
    setReadinessDecayForTesting(0.01);
    setReadinessRecoveryForTesting(0.5);
    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    setRtbDurationTicksForTesting(5);
    setRefuelDurationTicksForTesting(5);
    setReadinessDecayForTesting(0.003);
    setReadinessRecoveryForTesting(0.04);
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

async function spawnWing(client: any, room: any) {
    client.send("SPAWN_WING", {
      wing_id: "wing-1",
      nation_id: "germany",
      aircraft_type: "FIGHTER",
      count: 10,
      position_lng: 13.385771,
      position_lat: 52.483566,
      heading_deg: 0,
      lifecycle_state: WING_LIFECYCLE.IDLE,
      mission: "INTERCEPTION",
    home_airbase_province_id: "we6_germany_06",
  });
  await room.waitForNextPatch();
}

async function waitForWingState(room: any, wingId: string, expectedState: string, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const wing = room.state.air_wings.get(wingId);
    if (wing?.lifecycle_state === expectedState) return;
    await Promise.race([
      room.waitForNextPatch(),
      new Promise<void>((resolve) => setTimeout(resolve, 50)),
    ]);
  }
  const wing = room.state.air_wings.get(wingId);
  throw new Error(`expected ${wingId} to reach ${expectedState}, got ${wing?.lifecycle_state}`);
}

  it("RETREAT_WING from TRANSIT forces RTB", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await room.waitForNextPatch();

    const wingRtbPromise = new Promise<any>(resolve =>
      client.onMessage("WING_RTB", (msg: any) => {
        if (msg.wing_id === "wing-1") resolve(msg);
      })
    );
    client.send("RETREAT_WING", { wing_id: "wing-1" });
    const rtbMsg = await wingRtbPromise;
    assert.strictEqual(rtbMsg.reason, "player_retreat");
  });

  it("RETREAT_WING from ENGAGED forces RTB", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.ENGAGED });
    await room.waitForNextPatch();

    client.send("RETREAT_WING", { wing_id: "wing-1" });
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.RTB);
  });

  it("RETREAT_WING from IDLE is a no-op", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);

    client.send("RETREAT_WING", { wing_id: "wing-1" });
    await room.waitForNextPatch();

    assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.IDLE);
  });

  it("REDEPLOY_WING from IDLE transitions to RELOCATE", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);

    client.send("REDEPLOY_WING", { wing_id: "wing-1", new_province_id: "we6_germany_01" });
    await room.waitForNextPatch();

    assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.RELOCATE);
  });

  it("REDEPLOY_WING from airborne forces RTB before relocating", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await room.waitForNextPatch();

    client.send("REDEPLOY_WING", { wing_id: "wing-1", new_province_id: "we6_germany_01" });
    await room.waitForNextPatch();

    const state = room.state.air_wings.get("wing-1").lifecycle_state;
    assert.ok(
      state === WING_LIFECYCLE.RTB || state === WING_LIFECYCLE.REFUEL || state === WING_LIFECYCLE.RELOCATE,
      `expected RTB/REFUEL/RELOCATE after airborne redeploy, got ${state}`
    );
  });

  it("REDEPLOY_WING arrival updates home base and leaves airborne state", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);

    client.send("REDEPLOY_WING", { wing_id: "wing-1", new_province_id: "we6_germany_01" });
    await room.waitForNextPatch();
    client.send("SET_PATH_ELAPSED", { wing_id: "wing-1", elapsed_ms: 999_999 });
    await room.waitForNextPatch();
    (room as any).gameTick();
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get("wing-1");
    assert.strictEqual(wing.home_airbase_province_id, "we6_germany_01");
    assert.ok(
      wing.lifecycle_state === WING_LIFECYCLE.REFUEL || wing.lifecycle_state === WING_LIFECYCLE.IDLE,
      `expected REFUEL or IDLE after redeploy arrival, got ${wing.lifecycle_state}`
    );
  });
});
