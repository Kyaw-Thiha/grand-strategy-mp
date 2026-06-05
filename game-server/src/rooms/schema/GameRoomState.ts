import { Schema, MapSchema, type } from "@colyseus/schema";

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

// ── Phase 4+ skeletons ────────────────────────────────────────────────────────
// Empty maps for now. Populated when military/economy/diplomacy phases are built.

export class ProvinceState extends Schema {
  @type("string") province_id: string = "";
  @type("string") owner_id: string = "";
}

export class UnitState extends Schema {
  @type("string") unit_id: string = "";
  @type("string") owner_id: string = "";
  @type("string") province_id: string = "";
}

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

  @type({ map: PlayerState })  players   = new MapSchema<PlayerState>();
  @type({ map: NationState })  nations   = new MapSchema<NationState>();
  @type({ map: ProvinceState }) provinces = new MapSchema<ProvinceState>();
  @type({ map: UnitState })    units     = new MapSchema<UnitState>();
  @type({ map: RelationState }) relations = new MapSchema<RelationState>();
  @type({ map: ProposalState }) proposals = new MapSchema<ProposalState>();
}
