import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { setCombatGraceTicksForTesting } from "../src/systems/combat_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

function setStance(room: any, nationA: string, nationB: string, stance: string): void {
  const relation = room.state.relations.get(`${nationA}|${nationB}`)
    ?? room.state.relations.get(`${nationB}|${nationA}`);
  assert.ok(relation, `missing relation ${nationA}|${nationB}`);
  relation.stance = stance;
}

/**
 * Wait for a message of the given type whose division fields match divA/divB
 * (in either order). startGame() also spawns default divisions that may
 * engage each other, producing unrelated COMBAT_STARTED/COMBAT_ENDED
 * messages we must ignore.
 */
function waitForCombatMessage(
  client: any,
  type: string,
  divA: string,
  divB: string,
  timeoutMs = 60_000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unbind();
      reject(new Error(`Timeout waiting for ${type} involving ${divA}/${divB}`));
    }, timeoutMs);
    const unbind = client.onMessage(type, (msg: any) => {
      const ids = [msg.division_a, msg.division_b, msg.winner_id, msg.retreated_id].filter(Boolean);
      if (ids.includes(divA) || ids.includes(divB)) {
        clearTimeout(timer);
        unbind();
        resolve(msg);
      }
    });
  });
}

describe("lane:tactical | 6m — Combat engagement_id broadcasts", function () {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setCombatGraceTicksForTesting(1);
    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    setCombatGraceTicksForTesting(10);
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("COMBAT_STARTED and COMBAT_ENDED both carry a non-empty engagement_id", async () => {
    const token = await makeToken();
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    client.send("SELECT_NATION", { nation_id: "germany" });
    await room.waitForNextPatch();

    const divA = "div-attacker";
    const divB = "div-defender";
    client.send("SPAWN_DIVISION", { division_id: divA, nation_id: "germany", position_lng: 0, position_lat: 0 });
    client.send("SPAWN_DIVISION", { division_id: divB, nation_id: "france", position_lng: 0.001, position_lat: 0.001 });
    await room.waitForNextPatch();

    await (room as any).startGame();
    setStance(room, "germany", "france", "war");
    await room.waitForNextPatch();

    const startedMsg: any = await waitForCombatMessage(client, "COMBAT_STARTED", divA, divB);
    assert.ok(typeof startedMsg.engagement_id === "string" && startedMsg.engagement_id.length > 0,
      "COMBAT_STARTED must carry a non-empty engagement_id");

    await room.waitForNextPatch();
    client.send("RETREAT", { division_id: divA });
    const endedMsg: any = await waitForCombatMessage(client, "COMBAT_ENDED", divA, divB);
    assert.ok(typeof endedMsg.engagement_id === "string" && endedMsg.engagement_id.length > 0,
      "COMBAT_ENDED must carry a non-empty engagement_id");
    assert.strictEqual(endedMsg.engagement_id, startedMsg.engagement_id,
      "COMBAT_ENDED's engagement_id must match the pair's COMBAT_STARTED engagement_id");
  });

  it("diplomacy-triggered COMBAT_ENDED includes engagement_id", async () => {
    const token = await makeToken();
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    client.send("SELECT_NATION", { nation_id: "germany" });
    await room.waitForNextPatch();

    const divA = "div-germany";
    const divB = "div-france";
    client.send("SPAWN_DIVISION", { division_id: divA, nation_id: "germany", position_lng: 0, position_lat: 0 });
    client.send("SPAWN_DIVISION", { division_id: divB, nation_id: "france", position_lng: 0.001, position_lat: 0.001 });
    await room.waitForNextPatch();

    await (room as any).startGame();
    setStance(room, "germany", "france", "war");
    await room.waitForNextPatch();

    const startedMsg: any = await waitForCombatMessage(client, "COMBAT_STARTED", divA, divB);
    assert.ok(typeof startedMsg.engagement_id === "string" && startedMsg.engagement_id.length > 0,
      "COMBAT_STARTED must carry a non-empty engagement_id");
    const capturedEngagementId = startedMsg.engagement_id;

    // Change relation from war to peace, which triggers clearInvalidDiplomaticEngagements
    setStance(room, "germany", "france", "peace");
    (room as any).finishDiplomacyRelationChange(
      new Set(["germany", "france"]),
      "test: relation changed to peace"
    );
    await room.waitForNextPatch();

    const endedMsg: any = await waitForCombatMessage(client, "COMBAT_ENDED", divA, divB);
    assert.strictEqual(endedMsg.reason, "diplomacy",
      "COMBAT_ENDED reason must be 'diplomacy' when triggered by relation change");
    assert.ok(typeof endedMsg.engagement_id === "string" && endedMsg.engagement_id.length > 0,
      "diplomacy-triggered COMBAT_ENDED must carry a non-empty engagement_id");
    assert.strictEqual(endedMsg.engagement_id, capturedEngagementId,
      "diplomacy-triggered COMBAT_ENDED's engagement_id must match the pair's COMBAT_STARTED engagement_id");
  });
});
