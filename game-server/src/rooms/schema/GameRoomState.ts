import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import { AirWingState } from "./AirWingState.js";
import { NavalContactMarkerState } from "./NavalContactMarkerState.js";

export class GridCellState extends Schema {
  @type("string")  unit_type: string      = "";
  @type("number")  hp: number             = 100;
  @type("number")  suppression: number    = 0;
  @type("string")  xp_tier: string        = "green";
  @type("number")  xp_points: number      = 0;
  @type("number")  xp_pending: number     = 0;
  @type("boolean") incapacitated: boolean = false;
  @type("boolean") stealthed: boolean     = false;
}

export class DivisionGridState extends Schema {
  @type([GridCellState]) cells = new ArraySchema<GridCellState>(
    ...Array.from({ length: 25 }, () => new GridCellState())
  );
}

export class PlayerState extends Schema {
  @type("string") userId: string = "";
  @type("string") steamId: string = "";
  @type("boolean") hasHostPass: boolean = false;
}

export class NationState extends Schema {
  @type("string")   nation_id: string  = "";
  @type("string")   player_id: string  = "";
  @type("boolean")  is_ready: boolean  = false;
  @type(["string"]) researched_perks   = new ArraySchema<string>();
  // Ten-resource national stockpile (money, grain, iron, oil, rubber, nitrates, tungsten,
  // chromium, aluminium, uranium) — see ECONOMY_BUILDINGS.md / RESOURCE_ECONOMY.md.
  @type({ map: "number" }) resources = new MapSchema<number>();
  @type("number") manpower_available: number = 0;
  @type("number") manpower_ceiling:   number = 0;
  // Keyed by unit_type — populated by Branch C (Unit Production/Reserve).
  @type({ map: "number" }) reserve_pool = new MapSchema<number>();
  // Keyed by resource type + "construction_speed" + "unit_production_speed" — populated by
  // Branch B (Industry Pool allocation).
  @type({ map: "number" }) industry_alloc = new MapSchema<number>();
}

export class ProvinceState extends Schema {
  @type("string") province_id: string = "";
  @type("string") owner_id: string = "";
  @type("number") industry:            number = 50;
  @type("number") population:          number = 50;
  @type("number") infrastructure:      number = 50;
  @type("number") oil_bombed_until_ms: number = 0;
  @type("number") naval_base_level: number = 0;
  /** Player-built supply hub, separate from the static, map-authored is_supply_hub provinces
   *  SubprovinceSystem loads at room start. */
  @type("boolean") has_supply_hub: boolean = false;
  /** Reserved for future upgrade tiers — no gameplay effect yet. */
  @type("number") supply_hub_level: number = 0;
  /** 0 = not under construction; otherwise a server clock timestamp (Date.now()-based, same
   *  pattern as oil_bombed_until_ms) at which construction completes. */
  @type("number") supply_hub_construction_ends_at_ms: number = 0;
}

export class SubprovinceState extends Schema {
  @type("string") province_id: string = "";
  @type("string") owner_id: string = "";
}

// ── Phase 4: Division (replaces skeleton UnitState) ───────────────────────────

export class DivisionState extends Schema {
  @type("string") division_id: string = "";
  @type("string") nation_id: string = "";
  @type("string") division_type: string = "infantry"; // "armoured"|"motorised"|"infantry"
  @type("number") position_lng: number = 0;
  @type("number") position_lat: number = 0;
  @type("number") hp: number = 100;             // 0–100
  @type("number") suppression: number = 0;      // 0–100
  @type("string") combat_state: string = "idle"; // "idle"|"engaged"|"suppressed"|"retreating"|"destroyed"
  @type("string") supply_status: string = "normal"; // "normal"|"out_of_supply"|"cut_off"|"encircled"
  // Batch 8 Task 3: per-division speed penalty for a Tier 2 (cut_off) fighting-withdrawal
  // retreat. 1 = no penalty (default/normal movement). Reset to 1 once the retreat completes
  // (combat_system.ts's _checkRetreatCompletion). Applied only to the division's own movement
  // (movement_system.ts's _advanceDivision/_advanceFinalPosition), never to in-combat
  // repositioning (_advanceReposition).
  @type("number") retreat_speed_mult: number = 1;
  @type("number") observation_radius: number = 100; // km
  @type("number") engagement_radius: number = 50;   // km, computed from template
  @type("number") recon_value: number = 0;    // 0.0–1.0; accumulated per engagement round
  @type("string") movement_profile_json: string = "{}"; // 33-value terrain cost table
  @type(["string"]) move_order = new ArraySchema<string>(); // ordered waypoint IDs
  @type(["string"]) reposition_order = new ArraySchema<string>(); // in-combat reposition path
  @type("string") stack_id: string = "";
  @type("number") stack_position: number = 0;   // 0 = front of stack
  @type("string") attacker_role: string = "";   // "attacker"|"defender"|"meeting"|""
  @type(["string"]) engaged_with = new ArraySchema<string>(); // division IDs
  @type(["string"]) consumed_waypoint_ids: string[] = []; // waypoints consumed on this tick
  @type("number") final_position_lng: number = -999; // exact click target (-999 = none)
  @type("number") final_position_lat: number = -999;
  @type("string")          template_id: string = "";
  @type("string") subprovince_id: string = ""; // resolved each tick by SubprovinceSystem.checkCaptureAfterMovement
  grid: DivisionGridState = new DivisionGridState(); // server-side only — not schema-synced
}

// ─────────────────────────────────────────────────────────────────────────────

export class RelationState extends Schema {
  @type("string") from_id: string = "";
  @type("string") to_id: string = "";
  @type("string") stance: string = "neutral";
}

export class ProposalState extends Schema {
  @type("string") proposal_id: string = "";
  @type("string") from_id: string = "";
  @type("string") to_id: string = "";
  @type("string") stance: string = "";
  @type("boolean") resolved: boolean = false;
}

// ─────────────────────────────────────────────────────────────────────────────

export class GameRoomState extends Schema {
  @type("string") phase: string = "lobby";
  @type("string") map_id: string = "western_europe_6";
  @type("number") game_speed: number = 1;

  @type({ map: PlayerState })   players   = new MapSchema<PlayerState>();
  @type({ map: NationState })   nations   = new MapSchema<NationState>();
  @type({ map: ProvinceState }) provinces = new MapSchema<ProvinceState>();
  @type({ map: SubprovinceState }) subprovinces = new MapSchema<SubprovinceState>();
  @type({ map: DivisionState }) divisions = new MapSchema<DivisionState>();
  @type({ map: RelationState }) relations  = new MapSchema<RelationState>();
  @type({ map: ProposalState }) proposals  = new MapSchema<ProposalState>();
  @type({ map: AirWingState })  air_wings  = new MapSchema<AirWingState>();
  @type({ map: NavalContactMarkerState })
  naval_contact_markers = new MapSchema<NavalContactMarkerState>();

  // Province-to-province adjacency, parsed once from map_data.json at room init.
  // Server-side only — not schema-synced, mirrors DivisionState.grid's pattern above.
  provinceNeighbors: Map<string, string[]> = new Map();
}
