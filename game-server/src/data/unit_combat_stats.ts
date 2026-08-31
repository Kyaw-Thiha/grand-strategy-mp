import { UnitType } from "../types/tactical_types.js";

export interface UnitCombatStats {
  pen:           number;
  armour:        number;
  hp_floor_pct:  number;
  stealth_level: number;   // 0 = no stealth; combined with terrain perk bonus at runtime
  anti_stealth:  number;   // reveals enemy with effective_stealth <= this value
  // Branch B (RESOURCE_ECONOMY.md's Chromium section) — the premium tier within its unit
  // class. Below the national chromium threshold, chromium_gated=true types cannot be built
  // (Branch C, not yet implemented) and lose supply draw entirely (Phase 7, not yet
  // implemented). Defaults to false; only set true explicitly below.
  chromium_gated: boolean;
}

export const UNIT_COMBAT_STATS: Record<string, UnitCombatStats> = {
  [UnitType.INFANTRY]:           { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  [UnitType.ASSAULT_INF]:        { pen: 15, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  [UnitType.RECON_INF]:          { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 1, chromium_gated: false },
  [UnitType.MG]:                 { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  [UnitType.CAVALRY]:            { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  [UnitType.AT_INFANTRY]:        { pen: 40, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  [UnitType.SNIPER]:             { pen: 15, armour:  0, hp_floor_pct: 20, stealth_level: 2, anti_stealth: 0, chromium_gated: false },
  [UnitType.COMMANDO]:           { pen: 15, armour:  0, hp_floor_pct: 20, stealth_level: 2, anti_stealth: 0, chromium_gated: false },
  [UnitType.FLAMETHROWER]:       { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  [UnitType.ARMOURED_CAR]:       { pen: 25, armour: 15, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 2, chromium_gated: false },
  [UnitType.LIGHT_TANK]:         { pen: 45, armour: 30, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  [UnitType.MEDIUM_TANK]:        { pen: 65, armour: 50, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  [UnitType.HEAVY_TANK]:         { pen: 85, armour: 75, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0, chromium_gated: true },
  [UnitType.AT_GUN_SP]:          { pen: 75, armour: 25, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  [UnitType.AT_GUN]:             { pen: 70, armour:  0, hp_floor_pct:  0, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  [UnitType.AA_GUN]:             { pen: 20, armour:  0, hp_floor_pct:  0, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  [UnitType.ARTILLERY]:          { pen: 50, armour:  0, hp_floor_pct:  0, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  // New entries (unit types used in attack_patterns.ts/perks.ts but previously missing from enum)
  [UnitType.FORCE_RECON_SNIPER]: { pen: 15, armour:  0, hp_floor_pct: 20, stealth_level: 2, anti_stealth: 2, chromium_gated: false },
  [UnitType.HOWITZER]:           { pen: 55, armour:  0, hp_floor_pct:  0, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  [UnitType.SELF_PROPELLED_GUN]: { pen: 50, armour: 10, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  // Branch C (Phase 9 Task C) — added alongside RAISE_DIVISION/production support.
  // Motorised infantry: leg/mounted incapacitation bucket (Barracks-produced, same profile
  // shape as INFANTRY), but oil/rubber-consuming per RESOURCE_ECONOMY.md's Oil section.
  [UnitType.MOTORISED_INF]:  { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
  // Mechanised infantry: vehicle incapacitation bucket (Tank Plant-produced per
  // TACTICAL_COMBAT.md/ECONOMY_BUILDINGS.md — "belongs here despite its name"), lightly
  // armoured halftrack-class.
  [UnitType.MECHANISED_INF]: { pen: 15, armour: 10, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0, chromium_gated: false },
};
