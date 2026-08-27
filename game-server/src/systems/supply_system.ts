import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getCachedFile } from "../data/map_cache.js";
import type { GameRoomState, DivisionState } from "../rooms/schema/GameRoomState.js";
import { findSupplyRoute, type SupplyRoute } from "./supply_graph.js";
import { SubprovinceSystem, makeIsFriendly } from "./subprovince_system.js";

// ─── Tunable constants ──────────────────────────────────────────────────────

const KM_PER_DEG = 111.0;

// How many game ticks between full supply-status recalculation
const SUPPLY_TICK_INTERVAL = 5;

// Corridor check: walk outward in 8 directions, this many steps of STEP_KM each.
// A direction "succeeds" when it reaches a friendly city within 1.5× STEP_KM without
// crossing any enemy engagement radius.
const CORRIDOR_STEP_KM  = 30;
const CORRIDOR_MAX_STEPS = 5;   // 150 km max reach per direction

// Encirclement: sample points at MULT × engagement_radius from division centre;
// if BLOCKED_THRESHOLD of ENCIRCLE_DIRS are inside an enemy engagement radius → encircled
const ENCIRCLE_SAMPLE_MULT       = 1.5;
const ENCIRCLE_DIRS              = 8;
const ENCIRCLE_BLOCKED_THRESHOLD = 7;  // 7 of 8 directions blocked

// HP drained every game tick (not supply tick) based on supply tier
const OOS_HP_DRAIN_PER_TICK       = 0.05;   // slow attrition out of supply
const CUTOFF_HP_DRAIN_PER_TICK    = 0.15;   // fighting-withdrawal cost
const ENCIRCLED_HP_DRAIN_PER_TICK = 0.35;   // rapid deterioration while fully encircled

// A unit in enemy/neutral territory is still treated as "in friendly" if any friendly
// city is within this distance — handles border units where a neutral city happens to
// be geometrically closer than the nearest friendly one.
const FRIENDLY_TERRITORIAL_REACH_KM = 250;

// Status tiers in order of severity — degradation limited to one tier per supply tick
const TIER_ORDER = ["normal", "out_of_supply", "cut_off", "encircled"] as const;
type SupplyTier = typeof TIER_ORDER[number];

// ─── Internal types ─────────────────────────────────────────────────────────

interface ProvinceCity {
  city_lng:  number;
  city_lat:  number;
  nation_id: string; // initial owner (fallback when state.provinces has no entry)
}

// ─── SupplySystem ────────────────────────────────────────────────────────────

export class SupplySystem {
  private provinces = new Map<string, ProvinceCity>();

  // ---------------------------------------------------------------------------
  // loadMapData
  // ---------------------------------------------------------------------------

  loadMapData(mapId: string): void {
    const __dir    = dirname(fileURLToPath(import.meta.url));
    const dataPath = join(__dir, "../..", "..", "client", "assets", "data", mapId, "map_data.json");
    try {
      const raw = getCachedFile<{ provinces: Array<{ province_id: string; nation_id: string; city_position: [number, number] }> }>(dataPath);
      for (const p of raw.provinces ?? []) {
        if (!p.province_id || !p.city_position) continue;
        this.provinces.set(p.province_id, {
          city_lng:  p.city_position[0],
          city_lat:  p.city_position[1],
          nation_id: p.nation_id ?? "",
        });
      }
      console.log(`[SupplySystem] loaded ${this.provinces.size} province cities`);
    } catch {
      console.warn("[SupplySystem] map_data.json not found — supply checks disabled");
    }
  }

  // ---------------------------------------------------------------------------
  // computeSubprovinceRoutes — authoritative subprovince-graph supply routing
  // ---------------------------------------------------------------------------

  /**
   * Computes one SupplyRoute per living (non-destroyed) division whose current position
   * resolves to a known subprovince, via Dijkstra over the subprovince adjacency graph
   * (see `findSupplyRoute` in supply_graph.ts). Divisions whose position resolves to no
   * subprovince are silently skipped rather than throwing.
   */
  computeSubprovinceRoutes(state: GameRoomState, subprovinceSystem: SubprovinceSystem): SupplyRoute[] {
    const graph = subprovinceSystem.getGraph();
    const ownership = new Map<string, { ownerId: string; provinceId: string }>();
    for (const [id, sp] of state.subprovinces) {
      ownership.set(id, { ownerId: sp.owner_id, provinceId: sp.province_id });
    }

    const routes: SupplyRoute[] = [];
    for (const division of state.divisions.values()) {
      if (division.combat_state === "destroyed") continue;
      const startId = subprovinceSystem.getSubprovinceAtPosition({ lng: division.position_lng, lat: division.position_lat });
      if (startId === null) continue;

      const isFriendly = makeIsFriendly(division.nation_id, state.relations);
      const hubs = subprovinceSystem.getHubSubprovinceIds(state, isFriendly);
      // Scoped to the requesting DIVISION's own nation only — a division may transit through a
      // cell its own side occupies even if that cell isn't (yet) friendly-owned, but this must
      // never extend to allies' occupation, only the requester's own nation's divisions.
      const isOccupiedByRequester = (subprovinceId: string) =>
        [...state.divisions.values()].some(
          (d) => d.nation_id === division.nation_id && d.combat_state !== "destroyed" &&
                 subprovinceSystem.getSubprovinceAtPosition({ lng: d.position_lng, lat: d.position_lat }) === subprovinceId,
        );

      routes.push(
        findSupplyRoute(graph, ownership, hubs, startId, division.nation_id, isFriendly, isOccupiedByRequester, division.division_id),
      );
    }
    return routes;
  }

  // ---------------------------------------------------------------------------
  // tick — called every game tick from GameRoom
  // ---------------------------------------------------------------------------

  tick(
    state:      GameRoomState,
    tickCount:  number,
    broadcast:  (type: string, msg: unknown) => void,
  ): Set<string> {
    // DISABLED: supply system temporarily disabled — pending rework.
    // All logic below is preserved; re-enable by removing this early return.
    void state; void tickCount; void broadcast;
    return new Set<string>();

    /* eslint-disable no-unreachable */
    const changed = new Set<string>();

    if (tickCount === 1) {
      console.log(`[SupplySystem] first tick — provinces loaded: ${this.provinces.size}`);
    }
    if (tickCount % SUPPLY_TICK_INTERVAL === 0) {
      console.log(`[SupplySystem] supply tick ${tickCount} — checking ${Array.from(state.divisions.values()).filter(d => d.combat_state !== "destroyed").length} live divisions`);
    }

    // ── Per-tick HP drain based on current supply tier ──────────────────────
    for (const [, div] of state.divisions) {
      if (div.combat_state === "destroyed") continue;

      let drain = 0;
      if (div.supply_status === "out_of_supply") drain = OOS_HP_DRAIN_PER_TICK;
      else if (div.supply_status === "cut_off")    drain = CUTOFF_HP_DRAIN_PER_TICK;
      else if (div.supply_status === "encircled")  drain = ENCIRCLED_HP_DRAIN_PER_TICK;

      if (drain > 0) {
        div.hp = Math.max(0, div.hp - drain);
        changed.add(div.division_id);
      }
    }

    // ── Full status recalculation every N ticks ──────────────────────────────
    if (tickCount % SUPPLY_TICK_INTERVAL !== 0) return changed;

    const divList = Array.from(state.divisions.values());

    for (const div of divList) {
      if (div.combat_state === "destroyed") continue;

      const oldStatus = div.supply_status as SupplyTier;
      const computed  = this._computeStatus(div, divList, state) as SupplyTier;

      // Status can only degrade ONE tier per supply tick; can improve freely
      const oldTier      = TIER_ORDER.indexOf(oldStatus);
      const computedTier = TIER_ORDER.indexOf(computed);
      const newTier      = computedTier > oldTier ? oldTier + 1 : computedTier;
      const newStatus    = TIER_ORDER[newTier];

      if (newStatus === oldStatus) continue;

      div.supply_status = newStatus;
      changed.add(div.division_id);

      const evtNames: Record<string, string> = {
        out_of_supply: "OUT_OF_SUPPLY",
        cut_off:       "CUT_OFF",
        encircled:     "DIVISION_ENCIRCLED",
      };
      if (evtNames[newStatus]) {
        broadcast(evtNames[newStatus], {
          division_id:   div.division_id,
          nation_id:     div.nation_id,
          supply_status: newStatus,
        });
      } else if (newStatus === "normal") {
        broadcast("SUPPLY_RESTORED", {
          division_id: div.division_id,
          nation_id:   div.nation_id,
        });
      }

      console.log(`[SupplySystem] ${div.division_id}: ${oldStatus} → ${newStatus}`);
    }

    return changed;
    /* eslint-enable no-unreachable */
  }

  // ---------------------------------------------------------------------------
  // _computeStatus
  // ---------------------------------------------------------------------------

  private _computeStatus(
    div:      DivisionState,
    divList:  DivisionState[],
    state:    GameRoomState,
  ): string {
    const enemies = divList.filter(
      d => d.nation_id !== div.nation_id && d.combat_state !== "destroyed",
    );

    // Step 1: Territory check — nearest province by city distance, with fallback for
    // border units where a neutral city happens to be geometrically closer than the
    // nearest friendly city (e.g. Saarbrücken is closer to Luxembourg than Frankfurt).
    const nearestProv       = this._nearestProvince(div.position_lng, div.position_lat, state);
    const nearestFriendlyKm = this._nearestFriendlyProvinceKm(
      div.nation_id, div.position_lng, div.position_lat, state,
    );
    const inFriendly = nearestProv?.ownerId === div.nation_id
                    || nearestFriendlyKm <= FRIENDLY_TERRITORIAL_REACH_KM;

    // Step 2: In friendly territory — only full encirclement can hurt supply
    if (inFriendly) {
      if (this._isEncircled(div, divList)) return "encircled";
      return "normal";
    }

    // Step 3: In enemy/neutral territory — check whether supply corridor is open.
    // A corridor is open if ANY of 8 outward directions reaches a friendly province
    // city without crossing an enemy engagement radius.
    const corridorOpen = this._corridorOpen(div, enemies, div.nation_id, state);
    if (corridorOpen) return "out_of_supply";   // in enemy territory, line not yet cut

    // Corridor is blocked — check full encirclement
    if (this._isEncircled(div, divList)) return "encircled";
    return "cut_off";
  }

  // ---------------------------------------------------------------------------
  // _nearestProvince — find the nearest province city and its live owner
  // ---------------------------------------------------------------------------

  private _nearestProvince(
    lng:   number,
    lat:   number,
    state: GameRoomState,
  ): { ownerId: string } | null {
    let best: { ownerId: string } | null = null;
    let bestDist = Infinity;
    for (const [provinceId, prov] of this.provinces) {
      const d = this._distKm(lng, lat, prov.city_lng, prov.city_lat);
      if (d < bestDist) {
        bestDist = d;
        const stateP = state.provinces.get(provinceId);
        best = { ownerId: stateP ? stateP.owner_id : prov.nation_id };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // _corridorOpen — 8-direction walk to detect whether supply can reach the
  // division from friendly territory without crossing enemy engagement radii
  // ---------------------------------------------------------------------------

  private _corridorOpen(
    div:      DivisionState,
    enemies:  DivisionState[],
    nationId: string,
    state:    GameRoomState,
  ): boolean {
    const friendlyReachKm = CORRIDOR_STEP_KM * 1.5;

    for (let d = 0; d < ENCIRCLE_DIRS; d++) {
      const angle = (2 * Math.PI * d) / ENCIRCLE_DIRS;

      for (let step = 1; step <= CORRIDOR_MAX_STEPS; step++) {
        const distKm = step * CORRIDOR_STEP_KM;
        const sLng   = div.position_lng + Math.cos(angle) * (distKm / KM_PER_DEG);
        const sLat   = div.position_lat + Math.sin(angle) * (distKm / KM_PER_DEG);

        // Blocked if inside any enemy engagement radius
        const blocked = enemies.some(
          e => this._distKm(sLng, sLat, e.position_lng, e.position_lat) <= e.engagement_radius,
        );
        if (blocked) break;   // this direction is cut off, try next

        // If this sample point is near a friendly city → corridor confirmed open
        const nearestKm = this._nearestFriendlyProvinceKm(nationId, sLng, sLat, state);
        if (nearestKm <= friendlyReachKm) return true;
      }
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // _nearestFriendlyProvinceKm
  // ---------------------------------------------------------------------------

  private _nearestFriendlyProvinceKm(
    nationId: string,
    lng: number,
    lat: number,
    state: GameRoomState,
  ): number {
    let best = Infinity;
    for (const [provinceId, prov] of this.provinces) {
      // Use live owner from state if available, otherwise fall back to initial owner
      const stateProvince = state.provinces.get(provinceId);
      const ownerId = stateProvince ? stateProvince.owner_id : prov.nation_id;
      if (ownerId !== nationId) continue;

      const d = this._distKm(lng, lat, prov.city_lng, prov.city_lat);
      if (d < best) best = d;
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // _isEncircled — sample 8 directions; count those blocked by enemy divisions
  // ---------------------------------------------------------------------------

  private _isEncircled(div: DivisionState, divList: DivisionState[]): boolean {
    const sampleRadiusDeg = (div.engagement_radius * ENCIRCLE_SAMPLE_MULT) / KM_PER_DEG;
    const enemies = divList.filter(
      d => d.nation_id !== div.nation_id && d.combat_state !== "destroyed",
    );

    let blockedCount = 0;
    for (let i = 0; i < ENCIRCLE_DIRS; i++) {
      const angle    = (2 * Math.PI * i) / ENCIRCLE_DIRS;
      const sampleLng = div.position_lng + Math.cos(angle) * sampleRadiusDeg;
      const sampleLat = div.position_lat + Math.sin(angle) * sampleRadiusDeg;

      for (const enemy of enemies) {
        const distToEnemy = this._distKm(sampleLng, sampleLat, enemy.position_lng, enemy.position_lat);
        if (distToEnemy <= enemy.engagement_radius) {
          blockedCount++;
          break;
        }
      }
    }

    return blockedCount >= ENCIRCLE_BLOCKED_THRESHOLD;
  }

  // ---------------------------------------------------------------------------
  // _distKm — matches movement_system / combat_system
  // ---------------------------------------------------------------------------

  private _distKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
    return Math.sqrt((aLng - bLng) ** 2 + (aLat - bLat) ** 2) * KM_PER_DEG;
  }
}
