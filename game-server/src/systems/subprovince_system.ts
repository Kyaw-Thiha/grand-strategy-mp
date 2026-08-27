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

export type CaptureDelta = { subprovinceId: string; newOwner: string | null };
type BroadcastFn = (sessionFilter: (nationId: string) => boolean, type: string, msg: unknown) => void;

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

  /** Loads the subprovince graph and spatial index for the given map. Must be called before any other method. */
  loadForRoom(mapId: string): void {
    this.graph = loadSubprovinceGraphForRoom(mapId);
    this.spatialIndex = buildSubprovinceSpatialIndex(this.graph);
    this.defsById = this.graph.nodes;
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
    if (subprovinceId === null) return deltas;

    const def = this.defsById.get(subprovinceId);
    if (!def) return deltas;
    if (def.kind === "capital") return deltas; // capital cells only flip via Batch 5's city cascade
    if (NON_CAPTURING_STATES.has(division.combat_state)) return deltas;
    // An engaged/suppressed division never captures its own cell this tick; freeze marking for
    // OTHER divisions sharing this cell is scanCombatFreeze's responsibility, not this check's.
    if (ACTIVE_COMBAT_STATES.has(division.combat_state)) return deltas;
    if (this.isCombatFrozen(subprovinceId)) return deltas;

    const sp = state.subprovinces.get(subprovinceId);
    if (!sp) return deltas;

    if (division.nation_id !== sp.owner_id) {
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
    if (stillPresent) return deltas;

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

  private _nationHasLivingDivisionInProvince(nationId: string, provinceId: string, state: GameRoomState): boolean {
    for (const division of state.divisions.values()) {
      if (division.nation_id !== nationId) continue;
      if (division.combat_state === "destroyed") continue;
      const subprovinceId = this.getSubprovinceAtPosition({ lng: division.position_lng, lat: division.position_lat });
      if (subprovinceId === null) continue;
      const def = this.defsById.get(subprovinceId);
      if (def?.provinceId === provinceId) return true;
    }
    return false;
  }

  private _emitCaptureEvents(deltas: CaptureDelta[], state: GameRoomState, broadcast: BroadcastFn): void {
    for (const delta of deltas) {
      const sp = state.subprovinces.get(delta.subprovinceId);
      if (!sp) continue;
      const provinceId = sp.province_id;
      broadcast(
        (nationId) => {
          const province = state.provinces.get(provinceId);
          const oldOrNewBelligerent =
            areNationsAtWar(nationId, delta.newOwner ?? "", state.relations) ||
            areNationsAtWar(nationId, province?.owner_id ?? "", state.relations);
          return oldOrNewBelligerent;
        },
        "SUBPROVINCE_CAPTURED",
        { subprovince_id: delta.subprovinceId, province_id: provinceId, new_owner_id: delta.newOwner, captured_by: delta.newOwner },
      );
      broadcast(
        (nationId) => {
          const province = state.provinces.get(provinceId);
          const belligerent =
            areNationsAtWar(nationId, delta.newOwner ?? "", state.relations) ||
            areNationsAtWar(nationId, province?.owner_id ?? "", state.relations);
          return !belligerent;
        },
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
