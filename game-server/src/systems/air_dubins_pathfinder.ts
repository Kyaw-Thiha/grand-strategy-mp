import { randomUUID } from "crypto";
import type { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, serializeWing } from "../rooms/schema/AirWingState.js";
import { AirWingLifecycleSystem } from "./air_wing_lifecycle_system.js";
import { AirSpatialBucket } from "./air_spatial_bucket.js";

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
}

let WING_SPEED_DEG_PER_MS = 0.0002;
let WING_TURN_RADIUS_DEG = 0.3;
let ENGAGEMENT_RANGE_DEG = 0.15;

export function setWingSpeedForTesting(v: number): void { WING_SPEED_DEG_PER_MS = v; }
export function setTurnRadiusForTesting(v: number): void { WING_TURN_RADIUS_DEG = v; }
export function setEngagementRangeForTesting(v: number): void { ENGAGEMENT_RANGE_DEG = v; }

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
  const controlLength = directDistance <= 0.0001
    ? 0.0
    : clamp(directDistance * 0.12, Math.max(turnRadiusDeg * 0.1, 0.02), directDistance / 3);

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
  ): DubinsPath {
    const endHeading = bearingCompassDeg(startPos, endPos);
    return buildSmoothPath(startPos, startHeadingCompassDeg, endPos, endHeading, "TRANSIT", WING_TURN_RADIUS_DEG);
  }

  computeRtbPath(
    startPos: { lng: number; lat: number },
    startHeadingCompassDeg: number,
    airbasePos: { lng: number; lat: number },
    airbaseEntryHeadingCompassDeg: number,
  ): DubinsPath {
    return buildSmoothPath(startPos, startHeadingCompassDeg, airbasePos, airbaseEntryHeadingCompassDeg, "RTB", WING_TURN_RADIUS_DEG);
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

      wing.path_elapsed_ms += tickMs;

      if (path.path_type === "LOITER") {
        const loiterPeriodMs = path.total_length_deg / Math.max(path.speed_deg_per_ms, 0.000001);
        wing.path_elapsed_ms = loiterPeriodMs > 0 ? wing.path_elapsed_ms % loiterPeriodMs : 0;
      }

      const position = this.evaluatePosition(path, wing.path_elapsed_ms);
      wing.position_lng = position.lng;
      wing.position_lat = position.lat;
      wing.heading_deg = position.heading_compass_deg;
    }

    spatialBucket.clear();
    for (const wing of state.air_wings.values()) {
      if (wing.lifecycle_state !== WING_LIFECYCLE.TRANSIT && wing.lifecycle_state !== WING_LIFECYCLE.ENGAGED) {
        continue;
      }
      spatialBucket.add(wing.wing_id, wing.position_lng, wing.position_lat);
    }

    for (const [wingIdA, wingIdB] of spatialBucket.getLocalPairs()) {
      const wingA = state.air_wings.get(wingIdA);
      const wingB = state.air_wings.get(wingIdB);
      if (!wingA || !wingB) continue;
      if (wingA.nation_id === wingB.nation_id) continue;
      if (wingA.lifecycle_state !== WING_LIFECYCLE.TRANSIT || wingB.lifecycle_state !== WING_LIFECYCLE.TRANSIT) continue;

      const pathA = this._activePaths.get(wingIdA);
      const pathB = this._activePaths.get(wingIdB);
      if (!pathA || !pathB) continue;

      if (this.sweepCheck(pathA, wingA.path_elapsed_ms - tickMs, pathB, wingB.path_elapsed_ms - tickMs, ENGAGEMENT_RANGE_DEG, tickMs)) {
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
      broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...loiterPath } satisfies AirWingPathMessage);
    }
  }
}
