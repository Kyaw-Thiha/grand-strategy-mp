import { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { MISSION_TYPES, WING_LIFECYCLE } from "../rooms/schema/AirWingState.js";
import { resolvePattern, type CellSnapshot } from "./air_attack_pattern_registry.js";
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
      position_lng?: number;
      position_lat?: number;
      attacker_nation_id: string;
      defender_nation_id: string;
      runs: unknown[];
    }>();

    for (const wing of bombers) {
      const range = BOMBING_RANGE_DEG * Math.max(0.01, wing.status_instruments);
      const engagement = combatSystem.getEngagementAtPosition(
        wing.position_lng, wing.position_lat, range,
        wing.nation_id,
        state,
      );

      if (!engagement) {
        // Fallback: direct division bombing when target is an idle division
        const targetDiv = wing.target_id ? state.divisions.get(wing.target_id) : undefined;
        if (!targetDiv) continue;

        const dist = euclidDeg(wing.position_lng, wing.position_lat,
                               targetDiv.position_lng, targetDiv.position_lat);
        if (dist > BOMBING_RANGE_DEG) continue;

        const gridCells = (targetDiv as any).grid?.cells as Array<{
          unit_type: string; hp: number; suppression: number; incapacitated: boolean;
        }> | undefined;

        // Build cell snapshots for the pattern registry (same path as engagement bombing)
        const cellSnapshots: CellSnapshot[] = [];
        if (gridCells) {
          for (let i = 0; i < gridCells.length; i++) {
            const c = gridCells[i];
            cellSnapshots.push({
              unit_type: c.unit_type,
              hp: c.hp,
              suppression: c.suppression,
              incapacitated: c.incapacitated,
            });
          }
        }

        const ctx = {
          aircraft_type:          wing.aircraft_type,
          count:                  wing.count,
          combat_readiness:       wing.combat_readiness,
          perk_strafing:          (wing as any).perk_strafing ?? false,
          perk_precision_bombing: (wing as any).perk_precision_bombing ?? false,
          recon_quality:          0.0,
        };
        const result = resolvePattern(cellSnapshots, ctx);

        // Apply damage to actual grid cells
        const hitCells: Array<{
          cell_index: number; unit_type: string;
          hp_damage: number; supp_damage: number;
          hp_after: number; supp_after: number;
        }> = [];
        if (gridCells) {
          for (const hit of result.hit_cells) {
            const cell = gridCells[hit.cell_index];
            const hp_after   = Math.max(0,   cell.hp          - hit.hp_damage);
            const supp_after = Math.min(100, cell.suppression + hit.supp_damage);
            cell.hp          = hp_after;
            cell.suppression = supp_after;
            if (cell.hp <= 0) cell.incapacitated = true;
            hitCells.push({
              cell_index:  hit.cell_index,
              unit_type:   cell.unit_type,
              hp_damage:   hit.hp_damage,
              supp_damage: hit.supp_damage,
              hp_after,
              supp_after,
            });
          }
        }
        const actualDmg = result.total_hp_damage;
        targetDiv.hp = Math.max(0, targetDiv.hp - actualDmg);

        // Full grid snapshot so client can render the formation
        const gridSnapshot: Array<{
          cell_index: number; unit_type: string;
          hp: number; suppression: number; incapacitated: boolean;
        }> = [];
        if (gridCells) {
          for (let i = 0; i < gridCells.length; i++) {
            const c = gridCells[i];
            gridSnapshot.push({
              cell_index: i, unit_type: c.unit_type,
              hp: c.hp, suppression: c.suppression, incapacitated: c.incapacitated,
            });
          }
        }

        const batchKey = "div:" + wing.target_id;
        if (!batchByProvince.has(batchKey)) {
          batchByProvince.set(batchKey, {
            province_id:        batchKey,
            position_lng:       targetDiv.position_lng,
            position_lat:       targetDiv.position_lat,
            attacker_nation_id: wing.nation_id,
            defender_nation_id: targetDiv.nation_id,
            runs: [],
          });
        }
        batchByProvince.get(batchKey)!.runs.push({
          wing_id: wing.wing_id, nation_id: wing.nation_id,
          aircraft_type: wing.aircraft_type, count: wing.count,
          hit_cells: hitCells, grid_snapshot: gridSnapshot,
          pattern_type: result.pattern_type, total_hp_damage: actualDmg,
        });

        wing.combat_readiness = Math.max(READINESS_FLOOR,
          wing.combat_readiness - READINESS_BOMBING_SPIKE);

        lifecycleSystem.resolveEngagement(wing.wing_id, state, broadcast);
        continue;
      }

      // RTB if the target province's defender is now a friendly nation
      if (engagement.defender_nation_id === wing.nation_id) {
        lifecycleSystem.resolveEngagement(wing.wing_id, state, broadcast);
        continue;
      }

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
