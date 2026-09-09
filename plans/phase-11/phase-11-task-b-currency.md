# Branch B — `feat/research-currency`

## Context

**Prerequisite: Branch A merged.** This branch assumes Branch A's interface contract is real:
a `ResearchSystem` class with `Map<nation_id, NationResearchData>`
(`NationResearchData { researched_node_ids: Set<string>, active_projects: ResearchProgress[] }`,
`ResearchProgress { node_id, points_remaining, points_total }`), `NationState.active_research_count`,
JSON node definitions (`client/assets/data/research/<branch>.json`) with a `cost: {money,
science}` field (Branch A leaves it at `{0,0}`), `START_RESEARCH`/`CANCEL_RESEARCH` command
handlers with ownership guards but no cost check, a flat `RESEARCH_PROGRESS_PER_TICK_PLACEHOLDER`
tick rate, `RESEARCH_INIT`/`RESEARCH_UPDATES` broadcasts, and client-side `GameState.research:
Dictionary` / `EventBus.research_updated()` / `CommandQueue.submit("START_RESEARCH"/
"CANCEL_RESEARCH", ...)` replacing the old client-local-only prototype's direct calls.

This branch wires the real shared money+science pool `RESEARCH.md` describes: per-node cost
deduction at research start, a concurrency cost curve (each additional simultaneous project
costs more — a soft cap via rising price, never a hard slot limit), an anti-snowball floor
(completion speed approaches a minimum time as funding increases, never reaches it), no refund
on respec (confirm only — Branch A's mutex/respec state machine already doesn't touch currency),
and a fixed-rate partial refund on cancel. It also gives `NationState.science_points` its first
real sink (confirmed by investigation: zero code anywhere currently decrements it) and builds
Uranium's research-currency injection from scratch (confirmed by investigation: no code stub
exists anywhere for this — Phase 9's "stub" is doc-only, not a dormant code path to resume).

**A clean reuse found by investigation, load-bearing for this branch's design:** the anti-
snowball floor does **not** need a new curve invented. `resource_economy_system.ts`'s existing
`industrySliceMultiplier(allocationPct)` (Phase 9) is already exactly the right shape — floors
at `1.0` (never a precondition), asymptotically approaches a cap as allocation → 100 (never
reaches infinite speed) — the same "no amount of currency buys instant tech" guarantee
`RESEARCH.md` asks for. This branch adds one new `industry_alloc` key, `"research_speed"`,
alongside the existing `"construction_speed"`/`"unit_production_speed"` national slices, and
multiplies `ResearchSystem`'s per-tick progress rate by `industrySliceMultiplier(alloc)` —
**reusing the function directly, not reimplementing it.** The **concurrency cost curve** (rising
*price* per simultaneous project) is a genuinely different, separate mechanic from this speed
curve — confirmed by investigation, nothing like it exists in the codebase yet — and is
implemented fresh in Step 2 below. Keep these two curves conceptually distinct: one makes
research *cost more* the more you run at once; the other makes research *complete faster* the
more national industry you devote to it. Do not conflate them into one function.

**Keep test runs minimal and targeted, same as Branch A.** Run only this branch's new test file
while iterating; do not run `npm test` (full suite) at all as part of this branch.

---

## Critical Pre-Read

### `industry_alloc` — real current key set (`GameRoomState.ts:48`, `GameRoom.ts:2895-2898`, various read sites)

```typescript
@type({ map: "number" }) industry_alloc = new MapSchema<number>();
// Keys actually populated today: "money", "construction_speed", "unit_production_speed",
// plus one key per each of the ten resource types (grain, iron, oil, rubber, nitrates,
// tungsten, chromium, aluminium, uranium — "money" doubles as both a tradeable resource
// and its own extraction-boost slice).
```
This branch adds one more key: `"research_speed"`, same National-slice tier as
`"construction_speed"`/`"unit_production_speed"`.

### `industrySliceMultiplier` — the exact function this branch reuses (`resource_economy_system.ts:54-57`)

```typescript
export function industrySliceMultiplier(allocationPct: number): number {
  // Saturating curve: 0% allocation -> 1.0x (never a precondition), 100% -> asymptotic cap.
  return 1.0 + (allocationPct / 100) * (INDUSTRY_DIMINISHING_K / (INDUSTRY_DIMINISHING_K + allocationPct));
}
```
Constant (`resource_stats.ts:48`): `export const INDUSTRY_DIMINISHING_K = 30; // TBD playtesting`.
**Import and call this directly** — `import { industrySliceMultiplier } from
"../systems/resource_economy_system.js"` — for the research-speed multiplier. Do not copy the
formula into a second location.

### `SET_INDUSTRY_ALLOCATION` — full current handler, exact reject-if-not-100 + cooldown rule (`GameRoom.ts:695-716`)

```typescript
this.onMessage("SET_INDUSTRY_ALLOCATION", (client, msg: { allocations: Record<string, number> }) => {
  if (this.state.phase !== "running") return;
  const player = this.state.players.get(client.sessionId);
  if (!player) return;
  const nation = this.getNationForPlayer(player.userId);
  if (!nation) return;

  const now = Date.now();
  const lastSet = this._industryAllocCooldownByNation.get(nation.nation_id) ?? 0;
  if (now - lastSet < INDUSTRY_REALLOCATION_COOLDOWN_MS) return;

  const total = Object.values(msg.allocations ?? {}).reduce((sum, v) => sum + v, 0);
  if (Math.abs(total - 100) > 0.5) return; // reject — must sum to 100, not silently normalized

  for (const [key, value] of Object.entries(msg.allocations)) {
    nation.industry_alloc.set(key, Math.max(0, Math.min(100, value)));
  }
  this._industryAllocCooldownByNation.set(nation.nation_id, now);
});
```
**Not modified by this branch** — `"research_speed"` is just another key clients can include in
`allocations`; the handler already accepts arbitrary keys generically. Confirm this in a test
rather than editing the handler.

### `BUILD_BUILDING` — the exact check-then-deduct pattern `START_RESEARCH`'s cost check mirrors (`GameRoom.ts:578-613`)

```typescript
const cost = stats.resource_cost_by_level[currentLevel];
if (!cost) return;
for (const [resType, amount] of Object.entries(cost)) {
  if ((nation.resources.get(resType) ?? 0) < (amount ?? 0)) return; // insufficient — reject silently
}
// ...start the thing...
for (const [resType, amount] of Object.entries(cost)) {
  nation.resources.set(resType, (nation.resources.get(resType) ?? 0) - (amount ?? 0));
}
```
Two-pass (check-all, then deduct-all) — copy this shape exactly for `START_RESEARCH`'s
`{money, science}` cost, with one difference: `money` comes from `nation.resources.get("money")`
but `science` comes from `nation.science_points` directly (a sibling scalar field, **not** part
of the `resources` MapSchema — confirmed by investigation, `GameRoomState.ts:57`).

### `science_points` — first-ever decrement, confirmed clean (`GameRoomState.ts:57`, `GameRoom.ts:3147`)

```typescript
@type("number") science_points: number = 0;
// comment: "...this is intentionally a stockpile with no sink yet."
...
nation.science_points += scienceGainForTick(totalSchoolLevel, SCIENCE_PER_SCHOOL_LEVEL);
```
Confirmed by grep: zero hits for `science_points -=` or `science_points.set(` with a subtraction
anywhere in `game-server/src` today. `START_RESEARCH`'s deduction and `CANCEL_RESEARCH`'s
partial refund are this field's first-ever writes besides the tick accumulator.

### Uranium injection — genuinely new, no stub to resume (confirmed by investigation)

No "research-currency"/"Uranium injection" TODO or dormant branch exists anywhere in
`game-server/src` — Phase 9's "stub" reference is doc-only. Per `RESOURCE_ECONOMY.md`'s Uranium
section: *"A nation with uranium access that completes a specific tech node receives a large,
one-time boost to its research currency."* This branch invents the wiring from `RESEARCH.md`'s
spec directly: a new `effects` entry type, `{"type": "uranium_injection", "amount": {"science":
N}}`, placed on exactly one sample node (e.g. a General-branch "Uranium Research Program" node —
Uranium itself has no unit/building tree of its own, so General is the natural home). On
completion, if `nation.resources.get("uranium") ?? 0 > 0` (per the design's "uranium access"
framing — presence, not a stock threshold, since Uranium's own mechanic per
`RESOURCE_ECONOMY.md` is "mine is deliberately cheap and simple, the bottleneck is entirely on
the research side"), grant the one-time `science` amount. **Do not build a second, general-
purpose "resource-gated currency injection" system** — this is confirmed to be Uranium's one
documented special case, not a pattern other resources share (`RESOURCE_ECONOMY.md` explicitly
chose this over an alternative to "keep uranium mechanically simple... one clear use case, not
two competing ones" — do not generalize past what's asked).

### Refund/forfeit math — no existing partial-refund precedent, confirmed new (`unit_production_system.ts:303-316`, `GameRoom.ts:803-824`)

`CANCEL_MARSHALLING` and `CANCEL_MARKET_ORDER` are both **full** refunds of exactly what was
reserved — no forfeit percentage anywhere in this codebase to crib from. Build fresh from
`RESEARCH.md`'s Cancelling In-Progress Research section:
```
invested_so_far = (1 - points_remaining/points_total) * cost   // per resource, money & science
refund          = invested_so_far * RESEARCH_CANCEL_REFUND_RATE // TBD playtesting constant, 0-1
forfeit         = invested_so_far - refund
```
`refund` credited back to `nation.resources.money` / `nation.science_points`; `forfeit` is
simply not credited (matches Phase 9's "burned, not redistributed" convention for the spot
market spread, same "money sink" precedent).

### `test-lanes.json` — `research` lane will already exist post-Branch-A; extend, don't create (`test-lanes.json`, `economy` lane at lines 102-120 for shape reference)

Branch A adds the `research` lane. This branch appends its own test file to that lane's
`tests` array and its new source file(s) to `source_prefixes` — do not recreate the lane.

---

### Client — `economy_panel.gd` (326 lines, real merged Phase 9 code)

**Resources tab** (`_refresh_resources()`, lines 98-140) iterates a fixed `RESOURCE_ORDER`
array (lines 10-11, ten entries: money…uranium) — **no science row today.** Each row is a fresh
`HBoxContainer` (name label, amount, rate, conditional cap `ProgressBar`, lines 107-135).
Science needs a new row added to this function, reading `GameState.science_points` (a sibling
scalar, confirmed present client-side already at `game_state.gd:53` and populated by
`_apply_resource_updates` at line 179 — **already flows to the client today**, this branch just
needs to render it) — **not** iterated from `RESOURCE_ORDER` since it isn't in the `resources`
Dictionary at all, it's a separate field. Add it as one extra hand-written row after the
`RESOURCE_ORDER` loop, same visual shape as the others but sourced differently.

**Industry tab sliders** (`_build_industry_sliders()`/`_add_slider_group()`, lines 143-212) —
three groups: `COMMON_SLICES`, `RESTRICTED_SLICES`, `NATIONAL_SLICES` (lines 13-15). Add
`"research_speed"` to `NATIONAL_SLICES` alongside `"construction_speed"`/
`"unit_production_speed"` — the slider-row construction code (lines 191-210) is fully generic
over slice key, no new code needed beyond adding the key to the array and a display-name lookup.
Submit-on-release pattern (`drag_ended` → `_submit_allocation()`, line 210) already generic,
unchanged.

**No insufficient-funds/disabled-when-unaffordable pattern exists anywhere in this codebase**
(confirmed: `province_detail_panel.gd`'s Build/Upgrade buttons only disable for max-level or
zero-deposit, never affordability — `_populate_action_slot()`, lines 215-242). **This branch
originates that visual pattern** for research cards — there is nothing to reuse, only to invent
once and apply consistently.

### Notification/toast — reusable as-is, has a `"research"` category already (`event_bus.gd:78`, `notification_feed.gd`)

```gdscript
signal notification_requested(message: String, type: String)
```
`notification_feed.gd`'s `push_notification()` already maps `type == "research"` to a teal
accent + "RESEARCH" title (`_get_type_color`/`_get_type_title`). This branch reuses it directly
for the cancel-refund report: `EventBus.notification_requested.emit("Cancelled: Improved APC —
refunded 3.1, forfeited 3.1", "research")` — plain fire-and-forget text, no structured/numeric
UI needed, no new widget.

### The research drawer's card fields — what changes (post-Branch-A state, current baseline confirmed at `research_drawer_panel.gd:106-159`)

Current (pre-Branch-A) baseline: `meta.text = "%s - Research points: %d" % [entry.get("column",
"Research"), int(entry.get("science_value", 0))]` (lines 134-137) — a single placeholder int.
Per Branch A's plan, this becomes a real `{money, science}` cost pair read from the JSON node's
`cost` field; this branch's job is making that displayed pair (a) reflect the real non-zero
values authored in Step 1 below, (b) reflect the *live* concurrency-adjusted price (recomputed
at render time from `nation.active_research_count`, not the flat authored value), and (c) show
an insufficient-funds visual state when `GameState.resources.money`/`GameState.science_points`
can't cover it.

**No Cancel affordance exists on in-progress cards today** — confirmed, the only state
difference between an active and available card is border color + status text
(`_make_card_style`, is_active flag). This branch adds one, following the one existing
plain-button-no-preview precedent in this codebase, `military_panel.gd:172-177`'s
`CANCEL_MARSHALLING` button:
```gdscript
var btn_cancel := Button.new()
btn_cancel.text = "Cancel"
btn_cancel.pressed.connect(func() -> void:
    CommandQueue.submit("CANCEL_MARSHALLING", {"marshalling_id": mid})
)
```
Same shape, `CANCEL_RESEARCH` instead — submit immediately, no confirmation dialog (that
richer "show numbers before committing" step is explicitly `RESEARCH_UI_HANDOFF.md` §6.6's job,
Branch C's popup system) — the refund/forfeit numbers this branch shows arrive **after** the
fact, via the toast above, once the server responds with the actual computed amounts.

### `GameState.gd` — `_apply_resource_updates`, full current body confirming `science_points` already client-synced (`game_state.gd:172-185`)

```gdscript
func _apply_resource_updates(data: Dictionary) -> void:
    for key: String in data.get("resources", {}):
        resources[key] = data["resources"][key]
    resource_net_rates = data.get("net_rates", {})
    manpower_available = data.get("manpower_available", manpower_available)
    manpower_ceiling = data.get("manpower_ceiling", manpower_ceiling)
    chromium_available = data.get("chromium_available", chromium_available)
    science_points = data.get("science_points", science_points)
    convoy_capacity = data.get("convoy_capacity", convoy_capacity)
    oil_priority = data.get("oil_priority", oil_priority)
    oil_penalty_active = data.get("oil_penalty_active", false)
    resource_storage_cap = data.get("resource_storage_cap", resource_storage_cap)
    industry_alloc = data.get("industry_alloc", industry_alloc)
    EventBus.resources_updated.emit()
```
Confirms `science_points` is already a top-level `float` field (`game_state.gd:53`), populated
here, field name exactly `science_points` (not `science`) — this branch's Economy panel Science
row and research-card cost display both read `GameState.science_points` directly, no new
client-side plumbing needed for the read side. `industry_alloc: Dictionary` is likewise already
client-synced (line unchanged) — the new `"research_speed"` key just needs to be readable from
it once the server starts sending it, no `_apply_*` change needed here at all.

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/src/data/research_stats.ts` | `RESEARCH_CONCURRENCY_COST_STEP`, `RESEARCH_CANCEL_REFUND_RATE`, `URANIUM_INJECTION_SCIENCE_AMOUNT` — TBD-playtesting placeholder constants |
| `game-server/test/11b-research-currency.test.ts` | All Branch B server tests |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/systems/research_system.ts` (Branch A) | Cost check-then-deduct in `startResearch()`; concurrency cost multiplier at cost-computation time; `industrySliceMultiplier("research_speed")` wired into `tick()`'s progress rate, replacing the flat placeholder; refund/forfeit math in `cancelResearch()`; Uranium injection effect handling in the completion path |
| `client/assets/data/research/*.json` (Branch A) | Replace placeholder `cost: {money:0, science:0}` with real small placeholder-but-nonzero values (still TBD-playtesting, just no longer literally free) |
| `client/src/ui/hud/economy_panel.gd` | New Science row (Resources tab); new `"research_speed"` slider (Industry tab, `NATIONAL_SLICES`) |
| `client/src/ui/hud/research_drawer_panel.gd` (Branch A) | Cost display becomes real `{money, science}` pair, live concurrency-adjusted, insufficient-funds visual state; new Cancel button on in-progress cards |
| `client/src/systems/research/research_tree_view.gd` (Branch A) | Same cost-display/insufficient-funds/Cancel treatment applied to Full Tree cards, mirroring the drawer |

---

## Step 1: Real cost values + `research_stats.ts` constants (TDD)

### 1a. Author real (still placeholder-magnitude) costs

Update the JSON files' `cost` fields to small nonzero `{money, science}` pairs — e.g. tier-1
nodes `{money: 20, science: 10}`, scaling up per tier, same "TBD playtesting, monotonically
increasing" convention every other cost table in this codebase already uses. Not this branch's
job to balance — just to stop being literally zero so the rest of the mechanism is testable.

### 1b. `research_stats.ts`

```typescript
export const RESEARCH_CONCURRENCY_COST_STEP = 0.25; // TBD playtesting — +25% cost per
                                                       // additional simultaneous project, uncapped
export const RESEARCH_CANCEL_REFUND_RATE = 0.5;       // TBD playtesting — fraction of invested
                                                       // currency refunded on cancel
export const URANIUM_INJECTION_SCIENCE_AMOUNT = 50;   // TBD playtesting — one-time science boost
```

### 1c. Test (minimal — this is pure data)

```typescript
describe("lane:research | research_stats constants", () => {
  it("every branch JSON file's nodes have nonzero cost after this branch's authoring pass", () => {});
});
```
Run just this file while iterating (see Context note) — do not run the full suite.

---

## Step 2: Concurrency cost curve

### 2a. Tests

```typescript
describe("lane:research | Concurrency cost curve — rising price, not a hard limit", () => {
  it("a nation's Nth concurrent project's charged cost is higher than its 1st, scaling with active_research_count at start time", () => {});
  it("starting a 5th, 6th, ... concurrent project is never rejected outright for being 'too many' — soft cap via price only", () => {});
  it("an already-active project's charged cost does not retroactively change when a later project starts (locked in at its own start time)", () => {});
});
```

### 2b. Implement

```typescript
export function researchConcurrencyCostMultiplier(activeCountBeforeThisOne: number): number {
  return 1.0 + activeCountBeforeThisOne * RESEARCH_CONCURRENCY_COST_STEP; // rising, uncapped —
    // deliberately NOT the industrySliceMultiplier shape (that one saturates/caps; this one
    // should keep climbing, since its whole job is discouraging — not merely diminishing —
    // ever-more parallel research)
}
```
Called once, at `startResearch()` time, against `nation.active_research_count` (the count
*before* this new project is added) — the computed `{money, science}` cost at that moment is
what's charged and what `points_total`/refund math is based on; it is not recomputed later for
that project even if the nation's concurrent count changes afterward.

**Manual verification:** covered together with Step 5's UI checkpoint below.

---

## Step 3: `START_RESEARCH` real cost check-then-deduct

### 3a. Tests

```typescript
describe("lane:research | START_RESEARCH cost enforcement", () => {
  it("insufficient money OR insufficient science each independently reject the request, no partial deduction", () => {});
  it("on success, both money and science are deducted by the concurrency-adjusted cost, atomically", () => {});
});
```

### 3b. Implement

Mirror `BUILD_BUILDING`'s two-pass shape (Critical Pre-Read) exactly, computing the node's
`{money, science}` cost via `researchConcurrencyCostMultiplier(nation.active_research_count)`
first, checking `nation.resources.get("money")` and `nation.science_points` against it, only
then deducting both and incrementing `active_research_count`.

**Manual verification:** covered together with Step 5's UI checkpoint below.

---

## Step 4: Anti-snowball floor — wire `industrySliceMultiplier("research_speed")` into the tick rate

### 4a. Tests

```typescript
describe("lane:research | Research speed scales with industry allocation, never reaches a hard minimum", () => {
  it("0% research_speed allocation still progresses at the base rate (never a precondition)", () => {});
  it("100% allocation completes faster than 0%, but the per-tick rate never exceeds industrySliceMultiplier's own asymptotic cap", () => {});
});
```

### 4b. Implement

In `ResearchSystem.tick()`, replace Branch A's flat
`RESEARCH_PROGRESS_PER_TICK_PLACEHOLDER` decrement with:
```typescript
const rate = RESEARCH_PROGRESS_PER_TICK_PLACEHOLDER * industrySliceMultiplier(nation.industry_alloc.get("research_speed") ?? 0);
project.points_remaining = Math.max(0, project.points_remaining - rate);
```
Import `industrySliceMultiplier` from `resource_economy_system.ts` — do not redefine it.

**Manual verification (required):** drag the new Research slider (Economy panel, Industry tab)
to a high value, confirm an in-progress node's completion visibly speeds up over the next few
ticks on a saturating (not linear) curve, same visual confirmation pattern Phase 9's own
Industry Pool verification used.

---

## Step 5: `CANCEL_RESEARCH` refund/forfeit math

### 5a. Tests

```typescript
describe("lane:research | Cancel refund math", () => {
  it("invested_so_far, refund, and forfeit are computed from (1 - points_remaining/points_total) * cost at cancel time — not stored per-project fields", () => {});
  it("refund is credited back to nation.resources.money and nation.science_points respectively; forfeit is not credited anywhere (burned, matching the spot-market-spread convention)", () => {});
  it("cancelling resets progress to 0 and removes the project from active_projects — re-starting later begins from scratch, per RESEARCH.md", () => {});
});
```

### 5b. Implement

Per the Critical Pre-Read formula. Broadcast the computed numbers in the same
`RESEARCH_UPDATES` (or a dedicated small payload) so the client can report them via the toast in
Step 6 — do not make the client recompute this math itself from raw progress/cost, since the
concurrency-adjusted cost that was actually charged at start time is server-authoritative state
the client doesn't independently track.

**Manual verification:** covered together with Step 6's UI checkpoint below.

---

## Step 6: Uranium injection

### 6a. Test

```typescript
describe("lane:research | Uranium research-currency injection", () => {
  it("completing the Uranium Research Program node with uranium stock > 0 grants a one-time science boost", () => {});
  it("completing it with zero uranium stock grants nothing — the node still completes (no production block, per RESOURCE_ECONOMY.md's Uranium mechanic being research-bound not geography-bound for the mine itself, but the INJECTION specifically requires access)", () => {});
});
```

### 6b. Implement

One new `effects` entry type consumed only in the completion path (Step 3's/Branch A's
`_applyNodeEffects`): `{"type": "uranium_injection", "amount": {"science": N}}` — checks
`nation.resources.get("uranium") ?? 0 > 0` at completion time, adds `amount.science` to
`nation.science_points` if true. No new generic system — this is the one documented special
case, not a pattern to extend to other resources (Critical Pre-Read).

**Manual verification:** bot-script or manually set a nation's uranium stock to a nonzero value
(existing `APPLY_PERKS`-adjacent test-only mutation pattern, or Phase 9's dev-set resource
handler if one exists — locate before inventing a new one), complete the Uranium node, confirm
science_points jumps by the injection amount on top of its normal per-tick trickle.

---

## Step 7: Client — Science row, Research slider, real cost display, insufficient-funds, Cancel

### 7a. Economy panel

Add the Science row to `_refresh_resources()` (reads `GameState.science_points`, same visual
row shape as the other ten, no cap/progress-bar since science has no `resource_storage_cap`
entry — confirm this is actually true before assuming, since Warehouse's cap dictionary might
already default-include it; if so, render the bar too, for consistency). Add `"research_speed"`
to `NATIONAL_SLICES`.

### 7b. Research card cost display + insufficient-funds (drawer + full tree)

Replace the placeholder `"Research points: %d"` line with a real cost pair, computed live:
```gdscript
var base_cost: Dictionary = entry.get("cost", {"money": 0, "science": 0})
var multiplier: float = 1.0 + float(GameState.active_research_count) * RESEARCH_CONCURRENCY_COST_STEP_CLIENT_MIRROR
var money_cost: int = int(ceil(base_cost.get("money", 0) * multiplier))
var science_cost: int = int(ceil(base_cost.get("science", 0) * multiplier))
meta.text = "$%d · 🔬%d" % [money_cost, science_cost]
var affordable: bool = GameState.resources.get("money", 0) >= money_cost and GameState.science_points >= science_cost
meta.modulate = Color.WHITE if affordable else Color(0.85, 0.3, 0.3) # first insufficient-funds pattern in this codebase — keep it this simple, a color change, nothing fancier
```
**`GameState.active_research_count` needs to exist client-side** — confirm Branch A actually
synced it (its plan's `NationResearchData` serialization should include it in `RESEARCH_UPDATES`
payloads; if it was missed, add the one-line read here rather than reverse-computing it from
`active_projects.size()` locally, since the server is authoritative on this count).
`RESEARCH_CONCURRENCY_COST_STEP_CLIENT_MIRROR` — client-side display-only mirror of the server
constant (Step 2b), used purely for showing the player what the price *will* be before they
click; the server remains the source of truth on the actual charge (Step 3), so a mismatch here
is a display bug, never an exploit.

### 7c. Cancel button on in-progress cards

Per the Critical Pre-Read's `CANCEL_MARSHALLING`-button precedent — add a plain `Button`,
visible only when the card's state is "Researching," wired directly to
`CommandQueue.submit("CANCEL_RESEARCH", {"node_id": entry_id})`, no confirmation step (that's
Branch C's job). On the resulting `RESEARCH_UPDATES` broadcast carrying the refund/forfeit
numbers (Step 5b), emit the toast:
```gdscript
EventBus.notification_requested.emit(
    "Cancelled: %s — refunded %d, forfeited %d" % [node_name, refund_total, forfeit_total],
    "research"
)
```

**Manual verification (required, this branch's primary visual checkpoint):** open the Economy
panel, confirm a Science row now appears alongside the ten resources with a real ticking value.
Open the Research sidebar, confirm a node's card shows a real `$X · 🔬Y` cost instead of the old
placeholder — start one project, confirm money/science visibly decrease by that exact amount.
Start a second concurrent project on a node with the same base cost — confirm its displayed (and
actually-charged) cost is visibly higher than the first's was. Try to start a node you can't
afford — confirm the insufficient-funds color cue appears and the click is rejected (server-side;
confirm no currency was deducted). Cancel an in-progress node — confirm a toast reports the exact
invested/refunded/forfeited numbers and the currency partially returns. Drag the new Research
slider in the Industry tab — confirm an in-progress node's completion visibly speeds up.

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| The anti-snowball floor needs a new curve function | **Wrong** — `industrySliceMultiplier` (Phase 9, `resource_economy_system.ts:54-57`) already has exactly the right saturating shape; import and reuse it for a new `"research_speed"` industry_alloc slice, don't reinvent |
| The concurrency cost curve and the anti-snowball speed curve are the same mechanic | **Wrong** — concurrency cost curve makes research cost *more* the more you run at once (rising, uncapped, a genuinely new function); the anti-snowball floor makes research complete *faster* the more industry you allocate (saturating, reused from Phase 9). Keep them separate |
| Uranium's injection is a general "resource-gated bonus" system other resources might also use later | **Wrong** — `RESOURCE_ECONOMY.md` explicitly chose this as Uranium's one documented special case specifically to avoid "two competing use cases"; do not build general infrastructure for it |
| There's an existing partial-refund-with-forfeit pattern to copy for `CANCEL_RESEARCH` | **Wrong** — confirmed by investigation, `CANCEL_MARSHALLING`/`CANCEL_MARKET_ORDER` are both full refunds; the invested/refund/forfeit math is genuinely new, built from `RESEARCH.md`'s spec alone |
| `science_points` already has a sink from some earlier phase | **Wrong** — confirmed zero decrements anywhere in the codebase before this branch; this is its first real consumer |
| Cancel needs a confirmation-dialog-with-preview-numbers before this branch is "done" | **Wrong for this branch** — that's explicitly `RESEARCH_UI_HANDOFF.md` §6.6 / Branch C's job; this branch's Cancel is a plain immediate button (matching the one existing `CANCEL_MARSHALLING` precedent), refund numbers reported *after* the fact via toast |
| `research_drawer_panel.gd`'s current (pre-Branch-A) code is what this branch modifies | **Wrong** — this branch assumes Branch A already rewired it to route through `CommandQueue`/`GameState.research`; the investigation's quoted line numbers describe the *pre-Branch-A* baseline for context, not the file this branch actually edits line-for-line |
