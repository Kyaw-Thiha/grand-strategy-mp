import { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { MISSION_TYPES, WING_LIFECYCLE, AirWingState } from "../rooms/schema/AirWingState.js";
import { getObservationDeg, setPassiveObservationOverrideForTesting } from "../data/air_unit_stats.js";

type BroadcastFn = (type: string, msg: unknown) => void;
type BroadcastToNationFn = (type: string, msg: unknown, nationId: string) => void;

let PASSIVE_WING_RADIUS_DEG = 0.1;
let RECON_WING_RADIUS_DEG = 1.0;
let KM_PER_DEG = 111.32;

export function setPassiveWingRadiusForTesting(v: number): void {
  PASSIVE_WING_RADIUS_DEG = v;
  setPassiveObservationOverrideForTesting(v);
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
  aircraft_type: string;
  position_lng: number;
  position_lat: number;
};

export class AirDetectionSystem {
  private _radars: Map<string, RadarEntry> = new Map();
  private _prevDetected: Map<string, boolean> = new Map();
  private _prevWingDetectedByNation: Map<string, Set<string>> = new Map();
  // wingId → set of nationIds that currently detect this wing
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

  getWingDetectedByNations(wingId: string): Set<string> {
    return this._prevWingDetectedByNation.get(wingId) ?? new Set();
  }

  getVisibleDivisionsForNation(nationId: string): Set<string> {
    return this._prevVisibleDivisions.get(nationId) ?? new Set();
  }

  tick(
    state: GameRoomState,
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

    // ── Air-to-air detection (per-nation) ───────────────────────────────────
    const newWingDetectedByNation = new Map<string, Set<string>>();
    for (const wing of airborneWings) {
      const detectors = new Set<string>();
      for (const [nationId] of state.nations) {
        if (nationId === wing.nation_id) continue;
        if (this._canNationDetectWing(
          nationId, wing.wing_id, wing.nation_id,
          wing.position_lng, wing.position_lat, state, airborneWings,
        )) {
          detectors.add(nationId);
        }
      }
      newWingDetectedByNation.set(wing.wing_id, detectors);
      // Backwards compat: is_detected = detected by any hostile nation
      const detected = detectors.size > 0;
      const wasDetected = this._prevDetected.get(wing.wing_id) ?? false;
      wing.is_detected = detected;
      this._prevDetected.set(wing.wing_id, detected);
      if (detected && !wasDetected) {
        broadcast("WING_DETECTED", { wing_id: wing.wing_id, nation_id: wing.nation_id });
      } else if (!detected && wasDetected) {
        broadcast("WING_LOST_DETECTION", { wing_id: wing.wing_id, nation_id: wing.nation_id });
      }
    }
    this._prevWingDetectedByNation = newWingDetectedByNation;

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
        : getObservationDeg(wing.aircraft_type);

      for (const [divId, div] of state.divisions.entries()) {
        if (div.nation_id === wing.nation_id) continue;
        const dist = euclidDeg(wing.position_lng, wing.position_lat, div.position_lng, div.position_lat);
        if (dist > radius) continue;

        if (!result.has(wing.nation_id)) result.set(wing.nation_id, new Set());
        result.get(wing.nation_id)!.add(divId);
      }
    }

    return result;
  }

  private _canNationDetectWing(
    observerNationId: string,
    wingId: string,
    wingNationId: string,
    wingLng: number,
    wingLat: number,
    state: GameRoomState,
    airborneWingsList: AirborneWingSnapshot[],
  ): boolean {
    // Radar: only this observer's radars count
    for (const radar of this._radars.values()) {
      if (radar.nation_id !== observerNationId) continue;
      if (euclidDeg(wingLng, wingLat, radar.position_lng, radar.position_lat) <= radar.radius_deg)
        return true;
    }
    // Other airborne wings belonging to observerNation
    for (const source of airborneWingsList) {
      if (source.wing_id === wingId) continue;
      if (source.nation_id !== observerNationId) continue;
      const radius = source.mission === MISSION_TYPES.RECON
        ? RECON_WING_RADIUS_DEG
        : getObservationDeg(source.aircraft_type);
      if (euclidDeg(wingLng, wingLat, source.position_lng, source.position_lat) <= radius)
        return true;
    }
    // Ground divisions belonging to observerNation
    for (const division of state.divisions.values()) {
      if (division.nation_id !== observerNationId) continue;
      const radiusDeg = division.observation_radius / KM_PER_DEG;
      if (euclidDeg(wingLng, wingLat, division.position_lng, division.position_lat) <= radiusDeg)
        return true;
    }
    return false;
  }
}
