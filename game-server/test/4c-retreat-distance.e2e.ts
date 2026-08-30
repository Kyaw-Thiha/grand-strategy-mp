/**
 * Phase 4C — retreat distance e2e test.
 *
 * TDD: this test FAILS when retreatKm = 20 (division travels only ~20 km)
 *      and PASSES when retreatKm = 50 (division travels ~50 km).
 *
 * Measures the distance the retreating division actually travels (engagement
 * position → final idle position), not its distance from the enemy.
 *
 * Run with: NODE_ENV=test npx tsx test/4c-retreat-distance.e2e.ts
 * Requires both servers running with DEV_MODE=true and the game-server started with
 * NODE_ENV=test (so the SPAWN_DIVISION test-only message handler is registered).
 */

import { Client, Room } from "@colyseus/sdk";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "e2e-rd-bot-a@example.com";
const BOT_B_EMAIL = "e2e-rd-bot-b@example.com";
const PASSWORD    = "password123";

const KM_PER_DEG = 111.0;
// Must be between retreatKm=20 (fail) and retreatKm=50 (pass)
const MIN_RETREAT_TRAVEL_KM = 35;

// Throwaway test divisions spawned via SPAWN_DIVISION (bypasses territory-ownership
// validation) at the same coordinates the old default-roster front-line pair used
// (Sarreguemines / Metz) — preserves the ~37 km engagement-range distance.
const DE_DIV = "e2e-rd-de-front";
const FR_DIV = "e2e-rd-fr-front";
const DE_LNG = 6.500, DE_LAT = 49.190; // Sarreguemines
const FR_LNG = 6.175, FR_LAT = 49.123; // Metz

// ── Types ─────────────────────────────────────────────────────────────────────

interface DivisionUpdate {
  division_id: string;
  combat_state?: string;
  position_lng?: number;
  position_lat?: number;
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

/** Tracks the most-recently-seen values for a division across all DIVISION_UPDATES. */
function trackDivision(room: Room, divisionId: string): { current: DivisionUpdate } {
  const tracker = { current: { division_id: divisionId } as DivisionUpdate };
  room.onMessage("DIVISION_UPDATES", (msg: unknown) => {
    const m = msg as { divisions: DivisionUpdate[] };
    const found = m.divisions.find(d => d.division_id === divisionId);
    if (found) Object.assign(tracker.current, found);
  });
  return tracker;
}

function distKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
  return Math.sqrt((lng1 - lng2) ** 2 + (lat1 - lat2) ** 2) * KM_PER_DEG;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4C — retreat distance e2e test");
  console.log(`  Assertion: retreat travel distance ≥ ${MIN_RETREAT_TRAVEL_KM} km`);
  console.log(`  Front-line pair: ${DE_DIV} (Sarreguemines) vs ${FR_DIV} (Metz) — ~37 km apart\n`);

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
  const roomA   = await clientA.create("game_room", { token: botA.token });

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

  roomA.send("SELECT_NATION", { nation_id: "germany" });
  roomB.send("SELECT_NATION", { nation_id: "france" });
  await sleep(200);

  const gameStartedPromise      = waitForMessage(roomA, "GAME_STARTED",      10000);
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

  // Track both front-line divisions from spawn.
  // Their positions will be populated on the first DIVISION_UPDATES that includes them.
  const germTracker = trackDivision(roomA, DE_DIV);
  const frTracker   = trackDivision(roomA, FR_DIV);

  await waitForMessage(roomA, "COMBAT_STARTED", 20000);
  console.log("  ✓ COMBAT_STARTED");

  // Wait for one front-line division to enter "retreating".
  await waitForDivisionState(
    roomA,
    divs => divs.some(
      d => (d.division_id === DE_DIV || d.division_id === FR_DIV)
        && d.combat_state === "retreating",
    ),
    90000,
    "a front-line division enters 'retreating'",
  );

  // Determine which division is retreating and capture engagement position from tracker.
  // Position is frozen at the engagement point (movement_system skips "engaged"/"suppressed").
  const germState = germTracker.current.combat_state;
  const retreatingId = germState === "retreating" ? DE_DIV : FR_DIV;
  const retreatTracker = retreatingId === DE_DIV ? germTracker : frTracker;

  const engageLng = retreatTracker.current.position_lng ?? 0;
  const engageLat = retreatTracker.current.position_lat ?? 0;
  console.log(`  ${retreatingId} retreating from engagement position (${engageLng.toFixed(3)}, ${engageLat.toFixed(3)})`);

  // Wait for retreat to complete (combat_state → "idle").
  await waitForDivisionState(
    roomA,
    divs => divs.some(d => d.division_id === retreatingId && d.combat_state === "idle"),
    120000,
    `${retreatingId} returns to 'idle' after retreat`,
  );

  const finalLng = retreatTracker.current.position_lng ?? 0;
  const finalLat = retreatTracker.current.position_lat ?? 0;
  const travelKm = distKm(engageLng, engageLat, finalLng, finalLat);

  console.log(`  ${retreatingId} now at (${finalLng.toFixed(3)}, ${finalLat.toFixed(3)})`);
  console.log(`  Travel distance: ${travelKm.toFixed(1)} km (must be ≥ ${MIN_RETREAT_TRAVEL_KM} km)`);

  assert(
    travelKm >= MIN_RETREAT_TRAVEL_KM,
    `Retreat travel ${travelKm.toFixed(1)} km < ${MIN_RETREAT_TRAVEL_KM} km — increase retreatKm in _initiateRetreat`,
  );

  console.log(`\n✅ Retreat distance test passed (${travelKm.toFixed(1)} km ≥ ${MIN_RETREAT_TRAVEL_KM} km).`);

  roomA.leave();
  roomB.leave();
  await sleep(500);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\n❌ Retreat distance test failed:", message);
  process.exit(1);
});
