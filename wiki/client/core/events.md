# Event Bus

The event bus keeps the game responsive when something happens: a province changes hands, an army is selected, a chat message arrives, or an air battle starts. It lets the relevant map and interface features react together.

# Details

## Signals

`EventBus`, implemented by `client/src/core/event_bus.gd`, defines signals for map/province state, divisions and tactical combat, lobby/session changes, diplomacy, local research, selection, input blocking, notifications, chat, templates, air wings, radar, detection, bombing, and air-combat detail requests.

Server routing publishes relevant events after applying match updates to `GameState`. Scene systems use these signals instead of direct references across subsystem boundaries. Autoloads remain explicit service boundaries and may be called directly where they provide the operation.

## Verified signal example

`client/src/core/event_bus.gd` declares the map events consumed by unrelated presentation systems:

```gdscript
signal province_changed(province_id: String)
signal province_captured(province_id: String, new_owner_id: String)
signal frontline_updated(province_id: String, nation_shares: Dictionary)
signal vision_visibility_changed(visible_provinces: Dictionary)
```

The payload contains identifiers or event data, while a receiver that needs current match information reads it from `GameState`.

## Adding signals

Add a signal when unrelated systems need a durable cross-module notification, not merely because two nodes happen to interact in one scene. Signal payloads should carry stable identifiers or immutable event data; consumers that need current match data should read it from `GameState`.

# Related Notes

- [[client/core/index|Client Core Runtime]]
- [[client/core/game-state-and-commands|Game-State Mirror and Commands]]
- [[client/session/index|Sessions]]
- [[client/ui/index|User Interface]]
