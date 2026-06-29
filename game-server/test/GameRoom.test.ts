import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { GameRoomState } from "../src/rooms/schema/GameRoomState.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(payload: object, secret = jwtSecret) {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(secret);
}

describe("GameRoom", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());
  beforeEach(async () => await colyseus.cleanup());

  describe("onAuth()", () => {
    it("accepts a valid JWT and returns the payload", async () => {
      const token = await makeToken({ sub: "user-123", steam_id: "dev_steamid", has_host_pass: false });
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const client = await colyseus.connectTo(room, { token });

      assert.strictEqual(client.sessionId, room.clients[0].sessionId);
    });

    it("rejects a JWT signed with the wrong secret", async () => {
      const wrongSecret = new TextEncoder().encode("wrong-secret");
      const token = await makeToken({ sub: "user-123", steam_id: "dev_steamid", has_host_pass: false }, wrongSecret);
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});

      await assert.rejects(() => colyseus.connectTo(room, { token }));
    });

    it("rejects a request with no token", async () => {
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      await assert.rejects(() => colyseus.connectTo(room, {}));
    });
  });

  describe("onJoin()", () => {
    it("adds the player to room state with correct fields", async () => {
      const token = await makeToken({ sub: "user-abc", steam_id: "dev_steamid", has_host_pass: true });
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const client = await colyseus.connectTo(room, { token });

      await room.waitForNextPatch();

      const player = room.state.players.get(client.sessionId);
      assert.strictEqual(player?.userId, "user-abc");
      assert.strictEqual(player?.hasHostPass, true);
    });
  });

  describe("SEND_CHAT", () => {
    it("broadcasts a trimmed chat message with sender email to all clients", async () => {
      const tokenA = await makeToken({
        sub: "user-a",
        email: "alpha@example.com",
        steam_id: "dev_steamid",
        has_host_pass: true,
      });
      const tokenB = await makeToken({
        sub: "user-b",
        email: "bravo@example.com",
        steam_id: "dev_steamid",
        has_host_pass: false,
      });
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const clientA = await colyseus.connectTo(room, { token: tokenA });
      const clientB = await colyseus.connectTo(room, { token: tokenB });

      const receivedA = new Promise<any>(resolve => clientA.onMessage("CHAT_MESSAGE", resolve));
      const receivedB = new Promise<any>(resolve => clientB.onMessage("CHAT_MESSAGE", resolve));

      clientA.send("SEND_CHAT", { message: "  Hold the line.  " });

      const [messageA, messageB] = await Promise.all([receivedA, receivedB]);
      for (const message of [messageA, messageB]) {
        assert.strictEqual(message.user_id, "user-a");
        assert.strictEqual(message.email, "alpha@example.com");
        assert.strictEqual(message.message, "Hold the line.");
        assert.match(message.time, /^\d{2}:\d{2}$/);
      }
    });

    it("does not broadcast blank chat messages", async () => {
      const token = await makeToken({
        sub: "user-a",
        email: "alpha@example.com",
        steam_id: "dev_steamid",
        has_host_pass: true,
      });
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const client = await colyseus.connectTo(room, { token });
      let received = false;
      client.onMessage("CHAT_MESSAGE", () => {
        received = true;
      });

      client.send("SEND_CHAT", { message: "   " });
      await new Promise(resolve => setTimeout(resolve, 100));

      assert.strictEqual(received, false);
    });
  });

  describe("onLeave()", () => {
    it("removes the player from room state on disconnect", async () => {
      const token = await makeToken({ sub: "user-abc", steam_id: "dev_steamid", has_host_pass: false });
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const client = await colyseus.connectTo(room, { token });

      await room.waitForNextPatch();
      assert.strictEqual(room.state.players.size, 1);

      client.leave();
      await new Promise(resolve => setTimeout(resolve, 200));
      assert.strictEqual(room.state.players.size, 0);
    });
  });
});
