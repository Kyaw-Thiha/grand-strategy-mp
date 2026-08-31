import { UnitType } from "../types/tactical_types.js";
import { AIR_UNIT_TYPES } from "../rooms/schema/AirWingState.js";

export interface UnitProductionStats {
  build_points: number; // TBD playtesting — placeholder curve, higher tier = higher cost
  produced_by: string;
}

export const PRODUCTION_BUILDING_TYPES: string[] = [
  "barracks", "tank_plant", "ordnance_factory", "aircraft_factory",
];

// Land unit types. motorised_infantry/mechanised_infantry were added to UnitType in this same
// branch (Phase 9 Task C) specifically to fill this table's gap — see tactical_types.ts.
export const UNIT_PRODUCTION_STATS: Record<string, UnitProductionStats> = {
  // Barracks — infantry/leg-type roster (TACTICAL_COMBAT.md's "leg/mounted" incapacitation bucket).
  [UnitType.INFANTRY]:           { build_points: 30, produced_by: "barracks" },
  [UnitType.ASSAULT_INF]:        { build_points: 35, produced_by: "barracks" },
  [UnitType.RECON_INF]:          { build_points: 30, produced_by: "barracks" },
  [UnitType.MG]:                 { build_points: 25, produced_by: "barracks" },
  [UnitType.CAVALRY]:            { build_points: 30, produced_by: "barracks" },
  [UnitType.AT_INFANTRY]:        { build_points: 35, produced_by: "barracks" },
  [UnitType.SNIPER]:             { build_points: 40, produced_by: "barracks" },
  [UnitType.COMMANDO]:           { build_points: 45, produced_by: "barracks" },
  [UnitType.FLAMETHROWER]:       { build_points: 35, produced_by: "barracks" },
  [UnitType.FORCE_RECON_SNIPER]: { build_points: 45, produced_by: "barracks" },
  [UnitType.MOTORISED_INF]:      { build_points: 40, produced_by: "barracks" },

  // Tank Plant — vehicle-chassis roster (TACTICAL_COMBAT.md's "vehicle" incapacitation bucket).
  // mechanised_infantry belongs here despite its name — gated behind the armour research branch
  // (post-medium-tank tier) per TACTICAL_COMBAT.md, not the infantry branch.
  [UnitType.ARMOURED_CAR]:       { build_points: 50,  produced_by: "tank_plant" },
  [UnitType.LIGHT_TANK]:         { build_points: 60,  produced_by: "tank_plant" },
  [UnitType.MEDIUM_TANK]:        { build_points: 90,  produced_by: "tank_plant" },
  [UnitType.HEAVY_TANK]:         { build_points: 140, produced_by: "tank_plant" },
  [UnitType.AT_GUN_SP]:          { build_points: 100, produced_by: "tank_plant" },
  [UnitType.SELF_PROPELLED_GUN]: { build_points: 110, produced_by: "tank_plant" },
  [UnitType.MECHANISED_INF]:     { build_points: 70,  produced_by: "tank_plant" },

  // Ordnance Factory — crew-served, towed roster (TACTICAL_COMBAT.md's "no incapacitation" bucket).
  [UnitType.ARTILLERY]: { build_points: 70, produced_by: "ordnance_factory" },
  [UnitType.AT_GUN]:    { build_points: 50, produced_by: "ordnance_factory" },
  [UnitType.AA_GUN]:    { build_points: 55, produced_by: "ordnance_factory" },
  [UnitType.HOWITZER]:  { build_points: 80, produced_by: "ordnance_factory" },

  // Aircraft Factory — reuses Phase 12's AIR_UNIT_TYPES verbatim, no second list.
  [AIR_UNIT_TYPES.CAS_PLANE]:        { build_points: 90,  produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.DIVE_BOMBER]:      { build_points: 100, produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.FIGHTER]:          { build_points: 110, produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.NAVAL_BOMBER]:     { build_points: 120, produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.HEAVY_FIGHTER]:    { build_points: 130, produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.STRATEGIC_BOMBER]: { build_points: 180, produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.TACTICAL_BOMBER]:  { build_points: 140, produced_by: "aircraft_factory" },
  [AIR_UNIT_TYPES.RECON_PLANE]:      { build_points: 80,  produced_by: "aircraft_factory" },
};

export function getUnitProductionStats(unitType: string): UnitProductionStats {
  const stats = UNIT_PRODUCTION_STATS[unitType];
  if (!stats) throw new Error(`Unknown unit type for production: ${unitType}`);
  return stats;
}
