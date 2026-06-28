// Values must stay in sync with TACTICAL_COMBAT.md (Open Questions section).
// Both combat_system.ts and attack_patterns.ts import from here to avoid circular imports.
export const BASE_ATTRITION       = 2.5;
export const HP_DAMAGE_FRACTION   = 0.3;
export const SUPPRESSION_FRACTION = 0.7;
export const SIDE_ARMOUR_MULT           = 0.5;   // armour effectiveness when hit from column shift
export const TACTICAL_FLANK_BONUS       = 1.25;  // HP damage bonus for armour 1-col shift
export const TACTICAL_ENVELOPMENT_BONUS = 1.5;   // HP damage bonus for armour 2-col shift

export const RECON_MAX            = 1.0;   // recon_value is capped at this
export const RECON_BASE_PER_ROUND = 0.02;  // every engagement side gains this baseline per round

// Per-round recon contribution per living cell of this unit_type (0 = no contribution).
// Baseline (RECON_BASE_PER_ROUND) is added separately in combat_system.ts.
export const RECON_CONTRIB_RATES: Record<string, number> = {
  recon_infantry: 0.12,
  armoured_car:   0.06,
};

// Unit type value used for artillery column weighting.
// At high recon, columns with high-value units are targeted preferentially.
export const ARTY_UNIT_VALUE: Record<string, number> = {
  sniper:            5,
  force_recon_sniper:5,
  flamethrower:      4,
  heavy_tank:        5,
  medium_tank:       4,
  light_tank:        3,
  armoured_car:      3,
  mg:                3,
  at_gun:            3,
  at_gun_sp:         3,
  at_infantry:       2,
  howitzer:          3,
  self_propelled_gun:3,
};
