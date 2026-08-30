import { Client } from "@colyseus/sdk";

const HONO_URL     = "http://localhost:3000";
const COLYSEUS_URL = "ws://localhost:2567";
const EMAIL = "debug-test@example.com";
const PASS  = "password123";

async function main() {
  // Register/login
  await fetch(`${HONO_URL}/auth/email`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({email:EMAIL, password:PASS}) });
  const r = await fetch(`${HONO_URL}/auth/email`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({email:EMAIL, password:PASS}) });
  const { token } = await r.json() as {token:string};

  await fetch(`${HONO_URL}/auth/email`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({email:"debug-b@example.com", password:PASS}) });
  const r2 = await fetch(`${HONO_URL}/auth/email`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({email:"debug-b@example.com", password:PASS}) });
  const { token: tokenB } = await r2.json() as {token:string};

  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  console.log("has_host_pass:", payload.has_host_pass);

  const cr = await fetch(`${HONO_URL}/lobby/create`, { method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`}, body: JSON.stringify({}) });
  const { join_code } = await cr.json() as {join_code:string};

  const clientA = new Client(COLYSEUS_URL);
  const roomA = await clientA.create("game_room", { token });

  await fetch(`${HONO_URL}/lobby/activate`, { method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`}, body: JSON.stringify({join_code, room_id: roomA.roomId}) });
  const rr = await fetch(`${HONO_URL}/lobby/resolve/${join_code}`);
  const { room_id } = await rr.json() as {room_id:string};
  const clientB = new Client(COLYSEUS_URL);
  const roomB = await clientB.joinById(room_id, { token: tokenB });

  roomA.send("SELECT_NATION", { nation_id: "germany" });
  roomB.send("SELECT_NATION", { nation_id: "france" });
  await new Promise(r => setTimeout(r, 300));

  roomA.onMessage("GAME_STARTED", () => console.log("GAME_STARTED"));
  roomA.onMessage("DIVISIONS_SPAWNED", () => console.log("DIVISIONS_SPAWNED"));
  roomA.onMessage("COMBAT_STARTED", (msg) => console.log("COMBAT_STARTED:", JSON.stringify(msg)));
  // Throwaway test division IDs, spawned via the test-only SPAWN_DIVISION message (which
  // does not validate territory ownership). The default roster no longer includes a
  // front-line pair that legally starts within engagement range (the old germany_div_05
  // spawn was a data bug inside French territory and has been removed).
  const DE_DIV = "debug-de-front";
  const FR_DIV = "debug-fr-front";

  roomA.onMessage("DIVISION_UPDATES", (msg: any) => {
    const front = msg.divisions?.filter((d: any) => d.division_id === DE_DIV || d.division_id === FR_DIV);
    if (front?.length) console.log("DIVISION_UPDATES front-pair:", JSON.stringify(front));
  });

  roomA.send("SET_READY", { ready: true });
  roomB.send("SET_READY", { ready: true });
  await new Promise(r => setTimeout(r, 200));
  roomA.send("START_GAME", {});
  await new Promise(r => setTimeout(r, 500));

  // Spawn our own throwaway front-line pair ~37 km apart (Sarreguemines / Metz coords) —
  // within the 50 km engagement range — so combat starts automatically.
  roomA.send("SPAWN_DIVISION", { division_id: DE_DIV, nation_id: "germany", position_lng: 6.500, position_lat: 49.190 });
  roomB.send("SPAWN_DIVISION", { division_id: FR_DIV, nation_id: "france", position_lng: 6.175, position_lat: 49.123 });

  await new Promise(r => setTimeout(r, 20000));
  roomA.leave(); roomB.leave();
  console.log("done");
}

main().catch(e => { console.error(e); process.exit(1); });
