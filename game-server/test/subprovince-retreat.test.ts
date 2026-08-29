import assert from "assert";
import { describe, it, before } from "mocha";
import { SubprovinceSystem, makeIsFriendly } from "../src/systems/subprovince_system.js";
import { MovementSystem } from "../src/systems/movement_system.js";
import { CombatSystem } from "../src/systems/combat_system.js";
import { ring } from "../src/systems/supply_system.js";
import { findRetreatPath } from "../src/systems/supply_graph.js";
import { GameRoomState, ProvinceState, DivisionState, SubprovinceState } from "../src/rooms/schema/GameRoomState.js";
import { loadSubprovinceGraph, type SubprovinceDefinition, type SubprovinceGraph } from "../src/data/map_loader.js";
import { buildSubprovinceSpatialIndex, findSubprovinceAtPoint, type SubprovincePIPEntry } from "../src/data/subprovince_loader.js";

// Batch 8 Task 3 — retreat trigger and fighting-withdrawal damage.
//
// These tests exercise MovementSystem.computeRetreatTarget and CombatSystem's
// _initiateRetreat/​_checkAutoRetreatOrRotate wiring directly against real subprovince-graph
// systems (no full Colyseus room boot needed), mirroring test/subprovince-supply.test.ts's
// style: `new SubprovinceSystem(); subSys.loadForRoom(MAP_ID);` plus a hand-built GameRoomState.

const MAP_ID = "western_europe_6";
const GERMANY_PROVINCE = "we6_germany_01";

// Same fighting-withdrawal constants as combat_system.ts (not exported — kept in sync manually,
// same tradeoff test/subprovince-supply.test.ts already accepts for supply_system.ts's tuning
// constants). If combat_system.ts's values change, this file's expectations must be updated too.
const FIGHTING_WITHDRAWAL_MAX_DAMAGE = 15;
const RETREAT_SPEED_PENALTY_MULT = 0.5;

/** Centroid of a subprovince's outer ring, excluding a duplicated closing vertex if present. */
function centroidOf(def: SubprovinceDefinition): { lng: number; lat: number } {
  const r = def.polygon[0];
  const first = r[0];
  const last = r[r.length - 1];
  const pts = (first[0] === last[0] && first[1] === last[1]) ? r.slice(0, -1) : r;
  let lng = 0, lat = 0;
  for (const [x, y] of pts) { lng += x; lat += y; }
  return { lng: lng / pts.length, lat: lat / pts.length };
}

function distKm(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  return Math.sqrt((a.lng - b.lng) ** 2 + (a.lat - b.lat) ** 2) * 111.0;
}

/** Picks a hinterland cell in GERMANY_PROVINCE whose centroid ray-casts back to itself. */
function pickVerifiedHinterlandCell(
  spatialIndex: SubprovincePIPEntry[],
  defs: SubprovinceDefinition[],
): { id: string; lng: number; lat: number } {
  for (const def of defs) {
    const c = centroidOf(def);
    if (findSubprovinceAtPoint(c.lng, c.lat, spatialIndex) === def.id) {
      return { id: def.id, lng: c.lng, lat: c.lat };
    }
  }
  throw new Error(`no centroid-verified hinterland cell found for ${GERMANY_PROVINCE}`);
}

/** A minimal, valid closed-free square ring around (lng, lat) for synthetic fixture nodes. */
function squareRing(lng: number, lat: number): Array<[number, number]> {
  return [[lng, lat], [lng + 0.01, lat], [lng + 0.01, lat + 0.01], [lng, lat + 0.01]];
}

const noopBroadcast = () => {};

describe("lane:subprovince | retreat trigger and fighting-withdrawal damage", () => {
  let germanyCell: { id: string; lng: number; lat: number };
  let movementSystem: MovementSystem;

  before(() => {
    const graph = loadSubprovinceGraph(MAP_ID);
    const spatialIndex = buildSubprovinceSpatialIndex(graph);
    // Pinned to a specific real cell (verified via a one-off probe script, same convention as
    // subprovince-system-unit.test.ts's ALBANIA_CELL_*/AUSTRIA_CAPITAL_CELL), rather than "first
    // centroid-verified hinterland cell in iteration order": with distance+terrain-weighted
    // retreat costs (supply_graph.ts), an arbitrary hinterland cell can be surrounded by harsh
    // terrain (e.g. dense_forest_mountains, impassable for the terrain-cost profile retreat
    // pathing uses) with no fully-friendly off-road detour at all, or have a neighbor topology
    // that doesn't match the "exactly two ring(1) neighbors" fixture below — this specific cell
    // is plains/flat with exactly two ring(1) neighbors, confirmed via the probe script to work
    // for every test in this file.
    const GERMANY_FIXTURE_CELL_ID = "we6_germany_01_sp_127";
    const hinterlandDefs = [...graph.nodes.values()].filter(
      (d) => d.id === GERMANY_FIXTURE_CELL_ID,
    );
    germanyCell = pickVerifiedHinterlandCell(spatialIndex, hinterlandDefs);

    movementSystem = new MovementSystem();
    movementSystem.loadWaypoints(MAP_ID);
  });

  /** Fresh SubprovinceSystem + CombatSystem + GameRoomState, germany owning GERMANY_PROVINCE. */
  function freshSystems(): { subSys: SubprovinceSystem; combatSystem: CombatSystem; state: GameRoomState } {
    const subSys = new SubprovinceSystem();
    subSys.loadForRoom(MAP_ID);
    const combatSystem = new CombatSystem(movementSystem);
    combatSystem.setSubprovinceSystem(subSys, () => {});

    const state = new GameRoomState();
    const province = new ProvinceState();
    province.province_id = GERMANY_PROVINCE;
    province.owner_id = "germany";
    state.provinces.set(GERMANY_PROVINCE, province);
    subSys.initializeOwnership(state);

    return { subSys, combatSystem, state };
  }

  function spawnDivision(
    state: GameRoomState,
    id: string,
    nation: string,
    lng: number,
    lat: number,
    opts: { hp?: number; supply_status?: string; combat_state?: string; suppression?: number } = {},
  ): DivisionState {
    const div = new DivisionState();
    div.division_id = id;
    div.nation_id = nation;
    div.position_lng = lng;
    div.position_lat = lat;
    div.hp = opts.hp ?? 100;
    div.supply_status = opts.supply_status ?? "normal";
    div.combat_state = opts.combat_state ?? "idle";
    div.suppression = opts.suppression ?? 0;
    state.divisions.set(id, div);
    return div;
  }

  describe("clean retreat — normal / out_of_supply", () => {
    for (const tier of ["normal", "out_of_supply"]) {
      it(`takes no HP damage and leaves retreat_speed_mult at 1 (supply_status="${tier}")`, () => {
        const { combatSystem, state } = freshSystems();
        const div = spawnDivision(state, "d1", "germany", germanyCell.lng, germanyCell.lat, { hp: 80, supply_status: tier });
        const enemy = spawnDivision(state, "e1", "france", germanyCell.lng + 1, germanyCell.lat + 1);

        const changed = new Set<string>();
        combatSystem.initiateRetreat(div, [enemy], state, changed, noopBroadcast);

        assert.equal(div.hp, 80, "clean retreat must not damage HP");
        assert.equal(div.retreat_speed_mult, 1, "clean retreat must not apply a speed penalty");
        assert.equal(div.combat_state, "retreating");
        assert.ok(div.move_order.length > 0, "a retreat target waypoint must be set");
      });
    }
  });

  describe("fighting withdrawal — cut_off", () => {
    it("applies HP damage and a speed penalty proportional to a known blockedFraction (0.5)", () => {
      const { subSys, combatSystem, state } = freshSystems();

      // Inject a synthetic 3-hop chain graph (start -> midA(friendly) -> midB(enemy) ->
      // target(friendly road)) so the retreat path's blockedFraction is deterministically 0.5
      // (1 blocked hop out of 2 counted hops) — same private-field-injection technique
      // test/subprovince-supply.test.ts already uses (`(subSys as any).hubSubprovinceIds`), and
      // the same synthetic-minimal-graph approach Task 2's own findRetreatPath tests use in
      // supply-graph.test.ts, here combined with a real, spatially-resolvable start cell so the
      // full MovementSystem/CombatSystem wiring (not just findRetreatPath in isolation) is
      // exercised end-to-end.
      const synthGraph: SubprovinceGraph = {
        nodes: new Map<string, SubprovinceDefinition>([
          [germanyCell.id, {
            id: germanyCell.id, provinceId: GERMANY_PROVINCE, kind: "hinterland",
            coverCombat: null, elevationType: null, isCapital: false,
            polygon: [squareRing(germanyCell.lng, germanyCell.lat)],
          }],
          ["synth_midA", {
            id: "synth_midA", provinceId: GERMANY_PROVINCE, kind: "hinterland",
            coverCombat: null, elevationType: null, isCapital: false,
            polygon: [squareRing(germanyCell.lng + 0.1, germanyCell.lat)],
          }],
          ["synth_midB", {
            id: "synth_midB", provinceId: GERMANY_PROVINCE, kind: "hinterland",
            coverCombat: null, elevationType: null, isCapital: false,
            polygon: [squareRing(germanyCell.lng + 0.2, germanyCell.lat)],
          }],
          ["synth_target", {
            id: "synth_target", provinceId: GERMANY_PROVINCE, kind: "road",
            coverCombat: null, elevationType: null, isCapital: false,
            polygon: [squareRing(germanyCell.lng + 0.3, germanyCell.lat)],
          }],
        ]),
        neighbors: new Map<string, string[]>([
          [germanyCell.id, ["synth_midA"]],
          ["synth_midA", [germanyCell.id, "synth_midB"]],
          ["synth_midB", ["synth_midA", "synth_target"]],
          ["synth_target", ["synth_midB"]],
        ]),
      };
      (subSys as any).graph = synthGraph;

      const midA = new SubprovinceState();
      midA.province_id = GERMANY_PROVINCE; midA.owner_id = "germany";
      state.subprovinces.set("synth_midA", midA);
      const midB = new SubprovinceState();
      midB.province_id = GERMANY_PROVINCE; midB.owner_id = "france"; // the one blocked hop
      state.subprovinces.set("synth_midB", midB);
      const target = new SubprovinceState();
      target.province_id = GERMANY_PROVINCE; target.owner_id = "germany";
      state.subprovinces.set("synth_target", target);

      // Sanity-check the fixture actually produces blockedFraction 0.5 via findRetreatPath
      // directly, independent of the CombatSystem/MovementSystem wiring under test below.
      const isFriendly = makeIsFriendly("germany", state.relations);
      const hubs = subSys.getHubSubprovinceIds(state, isFriendly);
      const ownership = new Map<string, { ownerId: string; provinceId: string }>();
      for (const [id, sp] of state.subprovinces) ownership.set(id, { ownerId: sp.owner_id, provinceId: sp.province_id });
      const directPath = findRetreatPath(synthGraph, ownership, hubs, germanyCell.id, "germany", isFriendly, () => false);
      assert.equal(directPath.blockedFraction, 0.5, "fixture sanity check");
      assert.deepEqual(directPath.subprovinceIds, [germanyCell.id, "synth_midA", "synth_midB", "synth_target"]);

      const div = spawnDivision(state, "d1", "germany", germanyCell.lng, germanyCell.lat, { hp: 100, supply_status: "cut_off" });
      const enemy = spawnDivision(state, "e1", "france", germanyCell.lng + 1, germanyCell.lat + 1);

      const changed = new Set<string>();
      combatSystem.initiateRetreat(div, [enemy], state, changed, noopBroadcast);

      const expectedHp = 100 - FIGHTING_WITHDRAWAL_MAX_DAMAGE * 0.5;
      assert.equal(div.hp, expectedHp, "fighting-withdrawal damage must be proportional to blockedFraction");
      assert.equal(div.retreat_speed_mult, RETREAT_SPEED_PENALTY_MULT);
      assert.equal(div.combat_state, "retreating");
    });

    it("applies full FIGHTING_WITHDRAWAL_MAX_DAMAGE when the retreat path is entirely non-friendly (blockedFraction 1)", () => {
      const { subSys, combatSystem, state } = freshSystems();
      const graph = subSys.getGraph();

      // Flip BOTH ring(1) cells around germanyCell to enemy ownership. Every path out must then
      // cross at least one of them; the resulting retreat path's single counted hop is always
      // non-friendly, so blockedFraction is deterministically 1 regardless of which of the two
      // the search picks.
      for (const id of ring(graph, germanyCell.id, 1)) {
        const sp = state.subprovinces.get(id);
        if (sp) sp.owner_id = "france";
      }

      const div = spawnDivision(state, "d1", "germany", germanyCell.lng, germanyCell.lat, { hp: 100, supply_status: "cut_off" });
      const enemy = spawnDivision(state, "e1", "france", germanyCell.lng + 1, germanyCell.lat + 1);

      const changed = new Set<string>();
      combatSystem.initiateRetreat(div, [enemy], state, changed, noopBroadcast);

      assert.equal(div.hp, 100 - FIGHTING_WITHDRAWAL_MAX_DAMAGE * 1);
      assert.equal(div.retreat_speed_mult, RETREAT_SPEED_PENALTY_MULT);
    });
  });

  describe("encircled — retreat stays blocked (pre-existing gate)", () => {
    it("_checkAutoRetreatOrRotate never initiates retreat for an encircled division, even past the suppression threshold", () => {
      const { combatSystem, state } = freshSystems();
      const div = spawnDivision(state, "d1", "germany", germanyCell.lng, germanyCell.lat, {
        hp: 100, supply_status: "encircled", combat_state: "engaged", suppression: 100,
      });
      const enemy = spawnDivision(state, "e1", "france", germanyCell.lng + 1, germanyCell.lat + 1);

      const changed = new Set<string>();
      // Directly exercises the private gate (threshold=1 guarantees it's crossed) — this batch
      // does not implement or modify this guard, only confirms it keeps firing correctly now
      // that real (Task 1) supply tier data flows into div.supply_status.
      (combatSystem as any)._checkAutoRetreatOrRotate(div, 1, [enemy], state, changed, noopBroadcast);

      assert.equal(div.combat_state, "engaged", "encircled division must not transition toward retreat at all");
      assert.equal(div.move_order.length, 0);
      assert.equal(div.hp, 100);
      assert.equal(div.retreat_speed_mult, 1);
    });

    it("the manual RETREAT command path (public initiateRetreat) also refuses an encircled division", () => {
      // Fix for a gap this batch's earlier planning flagged: _checkAutoRetreatOrRotate already
      // blocked auto-retreat for encircled divisions, but GameRoom.handleRetreat calls the public
      // CombatSystem.initiateRetreat() directly and had no equivalent guard, so a manually-issued
      // RETREAT command could let an encircled division escape when auto-retreat couldn't.
      const { combatSystem, state } = freshSystems();
      const div = spawnDivision(state, "d1", "germany", germanyCell.lng, germanyCell.lat, {
        hp: 100, supply_status: "encircled", combat_state: "engaged", suppression: 100,
      });
      const enemy = spawnDivision(state, "e1", "france", germanyCell.lng + 1, germanyCell.lat + 1);

      const changed = new Set<string>();
      combatSystem.initiateRetreat(div, [enemy], state, changed, noopBroadcast);

      assert.equal(div.combat_state, "engaged", "manual retreat must not move an encircled division toward retreating");
      assert.equal(div.move_order.length, 0);
      assert.equal(div.hp, 100);
      assert.equal(div.retreat_speed_mult, 1);
    });
  });

  describe("retreat targets ownership-aware ground, not pure nearest-distance", () => {
    it("routes around a nearer enemy-owned road cell to a farther friendly one", () => {
      const { subSys, state: baselineState } = freshSystems();
      const graph = subSys.getGraph();

      const isFriendlyBaseline = makeIsFriendly("germany", baselineState.relations);
      const hubsBaseline = subSys.getHubSubprovinceIds(baselineState, isFriendlyBaseline);
      const ownershipBaseline = new Map<string, { ownerId: string; provinceId: string }>();
      for (const [id, sp] of baselineState.subprovinces) ownershipBaseline.set(id, { ownerId: sp.owner_id, provinceId: sp.province_id });

      const baselinePath = findRetreatPath(graph, ownershipBaseline, hubsBaseline, germanyCell.id, "germany", isFriendlyBaseline, () => false);
      // Sanity check: with everything friendly, the actual cheapest retreat destination is a road
      // cell — derived from the real cost-based pathfinder itself (not a naive "first ring(1) road
      // cell found" guess, which only coincidentally matched the real algorithm before the
      // subprovince-adjacency cross-province-edge fix; a richer, more complete graph can have
      // multiple ring(1) road candidates, so "first found" and "actually cheapest" are no longer
      // guaranteed to agree, nor should they be).
      const nearRoadId = baselinePath.subprovinceIds[baselinePath.subprovinceIds.length - 1];
      assert.equal(graph.nodes.get(nearRoadId)?.kind, "road",
        "fixture requires the baseline retreat destination to be a road cell");

      // Now flip that nearest road cell to enemy ownership and re-run.
      const { subSys: subSys2, combatSystem: combatSystem2, state } = freshSystems();
      state.subprovinces.get(nearRoadId as string)!.owner_id = "france";

      const isFriendly = makeIsFriendly("germany", state.relations);
      const hubs = subSys2.getHubSubprovinceIds(state, isFriendly);
      const ownership = new Map<string, { ownerId: string; provinceId: string }>();
      for (const [id, sp] of state.subprovinces) ownership.set(id, { ownerId: sp.owner_id, provinceId: sp.province_id });
      const afterFlipPath = findRetreatPath(subSys2.getGraph(), ownership, hubs, germanyCell.id, "germany", isFriendly, () => false);
      const chosenId = afterFlipPath.subprovinceIds[afterFlipPath.subprovinceIds.length - 1];

      assert.notEqual(chosenId, nearRoadId, "must not retreat onto the now-enemy-owned cell");
      assert.equal(afterFlipPath.blockedFraction, 0, "the chosen alternate route must be fully friendly");

      const nearRoadDef = subSys2.getGraph().nodes.get(nearRoadId as string)!;
      const chosenDef = subSys2.getGraph().nodes.get(chosenId)!;
      const distToNearRoad = distKm(germanyCell, centroidOf(nearRoadDef));
      const distToChosen = distKm(germanyCell, centroidOf(chosenDef));
      assert.ok(
        distToChosen > distToNearRoad,
        `expected the ownership-aware target (${distToChosen.toFixed(1)}km) to be farther than the ` +
        `bypassed nearer enemy cell (${distToNearRoad.toFixed(1)}km) — this is the actual behavior ` +
        `change from pure nearest-distance to cost-aware graph routing`,
      );

      // Full pipeline check: CombatSystem.initiateRetreat -> MovementSystem.computeRetreatTarget
      // must land the division's move_order on the waypoint nearest the chosen (farther,
      // friendly) cell, not the waypoint nearest the bypassed (nearer, enemy) one.
      const div = spawnDivision(state, "d1", "germany", germanyCell.lng, germanyCell.lat);
      const enemy = spawnDivision(state, "e1", "france", germanyCell.lng + 1, germanyCell.lat + 1);
      const changed = new Set<string>();
      combatSystem2.initiateRetreat(div, [enemy], state, changed, noopBroadcast);

      const expectedWaypoint = movementSystem.getNearestWaypoint(centroidOf(chosenDef).lng, centroidOf(chosenDef).lat);
      const nearRoadWaypoint = movementSystem.getNearestWaypoint(centroidOf(nearRoadDef).lng, centroidOf(nearRoadDef).lat);
      assert.ok(expectedWaypoint);
      assert.equal(div.move_order[0], expectedWaypoint!.id);
      // Only meaningful if the two candidate cells resolve to different waypoints in the first
      // place (true for this fixture — germanyCell's real map neighbors are geometrically apart).
      if (nearRoadWaypoint && nearRoadWaypoint.id !== expectedWaypoint!.id) {
        assert.notEqual(div.move_order[0], nearRoadWaypoint.id);
      }
    });
  });
});
