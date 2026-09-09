# Branch C — `feat/research-ui-interaction`

## Context

**Prerequisite: Branches A and B merged.** This branch assumes: real JSON-driven tree data
synced via `GameState.research`/`EventBus.research_updated()` (Branch A), real `{money,
science}` cost display with an insufficient-funds color cue and a plain (no-confirmation)
Cancel button on in-progress cards (Branch B). Branch C's job is the full visual/interaction
layer from `plans/phase-11/RESEARCH_UI_HANDOFF.md`: sidebar IN PROGRESS/NEW/AVAILABLE sections
with search/branch-filter, composable node badges (⚙▣⇄➕) + a mutex bracket container, hover
tooltips, click-to-open Confirm/Cancel popups for every state, and a Full Tree panel with real
branch tabs, a pan/zoom canvas defaulting to the researched frontier (not full zoom-out), a
`[Fit]` button, and edge-fade directional arrows.

**The single most important architectural finding from investigation, and it changes how
popups must be built:** `HUDManager` (`client/src/ui/hud/hud_manager.gd`) has **no concept of
stacking** — `_currently_open` is a single string, and `show_panel()` calls `close_all()`
before opening any `FULL_CENTER` panel (line ~184). Registering a Confirm/Cancel popup as its
own `HUDManager.register_panel(..., FULL_CENTER)` panel and showing it while Full Tree
(itself `FULL_CENTER`) is open **would close Full Tree**, not layer on top of it. Confirmed by
investigation: **no existing panel in this codebase opens a popup from inside an already-open
FULL_CENTER modal** — every current FULL_CENTER "popup" (Market, Propose Trade Route, Air Wing
Spawn/Escort Picker) is a top-level modal opened from a side-docked panel or the map, never
nested inside another modal. This branch is the first to need that composition, and the fix is
architectural, not incidental: **the popup is one shared overlay component, instantiated once
by `game_hud.gd` as a top-level `Control` added last in the scene tree (so normal Godot draw
order puts it above both side-docked drawers and `HUDManager`'s center-panel anchor), shown/
hidden via `.visible`, never through `HUDManager`.** Both the sidebar (SIDE_DOCKED) and Full
Tree (FULL_CENTER) open the *same* popup instance via one `EventBus` signal
(`research_node_popup_requested(node_id: String)`) — one popup implementation, two entry
points, no duplicated popup code between the two surfaces.

**Also genuinely new, confirmed by investigation, nothing to reuse:** the vignette/backdrop
image treatment (§6.2), the mutex bracket container (§5.1), pan/zoom on a UI canvas (the only
precedent, `client/src/systems/map/camera_system.gd`, operates on the literal strategic map's
`Camera2D` — its *idiom* is reusable at a smaller scale, drag-threshold click/pan arbitration
and cursor-anchored zoom, but not its code, since Full Tree's canvas is `Control`-space, not
world-space), edge-fade off-screen indicators, and the search/filter `LineEdit` + debounce
pattern (zero `text_changed` connections exist anywhere in `client/src/` today). Budget real
implementation time for these, they are not "just wire it up."

**What already exists and should be reused, not rebuilt:** branch-tab switching — `diplomacy_
panel.gd`'s Nations/Alliance/TradeRoutes tabs and `military_panel.gd`'s Land/Air/Naval tabs are
both the exact same `TabBar`(`TabContainer`)/`TabButtons`(`HBoxContainer`, shared `ButtonGroup`)
pattern, `cycle_sub_tab(forward)` included — confirmed line-identical in both real files. Full
Tree's seven branch tabs (Infantry/Ordnance/Armour/Air/Naval/Economy/General) copy this
verbatim. Confirm/Cancel button footer wiring — `air_wing_escort_picker_panel.gd`/`air_wing_
spawn_panel.gd` both have a plain `HBoxContainer` footer with a `_btn_confirm`/`btn_cancel`
pair; reuse that *button-wiring* shape inside the new popup component (not their `HUDManager`
registration style — see above). Text-glyph badges, not icon textures — confirmed convention:
`friendly_province_panel.gd`'s BUILDINGS row explicitly uses `Label` text badges "no per-
building icon assets exist yet" (line ~22); Branch C's ⚙▣⇄➕ badges are `Label`s with unicode
glyphs, matching that precedent, not a new icon-texture system.

**Also newly added during Branch A, already in the JSON schema, wire it up here:** every node
now carries both `short_description` (glance-friendly, shown on cards and the hover tooltip)
and `description` (fuller text, shown only inside the click-to-open popup body). Branch A's
client loader (`research_tree_data_loader.gd`) already carries both through in the definitions
dict it hands to `research_system.gd.load_from_definitions()` — `short_description` under that
key and the full text under `full_description` — because Branch A's minimal card-only UI has
no separate popup surface yet. This branch's card rendering (`research_entry_card.gd`,
`research_drawer_panel.gd`) should read `short_description`/`full_description` directly rather
than the combined `branch · Tier N\n\n...` string Branch A stitched into `description` as a
stopgap for its single flat grid — that stitching goes away once real branch tabs (Step 5) make
the branch/tier context visually obvious without needing to print it into every card's body.
The popup (Step 4) is what actually reads `full_description`, per `RESEARCH_UI_HANDOFF.md` §7.

**Newly flagged during Branch A's manual verification, in scope for this branch:** Branch A's
server ticks research progress once per second (`TICK_MS = 1000`) and broadcasts
`RESEARCH_UPDATES` on every tick a project is in flight — correct and sufficient for Branch A's
own checkpoint ("watch progress tick and complete"), but the result is a visibly stepped bar
(e.g. 0%→25%→50%→75%→100% for a 4-point placeholder cost), not the smooth per-frame fill the
old client-local prototype had via its own `_process(delta)` ticking. Neither `RESEARCH.md` nor
this plan's earlier branch descriptions call this out explicitly, so it was never anyone's
stated job — it lands here because Step 4b item 6 and Step 2a's IN PROGRESS section are the
places that actually render the progress bar in its final form. **Fix:** interpolate
client-side between the last two known `(points_remaining, received_at)` samples from
`GameState.research` using frame `delta`, the same way the retired local prototype's
`research_system.gd.advance(delta)` used to animate — but driven by the server's real rate
*estimated from consecutive samples*, not a hardcoded client-side constant, so it stays correct
if Branch B's real currency-funded rate ever varies per node or per nation. Do not attempt to
reduce the server's 1-second tick interval or broadcast more often — this is a presentation-layer
smoothing problem, not a network-chattiness one.

**Keep test runs minimal and targeted.** This branch is almost entirely client-side UI — most
verification here is manual/visual, not automated. Where server-side logic genuinely changes
(none expected — this branch should not need to touch `game-server/` at all, it's presentation
only over Branch A/B's already-correct data), run only the targeted test file if one is needed;
do not run `npm test`.

---

## Critical Pre-Read

### `HUDManager` — no stacking, the reason popups must NOT be `FULL_CENTER` panels (`hud_manager.gd`)

`_currently_open: String` (single value, not a stack) and `show_panel()`'s
`if placement == PlacementMode.FULL_CENTER: ... close_all()` — registering a second
`FULL_CENTER` panel and showing it while Full Tree is open closes Full Tree first. **Do not
register the popup through `HUDManager` at all.**

### `diplomacy_panel.gd` — exact tab pattern to copy for Full Tree's branch tabs

```gdscript
func _setup_tab_buttons() -> void:
    var tabs: TabContainer = get_node_or_null(_CONTENT_PATH + "/TabBar") as TabContainer
    var tab_buttons: HBoxContainer = get_node_or_null(_CONTENT_PATH + "/TabButtons") as HBoxContainer
    if tabs == null or tab_buttons == null: return
    var button_group: ButtonGroup = ButtonGroup.new()
    for index: int in range(tab_buttons.get_child_count()):
        var button: Button = tab_buttons.get_child(index) as Button
        button.button_group = button_group
        button.pressed.connect(_on_tab_button_pressed.bind(index))
    tabs.tab_changed.connect(_sync_tab_button)
    _sync_tab_button(tabs.current_tab)

func cycle_sub_tab(forward: bool) -> void:
    var tabs_node: Node = get_node_or_null(_CONTENT_PATH + "/TabBar")
    if tabs_node == null or not tabs_node is TabContainer: return
    var tabs: TabContainer = tabs_node as TabContainer
    var count: int = tabs.get_tab_count()
    if count <= 1: return
    tabs.current_tab = posmod(tabs.current_tab + (1 if forward else -1), count)
```
Confirmed identical in `military_panel.gd` (Land/Air/Naval tabs) — this is a stable, load-
bearing idiom in this codebase, copy verbatim for Full Tree's seven branch tabs. `HUDManager`
routes Tab-key presses to whichever panel is open's `cycle_sub_tab(forward)` by name lookup —
no change needed there.

### `camera_system.gd` — the pan/zoom *idiom* to mirror at UI scale, not the code itself

Cursor-anchored zoom (stepped `ZOOM_STEP := 0.15`, smoothly lerped toward a `_target_zoom` each
frame), right-drag pan with a pixel-threshold click/drag arbitration (`RIGHT_DRAG_THRESHOLD_PX
:= 8.0` — only starts panning once motion exceeds this, otherwise treats release as a plain
click), and a smoothstep ease (`t*t*(3.0-2.0*t)`) for animated snap-to-position. Full Tree's
canvas is a plain `Control` in UI space, not a `Camera2D` in world space — the simplest correct
implementation is a `Control` whose `position`/`scale` are directly manipulated on drag/wheel
(no `Camera2D`/`SubViewport` needed), reusing only the *shape* of these three behaviors
(threshold-gated drag, cursor-anchored zoom math, smoothstep ease for `[Fit]`'s snap
animation), not any literal code from this file.

### Card rendering this branch restructures — full current bodies

`research_drawer_panel.gd`'s `_create_entry_card()` (lines 106-159) and `_make_card_style()`
(166-178) — binary active/inactive only, flat list, no sections, no badges:
```gdscript
const CARD_BG: Color = Color(0.12, 0.08, 0.05, 0.96)
const CARD_BG_ACTIVE: Color = Color(0.16, 0.12, 0.06, 0.98)
const CARD_BORDER: Color = Color(0.42, 0.30, 0.16, 1.0)
const CARD_BORDER_ACTIVE: Color = Color(0.84, 0.68, 0.30, 1.0)
```
`research_entry_card.gd`'s `_apply_state_style()` (127-151) — **only three states exist today**
(`STATE_UNAVAILABLE`/`STATE_AVAILABLE`/`STATE_RESEARCHED`); "Researching" is currently just a
border-color toggle inside the `STATE_AVAILABLE` branch (`is_active` flag), not a real fourth
state:
```gdscript
if state == STATE_RESEARCHED:
    style.bg_color = Color(0.12, 0.16, 0.10, 0.96); style.border_color = Color(0.42, 0.62, 0.32)
elif state == STATE_AVAILABLE:
    style.bg_color = Color(0.12, 0.08, 0.05, 0.96)
    style.border_color = Color(0.84, 0.68, 0.30) if is_active else Color(0.42, 0.30, 0.16)
else: # unavailable/locked
    style.bg_color = Color(0.08, 0.06, 0.04, 0.72); style.border_color = Color(0.22, 0.16, 0.09, 0.65)
    modulate = Color(0.66, 0.60, 0.50, 1.0)
```
**This branch adds a genuine fourth top-level state** (Researching, amber + the existing
animated progress-bar fill, distinct from static Available) rather than continuing to fold it
into Available via a flag. Given both `research_drawer_panel.gd`'s cards and `research_entry_
card.gd`'s cards need the identical badge/state visual language, **extract the shared color
constants + state→style logic into one new small utility** (`research_card_style.gd`,
autoload-free static/`class_name` helper) that both files call into — avoids duplicating four
states' worth of colors in two places.

### The empty-stub branch state — already partially built by Branch A, confirm and refine

Branch A's plan already renders a basic empty-stub for Naval; this branch makes every non-
Armour branch tab (Infantry/Ordnance/Air/Naval/Economy) match `RESEARCH_UI_HANDOFF.md` §4.5's
exact "🔧 Coming Soon" framing when that branch has only sample/placeholder content still
marked as such — **note:** per the phase overview, Infantry/Ordnance/Air/Economy actually do
have small *sample* node sets (Branch A authored them to exercise the engine), so they are not
literally empty like Naval. Branch C's job here is cosmetic-only: decide (and clearly comment)
whether sample-content branches show their sample nodes plainly (simplest, and arguably more
honest for a dev build) or borrow the "Coming Soon" treatment despite having a few nodes —
**recommendation: show the sample content, do not fake a "Coming Soon" state for branches that
do have nodes** — reserve the literal Coming Soon empty-state for Naval only, which really is
empty. Flag this as a judgment call for whoever implements, not a hard requirement either way.

---

## Files to Create

| File | Purpose |
|---|---|
| `client/src/ui/hud/research_node_popup.gd` + `.tscn` | The shared overlay popup — one instance, six body variants (hover-lite handled separately, see below) |
| `client/src/systems/research/research_card_style.gd` | Shared badge glyph map + four-state color/style logic, used by both the drawer and Full Tree cards |
| `client/src/systems/research/research_mutex_bracket.gd` | Custom `Control` with `_draw()` override for the gold double-border bracket container spanning mutex options |
| `client/src/systems/research/research_tree_canvas.gd` | The Full Tree's pan/zoom `Control` wrapper (drag-threshold pan, cursor-anchored zoom, `[Fit]` smoothstep snap, edge-fade bounds comparison) |

## Files to Modify

| File | Change |
|---|---|
| `client/src/ui/hud/research_drawer_panel.gd` | Restructure into IN PROGRESS / NEW / AVAILABLE sections; add search box + branch-filter dropdown; add badges via `research_card_style.gd`; route card clicks to open the popup instead of directly submitting |
| `client/src/systems/research/research_tree_view.gd` | Add branch tabs (`TabBar`/`TabButtons`) + left rail unit list; wrap the existing grid canvas in `research_tree_canvas.gd`; wire `[Fit]`/`[-]`/`[+]`; add persistent legend footer |
| `client/src/systems/research/research_entry_card.gd` | Extend `_apply_state_style()` to a real four-state branch via `research_card_style.gd`; add badge row rendering |
| `client/scenes/systems/research/research_tree.tscn` | Add left-rail `Control` structure, `[Fit]`/zoom buttons, legend footer, branch `TabBar`/`TabButtons` |
| `client/src/ui/hud/game_hud.gd` | Instantiate `research_node_popup.gd` once as a top-level overlay `Control`, added last in the tree; connect `EventBus.research_node_popup_requested` |
| `client/src/core/event_bus.gd` | New `research_node_popup_requested(node_id: String)` signal |

---

## Step 1: Shared badge + four-state style utility

### 1a. `research_card_style.gd`

```gdscript
class_name ResearchCardStyle
extends RefCounted

const BADGE_GLYPHS := {"mechanic": "⚙", "lineage": "▣", "redistribute": "⇄", "additive": "➕"}

const STATE_AVAILABLE := "available"
const STATE_RESEARCHING := "researching"
const STATE_RESEARCHED := "researched"
const STATE_LOCKED := "locked"

static func build_badge_row(badges: Array) -> HBoxContainer:
    var row := HBoxContainer.new()
    for badge_type: String in badges:
        var glyph := Label.new()
        glyph.text = BADGE_GLYPHS.get(badge_type, "?")
        row.add_child(glyph)
    return row

static func make_state_style(state: String) -> StyleBoxFlat:
    var style := StyleBoxFlat.new()
    style.corner_radius_top_left = 6; style.corner_radius_top_right = 6
    style.corner_radius_bottom_left = 6; style.corner_radius_bottom_right = 6
    style.border_width_left = 1; style.border_width_top = 1
    style.border_width_right = 1; style.border_width_bottom = 1
    match state:
        STATE_AVAILABLE:
            style.bg_color = Color(0.12, 0.08, 0.05, 0.96)
            style.border_color = Color(0.84, 0.68, 0.30) # amber, solid
        STATE_RESEARCHING:
            style.bg_color = Color(0.14, 0.10, 0.05, 0.98)
            style.border_color = Color(0.90, 0.72, 0.20) # amber, brighter — reuses existing
                                                            # progress-bar fill widget for the
                                                            # animated part, this is just the card frame
        STATE_RESEARCHED:
            style.bg_color = Color(0.12, 0.16, 0.10, 0.96)
            style.border_color = Color(0.42, 0.62, 0.32) # green, filled
        STATE_LOCKED:
            style.bg_color = Color(0.08, 0.06, 0.04, 0.40) # desaturated, ~40% opacity per spec
            style.border_color = Color(0.22, 0.16, 0.09, 0.30) # dim, no border emphasis
    return style
```
No literal dashed border — Godot's `StyleBoxFlat` has no native dash support, and the handoff
doc's ASCII dashes (`┌ ─ ─ ─ ┐`) are describing the *intent* ("dimmed, no border emphasis" per
§5.2's own prose), not a literal requirement. Low opacity + a faint border achieves the same
communicated meaning without needing a custom-drawn dashed `StyleBox`.

### 1b. Wire into both card sources

`research_entry_card.gd`'s `_apply_state_style()` becomes a thin wrapper calling
`ResearchCardStyle.make_state_style(state)` and `add_child(ResearchCardStyle.build_badge_row(badges))`
in `_apply_text()`. `research_drawer_panel.gd`'s `_make_card_style()` does the same, replacing
its two-color binary logic.

**Manual verification:** none yet in isolation — covered by Step 2's checkpoint.

---

## Step 2: Sidebar restructure — IN PROGRESS / NEW / AVAILABLE + search/filter

### 2a. Section logic (client-side, no new server state needed)

**IN PROGRESS:** `GameState.research`'s active projects, sorted by soonest-`points_remaining`
first (ascending) — always shown, never filtered by search/branch. Progress values feeding this
section's bars go through the same client-side interpolation described in the Context note
above, not the raw stepped server sample directly.

**NEW:** client-side-only recency tracking — on each `EventBus.research_updated` fire, diff
the newly-available node id set against the previous snapshot; any node that just transitioned
into "available" gets pushed to the front of a capped (5-entry) local `Array`, oldest entries
fall off automatically as newer ones arrive. **No server field needed** — this is purely a
local UI convenience per the handoff doc's own framing ("needs no seen/dismissed flag").

**AVAILABLE:** per-unit "continue chain or start here" resolution (§3.1) — for each `unit_id`
with at least one researched node, find its most-recently-completed node's path, offer the
next tier up in that same path; for a `unit_id` with zero research, fall back to its tier-1
entry node(s) labeled "start here." A next-step that lands on a `mutex_group_id` renders as
one card for the whole group (opens the multi-option popup, never pre-picks an option). Sort:
most-recently-active unit first, cold-start fallback to branch order (Infantry → Ordnance →
Armour → Air → Naval → Economy → General) → tier ascending → cost ascending. Hard cap 6-8
cards, "View Full Tree →" link below the cap.

### 2b. Search + branch filter

```gdscript
@onready var _search_box: LineEdit = %SearchBox
@onready var _branch_filter: OptionButton = %BranchFilter
var _search_debounce: Timer

func _ready() -> void:
    _search_debounce = Timer.new()
    _search_debounce.one_shot = true
    _search_debounce.wait_time = 0.15
    add_child(_search_debounce)
    _search_debounce.timeout.connect(_apply_filters)
    _search_box.text_changed.connect(func(_text: String) -> void: _search_debounce.start())
    _branch_filter.item_selected.connect(func(_idx: int) -> void: _apply_filters())
```
No existing debounce precedent in this codebase (confirmed by investigation) — this is the
standard Godot `Timer(one_shot=true)`-reset-on-each-keystroke idiom, first instance here.
IN PROGRESS/NEW sections collapse (hide their header) if filtering excludes everything in them,
per the handoff's explicit "don't render an empty header" rule.

**Manual verification (required):** open the Research sidebar mid-game with a few nodes
researched/in-progress — confirm IN PROGRESS shows active projects sorted soonest-first, NEW
shows the last few newly-unlocked nodes and ages them out as more complete, AVAILABLE shows
per-unit next-steps with a "start here" label for untouched units and "continuing chain" for
ones with prior research, a mutex tier renders as one card. Type in the search box — confirm
debounced highlighting, empty sections collapse rather than showing blank headers. Switch the
branch filter — confirm the same.

---

## Step 3: Mutex bracket container

### 3a. `research_mutex_bracket.gd`

```gdscript
extends Control
class_name ResearchMutexBracket

@export var option_count: int = 2

func _draw() -> void:
    var gold := Color(0.84, 0.68, 0.30)
    draw_rect(Rect2(Vector2.ZERO, size), gold, false, 3.0) # double-border box
    draw_rect(Rect2(Vector2(2,2), size - Vector2(4,4)), gold, false, 1.0)
    # Bracket connecting the tier's option columns below the box — a simple horizontal line
    # with two short downward ticks at each option's x-center, matching the ASCII mockup's
    # "spans all N columns" bracket. Exact tick x-positions come from sibling layout, passed
    # in via a setter once the options are laid out (Control doesn't know its siblings' final
    # positions until after layout, so this needs a call from the parent after _ready(), not a
    # value computed inside this script alone).
```
Wraps mutex-group option cards inside a `PanelContainer`-like border; no existing bracket
precedent anywhere in this codebase (confirmed) — this is genuinely new geometry, kept as
simple as a double-rect border plus a couple of tick lines, not an elaborate custom shape.

**Manual verification:** covered by Step 5/6's full popup+tree checkpoint.

---

## Step 4: The shared popup component

### 4a. `EventBus` + `game_hud.gd` wiring

```gdscript
# event_bus.gd
signal research_node_popup_requested(node_id: String)
```
```gdscript
# game_hud.gd — instantiate once, add LAST so normal draw order puts it above every
# HUDManager-registered panel (side-docked or full-center) and above the map
var _research_node_popup: Control
const _ResearchNodePopupScene := preload("res://scenes/systems/research/research_node_popup.tscn")
...
_research_node_popup = _ResearchNodePopupScene.instantiate()
add_child(_research_node_popup)  # added after every other panel is already a child
EventBus.research_node_popup_requested.connect(_research_node_popup.open_for_node)
```
**Not registered through `HUDManager`** — per the Critical Pre-Read, this is the whole point.

### 4b. `research_node_popup.gd` — six body variants over one shell

Shell: dim background `ColorRect` (full-screen, blocks input to whatever's behind it),
centered `PanelContainer` with header image + vignette (new — see 4c), scrollable body,
pinned footer. `open_for_node(node_id: String)` reads the node's def + live state from
`GameState.research` and picks a body variant:

1. **Hover (lightweight, NOT this popup)** — a separate, much simpler floating `Label` tooltip
   on `mouse_entered`, no image/buttons, per §6.1. Implement directly on each card
   (`mouse_entered`/`mouse_exited` → show/hide a small `PanelContainer` positioned near the
   cursor) — this is not part of `research_node_popup.gd` at all, keep it lightweight and
   separate from the heavier click-popup.
2. **Available → Confirm/Cancel** (§6.2): image header, scrollable description + `Requires:`
   list + cost, footer `[Cancel][Confirm]`. Confirm submits `CommandQueue.submit("START_RESEARCH",
   {"node_id": node_id})` (Branch A's command, now routed through the popup instead of a direct
   card click).
3. **Available + mutex conflict → warning body** (§6.3): same shell, an `⚠` warning line
   inserted in the scrollable body (never the footer, so it can't push Confirm/Cancel off-
   screen) stating which currently-researched sibling will be displaced and that respec applies
   no refund, exactly RESEARCH.md's rule.
4. **Locked → read-only** (§6.4): image header, description, a `Requires:` checklist (✓/✗ per
   prerequisite, computed from `GameState.research`), footer `[Close]` only.
5. **Researched → read-only** (§6.5): same shell, no requirements block, `[Close]` only.
6. **Researching → progress + Cancel** (§6.6): progress bar (reuse the existing animated fill
   widget, now driven by client-side interpolation between `RESEARCH_UPDATES` samples per the
   Context note above — do not bind the bar's value directly to the last raw server sample,
   which is what produces Branch A's stepped look), `[Cancel Research][Close]`. Clicking Cancel Research swaps the popup body to the
   confirmation sub-step showing `invested_so_far`/`refund`/`forfeit` (Branch B's server-
   computed numbers, arrived via the last `RESEARCH_UPDATES` for this node — do not
   recompute client-side) with `[Back][Confirm Cancel]`. Confirm Cancel submits
   `CommandQueue.submit("CANCEL_RESEARCH", {"node_id": node_id})`.

### 4c. Vignette treatment (new — no precedent anywhere)

Simplest correct approach given nothing exists to reuse: a `TextureRect` for the node's
`image_asset` (Branch A's JSON field — placeholder icons per the user's earlier note, real art
later), with a `GradientTexture2D`-filled `ColorRect` overlaid at the bottom third of the image,
alpha ramping 0→1 top-to-bottom, blending into the panel's own background color. This mirrors
`vision_system.gd`'s existing `GradientTexture2D` usage (a different purpose — fog-of-war mask —
but confirms the engine feature is already used elsewhere in this codebase, so this isn't
introducing a wholly unfamiliar Godot mechanism, just a new *use* of it).

**Manual verification (required):** click an Available node from the sidebar — confirm the
popup opens (Full Tree, if open, stays open and dimmed behind it, does NOT close). Click a
Locked node — confirm the read-only requirements checklist. Click a Researching node, then
Cancel Research — confirm the numbers-shown confirmation sub-step appears before anything
actually cancels, and the final numbers match what Branch B's server math computed. Click a
mutex-conflicting Available option — confirm the warning body appears with the correct
displaced-sibling name.

---

## Step 5: Full Tree — branch tabs, left rail, pan/zoom canvas, Fit, edge-fade, legend

### 5a. Branch tabs + left rail

Per the Critical Pre-Read's `diplomacy_panel.gd` pattern, add `TabBar`/`TabButtons` for the
seven branches. Inside each tab's content, a left rail (`Control`, fixed width) holding the
search box (highlights matches across every unit in the current branch) and a vertical
scrollable list of units (`●`/`○` filled/hollow per "at least one node researched," fraction
`researched/total`). Selecting a unit swaps which node set the canvas (5b) displays.

### 5b. `research_tree_canvas.gd` — pan/zoom wrapper

```gdscript
extends Control
class_name ResearchTreeCanvas

const ZOOM_STEP := 0.15
const DRAG_THRESHOLD_PX := 8.0
var _target_zoom := 1.0
var _drag_start_mouse: Vector2
var _dragging := false

func _gui_input(event: InputEvent) -> void:
    if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_WHEEL_UP:
        _zoom_at(event.position, ZOOM_STEP)
    elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
        _zoom_at(event.position, -ZOOM_STEP)
    elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
        _dragging = event.pressed
        _drag_start_mouse = event.position
    elif event is InputEventMouseMotion and _dragging:
        if event.position.distance_to(_drag_start_mouse) > DRAG_THRESHOLD_PX:
            position += event.relative

func _zoom_at(mouse_pos: Vector2, delta: float) -> void:
    # cursor-anchored: adjust position so the point under the cursor stays fixed as scale changes
    var before := (mouse_pos - position) / scale
    _target_zoom = clampf(_target_zoom + delta, 0.3, 2.5)
    scale = Vector2(_target_zoom, _target_zoom)
    position = mouse_pos - before * scale

func snap_to_fit(content_bounds: Rect2, viewport_size: Vector2) -> void:
    # smoothstep-eased tween of position/scale to fit content_bounds within viewport_size —
    # mirrors camera_system.gd's ease shape (t*t*(3-2t)), animated via a Tween, not a Camera2D
    pass

func default_frontier_view(researched_bounds: Rect2) -> void:
    # opens zoomed to researched + directly-adjacent-available nodes only, NOT full overview —
    # per RESEARCH_UI_HANDOFF.md 4.2's explicit rationale (avoid the Path-of-Exile "intimidating
    # full tree" failure mode)
    pass
```
Reuses the *idiom* from `camera_system.gd` (drag-threshold, cursor-anchored zoom, smoothstep
ease) at `Control` scale, not its `Camera2D`-specific code — confirmed no reusable code exists
for this, per investigation.

### 5c. Edge-fade arrows

```gdscript
func _update_edge_fade_arrows(canvas: ResearchTreeCanvas, content_bounds: Rect2, viewport_rect: Rect2) -> void:
    var visible_bounds := Rect2((viewport_rect.position - canvas.position) / canvas.scale, viewport_rect.size / canvas.scale)
    %ArrowUp.visible    = content_bounds.position.y < visible_bounds.position.y
    %ArrowDown.visible  = content_bounds.end.y   > visible_bounds.end.y
    %ArrowLeft.visible  = content_bounds.position.x < visible_bounds.position.x
    %ArrowRight.visible = content_bounds.end.x   > visible_bounds.end.x
```
Pure bounds comparison, no new rendering pipeline, per the handoff's own note — confirmed no
existing off-screen-indicator code anywhere to reuse, this is the first instance. Arrow glyphs
are `Label`s (▲▼◄►), matching the established text-glyph convention, not new icon assets.

### 5d. `[Fit]` / `[-]` / `[+]` buttons + persistent legend footer

Three plain buttons calling `_target_zoom` adjustments / `snap_to_fit()`. Legend: a permanent
footer row (`🟧 Available  🟩 Researched  ▓ Researching  ▪dim Locked`), always visible, not a
tooltip — per §4.1's explicit contrast/legibility rationale.

**Manual verification (required, this branch's other primary checkpoint):** open Full Tree,
confirm branch tabs switch content (and `Tab` key cycles them), confirm the left rail's unit
list updates the canvas on selection. Confirm the canvas opens zoomed to the researched
frontier, not a full zoomed-out view. Drag to pan, scroll to zoom (cursor-anchored — the point
under the cursor should not visibly jump). Click `[Fit]` — confirm a smooth animated snap to
the whole tree's bounds. Zoom/pan until part of the tree is off-screen — confirm the correct
edge(s) show fade arrows, and that panning back into view hides them again. Confirm the legend
footer is always visible regardless of pan/zoom state.

---

## Step 6: Wire node clicks (drawer + Full Tree) to the popup, retire direct-start behavior

Replace `research_drawer_panel.gd`'s remaining direct `CommandQueue.submit("START_RESEARCH", ...)`
click path (Branch B left this as a plain immediate action) and `research_tree_view.gd`'s
equivalent with `EventBus.research_node_popup_requested.emit(node_id)` — **every click now
opens a popup; nothing starts/cancels research without going through it**, per §6's governing
rule. Branch B's inline Cancel button on in-progress cards is superseded by the popup's
Researching-state Cancel flow (Step 4b, item 6) — remove the inline button, its behavior now
lives inside the popup.

**Manual verification:** click any node anywhere (sidebar or Full Tree) — confirm nothing
starts/cancels instantly anymore, the popup always opens first.

---

## Manual UI Checkpoint — ASCII reference (adapted from `RESEARCH_UI_HANDOFF.md`, this is the target this branch builds toward exactly)

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
│ │ 🆕 ⚙▣ Improved APC                       │   │
│ │ Armour · Mech. Inf. · Tier 4   $8 · 🔬6 │   │
│ └───────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│ AVAILABLE — your next step per unit          │
│ ┌───────────────────────────────────────┐   │
│ │ ╔═══════════════════════════════════╗   │   │
│ │ ║ ⚥ CHOOSE: Fire&Move/Bayonet/       ║   │   │
│ │ ║   Marksman — Standard Inf. Tier 3  ║   │   │
│ │ ╚═══════════════════════════════════╝   │   │
│ └───────────────────────────────────────┘   │
│ ┌───────────────────────────────────────┐   │
│ │ ➕ Light Tank Chassis — start here       │   │
│ │ Armour · Light Tank         $4 · 🔬2    │   │
│ └───────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│              [ View Full Tree → ]            │
└─────────────────────────────────────────────┘
```

```
Click any card → shared popup, dims everything behind it (Full Tree stays open underneath):
┌───────────────────────────────────────┐
│ ░░░[image + vignette fade]░░░░░░░░░░ │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ⚙▣  IMPROVED APC                        │
│ Armour → Mechanised Infantry chain      │
│───────────────────────────────────────│
│ Full-tracked hull replaces the          │
│ half-track. Higher off-road speed,      │
│ +armour, +suppression resistance.       │
│                                          │
│ Requires: APC (half-track) ✓            │
│ Cost: $8 · 🔬6                          │
│───────────────────────────────────────│  ← pinned, never scrolls
│         [ Cancel ]      [ Confirm ]     │
└───────────────────────────────────────┘
```

```
Full Tree, post-Branch-C — branch tabs + left rail + pan/zoom canvas + legend:
┌─ RESEARCH ───────────────────────────────────────────────────────────┐
│ Infantry  Ordnance  Armour  Air  Naval  Economy  General             │ ✕ │
├───────────┬────────────────────────────────────────────────────────────┤
│[🔍 search]│ [ – ] [Fit] [ + ]                    ▲ (edge-fade, content   │
├───────────┤                                        above current view) │
│●Standard 9/14                                                          │
│●Assault  4/12         [ canvas — pan/zoom, drag + scroll ]             │
│○MG Team  0/9          (opens zoomed to researched frontier,            │
│●AT Inf.  2/10          NOT the full tree — [Fit] is opt-in)            │
│                                                     ◄  ►  (edge-fade)   │
├────────────────────────────────────────────────────────────────────────┤
│ Legend:  🟧 Available  🟩 Researched  ▓ Researching  ▪dim Locked       │
└────────────────────────────────────────────────────────────────────────┘
```

```
Naval branch (genuinely empty — Coming Soon; sample-content branches show their sample nodes
plainly instead, per this branch's judgment call in the Critical Pre-Read):
┌─ RESEARCH ───────────────────────────────────────────────────────────┐
│ Infantry  Ordnance  Armour  Air  Naval  Economy  General             │ ✕ │
├───────────┬────────────────────────────────────────────────────────────┤
│  (unit    │              🔧  Coming Soon                                │
│  list     │      Naval doctrine trees are still in                     │
│  empty)   │      development for this build.                           │
└───────────┴────────────────────────────────────────────────────────────┘
```

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| The Confirm/Cancel popup can be a new `HUDManager.register_panel(..., FULL_CENTER)` panel like every other existing modal | **Wrong, confirmed architecturally** — `HUDManager.show_panel()` closes any open `FULL_CENTER` panel first; opening the popup this way while Full Tree is open would close Full Tree. It must be a shared top-level overlay `Control`, added directly in `game_hud.gd`, never through `HUDManager` |
| There's an existing icon-texture system to build the ⚙▣⇄➕ badges from | **Wrong** — confirmed convention across the codebase is text-glyph `Label`s (see `friendly_province_panel.gd`'s BUILDINGS row, which explicitly notes no icon assets exist), not `TextureRect`s from `client/assets/icons/` |
| The vignette/backdrop image treatment, mutex bracket, edge-fade arrows, and search debounce all have existing precedent somewhere in this large codebase | **Wrong for all four** — confirmed by direct grep, none exist anywhere; this branch originates all four from scratch |
| "Researching" can stay a border-color variant of "Available," like it is today | **Wrong per this branch's own scope** — the four-state system (§5.2) is a real requirement; Researching becomes its own top-level state in `research_card_style.gd`, not a flag on Available |
| Full Tree's pan/zoom canvas should be built with a `Camera2D`/`SubViewport`, mirroring the strategic map | **Wrong** — that's world-space camera code for the actual map; Full Tree's canvas is UI-space, correctly implemented as a plain `Control` with directly-manipulated `position`/`scale`, only borrowing `camera_system.gd`'s *interaction shape* (threshold-gated drag, cursor-anchored zoom, smoothstep ease) |
| Branch B's inline Cancel button (added on in-progress cards) should stay alongside the new popup's Cancel flow | **Wrong** — Branch C's popup supersedes it entirely; the inline button is removed once every click routes through the popup, per §6's "every click now opens a popup" rule |
| The "NEW" section needs a new server-side field to track recency | **Wrong** — it's a purely client-side, purely visual convenience computed by diffing available-node snapshots across `EventBus.research_updated` events; no schema/broadcast change needed |
| Progress bars should just bind directly to the latest `RESEARCH_UPDATES` `points_remaining` value, like Branch A's minimal display did | **Wrong for this branch** — that produces the stepped 0%→25%→50%→...→100% look Branch A's own manual verification surfaced (server ticks/broadcasts once per second). This branch interpolates client-side between consecutive samples using frame `delta` for a smooth fill, per the Context note above |
