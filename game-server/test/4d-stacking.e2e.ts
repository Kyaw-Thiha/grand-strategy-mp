/**
 * Phase 4D end-to-end: stacking mechanics.
 *
 * germany_div_01 (Frankfurt, 8.684°E 50.063°N) and germany_div_04 (moved to 8.610°E 50.000°N)
 * spawn ~9 km apart — within the 15 km STACK_THRESHOLD_KM. Both have no active move orders
 * at spawn, so the stack detection system should form a stack automatically.
 *
 * Tests:
 *   A: STACK_FORMED fires with stack_id and both divisions in the array
 *   B: STACK_DISSOLVED fires after one division receives a MOVE order
 *
 * Run with: npx tsx test/4d-stacking.e2e.ts
 * Requires both servers running with DEV_MODE=true.
 */

import { Client, Room } from "@colyseus/sdk";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "e2e-4d-stack-a@example.com";
const BOT_B_EMAIL = "e2e-4d-stack-b@example.com";
const PASSWORD    = "password123";

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
  predicate: (divs: { division_id: string; stack_id?: string }[]) => boolean,
  timeoutMs = 30000,
  description = "condition",
): Promise<{ division_id: string; stack_id?: string }[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${description}`)), timeoutMs);
    room.onMessage("DIVISION_UPDATES", (msg: unknown) => {
      const m = msg as { divisions: { division_id: string; stack_id?: string }[] };
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
  console.log("Phase 4D — Stacking Mechanics\n");
  console.log("  Stack pair: germany_div_01 (Frankfurt) + germany_div_04 (moved to 8.610, 50.000)");
  console.log("  Spawn distance: ~9 km — within 15 km STACK_THRESHOLD_KM\n");

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

  // Register listeners BEFORE START_GAME to catch first-tick events
  let _stackFormedStackId: string | null = null;
  const stackFormedMsgPromise = new Promise<{ stack_id: string; divisions: string[] }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for STACK_FORMED with germany_div_01 + germany_div_04")), 20000);
    const handler = (msg: unknown) => {
      const m = msg as { stack_id: string; divisions: string[] };
      if (m.divisions.includes("germany_div_01") && m.divisions.includes("germany_div_04")) {
        _stackFormedStackId = m.stack_id;
        clearTimeout(timer);
        resolve(m);
      }
    };
    roomA.onMessage("STACK_FORMED", handler);
    roomB.onMessage("STACK_FORMED", handler);
  });

  const stackDissolvedMsgPromise = new Promise<{ stack_id: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for STACK_DISSOLVED (stack not dissolving after move order)`));
    }, 25000);
    roomA.onMessage("STACK_DISSOLVED", (msg: unknown) => {
      const m = msg as { stack_id: string };
      resolve(m);
    });
  });

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

  const gd01 = spawnMsg.divisions.find(d => d.division_id === "germany_div_01");
  const gd04 = spawnMsg.divisions.find(d => d.division_id === "germany_div_04");
  assert(!!gd01, "germany_div_01 not in spawn list");
  assert(!!gd04, "germany_div_04 not in spawn list");

  const dx = gd01!.position_lng - gd04!.position_lng;
  const dy = gd01!.position_lat - gd04!.position_lat;
  const distKm = Math.sqrt(dx * dx + dy * dy) * 111;
  console.log(`   germany_div_01: (${gd01!.position_lng.toFixed(3)}, ${gd01!.position_lat.toFixed(3)})`);
  console.log(`   germany_div_04: (${gd04!.position_lng.toFixed(3)},  ${gd04!.position_lat.toFixed(3)})`);
  console.log(`   Spawn distance: ${distKm.toFixed(1)} km (stack threshold: ≤ 15 km)`);
  assert(distKm <= 15, `Divisions too far apart to stack: ${distKm.toFixed(1)} km`);

  // ── Test A: STACK_FORMED ──────────────────────────────────────────────────
  console.log("\n--- Test A: STACK_FORMED ---");

  const stackFormedMsg = await stackFormedMsgPromise;
  assert(!!stackFormedMsg.stack_id, "STACK_FORMED missing stack_id");
  assert(stackFormedMsg.divisions.length >= 2,
    `STACK_FORMED divisions array too short: ${JSON.stringify(stackFormedMsg.divisions)}`);

  console.log(`   ✓ STACK_FORMED — stack_id: ${stackFormedMsg.stack_id}`);
  console.log(`   ✓ Divisions: ${JSON.stringify(stackFormedMsg.divisions)}`);

  // Verify DIVISION_UPDATES confirms stack_id
  console.log("5. Verifying DIVISION_UPDATES shows stack_id on both divisions...");
  const stackConfirmDivs = await waitForDivisionState(
    roomA,
    divs => {
      const d01 = divs.find(d => d.division_id === "germany_div_01");
      const d04 = divs.find(d => d.division_id === "germany_div_04");
      return !!(d01 && d04 && d01.stack_id !== "" && d01.stack_id === d04.stack_id);
    },
    10000,
    "both divisions have matching non-empty stack_id",
  );
  const d01Stack = stackConfirmDivs.find(d => d.division_id === "germany_div_01")?.stack_id;
  const d04Stack = stackConfirmDivs.find(d => d.division_id === "germany_div_04")?.stack_id;
  assert(d01Stack === stackFormedMsg.stack_id, `germany_div_01 stack_id mismatch: ${d01Stack} vs ${stackFormedMsg.stack_id}`);
  assert(d04Stack === stackFormedMsg.stack_id, `germany_div_04 stack_id mismatch: ${d04Stack} vs ${stackFormedMsg.stack_id}`);
  console.log(`   ✓ germany_div_01.stack_id: ${d01Stack}`);
  console.log(`   ✓ germany_div_04.stack_id: ${d04Stack}`);

  // ── Test B: STACK_DISSOLVED ────────────────────────────────────────────────
  console.log("\n--- Test B: STACK_DISSOLVED ---");

  console.log("6. Sending MOVE order to germany_div_01 to break the stack...");
  // Listen for rejection before sending
  let moveRejected = false;
  roomA.onMessage("MOVE_ORDER_REJECTED", (msg: unknown) => {
    const m = msg as { division_id: string; reason: string };
    console.log(`   [diag] MOVE_ORDER_REJECTED: ${m.division_id} — ${m.reason}`);
    moveRejected = true;
  });
  // Use a known valid waypoint ID near the division's position
  roomA.send("SUBMIT_MOVE_ORDER", {
    division_id: "germany_div_01",
    waypoints: ["wp_079006"],  // Berlin — far enough that division doesn't arrive immediately
  });
  console.log("   ✓ MOVE order submitted");
  await sleep(1000);
  assert(!moveRejected, "MOVE order was rejected — waypoint ID may be invalid");

  const stackDissolvedMsg = await stackDissolvedMsgPromise;
  assert(!!stackDissolvedMsg.stack_id, "STACK_DISSOLVED missing stack_id");
  console.log(`   ✓ STACK_DISSOLVED — stack_id: ${stackDissolvedMsg.stack_id}`);

  console.log("7. Verifying DIVISION_UPDATES clears stack_id on moved division...");
  const dissolveConfirmDivs = await waitForDivisionState(
    roomA,
    divs => {
      const d01 = divs.find(d => d.division_id === "germany_div_01");
      return !!(d01 && (d01.stack_id === "" || d01.stack_id === undefined));
    },
    10000,
    "germany_div_01 has empty stack_id after dissolve",
  );
  const d01Post = dissolveConfirmDivs.find(d => d.division_id === "germany_div_01");
  console.log(`   ✓ germany_div_01.stack_id after dissolve: "${d01Post?.stack_id ?? ""}"`);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  roomA.leave();
  roomB.leave();

  console.log("\n✅ Phase 4D — Stacking e2e passed.");
}

main().catch((err) => {
  console.error("\n❌ Phase 4D — Stacking e2e failed:", err.message);
  process.exit(1);
});
