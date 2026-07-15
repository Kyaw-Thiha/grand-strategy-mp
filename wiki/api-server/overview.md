# API Server Role and Boundaries

The API server is the application backend outside the live match. Its responsibilities are player identity, account entitlements, room discovery, and durable records created when a match ends. It makes those concerns available to the Godot client and to the Colyseus game server without becoming a second owner of live game state.

The service boundaries are:

- The API server owns account and coordination concerns.
- The game server owns live simulation concerns.
- The Godot client owns presentation and player intent, not authoritative data.

# Related Notes

- [[api-server/index|API Server]]
- [[api-server/authentication|Authentication]]
- [[api-server/lobby|Lobby Coordination]]
- [[api-server/internal-api|Internal API]]
- [[api-server/database|Database and RLS]]
- [[api-server/deployment|Development and Deployment]]

# Details

## Account and session lifecycle responsibilities

The API server supports the following stages of the application lifecycle:

1. Establish an identity through login.
2. Return a token that proves that identity to other services.
3. Allow an eligible player to reserve a lobby.
4. Help another player turn a join code into a Colyseus room ID.
5. Receive the final room result so the session is not lost when the room is destroyed.

The game server performs the transition from lobby to running simulation. The API server provides the identity and room-discovery data required for that handoff.

## Route group responsibilities

The service currently exposes four route groups:

| Route group | App responsibility                   | Current state                                             |
| ----------- | ------------------------------------ | --------------------------------------------------------- |
| `/auth`     | Establish and renew player identity  | Implemented for email/password development auth           |
| `/profile`  | Read and update the current account  | Implemented, limited to email/profile fields              |
| `/lobby`    | Coordinate join codes and room IDs   | Implemented with process-local memory                     |
| `/internal` | Receive trusted game-server requests | Implemented for host-pass lookup and game-end persistence |

## Trust boundaries

- Player routes use `Authorization: Bearer <jwt>`.
- Internal routes use `Authorization: Internal <INTERNAL_SECRET>`.
- The client is allowed to ask for account and lobby operations, but it cannot write live simulation state through this service.
- The game server may report trusted lifecycle events, but the client must never be allowed to impersonate that internal caller.

## Persistent versus session data

The database is for data that should remain meaningful after a room ends. The in-memory lobby store is only a rendezvous point. Live game state should not be copied into the API server on every tick; that would make the API server a second simulation authority.

## Current implementation gap

- The current service implements only the minimum account/lobby/session bridge needed by the playable development loop.
- The old contracts describe Steam auth, division CRUD, shop APIs, public profiles, and richer game-session history that are not live routes today.
- `division_templates` exists in the database schema but is not currently exposed through API routes.
- The in-memory lobby design works for one development process, not for reliable multi-instance deployment.
