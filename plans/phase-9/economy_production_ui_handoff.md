# Economy & Production UI — Implementation Handoff

**Status:** Structure and interaction behavior fully specified below. Exact colors,
pixel sizing, and animation timing are not specified — build against the existing HUD's
visual language (dark panel, amber/gold accent, the style already established in the
current top bar / Military / Diplomacy screens). Numeric thresholds inherited from the
mechanics docs (severity bands, thresholds) are marked TBD there and are not re-derived
here.

**Not part of the project design docs.** Supplementary handoff for implementation,
written to accompany `unit_production_handoff.md` (the mechanics side of this same
system — Reserve, Marshalling, the auto-scheduler, `build_points`). Read both together;
this document assumes everything in that one and doesn't re-explain the underlying
mechanics, only how they surface in the UI. Also assumes the mechanics doc updates made
to `RESOURCE_ECONOMY.md`, `ECONOMY_BUILDINGS.md`, `MAP_DATA_CONTRACT.md`,
`DATA_CONTRACTS.md`, and `DEV_PHASES.md` in the same session as this handoff.

---

## 1. General UI Patterns

Four reusable patterns, all derived from conventions already visible in the existing
HUD screenshots — nothing below invents a new interaction paradigm the game doesn't
already use elsewhere.

**Sidebar Panel.** The existing left-edge button column (`Q RES`, `E ECO`, `R MIL`, `T
DIP`, ...). Clicking a button expands it in place to show list-style content, optionally
with its own sub-tabs (as `R MIL` already does with Land/Air/Naval). This document adds
one new sidebar button: **Production** (see §7). List content stays narrow-column width.

**Modal Overlay.** For anything needing more room than the sidebar's width allows. A
large panel centered on screen, with a top-right `[X]` close button, layered on top of
the map. The sidebar remains visible and dimmed underneath (already the existing
behavior for Division Template Edit — see the reference screenshot). Closing an overlay
simply reveals whatever was already open behind it — there is no back-navigation stack,
because there's only ever one layer. **Only one Modal Overlay may be open at a time.**
Opening a new one closes whichever was already open. This document introduces three:
Province Detail (§3), Market (§5), and Propose Trade Route (§6).

**Hover Flyout.** A small tooltip-style popup anchored to a trigger element, shown on
hover (no click required), dismissed on mouse-leave. Used once, in the top bar (§2).

**Compact Status Strip.** A minimal-footprint horizontal readout embedded directly on
the map surface (not the sidebar), using icons and level badges instead of full text
rows to maximize information density in a small footprint. Optionally paired with a
collapsible detail strip beneath it for anything that doesn't fit inline. Used for the
province HUD panel (§9).

---

## 2. Top Bar

```
+--------------------------------------------------------------------------------------------+
| [FLAG] GERMANY   $1,240 (+18/t)   GRAIN[###...] +6/t   OIL[#.....]! -3/t   MANPOWER 4.2k/6k |
|                                                            [Market]  [v 6 more]   00:00:18  [gear] |
+--------------------------------------------------------------------------------------------+
                                                                    (hover "v 6 more")
                                                          +-----------------------------+
                                                          | IRON        310    +4/t     |
                                                          | RUBBER      180    +2/t     |
                                                          | NITRATES    210    +2/t     |
                                                          | TUNGSTEN     60    +1/t     |
                                                          | CHROMIUM      0    +0/t     |
                                                          | ALUMINIUM    75    +1/t     |
                                                          | URANIUM       5    +0/t     |
                                                          +-----------------------------+
```

**Always shown, in this fixed order:** Money, Grain, Oil, Manpower. These four are the
"is this nation currently functioning" signals — money (afford things), grain
(population sustained), oil (existing mechanized/naval/air forces can operate — a
shortage here is felt fleet-wide immediately, unlike other resources which only slow
future production), manpower (can still reinforce/build). This selection is fixed
regardless of nation — it does not vary by what a nation has access to, unlike the
flyout below.

**Money, Grain, Oil display as bar-fill icon + net rate** (`+N/t` or `-N/t`), consistent
with the resource visual language used elsewhere (Economy → Resources, §4). Oil (and
any other resource in the flyout, when its shortage-penalty is actively suppressing
something) gets a **`!` marker** appended — this reflects RESOURCE_ECONOMY.md's rate-
modifier mechanic actually biting, not just low stock. Do not show `!` purely for low
stock with no active penalty.

**Manpower displays differently: plain `available / ceiling` text, no bar-fill icon.**
This is deliberate, not an oversight — manpower isn't one of the ten tradeable resources
(it's derived from population, per RESOURCE_ECONOMY.md's Population and Manpower
section), so giving it the same bar-fill treatment as a tradeable resource would
misleadingly imply it can be bought/sold on the Market (§5). This is **available**
manpower (the spendable pool), not committed manpower (sum of manpower cost across
fielded + deploying units) — available reads more naturally as a warning signal: a
draining bar nearing empty is instantly legible as "running low," whereas a filling
"committed" bar risks reading as a good, growing thing when it's actually a concern.

**`[v N more]` — hover flyout, not click-navigation.** Shows every resource *not* in the
always-shown four, in a compact list (name, stockpile, net rate, no bar-fill needed at
this size). **Only resources this nation actually has meaningful access to appear here**
— a landlocked nation with zero aluminium access never shows an aluminium row. `N`
in the button label reflects the actual count for this nation (varies 0–7). This is
distinct from the Market panel below, which shows all ten resources regardless of
whether this nation produces them.

**`[Market]` button** sits immediately beside the flyout trigger. Opens the Market Modal
Overlay (§5).

---

## 3. Provinces — Sidebar List + Province Detail Overlay

**Sidebar list (new sidebar entry, or a sub-view depending on where `Q` currently
routes — placement within the existing sidebar taxonomy is an open item, see §11):**

```
+----------------------+
| PROVINCES        [Q] |
+----------------------+
| Berlin        (cap)  |
| Hamburg               |
| Bremen                |
| Essen                 |
| Stettin                |
| Breslau                |
| Frankfurt               |
+----------------------+
```

Plain list, one row per owned province, capital marked. Clicking a row opens Province
Detail as a Modal Overlay:

```
SIDEBAR (stays visible, dimmed)              OVERLAY (center, on top of map)
+-------------+                              +----------------------------------------+
| PROVINCES   |   --- click "Essen" --->     | ESSEN                            [X]   |
|  Berlin(cap)|                              | Germany | Pop 64 | Ind 58 | Infra 71   |
|  Hamburg    |                              +----------------------------------------+
| >Essen<     |                              | RESOURCES PRODUCED HERE                |
|  Stettin    |                              |   Iron    [====......]  base 20->34    |
|  Breslau    |                              +----------------------------------------+
+-------------+                              | BUILDINGS                              |
                                              |  Iron Mine        Lv 3/5  [Upgrade] [Path >]
                                              |  Warehouse/Depot  Lv 1/5  [Upgrade] [Path >]
                                              |  Barracks         Lv 1/5  [Upgrade]  (fixed)
                                              |  Tank Plant        Lv 1/5  [Upgrade]  [Path >]
                                              |  School            Lv 0/5  [Build]
                                              |  Hospital           Lv 0/5  [Build]
                                              |  Infrastructure      Lv 2/5  [Upgrade] [Path >]
                                              +----------------------------------------+
                                              | [+ Add building]                       |
                                              +----------------------------------------+
```

**Row-level rules:**
- One row per building the province either has (level ≥1) or could build (level 0,
  button reads `Build` instead of `Upgrade`).
- **`[Path >]`** only appears for buildings with more than one research path (per
  ECONOMY_BUILDINGS.md's Complexity classification for that building). Single-path
  buildings (Barracks, Ordnance Factory, Tungsten Mine, Chromium Mine, Uranium Mine, and
  any other Simple/1-path building) show **`(fixed)`** instead — there's nothing to
  branch into.
- `[Path >]` opens whatever UI owns the perk-tree/research view (the `Q RES` research
  panel) — Province Detail links to it rather than duplicating perk-tree UI inline.
- The "RESOURCES PRODUCED HERE" block only appears if this province has at least one
  resource-extraction building with output >0; a province with no extraction buildings
  omits this block entirely rather than showing an empty one.

No back button — closing `[X]` reveals the still-present sidebar list underneath, per
§1's Modal Overlay pattern.

---

## 4. Economy Panel (sidebar, existing `E ECO` button) — 3 tabs

### Tab 1 — Resources

```
+-----------------------------------------------------------+
| RESOURCES                                                  |
+-----------------------------------------------------------+
| Money      12,400   +18/t                    [======..]   |
| Grain         420   +6/t                      [====....]  |
| Iron          310   +4/t                      [#####...]  |
| Oil            40   -3/t  !                   [#.......]  |
| Rubber        180   +2/t                       [###.....] |
| Nitrates      210   +2/t                       [####....] |
| Tungsten       60   +1/t                        [##......]|
| Chromium        0   +0/t                        [........]|
| Aluminium      75   +1/t                        [###.....]|
| Uranium         5   +0/t                        [#.......]|
+-----------------------------------------------------------+
| Manpower avail: 4,200 / 6,000                              |
+-----------------------------------------------------------+
```

All ten resources always listed here (unlike the top bar's curated four + flyout) —
this is the full national ledger, not a quick-glance summary. Bar-fill shows current
stock against Warehouse's storage cap. Manpower gets its own row at the bottom, same
`available/ceiling` framing as the top bar, for the same reason (not tradeable, not one
of the ten).

### Tab 2 — Industry (Pool sliders)

```
+-----------------------------------------------------------+
| INDUSTRY POOL ALLOCATION                                   |
+-----------------------------------------------------------+
| COMMON                                                      |
|  Money      [-----|===========]  62%                        |
|  Grain      [---|=============]  70%                         |
|  Iron       [-------|=========]  45%                          |
| RESTRICTED (nation has access)                                 |
|  Oil        [====|==============] 80%                           |
|  Rubber     [-----------|======]  25%                             |
|  Nitrates   [---|=============]  70%                                |
| NATIONAL                                                              |
|  Construction Speed     [------|=========] 55%                         |
|  Unit Production Speed  [----------|=====] 30%                          |
+-----------------------------------------------------------+
| [Reset to Default]                                          |
+-----------------------------------------------------------+
```

Sliders grouped Common / Restricted (only resources this nation has access to — a
nation without chromium never sees a dead chromium slider) / National. Live drag,
near-instant reallocation, short cooldown to prevent frame-perfect micromanagement (see
ECONOMY_BUILDINGS.md's Industry Pool section for the underlying reallocation rules).

### Tab 3 — My Trade

```
+-----------------------------------------------------------+
| MY TRADE                                                    |
+-----------------------------------------------------------+
| MY SPOT ORDERS                                               |
|  Sell  Rubber   80 @ 1.1        [Cancel]                       |
|  Buy   Iron     50 @ 2.6        [Cancel]                        |
|                                                                    |
|  Place new orders from the Market panel   [Market]                  |
+-----------------------------------------------------------+
| TRADE ROUTES   (read-only — manage in Diplomacy)               |
|  -> France   Iron 20/t  <-  Grain 15/t     Active                 |
|  -> Poland   (proposed, awaiting response)                          |
+-----------------------------------------------------------+
```

Deliberately narrow scope: this tab shows only the player's own active spot orders
(with Cancel) and a read-only summary of their trade routes. It is **not** a market
browser (that's §5) and **not** where routes are created or ended (that's §6). The
`[Market]` button here is a shortcut to the same overlay the top bar's `[Market]` button
opens — same destination, two entry points.

---

## 5. Market — Modal Overlay (opened from the top bar or Economy → My Trade)

Each resource gets its own column: a BUY section (top 3 lowest sell-offers — i.e. what
you'd pay to buy) and a SELL section (top 3 highest buy-offers — i.e. what you'd get to
sell), each with an `[+ Add offer]` button beneath its top 3 for placing a new order of
your own.

**Single column, detailed view:**
```
+----------------+
|      IRON      |
+----------------+
| BUY (top 3)    |
|  2.4 x120 [Buy]|
|  2.5 x80  [Buy]|
|  2.6 x50  [Buy]|
| [+ Add offer]  |
+----------------+
| SELL (top 3)   |
|  2.2 x90 [Sell]|
|  2.1 x40 [Sell]|
|  2.0 x20 [Sell]|
| [+ Add offer]  |
+----------------+
```

**Full layout — all ten resource columns, horizontally scrollable past what fits:**
```
+------------------------------------------------------------------------------------------+
| MARKET                                                                              [X]   |
+------------------------------------------------------------------------------------------+
|   IRON        RUBBER       OIL          GRAIN        TUNGSTEN     |  < scroll for 5 more >|
|   [as above]  [...]        [...]        [...]        [...]        |                        |
+------------------------------------------------------------------------------------------+
```

**Unlike the top bar's flyout, all ten resources appear here regardless of whether this
nation produces or has access to them** — a nation with zero chromium deposits may still
want to *buy* chromium, so curating the Market to "resources you already have" would
defeat its purpose.

**Empty-state column — must look intentional, not broken, since early-session or
quiet-lobby markets will often be thin:**
```
+----------------+
|    CHROMIUM    |
+----------------+
| BUY (top 3)    |
|  No offers yet |
|  Be the first  |
| [+ Add offer]  |
+----------------+
| SELL (top 3)   |
|  No offers yet |
| [+ Add offer]  |
+----------------+
```
Same card shape and sizing as a populated column — only the offer rows are replaced with
the empty-state text. The `[+ Add offer]` button stays present and equally prominent in
both states; an empty column should read as "opportunity" (be the first to list), not as
a dead or broken feature.

**Placing an offer** (`[+ Add offer]`) opens a minimal inline form (quantity + price),
not a further nested overlay — keep this a lightweight interaction since it's the core
loop of this screen.

---

## 6. Diplomacy Panel (sidebar, existing `T DIP` button) — 3rd tab added

Existing Nations/Alliance tabs unchanged. New third tab:

```
+-----------------------------------------------+
| DIPLOMACY                              [X]     |
| [ Nations ]  [ Alliance ]  [ Trade Routes ]     |
+-----------------------------------------------+
| MY TRADE ROUTES                                  |
|  [FR] France   Iron 20/t <-> Grain 15/t   [End]   |
|  [PL] Poland   (proposed, awaiting)     [Cancel]   |
+-----------------------------------------------+
| [+ Propose New Route]                              |
+-----------------------------------------------+
```

This is the one and only place trade routes are created or ended — Economy → My Trade
(§4, Tab 3) only displays a read-only mirror of what's here.

### Propose Trade Route — Modal Overlay

```
+---------------------------------------------------------+
| PROPOSE TRADE ROUTE                                [X]   |
+---------------------------------------------------------+
| PARTNER NATION                                              |
|  ( ) France     Direct border                                 |
|  ( ) Poland     Direct border                                   |
|  ( ) UK         Naval access                                      |
|  ( ) Italy      Requires transit via Switzerland (not granted)      |
|                                          [Request Transit]              |
+---------------------------------------------------------+
| YOU SEND                    YOU RECEIVE                     |
|  [Iron    v]   [20]/t         [Grain   v]   [15]/t              |
+---------------------------------------------------------+
|                                       [Send Proposal]           |
+---------------------------------------------------------+
```

**Partner eligibility**, per RESOURCE_ECONOMY.md's Standing Trade Routes rules (shared
border, naval access, or a granted third-party transit right):
- **Nations at War are excluded from the list entirely** — not shown grayed out, not
  shown at all. There's no ambiguity to communicate; they're categorically ineligible.
- **Nations reachable by border or naval access** are directly selectable, with the
  reachability reason shown as a small label (as above) so the player understands *why*
  each option is available, not just that it is.
- **Nations only reachable via an ungranted transit right** are shown but not directly
  selectable — instead of silently disabling the option with no explanation, show the
  blocking reason and a `[Request Transit]` action that starts that separate flow.
- **Empty state**, if literally no nation qualifies: *"No eligible partners — not at
  peace with, bordering, or sea-connected to any nation."*

Resource pair uses two independent dropdown+quantity pairs (You Send / You Receive) —
any of the ten resources selectable on either side, no restriction that the two sides
must differ in kind (though proposing to trade a resource for itself is presumably
nonsensical and can be blocked client-side as a simple validation, not a hard mechanic
rule).

---

## 7. Production Panel — new sidebar entry

New sidebar button. Three tabs: Templates / Reserve / Naval. This panel owns the
*blueprint and economy* side of unit production — actual battlefield division instances
live in Military (§8) instead.

### Tab 1 — Templates

```
+-----------------------------------------------+
| PRODUCTION                              [X]     |
| [ Templates ]  [ Reserve ]  [ Naval ]            |
+-----------------------------------------------+
| DIVISION TEMPLATES                        [+]    |
|  3rd Mechanized      Combined-Arms                |
|    Fielded: 2    Deploying: 1          [Edit]      |
|  1st Infantry Div    Supported Infantry              |
|    Fielded: 4    Deploying: 0          [Edit]        |
|  Armoured Spearhead  Armoured Assault                  |
|    Fielded: 0    Deploying: 1          [Edit]           |
+-----------------------------------------------+
```

This is the existing Division Templates list (from the current Military → Land
sub-panel), relocated here, with **Fielded** (count of real, currently-deployed
divisions using this template) and **Deploying** (count currently in Marshalling —
RESOURCE_ECONOMY.md's Marshalling section) added to each row. A template with 0 fielded
and 0 deploying (never raised yet) still shows both as plain `0` — no special empty
treatment needed at the per-template level, the template itself remains fully editable.
`[Edit]` opens the existing Division Template Edit overlay (unchanged).

### Tab 2 — Reserve

```
+-----------------------------------------------------------------+
| RESERVE                                                          |
+-----------------------------------------------------------------+
| INFANTRY              340 HP-eq              Prod 12/t             |
|  RED    AMBER   neutral   GREEN    BLUE                              |
|  |-------|-------|---▲----|--------|--------|   (balanced, tiny deficit)
+-----------------------------------------------------------------+
| ORDNANCE (Arty/AT/AA)  90 HP-eq              Prod 4/t                 |
|  RED    AMBER   neutral   GREEN    BLUE                                   |
|  |-------|-------|--------|---▲----|--------|   (slight surplus)             |
+-----------------------------------------------------------------+
| TANK                   0 HP-eq               Prod 0/t                         |
|  RED    AMBER   neutral   GREEN    BLUE                                            |
|  |--▲----|-------|--------|--------|--------|   (heavy deficit)                       |
+-----------------------------------------------------------------+
| AIR                    60 HP-eq              Prod 6/t                                  |
|  RED    AMBER   neutral   GREEN    BLUE                                                     |
|  |-------|-------|---▲----|--------|--------|   (balanced)                                     |
+-----------------------------------------------------------------+
```

Four fixed subheading categories: **Infantry, Ordnance (Arty/AT/AA), Tank, Air** — these
map directly to Barracks, Ordnance Factory, Tank Plant, and Aircraft Factory
respectively (ECONOMY_BUILDINGS.md's Military Production Buildings). Naval Reserve is
*not* shown here — it's structurally different (discrete ships, not a fungible pool),
and lives entirely in Tab 3 instead.

**Bar semantics** (full formula in RESOURCE_ECONOMY.md's "Reserve status — deficit/excess
severity," added alongside this handoff):
- The bar is a fixed five-band gradient track (Red / Amber / Neutral / Green / Blue),
  **center-anchored at zero net rate** (production exactly matching consumption). A
  marker (`▲`) shows current position along the track.
- Bar position communicates **trend** (getting worse / stable / getting better), not
  absolute stock level — the absolute number (`340 HP-eq`) and raw production rate
  (`Prod 12/t`) are shown as plain text beside the bar for that purpose instead. Don't
  try to encode both in one number.
- Both position *and* marker color encode severity — deliberate redundancy for
  colorblind accessibility, not just visual flourish.
- **Zero-demand edge case:** a category with no current demand at all (e.g. Tank, if no
  template or fielded division currently wants any) reads as **Neutral**, never as a
  deficit — zero supply against zero demand isn't a problem. Consider a distinct label
  for this case specifically (e.g. `— no demand —`) rather than the same "(balanced)"
  wording used for genuinely-active-and-matched demand, since these are different
  situations for the player even though they render at the same bar position.
- Severity bands are placeholder-threshold, TBD from playtesting — see
  RESOURCE_ECONOMY.md, not re-specified here.

### Tab 3 — Naval

```
+-----------------------------------------------+
| NAVAL                                             |
+-----------------------------------------------+
| UNDER CONSTRUCTION                                 |
|  Destroyer "Z-04"    Kiel      [====......] 45%     |
+-----------------------------------------------+
| UNDER REPAIR                                          |
|  Cruiser "Hipper"    Kiel      [========..] 70%          |
+-----------------------------------------------+
```

One row per ship currently in each state, showing ship name/class, home port/naval base,
and progress. Per NAVAL_COMBAT.md, repair and new construction compete for the same
naval base capacity slots (repair takes priority) — this tab is a forward-planning UI
spec, since naval combat itself isn't implemented yet; the two-list shape should hold
once it is. Empty lists (nothing building, nothing repairing) simply omit that
sub-section rather than showing an empty placeholder, consistent with every other
collapsible-when-empty section in this document.

---

## 8. Military Panel (existing `R MIL` button) — Land/Air/Naval revised

Templates have moved to Production (§7). This panel now tracks **real division
instances** — the battlefield-instance counterpart to Production's blueprint side.
Land tab shown; Air and Naval follow the same Deploying/Deployed shape once those
domains are implemented.

```
+-----------------------------------------------+
| MILITARY                                [X]      |
| [ Land ]  [ Air ]  [ Naval ]                       |
+-----------------------------------------------+
| DEPLOYING                                            |
|  3rd Mechanized #2    62% agg. HP                       |
|    Missing: 2x Medium Tank, 1x Mech. Infantry              |
|    [Cancel]   [Force Deploy]  (unlocks at 50%)               |
+-----------------------------------------------+
| DEPLOYED                                                       |
|  3rd Mechanized #1     Berlin sector       98% HP                 |
|  1st Infantry Div #1   Frankfurt sector   100% HP                    |
|  1st Infantry Div #2   Bremen sector       76% HP                       |
+-----------------------------------------------+
```

**DEPLOYING section — one row per division currently in Marshalling:**
- Shows aggregate HP% (RESOURCE_ECONOMY.md's Marshalling formula — sum of present
  units' current HP over sum of all template-target units' full HP, not headcount).
- Shows what's missing, by unit type and count.
- **`[Force Deploy]`** is disabled/locked until aggregate HP reaches ≥50%; enabling it at
  exactly 50% (not requiring the player to wait past it) matches the locked design.
- **`[Cancel]`** — cancelling a marshalling division returns whatever units it had
  already been allocated back to national Reserve (RESOURCE_ECONOMY.md's Reserve is
  origin-agnostic — nothing about this action is destructive, per the earlier design
  discussion establishing Reserve accepts stock regardless of source). This should not
  read as "wasting" the resources already spent; the units aren't lost, just unassigned.

**Empty state for DEPLOYING**, since a lobby will often have long stretches with nothing
marshalling:
```
| DEPLOYING                                            |
|  No divisions currently marshalling.                    |
|  Raise one from the Production panel.                      |
+-----------------------------------------------+
```

**DEPLOYED section** — one row per real, currently-fielded division using this domain
(Land here). Clicking a row should center/select it on the strategic map (consistent
with STRATEGIC_COMBAT.md's existing division-dot click behavior) rather than opening
another overlay — this list is a navigation aid into the map, not a second home for
division management.

---

## 9. Province HUD Panel — compact, on-map (bottom panel)

This is the small-footprint panel that appears directly on the map when a province is
selected (distinct from the full Province Detail Modal Overlay in §3 — this is the
glanceable version, that's the full-management version).

```
+------------------------------------------------------------------------------------+
| [blue strip]   ESSEN · Germany                    Pop 64   Ind 58   Infra 71        |
+------------------------------------------------------------------------------------+
| BUILDINGS   [Mine◐]Lv3→4  [Whse]Lv1  [Brks]Lv1  [TankPlant◐]Lv1→2  [+]                |
+------------------------------------------------------------------------------------+
| IN PROGRESS (2)                                                        [▾ expand]   |
|  Iron Mine    Lv3→4   [======......] 60%   ~25s                                     |
|  Tank Plant   Lv1→2   [===.........] 30%   ~55s                                     |
+------------------------------------------------------------------------------------+
|                                                              [Manage Province >]      |
+------------------------------------------------------------------------------------+
```

**Header strip:** province name, owner, and the three 0–100 economy scalars
(Population/Industry/Infrastructure) — always visible, no interaction.

**BUILDINGS row:** one icon + level badge per building the province has (level ≥1
only — buildings at level 0 don't clutter this compact row, they're only reachable via
`[+]` or the full overlay). This is intentionally icon-only, not the full text-row
layout from §3, to fit the small footprint.
- **A small radial progress ring (`◐`) overlays any icon whose building is currently
  under construction/upgrading.** This is the primary visual signal that **parallel
  construction is happening** — multiple icons can show the ring simultaneously (as
  above, Iron Mine and Tank Plant both mid-upgrade at once), which is what actually
  communicates "yes, this province really is building more than one thing right now"
  without requiring the player to open anything.
- Hover an icon: tooltip with building name, level, and current effect.
- Click an icon: opens a small inline upgrade-confirm popover for the common case (spend
  resources, bump level by one) — anything requiring a research-path choice instead
  routes into the full Province Detail overlay (§3), since there's no room for perk-tree
  UI at this footprint.
- **`[+]`** opens Province Detail (§3), scrolled to "add a new building."

**IN PROGRESS strip:** shows up to 2 active construction/upgrade projects inline,
directly (building name, level transition, progress bar, ETA). **3 or more collapses**
to a single `IN PROGRESS (N) [▾ expand]` header — expanding reveals the full list
in-place rather than opening another overlay, to keep this panel from ballooning in
height and eating map visibility on a province with every slot busy at once. **Zero
active projects: this entire strip disappears**, and the panel shrinks back down —
there's no empty-state placeholder for "nothing being built," it simply isn't shown.

**`[Manage Province >]`** — the panel's single primary call-to-action, opening the full
Province Detail overlay (§3). This replaces the current three-button row (`Upgrade` /
`Build Radar` / `Manage Prod.`) seen in the existing implementation — those three actions
are all reachable from inside the full overlay already, so keeping them duplicated here
adds width without adding capability.

---

## 10. Cross-Reference to Mechanics Docs

| This handoff section | Mechanics defined in |
|---|---|
| §2 Top Bar (resource curation, `!` marker) | RESOURCE_ECONOMY.md — resource roster, rate-modifier resources |
| §3 Province Detail (building rows, Path/fixed) | ECONOMY_BUILDINGS.md — Complexity classification per building |
| §4 Tab 1/2 (stockpile, Industry Pool sliders) | RESOURCE_ECONOMY.md, ECONOMY_BUILDINGS.md — The Industry Pool |
| §5 Market (spread, matching) | RESOURCE_ECONOMY.md — Player-Driven Market, Spot market |
| §6 Trade Routes (eligibility) | RESOURCE_ECONOMY.md — Standing trade routes |
| §7 Tab 1 (Fielded/Deploying) | RESOURCE_ECONOMY.md — Marshalling |
| §7 Tab 2 (Reserve severity bands) | RESOURCE_ECONOMY.md — Reserve status: deficit/excess severity |
| §7 Tab 3, §8 (naval repair/construction) | NAVAL_COMBAT.md — naval base level |
| §8 Deploying section (aggregate HP%, Force Deploy) | RESOURCE_ECONOMY.md — Marshalling, early deployment threshold |
| §9 (parallel construction, `construction_points`) | ECONOMY_BUILDINGS.md — `construction_points`, Infrastructure |

---

## 11. Open UI Questions

1. **Where does the Provinces sidebar entry (§3) live?** Whether it's a new top-level
   sidebar button or nested under an existing one (`Q RES`?) wasn't decided — needs a
   call before implementation.
2. **Production panel's sidebar position/hotkey** — a new top-level button was assumed;
   confirm placement relative to the existing five.
3. **Naval's Deploying/Deployed shape (§8)** — Land's shape is fully specified; Air and
   Naval were noted as "follow the same pattern" but not walked through in the same
   detail, particularly Naval given it uses discrete ships rather than the fungible
   division-HP model.
4. **Add-offer form (§5)** — specified as "a minimal inline form," not laid out in
   detail; needs its own small spec pass when implemented.
5. **Manpower's available-vs-committed framing (§2)** — implemented as available/
   ceiling per this handoff's recommendation, but flagged as a real alternative if
   preferred; confirm before building.
