import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { UnitType, XpTier } from "../src/types/tactical_types.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: false })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("6a — Tactical Grid Schema", function () {
  this.timeout(15_000);

  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => { colyseus = await boot(appConfig); });
  // Small drain delay lets in-flight HTTP requests complete before shutdown
  // to avoid ERR_HTTP_HEADERS_SENT contaminating subsequent test suites.
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

  it("DivisionState carries a grid field with 25 cells after division spawns", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_DIVISION", {
      division_id:  "div-test-1",
      nation_id:    "nation-1",
      position_lng: 0,
      position_lat: 0,
    });
    await room.waitForNextPatch();

    const div = room.state.divisions.get("div-test-1");
    assert.ok(div, "division should exist in state");
    assert.ok(div.grid, "division.grid should exist");
    assert.strictEqual(div.grid.cells.length, 25, "grid must have exactly 25 cells");
  });

  it("GridCellState defaults: empty unit_type, hp=100, suppression=0, xp_tier=green, not incapacitated", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_DIVISION", { division_id: "div-defaults", nation_id: "n1", position_lng: 0, position_lat: 0 });
    await room.waitForNextPatch();

    const div  = room.state.divisions.get("div-defaults");
    const cell = div.grid.cells[0];
    assert.strictEqual(cell.unit_type,     UnitType.EMPTY);
    assert.strictEqual(cell.hp,            100);
    assert.strictEqual(cell.suppression,   0);
    assert.strictEqual(cell.xp_tier,       XpTier.GREEN);
    assert.strictEqual(cell.incapacitated, false);
    assert.strictEqual(cell.stealthed,     false);
  });

  it("unit_type can be set to every valid UnitType value and round-trips through Colyseus", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_DIVISION", { division_id: "div-types", nation_id: "n1", position_lng: 0, position_lat: 0 });
    await room.waitForNextPatch();

    for (const [key, unitType] of Object.entries(UnitType)) {
      if (unitType === UnitType.EMPTY) continue;
      client.send("SET_CELL", { division_id: "div-types", cell_index: 0, unit_type: unitType });
      await room.waitForNextPatch();
      const cell = room.state.divisions.get("div-types").grid.cells[0];
      assert.strictEqual(cell.unit_type, unitType, `UnitType.${key} should survive serialization`);
    }
  });

  it("cell index 0 = R1 back-left, cell 24 = R5 vanguard-right; both survive round-trip", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_DIVISION", { division_id: "div-idx", nation_id: "n1", position_lng: 0, position_lat: 0 });
    await room.waitForNextPatch();

    client.send("SET_CELL", { division_id: "div-idx", cell_index: 0,  unit_type: "infantry" });
    client.send("SET_CELL", { division_id: "div-idx", cell_index: 24, unit_type: "artillery" });
    await room.waitForNextPatch();

    const div = room.state.divisions.get("div-idx");
    assert.strictEqual(div.grid.cells[0].unit_type,  "infantry");
    assert.strictEqual(div.grid.cells[24].unit_type, "artillery");
  });

  it("hp and suppression can be set independently per cell", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_DIVISION", { division_id: "div-bars", nation_id: "n1", position_lng: 0, position_lat: 0 });
    await room.waitForNextPatch();

    client.send("SET_CELL", { division_id: "div-bars", cell_index: 5, hp: 42, suppression: 67 });
    await room.waitForNextPatch();

    const cell = room.state.divisions.get("div-bars").grid.cells[5];
    assert.strictEqual(cell.hp,          42);
    assert.strictEqual(cell.suppression, 67);
  });

  it("xp_tier cycles through all four tiers and serializes correctly", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_DIVISION", { division_id: "div-xp", nation_id: "n1", position_lng: 0, position_lat: 0 });
    await room.waitForNextPatch();

    for (const tier of [XpTier.GREEN, XpTier.SEASONED, XpTier.VETERAN, XpTier.ELITE]) {
      client.send("SET_CELL", { division_id: "div-xp", cell_index: 12, xp_tier: tier });
      await room.waitForNextPatch();
      const cell = room.state.divisions.get("div-xp").grid.cells[12];
      assert.strictEqual(cell.xp_tier, tier);
    }
  });

  it("DivisionState.template_id exists and defaults to empty string", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_DIVISION", { division_id: "div-tmpl", nation_id: "n1", position_lng: 0, position_lat: 0 });
    await room.waitForNextPatch();

    const div = room.state.divisions.get("div-tmpl");
    assert.ok("template_id" in div, "template_id field must exist on DivisionState");
    assert.strictEqual(div.template_id, "");
  });

  it("unit_terrain_costs covers all UnitType values (except EMPTY)", async () => {
    const { UNIT_TERRAIN_COSTS } = await import("../src/data/unit_terrain_costs.js");
    for (const [key, unitType] of Object.entries(UnitType)) {
      if (unitType === UnitType.EMPTY) continue;
      assert.ok(
        unitType in UNIT_TERRAIN_COSTS,
        `unit_terrain_costs is missing entry for UnitType.${key} ("${unitType}")`
      );
    }
  });
});
