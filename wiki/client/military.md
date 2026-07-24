# Military Display and Movement Input

Military tools let players see their divisions, select single units or groups, preview routes, issue movement and stance orders, and follow ongoing engagements on the map.

# Details

## Unit presentation

`MilitarySystem` instantiates `DivisionIcon` and `EngagementBanner` scene components, updates their display from `GameState` and `EventBus`, filters visibility, and tracks local selected units. It renders stack state, combat state, health, supply, local selection, and temporary route overlays. `FrontlineOverlay` is available as a display component but is currently deferred in the `MapDebug` composition.

## Local path preview

The `Pathfinder` consumes the loaded waypoint graph and optional hierarchy clusters to calculate a client-side preview. It considers roads, terrain, rivers, neutral relations, fallback reachability, synthetic goals, path smoothing, and HPA routing. Military uses threads and a generation counter to discard stale preview results, then reconciles display positions with authoritative updates.

This prediction is display/input assistance only. The submitted `SUBMIT_MOVE_ORDER`, `HOLD`, `RETREAT`, `REPOSITION`, stack, and template requests remain authoritative-server commands, and rejected orders appear as notifications.

## Templates and tactical UI

`DivisionTemplateStore` owns local built-in template presets and changes in the division builder. The viewer may submit `ASSIGN_TEMPLATE` for a server-side division. HUD panels render friendly/enemy division, stack, tactical-combat, and template detail state from the mirror and EventBus.

## Verified command boundary example

`client/src/core/command_queue.gd`, `CommandQueue.submit()`, is the final local step before a movement or tactical request is sent:

```gdscript
if not AuthManager.is_logged_in():
	command_rejected.emit(type, "Not authenticated")
	return

NetManager.send_command(type, payload)
```

Military UI can preview a route, but this handoff makes the server the component that validates the submitted order.

# Related Notes

- [[client/index|Client]]
- [[client/map-and-input|Map Rendering, Camera, and Input]]
- [[client/ui|User Interface]]
- [[game-server/simulation/movement-and-territory|Movement and Territory]]
- [[game-server/simulation/tactical-divisions|Tactical Divisions]]
