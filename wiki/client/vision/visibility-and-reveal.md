# Visibility and Reveal

Vision darkens territory outside the player’s current view and decides which foreign divisions and air wings the client is allowed to draw and inspect.

# Details

## Province and unit visibility

`VisionSystem`, implemented by `client/src/systems/map/vision_system.gd`, treats the player’s owned provinces as visible and adds provinces reached by friendly division observation radii. It publishes the current province set through `EventBus.vision_visibility_changed`.

Military display uses that set, friendly-unit observation distance, and explicit server reveal state when deciding whether to show a foreign division icon. Friendly divisions supply moving light positions so their reveal area follows the displayed unit between server updates.

## Fog and light presentation

The system creates an ocean polygon, a dark `CanvasModulate`, and bounded `PointLight2D` nodes. Owned provinces restore local map color; friendly divisions add moving observation light. Light counts are capped, and movement-driven visibility refresh is throttled to avoid rebuilding the entire display every frame.

This lighting is presentation. It does not remove data from `GameState` or decide what the server may send.

## Server reveal events

`DIVISION_REVEALED` and `DIVISION_HIDDEN` become `EventBus` signals consumed by `MilitarySystem`. Province capture and lobby-state updates also trigger vision refreshes.

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

