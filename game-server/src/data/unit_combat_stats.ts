import { UnitType } from "../types/tactical_types.js";

export interface UnitCombatStats {
  pen:           number;
  armour:        number;
  hp_floor_pct:  number;
  stealth_level: number;   // 0 = no stealth; combined with terrain perk bonus at runtime
  anti_stealth:  number;   // reveals enemy with effective_stealth <= this value
}

export const UNIT_COMBAT_STATS: Record<string, UnitCombatStats> = {
  [UnitType.INFANTRY]:           { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0 },
  [UnitType.ASSAULT_INF]:        { pen: 15, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0 },
  [UnitType.RECON_INF]:          { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 1 },
  [UnitType.MG]:                 { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0 },
  [UnitType.CAVALRY]:            { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0 },
  [UnitType.AT_INFANTRY]:        { pen: 40, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0 },
  [UnitType.SNIPER]:             { pen: 15, armour:  0, hp_floor_pct: 20, stealth_level: 2, anti_stealth: 0 },
  [UnitType.COMMANDO]:           { pen: 15, armour:  0, hp_floor_pct: 20, stealth_level: 2, anti_stealth: 0 },
  [UnitType.FLAMETHROWER]:       { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0 },
  [UnitType.ARMOURED_CAR]:       { pen: 25, armour: 15, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 2 },
  [UnitType.LIGHT_TANK]:         { pen: 45, armour: 30, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0 },
  [UnitType.MEDIUM_TANK]:        { pen: 65, armour: 50, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0 },
  [UnitType.HEAVY_TANK]:         { pen: 85, armour: 75, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0 },
  [UnitType.AT_GUN_SP]:          { pen: 75, armour: 25, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0 },
  [UnitType.AT_GUN]:             { pen: 70, armour:  0, hp_floor_pct:  0, stealth_level: 0, anti_stealth: 0 },
  [UnitType.AA_GUN]:             { pen: 20, armour:  0, hp_floor_pct:  0, stealth_level: 0, anti_stealth: 0 },
  [UnitType.ARTILLERY]:          { pen: 50, armour:  0, hp_floor_pct:  0, stealth_level: 0, anti_stealth: 0 },
  // New entries (unit types used in attack_patterns.ts/perks.ts but previously missing from enum)
  [UnitType.FORCE_RECON_SNIPER]: { pen: 15, armour:  0, hp_floor_pct: 20, stealth_level: 2, anti_stealth: 2 },
  [UnitType.HOWITZER]:           { pen: 55, armour:  0, hp_floor_pct:  0, stealth_level: 0, anti_stealth: 0 },
  [UnitType.SELF_PROPELLED_GUN]: { pen: 50, armour: 10, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0 },
};
