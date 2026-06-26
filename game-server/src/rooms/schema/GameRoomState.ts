import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") userId: string = "";
  @type("string") steamId: string = "";
  @type("boolean") hasHostPass: boolean = false;
}

export class NationState extends Schema {
  @type("string") nation_id: string = "";
  @type("string") player_id: string = "";
  @type("boolean") is_ready: boolean = false;
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
  @type("string") movement_profile_json: string = "{}"; // 33-value terrain cost table
  @type(["string"]) move_order = new ArraySchema<string>(); // ordered waypoint IDs
  @type(["string"]) reposition_order = new ArraySchema<string>(); // in-combat reposition path
  @type("string") stack_id: string = "";
  @type("number") stack_position: number = 0;   // 0 = front of stack
  @type("string") attacker_role: string = "";   // "attacker"|"defender"|"meeting"|""
  @type(["string"]) engaged_with = new ArraySchema<string>(); // division IDs
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
