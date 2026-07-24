# Stacks, Engagements, and Tactical UI

When divisions occupy the same force group or enter combat, the client groups their map display and gives players panels for following the battle and ordering a retreat.

# Details

## Stacks

`GameState` stores server-reported stack records. `SessionManager` currently applies `STACK_FORMED`, `STACK_ROTATION`, and `STACK_DISSOLVED`, then `MilitarySystem` updates icon placement and front-unit display.

Group selection and movement can include several friendly divisions. **Current:** `FriendlyStackPanel` and `EventBus.stack_selected` are placeholders; the dedicated bottom stack-selection UI is not connected to a complete stack-selection flow.

## Engagement banners

`COMBAT_STARTED` creates an `EngagementBanner` between the participating division icons. The banner follows health changes and tactical round events, and clicking it emits `EventBus.tactical_combat_opened`.

`COMBAT_ENDED` removes the corresponding banner and publishes the reported winner/retreat result. The client presents those results; the server resolves contact, damage, suppression, retreat, and destruction.

## Tactical panel

`TacticalCombatPanel` is a full-center HUD panel. It shows attacker and defender formations, unit cells, terrain context, lethality phase, bonuses, round timing, health, and suppression from the available engagement payloads.

The panel listens for `ROUND_RESOLVED` and other combat-facing events. Its player command is retreat, submitted as `RETREAT` through `CommandQueue`. `COMBAT_RESULT` is currently reserved in `SessionManager` and does not add separate panel behavior.

Some attack-pattern previews contain explicit approximation or future-data comments. They should be documented and tested as presentation scaffolding, not as proof that the client resolves tactical combat.

# Related Notes

- [[client/military/index|Client Military]]
- [[client/military/divisions-and-selection|Divisions and Selection]]
- [[client/military/movement-and-pathfinding|Movement and Pathfinding]]
- [[client/ui/hud-panels-and-input|HUD Panels and Input]]
- [[game-server/simulation/ground-combat|Ground Combat]]
- [[game-server/simulation/tactical-divisions|Tactical Divisions]]

