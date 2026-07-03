import type { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, serializeWing } from "../rooms/schema/AirWingState.js";

// ── Module-level mutable constants — mutated ONLY by exported test helpers ───

let READINESS_DECAY_PER_TICK  = 0.04;
let READINESS_RECOVERY_RATE   = 0.06;
let READINESS_RTB_THRESHOLD   = 0.25;
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

// ── Types ────────────────────────────────────────────────────────────────────

type BroadcastFn = (type: string, msg: unknown) => void;

// ── AirWingLifecycleSystem ───────────────────────────────────────────────────

export class AirWingLifecycleSystem {
  private _engagementTicks:  Map<string, number> = new Map();
  private _loiterTicks:      Map<string, number> = new Map();
  private _rtbTicks:         Map<string, number> = new Map();
  private _refuelTicks:      Map<string, number> = new Map();
  private _weaponCooldown:   Map<string, number> = new Map();
  private _lastEngagedTarget: Map<string, string> = new Map();

  tick(state: GameRoomState, _tickCount: number, broadcast: BroadcastFn): void {
    const changed: string[] = [];

    for (const [wingId, wing] of state.air_wings.entries()) {
      let didChange = false;

      // 1. Readiness: decay while airborne, recover while IDLE/REFUEL
      const isAirborne = wing.lifecycle_state !== WING_LIFECYCLE.IDLE
                      && wing.lifecycle_state !== WING_LIFECYCLE.REFUEL;
      if (isAirborne) {
        const prev = wing.combat_readiness;
        wing.combat_readiness = Math.max(READINESS_FLOOR,
          wing.combat_readiness - READINESS_DECAY_PER_TICK);
        if (wing.combat_readiness !== prev) didChange = true;
      } else {
        const prev = wing.combat_readiness;
        wing.combat_readiness = Math.min(1.0,
          wing.combat_readiness + READINESS_RECOVERY_RATE);
        if (wing.combat_readiness !== prev) didChange = true;
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

      // 3. Force RTB if readiness at or below threshold (overrides any airborne state)
      if (isAirborne && wing.combat_readiness <= READINESS_RTB_THRESHOLD
          && wing.lifecycle_state !== WING_LIFECYCLE.RTB) {
        wing.lifecycle_state = WING_LIFECYCLE.RTB;
        this._rtbTicks.set(wingId, 0);
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
            wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
            this._loiterTicks.delete(wingId);
            didChange = true;
            break;
          }
          const ticks = (this._loiterTicks.get(wingId) ?? 0) + 1;
          this._loiterTicks.set(wingId, ticks);
          if (ticks >= MAX_LOITER_TICKS) {
            wing.lifecycle_state = WING_LIFECYCLE.RTB;
            this._loiterTicks.delete(wingId);
            this._rtbTicks.set(wingId, 0);
            broadcast("WING_RTB", { wing_id: wingId, nation_id: wing.nation_id, reason: "mission_complete" });
            didChange = true;
          }
          break;
        }
        case WING_LIFECYCLE.RTB: {
          const ticks = (this._rtbTicks.get(wingId) ?? 0) + 1;
          this._rtbTicks.set(wingId, ticks);
          if (ticks >= RTB_DURATION_TICKS) {
            wing.lifecycle_state = WING_LIFECYCLE.REFUEL;
            this._rtbTicks.delete(wingId);
            this._refuelTicks.set(wingId, 0);
            didChange = true;
          }
          break;
        }
        case WING_LIFECYCLE.REFUEL: {
          const ticks = (this._refuelTicks.get(wingId) ?? 0) + 1;
          this._refuelTicks.set(wingId, ticks);
          if (ticks >= REFUEL_DURATION_TICKS) {
            wing.lifecycle_state = WING_LIFECYCLE.IDLE;
            this._refuelTicks.delete(wingId);
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
    if (!wing || wing.lifecycle_state !== WING_LIFECYCLE.TRANSIT) return;
    this._lastEngagedTarget.set(wingId, targetWingId);
    wing.lifecycle_state = WING_LIFECYCLE.ENGAGED;
  }

  resolveEngagement(wingId: string, state: GameRoomState, broadcast: BroadcastFn): void {
    const wing = state.air_wings.get(wingId);
    if (!wing) return;

    this._engagementTicks.delete(wingId);

    if (!wing.perk_multi_sortie) {
      wing.lifecycle_state = WING_LIFECYCLE.RTB;
      this._rtbTicks.set(wingId, 0);
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

  disbandWing(wingId: string, state: GameRoomState, broadcast: BroadcastFn): void {
    const wing = state.air_wings.get(wingId);
    if (!wing) return;

    const nationId = wing.nation_id;
    state.air_wings.delete(wingId);

    this._engagementTicks.delete(wingId);
    this._loiterTicks.delete(wingId);
    this._rtbTicks.delete(wingId);
    this._refuelTicks.delete(wingId);
    this._weaponCooldown.delete(wingId);
    this._lastEngagedTarget.delete(wingId);

    broadcast("WING_DESTROYED", {
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
}
