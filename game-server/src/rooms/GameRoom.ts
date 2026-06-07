import { Room, Client, CloseCode } from "colyseus";
import { jwtVerify } from "jose";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { GameRoomState, PlayerState, NationState, DivisionState, ProvinceState } from "./schema/GameRoomState.js";
import { getMapNationIds } from "../data/map_loader.js";
import { MovementSystem } from "../systems/movement_system.js";
import { CombatSystem } from "../systems/combat_system.js";
import { STARTING_POSITIONS } from "../data/maps/western_europe_6/starting_positions.js";
import { DEFAULT_TEMPLATE } from "../data/maps/western_europe_6/default_template.js";

interface JwtPayload {
  sub: string;
  steam_id: string;
  has_host_pass: boolean;
}

const API_SERVER_URL = process.env.API_SERVER_URL ?? "http://localhost:3000";
const MIN_PLAYERS_TO_START = 2;
const TICK_MS = 1000;

export class GameRoom extends Room<{ state: GameRoomState }> {
  maxClients = 6;

  private hostSessionId: string = "";
  private gameStartedAt: Date | null = null;
  private nationIds: string[] = [];
  private tickCount = 0;
  private movementSystem = new MovementSystem();
  private combatSystem = new CombatSystem(this.movementSystem);

  async onAuth(_client: Client, options: { token?: string }) {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    try {
      const { payload } = await jwtVerify(options.token ?? "", secret, { algorithms: ["HS256"] });
      return payload as unknown as JwtPayload;
    } catch {
      throw new Error("Invalid or expired token");
    }
  }

  async onCreate() {
    this.setState(new GameRoomState());

    this.nationIds = await getMapNationIds(this.state.map_id);
    for (const nationId of this.nationIds) {
      const slot = new NationState();
      slot.nation_id = nationId;
      this.state.nations.set(nationId, slot);
    }

    this.onMessage("SELECT_NATION",    (client, msg) => this.handleSelectNation(client, msg));
    this.onMessage("DESELECT_NATION",  (client, _msg) => this.handleDeselectNation(client));
    this.onMessage("SET_READY",        (client, msg) => this.handleSetReady(client, msg));
    this.onMessage("START_GAME",       (client, _msg) => this.handleStartGame(client));
    this.onMessage("VOTE_SPEED",       (client, msg) => this.handleVoteSpeed(client, msg));
    this.onMessage("END_GAME",         (client, _msg) => this.handleEndGame(client));
    this.onMessage("SUBMIT_MOVE_ORDER",(client, msg) => this.handleSubmitMoveOrder(client, msg));
    this.onMessage("HOLD",             (client, msg) => this.handleHold(client, msg));
    this.onMessage("RETREAT",          (client, msg) => this.handleRetreat(client, msg));

    console.log(`[GameRoom] ${this.roomId} created`);
  }

  onJoin(client: Client, _options: unknown, auth: JwtPayload) {
    const player = new PlayerState();
    player.userId = auth.sub;
    player.steamId = auth.steam_id;
    player.hasHostPass = auth.has_host_pass;
    this.state.players.set(client.sessionId, player);

    if (this.state.players.size === 1) {
      this.hostSessionId = client.sessionId;
    }

    console.log(`[GameRoom] ${auth.sub} joined (${client.sessionId}), host=${this.hostSessionId === client.sessionId}`);
    this.broadcastLobbyState();
  }

  onLeave(client: Client, _code: CloseCode) {
    const player = this.state.players.get(client.sessionId);
    const userId = player?.userId ?? "";

    this.state.players.delete(client.sessionId);

    if (userId) {
      for (const nation of this.state.nations.values()) {
        if (nation.player_id === userId) {
          nation.player_id = "";
          nation.is_ready = false;
          break;
        }
      }
    }

    if (this.hostSessionId === client.sessionId && this.state.players.size > 0) {
      this.hostSessionId = this.state.players.keys().next().value ?? "";
      console.log(`[GameRoom] host transferred to ${this.hostSessionId}`);
    }

    console.log(`[GameRoom] ${client.sessionId} left (${this.state.players.size} remaining)`);
    this.broadcastLobbyState();
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

    this.clearNationForPlayer(player.userId);
    slot.player_id = player.userId;
    slot.is_ready = false;

    this.broadcastLobbyState();
    this.checkAutoStart();
  }

  private handleDeselectNation(client: Client) {
    if (this.state.phase !== "lobby") return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    this.clearNationForPlayer(player.userId);
    this.broadcastLobbyState();
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
    this.broadcastLobbyState();
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
    this.endGame("");
  }

  private handleSubmitMoveOrder(client: Client, msg: { division_id?: string; waypoints?: string[] }) {
    if (this.state.phase !== "running") return;
    const divisionId = msg.division_id ?? "";
    const waypoints = msg.waypoints ?? [];

    const division = this.state.divisions.get(divisionId);
    if (!division) {
      client.send("ERROR", { message: `Unknown division: ${divisionId}` });
      return;
    }

    // Verify ownership
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const nation = this.getNationForPlayer(player.userId);
    if (!nation || nation.nation_id !== division.nation_id) {
      client.send("ERROR", { message: "Not your division" });
      return;
    }

    if (!this.movementSystem.validateMoveOrder(waypoints)) {
      client.send("MOVE_ORDER_REJECTED", { division_id: divisionId, reason: "invalid_waypoints" });
      return;
    }

    // Replace existing move order
    division.move_order.splice(0, division.move_order.length);
    for (const wpId of waypoints) {
      division.move_order.push(wpId);
    }
  }

  private handleHold(client: Client, msg: { division_id?: string }) {
    if (this.state.phase !== "running") return;
    const divisionId = msg.division_id ?? "";
    const division = this.state.divisions.get(divisionId);
    if (!division) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const nation = this.getNationForPlayer(player.userId);
    if (!nation || nation.nation_id !== division.nation_id) return;

    division.move_order.splice(0, division.move_order.length);
  }

  private handleRetreat(client: Client, msg: { division_id?: string }) {
    if (this.state.phase !== "running") return;
    const divisionId = msg.division_id ?? "";
    const division = this.state.divisions.get(divisionId);
    if (!division) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const nation = this.getNationForPlayer(player.userId);
    if (!nation || nation.nation_id !== division.nation_id) return;

    const enemies: DivisionState[] = [];
    for (const eid of division.engaged_with) {
      const e = this.state.divisions.get(eid);
      if (e) enemies.push(e);
    }
    this.combatSystem.initiateRetreat(division, enemies);
  }

  // ── Game lifecycle ──────────────────────────────────────────────────────────

  private startGame() {
    this.state.phase = "running";
    this.gameStartedAt = new Date();

    // Load waypoints for movement and map data for combat
    this.movementSystem.loadWaypoints(this.state.map_id);
    this.combatSystem.loadMapData(this.state.map_id);
    this._initProvinces(this.state.map_id);

    // Spawn all divisions
    this.spawnDivisions();

    // Broadcast GAME_STARTED (existing clients listen for this)
    const assignments: Record<string, string> = {};
    for (const [id, nation] of this.state.nations.entries()) {
      assignments[id] = nation.player_id;
    }
    this.broadcast("GAME_STARTED", {
      nation_assignments: assignments,
      game_speed: this.state.game_speed,
    });

    // Send full initial division state
    this.broadcast("DIVISIONS_SPAWNED", {
      divisions: this.serializeDivisions(),
    });

    // Start game loop
    this.clock.setInterval(() => this.gameTick(), TICK_MS);

    console.log(`[GameRoom] ${this.roomId} game started, ${this.state.divisions.size} divisions spawned`);
  }

  private spawnDivisions() {
    const profile = this.movementSystem.computeMovementProfile(DEFAULT_TEMPLATE);
    const divisionType = this.movementSystem.classifyDivisionType(DEFAULT_TEMPLATE);
    const engagementRadius = this.movementSystem.computeEngagementRadius(DEFAULT_TEMPLATE);
    const observationRadius = this.movementSystem.computeObservationRadius(DEFAULT_TEMPLATE);
    const profileJson = JSON.stringify(profile);

    for (const spawn of STARTING_POSITIONS) {
      const div = new DivisionState();
      div.division_id = spawn.division_id;
      div.nation_id = spawn.nation_id;
      div.division_type = divisionType;
      div.position_lng = spawn.lng;
      div.position_lat = spawn.lat;
      div.hp = 100;
      div.suppression = 0;
      div.combat_state = "idle";
      div.supply_status = "normal";
      div.observation_radius = observationRadius;
      div.engagement_radius = engagementRadius;
      div.movement_profile_json = profileJson;
      this.state.divisions.set(spawn.division_id, div);
    }
  }

  private gameTick() {
    if (this.state.phase !== "running") return;
    this.tickCount++;

    // Capture active divisions before movement tick
    const activeBefore = new Set<string>();
    for (const [id, div] of this.state.divisions) {
      if (div.move_order.length > 0 || div.combat_state !== "idle") activeBefore.add(id);
    }

    this.movementSystem.tick(this.state);
    const combatChanged = this.combatSystem.tick(this.state, (type, msg) => this.broadcast(type, msg));

    // Broadcast all divisions that were active or changed state this tick
    const toUpdate = new Set([...activeBefore, ...combatChanged]);
    const updates = [];
    for (const id of toUpdate) {
      const div = this.state.divisions.get(id);
      if (div) updates.push(this.serializeDivision(div));
    }
    if (updates.length > 0) {
      this.broadcast("DIVISION_UPDATES", { divisions: updates });
    }
  }

  private resolveWinner(): string {
    return "";
  }

  private endGame(winnerId: string) {
    this.state.phase = "ended";
    this.broadcast("GAME_ENDED", { winner_id: winnerId, reason: "host_ended" });
    this.notifyGameEnd(winnerId).catch(err =>
      console.error("[GameRoom] Failed to notify game end:", err)
    );
    console.log(`[GameRoom] ${this.roomId} game ended`);
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

  private checkAutoStart() {
    if (this.state.phase !== "lobby") return;
    const slots = [...this.state.nations.values()];
    const filled = slots.filter(n => n.player_id !== "");
    const allReady = filled.length >= MIN_PLAYERS_TO_START &&
      filled.every(n => n.is_ready) &&
      filled.length === this.nationIds.length;
    if (allReady) this.startGame();
  }

  private serializeDivision(div: DivisionState): object {
    return {
      division_id: div.division_id,
      nation_id: div.nation_id,
      division_type: div.division_type,
      position_lng: div.position_lng,
      position_lat: div.position_lat,
      hp: div.hp,
      suppression: div.suppression,
      combat_state: div.combat_state,
      supply_status: div.supply_status,
      observation_radius: div.observation_radius,
      engagement_radius: div.engagement_radius,
      move_order: [...div.move_order],
      stack_id: div.stack_id,
      stack_position: div.stack_position,
      attacker_role: div.attacker_role,
      engaged_with: [...div.engaged_with],
    };
  }

  private serializeDivisions(): object[] {
    const result = [];
    for (const div of this.state.divisions.values()) {
      result.push(this.serializeDivision(div));
    }
    return result;
  }

  private broadcastLobbyState(): void {
    const nations: Record<string, { player_id: string; is_ready: boolean }> = {};
    for (const [id, nation] of Array.from(this.state.nations.entries())) {
      nations[id] = { player_id: nation.player_id, is_ready: nation.is_ready };
    }

    const players: Record<string, { user_id: string }> = {};
    for (const [sessionId, player] of Array.from(this.state.players.entries())) {
      players[sessionId] = { user_id: player.userId };
    }

    this.broadcast("LOBBY_STATE_UPDATE", {
      phase: this.state.phase,
      host_session_id: this.hostSessionId,
      nations,
      players,
      game_speed: this.state.game_speed,
    });
  }

  /** Populate state.provinces from map_data.json initial nation owners. */
  private _initProvinces(mapId: string): void {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const dataPath = join(__dir, "../..", "..", "client", "assets", "data", mapId, "map_data.json");
    try {
      const raw = JSON.parse(readFileSync(dataPath, "utf-8")) as {
        provinces: Array<{ province_id: string; nation_id: string }>;
      };
      for (const p of raw.provinces ?? []) {
        if (!p.province_id) continue;
        const slot = new ProvinceState();
        slot.province_id = p.province_id;
        slot.owner_id    = p.nation_id ?? "";
        this.state.provinces.set(p.province_id, slot);
      }
      console.log(`[GameRoom] initialized ${this.state.provinces.size} provinces`);
    } catch {
      console.warn(`[GameRoom] could not load map_data.json for province init`);
    }
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
