/**
 * Formation Rule System.
 *
 * Detects positional relationships between units on a 5×5 division grid
 * and returns per-cell stat modifier maps. Ships with no active rules;
 * concrete rules are added later via perk research.
 *
 * Grid layout:
 *   logical_row = Math.floor(cell_index / 5)
 *   col         = cell_index % 5
 *   Row 0 = REAR (cells 0–4), Row 4 = VANGUARD (cells 20–24)
 */

// ── Public types ─────────────────────────────────────────────────────────────

export type ProximitySpec =
  | { type: "adjacent" }
  | { type: "same_row" }
  | { type: "same_col" }
  | { type: "distance"; max: number }
  | { type: "self_in_row"; row: number };

export interface FormationBonusModifiers {
  hp_dealt_mult:    number;
  supp_dealt_mult:  number;
  supp_resist_mult: number;
  supp_decay_mult:  number;
}

export interface FormationRule {
  id: string;
  unitA: string | string[];
  unitB: string | string[];
  proximity: ProximitySpec;
  bonusForA: Partial<FormationBonusModifiers>;
  bonusForB?: Partial<FormationBonusModifiers>;
}

export interface FormationCellInput {
  unit_type:     string;
  incapacitated: boolean;
}

// ── Identity constant (exported for combat_system default) ───────────────────

export const IDENTITY_FORMATION_BONUS: FormationBonusModifiers = {
  hp_dealt_mult:    1.0,
  supp_dealt_mult:  1.0,
  supp_resist_mult: 1.0,
  supp_decay_mult:  1.0,
};

// ── Internal helpers ─────────────────────────────────────────────────────────

function _row(idx: number): number { return Math.floor(idx / 5); }
function _col(idx: number): number { return idx % 5; }

function _chebyshev(idxA: number, idxB: number): number {
  return Math.max(Math.abs(_row(idxA) - _row(idxB)), Math.abs(_col(idxA) - _col(idxB)));
}

function _matchesUnit(unit_type: string, pattern: string | string[]): boolean {
  if (Array.isArray(pattern)) return pattern.includes(unit_type);
  return unit_type === pattern;
}

function _matchesProximity(idxA: number, idxB: number, spec: ProximitySpec): boolean {
  if (idxA === idxB) return false;
  switch (spec.type) {
    case "adjacent":     return _chebyshev(idxA, idxB) === 1;
    case "same_row":     return _row(idxA) === _row(idxB);
    case "same_col":     return _col(idxA) === _col(idxB);
    case "distance":     return _chebyshev(idxA, idxB) <= spec.max;
    case "self_in_row":  return false;
  }
}

function _mergeBonus(
  existing: FormationBonusModifiers,
  bonus: Partial<FormationBonusModifiers>,
): FormationBonusModifiers {
  return {
    hp_dealt_mult:    existing.hp_dealt_mult    * (bonus.hp_dealt_mult    ?? 1.0),
    supp_dealt_mult:  existing.supp_dealt_mult  * (bonus.supp_dealt_mult  ?? 1.0),
    supp_resist_mult: existing.supp_resist_mult * (bonus.supp_resist_mult ?? 1.0),
    supp_decay_mult:  existing.supp_decay_mult  * (bonus.supp_decay_mult  ?? 1.0),
  };
}

function _applyBonus(
  bonusMap: Map<number, FormationBonusModifiers>,
  cellIdx: number,
  bonus: Partial<FormationBonusModifiers>,
): void {
  const existing = bonusMap.get(cellIdx) ?? { ...IDENTITY_FORMATION_BONUS };
  bonusMap.set(cellIdx, _mergeBonus(existing, bonus));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the list of currently-active formation rules.
 * Starts empty — rules are added via perk research in future branches.
 * The researchedPerks parameter is accepted now for forward-compatibility.
 */
export function getActiveFormationRules(_researchedPerks?: string[]): FormationRule[] {
  return [];
}

/**
 * Evaluates all active formation rules against a division's cell grid.
 * Returns a Map of cell_index → combined FormationBonusModifiers.
 * Cells not in the Map receive IDENTITY_FORMATION_BONUS (no effect).
 * Incapacitated cells are excluded from matching.
 */
export function evaluateFormationRules(
  cells: FormationCellInput[],
  activeRules: FormationRule[],
): Map<number, FormationBonusModifiers> {
  const bonusMap = new Map<number, FormationBonusModifiers>();
  if (activeRules.length === 0) return bonusMap;

  for (const rule of activeRules) {
    if (rule.proximity.type === "self_in_row") {
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (cell.unit_type === "" || cell.incapacitated) continue;
        if (_row(i) === rule.proximity.row && _matchesUnit(cell.unit_type, rule.unitA)) {
          _applyBonus(bonusMap, i, rule.bonusForA);
        }
      }
      continue;
    }

    const appliedA = new Set<number>();
    const appliedB = new Set<number>();

    for (let idxA = 0; idxA < cells.length; idxA++) {
      const cellA = cells[idxA];
      if (cellA.unit_type === "" || cellA.incapacitated) continue;
      if (!_matchesUnit(cellA.unit_type, rule.unitA)) continue;

      for (let idxB = 0; idxB < cells.length; idxB++) {
        if (idxA === idxB) continue;
        const cellB = cells[idxB];
        if (cellB.unit_type === "" || cellB.incapacitated) continue;
        if (!_matchesUnit(cellB.unit_type, rule.unitB)) continue;
        if (!_matchesProximity(idxA, idxB, rule.proximity)) continue;

        if (!appliedA.has(idxA)) {
          _applyBonus(bonusMap, idxA, rule.bonusForA);
          appliedA.add(idxA);
        }
        if (rule.bonusForB && !appliedB.has(idxB)) {
          _applyBonus(bonusMap, idxB, rule.bonusForB);
          appliedB.add(idxB);
        }
      }
    }
  }

  return bonusMap;
}
