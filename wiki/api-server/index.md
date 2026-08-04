# API Server

The API server is the backend for information and operations that exist outside an individual game session. It keeps track of player accounts and host entitlements, helps players find a Colyseus room, and records the small amount of session information that must survive after that room ends.

It currently provides:

- Registering and authenticating development accounts.
- Issuing and refreshing player JWTs used by the client and game server.
- Reading and updating the authenticated player's account profile.
- Determining whether a player may reserve a lobby through the host-pass entitlement.
- Mapping human-readable lobby join codes to Colyseus room IDs.
- Receiving trusted game-server lifecycle events and persisting minimal game-session results.
- Providing the server-to-server boundary between Colyseus and the database.

It is not the game's simulation server. Real-time state, combat, movement, diplomacy, economy, and game-speed logic belong to `game-server` and exist within the lifetime of a game room.

## Service Relationship

The services interact during a session as follows:

```text
Godot client
  ├─ logs in and manages account/lobby requests ──> API server
  ├─ sends and receives live game state ───────────> Game server
  └─ displays the result of both services

Game server ── trusted game-end request ──> API server ──> PostgreSQL/Supabase
```

The API server separates the temporary multiplayer session from the longer-lived account and persistence layer. The client uses it for HTTP operations before and after a game; the game server uses it for trusted persistence operations; neither service delegates live simulation to it.

## Data Lifetime

| Data                                       | Owner                           | Lifetime                                                |
| ------------------------------------------ | ------------------------------- | ------------------------------------------------------- |
| Login identity and password hash           | API server + database           | Persists across games                                   |
| Host-pass entitlement                      | API server + database/JWT claim | Persists across games                                   |
| Player profile                             | API server + database           | Persists across games                                   |
| Join-code registry                         | API server memory               | Until room cleanup or API restart                       |
| Live nations, units, combat, and diplomacy | Game server room                | Only during a game                                      |
| Game-session record                        | API server + database           | Intended to survive room destruction; currently minimal |

## Responsibilities

- Identity, authentication, authorization, account/profile data, entitlements, and other player-level information.
- Coordination data needed to find or enter a game room.
- Validation and persistence of data that must survive a game.
- Trusted server-to-server operations initiated by the game server.

## Out of Scope

- Combat calculations or tactical rules.
- Movement, pathfinding, economy, diplomacy, or game-speed simulation.
- The authoritative live game state.
- Client UI state or Godot scene transitions.

The API server may authorize access to a game, but the game server remains authoritative once the player is inside the room.

# Wiki

- [[api-server/overview|Role and Boundaries]]
- [[api-server/authentication|Authentication]]
- [[api-server/profile|Player Profile]]
- [[api-server/lobby|Lobby Coordination]]
- [[api-server/internal-api|Internal API]]
- [[api-server/database|Database and RLS]]
- [[api-server/deployment|Development and Deployment]]
- [[api-server/backlog|API Server Backlog]]

# Related Notes

- [Architecture](../../docs/ARCHITECTURE.md)
- [Data Contracts](../../docs/DATA_CONTRACTS.md)
- [[game-server/index|Game Server]]
