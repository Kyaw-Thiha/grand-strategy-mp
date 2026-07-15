# Database and RLS

The database contains the game's durable, non-simulation data. It currently stores three kinds of records:

- **Player accounts** — email and password credentials, an optional Steam ID, host-pass entitlement, and account creation time.
- **Division templates** — named, player-owned JSON templates for persistent unit layouts. The table exists, but the application does not yet use it.
- **Game-session records** — the start time, end time, and result JSON for completed rooms. The current record is deliberately minimal and is not yet a match-history system.

It does not contain live room state: nations, units, readiness, combat, movement, diplomacy, and the simulation tick remain in the Colyseus game server while a game is running. The API server reads and writes the durable records; a room reports its result through the internal API before it is destroyed.

The current implementation uses Supabase Postgres, Drizzle for schema definitions and queries, and the `postgres` driver for the API server's direct connection.

# Related Notes

- [[api-server/index|API Server]]
- [[api-server/authentication|Authentication]]
- [[api-server/profile|Player Profile]]
- [[api-server/internal-api|Internal API]]
- [[api-server/deployment|Development and Deployment]]

# Details

## Current tables

### `players`

The durable account record behind the JWT `sub` claim. It is separate from the `PlayerState` held in a live Colyseus room.

| Column          | Type           | Contents                                         |
| --------------- | -------------- | ------------------------------------------------ |
| `id`            | UUID           | Primary key and player identity used by JWTs.    |
| `email`         | Text           | Unique email used by development authentication. |
| `password_hash` | Text           | Hashed password; never returned to the client.   |
| `steam_id`      | Text, optional | Reserved for future Steam identity linkage.      |
| `has_host_pass` | Boolean        | Whether the account is entitled to host a lobby. |
| `created_at`    | Timestamp      | Account creation time.                           |

Used by the authentication and profile routes. The internal API can also read the host-pass field for the game server.

### `division_templates`

Player-owned persistent division layouts. The table is defined but no current API route reads or writes it.

| Column | Type | Contents |
| --- | --- | --- |
| `id` | UUID | Primary key for the template. |
| `player_id` | UUID | Owning player; references `players.id` and is deleted with the player. |
| `name` | Text | Player-facing template name. |
| `template_json` | JSONB | The template's unit-layout data. |
| `updated_at` | Timestamp | Most recent update time. |

### `game_sessions`

Minimal durable record of a Colyseus room ending. It is not yet a complete match-history model: it has no room ID, map, end reason, or per-player results stored in dedicated columns.

| Column | Type | Contents |
| --- | --- | --- |
| `id` | UUID | Primary key for the recorded session. |
| `started_at` | Timestamp | Reported or default session start time. |
| `ended_at` | Timestamp, optional | Time the game-end event was recorded. |
| `result_json` | JSONB, optional | Flexible result payload; currently includes the winner ID. |

`POST /internal/game-end` creates these records when the game server reports that a room has ended.

## Database access

`src/db/index.ts` creates one Drizzle client using `DATABASE_URL` with SSL enabled. Route handlers query the exported client directly. The database is not part of the real-time tick loop.

## RLS script

`rls.sql` enables row-level security and defines select policies for players, division templates, and public game-session history. Its comments describe a future direct Supabase client flow; the current Hono route implementation does not use the Supabase JS client for database access.

The old documentation describes a larger schema and Supabase service-role write path than the current code. Those fields and access patterns should not be treated as implemented.

## Schema changes

The current README instructs developers to use `drizzle-kit push`. A tracked migration workflow has not yet been established in the repository. Treat schema changes as cross-service changes: route payloads, client expectations, RLS policies, and game-server end-of-session data may all depend on them.
