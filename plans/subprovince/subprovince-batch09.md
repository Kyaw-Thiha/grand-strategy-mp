# Batch 9: Frontline Retirement and Final Reconciliation

> **For agentic workers:** Implement this batch independently. This is cleanup and verification,
> not new logic — if you find yourself designing new behavior here, stop and check whether it
> actually belongs in Batch 8 instead. Do not begin this batch until Batch 8's gate is approved;
> its "no old influence-grid behavior remains" acceptance check assumes supply/retreat/encirclement
> are already correct.

**Goal:** Remove the old Dynamic Frontline System (server broadcast, client store, client signal,
and the already-dead overlay renderer) entirely, and reconcile `docs/DEV_PHASES.md`,
`docs/STRATEGIC_COMBAT.md`, and `docs/MAP_DATA_CONTRACT.md` against what actually got built across
Batches 1-8, closing out the migration this whole `plans/subprovince/` series was for.

**Architecture:** Pure removal plus documentation reconciliation — no new systems, no new files
beyond replaced tests.

**Tech Stack:** TypeScript, GDScript, Markdown.

## Reality Check Before Starting

Unlike the old (now-dead) supply geometric code, `frontline_system.ts` is **currently live and
running every tick** (`GameRoom.ts:1643`, `this.frontlineSystem.tick(...)`, called unconditionally
at the site even though the class has its own unused `FRONTLINE_TICK_INTERVAL = 5` constant —
confirmed by this batch's research, worth resolving as "remove entirely" rather than "fix the
gating bug," since the whole file is going away). It broadcasts `FRONTLINE_UPDATED` every tick to
real, currently-connected client state:

- `client/src/core/game_state.gd:26` — live `frontline: Dictionary`, populated by
  `_apply_frontline_updated` (line 162).
- `client/src/core/event_bus.gd:11` — live `signal frontline_updated(province_id, nation_shares)`.
- `client/src/systems/session/session_manager.gd` — the `"FRONTLINE_UPDATED"` dispatch case.
- `client/src/systems/frontline/frontline_overlay.gd` — confirmed already fully dead (its `setup()`
  is entirely commented out except one field assignment, and it is **not instantiated anywhere** —
  no scene or script references it). Removing it is a pure deletion with no wiring to undo.

So this batch removes two different kinds of thing: a live, wired, actively-broadcasting server
system and its live client consumers (real removal work, verify nothing else depends on it first),
plus one already-inert file (trivial deletion).

## Scope

### Included

- Remove `frontline_system.ts`'s server broadcast and its `GameRoom.ts` call site.
- Remove `game_state.gd`'s `frontline` dict, `event_bus.gd`'s `frontline_updated` signal,
  `session_manager.gd`'s dispatch case.
- Remove `frontline_overlay.gd` and its `.uid` sidecar.
- Replace `4e-frontline.e2e.ts` with `lane:subprovince |` coverage confirming frontline behavior is
  gone and subprovince rendering (Batch 6) is the sole source of ownership visualization.
- Documentation reconciliation across `docs/DEV_PHASES.md`, `docs/STRATEGIC_COMBAT.md`,
  `docs/MAP_DATA_CONTRACT.md`, and `plans/subprovince/SUBPROVINCE_PHASES.md`'s own checkboxes.
- Full-suite verification across server, client, and docs.

### Excluded

- Any change to subprovince capture/supply/retreat/encirclement logic itself — Batches 4/5/8 own
  that; this batch only removes what they replaced.
- New gameplay behavior of any kind.

## Task 1: Remove Server-Side Frontline System

**Files:**

- Modify or remove: `game-server/src/systems/frontline_system.ts`
- Modify: `game-server/src/rooms/GameRoom.ts`

**Work:**

1. Before deleting, grep for every reference to `frontlineSystem`/`FrontlineSystem`/
   `FRONTLINE_UPDATED` across `game-server/src/` to confirm the full removal surface — this batch's
   research covered the main call site (`GameRoom.ts:1643`) and the class itself, but re-verify at
   implementation time rather than trusting this list is exhaustive.
2. Remove the `this.frontlineSystem.tick(...)` call from `GameRoom.gameTick()`.
3. Remove `frontlineSystem`'s instantiation and any `loadMapData` call for it in `startGame()`.
4. Decide during implementation whether to delete `frontline_system.ts` outright or leave a
   minimal, clearly-marked stub if some other in-flight branch/test still imports the class name —
   check before assuming a clean delete is safe (per Global Constraint: "Preserve compatibility
   only where an active external consumer requires it" — verify there is or isn't one, don't guess
   either way).
5. Remove any now-orphaned `ProvinceState` fields that existed solely for frontline influence
   display, if any are found — confirm during implementation whether `nation_shares`/influence data
   lives on `ProvinceState` itself or was always frontline-system-internal state before removing
   anything from the schema.

## Task 2: Remove Client-Side Frontline State and Overlay

**Files:**

- Modify: `client/src/core/game_state.gd`
- Modify: `client/src/core/event_bus.gd`
- Modify: `client/src/systems/session/session_manager.gd`
- Remove: `client/src/systems/frontline/frontline_overlay.gd` (and `.uid` sidecar)

**Work:**

1. Remove `game_state.gd`'s `frontline: Dictionary` field and `_apply_frontline_updated` method.
2. Remove `event_bus.gd`'s `frontline_updated` signal.
3. Remove `session_manager.gd`'s `"FRONTLINE_UPDATED"` case from its `match type:` block.
4. Grep the client tree for any other read of `GameState.frontline` or
   `EventBus.frontline_updated` before removing — this batch's research did not exhaustively search
   beyond `game_state.gd`/`event_bus.gd`/`session_manager.gd`/`frontline_overlay.gd`; confirm no
   other UI element (e.g. a debug panel) reads this state before deleting it out from under it.
5. Delete `frontline_overlay.gd` and its `.uid` file — already confirmed unreferenced by any scene
   or script, so this is a clean removal with nothing else to update.

## Task 3: Test Migration

**Files:**

- Replace: `game-server/test/4e-frontline.e2e.ts`

**Work:**

1. Replace with a `lane:subprovince |` vitest test (matching Batch 8's migration of `4c`/`4d`)
   confirming: `FRONTLINE_UPDATED` is never broadcast, `frontlineSystem` no longer exists on
   `GameRoom` (or whatever removal shape Task 1 lands on), and subprovince ownership state
   (`state.subprovinces`, from Batch 4) is the only ownership signal a client receives.
2. If Task 1 preserved a compatibility stub instead of a clean delete, adjust this test's
   assertions to match whatever was actually decided there rather than assuming full removal.

## Task 4: Documentation Reconciliation

**Files:**

- Modify: `docs/DEV_PHASES.md`
- Modify: `docs/STRATEGIC_COMBAT.md`
- Modify: `docs/MAP_DATA_CONTRACT.md`
- Modify: `plans/subprovince/SUBPROVINCE_PHASES.md`

**Work:**

1. Mark `DEV_PHASES.md`'s Phase 4/7/8/9/10/11 checkboxes complete only for items actually verified
   by this batch's and prior batches' automated/manual gates — per `docs/AGENTS.md`'s rule, "mark a
   checkbox complete only after verifying the implementation and the smallest relevant check," not
   by assuming everything in `SUBPROVINCE_PHASES.md` shipped exactly as planned (this project's own
   history this session includes several plan-vs-reality mismatches found along the way — verify
   each claim before marking it done, don't rubber-stamp).
2. Confirm `STRATEGIC_COMBAT.md`'s "Dynamic Frontline System" section (the one HANDOFF.md said was
   "replaced, not deferred") is either removed or clearly marked historical/superseded, not left
   reading as current design alongside the new Subprovince Capture System section.
3. Confirm Batch 8's Task 4 doc correction (Tier 1 `valid_edge`) actually landed before this batch
   started — if not, that's a Batch 8 gate failure to send back, not something to silently patch
   here.
4. Remove or resolve every "(Open — confirm before implementing)" marker in
   `STRATEGIC_COMBAT.md`'s Subprovince Capture System and Supply sections that Batches 4-8 have
   since resolved (recon exclusion: resolved, no exclusion; cascade behavior: resolved, occupied +
   one route preserved; off-road supply: resolved, continuous blend; combat-frozen render state,
   fade duration: confirm these were actually settled during Batch 6/7 implementation, don't assume
   from planning-stage defaults if the implementing agent changed them).
5. Update `MAP_DATA_CONTRACT.md`'s stale "Reference implementation... not yet integrated into
   pipeline.py" line and the zero-padded ID example, if Batch 3's planned Task 6 doc corrections
   didn't already land — verify, don't assume.
6. Preserve unrelated province-level adjacency/capture documentation untouched — this is a scoped
   reconciliation of subprovince-related content only, per Global Constraints and `docs/AGENTS.md`.

**Verification:**

```bash
python3 scripts/check-docs.py
```

## Task 5: Final Integration Verification

**Work:**

1. Run a complete capture scenario end-to-end: movement → capture → supply route update → retreat
   under Tier 2 → encirclement under Tier 3 → destruction, confirming every batch's piece still
   works together, not just in isolation.
2. Toggle visibility (fog) and inspect ownership parity between what belligerents and neutrals see,
   per Batch 4/5's filtering rules.
3. Confirm 2D map readability at all zoom levels with the full stack active (Batch 6 fills, Batch 7
   route lines, no frontline remnants).
4. Confirm no old influence-grid behavior remains anywhere — server broadcasts, client state,
   rendered visuals.

**Automated verification:**

```bash
cd game-server && npm test
cd game-server && npm run build
cd game-server && npm run test:full
```

```bash
python3 scripts/check-docs.py
```

```bash
godot --headless --path client client/test/test_subprovince_renderer.tscn
godot --headless --path client client/test/test_supply_line_overlay.tscn
```

## Manual Verification Gate

This is the final gate for the whole `plans/subprovince/` series. Confirm every item in
`SUBPROVINCE_PHASES.md`'s "Final Acceptance" list against the real, current implementation — not
against what any individual batch plan assumed would happen — before considering the subprovince
migration complete:

- Subprovince boundaries visibly follow cover/elevation raster detail without gaps or overlaps.
- Capital, town, road, and hinterland metadata is correct.
- Literal occupancy flips cells; capital cells only flip via city/province capture.
- Sticky ownership and complete revert behavior work.
- Combat-frozen cells show contested tint without authoritative ownership changing.
- City cascade preserves occupied former-defender cells and one valid supply route.
- Roads are preferred and off-road supply is slower, not disqualifying.
- Enemy-owned occupied cells supply only their occupying unit.
- Selected own routes remain visible through fog; foreign routes disappear when hidden.
- Multiple selected routes remain readable.
- Province borders remain stronger than subprovince borders.
- Supply, retreat, and encirclement use the same graph.
- Old frontline influence behavior is absent — server, client, and rendered.
- 2D remains the default and retains information parity with all new overlays.

Once approved, the `plans/subprovince/` series is complete.
