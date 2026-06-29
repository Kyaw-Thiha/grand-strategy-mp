/**
 * Terrain Modifier System.
 *
 * Per-cell, per-unit-type terrain modifiers evaluated each combat round.
 * Ships with no active rules — rules are added later via perk research.
 *
 * battle_cover values (from ActivePair.battle_cover, set via COVER_MOD in combat_system.ts):
 *   plains, farmland, grassland, steppe, open_forest, temperate_forest,
 *   boreal_forest, dense_forest, urban, mediterranean_scrub, heathland,
 *   hot_desert, cold_desert, tundra, wetland
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface TerrainCellModifiers {
  hp_dealt_mult:    number;
  supp_dealt_mult:  number;
  supp_resist_mult: number;
  supp_decay_mult:  number;
  stealth_delta:    number;
  flanking_enabled: boolean;
}

export interface TerrainModifierRule {
  id: string;
  unit_types: string | string[];
  terrain:    string | string[];
  modifiers:  Partial<TerrainCellModifiers>;
}

export interface TerrainCellInput {
  unit_type:     string;
  incapacitated: boolean;
}

// ── Identity constant ─────────────────────────────────────────────────────────

export const IDENTITY_TERRAIN_MODIFIERS: TerrainCellModifiers = {
  hp_dealt_mult:    1.0,
  supp_dealt_mult:  1.0,
  supp_resist_mult: 1.0,
  supp_decay_mult:  1.0,
  stealth_delta:    0,
  flanking_enabled: true,
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function _matchesUnit(unit_type: string, pattern: string | string[]): boolean {
  return Array.isArray(pattern) ? pattern.includes(unit_type) : unit_type === pattern;
}

function _matchesTerrain(battle_cover: string, pattern: string | string[]): boolean {
  return Array.isArray(pattern) ? pattern.includes(battle_cover) : battle_cover === pattern;
}

function _mergeModifiers(
  existing: TerrainCellModifiers,
  bonus: Partial<TerrainCellModifiers>,
): TerrainCellModifiers {
  return {
    hp_dealt_mult:    existing.hp_dealt_mult    * (bonus.hp_dealt_mult    ?? 1.0),
    supp_dealt_mult:  existing.supp_dealt_mult  * (bonus.supp_dealt_mult  ?? 1.0),
    supp_resist_mult: existing.supp_resist_mult * (bonus.supp_resist_mult ?? 1.0),
    supp_decay_mult:  existing.supp_decay_mult  * (bonus.supp_decay_mult  ?? 1.0),
    stealth_delta:    existing.stealth_delta    + (bonus.stealth_delta    ?? 0),
    flanking_enabled: existing.flanking_enabled && (bonus.flanking_enabled ?? true),
  };
}

function _applyModifier(
  modMap: Map<number, TerrainCellModifiers>,
  cellIdx: number,
  bonus: Partial<TerrainCellModifiers>,
): void {
  const existing = modMap.get(cellIdx) ?? { ...IDENTITY_TERRAIN_MODIFIERS };
  modMap.set(cellIdx, _mergeModifiers(existing, bonus));
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getActiveTerrainModifierRules(_researchedPerks?: string[]): TerrainModifierRule[] {
  return [];
}

export function evaluateTerrainModifiers(
  cells: TerrainCellInput[],
  battle_cover: string,
  activeRules: TerrainModifierRule[],
): Map<number, TerrainCellModifiers> {
  const modMap = new Map<number, TerrainCellModifiers>();
  if (activeRules.length === 0) return modMap;

  for (const rule of activeRules) {
    if (!_matchesTerrain(battle_cover, rule.terrain)) continue;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell.unit_type === "" || cell.incapacitated) continue;
      if (!_matchesUnit(cell.unit_type, rule.unit_types)) continue;
      _applyModifier(modMap, i, rule.modifiers);
    }
  }

  return modMap;
}
