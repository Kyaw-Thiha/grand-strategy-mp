# API Server Backlog

This backlog identifies the API work still needed to make accounts, lobby coordination, and
persistence safe and maintainable beyond the current development environment.

# Details

## Security and correctness

**Planned:** validate required secrets and database configuration at startup, centralize JWT
claims and middleware, add typed request validation and normalized account input, handle
database constraint failures without leaking driver details, and make trusted game-end
writes validated and idempotent.

Credential-looking local values must be treated as disposable development data or rotated;
tracked examples and documentation contain placeholders only.

## Persistence boundaries

**Planned:** place database access behind repository or service boundaries, give lobby
storage explicit expiration and state transitions, replace collision-prone join-code
generation, adopt tracked database migrations, and settle one supported RLS/direct-database
trust model.

Persistent division-template routes and richer completed-session records remain deferred
until their contracts are stable. A multi-replica API deployment also needs shared lobby
storage instead of the current in-memory map.

## Operations and testability

**Planned:** add application and database readiness checks, structured secret-safe logging,
graceful database shutdown, an injectable application factory, explicit type-check/test
scripts, and broader route coverage for authorization, invalid payloads, duplicate requests,
lobby cleanup, and database failures.

## Implementation anchors

- `api-server/src/index.ts` — application startup and environment use.
- `api-server/src/routes/` — authentication, profile, lobby, and internal handlers.
- `api-server/src/db/schema.ts` — current persistent tables.
- `api-server/src/db/rls.sql` — row-level-security policy assumptions.

# Related Notes

- [[api-server/index|API Server]]
- [[api-server/overview|Role and Boundaries]]
- [[api-server/internal-api|Internal API]]
- [[api-server/database|Database and RLS]]
- [[docs/ARCHITECTURE|Architecture]]
- [[docs/DATA_CONTRACTS|Data Contracts]]
