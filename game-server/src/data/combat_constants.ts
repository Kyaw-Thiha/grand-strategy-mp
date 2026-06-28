// Values must stay in sync with TACTICAL_COMBAT.md (Open Questions section).
// Both combat_system.ts and attack_patterns.ts import from here to avoid circular imports.
export const BASE_ATTRITION       = 2.5;
export const HP_DAMAGE_FRACTION   = 0.3;
export const SUPPRESSION_FRACTION = 0.7;
export const SIDE_ARMOUR_MULT           = 0.5;   // armour effectiveness when hit from column shift
export const TACTICAL_FLANK_BONUS       = 1.25;  // HP damage bonus for armour 1-col shift
export const TACTICAL_ENVELOPMENT_BONUS = 1.5;   // HP damage bonus for armour 2-col shift
