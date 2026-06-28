export const UnitType = {
  INFANTRY:        "infantry",
  ASSAULT_INF:     "assault_infantry",
  RECON_INF:       "recon_infantry",
  MG:              "mg",
  CAVALRY:         "cavalry",
  LIGHT_TANK:      "light_tank",
  MEDIUM_TANK:     "medium_tank",
  HEAVY_TANK:      "heavy_tank",
  ARMOURED_CAR:    "armoured_car",
  AT_INFANTRY:     "at_infantry",
  AT_GUN:          "at_gun",
  AT_GUN_SP:       "at_gun_sp",
  AA_GUN:          "aa_gun",
  SNIPER:          "sniper",
  FLAMETHROWER:    "flamethrower",
  ARTILLERY:       "artillery",
  COMMANDO:        "commando",
  EMPTY:              "",
  FORCE_RECON_SNIPER: "force_recon_sniper",
  HOWITZER:           "howitzer",
  SELF_PROPELLED_GUN: "self_propelled_gun",
} as const;

export type UnitTypeValue = typeof UnitType[keyof typeof UnitType];

export const XpTier = {
  GREEN:    "green",
  SEASONED: "seasoned",
  VETERAN:  "veteran",
  ELITE:    "elite",
} as const;

export type XpTierValue = typeof XpTier[keyof typeof XpTier];

// ── Event payload interfaces ───────────────────────────────────────────────

export interface RoundResolvedPayload {
  engagement_id: string;
  round_number: number;
  lethality_phase: "contact" | "firefight" | "intense" | "decisive" | "annihilation";
  attacker_grid_delta: GridCellDelta[];
  defender_grid_delta: GridCellDelta[];
  formation_bonuses_active: FormationBonusActive[];
  xp_changes: XpChangeEntry[];
}

export interface GridCellDelta {
  cell_index: number;   // 0–24; row*5+col where row 0=R1(back), row 4=R5(vanguard/front)
  hp?: number;
  suppression?: number;
  xp_tier?: XpTierValue;
  incapacitated?: boolean;
  stealthed?: boolean;
  unit_type?: UnitTypeValue;
}

export interface FormationBonusActive {
  cell_a: number;
  cell_b: number;
  bonus_type: "at_mg" | "sniper_recon" | "flm_assault" | "mg_mg" | "arty_recon";
}

export interface XpChangeEntry {
  division_id: string;
  cell_index: number;
  xp_before: XpTierValue;
  xp_after: XpTierValue;
}

export interface UnitIncapacitatedPayload {
  engagement_id: string;
  division_id: string;
  cell_index: number;
  unit_type: UnitTypeValue;
  xp_retained: number;
}

export interface UnitRecoveredPayload {
  engagement_id: string;
  division_id: string;
  cell_index: number;
}

export interface UnitExperienceGainedPayload {
  engagement_id: string;
  division_id: string;
  cell_index: number;
  new_tier: XpTierValue;
}

export interface UnitEliteReachedPayload {
  engagement_id: string;
  division_id: string;
  cell_index: number;
}

export interface TacticalBreakthroughPayload {
  engagement_id: string;
  division_id: string;
}
