import { GridCellState } from "../rooms/schema/GameRoomState.js";
import { UNIT_COMBAT_STATS } from "../data/unit_combat_stats.js";
import { BASE_ATTRITION } from "../data/combat_constants.js";

const ARMOUR_TYPES = new Set(["light_tank", "medium_tank", "heavy_tank", "armoured_car"]);
const AT_TYPES     = new Set(["at_infantry", "at_gun", "at_gun_sp"]);

// Cells with armour > 0 per UNIT_COMBAT_STATS — valid armoured targets for AT.
// at_gun_sp: armour=25. at_gun/at_infantry: armour=0 (NOT armoured targets).
const ARMOURED_TARGET_TYPES = new Set([
  "light_tank", "medium_tank", "heavy_tank", "armoured_car", "at_gun_sp",
]);

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
    default:             return PROFILE_INFANTRY;
  }
}

export function _getFrontmostOccupiedRow(cells: GridCellState[]): number {
  for (let row = 4; row >= 0; row--) {
    for (let col = 0; col < 5; col++) {
      const cell = cells[row * 5 + col];
      if (cell && cell.unit_type !== "" && !cell.incapacitated) return row;
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
    if (cell && cell.unit_type !== "" && !cell.incapacitated) result.push(idx);
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
      if (cell && cell.unit_type !== "" && !cell.incapacitated) targets.push(idx);
    }
  }
  return targets;
}

export function _columnTargets(col: number, min_row: number, cells: GridCellState[]): number[] {
  const result: number[] = [];
  for (let row = 4; row >= min_row; row--) {
    const idx  = row * 5 + col;
    const cell = cells[idx];
    if (cell && cell.unit_type !== "" && !cell.incapacitated) result.push(idx);
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
      if (cell && ARMOURED_TARGET_TYPES.has(cell.unit_type) && !cell.incapacitated) return true;
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

export function getTargetCells(
  unit_type:    string,
  attacker_row: number,
  attacker_col: number,
  enemy_cells:  GridCellState[],
  round_number: number,
  n:            number = Infinity,
  cover:        string = "",
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
      if (!atShift) return [];
      const raw = _columnTargets(atShift.col, 0, enemy_cells)
        .filter(idx => {
          const cell = enemy_cells[idx];
          return cell && ARMOURED_TARGET_TYPES.has(cell.unit_type);
        });
      return isFinite(n) ? raw.slice(0, n) : raw;
    }
    case "aa_gun":
      return [];
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

    const targets = getTargetCells(attCell.unit_type, attRow, attCol, virtual, round_number, n, cover);
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
