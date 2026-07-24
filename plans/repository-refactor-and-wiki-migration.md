# Repository Refactor and Wiki Migration

## Goal

Bring the repository's implemented components and active architecture into a maintainable shape, migrate current developer knowledge from `old-docs/` into the canonical `wiki/`, and leave a durable workflow that keeps documentation accurate as code changes.

Current code is authoritative. `plans/` remains a record of implementation work and is not part of the wiki migration. `old-docs/` is read-only historical input during migration and will be removed only after every note has been classified and any still-current content has been migrated or deliberately retired.

## Scope and Boundaries

- **Client** owns Godot runtime presentation, input, UI, and client-side systems.
- **Map** is a separate component: it owns source datasets and generation tools. The client owns consumption, rendering, and interaction with generated map data.
- **Cross-component** work describes or refactors flows crossing ownership boundaries, such as client commands to the game server, game-server persistence through the API server, or generated map data consumed by runtime systems.
- Refactoring is in scope where current code, boundaries, duplication, safety, or maintainability justify it. For every candidate, first explain the problem, proposed modification, affected ownership or contracts, expected benefit, and verification plan to the user. Implement only after the user confirms. Do not propose a refactor merely to create activity.
- Obsidian state (`wiki/.obsidian/`) is local-only and must remain ignored.

## Checklist

### 0. Migration Foundation

- [x] Establish `wiki/` as the canonical developer documentation location.
- [x] Move legacy `docs/` material to read-only `old-docs/`.
- [x] Add repository and wiki documentation policies plus the post-change ingestion skill.
- [x] Document the API server's current implementation and record its refactor backlog.
- [x] Complete the initial game-server wiki ingestion in the working tree.
- [ ] Commit the staged game-server wiki ingestion after final review.
- [x] Ignore and untrack all `wiki/.obsidian/` reader state.

### 1. Game Server Review and Refactor

- [x] Review game-server ownership, room lifecycle, state schema, commands, simulation systems, and test lanes against current code.
- [x] Assess server refactor opportunities; no worthwhile modification is currently identified.
- [x] Create and link the focused game-server wiki notes; the completed ingestion is staged for commit.

### 2. Client Review, Refactor, and Documentation

- [x] Map client autoload ownership, scene composition, networking, and read-only game-state boundaries.
- [x] Document core/runtime systems: auth, configuration, networking, commands, sessions, and events.
- [x] Document gameplay/display systems: map, camera/input, military, diplomacy, research, air, vision, and UI.
- [x] Review client tests and debugging scenes; document the supported verification workflow.
- [x] Explain each worthwhile client refactor proposal and wait for user confirmation before implementation.
- [ ] Implement only user-approved client refactors and ingest the affected notes.

### 3. Map Pipeline Review, Refactor, and Documentation

- [ ] Document map source datasets, generated artifacts, and the map-generation pipeline.
- [ ] Document the generated-data contracts consumed by the client and game server.
- [ ] Review map tooling and generated-asset ownership for worthwhile refactor proposals.
- [ ] Explain proposed map refactors and implement only those approved by the user, then ingest the affected notes.

### 4. Cross-Component Architecture and Operations

- [ ] Create current architecture notes for ownership boundaries and service responsibilities.
- [ ] Document auth, lobby, session, command, replicated-state, and persistence flows across client, game server, and API server.
- [ ] Document environment configuration, secrets boundaries, local startup, and E2E workflows.
- [ ] Reconcile and document test strategy: client scenes, API tests, server lanes, and E2E checks.
- [ ] Explain proposed cross-component contract refactors, including owners and migration path, and implement only those approved by the user.

### 5. Legacy Documentation Migration and Retirement

- [ ] Create a per-note migration inventory for all `old-docs/` material.
- [ ] Classify every legacy note as migrated, partially migrated, superseded, or historical-only.
- [ ] Migrate still-current technical and design content into scoped responsibility-first wiki notes.
- [ ] Clearly label planned/deferred systems, including tactical combat, air combat, economy, naval, research, supply, and persistence.
- [ ] Repair wiki indexes and incoming/outgoing links for every moved, split, or retired note.
- [ ] Remove `old-docs/` only after the inventory is complete and the migrated wiki is reviewed.

### 6. Completion Gate

- [ ] Verify all wiki links and direct-child indexes.
- [ ] Verify documentation claims against current code and supported commands.
- [ ] Run the smallest relevant checks for each user-approved implemented refactor.
- [ ] Review the migration inventory and remaining approved deferrals.
- [ ] Remove obsolete legacy documentation and complete the final ingestion report.

## Execution Order

Work in focused component batches: game server, client, map, then cross-component architecture. Each batch may contain multiple coherent implementation tasks, but every completed source/configuration/schema/test/asset change must run the wiki ingestion workflow once after verification. Legacy-note classification can proceed alongside the matching component batch; deletion waits until the final completion gate.
