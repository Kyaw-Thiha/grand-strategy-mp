import { GridCellState } from "../rooms/schema/GameRoomState.js";
import { UNIT_COMBAT_STATS } from "../data/unit_combat_stats.js";
import {
  BASE_ATTRITION,
  RECON_CONTRIB_RATES,
  ARTY_UNIT_VALUE,
  XP_THRESHOLD_SEASONED,
  XP_THRESHOLD_VETERAN,
  XP_THRESHOLD_ELITE,
  XP_TIER_HP_MULT,
  XP_TIER_SUPP_RESIST_MULT,
  XP_TIER_RECON_MULT,
  XP_POST_ELITE_SCALE,
  XP_POST_ELITE_DECAY,
} from "../data/combat_constants.js";
import type { SpecialAttackConfig } from "../types/perk_types.js";
import { DEFAULT_SNIPER_CONFIG, DEFAULT_ARTILLERY_CONFIG } from "../types/perk_types.js";

const ARMOUR_TYPES = new Set(["light_tank", "medium_tank", "heavy_tank", "armoured_car"]);
const AT_TYPES     = new Set(["at_infantry", "at_gun", "at_gun_sp"]);

// Cells with armour > 0 per UNIT_COMBAT_STATS — valid armoured targets for AT.
// at_gun_sp: armour=25. at_gun/at_infantry: armour=0 (NOT armoured targets).
const ARMOURED_TARGET_TYPES = new Set([
  "light_tank", "medium_tank", "heavy_tank", "armoured_car", "at_gun_sp",
]);

export const SNIPER_TYPES = new Set(["sniper", "force_recon_sniper"]);
export const ARTY_TYPES   = new Set(["artillery", "howitzer", "self_propelled_gun"]);

export interface DamageProfile {
  hp_fraction:       number;
  supp_fraction:     number;
  bypasses_armour:   boolean;
  cavalry_supp_mult: number;
}

export interface FireOrderEntry {
  cell: GridCellState;
  idx:  number;
}

const PROFILE_INFANTRY: DamageProfile = {
  hp_fraction: 0.30, supp_fraction: 0.70, bypasses_armour: false, cavalry_supp_mult: 1.0,
};
const PROFILE_MG: DamageProfile = {
  hp_fraction: 0.08, supp_fraction: 0.92, bypasses_armour: false, cavalry_supp_mult: 2.0,
};
const PROFILE_CAVALRY_CHARGE: DamageProfile = {
  hp_fraction: 0.55, supp_fraction: 0.45, bypasses_armour: false, cavalry_supp_mult: 1.0,
};
const PROFILE_FLAMETHROWER: DamageProfile = {
  hp_fraction: 0.20, supp_fraction: 0.80, bypasses_armour: true, cavalry_supp_mult: 1.0,
};

// AT: primary effect is penetration/HP damage; minimal crew suppression
const PROFILE_AT: DamageProfile = {
  hp_fraction: 0.75, supp_fraction: 0.25, bypasses_armour: false, cavalry_supp_mult: 1.0,
};

// Armour: cannon + machine gun combo — balanced HP and suppression
const PROFILE_ARMOUR: DamageProfile = {
  hp_fraction: 0.50, supp_fraction: 0.50, bypasses_armour: false, cavalry_supp_mult: 1.5,
};

const PROFILE_SNIPER: DamageProfile = {
  hp_fraction:       0.80,
  supp_fraction:     0.20,
  bypasses_armour:   false,
  cavalry_supp_mult: 1.0,
};

const PROFILE_ARTILLERY: DamageProfile = {
  hp_fraction:       0.65,
  supp_fraction:     0.35,
  bypasses_armour:   false,
  cavalry_supp_mult: 1.0,
};

export function getDamageProfile(unit_type: string, round_number: number): DamageProfile {
  switch (unit_type) {
    case "mg":           return PROFILE_MG;
    case "cavalry":      return round_number === 1 ? PROFILE_CAVALRY_CHARGE : PROFILE_INFANTRY;
    case "flamethrower": return PROFILE_FLAMETHROWER;
    case "at_infantry":
    case "at_gun":
    case "at_gun_sp":    return PROFILE_AT;
    case "light_tank":
    case "medium_tank":
    case "heavy_tank":
    case "armoured_car": return PROFILE_ARMOUR;
    case "sniper":
    case "force_recon_sniper": return PROFILE_SNIPER;
    case "artillery":
    case "howitzer":
    case "self_propelled_gun": return PROFILE_ARTILLERY;
    default:             return PROFILE_INFANTRY;
  }
}

export function _getFrontmostOccupiedRow(cells: GridCellState[]): number {
  for (let row = 4; row >= 0; row--) {
    for (let col = 0; col < 5; col++) {
      const cell = cells[row * 5 + col];
      if (cell && cell.unit_type !== "" && !cell.incapacitated && !cell.stealthed) return row;
    }
  }
  return -1;
}

function _getLivingCellsInRow(cells: GridCellState[], row: number): number[] {
  if (row < 0) return [];
  const result: number[] = [];
  for (let col = 0; col < 5; col++) {
    const idx  = row * 5 + col;
    const cell = cells[idx];
    if (cell && cell.unit_type !== "" && !cell.incapacitated && !cell.stealthed) result.push(idx);
  }
  return result;
}

function _horizontalTargets(cells: GridCellState[], n: number = Infinity): number[] {
  const row    = _getFrontmostOccupiedRow(cells);
  const living = _getLivingCellsInRow(cells, row);
  return isFinite(n) ? living.slice(0, n) : living;
}

function _flamethrowerTargets(
  attacker_row: number,
  attacker_col: number,
  cells: GridCellState[],
): number[] {
  const rows = [attacker_row, attacker_row - 1].filter(r => r >= 0);
  const cols = [attacker_col - 1, attacker_col, attacker_col + 1].filter(c => c >= 0 && c <= 4);
  const targets: number[] = [];
  for (const r of rows) {
    for (const c of cols) {
      const idx  = r * 5 + c;
      const cell = cells[idx];
      if (cell && cell.unit_type !== "" && !cell.incapacitated && !cell.stealthed) targets.push(idx);
    }
  }
  return targets;
}

export function _columnTargets(col: number, min_row: number, cells: GridCellState[]): number[] {
  const result: number[] = [];
  for (let row = 4; row >= min_row; row--) {
    const idx  = row * 5 + col;
    const cell = cells[idx];
    if (cell && cell.unit_type !== "" && !cell.incapacitated && !cell.stealthed) result.push(idx);
  }
  return result;
}

export function _resolveArmourColumn(
  attacker_col: number,
  cells:         GridCellState[],
  attacker_row:  number,
  cover:         string,
): { col: number; shift_type: "none" | "flank" | "envelopment" } | null {
  const min_row = 4 - attacker_row;

  if (_columnTargets(attacker_col, min_row, cells).length > 0) {
    return { col: attacker_col, shift_type: "none" };
  }

  if (cover === "dense_forest" || cover === "urban") {
    return null;
  }

  let searchOrder: number[];
  if (attacker_col === 0 || attacker_col === 1) {
    searchOrder = [attacker_col + 1, attacker_col + 2].filter(c => c <= 4);
  } else if (attacker_col === 3 || attacker_col === 4) {
    searchOrder = [attacker_col - 1, attacker_col - 2].filter(c => c >= 0);
  } else {
    searchOrder = [attacker_col - 1, attacker_col + 1].filter(c => c >= 0 && c <= 4);
  }

  const [first, second] = searchOrder;
  if (first !== undefined && _columnTargets(first, min_row, cells).length > 0) {
    return { col: first, shift_type: "flank" };
  }
  if (second !== undefined && _columnTargets(second, min_row, cells).length > 0) {
    return { col: second, shift_type: "envelopment" };
  }
  return null;
}

export function _resolveATColumn(
  attacker_col: number,
  cells:         GridCellState[],
): { col: number; is_side: boolean } | null {
  const hasArmourInCol = (col: number): boolean => {
    for (let row = 4; row >= 0; row--) {
      const cell = cells[row * 5 + col];
      if (cell && ARMOURED_TARGET_TYPES.has(cell.unit_type) && !cell.incapacitated && !cell.stealthed) return true;
    }
    return false;
  };

  if (hasArmourInCol(attacker_col)) {
    return { col: attacker_col, is_side: false };
  }

  const others = Array.from({ length: 5 }, (_, c) => c)
    .filter(c => c !== attacker_col)
    .sort((a, b) => {
      const da = Math.abs(a - attacker_col);
      const db = Math.abs(b - attacker_col);
      return da !== db ? da - db : a - b;
    });

  for (const col of others) {
    if (hasArmourInCol(col)) return { col, is_side: true };
  }
  return null;
}

/** djb2 string hash → non-negative 32-bit integer. Deterministic across runtimes. */
export function _hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0xFFFFFFFF;
  return h >>> 0;
}

/**
 * Priority-based full-grid targeting for snipers.
 * Scans all 25 enemy cells in priority_list order, collecting up to n_targets living cells.
 * Returns cells in priority order (first matching priority type first).
 */
export function _sniperTargets(
  priority_list: string[],
  n_targets:     number,
  cells:         GridCellState[],
): number[] {
  const result: number[] = [];
  for (const type of priority_list) {
    if (result.length >= n_targets) break;
    for (let i = 0; i < cells.length; i++) {
      if (result.length >= n_targets) break;
      const c = cells[i];
      if (c.unit_type === type && !c.incapacitated && c.unit_type !== "" && !c.stealthed) {
        result.push(i);
      }
    }
  }
  return result;
}

/**
 * Weighted-random column selection followed by area expansion.
 *
 * Column weight formula:
 *   weight(col) = (1 - recon_value) * occupied_count(col)
 *               + recon_value       * value_score(col)
 * where value_score sums ARTY_UNIT_VALUE[unit_type] per living cell in col.
 *
 * center_col is chosen via seeded LCG random. Targets = all living cells in
 * columns [center_col - area_radius, center_col + area_radius] clamped to [0,4].
 * Ordered R5-first (row 4 descending) within each column.
 *
 * Returns { center_col: 0, targets: [] } if grid is empty.
 */
export function _artilleryTargets(
  cells:       GridCellState[],
  recon_value: number,    // 0.0–1.0 normalized
  area_radius: number,
  rng_seed:    number,
): { center_col: number; targets: number[] } {
  const colOccupied = [0, 0, 0, 0, 0];
  const colValue    = [0, 0, 0, 0, 0];

  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      const cell = cells[row * 5 + col];
      if (cell && cell.unit_type !== "" && !cell.incapacitated && !cell.stealthed) {
        colOccupied[col]++;
        colValue[col] += ARTY_UNIT_VALUE[cell.unit_type] ?? 1;
      }
    }
  }

  const totalOccupied = colOccupied.reduce((s, n) => s + n, 0);
  if (totalOccupied === 0) return { center_col: 0, targets: [] };

  // Build final weights: lerp between occupied count and value score by recon_value
  const colWeights = colOccupied.map((oc, i) =>
    (1 - recon_value) * oc + recon_value * colValue[i],
  );

  const totalWeight = colWeights.reduce((s, w) => s + w, 0);
  // LCG step for deterministic random in [0, 1)
  const r = ((rng_seed * 1664525 + 1013904223) >>> 0) / 0x100000000;

  let center_col = 4; // fallback to last col
  let cumulative = 0;
  for (let c = 0; c < 5; c++) {
    cumulative += colWeights[c] / totalWeight;
    if (r < cumulative) { center_col = c; break; }
  }

  // Collect living cells in [center_col - area_radius, center_col + area_radius]
  const minCol = Math.max(0, center_col - area_radius);
  const maxCol = Math.min(4, center_col + area_radius);
  const targets: number[] = [];

  for (let col = minCol; col <= maxCol; col++) {
    for (let row = 4; row >= 0; row--) { // R5 first
      const idx  = row * 5 + col;
      const cell = cells[idx];
      if (cell && cell.unit_type !== "" && !cell.incapacitated && !cell.stealthed) targets.push(idx);
    }
  }

  return { center_col, targets };
}

/**
 * Returns per-cell damage multipliers for an artillery strike.
 * mult(idx) = max(0, 1.0 - falloff_per_col × |col(idx) − center_col|)
 * Center column always gets 1.0. Multiplier never goes below 0.
 */
export function getArtilleryDamageMultipliers(
  targets:         number[],
  center_col:      number,
  falloff_per_col: number,
): Map<number, number> {
  const result = new Map<number, number>();
  for (const idx of targets) {
    const col  = idx % 5;
    const dist = Math.abs(col - center_col);
    result.set(idx, Math.max(0, 1.0 - falloff_per_col * dist));
  }
  return result;
}

/**
 * Per-round recon contribution for a single living cell of unit_type.
 * Returns 0 for non-recon units (combat_system adds RECON_BASE_PER_ROUND separately).
 */
export function _reconContribution(unit_type: string): number {
  return RECON_CONTRIB_RATES[unit_type] ?? 0;
}

export function getXpTier(xp_points: number): "green" | "seasoned" | "veteran" | "elite" {
  if (xp_points >= XP_THRESHOLD_ELITE)    return "elite";
  if (xp_points >= XP_THRESHOLD_VETERAN)  return "veteran";
  if (xp_points >= XP_THRESHOLD_SEASONED) return "seasoned";
  return "green";
}

function _postEliteBonus(xp_points: number): number {
  if (xp_points < XP_THRESHOLD_ELITE) return 0;
  return XP_POST_ELITE_SCALE * Math.log1p((xp_points - XP_THRESHOLD_ELITE) / XP_POST_ELITE_DECAY);
}

/** HP damage reduction multiplier. Divide incoming HP damage by this value. */
export function getXpHpMult(xp_points: number): number {
  return (XP_TIER_HP_MULT[getXpTier(xp_points)] ?? 1.0) + _postEliteBonus(xp_points);
}

/** Suppression resistance multiplier. Divide incoming suppression by this value. */
export function getXpSuppResistMult(xp_points: number): number {
  return XP_TIER_SUPP_RESIST_MULT[getXpTier(xp_points)] ?? 1.0;
}

/** Recon contribution multiplier. Multiply recon gain by this value. */
export function getXpReconMult(xp_points: number): number {
  return XP_TIER_RECON_MULT[getXpTier(xp_points)] ?? 1.0;
}

/**
 * Returns XP retention multiplier for a unit at engagement end.
 * @param hp_ratio          cell.hp / 100
 * @param is_incapacitated  cell.incapacitated
 * @param division_won      whether this cell's division won
 * @param incap_retention   perk-resolved (default 0.40)
 * @param damaged_retention perk-resolved (default 0.60)
 */
export function _computeXpRetention(
  hp_ratio:          number,
  is_incapacitated:  boolean,
  division_won:      boolean,
  incap_retention:   number,
  damaged_retention: number,
): number {
  if (is_incapacitated) return division_won ? incap_retention : 0.0;
  if (hp_ratio > 0.50)  return 1.0;
  return damaged_retention;
}

/**
 * Resolves stealthed flag for each cell in `cells`.
 * Mutates cells[i].stealthed in place.
 *
 * @param cells              Cells to evaluate (one division's grid)
 * @param max_enemy_anti     Highest anti_stealth value among ALL active enemy cells
 * @param effective_stealths Array[25]: effective stealth per cell (base + terrain perk bonus)
 */
export function _resolveStealthForRound(
  cells:              GridCellState[],
  max_enemy_anti:     number,
  effective_stealths: number[],
): void {
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.unit_type === "" || cell.incapacitated) {
      cell.stealthed = false;
      continue;
    }
    const s = effective_stealths[i] ?? 0;
    cell.stealthed = s > 0 && max_enemy_anti < s;
  }
}

export function getTargetCells(
  unit_type:    string,
  attacker_row: number,
  attacker_col: number,
  enemy_cells:  GridCellState[],
  round_number: number,
  n:            number              = Infinity,
  cover:        string              = "",
  config?:      SpecialAttackConfig,
): number[] {
  switch (unit_type) {
    case "infantry":
    case "assault_infantry":
    case "recon_infantry":
    case "commando":
    case "mg":
    case "cavalry":
      return _horizontalTargets(enemy_cells, n);
    case "flamethrower":
      return _flamethrowerTargets(attacker_row, attacker_col, enemy_cells);
    case "light_tank":
    case "medium_tank":
    case "heavy_tank":
    case "armoured_car": {
      const shift = _resolveArmourColumn(attacker_col, enemy_cells, attacker_row, cover);
      if (!shift) return [];
      const min_row = 4 - attacker_row;
      const raw     = _columnTargets(shift.col, min_row, enemy_cells);
      return isFinite(n) ? raw.slice(0, n) : raw;
    }
    case "at_infantry":
    case "at_gun":
    case "at_gun_sp": {
      const atShift = _resolveATColumn(attacker_col, enemy_cells);
      if (!atShift) return _horizontalTargets(enemy_cells, n);
      const raw = _columnTargets(atShift.col, 0, enemy_cells)
        .filter(idx => {
          const cell = enemy_cells[idx];
          return cell && ARMOURED_TARGET_TYPES.has(cell.unit_type);
        });
      return isFinite(n) ? raw.slice(0, n) : raw;
    }
    case "aa_gun":
      return [];
    case "sniper":
    case "force_recon_sniper": {
      const cfg = config ?? { ...DEFAULT_SNIPER_CONFIG, priority_list: [...DEFAULT_SNIPER_CONFIG.priority_list] };
      const raw = _sniperTargets(cfg.priority_list, cfg.n_targets, enemy_cells);
      return isFinite(n) ? raw.slice(0, n) : raw;
    }
    case "artillery":
    case "howitzer":
    case "self_propelled_gun": {
      const cfg = config ?? { ...DEFAULT_ARTILLERY_CONFIG };
      const { targets } = _artilleryTargets(enemy_cells, cfg.recon_value, cfg.area_radius, cfg.rng_seed);
      return isFinite(n) ? targets.slice(0, n) : targets;
    }
    default:
      return [];
  }
}

export function getFireOrder(
  attacker_cells: GridCellState[],
  priority_types: string[] = [],
): FireOrderEntry[] {
  const living: FireOrderEntry[] = attacker_cells
    .map((cell, idx) => ({ cell, idx }))
    .filter(({ cell }) => cell.unit_type !== "" && !cell.incapacitated);

  return living.sort((a, b) => {
    const aP = priority_types.indexOf(a.cell.unit_type);
    const bP = priority_types.indexOf(b.cell.unit_type);
    if (aP >= 0 && bP >= 0) return aP - bP;
    if (aP >= 0)             return -1;
    if (bP >= 0)             return  1;
    const aRow = Math.floor(a.idx / 5);
    const bRow = Math.floor(b.idx / 5);
    if (aRow !== bRow) return bRow - aRow;
    return (a.idx % 5) - (b.idx % 5);
  });
}

export function simulateRound(
  attacker_cells: GridCellState[],
  enemy_cells:    GridCellState[],
  round_number:   number,
  priority_types: string[] = [],
  n:              number   = Infinity,
  cover:          string   = "",
  seed:           number   = 0,
): Map<number, number[]> {
  const virtual: GridCellState[] = enemy_cells.map(c => {
    const v         = new GridCellState();
    v.unit_type     = c.unit_type;
    v.hp            = c.hp;
    v.suppression   = c.suppression;
    v.incapacitated = c.incapacitated;
    v.stealthed     = c.stealthed;
    return v;
  });

  const result = new Map<number, number[]>();
  const order  = getFireOrder(attacker_cells, priority_types);

  for (const { cell: attCell, idx } of order) {
    const attRow = Math.floor(idx / 5);
    const attCol = idx % 5;

    // Build special config for sniper/arty — default perks, runtime fields from params.
    let specialCfg: SpecialAttackConfig | undefined;
    if (SNIPER_TYPES.has(attCell.unit_type)) {
      specialCfg = { ...DEFAULT_SNIPER_CONFIG, priority_list: [...DEFAULT_SNIPER_CONFIG.priority_list] };
    } else if (ARTY_TYPES.has(attCell.unit_type)) {
      specialCfg = { ...DEFAULT_ARTILLERY_CONFIG, rng_seed: seed };
    }
    const targets = getTargetCells(attCell.unit_type, attRow, attCol, virtual, round_number, n, cover, specialCfg);
    result.set(idx, targets);
    if (targets.length === 0) continue;

    const profile     = getDamageProfile(attCell.unit_type, round_number);
    const perTargetHp = (BASE_ATTRITION * profile.hp_fraction) / targets.length;

    for (const tIdx of targets) {
      const tCell = virtual[tIdx];
      if (!tCell || tCell.incapacitated) continue;
      tCell.hp = Math.max(0, tCell.hp - perTargetHp);
      const floorPct = UNIT_COMBAT_STATS[tCell.unit_type]?.hp_floor_pct ?? 0;
      if ((floorPct > 0 && tCell.hp <= floorPct) || tCell.hp <= 0) {
        tCell.incapacitated = true;
      }
    }
  }

  return result;
}
