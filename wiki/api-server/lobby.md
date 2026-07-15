# Lobby Coordination

The lobby API is the room-discovery service. It keeps a temporary registry of human-readable join codes, the player who reserved each code, and—once a room has been created—the matching Colyseus room ID.

It lets a host publish a room and lets another player find that room by code or through the public list. It does not own the room, its player list, nation selection, ready state, or game-start rules; those belong to the game server after clients connect.

# Related Notes

- [[api-server/index|API Server]]
- [[api-server/authentication|Authentication]]
- [[api-server/internal-api|Internal API]]
- [[api-server/deployment|Development and Deployment]]

# Details

## Lifecycle

```text
POST /lobby/create       -> pending join code, no room ID
Colyseus room creation   -> room ID exists
POST /lobby/activate     -> join code linked to room ID
GET /lobby/resolve/:code -> joiner obtains room ID
POST /internal/game-end  -> matching lobby entry removed
```

## Host flow

The Godot `LobbySystem` performs this sequence:

1. Call `POST /lobby/create` with the player's JWT.
2. Receive a pending six-character join code.
3. Ask `NetManager` to create and join a Colyseus `game_room`.
4. Call `POST /lobby/activate` to associate the returned room ID with the code.
5. Show the code to other players.

The API server cannot activate the lobby before the room ID exists, which is why creation and activation are separate operations.

## Join flow

A player can:

- Enter a code, causing the client to call `GET /lobby/resolve/:code` and then join the returned room ID.
- Request `GET /lobby/public`, choose an active entry, and join its room ID.

The API server only resolves the destination. The game server still authenticates the player's JWT and decides whether the player can enter or act in the room.

## `POST /lobby/create`

Requires a player JWT whose `has_host_pass` claim is true. The request body is currently ignored. The service generates a six-character uppercase code and returns:

```json
{ "join_code": "ABC123" }
```

## `POST /lobby/activate`

Requires the host JWT and this body:

```json
{ "join_code": "ABC123", "room_id": "<colyseus-room-id>" }
```

The host must own the pending code. Invalid codes return `404`, another player returns `403`, and an already activated code returns `409`.

## Public lookup routes

- `GET /lobby/resolve/:code` returns `{ "room_id": "..." }` for an activated code. Codes are case-insensitive. Missing or pending codes return `404`.
- `GET /lobby/public` returns active entries with `join_code`, `room_id`, and `created_at`.

There is currently no privacy field, map field, player count, host display name, or nation availability in a public listing. “Public” currently means “every activated in-memory lobby is returned.”

## Limitations

The registry is an in-memory `Map`. It is lost on restart, is not shared between service replicas, has no expiration for abandoned pending lobbies, and uses a non-cryptographic random code generator. A failed host flow can therefore leave a pending code behind until the API process restarts.
