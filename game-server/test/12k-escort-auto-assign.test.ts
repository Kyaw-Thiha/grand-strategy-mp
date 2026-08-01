import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, MISSION_TYPES, AIR_UNIT_TYPES, serializeWing } from "../src/rooms/schema/AirWingState.js";
import { setAirMissionTargetingEnabledForTesting } from "../src/systems/air_mission_targeting.js";

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
    // Escort assignment is now resolved by AirMissionTargetingSystem's per-tick loop (like
    // every other auto-targeted mission), not synchronously in the ASSIGN_WING_MISSION
    // handler — this suite needs the live system enabled and a tick() after assignment.
    setAirMissionTargetingEnabledForTesting(true);
    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    setAirMissionTargetingEnabledForTesting(false);
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  // startGame() unconditionally spawns each nation's starting air fleet
  // (AIR_WING_STARTING_POSITIONS) — germany's includes an IDLE cas_plane and an IDLE
  // strategic_bomber. Since idle bombers are now eligible for escort auto-assignment (see
  // eligibleStates in autoAssignEscort), these starting-fleet wings would otherwise
  // silently compete with each test's own explicitly-spawned wings. Sideline them into a
  // non-eligible lifecycle state so tests get a deterministic, isolated pool.
  const STARTING_FLEET_BOMBER_IDS = ["germany_cas_frankfurt_01", "germany_strat_bomber_frankfurt_01"];

  async function joinRoom() {
    const token  = await makeToken();
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    client.send("SELECT_NATION", { nation_id: "germany" });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    for (const wingId of STARTING_FLEET_BOMBER_IDS) {
      client.send("SET_WING_LIFECYCLE", { wing_id: wingId, lifecycle_state: WING_LIFECYCLE.RTB });
    }
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

  // ── Escort auto-assignment (per-tick, tiered: airborne always beats idle) ───────

  it("heavy fighter ESCORT pairs with strategic bomber over CAS plane", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "strat-bomber", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "cas-plane-1", aircraft_type: AIR_UNIT_TYPES.CAS_PLANE, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);

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
    await tickRoom(room);

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
    await tickRoom(room);

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
      await tickRoom(room);
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

  it("heavy fighter with no eligible bomber patrols instead of sitting with an empty target", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);

    const hf = room.state.air_wings.get("hf-escort");
    assert.ok(hf);
    assert.strictEqual(hf.mission, MISSION_TYPES.ESCORT, "must stay on Escort, not flip mission");
    assert.notStrictEqual(hf.target_id, "", "must pick up a patrol target");
    assert.strictEqual(hf.lifecycle_state, WING_LIFECYCLE.TRANSIT);
  });

  it("fighter with no eligible bomber patrols and stays on ESCORT (never auto-reverts to AIR_SUPERIORITY)", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "fighter-escort", aircraft_type: AIR_UNIT_TYPES.FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "fighter-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);

    const f = room.state.air_wings.get("fighter-escort");
    assert.ok(f);
    assert.strictEqual(f.mission, MISSION_TYPES.ESCORT, "must stay on Escort, not flip mission");
    assert.notStrictEqual(f.target_id, "", "must pick up a patrol target");
    assert.strictEqual(f.lifecycle_state, WING_LIFECYCLE.TRANSIT);
  });

  it("escort patrolling with no eligible bomber upgrades to a real bomber once one becomes airborne", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "fighter-escort-2", aircraft_type: AIR_UNIT_TYPES.FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "fighter-escort-2", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);

    let f = room.state.air_wings.get("fighter-escort-2");
    assert.ok(f);
    assert.strictEqual(f.mission, MISSION_TYPES.ESCORT);
    const patrolTargetId = f.target_id;
    assert.notStrictEqual(patrolTargetId, "");

    const bomberId = await spawnWing(client, room, {
      wing_id: "cas-bomber-late", aircraft_type: AIR_UNIT_TYPES.CAS_PLANE,
      lifecycle_state: WING_LIFECYCLE.TRANSIT, mission: MISSION_TYPES.IDLE,
    });
    await tickRoom(room);

    f = room.state.air_wings.get("fighter-escort-2");
    assert.ok(f);
    assert.strictEqual(f.mission, MISSION_TYPES.ESCORT);
    assert.strictEqual(f.target_id, bomberId, "must upgrade off the patrol target onto the real bomber");
  });

  it("idle bombers ARE candidates for escort auto-assign when no airborne bomber exists at all", async () => {
    const { client, room } = await joinRoom();
    // mission: IDLE — a genuinely parked bomber with no assignment. Any AUTO_TARGETED_MISSIONS
    // value (e.g. the spawnWing helper's default of INTERCEPTION) would self-launch via its
    // own patrol-fallback tier within one tick, making it look "airborne" to Escort's tier
    // check for the wrong reason.
    await spawnWing(client, room, { wing_id: "idle-bomber", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.IDLE });
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);

    const hf = room.state.air_wings.get("hf-escort");
    assert.ok(hf);
    assert.strictEqual(hf.mission, MISSION_TYPES.ESCORT);
    assert.strictEqual(hf.target_id, "idle-bomber");
  });

  it("a grounded/refueling bomber counts as idle-tier eligible for escort", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, {
      wing_id: "refuel-bomber", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.REFUEL, mission: MISSION_TYPES.IDLE,
    });
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);

    assert.strictEqual(room.state.air_wings.get("hf-escort")?.target_id, "refuel-bomber");
  });

  it("an RTB bomber does NOT count as idle-tier eligible for escort (still transiting home, not grounded)", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, {
      wing_id: "rtb-bomber", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.RTB, mission: MISSION_TYPES.IDLE,
    });
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);

    assert.notStrictEqual(room.state.air_wings.get("hf-escort")?.target_id, "rtb-bomber");
  });

  it("an airborne bomber is ALWAYS preferred over an idle one, even a closer/less-crowded idle one", async () => {
    // Regression test for the exact bug reported: escort was picking the closer idle
    // bomber purely on distance/crowd score while ignoring a real airborne bomber. Tiering
    // (airborne tier always resolves before idle tier is even considered) must make this
    // impossible regardless of position or existing escort counts.
    const { client, room } = await joinRoom();
    await spawnWing(client, room, {
      wing_id: "idle-bomber-close", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.IDLE,
      position_lng: 8.68, position_lat: 50.06,
    });
    await spawnWing(client, room, {
      wing_id: "airborne-bomber-far", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.TRANSIT, position_lng: 20.0, position_lat: 55.0,
    });
    await spawnWing(client, room, {
      wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER,
      position_lng: 8.68, position_lat: 50.06, // spawned right next to the idle bomber
    });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);

    assert.strictEqual(room.state.air_wings.get("hf-escort")?.target_id, "airborne-bomber-far");
  });

  it("an escort committed to an idle bomber upgrades to an airborne one that appears later", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "idle-bomber", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.IDLE });
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);
    assert.strictEqual(room.state.air_wings.get("hf-escort")?.target_id, "idle-bomber",
      "precondition: escort must commit to the idle bomber first (no airborne one exists yet)");

    await spawnWing(client, room, { wing_id: "airborne-bomber", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await tickRoom(room);

    assert.strictEqual(room.state.air_wings.get("hf-escort")?.target_id, "airborne-bomber",
      "escort must upgrade from its idle bomber to the newly-available airborne one");
  });

  it("hysteresis: an escort already on an airborne bomber does not swap to a different, less-crowded airborne bomber", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "bomber-a", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);
    assert.strictEqual(room.state.air_wings.get("hf-escort")?.target_id, "bomber-a");

    // bomber-b is an equally-eligible, equally-uncovered airborne bomber — same tier as
    // bomber-a, so hysteresis must keep the escort on its current pick.
    await spawnWing(client, room, { wing_id: "bomber-b", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await tickRoom(room);

    assert.strictEqual(room.state.air_wings.get("hf-escort")?.target_id, "bomber-a");
  });

  it("orphan escort re-pairs to another airborne bomber on disband", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { wing_id: "bomber-a", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "bomber-b", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);
    assert.strictEqual(room.state.air_wings.get("hf-escort")?.target_id, "bomber-a");

    client.send("DISBAND_WING", { wing_id: "bomber-a" });
    await room.waitForNextPatch();
    await tickRoom(room);

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
    await tickRoom(room);
    assert.strictEqual(room.state.air_wings.get("hf-escort")?.target_id, "bomber-x");

    client.send("DISBAND_WING", { wing_id: "bomber-x" });
    await room.waitForNextPatch();
    await tickRoom(room);

    assert.strictEqual(room.state.air_wings.has("bomber-x"), false);
    for (const w of room.state.air_wings.values()) {
      assert.notStrictEqual(w.target_id, "bomber-x");
    }
  });

  it("regression: escort with a real airborne bomber target actually moves, not just changes lifecycle_state", async () => {
    // The reported bug: the escort's target_id/lifecycle_state looked correct (committed,
    // TRANSIT) but position_lng/position_lat never advanced tick over tick because the
    // pathfinder's "sync escort wings" block never registered a real path in _activePaths.
    // spawnWing's default mission (INTERCEPTION) makes the bomber self-launch on its own
    // patrol-fallback tier, giving it a real computed Dubins path rather than a hand-set
    // TRANSIT state with no path — a real repro for the movement bug, not just target_id.
    const { client, room } = await joinRoom();
    const bomberId = await spawnWing(client, room, {
      wing_id: "bomber-real-path", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.INTERCEPTION,
    });
    await tickRoom(room);
    const bomberAfterLaunch = room.state.air_wings.get(bomberId);
    assert.ok(bomberAfterLaunch);
    assert.strictEqual(bomberAfterLaunch.lifecycle_state, WING_LIFECYCLE.TRANSIT,
      "precondition: bomber must have actually self-launched with a real path");

    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });
    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);

    const escortAfterCommit = room.state.air_wings.get("hf-escort");
    assert.ok(escortAfterCommit);
    assert.strictEqual(escortAfterCommit.target_id, bomberId);
    assert.strictEqual(escortAfterCommit.lifecycle_state, WING_LIFECYCLE.TRANSIT);
    const startLng = escortAfterCommit.position_lng;
    const startLat = escortAfterCommit.position_lat;

    await tickRoom(room, 3);

    const escortAfterMoving = room.state.air_wings.get("hf-escort");
    assert.ok(escortAfterMoving);
    const moved = Math.abs(escortAfterMoving.position_lng - startLng) > 1e-9
      || Math.abs(escortAfterMoving.position_lat - startLat) > 1e-9;
    assert.ok(moved, "escort must physically move while escorting an airborne bomber, not stay frozen at base");
  });
});
