# JWT and API Requests

Once signed in, a player's identity follows their lobby and match requests so the services can decide which account is acting and whether that account may host a game.

# Details

## Authenticated API requests

`APIClient`, implemented by `client/src/net/api_client.gd`, is the client facade for Hono API calls. Its base URL reads `Config.API_URL`, so authentication uses the debug, release, or valid JSON-overridden API endpoint selected by [[client/core/configuration-and-serialization|Configuration and Serialization]].

The `post()`, `get_req()`, and `put()` helpers route through one request method. It always adds `Content-Type: application/json` and adds `Authorization: Bearer <JWT>` when `APIClient.jwt` is non-empty. The initial `/auth/email` request therefore has no bearer header; later protected requests reuse the token stored by `AuthManager`.

`client/src/net/api_client.gd`, `APIClient._request()`, attaches that header:

```gdscript
var headers := ["Content-Type: application/json"]
if jwt != "":
	headers.append("Authorization: Bearer " + jwt)

var body_string := JSON.stringify(body) if not body.is_empty() else ""
http.request(BASE_URL + endpoint, headers, method, body_string)
```

After a completed request, the helper returns a dictionary shaped as `{ "code": HTTP status, "data": parsed JSON }`. Callers decide how to present or route failures.

## Host-pass claim

The main menu reads the locally decoded `AuthManager.has_host_pass` claim to hide Create Game when the player is not eligible to host. This is presentation only: `POST /lobby/create` verifies the signed JWT and rejects a missing host pass on the API server. Changing the local value or decoded token display cannot grant hosting access.

Development tokens report a host pass when the API server runs with `DEV_MODE=true`. Joining by code or browsing public games does not use the local host-pass check.

## Commands and room admission

`client/src/core/command_queue.gd` rejects a gameplay command when `AuthManager.is_logged_in()` is false, then checks the room connection before forwarding it. These are usability gates; the game server remains responsible for validating the authenticated player and the requested action.

Colyseus matchmaking uses the same JWT through `client/src/net/net_manager.gd`, but sends it as the matchmaker request's `token` option rather than an Hono bearer header. The game server verifies it before room admission.

## Failure and expiry behavior

**Current:** `APIClient` has no retry, timeout policy, token refresh, or automatic logout on `401`. Although the API server exposes `/auth/refresh`, the client does not call it. A token remains locally “logged in” until cleared even after it expires; protected API or room requests then fail when a server verifies it.

The request facade also assumes request startup succeeds and that the response body parses into the shape expected by each caller. It does not normalize transport errors, empty bodies, or invalid JSON. Authentication callers can therefore receive `null` data instead of a dictionary, and the current login error path may fail while trying to read an error message. These are documented implementation limitations, not intended player behavior.

# Related Notes

- [[client/auth/index|Client Authentication]]
- [[client/auth/login-and-session|Login and Session Identity]]
- [[client/core/game-state-and-commands|Game-State Mirror and Commands]]
- [[client/networking/index|Networking]]
- [[api-server/authentication|API Server Authentication]]
- [[api-server/lobby|Lobby Coordination]]

