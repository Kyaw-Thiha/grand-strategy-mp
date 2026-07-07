import { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { MISSION_TYPES, WING_LIFECYCLE } from "../rooms/schema/AirWingState.js";
import type { AirWingLifecycleSystem } from "./air_wing_lifecycle_system.js";

type BroadcastFn = (type: string, msg: unknown) => void;
type BroadcastToNationFn = (type: string, msg: unknown, nationId: string) => void;

let PASSIVE_WING_RADIUS_DEG = 0.1;
let RECON_WING_RADIUS_DEG = 1.0;
let KM_PER_DEG = 111.32;

export function setPassiveWingRadiusForTesting(v: number): void {
  PASSIVE_WING_RADIUS_DEG = v;
}

export function setReconWingRadiusForTesting(v: number): void {
  RECON_WING_RADIUS_DEG = v;
}

export function setKmPerDegForTesting(v: number): void {
  KM_PER_DEG = v;
}

function euclidDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  return Math.sqrt((lng1 - lng2) ** 2 + (lat1 - lat2) ** 2);
}

export interface RadarEntry {
  position_lng: number;
  position_lat: number;
  radius_deg: number;
  nation_id: string;
}

type AirborneWingSnapshot = {
  wing_id: string;
  nation_id: string;
  mission: string;
  position_lng: number;
  position_lat: number;
};

export class AirDetectionSystem {
  private _radars: Map<string, RadarEntry> = new Map();
  private _prevDetected: Map<string, boolean> = new Map();
  private _prevVisibleDivisions: Map<string, Set<string>> = new Map();

  setRadarEntry(provinceId: string, entry: RadarEntry): void {
    if (entry.radius_deg <= 0) {
      this._radars.delete(provinceId);
      return;
    }
    this._radars.set(provinceId, entry);
  }

  clearWing(wingId: string): void {
    this._prevDetected.delete(wingId);
  }

  getVisibleDivisionsForNation(nationId: string): Set<string> {
    return this._prevVisibleDivisions.get(nationId) ?? new Set();
  }

  tick(
    state: GameRoomState,
    lifecycleSystem: AirWingLifecycleSystem,
    broadcast: BroadcastFn,
    broadcastToNation: BroadcastToNationFn,
  ): void {
    const airborne = new Set([
      WING_LIFECYCLE.TRANSIT,
      WING_LIFECYCLE.ENGAGED,
      WING_LIFECYCLE.LOITER,
      WING_LIFECYCLE.RTB,
    ]);

    const airborneWings = [...state.air_wings.values()].filter(wing => airborne.has(wing.lifecycle_state as WING_LIFECYCLE));

    // ── Air-to-air detection ────────────────────────────────────────────────
    for (const wing of airborneWings) {
      const detected = this._isWingDetected(wing.wing_id, wing.nation_id, wing.position_lng, wing.position_lat, state, airborneWings);
      const wasDetected = this._prevDetected.get(wing.wing_id) ?? false;
      wing.is_detected = detected;
      this._prevDetected.set(wing.wing_id, detected);
      if (detected && !wasDetected) {
        broadcast("WING_DETECTED", { wing_id: wing.wing_id, nation_id: wing.nation_id });
      } else if (!detected && wasDetected) {
        broadcast("WING_LOST_DETECTION", { wing_id: wing.wing_id, nation_id: wing.nation_id });
      }
    }

    // ── Interception pursuit trigger ────────────────────────────────────────
    for (const wing of airborneWings) {
      if (wing.lifecycle_state !== WING_LIFECYCLE.LOITER) continue;
      if (wing.mission !== MISSION_TYPES.INTERCEPTION && wing.mission !== MISSION_TYPES.AIR_SUPERIORITY) continue;

      let bestTarget: string | null = null;
      let bestDist = Infinity;
      for (const enemy of airborneWings) {
        if (!this._areNationsHostile(wing.nation_id, enemy.nation_id, state)) continue;
        if (!enemy.is_detected) continue;
        const dist = euclidDeg(wing.position_lng, wing.position_lat, enemy.position_lng, enemy.position_lat);
        if (dist < bestDist) {
          bestDist = dist;
          bestTarget = enemy.wing_id;
        }
      }

      if (bestTarget) {
        lifecycleSystem.startInterceptionPursuit(wing.wing_id, bestTarget, state);
      }
    }

    // ── Stale air-wing detection cleanup ───────────────────────────────────
    for (const [wingId] of this._prevDetected) {
      const wing = state.air_wings.get(wingId);
      if (!wing || !airborne.has(wing.lifecycle_state as WING_LIFECYCLE)) {
        const wasDetected = this._prevDetected.get(wingId) ?? false;
        this._prevDetected.delete(wingId);
        if (wing) {
          wing.is_detected = false;
          if (wasDetected) {
            broadcast("WING_LOST_DETECTION", { wing_id: wing.wing_id, nation_id: wing.nation_id });
          }
        }
      }
    }

    // ── Air-to-ground: division visibility per nation ───────────────────────
    this._tickDivisionVisibility(state, airborneWings, broadcastToNation);
  }

  private _tickDivisionVisibility(
    state: GameRoomState,
    airborneWings: AirborneWingSnapshot[],
    broadcastToNation: BroadcastToNationFn,
  ): void {
    const newVisible = this._computeDivisionVisibility(state, airborneWings);
    if (newVisible.size > 0) {
      for (const [nation, divs] of newVisible) {
        console.log(`[AirDetection] nation=${nation} can see divisions: ${[...divs].join(", ")}`);
      }
    }
    const allNations = new Set([...this._prevVisibleDivisions.keys(), ...newVisible.keys()]);

    for (const nationId of allNations) {
      const prev = this._prevVisibleDivisions.get(nationId) ?? new Set<string>();
      const curr = newVisible.get(nationId) ?? new Set<string>();

      for (const divId of curr) {
        if (!prev.has(divId)) {
          broadcastToNation("DIVISION_REVEALED", { division_id: divId }, nationId);
        }
      }
      for (const divId of prev) {
        if (!curr.has(divId)) {
          broadcastToNation("DIVISION_HIDDEN", { division_id: divId }, nationId);
        }
      }

      if (curr.size > 0) {
        this._prevVisibleDivisions.set(nationId, curr);
      } else {
        this._prevVisibleDivisions.delete(nationId);
      }
    }
  }

  private _computeDivisionVisibility(
    state: GameRoomState,
    airborneWings: AirborneWingSnapshot[],
  ): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();

    for (const wing of airborneWings) {
      const radius = wing.mission === MISSION_TYPES.RECON
        ? RECON_WING_RADIUS_DEG * 2.0
        : RECON_WING_RADIUS_DEG;

      console.log(`[AirDetection] checking wing=${wing.wing_id} nation=${wing.nation_id} pos=(${wing.position_lng.toFixed(3)},${wing.position_lat.toFixed(3)}) radius=${radius}`);

      for (const [divId, div] of state.divisions.entries()) {
        if (div.nation_id === wing.nation_id) continue;
        const dist = euclidDeg(wing.position_lng, wing.position_lat, div.position_lng, div.position_lat);
        if (dist > radius) continue;

        console.log(`[AirDetection] wing=${wing.wing_id} REVEALS div=${divId} nation=${div.nation_id} dist=${dist.toFixed(3)}`);
        if (!result.has(wing.nation_id)) result.set(wing.nation_id, new Set());
        result.get(wing.nation_id)!.add(divId);
      }
    }

    return result;
  }

  private _isWingDetected(
    wingId: string,
    wingNationId: string,
    wingLng: number,
    wingLat: number,
    state: GameRoomState,
    airborneWings: AirborneWingSnapshot[],
  ): boolean {
    for (const radar of this._radars.values()) {
      if (!this._areNationsHostile(radar.nation_id, wingNationId, state)) continue;
      if (euclidDeg(wingLng, wingLat, radar.position_lng, radar.position_lat) <= radar.radius_deg) {
        return true;
      }
    }

    for (const source of airborneWings) {
      if (source.wing_id === wingId) continue;
      if (!this._areNationsHostile(source.nation_id, wingNationId, state)) continue;
      const radius = source.mission === MISSION_TYPES.RECON ? RECON_WING_RADIUS_DEG : PASSIVE_WING_RADIUS_DEG;
      if (euclidDeg(wingLng, wingLat, source.position_lng, source.position_lat) <= radius) {
        return true;
      }
    }

    for (const division of state.divisions.values()) {
      if (division.nation_id === wingNationId) continue; // own divisions don't detect own wings
      const radiusDeg = division.observation_radius / KM_PER_DEG;
      if (euclidDeg(wingLng, wingLat, division.position_lng, division.position_lat) <= radiusDeg) {
        return true;
      }
    }

    return false;
  }

  private _areNationsHostile(nationA: string, nationB: string, state: GameRoomState): boolean {
    if (nationA === nationB) return false;
    const rel = state.relations.get(`${nationA}|${nationB}`) ?? state.relations.get(`${nationB}|${nationA}`);
    return (rel?.stance ?? "neutral") === "war";
  }
}
