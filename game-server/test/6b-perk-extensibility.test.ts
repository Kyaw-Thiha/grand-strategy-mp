import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { IDENTITY_MODIFIERS } from "../src/types/perk_types.js";
import { PERK_REGISTRY, resolvePerkModifiers } from "../src/data/perks.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: false })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("lane:tactical | 6b — Perk System Extensibility", function () {
  this.timeout(15_000);

  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => { colyseus = await boot(appConfig); });
  after(async () => {
    await new Promise(r => setTimeout(r, 300));
    await colyseus.shutdown();
  });
  beforeEach(async () => { await colyseus.cleanup(); });

  async function joinRoom() {
    const token  = await makeToken();
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    return { client, room };
  }

  // ── Colyseus schema tests ─────────────────────────────────────────────────

  it("NationState.researched_perks field exists and serializes empty through Colyseus", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_NATION", { nation_id: "nation-perks-1" });
    await room.waitForNextPatch();

    const nation = room.state.nations.get("nation-perks-1");
    assert.ok(nation, "nation should exist in state");
    assert.ok("researched_perks" in nation, "researched_perks field must exist on NationState");
    assert.strictEqual(nation.researched_perks.length, 0, "researched_perks should default to empty");
  });

  it("researched_perks ArraySchema serializes and deserializes a perk ID through Colyseus", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_NATION", { nation_id: "nation-perks-2" });
    await room.waitForNextPatch();

    client.send("APPLY_PERKS", {
      nation_id: "nation-perks-2",
      perk_ids: ["infantry_suppression_resist_1", "cavalry_charge_damage_1"],
    });
    await room.waitForNextPatch();

    const nation = room.state.nations.get("nation-perks-2");
    assert.strictEqual(nation.researched_perks.length, 2);
    assert.strictEqual(nation.researched_perks[0], "infantry_suppression_resist_1");
    assert.strictEqual(nation.researched_perks[1], "cavalry_charge_damage_1");
  });

  // ── Pure function tests ───────────────────────────────────────────────────

  it("resolvePerkModifiers returns all 1.0× multipliers when no perks active", () => {
    const mods = resolvePerkModifiers("infantry", []);
    assert.deepStrictEqual(mods, IDENTITY_MODIFIERS);
  });

  it("infantry_suppression_resist_1 applies to infantry but not cavalry", () => {
    const infMods = resolvePerkModifiers("infantry", ["infantry_suppression_resist_1"]);
    const cavMods = resolvePerkModifiers("cavalry",  ["infantry_suppression_resist_1"]);
    assert.strictEqual(infMods.suppression_resist_mult, 1.10);
    assert.deepStrictEqual(cavMods, IDENTITY_MODIFIERS);
  });

  it("stacked infantry perks multiply suppression_resist_mult", () => {
    const mods = resolvePerkModifiers("infantry", [
      "infantry_suppression_resist_1",
      "infantry_suppression_resist_2",
    ]);
    assert.ok(Math.abs(mods.suppression_resist_mult - 1.10 * 1.20) < 0.001);
  });

  it("unknown perk IDs are silently ignored", () => {
    const mods = resolvePerkModifiers("infantry", ["perk_does_not_exist"]);
    assert.deepStrictEqual(mods, IDENTITY_MODIFIERS);
  });

  it("formation_synergy perks are not applied by resolvePerkModifiers", () => {
    const mods = resolvePerkModifiers("sniper", ["sniper_recon_enhanced"]);
    assert.deepStrictEqual(mods, IDENTITY_MODIFIERS);
  });

  it("PERK_REGISTRY contains the Phase 11 minimal perk set", () => {
    const expected = [
      "infantry_suppression_resist_1", "infantry_suppression_resist_2", "infantry_suppression_resist_3",
      "cavalry_charge_damage_1", "cavalry_charge_damage_2", "cavalry_charge_damage_3",
    ];
    for (const id of expected) {
      assert.ok(id in PERK_REGISTRY, `PERK_REGISTRY missing "${id}"`);
    }
  });
});
