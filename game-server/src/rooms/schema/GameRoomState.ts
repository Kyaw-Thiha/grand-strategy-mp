import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";

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
}

export class ProvinceState extends Schema {
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
  @type({ map: DivisionState }) divisions = new MapSchema<DivisionState>();
  @type({ map: RelationState }) relations = new MapSchema<RelationState>();
  @type({ map: ProposalState }) proposals = new MapSchema<ProposalState>();
}
