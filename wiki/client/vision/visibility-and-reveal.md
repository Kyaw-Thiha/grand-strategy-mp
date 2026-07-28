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

**Current.** `DIVISION_APPEARED` and `DIVISION_VANISHED` are per-nation events sent by `ServerVisibilitySystem` when a division enters or leaves a player's visible set (fog-of-war boundary crossing). `AIR_WING_VANISHED` is the wing equivalent — distinct from `AIR_WING_DESTROYED` (permanent destruction vs. temporary visibility loss).

Air wings use a separate detection path: enemy wing icons appear only while airborne and detected through state or `WING_DETECTED`, then disappear after `WING_LOST_DETECTION`.

## Fog-of-war animations

**Current.** When a unit enters or leaves the player's visible set, the client plays a brief animation:

- `DivisionIcon.reveal()` and `AirWingIcon.reveal()`: scale from 0.8× to 1.0× with a 0.3s fade-in (`modulate.a` 0→1, `Tween.EASE_OUT`).
- `DivisionIcon.conceal()` and `AirWingIcon.conceal()`: 0.4s fade-out returning a `Signal` so the caller can `await` completion before removing the icon from GameState.

These animations replace instant icon appearance/disappearance with a smooth fog-emerge and fade-away effect.

## Detection ring VFX

**Current.** `detection_ring.gd` (`client/src/systems/military/detection_ring.gd`) renders a short-lived cyan expanding ring (0.6s, radius 0→30px, alpha 1→0) at a detected unit's position. It is instantiated via `_spawn_radar_ping()` in `MilitarySystem` when `division_revealed` fires — the signal handler was renamed to `_on_division_revealed_with_ping` to layer the VFX on top of the existing reveal logic.

## Air detection status

`RADAR_UPDATED` is routed onto `EventBus`, and `air_detection_overlay.gd` can draw radar/recon circles. **Current:** that overlay is not instantiated or populated by the active map composition. Owned air-wing icons draw their current passive/recon/combat-radius circles, but a synchronized radar overlay remains incomplete.

## Information boundary

**Current.** `ServerVisibilitySystem` enforces the information boundary on the server: each connected client receives only the division and wing data their nation is permitted to see. Own and allied units are always included; idle enemy wings at base are never sent; airborne enemy units only flow through when inside detection coverage or over an owned province. The client fog-of-war and reveal animations are visual polish on top of this server-side filter, not a replacement for it.

# Related Notes

- [[client/vision/index|Client Vision]]
- [[client/map/rendering-camera-and-interaction|Rendering, Camera, and Interaction]]
- [[client/military/divisions-and-selection|Divisions and Selection]]
- [[client/air/detection-combat-and-bombing|Detection, Combat, and Bombing]]
- [[game-server/game-state|Authoritative Game State]]

