# Batch 8: Supply, Retreat, and Encirclement Migration

> **For agentic workers:** Implement this batch independently and stop at the manual verification
> gate. This is a migration, not new-system-alongside-old — the old geometric
> `_corridorOpen`/`_isEncircled` code and the old waypoint-nearest retreat targeting must actually
> be **removed**, not left dead next to new code, once the new graph-based logic replaces them.
> Batches 1-6 are implemented and confirmed matching their plans closely; this batch's research was
> done against the real current code, not against earlier speculative plans — file/line references
> below are live, not projected.

**Goal:** Replace the disabled geometric supply-status/encirclement checks with the ring-based BFS
checks from `STRATEGIC_COMBAT.md`'s three-tier system, replace waypoint-nearest retreat targeting
with subprovince-graph retreat pathing (friendly cheap, contested medium, enemy/neutral
expensive-but-traversable under the Tier 2 fighting-withdrawal rule), and remove the now-dead old
code paths — while leaving ordinary unit movement's waypoint pathing completely untouched.

**Architecture:** `supply_graph.ts` (Batch 5, unchanged) stays the pure Dijkstra route-query
module. This batch adds ring-based BFS tier detection and a separate retreat-cost Dijkstra
variant — different edge-validity rules from supply's `findSupplyRoute`, so they're new functions,
not a reuse of it with different flags. Tier computation replaces the body of `supply_system.ts`'s
already-dead `tick()` (currently short-circuited with a `DISABLED` comment, real logic below it
unreachable) rather than adding a third method alongside the Batch 5 `computeSubprovinceRoutes` —
`GameRoom.ts` already calls `tick()` every tick (line 1620) and discards its empty result, so
re-enabling it in place needs no new `GameRoom.ts` call site, only removing the early return and
swapping the old geometric triggers for the new graph queries. Retreat pathing decides *where* and
*how costly* a retreat is via the subprovince graph, then hands off to the existing waypoint-based
`move_order` movement execution by targeting the waypoint nearest the retreat path's destination —
`movement_system.ts`'s actual per-tick movement loop is untouched; only what gets pushed onto
`move_order` during a retreat changes.

**Tech Stack:** TypeScript, Colyseus.

## Scope

### Included

- Ring-based BFS `ring(n)` helper and the three-tier trigger logic (Tier 1 Out of Supply, Tier 2
  Cut Off, Tier 3 Encircled), replacing `supply_system.ts`'s dead `_corridorOpen`/`_isEncircled`.
- Removing the dead code once replaced: `_corridorOpen`, `_isEncircled`, their constants
  (`CORRIDOR_STEP_KM`, `CORRIDOR_MAX_STEPS`, `ENCIRCLE_SAMPLE_MULT`, `ENCIRCLE_DIRS`,
  `ENCIRCLE_BLOCKED_THRESHOLD`), and the `DISABLED` early return.
- Reusing the existing (currently-unreachable-but-correct) `_computeStatus`/`TIER_ORDER`
  one-tier-at-a-time cascading logic — only its *trigger conditions* change, not its structure.
- Subprovince-graph retreat-cost Dijkstra, cost-weighted by ownership per
  `STRATEGIC_COMBAT.md`'s retreat-pathing paragraph.
- Fighting-withdrawal HP damage on Tier-2 retreat, proportional to blocked-hop fraction of the
  chosen retreat path.
- Replacing `combat_system.ts:1414-1420`'s `getNearestNonNeutralWaypoint`-based retreat targeting.
- Correcting `docs/STRATEGIC_COMBAT.md`'s Tier 1 pseudocode, which still shows the road-exclusive
  `valid_edge` this session already resolved against during Batch 5 planning (see "Tier 1
  Correction" below) — the doc was never actually updated when that decision was made.
- Migrating `4c-retreat-distance.e2e.ts`/`4d-encirclement.e2e.ts` to the established
  `lane:subprovince |` vitest convention (see "Test Migration" below).

### Excluded

- Frontline system removal (`frontline_system.ts`, `frontline_overlay.gd`) — Batch 9.
- Anything about ordinary (non-retreat) unit movement — `movement_system.ts`'s `tick()` and
  `WaypointGraph` stay exactly as they are; confirmed in this batch's research to be real,
  load-bearing pathing infrastructure, not something this migration touches.
- Supply hub definition/placement — already implemented (`getHubSubprovinceIds`,
  `staticHubProvinceIds`, `registerHub`, player-constructible hubs per the project's recent commit
  history) as part of Batch 5's actual implementation, which went further than Batch 5's original
  plan assumed. This batch consumes the existing hub set as-is; it does not touch hub placement or
  construction logic.

## Reality Check Against Earlier Plans

This batch's research read the actual current code, not the batch04/05 plan documents, and found
they match closely — one thing worth flagging before starting:

- `DivisionState.supply_status` (`GameRoomState.ts:69`, `"normal"|"out_of_supply"|"cut_off"|"encircled"`)
  is **already read by live combat logic** — `combat_system.ts:1019`, `1024`, `1496` already gate
  death-vs-retreat and block retreat entirely on `supply_status === "encircled"`. This batch is
  writing into an already-wired consumer, not building the consumer too — good news (less to
  build), but means a wrong tier calculation has immediate, already-connected gameplay
  consequences (a bug here can silently block retreats or misfire the destruction-on-Tier-3 path),
  not just a display bug. Test this path with extra care.
- `server_visibility_system.ts:22` and `GameRoom.ts:2314` already forward `supply_status` to
  clients — no client-side change needed in this batch for the tier value itself to reach players
  (Batch 7's route line is a separate, additional visualization).

## Tier 1 Correction

`docs/STRATEGIC_COMBAT.md`'s current pseudocode (still unedited since this session's Batch 5
planning, which resolved this exact question but never wrote the correction back to the doc):

```
# Current doc text (stale):
valid_edge = lambda sp: FRIENDLY(sp) and sp.kind == "road"
```

Per this session's resolved decision (supply flow is a continuous road/off-road blend, not a
binary fallback — an off-road-only path is still connected, just lower throughput), Tier 1's
actual trigger must accept **any** `FRIENDLY(sp)` edge, not just road cells — road-vs-off-road only
affects `throughputRatio` (Batch 5's concern), not whether a path counts as existing at all for
Tier 1 purposes:

```
valid_edge = lambda sp: FRIENDLY(sp)   # corrected — road preference lives in Batch 5's cost
                                        # weighting for route SELECTION, not in Tier 1's binary
                                        # connectivity trigger
```

Update `docs/STRATEGIC_COMBAT.md`'s pseudocode block to match, in Task 4, as part of this batch —
don't let a third batch pass with the doc still contradicting the implementation.

## Task 1: Ring-Based Tier Detection

**Files:**

- Modify: `game-server/src/systems/supply_system.ts`

**Work:**

1. Implement `ring(graph, startSubprovinceId, n) -> string[]`: BFS from `startSubprovinceId` over
   `SubprovinceGraph.neighbors`, returning nodes at exact hop-distance `n` (not "within n" —
   `STRATEGIC_COMBAT.md`'s `ring(n)` is an exact layer, matching typical BFS-layer semantics: track
   visited nodes per layer, layer `n` is the frontier after `n` expansions minus all previously
   visited nodes).
2. Implement the three-tier trigger, replacing `_corridorOpen`/`_isEncircled`:
   ```ts
   function computeSupplyTier(graph, ownership, hubs, isFriendly, startSubprovinceId): SupplyTier {
     const pathExists = /* Dijkstra reachability check, valid_edge = FRIENDLY(sp), per Tier 1 Correction */;
     if (!pathExists) {
       for (const n of [3, 2, 1]) {
         if (ring(graph, startSubprovinceId, n).every(sp => !isFriendly(ownership.get(sp)?.ownerId))) {
           for (const n2 of [2, 1]) {
             if (n2 <= n && ring(graph, startSubprovinceId, n2).every(sp => !isFriendly(ownership.get(sp)?.ownerId))) {
               return "encircled";
             }
           }
           return "cut_off";
         }
       }
       return "out_of_supply";
     }
     return "normal";
   }
   ```
   (Illustrative shape — confirm the exact nesting against `STRATEGIC_COMBAT.md`'s pseudocode
   during implementation; the doc's own text notes Encircled's check is "a strict subset of Cut
   Off's check" so the escalation invariant holds without extra ordering logic, but write it so
   that invariant is structurally obvious in the code, not just true by coincidence of check order.)
3. **Reuse, don't rewrite, the existing one-tier-at-a-time cascade**: the dead `_computeStatus`
   function already implements "status degrades one tier at a time within a single tick" via
   `TIER_ORDER` — keep that structure, replace only the boolean conditions it currently derives
   from `_corridorOpen`/`_isEncircled` with calls to the new `computeSupplyTier`/`ring`/reachability
   logic above.
4. Remove the `DISABLED` early return in `tick()`, and remove `_corridorOpen`, `_isEncircled`, and
   their now-unused constants entirely (not commented out — deleted).
5. Confirm what `tick()`'s `Set<string>` return value was originally used for (check
   `GameRoom.ts:1620`'s call site and any historical usage before it was disabled) before assuming
   its contract — this batch research did not trace that far; don't guess, verify during
   implementation.
6. Hub set: use `SubprovinceSystem.getHubSubprovinceIds()` (already implemented, per Batch 5's
   actual scope going beyond its original plan to include player-constructible hubs) — do not
   reintroduce the old `ProvinceCity`-based hub concept the dead code used.

**Tests:**

- Exact-hop-distance encirclement: a division with zero friendly subprovinces at ring(1) and
  ring(2) is `encircled`; zero only at ring(3) (with ring(1)/(2) still friendly) is `cut_off`.
- Off-road-only but fully connected friendly path is `normal`, not `out_of_supply` (confirms the
  Tier 1 Correction is actually applied, not just documented).
- One-tier-at-a-time cascade: a division going from `normal` directly to conditions that would
  qualify as `encircled` still passes through `out_of_supply`/`cut_off` in the same or subsequent
  ticks per the existing `TIER_ORDER` stepping logic, never jumping directly.
- `supply_status === "encircled"` still correctly blocks retreat and gates the destruction path at
  `combat_system.ts:1019/1024/1496` once written by real (non-dead) code.

## Task 2: Retreat-Cost Graph Search

**Files:**

- Modify: `game-server/src/systems/supply_graph.ts` (or a new sibling module if keeping
  retreat-cost search separate from `findSupplyRoute` reads more clearly — decide during
  implementation; they share the graph but not the edge-validity rule, see below)

**Work:**

1. Implement a retreat-cost search distinct from `findSupplyRoute`: `findRetreatPath(graph,
   ownership, startSubprovinceId, nationId, isFriendly) -> { subprovinceIds: string[],
   blockedFraction: number }`. Unlike supply's `valid_edge` (which treats non-friendly cells as
   flatly impassable except the single occupied-cell exception), retreat must be able to traverse
   **any** cell — friendly cheap, contested medium, enemy/neutral expensive-but-traversable — per
   `STRATEGIC_COMBAT.md`'s retreat-pathing paragraph. This is the core reason it's a separate
   function, not `findSupplyRoute` with a flag: the edge-validity predicate itself is fundamentally
   different (supply = hard block outside the exception; retreat = always traversable, cost-only).
2. Cost model: friendly cheap (reuse Batch 5's road/off-road-friendly costs), contested (a cell
   currently combat-frozen, per `SubprovinceSystem.isCombatFrozen`) medium, enemy/neutral
   (non-friendly, non-frozen) expensive. Reuse the same `1/throughput`-style inversion pattern
   already established, don't invent a fourth cost formula shape.
3. Target: nearest friendly-or-allied road-corridor cell or hub (per the doc's exact wording),
   found via the same multi-target Dijkstra approach `findSupplyRoute` already established.
4. `blockedFraction` = fraction of the selected path's hops that are non-friendly — this feeds
   Task 3's fighting-withdrawal HP damage calculation directly, so return it as a first-class
   field rather than making the caller recompute it from `subprovinceIds`.
5. Deterministic tie-breaking, same requirement and same mechanism as `findSupplyRoute`
   (lexicographic `subprovinceIds` comparison on equal cost).

**Tests** (new or extended `subprovince-supply-graph.test.ts` — pure unit tests, no Colyseus room):

- Retreat path can traverse enemy-owned unoccupied ground (unlike supply routes, which cannot).
- `blockedFraction` is 0 for an all-friendly path, 1 for an all-enemy/neutral path, and correctly
  proportional for a mixed path.
- Retreat path prefers friendly ground when a friendly-only path exists (lower cost wins).
- Deterministic tie-break matches `findSupplyRoute`'s convention.

## Task 3: Retreat Trigger and Fighting-Withdrawal Damage

**Files:**

- Modify: `game-server/src/systems/movement_system.ts`
- Modify: `game-server/src/systems/combat_system.ts`

**Work:**

1. Add a new method to `movement_system.ts` (the file that already owns `WaypointGraph` and
   `getNearestNonNeutralWaypoint`, which this replaces): `computeRetreatTarget(division, state,
   subprovinceSystem) -> { waypointId: string | null, blockedFraction: number }`. Internally: resolve
   the division's current subprovince, call Task 2's `findRetreatPath`, then translate the path's
   *destination* subprovince into the nearest waypoint via the existing `getNearestWaypoint`-style
   lookup (reuse, don't reimplement) so the result can still be pushed onto `div.move_order` exactly
   as before — this is the deliberate seam keeping ordinary movement execution untouched while
   making the retreat *decision* graph-based.
2. In `combat_system.ts`, replace the `getNearestNonNeutralWaypoint` call at lines 1414-1420 with a
   call to `movementSystem.computeRetreatTarget(...)`.
3. **Fighting-withdrawal damage**: when the retreating division's `supply_status` is `cut_off` (Tier
   2) at the moment retreat is ordered, apply one-time HP damage proportional to
   `blockedFraction` from Task 2, and apply the existing reduced-speed effect (confirm how speed
   modifiers are currently expressed on `DivisionState`/`movement_system.ts` before adding a new
   mechanism — likely an existing multiplier field, not a new one).
4. When `supply_status === "encircled"` (Tier 3): retreat stays blocked, per the already-live guard
   at `combat_system.ts:1019/1024/1496` — this batch does not need to add that block, only make sure
   it keeps firing correctly once real tier data flows into it.
5. Clean retreat (Tier 1/normal): no HP damage, existing speed, same as today's behavior — just now
   targeting a graph-chosen waypoint instead of a purely-nearest one.

**Tests** (`game-server/test/subprovince-retreat.test.ts`, `lane:subprovince |` convention, modeled
on `subprovince-capture.test.ts`'s `boot`/`getTestPort`/`SPAWN_DIVISION` structure):

- Clean retreat (Tier 1 or normal) takes no HP damage.
- Fighting withdrawal (Tier 2) applies HP damage proportional to the actual blocked fraction of the
  chosen path — verify with a constructed scenario where the fraction is known.
- Retreat is blocked entirely when `supply_status === "encircled"`.
- Retreat targets ownership-aware ground — a division retreating with both a short enemy-heavy path
  and a longer friendly path available chooses per the cost model, not pure distance (this is the
  actual behavior change from "nearest waypoint" to "cost-aware graph path").

## Task 4: Documentation Correction

**Files:**

- Modify: `docs/STRATEGIC_COMBAT.md`

**Work:**

1. Update the Tier 1 `valid_edge` pseudocode per "Tier 1 Correction" above.
2. Add one sentence noting off-road connectivity counts toward Tier 1 avoidance, with road
   preference affecting only route throughput/selection (Batch 5's concern), not Tier 1's binary
   trigger — so a future reader doesn't hit the same doc/implementation mismatch this batch found.

**Verification:**

```bash
python3 scripts/check-docs.py
```

## Task 5: Remove Old Code, Test Migration

**Files:**

- Modify: `game-server/src/systems/supply_system.ts` (deletions, covered by Task 1)
- Modify or replace: `game-server/test/4c-retreat-distance.e2e.ts`
- Modify or replace: `game-server/test/4d-encirclement.e2e.ts`

**Work:**

1. Confirm no other code path still calls `_corridorOpen`/`_isEncircled` before deleting (grep,
   don't assume) — these were confirmed dead in this batch's research, but re-verify at the point
   of deletion since other work may have landed in between.
2. Migrate `4c-retreat-distance.e2e.ts` and `4d-encirclement.e2e.ts` from the old raw-client e2e
   script style (requires a live `DEV_MODE` dev server, `npx tsx test/...`, not part of the vitest
   `lane:` suite) into proper `lane:subprovince |` vitest tests using `boot`/`getTestPort()` —
   this is slightly more than "modify" but keeps the whole subprovince test surface on one
   consistent, CI-runnable convention rather than leaving two retreat/encirclement test styles
   coexisting. If time-constrained, at minimum confirm these old scripts still pass manually before
   removing them, don't just delete without re-verifying their scenarios are covered by Task 1/3's
   new tests.

## Dependencies

No new dependencies.

## Verification

```bash
cd game-server && npm test -- subprovince
cd game-server && npm run build
cd game-server && npm run test:full
```

```bash
python3 scripts/check-docs.py
```

## Manual Verification Gate

Batch 8 is complete only after manual review confirms:

1. Create road and off-road supply scenarios; confirm off-road-only connectivity avoids Tier 1
   (the corrected behavior) while still showing reduced throughput via Batch 5's route display.
2. Cut a road corridor; watch a division progress through the tiers one at a time, not skip any.
3. Capture a subprovince along an active supply route; confirm the affected division's tier updates
   correctly on the next supply tick.
4. Test retreat through friendly ground (clean, no damage), contested/enemy ground (fighting
   withdrawal, HP damage proportional to path composition), and confirm retreat is fully blocked
   once `encircled`.
5. Confirm ordinary (non-retreat) unit movement is completely unaffected — spot check normal move
   orders still path exactly as before this batch.
6. Confirm `docs/STRATEGIC_COMBAT.md`'s Tier 1 pseudocode now matches the implementation.
7. Confirm the legacy `4c`/`4d` e2e scripts' scenarios are still covered (either by their migrated
   vitest versions or by explicit manual re-verification if migration was deferred).

Do not begin Batch 9 (frontline retirement, final reconciliation) until this gate is approved —
Batch 9's "no old influence-grid behavior remains" acceptance check assumes this batch's supply/
retreat/encirclement behavior is already correct and stable, since Batch 9 is cleanup, not a place
to discover new supply-logic bugs.
