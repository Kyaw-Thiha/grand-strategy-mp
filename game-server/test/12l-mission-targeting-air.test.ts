import assert from "assert";
import { describe, it } from "mocha";
import {
  scoreCandidate,
  buildClaimsRegistry,
  visibleEnemyWingsOfTypes,
  anyVisibleEnemyWing,
  resolveInterceptionTargets,
  resolveAirSuperiorityTargets,
} from "../src/systems/air_mission_targeting.js";
import { GameRoomState, RelationState, ProvinceState } from "../src/rooms/schema/GameRoomState.js";
import { AirWingState, MISSION_TYPES } from "../src/rooms/schema/AirWingState.js";

function setRelation(state: GameRoomState, a: string, b: string, stance: string): void {
  const rel = new RelationState();
  rel.from_id = a;
  rel.to_id = b;
  rel.stance = stance;
  state.relations.set(`${a}|${b}`, rel);
}

function makeWing(id: string, nationId: string, lng: number, lat: number, aircraftType: string): AirWingState {
  const w = new AirWingState();
  w.wing_id = id;
  w.nation_id = nationId;
  w.aircraft_type = aircraftType;
  w.position_lng = lng;
  w.position_lat = lat;
  w.home_airbase_province_id = "home_prov";
  return w;
}

/** Detection stub that reports every wing as detected by every nation. */
const ALL_DETECTED = { getWingDetectedByNations: (_wingId: string) => new Set(["us", "de", "fr"]) };
const NONE_DETECTED = { getWingDetectedByNations: (_wingId: string) => new Set<string>() };

function makeResolvePosition(positions: Record<string, { lng: number; lat: number }>) {
  return (id: string): { lng: number; lat: number } | null => positions[id] ?? null;
}

describe("lane:air-combat | Shared crowd-balance and scoring", () => {
  it("closer candidates score higher than farther ones at equal claim count", () => {
    const near = scoreCandidate(0.1, 0);
    const far  = scoreCandidate(2.0, 0);
    assert.ok(near > far);
  });

  it("a candidate with more existing claims scores lower than an equally-distant less-claimed one", () => {
    const uncrowded = scoreCandidate(1.0, 0);
    const crowded   = scoreCandidate(1.0, 3);
    assert.ok(uncrowded > crowded);
  });

  it("buildClaimsRegistry counts wings by mission+target_id, keyed by target_id", () => {
    const state = new GameRoomState();
    const w1 = new AirWingState(); w1.wing_id = "w1"; w1.mission = MISSION_TYPES.TACTICAL_BOMBING; w1.target_id = "div_1";
    const w2 = new AirWingState(); w2.wing_id = "w2"; w2.mission = MISSION_TYPES.TACTICAL_BOMBING; w2.target_id = "div_1";
    const w3 = new AirWingState(); w3.wing_id = "w3"; w3.mission = MISSION_TYPES.TACTICAL_BOMBING; w3.target_id = "div_2";
    state.air_wings.set("w1", w1); state.air_wings.set("w2", w2); state.air_wings.set("w3", w3);
    const claims = buildClaimsRegistry(state);
    assert.strictEqual(claims.get("div_1"), 2);
    assert.strictEqual(claims.get("div_2"), 1);
    assert.strictEqual(claims.get("nonexistent") ?? 0, 0);
  });
});

describe("lane:air-combat | visibleEnemyWingsOfTypes / anyVisibleEnemyWing", () => {
  it("only returns hostile, type-matching, detected wings", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const bomber = makeWing("de_bomber", "de", 1, 0, "tactical_bomber");
    const fighter = makeWing("de_fighter", "de", 1, 0, "fighter");
    const neutral = makeWing("fr_bomber", "fr", 1, 0, "tactical_bomber"); // not hostile (neutral)
    state.air_wings.set("de_bomber", bomber);
    state.air_wings.set("de_fighter", fighter);
    state.air_wings.set("fr_bomber", neutral);

    const result = visibleEnemyWingsOfTypes("us", new Set(["tactical_bomber", "strategic_bomber"]), state, ALL_DETECTED);
    assert.deepStrictEqual(result.map(w => w.wing_id), ["de_bomber"]);
  });

  it("excludes wings not detected by the viewer", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    state.air_wings.set("de_bomber", makeWing("de_bomber", "de", 1, 0, "tactical_bomber"));
    const result = visibleEnemyWingsOfTypes("us", new Set(["tactical_bomber"]), state, NONE_DETECTED);
    assert.deepStrictEqual(result, []);
  });

  it("anyVisibleEnemyWing ignores aircraft type entirely", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    state.air_wings.set("de_recon", makeWing("de_recon", "de", 1, 0, "recon_plane"));
    const result = anyVisibleEnemyWing("us", state, ALL_DETECTED);
    assert.deepStrictEqual(result.map(w => w.wing_id), ["de_recon"]);
  });
});

describe("lane:air-combat | Interception tier chain", () => {
  it("tier 1 prioritizes bombers over fighters and low-alt bombers", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("interceptor", "us", 0, 0, "fighter");
    state.air_wings.set("interceptor", wing);
    state.air_wings.set("de_bomber", makeWing("de_bomber", "de", 1, 0, "strategic_bomber"));
    state.air_wings.set("de_fighter", makeWing("de_fighter", "de", 0.5, 0, "fighter"));

    const result = resolveInterceptionTargets(wing, state, new Map(), ALL_DETECTED, new Map(), makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 1, targetId: "de_bomber" });
  });

  it("tier 2 targets low-altitude bombers when no strategic/tactical bomber is visible", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("interceptor", "us", 0, 0, "fighter");
    state.air_wings.set("interceptor", wing);
    state.air_wings.set("de_cas", makeWing("de_cas", "de", 1, 0, "cas_plane"));
    state.air_wings.set("de_fighter", makeWing("de_fighter", "de", 0.5, 0, "fighter"));

    const result = resolveInterceptionTargets(wing, state, new Map(), ALL_DETECTED, new Map(), makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 2, targetId: "de_cas" });
  });

  it("tier 3 engages any visible enemy wing when no bomber type is present", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("interceptor", "us", 0, 0, "fighter");
    state.air_wings.set("interceptor", wing);
    state.air_wings.set("de_fighter", makeWing("de_fighter", "de", 0.5, 0, "fighter"));

    const result = resolveInterceptionTargets(wing, state, new Map(), ALL_DETECTED, new Map(), makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 3, targetId: "de_fighter" });
  });

  it("falls back to patrol tiers (>=4) when no enemy wing is visible at all", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("interceptor", "us", 0, 0, "fighter");
    state.air_wings.set("interceptor", wing);

    const p1 = new ProvinceState(); p1.province_id = "p1"; p1.owner_id = "us";
    state.provinces.set("p1", p1);
    const resolvePosition = makeResolvePosition({ p1: { lng: 0, lat: 0 }, home_prov: { lng: 0, lat: 0 } });

    const result = resolveInterceptionTargets(wing, state, new Map(), ALL_DETECTED, new Map(), resolvePosition);
    assert.ok(result !== null && result.tier >= 4, `expected a patrol-fallback tier, got ${JSON.stringify(result)}`);
    assert.strictEqual(result!.targetId, "p1");
  });
});

describe("lane:air-combat | Air Superiority tier chain", () => {
  it("tier 1 prioritizes fighters over low-alt and heavy bombers (reversed from Interception)", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("as_wing", "us", 0, 0, "fighter");
    state.air_wings.set("as_wing", wing);
    state.air_wings.set("de_fighter", makeWing("de_fighter", "de", 1, 0, "fighter"));
    state.air_wings.set("de_bomber", makeWing("de_bomber", "de", 0.5, 0, "strategic_bomber"));

    const result = resolveAirSuperiorityTargets(wing, state, new Map(), ALL_DETECTED, new Map(), makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 1, targetId: "de_fighter" });
  });

  it("tier 2 targets low-alt bombers when no enemy fighter is visible", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("as_wing", "us", 0, 0, "fighter");
    state.air_wings.set("as_wing", wing);
    state.air_wings.set("de_cas", makeWing("de_cas", "de", 1, 0, "dive_bomber"));
    state.air_wings.set("de_bomber", makeWing("de_bomber", "de", 0.5, 0, "tactical_bomber"));

    const result = resolveAirSuperiorityTargets(wing, state, new Map(), ALL_DETECTED, new Map(), makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 2, targetId: "de_cas" });
  });

  it("tier 3 targets strategic/tactical bombers when no fighter or low-alt bomber is visible", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("as_wing", "us", 0, 0, "fighter");
    state.air_wings.set("as_wing", wing);
    state.air_wings.set("de_bomber", makeWing("de_bomber", "de", 0.5, 0, "tactical_bomber"));

    const result = resolveAirSuperiorityTargets(wing, state, new Map(), ALL_DETECTED, new Map(), makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 3, targetId: "de_bomber" });
  });
});
