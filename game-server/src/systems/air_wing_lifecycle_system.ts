import type { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { MISSION_TYPES, WING_LIFECYCLE, serializeWing } from "../rooms/schema/AirWingState.js";

// ── Module-level mutable constants — mutated ONLY by exported test helpers ───

// Fuel: fast decay defines range; forced RTB when empty; fast recovery at base
let FUEL_DECAY_TRANSIT = 0.02;   // cruise-power engines
let FUEL_DECAY_LOITER  = 0.008;  // throttled back in orbit
let FUEL_RECOVERY_RATE    = 0.20;   // ~5 ticks to full refuel
let FUEL_RTB_THRESHOLD    = 0.10;   // forced RTB below this level
const FUEL_FLOOR          = 0.0;

// Readiness: slow decay scales combat damage; no forced RTB; slow recovery (maintenance)
let READINESS_DECAY_PER_TICK  = 0.003;  // dev: slow for testing
let READINESS_RECOVERY_RATE   = 0.04;
const READINESS_FLOOR         = 0.15;

let WEAPON_COOLDOWN_TICKS          = 3;
let ENGAGEMENT_AUTO_RESOLVE_TICKS  = 2;
let MAX_LOITER_TICKS               = 15;
let RTB_DURATION_TICKS             = 5;
let REFUEL_DURATION_TICKS          = 5;

export function setWeaponCooldownTicksForTesting(n: number): void { WEAPON_COOLDOWN_TICKS = n; }
export function setEngagementAutoResolveTicksForTesting(n: number): void { ENGAGEMENT_AUTO_RESOLVE_TICKS = n; }
export function setMaxLoiterTicksForTesting(n: number): void { MAX_LOITER_TICKS = n; }
export function setRtbDurationTicksForTesting(n: number): void { RTB_DURATION_TICKS = n; }
export function setRefuelDurationTicksForTesting(n: number): void { REFUEL_DURATION_TICKS = n; }
export function setReadinessDecayForTesting(rate: number): void { READINESS_DECAY_PER_TICK = rate; }
export function setReadinessRecoveryForTesting(rate: number): void { READINESS_RECOVERY_RATE = rate; }
export function setFuelDecayForTesting(rate: number): void { FUEL_DECAY_TRANSIT = rate; }
export function setFuelDecayTransitForTesting(rate: number): void { FUEL_DECAY_TRANSIT = rate; }
export function setFuelDecayLoiterForTesting(rate: number): void { FUEL_DECAY_LOITER = rate; }
export function setFuelRecoveryForTesting(rate: number): void { FUEL_RECOVERY_RATE = rate; }
export function setFuelRtbThresholdForTesting(t: number): void { FUEL_RTB_THRESHOLD = t; }

const ENGINE_DECAY_PER_LANDING  = 0.04;
const WEAPONS_DECAY_PER_LANDING = 0.04;
let _landingToggle = false;

export { FUEL_DECAY_TRANSIT, FUEL_DECAY_LOITER, FUEL_RTB_THRESHOLD };

// ── Types ────────────────────────────────────────────────────────────────────

type BroadcastFn = (type: string, msg: unknown) => void;

// ── AirWingLifecycleSystem ───────────────────────────────────────────────────

export class AirWingLifecycleSystem {
  private _engagementTicks:  Map<string, number> = new Map();
  private _loiterTicks:      Map<string, number> = new Map();
  private _refuelTicks:      Map<string, number> = new Map();
  private _weaponCooldown:   Map<string, number> = new Map();
  private _lastEngagedTarget: Map<string, string> = new Map();
  private _pendingRedeployTarget: Map<string, string> = new Map();
  private _pendingMissionAfterRedeploy: Map<string, { mission: string; target_id: string }> = new Map();
  private _pendingTransitAfterRedeploy: Map<string, { lng: number; lat: number }> = new Map();
  private _statusFuel: Map<string, number> = new Map();

  tick(state: GameRoomState, _tickCount: number, broadcast: BroadcastFn): void {
    const changed: string[] = [];

    for (const [wingId, wing] of state.air_wings.entries()) {
      let didChange = false;

      // 1. Fuel + Readiness: decay while airborne, recover while IDLE/REFUEL
      const isAirborne = wing.lifecycle_state !== WING_LIFECYCLE.IDLE
                      && wing.lifecycle_state !== WING_LIFECYCLE.REFUEL;
      const isRelocating = wing.lifecycle_state === WING_LIFECYCLE.RELOCATE;
      if (isAirborne) {
        const prevFuel = wing.fuel;
        const fuelRate = wing.lifecycle_state === WING_LIFECYCLE.LOITER
          ? FUEL_DECAY_LOITER
          : FUEL_DECAY_TRANSIT;
        wing.fuel_decay_rate = fuelRate * wing.status_fuel;
        wing.fuel = Math.max(FUEL_FLOOR, wing.fuel - wing.fuel_decay_rate);
        if (wing.fuel !== prevFuel) didChange = true;
        const prevR = wing.combat_readiness;
        wing.combat_readiness = Math.max(READINESS_FLOOR,
          wing.combat_readiness - READINESS_DECAY_PER_TICK);
        if (wing.combat_readiness !== prevR) didChange = true;
      } else {
        wing.fuel_decay_rate = FUEL_DECAY_TRANSIT;
        const prevFuel = wing.fuel;
        wing.fuel = Math.min(1.0, wing.fuel + FUEL_RECOVERY_RATE);
        if (wing.fuel !== prevFuel) didChange = true;
        const prevR = wing.combat_readiness;
        wing.combat_readiness = Math.min(1.0,
          wing.combat_readiness + READINESS_RECOVERY_RATE);
        if (wing.combat_readiness !== prevR) didChange = true;
      }

      // 2. Weapon cooldown
      const cooldown = this._weaponCooldown.get(wingId) ?? 0;
      if (cooldown > 0) {
        const newCooldown = cooldown - 1;
        this._weaponCooldown.set(wingId, newCooldown);
        if (newCooldown === 0 && !wing.weapon_ready) {
          wing.weapon_ready = true;
          didChange = true;
        }
      }

      // 3. Force RTB if fuel at or below threshold (overrides any airborne state except RELOCATE)
      if (isAirborne && !isRelocating && wing.fuel <= FUEL_RTB_THRESHOLD
          && wing.lifecycle_state !== WING_LIFECYCLE.RTB) {
        wing.lifecycle_state = WING_LIFECYCLE.RTB;
        this._engagementTicks.delete(wingId);
        this._loiterTicks.delete(wingId);
        broadcast("WING_RTB", { wing_id: wingId, nation_id: wing.nation_id, reason: "low_readiness" });
        didChange = true;
      }

      // 4. State-machine tick transitions
      switch (wing.lifecycle_state) {
        case WING_LIFECYCLE.ENGAGED: {
          if (!this._engagementTicks.has(wingId)) {
            this._engagementTicks.set(wingId, 0);
            wing.weapon_ready = false;
            this._weaponCooldown.set(wingId, WEAPON_COOLDOWN_TICKS);
            didChange = true;
          }
          const ticks = (this._engagementTicks.get(wingId) ?? 0) + 1;
          this._engagementTicks.set(wingId, ticks);
          if (ticks >= ENGAGEMENT_AUTO_RESOLVE_TICKS) {
            this.resolveEngagement(wingId, state, broadcast);
            didChange = true;
          }
          break;
        }
        case WING_LIFECYCLE.LOITER: {
          if (wing.target_id !== "") {
            if (_landingToggle) {
              wing.status_engine  = Math.max(0, wing.status_engine  - ENGINE_DECAY_PER_LANDING);
            } else {
              wing.status_weapons = Math.max(0, wing.status_weapons - WEAPONS_DECAY_PER_LANDING);
            }
            _landingToggle = !_landingToggle;
            wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
            this._loiterTicks.delete(wingId);
            didChange = true;
            break;
          }
          const ticks = (this._loiterTicks.get(wingId) ?? 0) + 1;
          this._loiterTicks.set(wingId, ticks);
          const isPatrolMission = wing.mission === MISSION_TYPES.INTERCEPTION
                                || wing.mission === MISSION_TYPES.AIR_SUPERIORITY;
          if (!isPatrolMission && ticks >= MAX_LOITER_TICKS) {
            if (_landingToggle) {
              wing.status_engine  = Math.max(0, wing.status_engine  - ENGINE_DECAY_PER_LANDING);
            } else {
              wing.status_weapons = Math.max(0, wing.status_weapons - WEAPONS_DECAY_PER_LANDING);
            }
            _landingToggle = !_landingToggle;
            wing.lifecycle_state = WING_LIFECYCLE.RTB;
            this._loiterTicks.delete(wingId);
            broadcast("WING_RTB", { wing_id: wingId, nation_id: wing.nation_id, reason: "mission_complete" });
            didChange = true;
          }
          break;
        }
        case WING_LIFECYCLE.RTB: {
          // Path completion drives REFUEL transition via air_dubins_pathfinder.tick()
          break;
        }
        case WING_LIFECYCLE.REFUEL: {
          const ticks = (this._refuelTicks.get(wingId) ?? 0) + 1;
          this._refuelTicks.set(wingId, ticks);
          if (ticks >= REFUEL_DURATION_TICKS) {
            this._refuelTicks.delete(wingId);
            this._statusFuel.set(wingId, 1.0);
            wing.status_fuel = 1.0;
            if (this._pendingRedeployTarget.has(wingId)) {
              wing.lifecycle_state = WING_LIFECYCLE.RELOCATE;
            } else {
              wing.lifecycle_state = WING_LIFECYCLE.IDLE;
              wing.path_gen_id = "";
              const pending = this._pendingMissionAfterRedeploy.get(wingId);
              if (pending) {
                this._pendingMissionAfterRedeploy.delete(wingId);
                this.assignMission(wingId, pending.mission, pending.target_id, state);
              }
            }
            didChange = true;
          }
          break;
        }
      }

      if (didChange) changed.push(wingId);
    }

    if (changed.length > 0) {
      broadcast("AIR_WING_UPDATES", {
        wings: changed.map(id => serializeWing(state.air_wings.get(id)!))
      });
    }
  }

  assignMission(wingId: string, mission: string, targetId: string, state: GameRoomState): boolean {
    const wing = state.air_wings.get(wingId);
    if (!wing) return false;
    if (wing.lifecycle_state === WING_LIFECYCLE.ENGAGED) return false;

    wing.mission    = mission;
    wing.target_id  = targetId;
    if (wing.lifecycle_state === WING_LIFECYCLE.IDLE
     || wing.lifecycle_state === WING_LIFECYCLE.LOITER) {
      wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      this._loiterTicks.delete(wingId);
    }
    return true;
  }

  triggerContact(wingId: string, targetWingId: string, state: GameRoomState): void {
    const wing = state.air_wings.get(wingId);
    if (!wing) return;
    this._lastEngagedTarget.set(wingId, targetWingId);
    if (wing.lifecycle_state !== WING_LIFECYCLE.TRANSIT) return;
    wing.lifecycle_state = WING_LIFECYCLE.ENGAGED;
  }

  startInterceptionPursuit(wingId: string, targetWingId: string, state: GameRoomState): void {
    const wing = state.air_wings.get(wingId);
    if (!wing) return;
    if (wing.lifecycle_state !== WING_LIFECYCLE.LOITER) return;
    if (wing.mission !== MISSION_TYPES.INTERCEPTION && wing.mission !== MISSION_TYPES.AIR_SUPERIORITY) return;

    this._loiterTicks.delete(wingId);
    wing.target_id = targetWingId;
    wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
  }

  resolveEngagement(wingId: string, state: GameRoomState, broadcast: BroadcastFn): void {
    const wing = state.air_wings.get(wingId);
    if (!wing) return;

    this._engagementTicks.delete(wingId);

    if (!wing.perk_multi_sortie) {
      wing.lifecycle_state = WING_LIFECYCLE.RTB;
      broadcast("WING_RTB", { wing_id: wingId, nation_id: wing.nation_id, reason: "mission_complete" });
      return;
    }

    const lastTarget = this._lastEngagedTarget.get(wingId) ?? "";
    const hasNewTarget = wing.target_id !== "" && wing.target_id !== lastTarget;

    if (hasNewTarget) {
      wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
    } else {
      wing.lifecycle_state = WING_LIFECYCLE.LOITER;
      wing.target_id = "";
      this._loiterTicks.set(wingId, 0);
    }
  }

  disbandWing(wingId: string, state: GameRoomState, broadcast: BroadcastFn, messageType = "AIR_WING_DESTROYED"): void {
    const wing = state.air_wings.get(wingId);
    if (!wing) return;

    const nationId = wing.nation_id;
    state.air_wings.delete(wingId);

    this._engagementTicks.delete(wingId);
    this._loiterTicks.delete(wingId);
    this._refuelTicks.delete(wingId);
    this._weaponCooldown.delete(wingId);
    this._lastEngagedTarget.delete(wingId);
    this._pendingRedeployTarget.delete(wingId);
    this._pendingMissionAfterRedeploy.delete(wingId);
    this._pendingTransitAfterRedeploy.delete(wingId);
    this._statusFuel.delete(wingId);

    broadcast(messageType, {
      wing_id: wingId,
      nation_id: nationId,
      destroyed_by_wing_id: "",
    });
  }

  setPerk(wingId: string, perk: string, value: boolean, state: GameRoomState): boolean {
    const wing = state.air_wings.get(wingId);
    if (!wing) return false;
    switch (perk) {
      case "multi_sortie":      wing.perk_multi_sortie      = value; return true;
      case "strafing":          wing.perk_strafing          = value; return true;
      case "extended_range":    wing.perk_extended_range    = value; return true;
      case "precision_bombing": wing.perk_precision_bombing = value; return true;
      default: return false;
    }
  }

  retreatWing(wingId: string, state: GameRoomState, broadcast: BroadcastFn): void {
    const wing = state.air_wings.get(wingId);
    if (!wing) return;
    if (wing.lifecycle_state !== WING_LIFECYCLE.TRANSIT
      && wing.lifecycle_state !== WING_LIFECYCLE.ENGAGED
      && wing.lifecycle_state !== WING_LIFECYCLE.LOITER) {
      return;
    }

    this._engagementTicks.delete(wingId);
    this._loiterTicks.delete(wingId);
    this._pendingRedeployTarget.delete(wingId);
    wing.lifecycle_state = WING_LIFECYCLE.RTB;
    broadcast("WING_RTB", { wing_id: wingId, nation_id: wing.nation_id, reason: "player_retreat" });
  }

  startRedeploy(wingId: string, newProvinceId: string, state: GameRoomState): boolean {
    const wing = state.air_wings.get(wingId);
    if (!wing) return false;
    if (wing.lifecycle_state === WING_LIFECYCLE.RELOCATE) return false;

    // Cancel any queued auto-staging transit/mission so the new destination wins.
    this._pendingTransitAfterRedeploy.delete(wingId);
    this._pendingMissionAfterRedeploy.delete(wingId);
    this._pendingRedeployTarget.set(wingId, newProvinceId);

    if (wing.lifecycle_state === WING_LIFECYCLE.IDLE) {
      wing.lifecycle_state = WING_LIFECYCLE.RELOCATE;
      wing.path_elapsed_ms = 0;
    } else if (wing.lifecycle_state === WING_LIFECYCLE.REFUEL) {
      // Will transition to RELOCATE when REFUEL completes (handled in tick)
    } else {
      // Airborne: force RTB; RELOCATE starts after landing
      if (wing.lifecycle_state !== WING_LIFECYCLE.RTB) {
        wing.lifecycle_state = WING_LIFECYCLE.RTB;
        this._engagementTicks.delete(wingId);
        this._loiterTicks.delete(wingId);
      }
    }
    return true;
  }

  getEngagementTarget(wingId: string): string | null {
    return this._lastEngagedTarget.get(wingId) ?? null;
  }

  startWeaponCooldown(wingId: string, state: GameRoomState): void {
    const wing = state.air_wings.get(wingId);
    if (!wing) return;
    wing.weapon_ready = false;
    this._weaponCooldown.set(wingId, WEAPON_COOLDOWN_TICKS);
  }

  getStatusFuel(wingId: string): number {
    return this._statusFuel.get(wingId) ?? 1.0;
  }

  getPendingRedeployTarget(wingId: string): string | undefined {
    return this._pendingRedeployTarget.get(wingId);
  }

  queueMissionAfterRedeploy(wingId: string, mission: string, target_id: string): void {
    this._pendingMissionAfterRedeploy.set(wingId, { mission, target_id });
  }

  completeRedeploy(wingId: string, state: GameRoomState): void {
    const newProvinceId = this._pendingRedeployTarget.get(wingId);
    if (!newProvinceId) return;

    const wing = state.air_wings.get(wingId);
    if (!wing) return;

    wing.home_airbase_province_id = newProvinceId;
    this._pendingRedeployTarget.delete(wingId);
    this._refuelTicks.set(wingId, 0);
    wing.lifecycle_state = WING_LIFECYCLE.REFUEL;
  }

  isPendingRedeploy(wingId: string): boolean {
    return this._pendingRedeployTarget.has(wingId);
  }

  queueTransitAfterRedeploy(wingId: string, lng: number, lat: number): void {
    this._pendingTransitAfterRedeploy.set(wingId, { lng, lat });
  }

  consumePendingTransitAfterRedeploy(wingId: string): { lng: number; lat: number } | undefined {
    const v = this._pendingTransitAfterRedeploy.get(wingId);
    if (v) this._pendingTransitAfterRedeploy.delete(wingId);
    return v;
  }
}
