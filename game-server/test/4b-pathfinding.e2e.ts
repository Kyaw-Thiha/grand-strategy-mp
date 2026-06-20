/**
 * Phase 4B end-to-end: path validation and off-road movement.
 *
 * Tests:
 *   1. Submit a valid multi-hop connected path → accepted, division moves
 *   2. Submit a path with non-connected waypoints → MOVE_ORDER_REJECTED
 *   3. Submit a path with a non-existent waypoint ID → MOVE_ORDER_REJECTED
 *   4. Submit a terrain-only path (tg_ nodes) → accepted (off-road movement)
 *
 * Run with: npx tsx test/4b-pathfinding.e2e.ts
 * Requires both servers running with DEV_MODE=true.
 */

import { Client, Room } from "@colyseus/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "e2e-4b-bot-a@example.com";
const BOT_B_EMAIL = "e2e-4b-bot-b@example.com";
const PASSWORD    = "password123";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR         = join(__dir, "../../client/assets/data/western_europe_6");
const WAYPOINTS_PATH   = join(DATA_DIR, "waypoints.json");
const TERRAIN_WP_PATH  = join(DATA_DIR, "waypoints_terrain.json");

interface WaypointNode { id: string; lng: number; lat: number }
interface WaypointEdge { from: string; to: string; base_cost: number; river_size: string | null }

let waypointData: { nodes: WaypointNode[]; edges: WaypointEdge[] };
let terrainData:  { nodes: WaypointNode[]; edges: WaypointEdge[] } | null = null;

function loadWaypoints() {
  waypointData = JSON.parse(readFileSync(WAYPOINTS_PATH, "utf-8")) as typeof waypointData;
  try {
    terrainData = JSON.parse(readFileSync(TERRAIN_WP_PATH, "utf-8")) as typeof terrainData;
  } catch {
    terrainData = null;
  }
}

/** Find nearest waypoint to (lng, lat) by sampling every 50th node. */
function findNearest(lng: number, lat: number): WaypointNode {
  let best = waypointData.nodes[0];
  let bestDist = Infinity;
  for (let i = 0; i < waypointData.nodes.length; i += 50) {
    const n = waypointData.nodes[i];
    const d = (n.lng - lng) ** 2 + (n.lat - lat) ** 2;
    if (d < bestDist) { bestDist = d; best = n; }
  }
  return best;
}

/** BFS to find a connected path of exactly `hops` edges from start node. */
function findConnectedPath(startId: string, hops: number): string[] {
  // Build adjacency for BFS
  const adj = new Map<string, string[]>();
  for (const e of waypointData.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to))   adj.set(e.to,   []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  const path = [startId];
  let current = startId;
  for (let i = 0; i < hops; i++) {
    const neighbors = adj.get(current) ?? [];
    if (neighbors.length === 0) break;
    // Pick neighbor not already in path
    const next = neighbors.find(n => !path.includes(n)) ?? neighbors[0];
    path.push(next);
    current = next;
  }
  return path;
}

/**
 * Find a connected path of `hops` edges consisting only of terrain grid (tg_) nodes.
 * Returns null if no terrain nodes exist in the graph.
 */
function findTerrainPath(hops = 3): string[] | null {
  if (!terrainData) return null;
  // Build adjacency from terrain-only edges (tg_ → tg_ only)
  const adj = new Map<string, string[]>();
  for (const e of terrainData.edges) {
    if (!e.from.startsWith("tg_") || !e.to.startsWith("tg_")) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to))   adj.set(e.to,   []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  for (const node of terrainData.nodes) {
    if (!node.id.startsWith("tg_")) continue;
    if (!adj.has(node.id)) continue;
    const path = [node.id];
    let current = node.id;
    for (let i = 0; i < hops - 1; i++) {
      const next = (adj.get(current) ?? []).find(n => !path.includes(n));
      if (!next) break;
      path.push(next);
      current = next;
    }
    if (path.length >= hops) return path;
  }
  return null;
}

/** Find two waypoints that are definitely NOT directly connected. */
function findDisconnectedPair(): [string, string] {
  const nodeIds = waypointData.nodes.map(n => n.id);
  const edgeSet = new Set(waypointData.edges.flatMap(e => [`${e.from}|${e.to}`, `${e.to}|${e.from}`]));
  // Take two nodes far apart (start and near-end of sorted list)
  const a = nodeIds[0];
  const b = nodeIds[Math.floor(nodeIds.length * 0.6)];
  // Verify they're not directly connected
  if (!edgeSet.has(`${a}|${b}`)) return [a, b];
  // Fallback: just use two very distant ones
  return [nodeIds[0], nodeIds[nodeIds.length - 1]];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function register(email: string): Promise<void> {
  const res = await fetch(`${HONO_URL}/auth/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`Register failed: ${res.status}`);
}

async function login(email: string): Promise<{ token: string; userId: string; hasHostPass: boolean }> {
  const res = await fetch(`${HONO_URL}/auth/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const { token } = await res.json() as { token: string };
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  return { token, userId: payload.sub, hasHostPass: payload.has_host_pass ?? false };
}

function waitForMessage(room: Room, type: string, timeoutMs = 10000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    room.onMessage(type, (msg: unknown) => { clearTimeout(timer); resolve(msg); });
  });
}

function collectMessages(room: Room, type: string, durationMs: number): Promise<unknown[]> {
  return new Promise(resolve => {
    const collected: unknown[] = [];
    room.onMessage(type, (msg: unknown) => collected.push(msg));
    setTimeout(() => resolve(collected), durationMs);
  });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4B — path validation and movement\n");

  console.log("Loading waypoints...");
  loadWaypoints();
  console.log(`   ${waypointData.nodes.length} road nodes, ${waypointData.edges.length} road edges`);
  if (terrainData) console.log(`   ${terrainData.nodes.length} terrain nodes, ${terrainData.edges.length} terrain edges`);

  // 1. Register + login
  console.log("1. Registering and logging in...");
  await register(BOT_A_EMAIL);
  await register(BOT_B_EMAIL);
  const botA = await login(BOT_A_EMAIL);
  const botB = await login(BOT_B_EMAIL);
  assert(botA.hasHostPass, "Bot A needs has_host_pass=true — is DEV_MODE=true?");

  // 2. Create room
  console.log("2. Creating lobby and room...");
  const createRes = await fetch(`${HONO_URL}/lobby/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${botA.token}` },
    body: JSON.stringify({}),
  });
  assert(createRes.ok, `POST /lobby/create failed: ${createRes.status}`);
  const { join_code } = await createRes.json() as { join_code: string };

  const clientA = new Client(COLYSEUS_URL);
  const roomA = await clientA.create("game_room", { token: botA.token });

  const activateRes = await fetch(`${HONO_URL}/lobby/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${botA.token}` },
    body: JSON.stringify({ join_code, room_id: roomA.roomId }),
  });
  assert(activateRes.ok, `POST /lobby/activate failed: ${activateRes.status}`);

  const resolveRes = await fetch(`${HONO_URL}/lobby/resolve/${join_code}`);
  const { room_id } = await resolveRes.json() as { room_id: string };
  const clientB = new Client(COLYSEUS_URL);
  const roomB = await clientB.joinById(room_id, { token: botB.token });

  // 3. Select nations + ready + start
  console.log("3. Starting game...");
  roomA.send("SELECT_NATION", { nation_id: "germany" });
  roomB.send("SELECT_NATION", { nation_id: "france" });
  await new Promise(r => setTimeout(r, 200));

  const gameStartedA = waitForMessage(roomA, "GAME_STARTED", 10000);
  const divisionsSpawnedA = waitForMessage(roomA, "DIVISIONS_SPAWNED", 12000);

  roomA.send("SET_READY", { ready: true });
  roomB.send("SET_READY", { ready: true });
  await new Promise(r => setTimeout(r, 200));
  roomA.send("START_GAME", {});

  await gameStartedA;
  console.log("   ✓ GAME_STARTED");

  const spawnMsg = await divisionsSpawnedA as { divisions: { division_id: string; position_lng: number; position_lat: number }[] };
  const germDiv = spawnMsg.divisions.find(d => d.division_id === "germany_div_01")!;
  assert(!!germDiv, "germany_div_01 not found");
  console.log(`   germany_div_01 spawn: (${germDiv.position_lng.toFixed(4)}, ${germDiv.position_lat.toFixed(4)})`);

  // 4. Find a valid multi-hop connected path from spawn
  console.log("4. Test: valid connected path → accepted...");
  const nearestNode = findNearest(germDiv.position_lng, germDiv.position_lat);
  const connectedPath = findConnectedPath(nearestNode.id, 4);
  console.log(`   Path: ${connectedPath.slice(0, 3).join(" → ")} ... (${connectedPath.length} hops)`);

  const updatesPromise = collectMessages(roomA, "DIVISION_UPDATES", 4000);
  let rejected = false;
  roomA.onMessage("MOVE_ORDER_REJECTED", (msg: unknown) => {
    console.error("   MOVE_ORDER_REJECTED:", JSON.stringify(msg));
    rejected = true;
  });

  roomA.send("SUBMIT_MOVE_ORDER", { division_id: "germany_div_01", waypoints: connectedPath });
  const updates = await updatesPromise as { divisions: { division_id: string }[] }[];
  assert(!rejected, "Valid connected path was rejected");
  assert(updates.length > 0, "No DIVISION_UPDATES received for valid path");
  console.log("   ✓ Valid path accepted, division moving");

  // 5. Test: disconnected waypoint pair → rejected
  console.log("5. Test: disconnected waypoint pair → rejected...");
  const [disconnA, disconnB] = findDisconnectedPair();
  console.log(`   Submitting disconnected pair: ${disconnA} | ${disconnB}`);

  let rejectedDisconn = false;
  roomA.onMessage("MOVE_ORDER_REJECTED", () => { rejectedDisconn = true; });
  roomA.send("SUBMIT_MOVE_ORDER", { division_id: "germany_div_01", waypoints: [disconnA, disconnB] });
  await new Promise(r => setTimeout(r, 1500));
  assert(rejectedDisconn, "Disconnected pair was not rejected");
  console.log("   ✓ Disconnected pair correctly rejected");

  // 6. Test: non-existent waypoint ID → rejected
  console.log("6. Test: non-existent waypoint → rejected...");
  let rejectedBadId = false;
  roomA.onMessage("MOVE_ORDER_REJECTED", () => { rejectedBadId = true; });
  roomA.send("SUBMIT_MOVE_ORDER", { division_id: "germany_div_01", waypoints: ["wp_FAKE_ID_99999"] });
  await new Promise(r => setTimeout(r, 1500));
  assert(rejectedBadId, "Non-existent waypoint was not rejected");
  console.log("   ✓ Non-existent waypoint correctly rejected");

  // 7. Test: terrain-only path (tg_ nodes) → accepted (off-road movement)
  console.log("7. Test: terrain-only path (off-road tg_ nodes) → accepted...");
  const terrainPath = findTerrainPath(3);
  assert(
    terrainPath !== null,
    "No terrain (tg_) nodes found in waypoints.json — pipeline may not have generated terrain grid",
  );
  console.log(`   Terrain path: ${terrainPath!.slice(0, 3).join(" → ")}`);

  let rejectedTerrain = false;
  roomA.onMessage("MOVE_ORDER_REJECTED", () => { rejectedTerrain = true; });
  roomA.send("SUBMIT_MOVE_ORDER", { division_id: "germany_div_01", waypoints: terrainPath! });
  await new Promise(r => setTimeout(r, 2000));
  assert(!rejectedTerrain, "Terrain-only path was unexpectedly rejected — off-road movement broken");
  console.log("   ✓ Terrain path accepted — off-road movement works");

  // ── Cleanup ───────────────────────────────────────────────────────────────
  roomA.leave();
  roomB.leave();

  console.log("\n✅ Phase 4B e2e passed.");
}

main().catch((err) => {
  console.error("\n❌ Phase 4B e2e failed:", err.message);
  process.exit(1);
});
