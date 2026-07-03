import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { GameRoomState, DivisionState, RelationState } from "../rooms/schema/GameRoomState.js";
import { UNIT_TERRAIN_COSTS, TERRAIN_KEYS } from "../data/unit_terrain_costs.js";
import type { TemplateCell } from "../data/maps/western_europe_6/default_template.js";

type RelationLookup = {
  get(key: string): RelationState | undefined;
};

// 1° latitude ≈ 111 km. Used for speed conversion only (approximate, not haversine).
const KM_PER_DEG_LAT = 111.0;

// Km/h at which divisions move on roads (game hours = ticks at speed 1).
const ROAD_SPEED_KMH = 60;
const OFFROAD_SPEED_KMH = 20;

// Reposition constants
const REPOSITION_MAX_KM   = 12;
const REPOSITION_SPEED    = 0.30; // 30% of normal movement speed

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
  // waypointId → nationId for territory checks (built by loadMapData)
  private waypointNation: Map<string, string> = new Map();
  // River segments collected from waypoint edges for combat crossing checks
  private riverSegments: Array<{ x1: number; y1: number; x2: number; y2: number; size: string }> = [];

  loadWaypoints(mapId: string): void {
    const __dir = dirname(fileURLToPath(import.meta.url));
    // From game-server/src/systems/ → 2 levels up = game-server/
    const gameServerRoot = join(__dir, "../..");
    const dataPath = join(gameServerRoot, "..", "client", "assets", "data", mapId, "waypoints.json");

    let raw: { nodes: WaypointNode[]; edges: WaypointEdge[]; road_connections: { road_id: string; waypoint_id: string }[] };
    try {
      raw = JSON.parse(readFileSync(dataPath, "utf-8"));
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
      const tRaw = JSON.parse(readFileSync(terrainPath, "utf-8")) as {
        nodes: WaypointNode[];
        edges: WaypointEdge[];
      };
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

  /** Build waypointId → nationId mapping via point-in-polygon against map_data.json. */
  loadMapData(mapId: string): void {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const gameServerRoot = join(__dir, "../..");
    const dataPath = join(gameServerRoot, "..", "client", "assets", "data", mapId, "map_data.json");

    let raw: { provinces: Array<{ nation_id: string; polygons: number[][][] }> };
    try {
      raw = JSON.parse(readFileSync(dataPath, "utf-8"));
    } catch {
      console.warn(`[MovementSystem] map_data.json not found — territory checks disabled`);
      return;
    }

    // Pre-compute bounding boxes for each province to reduce point-in-polygon checks
    interface BBox { minLng: number; maxLng: number; minLat: number; maxLat: number; nationId: string; polygons: number[][][] }
    const bboxes: BBox[] = [];
    for (const province of raw.provinces) {
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const ring of province.polygons) {
        for (const coord of ring) {
          if (coord[0] < minLng) minLng = coord[0];
          if (coord[0] > maxLng) maxLng = coord[0];
          if (coord[1] < minLat) minLat = coord[1];
          if (coord[1] > maxLat) maxLat = coord[1];
        }
      }
      bboxes.push({ minLng, maxLng, minLat, maxLat, nationId: province.nation_id, polygons: province.polygons });
    }

    for (const [waypointId, node] of this.graph.nodes) {
      for (const bb of bboxes) {
        if (node.lng < bb.minLng || node.lng > bb.maxLng) continue;
        if (node.lat < bb.minLat || node.lat > bb.maxLat) continue;
        // Waypoint is within bounding box — check actual polygon
        let found = false;
        for (const ring of bb.polygons) {
          if (this._pointInPolygon(node.lng, node.lat, ring)) {
            this.waypointNation.set(waypointId, bb.nationId);
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
    console.log(`[MovementSystem] built waypoint→nation mapping: ${this.waypointNation.size} nodes mapped`);
  }

  /** Returns true if (px, py) is inside the given polygon ring using ray casting. */
  private _pointInPolygon(px: number, py: number, polygon: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** Returns true if the waypoint belongs to a nation that is neither at war nor allied with divNationId. */
  private _isNeutralFor(
    waypointId: string,
    divNationId: string,
    relations: RelationLookup,
  ): boolean {
    const wpNation = this.waypointNation.get(waypointId) ?? "";
    if (wpNation === "" || wpNation === divNationId) return false; // unmapped/sea or own territory
    const rel = relations.get(`${divNationId}|${wpNation}`)
            ?? relations.get(`${wpNation}|${divNationId}`);
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
  ): string[] {
    const allowed: string[] = [];
    for (const id of waypointIds) {
      if (this._isNeutralFor(id, divNationId, relations)) break;
      allowed.push(id);
    }
    return allowed;
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

  /** Like getNearestWaypoint but filters out waypoints in neutral territory. */
  getNearestNonNeutralWaypoint(
    lng: number,
    lat: number,
    divNationId: string,
    relations: RelationLookup,
  ): WaypointNode | null {
    let best: WaypointNode | null = null;
    let bestDist = Infinity;
    for (const [id, node] of this.graph.nodes) {
      if (this._isNeutralFor(id, divNationId, relations)) continue;
      const dx = node.lng - lng;
      const dy = node.lat - lat;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = node; }
    }
    return best ?? this.getNearestWaypoint(lng, lat); // fallback if all neutral
  }

  tick(state: GameRoomState): void {
    const speedMult = state.game_speed;

    for (const division of state.divisions.values()) {
      const hasFinalPos = division.final_position_lng > -998;
      if (division.move_order.length === 0 && !hasFinalPos) continue;
      if (division.combat_state === "engaged" || division.combat_state === "suppressed") continue;

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
    // degrees per tick (1 tick = speedMult game hours)
    const advanceDeg = (kmh / KM_PER_DEG_LAT) * speedMult;

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

    // Use nearest graph node's terrain type to determine last-mile speed
    const nearestId = this._findNearestNode(division.position_lng, division.position_lat);
    const nearestNode = nearestId !== null ? this.graph.nodes.get(nearestId) : undefined;
    let kmh = OFFROAD_SPEED_KMH;
    if (nearestNode) {
      if (this.graph.road_node_ids.has(nearestId!)) {
        kmh = ROAD_SPEED_KMH;
      } else {
        const profile = this._getProfile(division);
        const terrainKey = `${nearestNode.cover_combat}_${nearestNode.elevation}`;
        const cost = profile[terrainKey] ?? 1.0;
        if (!isFinite(cost) || cost <= 0) {
          // Impassable — abort final position
          division.final_position_lng = -999;
          division.final_position_lat = -999;
          return;
        }
        kmh = OFFROAD_SPEED_KMH / cost;
      }
    }

    const advanceDeg = (kmh / KM_PER_DEG_LAT) * speedMult;
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
