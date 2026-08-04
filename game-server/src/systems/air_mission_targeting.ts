import { GameRoomState, DivisionState } from "../rooms/schema/GameRoomState.js";
import { AirWingState, MISSION_TYPES, WING_LIFECYCLE, serializeWing } from "../rooms/schema/AirWingState.js";
import { getAirUnitStats } from "../data/air_unit_stats.js";
import type { AirWingLifecycleSystem } from "./air_wing_lifecycle_system.js";
import { FUEL_DECAY_TRANSIT, FUEL_RTB_THRESHOLD } from "./air_wing_lifecycle_system.js";
import type { DubinsPathfinder } from "./air_dubins_pathfinder.js";

// Same fuel-derived max-range formula as GameRoom._findNearestFriendlyAirbaseToPoint —
// duplicated here (not imported as a function) because that helper lives on GameRoom and
// depends on room-instance state; only the underlying constants are shared.
function maxRangeDeg(aircraftType: string): number {
  return (1.0 - FUEL_RTB_THRESHOLD) / FUEL_DECAY_TRANSIT * getAirUnitStats(aircraftType).speed_deg_per_ms * 1000;
}

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
// Small deterministic anti-gaming/anti-predictability term, per AIR_COMBAT.md's
// `utility = distance_falloff - CROWD_WEIGHT * claims + noise_floor` formula. Hash-derived
// (not Math.random()) so scoring stays reproducible for tests; kept an order of magnitude
// below CROWD_WEIGHT so it only breaks ties, never dominates distance/crowd.
const NOISE_WEIGHT = 0.01;

function euclidDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  return Math.sqrt((lng1 - lng2) ** 2 + (lat1 - lat2) ** 2);
}

/** Deterministic pseudo-random value in [0, 1) derived from a candidate id string. */
function idNoise(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  }
  return (h >>> 0) / 0xffffffff;
}

export function scoreCandidate(distDeg: number, claimCount: number, id?: string): number {
  const distanceFalloff = 1 / (1 + distDeg);
  const noiseFloor = id !== undefined ? NOISE_WEIGHT * idNoise(id) : 0;
  return distanceFalloff - CROWD_WEIGHT * claimCount + noiseFloor;
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
    const score = scoreCandidate(dist, claims.get(c.id) ?? 0, c.id);
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
  // Provinces owned by a stance-X nation — used below to also admit a division that's
  // physically inside stance-X territory (spawned or advanced there), independent of its
  // straight-line distance to the front line. A division several provinces deep in enemy
  // land is unambiguously "in enemy territory" even when it's well beyond
  // BORDER_PROXIMITY_DEG from the nearest province that actually touches the border.
  const stanceOwnedPositions: Array<{ lng: number; lat: number }> = [];
  const friendlyOwnedPositions: Array<{ lng: number; lat: number }> = [];
  for (const [provinceId, province] of state.provinces) {
    if (isBorderingStance(provinceId, viewerNationId, stance, state, provinceNeighbors)) {
      const pos = resolvePosition(provinceId);
      if (pos) borderProvincePositions.push(pos);
    }
    if (!province.owner_id) continue;
    const relation = getRelationStance(viewerNationId, province.owner_id, state);
    const pos = resolvePosition(provinceId);
    if (!pos) continue;
    if (relation === stance) stanceOwnedPositions.push(pos);
    else if (relation === "alliance") friendlyOwnedPositions.push(pos);
  }
  if (borderProvincePositions.length === 0 && stanceOwnedPositions.length === 0) return [];

  const nearestDist = (lng: number, lat: number, positions: Array<{ lng: number; lat: number }>): number => {
    let best = Infinity;
    for (const p of positions) {
      const d = euclidDeg(lng, lat, p.lng, p.lat);
      if (d < best) best = d;
    }
    return best;
  };

  const result: DivisionState[] = [];
  for (const division of state.divisions.values()) {
    if (!isFriendly(viewerNationId, division.nation_id, state)) continue;
    const nearBorder = borderProvincePositions.some(p =>
      euclidDeg(division.position_lng, division.position_lat, p.lng, p.lat) <= BORDER_PROXIMITY_DEG);
    // "Inside stance-X territory": nearer to a stance-X-owned province marker than to any
    // friendly-owned one. Own nation's provinces are excluded from friendlyOwnedPositions'
    // relation check (only "alliance" is friendly here — see isFriendly), so viewerNationId's
    // own provinces would otherwise be missing; that's fine, since a division near its own
    // territory is already covered by nearBorder or simply isn't a useful recon target.
    const insideStanceTerritory = stanceOwnedPositions.length > 0 &&
      nearestDist(division.position_lng, division.position_lat, stanceOwnedPositions) <
      nearestDist(division.position_lng, division.position_lat, friendlyOwnedPositions);
    if (nearBorder || insideStanceTerritory) result.push(division);
  }
  return result;
}

/**
 * Friendly-owned provinces that themselves directly border a stance-X neighbor — the
 * "no unit needed" bare border-patrol candidate, distinct from friendlyDivisionsNearBorder's
 * division-based candidates. Reuses isBorderingStance, the same real province-adjacency
 * primitive already used for the division-based border tiers.
 */
export function friendlyProvincesBorderingStance(
  viewerNationId: string,
  stance: "war" | "neutral",
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): Array<{ id: string; lng: number; lat: number }> {
  const result: Array<{ id: string; lng: number; lat: number }> = [];
  for (const [provinceId, province] of state.provinces) {
    if (!province.owner_id || !isFriendly(viewerNationId, province.owner_id, state)) continue;
    if (!isBorderingStance(provinceId, viewerNationId, stance, state, provinceNeighbors)) continue;
    const pos = resolvePosition(provinceId);
    if (pos) result.push({ id: provinceId, lng: pos.lng, lat: pos.lat });
  }
  return result;
}

export const BOMBER_TYPES = new Set(["strategic_bomber", "tactical_bomber"]);
export const LOW_ALT_BOMBER_TYPES = new Set(["cas_plane", "dive_bomber"]);
export const FIGHTER_TYPES = new Set(["fighter", "heavy_fighter"]);
// Tuned against the western_europe_6 map: median distance between adjacent provinces' city
// markers is ~2.8deg (mean ~3.0deg, max ~8.4deg) — a value much below that would exclude the
// large majority of real division-to-border-province distances, silently demoting almost
// every case to the distance-independent tier below. Still an approximation tied to this
// map's specific geography (see friendlyDivisionsNearBorder note); may need adjustment for
// maps with a different scale.
export const BORDER_PROXIMITY_DEG = 4.0;

export interface TierResult { tier: number; targetId: string; }

/**
 * Per-tick memoization cache for data that only depends on `(nationId[, stance])`, not on
 * the individual wing being resolved — `friendlyDivisionsNearBorder` and the enemy-province
 * candidate scan are both O(provinces) full scans that would otherwise re-run once per wing
 * of the same nation every tick. Callers pass one `TickCache` instance per `tick()` call;
 * individual resolver functions build their own scratch instance when called standalone
 * (e.g. directly from tests), which disables cross-call memoization but changes no behavior.
 */
export interface TickCache {
  borderDivs: Map<string, DivisionState[]>; // key: `${nationId}|${stance}`
  ownProvinces: Map<string, Array<{ id: string; lng: number; lat: number }>>; // key: nationId
  hostileProvinces: Map<string, Array<{ id: string; lng: number; lat: number }>>; // key: nationId
  warBorderProvinces: Map<string, Array<{ id: string; lng: number; lat: number }>>; // key: nationId
}

export function createTickCache(): TickCache {
  return {
    borderDivs: new Map(), ownProvinces: new Map(), hostileProvinces: new Map(),
    warBorderProvinces: new Map(),
  };
}

function getCachedWarBorderProvinces(
  cache: TickCache | undefined,
  nationId: string,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): Array<{ id: string; lng: number; lat: number }> {
  const compute = () => friendlyProvincesBorderingStance(nationId, "war", state, provinceNeighbors, resolvePosition);
  if (!cache) return compute();
  let cached = cache.warBorderProvinces.get(nationId);
  if (!cached) {
    cached = compute();
    cache.warBorderProvinces.set(nationId, cached);
  }
  return cached;
}

function getCachedBorderDivs(
  cache: TickCache | undefined,
  nationId: string,
  stance: "war" | "neutral",
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): DivisionState[] {
  if (!cache) return friendlyDivisionsNearBorder(nationId, stance, state, provinceNeighbors, resolvePosition);
  const key = `${nationId}|${stance}`;
  let cached = cache.borderDivs.get(key);
  if (!cached) {
    cached = friendlyDivisionsNearBorder(nationId, stance, state, provinceNeighbors, resolvePosition);
    cache.borderDivs.set(key, cached);
  }
  return cached;
}

function getCachedOwnProvinces(
  cache: TickCache | undefined,
  nationId: string,
  state: GameRoomState,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): Array<{ id: string; lng: number; lat: number }> {
  const compute = (): Array<{ id: string; lng: number; lat: number }> => {
    const list: Array<{ id: string; lng: number; lat: number }> = [];
    for (const [provinceId, province] of state.provinces) {
      if (province.owner_id !== nationId) continue;
      const pos = resolvePosition(provinceId);
      if (pos) list.push({ id: provinceId, lng: pos.lng, lat: pos.lat });
    }
    return list;
  };
  if (!cache) return compute();
  let cached = cache.ownProvinces.get(nationId);
  if (!cached) {
    cached = compute();
    cache.ownProvinces.set(nationId, cached);
  }
  return cached;
}

/** Shared patrol fallback used by Interception, Air Superiority, and Recon. */
export function resolvePatrolFallback(
  wing: AirWingState,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
  startTier: number,
  cache?: TickCache,
): TierResult | null {
  const nationId = wing.nation_id;

  const warBorderDivs = getCachedBorderDivs(cache, nationId, "war", state, provinceNeighbors, resolvePosition);
  const bestWar = pickBest(
    warBorderDivs.map(d => ({ id: d.division_id, lng: d.position_lng, lat: d.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (bestWar) return { tier: startTier, targetId: bestWar.id };

  const neutralBorderDivs = getCachedBorderDivs(cache, nationId, "neutral", state, provinceNeighbors, resolvePosition);
  const bestNeutral = pickBest(
    neutralBorderDivs.map(d => ({ id: d.division_id, lng: d.position_lng, lat: d.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (bestNeutral) return { tier: startTier + 1, targetId: bestNeutral.id };

  // Own cities, nearest to home airbase first — "nearest" measured from the wing's
  // home airbase per the design doc, NOT from the wing's current position (this is the
  // one tier in this file that intentionally uses a different distance origin).
  const homePos = resolvePosition(wing.home_airbase_province_id);
  const ownProvinces = getCachedOwnProvinces(cache, nationId, state, resolvePosition);
  if (ownProvinces.length > 0 && homePos) {
    // Exclude the wing's own home base — it always scores distance 0 from itself and would
    // otherwise win every time, making the wing "patrol" a point it's already sitting on.
    // Filtered per-call (not baked into the cached ownProvinces list), since that cache is
    // shared across every wing of this nation and other wings may have a different home base.
    const candidates = ownProvinces.filter(p => p.id !== wing.home_airbase_province_id);
    const best = pickBest(candidates, homePos.lng, homePos.lat, claims);
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
  cache?: TickCache,
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
  return resolvePatrolFallback(wing, state, provinceNeighbors, claims, resolvePosition, /* startTier */ 4, cache);
}

/** Air Superiority mission tier chain (mirrors Interception with reversed air-to-air priority). */
export function resolveAirSuperiorityTargets(
  wing: AirWingState,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  detectionSystem: { getWingDetectedByNations(wingId: string): Set<string> },
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
  cache?: TickCache,
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
  return resolvePatrolFallback(wing, state, provinceNeighbors, claims, resolvePosition, /* startTier */ 4, cache);
}

/** Tactical Bombing mission tier chain. */
export function resolveTacticalBombingTargets(
  wing: AirWingState,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  detectionSystem: { getVisibleDivisionsForNation(nationId: string): Set<string> },
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
  cache?: TickCache,
  visibilitySystem?: { canNationSeeDivision(nationId: string, divisionId: string): boolean },
): TierResult | null {
  const nationId = wing.nation_id;

  // Prefer the broader visibility rules ServerVisibilitySystem already computes for the
  // client (own province, alliance, and — critically — a friendly land division's own
  // observation radius, e.g. a division actively fighting an enemy one) over
  // AirDetectionSystem's narrower air-only query. A friendly land unit locked in combat
  // with an enemy division obviously knows where that enemy is, independent of any nearby
  // air asset; using the air-only query alone left Tactical Bombing unable to find a
  // target the player could plainly see their own front line fighting.
  // visibilitySystem is optional so direct-call unit tests (which construct state by hand
  // without a full ServerVisibilitySystem) can still exercise this function against the
  // narrower air-detection fallback.
  const candidates: Array<{ id: string; lng: number; lat: number }> = [];
  for (const [divId, div] of state.divisions.entries()) {
    if (isFriendly(nationId, div.nation_id, state)) continue; // must be enemy
    const visible = visibilitySystem
      ? visibilitySystem.canNationSeeDivision(nationId, divId)
      : detectionSystem.getVisibleDivisionsForNation(nationId).has(divId);
    if (!visible) continue;
    candidates.push({ id: div.division_id, lng: div.position_lng, lat: div.position_lat });
  }
  const best = pickBest(candidates, wing.position_lng, wing.position_lat, claims);
  if (best) return { tier: 1, targetId: best.id };

  // Tier 2: patrol over friendly units near a war-stance border, within the wing's max range
  // from its home airbase (AIR_COMBAT.md's Tactical Bombing tier 2 constraint) — same
  // fuel-derived range formula as GameRoom._findNearestFriendlyAirbaseToPoint, measured from
  // the home airbase to match that helper's framing.
  const homePos = resolvePosition(wing.home_airbase_province_id);
  const warBorderDivs = getCachedBorderDivs(cache, nationId, "war", state, provinceNeighbors, resolvePosition);
  const inRangeDivs = homePos
    ? warBorderDivs.filter(d =>
        euclidDeg(homePos.lng, homePos.lat, d.position_lng, d.position_lat) <= maxRangeDeg(wing.aircraft_type))
    : warBorderDivs;
  const bestPatrol = pickBest(
    inRangeDivs.map(d => ({ id: d.division_id, lng: d.position_lng, lat: d.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (bestPatrol) return { tier: 2, targetId: bestPatrol.id };

  return null; // tier 3: stay at base
}

// Secondary, tiebreaker-scale bonus applied to INDUSTRY/AREA candidate scores based on the
// province's `industry`/`population` scalar (both 0-100 in practice). Kept an order of
// magnitude below the ~0-1 distance_falloff term so it nudges rather than dominates — see
// AIR_COMBAT.md's Strategic Bombing section and this function's own comment for why OIL and
// LOGISTICS are not weighted the same way (no populated province field for either).
const SUB_MISSION_WEIGHT = 0.15;

/**
 * Strategic Bombing mission tier chain (Area / Industry / Oil / Logistics). Targets enemy
 * provinces directly — this tier chain does not filter by visibility/detection, since
 * provinces are static, always-known geography, unlike wings/divisions.
 *
 * Sub-mission weighting: INDUSTRY and AREA add a small bonus for provinces with a higher
 * `industry`/`population` scalar respectively (both populated from `map_data.json` today),
 * on top of the shared distance/crowd score. OIL is intentionally NOT weighted by an oil
 * output field — `map_data.json` carries a `resources.oil` value per province, but
 * `_initProvinces` in GameRoom.ts never copies it onto `ProvinceState` (no such field
 * exists on the schema; `oil_bombed_until_ms` is a bombing-effect timestamp, not extraction
 * output), so there is no populated data to weight by. LOGISTICS stays distance-only per
 * AIR_COMBAT.md (it targets road-segment throughput, not a province scalar).
 */
export function resolveStrategicBombingTargets(
  wing: AirWingState,
  state: GameRoomState,
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
  cache?: TickCache,
): TierResult | null {
  const nationId = wing.nation_id;

  const compute = (): Array<{ id: string; lng: number; lat: number }> => {
    const list: Array<{ id: string; lng: number; lat: number }> = [];
    for (const [provinceId, province] of state.provinces) {
      if (!province.owner_id || !isHostile(nationId, province.owner_id, state)) continue;
      const pos = resolvePosition(provinceId);
      if (pos) list.push({ id: provinceId, lng: pos.lng, lat: pos.lat });
    }
    return list;
  };
  let candidates: Array<{ id: string; lng: number; lat: number }>;
  if (!cache) {
    candidates = compute();
  } else {
    let cached = cache.hostileProvinces.get(nationId);
    if (!cached) {
      cached = compute();
      cache.hostileProvinces.set(nationId, cached);
    }
    candidates = cached;
  }

  let best: { id: string; lng: number; lat: number } | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const dist = Math.sqrt((wing.position_lng - c.lng) ** 2 + (wing.position_lat - c.lat) ** 2);
    let score = scoreCandidate(dist, claims.get(c.id) ?? 0, c.id);
    if (wing.mission === MISSION_TYPES.INDUSTRY || wing.mission === MISSION_TYPES.AREA) {
      const province = state.provinces.get(c.id);
      if (province) {
        const scalar = wing.mission === MISSION_TYPES.INDUSTRY ? province.industry : province.population;
        score += SUB_MISSION_WEIGHT * (scalar / 100);
      }
    }
    if (score > bestScore || (score === bestScore && (!best || c.id < best.id))) {
      bestScore = score;
      best = c;
    }
  }
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

// A followed bomber is only a legal recon tier-1 target while it's still actively flying
// its mission. Deliberately excludes RTB/REFUEL (a recon must drop an RTB'd bomber and
// re-target immediately, not follow it home), IDLE, and RELOCATE. Mirrors
// ESCORT_AIRBORNE_STATES minus RTB — Escort's own set legitimately keeps RTB, since
// escorts should follow their bomber home; recon should not.
const RECON_FOLLOWABLE_BOMBER_STATES = new Set([
  WING_LIFECYCLE.TRANSIT, WING_LIFECYCLE.ENGAGED, WING_LIFECYCLE.LOITER,
]);

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
  cache?: TickCache,
): TierResult | null {
  const nationId = wing.nation_id;

  // Tier 1: escort-follow a visible friendly (own OR allied — matches AIR_COMBAT.md's
  // "friendly" wording and every other friendly check in this file) strategic/tactical
  // bomber not already accompanied by another recon wing. "Not accompanied" is checked via
  // reconCounts (a recon-mission-only counter), NOT the shared claims map — the shared
  // claims map is keyed by target_id across all missions, and Escort's target_id is also a
  // bomber wing_id, so it would incorrectly read an escorted-but-unrecon'd bomber as
  // "already recon'd".
  const candidateBombers: Array<{ id: string; lng: number; lat: number }> = [];
  for (const bomber of state.air_wings.values()) {
    if (!isFriendly(nationId, bomber.nation_id, state)) continue;
    if (!RECON_ESCORT_BOMBER_TYPES.has(bomber.aircraft_type)) continue;
    if (!RECON_FOLLOWABLE_BOMBER_STATES.has(bomber.lifecycle_state as WING_LIFECYCLE)) continue;
    if ((reconCounts.get(bomber.wing_id) ?? 0) > 0) continue; // already has a recon escort
    candidateBombers.push({ id: bomber.wing_id, lng: bomber.position_lng, lat: bomber.position_lat });
  }
  const bestBomber = pickBest(candidateBombers, wing.position_lng, wing.position_lat, claims);
  if (bestBomber) return { tier: 1, targetId: bestBomber.id };

  // Tier 2: patrol ahead of a friendly land division near a war-stance border.
  const warBorderDivs = getCachedBorderDivs(cache, nationId, "war", state, provinceNeighbors, resolvePosition);
  const bestDiv = pickBest(
    warBorderDivs.map(d => ({ id: d.division_id, lng: d.position_lng, lat: d.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (bestDiv) return { tier: 2, targetId: bestDiv.id };

  // Tier 3: bare war-stance border patrol, vision-only — no friendly division needed.
  const warBorderProvs = getCachedWarBorderProvinces(cache, nationId, state, provinceNeighbors, resolvePosition);
  const bestBorderPoint = pickBest(warBorderProvs, wing.position_lng, wing.position_lat, claims);
  if (bestBorderPoint) return { tier: 3, targetId: bestBorderPoint.id };

  // Tiers 4-5: neutral-border patrol, then own cities. resolvePatrolFallback's own war-border
  // check is guaranteed empty here (we already proved warBorderDivs was empty above, or we'd
  // have returned at tier 2) — startTier=3 makes its neutral-border result land at tier 4 and
  // its own-city result land at tier 5, matching AIR_COMBAT.md's numbering without touching
  // the shared function (also used by Interception/Air Superiority/Escort with their own
  // startTier values).
  return resolvePatrolFallback(wing, state, provinceNeighbors, claims, resolvePosition, /* startTier */ 3, cache);
}

// ── Escort tier chain ───────────────────────────────────────────────────────────
//
// Unlike every other mission, Escort's "target" is a FRIENDLY bomber wing, not an enemy.
// This tier chain only ever needs to pick WHICH bomber to escort; air_dubins_pathfinder.ts
// computes the actual formation-flying path every tick from whatever that bomber is
// currently doing. AirMissionTargetingSystem.tick() special-cases Escort's commit step to
// skip path computation entirely (see below).

// Legal ongoing Escort target states — excludes RTB (an escort must drop an RTB'd bomber
// and re-target, not treat it as an ongoing eligible target — see _targetStillValid) but
// keeps IDLE/REFUEL, unlike Recon's RECON_FOLLOWABLE_BOMBER_STATES: Escort's own tier 3/4
// legitimately targets grounded bombers. Shared by pickEscortBomber's airborne-tier
// eligibility check (via ESCORT_AIRBORNE_STATES below) and _targetStillValid's Escort
// branch, so the two can never drift out of sync.
const ESCORT_TARGET_VALID_STATES = new Set([
  WING_LIFECYCLE.TRANSIT, WING_LIFECYCLE.ENGAGED, WING_LIFECYCLE.LOITER,
  WING_LIFECYCLE.IDLE, WING_LIFECYCLE.REFUEL,
]);
const ESCORT_AIRBORNE_STATES = new Set([
  WING_LIFECYCLE.TRANSIT, WING_LIFECYCLE.ENGAGED, WING_LIFECYCLE.LOITER,
]);
const HEAVY_FIGHTER_ESCORT_PRIMARY  = new Set(["strategic_bomber", "tactical_bomber"]);
const HEAVY_FIGHTER_ESCORT_FALLBACK = new Set(["cas_plane", "dive_bomber", "naval_bomber"]);
const FIGHTER_ESCORT_PRIMARY  = new Set(["cas_plane", "dive_bomber", "naval_bomber"]);
const FIGHTER_ESCORT_FALLBACK = new Set(["strategic_bomber", "tactical_bomber"]);

/** Counts live wings currently assigned (by ESCORT mission + target_id) to each bomber. */
export function buildEscortCounts(state: GameRoomState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const wing of state.air_wings.values()) {
    if (wing.mission !== MISSION_TYPES.ESCORT || !wing.target_id) continue;
    counts.set(wing.target_id, (counts.get(wing.target_id) ?? 0) + 1);
  }
  return counts;
}

function pickEscortBomber(
  nationId: string,
  typeSet: Set<string>,
  requireAirborne: boolean,
  state: GameRoomState,
  escortCounts: Map<string, number>,
): string {
  let best = "";
  let bestCount = Infinity;
  for (const w of state.air_wings.values()) {
    if (w.nation_id !== nationId) continue;
    if (!typeSet.has(w.aircraft_type)) continue;
    // Airborne tier: TRANSIT/ENGAGED/LOITER exactly. Idle tier: IDLE or REFUEL — grounded
    // bombers, whether never-launched or refueling between missions, are both escortable.
    // NOT simply "anything that isn't airborne," which would wrongly admit RTB/RELOCATE wings
    // (actively transiting somewhere, not a real "available on the ground" bomber) as
    // eligible fallback candidates.
    const eligible = requireAirborne
      ? ESCORT_AIRBORNE_STATES.has(w.lifecycle_state as WING_LIFECYCLE)
      : w.lifecycle_state === WING_LIFECYCLE.IDLE || w.lifecycle_state === WING_LIFECYCLE.REFUEL;
    if (!eligible) continue;
    const count = escortCounts.get(w.wing_id) ?? 0;
    if (count < bestCount) { bestCount = count; best = w.wing_id; }
  }
  return best;
}

/**
 * Tier 1/2: airborne bomber of the primary/fallback type for this fighter class. Tier 3/4:
 * same type preference, but only among IDLE bombers — checked strictly after every airborne
 * option, per the confirmed design ("prioritize bombers in the air; if none, check idle
 * bombers"). Re-run every tick like every other mission's chain, so an escort already
 * committed to an idle bomber upgrades the moment a real airborne bomber becomes available
 * (subject to the same hysteresis rule as every other mission — a same-tier bomber, however
 * less crowded, does not bump an already-committed escort).
 */
export function resolveEscortTargets(
  wing: AirWingState,
  state: GameRoomState,
  escortCounts: Map<string, number>,
  provinceNeighbors: Map<string, string[]>,
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
  cache?: TickCache,
): TierResult | null {
  const nationId = wing.nation_id;
  const isHeavy = wing.aircraft_type === "heavy_fighter";
  const primary  = isHeavy ? HEAVY_FIGHTER_ESCORT_PRIMARY  : FIGHTER_ESCORT_PRIMARY;
  const fallback = isHeavy ? HEAVY_FIGHTER_ESCORT_FALLBACK : FIGHTER_ESCORT_FALLBACK;

  let target = pickEscortBomber(nationId, primary, true, state, escortCounts);
  if (target) return { tier: 1, targetId: target };
  target = pickEscortBomber(nationId, fallback, true, state, escortCounts);
  if (target) return { tier: 2, targetId: target };
  target = pickEscortBomber(nationId, primary, false, state, escortCounts);
  if (target) return { tier: 3, targetId: target };
  target = pickEscortBomber(nationId, fallback, false, state, escortCounts);
  if (target) return { tier: 4, targetId: target };

  // Tiers 5-7: no eligible bomber of any kind, airborne or grounded — patrol near friendly
  // territory instead of sitting idle or permanently abandoning Escort (there's no automatic
  // way back into Escort once the mission changes). Re-checked every tick via the same
  // hysteresis rule as every other mission, so the escort snaps back to a real bomber the
  // instant one becomes eligible again.
  return resolvePatrolFallback(wing, state, provinceNeighbors, claims, resolvePosition, 5, cache);
}

// ── Step 5: Main tick() entry point ─────────────────────────────────────────────

type BroadcastFn = (type: string, msg: unknown) => void;
type DetectionQueries = {
  getWingDetectedByNations(wingId: string): Set<string>;
  getVisibleDivisionsForNation(nationId: string): Set<string>;
};
type ResolvePositionFn = (id: string) => { lng: number; lat: number } | null;
type VisibilityQueries = { canNationSeeDivision(nationId: string, divisionId: string): boolean };

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
  // Tracks the last-committed tier per wing_id, alongside the mission it was computed under —
  // tier numbers are only comparable within the same mission's tier chain (Recon tier 2 isn't
  // Interception tier 2), so a mission change resets the comparison to "no prior commitment"
  // rather than comparing across incompatible chains. A wing already on a valid tier-N target
  // is never bumped to a different, merely-less-crowded tier-N target — only a strictly better
  // tier, or an invalidated current target, triggers a reassignment.
  private _wingTier: Map<string, { tier: number; mission: string }> = new Map();

  // Wing IDs currently under player-directed manual targeting (right-click interception,
  // tactical bombing, or industry bombing target selection — see GameRoom.ts's
  // ASSIGN_WING_MISSION handler). AIR_COMBAT.md scopes auto-targeting to "any mission's
  // auto-search with NO manually selected target" — a wing in this set is left alone by
  // tick() every tick until its manual target becomes invalid, at which point control is
  // handed back to auto-search. Distinct from air_dubins_pathfinder.ts's own
  // `registerManualTarget`, which only feeds INTERCEPTION's lost-contact loiter logic and
  // has no concept of "don't auto-retarget this wing."
  private _manuallyTargetedWings: Set<string> = new Set();

  /** Marks `wingId` as player-directed — tick() will not auto-retarget it while still valid. */
  registerManualTarget(wingId: string): void {
    this._manuallyTargetedWings.add(wingId);
  }

  /** Hands `wingId` back to auto-search (e.g. a non-manual mission re-assignment). */
  clearManualTarget(wingId: string): void {
    this._manuallyTargetedWings.delete(wingId);
  }

  tick(
    state: GameRoomState,
    detectionSystem: DetectionQueries,
    lifecycleSystem: AirWingLifecycleSystem,
    pathfinder: DubinsPathfinder,
    resolvePosition: ResolvePositionFn,
    broadcast: BroadcastFn,
    visibilitySystem?: VisibilityQueries,
  ): void {
    if (!_targetingEnabled) return;

    for (const wingId of this._wingTier.keys()) {
      if (!state.air_wings.has(wingId)) this._wingTier.delete(wingId);
    }
    for (const wingId of this._manuallyTargetedWings) {
      if (!state.air_wings.has(wingId)) this._manuallyTargetedWings.delete(wingId);
    }

    const claims = buildClaimsRegistry(state);
    const reconCounts = buildReconEscortCounts(state);
    const escortCounts = buildEscortCounts(state);
    const provinceNeighbors = state.provinceNeighbors;
    const cache = createTickCache();
    const changed: string[] = [];

    for (const wing of state.air_wings.values()) {
      if (wing.mission === MISSION_TYPES.IDLE) continue;
      if (!RETARGETABLE_STATES.has(wing.lifecycle_state as WING_LIFECYCLE)) continue;

      const isEscort = wing.mission === MISSION_TYPES.ESCORT;
      const currentTargetStillValid = wing.target_id !== ""
        && this._targetStillValid(wing.target_id, state, wing.mission);

      // Manual-target protection (C1): a player-directed wing keeps its target untouched by
      // auto-search for as long as that target stays valid. Once invalid, hand control back
      // to auto-search — fall through to the normal resolution below. Escort has no manual
      // right-click flow (no client entry point sets is_manual for it), so this never
      // applies to it in practice, but the check is harmless either way.
      if (!isEscort && this._manuallyTargetedWings.has(wing.wing_id)) {
        if (currentTargetStillValid) continue;
        this._manuallyTargetedWings.delete(wing.wing_id);
      }

      // Distinguishes "had a bomber, it just went RTB" from "never had a bomber" (a
      // freshly-spawned escort with no target still falls through to patrol tiers 5-7
      // below, unaffected) — only the former skips patrol duty and RTBs to the bomber's
      // own base once no replacement bomber is found.
      const oldTargetWing = isEscort && wing.target_id !== "" ? state.air_wings.get(wing.target_id) : undefined;
      const droppedForRtb = isEscort && !currentTargetStillValid
        && oldTargetWing !== undefined && oldTargetWing.lifecycle_state === WING_LIFECYCLE.RTB;

      let result: TierResult | null;
      if (isEscort) {
        result = resolveEscortTargets(
          wing, state, escortCounts, provinceNeighbors, claims, resolvePosition, cache);
        if (droppedForRtb && (!result || result.tier >= 5)) {
          // No bomber tier (1-4) matched (either a patrol tier, or nothing at all) — skip
          // patrol duty, RTB to the FORMER bomber's base instead.
          wing.escort_rtb_fallback_province_id = oldTargetWing!.home_airbase_province_id;
          result = null;
        } else if (result && result.tier <= 4) {
          wing.escort_rtb_fallback_province_id = ""; // found a replacement — clear any stale stash
        }
      } else {
        // C2: exclude the wing's own claim on its own current target from the crowd count
        // while resolving FOR this wing — otherwise every wing re-evaluating its own
        // current target is penalized by its own claim, biasing the search away from a
        // target it should be allowed to keep. Scoped: decrement before resolving, restore
        // immediately after, since `claims` is shared across all wings resolved this tick.
        const ownTargetId = wing.target_id;
        const ownClaimCount = ownTargetId !== "" ? claims.get(ownTargetId) : undefined;
        if (ownTargetId !== "" && ownClaimCount) claims.set(ownTargetId, ownClaimCount - 1);
        result = this._resolveForMission(
          wing, state, provinceNeighbors, detectionSystem, claims, reconCounts, resolvePosition,
          cache, visibilitySystem);
        if (ownTargetId !== "" && ownClaimCount) claims.set(ownTargetId, ownClaimCount);
      }

      if (!result) {
        if (droppedForRtb && wing.escort_rtb_fallback_province_id !== "") {
          // Bomber went RTB, no replacement bomber or patrol duty available — RTB straight
          // to the former bomber's base rather than sitting with a dead target.
          wing.target_id = "";
          wing.escort_intercept_id = "";
          this._wingTier.delete(wing.wing_id);
          wing.lifecycle_state = WING_LIFECYCLE.RTB;
          changed.push(wing.wing_id);
          continue;
        }
        // I5: invalidated target with no replacement found — clear it rather than leaving
        // the wing flying at/toward a dead target forever. The lifecycle system's existing
        // LOITER/RTB machinery takes over from here.
        if (!currentTargetStillValid && wing.target_id !== "") {
          wing.target_id = "";
          this._wingTier.delete(wing.wing_id);
        }
        continue;
      }

      const wingTierEntry = this._wingTier.get(wing.wing_id);
      const previousTier = (wingTierEntry && wingTierEntry.mission === wing.mission)
        ? wingTierEntry.tier
        : Infinity; // I4: no comparable prior commitment — either none, or a different mission's chain

      // Escort committing to a live bomber never gets a path built here at all (see the
      // isEscort branch below) — its "path" is the ahead/loiter formation logic mirroring
      // the bomber every tick, not a stored commit-time path — so hasPath is meaningless
      // for that case and must not force a spurious re-commit every tick.
      const targetIsLiveBomberForEscort = isEscort && state.air_wings.has(result.targetId);
      // Real bug: a wing can reach this point with the same target/tier as before but no
      // live path — e.g. air_wing_lifecycle_system.ts's post-refuel pending-mission
      // reassignment calls assignMission() directly (not through GameRoom.ts's
      // ASSIGN_WING_MISSION handler, the only call site that actually builds a path), and
      // RTB->REFUEL already cleared any previous path. If target/tier are unchanged, the
      // "already on it" no-op used to skip committing forever, leaving the wing stuck in
      // TRANSIT with nothing to fly (patrol-fallback targets are a division/city/marker id,
      // not a wing id, so the pathfinder's own generic re-path loop can't resolve a position
      // for it and recover on its own either) — this is the deterministic cause of a
      // recon/patrol wing "staying at its airbase" after a refuel cycle even though a
      // legitimate far-away patrol target was already resolved.
      const pathMissing = !targetIsLiveBomberForEscort && !pathfinder.hasPath(wing.wing_id);
      // M11: the prior third disjunct here (`result.tier === previousTier && result.targetId
      // === wing.target_id`) could only ever be followed immediately by the no-op guard
      // below, so it never actually caused a commit — removed for readability.
      const shouldCommit = !currentTargetStillValid || result.tier < previousTier || pathMissing;
      if (!shouldCommit) continue;
      if (result.targetId === wing.target_id && result.tier === previousTier
          && !pathMissing) continue; // already on it, no-op

      if (isEscort && state.air_wings.has(result.targetId)) {
        // Committing to a bomber: Escort does not compute a Dubins path at all —
        // air_dubins_pathfinder.ts's own per-tick sync continuously mirrors the escort's
        // path_gen_id/path_elapsed_ms (and underlying path) to whatever its assigned bomber
        // is currently doing ("Sync escort wings" block). Only the target and the lifecycle
        // transition that makes the escort eligible for that sync are needed here. A patrol
        // target (tier 5-7, a friendly division/city rather than a bomber wing) falls through
        // to the normal Dubins path computation below instead, same as every other mission.
        const previousTargetId = wing.target_id;
        wing.target_id = result.targetId;
        wing.escort_intercept_id = ""; // fresh bomber assignment — never carry a stale break-off target
        this._wingTier.set(wing.wing_id, { tier: result.tier, mission: wing.mission });
        escortCounts.set(result.targetId, (escortCounts.get(result.targetId) ?? 0) + 1);
        if (previousTargetId !== result.targetId) {
          // Rendezvous: set the bomber-side reciprocal reference and hold it back at reduced
          // speed (air_dubins_pathfinder.ts's per-wing advancement loop) until this escort
          // has caught up and established its ahead formation (air_wing_lifecycle_system.ts
          // clears both fields once that happens, or on timeout/reassignment/loss). Only a
          // genuinely NEW bomber commit triggers this, not every re-evaluation of the same
          // still-valid target.
          const bomberWing = state.air_wings.get(result.targetId);
          if (bomberWing) {
            bomberWing.escorted_by_wing_id = wing.wing_id;
            bomberWing.awaiting_escort_rendezvous = true;
          }
        }
        if (previousTargetId !== "" && previousTargetId !== result.targetId) {
          if (escortCounts.has(previousTargetId)) {
            const vacated = (escortCounts.get(previousTargetId) ?? 1) - 1;
            if (vacated > 0) escortCounts.set(previousTargetId, vacated);
            else escortCounts.delete(previousTargetId);
          } else if (claims.has(previousTargetId)) {
            // Previous target was a patrol claim (division/city), not a bomber — vacate
            // there instead so patrol-target crowding scores don't leak stale claims.
            const vacatedCount = (claims.get(previousTargetId) ?? 1) - 1;
            if (vacatedCount > 0) claims.set(previousTargetId, vacatedCount);
            else claims.delete(previousTargetId);
          }
        }
        if (wing.lifecycle_state === WING_LIFECYCLE.IDLE || wing.lifecycle_state === WING_LIFECYCLE.LOITER) {
          wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
          lifecycleSystem.resetLoiterTicks(wing.wing_id);
        }
        changed.push(wing.wing_id);
        continue;
      }

      if (isEscort) {
        const previousTargetId = wing.target_id;
        if (previousTargetId !== "" && previousTargetId !== result.targetId) {
          const vacated = (escortCounts.get(previousTargetId) ?? 1) - 1;
          if (vacated > 0) escortCounts.set(previousTargetId, vacated);
          else escortCounts.delete(previousTargetId);
        }
      }

      const targetPos = resolvePosition(result.targetId);
      if (!targetPos) {
        // I5: same dead-target cleanup as the `!result` branch above.
        if (!currentTargetStillValid && wing.target_id !== "") {
          wing.target_id = "";
          this._wingTier.delete(wing.wing_id);
        }
        continue;
      }

      const previousTargetId = wing.target_id;
      wing.target_id = result.targetId;
      this._wingTier.set(wing.wing_id, { tier: result.tier, mission: wing.mission });

      // I3: keep `claims` live within this same tick as wings commit, so N wings launching
      // the same tick against the same target pool spread out instead of all evaluating
      // against a stale pre-tick snapshot and piling onto one contact.
      claims.set(result.targetId, (claims.get(result.targetId) ?? 0) + 1);
      if (previousTargetId !== "" && previousTargetId !== result.targetId) {
        const vacatedCount = (claims.get(previousTargetId) ?? 1) - 1;
        if (vacatedCount > 0) claims.set(previousTargetId, vacatedCount);
        else claims.delete(previousTargetId);
      }

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
        getAirUnitStats(wing.aircraft_type).speed_deg_per_ms,
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
  private _targetStillValid(targetId: string, state: GameRoomState, mission: string): boolean {
    const asWing = state.air_wings.get(targetId);
    if (asWing) {
      // Only Interception/Air Superiority target an ENEMY wing, where "no longer detected"
      // genuinely means "lost contact, find something else." Escort and Recon's
      // escort-a-bomber tier target a FRIENDLY wing — is_detected there reflects whether an
      // ENEMY nation currently sees it, which has nothing to do with whether the
      // escort/recon assignment is still meaningful.
      const pursuingEnemyWing = mission === MISSION_TYPES.INTERCEPTION || mission === MISSION_TYPES.AIR_SUPERIORITY;
      if (pursuingEnemyWing) return asWing.is_detected;
      if (mission === MISSION_TYPES.RECON) {
        return RECON_FOLLOWABLE_BOMBER_STATES.has(asWing.lifecycle_state as WING_LIFECYCLE);
      }
      if (mission === MISSION_TYPES.ESCORT) {
        return ESCORT_TARGET_VALID_STATES.has(asWing.lifecycle_state as WING_LIFECYCLE);
      }
      return true;
    }
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
    cache: TickCache,
    visibilitySystem?: VisibilityQueries,
  ): TierResult | null {
    switch (wing.mission) {
      case MISSION_TYPES.INTERCEPTION:
        return resolveInterceptionTargets(wing, state, provinceNeighbors, detectionSystem, claims, resolvePosition, cache);
      case MISSION_TYPES.AIR_SUPERIORITY:
        return resolveAirSuperiorityTargets(wing, state, provinceNeighbors, detectionSystem, claims, resolvePosition, cache);
      case MISSION_TYPES.TACTICAL_BOMBING:
        return resolveTacticalBombingTargets(
          wing, state, provinceNeighbors, detectionSystem, claims, resolvePosition, cache, visibilitySystem);
      case MISSION_TYPES.AREA:
      case MISSION_TYPES.INDUSTRY:
      case MISSION_TYPES.OIL:
      case MISSION_TYPES.LOGISTICS:
        return resolveStrategicBombingTargets(wing, state, claims, resolvePosition, cache);
      case MISSION_TYPES.TRADE_INTERDICTION:
      case MISSION_TYPES.ANTI_SUBMARINE:
      case MISSION_TYPES.ANTI_SHIP:
      case MISSION_TYPES.PORT_STRIKE:
        return resolveNavalTargets(wing, state, claims);
      case MISSION_TYPES.RECON:
        return resolveReconTargets(wing, state, provinceNeighbors, claims, reconCounts, resolvePosition, cache);
      default:
        return null;
    }
  }
}
