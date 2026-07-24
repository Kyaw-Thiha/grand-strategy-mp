# Detection, Combat, and Bombing

Air detection decides which enemy wings appear to the player, while combat and bombing markers show where aircraft have fought and let the player inspect the reported result.

# Details

## Detection and radar events

Own wings are displayed regardless of detection. Enemy wings are shown only while airborne and reported as detected through mirrored state or `WING_DETECTED`; `WING_LOST_DETECTION` hides them again.

`SessionManager` forwards `RADAR_UPDATED` and division reveal/hide messages through `EventBus`. `air_detection_overlay.gd` can draw wing and radar circles, but **Current:** it is not instantiated by the production or debug composition, `AirWingSystem._sync_detection_overlay()` is empty, and nothing consumes `radar_updated` to populate it. The separate circles drawn by `AirWingIcon` for owned airborne wings are current presentation; a synchronized radar overlay is scaffolding.

## Air combat presentation

`AIR_COMBAT_STARTED` draws a line between the participating wing icons. `AIR_COMBAT_ENDED` removes the line and creates a short-lived map banner near the reported fight. Nearby results can share a banner.

Clicking a banner opens `AirCombatDetailPanel`, which presents the server payload through aircraft glyphs and result details. The client does not calculate hits, losses, readiness changes, or the winner.

## Bombing presentation

`AIR_BOMBING_RESULT` creates or updates a temporary bombing indicator at the province city or the payload’s fallback coordinates. Clicking it opens `BombingDetailPanel` with the reported runs.

The indicator and detail panel visualize the server result. Strategic and tactical bombing effects remain game-server outcomes.

## Rejections and lifecycle notices

Server messages for automatic staging, return-to-base queuing, rejected moves, destroyed wings, path changes, and combat/bombing results become `GameState` updates or `EventBus` notifications. The friendly wing panel and map icons refresh from the resulting mirror rather than assuming that a submitted mission succeeded.

# Related Notes

- [[client/air/index|Client Air Operations]]
- [[client/air/wings-missions-and-movement|Wings, Missions, and Movement]]
- [[client/vision/visibility-and-reveal|Visibility and Reveal]]
- [[client/ui/hud-panels-and-input|HUD Panels and Input]]
- [[game-server/simulation/air-operations|Air Operations]]

