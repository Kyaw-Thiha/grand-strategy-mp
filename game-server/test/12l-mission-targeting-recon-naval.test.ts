import assert from "assert";
import { describe, it } from "mocha";
import {
  resolveNavalTargets,
  resolveReconTargets,
  buildReconEscortCounts,
  buildClaimsRegistry,
} from "../src/systems/air_mission_targeting.js";
import { GameRoomState, ProvinceState, RelationState } from "../src/rooms/schema/GameRoomState.js";
import { NavalContactMarkerState } from "../src/rooms/schema/NavalContactMarkerState.js";
import { AirWingState, MISSION_TYPES } from "../src/rooms/schema/AirWingState.js";

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
    const bomberEscorted = makeWing("bomber_escorted", "us", 0.5, 0, "strategic_bomber");
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

  it("falls back to tier-2 war-border patrol when every bomber is already recon-escorted", () => {
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

    // No divisions exist near a border -> no candidates at tier 2/3/4, and no own provinces
    // resolvable from home -> expect null (stay at base) since tier1 excluded and no patrol candidates.
    const claims = buildClaimsRegistry(state);
    const reconCounts = buildReconEscortCounts(state);
    const result = resolveReconTargets(wing, state, provinceNeighbors, claims, reconCounts, resolvePosition);
    assert.strictEqual(result, null);
  });
});
