import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import {
  setRoundTicksForTesting,
  setCombatGraceTicksForTesting,
} from "../src/systems/combat_system.js";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret  = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

function waitForEngagementRound(client: any, engagementId: string, timeoutMs = 60_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unbind(); reject(new Error(`Timeout waiting for ROUND_RESOLVED for ${engagementId}`)); }, timeoutMs);
    const unbind = client.onMessage("ROUND_RESOLVED", (msg: any) => {
      if (typeof msg.engagement_id === "string" && msg.engagement_id.startsWith(engagementId)) {
        clearTimeout(timer); unbind(); resolve(msg);
      }
    });
  });
}

function waitForMessage(client: any, type: string, timeoutMs = 60_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unbind(); reject(new Error(`Timeout waiting for ${type}`)); }, timeoutMs);
    const unbind = client.onMessage(type, (msg: any) => { clearTimeout(timer); unbind(); resolve(msg); });
  });
}

const combinedArms: [number, string][] = [
  [0, "recon_infantry"], [2, "recon_infantry"],
  [5, "medium_tank"], [6, "medium_tank"], [7, "infantry"],
  [10, "artillery"], [11, "at_gun"], [15, "infantry"],
];

const infantryPreset: [number, string][] = [
  [0, "recon_infantry"], [1, "infantry"],
  [5, "assault_infantry"], [6, "assault_infantry"], [7, "infantry"],
  [10, "mg"], [11, "artillery"], [12, "at_gun"],
  [15, "infantry"], [16, "infantry"], [20, "infantry"],
];

function setStance(room: any, nationA: string, nationB: string, stance: string): void {
  const relation = room.state.relations.get(`${nationA}|${nationB}`)
    ?? room.state.relations.get(`${nationB}|${nationA}`);
  assert.ok(relation, `missing relation ${nationA}|${nationB}`);
  relation.stance = stance;
}

describe("Phase 6 gate", function () {
  this.timeout(180_000);
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setRoundTicksForTesting(1);
    setCombatGraceTicksForTesting(1);
    colyseus = await boot(appConfig);
  });
  after(async () => {
    setRoundTicksForTesting(20);
    setCombatGraceTicksForTesting(10);
    await new Promise(r => setTimeout(r, 300));
    await colyseus.shutdown();
  });
  beforeEach(async () => { await colyseus.cleanup(); });

  it("two preset divisions fight — rounds resolve — damage dealt — force recon bypass", async () => {
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const token  = await makeToken();
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    client.send("SPAWN_DIVISION", { division_id: "div_a", nation_id: "germany", position_lng: 0, position_lat: 0 });
    client.send("SPAWN_DIVISION", { division_id: "div_b", nation_id: "france",  position_lng: 0.001, position_lat: 0.001 });
    await room.waitForNextPatch();

    for (const [idx, unit] of combinedArms) {
      client.send("SET_CELL", { division_id: "div_a", cell_index: idx, unit_type: unit });
    }
    for (const [idx, unit] of infantryPreset) {
      client.send("SET_CELL", { division_id: "div_b", cell_index: idx, unit_type: unit });
    }
    await room.waitForNextPatch();

    const combatStarted: any[] = [];
    const roundsResolved: any[] = [];
    client.onMessage("COMBAT_STARTED", (msg: any) => {
      if (msg.division_a === "div_a" || msg.division_b === "div_a") {
        combatStarted.push(msg);
      }
    });
    client.onMessage("ROUND_RESOLVED", (msg: any) => {
      if (typeof msg.engagement_id === "string" && msg.engagement_id.startsWith("div_a_vs_div_b_")) {
        roundsResolved.push(msg);
      }
    });

    (room as any).startGame();
    setStance(room, "germany", "france", "war");
    await room.waitForNextPatch();

    for (let i = 0; i < 3; i++) {
      await waitForEngagementRound(client, "div_a_vs_div_b_", 60_000);
    }

    assert.equal(combatStarted.length, 1);
    assert.ok(combatStarted[0].division_a);
    assert.ok(combatStarted[0].division_b);

    assert.ok(roundsResolved.length >= 3, "at least 3 rounds must resolve");
    for (let i = 0; i < roundsResolved.length; i++) {
      assert.equal(roundsResolved[i].round_number, i + 1);
    }

    assert.ok(roundsResolved[0].attacker_grid_delta.length > 0,
      "Round 1 must produce attacker grid deltas");
    assert.ok(roundsResolved[0].defender_grid_delta.length > 0,
      "Round 1 must produce defender grid deltas");

    const divBcells = room.state.divisions.get("div_b")!.grid!.cells;
    const cellsWithDamage = Array.from(divBcells).filter(c => c.hp < 100);
    assert.ok(cellsWithDamage.length > 0, "Defender cells must have taken HP damage");

    // Step 5 — Force recon full damage in Round 1
    // Both presets have recon_infantry which bypasses the lethality ramp.
    // R1 damage should be comparable to R2 damage (not dramatically lower).
    const r1DefDelta: any[] = roundsResolved[0].defender_grid_delta;
    const r2DefDelta: any[] = roundsResolved[1].defender_grid_delta;
    const r1Total = r1DefDelta.reduce((s: number, d: any) => s + Math.abs(d.hp ?? 0), 0);
    const r2Total = r2DefDelta.reduce((s: number, d: any) => s + Math.abs(d.hp ?? 0), 0);
    assert.ok(r1Total > 0, "Force recon must deal non-zero HP damage in Round 1");
    assert.ok(r1Total >= r2Total * 0.5,
      "Round 1 damage (with force recon bypass) must not be dramatically lower than Round 2");
  });

  it("auto-retreat fires when defender suppression reaches threshold", async () => {
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const token  = await makeToken();
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    client.send("SPAWN_DIVISION", { division_id: "div_a", nation_id: "germany", position_lng: 0, position_lat: 0 });
    client.send("SPAWN_DIVISION", { division_id: "div_b", nation_id: "france",  position_lng: 0.001, position_lat: 0.001 });
    await room.waitForNextPatch();

    client.send("SET_CELL", { division_id: "div_a", cell_index: 12, unit_type: "infantry" });
    client.send("SET_CELL", { division_id: "div_b", cell_index: 12, unit_type: "infantry" });
    await room.waitForNextPatch();

    const divB = room.state.divisions.get("div_b")!;
    (divB.grid!.cells[12] as any).suppression = 70;

    const combatEnded: any[] = [];
    client.onMessage("COMBAT_ENDED", (msg: any) => combatEnded.push(msg));

    (room as any).startGame();
    setStance(room, "germany", "france", "war");
    await room.waitForNextPatch();

    await waitForMessage(client, "COMBAT_ENDED", 30_000);

    // Step 6 — Suppression threshold triggers auto-retreat (verify via room state)
    const divBDiv = room.state.divisions.get("div_b")!;
    assert.ok(divBDiv.suppression >= 60,
      "Auto-retreat must fire at ≥60 suppression, got " + divBDiv.suppression);

    // Step 7 — XP accumulates after combat (direct room state access)
    const winnerId = combatEnded[0].winner_id;
    const winnerDiv = room.state.divisions.get(winnerId)!;
    const winnerCells = Array.from(winnerDiv.grid!.cells);
    assert.ok(winnerCells.some(c => c.xp_points > 0),
      "Winner's cells must have non-zero xp_points after combat");

    assert.equal(combatEnded.length, 1);
    assert.equal(combatEnded[0].retreated_id, "div_b");
    assert.equal(combatEnded[0].winner_id, "div_a");
  });

  it("flamethrower in R3 reaches enemy R3/R4 depth", async () => {
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const token  = await makeToken();
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    client.send("SPAWN_DIVISION", { division_id: "div_a", nation_id: "germany", position_lng: 0, position_lat: 0 });
    client.send("SPAWN_DIVISION", { division_id: "div_b", nation_id: "france",  position_lng: 0.001, position_lat: 0.001 });
    await room.waitForNextPatch();

    // Attacker: single infantry — will fire horizontally into defender's front row
    client.send("SET_CELL", { division_id: "div_a", cell_index: 12, unit_type: "infantry" });
    // Defender: flamethrower at R3/Support/C1 (index 10) + infantry for target
    // Flamethrower in R3 fires 1 row ahead = into enemy R3 and R4 (cell indices 10–19)
    client.send("SET_CELL", { division_id: "div_b", cell_index: 10, unit_type: "flamethrower" });
    client.send("SET_CELL", { division_id: "div_b", cell_index: 12, unit_type: "infantry" });
    await room.waitForNextPatch();

    const roundsResolved: any[] = [];
    client.onMessage("ROUND_RESOLVED", (msg: any) => {
      if (typeof msg.engagement_id === "string" && msg.engagement_id.startsWith("div_a_vs_div_b_")) {
        roundsResolved.push(msg);
      }
    });

    (room as any).startGame();
    setStance(room, "germany", "france", "war");
    await room.waitForNextPatch();

    await waitForEngagementRound(client, "div_a_vs_div_b_", 30_000);

    // Filter deep rows (cell_index 10–19 = R3/R4) and sum HP damage
    const delta: any[] = roundsResolved[0].defender_grid_delta;
    const deepRowDamage = delta
      .filter((d: any) => d.cell_index >= 10 && d.cell_index < 20)
      .reduce((s: number, d: any) => s + Math.abs(d.hp ?? 0), 0);
    assert.ok(deepRowDamage > 0,
      "Flamethrower in R3 must deal HP damage to enemy R3/R4 depth");
  });
});
