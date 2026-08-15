# AGENTS.md

This is the repository operating guide for AI coding agents. Keep work scoped and preserve
unrelated user changes.

## Maintained Documentation

`docs/` contains authoritative game designs, implementation requirements, roadmap state,
and completion tracking. Before implementing a documented feature, read only the relevant
sources and follow `docs/AGENTS.md`.

Update maintained documentation when a user decision changes the intended design or verified
implementation completes or contradicts a documented requirement. Keep reconciliation scoped;
do not skim or rewrite unrelated documents. `wiki/` is a legacy Obsidian archive and is not a
source of truth. Only modify it when the user explicitly requests archive work.

## Workflow

1. Propose and agree on a plan before implementation.
2. Execute it phase by phase and run the smallest relevant verification.
3. Reconcile only the relevant maintained documents after implementation and verification.

## Repository Map

```text
client/        Godot 4 client and UI
game-server/   Colyseus authoritative simulation server
api-server/    Hono/Bun auth, persistence, lobby, and internal API
map/           Map source data and generation pipeline
docs/          Maintained design and technical documentation
wiki/          Legacy Obsidian archive
scripts/       E2E, asset-sync, and repository helpers
```

There is no root workspace `package.json`. Install and run API and game-server dependencies
from their own folders.

## Architecture Rules

1. `GameState` is read-only on the client. Only `NetManager` may update it from server
   broadcasts; current exceptions are architectural debt, not a pattern to extend.
2. Gameplay commands go through `CommandQueue`; gameplay code does not call `NetManager`
   directly.
3. UI reads state and emits intent. It never writes gameplay state.
4. Colyseus resolves simulation authority for combat, economy, diplomacy, supply, and
   movement.
5. Persist required room data through Hono before ephemeral Colyseus rooms are destroyed.
6. Steam secrets never enter client code.
7. Internal routes use `Authorization: Internal <INTERNAL_SECRET>`, not player JWTs.
8. Cross-module communication uses `EventBus`; autoloads may be called directly by name.

## Code Conventions

- Prefer descriptive names and meaningful reusable functions.
- Add full doc comments to nontrivial functions.
- GDScript uses strict type annotations. Avoid `:=` when a call may return `Variant`, such
  as `Dictionary.get()`, `get_node()`, or `JSON.parse_string()`.
- Keep generated/imported Godot `.uid` and `.import` files consistent with added assets.
- Do not change `.obsidian/` reader state.

## Verification

- Game server: `cd game-server && npm test`; use `npm run test:full` before merging.
- Game-server build/type check: `cd game-server && npm run build`.
- API routes: `cd api-server && bun test <relevant-test-file>`.
- Godot: `godot --headless --path client <scene.tscn>`.
- Auth/session flows: `bash scripts/e2e-auth-handshake.sh` or
  `bash scripts/e2e-session-loop.sh`.
- Documentation: `python3 scripts/check-docs.py`.

New game-server tests must use `getTestPort`, belong to a lane in
`game-server/test-lanes.json`, and prefix their top-level `describe()` with
`lane:<name> | `. For UI work, report targeted headless checks and the manual visual checks
performed or still required. If a required check cannot run, name the exact command to run
later.
