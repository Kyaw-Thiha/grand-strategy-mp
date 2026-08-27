import { GameRoomState, DivisionState } from "../rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE } from "../rooms/schema/AirWingState.js";
import { findProvinceAtPoint, ProvincePIPEntry } from "../utils/geo_utils.js";
import type { AirDetectionSystem } from "./air_detection_system.js";
import type { SubprovinceSystem } from "./subprovince_system.js";

type BroadcastToClientFn = (clientSessionId: string, type: string, msg: unknown) => void;
type GetAllianceFn       = (nationId: string) => Set<string>;

const KM_PER_DEG = 111.32;

function serializeDivision(div: DivisionState): Record<string, unknown> {
  return {
    division_id: div.division_id,
    nation_id: div.nation_id,
    division_type: div.division_type,
    position_lng: div.position_lng,
    position_lat: div.position_lat,
    hp: div.hp,
    suppression: div.suppression,
    combat_state: div.combat_state,
    supply_status: div.supply_status,
    observation_radius: div.observation_radius,
    engagement_radius: div.engagement_radius,
    template_id: div.template_id,
    move_order: [...div.move_order],
    consumed_waypoint_ids: [...div.consumed_waypoint_ids],
    final_position_lng: div.final_position_lng,
    final_position_lat: div.final_position_lat,
    reposition_order: [...div.reposition_order],
    stack_id: div.stack_id,
    stack_position: div.stack_position,
    attacker_role: div.attacker_role,
    engaged_with: [...div.engaged_with],
    grid: {
      cells: Array.from(div.grid.cells).map(c => ({
        unit_type: c.unit_type,
        hp: c.hp,
        suppression: c.suppression,
        xp_tier: c.xp_tier,
        incapacitated: c.incapacitated,
        stealthed: c.stealthed,
      })),
    },
  };
}

export class ServerVisibilitySystem {
  private _pipEntries:  ProvincePIPEntry[];
  private _subprovinceSystem: SubprovinceSystem;
  private _prevDivVis:  Map<string, Set<string>> = new Map(); // nationId → Set<divisionId>
  private _prevWingVis: Map<string, Set<string>> = new Map(); // nationId → Set<wingId>

  constructor(pipEntries: ProvincePIPEntry[], subprovinceSystem: SubprovinceSystem) {
    this._pipEntries = pipEntries;
    this._subprovinceSystem = subprovinceSystem;
  }

  canNationSeeDivision(nationId: string, divisionId: string): boolean {
    return this._prevDivVis.get(nationId)?.has(divisionId) ?? false;
  }

  canNationSeeWing(nationId: string, wingId: string): boolean {
    return this._prevWingVis.get(nationId)?.has(wingId) ?? false;
  }

  tick(
    state:             GameRoomState,
    detectionSystem:   AirDetectionSystem,
    getAlliance:        GetAllianceFn,
    broadcastToClient: BroadcastToClientFn,
    getClientNation:   (sessionId: string) => string | null,
    clients:           Iterable<{ sessionId: string }>,
  ): void {
    const newDivVis  = this._computeDivisionVisibility(state, detectionSystem, getAlliance);
    const newWingVis = this._computeWingVisibility(state, detectionSystem, getAlliance);

    this._propagateAllianceVisibility(state, newDivVis, getAlliance);
    this._propagateAllianceVisibility(state, newWingVis, getAlliance);

    for (const [nationId, newVisible] of newDivVis) {
      const prevVisible = this._prevDivVis.get(nationId) ?? new Set<string>();
      for (const divId of newVisible) {
        if (!prevVisible.has(divId)) {
          const div = state.divisions.get(divId);
          if (!div) continue;
          this._sendToNation(nationId, "DIVISION_APPEARED", serializeDivision(div), broadcastToClient, getClientNation, clients);
        }
      }
      for (const divId of prevVisible) {
        if (!newVisible.has(divId)) {
          this._sendToNation(nationId, "DIVISION_VANISHED", { division_id: divId }, broadcastToClient, getClientNation, clients);
        }
      }
    }
    for (const [nationId, prevVisible] of this._prevDivVis) {
      if (!newDivVis.has(nationId)) {
        for (const divId of prevVisible) {
          this._sendToNation(nationId, "DIVISION_VANISHED", { division_id: divId }, broadcastToClient, getClientNation, clients);
        }
      }
    }

    for (const [nationId, prevVisible] of this._prevWingVis) {
      const newVisible = newWingVis.get(nationId) ?? new Set<string>();
      for (const wingId of prevVisible) {
        if (!newVisible.has(wingId)) {
          this._sendToNation(nationId, "AIR_WING_VANISHED", { wing_id: wingId }, broadcastToClient, getClientNation, clients);
        }
      }
    }

    this._prevDivVis  = newDivVis;
    this._prevWingVis = newWingVis;
  }

  private _computeDivisionVisibility(
    state: GameRoomState,
    detection: AirDetectionSystem,
    getAlliance: GetAllianceFn,
  ): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    for (const [divId, div] of state.divisions.entries()) {
      const divProvinceId = findProvinceAtPoint(div.position_lng, div.position_lat, this._pipEntries);
      const divProvinceOwnerId = divProvinceId ? state.provinces.get(divProvinceId)?.owner_id : null;
      // Subprovince ownership is the authoritative per-cell truth (Batch 4+); a nation that has
      // captured the exact cell a division stands in sees it, even if the parent province as a
      // whole is still owned by someone else.
      const divSubprovinceId = this._subprovinceSystem.getSubprovinceAtPosition({ lng: div.position_lng, lat: div.position_lat });
      const divSubprovinceOwnerId = divSubprovinceId ? state.subprovinces.get(divSubprovinceId)?.owner_id : null;
      for (const [nationId] of state.nations) {
        if (div.nation_id === nationId) { this._addToResult(result, nationId, divId); continue; }
        if (getAlliance(div.nation_id).has(nationId)) { this._addToResult(result, nationId, divId); continue; }
        if (detection.getVisibleDivisionsForNation(nationId).has(divId)) { this._addToResult(result, nationId, divId); continue; }
        if (divProvinceOwnerId === nationId) { this._addToResult(result, nationId, divId); continue; }
        if (divSubprovinceOwnerId === nationId) { this._addToResult(result, nationId, divId); continue; }
        for (const [, observerDiv] of state.divisions.entries()) {
          if (observerDiv.nation_id !== nationId) continue;
          const radiusDeg = observerDiv.observation_radius / KM_PER_DEG;
          const dx = div.position_lng - observerDiv.position_lng;
          const dy = div.position_lat - observerDiv.position_lat;
          if (Math.sqrt(dx * dx + dy * dy) <= radiusDeg) { this._addToResult(result, nationId, divId); break; }
        }
      }
    }
    return result;
  }

  private _computeWingVisibility(
    state: GameRoomState,
    detection: AirDetectionSystem,
    getAlliance: GetAllianceFn,
  ): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    const GROUND_STATES = new Set([WING_LIFECYCLE.IDLE, WING_LIFECYCLE.REFUEL]);
    for (const [wingId, wing] of state.air_wings.entries()) {
      const wingProvinceId = findProvinceAtPoint(wing.position_lng, wing.position_lat, this._pipEntries);
      const wingProvinceOwnerId = wingProvinceId ? state.provinces.get(wingProvinceId)?.owner_id : null;
      const wingSubprovinceId = this._subprovinceSystem.getSubprovinceAtPosition({ lng: wing.position_lng, lat: wing.position_lat });
      const wingSubprovinceOwnerId = wingSubprovinceId ? state.subprovinces.get(wingSubprovinceId)?.owner_id : null;
      for (const [nationId] of state.nations) {
        if (wing.nation_id === nationId) { this._addToResult(result, nationId, wingId); continue; }
        if (getAlliance(wing.nation_id).has(nationId)) { this._addToResult(result, nationId, wingId); continue; }
        if (GROUND_STATES.has(wing.lifecycle_state as any)) continue;
        if (detection.getWingDetectedByNations(wingId).has(nationId)) { this._addToResult(result, nationId, wingId); continue; }
        if (wingProvinceOwnerId === nationId) { this._addToResult(result, nationId, wingId); continue; }
        if (wingSubprovinceOwnerId === nationId) { this._addToResult(result, nationId, wingId); continue; }
      }
    }
    return result;
  }

  private _addToResult(result: Map<string, Set<string>>, nationId: string, entityId: string): void {
    if (!result.has(nationId)) result.set(nationId, new Set());
    result.get(nationId)!.add(entityId);
  }

  private _propagateAllianceVisibility(
    state: GameRoomState,
    visibility: Map<string, Set<string>>,
    getAlliance: GetAllianceFn,
  ): void {
    for (const [nationId] of state.nations) {
      const alliance = getAlliance(nationId);
      for (const allyId of alliance) {
        if (allyId === nationId) continue;
        const allyVisible = visibility.get(allyId);
        if (!allyVisible || allyVisible.size === 0) continue;
        for (const entityId of allyVisible) {
          this._addToResult(visibility, nationId, entityId);
        }
      }
    }
  }

  private _sendToNation(
    nationId: string,
    type: string,
    msg: unknown,
    broadcastToClient: BroadcastToClientFn,
    getClientNation: (sessionId: string) => string | null,
    clients: Iterable<{ sessionId: string }>,
  ): void {
    for (const client of clients) {
      if (getClientNation(client.sessionId) === nationId) broadcastToClient(client.sessionId, type, msg);
    }
  }
}
