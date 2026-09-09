# Research UI — Implementation Handoff

> UI-only spec for the Research system's presentation layer: sidebar quick-access panel,
> Full Tree modal, node cards, popups, and interaction model. This document does not
> define research mechanics — those live in `RESEARCH.md` (perk taxonomy, live-recompute
> fallback rule, respec sequencing, currency/anti-snowball curve, Auto/Manual perk
> activation). Every screen below is a presentation of that mechanism; when in doubt
> about *why* something behaves a certain way, check `RESEARCH.md` first.
> All mockups are ASCII wireframes describing layout, hierarchy, and behavior —
> not final pixel dimensions, colors, or typography. Those are a visual/frontend pass
> on top of this spec, not defined here.
> Last updated: September 2026.

---

## 1. Panel Structure & Entry Points

- **Sidebar quick-access panel** — non-modal, hotkey `Y` (per `UI_UX_DESIGN.md` §5),
  slides in alongside the map, map stays interactive behind it. This is the existing
  "Available research" panel, restructured per §3 below.
- **Full Tree modal** — opened via the "Full Tree" button in the sidebar header.
  Full-center overlay, dims the map (same visual treatment as the Diplomacy panel),
  and **replaces** the sidebar view while open — the two don't coexist on screen.
- **Branch tabs** inside Full Tree: `Tab` key cycles through them, clicking a tab
  title also switches — same interaction pattern already used by the Diplomacy
  panel's Nations / Alliance / Trade Routes tabs.
- `Esc` or the `✕` button closes Full Tree and returns to the map (sidebar does not
  auto-reopen; player re-invokes it with `Y` if they want it).

---

## 2. Axis Orientation (settled)

**Paths run horizontally (columns). Tiers run vertically, top → down (rows).**

Rationale: the shared tree widget spec in `DEV_PHASES.md` already describes "paths as
columns, tiers as rows." It also fits the actual screen shape we're designing into —
the sidebar/unit-list occupies a narrow vertical strip, leaving a **wide** canvas that's
better used spreading paths side-by-side than stacking them. A mutex tier (multiple
path-columns converging on one shared choice) then naturally draws as a single
horizontal row with a bracket spanning the columns it applies to — see §5.1.

```
        Path A        Path B        Path C
Tier1  ┌──────┐      ┌──────┐      ┌──────┐
       │ node │      │ node │      │ node │
       └──┬───┘      └──┬───┘      └──┬───┘
          │             │             │
Tier2  ╔══╧═════════════╧═════════════╧══╗   ← mutex row spans all 3 columns
       ║   choose ONE of these options    ║
       ╚══╤═════════════╤═════════════╤══╝
          │             │             │
Tier3  ┌──┴───┐      ┌──┴───┐      ┌──┴───┐
       │ node │      │ node │      │ node │
       └──────┘      └──────┘      └──────┘
```

---

## 3. Sidebar (Quick-Access) Panel

### 3.1 Section rules

**IN PROGRESS** — always shown, always on top, never filtered. Sorted soonest-to-complete.

**NEW** — a rolling window of the **latest 3–5** nodes that just became available as a
direct result of something completing. Being a recency window, this needs **no
seen/dismissed flag** — an item ages out on its own once enough newer ones exist.

**AVAILABLE** — one card per unit/research-item, excluding anything already shown in
NEW. Resolution rule per unit:
- If the unit has prior research: show the **next tier up in the path where its most
  recently completed node lives** ("continuing your chain/doctrine").
- If the unit has **zero** research yet: no "last path" exists to continue, so fall
  back to its **tier-1 entry node(s)** instead, labeled "start here." Without this
  fallback, a fresh match (nothing researched yet) would show an empty Available
  section, which is a bad first impression at 00:00.
- If the next step is a **mutex tier**, show the whole choice-point as one card
  (opens the multi-option popup on click) — never pre-pick one option to display.
- Sort: most-recently-active unit first. **Cold-start exception:** at match start,
  with no activity yet to sort by, fall back to branch order (Infantry → Ordnance →
  Armour → Air → Naval → Economy → General), then tier ascending, then cost ascending.
- **Hard cap** (6–8 cards). Below the cap, a **"View Full Tree →"** link — no infinite
  scroll, no attempt to show every available node (that's what Full Tree is for).

A branch filter dropdown ("All branches" default) and a search box sit above all
three sections and apply to all of them at once.

### 3.2 Mockups

**Normal state, mid-game:**
```
┌─ RESEARCH ─────────────────────┬───────────┐
│                                 │ Full Tree │ ✕ │
├─────────────────────────────────────────────┤
│ [🔍 search]              [ All branches ▾ ]  │
├─────────────────────────────────────────────┤
│ IN PROGRESS                                  │
│ ┌───────────────────────────────────────┐   │
│ │ ➕ Basic Airframes          96% ▓▓▓▓▓▓▓░│   │
│ └───────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│ NEW  (latest 5)                              │
│ ┌───────────────────────────────────────┐   │
│ │ 🆕 ⚙➕ Semi-Automatic Rifle              │   │
│ │ Infantry · Standard · Tier 2   RP: 6    │   │
│ └───────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│ AVAILABLE — your next step per unit          │
│ ┌───────────────────────────────────────┐   │
│ │ ⚙▣ Improved APC — continuing chain      │   │
│ │ Armour · Mech. Inf.            RP: 8    │   │
│ └───────────────────────────────────────┘   │
│ ┌───────────────────────────────────────┐   │
│ │ ╔═══════════════════════════════════╗   │   │
│ │ ║ ⚥ CHOOSE: Fire&Move/Bayonet/       ║   │   │
│ │ ║   Marksman — Standard Inf. Tier 3  ║   │   │
│ │ ╚═══════════════════════════════════╝   │   │
│ └───────────────────────────────────────┘   │
│ ┌───────────────────────────────────────┐   │
│ │ ➕ Light Tank Chassis — start here       │   │
│ │ Armour · Light Tank            RP: 4    │   │
│ └───────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│              [ View Full Tree → ]            │
└─────────────────────────────────────────────┘
```

**Cold-start state (00:00, nothing researched yet):**
```
┌─ RESEARCH ─────────────────────┬───────────┐
│                                 │ Full Tree │ ✕ │
├─────────────────────────────────────────────┤
│ [🔍 search]              [ All branches ▾ ]  │
├─────────────────────────────────────────────┤
│ IN PROGRESS — (empty, nothing started yet)   │
├─────────────────────────────────────────────┤
│ NEW — (empty, nothing has completed yet)     │
├─────────────────────────────────────────────┤
│ AVAILABLE — tier-1 entry points, all "start   │
│ here" (sorted by branch order, no activity    │
│ signal exists yet to sort by)                 │
│ ┌───────────────────────────────────────┐   │
│ │ ➕ Basic Infantry Training — start here  │   │
│ │ Infantry · Standard            RP: 4    │   │
│ └───────────────────────────────────────┘   │
│ ┌───────────────────────────────────────┐   │
│ │ ➕ Light Tank Chassis — start here       │   │
│ │ Armour · Light Tank             RP: 4   │   │
│ └───────────────────────────────────────┘   │
│ ┌───────────────────────────────────────┐   │
│ │ ➕ Basic Airframes — start here          │   │
│ │ Air · General                   RP: 4   │   │
│ └───────────────────────────────────────┘   │
│  ...(capped at 6–8)...                       │
├─────────────────────────────────────────────┤
│              [ View Full Tree → ]            │
└─────────────────────────────────────────────┘
```

**Filtered by branch + search applied:**
```
┌─ RESEARCH ─────────────────────┬───────────┐
│                                 │ Full Tree │ ✕ │
├─────────────────────────────────────────────┤
│ [🔍 "terrain"]              [ Armour ▾ ]     │
├─────────────────────────────────────────────┤
│ AVAILABLE (matches only)                     │
│ ┌───────────────────────────────────────┐   │
│ │ ⚙ Rough Terrain Mobility                │   │
│ │ Armour · Light Tank · Tier 3   RP: 10   │   │
│ └───────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│              [ View Full Tree → ]            │
└─────────────────────────────────────────────┘
```
IN PROGRESS / NEW sections collapse if the filter/search excludes everything in them —
don't render an empty header.

---

## 4. Full Tree Panel

### 4.1 Layout

```
┌─ RESEARCH ───────────────────────────────────────────────────────────┐
│ Infantry  Ordnance  Armour  Air  Naval  Economy  General             │ ✕ │
├───────────┬────────────────────────────────────────────────────────────┤
│[🔍 search]│ [ – ] [Fit] [ + ]                                          │
├───────────┤                                                            │
│●Standard 9/14                                                          │
│●Assault  4/12         [ canvas — selected unit's tree, pan/zoom ]      │
│○MG Team  0/9          (default view: zoomed near researched            │
│●AT Inf.  2/10          frontier, NOT full overview — see 4.2)          │
│○Recon    0/8                                                           │
│○Flame    0/7                                                           │
│○Sniper   0/6                                                           │
│○Commando 0/6                                                           │
│     ▼                                                                  │
├────────────────────────────────────────────────────────────────────────┤
│ Legend:  🟧 Available  🟩 Researched  ▓ Researching  ▪dim Locked       │
└────────────────────────────────────────────────────────────────────────┘
```

- **Left rail:** search box (highlights matches across every unit in this branch, not
  just the selected one), then a vertical, scrollable unit list. Filled `●` = at least
  one node researched in that unit's tree; hollow `○` = untouched. Fraction shows
  researched/total nodes. Selecting a unit swaps the canvas.
- **Canvas:** pan via drag, zoom via scroll wheel or the `[–] [+]` buttons. `[Fit]`
  snaps to the full tree's bounds for that unit.
- **No minimap** — cut deliberately. See §9 for rationale; replaced by the edge-fade
  arrows below.
- **Legend** is a persistent footer, not a tooltip — always visible so state is never
  ambiguous (this is the direct fix for the contrast/legibility complaints that plague
  flat tech-tree UIs in comparable games).

### 4.2 Default view vs. Fit view

```
DEFAULT (on opening a unit, or after completing research):        FIT (after clicking [Fit]):
┌───────────────────────────────┐                          ┌───────────────────────────────┐
│         ▲                     │                          │  ┌──┐  ┌──┐  ┌──┐  ┌──┐        │
│  ┌────┐ │ ┌────┐              │                          │  └┬─┘  └┬─┘  └┬─┘  └┬─┘        │
│  │Res.│─┼─│Res.│──┐           │   click [Fit] ──►        │   └─────┴──╥──┴─────┘          │
│  └────┘ │ └────┘  │           │                          │        ╔═══╩═══╗                │
│       ┌─┴──┐   ┌──┴─┐         │                          │        ║ mutex ║                │
│       │Avl │   │Avl │         │                          │        ╚═══╤═══╝                │
│       └────┘   └────┘         │                          │       ┌────┴────┐ ...           │
│         ▼                     │                          │       whole tree visible,       │
└───────────────────────────────┘                          │       zoomed out, smaller text   │
  zoomed to researched + adjacent                          └───────────────────────────────┘
  frontier only — this is what opens by default
```

Rationale: opening straight to a full zoomed-out tree is the exact failure mode that
makes large node-web UIs (e.g. Path of Exile's passive tree) feel intimidating to new
players. Defaulting to "your current frontier," with Fit as an explicit opt-in for the
big picture, keeps the common case (deciding what to research next) fast and legible.

### 4.3 Edge-fade directional indicators (minimap replacement)

Small fade/arrow overlays appear only on whichever canvas edge actually has off-screen
content — computed by comparing the camera's visible bounds against the tree's total
bounds. No second camera, no rendered minimap texture, just bounds comparison.

```
Content above only:        Content left + below:       Content on all sides:      Nothing off-screen:
┌───────────────┐          ┌───────────────┐           ┌───────────────┐          ┌───────────────┐
│      ▲         │          │               │           │      ▲        │          │               │
│               │          │  [visible]     │           │  ◄ [visible] ►│          │  [visible]     │
│  [visible]     │          │               │           │      ▼        │          │  (whole tree   │
│               │          │  ◄             │           │               │          │   fits)        │
│               │          │      ▼         │           │               │          │               │
└───────────────┘          └───────────────┘           └───────────────┘          └───────────────┘
```

### 4.4 Wide-tree case (more paths than fit on screen)

Same mechanism as depth — horizontal edge-fade arrows (`◄`/`►`) instead of forcing every
path into view at once. A Flagship-equivalent unit tree (per `ECONOMY_BUILDINGS.md`'s
width/depth bands, ~3–4 paths × 6–7 tiers) should still fit inside one `[Fit]` view on
most screens; arrows are the fallback for anything wider, not the primary navigation.

### 4.5 Empty/stub branch state

Applies to Infantry, Artillery, Air, Naval per Phase 11's MVP scope (only Armour has
real tree content at launch; see `DEV_PHASES.md` Phase 11).

```
┌─ RESEARCH ───────────────────────────────────────────────────────────┐
│ Infantry  Ordnance  Armour  Air  Naval  Economy  General             │ ✕ │
├───────────┬────────────────────────────────────────────────────────────┤
│           │                                                            │
│  (unit    │              🔧  Coming Soon                                │
│  list     │      Infantry doctrine trees are still in                  │
│  empty)   │      development for this build.                           │
│           │                                                            │
└───────────┴────────────────────────────────────────────────────────────┘
```
The branch tab itself is still clickable and visible (not hidden) — this communicates
"the panel structure is correct, content is coming," matching the same intent already
specified for `LandDoctrineUI`'s Infantry/Artillery sub-tabs in Phase 11.

---

## 5. Node Card Visual System

### 5.1 Composable badges — not exclusive shapes

**Important, supersedes earlier framing:** node "type" is not a single exclusive shape.
Real content mixes freely (e.g. "Improved APC" is a lineage-chain step, changes a
mechanic, *and* carries flat armor numbers, all at once). So the card shape stays
**one consistent shape**; badges stack on top of it, any combination:

| Badge | Meaning |
|---|---|
| ⚙ | Mechanic-change — introduces a new rule (terrain permission, multi-target hit, damage-curve reshape) |
| ▣ | Lineage/new-entity — this tier is (or includes) a discrete new grid entity replacing the previous tier |
| ⇄ | Redistribute — trades strength between two effects the thing already has |
| ➕ | Additive — carries a flat numeric stat change |

**Size/prominence** (minor vs. notable) is a **separate, author-set flag**, independent
of which badges are present — a design-significance call, not a type. This mirrors how
Path of Exile's tree distinguishes small vs. notable passives regardless of what the
passive actually does.

**Mutex is the one true structural exception** — not a badge, not a size choice, but a
different container: a gold double-border box with a bracket connecting the tier's
options, because it changes *how many you can have* (one), which is fundamentally
different from what any individual option does.

```
MINOR (author-flagged small), any badge combo:      NOTABLE (author-flagged large), any badge combo:
┌───────────────────┐                               ┌─────────────────────────────┐
│ ➕ +5 dmg   Tier 2  │                               │ ⚙▣  Improved APC              │
└───────────────────┘                               │ Full-tracked hull, higher     │
                                                      │ off-road speed; +armour,      │
┌───────────────────┐                                │ +suppression resist           │
│ ⚙ +terrain  Tier 3 │                                │ Tier 4                 RP: 8  │
└───────────────────┘                                └─────────────────────────────┘

MUTEX TIER (structural container — options inside can carry any badges/size):
╔═════════════════╗   ╔═════════════════╗   ╔═════════════════╗
║ ⚙ Fire & Move    ║ ⇔ ║ ⚙➕ Bayonet       ║ ⇔ ║ ➕ Marksman       ║
║ Doctrine          ║   ║ Doctrine         ║   ║ Training         ║
╚═════════════════╝   ╚═════════════════╝   ╚═════════════════╝
        "choose one — this tier only, respec available later"
```

### 5.2 State — orthogonal layer, applies on top of any card

State is independent of badges and size — it's rendered as a border/fill treatment on
whatever card shape the node already has.

```
              AVAILABLE            RESEARCHING              RESEARCHED             LOCKED
           (amber, solid       (existing progress-bar    (green, filled)      (desaturated,
            border)             fill animation, reused)                       ~40% opacity)
         ┌───────────┐         ┌───────────┐            ┌───────────┐        ┌ ─ ─ ─ ─ ─ ┐
         │ ⚙▣ Improved│         │ ⚙▣ Improved│           │ ⚙▣ Improved│         ⚙▣ Improved
         │    APC     │         │    APC     │           │    APC     │        │    APC    │
         │            │         │▓▓▓▓▓▓▓░░░ 78%│         │            │        │           │
         └───────────┘         └───────────┘            └───────────┘        └ ─ ─ ─ ─ ─ ┘
          🟧 border              existing animated         🟩 fill              dimmed, no
                                 fill widget                                    border emphasis
```

Same node, shown across its four possible states, to make the point that shape/badges
never change — only this outer treatment does.

---

## 6. Interaction Model

Replaces the current click-to-instantly-start behavior. Every click now opens a popup;
nothing starts researching without an explicit Confirm.

### 6.1 Hover (any node, any state) — lightweight, no click required

```
      ┌ ⚙▣ Improved APC ─────┐
      │ Full-tracked hull,   │
      │ +armour, +suppress.  │
      │ RP: 8 · Tier 4       │
      └──────────────────────┘
```
No image, no buttons — just enough to scan quickly while moving the cursor around the
tree. This is the "orient before you commit" layer.

### 6.2 Click on an **Available** node → actionable Confirm/Cancel popup

Image sits at the top with a vignette that fades down into the panel (same treatment
used for the path-column backdrop art). Body scrolls if the description is long;
footer with Cancel/Confirm is **pinned outside the scroll area, always visible**.

```
┌───────────────────────────────────────┐
│ ░░░░░[image: half-track APC   ░░░░░░░ │
│ ░░░░░ column, period photo]░░░░░░░░░░ │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ⚙▣  IMPROVED APC                        │
│ Armour → Mechanised Infantry chain      │
│───────────────────────────────────────│
│ ↕ (scrolls if long)                     │
│ Full-tracked hull replaces the          │
│ half-track. Higher off-road speed,      │
│ +armour, +suppression resistance.       │
│                                          │
│ Requires: APC (half-track) ✓            │
│ Research points: 8                      │
│───────────────────────────────────────│  ← fixed, never scrolls
│         [ Cancel ]      [ Confirm ]     │
└───────────────────────────────────────┘
```

### 6.3 Click on an Available **mutex** option → same shell, warning inserted in-body

Only appears when the player already has a conflicting pick elsewhere at that tier.
Warning sits in the scrollable body so it can never push the footer off-screen.

```
┌───────────────────────────────────────┐
│ ░░░░░[image]░░░░░░░░░░░░░░░░░░░░░░░░ │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ⚙  BAYONET DOCTRINE                     │
│───────────────────────────────────────│
│ ...perk description...                  │
│                                          │
│ ⚠ Researching this will un-research     │
│   "Fire & Move Doctrine" once complete. │
│   It stays active until then. No RP     │
│   refunded.                             │
│───────────────────────────────────────│
│         [ Cancel ]      [ Confirm ]     │
└───────────────────────────────────────┘
```
Sequencing on Confirm here matches `RESEARCH.md`'s respec rule exactly: old perk stays
fully active for the whole duration of the new research, un-researched only the instant
the new one completes, no refund.

### 6.4 Click on a **Locked** node → read-only info popup

Close button only — nothing to confirm. Shows which prerequisites are and aren't met,
so a player understands *why* it's locked without guessing.

```
┌───────────────────────────────────────┐
│ ░░░░░[image]░░░░░░░░░░░░░░░░░░░░░░░░ │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ⚙▣  IFV               🔒 LOCKED         │
│───────────────────────────────────────│
│ description text...                     │
│                                          │
│ Requires:                               │
│   ✓ Improved APC                        │
│   ✗ Medium Tank (not researched)        │
│───────────────────────────────────────│
│                        [ Close ]        │
└───────────────────────────────────────┘
```

### 6.5 Click on a **Researched** node → read-only info popup, no requirements block

```
┌───────────────────────────────────────┐
│ ░░░░░[image]░░░░░░░░░░░░░░░░░░░░░░░░ │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ⚙▣  IMPROVED APC        ✅ RESEARCHED   │
│───────────────────────────────────────│
│ description text...                     │
│───────────────────────────────────────│
│                        [ Close ]        │
└───────────────────────────────────────┘
```

### 6.6 Click on a **Researching** node → progress popup, with Cancel

**Decided:** cancelling is allowed. Progress resets to 0%; a portion of the currency
already invested is refunded (fixed refund rate — a balance constant, not specified
here), the remainder is forfeited. See `RESEARCH.md` — Cancelling In-Progress Research.

```
┌───────────────────────────────────────┐
│ ░░░░░[image]░░░░░░░░░░░░░░░░░░░░░░░░ │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ⚙▣  IMPROVED APC                        │
│───────────────────────────────────────│
│ description text...                     │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░  78%            │
│───────────────────────────────────────│
│      [ Cancel Research ]   [ Close ]    │
└───────────────────────────────────────┘
```

"Cancel Research" opens a confirmation sub-step (destructive, mirrors the respec
confirmation pattern) showing exact numbers before committing — never cancel silently:

```
┌───────────────────────────────────────┐
│ ⚠  CANCEL RESEARCH?                     │
│───────────────────────────────────────│
│ Improved APC — 78% complete             │
│                                          │
│ Invested so far:      6.2 RP            │
│ Refunded (partial):   3.1 RP            │
│ Forfeited:            3.1 RP            │
│                                          │
│ Progress resets to 0%. This cannot be   │
│ undone.                                 │
│───────────────────────────────────────│
│         [ Back ]      [ Confirm Cancel ]│
└───────────────────────────────────────┘
```

`invested_so_far`, `refund`, and `forfeit` here are computed at popup-open time from
`progress% × cost_rp` and the refund-rate constant — not stored per-node fields.

---

## 7. Node Data Fields the UI Needs

Per node, the UI layer expects (naming indicative, not a schema mandate):

- `id`, `branch` (Infantry/Ordnance/Armour/Air/Naval/Economy/General), `unit_id`
- `path_id`, `tier` (position for layout)
- `badges: []` — any of `mechanic`, `lineage`, `redistribute`, `additive`
- `size: "minor" | "notable"` — independent of badges
- `mutex_group_id` (nullable) — nodes sharing a group render as one bracketed row
- `name`, `description`, `cost_rp`
- `requires: [{node_id, met: bool}]` — for the Locked popup's requirement list
- `image_asset` — for the popup header image
- `state` — derived at render time from live game/research data, not stored on the node
- `is_new` — derived from recency (see §3.1), not a stored flag

---

## 8. Godot Implementation Notes

**Search box:** a `LineEdit` node, no custom control needed. Wire `text_changed`:

```gdscript
func _on_search_text_changed(query: String) -> void:
    var q := query.to_lower()
    for node_card in all_node_cards:
        var hay := (node_card.node_name + node_card.description).to_lower()
        node_card.set_highlighted(q != "" and hay.contains(q))
```

At the scale involved (hundreds of nodes total, not thousands), this runs instantly —
no indexing or debounce required, though a debounce timer is a fine polish item later.
Recommended default highlight treatment: dim non-matching cards to ~40% opacity via a
single `modulate` change (cheapest); an animated border-glow (via `Tween` or
`AnimationPlayer`) is a nice-to-have upgrade, not a requirement.

**Progress bar (Researching state):** reuse the existing animated fill widget already
built for the current sidebar (see the "Researching 96%" behavior already in place) —
no new widget needed, just apply it inside the new card shape.

**Edge-fade arrows:** pure bounds comparison (camera viewport rect vs. tree content
rect), toggling arrow visibility per side — no new rendering pipeline.

---

## 9. Explicitly Deferred / Rejected

- **Minimap — rejected.** A `SubViewport` + second `Camera2D` + coordinate-mapping
  overlay is a real chunk of work, and the problem it solves (disorientation in a huge
  node space) doesn't really exist at our scale — even the largest width/depth band
  (Flagship-equivalent, ~3–4 paths × 6–7 tiers, ~20–28 nodes) fits inside one `[Fit]`
  view on most screens. Replaced by the near-free edge-fade arrows in §4.3. If future
  content ends up far exceeding current bands, a real minimap is still a pure UI-layer
  add at that point — nothing about node/position data needs to change to support it
  later.
- **Manual perk-mode toggle UI** (per-template active/inactive perk selection) — out of
  scope for this handoff entirely. `RESEARCH.md` defines the data seam
  (`perk_mode: "auto"|"manual"`, `active_perks`) so this can be added later without a
  data migration, but no UI for it exists yet; every slot is Auto-only for now.
- **Exact colors, fonts, spacing, node card pixel dimensions** — a visual/frontend pass
  on top of this spec; only semantic states (amber/green/dim/animated) are defined here.

---

## 10. Cross-References

- `RESEARCH.md` — perk taxonomy, live-recompute + fallback rule, respec sequencing,
  currency & anti-snowball floor, Auto/Manual seam, session-reset scope.
- `TACTICAL_COMBAT.md` — Armoured branch content (the only branch with real tree
  content for the Phase 11 MVP; everything else renders the empty-stub state in §4.5).
- `DEV_PHASES.md` Phase 11 — the Colyseus/Godot task breakdown this UI plugs into,
  including the shared adjacency-web rendering widget this panel is built from.
- `UI_UX_DESIGN.md` §5 — `Y` hotkey placement, full-center overlay pattern for
  decision-heavy panels, and the Tab-cycles-subtabs precedent this reuses.
