# AGENTS.md

Read `docs/GAME_CONTEXT.md` first in every session. Then load only the docs relevant to the work.

This file is the repo operating guide for AI agents. Prefer current code and local docs over assumptions from older phase notes.

## Repo Structure

```
grand-strategy-mp/
├── client/        # Godot 4 project (res:// = client root)
├── game-server/   # Colyseus authoritative simulation server (Node.js / TypeScript)
├── api-server/    # Hono API server on Bun (auth, persistence, lobby/internal APIs)
├── map/           # Map data and Python map-generation pipeline
├── docs/          # Architecture, contracts, systems, testing, and design docs
├── plans/         # One stored plan per task
└── scripts/       # E2E scripts and R2 asset sync helpers
```

There is currently no root workspace `package.json` and no `packages/shared-types/` directory. Install and run API/game-server dependencies from their own folders.

## Workflow

1. **Plan first.** Propose a plan, discuss, and refine until agreed.
2. **Store the plan.** Save it as `plans/*.md` before implementation.
3. **Execute phase-by-phase.** Work through the stored plan in order. These are task phases, not necessarily `docs/DEV_PHASES.md` phases.
4. **Keep changes scoped.** Do not clean up unrelated files or revert user changes.

## Current State

- Development auth is email/password through Hono; Steam auth is still later work.
- Phases 1-5 are substantially complete. Phase 6 tactical grid work is active. Phase 12 air-combat scaffolding/work has started in code and plans.
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
- `cd game-server && npm run test:full` — all test files (takes ~9 min)
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
|---|---|
| Client display/input/UI | `client/src/`, `client/scenes/` |
| Server simulation/rooms/schema | `game-server/src/` |
| API/auth/persistence/lobby/internal routes | `api-server/src/` |
| Map source data and generation | `map/`, `map/tools/map_pipeline/` |
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

## Documentation Map

| When | Read |
|---|---|
| Every session | `docs/GAME_CONTEXT.md` |
| Infra/auth/folder structure/architecture rules | `docs/ARCHITECTURE.md` |
| Implementing or modifying a module | `docs/MODULES.md` |
| Networking/API/persistence/schema work | `docs/DATA_CONTRACTS.md` |
| Planning what to build next | `docs/DEV_PHASES.md` |
| Local two-instance testing | `docs/LOCAL_TESTING.md` |
| Tactical combat/grid work | `docs/TACTICAL_COMBAT.md` |
| Air combat work | `docs/AIR_COMBAT.md` |
| Map generation/rendering work | `docs/MAP_DATA_CONTRACT.md`, `docs/MAP_PRODUCTION_DOCS.md`, `docs/EDITOR_MAP_GENERATION.md` |
| Pathfinding/movement work | `docs/PATHFINDING.md` |
| UI/UX work | `docs/UI_UX_DESIGN.md`, `docs/PANEL_WIREFRAME_BRIEF.md` |
| Economy/resource work | `docs/ECONOMY_BUILDINGS.md`, `docs/RESOURCE_ECONOMY.md` |
| Naval combat work | `docs/NAVAL_COMBAT.md` |

## Verification Expectations

Before marking a task complete:

- Run the smallest relevant automated checks for the files changed.
- For server simulation changes, run `cd game-server && npm test` (auto-detects which lane to run based on your diff). Run `cd game-server && npm run test:full` before merging to main.
- Adding a new server test file? Add it to the relevant lane in `game-server/test-lanes.json` and prefix its top-level `describe()` with `lane:<name> | `.
- For API changes, run `cd api-server && bun test <relevant test file>` and consider adding a package script if the test surface grows.
- For full flow changes, run the relevant `scripts/e2e-*.sh` script.
- For Godot UI/client changes, run targeted headless scene tests when available and describe manual checks for visual/interaction behavior.
- If a required check cannot be run, state why and name the exact command that should be run later.
