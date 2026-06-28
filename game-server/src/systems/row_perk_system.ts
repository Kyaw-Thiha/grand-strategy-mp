/**
 * Row-positional combat perks.
 * Applied each round based on the logical row (Math.floor(cell_index / 5))
 * of attacker and defender cells.
 *
 * Row layout (logical_row):
 *   0 = REAR (cells 0–4)    — no bonus
 *   1 = RESERVE (5–9)       — faster suppression decay
 *   2 = SUPPORT (10–14)     — suppression resistance (defender)
 *   3 = ASSAULT (15–19)     — +HP damage dealt (attacker)
 *   4 = VANGUARD (20–24)    — +suppression dealt (attacker)
 */

export interface RowPerkModifiers {
  /** Multiplier on suppression output (attacker benefit). */
  supp_dealt_mult: number;
  /** Multiplier on HP damage output (attacker benefit). */
  hp_dealt_mult: number;
  /** Multiplier on incoming suppression (< 1 = defender receives less). */
  supp_resist_mult: number;
  /** Multiplier on per-round suppression decay rate (> 1 = decays faster). */
  supp_decay_mult: number;
}

export const ROW_PERK_SUPP_DEALT_MULT = 1.25;  // VANGUARD
export const ROW_PERK_HP_DEALT_MULT   = 1.20;  // ASSAULT
export const ROW_PERK_SUPP_RESIST     = 0.80;  // SUPPORT (defender: receive 20% less)
export const ROW_PERK_DECAY_MULT      = 1.50;  // RESERVE (decay 50% faster)

const IDENTITY: RowPerkModifiers = {
  supp_dealt_mult:  1.0,
  hp_dealt_mult:    1.0,
  supp_resist_mult: 1.0,
  supp_decay_mult:  1.0,
};

/**
 * Returns the row perk modifiers for a unit at the given logical_row.
 * logical_row = Math.floor(cell_index / 5)
 * Out-of-range rows return identity (no effect).
 */
export function getRowPerkModifiers(logical_row: number): RowPerkModifiers {
  switch (logical_row) {
    case 4: return { ...IDENTITY, supp_dealt_mult:  ROW_PERK_SUPP_DEALT_MULT };
    case 3: return { ...IDENTITY, hp_dealt_mult:    ROW_PERK_HP_DEALT_MULT   };
    case 2: return { ...IDENTITY, supp_resist_mult: ROW_PERK_SUPP_RESIST     };
    case 1: return { ...IDENTITY, supp_decay_mult:  ROW_PERK_DECAY_MULT      };
    default: return { ...IDENTITY };
  }
}
