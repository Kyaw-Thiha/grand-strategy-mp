# AGENTS.md

Read `docs/GAME_CONTEXT.md` first for project overview, then the relevant doc below.

## Repo Structure

```
grand-strategy-mp/
├── client/            # Godot 4 project (res:// = client root)
├── game-server/       # Colyseus (Node.js / TypeScript)
├── api-server/        # Hono + Bun (TypeScript)
├── packages/
│   └── shared-types/  # Types shared by game-server and api-server
└── package.json       # pnpm workspaces root
```

## Commands

- `pnpm install` — install all workspaces
- `pnpm --filter <package> <cmd>` — run command in specific workspace

## Architecture Rules (never violate)

1. **GameState is read-only on the client.** Only `NetManager` updates it from server broadcasts. Nothing else mutates it.
2. **All commands go through CommandQueue.** Game logic never calls `NetManager` directly.
3. **UI never writes game state.** UI reads `GameState` and emits signals. Systems submit via `CommandQueue`.
4. **Server resolves all simulation.** Combat, economy, diplomacy — Colyseus only. Client is display only.
5. **Colyseus rooms are ephemeral.** Persist required data to Supabase via Hono before the room is destroyed.
6. **Steam API key never leaves Hono.** It's an environment variable. Never in client code.
7. **Internal routes use INTERNAL_SECRET, not player JWTs.** Separate trust domain. `Authorization: Internal <secret>`.
8. **Cross-module communication uses EventBus.** No direct node references between systems.

## Key Conventions

- **Auth flow:** Steam → Hono → JWT (24h). JWT shape: `{ sub: user_id, steam_id, has_host_pass, exp }`.
- **Steam auth is Phase 7.** Phase 1 uses email auth as placeholder — JWT shape is identical.
- **Do NOT use `getAuthSessionTicket()` for backend auth.** Use `getAuthTicketForWebApi()` with hex encoding.
- **Service `identity` string** in `getAuthTicketForWebApi()` must match the `identity` param used in `AuthenticateUserTicket` on the server.
- **Godot direct-read rule:** Use Supabase anon key + RLS for reading own/public data. Use Hono for writes, auth, and cross-player data.

## Testing

- **Server logic (combat math, economy tick, diplomacy):** Unit tests in TypeScript — feed state in, assert output. No clients, no WebSocket.
- **Multiplayer flows (from Phase 3):** Bot clients — headless Colyseus clients running scripted action sequences. One script per scenario. Run them as regression tests.
- **Single-player Godot:** `Debug → Run Multiple Instances` for ad-hoc smoke testing.

## Authorship

| Directory | Owner |
|---|---|
| `client/` | Godot GDScript |
| `game-server/` | Colyseus TypeScript |
| `api-server/` | Hono + Bun TypeScript |
| `packages/shared-types/` | Shared TypeScript |

## Documentation Map

| When | Read |
|---|---|
| Every session | `docs/GAME_CONTEXT.md` |
| Any infra/auth/architecture work | `docs/ARCHITECTURE.md` |
| Implementing/modifying a module | `docs/MODULES.md` |
| Networking/API/persistence work | `docs/DATA_CONTRACTS.md` |
| Planning or deciding what to build | `docs/DEV_PHASES.md` |