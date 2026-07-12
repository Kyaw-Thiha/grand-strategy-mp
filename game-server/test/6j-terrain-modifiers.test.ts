import { describe, it } from "mocha";
import assert from "assert";
import {
  evaluateTerrainModifiers,
  getActiveTerrainModifierRules,
  IDENTITY_TERRAIN_MODIFIERS,
} from "../src/systems/terrain_modifier_system.js";
import type { TerrainModifierRule, TerrainCellInput } from "../src/systems/terrain_modifier_system.js";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { setRoundTicksForTesting, setCombatGraceTicksForTesting } from "../src/systems/combat_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret  = new TextEncoder().encode(JWT_SECRET);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGrid(overrides: Record<number, string>): TerrainCellInput[] {
  return Array.from({ length: 25 }, (_, i) => ({
    unit_type:     overrides[i] ?? "",
    incapacitated: false,
  }));
}

function makeRule(
  id: string,
  unit_types: string | string[],
  terrain: string | string[],
  modifiers: Partial<typeof IDENTITY_TERRAIN_MODIFIERS>,
): TerrainModifierRule {
  return { id, unit_types, terrain, modifiers };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("lane:tactical | terrain-modifier-system — unit tests", () => {

  // ── getActiveTerrainModifierRules ─────────────────────────────────────────

  it("getActiveTerrainModifierRules() returns empty array", () => {
    assert.deepStrictEqual(getActiveTerrainModifierRules(), []);
  });

  it("getActiveTerrainModifierRules([]) returns empty array", () => {
    assert.deepStrictEqual(getActiveTerrainModifierRules([]), []);
  });

  // ── Fast paths ────────────────────────────────────────────────────────────

  it("returns empty Map when activeRules is empty", () => {
    assert.strictEqual(evaluateTerrainModifiers(makeGrid({ 12: "infantry" }), "dense_forest", []).size, 0);
  });

  it("returns empty Map when grid has no units", () => {
    const rule = makeRule("r1", "infantry", "dense_forest", { hp_dealt_mult: 1.2 });
    assert.strictEqual(evaluateTerrainModifiers(makeGrid({}), "dense_forest", [rule]).size, 0);
  });

  // ── Terrain and unit matching ─────────────────────────────────────────────

  it("grants modifier when unit_type and terrain both match", () => {
    const grid = makeGrid({ 12: "infantry" });
    const rule = makeRule("r1", "infantry", "dense_forest", { supp_resist_mult: 0.8 });
    const result = evaluateTerrainModifiers(grid, "dense_forest", [rule]);
    assert.ok(result.has(12));
    assert.strictEqual(result.get(12)!.supp_resist_mult, 0.8);
  });

  it("no modifier when terrain does NOT match", () => {
    const grid = makeGrid({ 12: "infantry" });
    const rule = makeRule("r1", "infantry", "dense_forest", { supp_resist_mult: 0.8 });
    assert.strictEqual(evaluateTerrainModifiers(grid, "plains", [rule]).size, 0);
  });

  it("no modifier when unit_type does NOT match", () => {
    const grid = makeGrid({ 12: "artillery" });
    const rule = makeRule("r1", "infantry", "dense_forest", { supp_resist_mult: 0.8 });
    assert.strictEqual(evaluateTerrainModifiers(grid, "dense_forest", [rule]).size, 0);
  });

  // ── unit_types and terrain as arrays ─────────────────────────────────────

  it("unit_types as string[]: matches any listed unit type", () => {
    const grid = makeGrid({ 5: "commando" });
    const rule = makeRule("r1", ["infantry", "commando", "recon_infantry"], "temperate_forest", { supp_resist_mult: 0.85 });
    const result = evaluateTerrainModifiers(grid, "temperate_forest", [rule]);
    assert.ok(result.has(5));
  });

  it("terrain as string[]: matches any listed terrain", () => {
    const grid = makeGrid({ 5: "infantry" });
    const rule = makeRule("r1", "infantry", ["temperate_forest", "boreal_forest", "dense_forest"], { supp_resist_mult: 0.85 });
    const result = evaluateTerrainModifiers(grid, "boreal_forest", [rule]);
    assert.ok(result.has(5));
  });

  it("terrain as string[]: no match when none of the listed terrains match", () => {
    const grid = makeGrid({ 5: "infantry" });
    const rule = makeRule("r1", "infantry", ["temperate_forest", "dense_forest"], { supp_resist_mult: 0.85 });
    assert.strictEqual(evaluateTerrainModifiers(grid, "plains", [rule]).size, 0);
  });

  // ── flanking_enabled ──────────────────────────────────────────────────────

  it("flanking_enabled: false propagates for matching cell", () => {
    const grid = makeGrid({ 20: "heavy_tank" });
    const rule = makeRule("r1", ["light_tank", "medium_tank", "heavy_tank", "armoured_car"], ["dense_forest", "urban"], { flanking_enabled: false });
    const result = evaluateTerrainModifiers(grid, "urban", [rule]);
    assert.ok(result.has(20));
    assert.strictEqual(result.get(20)!.flanking_enabled, false);
  });

  it("flanking_enabled: no rule matched → cell not in map → caller uses IDENTITY (flanking_enabled: true)", () => {
    const grid = makeGrid({ 20: "heavy_tank" });
    const rule = makeRule("r1", ["light_tank", "medium_tank", "heavy_tank", "armoured_car"], ["dense_forest", "urban"], { flanking_enabled: false });
    const result = evaluateTerrainModifiers(grid, "plains", [rule]);
    assert.strictEqual(result.has(20), false);
    // Caller does: result.get(20) ?? IDENTITY_TERRAIN_MODIFIERS → flanking_enabled: true
  });

  // ── stealth_delta ─────────────────────────────────────────────────────────

  it("stealth_delta: positive delta granted for matching unit+terrain", () => {
    const grid = makeGrid({ 3: "sniper" });
    const rule = makeRule("r1", ["sniper", "commando", "recon_infantry"], "dense_forest", { stealth_delta: 1 });
    const result = evaluateTerrainModifiers(grid, "dense_forest", [rule]);
    assert.ok(result.has(3));
    assert.strictEqual(result.get(3)!.stealth_delta, 1);
  });

  it("stealth_delta: stacks additively across multiple matching rules", () => {
    const grid = makeGrid({ 3: "sniper" });
    const rule1 = makeRule("r1", "sniper", "dense_forest", { stealth_delta: 1 });
    const rule2 = makeRule("r2", "sniper", "dense_forest", { stealth_delta: 1 });
    const result = evaluateTerrainModifiers(grid, "dense_forest", [rule1, rule2]);
    assert.strictEqual(result.get(3)!.stealth_delta, 2);
  });

  // ── Multiplicative stacking (combat mods) ─────────────────────────────────

  it("hp_dealt_mult stacks multiplicatively across multiple rules", () => {
    const grid = makeGrid({ 12: "infantry" });
    const rule1 = makeRule("r1", "infantry", "plains", { hp_dealt_mult: 1.2 });
    const rule2 = makeRule("r2", "infantry", "plains", { hp_dealt_mult: 1.1 });
    const combined = evaluateTerrainModifiers(grid, "plains", [rule1, rule2]).get(12)!.hp_dealt_mult;
    assert.ok(Math.abs(combined - 1.32) < 0.001, `expected 1.32, got ${combined}`);
  });

  // ── flanking AND stacking ─────────────────────────────────────────────────

  it("flanking_enabled AND stacking: one false rule disables flanking even with other rules active", () => {
    const grid = makeGrid({ 20: "heavy_tank" });
    const ruleFlankDisable = makeRule("r1", "heavy_tank", "dense_forest", { flanking_enabled: false });
    const ruleHpBonus      = makeRule("r2", "heavy_tank", "dense_forest", { hp_dealt_mult: 1.1 });
    const result = evaluateTerrainModifiers(grid, "dense_forest", [ruleFlankDisable, ruleHpBonus]);
    assert.strictEqual(result.get(20)!.flanking_enabled, false, "flanking should be disabled");
    assert.ok(Math.abs(result.get(20)!.hp_dealt_mult - 1.1) < 0.001, "hp_dealt_mult should still apply");
  });

  // ── Incapacitated excluded ────────────────────────────────────────────────

  it("incapacitated cells are excluded from terrain matching", () => {
    const cells: TerrainCellInput[] = Array.from({ length: 25 }, (_, i) => ({
      unit_type:     i === 12 ? "infantry" : "",
      incapacitated: i === 12,
    }));
    const rule = makeRule("r1", "infantry", "dense_forest", { supp_resist_mult: 0.8 });
    assert.strictEqual(evaluateTerrainModifiers(cells, "dense_forest", [rule]).size, 0);
  });

  // ── IDENTITY_TERRAIN_MODIFIERS ────────────────────────────────────────────

  it("IDENTITY_TERRAIN_MODIFIERS: all combat mults = 1.0, stealth_delta = 0, flanking_enabled = true", () => {
    assert.strictEqual(IDENTITY_TERRAIN_MODIFIERS.hp_dealt_mult,    1.0);
    assert.strictEqual(IDENTITY_TERRAIN_MODIFIERS.supp_dealt_mult,  1.0);
    assert.strictEqual(IDENTITY_TERRAIN_MODIFIERS.supp_resist_mult, 1.0);
    assert.strictEqual(IDENTITY_TERRAIN_MODIFIERS.supp_decay_mult,  1.0);
    assert.strictEqual(IDENTITY_TERRAIN_MODIFIERS.stealth_delta,    0);
    assert.strictEqual(IDENTITY_TERRAIN_MODIFIERS.flanking_enabled, true);
  });
});

// ── Integration tests (no active rules = no change, regression) ─────────────

describe("lane:tactical | terrain-modifier-system — integration (no active rules = no change)", function () {
  this.timeout(180_000);

  async function makeToken(sub = "test-user") {
    return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("24h")
      .sign(jwtSecret);
  }

  function waitForEngagementRound(client: any, engagementId: string, timeoutMs = 60_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { unbind(); reject(new Error(`Timeout: ${engagementId}`)); }, timeoutMs);
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

    client.send("SPAWN_DIVISION", { division_id: "div-a", nation_id: "germany", position_lng: 0,     position_lat: 0     });
    client.send("SPAWN_DIVISION", { division_id: "div-b", nation_id: "france",  position_lng: 0.001, position_lat: 0.001 });
    await room.waitForNextPatch();

    for (const [idx, utype] of Object.entries(divAUnits))
      client.send("SET_CELL", { division_id: "div-a", cell_index: +idx, unit_type: utype });
    for (const [idx, utype] of Object.entries(divBUnits))
      client.send("SET_CELL", { division_id: "div-b", cell_index: +idx, unit_type: utype });
    await room.waitForNextPatch();

    await (room as any).startGame();
    // startGame() resets all relations to neutral via _initRelations().
    // Declare war so _detectEngagements() can trigger COMBAT_STARTED.
    client.send("SET_RELATION", { nation_a: "germany", nation_b: "france", stance: "war" });
    await room.waitForNextPatch();
    await client.waitForMessage("COMBAT_STARTED", 60_000);

    return { room, client, engagementId: "div-a_vs_div-b_" };
  }

  it("ROUND_RESOLVED fires correctly with no active terrain rules (regression)", async () => {
    const { client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    const msg = await waitForEngagementRound(client, engagementId);
    const hasDeltas = (msg.attacker_grid_delta?.length ?? 0) > 0 || (msg.defender_grid_delta?.length ?? 0) > 0;
    assert.ok(hasDeltas, "at least one grid delta should be present");
  });

  it("defender HP decreases after one round — no terrain rule interference (regression)", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    await waitForEngagementRound(client, engagementId);
    const cell = room.state.divisions.get("div-b")!.grid.cells[12];
    assert.ok(cell.hp < 100, `defender HP should drop from 100, got ${cell.hp}`);
  });

  it("defender suppression increases after one round — no terrain rule interference (regression)", async () => {
    const { room, client, engagementId } = await spawnCombat({ 12: "infantry" }, { 12: "infantry" });
    await waitForEngagementRound(client, engagementId);
    const cell = room.state.divisions.get("div-b")!.grid.cells[12];
    assert.ok(cell.suppression > 0, `suppression should be > 0, got ${cell.suppression}`);
  });

  // ── Suppression bridge verification tests ─────────────────────────────────

  it("(bridge) stealthed cell excluded from suppression average — Suppressed not triggered", async () => {
    const { room, client, engagementId } = await spawnCombat(
      { 12: "sniper", 13: "mg" },
      { 12: "infantry" },
    );

    const divA = room.state.divisions.get("div-a")!;
    (divA.grid.cells[12] as any).stealthed    = true;
    (divA.grid.cells[12] as any).suppression  = 80;
    (divA.grid.cells[13] as any).suppression  = 40;

    await waitForEngagementRound(client, engagementId);

    assert.strictEqual(divA.combat_state, "engaged",
      `stealthed exclusion should keep combat_state "engaged", got ${divA.combat_state}`);
    assert.ok(divA.suppression < 60,
      `div.suppression should be < 60 with stealthed excluded, got ${divA.suppression}`);
  });

  it("(bridge) incapacitated cell excluded from suppression average — Suppressed not triggered", async () => {
    const { room, client, engagementId } = await spawnCombat(
      { 12: "infantry", 13: "mg" },
      { 12: "infantry" },
    );

    const divA = room.state.divisions.get("div-a")!;
    (divA.grid.cells[12] as any).hp            = 19;
    (divA.grid.cells[12] as any).incapacitated = true;
    (divA.grid.cells[12] as any).suppression   = 80;
    (divA.grid.cells[13] as any).suppression   = 40;

    await waitForEngagementRound(client, engagementId);

    assert.strictEqual(divA.combat_state, "engaged",
      `incapacitated exclusion should keep combat_state "engaged", got ${divA.combat_state}`);
    assert.ok(divA.suppression < 60,
      `div.suppression should be < 60 with incapacitated excluded, got ${divA.suppression}`);
  });

  it("(bridge) suppression ≥ threshold after decay → combat_state 'suppressed'", async () => {
    const { room, client, engagementId } = await spawnCombat(
      { 12: "infantry" },
      { 12: "infantry" },
    );

    const divB = room.state.divisions.get("div-b")!;
    (divB.grid.cells[12] as any).suppression = 75;

    await waitForEngagementRound(client, engagementId);

    assert.strictEqual(divB.combat_state, "suppressed",
      `defender with suppression ≥ threshold should be "suppressed", got ${divB.combat_state}`);
  });

  it("(bridge) attacker suppression ≥ 80 threshold after non-meeting pair mutation → combat_state 'suppressed'", async () => {
    const { room, client, engagementId } = await spawnCombat(
      { 12: "infantry" },
      { 12: "infantry" },
    );

    // After COMBAT_STARTED, mutate the meeting battle into a non-meeting battle
    // so the attacker uses the 80% threshold instead of 60%.
    const combatSystem = (room as any).combatSystem;
    const pair = combatSystem.activePairs.get("div-a|div-b");
    pair.is_meeting = false;
    pair.attacker_id = "div-a";
    pair.defender_id = "div-b";

    const divA = room.state.divisions.get("div-a")!;
    const divB = room.state.divisions.get("div-b")!;
    divA.attacker_role = "attacker";
    divB.attacker_role = "defender";

    // Set attacker suppression high enough that after decay (8) and incoming
    // suppression (~1) the cell-level avg stays ≥ 80.
    (divA.grid.cells[12] as any).suppression = 95;

    await waitForEngagementRound(client, engagementId);

    assert.strictEqual(divA.combat_state, "suppressed",
      `attacker with suppression ≥ 80 should be "suppressed", got ${divA.combat_state}`);
  });
});
