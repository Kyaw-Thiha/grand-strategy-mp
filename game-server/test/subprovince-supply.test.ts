import { describe, it, before } from "mocha";
import assert from "assert";
import { SupplySystem } from "../src/systems/supply_system.js";
import { SubprovinceSystem, makeIsFriendly } from "../src/systems/subprovince_system.js";
import { GameRoomState, ProvinceState, DivisionState, RelationState } from "../src/rooms/schema/GameRoomState.js";
import { loadSubprovinceGraph, type SubprovinceDefinition } from "../src/data/map_loader.js";
import { buildSubprovinceSpatialIndex, findSubprovinceAtPoint, type SubprovincePIPEntry } from "../src/data/subprovince_loader.js";

const MAP_ID = "western_europe_6";
const GERMANY_PROVINCE = "we6_germany_01";

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

describe("lane:subprovince | supply system integration", () => {
  let germanyCell: { id: string; lng: number; lat: number };

  before(() => {
    const graph = loadSubprovinceGraph(MAP_ID);
    const spatialIndex = buildSubprovinceSpatialIndex(graph);
    const hinterlandDefs = [...graph.nodes.values()].filter(
      (d) => d.provinceId === GERMANY_PROVINCE && d.kind === "hinterland",
    );
    germanyCell = pickVerifiedHinterlandCell(spatialIndex, hinterlandDefs);
  });

  it("computes one SupplyRoute per living division", () => {
    const subSys = new SubprovinceSystem();
    subSys.loadForRoom(MAP_ID);
    const state = new GameRoomState();
    const province = new ProvinceState();
    province.province_id = GERMANY_PROVINCE;
    province.owner_id = "germany";
    state.provinces.set(GERMANY_PROVINCE, province);
    subSys.initializeOwnership(state);

    const division = new DivisionState();
    division.division_id = "d1";
    division.nation_id = "germany";
    division.combat_state = "idle";
    division.position_lng = germanyCell.lng;
    division.position_lat = germanyCell.lat;
    state.divisions.set("d1", division);

    const supplySys = new SupplySystem();
    const routes = supplySys.computeSubprovinceRoutes(state, subSys);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].divisionId, "d1");
  });

  it("skips destroyed divisions", () => {
    const subSys = new SubprovinceSystem();
    subSys.loadForRoom(MAP_ID);
    const state = new GameRoomState();
    const province = new ProvinceState();
    province.province_id = GERMANY_PROVINCE;
    province.owner_id = "germany";
    state.provinces.set(GERMANY_PROVINCE, province);
    subSys.initializeOwnership(state);

    const alive = new DivisionState();
    alive.division_id = "d1";
    alive.nation_id = "germany";
    alive.combat_state = "idle";
    alive.position_lng = germanyCell.lng;
    alive.position_lat = germanyCell.lat;
    state.divisions.set("d1", alive);

    const destroyed = new DivisionState();
    destroyed.division_id = "d2";
    destroyed.nation_id = "germany";
    destroyed.combat_state = "destroyed";
    destroyed.position_lng = germanyCell.lng;
    destroyed.position_lat = germanyCell.lat;
    state.divisions.set("d2", destroyed);

    const supplySys = new SupplySystem();
    const routes = supplySys.computeSubprovinceRoutes(state, subSys);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].divisionId, "d1");
  });

  it("skips divisions whose position resolves to no subprovince", () => {
    const subSys = new SubprovinceSystem();
    subSys.loadForRoom(MAP_ID);
    const state = new GameRoomState();
    const province = new ProvinceState();
    province.province_id = GERMANY_PROVINCE;
    province.owner_id = "germany";
    state.provinces.set(GERMANY_PROVINCE, province);
    subSys.initializeOwnership(state);

    const offMap = new DivisionState();
    offMap.division_id = "d1";
    offMap.nation_id = "germany";
    offMap.combat_state = "idle";
    offMap.position_lng = -999;
    offMap.position_lat = -999;
    state.divisions.set("d1", offMap);

    const supplySys = new SupplySystem();
    const routes = supplySys.computeSubprovinceRoutes(state, subSys);
    assert.equal(routes.length, 0);
  });

  describe("makeIsFriendly", () => {
    it("treats the same nation as friendly", () => {
      const state = new GameRoomState();
      const isFriendly = makeIsFriendly("germany", state.relations);
      assert.equal(isFriendly("germany"), true);
    });

    it("treats merely-neutral (not at war, not allied) nations as NOT friendly", () => {
      const state = new GameRoomState();
      const isFriendly = makeIsFriendly("germany", state.relations);
      assert.equal(isFriendly("italy"), false);
    });

    it("treats an explicitly allied nation as friendly", () => {
      const state = new GameRoomState();
      const rel = new RelationState();
      rel.from_id = "germany";
      rel.to_id = "italy";
      rel.stance = "alliance";
      state.relations.set("germany|italy", rel);
      const isFriendly = makeIsFriendly("germany", state.relations);
      assert.equal(isFriendly("italy"), true);
    });

    it("treats a nation at war as NOT friendly", () => {
      const state = new GameRoomState();
      const rel = new RelationState();
      rel.from_id = "germany";
      rel.to_id = "france";
      rel.stance = "war";
      state.relations.set("germany|france", rel);
      const isFriendly = makeIsFriendly("germany", state.relations);
      assert.equal(isFriendly("france"), false);
    });
  });
});
