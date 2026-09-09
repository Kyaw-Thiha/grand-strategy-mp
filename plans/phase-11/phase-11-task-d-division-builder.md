# Branch D — `feat/research-division-builder`

## Context

**Prerequisite: Branches A, B, and C merged.** This branch assumes Branch A's
`resolveLineageUnitType()`, `improved_apc`/`ifv` unit types, and `researched_perks`; Branch C's
node-badge visual language (⚙▣⇄➕) and `GameState.research`. This branch does **not** touch the
research panels themselves — it's the other side of the integration: DivisionBuilder chain-tier
selection at the unit-slot level, the Motorisation toggle, and standing up the (currently
completely dead) Unit Profile component for structural research-driven changes.

**Two real landmines found by investigation, not hypothetical — read before implementing:**

1. **`mechanised_infantry` is not in `ELIGIBLE_UNITS` at all today.** `division_builder_panel.gd`'s
   static `ELIGIBLE_UNITS` array (five rows) never lists `mechanised_infantry`, `improved_apc`,
   or `ifv` anywhere — a player cannot place any of the Armoured lineage chain's mechanised
   tiers in a division template right now, at all, regardless of research. This branch adds
   them, not just gates their visibility.
2. **A literal `unit_type` swap to `"motorised_infantry"` would make the division immobile
   today.** `game-server/src/data/unit_terrain_costs.ts` has no `motorised_infantry` entry, and
   `movement_system.ts:737`'s `UNIT_TERRAIN_COSTS[cell.unit_type]` lookup treats any missing key
   as `Infinity` at every terrain type (`movement_system.ts:738`) — a division with an unmapped
   cell's movement profile becomes `Infinity` everywhere, i.e. it cannot move at all. **This
   branch must add a real `motorised_infantry` terrain-cost row (faster than base `infantry`'s,
   since faster movement is the entire point) before wiring any UI that can produce this
   `unit_type`.** Confirmed separately: `infantry` and `motorised_infantry`'s
   `UNIT_COMBAT_STATS` entries are already byte-identical (`unit_combat_stats.ts:17,41`) —
   correctly matching `TACTICAL_COMBAT.md`'s "zero change to 5×5 grid combat stats" claim; it's
   only the movement-cost table that's missing, not the combat stats.

**Motorisation's real scope, resolved:** `TACTICAL_COMBAT.md`'s prose names six motorisable
infantry-family types (standard, assault, MG, AT infantry, recon infantry, flamethrower), but
the `UnitType` enum only has **one** motorised swap-target, `motorised_infantry`, matching only
base `infantry` — confirmed, no `motorised_assault_infantry`/`motorised_mg`/etc. exist anywhere.
Consistent with this phase's overall "generic mechanism now, real content later" scope: **this
branch builds the toggle mechanism generically** (works for any base type with a declared
motorised counterpart) **but only wires the one pair that actually exists**
(`infantry` ↔ `motorised_infantry`) **for real.** Adding the other five types/terrain-cost rows
is explicitly deferred to the same future content-authoring pass as building perk trees and
real doctrine content — not this branch's job, and not a silent gap (document it).

**Server-side validation is deliberately NOT hardened in this branch.** Both `ASSIGN_TEMPLATE`
(`GameRoom.ts:223-259`) and `RAISE_DIVISION` (`GameRoom.ts:620-637`) accept any client-supplied
`unit_type` string with zero validation against `researched_perks` today — confirmed still true
in current code. This branch relies on `RESEARCH.md`'s actual guarantee ("a template never
breaks," delivered by Branch A's `resolveLineageUnitType()` fallback resolving an
under-researched selection down to whatever's actually available) rather than adding hard
server-side rejection — client-side filtering (this branch) keeps the eligible list honest for
a normal player, and the fallback keeps an inconsistent/stale template harmless rather than
broken. Adding server-side rejection as defense-in-depth is a legitimate future hardening pass,
explicitly out of scope here (matches this codebase's existing permissive pattern elsewhere).

**Keep test runs minimal and targeted.** This branch is almost entirely client-side; if any
server-side test is genuinely needed (the terrain-cost fix), run only that targeted file, not
`npm test`.

---

## Critical Pre-Read

### `division_builder_panel.gd` — `ELIGIBLE_UNITS`, current five rows (no lineage types present)

```gdscript
const ELIGIBLE_UNITS: Array = [
    ["recon_infantry", "force_recon_sniper", "cavalry", "armoured_car", "light_tank", "commando"],
    ["medium_tank", "heavy_tank", "assault_infantry", "infantry", "at_gun_sp", "self_propelled_gun"],
    ["artillery", "howitzer", "at_gun", "mg", "aa_gun", "flamethrower"],
    ["infantry", "assault_infantry", "at_infantry", "commando", "sniper"],
    ["infantry", "mg", "at_infantry", "sniper"],
]
```
Row 1 (medium/heavy tank row) is the natural home for `mechanised_infantry`/`improved_apc`/
`ifv`, matching `TACTICAL_COMBAT.md`'s tree (`Medium tank → Mechanised infantry (APC) →
Improved APC → IFV`). This branch replaces the raw array read at `_refresh_cell_selected_panel`
(`~541-543`, `for unit_type in ELIGIBLE_UNITS[row]: ...`) with a function computing the
*effective* eligible list per row, folding in research state.

### `_make_unit_card()` — full current behavior, fully local, no network call at click time (`division_builder_panel.gd:548-622`)

Renders a `UnitGlyphCell` mini-icon, name, abbreviation, an "IN CELL" badge if already placed,
and a description. Click (`gui_input`, 610-616, and the glyph's `cell_clicked` signal, 618-620)
calls a local `place_unit` closure (601-608) that **only mutates the local `_cells` array** —
`_save_template()`/`ASSIGN_TEMPLATE` submission happens later, elsewhere. This means research-
based eligibility filtering is a **pure client-side list-construction concern** — no new command
handler or network round-trip needed for gating itself, only for what actually reaches the
server once the template is saved (already covered by existing `ASSIGN_TEMPLATE`/
`RAISE_DIVISION`, per the "not hardened" note above).

### §6.1a (`UI_UX_DESIGN.md`) — already satisfied, not a gap to fix

Investigation confirms `_restore_detail_for_cell()` (635-646), called unconditionally at the end
of every `_refresh_cell_selected_panel()`, already shows the placed unit's card immediately on
clicking a filled cell (639-644) versus a generic empty-state placeholder for an empty cell
(645-646) — this already matches `UI_UX_DESIGN.md` §6.1a's requirement. **The doc's "implicit
gap" framing describes a state this code no longer has** — do not spend branch time "fixing"
something already correct; just don't regress it while adding badges/motorised-toggle/info-
button to the same cards.

### Movement/terrain cost lookup — the exact call site that breaks on an unmapped type (`movement_system.ts:733-748`)

```typescript
const unitCosts = UNIT_TERRAIN_COSTS[cell.unit_type];    // line 737
if (!unitCosts) { /* every terrain cost treated as Infinity */ }  // line 738
...
if (costs.some(c => c === Infinity)) { profile[key] = Infinity; continue; }
```
This is the same call site Branch A's plan flagged generically ("grep for `UNIT_COMBAT_STATS[`
and every other direct consumer... movement") — **now concretely identified.** Confirm before
implementing whether Branch A actually wired `resolveLineageUnitType()` into this exact line (it
should have, per its own plan's instruction to cover movement lookups); if it didn't, this
branch must add that resolution here too, since an `improved_apc`/`ifv` cell needs to resolve to
whichever tier's movement costs actually exist in `UNIT_TERRAIN_COSTS` (confirm those entries
exist — likely inherited from `mechanised_infantry`'s row unless Branch A/this branch adds
tier-specific rows; if no tier-specific movement difference is designed, reuse
`mechanised_infantry`'s row for all three tiers rather than leaving `improved_apc`/`ifv`
unmapped and hitting the same immobile-division bug this branch is fixing for
`motorised_infantry`).

### `unit_combat_stats.ts` — confirms motorisation really is stat-neutral

```typescript
[UnitType.INFANTRY]:      { pen: 10, armour: 0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0, chromium_gated: false }, // line 17
[UnitType.MOTORISED_INF]: { pen: 10, armour: 0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0, chromium_gated: false }, // line 41
```
Byte-identical — no combat-stat work needed for the toggle, only movement costs (below) and UI.

### `unit_terrain_costs.ts` — the missing row this branch adds

No `motorised_infantry`/`mechanised_infantry` key exists anywhere in this file today (confirmed
by grep). `infantry`'s existing row (line ~80) is the template to copy and speed up for the new
`motorised_infantry` row — same shape, faster road/off-road values, matching
`RESOURCE_ECONOMY.md`/`TACTICAL_COMBAT.md`'s framing of motorisation as "on-road and off-road
movement costs improve to motorised profile values."

### `unit_profile.gd` — fully dead code, zero call sites, this branch makes it real

```gdscript
extends PanelContainer
## UnitProfile — placeholder for Phase 6.
func _ready() -> void: pass
func cycle_sub_tab(forward: bool) -> void: pass
func show_unit(unit_id: String) -> void: pass
func clear() -> void: pass
```
Confirmed via `grep "show_unit(" -r client/src/`: only the definition itself, no caller anywhere.
This branch is the first to wire it to anything.

### `UI_UX_DESIGN.md` §6.2 vs. §6.6 — resolving an apparent tension, not a contradiction

§6.2 rejects "a per-row info button" on the eligible list **in the context that existed when
that section was written** (no deeper view existed to justify one — hover-preview was
sufficient). §6.6, written for the Unit Profile component specifically, explicitly *reinstates*
a dedicated info affordance ("visible in the eligible list, and on the compact detail callout —
clicking it opens the Unit Profile") precisely because Unit Profile is new, genuinely deeper
content that a hover tooltip cannot hold. Read these as sequential, not conflicting: hover stays
the lightweight scan path (unchanged, still click = place); a **small, separate "ℹ" affordance**
is what §6.6 is asking for, additive to the existing click-to-place behavior, not a replacement
for it.

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/test/11d-lineage-movement.test.ts` | Targeted test for the new `motorised_infantry` terrain-cost row + confirming `resolveLineageUnitType()` covers the movement call site |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/data/unit_terrain_costs.ts` | New `motorised_infantry` row (faster than `infantry`'s) |
| `game-server/src/systems/movement_system.ts` | Confirm/add `resolveLineageUnitType()` coverage at line 737's lookup, per the Critical Pre-Read |
| `client/src/ui/hud/division_builder_panel.gd` | `ELIGIBLE_UNITS` row 1 gains `mechanised_infantry`/`improved_apc`/`ifv` (research-gated); `_make_unit_card()` gains badges, a Motorised toggle on eligible `infantry`, and an "ℹ" info affordance |
| `client/src/ui/hud/unit_profile.gd` | Real implementation: identity header, current stats, research outlook (structural vs. stat-delta), minimal attack-pattern text (no diagram this branch), optional flavour text |
| `client/scenes/game/panels/division_builder_panel.tscn` | Toggle/info-button child nodes on the eligible-unit card template |
| `client/scenes/.../unit_profile.tscn` (if it doesn't already have real structure — confirm) | Real layout for the sections above |

---

## Step 1: Fix the movement landmine first — `motorised_infantry` terrain costs

### 1a. Test

```typescript
describe("lane:movement | motorised_infantry terrain costs", () => {
  it("a division with a motorised_infantry cell has a finite (not Infinity) movement profile at every terrain key", () => {});
  it("motorised_infantry's road cost is lower than infantry's own road cost — the whole point of the toggle", () => {});
});
```
Run just this file while iterating; no full suite.

### 1b. Implement

Add a `motorised_infantry` row to `unit_terrain_costs.ts`, copied from `infantry`'s existing
row with road/off-road values improved (TBD-playtesting placeholder, same convention as every
other numeric table in this codebase — just needs to be genuinely faster, not precisely tuned).

**Manual verification:** none yet in isolation — covered by Step 3's checkpoint (a division
with a motorised infantry cell must actually be able to move on the map).

---

## Step 2: Lineage-chain eligibility — `mechanised_infantry`/`improved_apc`/`ifv` in the builder

### 2a. Client-side eligible-list computation

Replace the raw `ELIGIBLE_UNITS[row]` read with a function:
```gdscript
func _get_effective_eligible_units(row: int) -> Array:
    var base: Array = ELIGIBLE_UNITS[row].duplicate()
    if row == 1: # medium/heavy tank row — the Armoured lineage's home
        base.append("mechanised_infantry") # always available once medium_tank is researched —
                                              # confirm this prerequisite via GameState.research,
                                              # do not add unconditionally
        if GameState.research.get("researched_node_ids", []).has("armour_mechanisation_improved_apc"):
            base.append("improved_apc")
        if GameState.research.get("researched_node_ids", []).has("armour_mechanisation_ifv"):
            base.append("ifv")
    return base
```
**Do not show all three lineage tiers simultaneously as separate, independently-placeable
options once IFV is researched** — per `RESEARCH.md`'s lineage-chain framing, once a higher tier
is researched, that IS the unit now (the lower tiers stay placeable in the *sense* that a
template referencing them still resolves live to the highest tier per `resolveLineageUnitType`,
so the base `mechanised_infantry` entry can stay in the list without harm — it will just always
resolve up to whatever's actually researched at combat/movement time). This is a deliberate
simplification: **the eligible list shows every unlocked tier as its own card** (so the player
can see what they've achieved and place any of them), but the game's live-resolution rule
means placing the lower one is functionally identical to placing the higher one once the higher
is researched — document this rather than trying to hide lower tiers, which would fight the
"never breaks, never surprises" design intent.

### 2b. Motorised toggle on eligible `infantry` cards

Per the scoped-down design (Critical Pre-Read) — only `infantry` gets this, this branch. In
`_make_unit_card()`, when `unit_type == "infantry"` and
`GameState.research.get("researched_perks", []).has("motorisation_unlocked")` (the perk id
Branch A's plan assigns to the Motorisation node), add a small `CheckBox` labeled "Motorised."
Toggling it does not change which card is shown — it changes what `place_unit`'s closure
actually writes into `_cells[target_index]`: `"motorised_infantry"` instead of `"infantry"`
when checked. The "IN CELL" badge logic (`_cells[target_index] == unit_type`) needs a small
adjustment to also match on the toggled variant, so a motorised cell still shows as occupied by
the `infantry` card with its checkbox pre-checked, not as a phantom unmatched state.

**Manual verification (required, this branch's primary checkpoint):** research Mechanised
Infantry (APC), open the Division Builder, select a cell in the tank/mechanised row, confirm
"Mechanised Infantry" now appears in the eligible list (it does not today). Place it, save the
template, raise a division from it, confirm the fielded division's stats match `mechanised_
infantry`'s values. Research Improved APC — without re-saving the template — confirm the same
fielded division's effective stats update live (per Branch A's live-recompute). Separately,
research Motorisation, select an `infantry`-eligible cell, confirm a "Motorised" checkbox
appears; check it, place, save, raise a division — confirm it actually moves on the strategic
map (this is the landmine check) and moves *faster* on roads than an otherwise-identical
non-motorised infantry division.

```
Eligible-unit card, post-Branch-D (mechanised row, motorised toggle example):
┌───────────────────────────────────┐
│ [glyph] Infantry              ℹ   │  ← info affordance, opens Unit Profile
│ ☐ Motorised                        │  ← only shown when Motorisation researched
│ Standard rifle infantry...          │
└───────────────────────────────────┘

┌───────────────────────────────────┐
│ [glyph] Mechanised Infantry   ℹ   │
│ ⚙▣ (badges, matching Branch C's    │  ← badge glyphs reused from the research
│    node badge language)            │    node's own badges, for visual continuity
│ Armour → Mech. Inf. chain           │
└───────────────────────────────────┘
```

---

## Step 3: Unit Profile — real implementation

### 3a. Sections built this branch (per `UI_UX_DESIGN.md` §6.6, priority order)

1. **Identity header** — unit name + whatever the current renderer produces (the existing
   glyph/abbreviation system, per §6.6's explicit "renderer-agnostic from the start" framing —
   no new art needed, just don't hardcode a specific renderer assumption).
2. **Current stats** — same numbers as the compact eligible-list card, given more room.
3. **Attack pattern** — **text description only this branch** (e.g. "Column-priority, vertical
   attack pattern" for armour types) — the full diagram treatment reusing Tactical Combat
   Panel's overlay-shape visual language (§6.6, §7) is explicitly deferred, flag it as a
   follow-up rather than building it here; this branch's job is the research-integration
   sections below, not a combat-visualization component.
4. **Research outlook** — the section that actually matters for this phase's integration:
   ```gdscript
   func _build_research_outlook(unit_type: String) -> void:
       var next_nodes: Array = _find_next_research_nodes_for(unit_type) # nodes whose
           # unlocks_unit_type/perk effect targets this unit_type and aren't researched yet
       for node: Dictionary in next_nodes:
           if node.get("badges", []).any(func(b): return b in ["mechanic", "lineage"]):
               # structural change — labelled callout, plain language, NOT a stat-delta arrow
               _add_structural_callout("🔬 %s — %s" % [node.name, node.description])
           else:
               # pure additive/redistribute — before/after value pair
               _add_stat_delta_row(node)
   ```
   Badge-driven branching reuses Branch A/C's existing `badges` taxonomy directly — no new
   classification system invented.
5. **Flavour blurb** — lowest priority, shown only if the node/unit data actually has one;
   omit the section entirely rather than rendering an empty placeholder if not.

### 3b. Wire the trigger

Add the small "ℹ" `Button` to `_make_unit_card()` (Step 2b's mockup) and to the compact detail
callout, both calling `EventBus`-routed (or direct method call, since Unit Profile isn't
`HUDManager`-registered as a separate modal per §6.6's framing of it as "replacing or expanding
the right column" — confirm whether it should occupy the DivisionBuilder's own right-column
space or open as its own overlay; **default to expanding the right column in place**, matching
§6.6's literal wording, rather than adding another popup layer) `unit_profile.get_node(...)
.show_unit(unit_type)`.

**Manual verification (required):** click the "ℹ" affordance on Mechanised Infantry's card —
confirm Unit Profile opens (in-place, right column) showing identity/stats/attack-pattern-text/
research-outlook sections; confirm a structural research node (e.g. Improved APC) renders as a
labelled callout, not a numeric delta, while a hypothetical pure-additive sample node (from
Branch A's sample content on another branch, for contrast-testing this logic) renders as a
before/after pair.

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| §6.1a's filled-vs-empty distinct click state is an outstanding gap this branch must fix | **Wrong** — confirmed already correct in current code (`_restore_detail_for_cell()`); the design doc's "implicit gap" language describes a prior, already-fixed state. Don't spend time here, just don't regress it |
| Motorisation should be implemented for all six infantry-family types named in `TACTICAL_COMBAT.md`'s prose | **Wrong for this branch** — only `motorised_infantry` exists as a real `UnitType`; the other five are a documented future content addition, same deferral pattern as building perk trees |
| Swapping a cell's `unit_type` to `"motorised_infantry"` is already safe since the unit type exists in the enum | **Wrong, a real bug** — `unit_terrain_costs.ts` has no entry for it, so an unmapped cell makes the whole division's movement profile `Infinity` (immobile). This branch must add the terrain-cost row first |
| `mechanised_infantry`/`improved_apc`/`ifv` are already placeable in the Division Builder, just gated by research | **Wrong** — none of the three appear in `ELIGIBLE_UNITS` at all today; this branch adds the entries, not just their visibility gating |
| Server-side `ASSIGN_TEMPLATE`/`RAISE_DIVISION` need new validation against `researched_perks` for this branch to be "safe" | **Deliberately not done here** — `RESEARCH.md`'s actual guarantee is "a template never breaks" (delivered by live fallback resolution), not "invalid selections are rejected"; hardening is a legitimate separate future pass, not silently required by this one |
| §6.2's rejection of a per-row info button means Unit Profile can't have one | **Wrong** — §6.2's rejection predates Unit Profile's existence; §6.6 explicitly reinstates a dedicated info affordance for this specific, deeper component, additive to (not replacing) hover-preview and click-to-place |
| Unit Profile's Attack Pattern section needs the full diagram treatment this branch | **Wrong, deliberately scoped down** — text description only this branch; the diagram reusing Tactical Combat Panel's overlay visual language is flagged as a follow-up, not built here |
