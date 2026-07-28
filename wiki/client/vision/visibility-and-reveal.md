# Visibility and Reveal

Vision darkens territory outside the player’s current view and decides which foreign divisions and air wings the client is allowed to draw and inspect.

# Details

## Province and unit visibility

`VisionSystem`, implemented by `client/src/systems/map/vision_system.gd`, treats locally
owned and allied provinces as visible and adds provinces reached by local division
observation radii. Runtime `owner_id` takes precedence over runtime `nation_id` and static
map ownership. It publishes the current province set through
`EventBus.vision_visibility_changed`.

Military display uses that set, local-unit observation distance, and explicit server reveal
state when deciding whether to show a foreign division icon. Local divisions supply moving
mask positions so their reveal area follows the displayed unit between server updates.
Allied divisions do not share moving vision.

## Fog and mask presentation

The system copies every generated `Fill` and `FillPartXX` from locally owned and allied
provinces into one channel of a bounded `SubViewport` texture at full strength. A second
channel contains local-division radial stamps. The world-space multiplicative fog shader
combines the channels with a bounded maximum: visible cartography keeps its ordinary color,
overlap cannot create illumination, and hidden cartography remains dark.

Province interiors have no gradient. The shader preserves their exact solid mask and adds
only a ten-world-pixel outward feather. Ending ownership, alliance, or unit coverage
restores complete fog immediately; the client keeps no previously observed terrain memory.

Cartography and labels render below the fog polygon. Division, route, combat, air, and
naval marker roots render above it, while their data-driven visibility rules determine
whether they appear. Division observation and scouting radii are subtle outlines shown
only for selected divisions.

Division stamps are keyed and reused. Client interpolation changes their mask positions;
a visibility refresh changes scale only when observation radius changes. Removing a
division clears its stamp and position/radius caches. Province geometry rebuilds after
captures and relation or lobby changes. The mask viewport redraws only after one of those
sources changes.

This mask is presentation. It does not remove data from `GameState` or decide what the server may send.

## Server reveal events

`DIVISION_REVEALED` and `DIVISION_HIDDEN` become `EventBus` signals consumed by
`MilitarySystem`. Province capture, diplomatic relation, and lobby-state updates trigger
immediate territory-visibility refreshes.

Air wings use a separate detection path: enemy wing icons appear only while airborne and detected through state or `WING_DETECTED`, then disappear after `WING_LOST_DETECTION`.

## Air detection status

`RADAR_UPDATED` is routed onto `EventBus`, and `air_detection_overlay.gd` can draw radar/recon circles. **Current:** that overlay is not instantiated or populated by the active map composition. Owned air-wing icons draw their current passive/recon/combat-radius circles, but a synchronized radar overlay remains incomplete.

## Information boundary

Current client vision derives some presentation from the data already present in `GameState`. The game server must remain responsible for deciding which sensitive enemy information is sent to each player; darkness alone is not a security boundary.

# Related Notes

- [[client/vision/index|Client Vision]]
- [[client/map/rendering-camera-and-interaction|Rendering, Camera, and Interaction]]
- [[client/military/divisions-and-selection|Divisions and Selection]]
- [[client/air/detection-combat-and-bombing|Detection, Combat, and Bombing]]
- [[game-server/game-state|Authoritative Game State]]
