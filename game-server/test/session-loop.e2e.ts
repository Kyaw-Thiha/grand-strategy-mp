/**
 * End-to-end: full session loop — create lobby → join → pick nations → start → end.
 *
 * Two TypeScript bots exercise the complete Phase 3 flow:
 *   Bot A (host): register → login → /lobby/create → create Colyseus room →
 *                 /lobby/activate → SELECT_NATION → SET_READY → START_GAME → END_GAME
 *   Bot B (joiner): register → login → /lobby/resolve → join Colyseus room →
 *                   SELECT_NATION → SET_READY → (waits for GAME_STARTED / GAME_ENDED)
 *
 * Requires both servers running with DEV_MODE=true:
 *   api-server:  bun run src/index.ts   (port 3000)
 *   game-server: npm start              (port 2567)
 *
 * Run with: npx tsx test/session-loop.e2e.ts
 */

import { Client, Room } from "@colyseus/sdk";

const HONO_URL    = process.env.HONO_URL    ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "e2e-bot-a@example.com";
const BOT_B_EMAIL = "e2e-bot-b@example.com";
const PASSWORD    = "password123";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function register(email: string): Promise<void> {
  const res = await fetch(`${HONO_URL}/auth/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok && res.status !== 409) {
    // 409 = already exists, that's fine for re-runs
    throw new Error(`Register failed for ${email}: ${res.status} ${await res.text()}`);
  }
}

async function login(email: string): Promise<{ token: string; userId: string; hasHostPass: boolean }> {
  const res = await fetch(`${HONO_URL}/auth/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status} ${await res.text()}`);
  const { token } = await res.json() as { token: string };
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  return { token, userId: payload.sub, hasHostPass: payload.has_host_pass ?? false };
}

function waitForMessage(room: Room, type: string, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs);
    room.onMessage(type, (msg: unknown) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── Step 1: Register both bots ────────────────────────────────────────────
  console.log("1. Registering bots...");
  await register(BOT_A_EMAIL);
  await register(BOT_B_EMAIL);
  console.log("   ✓ Registered (or already exist)");

  // ── Step 2: Login both bots ───────────────────────────────────────────────
  console.log("2. Logging in...");
  const botA = await login(BOT_A_EMAIL);
  const botB = await login(BOT_B_EMAIL);
  console.log(`   ✓ Bot A: ${botA.userId}  has_host_pass=${botA.hasHostPass}`);
  console.log(`   ✓ Bot B: ${botB.userId}`);
  assert(botA.hasHostPass, "Bot A must have has_host_pass=true — is DEV_MODE=true set?");

  // ── Step 3: Bot A creates a lobby ─────────────────────────────────────────
  console.log("3. Bot A creating lobby...");
  const createRes = await fetch(`${HONO_URL}/lobby/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${botA.token}` },
    body: JSON.stringify({}),
  });
  assert(createRes.ok, `POST /lobby/create failed: ${createRes.status}`);
  const { join_code } = await createRes.json() as { join_code: string };
  console.log(`   ✓ Join code: ${join_code}`);

  // ── Step 4: Bot A creates Colyseus room ───────────────────────────────────
  console.log("4. Bot A creating Colyseus room...");
  const clientA = new Client(COLYSEUS_URL);
  const roomA = await clientA.create("game_room", { token: botA.token });
  console.log(`   ✓ Room created: ${roomA.roomId}  session: ${roomA.sessionId}`);

  // ── Step 5: Bot A activates lobby (links room_id to join code) ────────────
  console.log("5. Bot A activating lobby...");
  const activateRes = await fetch(`${HONO_URL}/lobby/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${botA.token}` },
    body: JSON.stringify({ join_code, room_id: roomA.roomId }),
  });
  assert(activateRes.ok, `POST /lobby/activate failed: ${activateRes.status}`);
  console.log("   ✓ Lobby activated");

  // ── Step 6: Bot B resolves join code and joins room ───────────────────────
  console.log("6. Bot B resolving join code and joining...");
  const resolveRes = await fetch(`${HONO_URL}/lobby/resolve/${join_code}`);
  assert(resolveRes.ok, `GET /lobby/resolve failed: ${resolveRes.status}`);
  const { room_id } = await resolveRes.json() as { room_id: string };
  assert(room_id === roomA.roomId, "Resolved room_id must match Bot A's room");

  const clientB = new Client(COLYSEUS_URL);
  const roomB = await clientB.joinById(room_id, { token: botB.token });
  console.log(`   ✓ Bot B joined: session ${roomB.sessionId}`);

  // ── Step 7: Both bots select nations ─────────────────────────────────────
  console.log("7. Selecting nations...");
  roomA.send("SELECT_NATION", { nation_id: "united_kingdom" });
  roomB.send("SELECT_NATION", { nation_id: "france" });
  await new Promise(r => setTimeout(r, 200));
  console.log("   ✓ Nations selected");

  // ── Step 8: Both bots set ready ───────────────────────────────────────────
  console.log("8. Setting ready...");
  const gameStartedA = waitForMessage(roomA, "GAME_STARTED");
  const gameStartedB = waitForMessage(roomB, "GAME_STARTED");

  roomA.send("SET_READY", { ready: true });
  roomB.send("SET_READY", { ready: true });
  await new Promise(r => setTimeout(r, 200));

  // ── Step 9: Host starts the game ─────────────────────────────────────────
  console.log("9. Bot A starting game...");
  roomA.send("START_GAME", {});

  const [startMsgA, startMsgB] = await Promise.all([gameStartedA, gameStartedB]);
  console.log("   ✓ GAME_STARTED received by both bots");
  console.log("   Bot A payload:", JSON.stringify(startMsgA));

  const startData = startMsgA as { nation_assignments: Record<string, string> };
  assert(
    typeof startData.nation_assignments === "object",
    "GAME_STARTED must include nation_assignments"
  );

  // ── Step 10: Host ends the game ───────────────────────────────────────────
  console.log("10. Bot A ending game...");
  const gameEndedA = waitForMessage(roomA, "GAME_ENDED");
  const gameEndedB = waitForMessage(roomB, "GAME_ENDED");

  roomA.send("END_GAME", {});

  const [endMsgA] = await Promise.all([gameEndedA, gameEndedB]);
  console.log("    ✓ GAME_ENDED received by both bots");
  console.log("    End payload:", JSON.stringify(endMsgA));

  // ── Step 11: Verify lobby cleaned up from public list ─────────────────────
  console.log("11. Checking /lobby/public is clean...");
  await new Promise(r => setTimeout(r, 300));
  const publicRes = await fetch(`${HONO_URL}/lobby/public`);
  const publicLobbies = await publicRes.json() as { join_code: string }[];
  const stillListed = publicLobbies.some(l => l.join_code === join_code);
  assert(!stillListed, "Ended lobby must be removed from /lobby/public");
  console.log("    ✓ Lobby removed from public list");

  // ── Cleanup ───────────────────────────────────────────────────────────────
  roomA.leave();
  roomB.leave();

  console.log("\n✅ Session loop e2e passed.");
}

main().catch((err) => {
  console.error("\n❌ Session loop e2e failed:", err.message);
  process.exit(1);
});
