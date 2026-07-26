import { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { QUALITY_DEFAULTS } from "../data/naval_contact_quality.js";
import { WING_LIFECYCLE, MISSION_TYPES } from "../rooms/schema/AirWingState.js";
import {
  PORT_STRIKE_NAVAL_BASE_DAMAGE_PER_PLANE,
  PORT_STRIKE_DAMAGE_SCALE,
} from "../data/air_bombing_stats.js";

type BroadcastFn         = (type: string, msg: unknown) => void;
type BroadcastToNationFn = (type: string, msg: unknown, nationId: string) => void;

type LifecycleSystem = import("./air_wing_lifecycle_system.js").AirWingLifecycleSystem;

export class AirNavalBomberSystem {
  tick(
    state: GameRoomState,
    lifecycleSystem: LifecycleSystem,
    broadcast: BroadcastFn,
    broadcastToNation: BroadcastToNationFn,
  ): void {
    this._tickMarkerExpiry(state, broadcastToNation);
    this._tickPortStrike(state, lifecycleSystem, broadcast);
  }

  _tickMarkerExpiry(state: GameRoomState, broadcastToNation: BroadcastToNationFn): void {
    const now = Date.now();
    for (const [markerId, marker] of state.naval_contact_markers) {
      if (now >= marker.expires_at_ms) {
        const nationId = marker.nation_id;
        state.naval_contact_markers.delete(markerId);
        broadcastToNation("CONTACT_MARKER_EXPIRED", { marker_id: markerId }, nationId);
      }
    }
  }

  _tickPortStrike(
    state: GameRoomState,
    lifecycleSystem: LifecycleSystem,
    broadcast: BroadcastFn,
  ): void {
    for (const [wingId, wing] of state.air_wings) {
      if (
        wing.lifecycle_state !== WING_LIFECYCLE.LOITER ||
        wing.mission !== MISSION_TYPES.PORT_STRIKE
      ) continue;

      const province = wing.target_id
        ? state.provinces.get(wing.target_id)
        : null;
      if (!province) {
        lifecycleSystem.resolveWingBombed(wingId, state, broadcast);
        continue;
      }

      const effectiveness = wing.count * wing.combat_readiness * PORT_STRIKE_DAMAGE_SCALE;
      const damage = effectiveness * PORT_STRIKE_NAVAL_BASE_DAMAGE_PER_PLANE;
      province.naval_base_level = Math.max(0, province.naval_base_level - damage);

      broadcast("NAVAL_BOMBER_STRIKE_HIT", {
        wing_id:           wingId,
        province_id:       wing.target_id,
        naval_base_damage: damage,
      });

      lifecycleSystem.resolveWingBombed(wingId, state, broadcast);
    }
  }

  refreshContact(markerId: string, state: GameRoomState): void {
    const marker = state.naval_contact_markers.get(markerId);
    if (!marker || !marker.is_refreshable) return;
    const defaults = QUALITY_DEFAULTS[marker.quality];
    if (!defaults) return;
    marker.expires_at_ms = Date.now() + defaults.duration_ms;
  }
}
