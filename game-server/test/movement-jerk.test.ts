/**
 * movement-jerk.test.ts
 *
 * Unit regression test for Phase 1: Fix Movement Jerk.
 *
 * Tests the server-side fix for the position snap / jerk that occurred when the
 * first DIVISION_UPDATES arrived ~1 second after a move order.
 *
 * Assertions:
 *   A. DivisionState has consumed_waypoint_ids field (schema check).
 *   B. _advanceDivision sets consumed_waypoint_ids to the consumed waypoint ID
 *      when a waypoint is snapped/passed through (distDeg < 0.0001).
 *   C. _advanceDivision resets consumed_waypoint_ids to [] on ticks where no
 *      waypoint is fully consumed (partial movement).
 *   D. consumed_waypoint_ids is annotated with @type(["string"]) so Colyseus
 *      includes it in schema serialisation.
 *
 * These are pure unit tests — no live server or Colyseus test server needed.
 */

import assert from "assert";
import { ArraySchema } from "@colyseus/schema";
import { DivisionState } from "../src/rooms/schema/GameRoomState.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal two-node graph injectable into MovementSystem's private field. */
function makeGraph(nodeA: { id: string; lng: number; lat: number },
                   nodeB: { id: string; lng: number; lat: number },
                   onRoad = true) {
  const node = (n: typeof nodeA) => ({ ...n, cover_combat: "open", elevation: "low" });
  return {
    nodes: new Map([
      [nodeA.id, node(nodeA)],
      [nodeB.id, node(nodeB)],
    ]),
    adjacency: new Map([
      [nodeA.id, [nodeB.id]],
      [nodeB.id, [nodeA.id]],
    ]),
    road_node_ids: onRoad ? new Set([nodeA.id, nodeB.id]) : new Set<string>(),
  };
}

/** Build a DivisionState with a move_order pointing to a single waypoint. */
function makeDiv(
  id: string,
  startLng: number,
  startLat: number,
  targetWpId: string,
  consumedWpIds: string[] = [],
): DivisionState {
  const div = new DivisionState();
  div.division_id           = id;
  div.position_lng          = startLng;
  div.position_lat          = startLat;
  for (const cid of consumedWpIds) div.consumed_waypoint_ids.push(cid);
  div.move_order            = new ArraySchema<string>(targetWpId);
  return div;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Phase 1 — movement-jerk regression", () => {
  it("DivisionState schema includes consumed_waypoint_ids field with default []", () => {
    const div = new DivisionState();
    assert.ok(
      "consumed_waypoint_ids" in div,
      'DivisionState is missing consumed_waypoint_ids — add @type(["string"]) consumed_waypoint_ids to the schema',
    );
    assert.strictEqual(
      div.consumed_waypoint_ids.length,
      0,
      "consumed_waypoint_ids default value must be empty array",
    );
  });

  it("consumed_waypoint_ids is registered in Colyseus schema (serialisation proof)", () => {
    const keys = Object.keys(new DivisionState());
    assert.ok(
      keys.includes("consumed_waypoint_ids"),
      `consumed_waypoint_ids not in Colyseus schema registry (Object.keys).  ` +
        `Add @type(["string"]) consumed_waypoint_ids to DivisionState.  ` +
        `Found: ${keys.join(", ")}`,
    );
  });

  it("_advanceDivision sets consumed_waypoint_ids when a waypoint is consumed (snap path)", async () => {
    const { MovementSystem } = await import("../src/systems/movement_system.js");
    const system = new MovementSystem();

    // wp_B is within snap threshold (distDeg < 0.0001) of starting position.
    const A = { id: "wp_A", lng: 10.0,     lat: 50.0 };
    const B = { id: "wp_B", lng: 10.00005, lat: 50.0 }; // 0.00005° < 0.0001 threshold

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (system as any).graph = makeGraph(A, B);

    const div = makeDiv("div_snap", A.lng, A.lat, B.id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (system as any)._advanceDivision(div, 1.0);

    assert.ok(
      div.consumed_waypoint_ids.includes(B.id),
      `_advanceDivision must push 'wp_B' into consumed_waypoint_ids within snap threshold`,
    );
    assert.strictEqual(div.move_order.length, 0, "move_order must be empty after consuming the only waypoint");
  });

  it("_advanceDivision sets consumed_waypoint_ids when a waypoint is consumed (speed-overshoot path)", async () => {
    const { MovementSystem } = await import("../src/systems/movement_system.js");
    const system = new MovementSystem();

    // wp_B is within road-speed travel distance for 1 game-hour but beyond snap threshold.
    // Road speed = 60 km/h. 1° lat ≈ 111 km → 60/111 ≈ 0.54°/hr.
    // So any B within 0.5° on a road will be consumed. Use 0.01° (safe, > 0.0001).
    const A = { id: "wp_A", lng: 10.0,  lat: 50.0 };
    const B = { id: "wp_B", lng: 10.01, lat: 50.0 }; // ~1.1 km — well within 60 km/h tick

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (system as any).graph = makeGraph(A, B, true /* onRoad */);

    const div = makeDiv("div_overshoot", A.lng, A.lat, B.id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (system as any)._advanceDivision(div, 1.0);

    assert.ok(
      div.consumed_waypoint_ids.includes(B.id),
      `_advanceDivision must push 'wp_B' into consumed_waypoint_ids when speed overshoots the waypoint`,
    );
    assert.strictEqual(div.move_order.length, 0, "move_order must be empty after consuming the only waypoint");
  });

  it("_advanceDivision leaves consumed_waypoint_ids empty when no waypoint is consumed this tick", async () => {
    const { MovementSystem } = await import("../src/systems/movement_system.js");
    const system = new MovementSystem();

    // wp_B is 5° away — far beyond one tick's travel at road speed.
    const A = { id: "wp_A", lng: 10.0, lat: 50.0 };
    const B = { id: "wp_B", lng: 15.0, lat: 50.0 }; // 5° ≈ 555 km — needs ~9 ticks at 60 km/h

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (system as any).graph = makeGraph(A, B, true);

    const div = makeDiv("div_partial", A.lng, A.lat, B.id, []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (system as any)._advanceDivision(div, 1.0);

    assert.strictEqual(
      div.consumed_waypoint_ids.length,
      0,
      "_advanceDivision must leave consumed_waypoint_ids empty when the division only moves partially toward a waypoint",
    );
    assert.strictEqual(div.move_order.length, 1, "move_order must still contain wp_B (not yet consumed)");
  });
});
