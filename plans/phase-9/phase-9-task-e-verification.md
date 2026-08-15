# Branch E — `feat/economy-verification`

## Context

**Must be last — prerequisite: Branches A, B, C, D all merged.** No new mechanics. This
branch is a full bot-driven, end-to-end run of `DEV_PHASES.md`'s actual Phase 9 verification
gate, exercising every branch together against real multi-nation scenarios rather than each
branch's own isolated unit tests. Its job is to catch integration gaps between branches —
e.g. Branch C's chromium hard-gate consuming Branch B's flag correctly, Branch D's market
correctly reading Branch B's resource stockpiles — not to re-test anything already covered
by a unit test in A/B/C/D.

**This branch's report must be honest about what the verification gate can and cannot
currently prove**, per the scoping already established across the other four task files.
Three items in `DEV_PHASES.md`'s Phase 9 gate paragraph describe behavior that is
**intentionally still a stub** after all four branches merge — do not write a bot script that
pretends to verify them, and do not report them as passing:

- **Aluminium's ceiling** — permanently inert placeholder flag (Branch B, Step 8a), by design,
  until Phase 14.
- **Uranium's research-currency injection** — no research-currency system exists yet
  (Branch B, Step 8b) — nothing to verify.
- **Chromium's hard production-block and supply-cut** — the *threshold flag* is real
  (Branch B) and *consumed* by the auto-scheduler (Branch C), but the **supply-cut half**
  (existing chromium-gated units in the field stopping HP recovery) has nothing to act on
  until Phase 7's healing tick exists — verify the production-block half only.

Write this branch's bot scripts to **explicitly assert the stub behavior stays stubbed**
(e.g. "aluminium ceiling remains `Infinity` for every nation regardless of stock or air-unit
count") rather than silently skipping these cases — a regression that accidentally makes a
stub start doing something unintended is still worth catching.

**Test-Driven Development doesn't apply in the usual sense here** — this branch writes bot
scripts against already-implemented behavior, not new mechanics ahead of implementation.
Write the bot scripts, run them against the merged Branches A-D, fix whatever integration
gaps they surface (in the smallest branch/file where the gap actually lives, not by patching
around it in this branch), re-run until green.

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/test/session-loop-economy.e2e.ts` | Bot-client E2E test, following the exact pattern of `game-server/test/session-loop.e2e.ts` (Phase 3's precedent) and `scripts/e2e-session-loop.sh`'s wrapper shape |
| `scripts/e2e-economy-loop.sh` | Shell wrapper, mirrors `scripts/e2e-session-loop.sh` |

No files modified — if this branch needs to modify anything outside its own new test files,
that is itself a finding: it means Branches A-D shipped an integration gap, and the fix
belongs in whichever of those branches actually owns the broken code, with a note in this
branch's PR description pointing at it, not a silent patch bundled into "verification."

---

## Bot Scenario — two nations, scripted in sequence, mapped 1:1 to `DEV_PHASES.md`'s Phase 9 gate paragraph

Use the existing bot client pattern (`DEV_PHASES.md`'s Testing Strategy section,
`game-server/tests/bots/bot_client.ts`-style Colyseus client, `getTestPort()` per
`AGENTS.md`). Two bot nations, Germany and France, same pattern as `session-loop.e2e.ts`.

1. **Zero-industry baseline output.** Germany builds an Iron Mine (Branch A `BUILD_BUILDING`),
   waits for construction to complete (Branch A `EconomyBuildingSystem.tick`), asserts iron
   stockpile increases at the mine's full base-tier rate with `industry_alloc` left at its
   default (Branch B Step 3/10) — confirms the Design Philosophy #1 guarantee end-to-end,
   not just at the unit level Branch B already tested in isolation.
2. **Diminishing-returns industry allocation.** Germany submits `SET_INDUSTRY_ALLOCATION`
   pushing Iron allocation high, asserts iron output rises on a saturating curve (samples at
   0%, 50%, 100% allocation, asserts the *marginal* gain from 50→100% is smaller than from
   0→50%) — an integration check that Branch B's `industrySliceMultiplier` is actually wired
   into the live tick, not just unit-tested in isolation.
3. **Oil debuff and allocation-priority toggle.** Germany drains its own oil (bot forces
   consumption via a scripted division with tanks, or a `DEV_SET_RESOURCE`-style test-only
   handler if one is added for this purpose — check whether Branch B's tests already needed
   such a handler and reuse it rather than adding a second one), asserts an oil-consuming
   division's move speed degrades while a pure-infantry division's does not, toggles
   `SET_OIL_PRIORITY` to `military`, asserts the military-side penalty visibly lessens
   relative to `economy` priority at the same stock level.
4. **Rubber depletes from combat, not just production.** Germany and France's tank-heavy
   divisions engage; asserts Germany's rubber stockpile visibly decreases round over round
   with **zero** new tank production occurring during the fight — isolates the combat-attrition
   drain (Branch B Step 5) from the build-cost drain (Branch C, not yet wired to rubber in
   this phase per Branch B's own scoping note).
5. **Tungsten downgrade, never a hard block.** Germany zeroes tungsten, engages an AT-infantry
   division against armour, asserts damage is reduced but nonzero, and asserts Germany can
   still `RAISE_DIVISION` a template containing AT infantry (production never blocked by
   tungsten, per `RESOURCE_ECONOMY.md`'s explicit "no production block... the entire effect
   lives in this one stat-table shift").
6. **Chromium hard-gate — production-block half only.** Germany zeroes chromium, raises a
   division template mixing `medium_tank` (not gated) and `heavy_tank` (gated), asserts the
   Tank Plant only ever produces `medium_tank` while starved (Branch C Step 2c), asserts
   `heavy_tank` production resumes automatically the tick chromium crosses back above
   threshold with **no additional player action required** (Branch C's "recompute-every-tick,
   self-correcting" design). **Do not attempt to assert anything about supply-cut to already-
   fielded chromium-gated units** — per this file's Context section, that half has nothing to
   verify yet.
7. **Aluminium and Uranium — assert stub behavior explicitly.** Assert
   `aluminium_air_doctrine_flag` is `false` for every nation with no code path to set it true
   anywhere in the merged branches; assert uranium accumulates via the same generic
   extraction path as iron (no special-cased behavior); assert nothing in the merged code
   attempts to spend uranium on anything (no `RESEARCH_CURRENCY`-flavored message type
   exists).
8. **Unit-level raise → resource deduction.** Germany raises a division, asserts the resource
   vector deducted matches the sum of the individual unit costs at the moment each slot
   actually fills (not a lump sum deducted at raise time) — the core §3.1 "hybrid" model from
   `unit_production_handoff.md`, worth an explicit integration assertion since it's easy to
   accidentally regress toward the old lump-sum model if a future change touches
   `RAISE_DIVISION` carelessly.
9. **Reserve → Marshalling → deployment pipeline, end to end.** Germany raises a division,
   asserts it does not appear in `state.divisions` as map-visible (`deployment_state ===
   "marshalling"`), asserts aggregate HP% climbs as Barracks production feeds Reserve which
   feeds the marshalling slots (Branch C Steps 2-4 working together, not just individually
   unit-tested), `FORCE_DEPLOY`s at ≥50%, asserts the division is now visible with
   `deployment_state === "deployed"`.
10. **Spot market fill with spread.** Germany posts a sell order, France posts a matching buy
    order, asserts Germany receives ~80-90% of listed price and France pays ~110-120% of the
    going rate in the **same transaction** (Branch D Step 2) — an integration check that both
    legs of the spread are applied correctly together, not just independently unit-tested.
11. **Standing trade route — placeholder disruption behaves as documented, not as the real
    thing.** Germany and France establish a port-to-port route; assert it stays active
    regardless of any simulated "enemy presence" scripting attempt, since no naval-unit
    concept exists to actually disrupt it in this phase — **explicitly assert this is still
    true after the fact**, i.e. this test should fail loudly if some future change
    accidentally makes the port-disruption placeholder start doing something, since that would
    mean it silently diverged from the documented Phase 14 deferral without anyone deciding
    that on purpose.
12. **Land trade route rejected between non-bordering nations, no transit exception exists.**
    Attempt a land-route proposal between two nations with no shared border and no naval
    access; assert rejection; assert no `[Request Transit]`-equivalent code path exists
    anywhere in the merged server code to bypass this (a grep-based assertion, not a runtime
    one, is acceptable for this specific check — confirming absence of a feature is
    legitimately easier to verify by searching the codebase than by trying to trigger it and
    catching a rejection).
13. **Population and Town Hall's VP-weighting.** Let population grow undisturbed in one
    province for the scenario's duration, compare its `effective_vp_value` (Branch B Step 9,
    Town Hall) against an equally-leveled province that took simulated population loss
    (script a `DEV_SET`-style test-only population reduction if needed, matching whatever
    test-only mutation pattern Branch A's `handleDevSetSupply`-equivalent already established
    for divisions) — confirms the undisturbed province's VP contribution is visibly higher.

---

## Load Test

Per `phase-12-air-combat.md`'s own final-integration-branch precedent ("Load test: wing
counts at `AIR_COMBAT.md` 'Server Architecture & Scaling' scale"), run the scenario above at
this game's own documented scale ceiling — `STRATEGIC_COMBAT.md`'s "roughly 5-15 divisions
per player" and every playable nation simultaneously active, all building/producing/trading
at once — and confirm `gameTick()`'s new economy-related work (Branch A's construction tick,
Branch B's per-nation resource tick, Branch C's per-building production scan, Branch D's
per-route flow tick) doesn't measurably regress the existing `TICK_MS = 1000` budget.
**If it does regress the tick budget, this is a legitimate finding to report, not something
to silently optimize away inside this "verification" branch** — report the specific
bottleneck (which of the four sub-systems) so a follow-up branch can address it deliberately.

---

## Verification Split

Every item above is **Automated (bot client)** per this phase's overview document's
verification-split convention — none require a running Godot client, since this branch's job
is server-side integration correctness, not visual/UX correctness (each of Branches A-D
already carries its own required manual/visual verification steps, already performed when
those branches individually merged). Run via:
```bash
bash scripts/e2e-economy-loop.sh
```
mirroring `scripts/e2e-session-loop.sh`'s existing invocation shape exactly. Also run the full
existing suite (`cd game-server && npm test`) to confirm the new `economy` lane and every
pre-existing lane are still green together — this is the first point in the phase where all
five lanes (`air-combat`, `tactical`, `movement`, `core`, `economy`) get exercised in the same
CI-equivalent pass.

---

## Completion Report Expectations

When this branch is done, its PR description (not a persisted doc — per `AGENTS.md`, do not
create wiki plans/notes as part of this work) should state, plainly:

1. Which of the 13 scenario items above pass.
2. Which stub behaviors (Aluminium, Uranium, Chromium's supply-cut half, port-route real
   disruption, transit-rights routing) were confirmed to remain correctly inert, per this
   file's Context section — framed as "confirmed still deferred, as designed," not "not yet
   implemented" (the latter reads as an oversight; the former correctly reads as a documented,
   deliberate phase boundary).
3. Any integration gap found between branches, which branch/file it was actually fixed in
   (not patched here), and the specific test that now covers it.
4. Load test results against `STRATEGIC_COMBAT.md`'s documented scale ceiling, and whether
   `gameTick()`'s economy work stayed within the existing 1-second tick budget.
