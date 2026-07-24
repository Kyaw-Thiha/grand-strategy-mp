# Game Server Role and Boundaries

The game server is the authority for everything that happens during a match. It decides whether an action is valid, advances the simulation, changes the live game state, and tells clients what occurred. Clients send intent; they do not resolve combat, movement, diplomacy, supply, or air operations themselves.

The server owns a live Colyseus room rather than long-lived account data. Player identity and completed-session persistence remain the API server's responsibility.

# Details

## Responsibilities

- Authenticate a player's JWT when they join a room.
- Run the lobby: nation selection, readiness, host control, and game start/end.
- Hold and replicate live match state for players, nations, provinces, divisions, diplomatic relations, and air wings.
- Validate player commands against phase, ownership, state, and game rules.
- Advance the one-second game tick while the room is running.
- Resolve movement, territorial capture, supply, ground combat, tactical formations, and air operations.
- Publish state updates and discrete events for the Godot client.
- Send a trusted game-end notification to the API server.

## Boundaries

The server does not own player accounts, passwords, host-pass purchase state, or durable match history. It receives identity in a JWT and calls the API server's internal endpoint when a game ends.

The current room default is `western_europe_6`, supports up to six clients, and starts with a minimum of one ready player. The one-player threshold is a **Current** development setting, not a final multiplayer rule.

## Runtime shape

`src/index.ts` starts the Colyseus service. `src/app.config.ts` registers `game_room`, configures a 1 MB WebSocket payload limit, and exposes development monitoring routes. `GameRoom` coordinates the room and simulation systems; those systems mutate the room's authoritative state.

`game-server/src/app.config.ts` registers the current room and payload limit:

```ts
initializeTransport: () => new WebSocketTransport({
  maxPayload: 1 * 1024 * 1024,
}),

rooms: {
  game_room: defineRoom(GameRoom)
},
```

This is the process-level entry point that makes `GameRoom` available to Colyseus clients.

# Related Notes

- [[game-server/index|Game Server]]
- [[game-server/room-lifecycle|Room Lifecycle]]
- [[game-server/game-state|Authoritative Game State]]
- [[api-server/internal-api|Internal API]]
