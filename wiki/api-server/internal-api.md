# Internal API

The internal API is the trusted interface used by the Colyseus game server. It currently supports two server-side operations: checking a player's persisted host-pass entitlement and recording that a game room has ended.

These routes are not part of the Godot client API. A player JWT is deliberately rejected; the caller must prove it is the game-server service with `INTERNAL_SECRET`.

# Related Notes

- [[api-server/index|API Server]]
- [[api-server/authentication|Authentication]]
- [[api-server/lobby|Lobby Coordination]]
- [[api-server/database|Database and RLS]]
- [[api-server/deployment|Development and Deployment]]

# Details

## Authentication

Every `/internal/*` request must send:

```http
Authorization: Internal <INTERNAL_SECRET>
```

Any other value returns `403`.

The current guard is a shared-secret comparison in `src/index.ts`. It is a trust boundary, not player authorization: it answers “is this the game server?” rather than “which player is this?”

## `GET /internal/verify-host-pass/:userId`

Looks up a player by UUID and returns:

```json
{ "hasHostPass": true }
```

Unknown players return `404`. This endpoint exists for a game-server host entitlement check, although the current `GameRoom` source has no active call site for it; the client must never call it directly.

## `POST /internal/game-end`

The current caller sends:

```json
{
  "room_id": "<colyseus-room-id>",
  "result_json": { "winner_id": "<player-id>" },
  "started_at": "<iso-8601-timestamp>"
}
```

The route inserts a `game_sessions` row with start time, end time, and result JSON, then removes the in-memory lobby entry whose room ID matches. It returns `{ "session_id": "<uuid>" }`.

The route currently does not persist the room ID, map ID, duration, winner column, end reason, or per-player results. It also does not make retries idempotent. The current `GameRoom.notifyGameEnd()` sends only the room ID, a result object containing `winner_id`, and the room start time.
