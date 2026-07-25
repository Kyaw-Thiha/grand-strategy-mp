import { GameRoomState, ProvinceState } from "../rooms/schema/GameRoomState.js";
import { MISSION_TYPES, WING_LIFECYCLE } from "../rooms/schema/AirWingState.js";
import {
  getProvinceBombingStats, BOMBING_RANGE_DEG, OIL_DEBUFF_DURATION_MS,
} from "../data/air_bombing_stats.js";
import type { AirWingLifecycleSystem } from "./air_wing_lifecycle_system.js";
import type { ProvinceAaSystem }       from "./air_province_aa_system.js";

type BroadcastFn         = (type: string, msg: unknown) => void;
type BroadcastToNationFn = (type: string, msg: unknown, nationId: string) => void;

const STRATEGIC_MISSIONS = new Set([
  MISSION_TYPES.AREA,
  MISSION_TYPES.INDUSTRY,
  MISSION_TYPES.OIL,
  MISSION_TYPES.LOGISTICS,
]);

let DAMAGE_SCALE = 1.0;
export function setProvinceBombingDamageForTesting(scale: number): void {
  DAMAGE_SCALE = scale;
}

function euclidDeg(
  lng1: number, lat1: number, lng2: number, lat2: number,
): number {
  return Math.sqrt((lng1 - lng2) ** 2 + (lat1 - lat2) ** 2);
}

export class AirStrategicBombingSystem {
  constructor(
    private readonly _cityPositions: Map<string, { lng: number; lat: number }>,
  ) {}

  tick(
    state:             GameRoomState,
    lifecycleSystem:   AirWingLifecycleSystem,
    aaSystem:          ProvinceAaSystem,
    broadcast:         BroadcastFn,
    broadcastToNation: BroadcastToNationFn,
  ): void {
    const bombers = [...state.air_wings.values()].filter(w =>
      w.lifecycle_state === WING_LIFECYCLE.LOITER &&
      STRATEGIC_MISSIONS.has(w.mission as any),
    );

    for (const wing of bombers) {
      const target = this._findTargetProvince(wing, state);
      if (!target) continue;
      const [provinceId, province] = target;

      if (province.owner_id === wing.nation_id) continue;

      if (wing.mission === MISSION_TYPES.LOGISTICS) {
        lifecycleSystem.resolveWingBombed(wing.wing_id, state, broadcast);
        continue;
      }

      const aaDamage = aaSystem.computeAaDamage(
        provinceId, wing.aircraft_type, wing.count,
      );
      if (aaDamage > 0) {
        wing.count = Math.max(0, wing.count - aaDamage);
        broadcast("PROVINCE_AA_FIRED", {
          province_id:  provinceId,
          wing_id:      wing.wing_id,
          damage_dealt: aaDamage,
        });
      }

      if (wing.count <= 0) {
        lifecycleSystem.resolveWingBombed(wing.wing_id, state, broadcast);
        continue;
      }

      const industryBefore       = province.industry;
      const populationBefore     = province.population;
      const infrastructureBefore = province.infrastructure;

      const stats = getProvinceBombingStats(wing.aircraft_type);
      const effectiveness = wing.count * wing.combat_readiness * DAMAGE_SCALE;

      if (wing.mission === MISSION_TYPES.AREA) {
        province.population     = Math.max(0,
          province.population     - stats.population_damage     * effectiveness);
        province.infrastructure = Math.max(0,
          province.infrastructure - stats.infrastructure_damage * effectiveness);
      } else if (wing.mission === MISSION_TYPES.INDUSTRY) {
        province.industry = Math.max(0,
          province.industry - stats.industry_damage * effectiveness);
      } else if (wing.mission === MISSION_TYPES.OIL) {
        province.oil_bombed_until_ms = Date.now() + OIL_DEBUFF_DURATION_MS;
      }

      const resultMsg = {
        province_id:              provinceId,
        mission:                  wing.mission,
        attacker_nation_id:       wing.nation_id,
        defender_nation_id:       province.owner_id,
        wing_id:                  wing.wing_id,
        aircraft_type:            wing.aircraft_type,
        count:                    wing.count,
        industry:                 province.industry,
        population:               province.population,
        infrastructure:           province.infrastructure,
        oil_bombed_until_ms:      province.oil_bombed_until_ms,
        industry_before:          industryBefore,
        population_before:        populationBefore,
        infrastructure_before:    infrastructureBefore,
      };
      broadcastToNation("AIR_BOMBING_PROVINCE_RESULT", resultMsg, wing.nation_id);
      broadcastToNation("AIR_BOMBING_PROVINCE_RESULT", resultMsg, province.owner_id);

      lifecycleSystem.resolveWingBombed(wing.wing_id, state, broadcast);
    }
  }

  private _findTargetProvince(
    wing: { position_lng: number; position_lat: number; target_id: string },
    state: GameRoomState,
  ): [string, ProvinceState] | null {
    const direct = state.provinces.get(wing.target_id);
    if (direct) {
      const pos = this._cityPositions.get(wing.target_id);
      if (pos && euclidDeg(
        wing.position_lng, wing.position_lat, pos.lng, pos.lat,
      ) <= BOMBING_RANGE_DEG) {
        return [wing.target_id, direct];
      }
    }

    let best: [string, ProvinceState] | null = null;
    let bestDist = Infinity;
    for (const [pid, pos] of this._cityPositions) {
      const prov = state.provinces.get(pid);
      if (!prov) continue;
      const dist = euclidDeg(
        wing.position_lng, wing.position_lat, pos.lng, pos.lat,
      );
      if (dist <= BOMBING_RANGE_DEG && dist < bestDist) {
        bestDist = dist;
        best = [pid, prov];
      }
    }
    return best;
  }
}
