# Branch E — `feat/research-verification`

## Context

**Must be last — prerequisite: Branches A, B, C, D all merged.** Optional to actually run, same
as `plans/phase-9/phase-9-task-e-verification.md`'s precedent (which the user confirmed they
never executed, judging it unnecessary once A-D's own manual checkpoints had already covered the
ground). No new mechanics. This branch is a full bot-driven, end-to-end run of
`DEV_PHASES.md`'s actual Phase 11 verification gate, exercising every branch together against a
real multi-nation scenario rather than each branch's own isolated checkpoint — its job is to
catch integration gaps between branches (e.g. Branch D's DivisionBuilder eligibility reading
Branch A's live research state correctly; Branch C's popup Confirm button actually charging
Branch B's real currency; Branch B's concurrency curve behaving correctly across two nations
racing to research the same thing), not to re-verify anything a branch's own manual checkpoint
already covered in isolation.

**Reconciling `DEV_PHASES.md`'s original gate wording against this plan's actual scope
decisions — read before writing bot scripts, so nothing is scripted to fail on a stale
assumption:**

`DEV_PHASES.md` Phase 11's verification gate text says *"Infantry's stub tree remains empty and
clearly marked, not silently populated with placeholder content"* and *"Confirm Infantry/
Artillery/Air/Naval panels render their empty-stub state."* This plan's own overview
(`phase-11-unit-specialization-research.md`) made a deliberate, user-directed scope decision
that supersedes this: **Infantry, Ordnance, Air, and Economy branches carry small, clearly-
labelled sample content** (to prove the engine/UI handle multiple branches, mutex, badges —
Branch A's Step 1d), and **only Naval is genuinely empty**, per the phase's actual branch plans.
Script this branch's assertions against the *actual* implemented scope (sample content, clearly
commented as placeholder, on Infantry/Ordnance/Air/Economy; true empty-stub only on Naval) — do
not write a test that fails because it expects the original doc's literal "empty" framing on
branches this plan intentionally populated with sample data.

**This branch's report must be honest about what the verification gate can and cannot currently
prove.** Several items are intentionally still deferred after all four branches merge — do not
script around them or report them as passing:

- **Building perk trees (all 18 economy buildings)** — no real content anywhere; explicitly a
  future, separate content-authoring pass per this plan's overview.
- **Real Infantry/Ordnance/Air/Naval doctrine content** — sample/placeholder only (Naval:
  literally none), same deferral.
- **Five of the six motorisable infantry types** `TACTICAL_COMBAT.md` names in prose** — only
  `infantry` ↔ `motorised_infantry` actually exists as a wired toggle (Branch D); the rest are a
  documented future content addition.
- **Server-side hard validation on `ASSIGN_TEMPLATE`/`RAISE_DIVISION`** — deliberately not added
  (Branch D's Context section) in favor of the live-fallback "template never breaks" guarantee;
  do not write a test asserting the server rejects an under-researched unit-type request, it
  won't, by design.
- **Unit Profile's attack-pattern diagram** — text-only this phase (Branch D), the diagram
  reusing Tactical Combat Panel's overlay visual language is a documented follow-up.

Write bot scripts to **explicitly assert these stay stubbed/deferred as designed** (e.g. "no
`motorised_at_infantry`-style type exists anywhere in the merged `UnitType` enum") rather than
silently skipping them — a regression that accidentally half-implements one of these is still
worth catching.

**Test-Driven Development doesn't apply in the usual sense here** — bot scripts against already-
implemented behavior across A-D, not new mechanics ahead of implementation. Keep this to the
one targeted e2e script; do not run the full `npm test` suite as part of this branch either,
consistent with every other branch in this phase.

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/test/session-loop-research.e2e.ts` | Bot-client E2E test, following `session-loop.e2e.ts`'s exact pattern (two bots: register → login → lobby → Colyseus room join → `SELECT_NATION`/`SET_READY`/`START_GAME`) and `scripts/e2e-session-loop.sh`'s wrapper shape |
| `scripts/e2e-research-loop.sh` | Shell wrapper, mirrors `scripts/e2e-session-loop.sh` exactly (start api-server + game-server with `DEV_MODE=true`, wait for readiness, run the bot script, tear down) |

No files modified — if this branch needs to touch anything outside its own new test files, that
is itself a finding: an integration gap between Branches A-D, fixed in whichever of those
branches actually owns the broken code, noted in this branch's completion report pointing at it,
not silently patched here.

---

## Bot Scenario — two nations, scripted in sequence, mapped to `DEV_PHASES.md`'s Phase 11 gate paragraph (reconciled per the Context section above)

Two bot nations (reuse `session-loop.e2e.ts`'s Bot A/Bot B host/joiner shape), `getTestPort()`
per `AGENTS.md`.

1. **Adjacency-web unlock.** Bot A researches the Armoured branch's Motorisation-adjacent
   mechanisation-chain entry point; asserts the next-tier-same-path node becomes available, and
   asserts whatever same-tier adjacent-path node `RESEARCH.md`'s adjacency rule predicts also
   becomes available — an integration check that Branch A's tree-loader-built adjacency
   structure and Branch C's sidebar AVAILABLE-section resolution agree with each other, not just
   individually unit-tested.
2. **Branch content state, reconciled scope.** Asserts Infantry/Ordnance/Air/Economy branches
   render their sample content (nonzero node count, each file's sample-content comment present)
   and Naval renders as a genuine empty array — **not** the original doc's "all stub branches
   empty" framing; assert the *actual* documented scope from this plan's overview.
3. **Template never breaks, across a not-yet-researched lineage tier.** Bot A builds/saves a
   division template referencing `improved_apc` in a slot with nothing researched yet; asserts
   the template loads and the division fields as `mechanised_infantry` (the base), no error —
   confirms Branch A's `resolveLineageUnitType()` fallback and Branch D's eligible-list
   additions compose correctly, since Branch D is what makes `improved_apc` reachable as a
   template selection at all.
4. **Live recompute, without re-saving.** Bot A researches Mechanised Infantry then Improved
   APC (spending real currency per Branch B — assert the deduction happens); without touching
   the template again, asserts the already-fielded division's effective stats update to
   Improved APC's values on the next read — the core cross-branch guarantee (Branch A's
   mechanism + Branch B's real currency actually gating it + Branch D's template referencing it)
   working together, not just each piece unit-tested alone.
5. **Respec, no refund, live drop.** Bot A researches a conflicting mutex option elsewhere in
   the tree that displaces an already-researched sibling; asserts the old perk/node stays fully
   active for the new research's entire duration (a division using it mid-respec is unaffected),
   asserts zero currency refund on the displaced node once the new one completes, and asserts
   the old perk/effect is atomically removed and live-recomputed away the instant completion
   fires — an integration check across Branch A's respec state machine and Branch B's currency
   (confirming Branch B didn't accidentally wire a refund into the respec path, which would
   violate `RESEARCH.md`'s explicit "no refund on respec" rule, distinct from cancel's partial
   refund).
6. **Currency mechanics, together.** Bot A starts two concurrent research projects; asserts the
   second's charged cost is visibly higher than the first's (concurrency cost curve), asserts
   `science_points` and `money` are both actually decremented by the correct concurrency-
   adjusted amounts. Bot A allocates Industry Pool's `research_speed` slice high; asserts
   completion speed measurably increases on a saturating (not linear) curve, never reaching a
   hard-zero completion time at any allocation. Bot A cancels an in-progress project; asserts
   the refunded/forfeited amounts match `RESEARCH.md`'s formula exactly (`invested_so_far ×
   refund_rate` refunded, remainder forfeited, nothing double-credited).
7. **Uranium injection.** With Bot A holding nonzero uranium stock, completing the Uranium
   Research Program node grants the one-time science boost; asserts a second bot (Bot B) with
   zero uranium stock completing the *same* node gets no injection but the node still completes
   normally (no production block) — confirms Branch B's Critical Pre-Read decision that this is
   a hard-coded one-off, not a general resource-gated system, actually behaves that way for two
   different nations' stock levels.
8. **Motorisation doesn't break movement.** Bot A researches Motorisation, places a motorised-
   infantry cell via the template, raises and deploys the division, issues a move order, and
   asserts the division's position actually advances over several ticks (the landmine check —
   confirms Branch D's `unit_terrain_costs.ts` fix is real and not silently reverted by a later
   branch), and asserts its road speed is measurably faster than an otherwise-identical non-
   motorised division's.
9. **Deferred/stubbed items stay deferred — explicit assertions, not silent omission.** Assert:
   no `UnitType` entries exist for `motorised_assault_infantry`/`motorised_mg`/`motorised_at_
   infantry`/`motorised_recon_infantry`/`motorised_flamethrower` (grep-based, acceptable per the
   phase-9 precedent's own reasoning that confirming absence is legitimately easier via search
   than by trying to trigger it); assert `ASSIGN_TEMPLATE` still accepts an unresearched
   `unit_type` string without server-side rejection (the fallback is what makes this safe, by
   design — this test should fail loudly if a future change silently adds rejection without
   anyone deciding that on purpose, the same "catch an accidental deviation from a documented
   deferral" reasoning phase-9's own Branch E used for its port-blockade placeholder).

---

## Load Test

Lighter than Phase 9's economy load test — research doesn't scale with province/division count,
only with nation count and each nation's concurrent-project count. Run the scenario above at
full lobby size (every playable nation active, each running several concurrent research
projects simultaneously) and confirm `ResearchSystem.tick()`'s per-nation loop doesn't
measurably regress `gameTick()`'s existing `TICK_MS = 1000` budget. If it does, report the
specific bottleneck as a finding for a follow-up branch, same as every other load-test
precedent in this project — do not silently optimize inside this "verification" branch.

---

## Verification Split

Every item above is **Automated (bot client)**, matching this phase's other branches' own
verification-split convention — Branches A-D already carry their own required manual/visual
checkpoints, performed when those branches individually merged; this branch's job is
integration correctness across them, not visual/UX re-verification. Run via:
```bash
bash scripts/e2e-research-loop.sh
```
mirroring `scripts/e2e-session-loop.sh`'s exact invocation shape. **Do not additionally run the
full `game-server` `npm test` suite** as part of this branch, consistent with every other branch
in this phase's test-running guidance.

---

## Completion Report Expectations

If this branch is actually run (optional, per the Context section), its report should state
plainly:

1. Which of the 9 scenario items above pass.
2. Which stub/deferred behaviors (5 of 6 motorised types, server-side hard validation, building
   perk trees, non-Armour/non-Naval doctrine content, Unit Profile's attack diagram) were
   confirmed to remain correctly deferred, as designed — framed as "confirmed still deferred, as
   designed," not "not yet implemented" (the latter reads as an oversight; the former correctly
   reads as a documented, deliberate phase boundary, same framing convention phase-9's own
   Branch E used).
3. Any integration gap found between Branches A-D, which branch/file it was actually fixed in
   (not patched here), and the specific scenario item that now covers it.
4. Load test results against a full-lobby scenario, and whether `ResearchSystem.tick()` stayed
   within the existing 1-second tick budget.

If this branch is **not** run (the user's stated default preference from Phase 9), no report is
needed — the phase is considered complete on Branches A-D's own individual manual checkpoints.
