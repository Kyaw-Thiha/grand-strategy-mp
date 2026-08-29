import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SubprovinceSystem } from "../src/systems/subprovince_system.js";
import { MovementSystem } from "../src/systems/movement_system.js";
import { GameRoomState, RelationState, SubprovinceState } from "../src/rooms/schema/GameRoomState.js";

// Regression coverage for the stale-territory-snapshot bug: MovementSystem.trimToAllowedTerritory /
// _isNeutralFor used to read a one-time `loadMapData()` snapshot of province-polygon ownership,
// built once at room start and never refreshed. Once subprovince ownership started churning far
// more often/granularly than the legacy province-level owner_id, that snapshot went stale almost
// immediately: a division could walk into land the guard should have blocked (destination's frozen
// snapshot still said "friendly"), and once inside, further move orders failed outright because
// every surrounding node shared the same stale "not mine" tag. The fix replaces the frozen snapshot
// with a live lookup through SubprovinceSystem.getSubprovinceAtPosition() + state.subprovinces.

const MAP_ID = "western_europe_6";

function freshSystems(): { subSys: SubprovinceSystem; movementSystem: MovementSystem; state: GameRoomState } {
  const subSys = new SubprovinceSystem();
  subSys.loadForRoom(MAP_ID);
  const movementSystem = new MovementSystem();
  movementSystem.loadWaypoints(MAP_ID);
  const state = new GameRoomState();
  return { subSys, movementSystem, state };
}

function setRelation(state: GameRoomState, a: string, b: string, stance: string): void {
  const rel = new RelationState();
  rel.from_id = a;
  rel.to_id = b;
  rel.stance = stance;
  state.relations.set(`${a}|${b}`, rel);
}

/** Picks a real waypoint (via MovementSystem's own nearest-waypoint lookup, same as production
 *  code paths) and resolves the real subprovince cell it lands in, so this test exercises real
 *  map geometry instead of synthetic fixtures — matching subprovince-system-unit.test.ts's
 *  established convention of using real western_europe_6 data for SubprovinceSystem tests. */
function pickWaypointAndCell(
  subSys: SubprovinceSystem, movementSystem: MovementSystem, near: { lng: number; lat: number },
): { waypointId: string; subprovinceId: string } {
  const waypoint = movementSystem.getNearestWaypoint(near.lng, near.lat);
  assert.ok(waypoint, "expected at least one real waypoint near the probe coordinate");
  const subprovinceId = subSys.getSubprovinceAtPosition({ lng: waypoint!.lng, lat: waypoint!.lat });
  assert.ok(subprovinceId, "expected the nearest real waypoint to resolve to a real subprovince cell");
  return { waypointId: waypoint!.id, subprovinceId: subprovinceId! };
}

// A real western_europe_6 coordinate, reused from subprovince-system-unit.test.ts's verified fixtures.
const ALBANIA_PROBE = { lng: 20.281317477125427, lat: 39.93642136794463 };

describe("lane:subprovince | neutral-territory movement guard uses live ownership", () => {
  it("trims a waypoint whose LIVE subprovince owner is neutral, regardless of any stale snapshot", () => {
    const { subSys, movementSystem, state } = freshSystems();
    const { waypointId, subprovinceId } = pickWaypointAndCell(subSys, movementSystem, ALBANIA_PROBE);

    const sp = new SubprovinceState();
    sp.province_id = "probe_province";
    sp.owner_id = "neutral_nation";
    state.subprovinces.set(subprovinceId, sp);
    // No relation entry set between "germany" and "neutral_nation" — defaults to "neutral" stance.

    const allowed = movementSystem.trimToAllowedTerritory(
      [waypointId], "germany", state.relations, subSys, state.subprovinces,
    );

    assert.deepEqual(allowed, [], "a live-neutral cell must be trimmed even with no stale data implying otherwise");
  });

  it("allows a waypoint whose subprovince was just captured by the moving division's own nation", () => {
    const { subSys, movementSystem, state } = freshSystems();
    const { waypointId, subprovinceId } = pickWaypointAndCell(subSys, movementSystem, ALBANIA_PROBE);

    const sp = new SubprovinceState();
    sp.province_id = "probe_province";
    sp.owner_id = "germany"; // freshly captured at the subprovince level
    state.subprovinces.set(subprovinceId, sp);

    const allowed = movementSystem.trimToAllowedTerritory(
      [waypointId], "germany", state.relations, subSys, state.subprovinces,
    );

    assert.deepEqual(allowed, [waypointId], "own-nation subprovince ownership must be passable immediately");
  });

  it("still allows enemy (at-war) territory, matching pre-existing intended behavior", () => {
    const { subSys, movementSystem, state } = freshSystems();
    const { waypointId, subprovinceId } = pickWaypointAndCell(subSys, movementSystem, ALBANIA_PROBE);

    const sp = new SubprovinceState();
    sp.province_id = "probe_province";
    sp.owner_id = "france";
    state.subprovinces.set(subprovinceId, sp);
    setRelation(state, "germany", "france", "war");

    const allowed = movementSystem.trimToAllowedTerritory(
      [waypointId], "germany", state.relations, subSys, state.subprovinces,
    );

    assert.deepEqual(allowed, [waypointId], "enemy territory must remain traversable for move orders");
  });

  it("treats a resolvable subprovince with no ownership entry as passable (unmapped fallback)", () => {
    // freshSystems() deliberately never calls subSys.initializeOwnership(state), so
    // state.subprovinces stays empty even though the cell itself resolves fine — exercising the
    // `subprovinces.get(subprovinceId)?.owner_id ?? ""` fallback the same way a genuinely
    // unresolvable (null subprovinceId) waypoint would, per _isNeutralFor's shared "" branch.
    const { subSys, movementSystem, state } = freshSystems();
    const { waypointId } = pickWaypointAndCell(subSys, movementSystem, ALBANIA_PROBE);
    assert.equal(state.subprovinces.size, 0, "sanity check: no ownership data has been initialized");

    const allowed = movementSystem.trimToAllowedTerritory(
      [waypointId], "germany", state.relations, subSys, state.subprovinces,
    );

    assert.deepEqual(allowed, [waypointId], "a cell with no ownership entry must not be blocked");
  });
});
