# Planned Steam Authentication

Players are intended to sign in with their Steam identity in a future release while receiving the same game account and lobby access represented by today's development JWT.

# Details

## Current status

**Planned:** The client does not currently request Steam authentication tickets, and the API server has no `/auth/steam` route. `client/project.godot` includes the GodotSteam plugin, but Steam initialization is disabled and the application ID is still the development placeholder. Email/password through `/auth/email` is the current authentication flow.

## Planned ticket exchange

The planned client boundary is:

1. Request a Web API ticket with GodotSteam `getAuthTicketForWebApi(service_identity)`.
2. Wait for the Web API ticket response callback before using the ticket.
3. Hex-encode the returned ticket bytes.
4. Send the ticket to Hono's future `/auth/steam` route.
5. Let Hono validate it with Steam `AuthenticateUserTicket`, resolve the player account, and return a JWT compatible with the current client session.

The `service_identity` used by the client must exactly match the `identity` value used for server-side ticket validation. The final route and payload remain to be defined with the API-server implementation; historical payload examples are not current contracts.

## Security boundary

The Steam Web API key belongs only in Hono server configuration. The client sends a short-lived ticket and must never contain or receive that server secret.

Backend authentication must use `getAuthTicketForWebApi()`, not `getAuthSessionTicket()`. The latter belongs to Steam's peer/session authentication flow and is not the ticket type accepted by `AuthenticateUserTicket`.

The planned Steam exchange should finish by populating the same in-memory `APIClient.jwt`, `AuthManager.user_id`, `user_email`, and `has_host_pass` state used by development login. API and game servers must continue to verify the resulting JWT independently.

# Related Notes

- [[client/auth/index|Client Authentication]]
- [[client/auth/login-and-session|Login and Session Identity]]
- [[api-server/authentication|API Server Authentication]]

