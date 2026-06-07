/**
 * Phase 4D end-to-end: stacking + three-tier supply/encirclement.
 *
 * Scenario:
 *   germany_div_05 (Saarbrücken) is teleported 400 km into France — deep behind enemy lines —
 *   so it is far from any German province (→ OUT_OF_SUPPLY) and far from any German division
 *   (→ CUT_OFF). Four French divisions are then teleported to surround it in all 8 directions
 *   (→ DIVISION_ENCIRCLED). The encircled German division takes HP drain each tick until it
 *   is destroyed or retreats (combat damage accelerates this).
 *
 * Stack test (soft):
 *   Two German divisions are teleported to the same spot → STACK_FORMED fires.
 *   Stacking is not required for the main supply-tier assertions.
 *
 * Tests:
 *   1. Game starts + divisions spawn
 *   2. OUT_OF_SUPPLY fires for germany_div_05 within 15 s (teleported far from Germany)
 *   3. CUT_OFF fires for germany_div_05 within 15 s after step 2
 *   4. DIVISION_ENCIRCLED fires within 15 s after step 3 (4 French divisions form a ring)
 *   5. UNIT_DESTROYED fires for germany_div_05 (from HP drain + combat damage)
 *   6. Soft: STACK_FORMED fires when two German divisions overlap
 *
 * Run with: npx tsx test/4d-encirclement.e2e.ts
 * Requires both servers running with DEV_MODE=true.
 */

import { Client, Room } from "@colyseus/sdk";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "e2e-4d-bot-a@example.com";
const BOT_B_EMAIL = "e2e-4d-bot-b@example.com";
const PASSWORD    = "password123";

// Victim division — will be teleported deep into enemy territory
const VICTIM_DIV = "germany_div_05";

// Teleport destination — central France, 171 km from nearest province city (no province capture),
// 903 km from nearest German province (well beyond 200 km OOS threshold).
const VICTIM_LNG = 2.0;
const VICTIM_LAT = 45.0;

// Eight French divisions forming a full encirclement ring (one per compass direction).
// At 70 km: sample points at 75 km + up to 20 km auto-retreat = 95 km, still within
// 70 km ring + 50 km engagement radius = 120 km coverage. No province city within 171 km
// so no province capture can happen regardless of who is nearby.
const RING_OFFSET_DEG = 70 / 111; // 70 km ≈ 0.63 degrees
const ENCIRCLE_RING: Array<{ id: string; lng: number; lat: number }> = [
  { id: "france_div_01", lng: VICTIM_LNG,                         lat: VICTIM_LAT + RING_OFFSET_DEG },  // N
  { id: "france_div_02", lng: VICTIM_LNG + RING_OFFSET_DEG,       lat: VICTIM_LAT + RING_OFFSET_DEG },  // NE
  { id: "france_div_03", lng: VICTIM_LNG + RING_OFFSET_DEG,       lat: VICTIM_LAT },                    // E
  { id: "france_div_04", lng: VICTIM_LNG + RING_OFFSET_DEG,       lat: VICTIM_LAT - RING_OFFSET_DEG },  // SE
  { id: "france_div_05", lng: VICTIM_LNG,                         lat: VICTIM_LAT - RING_OFFSET_DEG },  // S
  { id: "france_div_06", lng: VICTIM_LNG - RING_OFFSET_DEG,       lat: VICTIM_LAT - RING_OFFSET_DEG },  // SW
  { id: "france_div_07", lng: VICTIM_LNG - RING_OFFSET_DEG,       lat: VICTIM_LAT },                    // W
  { id: "france_div_08", lng: VICTIM_LNG - RING_OFFSET_DEG,       lat: VICTIM_LAT + RING_OFFSET_DEG },  // NW
];

// Two German divisions stacked on the same spot for the soft stacking test.
// Near we6_germany_01 city (8.68, 50.06) — well within 200 km supply range.
const STACK_DIV_A = "germany_div_01";
const STACK_DIV_B = "germany_div_02";
const STACK_LNG = 8.70;
const STACK_LAT = 50.10;

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

function waitForSupplyEvent(
  room: Room,
  divisionId: string,
  supplyStatus: string,
  timeoutMs = 20000,
): Promise<unknown> {
  const evtMap: Record<string, string> = {
    out_of_supply: "OUT_OF_SUPPLY",
    cut_off:       "CUT_OFF",
    encircled:     "DIVISION_ENCIRCLED",
  };
  const eventType = evtMap[supplyStatus] ?? supplyStatus;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${eventType} on ${divisionId}`)),
      timeoutMs,
    );
    room.onMessage(eventType, (msg: unknown) => {
      const m = msg as { division_id: string };
      if (m.division_id === divisionId) {
        clearTimeout(timer);
        resolve(msg);
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
  console.log("Phase 4D — stacking + three-tier supply/encirclement\n");

  // 1. Register + login
  console.log("1. Registering and logging in...");
  await register(BOT_A_EMAIL);
  await register(BOT_B_EMAIL);
  const botA = await login(BOT_A_EMAIL);
  const botB = await login(BOT_B_EMAIL);
  assert(botA.hasHostPass, "Bot A needs has_host_pass=true — is DEV_MODE=true?");

  // 2. Create room
  console.log("2. Creating room...");
  const createRes = await fetch(`${HONO_URL}/lobby/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${botA.token}` },
    body: JSON.stringify({}),
  });
  assert(createRes.ok, `POST /lobby/create failed: ${createRes.status}`);
  const { join_code } = await createRes.json() as { join_code: string };

  const clientA = new Client(COLYSEUS_URL);
  const roomA   = await clientA.create("game_room", { token: botA.token });
  roomA.onLeave((code) => console.log(`[roomA] LEFT code=${code}`));
  roomA.onError((code, msg) => console.log(`[roomA] ERROR code=${code} msg=${msg}`));

  const activateRes = await fetch(`${HONO_URL}/lobby/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${botA.token}` },
    body: JSON.stringify({ join_code, room_id: roomA.roomId }),
  });
  assert(activateRes.ok, `POST /lobby/activate failed: ${activateRes.status}`);

  const resolveRes = await fetch(`${HONO_URL}/lobby/resolve/${join_code}`);
  const { room_id } = await resolveRes.json() as { room_id: string };
  const clientB = new Client(COLYSEUS_URL);
  const roomB   = await clientB.joinById(room_id, { token: botB.token });

  // 3. Select nations + start game
  console.log("3. Starting game (Germany vs France)...");
  roomA.send("SELECT_NATION", { nation_id: "germany" });
  roomB.send("SELECT_NATION", { nation_id: "france" });
  await sleep(200);

  const gameStartedPromise    = waitForMessage(roomA, "GAME_STARTED",    10000);
  const divisionsSpawnedPromise = waitForMessage(roomA, "DIVISIONS_SPAWNED", 12000);

  roomA.send("SET_READY", { ready: true });
  roomB.send("SET_READY", { ready: true });
  await sleep(200);
  roomA.send("START_GAME", {});

  await gameStartedPromise;
  console.log("   ✓ GAME_STARTED");
  await divisionsSpawnedPromise;
  console.log("   ✓ DIVISIONS_SPAWNED");

  // 4. Teleport victim into deep France (away from all German provinces and divisions)
  console.log("\n4. Teleporting victim division into deep France...");
  roomA.send("DEV_TELEPORT", { division_id: VICTIM_DIV, lng: VICTIM_LNG, lat: VICTIM_LAT });
  await sleep(200);
  console.log(`   ${VICTIM_DIV} → (${VICTIM_LNG.toFixed(3)}, ${VICTIM_LAT.toFixed(3)}) [Central France, 171km from nearest city]`);

  // 5. Soft test: stack two German divisions on same spot
  console.log("\n5. Soft test: stacking two German divisions...");
  let stackFormed = false;
  roomA.onMessage("STACK_FORMED", (msg: unknown) => {
    const m = msg as { stack_id: string; divisions: string[] };
    console.log(`   ✓ STACK_FORMED: [${m.divisions.join(", ")}] → stack ${m.stack_id}`);
    stackFormed = true;
  });
  roomA.send("DEV_TELEPORT", { division_id: STACK_DIV_A, lng: STACK_LNG, lat: STACK_LAT });
  roomA.send("DEV_TELEPORT", { division_id: STACK_DIV_B, lng: STACK_LNG, lat: STACK_LAT });

  // 6. Place the encirclement ring NOW so it is ready by the time the third supply tick runs.
  // The three-tier progression fires at supply ticks 1, 2, 3 (each 5 s apart = 5/10/15 s after teleport).
  console.log("\n6. Placing French encirclement ring (before supply ticks run)...");
  for (const ring of ENCIRCLE_RING) {
    roomB.send("DEV_TELEPORT", { division_id: ring.id, lng: ring.lng, lat: ring.lat });
    await sleep(50);
    console.log(`   ${ring.id} → (${ring.lng.toFixed(3)}, ${ring.lat.toFixed(3)})`);
  }

  // 7. Test: OUT_OF_SUPPLY fires within 15 s (first supply tick = 5 s after game start)
  console.log("\n7. Test: OUT_OF_SUPPLY fires for victim division...");
  const oosMsg = await waitForSupplyEvent(roomA, VICTIM_DIV, "out_of_supply", 15000);
  console.log(`   ✓ OUT_OF_SUPPLY: ${JSON.stringify(oosMsg)}`);

  // 8. Test: CUT_OFF fires — victim is far from all German divisions (~700+ km from Germany)
  console.log("8. Test: CUT_OFF fires for victim division (second supply tick)...");
  const cutoffMsg = await waitForSupplyEvent(roomA, VICTIM_DIV, "cut_off", 15000);
  console.log(`   ✓ CUT_OFF: ${JSON.stringify(cutoffMsg)}`);

  // 9. Test: DIVISION_ENCIRCLED fires — ring blocks all 8 directions (third supply tick)
  console.log("9. Test: DIVISION_ENCIRCLED fires for victim division (third supply tick)...");
  const encircledMsg = await waitForSupplyEvent(roomA, VICTIM_DIV, "encircled", 15000);
  console.log(`   ✓ DIVISION_ENCIRCLED: ${JSON.stringify(encircledMsg)}`);

  // 10. Test: UNIT_DESTROYED fires (from HP drain + combat damage while encircled)
  // Encircled HP drain = 0.35/tick. With 100 HP and ring damage, expect ~100/0.35 ≈ 286 ticks max.
  // With combat from all 4 French divisions, it will be much faster (~30-60 ticks = 30-60 s).
  console.log("\n10. Test: UNIT_DESTROYED fires for encircled victim (≤ 120 s)...");
  const destroyedMsg = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timeout waiting for UNIT_DESTROYED on encircled division")),
      120_000,
    );
    roomA.onMessage("UNIT_DESTROYED", (msg: unknown) => {
      const m = msg as { division_id: string };
      if (m.division_id === VICTIM_DIV) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
  console.log(`   ✓ UNIT_DESTROYED: ${JSON.stringify(destroyedMsg)}`);

  // Stack soft result
  if (!stackFormed) {
    console.log("\n   ℹ Stack test: STACK_FORMED not observed (check log — may fire after supply events)");
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  roomA.leave();
  roomB.leave();

  console.log("\n✅ Phase 4D e2e passed.");
}

main().catch((err) => {
  console.error("\n❌ Phase 4D e2e failed:", err.message);
  process.exit(1);
});
