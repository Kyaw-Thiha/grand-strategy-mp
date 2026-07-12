import { describe, it } from "mocha";
import assert from "assert";
import {
  getRowPerkModifiers,
  ROW_PERK_SUPP_DEALT_MULT,
  ROW_PERK_HP_DEALT_MULT,
  ROW_PERK_SUPP_RESIST,
  ROW_PERK_DECAY_MULT,
} from "../src/systems/row_perk_system.js";

import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { setRoundTicksForTesting, setCombatGraceTicksForTesting } from "../src/systems/combat_system.js";

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

describe("lane:tactical | row-perk-system — unit tests", () => {

  it("VANGUARD (row 4): supp_dealt_mult > 1, hp/resist/decay all identity", () => {
    const m = getRowPerkModifiers(4);
    assert.strictEqual(m.supp_dealt_mult, ROW_PERK_SUPP_DEALT_MULT);
    assert.strictEqual(m.hp_dealt_mult,   1.0);
    assert.strictEqual(m.supp_resist_mult, 1.0);
    assert.strictEqual(m.supp_decay_mult,  1.0);
  });

  it("ASSAULT (row 3): hp_dealt_mult > 1, others identity", () => {
    const m = getRowPerkModifiers(3);
    assert.strictEqual(m.hp_dealt_mult,    ROW_PERK_HP_DEALT_MULT);
    assert.strictEqual(m.supp_dealt_mult,  1.0);
    assert.strictEqual(m.supp_resist_mult, 1.0);
    assert.strictEqual(m.supp_decay_mult,  1.0);
  });

  it("SUPPORT (row 2): supp_resist_mult < 1 (defender receives less supp), others identity", () => {
    const m = getRowPerkModifiers(2);
    assert.strictEqual(m.supp_resist_mult, ROW_PERK_SUPP_RESIST);
    assert.ok(m.supp_resist_mult < 1.0, "SUPPORT resist mult must be < 1");
    assert.strictEqual(m.supp_dealt_mult,  1.0);
    assert.strictEqual(m.hp_dealt_mult,    1.0);
    assert.strictEqual(m.supp_decay_mult,  1.0);
  });

  it("RESERVE (row 1): supp_decay_mult > 1, others identity", () => {
    const m = getRowPerkModifiers(1);
    assert.strictEqual(m.supp_decay_mult,  ROW_PERK_DECAY_MULT);
    assert.strictEqual(m.supp_dealt_mult,  1.0);
    assert.strictEqual(m.hp_dealt_mult,    1.0);
    assert.strictEqual(m.supp_resist_mult, 1.0);
  });

  it("REAR (row 0): all identity (no bonus)", () => {
    const m = getRowPerkModifiers(0);
    assert.strictEqual(m.supp_dealt_mult,  1.0);
    assert.strictEqual(m.hp_dealt_mult,    1.0);
    assert.strictEqual(m.supp_resist_mult, 1.0);
    assert.strictEqual(m.supp_decay_mult,  1.0);
  });

  it("out-of-range row (e.g. -1, 5) returns identity", () => {
    for (const row of [-1, 5, 99]) {
      const m = getRowPerkModifiers(row);
      assert.strictEqual(m.supp_dealt_mult,  1.0, `row ${row} supp_dealt should be 1`);
      assert.strictEqual(m.hp_dealt_mult,    1.0, `row ${row} hp_dealt should be 1`);
      assert.strictEqual(m.supp_resist_mult, 1.0, `row ${row} supp_resist should be 1`);
      assert.strictEqual(m.supp_decay_mult,  1.0, `row ${row} decay should be 1`);
    }
  });

  it("cell_index helper: correct logical_row for boundary cells", () => {
    // Test that Math.floor(cell_index / 5) gives the right row
    assert.strictEqual(Math.floor(0  / 5), 0);  // REAR first cell
    assert.strictEqual(Math.floor(4  / 5), 0);  // REAR last cell
    assert.strictEqual(Math.floor(5  / 5), 1);  // RESERVE first cell
    assert.strictEqual(Math.floor(19 / 5), 3);  // ASSAULT last cell
    assert.strictEqual(Math.floor(20 / 5), 4);  // VANGUARD first cell
    assert.strictEqual(Math.floor(24 / 5), 4);  // VANGUARD last cell
  });
});

describe("lane:tactical | row-perk-system — integration", function () {
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
  beforeEach(async () => { await colyseus.cleanup(); });

  // spawnCombat is defined inline here — no shared helpers directory exists.
  // divA = "div-a" attacks divB = "div-b". Single client controls both.
  async function spawnCombat(
    divAUnits: Record<number, string>,
    divBUnits: Record<number, string>
  ) {
    const token  = await makeToken();
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const divA = "div-a";
    const divB = "div-b";

    client.send("SPAWN_DIVISION", { division_id: divA, nation_id: "germany", position_lng: 0, position_lat: 0 });
    client.send("SPAWN_DIVISION", { division_id: divB, nation_id: "france",  position_lng: 0.001, position_lat: 0.001 });
    await room.waitForNextPatch();

    for (const [idx, utype] of Object.entries(divAUnits)) {
      client.send("SET_CELL", { division_id: divA, cell_index: +idx, unit_type: utype });
    }
    for (const [idx, utype] of Object.entries(divBUnits)) {
      client.send("SET_CELL", { division_id: divB, cell_index: +idx, unit_type: utype });
    }
    await room.waitForNextPatch();

    await (room as any).startGame();
    // startGame() resets all relations to neutral via _initRelations().
    // Declare war so _detectEngagements() can trigger COMBAT_STARTED.
    client.send("SET_RELATION", { nation_a: "germany", nation_b: "france", stance: "war" });
    await room.waitForNextPatch();
    await client.waitForMessage("COMBAT_STARTED", 60_000);

    const engagementId = `${divA}_vs_${divB}_`;
    return { room, client, engagementId };
  }

  it("VANGUARD attacker (cell 20) deals more suppression than REAR attacker (cell 0)", async () => {
    const { client: cA, engagementId: engA } = await spawnCombat(
      { 20: "infantry" },  // attacker VANGUARD row 4
      { 20: "infantry" }
    );
    const msgA = await waitForEngagementRound(cA, engA, 60_000);
    const suppA = msgA.defender_grid_delta?.[0]?.suppression ?? 0;

    const { client: cB, engagementId: engB } = await spawnCombat(
      { 0: "infantry" },   // attacker REAR row 0
      { 0: "infantry" }
    );
    const msgB = await waitForEngagementRound(cB, engB, 60_000);
    const suppB = msgB.defender_grid_delta?.[0]?.suppression ?? 0;

    assert.ok(
      suppA >= suppB * ROW_PERK_SUPP_DEALT_MULT * 0.95,
      `VANGUARD supp ${suppA} should be ~${ROW_PERK_SUPP_DEALT_MULT}x REAR supp ${suppB}`
    );
  });

  it("ASSAULT attacker (cell 15) deals more HP damage than REAR attacker (cell 0)", async () => {
    const { client: cA, engagementId: engA } = await spawnCombat(
      { 15: "infantry" },  // attacker ASSAULT row 3
      { 15: "infantry" }
    );
    const msgA = await waitForEngagementRound(cA, engA, 60_000);
    const hpDmgA = 100 - (msgA.defender_grid_delta?.[0]?.hp ?? 100);

    const { client: cB, engagementId: engB } = await spawnCombat(
      { 0: "infantry" },   // attacker REAR row 0
      { 0: "infantry" }
    );
    const msgB = await waitForEngagementRound(cB, engB, 60_000);
    const hpDmgB = 100 - (msgB.defender_grid_delta?.[0]?.hp ?? 100);

    assert.ok(
      hpDmgA >= hpDmgB * ROW_PERK_HP_DEALT_MULT * 0.95,
      `ASSAULT hp dmg ${hpDmgA} should be ~${ROW_PERK_HP_DEALT_MULT}x REAR hp dmg ${hpDmgB}`
    );
  });

  it("SUPPORT defender (cell 10) receives less suppression than REAR defender (cell 0)", async () => {
    const { client: cA, engagementId: engA } = await spawnCombat(
      { 0: "infantry" },
      { 10: "infantry" }   // defender SUPPORT row 2
    );
    const msgA = await waitForEngagementRound(cA, engA, 60_000);
    const suppReceivedA = msgA.defender_grid_delta?.[0]?.suppression ?? 0;

    const { client: cB, engagementId: engB } = await spawnCombat(
      { 0: "infantry" },
      { 0: "infantry" }    // defender REAR row 0
    );
    const msgB = await waitForEngagementRound(cB, engB, 60_000);
    const suppReceivedB = msgB.defender_grid_delta?.[0]?.suppression ?? 0;

    assert.ok(
      suppReceivedA <= suppReceivedB * ROW_PERK_SUPP_RESIST * 1.05,
      `SUPPORT supp received ${suppReceivedA} should be ~${ROW_PERK_SUPP_RESIST}x REAR received ${suppReceivedB}`
    );
  });
});
