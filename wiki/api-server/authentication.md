# Authentication

Authentication creates the identity shared by the API server and game server for one player. It turns a development account's email and password into a signed JWT containing the player's account ID and current host-pass entitlement.

The client uses that JWT to access its own API resources and to join a Colyseus room. The token identifies a player; it does not grant access to the internal API or make the client authoritative over game state.

# Details

### Login flow through the app

```text
Player enters email/password in Godot
  -> AuthManager calls APIClient.post("/auth/email")
  -> API server finds or creates the players row
  -> API server signs a JWT
  -> Godot stores the JWT in APIClient and reads its display claims
  -> NetManager passes the JWT to Colyseus
  -> Game server verifies the same JWT_SECRET
```

The client may decode its own token to display the user ID, email, and host-pass state, but that decoding is not authentication. The API and game server verify the signature independently.

### `POST /auth/email`

Request body:

```json
{ "email": "player@example.com", "password": "..." }
```

This endpoint intentionally combines registration and login during the development phase. It registers a new player when the email does not exist, or verifies the password for an existing player. Missing email or password returns `400`; invalid credentials return `401`.

The route stores a password hash, never the submitted password. The database row is the source of truth for the player's host-pass flag and account identity.

Response:

```json
{ "token": "<jwt>" }
```

In `DEV_MODE=true`, newly created players receive a host pass and issued tokens report `has_host_pass: true`.

### JWT claims

The current payload contains:

- `sub` — player UUID.
- `email` — account email.
- `steam_id` — stored Steam ID, or the development placeholder when absent.
- `has_host_pass` — host entitlement, overridden to true in development mode.
- `exp` — 24 hours after issuance.

The same `JWT_SECRET` must be configured in the API and game servers. The game server verifies this token during Colyseus authentication. A player JWT is not an internal API credential.

### `POST /auth/refresh`

Requires `Authorization: Bearer <jwt>`. The existing token is verified, the player is loaded from the database, and a new 24-hour token is returned. Missing, invalid, or expired tokens return `401`; a missing player returns `404`.

### Planned authentication

Steam ticket authentication remains future work. The old design documents a Steam-to-Hono verification bridge, but no `/auth/steam` route exists in the current code.

When Steam authentication is added, Hono should remain the only service that sees the Steam Web API secret. The client should provide a ticket, not the server secret.

## Verified route example

`api-server/src/routes/auth.ts` makes the email route register a new account or verify the existing password before signing a token:

```ts
auth.post('/email', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>()
  if (!email || !password) return c.json({ error: 'email and password required' }, 400)
  const [existing] = await db.select().from(players).where(eq(players.email, email)).limit(1)
  let player: typeof players.$inferSelect
  if (!existing) {
    const passwordHash = await Bun.password.hash(password)
```

This is the verified implementation behind the development registration/login behavior described above.

# Related Notes

- [[api-server/index|API Server]]
- [[api-server/profile|Player Profile]]
- [[api-server/lobby|Lobby Coordination]]
- [[api-server/deployment|Development and Deployment]]
