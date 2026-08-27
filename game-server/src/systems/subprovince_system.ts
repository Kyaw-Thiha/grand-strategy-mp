import {
  loadSubprovinceGraphForRoom,
  buildSubprovinceSpatialIndex,
  findSubprovinceAtPoint,
  type SubprovincePIPEntry,
} from "../data/subprovince_loader.js";
import type { SubprovinceGraph, SubprovinceDefinition } from "../data/map_loader.js";
import type { GameRoomState, DivisionState } from "../rooms/schema/GameRoomState.js";
import { SubprovinceState } from "../rooms/schema/GameRoomState.js";
import { areNationsAtWar } from "./combat_system.js";
import { findSupplyRoute } from "./supply_graph.js";
import { loadProvincePIPData, findProvinceAtPoint, type ProvincePIPEntry } from "../utils/geo_utils.js";
import { appendFileSync } from "fs";

// TEMPORARY debug logging — writes to a file instead of stdout so it doesn't flood the
// terminal. Remove this whole block (and its call sites) once the sticky-capture bug is fixed.
function spdebug(line: string): void {
  appendFileSync("/tmp/spdebug.log", `${new Date().toISOString()} ${line}\n`);
}

export type CaptureDelta = { subprovinceId: string; newOwner: string | null };
type BroadcastFn = (sessionFilter: (nationId: string) => boolean, type: string, msg: unknown) => void;

/**
 * Builds a friendliness predicate for supply routing: a subprovince owner counts as friendly
 * if it's the requesting nation itself, or a nation explicitly allied ("alliance" stance) with
 * it. Reuses `areNationsAtWar` to short-circuit the war case, but does NOT treat merely-neutral
 * (not at war, not allied) nations as friendly — `state.relations` distinguishes "alliance" as
 * its own stance beyond "war"/"neutral", so supply transit requires that explicit alliance, not
 * just the absence of war.
 */
export function makeIsFriendly(
  nationId: string,
  relations: GameRoomState["relations"],
): (ownerId: string) => boolean {
  return (ownerId: string) => {
    if (ownerId === nationId) return true;
    if (areNationsAtWar(nationId, ownerId, relations)) return false;
    const rel = relations.get(`${nationId}|${ownerId}`) ?? relations.get(`${ownerId}|${nationId}`);
    return (rel?.stance ?? "neutral") === "alliance";
  };
}

const ACTIVE_COMBAT_STATES = new Set(["engaged", "suppressed"]);
const NON_CAPTURING_STATES = new Set(["retreating", "destroyed"]);

/**
 * Owns subprovince ownership state and capture/revert/freeze logic. Loaded once per room
 * from the map's subprovince graph (Task 1), operates on GameRoomState.subprovinces (Task 2).
 *
 * Scope: ownership/capture/revert/freeze only. Supply-graph and city-cascade logic (Tasks 8/9)
 * extend this same class in later tasks but are intentionally not implemented here.
 */
export class SubprovinceSystem {
  private graph: SubprovinceGraph | null = null;
  private spatialIndex: SubprovincePIPEntry[] = [];
  private defsById = new Map<string, SubprovinceDefinition>();
  /** attackerNationId -> Set<provinceId> the attacker currently holds at least one cell in */
  private attackerProvinces = new Map<string, Set<string>>();
  /** subprovinceId of any cell with a division in "engaged"/"suppressed" combat_state this tick. */
  private frozenSubprovinceIds = new Set<string>();
  /**
   * Province-level (not subprovince-level) point-in-polygon index, used only by
   * _nationHasLivingDivisionInProvince. Deliberately coarser than the subprovince grid: a tiny
   * geometric gap between two adjacent subprovince cells must never read as "division left the
   * province" and trigger a false revert of every captured cell in it.
   */
  private provincePipEntries: ProvincePIPEntry[] = [];

  /** Loads the subprovince graph and spatial index for the given map. Must be called before any other method. */
  loadForRoom(mapId: string): void {
    this.graph = loadSubprovinceGraphForRoom(mapId);
    this.spatialIndex = buildSubprovinceSpatialIndex(this.graph);
    this.defsById = this.graph.nodes;
    this.provincePipEntries = loadProvincePIPData(mapId);
  }

  /** Exposes the loaded subprovince graph (nodes + adjacency) for supply-graph consumers (Task 8). */
  getGraph(): SubprovinceGraph {
    if (!this.graph) throw new Error("SubprovinceSystem.getGraph() called before loadForRoom()");
    return this.graph;
  }

  /** Seeds each subprovince's owner_id from its parent province's current owner_id. */
  initializeOwnership(state: GameRoomState): void {
    if (!this.graph) throw new Error("SubprovinceSystem.initializeOwnership() called before loadForRoom()");
    for (const def of this.graph.nodes.values()) {
      const province = state.provinces.get(def.provinceId);
      const sp = new SubprovinceState();
      sp.province_id = def.provinceId;
      sp.owner_id = province?.owner_id ?? "";
      state.subprovinces.set(def.id, sp);
    }
  }

  /** Returns the subprovince_id containing the given lng/lat, or null if outside all known polygons. */
  getSubprovinceAtPosition(position: { lng: number; lat: number }): string | null {
    return findSubprovinceAtPoint(position.lng, position.lat, this.spatialIndex);
  }

  /** True if the given cell is currently frozen against capture due to active combat this tick. */
  isCombatFrozen(subprovinceId: string): boolean {
    return this.frozenSubprovinceIds.has(subprovinceId);
  }

  /**
   * One full pass over all divisions for this tick, marking frozen every cell containing a
   * division whose combat_state is "engaged" or "suppressed". Does NOT perform any capture or
   * revert logic — it only updates freeze state so a later capture pass can read it.
   *
   * Required per-tick call order (a later task's GameRoom wiring must follow this exactly):
   *   1. resetFreezeTracking()
   *   2. scanCombatFreeze(allDivisions)  — one pass over every living division for the tick
   *   3. checkCaptureAfterMovement(division, ...) for each division, in any order
   * Steps 1-2 must both complete, in order, before any call in step 3 — this guarantees an
   * idle/enemy division sharing a cell with an engaged/suppressed division is blocked from
   * capturing that cell regardless of which division is processed first within step 3.
   */
  scanCombatFreeze(divisions: Iterable<DivisionState>): void {
    for (const division of divisions) {
      if (!ACTIVE_COMBAT_STATES.has(division.combat_state)) continue;
      const subprovinceId = this.getSubprovinceAtPosition({ lng: division.position_lng, lat: division.position_lat });
      if (subprovinceId === null) continue;
      this.frozenSubprovinceIds.add(subprovinceId);
    }
  }

  /**
   * Clears all freeze markers. Must be called once at the start of each tick's capture pass,
   * followed by a single scanCombatFreeze(allDivisions) call covering every living division for
   * that tick, and only then by the per-division checkCaptureAfterMovement calls for that tick.
   * See scanCombatFreeze's doc comment for the exact three-step order this class requires.
   */
  resetFreezeTracking(): void {
    this.frozenSubprovinceIds.clear();
  }

  /**
   * Called once per living division per tick, after movementSystem.tick(). Requires
   * resetFreezeTracking() + scanCombatFreeze(allDivisions) to have already run this tick (see
   * scanCombatFreeze's doc comment) — this method only READS freeze state, it does not set it.
   */
  checkCaptureAfterMovement(division: DivisionState, state: GameRoomState, broadcast: BroadcastFn): CaptureDelta[] {
    const deltas: CaptureDelta[] = [];
    const subprovinceId = this.getSubprovinceAtPosition({ lng: division.position_lng, lat: division.position_lat });
    division.subprovince_id = subprovinceId ?? "";
    if (subprovinceId === null) return deltas;

    const def = this.defsById.get(subprovinceId);
    if (!def) return deltas;
    if (def.kind === "capital") return deltas;
    if (NON_CAPTURING_STATES.has(division.combat_state)) return deltas;
    // An engaged/suppressed division never captures its own cell this tick; freeze marking for
    // OTHER divisions sharing this cell is scanCombatFreeze's responsibility, not this check's.
    if (ACTIVE_COMBAT_STATES.has(division.combat_state)) return deltas;
    if (this.isCombatFrozen(subprovinceId)) return deltas;

    const sp = state.subprovinces.get(subprovinceId);
    if (!sp) return deltas;

    if (division.nation_id !== sp.owner_id) {
      spdebug(`CAPTURE division=${division.division_id} nation=${division.nation_id} sp=${subprovinceId} province=${sp.province_id} owner ${sp.owner_id} -> ${division.nation_id}`);
      sp.owner_id = division.nation_id;
      deltas.push({ subprovinceId, newOwner: division.nation_id });

      if (division.nation_id !== state.provinces.get(sp.province_id)?.owner_id) {
        let provinces = this.attackerProvinces.get(division.nation_id);
        if (!provinces) { provinces = new Set(); this.attackerProvinces.set(division.nation_id, provinces); }
        provinces.add(sp.province_id);
      }
    }

    this._emitCaptureEvents(deltas, state, broadcast);
    return deltas;
  }

  /** Called once per (attackerNationId, provinceId) tracked pair per tick. */
  revertNationCaptureIfProvinceEmpty(
    nationId: string, provinceId: string, state: GameRoomState, broadcast: BroadcastFn,
  ): CaptureDelta[] {
    const deltas: CaptureDelta[] = [];
    const stillPresent = this._nationHasLivingDivisionInProvince(nationId, provinceId, state);
    spdebug(`REVERT-CHECK nation=${nationId} province=${provinceId} stillPresent=${stillPresent}`);
    if (stillPresent) return deltas;

    spdebug(`REVERTING nation=${nationId} province=${provinceId}`);
    const province = state.provinces.get(provinceId);
    const properOwner = province?.owner_id ?? "";
    for (const [subprovinceId, sp] of state.subprovinces) {
      if (this.isCombatFrozen(subprovinceId)) continue;
      if (sp.province_id === provinceId && sp.owner_id === nationId && nationId !== properOwner) {
        sp.owner_id = properOwner;
        deltas.push({ subprovinceId, newOwner: properOwner });
      }
    }

    this.attackerProvinces.get(nationId)?.delete(provinceId);
    this._emitCaptureEvents(deltas, state, broadcast);
    return deltas;
  }

  /** Exposes tracked attacker/province pairs so GameRoom.gameTick() knows which to re-check each tick. */
  getTrackedAttackerProvincePairs(): Array<{ nationId: string; provinceId: string }> {
    const pairs: Array<{ nationId: string; provinceId: string }> = [];
    for (const [nationId, provinces] of this.attackerProvinces) {
      for (const provinceId of provinces) pairs.push({ nationId, provinceId });
    }
    return pairs;
  }

  /** Batch 5 hook: friendly-or-allied-owned capital-kind cells count as supply hubs. */
  getHubSubprovinceIds(state: GameRoomState, isFriendly: (ownerId: string) => boolean): Set<string> {
    const hubs = new Set<string>();
    for (const def of this.defsById.values()) {
      if (def.kind !== "capital") continue;
      const sp = state.subprovinces.get(def.id);
      if (sp && isFriendly(sp.owner_id)) hubs.add(def.id);
    }
    return hubs;
  }

  /**
   * Batch 5 hook: called from combat_system.ts's `_checkProvinceCapture` immediately after a
   * province's `owner_id` flips to `newOwner`. Cascades that flip down to the subprovince
   * (city-cell) level, except for:
   *   1. The capital cell itself, whose owner is synced here (this is the ONLY place a capital
   *      cell's owner ever changes — the generic `checkCaptureAfterMovement` path skips capitals).
   *   2. Cells still occupied by a surviving `oldOwner` division ("former defenders").
   *   3. Cells on one preserved supply route from a surviving-defender cell to another
   *      `oldOwner`-friendly hub, if such a route exists (evaluated against ownership AFTER the
   *      capital sync, so the just-captured capital no longer counts as an `oldOwner` hub/friendly
   *      cell). Candidate route starts are tried in deterministic sorted-ID order; the first
   *      "open" or "degraded" result is kept.
   * If no such route exists, only directly-occupied cells (case 2) are preserved.
   */
  cascadeCityCapture(
    provinceId: string, oldOwner: string, newOwner: string, state: GameRoomState, broadcast: BroadcastFn,
  ): void {
    // Step 1: sync the capital cell's owner to the new province owner.
    for (const def of this.defsById.values()) {
      if (def.provinceId !== provinceId || def.kind !== "capital") continue;
      const capitalSp = state.subprovinces.get(def.id);
      if (capitalSp && capitalSp.owner_id !== newOwner) {
        capitalSp.owner_id = newOwner;
      }
    }

    // Step 2: cells still occupied by a surviving former-defender (oldOwner) division.
    const occupiedByDefender = new Set<string>();
    for (const division of state.divisions.values()) {
      if (division.nation_id !== oldOwner || division.combat_state === "destroyed") continue;
      const subprovinceId = this.getSubprovinceAtPosition({ lng: division.position_lng, lat: division.position_lat });
      if (subprovinceId === null) continue;
      const def = this.defsById.get(subprovinceId);
      if (def?.provinceId === provinceId) occupiedByDefender.add(subprovinceId);
    }

    // Step 3: select at most one preserved supply route for oldOwner, evaluated post-capital-sync.
    const isFriendlyToOldOwner = makeIsFriendly(oldOwner, state.relations);
    const hubs = this.getHubSubprovinceIds(state, isFriendlyToOldOwner);
    const ownership = new Map<string, { ownerId: string; provinceId: string }>();
    for (const [id, sp] of state.subprovinces) ownership.set(id, { ownerId: sp.owner_id, provinceId: sp.province_id });

    let preservedRoute: string[] = [];
    const graph = this.getGraph();
    const candidateStarts = [...occupiedByDefender].filter((id) => graph.nodes.has(id)).sort();
    for (const startId of candidateStarts) {
      const route = findSupplyRoute(graph, ownership, hubs, startId, oldOwner, isFriendlyToOldOwner, () => false, "cascade-probe");
      if (route.status === "open" || route.status === "degraded") {
        preservedRoute = route.subprovinceIds;
        break;
      }
    }
    const preservedSet = new Set([...occupiedByDefender, ...preservedRoute]);

    // Step 4: flip everything else in the province still owned by oldOwner.
    const deltas: CaptureDelta[] = [];
    for (const [subprovinceId, sp] of state.subprovinces) {
      if (sp.province_id !== provinceId) continue;
      if (sp.owner_id !== oldOwner) continue;
      if (preservedSet.has(subprovinceId)) continue;
      sp.owner_id = newOwner;
      deltas.push({ subprovinceId, newOwner });
    }

    this._emitCaptureEvents(deltas, state, broadcast, oldOwner);
  }

  private _nationHasLivingDivisionInProvince(nationId: string, provinceId: string, state: GameRoomState): boolean {
    for (const division of state.divisions.values()) {
      if (division.nation_id !== nationId) continue;
      if (division.combat_state === "destroyed") continue;
      // Province-level PIP, not subprovince-grid resolution: a division standing in a tiny gap
      // between two adjacent subprovince cells must still count as "in the province" here, or a
      // single missed tick reverts every captured cell in it with no retry.
      const resolvedProvinceId = findProvinceAtPoint(division.position_lng, division.position_lat, this.provincePipEntries);
      spdebug(`PRESENCE division=${division.division_id} nation=${division.nation_id} combat_state=${division.combat_state} resolvedProvince=${resolvedProvinceId} targetProvince=${provinceId} match=${resolvedProvinceId === provinceId}`);
      if (resolvedProvinceId === provinceId) return true;
    }
    return false;
  }

  /**
   * `otherOwnerOverride` lets a caller supply the "other side" of the capture explicitly instead
   * of reading it live from `state.provinces`. This is required by cascadeCityCapture: by the
   * time it runs, `_checkProvinceCapture` has already reassigned the province's own owner_id to
   * the NEW owner, so a live lookup would see the new owner on both sides of the belligerency
   * check (silently dropping the actual old owner) — the generic per-subprovince capture/revert
   * paths never mutate `state.provinces.owner_id`, so they're unaffected and keep the live lookup.
   */
  private _emitCaptureEvents(
    deltas: CaptureDelta[], state: GameRoomState, broadcast: BroadcastFn, otherOwnerOverride?: string,
  ): void {
    for (const delta of deltas) {
      const sp = state.subprovinces.get(delta.subprovinceId);
      if (!sp) continue;
      const provinceId = sp.province_id;
      const otherOwner = otherOwnerOverride ?? state.provinces.get(provinceId)?.owner_id ?? "";
      // The capturing nation and the nation that lost the cell are always directly involved in
      // this specific event, regardless of formal war status between them — subprovince capture
      // never required active war (literal-occupancy capture works without it). War status only
      // gates whether a THIRD PARTY gets the detailed event; it must never exclude the two
      // parties actually in the capture, which areNationsAtWar(nationId, nationId) would
      // otherwise do for the capturing nation whenever it isn't formally at war with the loser.
      const isBelligerent = (nationId: string): boolean =>
        nationId === delta.newOwner ||
        nationId === otherOwner ||
        areNationsAtWar(nationId, delta.newOwner ?? "", state.relations) ||
        areNationsAtWar(nationId, otherOwner, state.relations);
      broadcast(
        isBelligerent,
        "SUBPROVINCE_CAPTURED",
        { subprovince_id: delta.subprovinceId, province_id: provinceId, new_owner_id: delta.newOwner, captured_by: delta.newOwner },
      );
      broadcast(
        (nationId) => !isBelligerent(nationId),
        "PROVINCE_CONTEST_UPDATE",
        { province_id: provinceId, contested: this._provinceIsContested(provinceId, state) },
      );
    }
  }

  private _provinceIsContested(provinceId: string, state: GameRoomState): boolean {
    const province = state.provinces.get(provinceId);
    const properOwner = province?.owner_id ?? "";
    for (const sp of state.subprovinces.values()) {
      if (sp.province_id === provinceId && sp.owner_id !== properOwner) return true;
    }
    return false;
  }
}
