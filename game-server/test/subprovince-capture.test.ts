import assert from "assert";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { loadSubprovinceGraph, type SubprovinceDefinition } from "../src/data/map_loader.js";
import { buildSubprovinceSpatialIndex, findSubprovinceAtPoint, type SubprovincePIPEntry } from "../src/data/subprovince_loader.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub: string) {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

const MAP_ID = "western_europe_6";
// Manually-verified fixture provinces (per this plan's global-constraints research):
// we6_germany_01 is a plain hinterland-bearing province owned by germany; we6_germany_06 is
// germany's capital province and contains the map's germany-side capital-kind cell.
const GERMANY_PROVINCE = "we6_germany_01";
const GERMANY_CAPITAL_PROVINCE = "we6_germany_06";

const ATTACKER = "france";
const DEFENDER = "germany";
const NEUTRAL = "italy";

// ── Geometry helpers (pure, no room/network dependency) ───────────────────────

/** Centroid of a subprovince's outer ring, excluding a duplicated closing vertex if present. */
function centroidOf(def: SubprovinceDefinition): { lng: number; lat: number } {
  const ring = def.polygon[0];
  const first = ring[0];
  const last = ring[ring.length - 1];
  const pts = (first[0] === last[0] && first[1] === last[1]) ? ring.slice(0, -1) : ring;
  let lng = 0, lat = 0;
  for (const [x, y] of pts) { lng += x; lat += y; }
  return { lng: lng / pts.length, lat: lat / pts.length };
}

/**
 * A point guaranteed to resolve to a DIFFERENT subprovince than `def` (or none at all) —
 * extrapolates outward from the centroid through the first ring vertex until it lands outside.
 */
function pointOutside(def: SubprovinceDefinition, spatialIndex: SubprovincePIPEntry[]): { lng: number; lat: number } {
  const ring = def.polygon[0];
  const c = centroidOf(def);
  const v = ring[0];
  for (let scale = 1.05; scale <= 6; scale += 0.15) {
    const lng = c.lng + (v[0] - c.lng) * scale;
    const lat = c.lat + (v[1] - c.lat) * scale;
    if (findSubprovinceAtPoint(lng, lat, spatialIndex) !== def.id) return { lng, lat };
  }
  throw new Error(`could not compute a point outside subprovince ${def.id}`);
}

/** Picks `count` candidates whose centroid ray-casts back to themselves (skips any that don't). */
function pickVerifiedCells(
  candidates: SubprovinceDefinition[],
  spatialIndex: SubprovincePIPEntry[],
  count: number,
): Array<{ id: string; lng: number; lat: number }> {
  const picked: Array<{ id: string; lng: number; lat: number }> = [];
  for (const def of candidates) {
    const c = centroidOf(def);
    if (findSubprovinceAtPoint(c.lng, c.lat, spatialIndex) === def.id) {
      picked.push({ id: def.id, lng: c.lng, lat: c.lat });
      if (picked.length === count) return picked;
    }
  }
  throw new Error(`only found ${picked.length}/${count} centroid-verified cells among ${candidates.length} candidates`);
}

describe("lane:subprovince | Batch 4 — Basic Server Capture", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  // Fixture cells, computed once from the real map data.
  let literalCell: { id: string; lng: number; lat: number };
  let radiusTargetDef: SubprovinceDefinition;
  let radiusTargetCell: { id: string; lng: number; lat: number };
  let radiusOutsidePoint: { lng: number; lat: number };
  let stickyCellA: { id: string; lng: number; lat: number };
  let stickyCellB: { id: string; lng: number; lat: number };
  let revertCellA: { id: string; lng: number; lat: number };
  let revertCellB: { id: string; lng: number; lat: number };
  let freezeCell: { id: string; lng: number; lat: number };
  let eventCellA: { id: string; lng: number; lat: number };
  let eventCellB: { id: string; lng: number; lat: number };
  let neutralTestCell: { id: string; lng: number; lat: number };
  let capitalCell: { id: string; lng: number; lat: number };
  let awayFromProvinceCell: { id: string; lng: number; lat: number };
  let germanyCityPosition: { lng: number; lat: number };

  before(async () => {
    const graph = loadSubprovinceGraph(MAP_ID);
    const spatialIndex = buildSubprovinceSpatialIndex(graph);

    const hinterlandDefs = [...graph.nodes.values()].filter(
      (d) => d.provinceId === GERMANY_PROVINCE && d.kind === "hinterland",
    );
    const verifiedHinterland = pickVerifiedCells(hinterlandDefs, spatialIndex, 10);
    [
      literalCell,
      radiusTargetCell,
      stickyCellA,
      stickyCellB,
      revertCellA,
      revertCellB,
      freezeCell,
      eventCellA,
      eventCellB,
      neutralTestCell,
    ] = verifiedHinterland;
    radiusTargetDef = graph.nodes.get(radiusTargetCell.id)!;
    radiusOutsidePoint = pointOutside(radiusTargetDef, spatialIndex);

    const capitalDefs = [...graph.nodes.values()].filter(
      (d) => d.provinceId === GERMANY_CAPITAL_PROVINCE && d.kind === "capital",
    );
    [capitalCell] = pickVerifiedCells(capitalDefs, spatialIndex, 1);

    const otherProvinceDefs = [...graph.nodes.values()].filter(
      (d) => d.kind === "hinterland" && d.provinceId !== GERMANY_PROVINCE && d.provinceId !== GERMANY_CAPITAL_PROVINCE,
    );
    [awayFromProvinceCell] = pickVerifiedCells(otherProvinceDefs, spatialIndex, 1);

    // GERMANY_PROVINCE's city position, used to plant a stationary defender near the city so
    // the legacy whole-province auto-capture (combat_system.ts's `_checkProvinceCapture`,
    // which instantly flips an entire unopposed province to any occupying division) reports
    // the province as "contested" and leaves province-level ownership alone. Without this,
    // that unrelated legacy mechanic — running in the same gameTick() as this suite's
    // subprovince-level logic — would flip the whole province to the attacker on the very
    // first tick, making "revert to province owner" trivially a no-op instead of a real test.
    const __dir = dirname(fileURLToPath(import.meta.url));
    const mapData = JSON.parse(
      readFileSync(join(__dir, "..", "..", "client", "assets", "data", MAP_ID, "map_data.json"), "utf-8"),
    ) as { provinces: Array<{ province_id: string; city_position?: [number, number] }> };
    const germanyProvinceData = mapData.provinces.find((p) => p.province_id === GERMANY_PROVINCE);
    if (!germanyProvinceData?.city_position) throw new Error(`no city_position found for ${GERMANY_PROVINCE}`);
    germanyCityPosition = { lng: germanyProvinceData.city_position[0], lat: germanyProvinceData.city_position[1] };

    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  /** Boots a fresh room, connects one client per requested nation, and starts the game. */
  async function joinNations(nationIds: string[]): Promise<{ room: any; clients: Record<string, any> }> {
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const clients: Record<string, any> = {};
    for (const nationId of nationIds) {
      const token = await makeToken(`test-${nationId}`);
      const client = await colyseus.connectTo(room, { token });
      await room.waitForNextPatch();
      client.send("SELECT_NATION", { nation_id: nationId });
      await room.waitForNextPatch();
      clients[nationId] = client;
    }
    await (room as any).startGame();
    // Loading movement/waypoint data inside startGame() runs synchronously and can stall the
    // event loop long enough that Colyseus's internal clock "catches up" with a burst of
    // real automatic gameTick() calls the instant control returns — before this helper's
    // caller gets a chance to assert on freshly-initialized state. Clearing the clock
    // immediately (synchronously, before any await) cancels that pending auto-tick interval
    // so every tick in this suite is the explicit, deterministic tickRoom() call below.
    (room as any).clock.clear();
    // startGame() also spawns a full roster of STARTING_POSITIONS divisions for every nation
    // (real, historically-plausible frontline positions) so that other test suites can exercise
    // combat/movement end-to-end. Some of those real divisions sit inside/near this suite's
    // fixture province and would otherwise contaminate capture/revert/event-count assertions
    // that are specifically about the divisions each test spawns. Clear them for a hermetic
    // slate — this suite only cares about SubprovinceSystem's own capture mechanics.
    for (const id of [...room.state.divisions.keys()]) {
      room.state.divisions.delete(id);
    }
    await room.waitForNextPatch();
    return { room, clients };
  }

  async function spawnDivision(client: any, room: any, overrides: Record<string, unknown> = {}) {
    const defaults: Record<string, unknown> = {
      division_id: "d1",
      nation_id: ATTACKER,
      position_lng: 0,
      position_lat: 0,
    };
    client.send("SPAWN_DIVISION", { ...defaults, ...overrides });
    await room.waitForNextPatch();
  }

  async function tickRoom(room: any): Promise<void> {
    room.gameTick();
    await room.waitForNextPatch();
  }

  it("literal occupancy captures a hinterland cell", async () => {
    const { room, clients } = await joinNations([ATTACKER]);
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "d1",
      position_lng: literalCell.lng,
      position_lat: literalCell.lat,
    });
    await tickRoom(room);

    const sp = room.state.subprovinces.get(literalCell.id);
    assert.strictEqual(sp.owner_id, ATTACKER);
  });

  it("capital-kind cells never flip via checkCaptureAfterMovement", async () => {
    const { room, clients } = await joinNations([ATTACKER]);
    const before = room.state.subprovinces.get(capitalCell.id).owner_id;
    assert.strictEqual(before, DEFENDER, "sanity check: capital cell starts owned by its province owner");

    await spawnDivision(clients[ATTACKER], room, {
      division_id: "d1",
      position_lng: capitalCell.lng,
      position_lat: capitalCell.lat,
    });
    await tickRoom(room);

    const sp = room.state.subprovinces.get(capitalCell.id);
    assert.strictEqual(sp.owner_id, DEFENDER, "capital cells only flip via the city cascade, not literal occupancy");
  });

  it("radius-only presence does not capture", async () => {
    const { room, clients } = await joinNations([ATTACKER]);
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "d1",
      position_lng: radiusOutsidePoint.lng,
      position_lat: radiusOutsidePoint.lat,
      observation_radius: 500,
    });
    await tickRoom(room);

    const sp = room.state.subprovinces.get(radiusTargetCell.id);
    assert.strictEqual(sp.owner_id, DEFENDER, "a division merely observing (not occupying) the cell must not capture it");
  });

  it("recon unit captures the same as any other unit type", async () => {
    const { room, clients } = await joinNations([ATTACKER]);
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "d-recon",
      position_lng: literalCell.lng,
      position_lat: literalCell.lat,
    });

    const div = room.state.divisions.get("d-recon");
    assert.ok(
      div.grid.cells.some((c: any) => c.unit_type === "recon_infantry"),
      "spawned division must include at least one recon_infantry cell (default grid)",
    );

    await tickRoom(room);
    const sp = room.state.subprovinces.get(literalCell.id);
    assert.strictEqual(sp.owner_id, ATTACKER, "presence of a recon unit in the grid must not block capture");
  });

  it("sticky ownership persists while the attacker has a living division anywhere in the province", async () => {
    const { room, clients } = await joinNations([ATTACKER]);
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "d1",
      position_lng: stickyCellA.lng,
      position_lat: stickyCellA.lat,
    });
    await tickRoom(room);
    assert.strictEqual(room.state.subprovinces.get(stickyCellA.id).owner_id, ATTACKER);

    // Move the same division to a different subprovince within the same province.
    clients[ATTACKER].send("SET_DIVISION_POSITION", {
      division_id: "d1",
      lng: stickyCellB.lng,
      lat: stickyCellB.lat,
    });
    await room.waitForNextPatch();
    await tickRoom(room);

    assert.strictEqual(
      room.state.subprovinces.get(stickyCellA.id).owner_id,
      ATTACKER,
      "first captured cell must remain owned by the attacker while it still holds the province",
    );
    assert.strictEqual(room.state.subprovinces.get(stickyCellB.id).owner_id, ATTACKER);
  });

  it("complete revert happens in one tick when the attacker's division leaves the province", async () => {
    const { room, clients } = await joinNations([ATTACKER]);
    // Keep this test isolated to subprovince-level ownership: stationing an idle germany
    // defender at the province's city, plus a war stance, makes combat_system.ts's unrelated
    // legacy whole-province auto-capture see the province as "contested" (an at-war enemy
    // within its contest radius of the city) and leave state.provinces' owner_id alone — so
    // this test genuinely exercises SubprovinceSystem's own revert path, not a coincidental
    // side effect of the legacy province flip already having made the attacker the "proper"
    // owner by the time we check.
    clients[ATTACKER].send("SET_RELATION", { nation_a: ATTACKER, nation_b: DEFENDER, stance: "war" });
    await room.waitForNextPatch();
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "defender",
      nation_id: DEFENDER,
      position_lng: germanyCityPosition.lng,
      position_lat: germanyCityPosition.lat,
    });
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "d1",
      position_lng: revertCellA.lng,
      position_lat: revertCellA.lat,
    });
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "d2",
      position_lng: revertCellB.lng,
      position_lat: revertCellB.lat,
    });
    await tickRoom(room);
    assert.strictEqual(room.state.subprovinces.get(revertCellA.id).owner_id, ATTACKER);
    assert.strictEqual(room.state.subprovinces.get(revertCellB.id).owner_id, ATTACKER);

    // Move both divisions entirely out of the province in a single tick.
    clients[ATTACKER].send("SET_DIVISION_POSITION", {
      division_id: "d1",
      lng: awayFromProvinceCell.lng,
      lat: awayFromProvinceCell.lat,
    });
    clients[ATTACKER].send("SET_DIVISION_POSITION", {
      division_id: "d2",
      lng: awayFromProvinceCell.lng,
      lat: awayFromProvinceCell.lat,
    });
    await room.waitForNextPatch();
    await tickRoom(room);

    assert.strictEqual(room.state.subprovinces.get(revertCellA.id).owner_id, DEFENDER);
    assert.strictEqual(room.state.subprovinces.get(revertCellB.id).owner_id, DEFENDER);
  });

  it("combat freeze prevents capture, and capture proceeds once combat resolves", async () => {
    const { room, clients } = await joinNations([ATTACKER]);
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "d1",
      position_lng: freezeCell.lng,
      position_lat: freezeCell.lat,
    });

    const div = room.state.divisions.get("d1");
    div.combat_state = "engaged";
    await tickRoom(room);
    assert.strictEqual(
      room.state.subprovinces.get(freezeCell.id).owner_id,
      DEFENDER,
      "an engaged division must not capture the cell it occupies",
    );

    div.combat_state = "idle";
    await tickRoom(room);
    assert.strictEqual(
      room.state.subprovinces.get(freezeCell.id).owner_id,
      ATTACKER,
      "capture must proceed once combat resolves back to idle",
    );
  });

  it("emits one SUBPROVINCE_CAPTURED event per changed cell, not batched", async () => {
    const { room, clients } = await joinNations([ATTACKER, DEFENDER]);
    clients[ATTACKER].send("SET_RELATION", { nation_a: ATTACKER, nation_b: DEFENDER, stance: "war" });
    await room.waitForNextPatch();

    const events: any[] = [];
    clients[ATTACKER].onMessage("SUBPROVINCE_CAPTURED", (msg: any) => events.push(msg));

    await spawnDivision(clients[ATTACKER], room, {
      division_id: "d1",
      position_lng: eventCellA.lng,
      position_lat: eventCellA.lat,
    });
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "d2",
      position_lng: eventCellB.lng,
      position_lat: eventCellB.lat,
    });
    await tickRoom(room);

    assert.strictEqual(events.length, 2, "must receive one separate event per captured cell, not a single batched event");
    const ids = events.map((e) => e.subprovince_id).sort();
    assert.deepStrictEqual(ids, [eventCellA.id, eventCellB.id].sort());
  });

  it("neutral observers receive PROVINCE_CONTEST_UPDATE without subprovince_id, never SUBPROVINCE_CAPTURED", async () => {
    const { room, clients } = await joinNations([ATTACKER, DEFENDER, NEUTRAL]);
    clients[ATTACKER].send("SET_RELATION", { nation_a: ATTACKER, nation_b: DEFENDER, stance: "war" });
    await room.waitForNextPatch();

    const neutralCaptured: any[] = [];
    const neutralContest: any[] = [];
    clients[NEUTRAL].onMessage("SUBPROVINCE_CAPTURED", (msg: any) => neutralCaptured.push(msg));
    clients[NEUTRAL].onMessage("PROVINCE_CONTEST_UPDATE", (msg: any) => neutralContest.push(msg));

    const belligerentCaptured: any[] = [];
    clients[ATTACKER].onMessage("SUBPROVINCE_CAPTURED", (msg: any) => belligerentCaptured.push(msg));

    await spawnDivision(clients[ATTACKER], room, {
      division_id: "d1",
      position_lng: neutralTestCell.lng,
      position_lat: neutralTestCell.lat,
    });
    await tickRoom(room);

    assert.strictEqual(neutralCaptured.length, 0, "a nation at peace with both sides must never receive SUBPROVINCE_CAPTURED");
    assert.ok(neutralContest.length >= 1, "a nation at peace with both sides must receive PROVINCE_CONTEST_UPDATE");
    for (const msg of neutralContest) {
      assert.ok(!("subprovince_id" in msg), "PROVINCE_CONTEST_UPDATE must not leak the exact subprovince_id to neutral observers");
    }
    assert.ok(belligerentCaptured.length >= 1, "the belligerent attacker must receive SUBPROVINCE_CAPTURED");
  });

  it("initial ownership after startGame() matches each subprovince's province owner", async () => {
    const { room } = await joinNations([ATTACKER]);

    let checked = 0;
    for (const [id, sp] of room.state.subprovinces) {
      const province = room.state.provinces.get(sp.province_id);
      assert.strictEqual(sp.owner_id, province?.owner_id ?? "", `subprovince ${id} must start owned by its province's owner`);
      checked++;
    }
    assert.ok(checked > 0, "sanity check: subprovinces must have been initialized");
  });

  it("getSubprovinceAtPosition returns null for a position outside all known subprovinces", async () => {
    const { room } = await joinNations([ATTACKER]);
    // (0, 0) — mid-Atlantic/Gulf of Guinea — is nowhere near the western_europe_6 map bounds.
    const result = (room as any).subprovinceSystem.getSubprovinceAtPosition({ lng: 0, lat: 0 });
    assert.strictEqual(result, null);
  });
});
