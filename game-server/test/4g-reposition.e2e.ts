/**
 * Phase 4G end-to-end: reposition during combat, river crossing penalty, hold fix.
 *
 * Uses a throwaway German test division vs a throwaway French test division, spawned via the
 * test-only SPAWN_DIVISION message (which does not validate territory ownership) at the old
 * Sarreguemines (6.500°E 49.190°N) / Metz (6.175°E 49.123°N) coordinates — spawn ~37 km apart,
 * within the 50 km engagement range. No MOVE order needed — both sides auto-engage as meeting
 * battle (60% threshold).
 *
 * Distance cap: the server no longer enforces a fixed repos distance. The client-side
 * engagement-boundary truncation handles path capping. The server accepts any valid reposition
 * path as long as the division is within (Ra + Rb) of its engaged enemies.
 *
 * Tests (ordered so combat-active tests run before combat ends):
 *   A — Reposition accepted during combat (reposition_order populated)
 *   D — Reposition accepted with far-away waypoint (server accepts, client-side truncates)
 *   B — Reposition clears after combat ends
 *   C — Reposition rejected when not in combat
 *   E — Hold broadcasts update (move_order cleared, client learns)
 *
 * Run with: NODE_ENV=test npx tsx test/4g-reposition.e2e.ts
 * Requires both servers running with DEV_MODE=true and the game-server started with
 * NODE_ENV=test (so the SPAWN_DIVISION test-only message handler is registered).
 */

import { Client, Room } from "@colyseus/sdk";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "e2e-4g-bot-a@example.com";
const BOT_B_EMAIL = "e2e-4g-bot-b@example.com";
const PASSWORD    = "password123";

// Throwaway test divisions spawned via SPAWN_DIVISION (bypasses territory-ownership
// validation) at the old Sarreguemines / Metz coordinates — preserves the ~37 km
// engagement-range distance and the ~4.4 km proximity of wp_070996 used in Test A.
const DE_DIV = "e2e-4g-de-front";
const FR_DIV = "e2e-4g-fr-front";
const DE_LNG = 6.500, DE_LAT = 49.190; // Sarreguemines
const FR_LNG = 6.175, FR_LAT = 49.123; // Metz

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

interface DivisionUpdate {
  division_id: string;
  combat_state?: string;
  suppression?: number;
  hp?: number;
  move_order?: string[];
  reposition_order?: string[];
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

function waitForRejection(
  room: Room,
  divisionId: string,
  timeoutMs = 5000,
  expectedReason?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(
      `Timeout waiting for MOVE_ORDER_REJECTED for ${divisionId}${expectedReason ? ` (expected: ${expectedReason})` : ""}`
    )), timeoutMs);
    room.onMessage("MOVE_ORDER_REJECTED", (msg: unknown) => {
      const m = msg as { division_id: string; reason: string };
      if (m.division_id === divisionId) {
        clearTimeout(timer);
        resolve(m.reason);
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4G — reposition, river crossing, hold fix\n");
  console.log(`  Front-line pair: ${DE_DIV} (Sarreguemines) vs ${FR_DIV} (Metz)`);
  console.log(`  Reposition target: wp_070996 (~4.4 km from ${DE_DIV})`);
  console.log("  Idle test division: germany_div_01 (Frankfurt area)");

  // ── 1. Register + login ───────────────────────────────────────────────────
  console.log("\n1. Registering and logging in...");
  await register(BOT_A_EMAIL);
  await register(BOT_B_EMAIL);
  const botA = await login(BOT_A_EMAIL);
  const botB = await login(BOT_B_EMAIL);
  assert(botA.hasHostPass, "Bot A needs has_host_pass=true — is DEV_MODE=true?");

  // ── 2. Create room + lobby ────────────────────────────────────────────────
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

  // ── 3. Select nations + ready + start ─────────────────────────────────────
  console.log("3. Starting game...");
  roomA.send("SELECT_NATION", { nation_id: "germany" });
  roomB.send("SELECT_NATION", { nation_id: "france" });
  await sleep(200);

  const gameStartedPromise      = waitForMessage(roomA, "GAME_STARTED", 10000);
  const divisionsSpawnedPromise = waitForMessage(roomA, "DIVISIONS_SPAWNED", 12000);

  roomA.send("SET_READY", { ready: true });
  roomB.send("SET_READY", { ready: true });
  await sleep(200);
  roomA.send("START_GAME", {});

  await gameStartedPromise;
  console.log("   ✓ GAME_STARTED");
  await divisionsSpawnedPromise;
  console.log("   ✓ DIVISIONS_SPAWNED");

  // Spawn our own throwaway front-line pair via the test-only SPAWN_DIVISION message.
  roomA.send("SPAWN_DIVISION", { division_id: DE_DIV, nation_id: "germany", position_lng: DE_LNG, position_lat: DE_LAT });
  roomB.send("SPAWN_DIVISION", { division_id: FR_DIV, nation_id: "france", position_lng: FR_LNG, position_lat: FR_LAT });
  await sleep(300);

  // ── 4. Test A: Reposition accepted during combat ──────────────────────────
  // No MOVE order needed — the throwaway divisions auto-engage from standing positions
  // (~37 km apart, well within the 50 km combined range). Both sides are classified as
  // meeting battle (60% threshold), which is fine for testing reposition behaviour.
  console.log("\n4. Test A: Reposition accepted during combat...");

  const combatStartedMsg = await waitForMessage(roomA, "COMBAT_STARTED", 20000) as {
    division_a: string;
    division_b: string;
    is_meeting_battle: boolean;
  };
  const involvesTarget =
    combatStartedMsg.division_a === DE_DIV ||
    combatStartedMsg.division_b === DE_DIV;
  assert(involvesTarget, `COMBAT_STARTED did not involve ${DE_DIV}: ${JSON.stringify(combatStartedMsg)}`);
  console.log(`   ✓ COMBAT_STARTED — is_meeting_battle: ${combatStartedMsg.is_meeting_battle}`);

  // Send REPOSITION for the German test division to a nearby waypoint
  roomA.send("REPOSITION", {
    division_id: DE_DIV,
    waypoints: ["wp_070996"],
  });

  const repositionAccepted = await waitForDivisionState(
    roomA,
    divs => {
      const gd05 = divs.find(d => d.division_id === DE_DIV);
      return !!(gd05 && gd05.reposition_order && gd05.reposition_order.length > 0);
    },
    5000,
    `reposition_order populated on ${DE_DIV}`,
  );
  const gd05Repos = repositionAccepted.find(d => d.division_id === DE_DIV);
  assert(!!gd05Repos?.reposition_order && gd05Repos.reposition_order.length > 0,
    "reposition_order should be non-empty after REPOSITION command");
  assert(gd05Repos?.combat_state === "engaged",
    "combat_state should still be 'engaged' after reposition");
  console.log("   ✓ reposition_order populated, combat_state still 'engaged'");

  // ── 5. Test D: Reposition accepted with far-away waypoint ─────────────────
  // The server no longer enforces a fixed distance cap. Any valid repos path is accepted
  // as long as the division is within engagement range of its enemies. Client-side
  // engagement-boundary truncation handles the actual path capping.
  console.log("\n5. Test D: Reposition accepted with far-away waypoint...");

  // The German test division is still in combat — send REPOSITION with wp_079006 (Berlin ~670 km away)
  // Server accepts it (division is within Ra+Rb of france) — client would have truncated
  const dStatePromise = waitForDivisionState(
    roomA,
    divs => {
      const gd05 = divs.find(d => d.division_id === DE_DIV);
      return !!(gd05?.reposition_order && gd05.reposition_order.length > 0);
    },
    3000,
    "reposition_order populated after far-away repos",
  );
  roomA.send("REPOSITION", {
    division_id: DE_DIV,
    waypoints: ["wp_079006"],
  });
  await dStatePromise;
  console.log("   ✓ REPOSITION accepted (server trusts client-side distance capping)");

  // ── 6. Test B: Reposition clears after combat ends ────────────────────────
  console.log("\n6. Test B: Reposition clears after combat ends...");

  const combatEnded = await waitForMessage(roomA, "COMBAT_ENDED", 120000) as {
    winner_id: string;
    retreated_id: string;
  };
  assert(!!combatEnded, "COMBAT_ENDED should fire");
  console.log(`   ✓ COMBAT_ENDED: winner=${combatEnded.winner_id}, retreated=${combatEnded.retreated_id}`);

  const repositionCleared = await waitForDivisionState(
    roomA,
    divs => {
      const gd05 = divs.find(d => d.division_id === DE_DIV);
      return !!(gd05?.reposition_order !== undefined && gd05.reposition_order !== null &&
        gd05.reposition_order.length === 0);
    },
    15000,
    `reposition_order cleared on ${DE_DIV}`,
  );
  const gd05PostCombat = repositionCleared.find(d => d.division_id === DE_DIV);
  assert(gd05PostCombat?.reposition_order?.length === 0,
    "reposition_order should be empty after combat ends");
  console.log("   ✓ reposition_order cleared after combat end");

  // ── 7. Test C: Reposition rejected when not in combat ─────────────────────
  console.log("\n7. Test C: Reposition rejected when not in combat...");

  const rejectionPromiseC = waitForRejection(roomA, "germany_div_01", 5000, "not_in_combat");
  roomA.send("REPOSITION", {
    division_id: "germany_div_01",
    waypoints: ["wp_079006"],
  });
  const reasonC = await rejectionPromiseC;
  assert(reasonC === "not_in_combat", `Expected 'not_in_combat', got: ${reasonC}`);
  console.log(`   ✓ REPOSITION rejected with reason: ${reasonC}`);

  // ── 8. Test E: Hold broadcasts update ─────────────────────────────────────
  console.log("\n8. Test E: Hold broadcasts update...");

  roomA.send("SUBMIT_MOVE_ORDER", {
    division_id: "germany_div_01",
    waypoints: ["wp_079006"],
  });

  const moveAccepted = await waitForDivisionState(
    roomA,
    divs => {
      const gd01 = divs.find(d => d.division_id === "germany_div_01");
      return !!(gd01?.move_order && gd01.move_order.length > 0);
    },
    5000,
    "move_order populated on germany_div_01",
  );
  assert(!!moveAccepted, "MOVE order should be accepted");
  console.log("   ✓ MOVE order accepted on germany_div_01");

  const holdDivStatePromise = waitForDivisionState(
    roomA,
    divs => {
      const gd01 = divs.find(d => d.division_id === "germany_div_01");
      return !!(gd01?.move_order !== undefined && gd01.move_order !== null &&
        gd01.move_order.length === 0);
    },
    5000,
    "move_order cleared on germany_div_01 after HOLD",
  );
  roomA.send("HOLD", { division_id: "germany_div_01" });
  await holdDivStatePromise;
  console.log("   ✓ HOLD cleared move_order and broadcast DIVISION_UPDATES");

  // ── Cleanup ───────────────────────────────────────────────────────────────
  roomA.leave();
  roomB.leave();

  console.log("\n✅ Phase 4G e2e passed.");
}

main().catch((err) => {
  console.error("\n❌ Phase 4G e2e failed:", err.message);
  process.exit(1);
});
