# Grand Strategy Multiplayer — Research System

> Authoritative shared-mechanism spec for **both** building perk trees
> (`ECONOMY_BUILDINGS.md`) and unit specialization trees (`TACTICAL_COMBAT.md`, and the
> Infantry/Artillery/Air/Naval trees not yet designed). Those documents define *content*
> (what each tree contains); this document defines the *mechanism* every tree shares.
> UI layout for the Research panel is deferred — this document is mechanism-only.
> Last updated: September 2026.

---

## Tree Shape (adjacency-web)

- A tree has **one or more named paths** (archetypes). No fixed floor or ceiling — a
  single-lever item gets one path (e.g. Uranium Mine); a genuinely complex item can have
  many. Practical UI legibility caps width in practice, not the rule itself.
- Unlocking a tier in a path unlocks the **next tier, same path**, plus the **same tier,
  adjacent path(s)**. Distant paths cost more by node-count, not an arbitrary tax.
- Paths are **not exclusive by default** — free investment across all paths.
- Specific **tiers** (not paths) can be locked as mutually-exclusive choice-points: pick
  one option among several at that tier only. Doesn't block other paths elsewhere.
- For units, each path should read as a coherent historical **doctrine identity** —
  going all-in on one path lets a player roleplay that doctrine; the adjacency web is
  what lets them mix-and-match into something custom instead.

## Perk Taxonomy

Three node shapes, used across both building and unit trees:

1. **Mechanic-unlock** (the default for units, especially early/mid-tree) — a new rule
   the unit didn't have before, not a stat delta: terrain-penalty immunity, hitting
   multiple targets, a reshaped damage curve (e.g. shotgun: big near-row damage, less at
   range). Any tradeoff lives inside the new rule itself.
2. **Redistribute** — trade strength between two effects the thing already has (e.g. a
   hospital shifting casualty-reduction toward supply-throughput). Standard for
   buildings; usable for units too, case-by-case as trees are designed.
3. **Pure additive** — flat stat increase, no new behavior. The "next generation"
   perk — reserved for mid/late-tree, after the qualitative differentiators are used up.

Buildings stay purely additive/redistribute (no mechanic-unlock shape). Units use all
three, weighted toward (1) early, (3) late.

**Lineage chains** are a separate structural case, not a perk type: a chain of tiers
that each replace the previous as a **distinct grid entity** (APC → improved APC → IFV),
not a perk layered on a fixed base. See `TACTICAL_COMBAT.md`'s Armoured branch.

## Live Effective Stats

- A fielded division's stats are computed from `(template + current nation research
  state)` on **every read** — never snapshotted at raise time. Newly completed (or
  un-researched, via respec) perks apply instantly to units already in the field.
- Effective-stats computation always takes an explicit active-perk-set argument —
  `compute_stats(unit_type, active_perk_ids)` — never a hardcoded "all researched."
- **Fallback rule:** a template referencing a not-yet-(re)searched lineage tier resolves
  to the **highest currently researched** tier in that chain — never straight to the
  unspecialized base. A template never breaks.

## Auto / Manual Perk Activation (Manual deferred)

Per unit-slot in a division template:

```
perk_mode: "auto" | "manual"
active_perks: Set<perk_id>   # ignored while perk_mode == "auto"
```

- **Auto** (default, only mode with UI right now): always uses every currently
  researched perk for that unit type — zero-touch, always current.
- **Manual** (data field exists now, UI and behavior deferred): a frozen custom
  selection. Newly researched perks land **inactive** on a manual slot until explicitly
  turned on, so a tuned build never mutates under the player. Toggling only selects
  among already-unlocked perks — it never bypasses research or tier-local exclusivity.
- Because the stats function already takes an explicit perk set as input, adding Manual
  mode later is new `DivisionBuilder` UI wired to an existing code path — no schema
  migration, no stats-pipeline rework.

## Currency & Anti-Snowball

- One shared currency pool (money + science, from School buildings) funds every research
  system in the game — buildings, General Technology, unit specialization. No per-system
  currencies.
- Running multiple projects concurrently uses a **concurrency cost curve** (soft cap via
  rising cost, not a hard slot limit).
- **Anti-snowball floor:** a node's completion time approaches a minimum (asymptote) as
  funding increases — diminishing returns, never zero. No amount of currency buys instant
  tech, consistent with the game's no-P2W identity (this is an economic-snowball guard,
  independent of any real-money concern).

## Respec

Re-selecting a different option at an already-decided mutually-exclusive tier:
1. Confirmation prompt (this will un-research the current pick).
2. New research starts; **old perk stays fully active for the entire duration** — no
   downtime gap.
3. The instant the new research completes, the old perk is un-researched atomically and
   everything using it live-recomputes down (per Live Effective Stats).
4. No currency refunded for the sunk cost in the old perk.

Research time itself is the natural rate-limiter — no separate cooldown needed.

## Cancelling In-Progress Research

- A player may cancel any node currently mid-research. Progress resets to **0%** and
  the project is removed from active research — it is not paused; picking it up again
  later means starting over from scratch.
- A **fixed refund rate** (a tunable balance constant, not fixed by this document) is
  applied to whatever currency has already been invested in that node. The player
  recovers that fraction; the remainder is forfeited. Because the invested amount
  itself scales with progress, cancelling early forfeits little in absolute terms;
  cancelling near completion forfeits more, even though the refund *rate* never
  changes.
- Refunded currency returns to the shared research-currency pool immediately, usable
  by any other project.
- **This is a different sunk-cost policy from Respec above, deliberately:** respec
  displaces an already-*completed* perk with zero refund, because that perk already
  delivered its value. Cancel aborts something **never completed** — the player got
  no value from it at all — so a partial refund is warranted where a full write-off
  would not be.

## Session Scope

- Research is **session-local** — it fully resets each match, nothing persists across
  games (matches the ephemeral-Colyseus-room architecture; see `MODULES.md`).
- **Exception:** a map/scenario can define a non-default **starting research baseline**
  (e.g. a scenario opening in 1942 instead of 1939 pre-unlocks some nodes for everyone).
  This is a map-data property, not player-account progression — every player on that map
  starts from the same adjusted baseline.
- **Pacing philosophy — the tree is meant to be "exhaustive," not "complete-able."** Most
  nodes give standalone value the moment they're researched, so partial investment in a
  short session is never wasted. Full completion of any tree is a large-map (up to 4hr)
  achievement, not an expectation for a 1-hour small-map session. Cost curves for actual
  tree content should be tuned against this: a focused player should clear a couple of
  early tiers in a small-map game; nobody should expect to clear the whole roster.

## Out of Scope

- Research panel UI/layout, sub-tab structure, and hotkey allocation — deferred to a
  future UI pass.
- Actual node-by-node content for Infantry/Artillery/Air/Naval doctrine trees — not
  designed yet (see `DEV_PHASES.md` Phase 11).
- Exact cost-curve numbers/tuning — mechanism only, not calibrated yet.
