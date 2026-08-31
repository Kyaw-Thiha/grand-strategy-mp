import { getBuildingStats } from "../data/building_stats.js";

export interface ConstructionProjectData {
  building_type: string;
  target_level: number;          // level being constructed TOWARD (current_level + 1)
  points_remaining: number;      // counts down to 0
  points_total: number;          // for progress % display
}

// Server-side only, not part of Colyseus schema — mirrors DivisionState.grid's precedent.
// Synced to clients via explicit PROVINCE_ECONOMY_INIT / BUILDING_UPDATES broadcasts instead
// of native schema reactivity (18-key-times-every-province is too sparse a surface for it).
export interface ProvinceEconomyData {
  province_id: string;
  buildings: Record<string, number>;          // building_type -> current level, 0 = not built
  resource_deposits: Record<string, number>;  // resource_type -> abundance, read-only after init
  construction_queue: ConstructionProjectData[];
}

const MAX_BUILDING_LEVEL = 5;

// TBD playtesting — placeholder curve.
const BASE_CONSTRUCTION_RATE_MIN = 1.0;
const BASE_CONSTRUCTION_RATE_RANGE = 2.0;

function baseConstructionRate(infrastructureLevel: number): number {
  return BASE_CONSTRUCTION_RATE_MIN + (infrastructureLevel / 100) * BASE_CONSTRUCTION_RATE_RANGE;
}

export class EconomyBuildingSystem {
  private provinceEconomy = new Map<string, ProvinceEconomyData>();

  init(provinceId: string, buildings: Record<string, number>, resourceDeposits: Record<string, number>): void {
    this.provinceEconomy.set(provinceId, {
      province_id: provinceId,
      buildings,
      resource_deposits: resourceDeposits,
      construction_queue: [],
    });
  }

  getAll(): Map<string, ProvinceEconomyData> {
    return this.provinceEconomy;
  }

  get(provinceId: string): ProvinceEconomyData | undefined {
    return this.provinceEconomy.get(provinceId);
  }

  /**
   * Starts construction toward the next level of buildingType in provinceId. Returns null
   * (no-op) if the province doesn't exist, the building is already under construction, or
   * it's already at the level cap — caller (BUILD_BUILDING handler) is responsible for the
   * resource-cost check before calling this.
   */
  startConstruction(provinceId: string, buildingType: string, infrastructureLevel: number): ConstructionProjectData | null {
    const econ = this.provinceEconomy.get(provinceId);
    if (!econ) return null;
    if (econ.construction_queue.some((p) => p.building_type === buildingType)) return null;
    const currentLevel = econ.buildings[buildingType] ?? 0;
    if (currentLevel >= MAX_BUILDING_LEVEL) return null;

    const stats = getBuildingStats(buildingType);
    const points = stats.construction_points_by_level[currentLevel];
    const project: ConstructionProjectData = {
      building_type: buildingType,
      target_level: currentLevel + 1,
      points_remaining: points,
      points_total: points,
    };
    econ.construction_queue.push(project);
    return project;
  }

  /**
   * Called once per gameTick. Every building slot in a province progresses independently and
   * in parallel — there is no shared local construction capacity within a province (unlike
   * Naval's repair/construction slot-sharing, which is a documented special case elsewhere).
   *
   * `industryConstructionMultiplier` is a per-nation lookup (Branch B — the Industry Pool's
   * "construction speed" slice is allocated per-nation, not globally, so a single flat number
   * can't be correct once more than one nation exists). Branch A hardcoded 1.0 for everyone;
   * pass `() => 1.0` to preserve that behavior.
   *
   * Broadcasts BUILDING_UPDATES on every tick a province has a non-empty construction_queue
   * (not only on completion), so client progress bars advance visibly every tick.
   */
  tick(
    provinces: { get(provinceId: string): { infrastructure: number; owner_id: string } | undefined },
    industryConstructionMultiplier: (ownerNationId: string) => number,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    for (const [provinceId, econ] of this.provinceEconomy) {
      if (econ.construction_queue.length === 0) continue;

      const province = provinces.get(provinceId);
      const infra = province?.infrastructure ?? 50;
      const rate = baseConstructionRate(infra) * industryConstructionMultiplier(province?.owner_id ?? "");

      for (const project of econ.construction_queue) {
        project.points_remaining = Math.max(0, project.points_remaining - rate);
        if (project.points_remaining <= 0) {
          econ.buildings[project.building_type] = project.target_level;
        }
      }
      econ.construction_queue = econ.construction_queue.filter((p) => p.points_remaining > 0);

      broadcast("BUILDING_UPDATES", {
        province_id: provinceId,
        buildings: econ.buildings,
        construction_queue: econ.construction_queue,
      });
    }
  }
}
