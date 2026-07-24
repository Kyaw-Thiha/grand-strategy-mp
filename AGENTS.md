# AGENTS.md

This file is the repository operating guide for AI agents. Prefer current code and the canonical wiki over assumptions from historical material.

## Documentation Is Part of Every Completed Change

Read and follow [`wiki/AGENTS.md`](wiki/AGENTS.md) before creating or changing documentation. It defines the wiki's ownership, note format, linking rules, and approval boundary.

After completing a change to source, schemas, configuration, tests, scripts, or assets, use [`skills/ingest/SKILL.md`](skills/ingest/SKILL.md). The skill updates the affected wiki notes and links after the final implementation is complete. Do not update `old-docs/`; it is historical reference material that will be removed after the refactor and documentation migration are complete.

Write wiki notes for the game developer and product designer first: explain what a system does for the game or player in plain language before its ownership, authority, or implementation details.

## Repo Structure

```text
grand-strategy-mp/
├── client/        # Godot 4 project (res:// = client root)
├── game-server/   # Colyseus authoritative simulation server (Node.js / TypeScript)
├── api-server/    # Hono API server on Bun (auth, persistence, lobby/internal APIs)
├── map/           # Map data and Python map-generation pipeline
├── wiki/          # Canonical developer wiki, viewed through Obsidian
├── skills/        # Repository-local agent skills
├── old-docs/      # Historical reference only; do not update
├── plans/         # One stored plan per task
└── scripts/       # E2E scripts and R2 asset sync helpers
```

The wiki's `.obsidian/` directory is local reader state and is ignored. Do not add Obsidian workspace settings, application settings, or themes to the repository.

There is currently no root workspace `package.json` and no `packages/shared-types/` directory. Install and run API/game-server dependencies from their own folders.

## Workflow

1. **Plan first.** Propose a plan, discuss, and refine until agreed.
2. **Store the plan.** Save it as `plans/*.md` before implementation.
3. **Execute phase-by-phase.** Work through the stored plan in order. These are task phases, not necessarily development-roadmap phases.
4. **Ingest documentation at completion.** After final code, tests, configuration, scripts, schemas, or assets are in place, follow `skills/ingest/SKILL.md` once for the completed task.
5. **Keep changes scoped.** Do not clean up unrelated files or revert user changes.

## Current State

- The full codebase refactor and documentation migration are active work. The wiki replaces the legacy documentation gradually; current code remains authoritative while the migration is incomplete.
- Development auth is email/password through Hono; Steam auth is later work.
- Phases 1–5 are substantially complete. Phase 6 tactical grid work is active. Phase 12 air-combat scaffolding/work has started in code and plans.
- The client has many Godot scene/script tests under `client/test/`, `client/tests/`, and `client/scenes/test/`.
- `npm test` in `game-server/` auto-detects changed files via git diff and runs only the affected test lanes (air-combat, tactical, movement, or core). Use `npm run test:full` to run all tests unconditionally. See `game-server/test-lanes.json` for lane mappings.

## Commands

### First-Time Setup

- `cd api-server && bun install`
- `cd game-server && npm install`
- `cp api-server/.env.example api-server/.env`
- `cp game-server/.env.example game-server/.env`
- `cp scripts/r2/.env.example scripts/r2/.env`
- `./scripts/r2/download.sh` — download large map/client asset data from Cloudflare R2

`JWT_SECRET` and `INTERNAL_SECRET` must match between `api-server/.env` and `game-server/.env`.

### Run Locally

- `cd api-server && bun run dev` — API server at `http://localhost:3000`
- `cd game-server && npm start` — Colyseus at `ws://localhost:2567`
- Open `client/` in Godot 4 and press Play. Debug builds use localhost endpoints from `client/src/core/config.gd`.

### Tests and Checks

- `cd game-server && npm test` — auto-detects affected lanes from git diff
- `cd game-server && npm run test:full` — all test files in parallel (~5 min, ~446 passing)
- `cd game-server && npm run test:air` — air combat tests only
- `cd game-server && npm run test:tactical` — tactical combat tests only
- `cd game-server && npm run test:movement` — movement tests only
- `cd game-server && npm run test:core` — GameRoom/core tests only
- `cd game-server && npm run build` — TypeScript build/type check for server source
- `cd api-server && bun test src/routes/auth.test.ts` — API auth/profile route tests
- `bash scripts/e2e-auth-handshake.sh` — starts both servers and runs the Godot auth handshake scene
- `bash scripts/e2e-session-loop.sh` — starts both servers and runs the Colyseus session-loop bot
- `godot --headless --path client <scene.tscn>` — targeted Godot scene test, for example `test/auth_handshake_test.tscn`

For UI work, also describe the manual visual checks performed or needed. There is no broad visual regression suite.

## Architecture Rules (Never Violate)

1. **GameState is read-only on the client.** Only `NetManager` updates it from server broadcasts.
2. **All commands go through `CommandQueue`.** Game logic never calls `NetManager` directly.
3. **UI never writes game state.** UI reads `GameState` and emits intent signals. Systems submit commands through `CommandQueue`.
4. **Server resolves all simulation.** Combat, economy, diplomacy, supply, and movement authority live in Colyseus. The client displays and predicts only where explicitly designed.
5. **Colyseus rooms are ephemeral.** Persist required data to Supabase via Hono before a room is destroyed.
6. **Steam API key never leaves Hono.** It is an environment variable and must never appear in client code.
7. **Internal routes use `INTERNAL_SECRET`, not player JWTs.** Use `Authorization: Internal <secret>`.
8. **Cross-module communication uses `EventBus`.** No direct node references between systems. Autoloads may be called directly by name.

## Client Autoloads

Registered in `client/project.godot`:

- `Config` — endpoint/config constants
- `MsgPack` — Colyseus protocol encoding/decoding
- `APIClient` — Hono HTTP client
- `AuthManager` — local auth/JWT state
- `NetManager` — Colyseus connection and server message routing
- `Supabase` — Supabase addon autoload
- `EventBus` — cross-module signals
- `GameState` — read-only client mirror of server state
- `CommandQueue` — single conduit for outgoing player commands
- `SessionManager` — session lifecycle transitions
- `LobbySystem` — create/join/activate lobby flow
- `DiplomacySystem` — diplomacy-facing client system
- `SceneManager` — scene transitions/loading
- `KeybindManager` — keybind presets/remapping/persistence
- `DivisionTemplateStore` — division-template client state/cache

## Subsystem Ownership

| Area | Source of truth |
| --- | --- |
| Client display/input/UI | `client/src/`, `client/scenes/` |
| Server simulation/rooms/schema | `game-server/src/` |
| API/auth/persistence/lobby/internal routes | `api-server/src/` |
| Map source data and generation | `map/`, `map/tools/map_pipeline/` |
| Canonical developer documentation | `wiki/` |
| Historical documentation | `old-docs/` (reference only) |
| Repository-local agent skills | `skills/` |
| Task plans | `plans/` |
| Local/E2E helpers | `scripts/` |

## Key Conventions

- Auth flow now: email dev auth -> Hono -> JWT -> Colyseus/Supabase-facing flows. Steam auth later keeps the JWT shape compatible.
- Intended Steam flow later: GodotSteam `getAuthTicketForWebApi()` -> Hono `/auth/steam` -> Steam `AuthenticateUserTicket` -> JWT.
- Do **not** use `getAuthSessionTicket()` for backend auth. Use `getAuthTicketForWebApi()` with hex encoding.
- The Steam `service_identity` passed by the client must match the server `identity` param when Steam auth is implemented.
- Godot direct-read rule: use Supabase anon key + RLS for safe own/public reads. Use Hono for writes, auth, validation, and cross-player data.
- Colyseus 0.17 client protocol details matter in Godot: preserve the matchmake path/process id handling and join-room ACK behavior in `NetManager`.

## Code Style

- Prefer descriptive names over abbreviations.
- Extract functions only for meaningful reusable behavior, not just to shrink line count.
- Document nontrivial functions with full doc comments: purpose, parameters, return value, and examples when helpful.
- Use short tactical inline comments to orient complex logic.
- GDScript must use strict type annotations: `var name: Type` and `func f() -> Type`. Avoid `:=` where a call may return `Variant`, such as `Dictionary.get()`, `get_node()`, or `JSON.parse_string()`.
- Keep generated/imported Godot `.uid` and `.import` files consistent when adding scenes/assets through Godot.

## Verification Expectations

Before marking a task complete:

- Run the smallest relevant automated checks for the files changed.
- For server simulation changes, run `cd game-server && npm test` (auto-detects which lane to run based on your diff). Run `cd game-server && npm run test:full` before merging to main.
- Adding a new server test file? Import `getTestPort` from `./helpers.js`, pass it to `boot(appConfig, getTestPort())`, add it to the relevant lane in `game-server/test-lanes.json`, and prefix its top-level `describe()` with `lane:<name> | `.
- For API changes, run `cd api-server && bun test <relevant test file>` and consider adding a package script if the test surface grows.
- For full flow changes, run the relevant `scripts/e2e-*.sh` script.
- For Godot UI/client changes, run targeted headless scene tests when available and describe manual checks for visual/interaction behavior.
- If a required check cannot be run, state why and name the exact command that should be run later.
