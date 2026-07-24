# API Server Cleanup Backlog

This backlog records proposed cleanup after documenting the current implementation. It is intentionally separate from the documentation work.

## Priority 0 — Security and correctness

- Validate required environment variables at startup. Fail closed when `JWT_SECRET`, `INTERNAL_SECRET`, `DATABASE_URL`, or required production settings are absent.
- Rotate any credential-looking values in local environment files if they are real rather than disposable development credentials. Keep only placeholders in tracked examples and documentation.
- Add typed request validation, email normalization, password policy, and safe handling of malformed JSON.
- Centralize JWT middleware, claims, and configuration instead of duplicating route-local definitions.
- Make internal game-end writes authenticated, validated, and idempotent so retries cannot create duplicate session records.
- Handle database uniqueness and constraint errors without leaking driver details.

## Priority 1 — Boundaries and persistence

- Move database queries behind repositories/services so route handlers only translate HTTP requests and responses.
- Introduce a lobby-store interface with expiration and explicit state transitions. Use Redis or database-backed storage before deploying multiple API replicas.
- Replace `Math.random()` join-code generation with collision-safe generation and bounded retry behavior.
- Reconcile `rls.sql`, Supabase assumptions, and the actual direct PostgreSQL/Drizzle access path. Document one supported trust model.
- Establish tracked Drizzle migrations instead of relying only on `drizzle-kit push`.
- Decide whether `division_templates` is intentionally deferred or should receive validated CRUD routes.
- Expand `game_sessions` only when the game-server result contract is stable; include room, map, duration, winner, end reason, and player results together.

## Priority 2 — Maintainability and operations

- Add a health/readiness endpoint that checks application and database availability.
- Add structured request/error logging without logging tokens, passwords, or secrets.
- Add graceful database-client shutdown and deployment error handling.
- Add an application factory with dependency injection so route tests do not require an uncontrolled live database.
- Add explicit package scripts for type checking and API tests.
- Add route coverage for profile, lobby, internal authorization, invalid payloads, duplicate operations, lobby cleanup, and database failures.
- Remove or justify unused Supabase dependencies and environment variables once the direct-read architecture is finalized.
