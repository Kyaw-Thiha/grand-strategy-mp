# Diplomacy and Research

Diplomacy lets players propose alliances, wars, peace, and votes, then see how relations develop. Research currently lets players explore and progress through a prototype technology tree while its match-wide rules are still being built.

# Details

## Diplomacy

`DiplomacySystem` is an autoload command facade. It submits `DIPLOMACY_ACTION` requests and vote responses through `CommandQueue`, then emits local submission signals. `SessionManager` applies `RELATIONS_UPDATED` into `GameState`, surfaces diplomacy notifications and interactive vote payloads on `EventBus`, and HUD panels render relations and voting controls.

## Research prototype

`ResearchSystem` owns definitions, availability, row/exclusivity checks, active progress, and completed entries only in local memory. It advances at one science value per real second and emits research signals used by the research drawer, tree, and HUD progress display. **Current:** it has no server command or authoritative persistence path; it resets with the scene/runtime and must not be treated as multiplayer state.

## Verified cross-module event example

`client/src/core/event_bus.gd` defines the presentation-facing diplomacy and research notifications:

```gdscript
signal relation_changed(from_id: String, to_id: String)
signal diplo_proposal_received(proposal: Dictionary)
signal diplo_resolved(proposal_id: String, accepted: bool)
signal research_started(entry_id: String)
signal research_completed(entry_id: String, effects: Dictionary)
```

Panels listen for these signals rather than directly reaching into unrelated systems.

# Related Notes

- [[client/index|Client]]
- [[client/commands-sessions-and-events|Commands, Sessions, and Events]]
- [[client/ui|User Interface]]
- [[game-server/commands-and-events|Commands and Events]]
