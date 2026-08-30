/**
 * Phase 4C end-to-end: engagement, combat, auto-retreat, province capture.
 *
 * The default roster no longer includes a front-line pair that legally starts within
 * engagement range (the old germany_div_05 spawn was a data bug — it sat inside French
 * sovereign territory — and has been removed). Instead, this test spawns its own throwaway
 * divisions via the test-only SPAWN_DIVISION message (which does not validate territory
 * ownership): a German division and a French division placed ~37 km apart — within the
 * 50 km engagement range (25+25) — so combat starts automatically on the first game tick
 * without any move orders needed.
 *
 * Tests:
 *   1. Game starts → COMBAT_STARTED fires within a few ticks (no move orders needed)
 *   2. Combat runs → DIVISION_UPDATES shows hp decreasing and suppression increasing
 *   3. Suppression threshold hit → combat_state changes to "retreating"
 *   4. Soft: PROVINCE_CAPTURED fires when an uncontested division reaches a city
 *
 * Run with: NODE_ENV=test npx tsx test/4c-combat.e2e.ts
 * Requires both servers running with DEV_MODE=true and the game-server started with
 * NODE_ENV=test (so the SPAWN_DIVISION test-only message handler is registered).
 */

import { Client, Room } from "@colyseus/sdk";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "e2e-4c-bot-a@example.com";
const BOT_B_EMAIL = "e2e-4c-bot-b@example.com";
const PASSWORD    = "password123";

// Throwaway test divisions, spawned via SPAWN_DIVISION at the same coordinates the old
// default-roster front-line pair used (Sarreguemines / Metz) — preserves the ~37 km
// engagement-range distance without depending on default territory-owned starting positions.
const DE_DIV = "e2e-4c-de-front";
const FR_DIV = "e2e-4c-fr-front";
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

/** Resolves when a DIVISION_UPDATES message satisfies predicate. */
function waitForDivisionState(
  room: Room,
  predicate: (divs: { division_id: string; combat_state?: string; suppression?: number; hp?: number }[]) => boolean,
  timeoutMs = 90000,
  description = "condition",
): Promise<{ division_id: string; combat_state?: string; suppression?: number }[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${description}`)), timeoutMs);
    room.onMessage("DIVISION_UPDATES", (msg: unknown) => {
      const m = msg as { divisions: { division_id: string; combat_state?: string; suppression?: number; hp?: number }[] };
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4C — engagement, combat, auto-retreat, province capture\n");
  console.log(`  Front-line pair: ${DE_DIV} (Sarreguemines) vs ${FR_DIV} (Metz)`);
  console.log("  Spawn distance: ~37 km — within engagement range (25+25=50 km)\n");

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

  // Spawn our own throwaway front-line pair via the test-only SPAWN_DIVISION message —
  // this bypasses territory-ownership validation entirely, so we can place them at exact
  // coordinates without needing a legally-owned starting position.
  roomA.send("SPAWN_DIVISION", { division_id: DE_DIV, nation_id: "germany", position_lng: DE_LNG, position_lat: DE_LAT });
  roomB.send("SPAWN_DIVISION", { division_id: FR_DIV, nation_id: "france", position_lng: FR_LNG, position_lat: FR_LAT });
  await sleep(300);

  const dx = DE_LNG - FR_LNG;
  const dy = DE_LAT - FR_LAT;
  const distKm = Math.sqrt(dx * dx + dy * dy) * 111;
  console.log(`   ${DE_DIV}: (${DE_LNG.toFixed(3)}, ${DE_LAT.toFixed(3)})`);
  console.log(`   ${FR_DIV}:  (${FR_LNG.toFixed(3)},  ${FR_LAT.toFixed(3)})`);
  console.log(`   Spawn distance: ${distKm.toFixed(1)} km (engagement triggers at ≤ 50 km)`);
  assert(distKm <= 50, `Divisions too far apart to engage: ${distKm.toFixed(1)} km`);

  // 4. Test: COMBAT_STARTED fires automatically (no move orders needed)
  console.log("\n4. Test: COMBAT_STARTED fires automatically...");
  const combatStartedMsg = await waitForMessage(roomA, "COMBAT_STARTED", 20000) as {
    division_a: string;
    division_b: string;
    is_meeting_battle: boolean;
  };
  const involvesFrontPair =
    (combatStartedMsg.division_a === DE_DIV || combatStartedMsg.division_b === DE_DIV) &&
    (combatStartedMsg.division_a === FR_DIV  || combatStartedMsg.division_b === FR_DIV);
  assert(involvesFrontPair, `COMBAT_STARTED did not involve the front-line pair: ${JSON.stringify(combatStartedMsg)}`);
  console.log(`   ✓ COMBAT_STARTED — meeting_battle: ${combatStartedMsg.is_meeting_battle}`);

  // 5. Test: DIVISION_UPDATES shows hp and suppression changing
  console.log("5. Test: combat tick drives hp/suppression changes...");
  const damageConfirmed = await waitForDivisionState(
    roomA,
    divs => {
      const gd05 = divs.find(d => d.division_id === DE_DIV);
      const fd05 = divs.find(d => d.division_id === FR_DIV);
      return !!(gd05 && fd05 && (gd05.suppression! > 0 || fd05.suppression! > 0));
    },
    15000,
    "suppression > 0 on front-line divisions",
  );
  const gd05After = damageConfirmed.find(d => d.division_id === DE_DIV);
  const fd05After = damageConfirmed.find(d => d.division_id === FR_DIV);
  console.log(`   ✓ Suppression building — ${DE_DIV}: ${gd05After?.suppression?.toFixed(1)}%  ${FR_DIV}: ${fd05After?.suppression?.toFixed(1)}%`);

  // 6. Test: auto-retreat fires when suppression hits threshold
  // Suppression grows at ~1.75/tick (BASE_ATTRITION 2.5 × 0.7 SUPPRESSION_FRACTION).
  // Threshold for meeting battle = 60% → expect retreat after ~35 ticks = 35 seconds.
  // Allow 90 s to be safe.
  console.log("6. Test: auto-retreat fires at suppression threshold (≤ 90 s)...");
  const retreatDivs = await waitForDivisionState(
    roomA,
    divs => divs.some(
      d => (d.division_id === DE_DIV || d.division_id === FR_DIV) &&
           d.combat_state === "retreating",
    ),
    90000,
    "a front-line division enters retreating state",
  );
  const retreating = retreatDivs.find(d => d.combat_state === "retreating");
  console.log(`   ✓ Auto-retreat: ${retreating!.division_id} is now retreating`);

  // 7. Soft test: province capture — wait 30 s to see if it fires
  console.log("7. Soft test: PROVINCE_CAPTURED...");
  let captured = false;
  roomA.onMessage("PROVINCE_CAPTURED", (msg: unknown) => {
    const m = msg as { province_id: string; new_owner_id: string; captured_by: string };
    console.log(`   ✓ PROVINCE_CAPTURED: ${m.province_id} by ${m.captured_by} for ${m.new_owner_id}`);
    captured = true;
  });
  await sleep(30000);
  if (!captured) {
    console.log("   ℹ Province capture not triggered in 30 s");
    console.log("     (Requires a division within 15 km of an uncontested enemy city)");
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  roomA.leave();
  roomB.leave();

  console.log("\n✅ Phase 4C e2e passed.");
}

main().catch((err) => {
  console.error("\n❌ Phase 4C e2e failed:", err.message);
  process.exit(1);
});
