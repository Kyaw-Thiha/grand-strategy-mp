import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { GameRoomState, DivisionState } from "../rooms/schema/GameRoomState.js";
import { UNIT_TERRAIN_COSTS, TERRAIN_KEYS } from "../data/unit_terrain_costs.js";
import type { TemplateCell } from "../data/maps/western_europe_6/default_template.js";

// 1° latitude ≈ 111 km. Used for speed conversion only (approximate, not haversine).
const KM_PER_DEG_LAT = 111.0;

// Km/h at which divisions move on roads (game hours = ticks at speed 1).
const ROAD_SPEED_KMH = 30;
const OFFROAD_SPEED_KMH = 5;

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
    }

    for (const rc of raw.road_connections) {
      this.graph.road_node_ids.add(rc.waypoint_id);
    }

    console.log(`[MovementSystem] loaded ${raw.nodes.length} waypoints, ${raw.edges.length} edges`);
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
    // Each consecutive pair must be a real edge
    for (let i = 0; i < waypointIds.length - 1; i++) {
      if (!this.edgeSet.has(`${waypointIds[i]}|${waypointIds[i + 1]}`)) return false;
    }
    return true;
  }

  tick(state: GameRoomState): void {
    const speedMult = state.game_speed;

    for (const division of state.divisions.values()) {
      if (division.move_order.length === 0) continue;
      if (division.combat_state === "engaged") continue;

      this._advanceDivision(division, speedMult);
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
      division.move_order.splice(0, 1);
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
      division.move_order.splice(0, 1);
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
    if (total === 0) return 50;
    const armoured = template.filter(c => ARMOURED_UNIT_TYPES.has(c.unit_type)).length;
    const cavalry = template.filter(c => CAVALRY_UNIT_TYPES.has(c.unit_type)).length;
    const armouredFrac = armoured / total;
    const cavalryFrac = cavalry / total;
    let radius = 50;
    radius -= (Math.max(0, armouredFrac - 0.15) / 0.10) * 5;
    radius -= (cavalryFrac / 0.10) * 2;
    return Math.max(30, Math.min(50, radius));
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
