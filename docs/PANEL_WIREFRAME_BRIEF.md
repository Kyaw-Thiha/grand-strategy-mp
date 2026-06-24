# Panel Wireframe Brief

> Derived from `UI_UX_DESIGN.md` — that file is the source of truth and contains full
> rationale. This brief exists to be scanned quickly while wireframing. If anything here
> seems ambiguous, check the master doc before guessing.

---

## Visual theme quick reference

- Base palette: desaturated warm-neutral (aged paper), NOT bright white. Paper grain
  on map base, brass/iron rivet motif on panel borders/chrome.
- **Exception, never desaturate:** nation/ownership fill color (bright, high-saturation,
  crisp borders) and unit/division state color (selected/moving/engaged/suppressed/
  encircled/out-of-supply — each its own reserved high-saturation color, used for
  nothing else). State is shown via color + shape/motion together, never color alone.
- Unit icons: simplified NATO-esque silhouettes by default (2D). 3D models/illustrated
  2D skins are paid cosmetic tier — must render identical underlying info to default
  (no occlusion/reveal advantage versus 2D).
- Type: serif/slab-serif for headers/nation names; geometric sans for all numbers
  and data — never serif for numeric data.
- Map colors: player-customizable (palette picker), not fixed.

---

## Map modes (3 total, + 1 overlay)

| Mode | Default? | Content |
|---|---|---|
| **Political** | Yes | Bright nation fill + faint ambient elevation hillshade (always on, all modes) + river vector overlay (always on) + diagonal hatch on impassable tiles **only when a division is selected**, scoped to that division's movement profile |
| **Cover** | No | Flat, full 11-tier cover-type fill, distinct colors, no hatching needed (this mode IS the detail view) |
| **Elevation** | No | Pure relief/hypsometric shading, no political fill |

- Switch via single cycle action (forward/backward), not 3 separate buttons.
- Mode never auto-changes on zoom level — always an explicit player choice.
- Combat terrain modifiers (forest bonus, river penalty) = hover tooltip / engagement-circle
  indicator only. Never permanent map paint in any mode.

### Relationship-ring overlay (Political mode only, held key — not a 4th mode)

- Hold **Alt** → province borders redraw with a relationship-coded outline on top of
  the existing nation fill (fill itself is untouched):
  - Self: no ring / subtle neutral outline
  - Ally: green outline
  - Enemy: red outline
  - Neutral: grey outline
  - Finer states (truce, etc.) if modeled: dashed vs. solid line, not a new color
- Release Alt → overlay disappears immediately. This is a momentary lookup, not a
  toggle — design it to feel transient, not like a persistent UI state.
- Outline only, never a second fill color — fill is reserved for nation identity.

---

## Panel inventory & placement

| Panel | Hotkey | Placement | Sub-tabs? |
|---|---|---|---|
| Military | Q | Side-docked (default) → expands to full-center for DivisionBuilder / TacticalGridUI | Land / Air / Naval |
| Economy / Trade | E | Side-docked | — |
| Diplomacy | T | Side-docked | — |
| Research | Y | Full-center overlay (always — info-dense tree view) | — |
| Politics *(later)* | U *(reserved)* | TBD when system ships | — |
| Espionage *(future)* | I *(reserved)* | TBD | — |

**Open/close behavior:**
- Same hotkey again → closes panel.
- Different panel hotkey → closes current, opens new (never stack).
- Tab, while panel open → cycles sub-tabs (Land→Air→Naval→Land). Tab never switches
  between top-level panels.

**Side-docked panels:** map must remain visible/live behind them at all times — these
are opened frequently (especially Military), can't cost map awareness on every open.

**Full-center overlay panels:** may dim/cover the map — used for occasional,
decision-heavy screens only (Research tree, DivisionBuilder, TacticalGridUI).

---

## Bottom selection panel (max 1/3 screen height)

Content swaps based on what's selected — design as 4 distinct states:

### State A: Friendly division selected
- Icon + template name + owner flag
- HP bar + suppression bar (dual-bar, distinct visual treatment from each other)
- Composition thumbnail (grid summary, not full 5×5 — that's TacticalGridUI's job)
- Buttons: Move / Hold / Retreat / Cancel — each shows its keybind in a tooltip or
  inline label (e.g. "Move [Space]")
- Small terrain-passability strip: shows which cover tiers THIS division can/can't
  enter (conditional — only renders for this state)

### State B: Friendly province selected
- Production summary, current buildings
- **Inline 1-click buttons** for any single-step, no-prerequisite, affordable upgrade
  (e.g. "Upgrade Supply Hub →2")
- "Manage Production →" deep-link button to full Economy panel — **only appears if
  there's something queue-shaped** (multiple items, ordering choice, mutually exclusive
  options). Otherwise hidden — don't show an empty invitation.
- Rule of thumb for any new action added here later: single irreversible action =
  inline button; anything with a queue/sequence/choice = deep-link only.

### State C: Friendly stack selected (multiple divisions, same position)
- Ordered list, drag-to-reorder
- First/reserve visual indicators per `STRATEGIC_COMBAT.md` stack mechanics

### State D: Enemy division selected (in observation/scouting range)
- Composition intel only, fidelity depends on scouting tier (counts → types → full grid)
- No action buttons at all

---

## Division Builder

**Layout: two columns. Left is fixed/always the grid. Right swaps content by state.**

**Left column — 5×5 grid (always this shape, never changes):**
- 5 rows, each labelled with its tactical role: Vanguard / Assault / Support /
  Reserve / back row (front-to-back). Show the label, don't make the player infer
  row meaning from position alone.
- Empty cells: dashed outline, clearly "empty," not a blank/broken-looking state —
  partial fill is normal and expected, most divisions won't fill all 25 cells.
- Filled cells: unit icon + a small at-a-glance glyph only. NOT full stats — those
  live in the right column only, never duplicated on the grid.
- When a unit is being hovered for placement, adjacent cells with formation-bonus
  synergy should glow/highlight live, before the player commits the placement.

**Right column — State 1: no cell selected (default/overview)**
- Movement profile summary: which terrains impassable, which is slowest
- Derived division type + engagement radius (Armoured / Motorised / Infantry +
  the computed radius number) — shown automatically, player shouldn't have to
  calculate this themselves
- Fill stats: cells filled out of 25, rough role balance

**Right column — State 2: a grid cell is selected**
Right column becomes two stacked zones, BOTH always visible at once (not a tab,
not a popover):
1. **Top: eligible unit list** — scrollable, one row per unit type valid for this
   cell. Each row: icon, name, one-line role description, 1-2 compact key stats.
2. **Bottom: detail callout** — fixed position, shows full stat block + terrain
   affinities + role description + formation synergy hints.

**IMPORTANT — empty cell vs. filled cell behave differently on click. This was
implemented wrong in the last pass, please fix:**
- **Clicking an EMPTY cell:** detail callout shows nothing until the player hovers
  an entry in the eligible list. Browse-first, as before.
- **Clicking a FILLED cell (a unit is already placed there):** detail callout
  must IMMEDIATELY show that placed unit's full card, with no hover required.
  The eligible list stays visible/usable below it so the player can still swap
  the unit out — but the very first thing shown on click should always be "what's
  currently in this cell," not an empty/default state. This matches how Steel
  Division lets you click any unit, placed or not, and always see its card.
  **Current build's bug:** clicking a filled cell behaves identically to clicking
  an empty one, discarding the placed unit's info — player has no way to recall
  what they placed without removing it. Needs fixing.

**Critical interaction rule (for the eligible list specifically):**
- **Hover** a list item → detail callout below updates live. This is for comparing/
  browsing — should feel frictionless, no commitment.
- **Click** a list item → commits/places that unit into the selected grid cell.
  This is the only thing a click does here.
- Do NOT put an info-button on each list row — with a dozen+ unit types in some
  lists, that's visual clutter. The hover-to-preview pattern replaces the need
  for it entirely.
- Do NOT replace the list with the detail view on click, and do NOT show detail
  as a popover floating over the grid — both were considered and rejected (loses
  ability to compare units side by side; popover would cover the grid the player
  is actively placing into).

**Unit art — current placeholder is provisional:** abbreviation text (e.g. "INF")
+ abstract CSS-gradient glyphs is fine for this layout-validation stage, but is
NOT final art direction. Production version should move toward actual recognisable
unit silhouettes (NATO-esque, per the visual theme spec) — closer to a Steel
Division level of instant shape-recognition, not just a category label. Don't
invest further in final art until the panel layout and the click-behavior fix
above are both confirmed working.

---

## Unit Profile (new — info button target, separate from the compact callout)

A bigger, separate view from the compact detail callout — triggered by an info
affordance on each unit (in the eligible list and on the compact callout). This is
NOT a resize of the existing callout; it's its own component, because:
- The Division Builder is the one screen with no time pressure (composing happens
  pre-match/in lobby) — it can afford a deeper, "look at this if you want" view.
- Research upgrades aren't always stat numbers — some change a unit's actual
  attack pattern, add a perk, or unlock a whole new unit type. A "+12%" arrow can't
  represent that; it needs prose + maybe a small diagram.

**Layout, top to bottom (quick glance still works, depth is optional, not forced):**
1. **Header:** unit name + full visual. Build this art slot generically — it should
   show whatever skin is active (current placeholder, future NATO silhouette, or a
   purchased cosmetic skin later) without redesigning the layout when art changes.
2. **Current stats:** same numbers as the compact callout, just given real room.
3. **Attack pattern — explained AND shown:** plain-language description of how this
   unit actually targets (row/column/AOE/priority-list/recon-weighted-random) PLUS
   a small static diagram using the same overlay shapes as the Tactical Combat
   Panel below (column highlight, AOE rectangle, numbered priority list, etc.) —
   reuse the visual language, don't invent a second one.
4. **Research outlook:**
   - Simple stat upgrades → before/after value pairs.
   - Structural changes (new pattern, new perk, unlocks a new unit) → their own
     small labeled callout in plain language, NOT squeezed into a stat-delta format.
5. **Flavor/history blurb:** short, lowest priority, bottom of the layout, easy to
   skip — immersion only, never competes with the functional sections above it.

**Important — same component gets reused in the Tactical Combat Panel** (clicking
any unit there opens this exact view, not a redesigned copy). A player mid-combat
will naturally stop at section 2 or 3; a player pre-match might read all five. Don't
build two versions — build one that works at both paces.

---

## Tactical Combat Panel (new)

Opens via the combat button on an active combat icon on the strategic map. Two 5×5
grids face each other — **reuse the Division Builder's exact grid visual language**
(same cell size, row labels, unit glyphs) so a player who's only used the builder
can read this panel on sight without learning a second system.

**Layout:** own grid and enemy grid, both R5 rows facing the shared centerline
(mirrored, not side-by-side in the same orientation) — visually shows "two front
lines meeting."

**Always visible (no hover needed):**
- HP bar + suppression bar + experience tier badge (Green/Seasoned/Veteran/Elite)
  per unit cell
- Soft highlight on whichever row/column/zone is the primary target this round —
  shown as one collective highlight, not per-unit arrows cluttering every cell
- Row perk labels on each row's edge (e.g. "▲ Vanguard — +suppression dealt"),
  persistent — row choice is a standing decision, deserves a standing label
- Formation bonus glow between synergized adjacent cells (same visual as builder)
- Terrain/river modifier banner above the grids (e.g. "River crossing — Major:
  −30% suppression resistance, 2 rounds remaining") — affects the whole fight, not
  one unit, so it doesn't hide in a per-unit tooltip
- 5-segment round-phase strip (Contact → Firefight → Intense → Decisive →
  Annihilation), current phase lit, round timer countdown beneath it. Visual
  intensity should escalate with phase — muted/slow-pulse at Contact, saturated
  red/fast-pulse at Annihilation — so the strip *feels* like rising stakes, not
  just labels them
- Flanking angle indicator (angular wedge near the affected grid edge) when a
  second attacker is present, showing measured angle + active bonus tier name

**On hover a friendly unit — show its actual attack pattern as an overlay shape on
the enemy grid.** This is the main ask: make the shape itself teach the targeting
rule, don't just rely on a tooltip.

| Unit type | What the overlay looks like |
|---|---|
| Infantry / MG | Highlight the enemy's entire frontmost-occupied row |
| Armour | Highlight own column down to enemy R5; fainter highlight on the column it'd shift to if its own column is empty |
| AT (gun/infantry) | Highlight own column; fainter highlight on shift-target column if empty |
| Sniper | Numbered markers (1,2,3...) on its real current potential targets — not a generic full-grid glow |
| Flamethrower | The literal 3-column × 2-row AOE rectangle, anchored exactly where the rule says (1 row ahead, own column ±1) |
| Artillery | Dot-density heatmap on the enemy grid — denser near occupied cells, scaled to current recon value; sparse/scattered at zero recon |

The artillery heatmap especially matters: a player should be able to glance at a
sparse, scattered heatmap and immediately feel "I need more recon" — the visual
itself should teach this, not a tooltip explaining recon-weighting in words.

**On click a unit** (friendly always, enemy only if currently visible per scouting
rules): opens the same **Unit Profile** component described above. Don't build a
separate combat-specific detail view.

**The panel can be closed any time — combat keeps resolving underneath regardless.**

---

## Notification / attention system

- Toasts queue from `NotificationSystem` (combat, diplomacy, economy, supply events).
- Tab key, when no panel is open, cycles through that same queue — design this as one
  shared list consumed two ways, not two separate UI surfaces.

---

## Keybind quick reference (for any wireframe tooltips/labels)

| Zone | Keys |
|---|---|
| Camera | WASD pan, Ctrl +/− zoom, F1–F8 bookmarks |
| Unit orders | Space=Move, G=Hold, C=Retreat, X=Cancel |
| Control groups | 0–9 select, Ctrl+0–9 assign, Shift+0–9 add, double-tap=select+snap camera |
| Panels | Q/E/T/Y (Military/Economy/Diplomacy/Research) |
| Map mode | ` cycle forward, Shift+` cycle backward, Alt (held) = relationship overlay |
| Chat | Enter=Allies-if-allied-else-All, Shift+Enter=All explicit |
| Escape | Context-sensitive back-out; opens Settings only if nothing else is open |

Any button shown in a panel or bottom-strip that has a keybind should display it
(tooltip or inline label) — this is an existing convention, not new.

---

## Things NOT in scope for this wireframe pass

- No pause button, no speed control UI — doesn't exist in this game.
- No surrender/leave-game hotkey button on HUD — lives inside Settings only.
- Politics/Espionage panel content — not designed yet, just reserve the hotkey slot
  visually if doing a full panel-row mockup.
- 3D rendering mode — 2D NATO-icon is the only render mode in scope for this pass.
