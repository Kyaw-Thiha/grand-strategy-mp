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
import { loadSubprovinceGraph, type SubprovinceDefinition, type SubprovinceGraph, type SubprovinceKind } from "../src/data/map_loader.js";
import { buildSubprovinceSpatialIndex, findSubprovinceAtPoint, type SubprovincePIPEntry } from "../src/data/subprovince_loader.js";
import { findSupplyRoute } from "../src/systems/supply_graph.js";
import { makeIsFriendly } from "../src/systems/subprovince_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub: string) {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

const MAP_ID = "western_europe_6";
// we6_germany_01 is a plain hinterland-bearing province (no capital cell of its own) owned by
// germany; we6_germany_06 is germany's capital province and contains the map's germany capital
// cell. Both facts are used the same way subprovince-capture.test.ts uses them.
const GERMANY_PROVINCE = "we6_germany_01";
const GERMANY_CAPITAL_PROVINCE = "we6_germany_06";

const ATTACKER = "france";
const DEFENDER = "germany";

// ── Geometry helpers (pure, no room/network dependency) — mirrors subprovince-capture.test.ts ──

function centroidOf(def: SubprovinceDefinition): { lng: number; lat: number } {
  const ring = def.polygon[0];
  const first = ring[0];
  const last = ring[ring.length - 1];
  const pts = (first[0] === last[0] && first[1] === last[1]) ? ring.slice(0, -1) : ring;
  let lng = 0, lat = 0;
  for (const [x, y] of pts) { lng += x; lat += y; }
  return { lng: lng / pts.length, lat: lat / pts.length };
}

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

/** BFS hop-distance from `startId` to every node reachable through `graph.neighbors`. */
function bfsDistances(graph: SubprovinceGraph, startId: string): Map<string, number> {
  const dist = new Map<string, number>([[startId, 0]]);
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    for (const n of graph.neighbors.get(cur) ?? []) {
      if (dist.has(n)) continue;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

describe("lane:subprovince | Batch 5 — City Capture Cascade", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  let graph: SubprovinceGraph;
  let spatialIndex: SubprovincePIPEntry[];
  let provinceCellIds: string[]; // every subprovince id belonging to GERMANY_PROVINCE

  let attackerCell: { id: string; lng: number; lat: number };
  let defenderCell: { id: string; lng: number; lat: number };
  let unrelatedCell: { id: string; lng: number; lat: number };
  // A hinterland cell within GERMANY_PROVINCE, directly adjacent to defenderCell, that the
  // route-preservation test expects to survive as part of the preserved supply route (it sits
  // between defenderCell and the fabricated cross-province hub below).
  let routeIntermediateCell: { id: string; lng: number; lat: number };
  // A hinterland cell in a DIFFERENT germany-owned province, temporarily promoted to kind
  // "capital" (i.e. supply hub) for the route-preservation test. It must live outside
  // GERMANY_PROVINCE: cascadeCityCapture's capital-sync step (Step 1) flips the owner of every
  // "capital"-kind cell *within the captured province* to the new owner before hubs are even
  // computed, so a fabricated hub inside the captured province would be captured by that sync
  // step itself before route selection ever ran. A fabricated inter-province edge (added/removed
  // around the test) connects routeIntermediateCell to this hub — the real map's subprovince
  // graph otherwise has zero inter-province edges (confirmed by direct inspection), so a route
  // to a hub in a different province is never naturally reachable.
  let routeHubDef: SubprovinceDefinition;
  let routeHubOriginalKind: SubprovinceKind;

  let capitalCell: { id: string; lng: number; lat: number };
  let germanyCapitalCityPosition: { lng: number; lat: number };

  before(async () => {
    graph = loadSubprovinceGraph(MAP_ID);
    spatialIndex = buildSubprovinceSpatialIndex(graph);

    const g1 = [...graph.nodes.values()].filter((d) => d.provinceId === GERMANY_PROVINCE);
    provinceCellIds = g1.map((d) => d.id);

    const __dirEarly = dirname(fileURLToPath(import.meta.url));
    const mapDataEarly = JSON.parse(
      readFileSync(join(__dirEarly, "..", "..", "client", "assets", "data", MAP_ID, "map_data.json"), "utf-8"),
    ) as { provinces: Array<{ province_id: string; city_position?: [number, number] }> };
    // _checkProvinceCapture (Fix 1) now additionally requires the occupying division be within
    // CONTEST_RADIUS_KM of the province's own city_position before the legacy whole-province
    // auto-capture fires — an arbitrary hinterland cell is no longer guaranteed to qualify.
    // attackerCell must be the cell that actually contains GERMANY_PROVINCE's city_position, so
    // standing there always satisfies that proximity requirement (distance 0), while still being
    // an ordinary hinterland/road cell whose own capture the existing per-cell assertions exercise.
    const germanyProvinceData = mapDataEarly.provinces.find((p) => p.province_id === GERMANY_PROVINCE);
    if (!germanyProvinceData?.city_position) throw new Error(`no city_position found for ${GERMANY_PROVINCE}`);
    const germanyProvinceCityId = findSubprovinceAtPoint(
      germanyProvinceData.city_position[0], germanyProvinceData.city_position[1], spatialIndex,
    );
    if (!germanyProvinceCityId) throw new Error(`${GERMANY_PROVINCE}'s city_position resolved to no subprovince cell`);
    const germanyProvinceCityDef = graph.nodes.get(germanyProvinceCityId)!;
    attackerCell = centroidOf(germanyProvinceCityDef);
    if (findSubprovinceAtPoint(attackerCell.lng, attackerCell.lat, spatialIndex) !== germanyProvinceCityId) {
      // Centroid didn't verify (rare, non-convex cell) — fall back to the exact city point itself,
      // which is guaranteed to resolve into this cell since that's how it was looked up above.
      attackerCell = { id: germanyProvinceCityId, lng: germanyProvinceData.city_position[0], lat: germanyProvinceData.city_position[1] };
    } else {
      attackerCell = { id: germanyProvinceCityId, lng: attackerCell.lng, lat: attackerCell.lat };
    }

    const hinterlandDefs = g1.filter((d) => d.kind === "hinterland" && d.id !== attackerCell.id);
    const verifiedHinterland = pickVerifiedCells(hinterlandDefs, spatialIndex, 2);
    [defenderCell, unrelatedCell] = verifiedHinterland;

    const dist = bfsDistances(graph, defenderCell.id);
    const intermediateCandidates = hinterlandDefs.filter(
      (d) => dist.get(d.id) === 1 && d.id !== attackerCell.id && d.id !== unrelatedCell.id,
    );
    [routeIntermediateCell] = pickVerifiedCells(intermediateCandidates, spatialIndex, 1);

    const g2Hinterland = [...graph.nodes.values()].filter(
      (d) => d.provinceId === "we6_germany_02" && d.kind === "hinterland",
    );
    const [verifiedHub] = pickVerifiedCells(g2Hinterland, spatialIndex, 1);
    routeHubDef = graph.nodes.get(verifiedHub.id)!;
    routeHubOriginalKind = routeHubDef.kind;

    const capitalDefs = [...graph.nodes.values()].filter(
      (d) => d.provinceId === GERMANY_CAPITAL_PROVINCE && d.kind === "capital",
    );
    [capitalCell] = pickVerifiedCells(capitalDefs, spatialIndex, 1);

    const __dir = dirname(fileURLToPath(import.meta.url));
    const mapData = JSON.parse(
      readFileSync(join(__dir, "..", "..", "client", "assets", "data", MAP_ID, "map_data.json"), "utf-8"),
    ) as { provinces: Array<{ province_id: string; city_position?: [number, number] }> };
    const capitalProvinceData = mapData.provinces.find((p) => p.province_id === GERMANY_CAPITAL_PROVINCE);
    if (!capitalProvinceData?.city_position) throw new Error(`no city_position found for ${GERMANY_CAPITAL_PROVINCE}`);
    germanyCapitalCityPosition = { lng: capitalProvinceData.city_position[0], lat: capitalProvinceData.city_position[1] };

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
    // See subprovince-capture.test.ts for why these two workarounds (clock clear + division
    // wipe) are required: Colyseus's clock can "catch up" with real automatic ticks before this
    // helper's caller gets to assert, and startGame() spawns a full STARTING_POSITIONS roster
    // that would otherwise contaminate this suite's own capture/cascade assertions.
    (room as any).clock.clear();
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

  it("preserves occupied former-defender cells while flipping the rest of the province", async () => {
    const { room, clients } = await joinNations([ATTACKER]);
    // Spawn the surviving germany defender BEFORE the attacker: _checkProvinceCapture has no
    // "already captured this tick" guard, so it re-evaluates every division against the
    // (possibly just-updated) province owner in insertion order. Spawning the still-germany
    // owner's own division first means it trivially no-ops (owner_id already matches), leaving
    // the attacker's subsequent capture as the only actual flip this tick, instead of the
    // defender's later-processed division bouncing the flip straight back to germany.
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "defender",
      nation_id: DEFENDER,
      position_lng: defenderCell.lng,
      position_lat: defenderCell.lat,
    });
    // Attacker occupies a cell inside the province with no declared war, so the legacy
    // whole-province auto-capture (_checkProvinceCapture) sees no contest and flips the
    // province, triggering the cascade.
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "attacker",
      position_lng: attackerCell.lng,
      position_lat: attackerCell.lat,
    });
    await tickRoom(room);

    assert.strictEqual(room.state.provinces.get(GERMANY_PROVINCE).owner_id, ATTACKER, "sanity: province must have flipped");
    assert.strictEqual(
      room.state.subprovinces.get(defenderCell.id).owner_id,
      DEFENDER,
      "the surviving former-defender's occupied cell must remain germany-owned",
    );
    assert.strictEqual(
      room.state.subprovinces.get(unrelatedCell.id).owner_id,
      ATTACKER,
      "an unoccupied hinterland cell with no route relevance must flip to the new owner",
    );
  });

  it("preserves the selected supply route to another owned hub", async () => {
    // Temporarily promote a hinterland cell in a different germany-owned province to a
    // "capital" (i.e. supply-hub) kind, and fabricate a bidirectional edge connecting it to
    // routeIntermediateCell (itself adjacent to defenderCell) — see the fixture comment above
    // for why both the different-province placement and the fabricated edge are necessary.
    routeHubDef.kind = "capital";
    const intermediateNeighbors = graph.neighbors.get(routeIntermediateCell.id) ?? [];
    const hubNeighbors = graph.neighbors.get(routeHubDef.id) ?? [];
    graph.neighbors.set(routeIntermediateCell.id, [...intermediateNeighbors, routeHubDef.id]);
    graph.neighbors.set(routeHubDef.id, [...hubNeighbors, routeIntermediateCell.id]);
    try {
      const { room, clients } = await joinNations([ATTACKER]);
      // Spawn order matters — see the comment in the first test in this suite for why the
      // still-germany-owned defender must be spawned before the attacker.
      await spawnDivision(clients[ATTACKER], room, {
        division_id: "defender",
        nation_id: DEFENDER,
        position_lng: defenderCell.lng,
        position_lat: defenderCell.lat,
      });
      await spawnDivision(clients[ATTACKER], room, {
        division_id: "attacker",
        position_lng: attackerCell.lng,
        position_lat: attackerCell.lat,
      });

      // Compute the oracle route with the exact same already-tested primitives
      // cascadeCityCapture calls internally (findSupplyRoute / makeIsFriendly /
      // getHubSubprovinceIds), using the pre-capture ownership snapshot (nothing has flipped
      // yet at this point), to determine which cells SHOULD be preserved.
      const subprovinceSystem = (room as any).subprovinceSystem;
      const isFriendlyGermany = makeIsFriendly(DEFENDER, room.state.relations);
      const hubs = subprovinceSystem.getHubSubprovinceIds(room.state, isFriendlyGermany);
      assert.ok(hubs.has(routeHubDef.id), "sanity: the fabricated hub must be recognized as a germany-friendly hub");
      const ownership = new Map<string, { ownerId: string; provinceId: string }>();
      for (const [id, sp] of room.state.subprovinces) ownership.set(id, { ownerId: sp.owner_id, provinceId: sp.province_id });
      // The generic per-division occupancy capture (SubprovinceSystem.checkCaptureAfterMovement)
      // runs earlier in the SAME tick, before combat_system's province-level capture/cascade —
      // so by the time cascadeCityCapture actually builds its ownership snapshot, attackerCell
      // has already flipped to the attacker. Mirror that here so the oracle matches reality.
      ownership.set(attackerCell.id, { ownerId: ATTACKER, provinceId: GERMANY_PROVINCE });
      const oracleRoute = findSupplyRoute(graph, ownership, hubs, defenderCell.id, DEFENDER, isFriendlyGermany, () => false, "test-oracle");
      assert.ok(
        oracleRoute.status === "open" || oracleRoute.status === "degraded",
        `sanity: a real route must exist for this test to be meaningful (got status "${oracleRoute.status}")`,
      );
      const expectedPreserved = new Set([defenderCell.id, ...oracleRoute.subprovinceIds]);
      assert.ok(expectedPreserved.size > 1, "sanity: the route must include at least one cell beyond the occupied defender cell");

      await tickRoom(room);

      assert.strictEqual(room.state.provinces.get(GERMANY_PROVINCE).owner_id, ATTACKER, "sanity: province must have flipped");
      for (const id of expectedPreserved) {
        assert.strictEqual(
          room.state.subprovinces.get(id).owner_id,
          DEFENDER,
          `route/occupied cell ${id} must remain germany-owned`,
        );
      }

      const trulyUnrelated = provinceCellIds.find((id) => !expectedPreserved.has(id));
      assert.ok(trulyUnrelated, "sanity: at least one province cell must fall outside the preserved set");
      assert.strictEqual(
        room.state.subprovinces.get(trulyUnrelated!).owner_id,
        ATTACKER,
        "a cell with no occupation and no route relevance must still flip",
      );
    } finally {
      routeHubDef.kind = routeHubOriginalKind;
      // graph.neighbors/graph.nodes are a process-wide cached singleton (loadSubprovinceGraph
      // caches by mapId), shared with every other test file that runs in the same mocha
      // process — restore the fabricated edge and kind so no other suite observes them.
      graph.neighbors.set(routeIntermediateCell.id, intermediateNeighbors);
      graph.neighbors.set(routeHubDef.id, hubNeighbors);
    }
  });

  it("does not preserve unrelated cells with no occupation and no route relevance", async () => {
    const { room, clients } = await joinNations([ATTACKER]);
    // No defender division at all this time — nothing should be preserved.
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "attacker",
      position_lng: attackerCell.lng,
      position_lat: attackerCell.lat,
    });
    await tickRoom(room);

    assert.strictEqual(room.state.provinces.get(GERMANY_PROVINCE).owner_id, ATTACKER, "sanity: province must have flipped");
    assert.strictEqual(
      room.state.subprovinces.get(unrelatedCell.id).owner_id,
      ATTACKER,
      "a cell with no occupation and no route relevance must flip to the new owner",
    );
  });

  it("preserves only occupied cells when no valid route exists", async () => {
    // The real subprovince graph has zero inter-province edges (verified by direct inspection),
    // so with no fabricated in-province hub, no route to another owned hub can ever exist here —
    // this test relies on that natural disconnection rather than manufacturing a severed edge.
    const { room, clients } = await joinNations([ATTACKER]);
    // Spawn order matters — see the comment in the first test in this suite.
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "defender",
      nation_id: DEFENDER,
      position_lng: defenderCell.lng,
      position_lat: defenderCell.lat,
    });
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "attacker",
      position_lng: attackerCell.lng,
      position_lat: attackerCell.lat,
    });
    await tickRoom(room);

    assert.strictEqual(room.state.provinces.get(GERMANY_PROVINCE).owner_id, ATTACKER, "sanity: province must have flipped");
    for (const id of provinceCellIds) {
      const expectedOwner = id === defenderCell.id ? DEFENDER : ATTACKER;
      assert.strictEqual(
        room.state.subprovinces.get(id).owner_id,
        expectedOwner,
        `cell ${id} must be ${expectedOwner === DEFENDER ? "preserved (directly occupied)" : "flipped (no route-shaped preservation)"}`,
      );
    }
  });

  it("capital cell owner_id changes only via PROVINCE_CAPTURED, never via generic occupancy", async () => {
    const { room, clients } = await joinNations([ATTACKER]);
    clients[ATTACKER].send("SET_RELATION", { nation_a: ATTACKER, nation_b: DEFENDER, stance: "war" });
    await room.waitForNextPatch();

    // Attacker stands directly inside the capital cell's polygon. Uses the province's exact
    // city_position (not capitalCell's ring centroid, which can land more than CONTEST_RADIUS_KM
    // away from city_position depending on how the capital ring got clipped during generation) so
    // Fix 1's city-proximity requirement is always satisfied once the contest below is removed.
    assert.strictEqual(
      findSubprovinceAtPoint(germanyCapitalCityPosition.lng, germanyCapitalCityPosition.lat, spatialIndex),
      capitalCell.id,
      "sanity: the capital province's city_position must resolve into the capital cell itself",
    );
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "attacker",
      position_lng: germanyCapitalCityPosition.lng,
      position_lat: germanyCapitalCityPosition.lat,
    });
    // A germany defender exactly at the province's city position contests the capture
    // (within CONTEST_RADIUS_KM), so _checkProvinceCapture must NOT flip the province this tick.
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "defender",
      nation_id: DEFENDER,
      position_lng: germanyCapitalCityPosition.lng,
      position_lat: germanyCapitalCityPosition.lat,
    });
    await tickRoom(room);

    assert.strictEqual(
      room.state.provinces.get(GERMANY_CAPITAL_PROVINCE).owner_id,
      DEFENDER,
      "sanity: contested capture must not have happened yet",
    );
    assert.strictEqual(
      room.state.subprovinces.get(capitalCell.id).owner_id,
      DEFENDER,
      "the capital cell must not flip via generic occupancy while merely standing inside it",
    );

    // Remove the contesting defender so the province becomes uncontested.
    room.state.divisions.delete("defender");
    await tickRoom(room);

    assert.strictEqual(
      room.state.provinces.get(GERMANY_CAPITAL_PROVINCE).owner_id,
      ATTACKER,
      "province must now have been captured",
    );
    assert.strictEqual(
      room.state.subprovinces.get(capitalCell.id).owner_id,
      ATTACKER,
      "the capital cell must flip in the same tick the province is captured, via the cascade",
    );
  });

  it("emits one SUBPROVINCE_CAPTURED event per actually-flipped cell, none for preserved cells", async () => {
    const { room, clients } = await joinNations([ATTACKER]);
    // SUBPROVINCE_CAPTURED (including the cascade's own events) is filtered to belligerent
    // nations only — declare war so the attacker actually receives them (attackerCell and
    // defenderCell are far enough apart in this fixture province that this does not put either
    // division in engagement range of the other).
    clients[ATTACKER].send("SET_RELATION", { nation_a: ATTACKER, nation_b: DEFENDER, stance: "war" });
    await room.waitForNextPatch();

    const events: any[] = [];
    clients[ATTACKER].onMessage("SUBPROVINCE_CAPTURED", (msg: any) => events.push(msg));

    // Spawn order matters — see the comment in the first test in this suite.
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "defender",
      nation_id: DEFENDER,
      position_lng: defenderCell.lng,
      position_lat: defenderCell.lat,
    });
    await spawnDivision(clients[ATTACKER], room, {
      division_id: "attacker",
      position_lng: attackerCell.lng,
      position_lat: attackerCell.lat,
    });
    await tickRoom(room);

    assert.strictEqual(room.state.provinces.get(GERMANY_PROVINCE).owner_id, ATTACKER, "sanity: province must have flipped");

    // The attacker's own occupied cell is captured by the generic per-division occupancy path
    // (SubprovinceSystem.checkCaptureAfterMovement) *before* combat_system's province-level
    // capture/cascade runs this same tick, but with war declared it's just as belligerent an
    // event as any cascade-flipped cell, so it's still expected here — only defenderCell (the
    // preserved occupied cell) must be absent.
    const flippedCount = provinceCellIds.filter((id) => id !== defenderCell.id).length;
    assert.ok(flippedCount > 0 && flippedCount < provinceCellIds.length, "sanity: some but not all cells must flip");
    assert.strictEqual(
      events.length,
      flippedCount,
      "must receive exactly one SUBPROVINCE_CAPTURED event per actually-flipped cell, none for the preserved occupied cell",
    );
    const ids = events.map((e) => e.subprovince_id);
    assert.ok(!ids.includes(defenderCell.id), "the preserved occupied cell must never appear in a SUBPROVINCE_CAPTURED event");
    assert.strictEqual(new Set(ids).size, ids.length, "each flipped cell must be reported exactly once");
  });
});
