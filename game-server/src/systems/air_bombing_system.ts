import { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { MISSION_TYPES, WING_LIFECYCLE } from "../rooms/schema/AirWingState.js";
import { resolvePattern } from "./air_attack_pattern_registry.js";
import { BOMBING_RANGE_DEG } from "../data/air_bombing_stats.js";
import type { AirWingLifecycleSystem } from "./air_wing_lifecycle_system.js";
import type { CombatSystem } from "./combat_system.js";

type BroadcastFn = (type: string, msg: unknown) => void;
type BroadcastToNationFn = (type: string, msg: unknown, nationId: string) => void;

const BOMBING_MISSIONS = new Set([
  MISSION_TYPES.TACTICAL_BOMBING,
]);

export const READINESS_BOMBING_SPIKE = 0.05;
const READINESS_FLOOR = 0.15;

export function setReadinessBombingSpikeForTesting(n: number): number {
  const old = READINESS_BOMBING_SPIKE;
  (READINESS_BOMBING_SPIKE as number) = n;
  return old;
}

function euclidDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  return Math.sqrt((lng1 - lng2) ** 2 + (lat1 - lat2) ** 2);
}

export class AirBombingSystem {
  tick(
    state: GameRoomState,
    lifecycleSystem: AirWingLifecycleSystem,
    combatSystem: CombatSystem,
    broadcast: BroadcastFn,
    broadcastToNation: BroadcastToNationFn,
  ): void {
    const bombers = [...state.air_wings.values()].filter(w =>
      w.lifecycle_state === WING_LIFECYCLE.LOITER &&
      BOMBING_MISSIONS.has(w.mission as any)
    );

    const batchByProvince = new Map<string, {
      province_id: string;
      attacker_nation_id: string;
      defender_nation_id: string;
      runs: unknown[];
    }>();

    for (const wing of bombers) {
      const engagement = combatSystem.getEngagementAtPosition(
        wing.position_lng, wing.position_lat, BOMBING_RANGE_DEG,
        wing.nation_id,
        state,
      );

      if (!engagement) continue;

      const recon_quality = this._computeReconQuality(wing, state);

      const ctx = {
        aircraft_type:    wing.aircraft_type,
        count:            wing.count,
        combat_readiness: wing.combat_readiness,
        perk_strafing:          (wing as any).perk_strafing ?? false,
        perk_precision_bombing: (wing as any).perk_precision_bombing ?? false,
        recon_quality,
      };

      const result = resolvePattern(engagement.defender_cells, ctx);

      engagement.applyAirStrikeDelta(result.hit_cells);

      const key = engagement.engagement_id;
      if (!batchByProvince.has(key)) {
        batchByProvince.set(key, {
          province_id:        engagement.engagement_id,
          attacker_nation_id: engagement.attacker_nation_id,
          defender_nation_id: engagement.defender_nation_id,
          runs: [],
        });
      }
      batchByProvince.get(key)!.runs.push({
        wing_id:         wing.wing_id,
        nation_id:       wing.nation_id,
        aircraft_type:   wing.aircraft_type,
        count:           wing.count,
        hit_cells:       result.hit_cells,
        pattern_type:    result.pattern_type,
        total_hp_damage: result.total_hp_damage,
      });

      wing.combat_readiness = Math.max(READINESS_FLOOR,
        wing.combat_readiness - READINESS_BOMBING_SPIKE);

      lifecycleSystem.resolveEngagement(wing.wing_id, state, broadcast);
    }

    for (const batch of batchByProvince.values()) {
      broadcastToNation("AIR_BOMBING_RESULT", batch, batch.attacker_nation_id);
      broadcastToNation("AIR_BOMBING_RESULT", batch, batch.defender_nation_id);
    }
  }

  private _computeReconQuality(wing: any, state: GameRoomState): number {
    for (const other of state.air_wings.values()) {
      if (other.nation_id !== wing.nation_id) continue;
      if (other.mission !== MISSION_TYPES.RECON) continue;
      if (other.lifecycle_state !== WING_LIFECYCLE.TRANSIT &&
          other.lifecycle_state !== WING_LIFECYCLE.LOITER) continue;
      const dist = Math.sqrt(
        (other.position_lng - wing.position_lng) ** 2 +
        (other.position_lat - wing.position_lat) ** 2
      );
      if (dist < 1.0) return 0.8;
    }
    return 0.0;
  }
}
