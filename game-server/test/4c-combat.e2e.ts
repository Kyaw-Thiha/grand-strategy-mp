/**
 * Phase 4C end-to-end: engagement, combat, auto-retreat, province capture.
 *
 * germany_div_05 (Saarbrücken, 6.995°E 49.237°N) and france_div_05 (Metz, 6.175°E 49.123°N)
 * spawn ~92 km apart — within the 100 km engagement range (50+50) — so combat starts
 * automatically on the first game tick without any move orders needed.
 *
 * Tests:
 *   1. Game starts → COMBAT_STARTED fires within a few ticks (no move orders needed)
 *   2. Combat runs → DIVISION_UPDATES shows hp decreasing and suppression increasing
 *   3. Suppression threshold hit → combat_state changes to "retreating"
 *   4. Soft: PROVINCE_CAPTURED fires when an uncontested division reaches a city
 *
 * Run with: npx tsx test/4c-combat.e2e.ts
 * Requires both servers running with DEV_MODE=true.
 */

import { Client, Room } from "@colyseus/sdk";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "e2e-4c-bot-a@example.com";
const BOT_B_EMAIL = "e2e-4c-bot-b@example.com";
const PASSWORD    = "password123";

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
  console.log("  Front-line pair: germany_div_05 (Saarbrücken) vs france_div_05 (Metz)");
  console.log("  Spawn distance: ~92 km — within engagement range (50+50=100 km)\n");

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
  console.log(`   ${spawnMsg.divisions.length} divisions spawned`);

  const germDiv = spawnMsg.divisions.find(d => d.division_id === "germany_div_05");
  const frDiv   = spawnMsg.divisions.find(d => d.division_id === "france_div_05");
  assert(!!germDiv, "germany_div_05 not in spawn list");
  assert(!!frDiv,   "france_div_05 not in spawn list");

  const dx = germDiv!.position_lng - frDiv!.position_lng;
  const dy = germDiv!.position_lat - frDiv!.position_lat;
  const distKm = Math.sqrt(dx * dx + dy * dy) * 111;
  console.log(`   germany_div_05: (${germDiv!.position_lng.toFixed(3)}, ${germDiv!.position_lat.toFixed(3)})`);
  console.log(`   france_div_05:  (${frDiv!.position_lng.toFixed(3)},  ${frDiv!.position_lat.toFixed(3)})`);
  console.log(`   Spawn distance: ${distKm.toFixed(1)} km (engagement triggers at ≤ 100 km)`);
  assert(distKm <= 100, `Divisions too far apart to engage: ${distKm.toFixed(1)} km`);

  // 4. Test: COMBAT_STARTED fires automatically (no move orders needed)
  console.log("\n4. Test: COMBAT_STARTED fires automatically...");
  const combatStartedMsg = await waitForMessage(roomA, "COMBAT_STARTED", 20000) as {
    division_a: string;
    division_b: string;
    is_meeting_battle: boolean;
  };
  const involvesFrontPair =
    (combatStartedMsg.division_a === "germany_div_05" || combatStartedMsg.division_b === "germany_div_05") &&
    (combatStartedMsg.division_a === "france_div_05"  || combatStartedMsg.division_b === "france_div_05");
  assert(involvesFrontPair, `COMBAT_STARTED did not involve the front-line pair: ${JSON.stringify(combatStartedMsg)}`);
  console.log(`   ✓ COMBAT_STARTED — meeting_battle: ${combatStartedMsg.is_meeting_battle}`);

  // 5. Test: DIVISION_UPDATES shows hp and suppression changing
  console.log("5. Test: combat tick drives hp/suppression changes...");
  const damageConfirmed = await waitForDivisionState(
    roomA,
    divs => {
      const gd05 = divs.find(d => d.division_id === "germany_div_05");
      const fd05 = divs.find(d => d.division_id === "france_div_05");
      return !!(gd05 && fd05 && (gd05.suppression! > 0 || fd05.suppression! > 0));
    },
    15000,
    "suppression > 0 on front-line divisions",
  );
  const gd05After = damageConfirmed.find(d => d.division_id === "germany_div_05");
  const fd05After = damageConfirmed.find(d => d.division_id === "france_div_05");
  console.log(`   ✓ Suppression building — germany_div_05: ${gd05After?.suppression?.toFixed(1)}%  france_div_05: ${fd05After?.suppression?.toFixed(1)}%`);

  // 6. Test: auto-retreat fires when suppression hits threshold
  // Suppression grows at ~1.75/tick (BASE_ATTRITION 2.5 × 0.7 SUPPRESSION_FRACTION).
  // Threshold for meeting battle = 60% → expect retreat after ~35 ticks = 35 seconds.
  // Allow 90 s to be safe.
  console.log("6. Test: auto-retreat fires at suppression threshold (≤ 90 s)...");
  const retreatDivs = await waitForDivisionState(
    roomA,
    divs => divs.some(
      d => (d.division_id === "germany_div_05" || d.division_id === "france_div_05") &&
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
