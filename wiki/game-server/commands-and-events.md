# Commands and Events

The game server accepts player intent as named Colyseus messages and returns authoritative outcomes through replicated state and events. A command does not change the game merely because a client sends it: the room checks the current phase, player ownership, and relevant game rules first.

# Details

## Player commands

| Area               | Commands                                                                                                        | Effect                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Lobby              | `SELECT_NATION`, `DESELECT_NATION`, `SET_READY`, `START_GAME`, `VOTE_SPEED`, `END_GAME`                         | Selects a nation, controls readiness, and manages the match lifecycle.                    |
| Ground forces      | `SUBMIT_MOVE_ORDER`, `HOLD`, `RETREAT`, `REPOSITION`, `REORDER_STACK`, `ASSIGN_TEMPLATE`                        | Issues movement or combat-positioning intent and changes tactical templates when allowed. |
| Diplomacy and chat | `DIPLOMACY_ACTION`, `DIPLOMACY_VOTE_RESPONSE`, `SEND_CHAT`                                                      | Starts or votes on diplomatic changes, or sends a capped chat message.                    |
| Air forces         | `ASSIGN_WING_MISSION`, `RETREAT_WING`, `REDEPLOY_WING`, `SUBMIT_AIR_WING_MOVE`, `DISBAND_WING`, `SET_WING_PERK` | Controls owned wings during the running phase.                                            |

Development-only messages add diagnostic spawning, teleportation, radar, supply, relation, and tactical-state controls when `DEV_MODE=true`. They are not player-facing contracts.

## Major server events

| Event group          | Examples                                                                                       | Meaning                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Lobby and lifecycle  | `LOBBY_STATE_UPDATE`, `GAME_STARTED`, `GAME_ENDED`                                             | The lobby changed, the match began, or the match ended.    |
| Ground state         | `DIVISIONS_SPAWNED`, `DIVISION_UPDATES`, `PROVINCE_INIT`, `PROVINCE_CAPTURED`                  | Initial or changed strategic ground state.                 |
| Ground combat        | `COMBAT_RESULT`, `ROUND_RESOLVED`, `COMBAT_ENDED`, `UNIT_DESTROYED`                            | A combat round, outcome, or unit lifecycle change.         |
| Diplomacy            | `RELATIONS_UPDATED`, `DIPLOMACY_VOTE_UPDATED`, `DIPLOMACY_NOTIFICATION`                        | Relationship changes and vote progress.                    |
| Air state            | `AIR_WING_UPDATES`, `AIR_WING_PATH`, `AIR_COMBAT_STARTED`, `AIR_COMBAT_ENDED`, `WING_DETECTED` | Wing state, paths, air combat, and detection.              |
| Errors and rejection | `ERROR`, `MOVE_ORDER_REJECTED`, `AIR_WING_MOVE_REJECTED`                                       | The requested action was invalid or currently unavailable. |

Some messages are sent only to the issuing client or an affected nation, notably validation errors, diplomacy vote prompts, radar updates, and certain detection information. Do not assume every event is globally visible.

## Contract ownership

The message names and payloads are currently defined alongside `GameRoom` and individual systems. A shared client/server contract package is **Planned**; until then, changes to these messages must be checked against Godot senders and handlers.

`game-server/src/rooms/GameRoom.ts` registers each message with a handler that first checks the running phase and player state:

```ts
this.onMessage("RETREAT_WING", (client, msg: { wing_id: string }) => {
  if (this.state.phase !== "running") return;
  const player = this.state.players.get(client.sessionId);
  if (!player) return;
  const nation = this.getNationForPlayer(player.userId);
  if (!nation) return;
  const wing = this.state.air_wings.get(msg.wing_id);
  if (!wing || wing.nation_id !== nation.nation_id) return;
  this.airWingLifecycleSystem.retreatWing(msg.wing_id, this.state, (type, m) => this.broadcast(type, m));
});
```

The named message is only player intent; the room controls whether it can affect the authoritative state.

# Related Notes

- [[game-server/index|Game Server]]
- [[game-server/game-state|Authoritative Game State]]
- [[game-server/room-lifecycle|Room Lifecycle]]
- [[game-server/simulation/index|Simulation]]
