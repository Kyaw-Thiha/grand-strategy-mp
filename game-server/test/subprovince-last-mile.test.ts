import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SubprovinceSystem } from "../src/systems/subprovince_system.js";
import { MovementSystem } from "../src/systems/movement_system.js";
import { GameRoomState, DivisionState } from "../src/rooms/schema/GameRoomState.js";

// Regression coverage for the unvalidated "last-mile" straight-line movement bug: once a move
// order's waypoint chain runs out, MovementSystem._advanceFinalPosition walks a straight line
// toward the player's raw click coordinate every tick, with NO cap on distance and NO check for
// neutral-territory ownership along the way — completely independent of whatever
// trimToAllowedTerritory decided about the waypoint chain a moment earlier. A division whose road-
// following portion correctly stopped at a border could still get an unbounded, unchecked
// straight-line hop across that border (or through impassable terrain) to the original click point.
// MovementSystem.resolveFinalPosition() is the fix: called once at move-order submission time, it
// clamps the requested click to the local waypoint graph's own density (with slack) and truncates
// the resulting segment at the first neutral or impassable sample.

const MAP_ID = "western_europe_6";

// A real western_europe_6 node verified (via a one-off probe script, same convention as
// subprovince-system-unit.test.ts's ALBANIA_CELL_A/B) to: (a) resolve back to itself through
// MovementSystem.getNearestWaypoint, (b) NOT be a road node (absent from waypoints.json's
// road_connections), so its off-road terrain profile actually governs passability rather than
// always costing 1.0 like a road cell would.
const OFFROAD_ANCHOR = { id: "ct_009944", lng: 20.282208, lat: 39.956681, cover_combat: "plains", elevation: "mountains" };

function freshSystems(): { subSys: SubprovinceSystem; movementSystem: MovementSystem; state: GameRoomState } {
  const subSys = new SubprovinceSystem();
  subSys.loadForRoom(MAP_ID);
  const movementSystem = new MovementSystem();
  movementSystem.loadWaypoints(MAP_ID);
  const state = new GameRoomState();
  // Deliberately never calls subSys.initializeOwnership(state) — state.subprovinces stays empty,
  // which resolves as passable/unmapped (per the neutral-guard fix's fallback), keeping
  // distance/terrain-focused tests free of incidental neutral-territory interference.
  return { subSys, movementSystem, state };
}

function makeDivision(nationId: string, movementProfile: Record<string, number> = {}): DivisionState {
  const division = new DivisionState();
  division.division_id = `${nationId}-${Math.random()}`;
  division.nation_id = nationId;
  division.movement_profile_json = JSON.stringify(movementProfile);
  return division;
}

function distDeg(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  return Math.sqrt((a.lng - b.lng) ** 2 + (a.lat - b.lat) ** 2);
}

describe("lane:subprovince | last-mile final-position resolution", () => {
  it("confirms the chosen anchor is a real, self-resolving, off-road node (test fixture sanity check)", () => {
    const { movementSystem } = freshSystems();
    const nearest = movementSystem.getNearestWaypoint(OFFROAD_ANCHOR.lng, OFFROAD_ANCHOR.lat);
    assert.equal(nearest?.id, OFFROAD_ANCHOR.id);
    assert.equal(nearest?.cover_combat, OFFROAD_ANCHOR.cover_combat);
    assert.equal(nearest?.elevation, OFFROAD_ANCHOR.elevation);
  });

  it("delivers a short, legitimate last-mile click unclamped and untruncated", () => {
    const { subSys, movementSystem, state } = freshSystems();
    const division = makeDivision("germany");
    // A modest, realistic "click a bit off-road" distance — well under any plausible local cap.
    const requested = { lng: OFFROAD_ANCHOR.lng + 0.001, lat: OFFROAD_ANCHOR.lat };

    const resolved = movementSystem.resolveFinalPosition(
      OFFROAD_ANCHOR.id, requested.lng, requested.lat, division, state.relations, subSys, state.subprovinces,
    );

    assert.ok(resolved, "a short off-road click must not be rejected");
    assert.ok(
      Math.abs(resolved!.lng - requested.lng) < 1e-9 && Math.abs(resolved!.lat - requested.lat) < 1e-9,
      `expected the short click to pass through exactly unclamped, got ${JSON.stringify(resolved)}`,
    );
  });

  it("delivers a known real inter-node edge distance unclamped (confirms slack leeway, not a harsh cutoff)", () => {
    // 0.1483 degrees is a real edge length from OFFROAD_ANCHOR to one of its actual graph
    // neighbors (verified via a one-off probe script against waypoints.json) — i.e. a real lower
    // bound on the anchor's local max-edge baseline. Since the cap is baseline × slack (> 1×
    // baseline), requesting exactly this distance must never be clamped, regardless of exactly how
    // much larger the true server-side (client+terrain-grid-merged) baseline turns out to be.
    const { subSys, movementSystem, state } = freshSystems();
    const division = makeDivision("germany");
    const KNOWN_REAL_EDGE_DEG = 0.1483;
    const requested = { lng: OFFROAD_ANCHOR.lng + KNOWN_REAL_EDGE_DEG, lat: OFFROAD_ANCHOR.lat };

    const resolved = movementSystem.resolveFinalPosition(
      OFFROAD_ANCHOR.id, requested.lng, requested.lat, division, state.relations, subSys, state.subprovinces,
    );

    assert.ok(resolved, "a request at a known real local edge distance must not be rejected");
    const resolvedDist = distDeg(OFFROAD_ANCHOR, resolved!);
    assert.ok(
      resolvedDist > KNOWN_REAL_EDGE_DEG - 1e-6,
      `expected the resolved point to reach (not fall short of) the known real edge distance, got ${resolvedDist}`,
    );
  });

  it("clamps a click target far beyond any plausible local waypoint density", () => {
    const { subSys, movementSystem, state } = freshSystems();
    const division = makeDivision("germany");
    // ~220km east — many orders of magnitude past any real inter-node spacing on this map.
    const farAway = { lng: OFFROAD_ANCHOR.lng + 2.0, lat: OFFROAD_ANCHOR.lat };

    const resolved = movementSystem.resolveFinalPosition(
      OFFROAD_ANCHOR.id, farAway.lng, farAway.lat, division, state.relations, subSys, state.subprovinces,
    );

    assert.ok(resolved, "an arbitrarily far click must still resolve to a clamped point, not be rejected outright");
    const resolvedDist = distDeg(OFFROAD_ANCHOR, resolved!);
    assert.ok(
      resolvedDist < 1.0,
      `expected the far-away click to be clamped to a small local hop, got a resolved distance of ${resolvedDist} degrees`,
    );
  });

  it("truncates the segment at the first live-neutral subprovince, not delivering the full click", () => {
    const { subSys, movementSystem, state } = freshSystems();
    const division = makeDivision("germany");
    const requested = { lng: OFFROAD_ANCHOR.lng + 0.02, lat: OFFROAD_ANCHOR.lat };

    // Resolve whatever real subprovince cell sits roughly midway along the segment and mark it
    // neutral — using the exact same lookup resolveFinalPosition's own sweep uses internally, so
    // this test doesn't need to guess real geometry, only observe it.
    const midpointId = subSys.getSubprovinceAtPosition({
      lng: (OFFROAD_ANCHOR.lng + requested.lng) / 2, lat: OFFROAD_ANCHOR.lat,
    });
    assert.ok(midpointId, "expected the segment's midpoint to resolve to a real subprovince cell");
    subSys.initializeOwnership(state); // seed every cell from its province owner first...
    const sp = state.subprovinces.get(midpointId!)!;
    sp.owner_id = "neutral_nation"; // ...then override just the midpoint cell to neutral.

    const resolved = movementSystem.resolveFinalPosition(
      OFFROAD_ANCHOR.id, requested.lng, requested.lat, division, state.relations, subSys, state.subprovinces,
    );

    if (resolved) {
      const resolvedDist = distDeg(OFFROAD_ANCHOR, resolved);
      const requestedDist = distDeg(OFFROAD_ANCHOR, requested);
      assert.ok(
        resolvedDist < requestedDist - 1e-6,
        `expected truncation before the full requested distance, got resolved=${resolvedDist} requested=${requestedDist}`,
      );
    }
    // A null result (blocked immediately) is also an acceptable truncation outcome if the anchor's
    // own cell happens to sit adjacent enough to the neutral cell — either way, the full click must
    // never be delivered whole.
  });

  it("truncates the segment at the first impassable-terrain sample for the division's movement profile", () => {
    const { subSys, movementSystem, state } = freshSystems();
    // Off-road plains_mountains terrain made impassable for this specific division's profile —
    // matches OFFROAD_ANCHOR's own verified terrain type, so the very first sweep sample (whose
    // nearest node is the anchor itself) is already blocked. Set the raw JSON string directly with
    // the literal numeral text "1e400" (not via JSON.stringify(1e400) — that JS numeric literal
    // already evaluates to the Infinity object *before* stringification, and
    // JSON.stringify(Infinity) serializes to "null", which would silently fall back to a passable
    // default cost instead of the intended impassable one).
    const division = makeDivision("germany");
    division.movement_profile_json = '{"plains_mountains":1e400}';
    const requested = { lng: OFFROAD_ANCHOR.lng + 0.001, lat: OFFROAD_ANCHOR.lat };

    const resolved = movementSystem.resolveFinalPosition(
      OFFROAD_ANCHOR.id, requested.lng, requested.lat, division, state.relations, subSys, state.subprovinces,
    );

    assert.equal(resolved, null, "a click into terrain the profile marks impassable must be rejected, not delivered");
  });

  it("does not truncate when the division's profile can traverse the anchor's own terrain type", () => {
    const { subSys, movementSystem, state } = freshSystems();
    const division = makeDivision("germany", { plains_mountains: 2.0 }); // slow, but passable
    const requested = { lng: OFFROAD_ANCHOR.lng + 0.001, lat: OFFROAD_ANCHOR.lat };

    const resolved = movementSystem.resolveFinalPosition(
      OFFROAD_ANCHOR.id, requested.lng, requested.lat, division, state.relations, subSys, state.subprovinces,
    );

    assert.ok(resolved, "a finite, passable terrain cost must not be treated as blocking");
  });
});
