import assert from "assert";
import { describe, it } from "mocha";
import {
  resolveNavalTargets,
  resolveReconTargets,
  buildReconEscortCounts,
  buildClaimsRegistry,
  createTickCache,
  AirMissionTargetingSystem,
  setAirMissionTargetingEnabledForTesting,
} from "../src/systems/air_mission_targeting.js";
import { GameRoomState, ProvinceState, RelationState, DivisionState } from "../src/rooms/schema/GameRoomState.js";
import { NavalContactMarkerState } from "../src/rooms/schema/NavalContactMarkerState.js";
import { AirWingState, MISSION_TYPES, WING_LIFECYCLE } from "../src/rooms/schema/AirWingState.js";
import { AirWingLifecycleSystem } from "../src/systems/air_wing_lifecycle_system.js";
import { DubinsPathfinder } from "../src/systems/air_dubins_pathfinder.js";

function setRelation(state: GameRoomState, a: string, b: string, stance: string): void {
  const rel = new RelationState();
  rel.from_id = a;
  rel.to_id = b;
  rel.stance = stance;
  state.relations.set(`${a}|${b}`, rel);
}

function makeWing(
  id: string,
  nationId: string,
  lng: number,
  lat: number,
  aircraftType = "recon_plane",
): AirWingState {
  const w = new AirWingState();
  w.wing_id = id;
  w.nation_id = nationId;
  w.aircraft_type = aircraftType;
  w.position_lng = lng;
  w.position_lat = lat;
  w.home_airbase_province_id = "home_prov";
  return w;
}

function makeProvince(id: string, ownerId: string): ProvinceState {
  const p = new ProvinceState();
  p.province_id = id;
  p.owner_id = ownerId;
  return p;
}

function makeResolvePosition(positions: Record<string, { lng: number; lat: number }>) {
  return (id: string): { lng: number; lat: number } | null => positions[id] ?? null;
}

describe("lane:air-combat | Naval mission tier chain", () => {
  it("tier 1 targets the nearest own-nation naval contact marker", () => {
    const state = new GameRoomState();
    const wing = makeWing("w1", "us", 0, 0, "naval_bomber");
    state.air_wings.set("w1", wing);

    const near = new NavalContactMarkerState();
    near.marker_id = "m_near"; near.nation_id = "us"; near.position_lng = 1; near.position_lat = 0;
    const far = new NavalContactMarkerState();
    far.marker_id = "m_far"; far.nation_id = "us"; far.position_lng = 5; far.position_lat = 0;
    const other = new NavalContactMarkerState();
    other.marker_id = "m_other_nation"; other.nation_id = "de"; other.position_lng = 0.1; other.position_lat = 0;

    state.naval_contact_markers.set("m_near", near);
    state.naval_contact_markers.set("m_far", far);
    state.naval_contact_markers.set("m_other_nation", other);

    const result = resolveNavalTargets(wing, state, new Map());
    assert.deepStrictEqual(result, { tier: 1, targetId: "m_near" });
  });

  it("returns null when no markers exist for the wing's nation", () => {
    const state = new GameRoomState();
    const wing = makeWing("w1", "us", 0, 0, "naval_bomber");
    state.air_wings.set("w1", wing);
    const result = resolveNavalTargets(wing, state, new Map());
    assert.strictEqual(result, null);
  });
});

describe("lane:air-combat | buildReconEscortCounts", () => {
  it("counts only RECON-mission wings by target_id, ignoring other missions targeting the same id", () => {
    const state = new GameRoomState();
    const recon1 = makeWing("r1", "us", 0, 0, "recon_plane");
    recon1.mission = MISSION_TYPES.RECON;
    recon1.target_id = "bomber_1";
    const escort1 = makeWing("e1", "us", 0, 0, "fighter");
    escort1.mission = MISSION_TYPES.ESCORT;
    escort1.target_id = "bomber_1"; // same target id, different mission — must not count
    state.air_wings.set("r1", recon1);
    state.air_wings.set("e1", escort1);

    const counts = buildReconEscortCounts(state);
    assert.strictEqual(counts.get("bomber_1"), 1);

    // Sanity: the shared claims registry WOULD collide (counts both), demonstrating why
    // the recon-specific counter is required for the "already accompanied" gate.
    const claims = buildClaimsRegistry(state);
    assert.strictEqual(claims.get("bomber_1"), 2);
  });
});

describe("lane:air-combat | Recon mission tier chain", () => {
  it("tier 1 escorts the nearest friendly bomber not already recon-escorted", () => {
    const state = new GameRoomState();
    const wing = makeWing("recon_new", "us", 0, 0, "recon_plane");
    state.air_wings.set("recon_new", wing);

    const bomberFree = makeWing("bomber_free", "us", 1, 0, "tactical_bomber");
    bomberFree.lifecycle_state = WING_LIFECYCLE.TRANSIT;
    const bomberEscorted = makeWing("bomber_escorted", "us", 0.5, 0, "strategic_bomber");
    bomberEscorted.lifecycle_state = WING_LIFECYCLE.TRANSIT;
    state.air_wings.set("bomber_free", bomberFree);
    state.air_wings.set("bomber_escorted", bomberEscorted);

    const existingRecon = makeWing("recon_existing", "us", 0, 0, "recon_plane");
    existingRecon.mission = MISSION_TYPES.RECON;
    existingRecon.target_id = "bomber_escorted";
    state.air_wings.set("recon_existing", existingRecon);

    const claims = buildClaimsRegistry(state);
    const reconCounts = buildReconEscortCounts(state);
    const result = resolveReconTargets(wing, state, new Map(), claims, reconCounts, makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 1, targetId: "bomber_free" });
  });

  it("an Escort claim on the same bomber wing_id does not block recon tier 1 (recon-specific gate, not shared claims)", () => {
    const state = new GameRoomState();
    const wing = makeWing("recon_new", "us", 0, 0, "recon_plane");
    state.air_wings.set("recon_new", wing);

    const bomber = makeWing("bomber_1", "us", 1, 0, "tactical_bomber");
    bomber.lifecycle_state = WING_LIFECYCLE.TRANSIT;
    state.air_wings.set("bomber_1", bomber);

    const escort = makeWing("escort_1", "us", 0, 0, "fighter");
    escort.mission = MISSION_TYPES.ESCORT;
    escort.target_id = "bomber_1";
    state.air_wings.set("escort_1", escort);

    const claims = buildClaimsRegistry(state); // claims.get("bomber_1") === 1, from escort
    const reconCounts = buildReconEscortCounts(state); // reconCounts.get("bomber_1") === undefined
    const result = resolveReconTargets(wing, state, new Map(), claims, reconCounts, makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 1, targetId: "bomber_1" });
  });

  it("tier 1 skips a bomber that is currently RTB or REFUEL, even if it would otherwise be the nearest free bomber", () => {
    const state = new GameRoomState();
    const wing = makeWing("recon_new", "us", 0, 0, "recon_plane");
    state.air_wings.set("recon_new", wing);

    const bomberRtb = makeWing("bomber_rtb", "us", 0.2, 0, "tactical_bomber");
    bomberRtb.lifecycle_state = WING_LIFECYCLE.RTB;
    const bomberRefuel = makeWing("bomber_refuel", "us", 0.3, 0, "tactical_bomber");
    bomberRefuel.lifecycle_state = WING_LIFECYCLE.REFUEL;
    const bomberFlying = makeWing("bomber_flying", "us", 5, 0, "strategic_bomber");
    bomberFlying.lifecycle_state = WING_LIFECYCLE.TRANSIT;
    state.air_wings.set("bomber_rtb", bomberRtb);
    state.air_wings.set("bomber_refuel", bomberRefuel);
    state.air_wings.set("bomber_flying", bomberFlying);

    const claims = buildClaimsRegistry(state);
    const reconCounts = buildReconEscortCounts(state);
    const result = resolveReconTargets(wing, state, new Map(), claims, reconCounts, makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 1, targetId: "bomber_flying" },
      "must skip the nearer RTB/REFUEL bombers and pick the farther still-flying one");
  });

  it("falls back to tier-3 bare war-border patrol when every bomber is already recon-escorted and no friendly division is near the border", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("recon_new", "us", 0, 0, "recon_plane");
    state.air_wings.set("recon_new", wing);

    const bomber = makeWing("bomber_1", "us", 1, 0, "tactical_bomber");
    state.air_wings.set("bomber_1", bomber);
    const existingRecon = makeWing("recon_existing", "us", 0, 0, "recon_plane");
    existingRecon.mission = MISSION_TYPES.RECON;
    existingRecon.target_id = "bomber_1";
    state.air_wings.set("recon_existing", existingRecon);

    state.provinces.set("p1", makeProvince("p1", "us"));
    state.provinces.set("p2", makeProvince("p2", "de"));
    const provinceNeighbors = new Map<string, string[]>([["p1", ["p2"]], ["p2", ["p1"]]]);
    const resolvePosition = makeResolvePosition({ p1: { lng: 0, lat: 0 }, p2: { lng: 1, lat: 1 } });

    // No divisions exist near the border, so tier 2 is empty, but p1 is friendly-owned and
    // directly borders p2 (war-stance) — tier 3's bare-border-point candidate, vision-only,
    // no unit required.
    const claims = buildClaimsRegistry(state);
    const reconCounts = buildReconEscortCounts(state);
    const result = resolveReconTargets(wing, state, provinceNeighbors, claims, reconCounts, resolvePosition);
    assert.deepStrictEqual(result, { tier: 3, targetId: "p1" });
  });

  it("tier 3 loses to tier 2 when a friendly division is near the war border", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("recon_new", "us", 0, 0, "recon_plane");
    state.air_wings.set("recon_new", wing);

    state.provinces.set("p1", makeProvince("p1", "us"));
    state.provinces.set("p2", makeProvince("p2", "de"));
    const provinceNeighbors = new Map<string, string[]>([["p1", ["p2"]], ["p2", ["p1"]]]);
    const resolvePosition = makeResolvePosition({ p1: { lng: 0, lat: 0 }, p2: { lng: 1, lat: 1 } });

    const division = new DivisionState();
    division.division_id = "div_1";
    division.nation_id = "us";
    division.position_lng = 0;
    division.position_lat = 0;
    state.divisions.set("div_1", division);

    const claims = buildClaimsRegistry(state);
    const reconCounts = buildReconEscortCounts(state);
    const result = resolveReconTargets(wing, state, provinceNeighbors, claims, reconCounts, resolvePosition);
    assert.deepStrictEqual(result, { tier: 2, targetId: "div_1" });
  });

  it("tier 2 still matches a division at real map scale, not just near-zero synthetic distances", () => {
    // Regression test: BORDER_PROXIMITY_DEG was originally 1.5, but the real western_europe_6
    // map's median distance between adjacent provinces' city markers is ~2.8deg (mean ~3.0,
    // max ~8.4) — a division genuinely fighting at its own province's position could easily be
    // further than 1.5deg from a neighboring border province's city marker, silently demoting
    // tier 2 to tier 3 almost everywhere on the real map. Every other test in this file uses
    // 0-5deg synthetic deltas too small to catch that scale mismatch.
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("recon_scale", "us", 0, 0, "recon_plane");
    state.air_wings.set("recon_scale", wing);

    state.provinces.set("p1", makeProvince("p1", "us"));
    state.provinces.set("p2", makeProvince("p2", "de"));
    const provinceNeighbors = new Map<string, string[]>([["p1", ["p2"]], ["p2", ["p1"]]]);
    // p1 (the qualifying war-border province) sits at (0,0); the division is ~2.8deg away —
    // representative of this map's real median adjacency distance, not a near-zero delta.
    const resolvePosition = makeResolvePosition({ p1: { lng: 0, lat: 0 }, p2: { lng: 6, lat: 5 } });

    const division = new DivisionState();
    division.division_id = "div_scale";
    division.nation_id = "us";
    division.position_lng = 2.0;
    division.position_lat = 2.0; // distance from p1's (0,0) ~= 2.83deg
    state.divisions.set("div_scale", division);

    const claims = buildClaimsRegistry(state);
    const reconCounts = buildReconEscortCounts(state);
    const result = resolveReconTargets(wing, state, provinceNeighbors, claims, reconCounts, resolvePosition);
    assert.deepStrictEqual(result, { tier: 2, targetId: "div_scale" });
  });

  it("falls back to tier 4 (neutral-border) when no war border exists, skipping tier 3 correctly", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "es", "neutral");
    const wing = makeWing("recon_new", "us", 0, 0, "recon_plane");
    state.air_wings.set("recon_new", wing);

    state.provinces.set("p1", makeProvince("p1", "us"));
    state.provinces.set("p2", makeProvince("p2", "es"));
    const provinceNeighbors = new Map<string, string[]>([["p1", ["p2"]], ["p2", ["p1"]]]);
    const resolvePosition = makeResolvePosition({ p1: { lng: 0, lat: 0 }, p2: { lng: 1, lat: 1 } });

    const division = new DivisionState();
    division.division_id = "div_1";
    division.nation_id = "us";
    division.position_lng = 0;
    division.position_lat = 0;
    state.divisions.set("div_1", division);

    const claims = buildClaimsRegistry(state);
    const reconCounts = buildReconEscortCounts(state);
    const result = resolveReconTargets(wing, state, provinceNeighbors, claims, reconCounts, resolvePosition);
    assert.deepStrictEqual(result, { tier: 4, targetId: "div_1" });
  });

  it("falls back to tier 5 (own city) when neither war nor neutral borders exist, and never targets its own home base", () => {
    const state = new GameRoomState();
    const wing = makeWing("recon_new", "us", 0, 0, "recon_plane");
    wing.home_airbase_province_id = "home_prov";
    state.air_wings.set("recon_new", wing);

    state.provinces.set("home_prov", makeProvince("home_prov", "us"));
    state.provinces.set("city_1", makeProvince("city_1", "us"));
    const provinceNeighbors = new Map<string, string[]>();
    const resolvePosition = makeResolvePosition({
      home_prov: { lng: 0, lat: 0 },
      city_1: { lng: 0.1, lat: 0 },
    });

    const claims = buildClaimsRegistry(state);
    const reconCounts = buildReconEscortCounts(state);
    const result = resolveReconTargets(wing, state, provinceNeighbors, claims, reconCounts, resolvePosition);
    assert.ok(result && result.tier === 5);
    assert.strictEqual(result!.targetId, "city_1");
    assert.notStrictEqual(result!.targetId, wing.home_airbase_province_id,
      "must never patrol a point it's already sitting on");
  });

  it("tier 5 returns null (stay at base) when the nation owns only its home base province", () => {
    const state = new GameRoomState();
    const wing = makeWing("recon_new", "us", 0, 0, "recon_plane");
    wing.home_airbase_province_id = "home_prov";
    state.air_wings.set("recon_new", wing);

    state.provinces.set("home_prov", makeProvince("home_prov", "us"));
    const provinceNeighbors = new Map<string, string[]>();
    const resolvePosition = makeResolvePosition({ home_prov: { lng: 0, lat: 0 } });

    const claims = buildClaimsRegistry(state);
    const reconCounts = buildReconEscortCounts(state);
    const result = resolveReconTargets(wing, state, provinceNeighbors, claims, reconCounts, resolvePosition);
    assert.strictEqual(result, null);
  });

  it("tier 5 excludes only each wing's own home base, not other wings' bases, from the shared per-nation cache", () => {
    const state = new GameRoomState();
    const wingA = makeWing("recon_a", "us", 0, 0, "recon_plane");
    wingA.home_airbase_province_id = "prov_a";
    state.air_wings.set("recon_a", wingA);
    const wingB = makeWing("recon_b", "us", 0, 0, "recon_plane");
    wingB.home_airbase_province_id = "prov_b";
    state.air_wings.set("recon_b", wingB);

    state.provinces.set("prov_a", makeProvince("prov_a", "us"));
    state.provinces.set("prov_b", makeProvince("prov_b", "us"));
    const provinceNeighbors = new Map<string, string[]>();
    const resolvePosition = makeResolvePosition({
      prov_a: { lng: 0, lat: 0 },
      prov_b: { lng: 1, lat: 0 },
    });

    const claims = buildClaimsRegistry(state);
    const reconCounts = buildReconEscortCounts(state);
    const cache = createTickCache();
    const resultA = resolveReconTargets(wingA, state, provinceNeighbors, claims, reconCounts, resolvePosition, cache);
    const resultB = resolveReconTargets(wingB, state, provinceNeighbors, claims, reconCounts, resolvePosition, cache);
    assert.strictEqual(resultA?.targetId, "prov_b", "wing A must exclude only its own base, still seeing prov_b");
    assert.strictEqual(resultB?.targetId, "prov_a", "wing B must exclude only its own base, still seeing prov_a");
  });
});

describe("lane:air-combat | Recon patrol survives a lost path without a live bomber target", () => {
  const NONE_DETECTED = {
    getWingDetectedByNations: (_wingId: string) => new Set<string>(),
    getVisibleDivisionsForNation: (_nationId: string) => new Set<string>(),
  };

  function setup() {
    const state = new GameRoomState();
    state.provinces.set("home_prov", makeProvince("home_prov", "us"));
    state.provinces.set("border_prov", makeProvince("border_prov", "us"));
    state.provinces.set("enemy_prov", makeProvince("enemy_prov", "fr"));
    state.provinceNeighbors.set("home_prov", ["border_prov"]);
    state.provinceNeighbors.set("border_prov", ["home_prov", "enemy_prov"]);
    state.provinceNeighbors.set("enemy_prov", ["border_prov"]);
    setRelation(state, "us", "fr", "war");

    const wing = makeWing("recon_stuck", "us", 0, 0, "recon_plane");
    wing.home_airbase_province_id = "home_prov";
    wing.mission = MISSION_TYPES.RECON;
    wing.lifecycle_state = WING_LIFECYCLE.IDLE;
    state.air_wings.set(wing.wing_id, wing);

    const resolvePosition = makeResolvePosition({
      home_prov: { lng: 0, lat: 0 },
      border_prov: { lng: 1, lat: 0 },
      enemy_prov: { lng: 2, lat: 0 },
    });

    const targeting = new AirMissionTargetingSystem();
    const lifecycle = new AirWingLifecycleSystem();
    const pathfinder = new DubinsPathfinder();
    return { state, wing, resolvePosition, targeting, lifecycle, pathfinder };
  }

  it("commits a real patrol target (not its own base) and builds a path for it", () => {
    setAirMissionTargetingEnabledForTesting(true);
    try {
      const { state, wing, resolvePosition, targeting, lifecycle, pathfinder } = setup();
      targeting.tick(state, NONE_DETECTED, lifecycle, pathfinder, resolvePosition, () => {});
      assert.strictEqual(wing.target_id, "border_prov");
      assert.notStrictEqual(wing.target_id, wing.home_airbase_province_id);
      assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.TRANSIT);
      assert.ok(pathfinder.hasPath(wing.wing_id), "a path must be built the moment the target is committed");
    } finally {
      setAirMissionTargetingEnabledForTesting(false);
    }
  });

  it("rebuilds a lost path on the next tick even when the same target/tier is re-resolved (post-refuel reassignment case)", () => {
    // Regression test: air_wing_lifecycle_system.ts's post-refuel pending-mission
    // reassignment calls assignMission() directly (not through GameRoom.ts's
    // ASSIGN_WING_MISSION handler, the only call site that builds a path itself), and
    // RTB->REFUEL already cleared any previous path. If the re-resolved target/tier match
    // what was already committed, the "already on it" no-op guard used to skip rebuilding a
    // path entirely, leaving the wing stuck in TRANSIT with no path forever — which is what
    // made a recon wing with a legitimate far-away patrol target appear to "just sit at its
    // airbase."
    setAirMissionTargetingEnabledForTesting(true);
    try {
      const { state, wing, resolvePosition, targeting, lifecycle, pathfinder } = setup();
      targeting.tick(state, NONE_DETECTED, lifecycle, pathfinder, resolvePosition, () => {});
      assert.ok(pathfinder.hasPath(wing.wing_id), "precondition: initial commit built a path");

      // Simulate the post-refuel reassignment: the path is cleared (as RTB->REFUEL does),
      // but target_id/mission/tier tracking are untouched, exactly like assignMission()
      // being called internally with the same still-valid target.
      pathfinder.clearPath(wing.wing_id);
      wing.path_gen_id = "";
      wing.path_elapsed_ms = 0;
      assert.ok(!pathfinder.hasPath(wing.wing_id), "precondition: path really is gone");

      targeting.tick(state, NONE_DETECTED, lifecycle, pathfinder, resolvePosition, () => {});
      assert.strictEqual(wing.target_id, "border_prov", "target should be unchanged (same tier still wins)");
      assert.ok(pathfinder.hasPath(wing.wing_id),
        "a fresh path must be rebuilt even though target/tier didn't change, since the old one was lost");
    } finally {
      setAirMissionTargetingEnabledForTesting(false);
    }
  });
});
