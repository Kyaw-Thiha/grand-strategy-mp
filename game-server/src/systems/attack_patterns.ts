import { GridCellState } from "../rooms/schema/GameRoomState.js";
import { UNIT_COMBAT_STATS } from "../data/unit_combat_stats.js";
import { BASE_ATTRITION } from "../data/combat_constants.js";

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

export function getDamageProfile(unit_type: string, round_number: number): DamageProfile {
  switch (unit_type) {
    case "mg":           return PROFILE_MG;
    case "cavalry":      return round_number === 1 ? PROFILE_CAVALRY_CHARGE : PROFILE_INFANTRY;
    case "flamethrower": return PROFILE_FLAMETHROWER;
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

export function getTargetCells(
  unit_type:    string,
  attacker_row: number,
  attacker_col: number,
  enemy_cells:  GridCellState[],
  round_number: number,
  n:            number = Infinity,
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

    const targets = getTargetCells(attCell.unit_type, attRow, attCol, virtual, round_number, n);
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
