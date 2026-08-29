import { describe, it, before } from "mocha";
import assert from "assert";
import { SupplyHubConstructionSystem } from "../src/systems/supply_hub_construction_system.js";
import { SubprovinceSystem } from "../src/systems/subprovince_system.js";
import { GameRoomState, ProvinceState } from "../src/rooms/schema/GameRoomState.js";
import { loadSubprovinceGraph } from "../src/data/map_loader.js";

const MAP_ID = "western_europe_6";
const GERMANY_PROVINCE = "we6_germany_01";
const GERMANY_CAPITAL_PROVINCE = "we6_germany_06"; // a static, map-authored is_supply_hub province

const NOW = 1_000_000;

function makeProvince(provinceId: string, ownerId: string, industry = 100): ProvinceState {
  const province = new ProvinceState();
  province.province_id = provinceId;
  province.owner_id = ownerId;
  province.industry = industry;
  return province;
}

describe("lane:subprovince | player-constructible supply hubs", () => {
  // Sanity check on the fixture provinces this suite relies on — resolved once, not per-test.
  before(() => {
    const graph = loadSubprovinceGraph(MAP_ID);
    const provinceIds = new Set([...graph.nodes.values()].map((d) => d.provinceId));
    if (!provinceIds.has(GERMANY_PROVINCE)) throw new Error(`fixture province ${GERMANY_PROVINCE} not found on ${MAP_ID}`);
    if (!provinceIds.has(GERMANY_CAPITAL_PROVINCE)) throw new Error(`fixture province ${GERMANY_CAPITAL_PROVINCE} not found on ${MAP_ID}`);
  });

  function makeState(): { state: GameRoomState; subSys: SubprovinceSystem } {
    const subSys = new SubprovinceSystem();
    subSys.loadForRoom(MAP_ID);
    const state = new GameRoomState();
    return { state, subSys };
  }

  it("starts construction in an owned province with sufficient industry", () => {
    const { state, subSys } = makeState();
    const province = makeProvince(GERMANY_PROVINCE, "germany", 100);
    state.provinces.set(GERMANY_PROVINCE, province);

    const sys = new SupplyHubConstructionSystem();
    const result = sys.startConstruction("germany", GERMANY_PROVINCE, state, subSys, NOW);

    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(province.industry, 50, "cost must be deducted");
    assert.strictEqual(province.supply_hub_construction_ends_at_ms, NOW + 5 * 60_000);
    assert.strictEqual(province.has_supply_hub, false, "must not complete instantly");
  });

  it("rejects construction in a province not owned by the requesting nation", () => {
    const { state, subSys } = makeState();
    state.provinces.set(GERMANY_PROVINCE, makeProvince(GERMANY_PROVINCE, "germany"));

    const sys = new SupplyHubConstructionSystem();
    const result = sys.startConstruction("france", GERMANY_PROVINCE, state, subSys, NOW);

    assert.strictEqual(result.ok, false);
  });

  it("rejects construction in a province that already has a player-built hub", () => {
    const { state, subSys } = makeState();
    const province = makeProvince(GERMANY_PROVINCE, "germany");
    province.has_supply_hub = true;
    state.provinces.set(GERMANY_PROVINCE, province);

    const sys = new SupplyHubConstructionSystem();
    const result = sys.startConstruction("germany", GERMANY_PROVINCE, state, subSys, NOW);

    assert.strictEqual(result.ok, false);
  });

  it("rejects construction in a province already under construction", () => {
    const { state, subSys } = makeState();
    const province = makeProvince(GERMANY_PROVINCE, "germany");
    province.supply_hub_construction_ends_at_ms = NOW + 1000;
    state.provinces.set(GERMANY_PROVINCE, province);

    const sys = new SupplyHubConstructionSystem();
    const result = sys.startConstruction("germany", GERMANY_PROVINCE, state, subSys, NOW);

    assert.strictEqual(result.ok, false);
  });

  it("rejects construction in a province that is already a static map hub", () => {
    const { state, subSys } = makeState();
    state.provinces.set(GERMANY_CAPITAL_PROVINCE, makeProvince(GERMANY_CAPITAL_PROVINCE, "germany"));
    // Real map data has not been regenerated with is_supply_hub yet (Batch pipeline work not
    // yet re-run in this environment) — inject directly into the private set, mirroring the
    // technique subprovince-supply.test.ts already uses for hubSubprovinceIds, to test the
    // rejection logic in isolation from loadSupplyHubProvinces' real map_data.json parsing.
    (subSys as any).staticHubProvinceIds.add(GERMANY_CAPITAL_PROVINCE);

    const sys = new SupplyHubConstructionSystem();
    const result = sys.startConstruction("germany", GERMANY_CAPITAL_PROVINCE, state, subSys, NOW);

    assert.strictEqual(result.ok, false);
  });

  it("rejects construction when the province has insufficient industry", () => {
    const { state, subSys } = makeState();
    state.provinces.set(GERMANY_PROVINCE, makeProvince(GERMANY_PROVINCE, "germany", 10));

    const sys = new SupplyHubConstructionSystem();
    const result = sys.startConstruction("germany", GERMANY_PROVINCE, state, subSys, NOW);

    assert.strictEqual(result.ok, false);
  });

  it("tick() completes construction once nowMs reaches the end timestamp and registers the hub", () => {
    const { state, subSys } = makeState();
    const province = makeProvince(GERMANY_PROVINCE, "germany");
    state.provinces.set(GERMANY_PROVINCE, province);
    subSys.initializeOwnership(state);

    const sys = new SupplyHubConstructionSystem();
    const started = sys.startConstruction("germany", GERMANY_PROVINCE, state, subSys, NOW);
    assert.strictEqual(started.ok, true);

    const completed: string[] = [];
    sys.tick(state, NOW + 1000, (provinceId) => completed.push(provinceId));
    assert.strictEqual(completed.length, 0, "must not complete before the timer elapses");
    assert.strictEqual(province.has_supply_hub, false);

    sys.tick(state, NOW + 5 * 60_000, (provinceId) => {
      completed.push(provinceId);
      subSys.registerDynamicHub(provinceId);
    });

    assert.deepStrictEqual(completed, [GERMANY_PROVINCE]);
    assert.strictEqual(province.has_supply_hub, true);
    assert.strictEqual(province.supply_hub_construction_ends_at_ms, 0);

    // The registered hub cell must resolve back to GERMANY_PROVINCE's city.
    const hubs = subSys.getHubSubprovinceIds(state, () => true);
    const graph = loadSubprovinceGraph(MAP_ID);
    const sawGermanyProvinceHub = [...hubs].some((id) => graph.nodes.get(id)?.provinceId === GERMANY_PROVINCE);
    assert.ok(sawGermanyProvinceHub, "the newly completed hub must be recognized by getHubSubprovinceIds");
  });

  it("does not enforce any cap on the number of hubs a nation builds", () => {
    const { state, subSys } = makeState();
    const graph = loadSubprovinceGraph(MAP_ID);
    const provinceIds = [...new Set([...graph.nodes.values()].map((d) => d.provinceId))]
      .filter((id) => id !== GERMANY_CAPITAL_PROVINCE)
      .slice(0, 6);
    for (const id of provinceIds) {
      state.provinces.set(id, makeProvince(id, "germany", 100));
    }
    subSys.initializeOwnership(state);

    const sys = new SupplyHubConstructionSystem();
    for (const id of provinceIds) {
      const result = sys.startConstruction("germany", id, state, subSys, NOW);
      assert.strictEqual(result.ok, true, `construction in ${id} must succeed with no cap`);
    }

    const completed: string[] = [];
    sys.tick(state, NOW + 5 * 60_000, (provinceId) => {
      completed.push(provinceId);
      subSys.registerDynamicHub(provinceId);
    });
    assert.strictEqual(completed.length, provinceIds.length);
  });
});
