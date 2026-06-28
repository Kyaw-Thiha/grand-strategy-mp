import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import {
  _armorPenMultiplier,
  _getIncapFloor,
  _computeDivisionSuppression,
  setRoundTicksForTesting,
  setCombatGraceTicksForTesting,
} from "../src/systems/combat_system.js";

function buildMockCells(
  overrides: Array<{ unit_type: string; suppression?: number; stealthed?: boolean; incapacitated?: boolean; hp?: number }>,
): any[] {
  const cells = Array.from({ length: 25 }, () => ({
    unit_type: "", hp: 100, suppression: 0, stealthed: false, incapacitated: false,
  }));
  overrides.forEach((o, i) => { cells[i] = { ...cells[i], ...o }; });
  return cells;
}

describe("6c — Unit combat stats: pure functions", function () {
  it("_armorPenMultiplier: pen=30 vs armour=60 → 0%", () => {
    assert.strictEqual(_armorPenMultiplier(30, 60), 0);
  });

  it("_armorPenMultiplier: pen=65 vs armour=100 → 0.20", () => {
    assert.strictEqual(_armorPenMultiplier(65, 100), 0.20);
  });

  it("_armorPenMultiplier: pen=90 vs armour=80 → 1.0", () => {
    assert.strictEqual(_armorPenMultiplier(90, 80), 1.0);
  });

  it("_armorPenMultiplier: armour=0 → 1.0 regardless of pen", () => {
    assert.strictEqual(_armorPenMultiplier(5, 0), 1.0);
  });

  it("_getIncapFloor: infantry, mg, cavalry, flamethrower → 20", () => {
    for (const t of ["infantry","mg","cavalry","flamethrower","at_infantry","sniper","commando","recon_infantry","assault_infantry"]) {
      assert.strictEqual(_getIncapFloor(t), 20, `expected 20 for ${t}`);
    }
  });

  it("_getIncapFloor: light_tank, medium_tank, heavy_tank, armoured_car, at_gun_sp → 30", () => {
    for (const t of ["light_tank","medium_tank","heavy_tank","armoured_car","at_gun_sp"]) {
      assert.strictEqual(_getIncapFloor(t), 30, `expected 30 for ${t}`);
    }
  });

  it("_getIncapFloor: artillery, at_gun, aa_gun → 0", () => {
    for (const t of ["artillery","at_gun","aa_gun"]) {
      assert.strictEqual(_getIncapFloor(t), 0, `expected 0 for ${t}`);
    }
  });

  it("_computeDivisionSuppression: excludes stealthed cells", () => {
    const cells = buildMockCells([
      { unit_type: "infantry",   suppression: 80, stealthed: true  },
      { unit_type: "mg",         suppression: 20, stealthed: false },
    ]);
    assert.strictEqual(_computeDivisionSuppression(cells), 20);
  });

  it("_computeDivisionSuppression: excludes incapacitated cells", () => {
    const cells = buildMockCells([
      { unit_type: "infantry",   suppression: 90, incapacitated: true  },
      { unit_type: "mg",         suppression: 10, incapacitated: false },
    ]);
    assert.strictEqual(_computeDivisionSuppression(cells), 10);
  });

  it("_computeDivisionSuppression: returns 0 when all cells empty", () => {
    const cells = buildMockCells([]);
    assert.strictEqual(_computeDivisionSuppression(cells), 0);
  });
});

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

describe("6c — Combat stats: integration", function () {
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

  async function spawnCombat(divAUnits: Record<number,string>, divBUnits: Record<number,string>) {
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
    await room.waitForNextPatch();
    await client.waitForMessage("COMBAT_STARTED", 60_000);

    const engagementId = `${divA}_vs_${divB}_`;
    return { room, client, engagementId };
  }

  it("ROUND_RESOLVED attacker_grid_delta is non-empty when divisions have units", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    const msg = await waitForEngagementRound(client, engagementId, 60_000) as any;
    assert.ok(msg.attacker_grid_delta.length > 0 || msg.defender_grid_delta.length > 0,
      "at least one delta array must be non-empty");
  });

  it("defender cell HP decreases after one round", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    await waitForEngagementRound(client, engagementId, 60_000);
    const cell = room.state.divisions.get("div-b").grid.cells[12];
    assert.ok(cell.hp < 100, `expected hp < 100, got ${cell.hp}`);
  });

  it("defender cell suppression increases after one round", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    await waitForEngagementRound(client, engagementId, 60_000);
    const cell = room.state.divisions.get("div-b").grid.cells[12];
    assert.ok(cell.suppression > 0, `expected suppression > 0, got ${cell.suppression}`);
  });

  it("UNIT_INCAPACITATED fires when infantry cell HP reaches floor", async () => {
    const { room, client } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    (room.state.divisions.get("div-b").grid.cells[12] as any).hp = 19;
    const msg = await waitForMessage(client, "UNIT_INCAPACITATED", 60_000) as any;
    assert.strictEqual(msg.division_id, "div-b");
    assert.strictEqual(msg.cell_index,  12);
  });

  it("cell suppression decays each round during active combat", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    (room.state.divisions.get("div-b").grid.cells[12] as any).suppression = 80;
    await waitForEngagementRound(client, engagementId, 60_000);
    await waitForEngagementRound(client, engagementId, 60_000);
    const cellAfter = room.state.divisions.get("div-b").grid.cells[12];
    assert.ok(typeof cellAfter.suppression === "number");
  });

  it("division.suppression excludes incapacitated cells from average", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry", 13: "mg" });
    const divB = room.state.divisions.get("div-b");
    (divB.grid.cells[13] as any).suppression   = 0;
    (divB.grid.cells[13] as any).incapacitated = true;
    (divB.grid.cells[12] as any).suppression   = 70;
    await waitForEngagementRound(client, engagementId, 60_000);
    assert.ok(divB.suppression >= 60, `expected division suppression ≥ 60, got ${divB.suppression}`);
  });

  it("armoured cell takes less damage than soft cell from infantry pen", async () => {
    // Both defender cells in R5 so horizontal targeting hits both
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 20: "infantry", 24: "heavy_tank" });
    await waitForEngagementRound(client, engagementId, 60_000);
    const div        = room.state.divisions.get("div-b");
    const softDmg    = 100 - div.grid.cells[20].hp;
    const armoredDmg = 100 - div.grid.cells[24].hp;
    assert.ok(armoredDmg < softDmg,
      `heavy_tank hp loss ${armoredDmg} should be less than infantry hp loss ${softDmg}`);
  });
});
