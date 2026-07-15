# Player Profile

The profile is the persisted account record for an individual player. The current profile contains the player's ID, email, optional Steam ID, host-pass entitlement, and account creation time.

It does not contain a player's current nation, units, readiness, or tactical state; those belong to the active Colyseus room. Both profile routes operate only on the account identified by the player's JWT, so a client cannot select another player's record.

# Related Notes

- [[api-server/index|API Server]]
- [[api-server/authentication|Authentication]]
- [[api-server/database|Database and RLS]]
- [[api-server/deployment|Development and Deployment]]

# Details

## Profile lifecycle

```text
Auth creates or identifies players row
  -> JWT carries player UUID in sub
  -> GET /profile reads the row for that UUID
  -> PUT /profile updates the same row
```

The Godot client currently uses the JWT claims immediately after login and does not need to fetch the profile to complete the lobby flow.

### `GET /profile`

The player is identified by the JWT `sub` claim. The response contains:

```json
{
  "id": "<uuid>",
  "email": "player@example.com",
  "steamId": null,
  "hasHostPass": false,
  "createdAt": "<timestamp>"
}
```

If the player no longer exists, the route returns `404`.

### `PUT /profile`

Request body:

```json
{ "email": "new-address@example.com" }
```

The route updates only the authenticated player's email and returns the updated ID and email. An absent email returns `400`. The current implementation does not reissue a JWT after an email change, so an existing token can contain the previous email until it is refreshed.

The current route does not expose display names, statistics, cosmetics, or division templates, despite those appearing in older design contracts. Those are separate future domains, not hidden behavior of this route.
