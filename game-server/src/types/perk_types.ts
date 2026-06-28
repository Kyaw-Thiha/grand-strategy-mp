export interface PerkModifiers {
  damage_mult: number;
  suppression_mult: number;
  suppression_resist_mult: number;
  movement_mult: number;
  observation_mult: number;
  recon_mult: number;
}

export const IDENTITY_MODIFIERS: PerkModifiers = {
  damage_mult: 1.0,
  suppression_mult: 1.0,
  suppression_resist_mult: 1.0,
  movement_mult: 1.0,
  observation_mult: 1.0,
  recon_mult: 1.0,
};

export type PerkScope = "unit_type" | "global" | "formation_synergy";

export interface PerkDefinition {
  perk_id:         string;
  scope:           PerkScope;
  applies_to_unit?: string;
  synergy_units?:  [string, string];
  modifiers:       Partial<PerkModifiers>;
  // Structural attack overrides (sniper/arty only). NEVER include recon_value or rng_seed here.
  attack_config?:  Partial<Pick<SpecialAttackConfig, "priority_list" | "n_targets" | "area_radius" | "falloff_per_col">>;
}

export interface SpecialAttackConfig {
  // ── perk-driven fields (set by resolveAttackConfig) ──
  priority_list:    string[];  // sniper target priority — ordered unit_type list
  n_targets:        number;    // sniper: how many priority targets to select
  area_radius:      number;    // arty: ±cols from center (0=single col, 1=3-wide, 2=5-wide)
  falloff_per_col:  number;    // arty: damage_mult reduction per col from center
  // ── runtime fields (set by caller before passing to getTargetCells) ──
  recon_value:      number;    // arty: normalized 0.0–1.0 from DivisionState.recon_value
  rng_seed:         number;    // arty: deterministic RNG seed; never in PerkDefinition
}

export const DEFAULT_SNIPER_CONFIG: Readonly<SpecialAttackConfig> = {
  priority_list:   ["sniper","force_recon_sniper","flamethrower","recon_infantry","mg","at_gun","at_gun_sp","at_infantry","commando","infantry"],
  n_targets:        1,
  area_radius:      0,
  falloff_per_col:  0.0,
  recon_value:      0.0,
  rng_seed:         0,
};

export const DEFAULT_ARTILLERY_CONFIG: Readonly<SpecialAttackConfig> = {
  priority_list:    [],
  n_targets:        1,
  area_radius:      0,
  falloff_per_col:  0.3,
  recon_value:      0.0,
  rng_seed:         0,
};
