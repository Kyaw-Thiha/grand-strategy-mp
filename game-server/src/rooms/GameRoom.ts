import { Room, Client, CloseCode } from "colyseus";
import { jwtVerify } from "jose";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { GameRoomState, PlayerState, NationState, DivisionState, ProvinceState, RelationState } from "./schema/GameRoomState.js";
import { getMapNationIds } from "../data/map_loader.js";
import { MovementSystem } from "../systems/movement_system.js";
import { CombatSystem, _isGridLocked } from "../systems/combat_system.js";
import { SupplySystem } from "../systems/supply_system.js";
import type { RoundResolvedPayload } from "../types/tactical_types.js";
import { FrontlineSystem } from "../systems/frontline_system.js";
import { STARTING_POSITIONS } from "../data/maps/western_europe_6/starting_positions.js";
import { DEFAULT_TEMPLATE } from "../data/maps/western_europe_6/default_template.js";

interface JwtPayload {
  sub: string;
  email?: string;
  steam_id: string;
  has_host_pass: boolean;
}

type DiplomacyAction =
  | "invite"
  | "declare_war"
  | "make_peace"
  | "quit_alliance"
  | "kick";

type DiplomacyVoteStage =
  | "target_response"
  | "actor_alliance_vote"
  | "target_alliance_vote";

type DiplomacyVoteChoice = "yes" | "no";

interface DiplomacyVote {
  id: string;
  notificationId: string;
  action: Exclude<DiplomacyAction, "quit_alliance">;
  actorNationId: string;
  targetNationId: string;
  actorAllianceAtStart: string[];
  targetAllianceAtStart: string[];
  involvedNationIds: Set<string>;
  stage: DiplomacyVoteStage;
  deadlineAt: number;
  durationMs: number;
  eligibleVoterIds: string[];
  votes: Map<string, DiplomacyVoteChoice>;
  timeout?: { clear: () => void };
}

const API_SERVER_URL = process.env.API_SERVER_URL ?? "http://localhost:3000";
const MIN_PLAYERS_TO_START = 1;
const TICK_MS = 1000;
const DIPLOMACY_TARGET_RESPONSE_MS = 10_000;
const DIPLOMACY_ALLIANCE_VOTE_MS = 15_000;

export class GameRoom extends Room<{ state: GameRoomState }> {
  maxClients = 6;

  private hostSessionId: string = "";
  private gameStartedAt: Date | null = null;
  private nationIds: string[] = [];
  private tickCount = 0;
  private movementSystem   = new MovementSystem();
  private combatSystem     = new CombatSystem(this.movementSystem);
  private supplySystem     = new SupplySystem();
  private frontlineSystem  = new FrontlineSystem();
  private playerEmails = new Map<string, string>();
  private diplomacyVotes = new Map<string, DiplomacyVote>();
  private activeDiplomacyVoteByNation = new Map<string, string>();
  private nextDiplomacyVoteNumber = 1;

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
    this.onMessage("REPOSITION",       (client, msg) => this.handleReposition(client, msg));
    this.onMessage("REORDER_STACK",    (client, msg) => this.handleReorderStack(client, msg));
    this.onMessage("SEND_CHAT",        (client, msg) => this.handleSendChat(client, msg));
    this.onMessage("DIPLOMACY_ACTION", (client, msg) => this.handleDiplomacyAction(client, msg));
    this.onMessage("DIPLOMACY_VOTE_RESPONSE", (client, msg) => this.handleDiplomacyVoteResponse(client, msg));
    this.onMessage("ASSIGN_TEMPLATE", (_client, msg: {
      division_id: string;
      template_id: string;
      cells: Array<{ cell_index: number; unit_type: string }>;
    }) => {
      const div = this.state.divisions.get(msg.division_id);
      if (!div) return;
      if (["engaged", "retreating", "suppressed"].includes(div.combat_state)) return;

      div.template_id = msg.template_id;

      if (div.grid) {
        for (const cell of div.grid.cells) {
          cell.unit_type = "";
        }
        for (const { cell_index, unit_type } of msg.cells) {
          if (cell_index >= 0 && cell_index < div.grid.cells.length && unit_type !== "") {
            div.grid.cells[cell_index].unit_type = unit_type;
          }
        }
      }

      const templateCells = msg.cells
        .filter(c => c.unit_type !== "")
        .map(c => ({
          unit_type: c.unit_type,
          row: Math.floor(c.cell_index / 5),
          col: c.cell_index % 5,
        }));

      div.division_type = this.movementSystem.classifyDivisionType(templateCells);
      div.engagement_radius = this.movementSystem.computeEngagementRadius(templateCells);
      div.movement_profile_json = JSON.stringify(
        this.movementSystem.computeMovementProfile(templateCells)
      );
      this.broadcast("DIVISION_UPDATES", { divisions: [this.serializeDivision(div)] });
    });
    if (process.env.DEV_MODE === "true") {
      this.onMessage("DEV_TELEPORT",   (_client, msg) => this.handleDevTeleport(msg));
      this.onMessage("DEV_SET_SUPPLY", (_client, msg) => this.handleDevSetSupply(msg));
    }
    if (process.env.NODE_ENV === "test") {
      this.onMessage("SPAWN_DIVISION", (_client, msg: {
        division_id: string;
        nation_id: string;
        position_lng: number;
        position_lat: number;
      }) => {
        const div = new DivisionState();
        div.division_id  = msg.division_id;
        div.nation_id    = msg.nation_id;
        div.position_lng = msg.position_lng;
        div.position_lat = msg.position_lat;
        this.state.divisions.set(msg.division_id, div);
      });
      this.onMessage("SET_CELL", (_client, msg: {
        division_id: string;
        cell_index: number;
        unit_type?: string;
        hp?: number;
        suppression?: number;
        xp_tier?: string;
        incapacitated?: boolean;
        stealthed?: boolean;
      }) => {
        if (_isGridLocked(msg.division_id, this.state)) {
          console.warn(`[test] SET_CELL rejected — division ${msg.division_id} is grid-locked`);
          return;
        }
        const div = this.state.divisions.get(msg.division_id);
        if (!div?.grid) return;
        const cell = div.grid.cells[msg.cell_index];
        if (!cell) return;
        if (msg.unit_type     !== undefined) cell.unit_type     = msg.unit_type;
        if (msg.hp            !== undefined) cell.hp            = msg.hp;
        if (msg.suppression   !== undefined) cell.suppression   = msg.suppression;
        if (msg.xp_tier       !== undefined) cell.xp_tier       = msg.xp_tier;
        if (msg.incapacitated !== undefined) cell.incapacitated = msg.incapacitated;
        if (msg.stealthed     !== undefined) cell.stealthed     = msg.stealthed;
      });
      this.onMessage("SPAWN_NATION", (_client, msg: { nation_id: string }) => {
        const nation = new NationState();
        nation.nation_id = msg.nation_id;
        this.state.nations.set(msg.nation_id, nation);
      });
      this.onMessage("APPLY_PERKS", (_client, msg: {
        nation_id: string;
        perk_ids: string[];
      }) => {
        const nation = this.state.nations.get(msg.nation_id);
        if (!nation) return;
        nation.researched_perks.clear();
        for (const id of msg.perk_ids) nation.researched_perks.push(id);
      });
    }

    console.log(`[GameRoom] ${this.roomId} created`);
  }

  onJoin(client: Client, _options: unknown, auth: JwtPayload) {
    const player = new PlayerState();
    player.userId = auth.sub;
    player.steamId = auth.steam_id;
    player.hasHostPass = auth.has_host_pass;
    this.state.players.set(client.sessionId, player);
    this.playerEmails.set(client.sessionId, auth.email ?? "");

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
    this.playerEmails.delete(client.sessionId);

    if (userId) {
      for (const nation of this.state.nations.values()) {
        if (nation.player_id === userId) {
          nation.player_id = "";
          nation.is_ready = false;
          break;
      }
    }
    this.broadcastRelations();
  }

    if (this.hostSessionId === client.sessionId && this.state.players.size > 0) {
      this.hostSessionId = this.state.players.keys().next().value ?? "";
      console.log(`[GameRoom] host transferred to ${this.hostSessionId}`);
    }

    console.log(`[GameRoom] ${client.sessionId} left (${this.state.players.size} remaining)`);
    this.broadcastLobbyState();
  }

  onDispose() {
    for (const vote of this.diplomacyVotes.values()) {
      vote.timeout?.clear();
    }
    this.diplomacyVotes.clear();
    this.activeDiplomacyVoteByNation.clear();
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

  private handleSendChat(client: Client, msg: { message?: string }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const message = (msg.message ?? "").trim().slice(0, 500);
    if (message === "") return;

    const now = new Date();
    const time =
      `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    this.broadcast("CHAT_MESSAGE", {
      time,
      user_id: player.userId,
      email: this.playerEmails.get(client.sessionId) || player.userId || "unknown@example.com",
      message,
    });
  }

  private handleDiplomacyAction(client: Client, msg: { action?: string; target_nation_id?: string }) {
    if (this.state.phase !== "running") return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const actorNation = this.getNationForPlayer(player.userId);
    if (!actorNation) {
      client.send("ERROR", { message: "Select a nation before using diplomacy" });
      return;
    }

    const action = msg.action as DiplomacyAction;
    if (!this.isDiplomacyAction(action)) {
      client.send("ERROR", { message: "Unknown diplomacy action" });
      return;
    }

    const actorNationId = actorNation.nation_id;
    const targetNationId = msg.target_nation_id ?? "";
    const actorAllianceBefore = this.getAllianceFor(actorNationId);

    if (action === "quit_alliance") {
      for (const nationId of this.nationIds) {
        if (nationId !== actorNationId) {
          this.setRelationStance(actorNationId, nationId, "neutral");
        }
      }
      this.finishDiplomacyRelationChange(
        new Set(actorAllianceBefore),
        `${actorNationId} quit their alliance.`,
      );
      return;
    }

    if (!this.validateTargetNation(client, targetNationId, actorNationId)) return;
    const targetAllianceBefore = this.getAllianceFor(targetNationId);
    const involvedNationIds = new Set<string>([...actorAllianceBefore, ...targetAllianceBefore, targetNationId]);

    if (this.hasActiveDiplomacyOverlap(involvedNationIds)) {
      client.send("ERROR", { message: "Another diplomacy vote is already active for these nations" });
      return;
    }

    if (action === "invite" && actorAllianceBefore.has(targetNationId)) {
      client.send("ERROR", { message: "Nation is already in your alliance" });
      return;
    }
    if (action === "declare_war" && actorAllianceBefore.has(targetNationId)) {
      client.send("ERROR", { message: "Cannot declare war on an ally" });
      return;
    }
    if (action === "make_peace" && actorAllianceBefore.has(targetNationId)) {
      client.send("ERROR", { message: "Nation is already in your alliance" });
      return;
    }
    if (action === "kick" && !actorAllianceBefore.has(targetNationId)) {
      client.send("ERROR", { message: "Nation is not in your alliance" });
      return;
    }

    client.send("DIPLOMACY_NOTIFICATION", {
      message: this.getDiplomacyActionStartedMessage(action, actorNationId, targetNationId),
      notification_type: "diplomacy",
    });
    this.createDiplomacyVote(action, actorNationId, targetNationId, actorAllianceBefore, targetAllianceBefore, involvedNationIds);
  }

  private handleDiplomacyVoteResponse(client: Client, msg: { vote_id?: string; accept?: boolean }) {
    if (this.state.phase !== "running") return;

    const voteId = msg.vote_id ?? "";
    const vote = this.diplomacyVotes.get(voteId);
    if (!vote) {
      client.send("ERROR", { message: "Diplomacy vote is no longer active" });
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const nation = this.getNationForPlayer(player.userId);
    if (!nation) return;

    if (!vote.eligibleVoterIds.includes(nation.nation_id)) {
      client.send("ERROR", { message: "You cannot vote on this proposal" });
      return;
    }

    vote.votes.set(nation.nation_id, msg.accept === true ? "yes" : "no");
    this.sendDiplomacyVoteUpdate(vote, false);

    if (vote.votes.size >= vote.eligibleVoterIds.length) {
      this.resolveDiplomacyVoteStage(vote, false);
    }
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

  private handleSubmitMoveOrder(client: Client, msg: { division_id?: string; waypoints?: string[]; final_lng?: number; final_lat?: number }) {
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

    // Trim path at first neutral-territory waypoint
    const allowedWaypoints = this.movementSystem.trimToAllowedTerritory(
      waypoints, division.nation_id, this.state.relations,
    );
    if (allowedWaypoints.length === 0) {
      client.send("MOVE_ORDER_REJECTED", { division_id: divisionId, reason: "neutral_territory" });
      return;
    }

    // Replace existing move order with the allowed prefix (may be shorter than requested)
    division.move_order.splice(0, division.move_order.length);
    for (const wpId of allowedWaypoints) {
      division.move_order.push(wpId);
    }

    // Store exact click target for last-mile advancement (-999 = none)
    division.final_position_lng = (typeof msg.final_lng === "number") ? msg.final_lng : -999;
    division.final_position_lat = (typeof msg.final_lat === "number") ? msg.final_lat : -999;
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
    this.broadcast("DIVISION_UPDATES", { divisions: [this.serializeDivision(division)] });
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
    const changed = new Set<string>();
    this.combatSystem.initiateRetreat(division, enemies, this.state, changed, (type, msg) => this.broadcast(type, msg));

    // Broadcast updates for both the retreating division and any reset opponents
    const serializedDivs: unknown[] = [this.serializeDivision(division)];
    for (const divId of changed) {
      if (divId !== division.division_id) {
        const opponent = this.state.divisions.get(divId);
        if (opponent) serializedDivs.push(this.serializeDivision(opponent));
      }
    }
    this.broadcast("DIVISION_UPDATES", { divisions: serializedDivs });
  }

  private handleReposition(client: Client, msg: { division_id?: string; waypoints?: string[] }) {
    if (this.state.phase !== "running") return;
    const divisionId = msg.division_id ?? "";
    const waypoints  = msg.waypoints ?? [];
    const division = this.state.divisions.get(divisionId);
    if (!division) { client.send("ERROR", { message: `Unknown division: ${divisionId}` }); return; }

    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const nation = this.getNationForPlayer(player.userId);
    if (!nation || nation.nation_id !== division.nation_id) {
      client.send("ERROR", { message: "Not your division" }); return;
    }

    if (division.combat_state !== "engaged" && division.combat_state !== "suppressed") {
      client.send("MOVE_ORDER_REJECTED", { division_id: divisionId, reason: "not_in_combat" }); return;
    }

    if (!this.movementSystem.validateMoveOrder(waypoints)) {
      client.send("MOVE_ORDER_REJECTED", { division_id: divisionId, reason: "invalid_waypoints" }); return;
    }

    // Check engagement boundary: reject repos if already past the edge of any engaged enemy
    for (const enemyId of division.engaged_with) {
      const enemy = this.state.divisions.get(enemyId);
      if (!enemy) continue;
      const dx = division.position_lng - enemy.position_lng;
      const dy = division.position_lat - enemy.position_lat;
      const dist = Math.sqrt(dx * dx + dy * dy) * 111;
      if (dist > division.engagement_radius + enemy.engagement_radius) {
        client.send("MOVE_ORDER_REJECTED", { division_id: divisionId, reason: "at_engagement_edge" }); return;
      }
    }

    division.reposition_order.splice(0, division.reposition_order.length);
    for (const wpId of waypoints) division.reposition_order.push(wpId);

    this.broadcast("DIVISION_UPDATES", { divisions: [this.serializeDivision(division)] });
  }

  private handleReorderStack(client: Client, msg: { stack_id?: string; new_order?: string[] }) {
    if (this.state.phase !== "running") return;
    const stackId  = msg.stack_id  ?? "";
    const newOrder = msg.new_order ?? [];
    if (!stackId || newOrder.length === 0) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const nation = this.getNationForPlayer(player.userId);
    if (!nation) return;

    // Verify all divisions in the order belong to this player's nation
    for (const divId of newOrder) {
      const div = this.state.divisions.get(divId);
      if (!div || div.nation_id !== nation.nation_id) {
        client.send("ERROR", { message: "Stack contains divisions from another nation" });
        return;
      }
    }

    const ok = this.combatSystem.reorderStack(stackId, newOrder, this.state, (type, msg) => this.broadcast(type, msg));
    if (!ok) client.send("ERROR", { message: "Cannot reorder stack (invalid or engaged)" });
  }

  /** DEV_MODE only — instantly teleport any division to given coordinates. */
  private handleDevTeleport(msg: { division_id?: string; lng?: number; lat?: number }) {
    const div = this.state.divisions.get(msg.division_id ?? "");
    if (!div) return;
    if (msg.lng !== undefined) div.position_lng = msg.lng;
    if (msg.lat !== undefined) div.position_lat = msg.lat;
    div.move_order.splice(0, div.move_order.length);
    this.broadcast("DIVISION_UPDATES", { divisions: [this.serializeDivision(div)] });
  }

  /** DEV_MODE only — force a division's supply_status for testing. */
  private handleDevSetSupply(msg: { division_id?: string; supply_status?: string }) {
    const div = this.state.divisions.get(msg.division_id ?? "");
    if (!div) return;
    const valid = ["normal", "out_of_supply", "cut_off", "encircled"];
    if (!valid.includes(msg.supply_status ?? "")) return;
    div.supply_status = msg.supply_status!;
    this.broadcast("DIVISION_UPDATES", { divisions: [this.serializeDivision(div)] });
  }

  // ── Game lifecycle ──────────────────────────────────────────────────────────

  private startGame() {
    this.state.phase = "running";
    this.gameStartedAt = new Date();

    // Load waypoints for movement and map data for combat + supply
    this.movementSystem.loadWaypoints(this.state.map_id);
    this.movementSystem.loadMapData(this.state.map_id);
    this.combatSystem.loadMapData(this.state.map_id);
    this.supplySystem.loadMapData(this.state.map_id);
    this.frontlineSystem.loadMapData(this.state.map_id);
    this._initProvinces(this.state.map_id);
    this._initRelations();
    this.broadcastRelations();

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

    // Send full initial division state — profile sent once at top level (shared by all divisions)
    const sharedProfileJson = this.state.divisions.values().next().value?.movement_profile_json ?? "";
    this.broadcast("DIVISIONS_SPAWNED", {
      shared_profile_json: sharedProfileJson,
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
      div.template_id = "preset_combined_arms";
      if (div.grid) {
        for (let i = 0; i < div.grid.cells.length; i++) div.grid.cells[i].unit_type = "";
        const defaultCells = [
          { row: 0, col: 0, unit_type: "recon_infantry" },
          { row: 0, col: 2, unit_type: "recon_infantry" },
          { row: 1, col: 0, unit_type: "medium_tank" },
          { row: 1, col: 1, unit_type: "medium_tank" },
          { row: 1, col: 2, unit_type: "infantry" },
          { row: 2, col: 0, unit_type: "artillery" },
          { row: 2, col: 1, unit_type: "at_gun" },
          { row: 3, col: 0, unit_type: "infantry" },
        ];
        for (const c of defaultCells) {
          const idx = c.row * 5 + c.col;
          div.grid.cells[idx].unit_type = c.unit_type;
        }
      }
      this.state.divisions.set(spawn.division_id, div);
    }
  }

  private gameTick() {
    if (this.state.phase !== "running") return;
    this.tickCount++;

    const activeBefore = new Set<string>();
    for (const [id, div] of this.state.divisions) {
      if (div.move_order.length > 0 || div.combat_state !== "idle") activeBefore.add(id);
    }

    try {
      this.movementSystem.tick(this.state);
      const combatChanged = this.combatSystem.tick(this.state, this.tickCount, (type, msg) => this.broadcast(type, msg));
      const supplyChanged = this.supplySystem.tick(this.state, this.tickCount, (type, msg) => this.broadcast(type, msg));
      this.frontlineSystem.tick(this.state, this.tickCount, (type, msg) => this.broadcast(type, msg));

      const toUpdate = new Set([...activeBefore, ...combatChanged, ...supplyChanged]);
      const updates = [];
      for (const id of toUpdate) {
        const div = this.state.divisions.get(id);
        if (div) updates.push(this.serializeDivision(div));
      }
      if (updates.length > 0) {
        this.broadcast("DIVISION_UPDATES", { divisions: updates });
      }
    } catch (err) {
      console.error(`[GameRoom] gameTick ${this.tickCount} THREW:`, err);
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

  private isDiplomacyAction(action: string): action is DiplomacyAction {
    return [
      "invite",
      "declare_war",
      "make_peace",
      "quit_alliance",
      "kick",
    ].includes(action);
  }

  private createDiplomacyVote(
    action: Exclude<DiplomacyAction, "quit_alliance">,
    actorNationId: string,
    targetNationId: string,
    actorAllianceBefore: Set<string>,
    targetAllianceBefore: Set<string>,
    involvedNationIds: Set<string>,
  ): void {
    const voteId = `diplo_vote_${this.nextDiplomacyVoteNumber++}`;
    const vote: DiplomacyVote = {
      id: voteId,
      notificationId: `${voteId}_notice`,
      action,
      actorNationId,
      targetNationId,
      actorAllianceAtStart: Array.from(actorAllianceBefore),
      targetAllianceAtStart: Array.from(targetAllianceBefore),
      involvedNationIds,
      stage: action === "invite" ? "target_response" : "actor_alliance_vote",
      deadlineAt: 0,
      durationMs: 0,
      eligibleVoterIds: [],
      votes: new Map<string, DiplomacyVoteChoice>(),
    };

    this.diplomacyVotes.set(vote.id, vote);
    for (const nationId of involvedNationIds) {
      this.activeDiplomacyVoteByNation.set(nationId, vote.id);
    }

    if (vote.stage === "target_response") {
      this.startDiplomacyVoteStage(vote, [targetNationId], DIPLOMACY_TARGET_RESPONSE_MS, false);
    } else {
      this.startActorAllianceVote(vote);
    }
  }

  private startActorAllianceVote(vote: DiplomacyVote): void {
    const excluded = vote.action === "kick"
      ? new Set<string>([vote.actorNationId, vote.targetNationId])
      : new Set<string>();
    const eligibleVoters = this.getPlayerControlledNationIds(vote.actorAllianceAtStart)
      .filter(nationId => !excluded.has(nationId));
    const defaultYes = vote.action === "kick" ? false : true;
    this.startDiplomacyVoteStage(vote, eligibleVoters, DIPLOMACY_ALLIANCE_VOTE_MS, defaultYes);
  }

  private startTargetAllianceVote(vote: DiplomacyVote): void {
    const eligibleVoters = this.getPlayerControlledNationIds(vote.targetAllianceAtStart);
    this.startDiplomacyVoteStage(vote, eligibleVoters, DIPLOMACY_ALLIANCE_VOTE_MS, false);
  }

  private startDiplomacyVoteStage(
    vote: DiplomacyVote,
    eligibleVoterIds: string[],
    durationMs: number,
    actorDefaultsYes: boolean,
  ): void {
    vote.timeout?.clear();
    vote.durationMs = durationMs;
    vote.deadlineAt = Date.now() + durationMs;
    vote.eligibleVoterIds = eligibleVoterIds;
    vote.votes.clear();

    if (actorDefaultsYes && eligibleVoterIds.includes(vote.actorNationId)) {
      vote.votes.set(vote.actorNationId, "yes");
    }

    if (eligibleVoterIds.length === 0) {
      this.resolveDiplomacyVoteStage(vote, false);
      return;
    }

    if (vote.votes.size >= eligibleVoterIds.length) {
      this.resolveDiplomacyVoteStage(vote, false);
      return;
    }

    this.sendDiplomacyVoteUpdate(vote, true);
    vote.timeout = this.clock.setTimeout(() => this.resolveDiplomacyVoteStage(vote, true), durationMs);
  }

  private resolveDiplomacyVoteStage(vote: DiplomacyVote, timedOut: boolean): void {
    vote.timeout?.clear();
    vote.timeout = undefined;
    this.sendDiplomacyVoteUpdate(vote, false);

    const passed = this.didDiplomacyVoteStagePass(vote);
    if (vote.stage === "target_response") {
      if (!passed) {
        this.finishDiplomacyVote(vote, false, `${vote.targetNationId} rejected the alliance invitation from ${vote.actorNationId}.`);
        return;
      }
      this.sendDiplomacyVoteResolved(vote, true);
      vote.stage = "actor_alliance_vote";
      this.startActorAllianceVote(vote);
      return;
    }

    if (vote.stage === "actor_alliance_vote") {
      if (!passed) {
        this.finishDiplomacyVote(vote, false, this.getDiplomacyFailureMessage(vote, timedOut));
        return;
      }
      if (vote.action === "make_peace") {
        this.sendDiplomacyVoteResolved(vote, true);
        vote.stage = "target_alliance_vote";
        this.startTargetAllianceVote(vote);
        return;
      }
      this.applyPassedDiplomacyVote(vote);
      return;
    }

    if (!passed) {
      this.finishDiplomacyVote(vote, false, this.getDiplomacyFailureMessage(vote, timedOut));
      return;
    }
    this.applyPassedDiplomacyVote(vote);
  }

  private didDiplomacyVoteStagePass(vote: DiplomacyVote): boolean {
    if (vote.eligibleVoterIds.length === 0) return true;
    let yesVotes = 0;
    for (const choice of vote.votes.values()) {
      if (choice === "yes") yesVotes++;
    }
    return yesVotes > vote.eligibleVoterIds.length / 2;
  }

  private applyPassedDiplomacyVote(vote: DiplomacyVote): void {
    if (vote.action === "invite") {
      this.applyInvite(vote.actorNationId, vote.targetNationId, new Set(vote.actorAllianceAtStart));
      this.finishDiplomacyRelationChange(
        new Set([...vote.actorAllianceAtStart, ...vote.targetAllianceAtStart, vote.targetNationId]),
        `${vote.actorNationId} invited ${vote.targetNationId} into their alliance.`,
      );
    } else if (vote.action === "kick") {
      this.applyKick(vote.targetNationId);
      this.finishDiplomacyRelationChange(
        new Set([...vote.actorAllianceAtStart, vote.targetNationId]),
        `${vote.actorNationId} kicked ${vote.targetNationId} from their alliance.`,
      );
    } else if (vote.action === "declare_war") {
      this.setGroupRelation(new Set(vote.actorAllianceAtStart), new Set(vote.targetAllianceAtStart), "war");
      this.finishDiplomacyRelationChange(
        new Set([...vote.actorAllianceAtStart, ...vote.targetAllianceAtStart]),
        `${vote.actorNationId} declared war on ${vote.targetNationId}.`,
      );
    } else if (vote.action === "make_peace") {
      this.setGroupRelation(new Set(vote.actorAllianceAtStart), new Set(vote.targetAllianceAtStart), "neutral");
      this.finishDiplomacyRelationChange(
        new Set([...vote.actorAllianceAtStart, ...vote.targetAllianceAtStart]),
        `${vote.actorNationId} made peace with ${vote.targetNationId}.`,
      );
    }
    this.finishDiplomacyVote(vote, true, "");
  }

  private applyInvite(actorNationId: string, targetNationId: string, actorAlliance: Set<string>): void {
    const inheritedStances = new Map<string, string>();
    for (const nationId of this.nationIds) {
      if (nationId === targetNationId || actorAlliance.has(nationId)) continue;
      inheritedStances.set(nationId, this.getRelationStance(actorNationId, nationId));
    }

    for (const nationId of this.nationIds) {
      if (nationId !== targetNationId) {
        this.setRelationStance(targetNationId, nationId, "neutral");
      }
    }
    for (const allyId of actorAlliance) {
      this.setRelationStance(targetNationId, allyId, "alliance");
    }
    for (const [nationId, stance] of inheritedStances) {
      this.setRelationStance(targetNationId, nationId, stance);
    }
  }

  private applyKick(targetNationId: string): void {
    for (const nationId of this.nationIds) {
      if (nationId !== targetNationId) {
        this.setRelationStance(targetNationId, nationId, "neutral");
      }
    }
  }

  private finishDiplomacyRelationChange(affectedNations: Set<string>, message: string): void {
    this.broadcastRelations();
    const changed = new Set<string>();
    this.combatSystem.clearInvalidDiplomaticEngagements(
      this.state,
      changed,
      (type, payload) => this.broadcast(type, payload),
    );
    if (changed.size > 0) {
      const updates = Array.from(changed)
        .map(id => this.state.divisions.get(id))
        .filter((division): division is DivisionState => division !== undefined)
        .map(division => this.serializeDivision(division));
      this.broadcast("DIVISION_UPDATES", { divisions: updates });
    }
    this.notifyAffectedDiplomacyPlayers(affectedNations, message);
  }

  private finishDiplomacyVote(vote: DiplomacyVote, passed: boolean, failureMessage: string): void {
    vote.timeout?.clear();
    this.sendDiplomacyVoteResolved(vote, passed);
    this.diplomacyVotes.delete(vote.id);
    for (const nationId of vote.involvedNationIds) {
      if (this.activeDiplomacyVoteByNation.get(nationId) === vote.id) {
        this.activeDiplomacyVoteByNation.delete(nationId);
      }
    }
    if (!passed && failureMessage !== "") {
      this.notifyAffectedDiplomacyPlayers(this.getFailureNotificationAudience(vote), failureMessage);
    }
  }

  private getDiplomacyFailureMessage(vote: DiplomacyVote, timedOut: boolean): string {
    const suffix = timedOut ? " after the vote timed out" : "";
    if (vote.action === "invite") {
      return `${vote.actorNationId}'s alliance rejected inviting ${vote.targetNationId}${suffix}.`;
    }
    if (vote.action === "kick") {
      return `${vote.actorNationId}'s alliance rejected kicking ${vote.targetNationId}${suffix}.`;
    }
    if (vote.action === "declare_war") {
      return `${vote.actorNationId}'s alliance rejected declaring war on ${vote.targetNationId}${suffix}.`;
    }
    return `${vote.actorNationId}'s peace proposal with ${vote.targetNationId} was rejected${suffix}.`;
  }

  private getFailureNotificationAudience(vote: DiplomacyVote): Set<string> {
    if (vote.action === "declare_war") {
      return new Set(vote.actorAllianceAtStart);
    }
    if (vote.action === "make_peace" && vote.stage === "target_alliance_vote") {
      return new Set([...vote.actorAllianceAtStart, ...vote.targetAllianceAtStart]);
    }
    return new Set([...vote.actorAllianceAtStart, vote.targetNationId]);
  }

  private hasActiveDiplomacyOverlap(nationIds: Set<string>): boolean {
    for (const nationId of nationIds) {
      if (this.activeDiplomacyVoteByNation.has(nationId)) return true;
    }
    return false;
  }

  private getPlayerControlledNationIds(nationIds: string[]): string[] {
    return nationIds.filter(nationId => {
      const nation = this.state.nations.get(nationId);
      return nation !== undefined && nation.player_id !== "";
    });
  }

  private sendDiplomacyVoteUpdate(vote: DiplomacyVote, isStart: boolean): void {
    const type = isStart ? "DIPLOMACY_INTERACTIVE_NOTIFICATION" : "DIPLOMACY_VOTE_UPDATED";
    const voters = vote.eligibleVoterIds.map(nationId => ({
      nation_id: nationId,
      status: vote.votes.get(nationId) ?? "pending",
    }));

    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (!player) continue;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation || !vote.eligibleVoterIds.includes(nation.nation_id)) continue;
      client.send(type, {
        notification_id: vote.notificationId,
        vote_id: vote.id,
        notification_type: "diplomacy",
        message: this.getDiplomacyStageMessage(vote),
        stage: vote.stage,
        requires_response: !vote.votes.has(nation.nation_id),
        deadline_at: vote.deadlineAt,
        duration_ms: vote.durationMs,
        yes_label: "Yes",
        no_label: "No",
        voters,
      });
    }
  }

  private sendDiplomacyVoteResolved(vote: DiplomacyVote, passed: boolean): void {
    const payload = {
      notification_id: vote.notificationId,
      vote_id: vote.id,
      resolved: true,
      passed,
      requires_response: false,
      voters: vote.eligibleVoterIds.map(nationId => ({
        nation_id: nationId,
        status: vote.votes.get(nationId) ?? "pending",
      })),
    };
    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (!player) continue;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation || !vote.eligibleVoterIds.includes(nation.nation_id)) continue;
      client.send("DIPLOMACY_VOTE_UPDATED", payload);
    }
  }

  private getDiplomacyStageMessage(vote: DiplomacyVote): string {
    if (vote.stage === "target_response") {
      return `${vote.actorNationId} invited you to join their alliance.`;
    }
    if (vote.action === "invite") {
      return `Vote to invite ${vote.targetNationId} into your alliance.`;
    }
    if (vote.action === "kick") {
      return `Vote to kick ${vote.targetNationId} from your alliance.`;
    }
    if (vote.action === "declare_war") {
      return `Vote to declare war on ${vote.targetNationId}.`;
    }
    if (vote.stage === "target_alliance_vote") {
      return `${vote.actorNationId} proposed peace with your alliance.`;
    }
    return `Vote to propose peace with ${vote.targetNationId}.`;
  }

  private getDiplomacyActionStartedMessage(
    action: Exclude<DiplomacyAction, "quit_alliance">,
    actorNationId: string,
    targetNationId: string,
  ): string {
    if (action === "invite") {
      return `${actorNationId} sent an alliance invitation to ${targetNationId}.`;
    }
    if (action === "kick") {
      return `${actorNationId} started a vote to kick ${targetNationId} from the alliance.`;
    }
    if (action === "declare_war") {
      return `${actorNationId} started a vote to declare war on ${targetNationId}.`;
    }
    return `${actorNationId} started a vote to make peace with ${targetNationId}.`;
  }

  private validateTargetNation(client: Client, targetNationId: string, actorNationId: string): boolean {
    if (targetNationId === "" || !this.state.nations.has(targetNationId)) {
      client.send("ERROR", { message: "Unknown diplomacy target" });
      return false;
    }
    if (targetNationId === actorNationId) {
      client.send("ERROR", { message: "Cannot target your own nation" });
      return false;
    }
    return true;
  }

  private getAllianceFor(nationId: string): Set<string> {
    const alliance = new Set<string>([nationId]);
    const queue = [nationId];

    while (queue.length > 0) {
      const current = queue.shift() ?? "";
      for (const rel of this.state.relations.values()) {
        if (rel.stance !== "alliance") continue;
        const neighbor = rel.from_id === current ? rel.to_id : rel.to_id === current ? rel.from_id : "";
        if (neighbor !== "" && !alliance.has(neighbor)) {
          alliance.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    return alliance;
  }

  private setGroupRelation(groupA: Set<string>, groupB: Set<string>, stance: "war" | "neutral" | "alliance"): void {
    for (const nationA of groupA) {
      for (const nationB of groupB) {
        this.setRelationStance(nationA, nationB, stance);
      }
    }
  }

  private getRelationStance(nationA: string, nationB: string): string {
    if (nationA === nationB) return "alliance";
    const rel = this.state.relations.get(`${nationA}|${nationB}`)
      ?? this.state.relations.get(`${nationB}|${nationA}`);
    return rel?.stance ?? "neutral";
  }

  private setRelationStance(nationA: string, nationB: string, stance: "war" | "neutral" | "alliance" | string): void {
    if (nationA === nationB) return;
    const key = this.getRelationKey(nationA, nationB);
    let rel = this.state.relations.get(key);
    if (!rel) {
      rel = new RelationState();
      const [fromId, toId] = key.split("|");
      rel.from_id = fromId;
      rel.to_id = toId;
      this.state.relations.set(key, rel);
    }
    rel.stance = stance;
  }

  private getRelationKey(nationA: string, nationB: string): string {
    const directKey = `${nationA}|${nationB}`;
    const reverseKey = `${nationB}|${nationA}`;
    if (this.state.relations.has(directKey)) return directKey;
    if (this.state.relations.has(reverseKey)) return reverseKey;

    const indexA = this.nationIds.indexOf(nationA);
    const indexB = this.nationIds.indexOf(nationB);
    if (indexA >= 0 && indexB >= 0) {
      return indexA < indexB ? directKey : reverseKey;
    }
    return nationA < nationB ? directKey : reverseKey;
  }

  private broadcastRelations(): void {
    const relationsPayload: Record<string, string> = {};
    for (const [, rel] of this.state.relations) {
      relationsPayload[`${rel.from_id}:${rel.to_id}`] = rel.stance;
      relationsPayload[`${rel.to_id}:${rel.from_id}`] = rel.stance;
    }
    this.broadcast("RELATIONS_UPDATED", { relations: relationsPayload });
  }

  private notifyAffectedDiplomacyPlayers(affectedNationIds: Set<string>, message: string): void {
    if (message === "") return;
    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (!player) continue;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation || !affectedNationIds.has(nation.nation_id)) continue;
      client.send("DIPLOMACY_NOTIFICATION", {
        message,
        notification_type: "diplomacy",
      });
    }
  }

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
      template_id: div.template_id,
      move_order: [...div.move_order],
      consumed_waypoint_ids: [...div.consumed_waypoint_ids],
      final_position_lng: div.final_position_lng,
      final_position_lat: div.final_position_lat,
      reposition_order: [...div.reposition_order],
      stack_id: div.stack_id,
      stack_position: div.stack_position,
      attacker_role: div.attacker_role,
      engaged_with: [...div.engaged_with],
      grid: {
        cells: Array.from(div.grid.cells).map(c => ({
          unit_type: c.unit_type,
          hp: c.hp,
          suppression: c.suppression,
          xp_tier: c.xp_tier,
          incapacitated: c.incapacitated,
          stealthed: c.stealthed,
        })),
      },
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
      map_id: this.state.map_id,
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

  /** Populate state.relations: all playable nations start neutral with each other. */
  private _initRelations(): void {
    this.state.relations.clear();
    const playerNations = this.nationIds.length > 0
      ? this.nationIds
      : ["germany", "france", "united_kingdom", "spain", "algeria", "italy"];
    for (let i = 0; i < playerNations.length; i++) {
      for (let j = i + 1; j < playerNations.length; j++) {
        const key = `${playerNations[i]}|${playerNations[j]}`;
        const rel = new RelationState();
        rel.from_id = playerNations[i];
        rel.to_id   = playerNations[j];
        rel.stance  = "neutral";
        this.state.relations.set(key, rel);
      }
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
