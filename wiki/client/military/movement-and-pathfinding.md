# Movement and Pathfinding

Movement tools let players point divisions toward a destination, preview the route they are building, and submit that plan for the game server to validate and resolve.

# Details

## Player movement intent

`MilitarySystem` supports direct right-click orders, an explicit move mode, group destinations, Shift-click waypoint chains, hold, retreat, and reposition intent. It draws a ghost route and milestone dots before submitting the final order.

`SUBMIT_MOVE_ORDER` carries the selected division ID, waypoint identifiers, and an optional final longitude/latitude. `REPOSITION`, `HOLD`, and `RETREAT` use their matching named commands. Every send goes through `CommandQueue`; the server remains responsible for ownership, relations, phase, movement legality, and the resulting position.

## Client route preview

`Pathfinder`, implemented by `client/src/systems/military/pathfinder.gd`, builds an A*/hierarchical graph from the generated waypoint data. Its preview considers terrain movement profiles, roads, river penalties, neutral relations, off-road synthetic destinations, fallback reachability, string pulling, and smoothing.

Path searches may run on worker threads. `MilitarySystem` uses generation counters so a stale result cannot replace a newer player choice. Group movement gives each selected division a nearby destination offset rather than sending every unit to exactly one point.

## Display reconciliation

Between server updates, the client advances icons along the known route for smoother presentation. New server data remains authoritative and can snap or reconcile the displayed route. Client dead reckoning and path previews are visual assistance, not a second simulation.

## Current map dependency

The main waypoint graph comes from the active `MapLoader`. **Current limitation:** the optional HPA cluster file path in `MilitarySystem.setup()` is hard-coded to `western_europe_6`, so another map would not load its own cluster optimization even if one existed. Replacing that hard-coded path is a refactor candidate; it is not changed by this documentation task.

# Related Notes

- [[client/military/index|Client Military]]
- [[client/military/divisions-and-selection|Divisions and Selection]]
- [[client/map/map-data-and-loading|Map Data and Loading]]
- [[game-server/simulation/movement-and-territory|Movement and Territory]]
- [[client/testing/test-scenes-and-workflows|Client Test Scenes and Workflows]]

