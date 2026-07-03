import { Schema, MapSchema, type } from "@colyseus/schema";

// ── Air unit type identifiers ─────────────────────────────────────────────────

export const AIR_UNIT_TYPES = {
  CAS_PLANE:          "cas_plane",
  DIVE_BOMBER:        "dive_bomber",
  FIGHTER:            "fighter",
  NAVAL_BOMBER:       "naval_bomber",
  HEAVY_FIGHTER:      "heavy_fighter",
  STRATEGIC_BOMBER:   "strategic_bomber",
  TACTICAL_BOMBER:    "tactical_bomber",
  RECON_PLANE:        "recon_plane",
} as const;
export type AirUnitType = typeof AIR_UNIT_TYPES[keyof typeof AIR_UNIT_TYPES];

// ── Mission identifiers ───────────────────────────────────────────────────────

export const MISSION_TYPES = {
  TACTICAL_BOMBING:    "tactical_bombing",
  INTERCEPTION:        "interception",
  AIR_SUPERIORITY:     "air_superiority",
  ESCORT:              "escort",
  LOGISTICS:           "logistics",
  AREA:                "area",
  INDUSTRY:            "industry",
  OIL:                 "oil",
  RECON:               "recon",
  TRADE_INTERDICTION:  "trade_interdiction",
  ANTI_SUBMARINE:      "anti_submarine",
  ANTI_SHIP:           "anti_ship",
} as const;
export type MissionType = typeof MISSION_TYPES[keyof typeof MISSION_TYPES];

// ── Wing lifecycle states ─────────────────────────────────────────────────────

export enum WING_LIFECYCLE {
  IDLE    = "idle",
  TRANSIT = "transit",
  ENGAGED = "engaged",
  LOITER  = "loiter",
  RTB     = "rtb",
  REFUEL  = "refuel",
}

// ── Wing template (aircraft_type + count; no internal grid) ──────────────────

export class AirWingTemplate extends Schema {
  @type("string") aircraft_type: string = AIR_UNIT_TYPES.FIGHTER;
  @type("number") count: number = 10;
}

// ── Core wing state synced to all clients ─────────────────────────────────────

export class AirWingState extends Schema {
  @type("string") wing_id: string = "";
  @type("string") nation_id: string = "";
  @type("string") aircraft_type: string = AIR_UNIT_TYPES.FIGHTER;

  // HP pool — count of operational aircraft in the wing
  @type("number") count: number = 10;

  // 0.0–1.0; decays airborne, recovers at home base
  @type("number") combat_readiness: number = 1.0;

  // Real-time geographic position (lng/lat in decimal degrees)
  @type("number") position_lng: number = 0;
  @type("number") position_lat: number = 0;

  // Current heading in degrees (0 = north, clockwise)
  @type("number") heading_deg: number = 0;

  // Lifecycle and mission state
  @type("string") lifecycle_state: string = WING_LIFECYCLE.IDLE;
  @type("string") mission: string = MISSION_TYPES.INTERCEPTION;

  // Target wing or province ID for the current mission (empty = no target)
  @type("string") target_id: string = "";

  // Home airbase — references an existing ProvinceState province_id
  @type("string") home_airbase_province_id: string = "";

  // Server-authoritative path tracking for client interpolation
  @type("string") path_gen_id: string = "";   // UUID; changes on each new path
  @type("number") path_elapsed_ms: number = 0; // ms elapsed along current path

  // Weapon reload state
  @type("boolean") weapon_ready: boolean = true;

  // Research perk flags (set via SET_WING_PERK; no research tree yet — Phase 11)
  @type("boolean") perk_multi_sortie: boolean = false;
  @type("boolean") perk_strafing: boolean = false;
  @type("boolean") perk_extended_range: boolean = false;
  @type("boolean") perk_precision_bombing: boolean = false;
}

// ── Event payload interfaces (emitted via room broadcast) ─────────────────────

export interface AirCombatStartedEvent {
  type: "AIR_COMBAT_STARTED";
  attacker_wing_id: string;
  defender_wing_id: string;
  position_lng: number;
  position_lat: number;
}

export interface AirSuperiorityLostEvent {
  type: "AIR_SUPERIORITY_LOST";
  nation_id: string;
  province_id: string;
}

export interface AirWingDrivenOffEvent {
  type: "AIR_WING_DRIVEN_OFF";
  wing_id: string;
  nation_id: string;
}

export interface WingRtbEvent {
  type: "WING_RTB";
  wing_id: string;
  nation_id: string;
  reason: "low_readiness" | "mission_complete" | "driven_off";
}

export interface WingDestroyedEvent {
  type: "WING_DESTROYED";
  wing_id: string;
  nation_id: string;
  destroyed_by_wing_id: string;
}

export type AirWingEvent =
  | AirCombatStartedEvent
  | AirSuperiorityLostEvent
  | AirWingDrivenOffEvent
  | WingRtbEvent
  | WingDestroyedEvent;

// ── MapSchema type alias used by GameRoomState ────────────────────────────────

export type AirWingsMap = MapSchema<AirWingState>;
