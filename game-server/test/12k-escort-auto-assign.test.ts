import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, MISSION_TYPES, AIR_UNIT_TYPES, serializeWing } from "../src/rooms/schema/AirWingState.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("lane:air-combat | 12k — IDLE mission, perk_air_combat & escort auto-assign", function () {

  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  async function joinRoom() {
    const token  = await makeToken();
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    client.send("SELECT_NATION", { nation_id: "germany" });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    return { client, room };
  }

  async function spawnWing(client: any, room: any, overrides: Record<string, unknown> = {}): Promise<string> {
    const id = overrides.wing_id ?? ("w12k-" + Math.random().toString(36).slice(2, 8));
    const defaults: Record<string, unknown> = {
      wing_id:                  id,
      nation_id:                "germany",
      aircraft_type:            AIR_UNIT_TYPES.FIGHTER,
      count:                    10,
      lifecycle_state:          WING_LIFECYCLE.IDLE,
      mission:                  MISSION_TYPES.INTERCEPTION,
      home_airbase_province_id: "we6_germany_06",
    };
    client.send("SPAWN_WING", { ...defaults, ...overrides });
    await room.waitForNextPatch();
    return id as string;
  }

  async function tickRoom(room: any, count = 1): Promise<void> {
    for (let i = 0; i < count; i++) {
      (room as any).gameTick();
      await room.waitForNextPatch();
    }
  }

  // ── IDLE mission ─────────────────────────────────────────────────────────

  it("MISSION_TYPES.IDLE exists and equals 'idle'", async () => {
    assert.strictEqual(MISSION_TYPES.IDLE, "idle");
  });

  it("assigning IDLE mission to IDLE-lifecycle wing stays IDLE", async () => {
    const { client, room } = await joinRoom();
    const wid = await spawnWing(client, room);

    client.send("ASSIGN_WING_MISSION", { wing_id: wid, mission: MISSION_TYPES.IDLE, target_id: "" });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get(wid);
    assert.ok(wing);
    assert.strictEqual(wing.mission, MISSION_TYPES.IDLE);
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.IDLE);
  });

  it("assigning IDLE mission to LOITER wing forces RTB", async () => {
    const { client, room } = await joinRoom();
    const wid = await spawnWing(client, room, { lifecycle_state: WING_LIFECYCLE.LOITER });

    client.send("ASSIGN_WING_MISSION", { wing_id: wid, mission: MISSION_TYPES.IDLE, target_id: "" });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get(wid);
    assert.ok(wing);
    assert.strictEqual(wing.mission, MISSION_TYPES.IDLE);
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.RTB);
  });

  it("assigning IDLE mission to TRANSIT wing forces RTB", async () => {
    const { client, room } = await joinRoom();
    const wid = await spawnWing(client, room, { lifecycle_state: WING_LIFECYCLE.TRANSIT });

    client.send("ASSIGN_WING_MISSION", { wing_id: wid, mission: MISSION_TYPES.IDLE, target_id: "" });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get(wid);
    assert.ok(wing);
    assert.strictEqual(wing.mission, MISSION_TYPES.IDLE);
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.RTB);
  });

  it("assigning IDLE mission to ENGAGED wing forces RTB", async () => {
    const { client, room } = await joinRoom();
    const wid = await spawnWing(client, room, { lifecycle_state: WING_LIFECYCLE.ENGAGED });

    client.send("ASSIGN_WING_MISSION", { wing_id: wid, mission: MISSION_TYPES.IDLE, target_id: "" });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get(wid);
    assert.ok(wing);
    assert.strictEqual(wing.mission, MISSION_TYPES.IDLE);
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.RTB);
  });

  it("assigning IDLE mission to REFUEL wing stays REFUEL", async () => {
    const { client, room } = await joinRoom();
    const wid = await spawnWing(client, room, { lifecycle_state: WING_LIFECYCLE.REFUEL });

    client.send("ASSIGN_WING_MISSION", { wing_id: wid, mission: MISSION_TYPES.IDLE, target_id: "" });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get(wid);
    assert.ok(wing);
    assert.strictEqual(wing.mission, MISSION_TYPES.IDLE);
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.REFUEL);
  });

  it("assigning a non-IDLE mission with a target to an IDLE wing still transitions to TRANSIT", async () => {
    const { client, room } = await joinRoom();
    const wid = await spawnWing(client, room);

    client.send("ASSIGN_WING_MISSION", { wing_id: wid, mission: MISSION_TYPES.AIR_SUPERIORITY, target_id: "some_target_id" });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get(wid);
    assert.ok(wing);
    assert.strictEqual(wing.mission, MISSION_TYPES.AIR_SUPERIORITY);
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.TRANSIT);
  });

  it("assigning a non-IDLE mission with an empty target to an IDLE wing stays IDLE (Branch L)", async () => {
    const { client, room } = await joinRoom();
    const wid = await spawnWing(client, room);

    client.send("ASSIGN_WING_MISSION", { wing_id: wid, mission: MISSION_TYPES.AIR_SUPERIORITY, target_id: "" });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get(wid);
    assert.ok(wing);
    assert.strictEqual(wing.mission, MISSION_TYPES.AIR_SUPERIORITY);
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.IDLE);
  });

  // ── Perk: air_combat ─────────────────────────────────────────────────────

  it("setPerk(wingId, 'air_combat', true) sets wing.perk_air_combat = true", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "wing-perk", aircraft_type: AIR_UNIT_TYPES.CAS_PLANE });

    client.send("SET_WING_PERK", { wing_id: "wing-perk", perk: "air_combat", value: true });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get("wing-perk");
    assert.ok(wing);
    assert.strictEqual(wing.perk_air_combat, true);
  });

  // ── Serialize wing ───────────────────────────────────────────────────────

  it("serializeWing() includes perk_air_combat and perk_splash", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "wing-serial" });

    client.send("SET_WING_PERK", { wing_id: "wing-serial", perk: "air_combat", value: true });
    await room.waitForNextPatch();
    client.send("SET_WING_PERK", { wing_id: "wing-serial", perk: "splash", value: true });
    await room.waitForNextPatch();

    const wing = room.state.air_wings.get("wing-serial");
    assert.ok(wing);
    const serialized = serializeWing(wing);
    assert.strictEqual(serialized.perk_air_combat, true);
    assert.strictEqual(serialized.perk_splash, true);
  });

  // ── Escort auto-assignment ───────────────────────────────────────────────

  it("heavy fighter ESCORT pairs with strategic bomber over CAS plane", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "strat-bomber", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "cas-plane-1", aircraft_type: AIR_UNIT_TYPES.CAS_PLANE, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();

    const hf = room.state.air_wings.get("hf-escort");
    assert.ok(hf);
    assert.strictEqual(hf.mission, MISSION_TYPES.ESCORT);
    assert.strictEqual(hf.target_id, "strat-bomber");
  });

  it("heavy fighter ESCORT falls back to CAS bomber when no strategic/tactical airborne", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "cas-plane-1", aircraft_type: AIR_UNIT_TYPES.CAS_PLANE, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();

    const hf = room.state.air_wings.get("hf-escort");
    assert.ok(hf);
    assert.strictEqual(hf.target_id, "cas-plane-1");
  });

  it("fighter ESCORT pairs with CAS bomber over strategic bomber", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "cas-plane-1", aircraft_type: AIR_UNIT_TYPES.CAS_PLANE, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "strat-bomber", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "fighter-escort", aircraft_type: AIR_UNIT_TYPES.FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "fighter-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();

    const f = room.state.air_wings.get("fighter-escort");
    assert.ok(f);
    assert.strictEqual(f.target_id, "cas-plane-1");
  });

  it("round-robin: 3 fighters escorting 2 bombers, third double-covers", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "bomber-a", aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "bomber-b", aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER, lifecycle_state: WING_LIFECYCLE.TRANSIT });

    for (const id of ["f-1", "f-2", "f-3"]) {
      await spawnWing(client, room, { wing_id: id, aircraft_type: AIR_UNIT_TYPES.FIGHTER });
      client.send("ASSIGN_WING_MISSION", { wing_id: id, mission: MISSION_TYPES.ESCORT, target_id: "" });
      await room.waitForNextPatch();
    }

    const targets = new Set([
      room.state.air_wings.get("f-1")?.target_id,
      room.state.air_wings.get("f-2")?.target_id,
      room.state.air_wings.get("f-3")?.target_id,
    ]);
    assert.ok(targets.has("bomber-a"));
    assert.ok(targets.has("bomber-b"));
    assert.strictEqual(targets.size, 2);
  });

  it("heavy fighter with no eligible bomber keeps ESCORT with empty target", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();

    const hf = room.state.air_wings.get("hf-escort");
    assert.ok(hf);
    assert.strictEqual(hf.mission, MISSION_TYPES.ESCORT);
    assert.strictEqual(hf.target_id, "");
  });

  it("fighter with no eligible bomber switches to AIR_SUPERIORITY", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "fighter-escort", aircraft_type: AIR_UNIT_TYPES.FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "fighter-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();

    const f = room.state.air_wings.get("fighter-escort");
    assert.ok(f);
    assert.strictEqual(f.mission, MISSION_TYPES.AIR_SUPERIORITY);
    assert.strictEqual(f.target_id, "");
  });

  it("idle bombers are not candidates for escort auto-assign", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "idle-bomber", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.IDLE });
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();

    const hf = room.state.air_wings.get("hf-escort");
    assert.ok(hf);
    assert.strictEqual(hf.target_id, "");
  });

  it("orphan escort re-pairs to another airborne bomber on disband", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "bomber-a", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "bomber-b", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.air_wings.get("hf-escort")?.target_id, "bomber-a");

    client.send("DISBAND_WING", { wing_id: "bomber-a" });
    await room.waitForNextPatch();

    const hf = room.state.air_wings.get("hf-escort");
    assert.ok(hf);
    assert.strictEqual(hf.target_id, "bomber-b");
  });

  it("dangling reference: no wing targets deleted wing after disband", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "bomber-x", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.air_wings.get("hf-escort")?.target_id, "bomber-x");

    client.send("DISBAND_WING", { wing_id: "bomber-x" });
    await room.waitForNextPatch();

    assert.strictEqual(room.state.air_wings.has("bomber-x"), false);
    for (const w of room.state.air_wings.values()) {
      assert.notStrictEqual(w.target_id, "bomber-x");
    }
  });
});
