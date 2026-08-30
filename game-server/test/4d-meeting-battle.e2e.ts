/**
 * Phase 4D end-to-end: meeting battle visual detection.
 *
 * A throwaway German test division and a throwaway French test division, spawned via the
 * test-only SPAWN_DIVISION message (which does not validate territory ownership) at the old
 * Sarreguemines / Metz coordinates, spawn ~37 km apart — within the 50 km engagement range
 * (25+25). After spawning, both receive MOVE orders into their own territory so move orders
 * exist on tick 1 when engagement is detected. This ensures both sides are labeled as
 * "meeting" battle.
 *
 * Tests:
 *   1. COMBAT_STARTED fires with is_meeting_battle === true
 *   2. DIVISION_UPDATES shows both divisions with attacker_role === "meeting"
 *
 * Run with: NODE_ENV=test npx tsx test/4d-meeting-battle.e2e.ts
 * Requires both servers running with DEV_MODE=true and the game-server started with
 * NODE_ENV=test (so the SPAWN_DIVISION test-only message handler is registered).
 */

import { Client, Room } from "@colyseus/sdk";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "e2e-4d-meeting-a@example.com";
const BOT_B_EMAIL = "e2e-4d-meeting-b@example.com";
const PASSWORD    = "password123";

// Throwaway test divisions spawned via SPAWN_DIVISION (bypasses territory-ownership
// validation) at the old Sarreguemines / Metz coordinates — preserves the ~37 km
// engagement-range distance.
const DE_DIV = "e2e-4d-meeting-de-front";
const FR_DIV = "e2e-4d-meeting-fr-front";
const DE_LNG = 6.500, DE_LAT = 49.190; // Sarreguemines
const FR_LNG = 6.175, FR_LAT = 49.123; // Metz

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
  predicate: (divs: { division_id: string; attacker_role?: string; combat_state?: string }[]) => boolean,
  timeoutMs = 30000,
  description = "condition",
): Promise<{ division_id: string; attacker_role?: string }[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${description}`)), timeoutMs);
    room.onMessage("DIVISION_UPDATES", (msg: unknown) => {
      const m = msg as { divisions: { division_id: string; attacker_role?: string }[] };
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
  console.log("Phase 4D — Meeting Battle Detection\n");
  console.log(`  Front-line pair: ${DE_DIV} (Sarreguemines) vs ${FR_DIV} (Metz)`);
  console.log("  Both receive MOVE orders into their own territory -> meeting battle\n");

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

  roomA.send("SET_READY", { ready: true });
  roomB.send("SET_READY", { ready: true });
  await sleep(200);
  roomA.send("START_GAME", {});

  await gameStartedPromise;
  console.log("   ✓ GAME_STARTED");

  const spawnMsg = await divisionsSpawnedPromise as {
    divisions: { division_id: string; position_lng: number; position_lat: number }[];
  };
  console.log(`   ${spawnMsg.divisions.length} default-roster divisions spawned`);

  // 4. Spawn our own throwaway front-line pair, then send MOVE orders into own territory so
  // both sides have orders when engagement triggers.
  console.log("4. Spawning front-line pair and sending MOVE orders...");
  roomA.send("SPAWN_DIVISION", { division_id: DE_DIV, nation_id: "germany", position_lng: DE_LNG, position_lat: DE_LAT });
  roomB.send("SPAWN_DIVISION", { division_id: FR_DIV, nation_id: "france", position_lng: FR_LNG, position_lat: FR_LAT });
  await sleep(300);
  // BOTH divisions move toward Berlin (same direction) so they stay within engagement range
  // while both having active move_orders when COMBAT_GRACE_TICKS expire
  roomA.send("SUBMIT_MOVE_ORDER", {
    division_id: DE_DIV,
    waypoints: ["wp_079006"],  // (13.298, 52.504) — Berlin, ~500 km NE
  });
  roomB.send("SUBMIT_MOVE_ORDER", {
    division_id: FR_DIV,
    waypoints: ["wp_079006"],  // Same Berlin waypoint — parallel movement
  });
  console.log("   ✓ MOVE orders submitted");

  // 5. Test: COMBAT_STARTED fires with is_meeting_battle === true
  console.log("\n5. Test: COMBAT_STARTED fires with is_meeting_battle === true...");
  const combatStartedMsg = await waitForMessage(roomA, "COMBAT_STARTED", 30000) as {
    division_a: string;
    division_b: string;
    is_meeting_battle: boolean;
  };
  const involvesFrontPair =
    (combatStartedMsg.division_a === DE_DIV || combatStartedMsg.division_b === DE_DIV) &&
    (combatStartedMsg.division_a === FR_DIV  || combatStartedMsg.division_b === FR_DIV);
  assert(involvesFrontPair, `COMBAT_STARTED did not involve the front-line pair: ${JSON.stringify(combatStartedMsg)}`);
  assert(combatStartedMsg.is_meeting_battle === true,
    `Expected is_meeting_battle=true but got ${combatStartedMsg.is_meeting_battle}`);
  console.log(`   ✓ COMBAT_STARTED — is_meeting_battle: ${combatStartedMsg.is_meeting_battle}`);

  // 6. Test: DIVISION_UPDATES shows both with attacker_role === "meeting"
  console.log("6. Test: both divisions have attacker_role === 'meeting'...");
  const meetingDivs = await waitForDivisionState(
    roomA,
    divs => {
      const gd05 = divs.find(d => d.division_id === DE_DIV);
      const fd05 = divs.find(d => d.division_id === FR_DIV);
      return !!(gd05 && fd05 && gd05.attacker_role === "meeting" && fd05.attacker_role === "meeting");
    },
    15000,
    "both divisions have attacker_role === meeting",
  );
  const gd05Role = meetingDivs.find(d => d.division_id === DE_DIV)?.attacker_role;
  const fd05Role = meetingDivs.find(d => d.division_id === FR_DIV)?.attacker_role;
  console.log(`   ✓ ${DE_DIV}.attacker_role: ${gd05Role}`);
  console.log(`   ✓ ${FR_DIV}.attacker_role:  ${fd05Role}`);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  roomA.leave();
  roomB.leave();

  console.log("\n✅ Phase 4D — Meeting Battle e2e passed.");
}

main().catch((err) => {
  console.error("\n❌ Phase 4D — Meeting Battle e2e failed:", err.message);
  process.exit(1);
});
