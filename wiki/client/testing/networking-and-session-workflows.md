# Networking and Session Workflows

These workflows check that a development player can authenticate, enter a room, and complete the server-side lobby-to-match loop before networking changes are accepted.

# Details

## Godot authentication handshake

`client/test/auth_handshake_test.tscn` runs `client/test/auth_handshake_test.gd`. The scene calls `AuthManager.login()`, waits for `logged_in`, then calls the legacy `NetManager.connect_to_room()` entry point and passes when `room_joined` fires.

With compatible API and game servers already running, execute:

```bash
godot --headless --path client test/auth_handshake_test.tscn
```

The scene verifies the Godot client’s email login, JWT handoff, Colyseus matchmaking, WebSocket reservation, and join acknowledgement. Despite its source comment, it does not inspect `GameState` or assert that a player appears in a lobby snapshot.

## Repository E2E wrappers

From the repository root, the supported authentication wrapper is:

```bash
bash scripts/e2e-auth-handshake.sh
```

`scripts/e2e-auth-handshake.sh` starts the Hono and Colyseus servers, waits for their local ports, runs the Godot scene above, and stops the processes. `JWT_SECRET` must be compatible between the two server environments.

The full server-side session loop is:

```bash
bash scripts/e2e-session-loop.sh
```

This wrapper starts the API server with `DEV_MODE=true`, starts the game server, and runs `game-server/test/session-loop.e2e.ts`. Two TypeScript Colyseus clients create and activate a lobby, resolve and join it, select nations, ready up, start and end the game, receive `GAME_STARTED` and `GAME_ENDED`, and verify that the ended lobby is removed from the public list.

The session-loop script validates the API/game-server contracts but does not exercise the Godot `LobbySystem`, `SessionManager`, scene transitions, or cleanup code.

## Current coverage gaps

There is no dedicated automated Godot test for:

- the Colyseus 0.17 `processId` URL branch;
- a missing join acknowledgement or malformed room packet;
- matchmaking, activation, timeout, or unexpected-disconnect UI behavior;
- reconnection or complete `GameState` cleanup;
- the `SessionManager` message-routing table;
- delivery of the game result to the postgame scene.

For documentation-only edits, verify the commands and source paths without running these broad integration workflows. Networking code changes should select the smallest applicable workflow and add focused coverage for the changed failure or lifecycle behavior.

# Related Notes

- [[client/testing/index|Client Testing]]
- [[client/networking/index|Client Networking]]
- [[client/session/networked-lobby-and-match-lifecycle|Networked Lobby and Match Lifecycle]]
- [[client/auth/login-and-session|Login and Session Identity]]
- [[game-server/testing-and-operations|Testing and Operations]]
