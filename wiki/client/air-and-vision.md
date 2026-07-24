# Air Operations and Vision

Air and vision tools let players follow their air wings, plan missions and routes, see bombing and air battles, and understand which parts of the map their nation can currently observe.

# Details

## Air-wing presentation and intent

`AirWingSystem` creates wing icons, interpolates server-supplied paths with the Dubins interpolator, reconciles their display positions, tracks selection, and renders range, detection, route, bombing, and air-combat overlays. Its right-click handling submits mission, movement, redeployment, retreat, disband, and perk intent through `CommandQueue`; capability checks are presentation guidance and the server decides validity.

`GameState` caches `AIR_WING_UPDATES`, paths, and removals. `SessionManager` forwards detection, radar, combat, bombing, and rejection events to `EventBus`, where overlays and HUD detail panels respond.

## Vision

`VisionSystem` derives display visibility from owned provinces and displayed division positions. It manages darkness/ocean layers and bounded dynamic lights, emits the current visible-province set, and is used by military icon filtering. Air detection can temporarily reveal divisions through separate server events. **Current:** this is a client presentation layer; the game server controls what information it sends.

## Verified mirrored-air-state example

`client/src/core/game_state.gd`, `GameState._apply_air_wing_updates()`, accepts server-sent wing data:

```gdscript
func _apply_air_wing_updates(data: Dictionary) -> void:
	for wing_data in data.get("wings", []):
		var id: String = wing_data.get("wing_id", "")
		if id.is_empty():
			continue
		air_wings[id] = wing_data
```

The client stores the update for presentation; it does not calculate the wing's authoritative flight result.

# Related Notes

- [[client/index|Client]]
- [[client/map-and-input|Map Rendering, Camera, and Input]]
- [[client/military|Military Display and Movement Input]]
- [[game-server/simulation/air-operations|Air Operations]]
