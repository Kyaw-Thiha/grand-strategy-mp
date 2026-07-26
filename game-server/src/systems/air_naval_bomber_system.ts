import { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { QUALITY_DEFAULTS } from "../data/naval_contact_quality.js";

type BroadcastFn         = (type: string, msg: unknown) => void;
type BroadcastToNationFn = (type: string, msg: unknown, nationId: string) => void;

export class AirNavalBomberSystem {
  tick(
    state: GameRoomState,
    lifecycleSystem: import("./air_wing_lifecycle_system.js").AirWingLifecycleSystem,
    broadcast: BroadcastFn,
    broadcastToNation: BroadcastToNationFn,
  ): void {
    this._tickMarkerExpiry(state, broadcastToNation);
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

  refreshContact(markerId: string, state: GameRoomState): void {
    const marker = state.naval_contact_markers.get(markerId);
    if (!marker || !marker.is_refreshable) return;
    const defaults = QUALITY_DEFAULTS[marker.quality];
    if (!defaults) return;
    marker.expires_at_ms = Date.now() + defaults.duration_ms;
  }
}
