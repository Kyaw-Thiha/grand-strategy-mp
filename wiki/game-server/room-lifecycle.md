# Room Lifecycle

A game room moves players from an authenticated lobby into one temporary running match, then ends and reports the result. The room owns all live state during that period and releases it when Colyseus disposes the room.

# Details

## Lifecycle

```text
Client joins with JWT
  -> GameRoom verifies token and records PlayerState
  -> player selects a nation and becomes ready
  -> host starts, or all selected players are ready
  -> server loads map data and spawns live state
  -> one-second simulation tick runs while phase is running
  -> host ends game
  -> server notifies API internal game-end route
  -> Colyseus disposes the room and its in-memory state
```

## Lobby

`onCreate()` creates nation slots for the selected map. `onJoin()` adds the authenticated player, assigns the first connected client as host, and broadcasts lobby state. A player may hold one nation slot; leaving clears that nation's player assignment and readiness. If the host leaves, the next connected client becomes host.

Only the host may issue `START_GAME` and `END_GAME`. A game may auto-start when every selected player is ready.

## Starting a game

`startGame()` changes the phase to `running`, loads movement and map data, initializes province ownership and neutral relations, spawns divisions and air wings, broadcasts initial state, and starts a one-second interval.

`game-server/src/rooms/GameRoom.ts`, `GameRoom.startGame()`, makes the phase change before initializing match systems:

```ts
private startGame() {
  this.state.phase = "running";
  this.gameStartedAt = new Date();
  this.movementSystem.loadWaypoints(this.state.map_id);
  this.movementSystem.loadMapData(this.state.map_id);
  this.combatSystem.loadMapData(this.state.map_id);
  this.supplySystem.loadMapData(this.state.map_id);
}
```

This shows that map and simulation data are prepared by the room at match start, not by the client.

## Ending a game

`END_GAME` currently produces `GAME_ENDED` with reason `host_ended`. The winner resolver is **Planned**: the current `resolveWinner()` returns an empty ID, so the server does not yet determine victory from game state.

The room calls `POST /internal/game-end` on the API server with its room ID, start time, and `{ winner_id }`. Persistence failure is logged but does not prevent the room from reaching `ended`.

## Disposal

`onDispose()` clears pending diplomacy-vote timers and in-memory vote tracking. No room state is retained by the game server after disposal.

# Related Notes

- [[game-server/index|Game Server]]
- [[game-server/game-state|Authoritative Game State]]
- [[game-server/commands-and-events|Commands and Events]]
- [[api-server/internal-api|Internal API]]
