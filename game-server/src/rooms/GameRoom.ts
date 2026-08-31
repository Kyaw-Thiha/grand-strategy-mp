import { Room, Client, CloseCode } from "colyseus";
import { jwtVerify } from "jose";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getCachedFile } from "../data/map_cache.js";
import { GameRoomState, PlayerState, NationState, DivisionState, ProvinceState, RelationState } from "./schema/GameRoomState.js";
import { AirWingState, WING_LIFECYCLE, MISSION_TYPES, serializeWing } from "./schema/AirWingState.js";
import { NavalContactMarkerState, serializeNavalContactMarker } from "./schema/NavalContactMarkerState.js";
import { getMapNationIds } from "../data/map_loader.js";
import { MovementSystem } from "../systems/movement_system.js";
import { CombatSystem, _isGridLocked } from "../systems/combat_system.js";
import { SupplySystem } from "../systems/supply_system.js";
import type { RoundResolvedPayload } from "../types/tactical_types.js";
import { SubprovinceSystem, makeIsFriendly } from "../systems/subprovince_system.js";
import { SupplyHubConstructionSystem } from "../systems/supply_hub_construction_system.js";
import { getAirUnitStats } from "../data/air_unit_stats.js";
import { AirWingLifecycleSystem, FUEL_DECAY_TRANSIT, FUEL_RTB_THRESHOLD } from "../systems/air_wing_lifecycle_system.js";
import { AirDetectionSystem } from "../systems/air_detection_system.js";
import { buildProvinceNeighbors, AirMissionTargetingSystem } from "../systems/air_mission_targeting.js";
import { DubinsPathfinder, registerManualTarget } from "../systems/air_dubins_pathfinder.js";
import { AirCombatSystem } from "../systems/air_combat_system.js";
import { AirBombingSystem } from "../systems/air_bombing_system.js";
import { AirStrategicBombingSystem } from "../systems/air_strategic_bombing_system.js";
import { AirNavalBomberSystem }      from "../systems/air_naval_bomber_system.js";
import { ProvinceAaSystem }          from "../systems/air_province_aa_system.js";
import { QUALITY_DEFAULTS }           from "../data/naval_contact_quality.js";
import { AirSpatialBucket } from "../systems/air_spatial_bucket.js";
import { ServerVisibilitySystem } from "../systems/server_visibility_system.js";
import { loadProvincePIPData }    from "../utils/geo_utils.js";
import { STARTING_POSITIONS } from "../data/maps/western_europe_6/starting_positions.js";
import { AIR_WING_STARTING_POSITIONS } from "../data/maps/western_europe_6/air_wing_starting_positions.js";
import { DEFAULT_TEMPLATE } from "../data/maps/western_europe_6/default_template.js";
import { EconomyBuildingSystem } from "../systems/economy_building_system.js";
import { getBuildingStats } from "../data/building_stats.js";

// How many game ticks between subprovince-graph supply route recomputation/broadcast.
// Matches the (unexported) SUPPLY_TICK_INTERVAL used by SupplySystem.tick()'s ring-based
// tier recalculation cadence in supply_system.ts, kept in sync deliberately rather than
// sharing an import.
const SUPPLY_TICK_INTERVAL = 5;

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
  private subprovinceSystem = new SubprovinceSystem();
  private supplyHubConstructionSystem = new SupplyHubConstructionSystem();
  private airWingLifecycleSystem = new AirWingLifecycleSystem();
  private airDetectionSystem = new AirDetectionSystem();
  private airDubinsPathfinder = new DubinsPathfinder();
  private airMissionTargetingSystem = new AirMissionTargetingSystem();
  private airCombatSystem = new AirCombatSystem();
  private airBombingSystem = new AirBombingSystem();
  private provinceAaSystem           = new ProvinceAaSystem();
  private airStrategicBombingSystem!: AirStrategicBombingSystem;
  private serverVisibilitySystem!: ServerVisibilitySystem;
  private airNavalBomberSystem       = new AirNavalBomberSystem();
  private economyBuildingSystem = new EconomyBuildingSystem();
  private airSpatialBucket = new AirSpatialBucket();
  private _provinceCityPositionLookup = new Map<string, { lng: number; lat: number }>();
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
    // Wire the shared SubprovinceSystem instance into CombatSystem so _checkProvinceCapture can
    // trigger the city-capture cascade (cell-level ownership fallout) right after a province
    // flips, along with the filtered-broadcast primitive so the cascade's SUBPROVINCE_CAPTURED
    // events are scoped to belligerent nations just like every other subprovince capture event.
    this.combatSystem.setSubprovinceSystem(
      this.subprovinceSystem,
      (sessionFilter, type, msg) => this._broadcastToFilteredNations(sessionFilter, type, msg),
    );

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
    this.onMessage("BUILD_SUPPLY_HUB", (client, msg) => this.handleBuildSupplyHub(client, msg));
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

    // ── Air wing production handlers ────────────────────────────────────────────

    this.onMessage("ASSIGN_WING_MISSION", (client, msg: {
      wing_id: string;
      mission: string;
      target_id: string;
      is_manual?: boolean;
    }) => {
      if (this.state.phase !== "running") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation) return;
      const wing = this.state.air_wings.get(msg.wing_id);
      if (!wing || wing.nation_id !== nation.nation_id) return;

      // Auto-Escort (empty target_id) is no longer resolved synchronously here — like every
      // other auto-targeted mission, assignMission() with an empty target leaves the wing
      // IDLE and AirMissionTargetingSystem's per-tick loop (resolveEscortTargets) picks a
      // bomber on the next tick, with the same continuous re-evaluation and hysteresis every
      // other mission gets (airborne bombers strictly preferred over idle ones, upgrading
      // automatically if a real airborne bomber later appears).
      const didChange = this.airWingLifecycleSystem.assignMission(
        msg.wing_id,
        msg.mission,
        msg.target_id,
        this.state
      );
      if (!didChange) return;
      const updated = this.state.air_wings.get(msg.wing_id);
      if (updated) this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(updated)] });

      const targetPos = this._resolveTargetPosition(msg.target_id);
      if (!targetPos || !updated) return;

      const path = this.airDubinsPathfinder.computeTransitPath(
        { lng: updated.position_lng, lat: updated.position_lat },
        updated.heading_deg,
        targetPos,
        getAirUnitStats(updated.aircraft_type).min_turn_radius_deg,
        getAirUnitStats(updated.aircraft_type).speed_deg_per_ms,
      );
      this.airDubinsPathfinder.clearPath(updated.wing_id);
      this.airDubinsPathfinder.storePath(updated.wing_id, path);
      updated.path_gen_id = path.path_gen_id;
      updated.path_elapsed_ms = 0;
      this.broadcast("AIR_WING_PATH", { wing_id: updated.wing_id, ...path });

      if (msg.is_manual && msg.target_id && msg.mission === MISSION_TYPES.INTERCEPTION) {
        registerManualTarget(msg.wing_id, msg.target_id);
      }

      // Manual-target protection for AirMissionTargetingSystem (separate from the
      // pathfinder's registerManualTarget above, which only feeds INTERCEPTION's
      // lost-contact loiter logic): a manual right-click assignment (interception,
      // tactical bombing, or industry bombing target selection) must not be silently
      // overwritten by auto-search on the next tick. A non-manual assignment (e.g. the UI
      // mission dropdown) hands control back to auto-search.
      if (msg.is_manual && msg.target_id) {
        this.airMissionTargetingSystem.registerManualTarget(msg.wing_id);
      } else {
        this.airMissionTargetingSystem.clearManualTarget(msg.wing_id);
      }
    });

    this.onMessage("RETREAT_WING", (client, msg: { wing_id: string }) => {
      if (this.state.phase !== "running") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation) return;
      const wing = this.state.air_wings.get(msg.wing_id);
      if (!wing || wing.nation_id !== nation.nation_id) return;

      this.airWingLifecycleSystem.retreatWing(msg.wing_id, this.state, (type, m) => this.broadcast(type, m));
    });

    this.onMessage("REDEPLOY_WING", (client, msg: { wing_id: string; new_province_id: string }) => {
      if (this.state.phase !== "running") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation) return;
      const wing = this.state.air_wings.get(msg.wing_id);
      if (!wing || wing.nation_id !== nation.nation_id) return;
      const province = this.state.provinces.get(msg.new_province_id);
      if (!province) return;
      const redeployStance = this.getRelationStance(nation.nation_id, province.owner_id);
      if (province.owner_id !== nation.nation_id && redeployStance !== "alliance") return;

      const didStart = this.airWingLifecycleSystem.startRedeploy(msg.wing_id, msg.new_province_id, this.state);
      if (!didStart) return;

      const updated = this.state.air_wings.get(msg.wing_id);
      if (!updated) return;

      this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(updated)] });

      // Only compute path immediately if wing is now RELOCATE (was IDLE).
      // Airborne wings have been forced to RTB; their RELOCATE path is computed
      // by the gameTick RELOCATE loop after they land.
      if (updated.lifecycle_state === WING_LIFECYCLE.RELOCATE) {
        const targetPos = this._resolveTargetPosition(msg.new_province_id);
        if (targetPos) {
          const startHeading = (Math.atan2(
            targetPos.lng - updated.position_lng,
            targetPos.lat - updated.position_lat,
          ) * 180 / Math.PI + 360) % 360;
          const path = this.airDubinsPathfinder.computeTransitPath(
            { lng: updated.position_lng, lat: updated.position_lat },
            startHeading,
            targetPos,
            getAirUnitStats(updated.aircraft_type).min_turn_radius_deg,
            getAirUnitStats(updated.aircraft_type).speed_deg_per_ms,
          );
          this.airDubinsPathfinder.clearPath(updated.wing_id);
          this.airDubinsPathfinder.storePath(updated.wing_id, path);
          updated.path_gen_id = path.path_gen_id;
          updated.path_elapsed_ms = 0;
          this.broadcast("AIR_WING_PATH", { wing_id: updated.wing_id, ...path });
        }
      }
    });

    this.onMessage("SUBMIT_AIR_WING_MOVE", (client, msg: {
      wing_id: string;
      target_lng: number;
      target_lat: number;
    }) => {
      if (this.state.phase !== "running") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation) return;
      const wing = this.state.air_wings.get(msg.wing_id);
      if (!wing || wing.nation_id !== nation.nation_id) return;

      // Auto-staging: if target is beyond max range from home airbase, find a closer
      // friendly staging base near the target and RELOCATE there first.
      const homePos = this._provinceCityPositionLookup.get(wing.home_airbase_province_id);
      const isAirborne = wing.lifecycle_state === WING_LIFECYCLE.TRANSIT
                      || wing.lifecycle_state === WING_LIFECYCLE.ENGAGED
                      || wing.lifecycle_state === WING_LIFECYCLE.LOITER
                      || wing.lifecycle_state === WING_LIFECYCLE.RELOCATE;

      if (isAirborne && homePos) {
        const wingSpeedDegPerMs = getAirUnitStats(wing.aircraft_type).speed_deg_per_ms;
        const currentRange = (wing.fuel - FUEL_RTB_THRESHOLD) / FUEL_DECAY_TRANSIT * wingSpeedDegPerMs * 1000;
        const MAX_RANGE_DEG = (1.0 - FUEL_RTB_THRESHOLD) / FUEL_DECAY_TRANSIT * wingSpeedDegPerMs * 1000;
        const distFromWing = Math.sqrt(
          (msg.target_lng - wing.position_lng) ** 2 +
          (msg.target_lat - wing.position_lat) ** 2
        );

        if (distFromWing > currentRange) {
          if (distFromWing <= MAX_RANGE_DEG) {
            this.airWingLifecycleSystem.retreatWing(wing.wing_id, this.state,
              (type, m) => this.broadcast(type, m));
            wing.pending_transit_lng = msg.target_lng;
            wing.pending_transit_lat = msg.target_lat;
            this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
            client.send("AIR_WING_RTB_QUEUED", { wing_id: wing.wing_id });
            return;
          } else {
            const stagingId = this._findNearestFriendlyAirbaseToPoint(
              wing, msg.target_lng, msg.target_lat,
            );
            if (stagingId) {
              this.airWingLifecycleSystem.startRedeploy(wing.wing_id, stagingId, this.state);
              this.airWingLifecycleSystem.queueTransitAfterRedeploy(
                wing.wing_id, msg.target_lng, msg.target_lat,
              );
              this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
              this.broadcast("AIR_WING_STAGING", { wing_id: wing.wing_id, staging_province_id: stagingId });
              return;
            }
            client.send("AIR_WING_MOVE_REJECTED", {
              wing_id: wing.wing_id,
              reason: "out_of_range",
            });
            return;
          }
        }
      }

      if (homePos) {
        const MAX_RANGE_DEG = (1.0 - FUEL_RTB_THRESHOLD) / FUEL_DECAY_TRANSIT * 0.0002 * 1000;
        const dlng = msg.target_lng - homePos.lng;
        const dlat = msg.target_lat - homePos.lat;
        if (Math.sqrt(dlng * dlng + dlat * dlat) > MAX_RANGE_DEG) {
          const stagingId = this._findNearestFriendlyAirbaseToPoint(
            wing, msg.target_lng, msg.target_lat,
          );
          if (stagingId) {
                  this.airWingLifecycleSystem.startRedeploy(wing.wing_id, stagingId, this.state);
            this.airWingLifecycleSystem.queueTransitAfterRedeploy(
              wing.wing_id, msg.target_lng, msg.target_lat,
            );
            this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
            this.broadcast("AIR_WING_STAGING", { wing_id: wing.wing_id, staging_province_id: stagingId });
            return;
          }
          if (!isAirborne) {
            client.send("AIR_WING_MOVE_REJECTED", {
              wing_id: wing.wing_id,
              reason: "out_of_range",
            });
          }
        }
      }

      const startPos = { lng: wing.position_lng, lat: wing.position_lat };
      const endPos   = { lng: msg.target_lng,    lat: msg.target_lat    };
      // IDLE wings always have heading_deg=0 (north). Use direct bearing to avoid the
      // backwards initial arc that buildSmoothPath creates when heading ≠ direction to target.
      const startHeading = wing.lifecycle_state === WING_LIFECYCLE.IDLE
        ? (Math.atan2(endPos.lng - startPos.lng, endPos.lat - startPos.lat) * 180 / Math.PI + 360) % 360
        : wing.heading_deg;
      const path = this.airDubinsPathfinder.computeTransitPath(
        startPos,
        startHeading,
        endPos,
        getAirUnitStats(wing.aircraft_type).min_turn_radius_deg,
        getAirUnitStats(wing.aircraft_type).speed_deg_per_ms,
      );
      this.airDubinsPathfinder.clearPath(wing.wing_id);
      this.airDubinsPathfinder.storePath(wing.wing_id, path);
      wing.path_gen_id = path.path_gen_id;
      wing.path_elapsed_ms = 0;
      wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      this.broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...path });
      this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
    });

    this.onMessage("DISBAND_WING", (client, msg: { wing_id: string }) => {
      if (this.state.phase !== "running") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation) return;
      const wing = this.state.air_wings.get(msg.wing_id);
      if (!wing || wing.nation_id !== nation.nation_id) return;

      this.airDubinsPathfinder.clearPath(msg.wing_id);
      this.airWingLifecycleSystem.disbandWing(msg.wing_id, this.state,
        (type, m) => this.broadcast(type, m), "WING_DESTROYED");
      this.airDetectionSystem.clearWing(msg.wing_id);
    });

    this.onMessage("SET_WING_PERK", (client, msg: {
      wing_id: string;
      perk: string;
      value: boolean;
    }) => {
      if (this.state.phase !== "running") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation) return;
      const wing = this.state.air_wings.get(msg.wing_id);
      if (!wing || wing.nation_id !== nation.nation_id) return;

      const didChange = this.airWingLifecycleSystem.setPerk(msg.wing_id, msg.perk, msg.value, this.state);
      if (!didChange) return;
      const updated = this.state.air_wings.get(msg.wing_id);
      if (updated) this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(updated)] });
    });

    this.onMessage("ADJUST_WING_SIZE", (client, msg: {
      wing_id: string;
      delta: number;
    }) => {
      if (this.state.phase !== "running") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation) return;
      const wing = this.state.air_wings.get(msg.wing_id);
      if (!wing || wing.nation_id !== nation.nation_id) return;

      wing.count = Math.max(0, wing.count + msg.delta);
      this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
    });

    this.onMessage("CREATE_WING", (client, msg: {
      wing_id: string;
      aircraft_type: string;
      count: number;
      home_airbase_province_id: string;
    }) => {
      if (this.state.phase !== "running") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation) return;
      const province = this.state.provinces.get(msg.home_airbase_province_id);
      if (!province || province.owner_id !== nation.nation_id) return;

      const wing = new AirWingState();
      wing.wing_id                  = msg.wing_id;
      wing.nation_id                = nation.nation_id;
      wing.aircraft_type            = msg.aircraft_type;
      wing.count                    = Math.max(0, msg.count);
      wing.home_airbase_province_id = msg.home_airbase_province_id;
      wing.lifecycle_state          = WING_LIFECYCLE.IDLE;
      wing.mission                  = MISSION_TYPES.IDLE;

      const pos = this._provinceCityPositionLookup.get(msg.home_airbase_province_id);
      if (pos) {
        wing.position_lng = pos.lng;
        wing.position_lat = pos.lat;
      }

      this.state.air_wings.set(msg.wing_id, wing);
      this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
    });

    this.onMessage("BUILD_BUILDING", (client, msg: { province_id: string; building_type: string }) => {
      if (this.state.phase !== "running") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation) return;
      const province = this.state.provinces.get(msg.province_id);
      if (!province || province.owner_id !== nation.nation_id) return;

      const econ = this.economyBuildingSystem.get(msg.province_id);
      if (!econ) return;
      const currentLevel = econ.buildings[msg.building_type] ?? 0;
      const stats = getBuildingStats(msg.building_type);
      // Same 0-based "cost to reach next level" indexing as EconomyBuildingSystem.startConstruction.
      const cost = stats.resource_cost_by_level[currentLevel];
      if (!cost) return; // already at level cap

      for (const [resType, amount] of Object.entries(cost)) {
        if ((nation.resources.get(resType) ?? 0) < (amount ?? 0)) return; // insufficient — reject silently
      }

      const project = this.economyBuildingSystem.startConstruction(msg.province_id, msg.building_type, province.infrastructure);
      if (!project) return; // already in progress or at cap

      // Resource cost is deducted at construction START, not completion — per
      // ECONOMY_BUILDINGS.md's "costs resources and time," both paid up front.
      for (const [resType, amount] of Object.entries(cost)) {
        nation.resources.set(resType, (nation.resources.get(resType) ?? 0) - (amount ?? 0));
      }

      this.broadcast("BUILDING_UPDATES", {
        province_id: msg.province_id,
        buildings: econ.buildings,
        construction_queue: econ.construction_queue,
      });
    });

    if (process.env.DEV_MODE === "true") {
      this.onMessage("DEV_TELEPORT",   (_client, msg) => this.handleDevTeleport(msg));
      this.onMessage("DEV_SET_SUPPLY", (_client, msg) => this.handleDevSetSupply(msg));
      this.onMessage("SPAWN_WING", (_client, msg: {
        wing_id: string;
        nation_id: string;
        aircraft_type?: string;
        count?: number;
        position_lng?: number;
        position_lat?: number;
        heading_deg?: number;
        lifecycle_state?: string;
        mission?: string;
        home_airbase_province_id?: string;
      }) => {
        const wing = new AirWingState();
        wing.wing_id   = msg.wing_id;
        wing.nation_id = msg.nation_id;
        if (msg.aircraft_type            !== undefined) wing.aircraft_type            = msg.aircraft_type;
        if (msg.count                    !== undefined) wing.count                    = msg.count;
        if (msg.position_lng             !== undefined) wing.position_lng             = msg.position_lng;
        if (msg.position_lat             !== undefined) wing.position_lat             = msg.position_lat;
        if (msg.heading_deg              !== undefined) wing.heading_deg              = msg.heading_deg;
        if (msg.lifecycle_state          !== undefined) wing.lifecycle_state          = msg.lifecycle_state;
        if (msg.mission                  !== undefined) wing.mission                  = msg.mission;
        if (msg.home_airbase_province_id !== undefined) wing.home_airbase_province_id = msg.home_airbase_province_id;
        this.state.air_wings.set(msg.wing_id, wing);
        this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
      });

      this.onMessage("CREATE_NAVAL_CONTACT", (_client, msg: {
        marker_id:    string;
        nation_id:    string;
        quality:      string;
        position_lng: number;
        position_lat: number;
      }) => {
        const defaults = QUALITY_DEFAULTS[msg.quality];
        if (!defaults) return;
        const marker = new NavalContactMarkerState();
        marker.marker_id     = msg.marker_id;
        marker.nation_id     = msg.nation_id;
        marker.quality       = msg.quality;
        marker.position_lng  = msg.position_lng;
        marker.position_lat  = msg.position_lat;
        marker.radius_deg    = defaults.radius_deg;
        marker.expires_at_ms = Date.now() + defaults.duration_ms;
        marker.is_refreshable = defaults.is_refreshable;
        this.state.naval_contact_markers.set(msg.marker_id, marker);
        this.broadcastToNation("NAVAL_CONTACT_UPDATES", { markers: [serializeNavalContactMarker(marker)] }, msg.nation_id);
      });
    }
    if (process.env.NODE_ENV === "test") {
      this.onMessage("SPAWN_DIVISION", (_client, msg: {
        division_id: string;
        nation_id: string;
        position_lng: number;
        position_lat: number;
        observation_radius?: number;
      }) => {
        const div = new DivisionState();
        div.division_id  = msg.division_id;
        div.nation_id    = msg.nation_id;
        div.position_lng = msg.position_lng;
        div.position_lat = msg.position_lat;
        if (msg.observation_radius !== undefined) div.observation_radius = msg.observation_radius;
        this.state.divisions.set(msg.division_id, div);
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
          div.grid.cells[c.row * 5 + c.col].unit_type = c.unit_type;
        }
      });
      this.onMessage("SET_RELATION", (_client, msg: {
        nation_a: string;
        nation_b: string;
        stance: "war" | "neutral" | "alliance";
      }) => {
        this.setRelationStance(msg.nation_a, msg.nation_b, msg.stance);
        this.broadcastRelations();
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
      this.onMessage("SPAWN_WING", (_client, msg: {
        wing_id: string;
        nation_id: string;
        aircraft_type?: string;
        count?: number;
        position_lng?: number;
        position_lat?: number;
        heading_deg?: number;
        lifecycle_state?: string;
        mission?: string;
        home_airbase_province_id?: string;
      }) => {
        const wing = new AirWingState();
        wing.wing_id      = msg.wing_id;
        wing.nation_id    = msg.nation_id;
        if (msg.aircraft_type              !== undefined) wing.aircraft_type              = msg.aircraft_type;
        if (msg.count                      !== undefined) wing.count                      = msg.count;
        if (msg.position_lng               !== undefined) wing.position_lng               = msg.position_lng;
        if (msg.position_lat               !== undefined) wing.position_lat               = msg.position_lat;
        if (msg.heading_deg                !== undefined) wing.heading_deg                = msg.heading_deg;
        if (msg.lifecycle_state            !== undefined) wing.lifecycle_state            = msg.lifecycle_state;
        if (msg.mission                    !== undefined) wing.mission                    = msg.mission;
        if (msg.home_airbase_province_id   !== undefined) wing.home_airbase_province_id   = msg.home_airbase_province_id;
        this.state.air_wings.set(msg.wing_id, wing);
        this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
      });

      this.onMessage("SET_WING_LIFECYCLE", (_client, msg: {
        wing_id: string;
        lifecycle_state: string;
      }) => {
        const wing = this.state.air_wings.get(msg.wing_id);
        if (!wing) return;
        wing.lifecycle_state = msg.lifecycle_state;
      });

      this.onMessage("SET_WING_READINESS", (_client, msg: {
        wing_id: string;
        combat_readiness: number;
      }) => {
        const wing = this.state.air_wings.get(msg.wing_id);
        if (!wing) return;
        wing.combat_readiness = Math.max(0, Math.min(1, msg.combat_readiness));
      });

      this.onMessage("SET_WING_FUEL", (_client, msg: {
        wing_id: string;
        fuel: number;
      }) => {
        const wing = this.state.air_wings.get(msg.wing_id);
        if (!wing) return;
        wing.fuel = Math.max(0, Math.min(1, msg.fuel));
      });

      this.onMessage("SET_WING_TARGET", (_client, msg: {
        wing_id: string;
        target_id: string;
      }) => {
        const wing = this.state.air_wings.get(msg.wing_id);
        if (!wing) return;
        wing.target_id = msg.target_id;
      });

      this.onMessage("SET_WING_COUNT", (_client, msg: {
        wing_id: string;
        count: number;
      }) => {
        const wing = this.state.air_wings.get(msg.wing_id);
        if (!wing) return;
        wing.count = Math.max(0, msg.count);
      });

      this.onMessage("SET_WING_STATUS_FUEL", (_client, msg: {
        wing_id: string;
        status_fuel: number;
      }) => {
        const wing = this.state.air_wings.get(msg.wing_id);
        if (!wing) return;
        wing.status_fuel = msg.status_fuel;
      });

      this.onMessage("SET_PATH_ELAPSED", (_client, msg: { wing_id: string; elapsed_ms: number }) => {
        const wing = this.state.air_wings.get(msg.wing_id);
        if (!wing) return;
        wing.path_elapsed_ms = msg.elapsed_ms;
      });

      this.onMessage("SET_PROVINCE_RADAR", (_client, msg: {
        province_id: string;
        nation_id: string;
        position_lng: number;
        position_lat: number;
        radius_deg: number;
      }) => {
        this.airDetectionSystem.setRadarEntry(msg.province_id, {
          position_lng: msg.position_lng,
          position_lat: msg.position_lat,
          radius_deg: msg.radius_deg,
          nation_id: msg.nation_id,
        });

        const payload = {
          key: msg.province_id,
          nation_id: msg.nation_id,
          position_lng: msg.position_lng,
          position_lat: msg.position_lat,
          radius_deg: msg.radius_deg,
        };
        for (const client of this.clients) {
          const player = this.state.players.get(client.sessionId);
          if (!player) continue;
          const nation = this.getNationForPlayer(player.userId);
          if (!nation || nation.nation_id !== msg.nation_id) continue;
          client.send("RADAR_UPDATED", payload);
        }
      });

      this.onMessage("SET_WING_POSITION", (_client, msg: {
        wing_id: string;
        position_lng: number;
        position_lat: number;
      }) => {
        const wing = this.state.air_wings.get(msg.wing_id);
        if (!wing) return;
        wing.position_lng = msg.position_lng;
        wing.position_lat = msg.position_lat;
        this.airDubinsPathfinder.clearPath(msg.wing_id);
        wing.path_gen_id = "";
        wing.path_elapsed_ms = 0;
      });

      this.onMessage("SIMULATE_ENGAGEMENT_START", (_client, msg: {
        wing_id: string;
        target_wing_id: string;
      }) => {
        const wing = this.state.air_wings.get(msg.wing_id);
        if (!wing) return;
        wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
        this.airWingLifecycleSystem.triggerContact(msg.wing_id, msg.target_wing_id, this.state);
      });

      this.onMessage("SPAWN_LAND_ENGAGEMENT", (_client, msg: {
        province_id: string;
        attacker_nation_id: string;
        defender_nation_id: string;
        position_lng: number;
        position_lat: number;
        defender_grid: Array<{ cell_index: number; unit_type: string; hp: number }>;
      }) => {
        this.combatSystem.injectTestEngagement({
          province_id:        msg.province_id,
          attacker_nation_id: msg.attacker_nation_id,
          defender_nation_id: msg.defender_nation_id,
          position_lng:       msg.position_lng,
          position_lat:       msg.position_lat,
          defender_grid:      msg.defender_grid,
        });
      });

      this.onMessage("SET_PROVINCE_OWNER", (_client, msg: { province_id: string; owner_id: string }) => {
        const prov = this.state.provinces.get(msg.province_id);
        if (prov) prov.owner_id = msg.owner_id;
      });

      this.onMessage("SET_PROVINCE_AA", (_client, msg: { province_id: string; strength: number }) => {
        this.provinceAaSystem.setProvinceAaStrength(msg.province_id, msg.strength);
      });

      this.onMessage("SET_DIVISION_POSITION", (
        _client, msg: { division_id: string; lng: number; lat: number },
      ) => {
        const div = this.state.divisions.get(msg.division_id);
        if (div) {
          div.position_lng = msg.lng;
          div.position_lat = msg.lat;
        }
      });

      this.onMessage("CREATE_NAVAL_CONTACT", (_client, msg: {
        marker_id:    string;
        nation_id:    string;
        quality:      string;
        position_lng: number;
        position_lat: number;
      }) => {
        const defaults = QUALITY_DEFAULTS[msg.quality];
        if (!defaults) return;
        const marker = new NavalContactMarkerState();
        marker.marker_id     = msg.marker_id;
        marker.nation_id     = msg.nation_id;
        marker.quality       = msg.quality;
        marker.position_lng  = msg.position_lng;
        marker.position_lat  = msg.position_lat;
        marker.radius_deg    = defaults.radius_deg;
        marker.expires_at_ms = Date.now() + defaults.duration_ms;
        marker.is_refreshable = defaults.is_refreshable;
        this.state.naval_contact_markers.set(msg.marker_id, marker);
        this.broadcastToNation("NAVAL_CONTACT_UPDATES", { markers: [serializeNavalContactMarker(marker)] }, msg.nation_id);
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

  private handleBuildSupplyHub(client: Client, msg: { province_id?: string }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const nation = this.getNationForPlayer(player.userId);
    if (!nation) {
      client.send("ERROR", { message: "Select a nation before building a supply hub" });
      return;
    }
    const provinceId = msg.province_id;
    if (!provinceId) {
      client.send("ERROR", { message: "province_id is required" });
      return;
    }
    const result = this.supplyHubConstructionSystem.startConstruction(
      nation.nation_id, provinceId, this.state, this.subprovinceSystem, Date.now(),
    );
    if (result.ok === false) {
      client.send("ERROR", { message: result.error });
    }
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
      waypoints, division.nation_id, this.state.relations, this.subprovinceSystem, this.state.subprovinces,
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

    // Store exact click target for last-mile advancement (-999 = none) — resolved/clamped against
    // the same neutral-territory guard and terrain passability the waypoint chain just went
    // through, plus a distance cap scaled to the local waypoint graph's own density. Without this,
    // _advanceFinalPosition would walk an unchecked, unbounded straight line toward the raw click
    // coordinate regardless of what trimToAllowedTerritory decided about the chain above it.
    division.final_position_lng = -999;
    division.final_position_lat = -999;
    if (typeof msg.final_lng === "number" && typeof msg.final_lat === "number") {
      const resolved = this.movementSystem.resolveFinalPosition(
        allowedWaypoints[allowedWaypoints.length - 1],
        msg.final_lng, msg.final_lat,
        division, this.state.relations, this.subprovinceSystem, this.state.subprovinces,
      );
      if (resolved) {
        division.final_position_lng = resolved.lng;
        division.final_position_lat = resolved.lat;
      }
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
    if (division.combat_state !== "idle") return;
    if (division.move_order.length === 0 && !(division.final_position_lng > -998)) return;

    division.move_order.splice(0, division.move_order.length);
    division.final_position_lng = -999;
    division.final_position_lat = -999;
    this.broadcastFilteredDivisionUpdates([divisionId]);
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
    if (division.combat_state !== "engaged" && division.combat_state !== "suppressed") return;

    const enemies: DivisionState[] = [];
    for (const eid of division.engaged_with) {
      const e = this.state.divisions.get(eid);
      if (e && e.nation_id !== division.nation_id
        && (e.combat_state === "engaged" || e.combat_state === "suppressed")) {
        enemies.push(e);
      }
    }
    if (enemies.length === 0) return;
    const changed = new Set<string>();
    this.combatSystem.initiateRetreat(division, enemies, this.state, changed, (type, msg) => this.broadcast(type, msg));

    // Include the retreating division even though CombatSystem only tracks changed opponents.
    changed.add(divisionId);
    this.broadcastFilteredDivisionUpdates(changed);
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

    // Load waypoints for movement and map data for combat + supply. Movement's own neutral-
    // territory check no longer needs a loadMapData snapshot — it resolves ownership live via
    // SubprovinceSystem/state.subprovinces instead (see movement_system.ts's _isNeutralFor).
    this.movementSystem.loadWaypoints(this.state.map_id);
    this.combatSystem.loadMapData(this.state.map_id);
    this.supplySystem.loadMapData(this.state.map_id);
    this.subprovinceSystem.loadForRoom(this.state.map_id);
    this._initProvinces(this.state.map_id);
    // Must run after _initProvinces populates province.owner_id, since subprovince ownership
    // is seeded from each subprovince's parent province's current owner_id.
    this.subprovinceSystem.initializeOwnership(this.state);
    this.airStrategicBombingSystem = new AirStrategicBombingSystem(
      this._provinceCityPositionLookup,
    );
    this.serverVisibilitySystem = new ServerVisibilitySystem(
      loadProvincePIPData(this.state.map_id),
      this.subprovinceSystem,
    );
    this._initRelations();
    this.broadcastRelations();
    this._initNationEconomy();
    // Resources are per-nation private data (each player only sees their own nation's
    // stockpile) — sent per-client via client.send(), not a global broadcast. Nothing
    // produces resources yet in this branch, so this is a one-time snapshot of the seeded
    // starting stockpile; Branch B adds ongoing RESOURCE_UPDATES as production comes online.
    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (!player) continue;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation) continue;
      client.send("RESOURCE_UPDATES", { resources: Object.fromEntries(nation.resources) });
    }

    // Spawn all divisions and air wings
    this.spawnDivisions();
    this.spawnAirWings();

    // Broadcast GAME_STARTED (existing clients listen for this)
    const assignments: Record<string, string> = {};
    for (const [id, nation] of this.state.nations.entries()) {
      assignments[id] = nation.player_id;
    }
    this.broadcast("GAME_STARTED", {
      nation_assignments: assignments,
      game_speed: this.state.game_speed,
    });

    // Send initial province ownership so clients can validate RELOCATE targets immediately
    const provinceOwners: Record<string, string> = {};
    for (const [pid, province] of this.state.provinces) {
      if (province.owner_id) provinceOwners[pid] = province.owner_id;
    }
    this.broadcast("PROVINCE_INIT", { provinces: provinceOwners });

    // Send initial per-province buildings/resource-deposits (off-schema, DivisionState.grid
    // precedent — see EconomyBuildingSystem's doc comment).
    const economySnapshot: Record<string, { buildings: Record<string, number>; resource_deposits: Record<string, number> }> = {};
    for (const [pid, econ] of this.economyBuildingSystem.getAll()) {
      economySnapshot[pid] = { buildings: econ.buildings, resource_deposits: econ.resource_deposits };
    }
    this.broadcast("PROVINCE_ECONOMY_INIT", { provinces: economySnapshot });

    // Send initial subprovince ownership snapshot (owner_id only — geometry/kind/province_id
    // are already static client data loaded from the map pipeline in Batch 3).
    const subprovinceSnapshot: Record<string, string> = {};
    for (const [id, sp] of this.state.subprovinces) {
      subprovinceSnapshot[id] = sp.owner_id;
    }
    this.broadcast("SUBPROVINCE_INIT", { subprovinces: subprovinceSnapshot });

    // Send full initial division state — profile sent once at top level (shared by all divisions)
    const sharedProfileJson = this.state.divisions.values().next().value?.movement_profile_json ?? "";
    this.broadcast("DIVISIONS_SPAWNED", {
      shared_profile_json: sharedProfileJson,
      divisions: this.serializeDivisions(),
    });

    this.broadcastFilteredAirWingUpdates({
      wings: [...this.state.air_wings.values()].map(w => serializeWing(w)),
    });

    // Send initial loiter paths so clients can animate pre-spawned loitering wings
    for (const wing of this.state.air_wings.values()) {
      if (wing.lifecycle_state !== WING_LIFECYCLE.LOITER) continue;
      const path = this.airDubinsPathfinder.getPath(wing.wing_id);
      if (path) this.broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...path });
    }

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

  private spawnAirWings() {
    for (const spawn of AIR_WING_STARTING_POSITIONS) {
      const wing = new AirWingState();
      wing.wing_id                  = spawn.wing_id;
      wing.nation_id                = spawn.nation_id;
      wing.aircraft_type            = spawn.aircraft_type;
      wing.count                    = 10;
      wing.combat_readiness         = 1.0;
      wing.position_lng             = spawn.lng;
      wing.position_lat             = spawn.lat;
      wing.heading_deg              = spawn.heading_deg ?? 0;
      wing.lifecycle_state          = (spawn.lifecycle_state as WING_LIFECYCLE) ?? WING_LIFECYCLE.IDLE;
      wing.mission                  = spawn.mission ?? MISSION_TYPES.IDLE;
      wing.target_id                = "";
      wing.home_airbase_province_id = spawn.home_airbase_province_id;
      wing.weapon_ready             = true;
      this.state.air_wings.set(spawn.wing_id, wing);
      // Wings spawned directly as LOITER need a real loiter arc so the pathfinder
      // has a valid position/heading when RTB is eventually triggered. Without a path,
      // the RTB produces a degenerate zero-distance path that causes erratic behaviour.
      if (wing.lifecycle_state === WING_LIFECYCLE.LOITER) {
        const loiterPath = this.airDubinsPathfinder.computeLoiterArc(
          { lng: spawn.lng, lat: spawn.lat },
          spawn.heading_deg ?? 0,
          this.airDubinsPathfinder.defaultTurnRadius(),
          getAirUnitStats(spawn.aircraft_type).speed_deg_per_ms,
        );
        this.airDubinsPathfinder.storePath(wing.wing_id, loiterPath);
        wing.path_gen_id = loiterPath.path_gen_id;
      }
    }
  }

  /**
   * Assign RTB paths to every wing currently in RTB state that doesn't already
   * have one.  Called twice per tick:
   *   1. Before pathfinder.tick() – wings RTB'd by the lifecycle system.
   *      `aheadPosition=true` evaluates the old path one tick ahead so the RTB
   *      path starts from the wing's actual current-tick position.
   *   2. After airCombatSystem.tick() – wings RTB'd by combat resolution.
   *      `aheadPosition=false` uses wing.position_lng/lat directly because the
   *      pathfinder has already updated it this tick.
   */
  private _assignRtbPaths(aheadPosition: boolean): void {
    for (const wing of this.state.air_wings.values()) {
      if (wing.lifecycle_state !== WING_LIFECYCLE.RTB) continue;
      const existingPath = this.airDubinsPathfinder.getPath(wing.wing_id);
      if (existingPath?.path_type === "RTB") continue;

      let startPos = { lng: wing.position_lng, lat: wing.position_lat };
      let startHeading = wing.heading_deg;
      if (existingPath) {
        if (aheadPosition) {
          let runtimeElapsed = wing.path_elapsed_ms + TICK_MS;
          if (existingPath.path_type === "LOITER") {
            const period = existingPath.total_length_deg / Math.max(existingPath.speed_deg_per_ms, 0.000001);
            if (period > 0) runtimeElapsed = runtimeElapsed % period;
          }
          const cur = this.airDubinsPathfinder.evaluatePosition(existingPath, runtimeElapsed);
          startPos    = { lng: cur.lng, lat: cur.lat };
          startHeading = cur.heading_compass_deg;
        }
        this.airDubinsPathfinder.clearPath(wing.wing_id);
      }

      // Escort-only: RTB to the FORMER bomber's airbase instead of the escort's own, when
      // no replacement bomber/patrol duty was found (see air_mission_targeting.ts).
      const rtbDestinationId = wing.escort_rtb_fallback_province_id !== ""
        ? wing.escort_rtb_fallback_province_id
        : wing.home_airbase_province_id;
      const airbasePos = this._resolveTargetPosition(rtbDestinationId);
      if (!airbasePos) continue;
      if (wing.escort_rtb_fallback_province_id !== "") wing.escort_rtb_fallback_province_id = ""; // consumed
      const rtbPath = this.airDubinsPathfinder.computeRtbPath(startPos, startHeading, airbasePos, 0, getAirUnitStats(wing.aircraft_type).min_turn_radius_deg, getAirUnitStats(wing.aircraft_type).speed_deg_per_ms);
      this.airDubinsPathfinder.storePath(wing.wing_id, rtbPath);
      wing.path_gen_id = rtbPath.path_gen_id;
      wing.path_elapsed_ms = 0;
      this.airDubinsPathfinder.advanceWingOnePath(wing, TICK_MS);
      this.broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...rtbPath });
      this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
    }
  }

  private broadcastToNation(type: string, msg: unknown, nationId: string): void {
    for (const c of this.clients) {
      const p = this.state.players.get(c.sessionId);
      if (!p) continue;
      const n = this.getNationForPlayer(p.userId);
      if (!n || n.nation_id !== nationId) continue;
      c.send(type, msg);
    }
  }

  /**
   * Sends a message to each client whose resolved nation_id passes sessionFilter. Used as the
   * BroadcastFn callback shape SubprovinceSystem's capture/revert methods expect, modeled on the
   * existing broadcastToNation/broadcastFilteredAirWingUpdates per-client resolution pattern.
   */
  private _broadcastToFilteredNations(
    sessionFilter: (nationId: string) => boolean,
    type: string,
    msg: unknown,
  ): void {
    for (const c of this.clients) {
      const p = this.state.players.get(c.sessionId);
      if (!p) continue;
      const n = this.getNationForPlayer(p.userId);
      if (!n || !sessionFilter(n.nation_id)) continue;
      c.send(type, msg);
    }
  }

  private broadcastFilteredAirWingUpdates(msg: { wings: unknown[] }): void {
    if (!this.serverVisibilitySystem) {
      this.broadcast("AIR_WING_UPDATES", msg);
      return;
    }
    for (const client of this.clients) {
      const p = this.state.players.get(client.sessionId);
      if (!p) continue;
      const nation = this.getNationForPlayer(p.userId);
      if (!nation) continue;
      const alliance = this.getAllianceFor(nation.nation_id);
      const visibleWings = msg.wings.filter((w: any) => {
        if (w.nation_id === nation.nation_id) return true;
        if (alliance.has(w.nation_id)) return true;
        return this.serverVisibilitySystem.canNationSeeWing(nation.nation_id, w.wing_id);
      });
      if (visibleWings.length > 0) client.send("AIR_WING_UPDATES", { wings: visibleWings });
    }
  }

  /** Sends each client only the requested division updates visible to their nation. */
  private broadcastFilteredDivisionUpdates(divisionIds: Iterable<string>): void {
    const divisions = [...divisionIds]
      .map(divisionId => this.state.divisions.get(divisionId))
      .filter((division): division is DivisionState => division !== undefined);

    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (!player) continue;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation) continue;
      const visibleUpdates = divisions
        .filter(division => this.serverVisibilitySystem.canNationSeeDivision(
          nation.nation_id,
          division.division_id,
        ))
        .map(division => this.serializeDivision(division));
      if (visibleUpdates.length > 0) {
        client.send("DIVISION_UPDATES", { divisions: visibleUpdates });
      }
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

      // Subprovince capture check — must run in this exact order: reset freeze tracking, then
      // one full scan marking every engaged/suppressed division's cell frozen, THEN per-division
      // capture checks, THEN per-(attacker,province) revert checks. See subprovince_system.ts's
      // scanCombatFreeze/resetFreezeTracking doc comments for why this order is load-bearing.
      this.subprovinceSystem.resetFreezeTracking();
      this.subprovinceSystem.scanCombatFreeze(this.state.divisions.values());
      for (const division of this.state.divisions.values()) {
        const startPosition = this.movementSystem.getTickStartPosition(division.division_id);
        this.subprovinceSystem.checkCaptureAfterMovement(
          division,
          this.state,
          (sessionFilter, type, msg) => this._broadcastToFilteredNations(sessionFilter, type, msg),
          startPosition,
        );
      }
      for (const { nationId, provinceId } of this.subprovinceSystem.getTrackedAttackerProvincePairs()) {
        this.subprovinceSystem.revertNationCaptureIfProvinceEmpty(nationId, provinceId, this.state, (sessionFilter, type, msg) =>
          this._broadcastToFilteredNations(sessionFilter, type, msg),
        );
      }

      this.supplyHubConstructionSystem.tick(this.state, Date.now(), (provinceId) => {
        this.subprovinceSystem.registerDynamicHub(provinceId);
        this.broadcast("SUPPLY_HUB_COMPLETED", { province_id: provinceId });
      });

      const pendingCaptures: Array<{ province_id: string; new_owner_id: string }> = [];
      const combatChanged = this.combatSystem.tick(this.state, this.tickCount, (type, msg) => {
        this.broadcast(type, msg);
        if (type === "PROVINCE_CAPTURED") {
          pendingCaptures.push(msg as { province_id: string; new_owner_id: string });
        }
      });
      // Only handle captures where province is STILL enemy-held after all combat this tick
      // (filters out ping-pong where Germany then France capture the same province in one tick)
      for (const evt of pendingCaptures) {
        const prov = this.state.provinces.get(evt.province_id);
        if (prov && prov.owner_id === evt.new_owner_id) {
          this._handleAirbaseCapture(evt);
        }
      }
      const supplyChanged = this.supplySystem.tick(this.state, this.tickCount, (type, msg) => this.broadcast(type, msg), this.subprovinceSystem);

      // TODO Branch B: constructionMultiplier is per-nation (each nation allocates its own
      // Industry Pool), but tick()'s signature only takes one global number since Branch A
      // hardcodes 1.0 for everyone. Branch B needs to change this to a per-province-owner
      // lookup, not a single multiplier.
      const constructionMultiplier = 1.0;
      this.economyBuildingSystem.tick(this.state.provinces, constructionMultiplier, (type, msg) => this.broadcast(type, msg));

      // Subprovince-graph supply routes (Task 8) — recomputed and broadcast on the same cadence
      // as the (currently no-op) legacy supply tick above. Routes are per-recipient-filtered data
      // (own nation always, allied nation always, otherwise gated by fog-of-war visibility) so they
      // are sent as a client event rather than synced through the Colyseus schema, which can't
      // express per-viewer filtering.
      if (this.tickCount % SUPPLY_TICK_INTERVAL === 0) {
        const routes = this.supplySystem.computeSubprovinceRoutes(this.state, this.subprovinceSystem);
        for (const route of routes) {
          const division = this.state.divisions.get(route.divisionId);
          if (!division) continue;
          const isFriendly = makeIsFriendly(division.nation_id, this.state.relations);
          this._broadcastToFilteredNations(
            (nationId) =>
              isFriendly(nationId) ||
              this.serverVisibilitySystem.canNationSeeDivision(nationId, division.division_id),
            "SUPPLY_ROUTE_UPDATE",
            route,
          );
        }
      }

      this.airDetectionSystem.tick(
        this.state,
        (type, msg) => this.broadcast(type, msg),
        (type, msg, nationId) => this.broadcastToNation(type, msg, nationId),
      );

      this.serverVisibilitySystem.tick(
        this.state,
        this.airDetectionSystem,
        (nationId) => this.getAllianceFor(nationId),
        (sessionId, type, msg) => {
          const client = this.clients.find(c => c.sessionId === sessionId);
          client?.send(type, msg);
        },
        (sessionId) => {
          const p = this.state.players.get(sessionId);
          if (!p) return null;
          return this.getNationForPlayer(p.userId)?.nation_id ?? null;
        },
        this.clients,
      );

      const wingBroadcast = (type: string, msg: any) => {
        if (type === "AIR_WING_UPDATES") {
          this.broadcastFilteredAirWingUpdates(msg);
        } else {
          this.broadcast(type, msg);
        }
      };
      this.airWingLifecycleSystem.tick(this.state, this.tickCount, wingBroadcast);

      // Auto-targeting: resolves each retargetable wing's mission-specific tier chain and
      // commits a new target/path per the hysteresis rule (see AIR_COMBAT.md). Runs after
      // the lifecycle tick (so LOITER/IDLE transitions from this tick are visible) and before
      // the RTB/Dubins ticks below (so a freshly committed TRANSIT wing gets its path advanced
      // this same tick).
      this.airMissionTargetingSystem.tick(
        this.state,
        this.airDetectionSystem,
        this.airWingLifecycleSystem,
        this.airDubinsPathfinder,
        (id) => this._resolveTargetPosition(id),
        wingBroadcast,
        this.serverVisibilitySystem,
      );

      // Wings set to RTB by the lifecycle tick (fuel-out, auto-resolve) get their paths
      // here. pathfinder.tick() hasn't run yet, so we evaluate one tick ahead via
      // path_elapsed_ms + TICK_MS to minimise the position gap at RTB start.
      this._assignRtbPaths(true);

      this.airDubinsPathfinder.tick(this.state, TICK_MS, this.airSpatialBucket, this.airWingLifecycleSystem,
        wingBroadcast);

      this.airCombatSystem.tick(this.state, this.airWingLifecycleSystem,
        wingBroadcast);

      // Wings set to RTB by the combat system get their paths in the same tick.
      // pathfinder.tick() has already run, so wing.position_lng/lat is current.
      this._assignRtbPaths(false);

      // RELOCATE path loop: compute Dubins path for wings that just entered RELOCATE
      // (after landing from an airborne state) but don't yet have a path.
      for (const wing of this.state.air_wings.values()) {
        if (wing.lifecycle_state !== WING_LIFECYCLE.RELOCATE) continue;
        if (this.airDubinsPathfinder.getPath(wing.wing_id)) continue;

        const newProvinceId = this.airWingLifecycleSystem.getPendingRedeployTarget(wing.wing_id);
        if (!newProvinceId) continue;
        const targetPos = this._resolveTargetPosition(newProvinceId);
        if (!targetPos) continue;

        const startHeading = (Math.atan2(
          targetPos.lng - wing.position_lng,
          targetPos.lat - wing.position_lat,
        ) * 180 / Math.PI + 360) % 360;
        const path = this.airDubinsPathfinder.computeTransitPath(
          { lng: wing.position_lng, lat: wing.position_lat },
          startHeading,
          targetPos,
          getAirUnitStats(wing.aircraft_type).min_turn_radius_deg,
          getAirUnitStats(wing.aircraft_type).speed_deg_per_ms,
        );
        this.airDubinsPathfinder.storePath(wing.wing_id, path);
        wing.path_gen_id = path.path_gen_id;
        wing.path_elapsed_ms = 0;
        this.broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...path });
        this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
      }

      // Pending-transit loop: fire transit orders queued by auto-staging or RTB-queue
      // once the wing lands at its staging base and finishes refuelling (IDLE state).
      for (const wing of this.state.air_wings.values()) {
        if (wing.lifecycle_state !== WING_LIFECYCLE.IDLE) continue;

        // RTB-queued transit (pending_transit_lng/lat set by SUBMIT_AIR_WING_MOVE)
        if (wing.pending_transit_lng !== 0 || wing.pending_transit_lat !== 0) {
          const startPos = { lng: wing.position_lng, lat: wing.position_lat };
          const endPos   = { lng: wing.pending_transit_lng, lat: wing.pending_transit_lat };
          wing.pending_transit_lng = 0;
          wing.pending_transit_lat = 0;
          const startHeading = (Math.atan2(
            endPos.lng - startPos.lng,
            endPos.lat - startPos.lat,
          ) * 180 / Math.PI + 360) % 360;
          const path = this.airDubinsPathfinder.computeTransitPath(startPos, startHeading, endPos, getAirUnitStats(wing.aircraft_type).min_turn_radius_deg, getAirUnitStats(wing.aircraft_type).speed_deg_per_ms);
          this.airDubinsPathfinder.storePath(wing.wing_id, path);
          wing.path_gen_id = path.path_gen_id;
          wing.path_elapsed_ms = 0;
          wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
          this.broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...path });
          this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
          continue;
        }

        const pendingTransit = this.airWingLifecycleSystem
          .consumePendingTransitAfterRedeploy(wing.wing_id);
        if (!pendingTransit) continue;

        const startPos = { lng: wing.position_lng, lat: wing.position_lat };
        const endPos   = { lng: pendingTransit.lng, lat: pendingTransit.lat };
        const startHeading = (Math.atan2(
          endPos.lng - startPos.lng,
          endPos.lat - startPos.lat,
        ) * 180 / Math.PI + 360) % 360;
        const path = this.airDubinsPathfinder.computeTransitPath(startPos, startHeading, endPos, getAirUnitStats(wing.aircraft_type).min_turn_radius_deg, getAirUnitStats(wing.aircraft_type).speed_deg_per_ms);
        this.airDubinsPathfinder.storePath(wing.wing_id, path);
        wing.path_gen_id = path.path_gen_id;
        wing.path_elapsed_ms = 0;
        wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
        this.broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...path });
        this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
      }

      this.airBombingSystem.tick(
        this.state,
        this.airWingLifecycleSystem,
        this.combatSystem,
        (type, msg) => this.broadcast(type, msg),
        (type, msg, nationId) => this.broadcastToNation(type, msg, nationId),
      );

      this.airStrategicBombingSystem.tick(
        this.state,
        this.airWingLifecycleSystem,
        this.provinceAaSystem,
        (type, msg) => this.broadcast(type, msg),
        (type, msg, nationId) => this.broadcastToNation(type, msg, nationId),
      );

      this.airNavalBomberSystem.tick(
        this.state,
        this.airWingLifecycleSystem,
        (type, msg) => this.broadcast(type, msg),
        (type, msg, nationId) => this.broadcastToNation(type, msg, nationId),
      );

      const toUpdate = new Set([...activeBefore, ...combatChanged, ...supplyChanged]);
      this.broadcastFilteredDivisionUpdates(toUpdate);
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
      this.setGroupRelation(
        new Set(vote.actorAllianceAtStart),
        new Set(vote.targetAllianceAtStart),
        "neutral",
      );
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
      subprovince_id: div.subprovince_id,
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

  /**
   * Seed each nation's starting resources. Only money gets a nonzero starting stockpile —
   * TBD playtesting placeholder — so BUILD_BUILDING is testable standalone before Branch B's
   * resource-production ticks exist (without this, buildings would be permanently
   * unaffordable until Branch B merges).
   */
  private _initNationEconomy(): void {
    const STARTING_MONEY = 500; // TBD playtesting — starting stockpile placeholder
    for (const nation of this.state.nations.values()) {
      nation.resources.set("money", STARTING_MONEY);
    }
  }

  /** Populate state.provinces from map_data.json initial nation owners. */
  private _initProvinces(mapId: string): void {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const dataPath = join(__dir, "../..", "..", "client", "assets", "data", mapId, "map_data.json");
    try {
      const raw = getCachedFile<{
        provinces: Array<{
          province_id:     string;
          nation_id:       string;
          city_position?:  [number, number];
          population?:     number;
          industry?:       number;
          infrastructure?: number;
          buildings?:  Record<string, number>;
          resources?:  Record<string, number>;
        }>;
        adjacency?: Array<{ from_province: string; to_province: string }>;
      }>(dataPath);
      for (const p of raw.provinces ?? []) {
        if (!p.province_id) continue;
        const slot = new ProvinceState();
        slot.province_id = p.province_id;
        slot.owner_id    = p.nation_id ?? "";
        if (p.population     !== undefined) slot.population     = p.population;
        if (p.industry       !== undefined) slot.industry       = p.industry;
        if (p.infrastructure !== undefined) slot.infrastructure = p.infrastructure;
        this.state.provinces.set(p.province_id, slot);
        this.economyBuildingSystem.init(p.province_id, p.buildings ?? {}, p.resources ?? {});
        if (p.city_position && p.city_position.length >= 2) {
          this._provinceCityPositionLookup.set(p.province_id, {
            lng: p.city_position[0],
            lat: p.city_position[1],
          });
        }
      }
      this.state.provinceNeighbors = buildProvinceNeighbors(raw.adjacency ?? []);
      console.log(`[GameRoom] initialized ${this.state.provinces.size} provinces`);
    } catch {
      console.warn(`[GameRoom] could not load map_data.json for province init`);
    }
  }

  private _resolveTargetPosition(targetId: string): { lng: number; lat: number } | null {
    const targetWing = this.state.air_wings.get(targetId);
    if (targetWing) {
      return { lng: targetWing.position_lng, lat: targetWing.position_lat };
    }
    const targetDiv = this.state.divisions.get(targetId);
    if (targetDiv) {
      return { lng: targetDiv.position_lng, lat: targetDiv.position_lat };
    }
    const targetMarker = this.state.naval_contact_markers.get(targetId);
    if (targetMarker) {
      return { lng: targetMarker.position_lng, lat: targetMarker.position_lat };
    }
    return this._provinceCityPositionLookup.get(targetId) ?? null;
  }

  private _handleAirbaseCapture(msg: { province_id: string; new_owner_id: string }): void {
    for (const wing of this.state.air_wings.values()) {
      if (wing.home_airbase_province_id !== msg.province_id) continue;
      const stance = this.getRelationStance(wing.nation_id, msg.new_owner_id);
      const isFriendly = wing.nation_id === msg.new_owner_id || stance === "alliance";
      if (isFriendly) continue;
      const nearestId = this._findNearestFriendlyAirbase(wing, msg.province_id);
      if (nearestId) {
          this.airWingLifecycleSystem.startRedeploy(wing.wing_id, nearestId, this.state);
        this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
      } else {
        this.airWingLifecycleSystem.disbandWing(wing.wing_id, this.state,
          (type, payload) => this.broadcast(type, payload));
      }
    }
  }

  private _findNearestFriendlyAirbaseToPoint(
    wing: AirWingState,
    targetLng: number,
    targetLat: number,
  ): string | null {
    const maxRange = (1.0 - FUEL_RTB_THRESHOLD) / FUEL_DECAY_TRANSIT * getAirUnitStats(wing.aircraft_type).speed_deg_per_ms * 1000;
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const [pid, province] of this.state.provinces) {
      if (!province.owner_id) continue;
      const isOwn = province.owner_id === wing.nation_id;
      const isAllied = !isOwn &&
        this.getRelationStance(wing.nation_id, province.owner_id) === "alliance";
      if (!isOwn && !isAllied) continue;
      const pos = this._provinceCityPositionLookup.get(pid);
      if (!pos) continue;
      const dlng = targetLng - pos.lng;
      const dlat = targetLat - pos.lat;
      const distToTarget = Math.sqrt(dlng * dlng + dlat * dlat);
      if (distToTarget > maxRange) continue;
      if (distToTarget < bestDist) {
        bestDist = distToTarget;
        bestId = pid;
      }
    }
    return bestId;
  }

  private _findNearestFriendlyAirbase(wing: AirWingState, excludeProvinceId: string): string | null {
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const [pid, province] of this.state.provinces) {
      if (pid === excludeProvinceId) continue;
      if (!province.owner_id) continue;
      const isOwn = province.owner_id === wing.nation_id;
      const isAllied = !isOwn && this.getRelationStance(wing.nation_id, province.owner_id) === "alliance";
      if (!isOwn && !isAllied) continue;
      const pos = this._provinceCityPositionLookup.get(pid);
      if (!pos) continue;
      const dlng = pos.lng - wing.position_lng;
      const dlat = pos.lat - wing.position_lat;
      const dist = dlng * dlng + dlat * dlat;
      if (dist < bestDist) {
        bestDist = dist;
        bestId = pid;
      }
    }
    return bestId;
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
