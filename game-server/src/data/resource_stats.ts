// Branch B — extraction rates, population/manpower constants. All TBD-playtesting placeholder
// values, named per project convention (unit_production_handoff.md: "do not invent values,
// use clearly-named placeholders").

export interface ExtractionStats {
  base_output_by_level: number[]; // 5 values, index 0 = level 1 output
}

// One entry per resource-extraction building_type in building_stats.ts's BUILDING_TYPES.
export const EXTRACTION_STATS: Record<string, ExtractionStats> = {
  res_grain:     { base_output_by_level: [4, 7, 11, 16, 22] },
  res_iron:      { base_output_by_level: [4, 7, 11, 16, 22] },
  res_oil:       { base_output_by_level: [3, 6, 10, 15, 21] },
  res_rubber:    { base_output_by_level: [3, 6, 10, 15, 21] },
  res_nitrates:  { base_output_by_level: [3, 6, 10, 15, 21] },
  res_tungsten:  { base_output_by_level: [1, 2, 3, 4, 5] },
  res_chromium:  { base_output_by_level: [1, 2, 3, 4, 5] },
  res_aluminium: { base_output_by_level: [1, 2, 3, 4, 5] }, // bauxite_mine stage — see Step 9's note
  res_uranium:   { base_output_by_level: [1, 2] }, // only 2 tiers exist (Uranium Mine is "1 path, 2 tiers")
};

// Maps a resource-extraction building_type -> the resource type it produces.
export const RESOURCE_TYPE_BY_BUILDING: Record<string, string> = {
  res_grain: "grain",
  res_iron: "iron",
  res_oil: "oil",
  res_rubber: "rubber",
  res_nitrates: "nitrates",
  res_tungsten: "tungsten",
  res_chromium: "chromium",
  res_aluminium: "aluminium", // conversion from bauxite_stock, see resource_economy_system.ts
  res_uranium: "uranium",
};

export function getExtractionStats(buildingType: string): ExtractionStats {
  const stats = EXTRACTION_STATS[buildingType];
  if (!stats) throw new Error(`Unknown extraction building type: ${buildingType}`);
  return stats;
}

export const MONEY_TRICKLE_PER_POPULATION = 0.02; // TBD playtesting — schema gap 1 placeholder
export const POPULATION_GROWTH_RATE = 0.5;        // TBD playtesting — flat per-tick growth, per-province
export const MANPOWER_RATIO = 0.15;               // fraction of population that is "ceiling" recruitable manpower
export const MANPOWER_SOFT_CAP_THRESHOLD = 0.2;   // below this available/ceiling ratio, cost multiplier kicks in
export const MANPOWER_SOFT_CAP_MAX_MULT = 3.0;    // cost multiplier at zero available manpower
export const MANPOWER_REGEN_RATE_FRACTION = 0.02; // TBD playtesting — fraction of ceiling regenerated per tick

export const INDUSTRY_DIMINISHING_K = 30; // TBD playtesting — saturation constant, per-slice independent curve
export const INDUSTRY_REALLOCATION_COOLDOWN_MS = 2000; // TBD playtesting — "near-instant"

export const HOSPITAL_DIMINISHING_K = 3;        // TBD playtesting — saturation constant
export const HOSPITAL_DAMAGE_MULT_FLOOR = 0.5;  // non-negotiable per ECONOMY_BUILDINGS.md: never approach 0

export const TUNGSTEN_FULL_ACCESS_THRESHOLD = 50; // TBD playtesting
export const TUNGSTEN_PEN_FLOOR_MULT = 0.6;       // TBD playtesting — worst-case pen multiplier at zero tungsten

export const CHROMIUM_THRESHOLD = 20; // TBD playtesting

export const RUBBER_DRAIN_PER_VEHICLE_CELL = 0.5;          // TBD playtesting
export const NITRATE_DRAIN_PER_INFANTRY_ARTY_CELL = 0.3;   // TBD playtesting

export const RAMP_TICKS = 120; // TBD playtesting — Rubber Plantation's ramp-up duration, in ticks

export const BAUXITE_TO_ALUMINIUM_RATIO = 0.8; // TBD playtesting — refinery conversion efficiency

export const SCIENCE_PER_SCHOOL_LEVEL = 0.3;         // TBD playtesting
// TBD playtesting — Warehouse base per-resource cap. Deliberately well above _initNationEconomy's
// STARTING_MONEY seed (500) so the starting stockpile isn't clamped flush against the cap
// before any trickle/extraction has a chance to grow it.
export const HOSPITAL_STORAGE_CAP_BASE = 2000;
export const HOSPITAL_STORAGE_CAP_PER_LEVEL = 250;    // TBD playtesting
export const CONVOY_CAPACITY_PER_SHIPYARD_LEVEL = 10; // TBD playtesting
export const TOWN_HALL_VP_MULT_PER_LEVEL = 0.1;       // TBD playtesting
export const INFRASTRUCTURE_BONUS_PER_LEVEL = 4;      // TBD playtesting — flat bonus to ProvinceState.infrastructure
export const INFRASTRUCTURE_BASE_DEFAULT = 50;         // ProvinceState.infrastructure's own schema default

export const TEN_RESOURCES: string[] = [
  "money", "grain", "iron", "oil", "rubber", "nitrates", "tungsten", "chromium", "aluminium", "uranium",
];

export const OIL_DEMAND_PER_CONSUMING_CELL = 0.2; // TBD playtesting — per-tick oil demand per oil-consuming grid cell
export const OIL_SPEED_MULT_FLOOR = 0.1;           // never a hard stop, per RESOURCE_ECONOMY.md's Oil section
