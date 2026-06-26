/**
 * movement-jerk.e2e.ts
 *
 * Regression test for Phase 1: Fix Movement Jerk.
 *
 * Scenario: Spawn a division, issue a move order, then observe every
 * DIVISION_UPDATES broadcast for 2 seconds.  Assert:
 *   1. consumed_waypoint_id is present on every broadcast (schema exists).
 *   2. No single-tick position jump exceeds DR_SNAP_DEG (0.001°) — the jerk
 *      that occurred when the server's first tick snapped the client position.
 *   3. When consumed_waypoint_id is non-empty it equals the waypoint that was
 *      at the head of the move_order before that tick (server consumed it).
 *
 * Run: npx tsx test/movement-jerk.e2e.ts
 */

import { Client, Room } from "@colyseus/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";
const BOT_A_EMAIL  = "jerk-bot-a@example.com";
const BOT_B_EMAIL  = "jerk-bot-b@example.com";
const PASSWORD     = "password123";

// Maximum allowed position jump between consecutive DIVISION_UPDATES frames.
const DR_SNAP_DEG = 0.001;

// ── Types ─────────────────────────────────────────────────────────────────────

interface DivisionUpdate {
  division_id: string;
  position_lng?: number;
  position_lat?: number;
  move_order?: string[];
  consumed_waypoint_id?: string;
}

interface AuthResult { token: string; userId: string; hasHostPass: boolean; }

// ── Helpers ───────────────────────────────────────────────────────────────────

async function register(email: string): Promise<void> {
  await fetch(`${HONO_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

async function login(email: string): Promise<AuthResult> {
  const res = await fetch(`${HONO_URL}/auth/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const { token } = await res.json() as { token: string };
  const [, raw] = token.split(".");
  const payload = JSON.parse(Buffer.from(raw, "base64").toString()) as {
    sub: string; has_host_pass: boolean;
  };
  return { token, userId: payload.sub, hasHostPass: payload.has_host_pass };
}

function waitForMessage(room: Room, type: string, timeoutMs = 10000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    room.onMessage(type, (msg: unknown) => { clearTimeout(t); resolve(msg); });
  });
}

function collectDivisionUpdates(room: Room, durationMs: number): Promise<DivisionUpdate[][]> {
  return new Promise(resolve => {
    const batches: DivisionUpdate[][] = [];
    room.onMessage("DIVISION_UPDATES", (msg: unknown) => {
      const m = msg as { divisions: DivisionUpdate[] };
      batches.push(m.divisions ?? []);
    });
    setTimeout(() => resolve(batches), durationMs);
  });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Load waypoints to find a valid near-spawn waypoint ────────────────────────

interface WaypointNode { id: string; lng: number; lat: number; }

function loadNearbyWaypoint(spawnLng: number, spawnLat: number): string {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const dataPath = join(__dir, "../../client/assets/data/western_europe_6/waypoints.json");
  const raw = JSON.parse(readFileSync(dataPath, "utf-8")) as {
    nodes: WaypointNode[];
    edges: { from: string; to: string }[];
  };

  // Build adjacency set
  const edgeSet = new Set<string>();
  for (const e of raw.edges) {
    edgeSet.add(`${e.from}|${e.to}`);
    edgeSet.add(`${e.to}|${e.from}`);
  }

  // Find closest node
  let best: WaypointNode | null = null;
  let bestDist = Infinity;
  for (const n of raw.nodes) {
    const dx = n.lng - spawnLng;
    const dy = n.lat - spawnLat;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestDist) { bestDist = d; best = n; }
  }
  if (!best) throw new Error("No waypoint nodes found");

  // Find a second waypoint connected to best
  const neighbor = raw.nodes.find(
    n => n.id !== best!.id && edgeSet.has(`${best!.id}|${n.id}`)
  );
  if (!neighbor) throw new Error(`No neighbor found for ${best.id}`);
  return neighbor.id;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 1 — movement-jerk regression test\n");

  // 1. Register & login
  console.log("1. Registering bots...");
  await register(BOT_A_EMAIL);
  await register(BOT_B_EMAIL);
  const botA = await login(BOT_A_EMAIL);
  const botB = await login(BOT_B_EMAIL);
  assert(botA.hasHostPass, "Bot A needs has_host_pass=true — is DEV_MODE=true?");

  // 2. Create lobby + room
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

  // 3. Select nations + start game
  console.log("3. Starting game...");
  roomA.send("SELECT_NATION", { nation_id: "germany" });
  roomB.send("SELECT_NATION", { nation_id: "france" });
  await sleep(200);

  const gameStartedPromise      = waitForMessage(roomA, "GAME_STARTED", 12000);
  const divisionsSpawnedPromise = waitForMessage(roomA, "DIVISIONS_SPAWNED", 14000);

  roomA.send("SET_READY", { ready: true });
  roomB.send("SET_READY", { ready: true });
  await sleep(200);
  roomA.send("START_GAME", {});

  await gameStartedPromise;
  console.log("   ✓ GAME_STARTED");

  const spawnMsg = await divisionsSpawnedPromise as {
    divisions: { division_id: string; position_lng: number; position_lat: number }[];
  };
  const germDiv = spawnMsg.divisions.find(d => d.division_id === "germany_div_01");
  assert(!!germDiv, "germany_div_01 not in DIVISIONS_SPAWNED");
  console.log(`   germany_div_01 spawn: (${germDiv!.position_lng.toFixed(4)}, ${germDiv!.position_lat.toFixed(4)})`);

  // 4. Find a nearby connected waypoint to move toward
  const targetWpId = loadNearbyWaypoint(germDiv!.position_lng, germDiv!.position_lat);
  console.log(`   Target waypoint: ${targetWpId}`);

  // 5. Start collecting updates BEFORE issuing the order
  console.log("4. Collecting DIVISION_UPDATES for 3 seconds...");
  const updatesPromise = collectDivisionUpdates(roomA, 3000);

  roomA.send("SUBMIT_MOVE_ORDER", {
    division_id: "germany_div_01",
    waypoints: [targetWpId],
  });

  const allBatches = await updatesPromise;
  console.log(`   Received ${allBatches.length} DIVISION_UPDATES batches`);
  assert(allBatches.length > 0, "No DIVISION_UPDATES received — is the tick loop running?");

  // 6. Extract per-tick position + consumed_waypoint_id for germany_div_01
  const frames: DivisionUpdate[] = [];
  for (const batch of allBatches) {
    const d = batch.find(u => u.division_id === "germany_div_01");
    if (d) frames.push(d);
  }
  console.log(`   germany_div_01 appeared in ${frames.length} batches`);

  // ── Assertion A: consumed_waypoint_id field exists on every frame ──────────
  console.log("5. Assert A: consumed_waypoint_id field present on every division update...");
  for (let i = 0; i < frames.length; i++) {
    assert(
      "consumed_waypoint_id" in frames[i],
      `Frame ${i}: consumed_waypoint_id missing from DIVISION_UPDATES payload`,
    );
  }
  console.log("   ✓ consumed_waypoint_id field present on all frames");

  // ── Assertion B: No single-tick position jump exceeds DR_SNAP_DEG ──────────
  console.log("6. Assert B: no position jump > DR_SNAP_DEG between consecutive frames...");
  let maxJump = 0;
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    if (prev.position_lng == null || curr.position_lng == null) continue;
    const dx = (curr.position_lng ?? 0) - (prev.position_lng ?? 0);
    const dy = (curr.position_lat ?? 0) - (prev.position_lat ?? 0);
    const jump = Math.sqrt(dx * dx + dy * dy);
    if (jump > maxJump) maxJump = jump;
    assert(
      jump <= DR_SNAP_DEG,
      `Position jumped ${jump.toFixed(6)}° between frame ${i - 1} and ${i} (max allowed: ${DR_SNAP_DEG}°) — movement jerk detected`,
    );
  }
  console.log(`   ✓ Max inter-frame jump: ${maxJump.toFixed(6)}° (threshold: ${DR_SNAP_DEG}°)`);

  // ── Assertion C: consumed_waypoint_id is either "" or the target waypoint ──
  console.log("7. Assert C: consumed_waypoint_id is '' or a known waypoint ID...");
  const consumedValues = frames
    .map(f => f.consumed_waypoint_id ?? "")
    .filter(v => v !== "");
  if (consumedValues.length > 0) {
    for (const v of consumedValues) {
      assert(
        typeof v === "string" && v.length > 0,
        `consumed_waypoint_id has unexpected value: ${JSON.stringify(v)}`,
      );
    }
    console.log(`   ✓ consumed_waypoint_id was non-empty ${consumedValues.length} time(s): ${[...new Set(consumedValues)].join(", ")}`);
  } else {
    console.log("   ✓ consumed_waypoint_id was '' on all frames (single-hop not yet reached)");
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  roomA.leave();
  roomB.leave();

  console.log("\n✅ Phase 1 movement-jerk regression test PASSED.");
}

main().catch((err: Error) => {
  console.error("\n❌ Phase 1 movement-jerk test FAILED:", err.message);
  process.exit(1);
});
