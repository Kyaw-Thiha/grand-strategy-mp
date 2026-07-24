# Wings, Missions, and Movement

Air wings let players follow aircraft on the map, inspect fuel and readiness, redeploy to friendly airfields, move through the air, and assign attacks to suitable targets.

# Details

## Wing display and selection

`AirWingSystem`, implemented by `client/src/systems/air/air_wing_system.gd`, creates an `AirWingIcon` for each wing in `GameState`. Icons display nation color, aircraft type, count, fuel, readiness, lifecycle state, and selection.

Selecting a wing emits `EventBus.air_wing_selected`, which opens the friendly air-wing panel. That panel shows current mission, target, home airbase, fuel, readiness, weapon state, and lifecycle values from the mirror.

## Right-click actions

The selected wing interprets right-click targets in this order:

1. A detected enemy wing can receive an `ASSIGN_WING_MISSION` interception request when the aircraft type supports it.
2. An enemy division or engagement can receive a tactical-bombing request when the wing is capable.
3. An enemy province city can receive an industry-bombing request from a strategic or tactical bomber.
4. A friendly or allied city submits `REDEPLOY_WING`.
5. Other map space submits `SUBMIT_AIR_WING_MOVE` with the clicked longitude and latitude.

These capability checks guide the player’s input. Every request passes through `CommandQueue`, and the game server decides whether it is legal and what route or result follows.

## Server paths and smooth movement

`GameState` stores wing updates and caches the latest `AIR_WING_PATH` payload. This cache lets a map scene created after the event hydrate the path instead of losing the initial flight.

`AirWingSystem` uses `DubinsInterpolator` to display the server-supplied curved route between updates. It tracks path generations, elapsed time, and a short reconciliation blend when a replacement path arrives. The remaining route is drawn for the selected wing.

The fuel-range overlay estimates reachable distance from current displayed fuel and the server-provided decay rate. It is presentation guidance, not a promise that the server will accept the destination.

## Incomplete route scaffolding

The system contains pending milestone and Shift-route helper methods, but the current mouse path does not add those milestones. Shift-right-click returns without submitting or building a chain. Document this as incomplete scaffolding; do not describe multi-point air route planning as current gameplay.

# Related Notes

- [[client/air/index|Client Air Operations]]
- [[client/air/detection-combat-and-bombing|Detection, Combat, and Bombing]]
- [[client/map/rendering-camera-and-interaction|Rendering, Camera, and Interaction]]
- [[client/networking/commands-state-and-events|Commands, State, and Events]]
- [[game-server/simulation/air-operations|Air Operations]]

