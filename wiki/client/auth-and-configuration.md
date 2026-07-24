# Authentication and Configuration

Authentication lets a player sign in, unlock the menu actions available to their account, and join a game room. It keeps the sign-in information needed for that play session without saving a password in the game client.

# Details

## Endpoint selection

Endpoint selection and JSON override behavior belong to [[client/core/configuration-and-serialization|Configuration and Serialization]]. Authentication uses those selected API endpoints; it does not own endpoint policy.

## Development login

`AuthManager.login()` posts email/password to `/auth/email` through `APIClient`. On success it retains the token only in memory, decodes its payload only to display the local `sub`, `email`, and `has_host_pass` claims, and emits `logged_in`. The API and game servers are responsible for signature verification and authorization. `logout()` clears the in-memory token and claims.

`APIClient` owns HTTP requests to `Config.API_URL` and adds `Authorization: Bearer <JWT>` only when a token exists. Its helpers return a `{ code, data }` result for the caller to handle.

## Steam status

Steam backend authentication is **Planned**. No Steam API key belongs in the client. The intended future flow uses `getAuthTicketForWebApi()` with hex encoding, then Hono validates it and returns the same JWT shape; it must not use `getAuthSessionTicket()` for backend authentication.

## Verified login example

`client/src/auth/auth_manager.gd`, `AuthManager.login()`, sends the development credentials through the API facade:

```gdscript
func login(email: String, password: String) -> void:
	var normalized_email: String = email.strip_edges()
	var result := await APIClient.post("/auth/email", {
		"email": normalized_email,
		"password": password,
	})
```

This is the client request that starts the JWT-based development login; the server, not this code, verifies credentials.

# Related Notes

- [[client/index|Client]]
- [[client/core/configuration-and-serialization|Configuration and Serialization]]
- [[client/networking/index|Networking]]
- [[api-server/authentication|Authentication]]
- [[api-server/lobby|Lobby Coordination]]
