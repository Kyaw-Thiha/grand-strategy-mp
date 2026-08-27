import { describe, it, before } from "mocha";
import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { SupplySystem, ring } from "../src/systems/supply_system.js";
import { SubprovinceSystem, makeIsFriendly } from "../src/systems/subprovince_system.js";
import { GameRoomState, ProvinceState, DivisionState, RelationState } from "../src/rooms/schema/GameRoomState.js";
import { loadSubprovinceGraph, type SubprovinceDefinition } from "../src/data/map_loader.js";
import { buildSubprovinceSpatialIndex, findSubprovinceAtPoint, loadSupplyHubProvinces, type SubprovincePIPEntry } from "../src/data/subprovince_loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  describe("getHubSubprovinceIds", () => {
    // Hub status is static, authored map data resolved once in loadForRoom() (Task A/C of the
    // supply-hub plan) — no longer inferred from cell kind at runtime. These tests inject
    // resolved hub ids directly into the private hubSubprovinceIds set (mirroring the technique
    // subprovince-city-cascade.test.ts already uses) to test the friendly-ownership filtering
    // logic in isolation from loadSupplyHubProvinces' real map_data.json parsing, which has its
    // own dedicated test below.
    it("includes a hub cell only when its owner passes isFriendly", () => {
      const subSys = new SubprovinceSystem();
      subSys.loadForRoom(MAP_ID);
      (subSys as any).hubSubprovinceIds.add(germanyCell.id);

      const state = new GameRoomState();
      const province = new ProvinceState();
      province.province_id = GERMANY_PROVINCE;
      province.owner_id = "germany";
      state.provinces.set(GERMANY_PROVINCE, province);
      subSys.initializeOwnership(state);
      state.subprovinces.get(germanyCell.id)!.owner_id = "germany";

      const hubsFriendly = subSys.getHubSubprovinceIds(state, (ownerId) => ownerId === "germany");
      assert.ok(hubsFriendly.has(germanyCell.id));

      const hubsNotFriendly = subSys.getHubSubprovinceIds(state, (ownerId) => ownerId === "france");
      assert.ok(!hubsNotFriendly.has(germanyCell.id));
    });

    it("never includes a cell that was not resolved as a hub, regardless of ownership", () => {
      const subSys = new SubprovinceSystem();
      subSys.loadForRoom(MAP_ID);
      // germanyCell deliberately NOT added to hubSubprovinceIds this time.

      const state = new GameRoomState();
      const province = new ProvinceState();
      province.province_id = GERMANY_PROVINCE;
      province.owner_id = "germany";
      state.provinces.set(GERMANY_PROVINCE, province);
      subSys.initializeOwnership(state);

      const hubs = subSys.getHubSubprovinceIds(state, () => true);
      assert.ok(!hubs.has(germanyCell.id));
    });
  });

  describe("loadSupplyHubProvinces", () => {
    it("returns only provinces flagged is_supply_hub, mapped to their city_position", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-hub-test-"));
      const mapId = `test_map_${path.basename(tmpDir)}`;
      const dataDir = path.join(__dirname, "..", "..", "client", "assets", "data", mapId);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, "map_data.json"), JSON.stringify({
        provinces: [
          { province_id: "p_hub", is_supply_hub: true, city_position: [1.5, 2.5] },
          { province_id: "p_not_hub", is_supply_hub: false, city_position: [3.5, 4.5] },
          { province_id: "p_no_flag", city_position: [5.5, 6.5] },
        ],
      }));
      try {
        const hubs = loadSupplyHubProvinces(mapId);
        assert.equal(hubs.size, 1);
        assert.deepEqual(hubs.get("p_hub"), [1.5, 2.5]);
        assert.equal(hubs.has("p_not_hub"), false);
        assert.equal(hubs.has("p_no_flag"), false);
      } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    });
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

  describe("SupplySystem.tick — one-tier-at-a-time cascade", () => {
    it("steps through out_of_supply and cut_off before reaching encircled, never jumping directly from normal", () => {
      const subSys = new SubprovinceSystem();
      subSys.loadForRoom(MAP_ID);
      const graph = subSys.getGraph();

      const state = new GameRoomState();
      const province = new ProvinceState();
      province.province_id = GERMANY_PROVINCE;
      province.owner_id = "germany";
      state.provinces.set(GERMANY_PROVINCE, province);
      subSys.initializeOwnership(state);

      // Force ring(1) and ring(2) around germanyCell to be entirely non-friendly (regardless of
      // real map province boundaries), and leave no reachable hub — this makes the *computed*
      // tier "encircled" on the very first recalculation, so the only thing that can produce
      // out_of_supply/cut_off along the way is tick()'s pre-existing one-tier-per-recalculation
      // cascade in supply_system.ts, not any property of this fixture.
      for (const id of [...ring(graph, germanyCell.id, 1), ...ring(graph, germanyCell.id, 2)]) {
        const sp = state.subprovinces.get(id);
        if (sp) sp.owner_id = "france";
      }

      const division = new DivisionState();
      division.division_id = "d1";
      division.nation_id = "germany";
      division.combat_state = "idle";
      division.position_lng = germanyCell.lng;
      division.position_lat = germanyCell.lat;
      state.divisions.set("d1", division);

      const supplySys = new SupplySystem();
      const noopBroadcast = () => {};

      assert.equal(division.supply_status, "normal");

      supplySys.tick(state, 5, noopBroadcast, subSys);
      assert.equal(division.supply_status, "out_of_supply");

      supplySys.tick(state, 10, noopBroadcast, subSys);
      assert.equal(division.supply_status, "cut_off");

      supplySys.tick(state, 15, noopBroadcast, subSys);
      assert.equal(division.supply_status, "encircled");

      // Further recalculation ticks must not escalate past encircled — it's the terminal tier.
      supplySys.tick(state, 20, noopBroadcast, subSys);
      assert.equal(division.supply_status, "encircled");
    });
  });
});
