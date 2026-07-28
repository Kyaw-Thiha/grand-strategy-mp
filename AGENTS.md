# AGENTS.md

This is the repository operating guide for AI coding agents. Keep work scoped, preserve
unrelated user changes, and use the documentation hierarchy below instead of assumptions.

## Documentation Authority and Context

`wiki/` is the repository's single documentation tree:

- `wiki/docs/` is the source of truth for intended behavior, implementation requirements,
  roadmap state, and completion checkboxes.
- Component notes elsewhere in `wiki/` summarize the current implementation for fast LLM
  context and link to the source files that own it.
- Temporary implementation plans are colocated with the component notes they affect and
  named `<task>-plan.md`. Completed plans are reconciled into durable documentation and
  deleted, not archived.

When sources disagree, follow `wiki/docs/`. Treat contradicting implementation as a defect
or an explicit unresolved mismatch; do not rewrite a confirmed design merely to match drift.
Current code must still be inspected to determine what is actually implemented and what
remains incomplete.

Load context economically:

1. If the user names a document or asks for a designed feature, read the relevant
   `wiki/docs/` source first.
2. Otherwise start at `wiki/index.md`, then read the relevant component index and only the
   likely affected notes.
3. Follow Related Notes only when the work crosses that boundary.
4. Verify implementation-sensitive claims against current source before relying on them.
5. Do not preload the full wiki or unrelated design documents and plans.

Read and follow `wiki/AGENTS.md` whenever working on documentation. More specific agent
files within the relevant wiki component apply to that area.

## Workflow

1. Propose and agree on a plan before implementation.
2. Save the agreed plan as `<task>-plan.md` in the narrowest wiki component that owns the
   work, and add it to that component's `index.md` while active.
3. Execute it phase by phase and run the smallest relevant verification.
4. Reconcile affected component notes and authoritative source checkboxes after the final
   implementation. Correct any material, confidently verified mismatch discovered during
   the task unless the user explicitly requested read-only work.
5. Delete the completed plan and remove its index entry after its durable information has
   been incorporated.

Do not edit an accurate note merely to record that it was reviewed. Reconcile once against
the final verified state rather than after every intermediate edit.

## Repository Map

```text
client/        Godot 4 client and UI
game-server/   Colyseus authoritative simulation server
api-server/    Hono/Bun auth, persistence, lobby, and internal API
map/           Map source data and generation pipeline
wiki/          Documentation, authoritative designs, and temporary plans
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
- Documentation: `python3 scripts/check-wiki.py`.

New game-server tests must use `getTestPort`, belong to a lane in
`game-server/test-lanes.json`, and prefix their top-level `describe()` with
`lane:<name> | `. For UI work, report targeted headless checks and the manual visual checks
performed or still required. If a required check cannot run, name the exact command to run
later.
