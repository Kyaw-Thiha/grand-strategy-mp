import { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { AirWingState, MISSION_TYPES, WING_LIFECYCLE } from "../rooms/schema/AirWingState.js";
import { getAirUnitStats, MAX_FORMATION_BONUS, FORMATION_DENSITY_CAP } from "../data/air_unit_stats.js";
import type { AirWingLifecycleSystem } from "./air_wing_lifecycle_system.js";

type BroadcastFn = (type: string, msg: unknown) => void;

let ATTACK_RANGE_DEG    = 0.3;
let SURPRISE_MULTIPLIER = 2.5;
const READINESS_COMBAT_SPIKE_AIR = 0.12;
const INSTRUMENTS_DECAY_PER_HIT = 0.05;

export function setAttackRangeForTesting(v: number): void      { ATTACK_RANGE_DEG = v; }
export function setSurpriseMultiplierForTesting(v: number): void { SURPRISE_MULTIPLIER = v; }

function euclidDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  return Math.sqrt((lng1 - lng2) ** 2 + (lat1 - lat2) ** 2);
}

const BOMBER_TYPES = new Set(["strategic_bomber", "tactical_bomber", "cas_plane", "dive_bomber"]);
const FIGHTER_TYPES = new Set(["fighter", "heavy_fighter"]);

function scoreTarget(targetType: string, mission: string): number {
  if (mission === MISSION_TYPES.INTERCEPTION)   return BOMBER_TYPES.has(targetType)  ? 10 : 1;
  if (mission === MISSION_TYPES.AIR_SUPERIORITY) return FIGHTER_TYPES.has(targetType) ? 10 : 1;
  return 1;
}

function areHostile(nationA: string, nationB: string, state: GameRoomState): boolean {
  if (nationA === nationB) return false;
  const rel = state.relations.get(`${nationA}|${nationB}`)
    ?? state.relations.get(`${nationB}|${nationA}`);
  return (rel?.stance ?? "neutral") === "war";
}

export class AirCombatSystem {
  tick(state: GameRoomState, lifecycleSystem: AirWingLifecycleSystem, broadcast: BroadcastFn): void {
    const COMBAT_STATES = new Set([WING_LIFECYCLE.TRANSIT, WING_LIFECYCLE.LOITER, WING_LIFECYCLE.ENGAGED]);
    const candidates = [...state.air_wings.values()]
      .filter(w => COMBAT_STATES.has(w.lifecycle_state as WING_LIFECYCLE));

    const pairs = this._findPairs(state, candidates);
    const assignments = this._deconflict(pairs, state);
    for (const [escortId, targetId] of this._findEscortTargets(state, candidates)) {
      if (!assignments.has(escortId)) assignments.set(escortId, targetId);
    }

    const countSnapshots = new Map<string, number>();
    const readinessSnapshots = new Map<string, number>();
    const nationIdSnapshots = new Map<string, string>();
    const aircraftTypeSnapshots = new Map<string, string>();
    for (const wing of state.air_wings.values()) {
      countSnapshots.set(wing.wing_id, wing.count);
      readinessSnapshots.set(wing.wing_id, wing.combat_readiness);
      nationIdSnapshots.set(wing.wing_id, wing.nation_id);
      aircraftTypeSnapshots.set(wing.wing_id, wing.aircraft_type);
    }

    const surpriseMap = new Map<string, boolean>();
    const engagedPairs: Array<[string, string]> = [];

    for (const [attackerWingId, targetWingId] of assignments) {
      const attacker = state.air_wings.get(attackerWingId);
      const target   = state.air_wings.get(targetWingId);
      if (!attacker || !target) continue;

      const isSurprise = target.is_detected === true && attacker.is_detected === false;
      broadcast("AIR_COMBAT_STARTED", { wing_a_id: attackerWingId, wing_b_id: targetWingId, is_surprise: isSurprise });
      surpriseMap.set(attackerWingId, isSurprise);

      this._resolveOneSide(attacker, target, isSurprise,
        countSnapshots.get(attackerWingId) ?? attacker.count,
        readinessSnapshots.get(attackerWingId) ?? attacker.combat_readiness,
        state, lifecycleSystem);

      engagedPairs.push([attackerWingId, targetWingId]);
    }

    const lifecycleProcessed = new Set<string>();
    const broadcastedPairs = new Set<string>();
    for (const [attackerWingId, targetWingId] of engagedPairs) {
      for (const [wingId, otherId] of [[attackerWingId, targetWingId], [targetWingId, attackerWingId]] as [string, string][]) {
        if (lifecycleProcessed.has(wingId)) continue;
        lifecycleProcessed.add(wingId);

        const wing = state.air_wings.get(wingId);
        if (!wing) continue;

        if (wing.count <= 0) {
          broadcast("AIR_WING_DESTROYED", { wing_id: wingId, nation_id: wing.nation_id, destroyed_by_wing_id: otherId });
          lifecycleSystem.disbandWing(wingId, state, broadcast);
        } else {
          lifecycleSystem.triggerContact(wingId, otherId, state);
          lifecycleSystem.resolveEngagement(wingId, state, broadcast);
        }
      }

      const pairKey = [attackerWingId, targetWingId].sort().join("|");
      if (broadcastedPairs.has(pairKey)) continue;
      broadcastedPairs.add(pairKey);

      const aWing = state.air_wings.get(attackerWingId);
      const tWing = state.air_wings.get(targetWingId);
      const aCountBefore = countSnapshots.get(attackerWingId) ?? 0;
      const tCountBefore = countSnapshots.get(targetWingId)   ?? 0;
      broadcast("AIR_COMBAT_ENDED", {
        wing_a_id:            attackerWingId,
        wing_b_id:            targetWingId,
        attacker_destroyed:   !aWing || aWing.count <= 0,
        target_destroyed:     !tWing || tWing.count <= 0,
        wing_a_nation_id:     nationIdSnapshots.get(attackerWingId) ?? "",
        wing_b_nation_id:     nationIdSnapshots.get(targetWingId)   ?? "",
        wing_a_aircraft_type: aircraftTypeSnapshots.get(attackerWingId) ?? "",
        wing_b_aircraft_type: aircraftTypeSnapshots.get(targetWingId)   ?? "",
        wing_a_planes_lost:   Math.max(0, aCountBefore - (aWing?.count ?? 0)),
        wing_b_planes_lost:   Math.max(0, tCountBefore - (tWing?.count ?? 0)),
        is_surprise:          surpriseMap.get(attackerWingId) ?? false,
      });
    }
  }

  private _resolveOneSide(
    attacker: AirWingState, target: AirWingState,
    isSurprise: boolean,
    attackerCountSnapshot: number,
    attackerReadinessSnapshot: number,
    state: GameRoomState, lifecycleSystem: AirWingLifecycleSystem,
  ): void {
    const stats = getAirUnitStats(attacker.aircraft_type);
    let baseValue = attacker.weapon_ready ? stats.attack_vs_air : stats.defense_vs_air;
    if (isSurprise && attacker.weapon_ready && stats.attack_vs_air > 0) {
      baseValue = stats.attack_vs_air * SURPRISE_MULTIPLIER;
    }
    const densityBonus = Math.min(target.count / FORMATION_DENSITY_CAP, 1.0) * MAX_FORMATION_BONUS;
    const raw = baseValue * attackerCountSnapshot * attackerReadinessSnapshot * attacker.status_weapons;
    const damage = Math.floor(raw / (1 + densityBonus));
    target.count = Math.max(0, target.count - damage);
    target.status_instruments = Math.max(0, target.status_instruments - INSTRUMENTS_DECAY_PER_HIT);

    if (attacker.weapon_ready && stats.attack_vs_air > 0 && target.count > 0) {
      target.status_fuel = +(target.status_fuel * 1.5).toFixed(4);
      lifecycleSystem.applyLandingDecay(attacker.wing_id, state);
    }

    if (stats.attack_vs_air > 0) {
      attacker.combat_readiness = Math.max(0, attacker.combat_readiness - READINESS_COMBAT_SPIKE_AIR);
      target.combat_readiness   = Math.max(0, target.combat_readiness   - READINESS_COMBAT_SPIKE_AIR);
    }

    if (attacker.weapon_ready) {
      lifecycleSystem.startWeaponCooldown(attacker.wing_id, state);
    }
  }

  private _findPairs(
    state: GameRoomState, candidates: AirWingState[],
  ): Array<{ attackerWingId: string; targetWingId: string }> {
    const pairs: Array<{ attackerWingId: string; targetWingId: string }> = [];
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i], b = candidates[j];
        if (!areHostile(a.nation_id, b.nation_id, state)) continue;
        if (euclidDeg(a.position_lng, a.position_lat, b.position_lng, b.position_lat) <= ATTACK_RANGE_DEG) {
          pairs.push({ attackerWingId: a.wing_id, targetWingId: b.wing_id });
          pairs.push({ attackerWingId: b.wing_id, targetWingId: a.wing_id });
        }
      }
    }
    return pairs;
  }

  private _deconflict(
    pairs: Array<{ attackerWingId: string; targetWingId: string }>,
    state: GameRoomState,
  ): Map<string, string> {
    const byAttacker = new Map<string, string[]>();
    for (const { attackerWingId, targetWingId } of pairs) {
      if (!byAttacker.has(attackerWingId)) byAttacker.set(attackerWingId, []);
      byAttacker.get(attackerWingId)!.push(targetWingId);
    }

    const claimed    = new Set<string>();
    const result     = new Map<string, string>();

    for (const attackerId of [...byAttacker.keys()].sort()) {
      const attacker = state.air_wings.get(attackerId);
      if (!attacker) continue;
      const targets = (byAttacker.get(attackerId) ?? []).sort((a, b) => {
        const wa = state.air_wings.get(a), wb = state.air_wings.get(b);
        if (!wa || !wb) return 0;
        return scoreTarget(wb.aircraft_type, attacker.mission)
             - scoreTarget(wa.aircraft_type, attacker.mission);
      });
      const chosen = targets.find(t => !claimed.has(t)) ?? targets[0];
      if (chosen) { result.set(attackerId, chosen); claimed.add(chosen); }
    }
    return result;
  }

  private _findEscortTargets(
    state: GameRoomState, candidates: AirWingState[],
  ): Map<string, string> {
    const result = new Map<string, string>();
    for (const escort of candidates) {
      if (escort.mission !== MISSION_TYPES.ESCORT) continue;
      const bomber = state.air_wings.get(escort.target_id);
      if (!bomber) continue;
      for (const enemy of candidates) {
        if (!areHostile(escort.nation_id, enemy.nation_id, state)) continue;
        const distToBomber = euclidDeg(bomber.position_lng, bomber.position_lat,
          enemy.position_lng, enemy.position_lat);
        const distToEscort = euclidDeg(escort.position_lng, escort.position_lat,
          enemy.position_lng, enemy.position_lat);
        if (distToBomber <= ATTACK_RANGE_DEG && distToEscort <= ATTACK_RANGE_DEG) {
          result.set(escort.wing_id, enemy.wing_id);
          break;
        }
      }
    }
    return result;
  }
}
