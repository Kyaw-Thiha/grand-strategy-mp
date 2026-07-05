# Update AGENTS.md

## Summary

Refresh `AGENTS.md` so it matches the current repo instead of the older pnpm/workspace assumptions. Keep it as the short, authoritative agent entrypoint, with links to deeper docs rather than duplicating every design doc.

## Key Changes

- Replace stale repo structure with the actual top-level layout: `client/`, `game-server/`, `api-server/`, `map/`, `docs/`, `plans/`, `scripts/`; remove the nonexistent root `package.json`/`packages/shared-types` workspace claim.
- Update commands:
  - API: `cd api-server && bun install`, `bun run dev`, `bun test src/routes/auth.test.ts`.
  - Game server: `cd game-server && npm install`, `npm start`, `npm test`, `npm run build`.
  - E2E: `bash scripts/e2e-auth-handshake.sh`, `bash scripts/e2e-session-loop.sh`.
  - Godot: `godot --headless --path client <test-scene>` for targeted scene tests.
  - Map assets: `./scripts/r2/download.sh`.
- Preserve the core architecture rules, but align them with current autoloads and implementation: `Config`, `MsgPack`, `APIClient`, `AuthManager`, `NetManager`, `Supabase`, `EventBus`, `GameState`, `CommandQueue`, `SessionManager`, `LobbySystem`, `DiplomacySystem`, `SceneManager`, `KeybindManager`, `DivisionTemplateStore`.
- Update current-state notes:
  - Email auth is implemented for development; Steam auth remains later.
  - Phases 1-5 are substantially complete; Phase 6 tactical grid is active; Phase 12 air-combat work has started in code/plans.
  - `game-server/npm test` currently runs a focused subset, while many additional test files exist and should be run directly when touching their area.
- Add subsystem guidance:
  - Client is Godot/GDScript display and input orchestration.
  - Colyseus is authoritative simulation.
  - Hono/Bun owns auth, persistence writes, lobby APIs, and internal routes.
  - `map/tools/map_pipeline/` owns generated map data; large assets come from R2.
- Add verification guidance by change type instead of one stale global `npm test && npm run typecheck` rule.

## Test Plan

- After editing, run no code test unless desired; this is documentation-only.
- Verify the new `AGENTS.md` references only paths and commands that exist.
- Check `git diff -- AGENTS.md plans/update-agents-md.md` for accidental unrelated edits.

## Assumptions

- Replace `AGENTS.md` content in place rather than appending a changelog.
- Do not update deeper docs in this task, even where they also contain stale workspace wording.
- Keep the project's "plan first, store plan, execute phase-by-phase" workflow.
