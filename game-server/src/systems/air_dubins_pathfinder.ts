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

// Fallback speed used when no per-wing speedDegPerMs is passed in (e.g. tests that exercise
// path geometry directly without a real AirWingState). Production call sites always pass an
// explicit getAirUnitStats(wing.aircraft_type).speed_deg_per_ms.
let WING_SPEED_DEG_PER_MS = 0.0002;
let WING_TURN_RADIUS_DEG = 0.3;
let ENGAGEMENT_RANGE_DEG = 0.3;

export function setWingSpeedForTesting(v: number): void { WING_SPEED_DEG_PER_MS = v; }
export function setTurnRadiusForTesting(v: number): void { WING_TURN_RADIUS_DEG = v; }
export function setEngagementRangeForTesting(v: number): void { ENGAGEMENT_RANGE_DEG = v; }

function resolveSpeed(explicitSpeedDegPerMs?: number): number {
  return explicitSpeedDegPerMs ?? WING_SPEED_DEG_PER_MS;
}

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

// ── Escort formation-flying tracking ──────────────────────────────────────────
// Per-escort "currently circling ahead, waiting for the bomber to catch up" flag.
const _escortLoitering = new Set<string>();
// Last trail/ahead/follow target point actually paved into a path, per wing — lets the
// formation block hold its current path instead of rebuilding from scratch every tick.
const _escortFormationTarget = new Map<string, { lng: number; lat: number }>();

// A bomber's heading while it's genuinely in TRANSIT, per wing_id — used as a stable
// substitute for a bomber's instantaneous heading_deg when computing where an escort should
// screen ahead of it. A self-LOITERing bomber's heading_deg continuously rotates around its
// own loiter circle (see computeLoiterArc's fixed rotational sense below); recomputing the
// escort's ahead point from that every tick produces a pursuit-curve artifact that snaps the
// escort into a repeatable one-sided offset instead of directly ahead. Updated only while a
// wing is actually TRANSIT (see the per-wing advancement loop above), so it always reflects
// the wing's last real direction of travel rather than a momentary loiter tangent.
const _lastTransitHeading = new Map<string, number>();

// Recon-only trailing distance (escort no longer uses this — see AHEAD_DISTANCE_DEG below).
// The lead-projection in _leadFormationPoint cancels roughly half of this offset at steady
// state (lead and trail vectors are anti-parallel), so this is set higher than the intended
// ~0.14-0.15 actual on-screen separation to compensate.
let TRAIL_DISTANCE_DEG          = 0.28;
let BREAKOFF_TRIGGER_RANGE_DEG  = 0.6;
let BREAKOFF_ABANDON_RANGE_DEG  = 0.9;
// Must clear one tick's worth of the formation target's own motion (a bomber cruising
// straight covers ~0.16-0.24 deg per 1000ms tick) — otherwise drift exceeds this on every
// single tick regardless of whether the follower is actually off course, forcing a full
// path rebuild every tick. Each rebuild resets path_elapsed_ms to 0 and hands the client a
// brand-new path_gen_id (see air_wing_system.gd's _on_air_wing_updated, which restarts its
// interpolation clock on every gen_id change) — rebuilding this often is what produced the
// "stop, hop, stop" stutter, independent of whether any individual rebuilt path was itself
// well-formed.
let REPATH_DRIFT_THRESHOLD_DEG  = 0.35;
// Bounds for how far ahead the trail/follow anchor leads the bomber's projected position
// (see _leadFormationPoint) — keeps a caught-up follower's rebuilt path from degenerating
// to near-zero length (which caused a hop-then-freeze stutter), without dragging the
// anchor so far ahead it cuts corners on the bomber's turns. The minimum is set well above
// a single tick's duration (1000ms in production) so that even a freshly rebuilt path is
// never short enough to fully saturate (reach its own endpoint) before the next tick —
// a path that completes early leaves the wing motionless mid-tick with nothing left to
// interpolate along until the next rebuild, which is the other half of the same stutter.
let FORMATION_LEAD_MIN_MS = 2_200;
let FORMATION_LEAD_MAX_MS = 4_000;
// Escort formation: how far ahead of the bomber the escort screens, and how close the
// bomber must close back in before a loitering escort leaves its circle and resumes
// closing the gap. ("Arrived" is detected directly from reachability — can the escort
// cover the remaining distance within one tick? — not a separate configurable threshold.)
// Must clear one tick's worth of the bomber's own motion (up to ~0.19-0.24 deg for the
// fastest escortable bomber types at a 1000ms tick) with real margin — a loitering escort's
// circle is fixed in space while the bomber keeps advancing, so if AHEAD_DISTANCE_DEG were
// only slightly bigger than one tick of bomber travel, the bomber would already be pulling
// level with (or past) the escort's station within a single tick of it arriving, forcing an
// immediate resume every time instead of ever actually holding the circle.
let AHEAD_DISTANCE_DEG         = 0.4;
// Deliberately much tighter than the aircraft's own min_turn_radius_deg (0.3-0.65, meant
// for real transit turning maneuvers) — this is a tight station-keeping circle right at the
// ahead point, not a wide patrol orbit.
let ESCORT_LOITER_RADIUS_DEG   = 0.02;
// Must stay meaningfully smaller than AHEAD_DISTANCE_DEG minus twice the loiter radius —
// otherwise either (a) it's already satisfied the instant the escort arrives, so it would
// immediately exit loiter and re-enter every tick instead of actually holding, or (b) the
// loiter circle's own orbital wobble (it swings within +-ESCORT_LOITER_RADIUS_DEG of the
// ahead point) dips inside the threshold purely from orbiting, not genuine bomber catch-up —
// AND must clear one tick's worth of the bomber's own motion, for the same reason
// AHEAD_DISTANCE_DEG must: comparing against the freshly recomputed ahead point (not the
// bomber's raw position — see the loitering check below) still grows by the bomber's
// per-tick displacement even while the escort's circle itself is genuinely holding station,
// so a threshold smaller than that displacement is trivially exceeded every single tick.
let RESUME_PURSUIT_RANGE_DEG   = 0.3;
// A bomber holding back for its newly-assigned escort (AirWingState.awaiting_escort_rendezvous
// — see air_mission_targeting.ts's escort-commit branch and
// air_wing_lifecycle_system.ts's clearing condition) advances at this fraction of its normal
// speed instead of a hard freeze (which reads as a stutter/bug, not an intentional hold — real
// aircraft don't stop dead in the air) or a full stop-and-loiter (which needs saving/restoring
// exact path state for no real behavioral gain here). Slowing rather than stopping also
// directly helps the escort close the gap and get ahead sooner.
let RENDEZVOUS_SLOWDOWN_FACTOR = 0.3;

export function setTrailDistanceForTesting(v: number): void { TRAIL_DISTANCE_DEG = v; }
export function setBreakoffTriggerRangeForTesting(v: number): void { BREAKOFF_TRIGGER_RANGE_DEG = v; }
export function setBreakoffAbandonRangeForTesting(v: number): void { BREAKOFF_ABANDON_RANGE_DEG = v; }
export function setRepathDriftThresholdForTesting(v: number): void { REPATH_DRIFT_THRESHOLD_DEG = v; }
export function setAheadDistanceForTesting(v: number): void { AHEAD_DISTANCE_DEG = v; }
export function setEscortLoiterRadiusForTesting(v: number): void { ESCORT_LOITER_RADIUS_DEG = v; }
export function setResumePursuitRangeForTesting(v: number): void { RESUME_PURSUIT_RANGE_DEG = v; }
export function setRendezvousSlowdownFactorForTesting(v: number): void { RENDEZVOUS_SLOWDOWN_FACTOR = v; }
export function setFormationLeadBoundsForTesting(minMs: number, maxMs: number): void {
  FORMATION_LEAD_MIN_MS = minMs; FORMATION_LEAD_MAX_MS = maxMs;
}

function areHostile(nationA: string, nationB: string, state: GameRoomState): boolean {
  if (nationA === nationB) return false;
  const rel = state.relations.get(`${nationA}|${nationB}`)
    ?? state.relations.get(`${nationB}|${nationA}`);
  return (rel?.stance ?? "neutral") === "war";
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
  speedDegPerMs?: number,
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
    speed_deg_per_ms: resolveSpeed(speedDegPerMs),
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
    speedDegPerMs?: number,
  ): DubinsPath {
    const endHeading = bearingCompassDeg(startPos, endPos);
    return buildSmoothPath(startPos, startHeadingCompassDeg, endPos, endHeading, "TRANSIT", turnRadiusDeg ?? WING_TURN_RADIUS_DEG, speedDegPerMs);
  }

  computeRtbPath(
    startPos: { lng: number; lat: number },
    startHeadingCompassDeg: number,
    airbasePos: { lng: number; lat: number },
    airbaseEntryHeadingCompassDeg: number,
    turnRadiusDeg?: number,
    speedDegPerMs?: number,
  ): DubinsPath {
    return buildSmoothPath(startPos, startHeadingCompassDeg, airbasePos, airbaseEntryHeadingCompassDeg, "RTB", turnRadiusDeg ?? WING_TURN_RADIUS_DEG, speedDegPerMs);
  }

  computeLoiterArc(
    entryPos: { lng: number; lat: number },
    entryHeadingCompassDeg: number,
    radiusDeg: number,
    speedDegPerMs?: number,
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
      speed_deg_per_ms: resolveSpeed(speedDegPerMs),
    };
  }

  computePursuitPath(
    startPos: { lng: number; lat: number },
    startHeadingCompassDeg: number,
    targetPos: { lng: number; lat: number },
    targetVelocityDegPerMs: { dlng: number; dlat: number },
    pursuerSpeedDegPerMs?: number,
    turnRadiusDeg?: number,
  ): DubinsPath {
    const directDistance = distance(startPos, targetPos);
    const leadTimeMs = clamp(directDistance / Math.max(resolveSpeed(pursuerSpeedDegPerMs), 0.000001), 1_000, 8_000);
    const leadTarget = {
      lng: targetPos.lng + (targetVelocityDegPerMs.dlng * leadTimeMs),
      lat: targetPos.lat + (targetVelocityDegPerMs.dlat * leadTimeMs),
    };
    return this.computeTransitPath(startPos, startHeadingCompassDeg, leadTarget, turnRadiusDeg, pursuerSpeedDegPerMs);
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

  // Leads the bomber's raw position forward by its own velocity over a short, bounded lead
  // time, THEN applies the trail/weave offset from the bomber's CURRENT heading. Offsetting
  // after leading (rather than leading an already-offset point) keeps the offset anchored to
  // the freshest heading — correct through turns — while the leading keeps the rebuilt path's
  // length from degenerating toward zero once the follower has caught up (a near-zero path
  // "expires" almost instantly, forcing a rebuild every tick that produces a hop-then-freeze
  // stutter instead of continuous motion).
  private _leadFormationPoint(
    fromPos: { lng: number; lat: number },
    bomberPos: { lng: number; lat: number },
    bomberHeadingDeg: number,
    bomberSpeedDegPerMs: number,
    followerSpeedDegPerMs: number,
    offsetHeadingDeg: number,
    offsetDistanceDeg: number,
  ): { lng: number; lat: number } {
    const directDistance = distance(fromPos, bomberPos);
    const leadTimeMs = clamp(
      directDistance / Math.max(followerSpeedDegPerMs, 0.000001),
      FORMATION_LEAD_MIN_MS, FORMATION_LEAD_MAX_MS,
    );
    const vec = vectorFromCompass(bomberHeadingDeg);
    const leadBomberPos = {
      lng: bomberPos.lng + vec.x * bomberSpeedDegPerMs * leadTimeMs,
      lat: bomberPos.lat + vec.y * bomberSpeedDegPerMs * leadTimeMs,
    };
    return pointAtDistanceAndHeading(leadBomberPos, offsetHeadingDeg, offsetDistanceDeg);
  }

  // Escort/recon formation-following: only rebuild the wing's path when its current one
  // has expired, or the formation target point (trail/weave/follow spot) has drifted past
  // REPATH_DRIFT_THRESHOLD_DEG since the last rebuild — holding course otherwise avoids the
  // saturate-and-snap teleport that unconditional every-tick rebuilds caused (short paths
  // relative to a fast wing's per-tick travel budget saturate to their own endpoint almost
  // instantly, so any tick-to-tick drift of the target point read as a positional snap).
  private _repathIfDrifted(
    wingId: string,
    wing: AirWingState,
    startPos: { lng: number; lat: number },
    candidateTarget: { lng: number; lat: number },
    turnRadiusDeg: number,
    speedDegPerMs: number,
    broadcast: BroadcastFn,
    targetDriftSpeedDegPerMs: number,
    tickMs: number,
  ): void {
    const existingPath = this._activePaths.get(wingId);
    const pathExpired = !existingPath
      || (existingPath.speed_deg_per_ms > 0
          && wing.path_elapsed_ms >= existingPath.total_length_deg / existingPath.speed_deg_per_ms);
    const cachedTarget = _escortFormationTarget.get(wingId);
    const drift = cachedTarget ? distance(candidateTarget, cachedTarget) : Infinity;
    if (!pathExpired && drift <= REPATH_DRIFT_THRESHOLD_DEG) return;

    // Guarantee the rebuilt path geometrically outlives the next drift-triggered rebuild —
    // otherwise, whenever the formation target (a bomber, which drifts the candidate target
    // at roughly targetDriftSpeedDegPerMs) is slow enough that closing REPATH_DRIFT_THRESHOLD_DEG
    // of drift takes longer than this path's own duration, the wing's server-side position
    // sits genuinely clamped at path-end for the remainder of the tick it expires in (see
    // evaluatePosition's saturation clamp) — a real one-tick freeze every rebuild cycle, not
    // a client-side artifact. Padding the built path further along its own departure vector
    // (past candidateTarget, in the direction the wing is already heading) fixes this without
    // touching the formation geometry itself: _escortFormationTarget below still caches the
    // real, unpadded candidateTarget, so drift comparisons and the resulting trail/ahead
    // distance are unaffected — only the geometric length of the path actually flown is
    // extended, and a genuine drift/expiry rebuild almost always fires long before the wing
    // could ever reach the padded endpoint.
    const requiredMinDurationMs = (REPATH_DRIFT_THRESHOLD_DEG / Math.max(targetDriftSpeedDegPerMs, 0.000001)) + tickMs;
    const rawLengthDeg = distance(startPos, candidateTarget);
    const rawDurationMs = speedDegPerMs > 0 ? rawLengthDeg / speedDegPerMs : Infinity;
    let pathTarget = candidateTarget;
    if (rawDurationMs < requiredMinDurationMs && rawLengthDeg > 0.000001) {
      const extraDeg = (requiredMinDurationMs - rawDurationMs) * speedDegPerMs;
      const ux = (candidateTarget.lng - startPos.lng) / rawLengthDeg;
      const uy = (candidateTarget.lat - startPos.lat) / rawLengthDeg;
      pathTarget = { lng: candidateTarget.lng + ux * extraDeg, lat: candidateTarget.lat + uy * extraDeg };
    }

    const newPath = this.computeTransitPath(startPos, wing.heading_deg, pathTarget, turnRadiusDeg, speedDegPerMs);
    this.storePath(wingId, newPath);
    wing.path_gen_id     = newPath.path_gen_id;
    wing.path_elapsed_ms = 0;
    _escortFormationTarget.set(wingId, candidateTarget);
    broadcast("AIR_WING_PATH", { wing_id: wingId, ...newPath, timestamp_ms: Date.now() } satisfies AirWingPathMessage);
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

      const rendezvousFactor = wing.awaiting_escort_rendezvous ? RENDEZVOUS_SLOWDOWN_FACTOR : 1;
      wing.path_elapsed_ms += tickMs * Math.max(0.01, wing.status_engine) * rendezvousFactor;

      if (path.path_type === "LOITER") {
        const loiterPeriodMs = path.total_length_deg / Math.max(path.speed_deg_per_ms, 0.000001);
        wing.path_elapsed_ms = loiterPeriodMs > 0 ? wing.path_elapsed_ms % loiterPeriodMs : 0;
      }

      const position = this.evaluatePosition(path, wing.path_elapsed_ms);
      wing.position_lng = position.lng;
      wing.position_lat = position.lat;
      wing.heading_deg = position.heading_compass_deg;
      if (wing.lifecycle_state === WING_LIFECYCLE.TRANSIT) {
        _lastTransitHeading.set(wing.wing_id, wing.heading_deg);
      }
    }

    // Escort formation flying: screen slightly AHEAD of its bomber (circling in place once
    // it arrives, until the bomber closes back within range), and break off to intercept a
    // hostile wing closing in on the bomber. Recon wings following a bomber (tier 1 of the
    // recon targeting chain) use a separate trailing-behind formula, minus the ahead/loiter
    // machinery and break-off — recon never fights. Trail/ahead-pursuit only re-path when
    // the formation target has drifted or the current path expired (see _repathIfDrifted);
    // the break-off branch below still rebuilds every tick, same as INTERCEPTION's
    // continuous pursuit re-path further down, since it's genuinely chasing a moving hostile.
    for (const escort of state.air_wings.values()) {
      const isRecon = escort.mission === MISSION_TYPES.RECON;
      if (escort.mission !== MISSION_TYPES.ESCORT && !isRecon) continue;
      if (escort.lifecycle_state !== WING_LIFECYCLE.TRANSIT &&
          escort.lifecycle_state !== WING_LIFECYCLE.LOITER) continue;
      const bomber = state.air_wings.get(escort.target_id);
      if (!bomber || !bomber.path_gen_id) continue; // patrol-fallback wing — generic re-path loop below handles it

      const startPos  = { lng: escort.position_lng, lat: escort.position_lat };
      const bomberPos = { lng: bomber.position_lng, lat: bomber.position_lat };
      const turnRadius  = getAirUnitStats(escort.aircraft_type).min_turn_radius_deg;
      const escortSpeed = getAirUnitStats(escort.aircraft_type).speed_deg_per_ms;
      // Match the bomber's actual per-tick advancement (see the rendezvousFactor applied to
      // wing.path_elapsed_ms in the advancement loop above) — otherwise, while a bomber is
      // holding back for its escort, the lead-projection below assumes it's moving at full
      // speed and overshoots the aim point far ahead of where the bomber will actually be.
      const bomberRendezvousFactor = bomber.awaiting_escort_rendezvous ? RENDEZVOUS_SLOWDOWN_FACTOR : 1;
      const bomberSpeed = getAirUnitStats(bomber.aircraft_type).speed_deg_per_ms
        * Math.max(0.01, bomber.status_engine) * bomberRendezvousFactor;
      // Stable substitute for bomber.heading_deg: a self-LOITERing bomber's heading rotates
      // continuously around its loiter circle, which would otherwise make the escort's ahead
      // point (below) an ever-shifting target — see _lastTransitHeading's doc comment.
      const bomberFormationHeading = bomber.lifecycle_state === WING_LIFECYCLE.TRANSIT
        ? bomber.heading_deg
        : _lastTransitHeading.get(bomber.wing_id) ?? bomber.heading_deg;

      if (isRecon) {
        // Direct following, not a border-patrol orbit — recon never weaves or breaks off.
        //
        // A "hold station once caught up" state analogous to escort's reachability-snap
        // (below) was attempted here and reverted: unlike escort's fighter (~50% faster than
        // a typical bomber, enough to fully close the ahead-gap within a tick and land
        // exactly on its station every time), recon's speed edge over a typical bomber is
        // much smaller and its trail point is a rotating heading-relative arm rather than a
        // fixed reachable point, so there's no clean "arrived" moment to snap into — every
        // entry/resume threshold tried either almost never triggered (chase settles into a
        // stable oscillation above the entry range) or triggered near the resume boundary
        // and immediately flickered back out on the very next tick, rebuilding anyway
        // (defeating the purpose while adding a second, less predictable failure mode).
        // Falls back to _repathIfDrifted alone, same as prior rounds — REPATH_DRIFT_THRESHOLD_DEG
        // and the lead-projected anchor already reduce this to holding a valid multi-tick
        // path most ticks, rebuilding only every ~2-3 ticks on path expiry, not every tick.
        const trailPoint = this._leadFormationPoint(
          startPos, bomberPos, bomber.heading_deg, bomberSpeed, escortSpeed,
          bomber.heading_deg + 180, TRAIL_DISTANCE_DEG,
        );
        this._repathIfDrifted(escort.wing_id, escort, startPos, trailPoint, turnRadius, escortSpeed, broadcast, bomberSpeed, tickMs);
        continue;
      }

      // Re-validate an active break-off every tick — abandon if the threat is gone, no
      // longer hunting this bomber, has drifted out of range, or is no longer airborne.
      if (escort.escort_intercept_id) {
        const threat = state.air_wings.get(escort.escort_intercept_id);
        const stillValid = !!threat
          && threat.target_id === bomber.wing_id
          && distance(bomberPos, { lng: threat.position_lng, lat: threat.position_lat }) <= BREAKOFF_ABANDON_RANGE_DEG
          && (threat.lifecycle_state === WING_LIFECYCLE.TRANSIT
              || threat.lifecycle_state === WING_LIFECYCLE.LOITER
              || threat.lifecycle_state === WING_LIFECYCLE.ENGAGED);
        if (!stillValid) escort.escort_intercept_id = "";
      }

      // Look for a new break-off trigger — a hostile wing hunting our bomber, closing in.
      if (!escort.escort_intercept_id) {
        for (const hostile of state.air_wings.values()) {
          if (!areHostile(escort.nation_id, hostile.nation_id, state)) continue;
          if (hostile.target_id !== bomber.wing_id) continue;
          if (distance(bomberPos, { lng: hostile.position_lng, lat: hostile.position_lat }) > BREAKOFF_TRIGGER_RANGE_DEG) continue;
          escort.escort_intercept_id = hostile.wing_id;
          break;
        }
      }

      if (escort.escort_intercept_id) {
        // Stale pre-break-off formation target/loiter state can't suppress or confuse the
        // first post-break-off rebuild — force a fresh ahead/loiter evaluation afterward.
        // An escort can trigger a break-off while circling (LOITER is now a normal ahead-
        // formation state, not just a "stuck" one) — it's actively pursuing again now, so
        // its lifecycle_state must reflect that.
        _escortFormationTarget.delete(escort.wing_id);
        _escortLoitering.delete(escort.wing_id);
        escort.lifecycle_state = WING_LIFECYCLE.TRANSIT;
        const threat = state.air_wings.get(escort.escort_intercept_id)!;
        const tSpeed = getAirUnitStats(threat.aircraft_type).speed_deg_per_ms * Math.max(0.01, threat.status_engine);
        const vec = vectorFromCompass(threat.heading_deg);
        const newPath = this.computePursuitPath(
          startPos, escort.heading_deg,
          { lng: threat.position_lng, lat: threat.position_lat },
          { dlng: vec.x * tSpeed, dlat: vec.y * tSpeed },
          escortSpeed, turnRadius,
        );
        this.storePath(escort.wing_id, newPath);
        escort.path_gen_id     = newPath.path_gen_id;
        escort.path_elapsed_ms = 0;
        broadcast("AIR_WING_PATH", { wing_id: escort.wing_id, ...newPath, timestamp_ms: Date.now() } satisfies AirWingPathMessage);
        continue;
      }

      // Ahead/circle-and-wait formation: screen slightly ahead of the bomber.
      const aheadPoint = pointAtDistanceAndHeading(bomberPos, bomberFormationHeading, AHEAD_DISTANCE_DEG);

      if (_escortLoitering.has(escort.wing_id)) {
        // Bug fix: this must measure how far the escort's (fixed-in-space) loiter circle
        // has fallen behind the bomber's freshly recomputed ahead point — NOT the raw
        // distance from the bomber to the escort's own position. By design, a properly
        // loitering escort always sits roughly AHEAD_DISTANCE_DEG away from the bomber, and
        // AHEAD_DISTANCE_DEG > RESUME_PURSUIT_RANGE_DEG — so comparing bomber-to-escort
        // distance was satisfied almost every tick regardless of whether the loiter circle
        // was actually stale, since the bomber's own forward motion alone (which always
        // exceeds AHEAD_DISTANCE_DEG - RESUME_PURSUIT_RANGE_DEG for any realistic
        // bomber/escort speed pairing) closes that gap every tick. That forced an exit into
        // "resume", which immediately re-satisfied the reachability snap back into a brand
        // new loiter arc — a perpetual same-tick LOITER->TRANSIT->LOITER flicker generating
        // a fresh path_gen_id (and a client-side interpolation reset) every single tick.
        if (distance(startPos, aheadPoint) <= RESUME_PURSUIT_RANGE_DEG) {
          // Still loitering, the ahead point hasn't drifted far from this circle yet —
          // leave the active LOITER path alone; the per-wing advancement loop earlier in
          // tick() already advances it.
          continue;
        }
        // Resume: exit loiter and fall through to re-evaluate fresh below, on this same tick.
        _escortLoitering.delete(escort.wing_id);
        escort.lifecycle_state = WING_LIFECYCLE.TRANSIT;
        _escortFormationTarget.delete(escort.wing_id);
      }

      // A fast escort chasing a continuously-receding point (the bomber advances every
      // tick too) would otherwise saturate to each tick's snapshot and perpetually converge
      // to sitting only ~one bomber-tick short of the real standoff, never actually
      // "arriving" no matter how much speed surplus it has (evaluatePosition's saturation
      // clamp always lands exactly on the stale snapshot, and next tick's fresh snapshot has
      // already moved on by then). Detecting genuine reachability directly — can the escort
      // cover the whole remaining distance within this tick's travel budget? — and snapping
      // straight to the ahead point when so avoids that artifact at its source, instead of
      // going through a rebuild-then-saturate cycle that never actually resolves.
      const directDistance = distance(startPos, aheadPoint);
      if (directDistance <= escortSpeed * tickMs) {
        escort.position_lng = aheadPoint.lng;
        escort.position_lat = aheadPoint.lat;
        escort.heading_deg  = bomberFormationHeading;
        _escortLoitering.add(escort.wing_id);
        escort.lifecycle_state = WING_LIFECYCLE.LOITER;
        const loiterPath = this.computeLoiterArc(aheadPoint, bomberFormationHeading, ESCORT_LOITER_RADIUS_DEG, escortSpeed);
        this.storePath(escort.wing_id, loiterPath);
        escort.path_gen_id     = loiterPath.path_gen_id;
        escort.path_elapsed_ms = 0;
        _escortFormationTarget.delete(escort.wing_id);
        broadcast("AIR_WING_PATH", { wing_id: escort.wing_id, ...loiterPath, timestamp_ms: Date.now() } satisfies AirWingPathMessage);
        continue;
      }

      // Lead-project the pursuit target (not the arrival/loiter-anchor aheadPoint above,
      // which must stay a plain, un-led offset so the reachability check and loiter circle
      // stay anchored to a stable point) — otherwise, once REPATH_DRIFT_THRESHOLD_DEG holds
      // a path across several ticks, a plain "ahead of the bomber's CURRENT position" target
      // goes stale while the bomber (especially mid-turn, when its heading itself keeps
      // changing) continues advancing past it, and the escort perpetually converges toward
      // the bomber's own position instead of the intended ahead station. Same fix recon's
      // trail point already uses (offsetHeadingDeg = bomber.heading_deg here instead of
      // +180, since escort screens ahead rather than behind).
      const leadAheadPoint = this._leadFormationPoint(
        startPos, bomberPos, bomberFormationHeading, bomberSpeed, escortSpeed,
        bomberFormationHeading, AHEAD_DISTANCE_DEG,
      );
      this._repathIfDrifted(escort.wing_id, escort, startPos, leadAheadPoint, turnRadius, escortSpeed, broadcast, bomberSpeed, tickMs);
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

      // Continuous pursuit (see the re-path loop below): an INTERCEPTION wing with a live
      // target always gets a brand-new lead-point path every tick, so a short pursuit leg
      // finishing exactly as it reaches this tick's lead point must not park the wing in
      // LOITER — let the re-path loop rebuild toward the target's updated position instead.
      if (wing.mission === MISSION_TYPES.INTERCEPTION && wing.target_id) {
        const target = state.air_wings.get(wing.target_id);
        if (target && target.lifecycle_state !== WING_LIFECYCLE.IDLE
            && target.lifecycle_state !== WING_LIFECYCLE.REFUEL) continue;
      }

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

      // An escort whose bomber has become unavailable (destroyed/grounded, no path_gen_id)
      // falls through here since the formation block above skips it — RTB-vs-retarget for
      // a bomber that specifically went RTB is air_mission_targeting.ts's job now (it drops
      // the target the same tick, before this loop ever sees it); REFUEL is a legitimate
      // ongoing Escort target (ESCORT_TARGET_VALID_STATES), so this loop must not treat it
      // as a reason to force RTB. Just park in LOITER like every other mission's "target
      // unavailable" case, until the next targeting pass re-evaluates.
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
      // Escorts and recon wings with a live bomber target are handled by the formation
      // block above; only patrol-fallback wings (target_id = a division/city/province id,
      // no live wing) fall through to this generic re-path loop like every other mission.
      if ((wing.mission === MISSION_TYPES.ESCORT || wing.mission === MISSION_TYPES.RECON)
          && state.air_wings.has(wing.target_id)) continue;
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
          const wingSpeed = getAirUnitStats(wing.aircraft_type).speed_deg_per_ms;

          let newPath: DubinsPath;
          if (wing.mission === MISSION_TYPES.INTERCEPTION) {
            // Pursuit: lead the target's own type speed, not the pursuer's.
            const tSpeed = getAirUnitStats(target.aircraft_type).speed_deg_per_ms * Math.max(0.01, target.status_engine);
            const vec = vectorFromCompass(target.heading_deg);
            newPath = this.computePursuitPath(
              startPos, wing.heading_deg, targetPos,
              { dlng: vec.x * tSpeed, dlat: vec.y * tSpeed },
              wingSpeed, turnRadius,
            );
          } else {
            newPath = this.computeTransitPath(startPos, wing.heading_deg, targetPos, turnRadius, wingSpeed);
          }

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
        getAirUnitStats(wing.aircraft_type).speed_deg_per_ms,
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
          getAirUnitStats(interceptor.aircraft_type).speed_deg_per_ms,
        );
        this.storePath(interceptorId, lostPath);
        interceptor.path_gen_id     = lostPath.path_gen_id;
        interceptor.path_elapsed_ms = 0;
      }
    }
  }
}
