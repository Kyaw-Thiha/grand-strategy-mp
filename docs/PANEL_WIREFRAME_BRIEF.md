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

## Map modes (3 total)

| Mode | Default? | Content |
|---|---|---|
| **Political** | Yes | Bright nation fill + faint ambient elevation hillshade (always on, all modes) + river vector overlay (always on) + diagonal hatch on impassable tiles **only when a division is selected**, scoped to that division's movement profile |
| **Cover** | No | Flat, full 11-tier cover-type fill, distinct colors, no hatching needed (this mode IS the detail view) |
| **Elevation** | No | Pure relief/hypsometric shading, no political fill |

- Switch via single cycle action (forward/backward), not 3 separate buttons.
- Mode never auto-changes on zoom level — always an explicit player choice.
- Combat terrain modifiers (forest bonus, river penalty) = hover tooltip / engagement-circle
  indicator only. Never permanent map paint in any mode.

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
| Map mode | ` cycle forward, Shift+` cycle backward |
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
