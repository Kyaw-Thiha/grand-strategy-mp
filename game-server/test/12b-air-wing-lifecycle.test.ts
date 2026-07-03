import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, MISSION_TYPES, AIR_UNIT_TYPES } from "../src/rooms/schema/AirWingState.js";
import {
  setWeaponCooldownTicksForTesting,
  setEngagementAutoResolveTicksForTesting,
  setMaxLoiterTicksForTesting,
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

describe("12b — Air Wing Lifecycle", function () {
  this.timeout(180_000);

  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setWeaponCooldownTicksForTesting(1);
    setEngagementAutoResolveTicksForTesting(2);
    setMaxLoiterTicksForTesting(2);
    setRtbDurationTicksForTesting(2);
    setRefuelDurationTicksForTesting(1);
    setReadinessDecayForTesting(0.1);
    setReadinessRecoveryForTesting(0.5);
    colyseus = await boot(appConfig);
  });

  after(async () => {
    setWeaponCooldownTicksForTesting(3);
    setEngagementAutoResolveTicksForTesting(2);
    setMaxLoiterTicksForTesting(15);
    setRtbDurationTicksForTesting(5);
    setRefuelDurationTicksForTesting(5);
    setReadinessDecayForTesting(0.04);
    setReadinessRecoveryForTesting(0.06);
    await new Promise(r => setTimeout(r, 300));
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

  async function spawnWing(client: any, room: any, overrides: Record<string, unknown> = {}) {
    const defaults: Record<string, unknown> = {
      wing_id:                  "wing-1",
      nation_id:                "germany",
      aircraft_type:            AIR_UNIT_TYPES.FIGHTER,
      count:                    10,
      lifecycle_state:          WING_LIFECYCLE.IDLE,
      mission:                  MISSION_TYPES.INTERCEPTION,
      home_airbase_province_id: "berlin",
    };
    client.send("SPAWN_WING", { ...defaults, ...overrides });
    await room.waitForNextPatch();
  }

  async function waitForWingState(
    room: any,
    wingId: string,
    expectedState: string,
    timeoutMs = 10_000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const wing = room.state.air_wings.get(wingId);
      if (wing?.lifecycle_state === expectedState) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await Promise.race([
        room.waitForNextPatch(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("deadline")), remaining)
        ),
      ]).catch(() => { /* deadline expired — fall through to deadline check */ });
    }
    const wing = room.state.air_wings.get(wingId);
    throw new Error(
      `waitForWingState timed out: expected "${expectedState}", got "${wing?.lifecycle_state}"`
    );
  }

  async function waitForWingPredicate(
    room: any,
    wingId: string,
    predicate: (wing: any | undefined) => boolean,
    timeoutMs = 10_000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const wing = room.state.air_wings.get(wingId);
      if (predicate(wing)) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await Promise.race([
        room.waitForNextPatch(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("deadline")), remaining)
        ),
      ]).catch(() => { /* deadline expired — fall through to deadline check */ });
    }
    const wing = room.state.air_wings.get(wingId);
    throw new Error(`waitForWingPredicate timed out for wing ${wingId}; last state was ${wing?.lifecycle_state}`);
  }

  async function waitForWingRemoval(
    room: any,
    wingId: string,
    timeoutMs = 10_000
  ): Promise<void> {
    await waitForWingPredicate(room, wingId, (wing) => !wing, timeoutMs);
  }

  // ── Test Group 1: ASSIGN_WING_MISSION (IDLE → TRANSIT) ───────────────────

  it("ASSIGN_WING_MISSION transitions IDLE wing to TRANSIT", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);

    client.send("ASSIGN_WING_MISSION", {
      wing_id:   "wing-1",
      mission:   MISSION_TYPES.INTERCEPTION,
      target_id: "enemy-wing-99",
    });
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);

    const wing = room.state.air_wings.get("wing-1");
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.TRANSIT);
    assert.strictEqual(wing.mission,         MISSION_TYPES.INTERCEPTION);
    assert.strictEqual(wing.target_id,       "enemy-wing-99");
  });

  it("ASSIGN_WING_MISSION on a TRANSIT wing updates mission and target without double-transition", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("ASSIGN_WING_MISSION", { wing_id: "wing-1", mission: MISSION_TYPES.INTERCEPTION, target_id: "t1" });
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);

    client.send("ASSIGN_WING_MISSION", { wing_id: "wing-1", mission: MISSION_TYPES.AIR_SUPERIORITY, target_id: "t2" });
    await room.waitForNextPatch();
    const wing = room.state.air_wings.get("wing-1");
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.TRANSIT);
    assert.strictEqual(wing.mission,         MISSION_TYPES.AIR_SUPERIORITY);
    assert.strictEqual(wing.target_id,       "t2");
  });

  it("ASSIGN_WING_MISSION on an ENGAGED wing is rejected (wing not reassigned to TRANSIT)", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.ENGAGED });
    await room.waitForNextPatch();

    client.send("ASSIGN_WING_MISSION", { wing_id: "wing-1", mission: MISSION_TYPES.INTERCEPTION, target_id: "t1" });
    await new Promise(r => setTimeout(r, 200));
    const wing = room.state.air_wings.get("wing-1");
    assert.notStrictEqual(wing.lifecycle_state, WING_LIFECYCLE.TRANSIT,
      "ENGAGED wing must not be moved to TRANSIT by a rejected ASSIGN_WING_MISSION");
  });

  it("ASSIGN_WING_MISSION on unknown wing_id is a no-op (no crash)", async () => {
    const { client, room } = await joinRoom();
    client.send("ASSIGN_WING_MISSION", { wing_id: "nonexistent", mission: MISSION_TYPES.INTERCEPTION, target_id: "t1" });
    await new Promise(r => setTimeout(r, 200));
    assert.ok(room.state);
  });

  // ── Test Group 2: ENGAGED → RTB (single-sortie default) ──────────────────

  it("single-sortie wing auto-resolves ENGAGED → RTB after engagement ticks", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.ENGAGED });
    await room.waitForNextPatch();

    await waitForWingState(room, "wing-1", WING_LIFECYCLE.RTB);
    const wing = room.state.air_wings.get("wing-1");
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.RTB);
  });

  it("single-sortie wing progresses RTB → REFUEL → IDLE", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.RTB });
    await room.waitForNextPatch();

    await waitForWingState(room, "wing-1", WING_LIFECYCLE.REFUEL);
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.IDLE);
    const wing = room.state.air_wings.get("wing-1");
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.IDLE);
  });

  // ── Test Group 3: Multi-sortie post-engagement transitions ────────────────

  it("multi-sortie wing: no new target after ENGAGED → LOITER", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "multi_sortie", value: true });
    await room.waitForNextPatch();
    client.send("SIMULATE_ENGAGEMENT_START", { wing_id: "wing-1", target_wing_id: "enemy-wing-99" });
    await room.waitForNextPatch();

    await waitForWingState(room, "wing-1", WING_LIFECYCLE.LOITER);
    assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.LOITER);
  });

  it("multi-sortie wing: new target queued before ENGAGED resolves → TRANSIT directly", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "multi_sortie", value: true });
    await room.waitForNextPatch();
    client.send("SIMULATE_ENGAGEMENT_START", { wing_id: "wing-1", target_wing_id: "enemy-wing-99" });
    await room.waitForNextPatch();

    client.send("SET_WING_TARGET", { wing_id: "wing-1", target_id: "enemy-wing-100" });
    await room.waitForNextPatch();

    await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);
    assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.TRANSIT);
    assert.strictEqual(room.state.air_wings.get("wing-1").target_id,       "enemy-wing-100");
  });

  it("multi-sortie wing: same target after ENGAGED → LOITER (recency penalty, not re-engage)", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "multi_sortie", value: true });
    await room.waitForNextPatch();
    client.send("SIMULATE_ENGAGEMENT_START", { wing_id: "wing-1", target_wing_id: "enemy-wing-99" });
    await room.waitForNextPatch();
    client.send("SET_WING_TARGET", { wing_id: "wing-1", target_id: "enemy-wing-99" });
    await room.waitForNextPatch();

    await waitForWingState(room, "wing-1", WING_LIFECYCLE.LOITER);
    const wing = room.state.air_wings.get("wing-1");
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.LOITER);
    assert.strictEqual(wing.target_id, "", "same-target LOITER path must clear stale target_id after resolve");
  });

  it("multi-sortie wing in LOITER: target assigned → transitions to TRANSIT", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "multi_sortie", value: true });
    await room.waitForNextPatch();
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.LOITER });
    await room.waitForNextPatch();

    client.send("SET_WING_TARGET", { wing_id: "wing-1", target_id: "new-target-wing" });
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);
    assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.TRANSIT);
  });

  it("multi-sortie wing in LOITER: MAX_LOITER_TICKS elapsed with no target → RTB", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "multi_sortie", value: true });
    await room.waitForNextPatch();
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.LOITER });
    await room.waitForNextPatch();
    await waitForWingState(room, "wing-1", WING_LIFECYCLE.RTB);
  });

  // ── Test Group 4: Readiness ──────────────────────────────────────────────

  it("combat_readiness decays each tick while airborne (TRANSIT)", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room, { lifecycle_state: WING_LIFECYCLE.TRANSIT });
    const before = room.state.air_wings.get("wing-1").combat_readiness;
    await waitForWingPredicate(room, "wing-1", (wing) => !!wing && wing.combat_readiness < before);
    const after = room.state.air_wings.get("wing-1").combat_readiness;
    assert.ok(after < before, "readiness must decay while airborne");
  });

  it("combat_readiness never decays below READINESS_FLOOR (0.15)", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_READINESS", { wing_id: "wing-1", combat_readiness: 0.16 });
    await room.waitForNextPatch();
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await room.waitForNextPatch();
    await waitForWingPredicate(room, "wing-1", (wing) => !!wing && wing.combat_readiness < 0.16);
    const wing = room.state.air_wings.get("wing-1");
    assert.ok(wing.combat_readiness >= 0.15, `readiness must be >= 0.15, got ${wing.combat_readiness}`);
  });

  it("combat_readiness recovers each tick while IDLE at base", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_READINESS", { wing_id: "wing-1", combat_readiness: 0.5 });
    await room.waitForNextPatch();

    const before = room.state.air_wings.get("wing-1").combat_readiness;
    await waitForWingPredicate(room, "wing-1", (wing) => !!wing && wing.combat_readiness > before);
    const after = room.state.air_wings.get("wing-1").combat_readiness;
    assert.ok(after > before, "readiness must recover while IDLE");
  });

  it("combat_readiness does not exceed 1.0 while recovering", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_READINESS", { wing_id: "wing-1", combat_readiness: 0.9 });
    await room.waitForNextPatch();
    await waitForWingPredicate(room, "wing-1", (wing) => !!wing && wing.combat_readiness >= 1.0);
    const wing = room.state.air_wings.get("wing-1");
    assert.ok(wing.combat_readiness <= 1.0, "readiness must not exceed 1.0");
  });

  it("combat_readiness also recovers during REFUEL", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_READINESS", { wing_id: "wing-1", combat_readiness: 0.3 });
    await room.waitForNextPatch();
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.REFUEL });
    await room.waitForNextPatch();

    const before = room.state.air_wings.get("wing-1").combat_readiness;
    await waitForWingPredicate(room, "wing-1", (wing) => !!wing && wing.combat_readiness > before);
    const after = room.state.air_wings.get("wing-1").combat_readiness;
    assert.ok(after > before, "readiness must recover during REFUEL too");
  });

  it("force RTB from LOITER when readiness hits RTB threshold (0.25)", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_READINESS", { wing_id: "wing-1", combat_readiness: 0.30 });
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.LOITER });
    await room.waitForNextPatch();
    await room.waitForNextPatch();

    await waitForWingState(room, "wing-1", WING_LIFECYCLE.RTB);
  });

  // ── Test Group 5: Weapon cooldown ────────────────────────────────────────

  it("weapon_ready starts true; firing sets it false on first ENGAGED tick", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    assert.strictEqual(room.state.air_wings.get("wing-1").weapon_ready, true);

    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.ENGAGED });
    await room.waitForNextPatch();
    await waitForWingPredicate(room, "wing-1", (wing) => !!wing && wing.weapon_ready === false);
    const wing = room.state.air_wings.get("wing-1");
    assert.strictEqual(wing.weapon_ready, false, "weapon_ready must be false after first ENGAGED tick");
  });

  it("weapon_ready returns to true after WEAPON_COOLDOWN_TICKS ticks", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.ENGAGED });
    await room.waitForNextPatch();
    await waitForWingPredicate(room, "wing-1", (wing) => !!wing && wing.weapon_ready === false);
    assert.strictEqual(room.state.air_wings.get("wing-1").weapon_ready, false, "sanity check");
    await waitForWingPredicate(room, "wing-1", (wing) =>
      !!wing && wing.weapon_ready === true && wing.lifecycle_state === WING_LIFECYCLE.RTB
    );
    assert.strictEqual(room.state.air_wings.get("wing-1").weapon_ready, true);
    assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.RTB);
  });

  // ── Test Group 6: DISBAND_WING ───────────────────────────────────────────

  it("DISBAND_WING removes wing from air_wings and broadcasts WING_DESTROYED", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);

    const destroyedPromise = new Promise<any>((resolve) => {
      client.onMessage("WING_DESTROYED", resolve);
    });

    client.send("DISBAND_WING", { wing_id: "wing-1" });
    const msg = await destroyedPromise;
    await waitForWingRemoval(room, "wing-1");

    assert.strictEqual(msg.wing_id, "wing-1");
    assert.ok(!room.state.air_wings.has("wing-1"), "wing must be removed from state");
  });

  it("DISBAND_WING on unknown wing_id is a no-op (no crash)", async () => {
    const { client, room } = await joinRoom();
    client.send("DISBAND_WING", { wing_id: "nonexistent" });
    await new Promise(r => setTimeout(r, 200));
    assert.ok(room.state);
  });

  // ── Test Group 7: SET_WING_PERK ──────────────────────────────────────────

  it("SET_WING_PERK sets perk_multi_sortie to true", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    assert.strictEqual(room.state.air_wings.get("wing-1").perk_multi_sortie, false);

    client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "multi_sortie", value: true });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.air_wings.get("wing-1").perk_multi_sortie, true);
  });

  it("SET_WING_PERK for unknown perk name is a no-op (no crash)", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "nonexistent_perk", value: true });
    await new Promise(r => setTimeout(r, 200));
    assert.ok(room.state.air_wings.get("wing-1"));
  });

  // ── Test Group 8: AIR_WING_UPDATES broadcast ─────────────────────────────

  it("lifecycle tick broadcasts AIR_WING_UPDATES with accurate wing state after lifecycle change", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);

    const updateReceived = new Promise<any>((resolve) => {
      client.onMessage("AIR_WING_UPDATES", resolve);
    });

    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await room.waitForNextPatch();

    const msg = await updateReceived;
    assert.ok(Array.isArray(msg.wings), "AIR_WING_UPDATES.wings must be an array");
    const w = msg.wings.find((w: any) => w.wing_id === "wing-1");
    assert.ok(w, "AIR_WING_UPDATES must include wing-1");
    assert.strictEqual(w.lifecycle_state, WING_LIFECYCLE.TRANSIT,
      "broadcast must serialize the current lifecycle_state accurately");
    assert.strictEqual(w.path_gen_id, "");
    assert.strictEqual(w.path_elapsed_ms, 0);
    assert.strictEqual(w.weapon_ready, true);
    assert.strictEqual(w.perk_multi_sortie, false);
    assert.strictEqual(w.perk_strafing, false);
    assert.strictEqual(w.perk_extended_range, false);
    assert.strictEqual(w.perk_precision_bombing, false);
  });
});
