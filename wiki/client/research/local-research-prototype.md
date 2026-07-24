# Local Research Prototype

The research prototype lets players open a technology tree, choose an available entry, watch its progress, and unlock later rows during the current client scene.

# Details

## Current implementation

**Current prototype:** research definitions are authored as cards in `client/scenes/systems/research/research_tree.tscn`. The scene owns a `ResearchSystem` node implemented by `client/src/systems/research/research_system.gd`.

`ResearchSystem` keeps definitions, active progress, completed entries, row availability, and exclusive-branch choices in local memory. It advances the active entry at one science point per real second. The state is not stored in `GameState`, persisted, or sent to another player.

## Progression rules

The first authored row is available immediately. A later row becomes available after any entry in the previous authored row is completed. Starting or making progress in one exclusive group blocks its alternatives.

Completing an entry records its effects dictionary locally and emits research progress/completion events. Those effects are displayed data; no current gameplay system applies them to server simulation.

## Research UI

`ResearchTreeView` collects the inspector-authored cards and gives their definitions to the local system. Each card shows unavailable, available, active, or researched presentation.

The side research drawer receives the same scene-owned `ResearchSystem` from `GameHUD`, lists runnable entries, starts them, and shows progress. The HUD dock fill and notification feed react to `EventBus` research signals.

`client/src/ui/hud/research_panel.gd` is an older placeholder panel; the active side drawer uses `research_drawer_panel.gd` and opens the full `research_tree.tscn`.

## Planned multiplayer boundary

**Planned:** research definitions, progression time, science income, completion, effects, and persistence must move to server-owned match state and commands before this becomes multiplayer gameplay. The client should then display mirrored progress and submit research choices through `CommandQueue`.

The current local prototype must not be presented as authoritative or durable. Closing/replacing its scene recreates its state.

# Related Notes

- [[client/research/index|Client Research]]
- [[client/ui/hud-panels-and-input|HUD Panels and Input]]
- [[client/core/events|Event Bus]]
- [[client/testing/test-scenes-and-workflows|Client Test Scenes and Workflows]]

