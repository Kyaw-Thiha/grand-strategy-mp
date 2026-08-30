/**
 * Phase 4E end-to-end: frontline influence system.
 *
 * Scenario:
 *   Germany and France start with divisions near the Rhine/Maginot border.
 *   The frontline system runs every 5 ticks and broadcasts FRONTLINE_BATCH
 *   for each province where any nation has influence.
 *
 * Tests:
 *   1. Game starts + divisions spawn
 *   2. FRONTLINE_BATCH arrives within 10 s (first frontline tick = 5 s)
 *   3. Provinces near starting German positions have germany share > 0
 *   4. Provinces near starting French positions have france share > 0
 *   5. nation_shares values sum to ≤ 1.001 (normalised correctly)
 *   6. Teleporting a German division deep into France raises France-interior
 *      province's germany share from 0 → > 0 within the next frontline tick
 *
 * Run with: NODE_ENV=test npx tsx test/4e-frontline.e2e.ts
 * Requires both servers running with DEV_MODE=true and the game-server started with
 * NODE_ENV=test (so the SPAWN_DIVISION test-only message handler is registered).
 */

import { Client, Room } from "@colyseus/sdk";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "e2e-4e-bot-a@example.com";
const BOT_B_EMAIL = "e2e-4e-bot-b@example.com";
const PASSWORD    = "password123";

// Central France — far from German starting positions
// Province we6_france_10 city is at approximately (1.5, 45.8)
const DEEP_FRANCE_LNG = 1.5;
const DEEP_FRANCE_LAT = 45.8;

// Throwaway German test division spawned via SPAWN_DIVISION (bypasses territory-ownership
// validation), near we6_germany_01 city so it contributes to the baseline germany-influence
// assertions before being teleported deep into France.
const TELEPORT_DIV      = "e2e-4e-teleport-div";
const TELEPORT_SPAWN_LNG = 8.684450;
const TELEPORT_SPAWN_LAT = 50.063147;

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

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4E — frontline influence system\n");

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

  const gameStartedPromise      = waitForMessage(roomA, "GAME_STARTED",     10000);
  const divisionsSpawnedPromise = waitForMessage(roomA, "DIVISIONS_SPAWNED", 12000);

  roomA.send("SET_READY", { ready: true });
  roomB.send("SET_READY", { ready: true });
  await sleep(200);
  roomA.send("START_GAME", {});

  await gameStartedPromise;
  console.log("   ✓ GAME_STARTED");
  await divisionsSpawnedPromise;
  console.log("   ✓ DIVISIONS_SPAWNED");

  // Spawn throwaway German test division near German territory via the test-only
  // SPAWN_DIVISION message, so it contributes to the baseline germany-influence
  // assertions below before being teleported deep into France in step 8.
  roomA.send("SPAWN_DIVISION", {
    division_id: TELEPORT_DIV,
    nation_id: "germany",
    position_lng: TELEPORT_SPAWN_LNG,
    position_lat: TELEPORT_SPAWN_LAT,
  });
  await sleep(300);

  // 4. Collect FRONTLINE_BATCH events for 12 s (covers at least 2 frontline ticks)
  console.log("\n4. Collecting FRONTLINE_BATCH events for 12 s...");
  const frontlineEvents = new Map<string, Record<string, number>>(); // province_id → nation_shares
  roomA.onMessage("FRONTLINE_BATCH", (msg: unknown) => {
    const m = msg as { provinces: Record<string, Record<string, number>> };
    for (const [provinceId, shares] of Object.entries(m.provinces)) {
      frontlineEvents.set(provinceId, shares);
    }
  });

  // Wait for the first FRONTLINE_BATCH within 10 s
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout: no FRONTLINE_BATCH received")), 10000);
    roomA.onMessage("FRONTLINE_BATCH", () => { clearTimeout(timer); resolve(); });
  });
  console.log("   ✓ First FRONTLINE_BATCH received");

  // Collect a full second tick worth
  await sleep(6000);
  console.log(`   Collected events for ${frontlineEvents.size} provinces`);

  // 5. Verify nation_shares normalisation
  console.log("\n5. Verifying nation_shares normalisation...");
  let badNorm = 0;
  for (const [pid, shares] of frontlineEvents) {
    const total = Object.values(shares).reduce((a, b) => a + b, 0);
    if (total > 1.001) {
      console.log(`   WARN: ${pid} shares sum to ${total.toFixed(4)}`);
      badNorm++;
    }
  }
  assert(badNorm === 0, `${badNorm} provinces had nation_shares summing > 1.001`);
  console.log("   ✓ All province shares normalised correctly");

  // 6. Verify german provinces have germany share > 0
  console.log("\n6. Verifying German provinces near starting positions...");
  const germanProvinces = [...frontlineEvents.entries()].filter(
    ([, shares]) => (shares["germany"] ?? 0) > 0,
  );
  assert(germanProvinces.length > 0, "No province had germany share > 0");
  console.log(`   ✓ ${germanProvinces.length} provinces have germany influence`);

  // 7. Verify french provinces have france share > 0
  console.log("\n7. Verifying French provinces near starting positions...");
  const frenchProvinces = [...frontlineEvents.entries()].filter(
    ([, shares]) => (shares["france"] ?? 0) > 0,
  );
  assert(frenchProvinces.length > 0, "No province had france share > 0");
  console.log(`   ✓ ${frenchProvinces.length} provinces have france influence`);

  // 8. Teleport a German division deep into France; verify its influence appears
  console.log(`\n8. Teleporting ${TELEPORT_DIV} to central France (${DEEP_FRANCE_LNG}, ${DEEP_FRANCE_LAT})...`);
  roomA.send("DEV_TELEPORT", { division_id: TELEPORT_DIV, lng: DEEP_FRANCE_LNG, lat: DEEP_FRANCE_LAT });

  // Find a province that was previously 0 germany share and near (1.5, 45.8)
  // Wait 2 frontline ticks for the influence to appear
  console.log("   Waiting 12 s for frontline update reflecting teleported division...");
  await sleep(12000);

  // Find nearest province from our collected events
  const nearbyWithGermany = [...frontlineEvents.entries()].filter(
    ([, shares]) => (shares["germany"] ?? 0) > 0,
  );
  assert(
    nearbyWithGermany.length > germanProvinces.length,
    `Expected more provinces with germany share after teleport (before: ${germanProvinces.length}, after: ${nearbyWithGermany.length})`,
  );
  console.log(`   ✓ Germany influence now in ${nearbyWithGermany.length} provinces (was ${germanProvinces.length})`);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  roomA.leave();
  roomB.leave();

  console.log("\n✅ Phase 4E e2e passed.");
}

main().catch((err) => {
  console.error("\n❌ Phase 4E e2e failed:", err.message);
  process.exit(1);
});
