import { GameRoomState, DivisionState } from "../rooms/schema/GameRoomState.js";
import { AirWingState, MISSION_TYPES, WING_LIFECYCLE, serializeWing } from "../rooms/schema/AirWingState.js";
import { getAirUnitStats } from "../data/air_unit_stats.js";
import type { AirWingLifecycleSystem } from "./air_wing_lifecycle_system.js";
import type { DubinsPathfinder } from "./air_dubins_pathfinder.js";

export function buildProvinceNeighbors(
  adjacency: Array<{ from_province: string; to_province: string }>,
): Map<string, string[]> {
  const neighbors = new Map<string, string[]>();
  const addEdge = (a: string, b: string): void => {
    if (!neighbors.has(a)) neighbors.set(a, []);
    neighbors.get(a)!.push(b);
  };
  for (const edge of adjacency) {
    addEdge(edge.from_province, edge.to_province);
    addEdge(edge.to_province, edge.from_province);
  }
  return neighbors;
}

function getRelationStance(nationA: string, nationB: string, state: GameRoomState): string {
  if (nationA === nationB) return "alliance";
  const rel = state.relations.get(`${nationA}|${nationB}`) ?? state.relations.get(`${nationB}|${nationA}`);
  return rel?.stance ?? "neutral";
}

/**
 * True if province `provinceId` has at least one neighbor province owned by a nation
 * whose relation to `viewerNationId` is `stance`. Evaluated from the viewer's own nation,
 * not the province's owner — a wing based at an allied airbase correctly sees "my ally
 * borders the enemy" as a valid war-border.
 */
export function isBorderingStance(
  provinceId: string,
  viewerNationId: string,
  stance: "war" | "neutral",
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
): boolean {
  const neighborIds = provinceNeighbors.get(provinceId);
  if (!neighborIds) return false;
  for (const neighborId of neighborIds) {
    const neighbor = state.provinces.get(neighborId);
    if (!neighbor || !neighbor.owner_id) continue;
    if (getRelationStance(viewerNationId, neighbor.owner_id, state) === stance) return true;
  }
  return false;
}

const CROWD_WEIGHT = 0.15;   // placeholder — playtesting-tunable, see AIR_COMBAT.md Open Questions

function euclidDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  return Math.sqrt((lng1 - lng2) ** 2 + (lat1 - lat2) ** 2);
}

export function scoreCandidate(distDeg: number, claimCount: number): number {
  const distanceFalloff = 1 / (1 + distDeg);
  return distanceFalloff - CROWD_WEIGHT * claimCount;
}

/** Counts live wings currently assigned (by mission+target_id) to each target_id. */
export function buildClaimsRegistry(state: GameRoomState): Map<string, number> {
  const claims = new Map<string, number>();
  for (const wing of state.air_wings.values()) {
    if (!wing.target_id) continue;
    claims.set(wing.target_id, (claims.get(wing.target_id) ?? 0) + 1);
  }
  return claims;
}

/** Picks the highest-scoring candidate id from a list of {id, lng, lat}. Ties broken by id string. */
function pickBest<T extends { id: string; lng: number; lat: number }>(
  candidates: T[],
  fromLng: number,
  fromLat: number,
  claims: Map<string, number>,
): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const dist = euclidDeg(fromLng, fromLat, c.lng, c.lat);
    const score = scoreCandidate(dist, claims.get(c.id) ?? 0);
    if (score > bestScore || (score === bestScore && (!best || c.id < best.id))) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// ── Step 4: Per-mission tier chains ─────────────────────────────────────────────

function isHostile(nationA: string, nationB: string, state: GameRoomState): boolean {
  if (nationA === nationB) return false;
  const rel = state.relations.get(`${nationA}|${nationB}`) ?? state.relations.get(`${nationB}|${nationA}`);
  return (rel?.stance ?? "neutral") === "war";
}

function isFriendly(nationA: string, nationB: string, state: GameRoomState): boolean {
  if (nationA === nationB) return true;
  const rel = state.relations.get(`${nationA}|${nationB}`) ?? state.relations.get(`${nationB}|${nationA}`);
  return (rel?.stance ?? "neutral") === "alliance";
}

/** Enemy air wings visible to `viewerNationId`, restricted to the given aircraft types. */
export function visibleEnemyWingsOfTypes(
  viewerNationId: string,
  types: Set<string>,
  state: GameRoomState,
  detectionSystem: { getWingDetectedByNations(wingId: string): Set<string> },
): AirWingState[] {
  const result: AirWingState[] = [];
  for (const wing of state.air_wings.values()) {
    if (!isHostile(viewerNationId, wing.nation_id, state)) continue;
    if (!types.has(wing.aircraft_type)) continue;
    if (!detectionSystem.getWingDetectedByNations(wing.wing_id).has(viewerNationId)) continue;
    result.push(wing);
  }
  return result;
}

/** Any visible enemy air wing, regardless of type — the "no bomber found, engage anything" tail tier. */
export function anyVisibleEnemyWing(
  viewerNationId: string,
  state: GameRoomState,
  detectionSystem: { getWingDetectedByNations(wingId: string): Set<string> },
): AirWingState[] {
  const result: AirWingState[] = [];
  for (const wing of state.air_wings.values()) {
    if (!isHostile(viewerNationId, wing.nation_id, state)) continue;
    if (!detectionSystem.getWingDetectedByNations(wing.wing_id).has(viewerNationId)) continue;
    result.push(wing);
  }
  return result;
}

/**
 * Friendly (own or allied) land divisions near a border of the given stance.
 *
 * DivisionState has no province_id field — only a raw lng/lat position — so "near a
 * border" cannot be answered via isBorderingStance (province-keyed). This approximates it:
 * a division counts as "near a border of stance X" if its position is within
 * BORDER_PROXIMITY_DEG of the city position of ANY province that itself borders a stance-X
 * neighbor. This is a deliberate approximation — real point-in-polygon containment is out
 * of scope; the map's polygon data is not loaded into game-server at runtime.
 */
export function friendlyDivisionsNearBorder(
  viewerNationId: string,
  stance: "war" | "neutral",
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): DivisionState[] {
  const borderProvincePositions: Array<{ lng: number; lat: number }> = [];
  for (const [provinceId] of state.provinces) {
    if (!isBorderingStance(provinceId, viewerNationId, stance, state, provinceNeighbors)) continue;
    const pos = resolvePosition(provinceId);
    if (pos) borderProvincePositions.push(pos);
  }
  if (borderProvincePositions.length === 0) return [];

  const result: DivisionState[] = [];
  for (const division of state.divisions.values()) {
    if (!isFriendly(viewerNationId, division.nation_id, state)) continue;
    const nearAny = borderProvincePositions.some(p =>
      euclidDeg(division.position_lng, division.position_lat, p.lng, p.lat) <= BORDER_PROXIMITY_DEG);
    if (nearAny) result.push(division);
  }
  return result;
}

export const BOMBER_TYPES = new Set(["strategic_bomber", "tactical_bomber"]);
export const LOW_ALT_BOMBER_TYPES = new Set(["cas_plane", "dive_bomber"]);
export const FIGHTER_TYPES = new Set(["fighter", "heavy_fighter"]);
export const BORDER_PROXIMITY_DEG = 1.5; // placeholder, see friendlyDivisionsNearBorder note

export interface TierResult { tier: number; targetId: string; }

/** Shared patrol fallback used by Interception, Air Superiority, and Recon. */
export function resolvePatrolFallback(
  wing: AirWingState,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
  startTier: number,
): TierResult | null {
  const nationId = wing.nation_id;

  const warBorderDivs = friendlyDivisionsNearBorder(nationId, "war", state, provinceNeighbors, resolvePosition);
  const bestWar = pickBest(
    warBorderDivs.map(d => ({ id: d.division_id, lng: d.position_lng, lat: d.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (bestWar) return { tier: startTier, targetId: bestWar.id };

  const neutralBorderDivs = friendlyDivisionsNearBorder(nationId, "neutral", state, provinceNeighbors, resolvePosition);
  const bestNeutral = pickBest(
    neutralBorderDivs.map(d => ({ id: d.division_id, lng: d.position_lng, lat: d.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (bestNeutral) return { tier: startTier + 1, targetId: bestNeutral.id };

  // Own cities, nearest to home airbase first — "nearest" measured from the wing's
  // home airbase per the design doc, NOT from the wing's current position (this is the
  // one tier in this file that intentionally uses a different distance origin).
  const homePos = resolvePosition(wing.home_airbase_province_id);
  const ownProvinces: Array<{ id: string; lng: number; lat: number }> = [];
  for (const [provinceId, province] of state.provinces) {
    if (province.owner_id !== nationId) continue;
    const pos = resolvePosition(provinceId);
    if (pos) ownProvinces.push({ id: provinceId, lng: pos.lng, lat: pos.lat });
  }
  if (ownProvinces.length > 0 && homePos) {
    const best = pickBest(ownProvinces, homePos.lng, homePos.lat, claims);
    if (best) return { tier: startTier + 2, targetId: best.id };
  }

  return null; // stay at base — assignMission's Step 2 fix leaves the wing IDLE
}

/** Interception mission tier chain. */
export function resolveInterceptionTargets(
  wing: AirWingState,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  detectionSystem: { getWingDetectedByNations(wingId: string): Set<string> },
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): TierResult | null {
  const nationId = wing.nation_id;

  const tier1 = visibleEnemyWingsOfTypes(nationId, BOMBER_TYPES, state, detectionSystem);
  const best1 = pickBest(tier1.map(w => ({ id: w.wing_id, lng: w.position_lng, lat: w.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (best1) return { tier: 1, targetId: best1.id };

  const tier2 = visibleEnemyWingsOfTypes(nationId, LOW_ALT_BOMBER_TYPES, state, detectionSystem);
  const best2 = pickBest(tier2.map(w => ({ id: w.wing_id, lng: w.position_lng, lat: w.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (best2) return { tier: 2, targetId: best2.id };

  const tier3 = anyVisibleEnemyWing(nationId, state, detectionSystem);
  const best3 = pickBest(tier3.map(w => ({ id: w.wing_id, lng: w.position_lng, lat: w.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (best3) return { tier: 3, targetId: best3.id };

  // Tiers 4-6: patrol fallback over friendly divisions/cities near a border, then own cities.
  return resolvePatrolFallback(wing, state, provinceNeighbors, claims, resolvePosition, /* startTier */ 4);
}

/** Air Superiority mission tier chain (mirrors Interception with reversed air-to-air priority). */
export function resolveAirSuperiorityTargets(
  wing: AirWingState,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  detectionSystem: { getWingDetectedByNations(wingId: string): Set<string> },
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): TierResult | null {
  const nationId = wing.nation_id;

  const tier1 = visibleEnemyWingsOfTypes(nationId, FIGHTER_TYPES, state, detectionSystem);
  const best1 = pickBest(tier1.map(w => ({ id: w.wing_id, lng: w.position_lng, lat: w.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (best1) return { tier: 1, targetId: best1.id };

  const tier2 = visibleEnemyWingsOfTypes(nationId, LOW_ALT_BOMBER_TYPES, state, detectionSystem);
  const best2 = pickBest(tier2.map(w => ({ id: w.wing_id, lng: w.position_lng, lat: w.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (best2) return { tier: 2, targetId: best2.id };

  const tier3 = visibleEnemyWingsOfTypes(nationId, BOMBER_TYPES, state, detectionSystem);
  const best3 = pickBest(tier3.map(w => ({ id: w.wing_id, lng: w.position_lng, lat: w.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (best3) return { tier: 3, targetId: best3.id };

  // Tiers 4-6: war-border patrol, then neutral-border patrol, then spread across own cities.
  // No separate "duplicate onto already-patrolled unit" tier — resolvePatrolFallback's
  // own-city tier already allows duplication for free, since pickBest never excludes
  // already-claimed candidates, only deprioritizes them via score.
  return resolvePatrolFallback(wing, state, provinceNeighbors, claims, resolvePosition, /* startTier */ 4);
}

/** Tactical Bombing mission tier chain. */
export function resolveTacticalBombingTargets(
  wing: AirWingState,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  detectionSystem: { getVisibleDivisionsForNation(nationId: string): Set<string> },
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): TierResult | null {
  const nationId = wing.nation_id;
  const visibleDivIds = detectionSystem.getVisibleDivisionsForNation(nationId);

  const candidates: Array<{ id: string; lng: number; lat: number }> = [];
  for (const divId of visibleDivIds) {
    const div = state.divisions.get(divId);
    if (!div) continue;
    if (isFriendly(nationId, div.nation_id, state)) continue; // must be enemy
    candidates.push({ id: div.division_id, lng: div.position_lng, lat: div.position_lat });
  }
  const best = pickBest(candidates, wing.position_lng, wing.position_lat, claims);
  if (best) return { tier: 1, targetId: best.id };

  // Tier 2: patrol over friendly units near a war-stance border.
  const warBorderDivs = friendlyDivisionsNearBorder(nationId, "war", state, provinceNeighbors, resolvePosition);
  const bestPatrol = pickBest(
    warBorderDivs.map(d => ({ id: d.division_id, lng: d.position_lng, lat: d.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (bestPatrol) return { tier: 2, targetId: bestPatrol.id };

  return null; // tier 3: stay at base
}

/**
 * Strategic Bombing mission tier chain (Area / Industry / Oil / Logistics). Targets enemy
 * provinces directly — this tier chain does not filter by visibility/detection, since
 * provinces are static, always-known geography, unlike wings/divisions.
 */
export function resolveStrategicBombingTargets(
  wing: AirWingState,
  state: GameRoomState,
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): TierResult | null {
  const nationId = wing.nation_id;
  const candidates: Array<{ id: string; lng: number; lat: number }> = [];
  for (const [provinceId, province] of state.provinces) {
    if (!province.owner_id || !isHostile(nationId, province.owner_id, state)) continue;
    const pos = resolvePosition(provinceId);
    if (pos) candidates.push({ id: provinceId, lng: pos.lng, lat: pos.lat });
  }
  const best = pickBest(candidates, wing.position_lng, wing.position_lat, claims);
  if (best) return { tier: 1, targetId: best.id };
  return null; // tier 2: stay at base
}

/** Naval mission tier chain (Trade Interdiction / Anti-Submarine / Anti-Ship / Port Strike). */
export function resolveNavalTargets(
  wing: AirWingState,
  state: GameRoomState,
  claims: Map<string, number>,
): TierResult | null {
  const nationId = wing.nation_id;
  const candidates: Array<{ id: string; lng: number; lat: number }> = [];
  for (const [markerId, marker] of state.naval_contact_markers) {
    if (marker.nation_id !== nationId) continue; // markers are per-observer, already fog-of-war filtered
    candidates.push({ id: markerId, lng: marker.position_lng, lat: marker.position_lat });
  }
  const best = pickBest(candidates, wing.position_lng, wing.position_lat, claims);
  if (best) return { tier: 1, targetId: best.id };
  return null; // tier 2: stay at base
}

export const RECON_ESCORT_BOMBER_TYPES = new Set(["strategic_bomber", "tactical_bomber"]);

/**
 * Counts live RECON-mission wings currently targeting each target_id. Used specifically for
 * Recon's "not already accompanied" gate — the shared claims registry is keyed by target_id
 * across ALL missions, and Escort's target_id is also a bomber wing_id, so reusing the
 * shared claims map for this check would collide with Escort claims on the same bomber.
 */
export function buildReconEscortCounts(state: GameRoomState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const wing of state.air_wings.values()) {
    if (wing.mission !== MISSION_TYPES.RECON || !wing.target_id) continue;
    counts.set(wing.target_id, (counts.get(wing.target_id) ?? 0) + 1);
  }
  return counts;
}

/** Recon mission tier chain. */
export function resolveReconTargets(
  wing: AirWingState,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  claims: Map<string, number>,
  reconCounts: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): TierResult | null {
  const nationId = wing.nation_id;

  // Tier 1: escort-follow a friendly strategic/tactical bomber not already accompanied by
  // another recon wing. "Not accompanied" is checked via reconCounts (a recon-mission-only
  // counter), NOT the shared claims map — the shared claims map is keyed by target_id
  // across all missions, and Escort's target_id is also a bomber wing_id, so it would
  // incorrectly read an escorted-but-unrecon'd bomber as "already recon'd".
  const candidateBombers: Array<{ id: string; lng: number; lat: number }> = [];
  for (const bomber of state.air_wings.values()) {
    if (bomber.nation_id !== nationId) continue;
    if (!RECON_ESCORT_BOMBER_TYPES.has(bomber.aircraft_type)) continue;
    if ((reconCounts.get(bomber.wing_id) ?? 0) > 0) continue; // already has a recon escort
    candidateBombers.push({ id: bomber.wing_id, lng: bomber.position_lng, lat: bomber.position_lat });
  }
  const bestBomber = pickBest(candidateBombers, wing.position_lng, wing.position_lat, claims);
  if (bestBomber) return { tier: 1, targetId: bestBomber.id };

  // Tiers 2-4: patrol ahead of a friendly land unit in/near enemy territory, then general
  // war-border patrol, then neutral-border patrol. Reuses the same friendlyDivisionsNearBorder
  // + resolvePatrolFallback machinery as Interception/Air Superiority.
  return resolvePatrolFallback(wing, state, provinceNeighbors, claims, resolvePosition, /* startTier */ 2);
}

// ── Step 5: Main tick() entry point ─────────────────────────────────────────────

type BroadcastFn = (type: string, msg: unknown) => void;
type DetectionQueries = {
  getWingDetectedByNations(wingId: string): Set<string>;
  getVisibleDivisionsForNation(nationId: string): Set<string>;
};
type ResolvePositionFn = (id: string) => { lng: number; lat: number } | null;

const RETARGETABLE_STATES = new Set([WING_LIFECYCLE.IDLE, WING_LIFECYCLE.LOITER, WING_LIFECYCLE.TRANSIT]);

// Defaults to ON for real games (NODE_ENV !== "test") and OFF under the test runner. Every
// pre-existing test suite in this repo predates AirMissionTargetingSystem and spawns wings
// with manually-assigned (often nonexistent) target_ids on AUTO_TARGETED_MISSIONS — under
// real map data, this system's patrol-fallback tiers virtually always find *some* target, so
// leaving it on by default under NODE_ENV=test would silently overwrite those manually-set
// targets across dozens of unrelated, already-reviewed test files the moment this system's
// tick() is wired into GameRoom's live loop. Tests that specifically exercise this system
// (see test/12l-mission-targeting-air.test.ts's end-to-end describe block) opt back in via
// setAirMissionTargetingEnabledForTesting(true) in their own before()/after() hooks.
let _targetingEnabled = process.env.NODE_ENV !== "test";

export function setAirMissionTargetingEnabledForTesting(v: boolean): void {
  _targetingEnabled = v;
}

/**
 * Drives per-tick auto-targeting for every non-idle, non-escort air wing: builds the shared
 * claims/recon-escort registries once, resolves each retargetable wing's mission-specific
 * tier chain, and — subject to the hysteresis rule (only commit on an invalidated target or
 * a strictly better tier) — commits a new target, kicks IDLE/LOITER wings into TRANSIT, and
 * generates + broadcasts a fresh Dubins path. See AIR_COMBAT.md "Responsiveness and
 * hysteresis" for the design rule this enforces.
 */
export class AirMissionTargetingSystem {
  // Tracks the last-committed tier per wing_id so a wing already on a valid tier-N target is
  // never bumped to a different, merely-less-crowded tier-N target — only a strictly better
  // tier, or an invalidated current target, triggers a reassignment.
  private _wingTier: Map<string, number> = new Map();

  tick(
    state: GameRoomState,
    detectionSystem: DetectionQueries,
    lifecycleSystem: AirWingLifecycleSystem,
    pathfinder: DubinsPathfinder,
    resolvePosition: ResolvePositionFn,
    broadcast: BroadcastFn,
  ): void {
    if (!_targetingEnabled) return;

    for (const wingId of this._wingTier.keys()) {
      if (!state.air_wings.has(wingId)) this._wingTier.delete(wingId);
    }

    const claims = buildClaimsRegistry(state);
    const reconCounts = buildReconEscortCounts(state);
    const provinceNeighbors = state.provinceNeighbors;
    const changed: string[] = [];

    for (const wing of state.air_wings.values()) {
      if (wing.mission === MISSION_TYPES.IDLE || wing.mission === MISSION_TYPES.ESCORT) continue;
      if (!RETARGETABLE_STATES.has(wing.lifecycle_state as WING_LIFECYCLE)) continue;

      const result = this._resolveForMission(
        wing, state, provinceNeighbors, detectionSystem, claims, reconCounts, resolvePosition);
      if (!result) continue;

      const currentTargetStillValid = wing.target_id !== "" && this._targetStillValid(wing.target_id, state);
      const previousTier = this._wingTier.get(wing.wing_id) ?? Infinity;

      const shouldCommit =
        !currentTargetStillValid ||
        result.tier < previousTier ||
        (result.tier === previousTier && result.targetId === wing.target_id);

      if (!shouldCommit) continue;
      if (result.targetId === wing.target_id && result.tier === previousTier) continue; // already on it, no-op

      const targetPos = resolvePosition(result.targetId);
      if (!targetPos) continue;

      wing.target_id = result.targetId;
      this._wingTier.set(wing.wing_id, result.tier);

      if (wing.lifecycle_state === WING_LIFECYCLE.IDLE || wing.lifecycle_state === WING_LIFECYCLE.LOITER) {
        wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
        lifecycleSystem.resetLoiterTicks(wing.wing_id);
      }

      const startHeading = (Math.atan2(
        targetPos.lng - wing.position_lng,
        targetPos.lat - wing.position_lat,
      ) * 180 / Math.PI + 360) % 360;
      const path = pathfinder.computeTransitPath(
        { lng: wing.position_lng, lat: wing.position_lat },
        startHeading,
        targetPos,
        getAirUnitStats(wing.aircraft_type).min_turn_radius_deg,
      );
      pathfinder.storePath(wing.wing_id, path);
      wing.path_gen_id = path.path_gen_id;
      wing.path_elapsed_ms = 0;
      broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...path });
      changed.push(wing.wing_id);
    }

    if (changed.length > 0) {
      broadcast("AIR_WING_UPDATES", { wings: changed.map(id => serializeWing(state.air_wings.get(id)!)) });
    }
  }

  /** True if `targetId` still refers to a live, still-relevant target. */
  private _targetStillValid(targetId: string, state: GameRoomState): boolean {
    const asWing = state.air_wings.get(targetId);
    if (asWing) return asWing.is_detected; // enemy wing target — still valid only if still detected
    if (state.divisions.has(targetId)) return true;   // division/patrol target — always valid while it exists
    if (state.provinces.has(targetId)) return true;   // province target — always valid while it exists
    if (state.naval_contact_markers.has(targetId)) return true;
    return false; // target no longer exists in any collection
  }

  private _resolveForMission(
    wing: AirWingState,
    state: GameRoomState,
    provinceNeighbors: Map<string, string[]>,
    detectionSystem: DetectionQueries,
    claims: Map<string, number>,
    reconCounts: Map<string, number>,
    resolvePosition: ResolvePositionFn,
  ): TierResult | null {
    switch (wing.mission) {
      case MISSION_TYPES.INTERCEPTION:
        return resolveInterceptionTargets(wing, state, provinceNeighbors, detectionSystem, claims, resolvePosition);
      case MISSION_TYPES.AIR_SUPERIORITY:
        return resolveAirSuperiorityTargets(wing, state, provinceNeighbors, detectionSystem, claims, resolvePosition);
      case MISSION_TYPES.TACTICAL_BOMBING:
        return resolveTacticalBombingTargets(wing, state, provinceNeighbors, detectionSystem, claims, resolvePosition);
      case MISSION_TYPES.AREA:
      case MISSION_TYPES.INDUSTRY:
      case MISSION_TYPES.OIL:
      case MISSION_TYPES.LOGISTICS:
        return resolveStrategicBombingTargets(wing, state, claims, resolvePosition);
      case MISSION_TYPES.TRADE_INTERDICTION:
      case MISSION_TYPES.ANTI_SUBMARINE:
      case MISSION_TYPES.ANTI_SHIP:
      case MISSION_TYPES.PORT_STRIKE:
        return resolveNavalTargets(wing, state, claims);
      case MISSION_TYPES.RECON:
        return resolveReconTargets(wing, state, provinceNeighbors, claims, reconCounts, resolvePosition);
      default:
        return null;
    }
  }
}
