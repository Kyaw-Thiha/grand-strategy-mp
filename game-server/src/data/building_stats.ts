export interface BuildingStats {
  // 5 values, levels 1-5. Indexed by CURRENT level (0-based): index 0 is the cost to go
  // from level 0 -> 1, index 4 is the cost to go from level 4 -> 5.
  construction_points_by_level: number[];
  resource_cost_by_level: Partial<Record<string, number>>[];
}

// The 24-key buildings{} schema per MAP_DATA_CONTRACT.md / map/tools/map_pipeline/pipeline.py's
// BUILDING_TYPES, PLUS "infrastructure" (Branch B schema gap 2 — ECONOMY_BUILDINGS.md documents
// Infrastructure as a full civilian building, but no bld_infrastructure field exists anywhere
// in MAP_DATA_CONTRACT.md or map_data.json yet; that's real map-authoring work outside this
// branch's scope. Adding the entry here with a safe level-0 default lets the base effect exist
// and be buildable without depending on the map pipeline being re-run — every province simply
// starts with no Infrastructure building until a later map-authoring pass seeds real levels.
export const BUILDING_TYPES: string[] = [
  // Strategic (military, out of ECONOMY_BUILDINGS.md's scope this phase — entries exist only
  // so buildings{} round-trips through the schema without a missing-key error).
  "fort", "port", "airbase", "supply_hub", "factory", "radar",
  // Production (base throughput only this phase, per ECONOMY_BUILDINGS.md).
  "barracks", "tank_plant", "ordnance_factory", "aircraft_factory",
  // Civilian.
  "school", "hospital", "warehouse", "shipyard", "town_hall", "infrastructure",
  // Resource-extraction.
  "res_grain", "res_iron", "res_oil", "res_rubber", "res_nitrates",
  "res_tungsten", "res_chromium", "res_aluminium", "res_uranium",
];

// TBD playtesting — placeholder curve, monotonically increasing.
const DEFAULT_CONSTRUCTION_POINTS = [100, 180, 280, 400, 550];

// TBD playtesting — placeholder cost curve. Money-only for every building type in this
// branch: money is the only resource a nation can ever hold in Branch A (nothing produces
// iron/oil/etc. until Branch B), so any non-money cost here would make that building
// permanently unbuildable — the same reasoning that justifies seeding starting money at all
// (see GameRoom._initNationEconomy()). Heavier industrial resource costs for production/
// extraction buildings land once Branch B gives nations a way to actually earn them.
function defaultCostByLevel(): Partial<Record<string, number>>[] {
  return [50, 90, 140, 200, 270].map((money) => ({ money }));
}

const STAT_TABLE: Record<string, BuildingStats> = Object.fromEntries(
  BUILDING_TYPES.map((buildingType) => [
    buildingType,
    {
      construction_points_by_level: [...DEFAULT_CONSTRUCTION_POINTS],
      resource_cost_by_level: defaultCostByLevel(),
    },
  ]),
);

export function getBuildingStats(buildingType: string): BuildingStats {
  const stats = STAT_TABLE[buildingType];
  if (!stats) throw new Error(`Unknown building type: ${buildingType}`);
  return stats;
}
