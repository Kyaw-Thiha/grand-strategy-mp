# Diplomacy Actions, Relations, and Votes

Diplomacy lets players inspect alliances and enemies, invite or remove partners, declare war, seek peace, and answer alliance decisions that require a vote.

# Details

## Relations shown to the player

`GameState.relations` holds the client’s latest server-reported stance pairs. `DiplomacyPanel` groups nations into the player’s alliance, neutral nations, and enemies, and provides a second view of all alliance groups.

`RELATIONS_UPDATED` is currently applied by `SessionManager`, which causes `EventBus.relation_changed` notifications. The panel rebuilds from the mirror when relations, lobby state, or phase changes.

## Player actions

`DiplomacySystem`, implemented by `client/src/systems/diplomacy/diplomacy_system.gd`, is the command facade. It submits `DIPLOMACY_ACTION` for invite, declare-war, make-peace, quit-alliance, and kick intent, and submits `DIPLOMACY_VOTE_RESPONSE` for yes/no answers.

The panel chooses which controls to display from current relations, but those controls are not authority. `CommandQueue` carries the request and the game server validates membership, targets, active votes, and the resulting relation.

## Notifications and voting

Ordinary diplomacy messages become timed notification cards. Interactive proposal and vote messages become cards with a deadline bar, voter status markers, and Yes/No buttons. `DIPLOMACY_VOTE_UPDATED` refreshes an existing card, including its passed/failed state.

The notification feed submits a response through `DiplomacySystem`; it does not directly change relations or mark a server vote complete.

## Current map-metadata limitation

Nation names and flags are read from generated `nations.json`. **Current limitation:** `DiplomacyPanel` and the notification feed use `western_europe_6` directly rather than consistently selecting metadata from `GameState.map_id`. A shared map-scoped metadata boundary is a refactor candidate for multi-map correctness.

# Related Notes

- [[client/diplomacy/index|Client Diplomacy]]
- [[client/networking/commands-state-and-events|Commands, State, and Events]]
- [[client/ui/chat-and-notifications|Chat and Notifications]]
- [[game-server/commands-and-events|Commands and Events]]
- [[game-server/game-state|Authoritative Game State]]

