import { Room, Client, CloseCode } from "colyseus";
import { jwtVerify } from "jose";
import { GameRoomState, PlayerState, NationState } from "./schema/GameRoomState.js";
import { getMapNationIds } from "../data/map_loader.js";

interface JwtPayload {
  sub: string;
  steam_id: string;
  has_host_pass: boolean;
}

const API_SERVER_URL = process.env.API_SERVER_URL ?? "http://localhost:3000";
const MIN_PLAYERS_TO_START = 2;

export class GameRoom extends Room<{ state: GameRoomState }> {
  maxClients = 6;

  private hostSessionId: string = "";
  private gameStartedAt: Date | null = null;
  private nationIds: string[] = [];

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

  async onCreate() {
    /**
     * Seed the nations map with all 6 playable slots (empty player_id).
     * Slots are claimed by SELECT_NATION messages.
     */
    this.setState(new GameRoomState());

    this.nationIds = await getMapNationIds(this.state.map_id);
    for (const nationId of this.nationIds) {
      const slot = new NationState();
      slot.nation_id = nationId;
      this.state.nations.set(nationId, slot);
    }

    this.onMessage("SELECT_NATION",  (client, msg) => this.handleSelectNation(client, msg));
    this.onMessage("DESELECT_NATION", (client, _msg) => this.handleDeselectNation(client));
    this.onMessage("SET_READY",      (client, msg) => this.handleSetReady(client, msg));
    this.onMessage("START_GAME",     (client, _msg) => this.handleStartGame(client));
    this.onMessage("VOTE_SPEED",     (client, msg) => this.handleVoteSpeed(client, msg));
    this.onMessage("END_GAME",       (client, _msg) => this.handleEndGame(client));

    console.log(`[GameRoom] ${this.roomId} created`);
  }

  onJoin(client: Client, _options: unknown, auth: JwtPayload) {
    const player = new PlayerState();
    player.userId = auth.sub;
    player.steamId = auth.steam_id;
    player.hasHostPass = auth.has_host_pass;
    this.state.players.set(client.sessionId, player);

    // First to join is host
    if (this.state.players.size === 1) {
      this.hostSessionId = client.sessionId;
    }

    console.log(`[GameRoom] ${auth.sub} joined (${client.sessionId}), host=${this.hostSessionId === client.sessionId}`);
  }

  onLeave(client: Client, _code: CloseCode) {
    const player = this.state.players.get(client.sessionId);
    const userId = player?.userId ?? "";

    this.state.players.delete(client.sessionId);

    // Free any nation slot this player held
    if (userId) {
      for (const nation of this.state.nations.values()) {
        if (nation.player_id === userId) {
          nation.player_id = "";
          nation.is_ready = false;
          break;
        }
      }
    }

    // Transfer host if needed
    if (this.hostSessionId === client.sessionId && this.state.players.size > 0) {
      this.hostSessionId = this.state.players.keys().next().value ?? "";
      console.log(`[GameRoom] host transferred to ${this.hostSessionId}`);
    }

    console.log(`[GameRoom] ${client.sessionId} left (${this.state.players.size} remaining)`);
  }

  onDispose() {
    console.log(`[GameRoom] ${this.roomId} disposed`);
  }

  // ── Message handlers ────────────────────────────────────────────────────────

  private handleSelectNation(client: Client, msg: { nation_id?: string }) {
    if (this.state.phase !== "lobby") return;

    const nationId = msg.nation_id ?? "";
    if (!this.nationIds.includes(nationId)) {
      client.send("ERROR", { message: `Unknown nation: ${nationId}` });
      return;
    }

    const slot = this.state.nations.get(nationId)!;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (slot.player_id !== "" && slot.player_id !== player.userId) {
      client.send("ERROR", { message: "Nation already taken" });
      return;
    }

    // Free the player's previous slot if they had one
    this.clearNationForPlayer(player.userId);

    slot.player_id = player.userId;
    slot.is_ready = false;

    this.checkAutoStart();
  }

  private handleDeselectNation(client: Client) {
    if (this.state.phase !== "lobby") return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    this.clearNationForPlayer(player.userId);
  }

  private handleSetReady(client: Client, msg: { ready?: boolean }) {
    if (this.state.phase !== "lobby") return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const nation = this.getNationForPlayer(player.userId);
    if (!nation) {
      client.send("ERROR", { message: "Select a nation before readying" });
      return;
    }

    nation.is_ready = msg.ready ?? true;
    this.checkAutoStart();
  }

  private handleStartGame(client: Client) {
    if (this.state.phase !== "lobby") return;
    if (client.sessionId !== this.hostSessionId) {
      client.send("ERROR", { message: "Only the host can start the game" });
      return;
    }

    const readyCount = [...this.state.nations.values()]
      .filter(n => n.player_id !== "" && n.is_ready).length;

    if (readyCount < MIN_PLAYERS_TO_START) {
      client.send("ERROR", { message: `Need at least ${MIN_PLAYERS_TO_START} ready players` });
      return;
    }

    this.startGame();
  }

  private handleVoteSpeed(client: Client, msg: { speed?: number }) {
    if (this.state.phase !== "running") return;
    const speed = msg.speed ?? 1;
    if (speed < 1 || speed > 5) return;
    this.state.game_speed = speed;
  }

  private handleEndGame(client: Client) {
    if (this.state.phase !== "running") return;
    if (client.sessionId !== this.hostSessionId) {
      client.send("ERROR", { message: "Only the host can end the game" });
      return;
    }

    const winner = this.resolveWinner();
    this.endGame(winner);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private clearNationForPlayer(userId: string) {
    for (const nation of this.state.nations.values()) {
      if (nation.player_id === userId) {
        nation.player_id = "";
        nation.is_ready = false;
        break;
      }
    }
  }

  private getNationForPlayer(userId: string): NationState | null {
    for (const nation of this.state.nations.values()) {
      if (nation.player_id === userId) return nation;
    }
    return null;
  }

  /**
   * Auto-start when all 6 nation slots are filled and every filled slot is ready.
   * Requires at least MIN_PLAYERS_TO_START players.
   */
  private checkAutoStart() {
    if (this.state.phase !== "lobby") return;

    const slots = [...this.state.nations.values()];
    const filled = slots.filter(n => n.player_id !== "");
    const allReady = filled.length >= MIN_PLAYERS_TO_START &&
      filled.every(n => n.is_ready) &&
      filled.length === this.nationIds.length; // all slots taken

    if (allReady) this.startGame();
  }

  private startGame() {
    this.state.phase = "running";
    this.gameStartedAt = new Date();

    const assignments: Record<string, string> = {};
    for (const [id, nation] of this.state.nations.entries()) {
      assignments[id] = nation.player_id;
    }

    this.broadcast("GAME_STARTED", {
      nation_assignments: assignments,
      game_speed: this.state.game_speed,
    });

    console.log(`[GameRoom] ${this.roomId} game started`);
  }

  private resolveWinner(): string {
    // Placeholder — Phase 4/5 will compute the real winner from game state
    return "";
  }

  private endGame(winnerId: string) {
    this.state.phase = "ended";

    this.broadcast("GAME_ENDED", {
      winner_id: winnerId,
      reason: "host_ended",
    });

    this.notifyGameEnd(winnerId).catch(err =>
      console.error("[GameRoom] Failed to notify game end:", err)
    );

    console.log(`[GameRoom] ${this.roomId} game ended`);
  }

  private async notifyGameEnd(winnerId: string) {
    await fetch(`${API_SERVER_URL}/internal/game-end`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Internal ${process.env.INTERNAL_SECRET}`,
      },
      body: JSON.stringify({
        room_id: this.roomId,
        result_json: { winner_id: winnerId },
        started_at: this.gameStartedAt?.toISOString(),
      }),
    });
  }
}
