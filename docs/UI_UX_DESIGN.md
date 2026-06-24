# Grand Strategy Multiplayer — UI/UX Design Spec

> Canonical reference for visual theme, panel system, map modes, and keybinds.
> Companion doc for wireframing handoff: `PANEL_WIREFRAME_BRIEF.md` (derived from this —
> if the two ever disagree, this file wins).
> Last updated: June 2026.

---

## 1. Design Motivation

This game sits in a category without a clean existing label: **continuous-time
(no-pause), multiplayer-first grand strategy with RTS-grade control expectations.**
It is not "HoI4 but faster" and not "StarCraft but slower" — it borrows specific,
separable things from each:

- **From grand strategy (HoI4/EU4):** panel-based deep systems (military templates,
  economy, diplomacy, research), map-mode-driven information layers, genre-recognizable
  visual language.
- **From RTS (StarCraft 2 specifically, and Wargame/Steel Division more precisely for
  pacing):** input philosophy — control groups, camera bookmarks, left-hand keyboard
  reachability, right hand permanently on the mouse.

**The pacing reference is Wargame/Steel Division, not StarCraft 2.** Eugen Systems'
own framing of their games is the right mental model: dense per-unit information,
played mostly zoomed out as a "mass of icons," with a few meaningful decisions every
10–20 seconds — not constant order-issuing. The skill ceiling can be high; the skill
floor must stay low. The tactical grid is an explicit auto-battler by design
(see `DEV_PHASES.md` — "never add real-time grid micromanagement"); the same floor/ceiling
philosophy extends upward into the strategic-layer UI.

**Working principle:** "constant interaction" means *frequent meaningful decisions*,
not *frequent clicks*. The UI's job is to make the player aware of what needs a decision
(notifications, contextual reveals, the Tab "needs attention" cycle) and make acting on
that decision cheap — not to demand APM for its own sake.

### Why this matters for every decision below

Because there is no pause button, every legibility failure costs the player something
in real time — a unit destroyed, a province lost — in a way it never did in HoI4. Design
choices that would be cosmetic preferences in a pausable game (color saturation, icon
clarity, terrain rendering) are treated here as functional requirements.

---

## 2. Visual Theme

**Direction chosen: Modernized Paper Map** (closest to HoI4's genre-recognizable look),
with a deliberate amendment to fix HoI4's most-cited legibility failure.

### What we keep from HoI4's lineage
- Desaturated, warm-neutral base palette (aged paper, not bright white) for terrain
  texture and panel chrome — reads as "war room dossier," genre-recognizable to the
  primary target audience (grand strategy crowd, per market positioning).
- Brass/iron rivet motif on panel borders; subtle paper grain on map base.
- Iconography over realistic art for units (simplified NATO-esque silhouettes) —
  scannable at the zoom level most play happens at, and avoids the "blends together
  when zoomed out" complaint leveled at realistic-art RTS like Wargame.
- Serif/slab-serif display type for headers and nation names (period "dossier" feel);
  geometric sans for all numeric/data text — numbers are never serif, since
  legibility-under-time-pressure matters more there than theme.

### The hard amendment: ownership and state color are never muted

Research finding: HoI4's most-repeated UI complaint across player feedback (forum
threads, and independently via the popularity of the "FPS Map" Workshop mod, whose
entire pitch is "sharper borders, coloured icons" and "makes the country colours fill
out the nation making it much clearer to see who [owns what]") is that the default
political map's desaturated palette makes ownership hard to read at a glance. That
game has a pause button. We don't.

**Rule:** desaturation applies to terrain texture and UI chrome — never to:
- Nation/ownership fill color (bright, high-saturation, crisp borders — not
  anti-aliased into mush)
- Unit/division state (selected, moving, engaged, suppressed, encircled,
  out-of-supply) — each gets a reserved, high-saturation color used for nothing else,
  communicated redundantly (color + shape/motion, never color alone, for
  colorblind-safety and legibility-under-pressure)

**Player-customizable map colors:** confirmed as worth building, not just a nice-to-have.
It directly addresses the root complaint above (some default nation-color-adjacency
pairs are low-contrast for some players) and costs little since nation color is already
data, not baked into art assets.

### 2D/3D rendering — cosmetic tier boundary

3D unit models and 3D map rendering may be sold as a cosmetic/paid-tier upgrade
**only as a renderer of identical underlying information** — same unit positions, same
terrain-tier legibility, same fog-of-war rules as 2D. A 3D camera that occludes units
behind terrain in ways 2D's flat icons never would, or that reveals something 2D
wouldn't, crosses from cosmetic into pay-to-win and is out of scope as designed.
**Hard constraint for whoever builds the 3D renderer:** functional information parity
between 2D and 3D modes, always. Unit *skins* (2D illustrated, 3D model) are unambiguously
safe cosmetic-tier content under the existing monetisation model in `ARCHITECTURE.md`.

---

## 3. Terrain Rendering — Elevation & Cover

This is a harder problem than HoI4 ever solved: HoI4 has one discrete terrain value per
province; we have two independent dimensions (11-value cover, 3-value elevation) at
sub-province pixel resolution, both gameplay-critical (movement legality, combat
modifiers — see `PATHFINDING.md`, `STRATEGIC_COMBAT.md`).

### Governing principle: conditional / contextual reveal

Don't render all available information permanently and unconditionally. Render the
*always-relevant* layers ambiently, and reveal *situational* layers only when they're
relevant to what the player is currently doing (a unit is selected, a hover is active,
combat is about to start). This principle recurs throughout this spec — see also
§5 (province quick-actions), §5 (bottom panel terrain strip), §8 (Tab attention-cycle).

### Why a single "show everything" map mode doesn't work

Cartographic precedent is direct on this: bivariate choropleth maps (overlaying two
independent color-coded categorical layers on one map) were tried in the 1970s and
found to "produce ambiguous representations that conveyed information poorly, being
too difficult to interpret." Filling provinces with both nation-color AND
full-fidelity cover-color simultaneously recreates this known failure mode.

### Elevation — ambient hillshade, visible in every mode

Elevation is ordinal and low-cardinality (3 values) — the correct cartographic solution
is a relief/hillshade texture at low, constant opacity, generated directly from the same
elevation-tier data the pathfinder uses (not a separately authored "pretty" texture —
this is what causes the visual/gameplay terrain mismatch HoI4 players still complain
about and mod against a decade later).

- Renders under the political fill in **every map mode**, all the time.
- A dedicated, high-contrast standalone Elevation mode is retained for the rare case
  where a player wants to study elevation in isolation — cheap to keep since it's
  already built, occasionally useful, no harm.

### Cover — collapsed to gameplay-relevant tiers in Political mode; full fidelity in dedicated Cover mode

No player making a move decision needs to distinguish all 11 cover categories at a
glance. They need three things, in order of how often they matter:

1. **Can my currently-selected unit even enter this tile?** (binary, division-aware)
2. **Will it be slow/costly to do so?**
3. **Will I get a combat bonus/penalty fighting here?**

**In Political mode (default):**
- Hard-impassable tiles for the **currently selected division's movement profile**
  rendered with a diagonal hatch/stipple texture — appears only when a division is
  selected, disappears otherwise. This is the conditional-reveal principle applied
  directly: the information is contextual to what the player is doing, not permanent
  clutter.
- Combat modifiers (forest defender bonus, river crossing penalty, etc.) are **never**
  permanent map paint — they surface via hover tooltip on a division/province, and via
  the engagement-circle terrain-bonus indicator already specified in
  `STRATEGIC_COMBAT.md`. These only matter at the moment of planning or resolving a
  fight, so contextual reveal at that moment is correct, not a compromise.
- Rivers remain an always-on vector overlay (existing behavior) — this is the precedent
  the hillshade and hatch-texture approaches above both extend.

**In dedicated Cover mode:**
- Full 11-tier fidelity, flat distinct colors per tier (HoI4's "simplified terrain"
  pattern, which is the terrain mode players actually trust and use, per direct forum
  evidence, over the "pretty" default mode). Used deliberately, before planning an
  offensive — matches actual HoI4 veteran workflow ("simplified terrain when preparing
  operations").

### Implementation note: never auto-switch map mode on zoom

A real, named failure mode exists in this exact space: a CK3 community mod exists
specifically to stop the game from automatically swapping away from the political color
overlay to a terrain texture as the camera zooms in (player-described as switching to
"puke map mode"). **Map mode must always be a stable, deliberate player choice — never
an automatic consequence of camera height.**

---

## 4. Map Modes — Final List

| Mode | Role | Always-on layers |
|---|---|---|
| **Political** (default) | ~90% of play: ownership, frontline, move orders | Nation fill (high-saturation) + ambient elevation hillshade + rivers + division-aware impassability hatch (conditional) |
| **Cover** | Deliberate pre-offensive planning | Full 11-tier cover fidelity, flat color |
| **Elevation** | Rare, standalone study of elevation only | Pure relief/hypsometric rendering |

This mirrors the actual HoI4-veteran usage pattern found in research: settle on 1–2
trusted modes for 90%+ of play, switch to a specialist mode briefly and deliberately
when planning something specific, return to default. We are not trying to invent new
player behavior here — we're building the modes that match behavior already observed
in the genre's own playerbase.

**Switching mechanism:** single cycle key (backtick) steps forward through the three
modes; Shift+backtick steps backward. Three dedicated keys were considered and rejected
— a 3-state cycle is trivial to reason about and costs one key instead of three. See
§9 for full keybind rationale.

### 4.1 Relationship-ring overlay (held key, Political mode only)

A fourth, fully separate "Diplomatic" map mode (self/ally/enemy/neutral fill coloring)
was considered and rejected. Political mode's per-nation fill already answers "whose
territory, specifically" — information needed constantly for diplomacy and intel
purposes, not just flavor. A relationship-colored mode answers a different, narrower
question ("can I trust this border, right now") that doesn't justify diluting the
"2–3 trusted modes" discipline established above, especially given relationship-fill
color would compete for the same saturated-fill channel nation color already owns —
recreating the bivariate-choropleth legibility problem already ruled out for cover
terrain (see §3).

**Resolution:** relationship information is layered onto Political mode as a
**held-key outline overlay**, not a separate mode and not a second fill color:

- **Hold Alt** → every province border redraws with a relationship-coded outline,
  drawn on top of the existing nation fill (which is untouched):
  - Self: no ring, or a subtle neutral outline (the player never needs reminding
    what's theirs)
  - Ally: green outline
  - Enemy: red outline
  - Neutral: grey/desaturated outline
  - Finer diplomatic states (truce, war-but-disengaged, etc., if the diplomacy
    system models them): a distinct line pattern (e.g. dashed vs. solid) rather
    than a fifth competing color — already at the practical limit of
    simultaneously-parseable color-coded signals
  - Release Alt → overlay disappears, back to plain nation fill
- **Why outline, not fill:** keeps relationship data on a different visual channel
  (edge/line) than identity data (fill), so neither competes with the other for
  saturation — the same pattern already used for the impassability hatch overlay.
- **Why a held key, not a toggle:** this is a momentary lookup ("is this border
  safe to weaken"), not a sustained state worth living in. A toggle risks becoming
  a forgotten, permanently-on clutter layer; holding keeps it deliberate and
  self-clearing.
- **Why Alt specifically:** Alt is not used anywhere else in this scheme, alone or
  in combination — unlike Ctrl, which already changes meaning the instant a second
  key joins it (Ctrl+0–9 assign, Ctrl+F1–F8 bookmark, Ctrl+/− zoom). Holding Ctrl for
  this purpose risked a real accidental-input failure mode: a player holding Ctrl to
  check relationships, then tapping a number out of habit, would reassign a control
  group instead of glancing at the map. Alt carries no such risk and can be held
  safely while panning (WASD) or issuing orders (Space/G/C/X) underneath it.
- Scoped to Political mode only — Cover and Elevation modes are specialist views
  with their own purpose and don't need this overlay.

---

## 5. Panel System

### 5.1 Panel inventory

| Panel | Source system(s) | Notes |
|---|---|---|
| **Military** | MilitarySystem, DivisionBuilder, AirSystem, NavalSystem | Single top-level panel with **Land / Air / Naval sub-tabs** — see rationale below |
| **Economy / Trade** | EconomySystem | Resources, production, build queue, province management |
| **Diplomacy** | DiplomacySystem | Propose/respond, treaties, map-sharing agreements |
| **Research** | TechSystem | General Technology tree (Phase 8+) |
| **Politics** | PoliticsSystem *(later)* | Reserved panel-row slot, no redesign needed when it ships |
| **Espionage** | *(future, unscoped)* | Reserved panel-row slot |

### 5.2 Why Military is one panel with sub-tabs, not three standalone panels

HoI4's model (separate top-level Land/Air/Naval panels) was considered and rejected
for this game specifically because of the session-length constraint. Six-plus
hotkeyable top-level panels (Land, Air, Naval, Economy, Diplomacy, Research) imposes
real navigational overhead in a 1-hour small-map session, and many matches won't have
meaningful naval or air presence at all (especially small maps) — a standalone Naval
tab that's irrelevant half the time wastes scarce hotkey real estate. One Military
panel with internal sub-tabs keeps the top-level hotkey count low while still giving
each branch (Land/Air/Naval) full screen space once entered.

### 5.3 Placement model — hybrid by panel type

Three placement options exist in the genre (persistent side-dock, full-center overlay,
hybrid). We use a hybrid, split by how often a panel is opened versus how much
information density it needs:

| Placement | Used for | Why |
|---|---|---|
| **Side-docked, map stays live** | Military (default state), Economy overview, Diplomacy relations overview | Opened frequently (every move order touches Military); cannot afford to cost map visibility on every open in a no-pause game |
| **Full-center overlay** | Research tree, DivisionBuilder, TacticalGridUI | Decision-heavy, information-dense, opened occasionally — these are "pause to think" moments even though the clock doesn't stop. Also matches existing HoI4-player expectation for Research specifically |
| **Military panel expand** | DivisionBuilder / TacticalGridUI opened *from within* Military | Side-docked by default; explicit expand affordance into full-center only for these sub-screens |

### 5.4 Sub-tab navigation

- **Tab**, while a panel with sub-tabs is open, cycles those sub-tabs (e.g. Land → Air
  → Naval → Land). Tab's meaning is context-bound: **Tab always means "cycle within the
  currently open panel's sub-context," never "switch panels."** This separation is
  deliberate so the two mental models (which panel vs. which sub-view) don't blur as
  more panels gain sub-tabs later (Research is a plausible future candidate).
- Sub-tabs are also directly mouse-clickable at all times.

### 5.5 Panel open/close behavior

- Pressing a panel's hotkey while it's already open **closes it**.
- Pressing a *different* panel's hotkey while one is open **closes the current panel,
  opens the new one** — never stacks panels.

### 5.6 Bottom selection panel (max one-third of screen)

Content is selection-dependent:

**Selected friendly division:**
- Identity block (icon, template name, owner flag)
- HP + suppression dual-bar (matches engine's dual-bar system)
- Composition summary (grid thumbnail / unit-type breakdown — full 5×5 grid only opens
  in TacticalGridUI during active combat)
- Action buttons mirroring keybinds (Move, Hold, Retreat, Cancel) — buttons exist for
  discoverability and mouse-only play; every one is keybound and tooltips show the
  bind, consistent with the existing convention in `STRATEGIC_COMBAT.md` ("Move [M]")
- Movement profile glance: small terrain-passability strip for this division's cover
  tiers — conditional reveal again, only rendered because this specific division is
  selected

**Selected friendly province:**
- Resource production summary, current buildings, build-queue state
- **Inline vs. deep-link rule** (see below)

**Selected friendly stack (multiple divisions, same position):**
- The ordered stack list/reorder UI from `STRATEGIC_COMBAT.md`, docked here rather
  than floating separately — drag to reorder, first/reserve indicators

**Selected enemy division (within observation/scouting range):**
- Composition intel at whatever fidelity the current scouting tier grants (partial
  counts → specific types → full grid, per `DEV_PHASES.md` Phase 4 scouting spec)
- No action buttons

### 5.7 Province management: inline vs. deep-link rule

Genre research is direct here. The historical justification for the RTS bottom-panel
convention itself is to minimize flipping between a base/economy view and the
battlefield — fragmenting related commands and information across disconnected UI
zones is a named, specific failure mode (cited against Planetary Annihilation's UI,
which split building commands, resources, and unit orders into three separate areas).
The opposite failure mode is also real and named: cramming an entire multi-step,
prerequisite-gated build queue into a small persistent strip becomes unmanageable as
complexity grows (cited against Humankind's city panel).

**Rule, threading between both failure modes:**
- **Inline in the bottom panel:** any single-click, no-prerequisite, no-ordering
  action (upgrade a building one level, build into an empty unqueued slot if affordable).
  One button, one cost, one click.
- **Deep-link to full Economy panel:** anything involving a queue — multiple items
  queued, reordering, or choosing between mutually-exclusive options for the same slot.
- The deep-link button ("Manage Production →") only **appears** once there's something
  queue-shaped to manage — consistent with the conditional-reveal principle — rather
  than sitting permanently as an invitation to a panel most short-session players will
  rarely need.

This gives implementers a concrete, non-judgment-call rule: *single irreversible
action = inline; anything stateful or sequential = deep-link.*

---

## 6. Division Builder UI

Source data model: `TACTICAL_COMBAT.md`'s 5×5 grid (25 cells, row roles Vanguard/
Assault/Support/Reserve/back, adjacency-based formation bonuses) and the movement
profile / engagement radius derived from composition (`STRATEGIC_COMBAT.md`). The
builder's layout is derived from this data model, not designed independently of it.

### 6.1 Overall layout — two columns, left fixed / right context-sensitive

**Left column — the 5×5 grid, always present, fixed shape:**
- All 5 rows labelled by their tactical role (Vanguard/Assault/Support/Reserve/back),
  not just numbered — row position is a real tactical decision the player needs to see,
  not infer.
- Empty cells rendered as clearly empty (dashed outline), never as a default/blank
  state that looks like an error — partial fill is explicitly expected and valid
  (`STRATEGIC_COMBAT.md`: "most divisions in play will have partially filled grids").
- Filled cells show unit icon + compact at-a-glance glyph (not full stats — full
  stats live in the right column, never duplicated on the grid itself).
- Adjacency-based formation bonuses glow live as a candidate unit is hovered over a
  cell before placement — explicitly required (`DEV_PHASES.md`: "formation bonus
  preview (highlight when placing adjacent synergy units)").

**Right column — swaps content based on selection state. Two states:**

**State 1 — no cell selected (template overview, default state):**
- Movement profile summary (impassable terrains, slowest terrain) — required per
  `DEV_PHASES.md`
- Derived division type + engagement radius (Armoured/Motorised/Infantry + the
  computed radius value) — shown immediately so the player sees the consequence of
  composition choices without needing to calculate it themselves
- Fill stats (cells filled / 25, row/role balance)

**State 2 — a grid cell is selected:**
- Right column becomes two stacked, both-permanently-visible zones (not a
  popover, not a view that replaces the list):
  1. **Eligible unit list** (top) — scrollable list of unit types valid for this
     cell/row, each entry: icon, name, one-line role descriptor, one or two
     compact key stats
  2. **Detail callout** (bottom, fixed position) — full stat block, terrain
     affinities, role description, formation synergy hints for the relevant unit
     (see 6.1a for which unit "relevant" means, depending on whether the selected
     cell is empty or already filled)

### 6.1a Selecting an empty cell vs. a filled cell — distinct initial detail state

These must NOT behave identically. Selecting a cell sets which unit the detail
callout shows by default, before any hover happens:

- **Empty cell selected:** detail callout has no unit to show until the player
  hovers an entry in the eligible list (browse-first flow, as in §6.1/§6.2).
- **Filled cell selected (a unit is already placed here):** detail callout
  immediately shows that placed unit's full card — the player should never have
  to re-hover the eligible list just to re-read what they already placed. The
  eligible list remains visible and usable below/alongside it for swapping the
  unit out, but the detail callout's *initial* state on click is always "show
  what's currently here," matching the inspect-any-unit pattern Steel Division
  uses (clicking a unit, placed or not, always surfaces its card). Hovering a
  *different* entry in the eligible list still previews that entry as normal —
  this only changes what's shown immediately on click, before any hover occurs.

This was an implicit gap in the first implementation pass (clicking a filled cell
behaved identically to clicking an empty one, discarding the placed unit's detail
and forcing the player back into the eligible list). Treat 6.1a as a hard
requirement, not an enhancement — without it, a player can place a unit, move on,
and have no way to recall what they placed without removing it first.

### 6.2 Why hover-preview, not a per-item info button

A per-row info button on every list entry was considered and rejected: with a dozen-
plus eligible unit types possible per cell, a second click-target on every row adds
visual clutter and friction that works against the "attractive, not cluttered" goal.
Instead, **hovering** a list entry live-updates the detail callout below; **clicking**
is reserved exclusively for committing that unit into the selected grid cell. This
separates browsing/comparing (low-stakes, should be frictionless) from placing
(higher-stakes — composition genuinely determines combat outcomes per
`STRATEGIC_COMBAT.md`) so an accidental click while merely comparing units can never
commit an unwanted placement.

### 6.3 Why this layout over alternatives considered

- **Detail-replaces-list on click** was rejected: comparing units against each other
  is the core task while populating a cell, and hiding the list on every click forces
  repeated back-and-forth navigation during the single most decision-dense moment in
  the builder.
- **Floating popover near the cursor** was rejected: a popover rich enough to hold a
  full stat block would, in this layout, float directly over the grid the player is
  actively placing into — obscuring the exact information (current grid state,
  formation bonus glow) the player needs while deciding.
- The chosen split (list above, detail below, both permanently present) extends the
  same "right column is context-sensitive, swaps by state" structure already used for
  State 1 vs. State 2, rather than introducing a third, different UI mechanism.

### 6.4 Forward-compatibility note

Hover-preview is mouse-first. If full keyboard-driven template building is pursued
later (consistent with the broader keybind philosophy in §9), arrow-key highlight
should trigger the same detail-preview update, with Enter/Space committing placement
— not designed in this pass, flagged so it isn't precluded by the implementation.

### 6.5 Unit art status — current placeholder is provisional, not final

The first wireframe pass renders grid-cell units as an abbreviation label (e.g.
"INF") plus an abstract CSS-gradient glyph (a circle for artillery, an X-pattern for
infantry, etc.) rather than recognisable unit silhouettes. This is acceptable as a
**layout-stage placeholder** — it's legible and cheap to produce while panel
structure and interaction flow are still being validated — but it is explicitly not
final art direction. Per §2 ("Iconography over realistic art... simplified
NATO-esque silhouettes"), the production version should move toward actual
silhouette icons recognisable at a glance, closer to the Steel Division reference
point raised in this round of feedback: instant shape recognition for what's placed,
not just a category abbreviation. Revisit once panel structure and the State
2 / 6.1a interaction flow are confirmed working — don't invest in final art before
the layout it sits inside has stabilised.

### 6.6 Unit Profile — full detail view (info button target)

The compact detail callout (§6.1, §6.1a) is deliberately small — it's designed to be
glanced at while comparing units or recalling a placement, inside a screen the player
might also be playing under some time pressure. It is **not** the right place to put
everything a curious player might want to know about a unit. That fuller view is a
separate, dedicated component: the **Unit Profile**.

**Why this needs to be a separate view, not an expanded callout:**

The Division Builder is the one screen in this entire game where the no-pause
constraint does not apply — composition happens between matches or in a lobby, at
the player's own pace. Every other UI decision in this document optimises for
minimal friction because time always costs something in this game; the builder is
the exception, and deserves a UI mode that reflects that — "chill," explorable,
rewarding a player who wants to read deeply, without that depth ever being forced on
a player who doesn't.

Additionally — and this is the more important reason — **research changes are not
always stat deltas.** Some research upgrades a number (Armour's Hard stat +12%).
Others change a unit's *structure*: a new attack-pattern behaviour, an additional
formation-bonus eligibility, or unlocking an entirely new unit type (e.g.
Mechanised Infantry via the armour branch, per `TACTICAL_COMBAT.md`). An inline "+12%
→" arrow can represent the first kind of change. It cannot represent the second kind
at all. These need prose and, where useful, a diagram — which requires real space,
not a corner of an already-small callout.

**Trigger:** an info affordance on each unit (visible in the eligible list, and on
the compact detail callout) — clicking it opens the Unit Profile, replacing or
expanding the right column for as long as the player wants to stay there.

**Contents, ordered by priority (quick glance still works; depth is available, not
forced):**

1. **Identity header** — name, and the unit's full visual. This slot is built
   **renderer-agnostic from the start**: it shows whatever the unit's current skin
   produces, whether that's the placeholder glyph, a future NATO-style silhouette, or
   a paid 3D/illustrated cosmetic skin. This is also where a purchased cosmetic skin
   is most worth showing off, since the player is deliberately looking, not glancing
   mid-battle — a natural showcase moment for the cosmetic tier described in §2.
2. **Current stats** — the same numbers as the compact callout, given proper room
   rather than compressed.
3. **Attack pattern, explained and shown** — plain-language description of the
   unit's actual targeting behaviour (row / column / AOE / full-grid-priority /
   recon-weighted-random, per `TACTICAL_COMBAT.md`'s archetypes) plus a small static
   diagram reusing the **same overlay-shape visual language** specified for the
   Tactical Combat Panel in §7 (column highlight for Armour, AOE rectangle for
   Flamethrower, priority-number list for Sniper, etc.). Reusing that visual
   vocabulary here means a player who studies a unit in the builder already
   recognises its overlay shape later, live, in combat — and a player who never
   opens this view still gets the same information for free in-combat via hover.
4. **Research outlook** — structural changes get described as what they are, not
   forced into a stat-delta format that doesn't fit them:
   - Pure stat upgrades: shown as before/after value pairs.
   - Structural changes (new targeting behaviour, new perk, a newly-unlocked unit
     type): shown as their own labelled callout in plain language (e.g. "🔬 Combined
     Arms Doctrine — unlocks Mechanised Infantry"), not squeezed into a numeric
     delta.
5. **Flavour / history blurb** — short, period-appropriate description, purely for
   immersion. Lowest priority in the layout (bottom), easiest to ignore, never
   competes with the functional sections above it for attention.

**Reuse in the Tactical Combat Panel:** this same component — not a redesigned copy
— is what opens when a player clicks a unit during live combat (§7.4). In that
context a player under time pressure will naturally stop at section 2 or 3 and
never scroll to the history blurb; a player studying their builder pre-match may
read all five. One component serves both contexts because the *player's own
urgency* determines how deep they go — the UI doesn't need to enforce brevity by
cutting content, the way it must elsewhere in this document for genuinely
time-pressured in-match panels.

---

## 7. Tactical Combat Panel

Source: `TACTICAL_COMBAT.md`'s already-specified content list for the panel opened
via the combat button (HP/suppression bars, experience badges, formation bonus
glow, row perk labels, attack pattern overlay, recon indicator, terrain modifier
display, round timer) and the five-phase escalation system (Contact → Firefight →
Intense → Decisive → Annihilation). This section designs the *visual language* for
that already-specified content — the content list existed; how it reads to a player
at a glance did not.

### 7.1 Why this panel reuses the Division Builder's grid, not a new visual system

The builder already establishes a 5×5 grid vocabulary (cell size, row labels, unit
glyphs) that the player learns for free while composing templates pre-match. The
combat panel reuses that vocabulary directly rather than inventing a second grid
language: same cell size, same row labels, same unit glyphs. A player who has only
ever used the builder should be able to read the combat grid on first sight.

**Spatial arrangement:** two grids face each other — own grid on one side, enemy
grid mirrored on the other, both R5 rows oriented toward the shared centreline. This
visually replicates "two front lines meeting" rather than presenting both grids in
the same orientation, which would obscure the row-5-faces-row-5 relationship that
matters mechanically.

### 7.2 Ambient state — visible without hovering anything

Per the existing content spec, every cell already shows HP bar, suppression bar, and
experience tier badge. Add one ambient layer not yet specified: **a soft highlight
on whichever row/column/zone is the primary target this round**, shown collectively
rather than per-unit — attacks resolve simultaneously across many units each round
(`TACTICAL_COMBAT.md`), so a glance should communicate "this area is hot right now"
without needing per-unit arrows cluttering every cell by default. Per-unit detail is
reserved for hover (§7.3), consistent with the conditional-reveal principle used
throughout this document (§3, §5.6, §5.7).

### 7.3 Hover — attack pattern overlay, one shape per archetype

Hovering a friendly unit overlays its actual targeting behaviour on the enemy grid,
using a distinct shape per archetype so the *shape itself* teaches the rule, rather
than requiring the player to read it in a tooltip:

| Archetype | Overlay shown on hover |
|---|---|
| Infantry / MG | Highlight the entire frontmost-occupied enemy row |
| Armour | Highlight own column from current row to enemy R5; fainter secondary highlight on the column it would shift to if its own column is empty (previews the flanking contingency before it happens) |
| AT (infantry/gun) | Highlight own column; fainter highlight on the shift-target column if empty |
| Sniper | Numbered priority markers (1, 2, 3…) on its actual current potential targets this round, not a generic full-grid highlight — this is the only way to make the priority-list rule (`TACTICAL_COMBAT.md`: snipers → flamethrowers → force recon → MG → AT gun → standard infantry fallback) visible rather than implicit |
| Flamethrower | The literal 3-column × 2-row AOE rectangle, anchored exactly per the rule (1 row ahead, own column ± 1, clamped to grid edges) |
| Artillery | A dot-density heatmap across the enemy grid — denser near currently-occupied cells, proportional to the division's accumulated recon value; sparse and scattered at zero recon |

**Why the artillery heatmap matters more than it looks:** this is the clearest case
of the stated goal — "so players can improve in the future" — being served by the
visual itself rather than by rules text. A player who hovers their artillery and
*sees* a sparse, scattered heatmap immediately understands "I need more recon" as a
visceral, visual fact, without reading a paragraph explaining recon-weighting. The
overlay is the lesson.

### 7.4 Click — opens the Unit Profile (§6.6), not a separate component

Clicking a unit (friendly always; enemy only within current visibility rules) opens
the same **Unit Profile** component specified in §6.6 — not a new, combat-specific
detail view. This is deliberate reuse: the player already knows where to look for
"more detail" because it's the same place the builder taught them, and the
component itself adapts naturally to how much time the player has to spend in it
(see §6.6's closing paragraph on context-driven depth).

### 7.5 Standing/ambient information — formation bonuses, row perks, terrain

These represent decisions made before this round started (row placement, adjacency),
not live combat events — so unlike the attack-pattern overlay, they render as
persistent ambient state, not hover-gated:

- **Row perk labels:** small, persistent label on each row's edge naming its active
  bonus (e.g. "▲ Vanguard — +suppression dealt"), always visible — row choice is a
  standing decision, not a momentary one, and deserves a standing label.
- **Formation bonus glow:** persistent soft glow between synergised adjacent cells,
  reusing the same visual treatment already specified for the Division Builder
  (§6.1) — one consistent "this adjacency is active" language across both screens.
- **Terrain / river modifiers:** a compact banner above both grids (e.g. "River
  crossing — Major: −30% suppression resistance, 2 rounds remaining") rather than
  buried in a per-unit tooltip, since these affect the whole engagement, not one
  unit.

### 7.6 Round phase — making escalation legible at a glance

A five-segment horizontal progress strip above the grids, matching the existing
phase names (Contact → Firefight → Intense → Decisive → Annihilation), with the
current phase lit and a round timer countdown beneath it. The strip's visual
intensity should escalate with the phase it represents — muted colour and a slow
pulse at Contact, increasingly saturated (toward red) and faster pulse by
Annihilation — so the *feel* of the strip reinforces the actual mechanical
escalation (`TACTICAL_COMBAT.md`'s lethality ramp) rather than merely labelling it.
A player should sense rising stakes before reading a single number.

### 7.7 Flanking angle indicator

Per `STRATEGIC_COMBAT.md`/`TACTICAL_COMBAT.md`, when a second attacker is present the
panel must show the measured flanking angle and which bonus tier (standard
90°–135°, deep/rear 135°–180°) is currently active. Render this as a simple angular
wedge indicator near the affected division's grid edge, with the active tier's name
shown directly on it — consistent with the rest of this panel's philosophy: name the
mechanic in plain language at the point where it's currently relevant, rather than
requiring a tooltip lookup.

---

## 8. Notifications & Attention

- A `NotificationSystem` (already specified in `MODULES.md`) queues toasts for combat,
  diplomacy, economy, and supply events.
- **Tab, when no panel is open**, cycles through the *same* queue the NotificationSystem
  maintains — not a separate "what needs attention" heuristic. This is a single shared
  queue consumed two ways (passive toast, active keyboard cycle), not two systems that
  can drift out of sync.
- This directly serves the "low floor, high ceiling" goal: a player who isn't tracking
  every front manually can tap one key to be walked through everything that currently
  needs a decision, rather than needing to scan the whole map themselves.

---

## 9. Keybind System

### 7.1 Governing principles

1. **Ergonomics over mnemonics whenever they conflict.** Mnemonics are accepted as a
   bonus when they fall out naturally; they never override hand-reach.
2. **Cluster by co-occurrence, not alphabet.** Keys used together in the same moment
   (unit orders; control-group operations) sit physically close together, regardless
   of whether their letters "spell" anything.
3. **Shift is one consistent modifier grammar:** expand / queue / alternate-target —
   reused identically everywhere (waypoint chaining, control-group add, all-chat,
   map-mode-reverse) rather than meaning something different per key.
4. **Escape is one recursive rule**, not a list of special cases (see §9.6).
5. Right hand stays on the mouse; all primary binds are left-hand reachable. Left-handed
   mirror preset ships as a first-class alternative, not an afterthought. All bindings
   remappable via Godot `InputMap`.
6. **Reserved slots exist on purpose** (Z, V, U, I, further F-keys if ever needed) so
   future systems extend the scheme without forcing a remap of existing muscle memory.

### 7.2 Full reference table

**Camera & zoom**
| Key | Action |
|---|---|
| W A S D | Pan camera |
| Ctrl +/− | Zoom in/out |
| F1–F8 | Jump to camera bookmark |
| Ctrl + F1–F8 | Set camera bookmark at current position/zoom |

**Unit orders** (active when division/stack selected)
| Key | Action |
|---|---|
| Space | Move (enter move mode; click = waypoint; Shift+click = chain) |
| G | Hold position |
| C | Retreat |
| X | Cancel orders |
| Z | *(reserved)* select idle/unengaged divisions |
| V | *(reserved)* cycle engaged/in-combat divisions |

**Control groups**
| Key | Action |
|---|---|
| 0–9 | Select group |
| Double-tap 0–9 | Select group + snap camera to it |
| Ctrl + 0–9 | Assign current selection to group |
| Shift + 0–9 | Add current selection to group |

**Panels**
| Key | Panel |
|---|---|
| Q | Military (Land/Air/Naval sub-tabs) |
| E | Economy / Trade |
| T | Diplomacy |
| Y | Research |
| U, I… | *(reserved)* Politics, Espionage |
| Tab (panel open) | Cycle sub-tabs within current panel |
| same key again | Close current panel |
| different panel key | Close current, open new |

**Map & navigation**
| Key | Action |
|---|---|
| ` (backtick) | Cycle map mode forward (Political → Cover → Elevation) |
| Shift + ` | Cycle map mode backward |
| Alt (held) | Show relationship-ring overlay (self/ally/enemy/neutral) on Political mode |
| Tab (no panel open) | Jump to next item needing attention (shared queue with NotificationSystem) |

**Chat**
| Key | Action |
|---|---|
| Enter | Chat — defaults to Allies if allied, else All |
| Shift + Enter | Chat — All (explicit) |

**System**
| Key | Action |
|---|---|
| Escape | Context-sensitive back-out (see §9.6) |

### 7.3 Why Space for Move, not M or F

M (the original placeholder bind) sits far from the WASD camera cluster — the worst
possible position for what is, by volume, the single most-used action in the game.
F was considered (zero finger-travel, adjacent to D) but Space won on pure ergonomics:
thumb-actuation costs zero finger travel from *any* WASD hand position, and Move's
frequency justifies the cheapest possible input over any other consideration.

**Known tradeoff, accepted deliberately:** Space-as-camera-snap-to-selection is a
common (not universal) convention elsewhere in the RTS genre (seen in community
hotkey proposals and in Beyond All Reason's Space+Tab camera/PiP switching). We are
diverging from that convention because Move's frequency advantage is larger than the
convention's pull. If camera-snap-to-selection is added as a feature later, it needs a
different key (a strong candidate is extending the double-tap-control-group-select
behavior, which already provides snap-to-group).

### 7.4 Why the unit-order cluster is Space / G / C / X, not the original M / H / G / X

Retreat was originally on G; G is reassigned to Hold because Hold is used more
frequently than Retreat and deserves the better-reachable slot. Retreat moves to C —
directly below Move (Space) and adjacent to the camera-hand home position — which
matters more for Retreat than for most actions, since a player issuing a retreat order
is usually already under time pressure and reach distance costs more in that moment,
not less. Cancel remains on X: lowest frequency in this cluster, and X is already a
near-universal "cancel" convention across non-game software, which serves new-player
transfer learning.

### 7.5 Why panels are Q / E / T / Y, not an unbroken Q-W-E-R-T row

An unbroken top-row run was considered (and is a clean teaching device: "it's the top
row"). It was rejected because R collides with Retreat, which earns its slot on
ergonomics grounds established in §9.4, and panel-switching is needed far less often
mid-combat than Retreat is. The very slightly less elegant Q/E/T/Y pattern is the
correct trade: Retreat keeps the reach it needs when a player is under pressure;
panels, switched much less frequently, can absorb the minor irregularity. Future
panels (Politics, Espionage) continue the same row (U, I…) without requiring a
redesign.

### 7.6 Escape — full state machine

Escape always backs out exactly one level of whatever is currently "open." It opens
the settings menu only when there is nothing left to back out of. This is a single
recursive rule, not four special cases — easy to implement correctly and impossible
for a player to find ambiguous, since it matches the "close the topmost thing" model
nearly all existing software already trained them on.

| Current state | Escape does |
|---|---|
| Move mode active (pending waypoints) | Cancel move mode, clear pending waypoints |
| A panel is open | Close that panel |
| Settings menu is open | Close settings, return to game |
| Nothing else active | Open settings menu |

**Surrender / leave game** is deliberately *not* a direct hotkey. It lives inside the
settings menu with a confirmation step, reachable in exactly two presses from anywhere
— this removes a real accidental-press/griefing vector at zero keybind cost.

### 7.7 No speed control / pause — by design, not by omission

This game has no pause and no speed-vote mechanic. This is a deliberate consequence of
the "no scheduling pain, no dead lobbies" positioning (`grand_strategy_mp_market_gap.md`)
— speed-vote and pause are exactly the mechanics that produce HoI4 MP's worst scheduling
friction (one player tabs out, the session stalls on a vote, everyone else waits). This
is already reflected in `DEV_PHASES.md` (pause/resume deferred past MVP) and is treated
here as closed, not pending — no keys are reserved for it.

---

## 10. Open Items / Future Work

- Politics and Espionage panels: reserved hotkey slots (U, I) exist; no UI content
  designed yet pending those systems landing (per `DEV_PHASES.md` Phase 12).
- Z and V (reserved unit-order-cluster keys): tentatively earmarked for
  idle-division-select and engaged-division-cycle respectively; not yet fully specified.
- Screenshot/replay-marker keys: no scope exists yet in project docs: flagged as a
  known gap, not a decision.
- 3D rendering mode: information-parity constraint stated in §2; full implementation
  spec not yet written (depends on Phase 9–10 air/naval completing first per
  `DEV_PHASES.md`).

---

*This document is the source of truth for UI/UX decisions. The wireframing pass
(Claude Design) should treat `PANEL_WIREFRAME_BRIEF.md` as its working brief and this
file as the rationale to consult if a brief item seems ambiguous or needs justification.*
