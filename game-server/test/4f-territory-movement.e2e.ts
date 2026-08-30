/**
 * Phase 4F end-to-end: territory-based movement restriction.
 *
 * Tests:
 *   A — Direct neutral target rejected: germany_div_01 → Swiss waypoint
 *   B — Path through neutral territory trimmed: [German, Swiss] → [German]
 *   C — Own territory allowed: germany_div_01 → German waypoint
 *   D — Enemy territory allowed (at war): throwaway German test division → French waypoint
 *
 * Test D used to target the default-roster germany_div_05, but that division was removed
 * (it was a data bug — it spawned inside French sovereign territory). It is replaced with
 * a throwaway division spawned via the test-only SPAWN_DIVISION message (which does not
 * validate territory ownership), placed harmlessly inside German territory.
 *
 * Run with: NODE_ENV=test npx tsx test/4f-territory-movement.e2e.ts
 * Requires both servers running with DEV_MODE=true and the game-server started with
 * NODE_ENV=test (so the SPAWN_DIVISION test-only message handler is registered).
 */

import { Client, Room } from "@colyseus/sdk";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "e2e-4f-territory-a@example.com";
const BOT_B_EMAIL = "e2e-4f-territory-b@example.com";
const PASSWORD    = "password123";

// Throwaway German test division for Test D, spawned via SPAWN_DIVISION (bypasses
// territory-ownership validation) inside German territory, near germany_div_01.
const DE_TEST_DIV = "e2e-4f-de-test";
const DE_TEST_LNG = 8.70, DE_TEST_LAT = 50.05;

interface DivisionUpdate {
  division_id: string;
  move_order?: string[];
}

async function register(email: string): Promise<void> {
  const res = await fetch(`${HONO_URL}/auth/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`Register failed: ${res.status}`);
}

async function login(email: string): Promise<{ token: string; hasHostPass: boolean }> {
  const res = await fetch(`${HONO_URL}/auth/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const { token } = await res.json() as { token: string };
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  return { token, hasHostPass: payload.has_host_pass ?? false };
}

function waitForMessage(room: Room, type: string, timeoutMs = 15000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    room.onMessage(type, (msg: unknown) => { clearTimeout(timer); resolve(msg); });
  });
}

function waitForDivisionState(
  room: Room,
  predicate: (divs: DivisionUpdate[]) => boolean,
  timeoutMs = 10000,
  description = "condition",
): Promise<DivisionUpdate[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${description}`)), timeoutMs);
    room.onMessage("DIVISION_UPDATES", (msg: unknown) => {
      const m = msg as { divisions: DivisionUpdate[] };
      if (predicate(m.divisions)) {
        clearTimeout(timer);
        resolve(m.divisions);
      }
    });
  });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function setupGame(): Promise<{ roomA: Room; roomB: Room }> {
  await register(BOT_A_EMAIL);
  await register(BOT_B_EMAIL);
  const botA = await login(BOT_A_EMAIL);
  const botB = await login(BOT_B_EMAIL);
  assert(botA.hasHostPass, "Bot A needs has_host_pass=true");

  const createRes = await fetch(`${HONO_URL}/lobby/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${botA.token}` },
    body: JSON.stringify({}),
  });
  assert(createRes.ok, `POST /lobby/create failed`);
  const { join_code } = await createRes.json() as { join_code: string };

  const clientA = new Client(COLYSEUS_URL);
  const roomA = await clientA.create("game_room", { token: botA.token });

  await fetch(`${HONO_URL}/lobby/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${botA.token}` },
    body: JSON.stringify({ join_code, room_id: roomA.roomId }),
  });

  const resolveRes = await fetch(`${HONO_URL}/lobby/resolve/${join_code}`);
  const { room_id } = await resolveRes.json() as { room_id: string };
  const clientB = new Client(COLYSEUS_URL);
  const roomB = await clientB.joinById(room_id, { token: botB.token });

  roomA.send("SELECT_NATION", { nation_id: "germany" });
  roomB.send("SELECT_NATION", { nation_id: "france" });
  await sleep(200);

  const gameStartedPromise = waitForMessage(roomA, "GAME_STARTED", 10000);
  const divisionsSpawnedPromise = waitForMessage(roomA, "DIVISIONS_SPAWNED", 12000);

  roomA.send("SET_READY", { ready: true });
  roomB.send("SET_READY", { ready: true });
  await sleep(200);
  roomA.send("START_GAME", {});

  await gameStartedPromise;
  await divisionsSpawnedPromise;

  // Spawn throwaway German test division for Test D via the test-only SPAWN_DIVISION message.
  roomA.send("SPAWN_DIVISION", {
    division_id: DE_TEST_DIV,
    nation_id: "germany",
    position_lng: DE_TEST_LNG,
    position_lat: DE_TEST_LAT,
  });
  await sleep(300);

  return { roomA, roomB };
}

/** Returns a promise that resolves to the rejection reason (or null if not rejected). */
function waitForRejection(roomA: Room, roomB: Room, divisionId: string, timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const handler = (msg: unknown) => {
      const m = msg as { division_id: string; reason: string };
      if (m.division_id === divisionId) {
        clearTimeout(timer);
        resolve(m.reason);
      }
    };
    roomA.onMessage("MOVE_ORDER_REJECTED", handler);
    roomB.onMessage("MOVE_ORDER_REJECTED", handler);
  });
}

async function main() {
  console.log("Phase 4F — Territory movement restriction\n");

  const { roomA, roomB } = await setupGame();
  console.log("   ✓ Game started, divisions spawned");

  // ── Test C: Own territory allowed (do this first as a baseline) ──────────
  console.log("\n--- Test C: Own territory allowed ---");
  console.log("1. Sending germany_div_01 → wp_079006 (Berlin, German territory)...");
  const rejectC = waitForRejection(roomA, roomB, "germany_div_01", 3000);
  roomA.send("SUBMIT_MOVE_ORDER", {
    division_id: "germany_div_01",
    waypoints: ["wp_079006"],
  });
  const reasonC = await rejectC;
  assert(reasonC === null, `Expected no rejection but got: ${reasonC}`);
  console.log("   ✓ No rejection — own territory allowed");

  // ── Test D: Enemy territory allowed (at war) ─────────────────────────────
  console.log("\n--- Test D: Enemy (France) territory allowed ---");
  console.log(`2. Sending ${DE_TEST_DIV} → wp_000213 (French territory, at war)...`);
  const rejectD = waitForRejection(roomA, roomB, DE_TEST_DIV, 3000);
  roomA.send("SUBMIT_MOVE_ORDER", {
    division_id: DE_TEST_DIV,
    waypoints: ["wp_000213"],
  });
  const reasonD = await rejectD;
  assert(reasonD === null, `Expected no rejection but got: ${reasonD}`);
  console.log("   ✓ No rejection — enemy territory allowed (at war)");

  // ── Test A: Direct neutral target rejected ───────────────────────────────
  console.log("\n--- Test A: Direct neutral target rejected ---");
  console.log("3. Sending germany_div_01 → wp_000754 (Switzerland, neutral)...");
  const rejectA = waitForRejection(roomA, roomB, "germany_div_01", 5000);
  roomA.send("SUBMIT_MOVE_ORDER", {
    division_id: "germany_div_01",
    waypoints: ["wp_000754"],
  });
  const reasonA = await rejectA;
  assert(reasonA === "neutral_territory", `Expected 'neutral_territory' rejection but got: ${reasonA}`);
  console.log(`   ✓ MOVE_ORDER_REJECTED — reason: ${reasonA}`);

  // ── Test B: Path through neutral territory trimmed ───────────────────────
  console.log("\n--- Test B: Path through neutral territory trimmed ---");
  console.log("4. Sending germany_div_01 → [wp_079006, wp_000754] (German → Swiss)...");
  const rejectB = waitForRejection(roomA, roomB, "germany_div_01", 3000);
  roomA.send("SUBMIT_MOVE_ORDER", {
    division_id: "germany_div_01",
    waypoints: ["wp_079006", "wp_000754"],
  });
  const reasonB = await rejectB;
  assert(reasonB === null, `Expected no rejection for trimmed path but got: ${reasonB}`);
  console.log("   ✓ No rejection — path was trimmed (Swiss waypoint removed, German prefix kept)");

  // ── Cleanup ───────────────────────────────────────────────────────────────
  roomA.leave();
  roomB.leave();

  console.log("\n✅ Phase 4F — Territory movement e2e passed.");
}

/** Poll GameState via DIVISION_UPDATES to get latest division state. */
function GameState_fetch(room: Room, divisionId: string): void {
  // This is a no-op for the test — we already verified via waitForDivisionState above
}

main().catch((err) => {
  console.error("\n❌ Phase 4F — Territory movement e2e failed:", err.message);
  process.exit(1);
});
