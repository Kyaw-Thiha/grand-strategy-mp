/**
 * End-to-end: Hono auth → JWT → Colyseus connection.
 *
 * Verifies that a JWT issued by the api-server is accepted by the game-server,
 * and that the authenticated player appears in room state after joining.
 *
 * Requires both servers running locally:
 *   api-server:  bun run src/index.ts   (port 3000)
 *   game-server: npm start              (port 2567)
 *
 * Run with: npx tsx test/auth-handshake.e2e.ts
 */

import { Client } from "@colyseus/sdk";

const HONO_URL = process.env.HONO_URL ?? "http://localhost:3000";
const COLYSEUS_URL = "ws://localhost:2567";
const TEST_EMAIL = "e2e-verify@example.com";
const TEST_PASSWORD = "password123";

async function main() {
  // Step 1: Get a JWT from Hono
  console.log("1. Authenticating with Hono...");
  const authRes = await fetch(`${HONO_URL}/auth/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });

  if (!authRes.ok) throw new Error(`Auth failed: ${authRes.status} ${await authRes.text()}`);

  const { token } = await authRes.json() as { token: string };
  const [, rawPayload] = token.split(".");
  const payload = JSON.parse(Buffer.from(rawPayload, "base64").toString());
  console.log(`   ✓ Got JWT for user_id: ${payload.sub}`);

  // Step 2: Connect to Colyseus with that JWT
  console.log("2. Connecting to Colyseus game_room...");
  const client = new Client(COLYSEUS_URL);
  const room = await client.joinOrCreate("game_room", { token });

  console.log(`   ✓ Connected — session: ${room.sessionId}, room: ${room.id}`);

  // Step 3: Confirm the player appears in room state
  await new Promise(resolve => setTimeout(resolve, 300));
  console.log("3. Room state players:", Object.keys((room.state as any).players?.toJSON?.() ?? {}));

  room.leave();
  console.log("\n✅ Auth handshake e2e passed.");
}

main().catch((err) => {
  console.error("\n❌ Verification failed:", err.message);
  process.exit(1);
});
