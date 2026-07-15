import { describe, it } from "mocha";
import assert from "assert";
import {
  evaluateFormationRules,
  getActiveFormationRules,
  IDENTITY_FORMATION_BONUS,
} from "../src/systems/formation_rule_system.js";
import type { FormationRule, FormationCellInput } from "../src/systems/formation_rule_system.js";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { setRoundTicksForTesting, setCombatGraceTicksForTesting } from "../src/systems/combat_system.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGrid(overrides: Record<number, string>): FormationCellInput[] {
  return Array.from({ length: 25 }, (_, i) => ({
    unit_type:     overrides[i] ?? "",
    incapacitated: false,
  }));
}

function makeRule(
  id: string,
  unitA: string | string[],
  unitB: string | string[],
  proximity: FormationRule["proximity"],
  bonusForA: Partial<typeof IDENTITY_FORMATION_BONUS>,
  bonusForB?: Partial<typeof IDENTITY_FORMATION_BONUS>,
): FormationRule {
  return { id, unitA, unitB, proximity, bonusForA, bonusForB };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("lane:tactical | formation-rule-system — unit tests", () => {

  // ── getActiveFormationRules ────────────────────────────────────────────────

  it("getActiveFormationRules() returns an empty array when no perks provided", () => {
    const rules = getActiveFormationRules();
    assert.deepStrictEqual(rules, []);
  });

  it("getActiveFormationRules([]) returns an empty array", () => {
    const rules = getActiveFormationRules([]);
    assert.deepStrictEqual(rules, []);
  });

  // ── evaluateFormationRules — empty ────────────────────────────────────────

  it("returns empty Map when activeRules is empty", () => {
    const grid = makeGrid({ 12: "infantry" });
    const result = evaluateFormationRules(grid, []);
    assert.strictEqual(result.size, 0, "should return empty Map with no rules");
  });

  it("returns empty Map when grid has no units", () => {
    const grid = makeGrid({});
    const rule = makeRule("r1", "infantry", "mg", { type: "adjacent" }, { hp_dealt_mult: 1.2 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0, "no units means no matches");
  });

  // ── Adjacent proximity ─────────────────────────────────────────────────────

  it("adjacent: grants bonus to both cells when matching units are neighbours", () => {
    const grid = makeGrid({ 12: "infantry", 13: "mg" });
    const rule = makeRule("r1", "infantry", "mg", { type: "adjacent" },
      { hp_dealt_mult: 1.2 }, { supp_dealt_mult: 1.15 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.ok(result.has(12), "infantry cell (12) should receive bonusForA");
    assert.ok(result.has(13), "mg cell (13) should receive bonusForB");
    assert.strictEqual(result.get(12)!.hp_dealt_mult, 1.2);
    assert.strictEqual(result.get(13)!.supp_dealt_mult, 1.15);
  });

  it("adjacent: no bonus when matching units are NOT neighbours", () => {
    const grid = makeGrid({ 0: "infantry", 24: "mg" });
    const rule = makeRule("r1", "infantry", "mg", { type: "adjacent" }, { hp_dealt_mult: 1.2 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0, "non-adjacent cells should not match");
  });

  it("adjacent: cell is not adjacent to itself", () => {
    const grid = makeGrid({ 12: "infantry" });
    const rule = makeRule("r1", "infantry", "infantry", { type: "adjacent" }, { hp_dealt_mult: 1.2 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0, "a cell cannot pair with itself");
  });

  // ── same_row proximity ─────────────────────────────────────────────────────

  it("same_row: grants bonus when matching units share a row", () => {
    const grid = makeGrid({ 10: "mg", 14: "mg" });
    const rule = makeRule("r1", "mg", "mg", { type: "same_row" },
      { supp_dealt_mult: 1.1 }, { supp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.ok(result.has(10), "cell 10 should get bonus");
    assert.ok(result.has(14), "cell 14 should get bonus");
  });

  it("same_row: no bonus when matching units are in different rows", () => {
    const grid = makeGrid({ 10: "mg", 15: "mg" });
    const rule = makeRule("r1", "mg", "mg", { type: "same_row" }, { supp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0);
  });

  // ── same_col proximity ─────────────────────────────────────────────────────

  it("same_col: grants bonus when matching units share a column", () => {
    const grid = makeGrid({ 2: "artillery", 22: "recon_infantry" });
    const rule = makeRule("r1", "artillery", "recon_infantry", { type: "same_col" },
      { hp_dealt_mult: 1.15 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.ok(result.has(2), "artillery cell should get bonusForA");
  });

  it("same_col: no bonus when same unit types are in different columns", () => {
    const grid = makeGrid({ 0: "artillery", 21: "recon_infantry" });
    const rule = makeRule("r1", "artillery", "recon_infantry", { type: "same_col" },
      { hp_dealt_mult: 1.15 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0);
  });

  // ── distance proximity ─────────────────────────────────────────────────────

  it("distance: grants bonus when Chebyshev distance <= max", () => {
    const grid = makeGrid({ 12: "infantry", 14: "mg" });
    const rule = makeRule("r1", "infantry", "mg", { type: "distance", max: 2 }, { hp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.ok(result.has(12), "within distance 2 should match");
  });

  it("distance: no bonus when Chebyshev distance > max", () => {
    const grid = makeGrid({ 12: "infantry", 14: "mg" });
    const rule = makeRule("r1", "infantry", "mg", { type: "distance", max: 1 }, { hp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0);
  });

  // ── self_in_row proximity ─────────────────────────────────────────────────

  it("self_in_row: grants bonus when unit is in the specified row", () => {
    const grid = makeGrid({ 20: "heavy_tank" });
    const rule = makeRule("r1", "heavy_tank", "", { type: "self_in_row", row: 4 },
      { hp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.ok(result.has(20), "heavy_tank in VANGUARD should get bonus");
    assert.strictEqual(result.get(20)!.hp_dealt_mult, 1.1);
  });

  it("self_in_row: no bonus when unit is in a different row", () => {
    const grid = makeGrid({ 0: "heavy_tank" });
    const rule = makeRule("r1", "heavy_tank", "", { type: "self_in_row", row: 4 },
      { hp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.strictEqual(result.size, 0);
  });

  // ── unitA as array ─────────────────────────────────────────────────────────

  it("unitA as string[]: matches any of the listed types", () => {
    const grid = makeGrid({ 12: "assault_infantry", 13: "mg" });
    const rule = makeRule("r1", ["infantry", "assault_infantry"], "mg",
      { type: "adjacent" }, { hp_dealt_mult: 1.2 });
    const result = evaluateFormationRules(grid, [rule]);
    assert.ok(result.has(12), "assault_infantry should match unitA array");
  });

  // ── Incapacitated cells ignored ────────────────────────────────────────────

  it("incapacitated cells are excluded from formation matching", () => {
    const cells: FormationCellInput[] = Array.from({ length: 25 }, (_, i) => ({
      unit_type:     i === 12 ? "infantry" : i === 13 ? "mg" : "",
      incapacitated: i === 12,
    }));
    const rule = makeRule("r1", "infantry", "mg", { type: "adjacent" }, { hp_dealt_mult: 1.2 });
    const result = evaluateFormationRules(cells, [rule]);
    assert.strictEqual(result.size, 0, "incapacitated units should not participate in formation bonuses");
  });

  // ── Multiple rules stack multiplicatively ──────────────────────────────────

  it("multiple matching rules stack modifiers multiplicatively on the same cell", () => {
    const grid = makeGrid({ 12: "infantry", 13: "mg", 11: "mg" });
    const rule1 = makeRule("r1", "infantry", "mg", { type: "adjacent" }, { hp_dealt_mult: 1.2 });
    const rule2 = makeRule("r2", "infantry", "mg", { type: "adjacent" }, { hp_dealt_mult: 1.1 });
    const result = evaluateFormationRules(grid, [rule1, rule2]);
    const combined = result.get(12)!.hp_dealt_mult;
    assert.ok(Math.abs(combined - 1.32) < 0.001,
      `expected 1.32 (1.2 * 1.1), got ${combined}`);
  });

  // ── IDENTITY_FORMATION_BONUS ───────────────────────────────────────────────

  it("IDENTITY_FORMATION_BONUS has all fields equal to 1.0", () => {
    assert.strictEqual(IDENTITY_FORMATION_BONUS.hp_dealt_mult,    1.0);
    assert.strictEqual(IDENTITY_FORMATION_BONUS.supp_dealt_mult,  1.0);
    assert.strictEqual(IDENTITY_FORMATION_BONUS.supp_resist_mult, 1.0);
    assert.strictEqual(IDENTITY_FORMATION_BONUS.supp_decay_mult,  1.0);
  });
});

// ── Integration tests ─────────────────────────────────────────────────────────
// These tests verify that wiring the formation rule system into combat does NOT
// break existing combat behaviour. Since getActiveFormationRules() returns [],
// formation bonuses are identity (1.0) and all damage/suppression is unchanged.

describe("lane:tactical | formation-rule-system — integration (no active rules = no change)", function () {

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
      const timer = setTimeout(() => {
        unbind();
        reject(new Error(`Timeout waiting for ROUND_RESOLVED for ${engagementId}`));
      }, timeoutMs);
      const unbind = client.onMessage("ROUND_RESOLVED", (msg: any) => {
        if (typeof msg.engagement_id === "string" && msg.engagement_id.startsWith(engagementId)) {
          clearTimeout(timer); unbind(); resolve(msg);
        }
      });
    });
  }

  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setRoundTicksForTesting(3);
    setCombatGraceTicksForTesting(1);
    colyseus = await boot(appConfig, getTestPort());
  });
  after(async () => {
    setRoundTicksForTesting(20);
    setCombatGraceTicksForTesting(10);
    await colyseus.shutdown();
  });
  beforeEach(async () => { await colyseus.cleanup(); });

  async function spawnCombat(
    divAUnits: Record<number, string>,
    divBUnits: Record<number, string>,
  ) {
    const token  = await makeToken();
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const divA = "div-a";
    const divB = "div-b";

    client.send("SPAWN_DIVISION", { division_id: divA, nation_id: "germany", position_lng: 0,     position_lat: 0     });
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

  it("ROUND_RESOLVED fires and defender cell takes HP damage (regression — no formation rules active)", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    const msg = await waitForEngagementRound(client, engagementId, 60_000);
    const hasDeltas = (msg.attacker_grid_delta?.length ?? 0) > 0 ||
                      (msg.defender_grid_delta?.length ?? 0) > 0;
    assert.ok(hasDeltas, "at least one grid delta should be present");
  });

  it("defender cell HP decreases after one round (regression)", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    await waitForEngagementRound(client, engagementId, 60_000);
    const cell = room.state.divisions.get("div-b")!.grid.cells[12];
    assert.ok(cell.hp < 100, `defender HP should have decreased from 100, got ${cell.hp}`);
  });

  it("defender cell suppression increases after one round (regression)", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    await waitForEngagementRound(client, engagementId, 60_000);
    const cell = room.state.divisions.get("div-b")!.grid.cells[12];
    assert.ok(cell.suppression > 0, `defender suppression should be > 0, got ${cell.suppression}`);
  });
});
