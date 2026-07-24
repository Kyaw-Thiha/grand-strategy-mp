# Divisions and Selection

Divisions are the armies players see on the map. Players can inspect their condition, select one or several friendly divisions, and open the controls used to move, hold, retreat, reposition, or manage templates.

# Details

## Map representation

`MilitarySystem`, implemented by `client/src/systems/military/military_system.gd`, creates a `DivisionIcon` for each division in `GameState`. Icons show nation color, health, supply, combat state, selection, and stack position while their displayed location is reconciled toward server updates.

The system listens for division add, update, removal, stack, combat, and visibility events. It reads current division records from `GameState`; it does not create match outcomes. MapDebug may seed fixture divisions when its mirror is empty, while the production scene does not.

## Selecting forces

Players can click one visible division, Shift-click to add or remove friendly divisions, or drag a selection box around friendly units. `MilitarySystem` publishes the resulting identifiers through `EventBus.division_selected`, `division_deselected`, and `division_selection_changed`.

Enemy divisions may be inspected when current vision permits, but ownership enforcement prevents the player from issuing their movement controls. Selecting a division clears province selection so the bottom HUD shows one coherent target.

## Division panels and templates

`GameHUD` responds to selection signals and opens the appropriate friendly or enemy division panel. Friendly controls emit movement-mode intent or submit `HOLD` and `RETREAT` through `CommandQueue`.

The division builder edits local template definitions in `DivisionTemplateStore`. The template viewer can submit `ASSIGN_TEMPLATE` for a live division. The local preview is not permission to change a server-owned division; the game server validates the assignment.

## Visibility

Friendly divisions remain visible to their owner. Foreign division icons depend on province/unit vision and explicit `DIVISION_REVEALED` or `DIVISION_HIDDEN` server events. The military system asks `VisionSystem` about display visibility and never uses a hidden icon as authority for whether a server command is legal.

# Related Notes

- [[client/military/index|Client Military]]
- [[client/military/movement-and-pathfinding|Movement and Pathfinding]]
- [[client/military/stacks-engagements-and-tactical-ui|Stacks, Engagements, and Tactical UI]]
- [[client/vision/visibility-and-reveal|Visibility and Reveal]]
- [[client/core/local-preferences-and-templates|Local Preferences and Templates]]

