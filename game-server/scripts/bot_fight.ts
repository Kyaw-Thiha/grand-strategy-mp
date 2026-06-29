/**
 * Bot fight script — live observation tool for Phase 6 gate.
 *
 * Starts a game with two bot players, assigns preset templates to the
 * front-line divisions, and prints all combat events so a human can watch
 * the tactical grid in the Godot client.
 *
 * Usage:
 *   NODE_ENV=development npx tsx scripts/bot_fight.ts
 *
 * Requires both the Hono API server and Colyseus game server running locally
 * (e.g. with `pnpm --filter api-server dev` and `pnpm --filter game-server start`).
 */

import { Client, Room } from "@colyseus/sdk";

const HONO_URL     = process.env.HONO_URL     ?? "http://localhost:3000";
const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";

const BOT_A_EMAIL = "bot-fight-a@example.com";
const BOT_B_EMAIL = "bot-fight-b@example.com";
const PASSWORD    = "password123";

async function register(email: string): Promise<void> {
  const res = await fetch(`${HONO_URL}/auth/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`Register failed: ${res.status}`);
}

async function login(email: string): Promise<{ token: string }> {
  const res = await fetch(`${HONO_URL}/auth/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return await res.json() as { token: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

async function main() {
  console.log(`[${timestamp()}] Bot fight — Phase 6 integration gate\n`);

  // 1. Auth both bots
  console.log(`[${timestamp()}] Registering and logging in...`);
  await register(BOT_A_EMAIL);
  await register(BOT_B_EMAIL);
  const botA = await login(BOT_A_EMAIL);
  const botB = await login(BOT_B_EMAIL);
  console.log(`[${timestamp()}] Both bots authenticated`);

  // 2. Create lobby via Hono
  console.log(`[${timestamp()}] Creating lobby...`);
  const createRes = await fetch(`${HONO_URL}/lobby/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${botA.token}` },
    body: JSON.stringify({}),
  });
  if (!createRes.ok) throw new Error(`Lobby create failed: ${createRes.status}`);
  const { join_code } = await createRes.json() as { join_code: string };

  // 3. BotA creates the Colyseus room
  const clientA = new Client(COLYSEUS_URL);
  const roomA: Room = await clientA.create("game_room", { token: botA.token });

  // 4. Activate lobby
  await fetch(`${HONO_URL}/lobby/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${botA.token}` },
    body: JSON.stringify({ join_code, room_id: roomA.roomId }),
  });

  // 5. BotB resolves and joins
  const resolveRes = await fetch(`${HONO_URL}/lobby/resolve/${join_code}`);
  const { room_id } = await resolveRes.json() as { room_id: string };
  const clientB = new Client(COLYSEUS_URL);
  const roomB: Room = await clientB.joinById(room_id, { token: botB.token });

  // 6. Select nations and start
  console.log(`[${timestamp()}] Selecting nations and starting game...`);
  roomA.send("SELECT_NATION", { nation_id: "germany" });
  roomB.send("SELECT_NATION", { nation_id: "france" });
  await sleep(200);

  const gameStartedPromise = new Promise<void>((resolve) => {
    roomA.onMessage("GAME_STARTED", () => resolve());
  });

  roomA.send("SET_READY", { ready: true });
  roomB.send("SET_READY", { ready: true });
  await sleep(200);
  roomA.send("START_GAME", {});

  await gameStartedPromise;
  console.log(`[${timestamp()}] Game started — waiting for combat...`);

  // 7. Listen for combat events and print them with timestamps
  roomA.onMessage("COMBAT_STARTED", (msg: any) => {
    console.log(`[${timestamp()}] COMBAT_STARTED — ${msg.division_a} vs ${msg.division_b} (meeting: ${msg.is_meeting_battle})`);
  });

  roomA.onMessage("ROUND_RESOLVED", (msg: any) => {
    const aDmg = (msg.attacker_grid_delta ?? []).reduce((s: number, d: any) => s + Math.abs(d.hp ?? 0), 0);
    const dDmg = (msg.defender_grid_delta ?? []).reduce((s: number, d: any) => s + Math.abs(d.hp ?? 0), 0);
    console.log(`[${timestamp()}] ROUND_RESOLVED #${msg.round_number} phase=${msg.lethality_phase} atkDmg=${aDmg.toFixed(1)} defDmg=${dDmg.toFixed(1)}`);
  });

  roomA.onMessage("COMBAT_RESULT", (msg: any) => {
    console.log(`[${timestamp()}] COMBAT_RESULT — round=${msg.round} hp: ${msg.division_a}=${msg.hp_a?.toFixed(1)} ${msg.division_b}=${msg.hp_b?.toFixed(1)} supp: ${msg.division_a}=${msg.suppression_a?.toFixed(1)} ${msg.division_b}=${msg.suppression_b?.toFixed(1)}`);
  });

  roomA.onMessage("UNIT_INCAPACITATED", (msg: any) => {
    console.log(`[${timestamp()}] UNIT_INCAPACITATED — ${msg.division_id} cell ${msg.cell_index}`);
  });

  roomA.onMessage("COMBAT_ENDED", (msg: any) => {
    console.log(`[${timestamp()}] COMBAT_ENDED — winner: ${msg.winner_id} retreated: ${msg.retreated_id}`);
    console.log(`\n[${timestamp()}] Bot fight complete.`);
    process.exit(0);
  });

  // 8. Timeout — if combat takes too long, exit anyway
  setTimeout(() => {
    console.log(`[${timestamp()}] Timeout — combat did not end within 5 minutes`);
    process.exit(1);
  }, 5 * 60 * 1000);
}

main().catch((err) => {
  console.error(`\n[${timestamp()}] Bot fight failed:`, err.message);
  process.exit(1);
});
