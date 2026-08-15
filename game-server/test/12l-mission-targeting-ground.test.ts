import assert from "assert";
import { describe, it } from "mocha";
import {
  resolveTacticalBombingTargets,
  resolveStrategicBombingTargets,
} from "../src/systems/air_mission_targeting.js";
import {
  GameRoomState,
  DivisionState,
  ProvinceState,
  RelationState,
} from "../src/rooms/schema/GameRoomState.js";
import { AirWingState } from "../src/rooms/schema/AirWingState.js";

function setRelation(state: GameRoomState, a: string, b: string, stance: string): void {
  const rel = new RelationState();
  rel.from_id = a;
  rel.to_id = b;
  rel.stance = stance;
  state.relations.set(`${a}|${b}`, rel);
}

function makeWing(id: string, nationId: string, lng: number, lat: number): AirWingState {
  const w = new AirWingState();
  w.wing_id = id;
  w.nation_id = nationId;
  w.position_lng = lng;
  w.position_lat = lat;
  w.home_airbase_province_id = "home_prov";
  return w;
}

function makeDivision(id: string, nationId: string, lng: number, lat: number): DivisionState {
  const d = new DivisionState();
  d.division_id = id;
  d.nation_id = nationId;
  d.position_lng = lng;
  d.position_lat = lat;
  return d;
}

function makeProvince(id: string, ownerId: string): ProvinceState {
  const p = new ProvinceState();
  p.province_id = id;
  p.owner_id = ownerId;
  return p;
}

/** Simple resolvePosition stub: provinces at fixed coords by id, divisions/wings ignored. */
function makeResolvePosition(positions: Record<string, { lng: number; lat: number }>) {
  return (id: string): { lng: number; lat: number } | null => positions[id] ?? null;
}

describe("lane:air-combat | Tactical Bombing tier chain", () => {
  it("tier 1 targets the nearest visible enemy division", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("w1", "us", 0, 0);
    state.air_wings.set("w1", wing);

    const near = makeDivision("d_near", "de", 1, 0);
    const far = makeDivision("d_far", "de", 5, 0);
    state.divisions.set("d_near", near);
    state.divisions.set("d_far", far);

    const detection = { getVisibleDivisionsForNation: (_n: string) => new Set(["d_near", "d_far"]) };
    const claims = new Map<string, number>();
    const result = resolveTacticalBombingTargets(wing, state, new Map(), detection, claims, makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 1, targetId: "d_near" });
  });

  it("excludes friendly divisions from the visible set even if present", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("w1", "us", 0, 0);
    state.air_wings.set("w1", wing);

    const friendly = makeDivision("d_friendly", "us", 0.1, 0);
    state.divisions.set("d_friendly", friendly);

    const detection = { getVisibleDivisionsForNation: (_n: string) => new Set(["d_friendly"]) };
    const claims = new Map<string, number>();
    const result = resolveTacticalBombingTargets(wing, state, new Map(), detection, claims, makeResolvePosition({}));
    assert.strictEqual(result, null);
  });

  it("falls back to tier 2 patrol over war-border divisions when no enemy division is visible", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("w1", "us", 0, 0);
    state.air_wings.set("w1", wing);

    // province p1 (us) borders p2 (de, at war) -> p1 is a war-border province
    const p1 = makeProvince("p1", "us");
    const p2 = makeProvince("p2", "de");
    state.provinces.set("p1", p1);
    state.provinces.set("p2", p2);
    const provinceNeighbors = new Map<string, string[]>([["p1", ["p2"]], ["p2", ["p1"]]]);

    const patrolDiv = makeDivision("d_patrol", "us", 0.2, 0.2);
    state.divisions.set("d_patrol", patrolDiv);

    const resolvePosition = makeResolvePosition({ p1: { lng: 0, lat: 0 }, p2: { lng: 1, lat: 1 } });
    const detection = { getVisibleDivisionsForNation: (_n: string) => new Set<string>() };
    const claims = new Map<string, number>();
    const result = resolveTacticalBombingTargets(wing, state, provinceNeighbors, detection, claims, resolvePosition);
    assert.deepStrictEqual(result, { tier: 2, targetId: "d_patrol" });
  });

  it("returns null (stay at base) when nothing is found at any tier", () => {
    const state = new GameRoomState();
    const wing = makeWing("w1", "us", 0, 0);
    state.air_wings.set("w1", wing);
    const detection = { getVisibleDivisionsForNation: (_n: string) => new Set<string>() };
    const claims = new Map<string, number>();
    const result = resolveTacticalBombingTargets(wing, state, new Map(), detection, claims, makeResolvePosition({}));
    assert.strictEqual(result, null);
  });
});

describe("lane:air-combat | Strategic Bombing tier chain", () => {
  it("tier 1 targets the nearest enemy-owned province, ignoring detection", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("w1", "us", 0, 0);
    state.air_wings.set("w1", wing);

    state.provinces.set("p_near", makeProvince("p_near", "de"));
    state.provinces.set("p_far", makeProvince("p_far", "de"));
    state.provinces.set("p_own", makeProvince("p_own", "us"));
    state.provinces.set("p_neutral", makeProvince("p_neutral", "fr"));

    const resolvePosition = makeResolvePosition({
      p_near: { lng: 1, lat: 0 },
      p_far: { lng: 5, lat: 0 },
      p_own: { lng: 0, lat: 0 },
      p_neutral: { lng: 0.5, lat: 0 },
    });

    const result = resolveStrategicBombingTargets(wing, state, new Map(), resolvePosition);
    assert.deepStrictEqual(result, { tier: 1, targetId: "p_near" });
  });

  it("returns null when no hostile-owned province exists", () => {
    const state = new GameRoomState();
    const wing = makeWing("w1", "us", 0, 0);
    state.air_wings.set("w1", wing);
    state.provinces.set("p_own", makeProvince("p_own", "us"));
    state.provinces.set("p_neutral", makeProvince("p_neutral", "fr"));

    const result = resolveStrategicBombingTargets(wing, state, new Map(), makeResolvePosition({ p_own: { lng: 0, lat: 0 }, p_neutral: { lng: 1, lat: 0 } }));
    assert.strictEqual(result, null);
  });
});
