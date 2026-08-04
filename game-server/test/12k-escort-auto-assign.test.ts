import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, MISSION_TYPES, AIR_UNIT_TYPES, serializeWing } from "../src/rooms/schema/AirWingState.js";
import { setAirMissionTargetingEnabledForTesting } from "../src/systems/air_mission_targeting.js";
import {
  setTrailDistanceForTesting,
  setBreakoffTriggerRangeForTesting, setBreakoffAbandonRangeForTesting,
  setEngagementRangeForTesting, setRepathDriftThresholdForTesting,
  setAheadDistanceForTesting, setResumePursuitRangeForTesting,
  setRendezvousSlowdownFactorForTesting,
} from "../src/systems/air_dubins_pathfinder.js";
import { setAttackRangeForTesting } from "../src/systems/air_combat_system.js";
import { setRendezvousTimeoutTicksForTesting } from "../src/systems/air_wing_lifecycle_system.js";
import { getAirUnitStats } from "../src/data/air_unit_stats.js";

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
    // RELOCATE — a lifecycle-only RELOCATE with no redeploy target set never gets a path
    // assigned (see GameRoom.ts's "RELOCATE path loop", gated on getPendingRedeployTarget)
    // and isn't matched by any Escort tier (idle tier wants IDLE/REFUEL, airborne tier wants
    // TRANSIT/ENGAGED/LOITER) — so it stays a real dead end, keeping the starting fleet out
    // of every test's escort-candidate search.
    for (const wingId of STARTING_FLEET_BOMBER_IDS) {
      client.send("SET_WING_LIFECYCLE", { wing_id: wingId, lifecycle_state: WING_LIFECYCLE.RELOCATE });
    }
    await room.waitForNextPatch();
    // Stop the room's own real-time gameTick() interval so tests drive every tick
    // explicitly via tickRoom() — without this, a slow test can pick up an extra
    // interval-driven tick interleaved with a manual one, corrupting exact per-tick
    // assertions (see 12h-naval-bomber.test.ts's identical fix).
    (room as any).clock.clear();
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

  function setRelation(room: any, nationA: string, nationB: string, stance: string): void {
    const relation = room.state.relations.get(`${nationA}|${nationB}`)
      ?? room.state.relations.get(`${nationB}|${nationA}`);
    assert.ok(relation, `missing relation ${nationA}|${nationB}`);
    relation.stance = stance;
  }

  function dist(a: { position_lng: number; position_lat: number }, b: { position_lng: number; position_lat: number }): number {
    return Math.sqrt((a.position_lng - b.position_lng) ** 2 + (a.position_lat - b.position_lat) ** 2);
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

  it("an RTB bomber is NOT eligible for escort — a fresh escort falls to patrol duty instead", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, {
      wing_id: "rtb-bomber", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.RTB, mission: MISSION_TYPES.IDLE,
    });
    await spawnWing(client, room, { wing_id: "hf-escort", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);

    const hf = room.state.air_wings.get("hf-escort");
    assert.ok(hf);
    assert.notStrictEqual(hf.target_id, "rtb-bomber", "an RTB bomber must never be picked as an escort target");
    assert.strictEqual(hf.mission, MISSION_TYPES.ESCORT, "must stay on Escort, patrolling instead");
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

  it("escort with no replacement bomber RTBs to the FORMER bomber's airbase, not its own, when its bomber RTBs", async () => {
    const { client, room } = await joinRoom();
    // we6_germany_06 and we6_germany_01 are two distinct real airbases on this map (per
    // air_wing_starting_positions.ts) — using both, rather than sharing the suite's usual
    // single default home base, is what lets the assertion distinguish "RTB to the bomber's
    // base" from "RTB to its own base."
    const bomberHome = { position_lng: 13.385771, position_lat: 52.483566 };  // we6_germany_06
    const escortHome = { position_lng: 8.684450, position_lat: 50.063147 };   // we6_germany_01
    const bomberId = await spawnWing(client, room, {
      wing_id: "bomber-rtb-follow", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.TRANSIT, mission: MISSION_TYPES.IDLE,
      home_airbase_province_id: "we6_germany_06", ...bomberHome,
    });
    await spawnWing(client, room, {
      wing_id: "hf-escort-rtb", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER,
      home_airbase_province_id: "we6_germany_01", ...escortHome,
    });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort-rtb", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);
    assert.strictEqual(room.state.air_wings.get("hf-escort-rtb")?.target_id, bomberId,
      "precondition: escort must have committed to the bomber first");

    const pathEvents: any[] = [];
    client.onMessage("AIR_WING_PATH", (msg: any) => pathEvents.push(msg));

    client.send("SET_WING_LIFECYCLE", { wing_id: bomberId, lifecycle_state: WING_LIFECYCLE.RTB });
    await room.waitForNextPatch();
    await tickRoom(room); // same-tick retarget: no other bomber exists, so escort itself goes RTB

    const escort = room.state.air_wings.get("hf-escort-rtb");
    assert.ok(escort);
    assert.strictEqual(escort.target_id, "", "escort must drop the RTB'd bomber, not keep following it");
    assert.strictEqual(escort.lifecycle_state, WING_LIFECYCLE.RTB,
      "with no replacement bomber available, escort must RTB itself");

    await tickRoom(room); // let _assignRtbPaths compute and broadcast the actual RTB path

    const rtbPathEvent = pathEvents.find(e => e.wing_id === "hf-escort-rtb");
    assert.ok(rtbPathEvent, "expected an AIR_WING_PATH broadcast assigning the escort's RTB path");
    const distEndToBomberHome = dist(
      { position_lng: rtbPathEvent.end_lng, position_lat: rtbPathEvent.end_lat },
      { position_lng: bomberHome.position_lng, position_lat: bomberHome.position_lat });
    const distEndToOwnHome = dist(
      { position_lng: rtbPathEvent.end_lng, position_lat: rtbPathEvent.end_lat },
      { position_lng: escortHome.position_lng, position_lat: escortHome.position_lat });
    assert.ok(distEndToBomberHome < 0.01,
      `escort's RTB path must end at the bomber's base, not its own (path ends at (${rtbPathEvent.end_lng}, ${rtbPathEvent.end_lat}), bomber home dist ${distEndToBomberHome}, own home dist ${distEndToOwnHome})`);
  });

  it("escort lands and refuels with its bomber, then auto-recommits once retargetable again", async () => {
    const { client, room } = await joinRoom();
    const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
    const bomberId = await spawnWing(client, room, {
      wing_id: "bomber-relaunch", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.TRANSIT, mission: MISSION_TYPES.IDLE, ...homePos,
    });
    await spawnWing(client, room, {
      wing_id: "hf-escort-relaunch", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER, ...homePos,
    });

    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort-relaunch", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);

    client.send("SET_WING_LIFECYCLE", { wing_id: bomberId, lifecycle_state: WING_LIFECYCLE.RTB });
    await room.waitForNextPatch();

    // Run enough ticks for both wings to land, refuel back to IDLE, and re-commit.
    await tickRoom(room, 20);

    const escort = room.state.air_wings.get("hf-escort-relaunch");
    assert.ok(escort);
    assert.strictEqual(escort.mission, MISSION_TYPES.ESCORT, "must still be on Escort, not some other mission");
    // LOITER is now a normal ahead-formation state (circling while its bomber catches up),
    // not just a "stuck at base" symptom — check for genuine recommitment instead.
    assert.notStrictEqual(escort.target_id, "", "must have re-committed to a live bomber, not sit targetless");
  });

  // ── Formation flying: trail / weave / break-off ─────────────────────────────

  it("an escort maintains separation from its bomber instead of co-locating", async () => {
    const { client, room } = await joinRoom();
    const bomberId = await spawnWing(client, room, {
      wing_id: "bomber-formation", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.INTERCEPTION,
    });
    await tickRoom(room); // self-launch: bomber gets a real Dubins path

    await spawnWing(client, room, { wing_id: "hf-escort-formation", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER });
    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort-formation", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);
    assert.strictEqual(room.state.air_wings.get("hf-escort-formation")?.target_id, bomberId,
      "precondition: escort must have committed to the bomber");

    await tickRoom(room, 5);

    const bomber = room.state.air_wings.get(bomberId);
    const escortAfter = room.state.air_wings.get("hf-escort-formation");
    assert.ok(bomber && escortAfter);
    const d = dist(bomber, escortAfter);
    assert.ok(d > 0.01, `escort must not be co-located with its bomber (distance was ${d})`);
  });

  it("an escort gets ahead of a slower bomber and circles until the bomber closes back in, then resumes", async () => {
    // A wide ahead-distance relative to the resume range, so there's a real multi-tick gap
    // for the (slow) bomber to close before resume triggers — otherwise, since the escort
    // arrives at the ahead point almost immediately (it's much faster) and that point sits
    // directly on the bomber's own straight flight line, the bomber can close a small gap
    // within a single tick, making the "still loitering" window impossible to observe.
    // Defaults (AHEAD_DISTANCE_DEG=0.5, RESUME_PURSUIT_RANGE_DEG=0.3) already give a real
    // multi-tick gap for the (slow) bomber to close before resume triggers — otherwise,
    // since the escort arrives at the ahead point almost immediately (it's much faster) and
    // that point sits directly on the bomber's own straight flight line, the bomber can
    // close a small gap within a single tick, making the "still loitering" window impossible
    // to observe. Set explicitly anyway so this test doesn't silently drift if the defaults
    // change again.
    setAheadDistanceForTesting(0.5);
    setResumePursuitRangeForTesting(0.3);
    try {
      const { client, room } = await joinRoom();
      const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
      const bomberId = await spawnWing(client, room, {
        wing_id: "bomber-slow", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
        lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.IDLE, ...homePos,
      });
      client.send("SUBMIT_AIR_WING_MOVE", { wing_id: bomberId, target_lng: homePos.position_lng + 5, target_lat: homePos.position_lat + 3 });
      await room.waitForNextPatch();

      await spawnWing(client, room, { wing_id: "fighter-ahead", aircraft_type: AIR_UNIT_TYPES.FIGHTER, ...homePos });
      client.send("ASSIGN_WING_MISSION", { wing_id: "fighter-ahead", mission: MISSION_TYPES.ESCORT, target_id: "" });
      await room.waitForNextPatch();
      await tickRoom(room);
      assert.strictEqual(room.state.air_wings.get("fighter-ahead")?.target_id, bomberId,
        "precondition: escort must have committed to the bomber");

      let sawLoiter = false;
      for (let i = 0; i < 12; i++) {
        await tickRoom(room);
        if (room.state.air_wings.get("fighter-ahead")?.lifecycle_state === WING_LIFECYCLE.LOITER) {
          sawLoiter = true;
          break;
        }
      }
      assert.ok(sawLoiter, "escort must enter LOITER once it's arrived ahead of its (slower) bomber");

      // While still loitering, the bomber hasn't closed the gap yet — must stay in LOITER.
      await tickRoom(room);
      assert.strictEqual(room.state.air_wings.get("fighter-ahead")?.lifecycle_state, WING_LIFECYCLE.LOITER,
        "escort must keep circling while the bomber is still out of resume range");

      // Run enough ticks for the bomber's own forward progress to close the gap.
      let sawResume = false;
      for (let i = 0; i < 20; i++) {
        await tickRoom(room);
        if (room.state.air_wings.get("fighter-ahead")?.lifecycle_state === WING_LIFECYCLE.TRANSIT) {
          sawResume = true;
          break;
        }
      }
      assert.ok(sawResume, "escort must resume TRANSIT once the bomber closes back within range");
    } finally {
      setAheadDistanceForTesting(0.5);
      setResumePursuitRangeForTesting(0.3);
    }
  });

  it("a break-off started while loitering clears the loiter state and re-evaluates fresh afterward", async () => {
    setAheadDistanceForTesting(0.5);
    setBreakoffTriggerRangeForTesting(0.6);
    try {
      const { client, room } = await joinRoom();
      setRelation(room, "germany", "france", "war");
      const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
      const bomberId = await spawnWing(client, room, {
        wing_id: "bomber-loiter-breakoff", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
        lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.IDLE, ...homePos,
      });
      // A real straight-line path, not just a bare TRANSIT with no path (which would fall
      // back to an immediate self-LOITER with a constantly-rotating heading, making the
      // ahead point an unreliable, ever-shifting target for this test's precondition).
      client.send("SUBMIT_AIR_WING_MOVE", { wing_id: bomberId, target_lng: homePos.position_lng + 5, target_lat: homePos.position_lat + 3 });
      await room.waitForNextPatch();
      await spawnWing(client, room, { wing_id: "fighter-loiter-breakoff", aircraft_type: AIR_UNIT_TYPES.FIGHTER, ...homePos });
      client.send("ASSIGN_WING_MISSION", { wing_id: "fighter-loiter-breakoff", mission: MISSION_TYPES.ESCORT, target_id: "" });
      await room.waitForNextPatch();
      await tickRoom(room);
      assert.strictEqual(room.state.air_wings.get("fighter-loiter-breakoff")?.target_id, bomberId,
        "precondition: escort must have committed to the bomber");

      let sawLoiter = false;
      for (let i = 0; i < 12; i++) {
        await tickRoom(room);
        if (room.state.air_wings.get("fighter-loiter-breakoff")?.lifecycle_state === WING_LIFECYCLE.LOITER) {
          sawLoiter = true;
          break;
        }
      }
      assert.ok(sawLoiter, "precondition: escort must be loitering ahead of its bomber");

      // Spawn the hostile near the bomber's CURRENT position (it's moved well away from
      // homePos by now, given the wide ahead-distance used to force a multi-tick approach).
      const bomberNow = room.state.air_wings.get(bomberId);
      assert.ok(bomberNow);
      const hostileId = await spawnWing(client, room, {
        wing_id: "hostile-loiter-breakoff", nation_id: "france", aircraft_type: AIR_UNIT_TYPES.FIGHTER,
        lifecycle_state: WING_LIFECYCLE.TRANSIT, mission: MISSION_TYPES.IDLE,
        position_lng: bomberNow.position_lng + 0.3, position_lat: bomberNow.position_lat,
      });
      const hostile = room.state.air_wings.get(hostileId);
      assert.ok(hostile);
      hostile.target_id = bomberId;

      await tickRoom(room, 2);

      const escort = room.state.air_wings.get("fighter-loiter-breakoff");
      assert.ok(escort);
      assert.strictEqual(escort.escort_intercept_id, hostileId,
        "escort must break off toward the hostile even while it was loitering");
      assert.notStrictEqual(escort.lifecycle_state, WING_LIFECYCLE.LOITER,
        "escort must leave LOITER once it's actively pursuing the threat");
    } finally {
      setAheadDistanceForTesting(0.5);
      setBreakoffTriggerRangeForTesting(0.6);
    }
  });

  it("escort breaks off toward a hostile wing hunting its bomber, within trigger range", async () => {
    setBreakoffTriggerRangeForTesting(0.6);
    const { client, room } = await joinRoom();
    setRelation(room, "germany", "france", "war");

    const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
    const bomberId = await spawnWing(client, room, {
      wing_id: "bomber-breakoff", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.TRANSIT, mission: MISSION_TYPES.IDLE, ...homePos,
    });
    await spawnWing(client, room, {
      wing_id: "hf-escort-breakoff", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER, ...homePos,
    });
    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort-breakoff", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);
    assert.strictEqual(room.state.air_wings.get("hf-escort-breakoff")?.target_id, bomberId,
      "precondition: escort must have committed to the bomber");

    const hostileId = await spawnWing(client, room, {
      wing_id: "hostile-interceptor", nation_id: "france", aircraft_type: AIR_UNIT_TYPES.FIGHTER,
      lifecycle_state: WING_LIFECYCLE.TRANSIT, mission: MISSION_TYPES.IDLE,
      position_lng: homePos.position_lng + 0.3, position_lat: homePos.position_lat,
    });
    const hostile = room.state.air_wings.get(hostileId);
    assert.ok(hostile);
    hostile.target_id = bomberId;

    await tickRoom(room, 3);

    const escort = room.state.air_wings.get("hf-escort-breakoff");
    assert.ok(escort);
    assert.strictEqual(escort.escort_intercept_id, hostileId,
      "escort must break off toward the hostile wing hunting its bomber");
  });

  it("escort abandons a break-off if the hostile stops targeting the bomber before contact", async () => {
    setBreakoffTriggerRangeForTesting(0.6);
    setBreakoffAbandonRangeForTesting(0.9);
    const { client, room } = await joinRoom();
    setRelation(room, "germany", "france", "war");

    const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
    const bomberId = await spawnWing(client, room, {
      wing_id: "bomber-abandon", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.TRANSIT, mission: MISSION_TYPES.IDLE, ...homePos,
    });
    await spawnWing(client, room, {
      wing_id: "hf-escort-abandon", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER, ...homePos,
    });
    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort-abandon", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);

    const hostileId = await spawnWing(client, room, {
      wing_id: "hostile-fickle", nation_id: "france", aircraft_type: AIR_UNIT_TYPES.FIGHTER,
      lifecycle_state: WING_LIFECYCLE.TRANSIT, mission: MISSION_TYPES.IDLE,
      position_lng: homePos.position_lng + 0.3, position_lat: homePos.position_lat,
    });
    const hostile = room.state.air_wings.get(hostileId);
    assert.ok(hostile);
    hostile.target_id = bomberId;

    await tickRoom(room);
    assert.strictEqual(room.state.air_wings.get("hf-escort-abandon")?.escort_intercept_id, hostileId,
      "precondition: escort must have broken off toward the hostile");

    // Hostile gives up on the bomber before the escort reaches it.
    hostile.target_id = "some-other-wing";
    await tickRoom(room, 2);

    const escort = room.state.air_wings.get("hf-escort-abandon");
    assert.ok(escort);
    assert.strictEqual(escort.escort_intercept_id, "", "escort must abandon the break-off");
    assert.notStrictEqual(escort.lifecycle_state, WING_LIFECYCLE.ENGAGED,
      "escort must never have reached combat with the abandoned threat");
  });

  it("escort re-commits to a live bomber after a forced RTB/refuel cycle from a resolved engagement", async () => {
    const { client, room } = await joinRoom();
    setRelation(room, "germany", "france", "war");

    const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
    const bomberId = await spawnWing(client, room, {
      wing_id: "bomber-postfight", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.TRANSIT, mission: MISSION_TYPES.IDLE, ...homePos,
    });
    await spawnWing(client, room, {
      wing_id: "hf-escort-postfight", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER, ...homePos,
    });
    client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort-postfight", mission: MISSION_TYPES.ESCORT, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);

    // Hostile spawned co-located with the escort so combat begins immediately, without
    // needing to simulate the pursuit path closing the distance.
    await spawnWing(client, room, {
      wing_id: "hostile-melee", nation_id: "france", aircraft_type: AIR_UNIT_TYPES.FIGHTER,
      lifecycle_state: WING_LIFECYCLE.TRANSIT, mission: MISSION_TYPES.IDLE, ...homePos,
    });

    // Run enough ticks for combat to resolve (forcing RTB, since perk_multi_sortie defaults
    // false) and for the escort to land, refuel, and auto-recommit to a live bomber again.
    await tickRoom(room, 25);

    const escort = room.state.air_wings.get("hf-escort-postfight");
    assert.ok(escort);
    assert.strictEqual(escort.mission, MISSION_TYPES.ESCORT, "must still be on Escort");
    assert.notStrictEqual(escort.target_id, "", "must have re-committed to a live target after the fight");
  });

  // ── Formation-flying smoothing: drift-gated re-path (no teleport) ──────────

  it("a trailing escort's per-tick position delta never exceeds its own travel budget (no teleport)", async () => {
    // Neutralize the rendezvous slowdown (round 4) — this test's escort deliberately shares
    // the bomber's own aircraft type/speed so it can never actually catch up and reach
    // LOITER, isolating the pursuit-phase path-rebuild behavior under test. With the real
    // rendezvous slowdown active, the bomber itself would crawl at reduced speed while
    // "awaiting" this same-speed escort, letting it catch up anyway — an unrelated
    // interaction this test isn't about.
    setRendezvousSlowdownFactorForTesting(1);
    try {
      const { client, room } = await joinRoom();
      const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
      const bomberId = await spawnWing(client, room, {
        wing_id: "bomber-smooth", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
        lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.IDLE, ...homePos,
      });
      // A long straight transit, well beyond this test's tick budget, so the bomber never
      // completes its path and re-enters LOITER (whose fast heading rotation during a tight
      // orbit would legitimately swing the trail point — not the teleport bug under test).
      client.send("SUBMIT_AIR_WING_MOVE", { wing_id: bomberId, target_lng: homePos.position_lng + 5, target_lat: homePos.position_lat + 3 });
      await room.waitForNextPatch();

      // Spawn already matched to the bomber's own type (rather than overriding aircraft_type
      // after commit) so the trail branch is exercised from the very first tick — switching
      // types mid-flight would itself cause a one-time weave-to-trail mode transition with a
      // legitimate one-time repath, which is not what this test is checking for.
      await spawnWing(client, room, { wing_id: "hf-escort-smooth", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, ...homePos });
      client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort-smooth", mission: MISSION_TYPES.ESCORT, target_id: "" });
      await room.waitForNextPatch();
      await tickRoom(room);
      assert.strictEqual(room.state.air_wings.get("hf-escort-smooth")?.target_id, bomberId,
        "precondition: escort must have committed to the bomber");

      const escort = room.state.air_wings.get("hf-escort-smooth");
      assert.ok(escort);
      const maxTravelPerTick = getAirUnitStats(AIR_UNIT_TYPES.STRATEGIC_BOMBER).speed_deg_per_ms * 1000;

      let prev = { position_lng: escort.position_lng, position_lat: escort.position_lat };
      for (let i = 0; i < 8; i++) {
        await tickRoom(room);
        const after = room.state.air_wings.get("hf-escort-smooth");
        assert.ok(after);
        const delta = dist(prev, after);
        assert.ok(delta <= maxTravelPerTick * 1.5,
          `escort position jumped ${delta} deg in one tick (budget ${maxTravelPerTick}, tick ${i}) — looks like a teleport`);
        prev = { position_lng: after.position_lng, position_lat: after.position_lat };
      }
    } finally {
      setRendezvousSlowdownFactorForTesting(0.3);
    }
  });

  it("holds a still-valid path across ticks instead of rebuilding on every trivial move, but still reacts to a real jump", async () => {
    // A real bomber in flight displaces ~0.16-0.24 deg every tick at current speeds — always
    // past any threshold small enough to also filter out genuine noise — so this isolates the
    // *mechanism* (drift-vs-expiry gating) with an oversized threshold that defeats drift as a
    // trigger, proving rebuilds are then governed purely by path expiry (i.e. the escort holds
    // a still-valid path instead of discarding it every tick), then restores the real default
    // and confirms a real target jump still forces an immediate rebuild.
    setRepathDriftThresholdForTesting(5);
    // Neutralize the rendezvous slowdown (round 4) — this test's tick counts and "rebuild on
    // the very next tick after a heading jump" assertion assume the bomber flies at its
    // normal speed throughout, not the reduced rendezvous rate while its escort is still
    // catching up from 2deg away.
    setRendezvousSlowdownFactorForTesting(1);
    try {
      const { client, room } = await joinRoom();
      const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
      const bomberId = await spawnWing(client, room, {
        wing_id: "bomber-hold", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
        lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.IDLE, ...homePos,
      });
      client.send("SUBMIT_AIR_WING_MOVE", { wing_id: bomberId, target_lng: homePos.position_lng + 5, target_lat: homePos.position_lat + 3 });
      await room.waitForNextPatch();

      // Escort spawns far away, so its initial rendezvous path takes several ticks to
      // complete — with drift defeated by the oversized threshold, only expiry can force
      // a rebuild here.
      await spawnWing(client, room, {
        wing_id: "hf-escort-distant", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER,
        position_lng: homePos.position_lng + 2, position_lat: homePos.position_lat + 2,
      });
      client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort-distant", mission: MISSION_TYPES.ESCORT, target_id: "" });
      await room.waitForNextPatch();
      await tickRoom(room);
      assert.strictEqual(room.state.air_wings.get("hf-escort-distant")?.target_id, bomberId,
        "precondition: escort must have committed to the bomber");

      const pathEvents: any[] = [];
      client.onMessage("AIR_WING_PATH", (msg: any) => pathEvents.push(msg));

      const ticks = 4;
      await tickRoom(room, ticks);
      const rebuilds = pathEvents.filter(e => e.wing_id === "hf-escort-distant").length;
      assert.ok(rebuilds < ticks,
        `expected the still-valid rendezvous path to be held (drift disabled via testing hook), saw ${rebuilds}/${ticks} rebuilds`);

      // Restore the real default threshold, then force a large jump in the bomber's
      // heading and confirm the escort's trail-point rebuild reacts on the very next tick.
      setRepathDriftThresholdForTesting(0.35);
      pathEvents.length = 0;
      const bomber = room.state.air_wings.get(bomberId);
      assert.ok(bomber);
      (bomber as any).heading_deg = ((bomber.heading_deg + 90) % 360);
      await tickRoom(room);
      assert.ok(pathEvents.some(e => e.wing_id === "hf-escort-distant"),
        "expected a rebuild once the bomber's heading (and thus the trail point) drifted");
    } finally {
      setRepathDriftThresholdForTesting(0.35);
      setRendezvousSlowdownFactorForTesting(0.3);
    }
  });

  // ── Lead-projected trail/weave anchor: no hop-then-freeze stutter once caught up ──

  it("a trailing escort's per-tick position deltas stay consistent once caught up (no hop-then-freeze stutter)", async () => {
    // Neutralize the rendezvous slowdown (round 4) — see the "no teleport" test above for
    // why this same-speed escort setup needs it disabled.
    setRendezvousSlowdownFactorForTesting(1);
    try {
      const { client, room } = await joinRoom();
      const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
      const bomberId = await spawnWing(client, room, {
        wing_id: "bomber-nostutter", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
        lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.IDLE, ...homePos,
      });
      client.send("SUBMIT_AIR_WING_MOVE", { wing_id: bomberId, target_lng: homePos.position_lng + 5, target_lat: homePos.position_lat + 3 });
      await room.waitForNextPatch();

      // Spawn already matched to the bomber's own type, at the bomber's position, so there's
      // no rendezvous phase to skew the deltas — the escort is "caught up" from the first tick.
      await spawnWing(client, room, { wing_id: "hf-escort-nostutter", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, ...homePos });
      client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort-nostutter", mission: MISSION_TYPES.ESCORT, target_id: "" });
      await room.waitForNextPatch();
      await tickRoom(room);
      assert.strictEqual(room.state.air_wings.get("hf-escort-nostutter")?.target_id, bomberId,
        "precondition: escort must have committed to the bomber");

      const escort = room.state.air_wings.get("hf-escort-nostutter");
      assert.ok(escort);
      const maxTravelPerTick = getAirUnitStats(AIR_UNIT_TYPES.STRATEGIC_BOMBER).speed_deg_per_ms * 1000;

      let prev = { position_lng: escort.position_lng, position_lat: escort.position_lat };
      const deltas: number[] = [];
      for (let i = 0; i < 10; i++) {
        await tickRoom(room);
        const after = room.state.air_wings.get("hf-escort-nostutter");
        assert.ok(after);
        deltas.push(dist(prev, after));
        prev = { position_lng: after.position_lng, position_lat: after.position_lat };
      }
      // Drop the first couple of ticks (settling into formation); every subsequent delta
      // should be a healthy fraction of the max per-tick travel budget — not near-zero
      // (frozen) followed by a large catch-up hop.
      const steadyState = deltas.slice(2);
      for (const [idx, d] of steadyState.entries()) {
        assert.ok(d > maxTravelPerTick * 0.5,
          `steady-state tick ${idx + 2} delta ${d} looks frozen/near-zero relative to budget ${maxTravelPerTick} — stutter regression`);
      }
    } finally {
      setRendezvousSlowdownFactorForTesting(0.3);
    }
  });

  // Note: the lead-projected anchor does NOT reduce how often the path gets rebuilt — a
  // continuously-moving bomber's trail point drifts by roughly its own per-tick
  // displacement (~0.16-0.24 deg) every tick, always past REPATH_DRIFT_THRESHOLD_DEG (0.03),
  // so a rebuild every tick is expected and correct. What the lead fixes is each rebuilt
  // path's *length*: without it, a caught-up follower's path degenerates to near-zero length
  // (saturates instantly, "freezes" for the rest of that tick, "hops" the next) — with it,
  // each rebuild's path has real length matching a normal tick's worth of travel, so
  // consecutive ticks show smooth, consistent motion instead of a hop-then-freeze stutter.
  // (The equivalent weave-branch test was removed when weave was replaced by the
  // ahead/circle-and-wait formation logic above — a faster escort now settles into LOITER
  // rather than an oscillating weave, covered by the loiter/resume tests above.)

  it("recon follow's per-tick position deltas stay consistent once caught up (no hop-then-freeze stutter)", async () => {
    // A "hold station once caught up" state analogous to escort's LOITER was attempted for
    // recon and reverted (see the isRecon branch's comment in air_dubins_pathfinder.ts) —
    // recon's speed edge over a typical bomber is too small to reliably detect an "arrived"
    // moment the way escort's fighter can. This test instead verifies the fallback property
    // that IS reliably true: REPATH_DRIFT_THRESHOLD_DEG plus the lead-projected anchor
    // (round 2) keep recon holding a valid multi-tick path most ticks rather than
    // saturating/rebuilding every single tick.
    const { client, room } = await joinRoom();
    const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
    const bomberId = await spawnWing(client, room, {
      wing_id: "bomber-lead-recon", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.IDLE, ...homePos,
    });
    // A real straight-line path, not a bare mission self-launch (which can fall back to an
    // unstable self-LOITER with a constantly-rotating heading, destabilizing the trail point
    // this test needs to converge against).
    client.send("SUBMIT_AIR_WING_MOVE", { wing_id: bomberId, target_lng: homePos.position_lng + 5, target_lat: homePos.position_lat + 3 });
    await room.waitForNextPatch();

    await spawnWing(client, room, { wing_id: "recon-lead", aircraft_type: AIR_UNIT_TYPES.RECON_PLANE, ...homePos });
    client.send("ASSIGN_WING_MISSION", { wing_id: "recon-lead", mission: MISSION_TYPES.RECON, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);
    assert.strictEqual(room.state.air_wings.get("recon-lead")?.target_id, bomberId,
      "precondition: recon must have committed to tier 1 (bomber escort-follow)");
    await tickRoom(room, 4); // settle into steady-state trailing

    const recon = room.state.air_wings.get("recon-lead");
    assert.ok(recon);
    const maxTravelPerTick = getAirUnitStats(AIR_UNIT_TYPES.RECON_PLANE).speed_deg_per_ms * 1000;

    let prev = { position_lng: recon.position_lng, position_lat: recon.position_lat };
    for (let i = 0; i < 6; i++) {
      await tickRoom(room);
      const after = room.state.air_wings.get("recon-lead");
      assert.ok(after);
      const d = dist(prev, after);
      assert.ok(d > maxTravelPerTick * 0.5,
        `steady-state recon-follow tick ${i} delta ${d} looks frozen/near-zero relative to budget ${maxTravelPerTick} — stutter regression`);
      prev = { position_lng: after.position_lng, position_lat: after.position_lat };
    }
  });

  it("escort break-off pursuit still rebuilds every tick, unaffected by the drift gate", async () => {
    setBreakoffTriggerRangeForTesting(0.6);
    // Disable actual combat so engagement doesn't cut the pursuit short mid-test — this
    // test is only about path-rebuild cadence, not combat resolution.
    setEngagementRangeForTesting(0);
    setAttackRangeForTesting(0);
    try {
      const { client, room } = await joinRoom();
      setRelation(room, "germany", "france", "war");

      const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
      const bomberId = await spawnWing(client, room, {
        wing_id: "bomber-pursuit-rebuild", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
        lifecycle_state: WING_LIFECYCLE.TRANSIT, mission: MISSION_TYPES.IDLE, ...homePos,
      });
      await spawnWing(client, room, {
        wing_id: "hf-escort-pursuit-rebuild", aircraft_type: AIR_UNIT_TYPES.HEAVY_FIGHTER, ...homePos,
      });
      client.send("ASSIGN_WING_MISSION", { wing_id: "hf-escort-pursuit-rebuild", mission: MISSION_TYPES.ESCORT, target_id: "" });
      await room.waitForNextPatch();
      await tickRoom(room);
      assert.strictEqual(room.state.air_wings.get("hf-escort-pursuit-rebuild")?.target_id, bomberId,
        "precondition: escort must have committed to the bomber");

      const hostileId = await spawnWing(client, room, {
        wing_id: "hostile-pursuit-rebuild", nation_id: "france", aircraft_type: AIR_UNIT_TYPES.FIGHTER,
        lifecycle_state: WING_LIFECYCLE.TRANSIT, mission: MISSION_TYPES.IDLE,
        position_lng: homePos.position_lng + 0.3, position_lat: homePos.position_lat,
      });
      const hostile = room.state.air_wings.get(hostileId);
      assert.ok(hostile);
      hostile.target_id = bomberId;

      await tickRoom(room); // establishes the break-off
      assert.strictEqual(room.state.air_wings.get("hf-escort-pursuit-rebuild")?.escort_intercept_id, hostileId,
        "precondition: escort must be mid break-off");

      const pathEvents: any[] = [];
      client.onMessage("AIR_WING_PATH", (msg: any) => pathEvents.push(msg));
      const ticks = 3;
      await tickRoom(room, ticks);
      const rebuilds = pathEvents.filter(e => e.wing_id === "hf-escort-pursuit-rebuild").length;
      assert.strictEqual(rebuilds, ticks, "break-off pursuit must still rebuild a fresh path every tick");
    } finally {
      setEngagementRangeForTesting(0.3);
      setAttackRangeForTesting(0.3);
    }
  });

  // ── Recon tier-1: continuous bomber following (not a fixed-point orbit) ────

  it("a recon wing continuously follows its assigned bomber instead of orbiting a fixed point", async () => {
    const { client, room } = await joinRoom();
    const bomberId = await spawnWing(client, room, {
      wing_id: "bomber-recon-follow", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.INTERCEPTION,
    });
    await tickRoom(room); // self-launch: bomber gets a real Dubins path

    await spawnWing(client, room, { wing_id: "recon-follow", aircraft_type: AIR_UNIT_TYPES.RECON_PLANE });
    client.send("ASSIGN_WING_MISSION", { wing_id: "recon-follow", mission: MISSION_TYPES.RECON, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);
    assert.strictEqual(room.state.air_wings.get("recon-follow")?.target_id, bomberId,
      "precondition: recon must have committed to tier 1 (bomber escort-follow)");

    const distances: number[] = [];
    for (let i = 0; i < 6; i++) {
      await tickRoom(room);
      const bomber = room.state.air_wings.get(bomberId);
      const recon = room.state.air_wings.get("recon-follow");
      assert.ok(bomber && recon);
      assert.notStrictEqual(recon.lifecycle_state, WING_LIFECYCLE.LOITER,
        `recon must not settle into a fixed-point orbit while its bomber keeps moving (tick ${i})`);
      distances.push(dist(bomber, recon));
    }
    for (const d of distances) {
      assert.ok(d > 0.01 && d < 0.5, `recon must keep pace near its bomber, not drift away or co-locate (saw ${d})`);
    }
  });

  it("a recon wing drops its bomber and re-targets the same tick the bomber goes RTB", async () => {
    const { client, room } = await joinRoom();
    const bomberId = await spawnWing(client, room, {
      wing_id: "bomber-recon-rtb", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.INTERCEPTION,
    });
    await tickRoom(room); // self-launch: bomber gets a real Dubins path

    // A second eligible bomber, far away, so the recon has somewhere else to go.
    const secondBomberId = await spawnWing(client, room, {
      wing_id: "bomber-recon-rtb-2", aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER,
      lifecycle_state: WING_LIFECYCLE.TRANSIT, mission: MISSION_TYPES.IDLE,
      position_lng: 13.385771 + 3, position_lat: 52.483566 + 2,
    });

    await spawnWing(client, room, { wing_id: "recon-rtb-drop", aircraft_type: AIR_UNIT_TYPES.RECON_PLANE });
    client.send("ASSIGN_WING_MISSION", { wing_id: "recon-rtb-drop", mission: MISSION_TYPES.RECON, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);
    assert.strictEqual(room.state.air_wings.get("recon-rtb-drop")?.target_id, bomberId,
      "precondition: recon must have committed to the first bomber");

    await tickRoom(room, 2); // let it close in and start following

    const bomber = room.state.air_wings.get(bomberId);
    assert.ok(bomber);
    (bomber as any).lifecycle_state = WING_LIFECYCLE.RTB;
    await tickRoom(room);

    const recon = room.state.air_wings.get("recon-rtb-drop");
    assert.ok(recon);
    assert.notStrictEqual(recon.target_id, bomberId,
      "recon must drop the RTB'd bomber the same tick, not keep following it home");
    assert.strictEqual(recon.target_id, secondBomberId,
      "recon must re-commit to the other still-flying eligible bomber");
  });

  it("a recon wing falls to a border-patrol tier when its bomber RTBs and no other bomber is eligible", async () => {
    const { client, room } = await joinRoom();
    setRelation(room, "germany", "france", "war");
    const bomberId = await spawnWing(client, room, {
      wing_id: "bomber-recon-rtb-solo", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
      lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.INTERCEPTION,
    });
    await tickRoom(room);

    await spawnWing(client, room, { wing_id: "recon-rtb-solo", aircraft_type: AIR_UNIT_TYPES.RECON_PLANE });
    client.send("ASSIGN_WING_MISSION", { wing_id: "recon-rtb-solo", mission: MISSION_TYPES.RECON, target_id: "" });
    await room.waitForNextPatch();
    await tickRoom(room);
    assert.strictEqual(room.state.air_wings.get("recon-rtb-solo")?.target_id, bomberId,
      "precondition: recon must have committed to the only bomber");

    await tickRoom(room, 2);

    const bomber = room.state.air_wings.get(bomberId);
    assert.ok(bomber);
    (bomber as any).lifecycle_state = WING_LIFECYCLE.RTB;
    await tickRoom(room);

    const recon = room.state.air_wings.get("recon-rtb-solo");
    assert.ok(recon);
    assert.notStrictEqual(recon.target_id, bomberId,
      "recon must drop the RTB'd bomber even with nothing else to escort");
    assert.notStrictEqual(recon.target_id, "",
      "recon must fall through to a border-patrol tier rather than sitting targetless");
  });

  // ── Escort rendezvous: bomber holds back until its escort gets ahead ───────

  describe("escort rendezvous", () => {
    it("a freshly-escorted bomber slows down and speeds back up once the escort forms up ahead", async () => {
      const { client, room } = await joinRoom();
      const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
      const bomberId = await spawnWing(client, room, {
        wing_id: "bomber-rendezvous", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
        lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.IDLE, ...homePos,
      });
      client.send("SUBMIT_AIR_WING_MOVE", { wing_id: bomberId, target_lng: homePos.position_lng + 5, target_lat: homePos.position_lat + 3 });
      await room.waitForNextPatch();

      await spawnWing(client, room, { wing_id: "fighter-rendezvous", aircraft_type: AIR_UNIT_TYPES.FIGHTER, ...homePos });
      client.send("ASSIGN_WING_MISSION", { wing_id: "fighter-rendezvous", mission: MISSION_TYPES.ESCORT, target_id: "" });
      await room.waitForNextPatch();
      await tickRoom(room);
      assert.strictEqual(room.state.air_wings.get("fighter-rendezvous")?.target_id, bomberId,
        "precondition: escort must have committed to the bomber");
      assert.strictEqual(room.state.air_wings.get(bomberId)?.escorted_by_wing_id, "fighter-rendezvous",
        "bomber must record its escort's wing_id the moment it commits");
      assert.strictEqual(room.state.air_wings.get(bomberId)?.awaiting_escort_rendezvous, true,
        "bomber must start holding back for a freshly-committed escort");

      const bomberSpeedBudget = getAirUnitStats(AIR_UNIT_TYPES.STRATEGIC_BOMBER).speed_deg_per_ms * 1000;
      let prev = { position_lng: room.state.air_wings.get(bomberId)!.position_lng, position_lat: room.state.air_wings.get(bomberId)!.position_lat };
      await tickRoom(room);
      let bomber = room.state.air_wings.get(bomberId);
      assert.ok(bomber);
      assert.ok(bomber.awaiting_escort_rendezvous, "escort has not caught up yet — bomber must still be holding back");
      const slowedDelta = dist(prev, bomber);
      assert.ok(slowedDelta < bomberSpeedBudget * 0.7,
        `bomber's per-tick delta ${slowedDelta} should be well under its normal budget ${bomberSpeedBudget} while awaiting rendezvous`);

      let sawResume = false;
      for (let i = 0; i < 20; i++) {
        await tickRoom(room);
        const escort = room.state.air_wings.get("fighter-rendezvous");
        if (escort?.lifecycle_state === WING_LIFECYCLE.LOITER) {
          sawResume = true;
          break;
        }
      }
      assert.ok(sawResume, "escort must eventually get ahead of the (slower) bomber and settle into LOITER");
      // One more tick: air_wing_lifecycle_system.ts's per-wing loop (which clears the flag)
      // runs before air_dubins_pathfinder.ts's tick (which just transitioned the escort into
      // LOITER above) within the same room tick, so the bomber's flag only clears on the
      // tick AFTER the escort is observed reaching LOITER, not the same one.
      await tickRoom(room);
      assert.strictEqual(room.state.air_wings.get(bomberId)?.awaiting_escort_rendezvous, false,
        "bomber must resume normal speed once its escort has formed up ahead");
    });

    it("escort reassigned away mid-rendezvous clears the bomber's flag (self-correcting, no reciprocal cleanup needed)", async () => {
      const { client, room } = await joinRoom();
      const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
      const bomberId = await spawnWing(client, room, {
        wing_id: "bomber-rendezvous-drop", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
        lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.IDLE, ...homePos,
      });
      client.send("SUBMIT_AIR_WING_MOVE", { wing_id: bomberId, target_lng: homePos.position_lng + 5, target_lat: homePos.position_lat + 3 });
      await room.waitForNextPatch();

      await spawnWing(client, room, { wing_id: "fighter-rendezvous-drop", aircraft_type: AIR_UNIT_TYPES.FIGHTER, ...homePos });
      client.send("ASSIGN_WING_MISSION", { wing_id: "fighter-rendezvous-drop", mission: MISSION_TYPES.ESCORT, target_id: "" });
      await room.waitForNextPatch();
      await tickRoom(room);
      assert.strictEqual(room.state.air_wings.get(bomberId)?.awaiting_escort_rendezvous, true,
        "precondition: bomber must be awaiting rendezvous");

      // Reassign the escort's target away directly (simulating it re-committing to a
      // different bomber before ever reaching LOITER ahead of this one) — disable auto-
      // targeting first, since with only one bomber in this scenario the escort would
      // otherwise just re-commit right back to it on the very next tick, masking the check
      // this test actually cares about (the bomber's own self-correcting clear condition).
      setAirMissionTargetingEnabledForTesting(false);
      try {
        const escort = room.state.air_wings.get("fighter-rendezvous-drop");
        assert.ok(escort);
        (escort as any).target_id = "some-other-wing";

        await tickRoom(room);
        assert.strictEqual(room.state.air_wings.get(bomberId)?.awaiting_escort_rendezvous, false,
          "bomber must stop waiting once its escort's target_id no longer points back at it");
      } finally {
        setAirMissionTargetingEnabledForTesting(true);
      }
    });

    it("rendezvous times out if the escort can never actually catch up and get ahead", async () => {
      setRendezvousTimeoutTicksForTesting(3);
      try {
        const { client, room } = await joinRoom();
        const homePos = { position_lng: 13.385771, position_lat: 52.483566 };
        const bomberId = await spawnWing(client, room, {
          wing_id: "bomber-rendezvous-timeout", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER,
          lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.IDLE, ...homePos,
        });
        client.send("SUBMIT_AIR_WING_MOVE", { wing_id: bomberId, target_lng: homePos.position_lng + 5, target_lat: homePos.position_lat + 3 });
        await room.waitForNextPatch();

        // Same aircraft type as the bomber it's escorting — matching speed, so it can never
        // actually get ahead and reach LOITER (mirrors the same-speed trick used elsewhere in
        // this file to keep an escort permanently in the pursuit phase).
        await spawnWing(client, room, {
          wing_id: "escort-rendezvous-timeout", aircraft_type: AIR_UNIT_TYPES.STRATEGIC_BOMBER, ...homePos,
        });
        client.send("ASSIGN_WING_MISSION", { wing_id: "escort-rendezvous-timeout", mission: MISSION_TYPES.ESCORT, target_id: "" });
        await room.waitForNextPatch();
        await tickRoom(room);
        assert.strictEqual(room.state.air_wings.get(bomberId)?.awaiting_escort_rendezvous, true,
          "precondition: bomber must be awaiting rendezvous");

        await tickRoom(room, 4);
        assert.strictEqual(room.state.air_wings.get(bomberId)?.awaiting_escort_rendezvous, false,
          "bomber must resume normal speed once the rendezvous timeout elapses, even though the escort never arrived");
      } finally {
        setRendezvousTimeoutTicksForTesting(30);
      }
    });
  });
});
