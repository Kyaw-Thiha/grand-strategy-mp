import { Room, Client, CloseCode } from "colyseus";
import { jwtVerify } from "jose";
import { GameRoomState, PlayerState } from "./schema/GameRoomState.js";

interface JwtPayload {
  sub: string;
  steam_id: string;
  has_host_pass: boolean;
}

export class GameRoom extends Room<GameRoomState> {
  maxClients = 16;

  messages = {
    // yourMessageType: (client: Client, message: any) => {
    //   /**
    //    * Handle "yourMessageType" message.
    //    */
    //   console.log(client.sessionId, "sent a message:", message);
    // }
  }

  async onAuth(_client: Client, options: { token?: string }) {
    /**
     * Verify the JWT issued by the Hono api-server.
     * Throws on failure — Colyseus rejects the client automatically.
     */
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    try {
      const { payload } = await jwtVerify(options.token ?? "", secret, { algorithms: ["HS256"] });
      return payload as unknown as JwtPayload;
    } catch {
      throw new Error("Invalid or expired token");
    }
  }

  onCreate() {
    /**
     * Called when a new room is created.
     */
    this.setState(new GameRoomState());
    console.log(`[GameRoom] ${this.roomId} created`);
  }

  onJoin(client: Client, _options: unknown, auth: JwtPayload) {
    /**
     * Called when a client joins the room.
     */
    const player = new PlayerState();
    player.userId = auth.sub;
    player.steamId = auth.steam_id;
    player.hasHostPass = auth.has_host_pass;
    this.state.players.set(client.sessionId, player);
    console.log(`[GameRoom] ${auth.sub} joined (${client.sessionId})`);
  }

  onLeave(client: Client, _code: CloseCode) {
    /**
     * Called when a client leaves the room.
     */
    this.state.players.delete(client.sessionId);
    console.log(`[GameRoom] ${client.sessionId} left`);
  }

  onDispose() {
    /**
     * Called when the room is disposed.
     */
    console.log(`[GameRoom] ${this.roomId} disposed`);
  }
}
