# Login and Session Identity

Players can sign in from the main menu with a development email and password, then access the lobby actions available to their account. Their credentials and sign-in token are kept only for the running game session.

# Details

## Development login

**Current:** The main menu sends the entered email and password to `AuthManager.login()`. Debug builds prefill the development credentials used by the local E2E setup; release builds leave the fields for the player to complete.

`AuthManager`, implemented by `client/src/auth/auth_manager.gd`, trims surrounding whitespace from the email and posts the credentials to `/auth/email` through `APIClient`. The API server creates a development account when the email is new or verifies the password for an existing account. Password verification and JWT signing happen on the API server, not in the game client.

While the request is running, `client/src/ui/main_menu/main_menu.gd` disables the Login button and displays `Logging in...`. A successful `logged_in` signal reveals Settings, join, browse, and eligible hosting actions. A `login_failed` signal re-enables the button and displays the returned reason.

## In-memory token and local claims

On a successful response, `AuthManager` stores the JWT in `APIClient.jwt`. The token is never written to a client file, so closing the game ends the local authenticated session.

The client decodes the JWT payload into three convenience values:

- `user_id` from `sub`, used to identify the local player in lobby and match views.
- `user_email` from `email`, falling back to the submitted email.
- `has_host_pass`, used to decide whether the main menu should show Create Game.

This decoding does not verify the JWT signature or grant authority. The API server verifies bearer tokens, and the game server verifies the token before admitting a player to a room. `AuthManager.is_logged_in()` currently checks only whether `APIClient.jwt` is non-empty; it does not inspect expiry.

`client/src/auth/auth_manager.gd`, `AuthManager.login()`, performs the client-side handoff:

```gdscript
var token: String = result["data"].get("token", "")
if token == "":
	login_failed.emit("No token in response")
	return

APIClient.jwt = token
var payload: Dictionary = _decode_payload(token)
user_id = payload.get("sub", "")
user_email = payload.get("email", normalized_email)
has_host_pass = payload.get("has_host_pass", false)
logged_in.emit(user_id)
```

## Logout behavior

**Current:** `AuthManager.logout()` clears `APIClient.jwt`, `user_id`, `user_email`, and `has_host_pass`. The current main-menu scene has no Logout control, nothing calls this method in normal play, and no logout signal coordinates room disconnection or a menu reset. A player therefore ends the visible session by closing the client rather than explicitly signing out.

## Login failures

For a completed non-200 response, `AuthManager` emits the API response's `error` value or the fallback `Login failed`. A successful response without a token emits `No token in response`. The main menu keeps the login form available and shows the reason.

Transport, invalid-JSON, refresh, and expired-token handling are current limitations described in [[client/auth/jwt-and-api-requests|JWT and API Requests]].

# Related Notes

- [[client/auth/index|Client Authentication]]
- [[client/auth/jwt-and-api-requests|JWT and API Requests]]
- [[client/core/configuration-and-serialization|Configuration and Serialization]]
- [[api-server/authentication|API Server Authentication]]

