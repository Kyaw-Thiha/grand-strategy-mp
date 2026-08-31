import type { MapSchema } from "@colyseus/schema";
import type { NationState, ProvinceState, DivisionState } from "../rooms/schema/GameRoomState.js";
import type { ProvinceEconomyData } from "./economy_building_system.js";
import {
  EXTRACTION_STATS,
  RESOURCE_TYPE_BY_BUILDING,
  MONEY_TRICKLE_PER_POPULATION,
  POPULATION_GROWTH_RATE,
  MANPOWER_RATIO,
  MANPOWER_SOFT_CAP_THRESHOLD,
  MANPOWER_SOFT_CAP_MAX_MULT,
  MANPOWER_REGEN_RATE_FRACTION,
  INDUSTRY_DIMINISHING_K,
  HOSPITAL_DIMINISHING_K,
  HOSPITAL_DAMAGE_MULT_FLOOR,
  TUNGSTEN_FULL_ACCESS_THRESHOLD,
  TUNGSTEN_PEN_FLOOR_MULT,
  CHROMIUM_THRESHOLD,
  RUBBER_DRAIN_PER_VEHICLE_CELL,
  NITRATE_DRAIN_PER_INFANTRY_ARTY_CELL,
  RAMP_TICKS,
  BAUXITE_TO_ALUMINIUM_RATIO,
} from "../data/resource_stats.js";
import { VEHICLE_TYPES, INFANTRY_ARTILLERY_TYPES } from "../data/unit_resource_tags.js";

export type OilPriority = "military" | "balanced" | "economy";
export type BroadcastFn = (type: string, msg: unknown) => void;

// ─── Population & Manpower (Step 2) ────────────────────────────────────────

export function tickPopulation(provinces: Iterable<ProvinceState>): void {
  for (const province of provinces) {
    province.population += POPULATION_GROWTH_RATE;
  }
}

export function computeManpower(nation: NationState, ownedProvinces: ProvinceState[]): void {
  const totalPop = ownedProvinces.reduce((sum, p) => sum + p.population, 0);
  nation.manpower_ceiling = totalPop * MANPOWER_RATIO;
  const regen = nation.manpower_ceiling * MANPOWER_REGEN_RATE_FRACTION;
  nation.manpower_available = Math.min(nation.manpower_ceiling, nation.manpower_available + regen);
}

export function getManpowerCostMultiplier(available: number, ceiling: number): number {
  if (ceiling <= 0) return 1.0; // zero-demand edge case — no deficit reads possible with no ceiling
  const ratio = available / ceiling;
  if (ratio >= MANPOWER_SOFT_CAP_THRESHOLD) return 1.0;
  const severity = 1 - ratio / MANPOWER_SOFT_CAP_THRESHOLD;
  return 1.0 + severity * (MANPOWER_SOFT_CAP_MAX_MULT - 1.0);
}

// ─── Industry Pool (Step 10) ────────────────────────────────────────────────

export function industrySliceMultiplier(allocationPct: number): number {
  // Saturating curve: 0% allocation -> 1.0x (never a precondition), 100% -> asymptotic cap.
  return 1.0 + (allocationPct / 100) * (INDUSTRY_DIMINISHING_K / (INDUSTRY_DIMINISHING_K + allocationPct));
}

// ─── Oil (Step 4) ───────────────────────────────────────────────────────────

const OIL_DEMAND_TIERS: Array<[number, number]> = [
  [0.50, 0.05], // 100-50%: negligible-to-minor
  [0.20, 0.25], // 50-20%: steepens
  [0.00, 0.60], // <20%: severe, never 1.0 (never a hard stop)
]; // TBD playtesting — placeholder curve, shape confirmed (soft, monotonic, never 100%) not exact numbers

/** Linear interpolation across the tier bands — avoids a visible cliff at 50%/20%. */
export function oilSpeedMultiplier(demandMetRatio: number): number {
  const clamped = Math.max(0, Math.min(1, demandMetRatio));
  // Build boundary points [ratio, penalty] from 1.0 down to 0.0, interpolate penalty linearly.
  const points: Array<[number, number]> = [[1.0, 0], ...OIL_DEMAND_TIERS];
  for (let i = 0; i < points.length - 1; i++) {
    const [r0, p0] = points[i];
    const [r1, p1] = points[i + 1];
    if (clamped <= r0 && clamped >= r1) {
      const span = r0 - r1;
      const t = span === 0 ? 0 : (r0 - clamped) / span;
      const penalty = p0 + t * (p1 - p0);
      return 1.0 - penalty;
    }
  }
  return 1.0 - OIL_DEMAND_TIERS[OIL_DEMAND_TIERS.length - 1][1];
}

export function computeOilDemandMet(oilStock: number, totalOilDemand: number): number {
  if (totalOilDemand <= 0) return 1.0; // zero-demand edge case reads as fully met
  return Math.min(1.0, oilStock / totalOilDemand);
}

/**
 * Priority-weighted multiplier applied to either military unit speed or civilian construction
 * speed. `balanced` weights both at 1.0 (full strength); `military` protects military speed at
 * civilian construction's expense and vice versa for `economy`. Exact weighting is a
 * placeholder; the direction is the load-bearing, testable behavior.
 */
export function oilPriorityWeight(priority: OilPriority, target: "military" | "construction"): number {
  if (priority === "balanced") return 1.0;
  if (priority === "military") return target === "military" ? 0.5 : 1.5;
  return target === "military" ? 1.5 : 0.5; // "economy"
}

// ─── Tungsten (Step 6) ──────────────────────────────────────────────────────

export function tungstenPenMultiplier(nationTungstenStock: number): number {
  const ratio = Math.min(1.0, nationTungstenStock / TUNGSTEN_FULL_ACCESS_THRESHOLD);
  return TUNGSTEN_PEN_FLOOR_MULT + ratio * (1.0 - TUNGSTEN_PEN_FLOOR_MULT);
}

// ─── Chromium (Step 7) ──────────────────────────────────────────────────────

export function isChromiumAvailable(nationChromiumStock: number): boolean {
  return nationChromiumStock > CHROMIUM_THRESHOLD;
}

// ─── Aluminium (Step 8a) ────────────────────────────────────────────────────

const ALUMINIUM_CEILING_BY_TIER: Record<number, number> = {}; // empty — inert until Phase 14

export function aluminiumSupplyCeiling(flagEnabled: boolean, tier: number): number {
  if (!flagEnabled) return Infinity; // no ceiling — nation hasn't "unlocked" the mechanic yet
  return ALUMINIUM_CEILING_BY_TIER[tier] ?? Infinity;
}

// ─── Hospital (Step 9) ──────────────────────────────────────────────────────

/**
 * Saturating curve, floor-clamped — must never approach making any unit unkillable. Zero
 * Hospitals = 1.0 (no reduction); reduction asymptotically approaches (1 - floor) as level
 * grows, so the curve saturates toward the floor rather than toward zero damage.
 */
export function hospitalDamageMultiplier(totalHospitalLevel: number): number {
  const reductionFraction = totalHospitalLevel / (totalHospitalLevel + HOSPITAL_DIMINISHING_K);
  const mult = 1 - reductionFraction * (1 - HOSPITAL_DAMAGE_MULT_FLOOR);
  return Math.max(HOSPITAL_DAMAGE_MULT_FLOOR, mult);
}

// ─── Combat-round attrition — Rubber / Nitrates (Step 5) ───────────────────

export function drainCombatAttrition(
  engagedDivisions: DivisionState[],
  nations: MapSchema<NationState>,
): void {
  const drainByNation = new Map<string, { rubber: number; nitrates: number }>();
  for (const div of engagedDivisions) {
    if (!div.grid) continue;
    let rubberCells = 0;
    let nitrateCells = 0;
    for (const cell of div.grid.cells) {
      if (cell.unit_type === "" || cell.hp <= 0 || cell.incapacitated) continue;
      if (VEHICLE_TYPES.has(cell.unit_type)) rubberCells++;
      if (INFANTRY_ARTILLERY_TYPES.has(cell.unit_type)) nitrateCells++;
    }
    if (rubberCells === 0 && nitrateCells === 0) continue;
    const drain = drainByNation.get(div.nation_id) ?? { rubber: 0, nitrates: 0 };
    drain.rubber += rubberCells * RUBBER_DRAIN_PER_VEHICLE_CELL;
    drain.nitrates += nitrateCells * NITRATE_DRAIN_PER_INFANTRY_ARTY_CELL;
    drainByNation.set(div.nation_id, drain);
  }
  for (const [nationId, drain] of drainByNation) {
    const nation = nations.get(nationId);
    if (!nation) continue;
    nation.resources.set("rubber", Math.max(0, (nation.resources.get("rubber") ?? 0) - drain.rubber));
    nation.resources.set("nitrates", Math.max(0, (nation.resources.get("nitrates") ?? 0) - drain.nitrates));
  }
}

// ─── Building base effects (Step 9) — pure helpers ─────────────────────────

export function scienceGainForTick(schoolLevel: number, sciencePerLevel: number): number {
  return schoolLevel * sciencePerLevel;
}

export function convoyCapacityForShipyards(totalShipyardLevelWithPort: number, perLevel: number): number {
  return totalShipyardLevelWithPort * perLevel;
}

export function effectiveVpValue(baseVpValue: number, townHallLevel: number, multPerLevel: number): number {
  return baseVpValue * (1 + townHallLevel * multPerLevel);
}

export function storageCapForLevel(warehouseLevel: number, base: number, perLevel: number): number {
  if (warehouseLevel <= 0) return base; // a province with no Warehouse still has a nonzero floor cap
  return base + warehouseLevel * perLevel;
}

// ─── Extraction tick + rubber ramp-up + bauxite chain (Step 3, 9) ──────────

export interface ExtractionResult {
  gained: Record<string, number>;
}

/**
 * Stateful only for the Rubber Plantation ramp-up tracker (ECONOMY_BUILDINGS.md: "a newly
 * built plantation takes longer than other extraction buildings to reach its full base-tier
 * output"). Everything else in this system is pure/stateless.
 */
export class ResourceEconomySystem {
  private rubberRampStartTick = new Map<string, number>(); // province_id -> tick when res_rubber first reached level >= 1

  tickExtraction(
    nation: NationState,
    ownedProvinces: ProvinceState[],
    ownedEconomies: ProvinceEconomyData[],
    industryMultiplierByResource: (resourceType: string) => number,
    tickCount: number,
  ): ExtractionResult {
    const gained: Record<string, number> = {};

    for (const econ of ownedEconomies) {
      for (const [buildingType, extraction] of Object.entries(EXTRACTION_STATS)) {
        const level = econ.buildings[buildingType] ?? 0;
        if (level === 0) continue;

        // res_aluminium is a two-stage bauxite_mine -> bauxite_refinery chain (Step 9's
        // "Bauxite Mine + Refinery" exception) — handled below, skip the generic path for it.
        if (buildingType === "res_aluminium") continue;

        const resourceType = RESOURCE_TYPE_BY_BUILDING[buildingType];
        const deposit = econ.resource_deposits[resourceType] ?? 0;
        let base = extraction.base_output_by_level[level - 1] ?? 0;

        if (buildingType === "res_rubber") {
          if (!this.rubberRampStartTick.has(econ.province_id)) {
            this.rubberRampStartTick.set(econ.province_id, tickCount);
          }
          const start = this.rubberRampStartTick.get(econ.province_id)!;
          const rampFraction = Math.min(1.0, (tickCount - start) / RAMP_TICKS);
          base *= rampFraction;
        }

        const output = base * (deposit / 100) * industryMultiplierByResource(resourceType);
        gained[resourceType] = (gained[resourceType] ?? 0) + output;
      }

      // Bauxite Mine + Refinery two-stage chain: res_aluminium building_type key is reused as
      // the "bauxite_mine" stage (extracts into nation.bauxite_stock, not `resources`); a
      // dedicated "bauxite_refinery" level doesn't exist as its own building slot in this
      // phase's schema (see Common Misassumptions) — model refinery conversion as a flat
      // ratio applied every tick against whatever bauxite_stock has accumulated, keeping the
      // mine and conversion steps numerically independent as ECONOMY_BUILDINGS.md requires.
      const bauxiteLevel = econ.buildings["res_aluminium"] ?? 0;
      if (bauxiteLevel > 0) {
        const deposit = econ.resource_deposits["aluminium"] ?? 0;
        const bauxiteExtraction = EXTRACTION_STATS.res_aluminium;
        const bauxiteOut = (bauxiteExtraction.base_output_by_level[bauxiteLevel - 1] ?? 0) * (deposit / 100);
        nation.bauxite_stock += bauxiteOut;
      }
    }

    if (nation.bauxite_stock > 0) {
      const converted = nation.bauxite_stock * BAUXITE_TO_ALUMINIUM_RATIO * industryMultiplierByResource("aluminium");
      const usable = Math.min(nation.bauxite_stock, converted);
      nation.bauxite_stock -= usable;
      gained["aluminium"] = (gained["aluminium"] ?? 0) + usable;
    }

    // Money placeholder trickle (schema gap 1) — population-scaled, not building-gated.
    const totalPopulation = ownedProvinces.reduce((sum, p) => sum + p.population, 0);
    gained["money"] = (gained["money"] ?? 0) + totalPopulation * MONEY_TRICKLE_PER_POPULATION;

    for (const [resType, amount] of Object.entries(gained)) {
      const cap = nation.resource_storage_cap.get(resType);
      const current = nation.resources.get(resType) ?? 0;
      const next = cap !== undefined ? Math.min(cap, current + amount) : current + amount;
      nation.resources.set(resType, next);
    }

    return { gained };
  }
}
