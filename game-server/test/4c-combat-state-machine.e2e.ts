/**
 * Phase 4C — combat state machine e2e tests.
 *
 * Tests the full state transition: engaged → suppressed → retreating.
 * Uses a throwaway front-line pair spawned via the test-only SPAWN_DIVISION message (which
 * does not validate territory ownership), placed at the same Sarreguemines/Metz coordinates
 * previously used by the (now-removed) default-roster pair: ~37 km apart, auto-engage.
 *
 * Tests:
 *   A. "suppressed" combat_state appears in DIVISION_UPDATES before "retreating"
 *   B. A suppressed division deals 0 damage (enemy suppression stops increasing)
 *   C. Manual RETREAT command transitions a division to "retreating" (regression guard)
 *
 * Run with: NODE_ENV=test npx tsx test/4c-combat-state-machine.e2e.ts
 * Requires both servers running with DEV_MODE=true and the game-server started with
 * NODE_ENV=test (so the SPAWN_DIVISION test-only message handler is registered).
 */

import { Client, Room } from "@colyseus/sdk";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "e2e-sm-bot-a@example.com";
const BOT_B_EMAIL = "e2e-sm-bot-b@example.com";
const PASSWORD    = "password123";

// Throwaway test divisions spawned via SPAWN_DIVISION (bypasses territory-ownership
// validation) at the old Sarreguemines / Metz coordinates.
const DE_DIV = "e2e-sm-de-front";
const FR_DIV = "e2e-sm-fr-front";
const DE_LNG = 6.500, DE_LAT = 49.190; // Sarreguemines
const FR_LNG = 6.175, FR_LAT = 49.123; // Metz

// ── Types ─────────────────────────────────────────────────────────────────────

interface DivisionUpdate {
  division_id: string;
  combat_state?: string;
  suppression?: number;
  hp?: number;
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

/** Resolves when a DIVISION_UPDATES message satisfies predicate, returning the matching batch. */
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
      if (predicate(m.divisions)) { clearTimeout(timer); resolve(m.divisions); }
    });
  });
}

/** Returns the most-recently-seen values for a division across all DIVISION_UPDATES messages. */
function trackDivisionState(room: Room, divisionId: string): { current: DivisionUpdate } {
  const tracker = { current: { division_id: divisionId } as DivisionUpdate };
  room.onMessage("DIVISION_UPDATES", (msg: unknown) => {
    const m = msg as { divisions: DivisionUpdate[] };
    const found = m.divisions.find(d => d.division_id === divisionId);
    if (found) Object.assign(tracker.current, found);
  });
  return tracker;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Shared game setup ─────────────────────────────────────────────────────────

async function setupGame(): Promise<{ roomA: Room; roomB: Room }> {
  await register(BOT_A_EMAIL);
  await register(BOT_B_EMAIL);
  const botA = await login(BOT_A_EMAIL);
  const botB = await login(BOT_B_EMAIL);
  assert(botA.hasHostPass, "Bot A needs has_host_pass=true — is DEV_MODE=true?");

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

  roomA.send("SELECT_NATION", { nation_id: "germany" });
  roomB.send("SELECT_NATION", { nation_id: "france" });
  await sleep(200);

  const gameStartedPromise    = waitForMessage(roomA, "GAME_STARTED", 10000);
  const divisionsSpawnedPromise = waitForMessage(roomA, "DIVISIONS_SPAWNED", 12000);

  roomA.send("SET_READY", { ready: true });
  roomB.send("SET_READY", { ready: true });
  await sleep(200);
  roomA.send("START_GAME", {});

  await gameStartedPromise;
  await divisionsSpawnedPromise;

  // Spawn our own throwaway front-line pair via the test-only SPAWN_DIVISION message.
  roomA.send("SPAWN_DIVISION", { division_id: DE_DIV, nation_id: "germany", position_lng: DE_LNG, position_lat: DE_LAT });
  roomB.send("SPAWN_DIVISION", { division_id: FR_DIV, nation_id: "france", position_lng: FR_LNG, position_lat: FR_LAT });
  await sleep(300);

  // Wait for COMBAT_STARTED on the front-line pair before running individual tests
  await waitForMessage(roomA, "COMBAT_STARTED", 20000);

  return { roomA, roomB };
}

// ── Test A — "suppressed" state appears before "retreating" ───────────────────

async function testA_suppressedStateBeforeRetreat(): Promise<void> {
  console.log("\nTest A: 'suppressed' state appears in DIVISION_UPDATES before 'retreating'");

  const { roomA, roomB } = await setupGame();

  // Must see "suppressed" — will timeout and fail if server skips straight to "retreating"
  const suppressedDivs = await waitForDivisionState(
    roomA,
    divs => divs.some(
      d => (d.division_id === DE_DIV || d.division_id === FR_DIV)
        && d.combat_state === "suppressed",
    ),
    90000,
    "a front-line division enters 'suppressed' state",
  );

  const suppressed = suppressedDivs.find(d => d.combat_state === "suppressed");
  assert(!!suppressed, "No division reached 'suppressed' state");
  console.log(`   ✓ ${suppressed!.division_id} entered 'suppressed' state`);

  // Now confirm "retreating" comes next (not some other state)
  const retreatDivs = await waitForDivisionState(
    roomA,
    divs => divs.some(
      d => d.division_id === suppressed!.division_id && d.combat_state === "retreating",
    ),
    10000,
    `${suppressed!.division_id} transitions to 'retreating'`,
  );
  const retreating = retreatDivs.find(d => d.division_id === suppressed!.division_id);
  assert(retreating?.combat_state === "retreating", "Division did not transition to 'retreating' after 'suppressed'");
  console.log(`   ✓ ${suppressed!.division_id} then transitioned to 'retreating'`);

  roomA.leave();
  roomB.leave();
  await sleep(500);
}

// ── Test B — suppressed division deals 0 damage ───────────────────────────────

async function testB_suppressedDealsNoDamage(): Promise<void> {
  console.log("\nTest B: suppressed division deals 0 damage (enemy suppression stops increasing)");

  const { roomA, roomB } = await setupGame();

  // Wait for one division to enter "suppressed"
  const suppressedDivs = await waitForDivisionState(
    roomA,
    divs => divs.some(
      d => (d.division_id === DE_DIV || d.division_id === FR_DIV)
        && d.combat_state === "suppressed",
    ),
    90000,
    "a division enters 'suppressed'",
  );

  const suppressedDiv = suppressedDivs.find(d => d.combat_state === "suppressed")!;
  // The enemy is the OTHER division
  const enemyId = suppressedDiv.division_id === DE_DIV ? FR_DIV : DE_DIV;

  // Record the enemy's suppression at this instant from the same batch
  const enemyInBatch = suppressedDivs.find(d => d.division_id === enemyId);
  const suppressionAtSuppressedMoment = enemyInBatch?.suppression ?? 0;
  console.log(`   ${suppressedDiv.division_id} suppressed; enemy ${enemyId} suppression = ${suppressionAtSuppressedMoment.toFixed(1)}%`);

  // Track enemy suppression over next 3 ticks
  const enemyTracker = trackDivisionState(roomA, enemyId);
  await sleep(3500); // 3+ ticks

  const suppressionAfter = enemyTracker.current.suppression ?? suppressionAtSuppressedMoment;
  const delta = suppressionAfter - suppressionAtSuppressedMoment;
  console.log(`   Enemy ${enemyId} suppression after 3 ticks: ${suppressionAfter.toFixed(1)}% (delta: ${delta.toFixed(1)})`);

  // Allow a tiny floating-point tolerance but it must not be meaningfully increasing.
  // One suppressed tick = 0 outgoing damage, so delta must be ≤ 0.01.
  assert(delta <= 0.01, `Enemy suppression increased by ${delta.toFixed(2)} while attacker was suppressed — suppressed divisions must deal 0 damage`);
  console.log("   ✓ Enemy suppression did not increase while attacker was suppressed");

  roomA.leave();
  roomB.leave();
  await sleep(500);
}

// ── Test C — manual RETREAT command (regression guard) ───────────────────────

async function testC_manualRetreatCommand(): Promise<void> {
  console.log("\nTest C: manual RETREAT command transitions engaged division to 'retreating'");

  const { roomA, roomB } = await setupGame();

  // Wait for engagement to be confirmed (COMBAT_STARTED already fired in setupGame,
  // but we need to wait for a DIVISION_UPDATES showing the "engaged" state)
  await waitForDivisionState(
    roomA,
    divs => divs.some(
      d => d.division_id === DE_DIV && d.combat_state === "engaged",
    ),
    15000,
    `${DE_DIV} is 'engaged'`,
  );
  console.log(`   ${DE_DIV} is engaged — sending RETREAT`);

  // Bot A controls Germany — send RETREAT for the German test division
  roomA.send("RETREAT", { division_id: DE_DIV });

  const retreatDivs = await waitForDivisionState(
    roomA,
    divs => divs.some(d => d.division_id === DE_DIV && d.combat_state === "retreating"),
    8000,
    `${DE_DIV} enters 'retreating'`,
  );
  const retreating = retreatDivs.find(d => d.division_id === DE_DIV);
  assert(retreating?.combat_state === "retreating", `${DE_DIV} did not enter 'retreating' after RETREAT command`);
  console.log("   ✓ Manual RETREAT command correctly transitions division to 'retreating'");

  roomA.leave();
  roomB.leave();
  await sleep(500);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4C — Combat State Machine e2e tests");
  console.log(`  Front-line pair: ${DE_DIV} (Sarreguemines) vs ${FR_DIV} (Metz)`);
  console.log("  Auto-engage: ~37 km apart, within 50 km engagement range\n");

  await testA_suppressedStateBeforeRetreat();
  await testB_suppressedDealsNoDamage();
  await testC_manualRetreatCommand();

  console.log("\n✅ All combat state machine tests passed.");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\n❌ Combat state machine tests failed:", message);
  process.exit(1);
});
