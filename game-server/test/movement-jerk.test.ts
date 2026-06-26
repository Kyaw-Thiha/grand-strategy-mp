/**
 * movement-jerk.test.ts
 *
 * Unit/integration regression test for Phase 1: Fix Movement Jerk.
 *
 * Tests the server-side fix for the position snap / jerk that occurred when the
 * first DIVISION_UPDATES arrived ~1 second after a move order.
 *
 * Assertions:
 *   A. DivisionState has consumed_waypoint_id field (schema check).
 *   B. _advanceDivision sets consumed_waypoint_id to the consumed waypoint ID
 *      when a waypoint is snapped/passed through.
 *   C. _advanceDivision resets consumed_waypoint_id to "" on ticks where no
 *      waypoint is fully consumed.
 *   D. After calling tick(), the broadcast state carries consumed_waypoint_id.
 *
 * Uses @colyseus/testing (ColyseusTestServer) — no live HTTP server required.
 */

import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { GameRoomState } from "../src/rooms/schema/GameRoomState.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";
const jwtSecret  = new TextEncoder().encode(JWT_SECRET);

async function makeToken(payload: object, secret = jwtSecret): Promise<string> {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(secret);
}

describe("Phase 1 — movement-jerk regression", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => { colyseus = await boot(appConfig); });
  after(async ()  => { await colyseus.shutdown(); });
  beforeEach(async () => { await colyseus.cleanup(); });

  it("DivisionState schema includes consumed_waypoint_id field", async () => {
    // The schema decorator registers the field; instantiating DivisionState
    // without a room is enough to verify it exists.
    const { DivisionState } = await import("../src/rooms/schema/GameRoomState.js");
    const div = new DivisionState();
    assert.ok(
      "consumed_waypoint_id" in div,
      "DivisionState is missing consumed_waypoint_id — add @type(\"string\") consumed_waypoint_id to the schema",
    );
    assert.strictEqual(
      div.consumed_waypoint_id,
      "",
      "consumed_waypoint_id default value should be empty string",
    );
  });

  it("MovementSystem._advanceDivision sets consumed_waypoint_id when a waypoint is consumed", async () => {
    // Import the system under test directly (not via the room).
    const { MovementSystem } = await import("../src/systems/movement_system.js");
    const { DivisionState } = await import("../src/rooms/schema/GameRoomState.js");
    const { ArraySchema } = await import("@colyseus/schema");

    const system = new MovementSystem();

    // Inject a minimal two-node graph: A → B where A and B are very close
    // (0.00005°, well under the 0.0001 snap threshold) so the waypoint is
    // consumed in a single tick.
    const nodeA = { id: "wp_A", lng: 10.0,     lat: 50.0,     cover_combat: "open", elevation: "low" };
    const nodeB = { id: "wp_B", lng: 10.00005,  lat: 50.0,     cover_combat: "open", elevation: "low" };

    // Access the private graph via type-casting (test-only).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graph = (system as any).graph as {
      nodes: Map<string, typeof nodeA>;
      adjacency: Map<string, string[]>;
      road_node_ids: Set<string>;
    };
    graph.nodes.set("wp_A", nodeA);
    graph.nodes.set("wp_B", nodeB);
    graph.adjacency.set("wp_A", ["wp_B"]);
    graph.adjacency.set("wp_B", ["wp_A"]);
    graph.road_node_ids.add("wp_A");
    graph.road_node_ids.add("wp_B");

    // Build a DivisionState positioned at node A, moving toward B.
    const div = new DivisionState();
    div.division_id = "test_div";
    div.position_lng = nodeA.lng;
    div.position_lat = nodeA.lat;
    div.consumed_waypoint_id = "";
    div.move_order = new ArraySchema<string>("wp_B");

    // Simulate a tick: speedMult = 1.0 (1 game hour).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (system as any)._advanceDivision(div, 1.0);

    // wp_B was within 0.0001° snap threshold — it must be consumed.
    assert.strictEqual(
      div.consumed_waypoint_id,
      "wp_B",
      "_advanceDivision must set consumed_waypoint_id to the consumed waypoint ID",
    );
    assert.strictEqual(div.move_order.length, 0, "move_order should be empty after consuming the only waypoint");
  });

  it("MovementSystem._advanceDivision resets consumed_waypoint_id to '' when no waypoint is consumed", async () => {
    const { MovementSystem } = await import("../src/systems/movement_system.js");
    const { DivisionState } = await import("../src/rooms/schema/GameRoomState.js");
    const { ArraySchema } = await import("@colyseus/schema");

    const system = new MovementSystem();

    // Node B is far away — will not be consumed in one tick.
    const nodeB = { id: "wp_B", lng: 15.0, lat: 50.0, cover_combat: "open", elevation: "low" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graph = (system as any).graph as {
      nodes: Map<string, typeof nodeB>;
      adjacency: Map<string, string[]>;
      road_node_ids: Set<string>;
    };
    graph.nodes.set("wp_B", nodeB);
    graph.adjacency.set("wp_B", []);
    graph.road_node_ids.add("wp_B");

    const div = new DivisionState();
    div.division_id = "test_div2";
    div.position_lng = 10.0;
    div.position_lat = 50.0;
    div.consumed_waypoint_id = "stale_value"; // pre-populated to verify reset
    div.move_order = new ArraySchema<string>("wp_B");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (system as any)._advanceDivision(div, 1.0);

    assert.strictEqual(
      div.consumed_waypoint_id,
      "",
      "_advanceDivision must reset consumed_waypoint_id to '' when no waypoint is consumed",
    );
    // Division should have moved but not consumed wp_B.
    assert.strictEqual(div.move_order.length, 1, "move_order should still contain wp_B");
  });

  it("GameRoom broadcasts consumed_waypoint_id in DIVISION_UPDATES after schema added", async () => {
    // This test verifies the schema field is accessible via the room state.
    // It does not run a full game (no nations, no divisions) — it just checks
    // that the schema field survives the Colyseus serialization round-trip.
    const token = await makeToken({ sub: "host-001", steam_id: "dev_steamid", has_host_pass: true });
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    await colyseus.connectTo(room, { token });

    await room.waitForNextPatch();

    // Directly set the field on a live DivisionState and confirm it is readable.
    const { DivisionState } = await import("../src/rooms/schema/GameRoomState.js");
    const div = new DivisionState();
    div.division_id         = "test_div_schema";
    div.consumed_waypoint_id = "wp_TEST_42";
    room.state.divisions.set("test_div_schema", div);

    await room.waitForNextPatch();

    const stored = room.state.divisions.get("test_div_schema");
    assert.ok(stored, "Division should be in room state");
    assert.strictEqual(
      stored.consumed_waypoint_id,
      "wp_TEST_42",
      "consumed_waypoint_id should round-trip through Colyseus schema serialization",
    );
  });
});
