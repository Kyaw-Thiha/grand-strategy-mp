import { randomUUID } from "crypto";
import type { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { MISSION_TYPES, WING_LIFECYCLE, serializeWing } from "../rooms/schema/AirWingState.js";
import type { AirWingState } from "../rooms/schema/AirWingState.js";
import { AirWingLifecycleSystem } from "./air_wing_lifecycle_system.js";
import { AirSpatialBucket } from "./air_spatial_bucket.js";
import { getAirUnitStats } from "../data/air_unit_stats.js";

type BroadcastFn = (type: string, msg: unknown) => void;

export interface DubinsSegment {
  type: "arc" | "straight";
  length_deg: number;
  start_lng?: number;
  start_lat?: number;
  end_lng?: number;
  end_lat?: number;
  heading_compass_deg?: number;
  center_lng?: number;
  center_lat?: number;
  radius_deg?: number;
  start_angle_rad?: number;
  sweep_rad?: number;
}

export interface DubinsPath {
  path_gen_id: string;
  path_type: string;
  segments: DubinsSegment[];
  total_length_deg: number;
  start_lng: number;
  start_lat: number;
  start_heading_compass_deg: number;
  end_lng: number;
  end_lat: number;
  end_heading_compass_deg: number;
  turn_radius_deg: number;
  speed_deg_per_ms: number;
}

export interface WingPosition {
  lng: number;
  lat: number;
  heading_compass_deg: number;
}

export interface AirWingPathMessage extends DubinsPath {
  wing_id: string;
  timestamp_ms?: number;
}

let WING_SPEED_DEG_PER_MS = 0.0002;
let WING_TURN_RADIUS_DEG = 0.3;
let ENGAGEMENT_RANGE_DEG = 0.3;

export function setWingSpeedForTesting(v: number): void { WING_SPEED_DEG_PER_MS = v; }
export function setTurnRadiusForTesting(v: number): void { WING_TURN_RADIUS_DEG = v; }
export function setEngagementRangeForTesting(v: number): void { ENGAGEMENT_RANGE_DEG = v; }

// ── Lost-contact tracking ──────────────────────────────────────────────────────
const _lastKnownPositions = new Map<string, { lng: number; lat: number }>();
const _manualTargets = new Map<string, string>(); // interceptor wing_id → target wing_id
const _lostContactLoiterTicks = new Map<string, number>(); // interceptor wing_id → tick count

let LOST_CONTACT_LOITER_TICKS = 5;
export function setLostContactLoiterTicksForTesting(n: number): void {
  LOST_CONTACT_LOITER_TICKS = n;
}

export function registerManualTarget(interceptorId: string, targetId: string): void {
  _manualTargets.set(interceptorId, targetId);
}

export function clearManualTarget(interceptorId: string): void {
  _manualTargets.delete(interceptorId);
  _lostContactLoiterTicks.delete(interceptorId);
}
// ────────────────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeCompassDeg(value: number): number {
  return ((value % 360) + 360) % 360;
}

function degToRad(value: number): number {
  return value * Math.PI / 180;
}

function radToDeg(value: number): number {
  return value * 180 / Math.PI;
}

function compassToMathRad(compassDeg: number): number {
  return degToRad(90 - compassDeg);
}

function mathToCompassDeg(mathRad: number): number {
  return normalizeCompassDeg(90 - radToDeg(mathRad));
}

function vectorFromCompass(compassDeg: number): { x: number; y: number } {
  const angle = compassToMathRad(compassDeg);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function bearingCompassDeg(from: { lng: number; lat: number }, to: { lng: number; lat: number }): number {
  return mathToCompassDeg(Math.atan2(to.lat - from.lat, to.lng - from.lng));
}

function distance(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  return Math.sqrt((a.lng - b.lng) ** 2 + (a.lat - b.lat) ** 2);
}

function pointAtDistanceAndHeading(origin: { lng: number; lat: number }, headingCompassDeg: number, distanceDeg: number): { lng: number; lat: number } {
  const vec = vectorFromCompass(headingCompassDeg);
  return {
    lng: origin.lng + vec.x * distanceDeg,
    lat: origin.lat + vec.y * distanceDeg,
  };
}

function cubicBezierPoint(
  p0: { lng: number; lat: number },
  p1: { lng: number; lat: number },
  p2: { lng: number; lat: number },
  p3: { lng: number; lat: number },
  t: number,
): { lng: number; lat: number } {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    lng: (uuu * p0.lng) + (3 * uu * t * p1.lng) + (3 * u * tt * p2.lng) + (ttt * p3.lng),
    lat: (uuu * p0.lat) + (3 * uu * t * p1.lat) + (3 * u * tt * p2.lat) + (ttt * p3.lat),
  };
}

function cubicBezierDerivative(
  p0: { lng: number; lat: number },
  p1: { lng: number; lat: number },
  p2: { lng: number; lat: number },
  p3: { lng: number; lat: number },
  t: number,
): { lng: number; lat: number } {
  const u = 1 - t;
  return {
    lng: 3 * u * u * (p1.lng - p0.lng) + 6 * u * t * (p2.lng - p1.lng) + 3 * t * t * (p3.lng - p2.lng),
    lat: 3 * u * u * (p1.lat - p0.lat) + 6 * u * t * (p2.lat - p1.lat) + 3 * t * t * (p3.lat - p2.lat),
  };
}

function buildSmoothPath(
  startPos: { lng: number; lat: number },
  startHeadingCompassDeg: number,
  endPos: { lng: number; lat: number },
  endHeadingCompassDeg: number,
  pathType: string,
  turnRadiusDeg: number,
): DubinsPath {
  const pathGenId = randomUUID();
  const directDistance = distance(startPos, endPos);
  const bearingToTarget = bearingCompassDeg(startPos, endPos);
  let headingDelta = bearingToTarget - startHeadingCompassDeg;
  if (headingDelta > 180) headingDelta -= 360;
  if (headingDelta < -180) headingDelta += 360;
  const needsHardTurn = Math.abs(headingDelta) > 90;

  const controlLength = directDistance <= 0.0001 || needsHardTurn
    ? 0.0
    : clamp(directDistance * 0.12, Math.max(turnRadiusDeg * 0.01, 0.001), directDistance / 3);

  const turnPoint = pointAtDistanceAndHeading(startPos, startHeadingCompassDeg, controlLength);
  const segments: DubinsSegment[] = [];
  let totalLength = 0;

  const firstLegLength = distance(startPos, turnPoint);
  if (firstLegLength > 0) {
    segments.push({
      type: "straight",
      length_deg: firstLegLength,
      start_lng: startPos.lng,
      start_lat: startPos.lat,
      end_lng: turnPoint.lng,
      end_lat: turnPoint.lat,
      heading_compass_deg: startHeadingCompassDeg,
    });
    totalLength += firstLegLength;
  }

  const secondLegLength = distance(turnPoint, endPos);
  if (secondLegLength > 0) {
    segments.push({
      type: "straight",
      length_deg: secondLegLength,
      start_lng: turnPoint.lng,
      start_lat: turnPoint.lat,
      end_lng: endPos.lng,
      end_lat: endPos.lat,
      heading_compass_deg: bearingCompassDeg(turnPoint, endPos),
    });
    totalLength += secondLegLength;
  }

  return {
    path_gen_id: pathGenId,
    path_type: pathType,
    segments,
    total_length_deg: totalLength,
    start_lng: startPos.lng,
    start_lat: startPos.lat,
    start_heading_compass_deg: normalizeCompassDeg(startHeadingCompassDeg),
    end_lng: endPos.lng,
    end_lat: endPos.lat,
    end_heading_compass_deg: normalizeCompassDeg(endHeadingCompassDeg),
    turn_radius_deg: turnRadiusDeg,
    speed_deg_per_ms: WING_SPEED_DEG_PER_MS,
  };
}

function makeArcSegment(
  centerPos: { lng: number; lat: number },
  radiusDeg: number,
  startAngleRad: number,
  sweepRad: number,
): DubinsSegment {
  return {
    type: "arc",
    length_deg: Math.abs(radiusDeg * sweepRad),
    center_lng: centerPos.lng,
    center_lat: centerPos.lat,
    radius_deg: radiusDeg,
    start_angle_rad: startAngleRad,
    sweep_rad: sweepRad,
  };
}

export class DubinsPathfinder {
  private _activePaths: Map<string, DubinsPath> = new Map();

  defaultTurnRadius(): number { return WING_TURN_RADIUS_DEG; }

  storePath(wingId: string, path: DubinsPath): void {
    this._activePaths.set(wingId, path);
  }

  clearPath(wingId: string): void {
    this._activePaths.delete(wingId);
  }

  hasPath(wingId: string): boolean {
    return this._activePaths.has(wingId);
  }

  getPath(wingId: string): DubinsPath | undefined {
    return this._activePaths.get(wingId);
  }

  computeTransitPath(
    startPos: { lng: number; lat: number },
    startHeadingCompassDeg: number,
    endPos: { lng: number; lat: number },
    turnRadiusDeg?: number,
  ): DubinsPath {
    const endHeading = bearingCompassDeg(startPos, endPos);
    return buildSmoothPath(startPos, startHeadingCompassDeg, endPos, endHeading, "TRANSIT", turnRadiusDeg ?? WING_TURN_RADIUS_DEG);
  }

  computeRtbPath(
    startPos: { lng: number; lat: number },
    startHeadingCompassDeg: number,
    airbasePos: { lng: number; lat: number },
    airbaseEntryHeadingCompassDeg: number,
    turnRadiusDeg?: number,
  ): DubinsPath {
    return buildSmoothPath(startPos, startHeadingCompassDeg, airbasePos, airbaseEntryHeadingCompassDeg, "RTB", turnRadiusDeg ?? WING_TURN_RADIUS_DEG);
  }

  computeLoiterArc(
    entryPos: { lng: number; lat: number },
    entryHeadingCompassDeg: number,
    radiusDeg: number,
  ): DubinsPath {
    // Convert compass heading to math radians (east=0, CCW positive)
    const mathHeadingRad = (90 - entryHeadingCompassDeg) * (Math.PI / 180);
    // Circle center is 90° left (CCW) of travel direction
    const perpRad = mathHeadingRad + Math.PI / 2;
    const centerPos = {
      lng: entryPos.lng + radiusDeg * Math.cos(perpRad),
      lat: entryPos.lat + radiusDeg * Math.sin(perpRad),
    };
    // Arc starts at entryPos: angle from center to entry = opposite of center offset
    const startAngleRad = perpRad + Math.PI;
    const segment = makeArcSegment(centerPos, radiusDeg, startAngleRad, 2 * Math.PI);

    const startLng = centerPos.lng + radiusDeg * Math.cos(startAngleRad); // = entryPos.lng
    const startLat = centerPos.lat + radiusDeg * Math.sin(startAngleRad); // = entryPos.lat
    const startHeading = normalizeCompassDeg(mathToCompassDeg(startAngleRad + Math.PI / 2));

    return {
      path_gen_id: randomUUID(),
      path_type: "LOITER",
      segments: [segment],
      total_length_deg: segment.length_deg,
      start_lng: startLng,
      start_lat: startLat,
      start_heading_compass_deg: startHeading,
      end_lng: startLng,
      end_lat: startLat,
      end_heading_compass_deg: startHeading,
      turn_radius_deg: radiusDeg,
      speed_deg_per_ms: WING_SPEED_DEG_PER_MS,
    };
  }

  computePursuitPath(
    startPos: { lng: number; lat: number },
    startHeadingCompassDeg: number,
    targetPos: { lng: number; lat: number },
    targetVelocityDegPerMs: { dlng: number; dlat: number },
  ): DubinsPath {
    const directDistance = distance(startPos, targetPos);
    const leadTimeMs = clamp(directDistance / Math.max(WING_SPEED_DEG_PER_MS, 0.000001), 1_000, 8_000);
    const leadTarget = {
      lng: targetPos.lng + (targetVelocityDegPerMs.dlng * leadTimeMs),
      lat: targetPos.lat + (targetVelocityDegPerMs.dlat * leadTimeMs),
    };
    return this.computeTransitPath(startPos, startHeadingCompassDeg, leadTarget);
  }

  evaluatePosition(path: DubinsPath, elapsedMs: number): WingPosition {
    if (elapsedMs <= 0) {
      return {
        lng: path.start_lng,
        lat: path.start_lat,
        heading_compass_deg: path.start_heading_compass_deg,
      };
    }

    const distanceCovered = clamp(elapsedMs * path.speed_deg_per_ms, 0, path.total_length_deg);
    let remaining = distanceCovered;
    let lastPoint = { lng: path.start_lng, lat: path.start_lat };

    for (const segment of path.segments) {
      if (remaining <= segment.length_deg) {
        if (segment.type === "arc") {
          const radius = segment.radius_deg ?? 0;
          const startAngle = segment.start_angle_rad ?? 0;
          const sweep = segment.sweep_rad ?? 0;
          const travelled = radius > 0 ? remaining / radius : 0;
          const signedTravel = sweep >= 0 ? travelled : -travelled;
          const angle = startAngle + signedTravel;
          const centerLng = segment.center_lng ?? 0;
          const centerLat = segment.center_lat ?? 0;
          const tangentHeading = normalizeCompassDeg(
            mathToCompassDeg(angle + (sweep >= 0 ? Math.PI / 2 : -Math.PI / 2))
          );
          return {
            lng: centerLng + (radius * Math.cos(angle)),
            lat: centerLat + (radius * Math.sin(angle)),
            heading_compass_deg: tangentHeading,
          };
        }

        const startLng = segment.start_lng ?? lastPoint.lng;
        const startLat = segment.start_lat ?? lastPoint.lat;
        const endLng = segment.end_lng ?? startLng;
        const endLat = segment.end_lat ?? startLat;
        const t = segment.length_deg > 0 ? remaining / segment.length_deg : 1;
        return {
          lng: startLng + ((endLng - startLng) * t),
          lat: startLat + ((endLat - startLat) * t),
          heading_compass_deg: segment.heading_compass_deg ?? bearingCompassDeg({ lng: startLng, lat: startLat }, { lng: endLng, lat: endLat }),
        };
      }

      remaining -= segment.length_deg;
      lastPoint = {
        lng: segment.end_lng ?? lastPoint.lng,
        lat: segment.end_lat ?? lastPoint.lat,
      };
    }

    return {
      lng: path.end_lng,
      lat: path.end_lat,
      heading_compass_deg: path.end_heading_compass_deg,
    };
  }

  sweepCheck(
    pathA: DubinsPath,
    pathAElapsedMs: number,
    pathB: DubinsPath,
    pathBElapsedMs: number,
    engagementRangeDeg: number,
    windowMs: number,
  ): boolean {
    const sampleCount = 41;
    const maxIndex = sampleCount - 1;
    for (let i = 0; i < sampleCount; i++) {
      const fraction = maxIndex > 0 ? i / maxIndex : 0;
      const posA = this.evaluatePosition(pathA, pathAElapsedMs + (fraction * windowMs));
      const posB = this.evaluatePosition(pathB, pathBElapsedMs + (fraction * windowMs));
      if (distance(posA, posB) <= engagementRangeDeg) return true;
    }
    return false;
  }

  advanceWingOnePath(wing: AirWingState, tickMs: number): void {
    const path = this._activePaths.get(wing.wing_id);
    if (!path) return;
    wing.path_elapsed_ms += tickMs * Math.max(0.01, wing.status_engine);
    if (path.path_type === "LOITER") {
      const period = path.speed_deg_per_ms > 0 ? path.total_length_deg / path.speed_deg_per_ms : 0;
      if (period > 0) wing.path_elapsed_ms = wing.path_elapsed_ms % period;
    }
    const pos = this.evaluatePosition(path, wing.path_elapsed_ms);
    wing.position_lng  = pos.lng;
    wing.position_lat  = pos.lat;
    wing.heading_deg   = pos.heading_compass_deg;
  }

  tick(
    state: GameRoomState,
    tickMs: number,
    spatialBucket: AirSpatialBucket,
    lifecycleSystem: AirWingLifecycleSystem,
    broadcast: BroadcastFn,
  ): void {
    for (const wing of state.air_wings.values()) {
      const path = this._activePaths.get(wing.wing_id);
      if (!path) continue;

      // Stale loiter path: wing left LOITER state via direct mutation without going through lifecycle.
      // Clear rather than silently moving the wing along the wrong arc.
      if (path.path_type === "LOITER" && wing.lifecycle_state !== WING_LIFECYCLE.LOITER) {
        this.clearPath(wing.wing_id);
        wing.path_gen_id = "";
        wing.path_elapsed_ms = 0;
        continue;
      }

      wing.path_elapsed_ms += tickMs * Math.max(0.01, wing.status_engine);

      if (path.path_type === "LOITER") {
        const loiterPeriodMs = path.total_length_deg / Math.max(path.speed_deg_per_ms, 0.000001);
        wing.path_elapsed_ms = loiterPeriodMs > 0 ? wing.path_elapsed_ms % loiterPeriodMs : 0;
      }

      const position = this.evaluatePosition(path, wing.path_elapsed_ms);
      wing.position_lng = position.lng;
      wing.position_lat = position.lat;
      wing.heading_deg = position.heading_compass_deg;
    }

    // Sync escort wings to their bomber's path so the client renders them co-located
    for (const escort of state.air_wings.values()) {
      if (escort.mission !== MISSION_TYPES.ESCORT) continue;
      if (escort.lifecycle_state !== WING_LIFECYCLE.TRANSIT &&
          escort.lifecycle_state !== WING_LIFECYCLE.LOITER) continue;
      const bomber = state.air_wings.get(escort.target_id);
      if (!bomber || !bomber.path_gen_id) continue;
      escort.path_gen_id     = bomber.path_gen_id;
      escort.path_elapsed_ms = bomber.path_elapsed_ms;
    }

    spatialBucket.clear();
    for (const wing of state.air_wings.values()) {
      if (wing.lifecycle_state !== WING_LIFECYCLE.TRANSIT && wing.lifecycle_state !== WING_LIFECYCLE.ENGAGED) {
        continue;
      }
      spatialBucket.add(wing.wing_id, wing.position_lng, wing.position_lat);
    }

    const processedContactPairs = new Set<string>();
    for (const [wingIdA, wingIdB] of spatialBucket.getLocalPairs()) {
      const wingA = state.air_wings.get(wingIdA);
      const wingB = state.air_wings.get(wingIdB);
      if (!wingA || !wingB) continue;
      if (wingA.nation_id === wingB.nation_id) continue;
      if (wingA.lifecycle_state !== WING_LIFECYCLE.TRANSIT || wingB.lifecycle_state !== WING_LIFECYCLE.TRANSIT) continue;
      const pairKey = wingIdA < wingIdB ? `${wingIdA}|${wingIdB}` : `${wingIdB}|${wingIdA}`;
      if (processedContactPairs.has(pairKey)) continue;
      processedContactPairs.add(pairKey);

      const pathA = this._activePaths.get(wingIdA);
      const pathB = this._activePaths.get(wingIdB);

      const fakePathForWing = (wing: any): DubinsPath => ({
        path_gen_id: wing.wing_id,
        path_type: "TRANSIT",
        segments: [],
        total_length_deg: 0,
        start_lng: wing.position_lng,
        start_lat: wing.position_lat,
        start_heading_compass_deg: wing.heading_deg,
        end_lng: wing.position_lng,
        end_lat: wing.position_lat,
        end_heading_compass_deg: wing.heading_deg,
        turn_radius_deg: 0.05,
        speed_deg_per_ms: 0.0001,
      });

      if (this.sweepCheck(
        pathA ?? fakePathForWing(wingA),
        pathA ? wingA.path_elapsed_ms - tickMs : 0,
        pathB ?? fakePathForWing(wingB),
        pathB ? wingB.path_elapsed_ms - tickMs : 0,
        ENGAGEMENT_RANGE_DEG,
        tickMs,
      )) {
        lifecycleSystem.triggerContact(wingIdA, wingIdB, state);
        lifecycleSystem.triggerContact(wingIdB, wingIdA, state);
      }
    }

    for (const wing of state.air_wings.values()) {
      const path = this._activePaths.get(wing.wing_id);
      if (!path) continue;
      if (path.path_type === "LOITER") continue;

      const pathDurationMs = path.total_length_deg / Math.max(path.speed_deg_per_ms, 0.000001);
      if (wing.path_elapsed_ms < pathDurationMs) continue;

      if (wing.lifecycle_state === WING_LIFECYCLE.RELOCATE) {
        lifecycleSystem.completeRedeploy(wing.wing_id, state);
        this.clearPath(wing.wing_id);
        broadcast("AIR_WING_UPDATES", { wings: [serializeWing(wing)] });
        continue;
      }

      if (wing.lifecycle_state === WING_LIFECYCLE.RTB) {
        wing.lifecycle_state = WING_LIFECYCLE.REFUEL;
        wing.path_gen_id = "";
        wing.path_elapsed_ms = 0;
        this.clearPath(wing.wing_id);
        broadcast("AIR_WING_UPDATES", { wings: [serializeWing(wing)] });
        continue;
      }

      wing.lifecycle_state = WING_LIFECYCLE.LOITER;
      const loiterPath = this.computeLoiterArc(
        { lng: wing.position_lng, lat: wing.position_lat },
        wing.heading_deg,
        path.turn_radius_deg,
      );
      this.storePath(wing.wing_id, loiterPath);
      wing.path_gen_id = loiterPath.path_gen_id;
      wing.path_elapsed_ms = 0;
      broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...loiterPath, timestamp_ms: Date.now() } satisfies AirWingPathMessage);
    }

    // Re-path TRANSIT wings that have no stored path (or an expired path) toward their target.
    // Root cause: lifecycle.tick() transitions LOITER patrol wings back to TRANSIT (when
    // target_id is set) without assigning a path. The advancement and expiry loops above
    // both skip wings with no path, so the wing freezes in TRANSIT indefinitely.
    for (const wing of state.air_wings.values()) {
      if (wing.lifecycle_state !== WING_LIFECYCLE.TRANSIT) continue;
      if (wing.mission === MISSION_TYPES.ESCORT) continue; // escort sync handled above
      const existingPath = this._activePaths.get(wing.wing_id);

      const pathExpired = !existingPath
        || (existingPath.speed_deg_per_ms > 0
            && wing.path_elapsed_ms >= existingPath.total_length_deg / existingPath.speed_deg_per_ms);

      // For interception with a target, always re-path (continuous pursuit toward lead point).
      // For other missions (or interception without a target), only re-path when the current path expires.
      if (!(wing.mission === MISSION_TYPES.INTERCEPTION && wing.target_id) && !pathExpired) continue;

      if (wing.target_id) {
        const target = state.air_wings.get(wing.target_id);
        if (target
            && target.lifecycle_state !== WING_LIFECYCLE.IDLE
            && target.lifecycle_state !== WING_LIFECYCLE.REFUEL) {
          const targetPos = { lng: target.position_lng, lat: target.position_lat };
          const startPos  = { lng: wing.position_lng, lat: wing.position_lat };
          const turnRadius = getAirUnitStats(wing.aircraft_type).min_turn_radius_deg;

          let leadTarget: { lng: number; lat: number };
          if (wing.mission === MISSION_TYPES.INTERCEPTION) {
            // Pursuit: compute lead position ahead of the moving target
            const directDist = distance(startPos, targetPos);
            const leadMs = clamp(directDist / Math.max(WING_SPEED_DEG_PER_MS, 0.000001), 1000, 8000);
            const tSpeed = WING_SPEED_DEG_PER_MS * Math.max(0.01, target.status_engine);
            const vec = vectorFromCompass(target.heading_deg);
            leadTarget = {
              lng: targetPos.lng + vec.x * tSpeed * leadMs,
              lat: targetPos.lat + vec.y * tSpeed * leadMs,
            };
          } else {
            leadTarget = targetPos;
          }

          const newPath = this.computeTransitPath(startPos, wing.heading_deg, leadTarget, turnRadius);
          this.storePath(wing.wing_id, newPath);
          wing.path_gen_id     = newPath.path_gen_id;
          wing.path_elapsed_ms = 0;
          broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...newPath, timestamp_ms: Date.now() } satisfies AirWingPathMessage);
        }
        // target_id set but target unavailable — leave wing in TRANSIT; lifecycle system
        // will clear target_id when engagement resolves or target is destroyed
        continue;
      }

      // No target at all — loiter at current position
      const fallbackLoiter = this.computeLoiterArc(
        { lng: wing.position_lng, lat: wing.position_lat },
        wing.heading_deg,
        WING_TURN_RADIUS_DEG,
      );
      this.storePath(wing.wing_id, fallbackLoiter);
      wing.path_gen_id     = fallbackLoiter.path_gen_id;
      wing.path_elapsed_ms = 0;
      wing.lifecycle_state = WING_LIFECYCLE.LOITER as any;
      broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...fallbackLoiter, timestamp_ms: Date.now() } satisfies AirWingPathMessage);
    }

    // ── Lost-contact handling for manually assigned interceptors ──────────────
    for (const [interceptorId, targetId] of _manualTargets) {
      const interceptor = state.air_wings.get(interceptorId);
      const target      = state.air_wings.get(targetId);
      if (!interceptor || !target) {
        _manualTargets.delete(interceptorId);
        continue;
      }

      if (target.is_detected) {
        _lastKnownPositions.set(targetId, {
          lng: target.position_lng,
          lat: target.position_lat,
        });
        _lostContactLoiterTicks.delete(interceptorId);
        continue;
      }

      const lastKnown = _lastKnownPositions.get(targetId);
      if (!lastKnown) continue;

      if (interceptor.lifecycle_state === WING_LIFECYCLE.LOITER) {
        const count = (_lostContactLoiterTicks.get(interceptorId) ?? 0) + 1;
        _lostContactLoiterTicks.set(interceptorId, count);

        if (count >= LOST_CONTACT_LOITER_TICKS) {
          interceptor.target_id = "";
          _manualTargets.delete(interceptorId);
          _lostContactLoiterTicks.delete(interceptorId);
          _lastKnownPositions.delete(targetId);
        }
      } else if (interceptor.lifecycle_state === WING_LIFECYCLE.TRANSIT) {
        const lostPath = this.computeTransitPath(
          { lng: interceptor.position_lng, lat: interceptor.position_lat },
          interceptor.heading_deg,
          lastKnown,
          getAirUnitStats(interceptor.aircraft_type).min_turn_radius_deg,
        );
        this.storePath(interceptorId, lostPath);
        interceptor.path_gen_id     = lostPath.path_gen_id;
        interceptor.path_elapsed_ms = 0;
      }
    }
  }
}
