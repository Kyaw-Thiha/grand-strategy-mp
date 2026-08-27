import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getCachedFile } from "../data/map_cache.js";
import type { GameRoomState, DivisionState } from "../rooms/schema/GameRoomState.js";
import { findSupplyRoute, type SupplyRoute } from "./supply_graph.js";
import { SubprovinceSystem, makeIsFriendly } from "./subprovince_system.js";
import type { SubprovinceGraph } from "../data/map_loader.js";

// ─── Tunable constants ──────────────────────────────────────────────────────

const KM_PER_DEG = 111.0;

// How many game ticks between full supply-status recalculation
const SUPPLY_TICK_INTERVAL = 5;

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
export type SupplyTier = typeof TIER_ORDER[number];

// ─── Internal types ─────────────────────────────────────────────────────────

interface ProvinceCity {
  city_lng:  number;
  city_lat:  number;
  nation_id: string; // initial owner (fallback when state.provinces has no entry)
}

type SubprovinceOwnership = { ownerId: string; provinceId: string };

// ─── Ring-based graph supply tier (Batch 8) ────────────────────────────────
//
// Implements docs/STRATEGIC_COMBAT.md's three-tier supply model:
//   Tier 1 — Out of Supply: no friendly/allied path exists to any friendly/allied supply hub,
//            walking only through friendly/allied-owned subprovinces (off-road hops count for
//            reachability — the "Tier 1 Correction"; only *throughput*, a separate Batch 5
//            routing concern in supply_graph.ts, is affected by road vs. off-road).
//   Tier 2 — Cut Off: ring(1), ring(2), or ring(3) around the division is entirely non-friendly.
//   Tier 3 — Encircled: ring(1) or ring(2) around the division is entirely non-friendly. This is
//            structurally a strict subset of Cut Off's trigger condition (rings 1–3), so
//            Encircled can never fire without Cut Off's gate also being true in the same
//            evaluation — see computeSupplyTier below.

/**
 * BFS layer at exact hop-distance `n` from `startId` over `graph.neighbors` — NOT "within n".
 * ring(2) excludes ring(1) and the start node itself. An empty result (e.g. `n` exceeds the
 * graph's radius reachable from `startId`) is a legitimate outcome: callers using `.every(...)`
 * to test "entirely non-friendly" get vacuous truth for free, which is the correct semantics per
 * STRATEGIC_COMBAT.md — do not special-case an empty ring here.
 */
export function ring(graph: SubprovinceGraph, startId: string, n: number): string[] {
  let frontier = new Set<string>([startId]);
  const visited = new Set<string>([startId]);
  for (let hop = 1; hop <= n; hop++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const neighborId of graph.neighbors.get(id) ?? []) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          next.add(neighborId);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }
  return [...frontier];
}

/**
 * Tier 1 reachability: plain BFS (no cost/shortest-path needed, just yes/no reachability) from
 * `startId` to any friendly-or-allied-owned supply hub, traversing only friendly/allied-owned
 * subprovinces (`valid_edge = FRIENDLY(sp)`). Deliberately ignores road/off-road `kind` — the
 * Tier 1 Correction — because throughput, not connectivity, is what road preference affects, and
 * that's `supply_graph.ts`'s (Batch 5) concern, not this reachability check's.
 */
function _pathExistsToFriendlyHub(
  graph: SubprovinceGraph,
  ownership: ReadonlyMap<string, SubprovinceOwnership>,
  hubs: ReadonlySet<string>,
  isFriendly: (ownerId: string) => boolean,
  startId: string,
): boolean {
  if (hubs.has(startId)) return true;

  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const neighborId of graph.neighbors.get(current) ?? []) {
      if (visited.has(neighborId)) continue;
      const ownerId = ownership.get(neighborId)?.ownerId ?? "";
      if (!isFriendly(ownerId)) continue;
      visited.add(neighborId);
      if (hubs.has(neighborId)) return true;
      queue.push(neighborId);
    }
  }
  return false;
}

/**
 * Computes a division's supply tier per STRATEGIC_COMBAT.md's ring-based three-tier model.
 * `ring1Sealed`/`ring2Sealed`/`ring3Sealed` are computed up front so the structural relationship
 * between Cut Off (any ring 1–3 sealed) and Encircled (ring 1 or 2 sealed — a strict subset of
 * Cut Off's own gate) is obvious from the code shape, not just true by coincidence of check
 * order.
 */
export function computeSupplyTier(
  graph: SubprovinceGraph,
  ownership: ReadonlyMap<string, SubprovinceOwnership>,
  hubs: ReadonlySet<string>,
  isFriendly: (ownerId: string) => boolean,
  startSubprovinceId: string,
): SupplyTier {
  if (_pathExistsToFriendlyHub(graph, ownership, hubs, isFriendly, startSubprovinceId)) {
    return "normal";
  }

  const sealed = (n: number): boolean =>
    ring(graph, startSubprovinceId, n).every((sp) => !isFriendly(ownership.get(sp)?.ownerId ?? ""));

  const ring1Sealed = sealed(1);
  const ring2Sealed = sealed(2);
  const ring3Sealed = sealed(3);

  const cutOffGate = ring1Sealed || ring2Sealed || ring3Sealed;
  if (!cutOffGate) return "out_of_supply";
  if (ring1Sealed || ring2Sealed) return "encircled";
  return "cut_off";
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
    state:              GameRoomState,
    tickCount:          number,
    broadcast:          (type: string, msg: unknown) => void,
    subprovinceSystem:  SubprovinceSystem,
  ): Set<string> {
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
    const graph = subprovinceSystem.getGraph();
    const ownership = new Map<string, SubprovinceOwnership>();
    for (const [id, sp] of state.subprovinces) {
      ownership.set(id, { ownerId: sp.owner_id, provinceId: sp.province_id });
    }

    for (const div of divList) {
      if (div.combat_state === "destroyed") continue;

      const startId = subprovinceSystem.getSubprovinceAtPosition({ lng: div.position_lng, lat: div.position_lat });
      if (startId === null) continue; // position doesn't resolve to a subprovince this tick — skip

      const oldStatus = div.supply_status as SupplyTier;
      const computed  = this._computeStatus(div, graph, ownership, subprovinceSystem, state, startId);

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
  }

  // ---------------------------------------------------------------------------
  // _computeStatus — ring-based graph tier lookup for a single division
  // ---------------------------------------------------------------------------

  private _computeStatus(
    div:                DivisionState,
    graph:              SubprovinceGraph,
    ownership:          ReadonlyMap<string, SubprovinceOwnership>,
    subprovinceSystem:  SubprovinceSystem,
    state:              GameRoomState,
    startId:            string,
  ): SupplyTier {
    const isFriendly = makeIsFriendly(div.nation_id, state.relations);
    const hubs = subprovinceSystem.getHubSubprovinceIds(state, isFriendly);
    return computeSupplyTier(graph, ownership, hubs, isFriendly, startId);
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
  // _distKm — matches movement_system / combat_system
  // ---------------------------------------------------------------------------

  private _distKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
    return Math.sqrt((aLng - bLng) ** 2 + (aLat - bLat) ** 2) * KM_PER_DEG;
  }
}
