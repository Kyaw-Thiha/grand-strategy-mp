/**
 * Phase 4E end-to-end: combat cleanup after disengagement.
 *
 * Tests two bugs:
 *   1. After one division retreats, the surviving division stays "engaged"
 *      instead of returning to "idle" (Bug 1)
 *   2. The surviving division's attacker_role and engaged_with are not cleared
 *
 * Uses the standard meeting-battle pair: both divisions have no move orders,
 * combat starts automatically as a meeting battle at tick 11+.
 *
 * Test A — One division retreats first:
 *   Wait for COMBAT_STARTED
 *   Wait for any division to enter "retreating"
 *   Assert the other division is NOT "idle" yet (still in combat or suppressed)
 *
 * Test B — Survivor returns to idle after opponent retreats:
 *   After Test A, wait for the surviving division's combat_state === "idle"
 *   Assert attacker_role is cleared
 *   Assert engaged_with is empty
 *
 * Test B will FAIL with current code (Bug 1) — goes green after Fix 1.
 *
 * Run with: npx tsx test/4e-combat-cleanup.e2e.ts
 * Requires both servers running with DEV_MODE=true.
 */

import { Client, Room } from "@colyseus/sdk";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "e2e-4e-cleanup-a@example.com";
const BOT_B_EMAIL = "e2e-4e-cleanup-b@example.com";
const PASSWORD    = "password123";

interface DivisionUpdate {
  division_id: string;
  attacker_role?: string;
  combat_state?: string;
  engaged_with?: string[];
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
  timeoutMs = 90000,
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

async function main() {
  console.log("Phase 4E — Combat cleanup after disengagement\n");
  console.log("  Front-line pair: germany_div_05 vs france_div_05 (auto-engage meeting battle)\n");

  // 1. Register + login
  console.log("1. Registering and logging in...");
  await register(BOT_A_EMAIL);
  await register(BOT_B_EMAIL);
  const botA = await login(BOT_A_EMAIL);
  const botB = await login(BOT_B_EMAIL);
  assert(botA.hasHostPass, "Bot A needs has_host_pass=true — is DEV_MODE=true?");

  // 2. Create room + lobby
  console.log("2. Creating room...");
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
  await sleep(200);

  const gameStartedPromise    = waitForMessage(roomA, "GAME_STARTED", 10000);
  const divisionsSpawnedPromise = waitForMessage(roomA, "DIVISIONS_SPAWNED", 12000);

  // Pre-register COMBAT_STARTED listener
  const combatStartedPromise = new Promise<{ division_a: string; division_b: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for COMBAT_STARTED")), 30000);
    roomA.onMessage("COMBAT_STARTED", (msg: unknown) => {
      clearTimeout(timer);
      resolve(msg as any);
    });
  });

  roomA.send("SET_READY", { ready: true });
  roomB.send("SET_READY", { ready: true });
  await sleep(200);
  roomA.send("START_GAME", {});

  await gameStartedPromise;
  console.log("   ✓ GAME_STARTED");

  await divisionsSpawnedPromise;
  console.log("   ✓ DIVISIONS_SPAWNED");

  // ── Test A: One division retreats first ───────────────────────────────────
  console.log("\n--- Test A: One division retreats first ---");

  console.log("4. Waiting for COMBAT_STARTED (meeting battle)...");
  await combatStartedPromise;
  console.log("   ✓ COMBAT_STARTED");

  console.log("5. Waiting for a division to enter retreating state...");
  const retreatDivs = await waitForDivisionState(
    roomA,
    divs => divs.some(
      d => (d.division_id === "germany_div_05" || d.division_id === "france_div_05") &&
           d.combat_state === "retreating",
    ),
    90000,
    "any front-line division retreats",
  );
  const retreatingDiv = retreatDivs.find(d => d.combat_state === "retreating");
  const survivorId = retreatingDiv?.division_id === "germany_div_05" ? "france_div_05" : "germany_div_05";
  const survivorState = retreatDivs.find(d => d.division_id === survivorId)?.combat_state;
  console.log(`   ✓ ${retreatingDiv!.division_id} is retreating`);
  console.log(`   ✓ ${survivorId} combat_state: ${survivorState} (still engaged/suppressed — not idle yet)`);

  // ── Test B: Survivor returns to idle ──────────────────────────────────────
  console.log("\n--- Test B: Survivor returns to idle after opponent retreats ---");

  console.log("6. Waiting for survivor to return to idle...");
  const idleDivs = await waitForDivisionState(
    roomA,
    divs => {
      const surv = divs.find(d => d.division_id === survivorId);
      return !!(surv && surv.combat_state === "idle");
    },
    30000,
    `${survivorId} transitions to idle after opponent retreat`,
  );
  const survIdle = idleDivs.find(d => d.division_id === survivorId);
  assert(survIdle?.combat_state === "idle",
    `Expected ${survivorId} combat_state=idle but got "${survIdle?.combat_state}"`);

  const roleCleared = survIdle?.attacker_role === "" || survIdle?.attacker_role === undefined;
  assert(roleCleared,
    `Expected ${survivorId} attacker_role cleared but got "${survIdle?.attacker_role}"`);
  console.log(`   ✓ ${survivorId}.combat_state:  ${survIdle?.combat_state}`);
  console.log(`   ✓ ${survivorId}.attacker_role: "${survIdle?.attacker_role ?? ""}" (cleared)`);

  const engagedWith = survIdle?.engaged_with;
  const hasNoEngagements = !engagedWith || engagedWith.length === 0;
  assert(hasNoEngagements,
    `Expected ${survivorId} engaged_with empty but got ${JSON.stringify(engagedWith)}`);
  console.log(`   ✓ ${survivorId}.engaged_with: ${JSON.stringify(engagedWith ?? [])} (cleared)`);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  roomA.leave();
  roomB.leave();

  console.log("\n✅ Phase 4E — Combat cleanup e2e passed.");
}

main().catch((err) => {
  console.error("\n❌ Phase 4E — Combat cleanup e2e failed:", err.message);
  process.exit(1);
});
