import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { setRoundTicksForTesting, setCombatGraceTicksForTesting, _isGridLocked } from "../src/systems/combat_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

/** Wait for a ROUND_RESOLVED message matching the expected engagement_id. */
function waitForEngagementRound(
  client: any,
  engagementId: string,
  timeoutMs = 60_000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unbind();
      reject(new Error(`Timeout waiting for ROUND_RESOLVED for ${engagementId}`));
    }, timeoutMs);
    const unbind = client.onMessage("ROUND_RESOLVED", (msg: any) => {
      if (typeof msg.engagement_id === "string" && msg.engagement_id.startsWith(engagementId)) {
        clearTimeout(timer);
        unbind();
        resolve(msg);
      }
    });
  });
}

/**
 * Create a room, connect a client, start the game loop, and spawn two
 * adjacent divisions from different nations so they auto-engage.
 */
async function startCombat(
  colyseus: ColyseusTestServer<typeof appConfig>,
): Promise<{ client: any; room: any; divAId: string; divBId: string; engagementId: string }> {
  const token = await makeToken();
  const room = await colyseus.createRoom<GameRoomState>("game_room", {});
  const client = await colyseus.connectTo(room, { token });
  await room.waitForNextPatch();

  const divA = "div-attacker";
  const divB = "div-defender";

  client.send("SPAWN_DIVISION", {
    division_id: divA,
    nation_id: "germany",
    position_lng: 0,
    position_lat: 0,
  });
  client.send("SPAWN_DIVISION", {
    division_id: divB,
    nation_id: "france",
    position_lng: 0.001,
    position_lat: 0.001,
  });
  await room.waitForNextPatch();

  // Start the game loop via private method — this loads map data, sets phase
  // to "running", and starts the clock interval driving gameTick().
  // It also spawns default divisions but their ROUND_RESOLVED messages have
  // different engagement_ids so our filter will ignore them.
  await (room as any).startGame();
  await room.waitForNextPatch();

  // Wait for COMBAT_STARTED to know our divisions engaged, then derive engagement_id
  await client.waitForMessage("COMBAT_STARTED", 60_000);
  const engagementId = `${divA}_vs_${divB}_`;

  return { client, room, divAId: divA, divBId: divB, engagementId };
}

describe("6b — Round System", function () {
  this.timeout(180_000);

  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setRoundTicksForTesting(3);
    setCombatGraceTicksForTesting(1);
    colyseus = await boot(appConfig);
  });

  after(async () => {
    setRoundTicksForTesting(20);
    setCombatGraceTicksForTesting(10);
    await new Promise(r => setTimeout(r, 300));
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("ROUND_RESOLVED fires with round_number=1 and lethality_phase='contact'", async () => {
    const { client, divAId, divBId } = await startCombat(colyseus);
    const eid = `${divAId}_vs_${divBId}_`;

    const msg = await waitForEngagementRound(client, eid, 60_000);
    assert.strictEqual(msg.round_number, 1, "first round should be round 1");
    assert.strictEqual(msg.lethality_phase, "contact", "round 1 phase should be contact");
    assert.ok(typeof msg.engagement_id === "string" && msg.engagement_id.length > 0,
      "engagement_id must be a non-empty string");
  });

  it("second ROUND_RESOLVED has round_number=2 and lethality_phase='firefight'", async () => {
    const { client, divAId, divBId } = await startCombat(colyseus);
    const eid = `${divAId}_vs_${divBId}_`;

    const msg1 = await waitForEngagementRound(client, eid, 60_000);
    const msg2 = await waitForEngagementRound(client, eid, 60_000);
    assert.strictEqual(msg2.round_number, 2);
    assert.strictEqual(msg2.lethality_phase, "firefight");
  });

  it("lethality_phase reaches 'annihilation' at round 5", async () => {
    const { client, divAId, divBId } = await startCombat(colyseus);
    const eid = `${divAId}_vs_${divBId}_`;

    let lastMsg: any;
    for (let i = 0; i < 5; i++) {
      lastMsg = await waitForEngagementRound(client, eid, 60_000);
    }
    assert.strictEqual(lastMsg.round_number, 5);
    assert.strictEqual(lastMsg.lethality_phase, "annihilation");
  });

  it("lethality_phase stays 'annihilation' at round 6", async () => {
    const { client, divAId, divBId } = await startCombat(colyseus);
    const eid = `${divAId}_vs_${divBId}_`;

    let lastMsg: any;
    for (let i = 0; i < 6; i++) {
      lastMsg = await waitForEngagementRound(client, eid, 60_000);
    }
    assert.strictEqual(lastMsg.round_number, 6);
    assert.strictEqual(lastMsg.lethality_phase, "annihilation",
      "annihilation must not roll over to a new phase");
  });

  it("payload has empty attacker_grid_delta and defender_grid_delta", async () => {
    const { client, divAId, divBId } = await startCombat(colyseus);
    const eid = `${divAId}_vs_${divBId}_`;

    const msg = await waitForEngagementRound(client, eid, 60_000);
    assert.ok(Array.isArray(msg.attacker_grid_delta), "attacker_grid_delta must be an array");
    assert.ok(Array.isArray(msg.defender_grid_delta), "defender_grid_delta must be an array");
    assert.strictEqual(msg.attacker_grid_delta.length, 0, "must be empty until Branch C-F");
    assert.strictEqual(msg.defender_grid_delta.length, 0);
  });

  it("payload has empty formation_bonuses_active and xp_changes", async () => {
    const { client, divAId, divBId } = await startCombat(colyseus);
    const eid = `${divAId}_vs_${divBId}_`;

    const msg = await waitForEngagementRound(client, eid, 60_000);
    assert.ok(Array.isArray(msg.formation_bonuses_active));
    assert.ok(Array.isArray(msg.xp_changes));
    assert.strictEqual(msg.formation_bonuses_active.length, 0, "must be empty until Branch I/G");
    assert.strictEqual(msg.xp_changes.length, 0);
  });

  it("same engagement_id appears in consecutive ROUND_RESOLVED events", async () => {
    const { client, divAId, divBId } = await startCombat(colyseus);
    const eid = `${divAId}_vs_${divBId}_`;

    const msg1 = await waitForEngagementRound(client, eid, 60_000);
    const msg2 = await waitForEngagementRound(client, eid, 60_000);
    assert.strictEqual(msg1.engagement_id, msg2.engagement_id,
      "engagement_id must be stable across rounds of the same combat");
  });

  it("_isGridLocked returns true for engaged div and false for non-existent", async () => {
    const { client, room, divAId } = await startCombat(colyseus);

    // Wait for at least one round to ensure combat state is established
    await waitForEngagementRound(client, `${divAId}_vs_div-defender_`, 60_000);
    await room.waitForNextPatch();

    const state = room.state as GameRoomState;
    assert.strictEqual(_isGridLocked(divAId, state), true,
      "engaged division should be grid-locked");
    assert.strictEqual(_isGridLocked("non-existent-div-id", state), false,
      "non-existent division should not be grid-locked");
  });
});
