# Deployment

The API server runs as a separate HTTP service alongside the Godot client and Colyseus game server. It requires a PostgreSQL connection for durable account and session data, plus shared secrets so it can issue player tokens and accept trusted game-server requests.

For local development, it serves HTTP at `http://localhost:3000`. The Godot client defaults to that address in debug builds. Game-server tests commonly override their API endpoint with `HONO_URL`; `GameRoom` uses `API_SERVER_URL` and defaults to the same localhost address.

# Related Notes

- [[api-server/index|API Server]]
- [[api-server/overview|Role and Boundaries]]
- [[api-server/authentication|Authentication]]
- [[api-server/database|Database and RLS]]
- [[api-server/lobby|Lobby Coordination]]
- [[api-server/internal-api|Internal API]]

# Details

## Requirements

- Bun.
- A PostgreSQL/Supabase database reachable through `DATABASE_URL`.
- Matching `JWT_SECRET` values in the API and game-server environments.
- Matching `INTERNAL_SECRET` values in the API and game-server environments.

The API and game server also need to agree on the database-backed player IDs and JWT claim shape. A client can connect to the API while still failing to join Colyseus if `JWT_SECRET` differs between the two services.

## Environment variables

The tracked `.env.example` defines:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — present for planned Supabase integration; the current route code does not use them.
- `JWT_SECRET` — signs player JWTs and must match the game server.
- `DATABASE_URL` — PostgreSQL connection string.
- `INTERNAL_SECRET` — guards server-to-server routes.
- `PORT` — documented as `3000` for local development.
- `DEV_MODE` — grants host-pass behavior for development authentication. The route code reads it, but it is not currently listed in `api-server/.env.example`; local scripts set it explicitly when needed.

Never commit `.env` files or place secret values in wiki pages.

## Local session loop

Run the API server and game server in separate terminals, then open the `client/` project in Godot:

```text
API server   -> HTTP http://localhost:3000
Game server  -> WebSocket ws://localhost:2567
Godot client -> calls both services
```

The normal host path is:

```text
email login
  -> API JWT
  -> lobby create
  -> Colyseus room create/join
  -> lobby activate
  -> second client resolves code and joins room
  -> game server runs session
  -> game server reports game-end to API
```

## Commands

```bash
cd api-server
bun install
bun run dev
```

The current package has no dedicated test script; the existing route test can be run with:

```bash
bun test src/routes/auth.test.ts
```

Database schema pushing is currently documented as:

```bash
bun drizzle-kit push
```

## Verification expectations

API changes should include route tests for authentication, authorization, validation, database failures, and side effects. Full session changes should also run the relevant `scripts/e2e-*.sh` or game-server integration flow.

If tests return database connection errors, check `DATABASE_URL` and database availability before treating the route code as the failure. The current route tests use the configured database rather than an isolated in-memory test database.
