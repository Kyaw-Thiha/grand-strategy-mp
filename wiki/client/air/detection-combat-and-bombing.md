# Detection, Combat, and Bombing

Air detection decides which enemy wings appear to the player, while combat and bombing markers show where aircraft have fought and let the player inspect the reported result.

# Details

## Detection and radar events

Own wings are displayed regardless of detection. Enemy wings are shown only while airborne and reported as detected through mirrored state or `WING_DETECTED`; `WING_LOST_DETECTION` hides them again.

`SessionManager` forwards `RADAR_UPDATED` and division reveal/hide messages through `EventBus`. `air_detection_overlay.gd` can draw wing and radar circles, but **Current:** it is not instantiated by the production or debug composition, `AirWingSystem._sync_detection_overlay()` is empty, and nothing consumes `radar_updated` to populate it. The separate circles drawn by `AirWingIcon` for owned airborne wings are current presentation; a synchronized radar overlay is scaffolding.

## Air combat presentation

`AIR_COMBAT_STARTED` draws a line between the participating wing icons. `AIR_COMBAT_ENDED` removes the line and creates a short-lived map banner near the reported fight. Nearby results can share a banner.

Clicking a banner opens `AirCombatDetailPanel`, which presents the server payload through aircraft glyphs and result details. The client does not calculate hits, losses, readiness changes, or the winner.

## Strategic bombing presentation

**Current:** `AIR_BOMBING_PROVINCE_RESULT` creates a purple `AirCombatBanner` at the target province

## Bombing presentation

`AIR_BOMBING_RESULT` creates or updates a temporary bombing indicator at the province city or the payload’s fallback coordinates. Clicking it opens `BombingDetailPanel` with the reported runs.

The indicator and detail panel visualize the server result. Strategic and tactical bombing effects remain game-server outcomes.

`PROVINCE_AA_FIRED` spawns a brief flak burst (orange/yellow `draw_circle`/`draw_arc` effect) that fades over 0.6 seconds at the province city. This is broadcast to all clients.

`EventBus` signals `air_bombing_province_result`, `province_aa_fired`, `strategic_bombing_detail_open_requested`, and `strategic_bombing_detail_closed` are added in `event_bus.gd`. `SessionManager` routes `AIR_BOMBING_PROVINCE_RESULT` and `PROVINCE_AA_FIRED` to these signals. `AirCombatBanner.on_clicked()` checks `_combat_type` and dispatches to `strategic_bombing_detail_open_requested` for strategic results.

## Naval contact markers

**Current (Branch H).** When the server broadcasts `NAVAL_CONTACT_UPDATES`, `SessionManager` routes to `GameState._apply_naval_contact_updates()`, which stores the marker data and emits `EventBus.naval_contact_marker_added`. `NavalContactMarkerSystem` (`client/src/systems/air/naval_contact_marker_system.gd`), a scene child node of `game.tscn` and `map_debug.tscn`, subscribes to this signal and renders a translucent circle at the marker's `position_lng/lat` with radius proportional to `radius_deg`. The circle alpha decays toward zero as `expires_at_ms` approaches; the circle is removed when `CONTACT_MARKER_EXPIRED` fires and `EventBus.naval_contact_marker_expired` is emitted. Enemy-nation markers are never sent to a client (server filters by `nation_id` before broadcast). The system receives `MapLoader` through a `setup()` call from `map_scene.gd` `_on_map_loaded()` — the same pattern `AirWingSystem` uses. No interaction beyond display.

## Rejections and lifecycle notices

Server messages for automatic staging, return-to-base queuing, rejected moves, destroyed wings, path changes, and combat/bombing results become `GameState` updates or `EventBus` notifications. The friendly wing panel and map icons refresh from the resulting mirror rather than assuming that a submitted mission succeeded.

# Related Notes

- [[client/air/index|Client Air Operations]]
- [[client/air/wings-missions-and-movement|Wings, Missions, and Movement]]
- [[client/vision/visibility-and-reveal|Visibility and Reveal]]
- [[client/ui/hud-panels-and-input|HUD Panels and Input]]
- [[game-server/simulation/air-operations|Air Operations]]

