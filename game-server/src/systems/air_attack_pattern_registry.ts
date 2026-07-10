import { BOMBING_STATS, TARGET_NOISE_FLOOR } from "../data/air_bombing_stats.js";

export interface CellSnapshot {
  unit_type: string;
  hp: number;
  suppression: number;
  incapacitated: boolean;
  soft_target?: boolean;
}

export interface BombingContext {
  aircraft_type: string;
  count: number;
  combat_readiness: number;
  perk_strafing: boolean;
  perk_precision_bombing: boolean;
  recon_quality: number;
}

export interface CellHit {
  cell_index: number;
  hp_damage: number;
  supp_damage: number;
}

export interface PatternResult {
  hit_cells: CellHit[];
  pattern_type: string;
  total_hp_damage: number;
}

const HARD_TARGET_TYPES = new Set([
  "light_tank", "medium_tank", "heavy_tank", "armoured_car",
  "at_gun", "at_gun_sp", "artillery", "howitzer", "self_propelled_gun",
]);

function isOccupied(cell: CellSnapshot): boolean {
  return cell.unit_type !== "" && !cell.incapacitated;
}

function isSoft(cell: CellSnapshot): boolean {
  return !HARD_TARGET_TYPES.has(cell.unit_type);
}

let _rng: () => number = Math.random;
export function setRngForTesting(fn: () => number): void { _rng = fn; }
export function resetRng(): void { _rng = Math.random; }

function scoreCell(cell: CellSnapshot, recon_quality: number): number {
  if (!isOccupied(cell)) return 0;
  const base = cell.hp / 100.0;
  const soft_bonus = isSoft(cell) ? 0.3 : 0.0;
  const noise = _rng() * TARGET_NOISE_FLOOR;
  return base * recon_quality + soft_bonus * recon_quality + noise;
}

function hitDamageSum(hits: CellHit[]): number {
  return hits.reduce((s, h) => s + h.hp_damage, 0);
}

export function resolveDivePattern(cells: CellSnapshot[], ctx: BombingContext): PatternResult {
  const { hp_per_plane, supp_per_plane } = BOMBING_STATS.dive_bomber;
  const total_hp = hp_per_plane * ctx.count * ctx.combat_readiness;
  const total_supp = supp_per_plane * ctx.count * ctx.combat_readiness;

  const scored = cells
    .map((c, i) => ({ i, score: scoreCell(c, ctx.recon_quality) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const num_targets = ctx.perk_precision_bombing ? 2 : 1;
  const targets = scored.slice(0, num_targets);

  const hit_cells: CellHit[] = targets.map(t => ({
    cell_index: t.i,
    hp_damage: Math.floor(total_hp / targets.length),
    supp_damage: Math.floor(total_supp / targets.length),
  }));

  return { hit_cells, pattern_type: "dive", total_hp_damage: hitDamageSum(hit_cells) };
}

export function resolveTacticalPattern(cells: CellSnapshot[], ctx: BombingContext): PatternResult {
  const { hp_per_plane, supp_per_plane } = BOMBING_STATS.tactical_bomber;
  const total_hp = hp_per_plane * ctx.count * ctx.combat_readiness;
  const total_supp = supp_per_plane * ctx.count * ctx.combat_readiness;

  let target_row = -1;
  for (let row = 4; row >= 0; row--) {
    const row_cells = [0, 1, 2, 3, 4].map(col => cells[row * 5 + col]);
    if (row_cells.some(isOccupied)) { target_row = row; break; }
  }

  if (target_row === -1) return { hit_cells: [], pattern_type: "tactical", total_hp_damage: 0 };

  const row_occupied = [0, 1, 2, 3, 4]
    .map(col => ({ idx: target_row * 5 + col, cell: cells[target_row * 5 + col] }))
    .filter(x => isOccupied(x.cell));

  const hit_cells: CellHit[] = row_occupied.map(x => ({
    cell_index: x.idx,
    hp_damage: Math.floor(total_hp / row_occupied.length),
    supp_damage: Math.floor(total_supp / row_occupied.length),
  }));

  return { hit_cells, pattern_type: "tactical", total_hp_damage: hitDamageSum(hit_cells) };
}

export function resolveCasPattern(cells: CellSnapshot[], ctx: BombingContext): PatternResult {
  const { hp_per_plane, supp_per_plane } = BOMBING_STATS.cas_plane;
  const total_hp = hp_per_plane * ctx.count * ctx.combat_readiness;
  const total_supp = supp_per_plane * ctx.count * ctx.combat_readiness;

  let best_col = 0;
  let best_col_score = -1;
  for (let col = 0; col < 5; col++) {
    const col_score = [0, 1, 2, 3, 4]
      .map(row => scoreCell(cells[row * 5 + col], ctx.recon_quality))
      .reduce((a, b) => a + b, 0);
    if (col_score > best_col_score) { best_col_score = col_score; best_col = col; }
  }

  const col_occupied = [0, 1, 2, 3, 4]
    .map(row => ({ idx: row * 5 + best_col, cell: cells[row * 5 + best_col] }))
    .filter(x => isOccupied(x.cell));

  if (col_occupied.length === 0) return { hit_cells: [], pattern_type: "cas", total_hp_damage: 0 };

  const hit_cells: CellHit[] = col_occupied.map(x => ({
    cell_index: x.idx,
    hp_damage: Math.floor(total_hp / col_occupied.length),
    supp_damage: Math.floor(total_supp / col_occupied.length),
  }));

  return { hit_cells, pattern_type: "cas", total_hp_damage: hitDamageSum(hit_cells) };
}

export function resolveFighterStrafingPattern(cells: CellSnapshot[], ctx: BombingContext): PatternResult {
  if (!ctx.perk_strafing) return { hit_cells: [], pattern_type: "fighter_strafe", total_hp_damage: 0 };
  return { ...resolveCasPattern(cells, ctx), pattern_type: "fighter_strafe" };
}

export function resolvePattern(cells: CellSnapshot[], ctx: BombingContext): PatternResult {
  switch (ctx.aircraft_type) {
    case "dive_bomber":      return resolveDivePattern(cells, ctx);
    case "tactical_bomber":
    case "cas_plane":        return ctx.aircraft_type === "cas_plane"
                               ? resolveCasPattern(cells, ctx)
                               : resolveTacticalPattern(cells, ctx);
    case "fighter":
    case "heavy_fighter":    return resolveFighterStrafingPattern(cells, ctx);
    default:                 return { hit_cells: [], pattern_type: "none", total_hp_damage: 0 };
  }
}
