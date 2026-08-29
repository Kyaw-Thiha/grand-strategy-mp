import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getCachedFile } from "../data/map_cache.js";
import type { GameRoomState, DivisionState, RelationState } from "../rooms/schema/GameRoomState.js";
import { UNIT_TERRAIN_COSTS, TERRAIN_KEYS } from "../data/unit_terrain_costs.js";
import type { TemplateCell } from "../data/maps/western_europe_6/default_template.js";
import type { SubprovinceSystem } from "./subprovince_system.js";
import { makeIsFriendly } from "./subprovince_system.js";
import { findRetreatPath } from "./supply_graph.js";
import type { SubprovinceDefinition } from "../data/map_loader.js";

type RelationLookup = {
  get(key: string): RelationState | undefined;
};

// 1° latitude ≈ 111 km. Used for speed conversion only (approximate, not haversine).
const KM_PER_DEG_LAT = 111.0;

// Same temporary diagnostic switch as combat_system.ts's STUCK_UNIT_DEBUG (see its doc comment) —
// duplicated here rather than imported to keep each file's debug logging independent of the
// other's module graph; both are gated by the same env var so one flag toggles both.
const STUCK_UNIT_DEBUG = process.env.STUCK_UNIT_DEBUG === "true";

// Km/h at which divisions move on roads (game hours = ticks at speed 1).
const ROAD_SPEED_KMH = 60;
const OFFROAD_SPEED_KMH = 20;

// Reposition constants
const REPOSITION_MAX_KM   = 12;
const REPOSITION_SPEED    = 0.30; // 30% of normal movement speed

// Last-mile ("exact click target") straight-line hop bounds — see resolveFinalPosition's doc
// comment. Tunable, illustrative, no playtesting basis yet, same convention as other density/
// timing constants elsewhere in this codebase.
/** Cap = (longest direct edge from the chain's last waypoint) × this multiplier — leeway on top of
 *  the graph's own local density, not an exact/harsh cutoff at the raw spacing. */
const LAST_MILE_CAP_SLACK_MULT = 1.5;
/** Fallback cap (degrees) only for the edge case of an isolated last-waypoint node with no
 *  neighbors to measure local density from. */
const FALLBACK_LAST_MILE_CAP_DEG = 0.05; // ~5.5km at KM_PER_DEG_LAT
/** Sample step (degrees) for the last-mile segment's neutral/terrain validity sweep — mirrors
 *  subprovince_system.ts's SWEEP_STEP_DEG capture-sweep constant (same rationale: fine enough that
 *  a blocking cell can't be skipped between samples). */
const LAST_MILE_SWEEP_STEP_DEG = 0.02;

// Units considered "armoured" for type classification and engagement radius.
const ARMOURED_UNIT_TYPES = new Set(["light_tank", "heavy_tank", "medium_tank"]);
const CAVALRY_UNIT_TYPES = new Set(["cavalry"]);

export interface WaypointNode {
  id: string;
  lng: number;
  lat: number;
  cover_combat: string;
  elevation: string;
}

export interface WaypointEdge {
  from: string;
  to: string;
  base_cost: number;
  river_size: string | null;
}

export interface WaypointGraph {
  nodes: Map<string, WaypointNode>;
  adjacency: Map<string, string[]>; // node_id → neighbour node_ids
  road_node_ids: Set<string>;       // nodes that lie on any road
}

export class MovementSystem {
  private graph: WaypointGraph = {
    nodes: new Map(),
    adjacency: new Map(),
    road_node_ids: new Set(),
  };
  // "from|to" and "to|from" for O(1) edge connectivity check
  private edgeSet: Set<string> = new Set();
  // Cached parsed movement profiles per division
  private profileCache: Map<string, Record<string, number>> = new Map();
  // River segments collected from waypoint edges for combat crossing checks
  private riverSegments: Array<{ x1: number; y1: number; x2: number; y2: number; size: string }> = [];
  /**
   * division_id -> position at the start of this tick's movement advancement, recorded only for
   * divisions that actually attempt to move this tick (cleared and rebuilt every tick(), not
   * carried over). Lets GameRoom.gameTick() pass a full start->end segment into
   * SubprovinceSystem.checkCaptureAfterMovement() instead of only the post-move end position — a
   * single division can cross more than one subprovince cell in one tick (see _advanceDivision's
   * leftover-budget recursion), so sampling only the end position silently skips cells crossed
   * along the way. A division with no entry here didn't move this tick, so the caller should treat
   * start == end (a degenerate, zero-length segment) for it.
   */
  private tickStartPositions: Map<string, { lng: number; lat: number }> = new Map();

  loadWaypoints(mapId: string): void {
    const __dir = dirname(fileURLToPath(import.meta.url));
    // From game-server/src/systems/ → 2 levels up = game-server/
    const gameServerRoot = join(__dir, "../..");
    const dataPath = join(gameServerRoot, "..", "client", "assets", "data", mapId, "waypoints.json");

    let raw: { nodes: WaypointNode[]; edges: WaypointEdge[]; road_connections: { road_id: string; waypoint_id: string }[] };
    try {
      raw = getCachedFile(dataPath);
    } catch {
      console.warn(`[MovementSystem] waypoints.json not found at ${dataPath} — road movement disabled`);
      return;
    }

    for (const node of raw.nodes) {
      this.graph.nodes.set(node.id, node);
      if (!this.graph.adjacency.has(node.id)) {
        this.graph.adjacency.set(node.id, []);
      }
    }

    for (const edge of raw.edges) {
      this.graph.adjacency.get(edge.from)?.push(edge.to);
      this.graph.adjacency.get(edge.to)?.push(edge.from);
      this.edgeSet.add(`${edge.from}|${edge.to}`);
      this.edgeSet.add(`${edge.to}|${edge.from}`);
      // Collect river segments for combat river crossing checks
      if (edge.river_size) {
        const fromNode = this.graph.nodes.get(edge.from);
        const toNode   = this.graph.nodes.get(edge.to);
        if (fromNode && toNode) {
          this.riverSegments.push({ x1: fromNode.lng, y1: fromNode.lat, x2: toNode.lng, y2: toNode.lat, size: edge.river_size });
        }
      }
    }

    for (const rc of raw.road_connections) {
      this.graph.road_node_ids.add(rc.waypoint_id);
    }

    console.log(`[MovementSystem] loaded ${raw.nodes.length} waypoints, ${raw.edges.length} edges`);

    // Load terrain grid (server-only — client uses road-only waypoints.json)
    const terrainPath = join(gameServerRoot, "..", "client", "assets", "data", mapId, "waypoints_terrain.json");
    if (existsSync(terrainPath)) {
      const tRaw = getCachedFile<{ nodes: WaypointNode[]; edges: WaypointEdge[] }>(terrainPath);
      for (const node of tRaw.nodes) {
        this.graph.nodes.set(node.id, node);
        this.graph.adjacency.set(node.id, []);
        // tg_ nodes intentionally omitted from road_node_ids → off-road speed applied
      }
      for (const edge of tRaw.edges) {
        this.graph.adjacency.get(edge.from)?.push(edge.to);
        this.graph.adjacency.get(edge.to)?.push(edge.from);
        this.edgeSet.add(`${edge.from}|${edge.to}`);
        this.edgeSet.add(`${edge.to}|${edge.from}`);
        if (edge.river_size) {
          const fromNode = this.graph.nodes.get(edge.from);
          const toNode   = this.graph.nodes.get(edge.to);
          if (fromNode && toNode) {
            this.riverSegments.push({ x1: fromNode.lng, y1: fromNode.lat, x2: toNode.lng, y2: toNode.lat, size: edge.river_size });
          }
        }
      }
      console.log(`[MovementSystem] merged terrain grid: ${tRaw.nodes.length} nodes, ${tRaw.edges.length} edges`);
    }
  }

  getNearestWaypoint(lng: number, lat: number): WaypointNode | null {
    let best: WaypointNode | null = null;
    let bestDist = Infinity;
    for (const node of this.graph.nodes.values()) {
      const dx = node.lng - lng;
      const dy = node.lat - lat;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = node; }
    }
    return best;
  }

  validateMoveOrder(waypointIds: string[]): boolean {
    for (const id of waypointIds) {
      if (!this.graph.nodes.has(id)) return false;
    }
    return true;
  }

  /**
   * Returns true if the waypoint belongs to a nation that is neither at war nor allied with
   * divNationId. Ownership is resolved LIVE via SubprovinceSystem/state.subprovinces rather than
   * from a frozen map-boot-time snapshot — subprovince geometry is static once generated, but
   * `owner_id` changes constantly at runtime (capture, revert, city cascade), and this used to read
   * a one-time province-polygon snapshot (`loadMapData`/`waypointNation`, since removed) that went
   * stale the moment the first subprovince capture happened. This runs once per submitted waypoint
   * path (not per tick), so a live per-call lookup is cheap enough — no cache needed here, unlike
   * the client's Pathfinder, which touches many more nodes per A* search (see pathfinder.gd).
   */
  private _isNeutralFor(
    waypointId: string,
    divNationId: string,
    relations: RelationLookup,
    subprovinceSystem: SubprovinceSystem | null,
    subprovinces: GameRoomState["subprovinces"] | null,
  ): boolean {
    const node = this.graph.nodes.get(waypointId);
    if (!node) return false;
    return this._isPositionNeutralFor(node.lng, node.lat, divNationId, relations, subprovinceSystem, subprovinces);
  }

  /**
   * Position-based core of _isNeutralFor, factored out so resolveFinalPosition's segment sweep
   * (last-mile straight-line validation) can reuse the exact same live-ownership logic against
   * arbitrary sampled points, not just waypoint-graph nodes.
   */
  private _isPositionNeutralFor(
    lng: number,
    lat: number,
    divNationId: string,
    relations: RelationLookup,
    subprovinceSystem: SubprovinceSystem | null,
    subprovinces: GameRoomState["subprovinces"] | null,
  ): boolean {
    // No live ownership data available (e.g. getNearestNonNeutralWaypoint's very-early-
    // initialization / subprovinceSystem-not-yet-wired fallback) — fail open, same convention as
    // the unmapped/sea case below rather than blocking on data we don't have.
    if (!subprovinceSystem || !subprovinces) return false;
    const subprovinceId = subprovinceSystem.getSubprovinceAtPosition({ lng, lat });
    const posNation = subprovinceId ? (subprovinces.get(subprovinceId)?.owner_id ?? "") : "";
    if (posNation === "" || posNation === divNationId) return false; // unmapped/sea or own territory
    const rel = relations.get(`${divNationId}|${posNation}`)
            ?? relations.get(`${posNation}|${divNationId}`);
    const stance = rel?.stance ?? "neutral";
    return stance !== "war" && stance !== "alliance";
  }

  /**
   * Trim a waypoint path at the first neutral-territory waypoint.
   * Returns the allowed prefix. An empty result means even the first waypoint is neutral —
   * the caller should reject the order.
   *
   * Design: trimming is better UX than outright rejection — units advance as far as
   * allowed along the player's intended route.
   */
  trimToAllowedTerritory(
    waypointIds: string[],
    divNationId: string,
    relations: RelationLookup,
    subprovinceSystem: SubprovinceSystem,
    subprovinces: GameRoomState["subprovinces"],
  ): string[] {
    const allowed: string[] = [];
    for (const id of waypointIds) {
      if (this._isNeutralFor(id, divNationId, relations, subprovinceSystem, subprovinces)) break;
      allowed.push(id);
    }
    return allowed;
  }

  /**
   * Validates and clamps a player's exact-click "final position" against the waypoint chain's
   * neutral-territory guard and terrain passability — the "last mile" straight-line hop
   * (_advanceFinalPosition) used to accept this raw click coordinate completely unchecked, letting
   * a division cut an arbitrarily long straight line across borders/impassable terrain once its
   * waypoint chain ran out. Called once at move-order submission time (GameRoom.handleSubmitMoveOrder),
   * not per-tick — mirrors trimToAllowedTerritory's own "decide once, walk toward a known-safe point
   * afterward" design.
   *
   * Two independent checks, both measured from `lastWaypointId` (the chain's last surviving node —
   * guaranteed non-null by the caller, since an all-neutral chain is already rejected outright
   * before final position is ever considered):
   *
   * 1. Distance cap: the requested point is clamped to at most
   *    `(longest direct edge from lastWaypointId) × LAST_MILE_CAP_SLACK_MULT` — scaled to the local
   *    waypoint graph's own density rather than a flat radius, with slack so a legitimate click a
   *    bit past the nearest node isn't harshly clipped. Falls back to FALLBACK_LAST_MILE_CAP_DEG
   *    only if the node has no neighbors to measure density from.
   * 2. Segment sweep: samples the clamped straight-line segment (LAST_MILE_SWEEP_STEP_DEG apart,
   *    same technique as subprovince_system.ts's capture-sweep) and truncates at the first sample
   *    that's either neutral territory or impassable terrain — "advance as far as allowed," same
   *    philosophy as trimToAllowedTerritory.
   *
   * Returns the resolved, safe point, or null if even the first sample beyond lastWaypointId is
   * blocked (caller should then leave final_position unset — the division simply stops at the last
   * waypoint).
   */
  resolveFinalPosition(
    lastWaypointId: string,
    requestedLng: number,
    requestedLat: number,
    division: DivisionState,
    relations: RelationLookup,
    subprovinceSystem: SubprovinceSystem,
    subprovinces: GameRoomState["subprovinces"],
  ): { lng: number; lat: number } | null {
    const lastNode = this.graph.nodes.get(lastWaypointId);
    if (!lastNode) return null;

    // 1. Distance cap from local graph density, with slack.
    const neighborIds = this.graph.adjacency.get(lastWaypointId) ?? [];
    let maxEdgeDeg = 0;
    for (const neighborId of neighborIds) {
      const neighbor = this.graph.nodes.get(neighborId);
      if (!neighbor) continue;
      const d = Math.sqrt((neighbor.lng - lastNode.lng) ** 2 + (neighbor.lat - lastNode.lat) ** 2);
      if (d > maxEdgeDeg) maxEdgeDeg = d;
    }
    const capDeg = (maxEdgeDeg > 0 ? maxEdgeDeg : FALLBACK_LAST_MILE_CAP_DEG) * LAST_MILE_CAP_SLACK_MULT;

    const dx = requestedLng - lastNode.lng;
    const dy = requestedLat - lastNode.lat;
    const requestedDistDeg = Math.sqrt(dx * dx + dy * dy);
    const clampRatio = Math.min(1, capDeg / Math.max(requestedDistDeg, 1e-9));
    const targetLng = lastNode.lng + dx * clampRatio;
    const targetLat = lastNode.lat + dy * clampRatio;

    // 2. Segment sweep for neutral-territory/terrain validity, truncating at the first blocked
    // sample. Starts sampling at i=1 (excludes lastNode itself, already validated by
    // trimToAllowedTerritory) through the (possibly distance-clamped) target, inclusive.
    const sweepDistDeg = Math.sqrt((targetLng - lastNode.lng) ** 2 + (targetLat - lastNode.lat) ** 2);
    const steps = Math.max(1, Math.ceil(sweepDistDeg / LAST_MILE_SWEEP_STEP_DEG));
    let resolvedLng = lastNode.lng;
    let resolvedLat = lastNode.lat;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const lng = lastNode.lng + (targetLng - lastNode.lng) * t;
      const lat = lastNode.lat + (targetLat - lastNode.lat) * t;
      if (this._isPositionNeutralFor(lng, lat, division.nation_id, relations, subprovinceSystem, subprovinces)) break;
      if (!isFinite(this._terrainCostAtPosition(lng, lat, division))) break;
      resolvedLng = lng;
      resolvedLat = lat;
    }

    if (resolvedLng === lastNode.lng && resolvedLat === lastNode.lat) return null; // blocked immediately
    return { lng: resolvedLng, lat: resolvedLat };
  }

  checkRiverCrossing(lng1: number, lat1: number, lng2: number, lat2: number): string {
    for (const seg of this.riverSegments) {
      if (this._segmentsIntersect(lng1, lat1, lng2, lat2, seg.x1, seg.y1, seg.x2, seg.y2)) {
        return seg.size;
      }
    }
    return "";
  }

  private _segmentsIntersect(
    ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number,
  ): boolean {
    const d1x = bx - ax, d1y = by - ay;
    const d2x = dx - cx, d2y = dy - cy;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-10) return false;
    const t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross;
    const u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  calculatePathDistance(waypointIds: string[], startLng: number, startLat: number): number {
    let totalKm = 0;
    let prevLng = startLng;
    let prevLat = startLat;
    for (const id of waypointIds) {
      const node = this.graph.nodes.get(id);
      if (!node) continue;
      totalKm += this._distKm(prevLng, prevLat, node.lng, node.lat);
      prevLng = node.lng;
      prevLat = node.lat;
    }
    return totalKm;
  }

  private _distKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
    return Math.sqrt((aLng - bLng) ** 2 + (aLat - bLat) ** 2) * KM_PER_DEG_LAT;
  }

  /** Like getNearestWaypoint but filters out waypoints in neutral territory. Pass null for
   *  subprovinceSystem/subprovinces when live ownership data isn't available (see _isNeutralFor's
   *  fail-open doc comment) — this fails open rather than blocking on missing data. */
  getNearestNonNeutralWaypoint(
    lng: number,
    lat: number,
    divNationId: string,
    relations: RelationLookup,
    subprovinceSystem: SubprovinceSystem | null,
    subprovinces: GameRoomState["subprovinces"] | null,
  ): WaypointNode | null {
    let best: WaypointNode | null = null;
    let bestDist = Infinity;
    for (const [id, node] of this.graph.nodes) {
      if (this._isNeutralFor(id, divNationId, relations, subprovinceSystem, subprovinces)) continue;
      const dx = node.lng - lng;
      const dy = node.lat - lat;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = node; }
    }
    return best ?? this.getNearestWaypoint(lng, lat); // fallback if all neutral
  }

  /**
   * Batch 8 Task 3 — graph-based, ownership-aware retreat targeting. Replaces the purely
   * distance-based `getNearestNonNeutralWaypoint` at the retreat-target-selection call site in
   * `combat_system.ts`'s `_initiateRetreat`: instead of the nearest non-neutral waypoint in raw
   * distance, this resolves the division's current subprovince and runs Task 2's
   * `findRetreatPath` (Dijkstra with ownership-tiered edge costs) to find the cheapest path to a
   * friendly-or-allied road-corridor cell or supply hub, then translates that path's destination
   * subprovince into the nearest waypoint via the existing `getNearestWaypoint` lookup — keeping
   * ordinary move-order execution (which only understands waypoint IDs) untouched.
   *
   * Fallback (division's position resolves to no known subprovince, e.g. off-map or mid-strait):
   * behaves like the old `getNearestNonNeutralWaypoint`, using the division's raw lng/lat —
   * there is no subprovince to graph-search from, so distance-based targeting is the only
   * option left, exactly as it was before this method existed.
   */
  /**
   * Returns the position a division occupied at the start of this tick's movement advancement, or
   * null if the division didn't move this tick (in which case a caller should treat its movement
   * segment as a zero-length point at its current position). See tickStartPositions' doc comment.
   */
  getTickStartPosition(divisionId: string): { lng: number; lat: number } | null {
    return this.tickStartPositions.get(divisionId) ?? null;
  }

  computeRetreatTarget(
    division: DivisionState,
    state: GameRoomState,
    subprovinceSystem: SubprovinceSystem,
  ): { waypointId: string | null; blockedFraction: number } {
    const startId = subprovinceSystem.getSubprovinceAtPosition({ lng: division.position_lng, lat: division.position_lat });
    if (startId === null) {
      const fallback = this.getNearestNonNeutralWaypoint(
        division.position_lng, division.position_lat, division.nation_id, state.relations,
        subprovinceSystem, state.subprovinces,
      );
      return { waypointId: fallback?.id ?? null, blockedFraction: 0 };
    }

    const graph = subprovinceSystem.getGraph();
    const ownership = new Map<string, { ownerId: string; provinceId: string }>();
    for (const [id, sp] of state.subprovinces) {
      ownership.set(id, { ownerId: sp.owner_id, provinceId: sp.province_id });
    }
    const isFriendly = makeIsFriendly(division.nation_id, state.relations);
    const hubs = subprovinceSystem.getHubSubprovinceIds(state, isFriendly);

    const retreatPath = findRetreatPath(
      graph,
      ownership,
      hubs,
      startId,
      division.nation_id,
      isFriendly,
      subprovinceSystem.isCombatFrozen.bind(subprovinceSystem),
    );

    const destinationId = retreatPath.subprovinceIds[retreatPath.subprovinceIds.length - 1];
    const destinationDef = graph.nodes.get(destinationId);
    const destinationPoint = destinationDef
      ? this._centroidOf(destinationDef)
      : { lng: division.position_lng, lat: division.position_lat };

    const waypoint = this.getNearestWaypoint(destinationPoint.lng, destinationPoint.lat);
    return { waypointId: waypoint?.id ?? null, blockedFraction: retreatPath.blockedFraction };
  }

  /**
   * Centroid of a subprovince cell's outer ring, excluding a duplicated closing vertex if
   * present. `SubprovinceDefinition` carries no stored centroid/representative point (confirmed
   * against `map_loader.ts`), so this ports the exact ring-closing-vertex-aware algorithm
   * already used by `test/subprovince-capture.test.ts`'s `centroidOf` helper rather than
   * inventing new geometry. Used only to translate a retreat path's destination subprovince into
   * a representative point for `getNearestWaypoint` — not a general-purpose PIP tool.
   */
  private _centroidOf(def: SubprovinceDefinition): { lng: number; lat: number } {
    const ring = def.polygon[0];
    if (!ring || ring.length === 0) return { lng: 0, lat: 0 };
    const first = ring[0];
    const last = ring[ring.length - 1];
    const pts = (first[0] === last[0] && first[1] === last[1]) ? ring.slice(0, -1) : ring;
    let lng = 0, lat = 0;
    for (const [x, y] of pts) { lng += x; lat += y; }
    return { lng: lng / pts.length, lat: lat / pts.length };
  }

  tick(state: GameRoomState): void {
    const speedMult = state.game_speed;
    this.tickStartPositions.clear();

    for (const division of state.divisions.values()) {
      const hasFinalPos = division.final_position_lng > -998;
      if (division.move_order.length === 0 && !hasFinalPos) continue;
      if (division.combat_state === "engaged" || division.combat_state === "suppressed") {
        if (STUCK_UNIT_DEBUG && division.move_order.length > 0) {
          console.log(`[STUCK_UNIT_DEBUG] movement-skipped: ${division.division_id}(${division.nation_id}, `
            + `combat_state=${division.combat_state}, supply=${division.supply_status}) has a `
            + `pending move_order but is frozen by combat this tick`);
        }
        continue;
      }

      this.tickStartPositions.set(division.division_id, {
        lng: division.position_lng,
        lat: division.position_lat,
      });

      // Reset consumed_waypoint_ids before each tick
      division.consumed_waypoint_ids.splice(0, division.consumed_waypoint_ids.length);
      if (division.move_order.length > 0) {
        this._advanceDivision(division, speedMult);
      }
      // After waypoints exhausted, advance to exact click target if set
      if (division.move_order.length === 0 && division.final_position_lng > -998) {
        this._advanceFinalPosition(division, speedMult);
      }
    }

    // Secondary loop: process reposition movement for engaged/suppressed divisions
    {
      let reposCount = 0;
      for (const division of state.divisions.values()) {
        if (division.reposition_order.length === 0) continue;
        reposCount++;
        if (division.combat_state !== "engaged" && division.combat_state !== "suppressed") {
          continue;
        }
        this._advanceReposition(division, speedMult);
      }
      if (reposCount === 0) {
        // Log a few divisions' repos_order state for debugging
        // No engaged divisions with repos orders — normal
      }
    }
  }

  private _advanceDivision(division: DivisionState, speedMult: number): void {
    const nextId = division.move_order[0];
    const nextNode = this.graph.nodes.get(nextId);
    if (!nextNode) {
      division.move_order.splice(0, 1);
      return;
    }

    const dx = nextNode.lng - division.position_lng;
    const dy = nextNode.lat - division.position_lat;
    const distDeg = Math.sqrt(dx * dx + dy * dy);

    if (distDeg < 0.0001) {
      division.position_lng = nextNode.lng;
      division.position_lat = nextNode.lat;
      division.consumed_waypoint_ids.push(nextId);
      division.move_order.splice(0, 1);
      if (division.move_order.length > 0) {
        this._advanceDivision(division, speedMult);
      }
      return;
    }

    // Speed: 1 tick = 1 game hour at speed 1.
    // On road: ROAD_SPEED_KMH. Off-road: OFFROAD_SPEED_KMH / profile_cost (harder terrain = slower).
    const onRoad = this.graph.road_node_ids.has(nextId);
    let kmh: number;
    if (onRoad) {
      kmh = ROAD_SPEED_KMH;
    } else {
      const profile = this._getProfile(division);
      const terrainKey = `${nextNode.cover_combat}_${nextNode.elevation}`;
      const cost = profile[terrainKey] ?? Infinity;
      if (!isFinite(cost)) {
        // Impassable tile in path — skip this waypoint
        division.move_order.splice(0, 1);
        return;
      }
      kmh = OFFROAD_SPEED_KMH / cost;
    }
    // degrees per tick (1 tick = speedMult game hours). Retreating divisions carrying a
    // fighting-withdrawal penalty (Batch 8 Task 3) move at retreat_speed_mult of normal speed —
    // applied here (own movement) but deliberately NOT in _advanceReposition, which is
    // in-combat repositioning, not retreat movement.
    const advanceDeg = (kmh / KM_PER_DEG_LAT) * speedMult * division.retreat_speed_mult;

    if (advanceDeg >= distDeg) {
      division.position_lng = nextNode.lng;
      division.position_lat = nextNode.lat;
      division.consumed_waypoint_ids.push(nextId);
      division.move_order.splice(0, 1);
      // Carry leftover budget into the next waypoint — mirrors client _advance_dr logic.
      if (division.move_order.length > 0 && advanceDeg > 0) {
        const leftoverMult = speedMult * (1.0 - distDeg / advanceDeg);
        if (leftoverMult > 1e-4) {
          this._advanceDivision(division, leftoverMult);
        }
      }
    } else {
      const ratio = advanceDeg / distDeg;
      division.position_lng += dx * ratio;
      division.position_lat += dy * ratio;
      // No waypoint consumed this call — pre-tick reset already cleared the array.
    }
  }

  private _advanceFinalPosition(division: DivisionState, speedMult: number): void {
    const dx = division.final_position_lng - division.position_lng;
    const dy = division.final_position_lat - division.position_lat;
    const distDeg = Math.sqrt(dx * dx + dy * dy);

    if (distDeg < 0.0001) {
      division.position_lng = division.final_position_lng;
      division.position_lat = division.final_position_lat;
      division.final_position_lng = -999;
      division.final_position_lat = -999;
      return;
    }

    // Use nearest graph node's terrain type to determine last-mile speed. The destination/segment
    // itself was already validated once at submission time (see resolveFinalPosition) — this
    // per-tick check is defense-in-depth against the division's current tile changing underneath it
    // (e.g. mid-walk combat interruption), not the only validation.
    const nearestId = this._findNearestNode(division.position_lng, division.position_lat);
    const onRoad = nearestId !== null && this.graph.road_node_ids.has(nearestId);
    let kmh: number;
    if (onRoad) {
      kmh = ROAD_SPEED_KMH;
    } else {
      const cost = this._terrainCostAtPosition(division.position_lng, division.position_lat, division);
      if (!isFinite(cost)) {
        // Impassable — abort final position
        division.final_position_lng = -999;
        division.final_position_lat = -999;
        return;
      }
      kmh = OFFROAD_SPEED_KMH / cost;
    }

    const advanceDeg = (kmh / KM_PER_DEG_LAT) * speedMult * division.retreat_speed_mult;
    if (advanceDeg >= distDeg) {
      division.position_lng = division.final_position_lng;
      division.position_lat = division.final_position_lat;
      division.final_position_lng = -999;
      division.final_position_lat = -999;
    } else {
      const ratio = advanceDeg / distDeg;
      division.position_lng += dx * ratio;
      division.position_lat += dy * ratio;
    }
  }

  private _findNearestNode(lng: number, lat: number): string | null {
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const [id, node] of this.graph.nodes) {
      const dx = node.lng - lng;
      const dy = node.lat - lat;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; bestId = id; }
    }
    return bestId;
  }

  /**
   * Terrain movement cost at an arbitrary point, keyed off the nearest graph node's terrain type —
   * the same "look up my current tile's cost" approximation _advanceFinalPosition already used
   * inline, factored out so resolveFinalPosition's segment sweep (last-mile straight-line
   * validation) can reuse it against arbitrary sampled points, not just the division's own position.
   * Road nodes always cost 1.0 (never impassable). Returns Infinity when off-road terrain is
   * impassable for the division's profile; fails open (1.0) when there's no nearby graph node at
   * all, matching this codebase's existing "no data → don't block" convention.
   */
  private _terrainCostAtPosition(lng: number, lat: number, division: DivisionState): number {
    const nearestId = this._findNearestNode(lng, lat);
    const nearestNode = nearestId !== null ? this.graph.nodes.get(nearestId) : undefined;
    if (!nearestNode) return 1.0;
    if (this.graph.road_node_ids.has(nearestId!)) return 1.0;
    const profile = this._getProfile(division);
    const terrainKey = `${nearestNode.cover_combat}_${nearestNode.elevation}`;
    const cost = profile[terrainKey] ?? 1.0;
    return (!isFinite(cost) || cost <= 0) ? Infinity : cost;
  }

  private _advanceReposition(division: DivisionState, speedMult: number): void {
    const nextId = division.reposition_order[0];
    const nextNode = this.graph.nodes.get(nextId);
    if (!nextNode) {
      division.reposition_order.splice(0, 1);
      return;
    }

    const dx = nextNode.lng - division.position_lng;
    const dy = nextNode.lat - division.position_lat;
    const distDeg = Math.sqrt(dx * dx + dy * dy);

    if (distDeg < 0.0001) {
      division.position_lng = nextNode.lng;
      division.position_lat = nextNode.lat;
      division.reposition_order.splice(0, 1);
      if (division.reposition_order.length > 0) {
        this._advanceReposition(division, speedMult);
      }
      return;
    }

    // Speed calculation matches _advanceDivision but multiplied by REPOSITION_SPEED (0.30)
    const onRoad = this.graph.road_node_ids.has(nextId);
    let kmh: number;
    if (onRoad) {
      kmh = ROAD_SPEED_KMH;
    } else {
      const profile = this._getProfile(division);
      const terrainKey = `${nextNode.cover_combat}_${nextNode.elevation}`;
      const cost = profile[terrainKey] ?? Infinity;
      if (!isFinite(cost)) {
        division.reposition_order.splice(0, 1);
        return;
      }
      kmh = OFFROAD_SPEED_KMH / cost;
    }
    // 30% of normal movement speed, multiplied by game speed
    const advanceDeg = ((kmh * REPOSITION_SPEED) / KM_PER_DEG_LAT) * speedMult;

    if (advanceDeg >= distDeg) {
      division.position_lng = nextNode.lng;
      division.position_lat = nextNode.lat;
      division.reposition_order.splice(0, 1);
      if (division.reposition_order.length > 0 && advanceDeg > 0) {
        const leftoverMult = speedMult * (1.0 - distDeg / advanceDeg);
        if (leftoverMult > 1e-4) {
          this._advanceReposition(division, leftoverMult);
        }
      }
    } else {
      const ratio = advanceDeg / distDeg;
      division.position_lng += dx * ratio;
      division.position_lat += dy * ratio;
    }
  }

  // ── Template analysis helpers ─────────────────────────────────────────────

  computeMovementProfile(template: TemplateCell[]): Record<string, number> {
    const profile: Record<string, number> = {};
    for (const key of TERRAIN_KEYS) {
      const costs = template.map(cell => {
        const unitCosts = UNIT_TERRAIN_COSTS[cell.unit_type];
        return unitCosts ? (unitCosts[key] ?? Infinity) : Infinity;
      });

      if (costs.some(c => c === Infinity)) {
        profile[key] = Infinity;
        continue;
      }

      const minCost = Math.min(...costs);
      const meanCost = costs.reduce((s, c) => s + c, 0) / costs.length;
      profile[key] = minCost * 0.4 + meanCost * 0.6;
    }
    return profile;
  }

  classifyDivisionType(template: TemplateCell[]): "armoured" | "motorised" | "infantry" {
    const total = template.length;
    if (total === 0) return "infantry";
    const armoured = template.filter(c => ARMOURED_UNIT_TYPES.has(c.unit_type)).length;
    const frac = armoured / total;
    if (frac >= 0.40) return "armoured";
    if (frac >= 0.15) return "motorised";
    return "infantry";
  }

  computeEngagementRadius(template: TemplateCell[]): number {
    const total = template.length;
    if (total === 0) return 25;
    const armoured = template.filter(c => ARMOURED_UNIT_TYPES.has(c.unit_type)).length;
    const cavalry = template.filter(c => CAVALRY_UNIT_TYPES.has(c.unit_type)).length;
    const armouredFrac = armoured / total;
    const cavalryFrac = cavalry / total;
    let radius = 25;
    radius -= (Math.max(0, armouredFrac - 0.15) / 0.10) * 0.5;
    radius -= (cavalryFrac / 0.10) * 0.25;
    return Math.max(22, Math.min(25, radius));
  }

  computeObservationRadius(_template: TemplateCell[]): number {
    // Baseline: 100 km. Recon units extend this — deferred to Phase 5.
    return 100;
  }

  private _getProfile(division: DivisionState): Record<string, number> {
    if (!this.profileCache.has(division.division_id)) {
      try {
        this.profileCache.set(division.division_id, JSON.parse(division.movement_profile_json));
      } catch {
        this.profileCache.set(division.division_id, {});
      }
    }
    return this.profileCache.get(division.division_id)!;
  }
}
