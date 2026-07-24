# Client Networking Review and Documentation

## Goal

Help a game developer understand how the Godot client joins a multiplayer room, sends player actions, receives game updates, handles current networking failures, and moves through networking-facing session transitions.

Current code is authoritative. This is a documentation-only task: application code, `old-docs/`, and `wiki/.obsidian/` are out of scope.

## Checklist

- [x] Replace the placeholder networking index with focused notes for connections, commands/state/events, and failures/cleanup.
- [x] Add a focused note for the networking-facing lobby and match lifecycle.
- [x] Add a focused networking and session test-workflow note.
- [x] Give each ordinary note at least one short, verified example under `# Details`.
- [x] Split and retire the superseded flat networking/session notes.
- [x] Repair affected direct-child indexes and incoming/outgoing links.
- [x] Record worthwhile refactor candidates without changing application code.
- [x] Verify paths, symbols, payloads, protocol details, Markdown structure, wiki links, and direct-child indexes.
- [x] Run the documentation-ingestion workflow once against the final documentation diff.
- [x] Run `git diff --check` and confirm protected paths remain unchanged.
- [x] Mark only the Phase 2 Networking checklist item complete in the repository migration plan.

## Documentation Structure

### Networking

- `wiki/client/networking/connection-and-room-transport.md`
  - API requests versus live Colyseus room traffic.
  - JWT handoff, matchmaking, WebSocket reservation, `processId`, join acknowledgement, `MsgPack`, packet sizing, and autoload registration.
- `wiki/client/networking/commands-state-and-events.md`
  - `CommandQueue`, outgoing packets, incoming named messages, `GameState`, `SessionManager`, `EventBus`, and server authority.
  - Identify the current `SessionManager` state-write path as architectural debt against the required `NetManager`-only write gate.
- `wiki/client/networking/failures-and-cleanup.md`
  - HTTP, matchmaking, room, disconnection, and cleanup behavior.
  - Document the absence of timeouts, retries, reconnects, token refresh, and complete state reset.

### Sessions and Testing

- `wiki/client/session/networked-lobby-and-match-lifecycle.md`
  - Lobby reservation, room creation/activation, join-code/public joins, lobby commands, loading handshake, match start/end, and scene transitions.
- `wiki/client/testing/networking-and-session-workflows.md`
  - Godot authentication handshake and the two repository E2E scripts, including prerequisites, coverage, and gaps.

## Refactor Review

Report these candidates for separate approval; do not implement them:

1. Restore the required `NetManager`-only `GameState` write gate.
2. Add explicit connecting/connected states, handshake timeouts, request-start checks, and useful Colyseus error decoding.
3. Normalize `APIClient` failures and require successful lobby activation before reporting lobby creation.
4. Define coherent unexpected-disconnect, state-reset, logout, and reconnect behavior.
5. Preserve the `GAME_ENDED` result across the postgame scene transition.

For each candidate, report the problem, affected systems, proposed modification, ownership impact, benefit, risks, migration concerns, and verification plan.

## Verification

- Compare every excerpt, path, autoload, symbol, command, payload field, and protocol detail with current source.
- Ensure code, commands, payloads, and file/symbol references appear only under `# Details`.
- Validate affected Obsidian links and direct-child indexes.
- Inspect the final diff for accidental edits to unrelated work, `old-docs/`, or `wiki/.obsidian/`.
- Run `git diff --check`.
- Do not run Godot or E2E tests for documentation-only edits; verify and document their real commands instead.

## Completion Boundaries

- Complete the Phase 2 Networking checklist item.
- Leave the broader Sessions, Testing, flat-note migration, and cross-component architecture checklist items open.
- Request approval before making any newly discovered architecture-wide or policy-level wiki change.
