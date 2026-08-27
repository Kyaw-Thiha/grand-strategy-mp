# Batch 7: Supply-Line Visualization

> **For agentic workers:** Implement this batch independently and stop at the manual verification
> gate. Use server-provided route data only — never recompute supply/route status client-side, even
> approximately. This batch does not touch the three-tier debuff system, retreat pathing, or true
> encirclement detection (Batch 8), and does not touch ownership rendering (Batch 6, already done).

**Goal:** Draw authoritative supply routes as animated lines for selected own units and visible
foreign units, styled by route status (teal/blue normal, amber off-road with a slower pulse, broken
red-marked when cut off), with a compact status line in the land-selection popover — all driven by
Batch 5's `SUPPLY_ROUTE_UPDATE` event, none of it computed client-side.

**Architecture:** `supply_line_overlay.gd` is a new renderer, structurally parallel to
`subprovince_renderer.gd` (Batch 6) — reacts to events, owns one visual node per active route,
mutates nothing in `GameState`. Since Batch 5 built the server push but never the client receiving
end, this batch is also where `SUPPLY_ROUTE_UPDATE` first gets wired into
`session_manager.gd`/`game_state.gd`, following the exact `air_wing_paths`-style cache pattern
already established for other non-schema-synced server-push data.

**Tech Stack:** GDScript, Godot 4.

## Scope

### Included

- Client plumbing for `SUPPLY_ROUTE_UPDATE`: `session_manager.gd` dispatch case,
  `GameState.supply_routes: Dictionary` cache, `EventBus.supply_route_updated` signal.
- `supply_line_overlay.gd`: draw routes for all selected own units, all currently-visible foreign
  units whose route data has been received, with the active selection emphasized.
- Status-based styling: open/degraded (teal/blue vs. amber, different pulse rates), cut_off
  (broken line to last-known interruption point, red marker), encircled (defer to whatever renders
  the existing Kessel-ring division indicator — see Task 3).
- Route removal when a foreign unit becomes hidden, following the existing
  `division_hidden`/`division_vanishing` pattern.
- Compact route status line in `land_selection_popover.gd`.
- `client/test/test_supply_line_overlay.gd`.

### Excluded

- Any change to `SupplyRoute` computation (Batch 5's `supply_graph.ts`/`supply_system.ts`) — this
  batch consumes that output as-is.
- Retreat pathing, true ring-based encirclement detection (Batch 8).
- The full Kessel-ring division indicator, if one already exists elsewhere for the Tier 3 debuff
  (per `STRATEGIC_COMBAT.md`'s UI table, "Red ring around the division dot") — confirm during
  implementation whether this is owned by an existing division-icon system; if so, Batch 7 only
  needs to not conflict with it, not build it. See Task 3.
- Ownership fill/border rendering (Batch 6, done).

## Batch 5 Interface Freeze

Batch 5 is not yet implemented in the actual codebase (still a plan, per this session's earlier
research). This batch is written against its documented `SupplyRoute` type and event:

```ts
type SupplyRoute = {
  divisionId: string;
  sourceHubId: string | null;
  subprovinceIds: string[];
  status: "open" | "degraded" | "cut_off" | "encircled";
  throughputRatio: number;
  blockedSubprovinceId: string | null;
};
```
Pushed as a `"SUPPLY_ROUTE_UPDATE"` event, one `SupplyRoute` payload per division, filtered
per-recipient server-side (own/allied always, foreign gated by visibility) — the client never
needs to do its own visibility filtering for whether it *receives* a route, only for whether it
currently *displays* one (a foreign unit's last-received route should stop rendering once that
unit is hidden, even though no new "this route no longer applies" event necessarily arrives — see
Task 2).

**Known gap found during this batch's planning, resolved here rather than reopening Batch 5:**
`SUBPROVINCE_PHASES.md` requires "cut-off routes drawn as broken lines with a red interruption
marker," but Batch 5's `cut_off` status carries an empty/single-node `subprovinceIds` (Dijkstra
found no path at all, so there is nothing to draw "up to the break point" from that payload alone).
Rather than having Batch 5 invent a "best partial reach" computation it doesn't otherwise need,
this batch resolves it client-side using data it already caches: keep the **last-known non-empty
route** per division in `GameState.supply_routes` (don't overwrite it with an empty path on a
`cut_off` update — store the status separately from the last-known path), and when rendering a
`cut_off` route, draw the last-known cached path dimmed/broken, with the red marker placed at the
first subprovince in that cached path whose *current* owner (from `GameState.subprovinces`, once
Batch 4 lands) is no longer friendly. This is a display-time interpretation of already-received
data, not a new supply computation — consistent with "never recalculate supply on the client." If
a division has *never* had a non-empty route (cut off from the first tick), fall back to no line,
marker only at the division's own position.

## Task 1: Client Event Plumbing

**Files:**

- Modify: `client/src/core/event_bus.gd`
- Modify: `client/src/core/game_state.gd`
- Modify: `client/src/systems/session/session_manager.gd`

**Work:**

1. `event_bus.gd`: add `signal supply_route_updated(division_id: String, route: Dictionary)`.
2. `game_state.gd`: add `supply_routes: Dictionary = {}` (division_id → last-received `SupplyRoute`
   dict) and `last_known_supply_path: Dictionary = {}` (division_id → last non-empty
   `subprovinceIds` array, per the gap resolution above), mirroring the existing
   `air_wing_paths: Dictionary` cache pattern (`game_state.gd:37`) rather than inventing a new
   storage convention. Add `_apply_supply_route_update(data: Dictionary) -> void`:
   ```gdscript
   func _apply_supply_route_update(data: Dictionary) -> void:
       var division_id: String = data.get("divisionId", "")
       supply_routes[division_id] = data
       var path: Array = data.get("subprovinceIds", [])
       if path.size() > 1:
           last_known_supply_path[division_id] = path
       EventBus.supply_route_updated.emit(division_id, data)
   ```
3. `session_manager.gd`: add `"SUPPLY_ROUTE_UPDATE": GameState._apply_supply_route_update(data)` to
   the existing `match type:` block, same pattern as `DIVISION_UPDATES`.

## Task 2: Supply Line Overlay Renderer

**Files:**

- Create: `client/src/systems/military/supply_line_overlay.gd`
- Modify: `client/src/systems/map/vision_render_layers.gd`

**Work:**

1. Add `const SUPPLY_ROUTE_Z: int = 27` to `vision_render_layers.gd` (confirmed by research:
   `FOG_OVERLAY_Z = 25`, `WORLD_MARKER_Z = 30` — unit icons draw at 30, so routes need a value
   strictly between, placing them "above fog and below unit icons" per the requirement).
2. Own one visual node per division with an active route to display: a `Node2D` wrapper containing
   a `Line2D` (the route polyline) plus an optional marker child (`Polygon2D` or small `Sprite2D`)
   for the cut-off interruption point. Build the polyline's points by resolving each ID in the
   route's `subprovinceIds` (or `last_known_supply_path` for a `cut_off` display, per the gap
   resolution) to a centroid via `map_loader.get_subprovince_polygon(id)` (Batch 3), projected
   through the shared `MapProjection` helper already used everywhere else client-side — do not
   recompute projection independently.
3. **Which divisions get a line, and emphasis:**
   - Own units: every ID in `MilitarySystem`'s current multi-selection
     (`EventBus.division_selection_changed`) gets a line; the one matching
     `EventBus.division_active_changed` renders at full opacity/width, others in the selection at
     reduced opacity — reuse `military_system.gd`'s existing selected/active distinction rather
     than inventing a separate "emphasis" concept.
   - Foreign units: any division whose route data has been received (`GameState.supply_routes`
     has an entry) **and** is currently visible — connect to `EventBus.division_revealed` /
     `division_appeared` to add a line, `division_hidden` / `division_vanishing` to remove it,
     mirroring `military_system.gd`'s existing four-signal wiring pattern exactly (confirmed
     structural precedent from research).
   - **Confirm during implementation** whether there's an existing "inspect a foreign division"
     interaction distinct from selection (selection is confirmed own-units-only via
     `military_system.gd`'s `_is_own_unit` filter) — the requirement "visible foreign-unit routes
     are inspectable end-to-end while the unit remains visible" implies routes for foreign units
     render independent of selection, gated only by visibility, not by a click/inspect action; this
     plan assumes that (any visible foreign unit with received route data always shows its line,
     no separate inspect gesture required) — if that turns out to clutter the map in practice, that
     is exactly the "avoid full-map route clutter" requirement's job to catch during manual review,
     not something to solve by guessing at an inspect interaction that may not exist.
4. **Styling** — a `const ROUTE_STYLE` table at file scope, keyed by `status`, following
   `map_renderer.gd`'s `NATION_PALETTE` convention exactly (centralized table, not inline magic
   numbers):
   ```gdscript
   const ROUTE_STYLE := {
       "open":     {"color": Color(0.2, 0.8, 0.9), "pulse_rate": 2.0, "width": 4.0},
       "degraded": {"color": Color(0.9, 0.7, 0.2), "pulse_rate": 1.0, "width": 4.0},
       "cut_off":  {"color": Color(0.85, 0.2, 0.2), "pulse_rate": 0.0, "width": 3.0, "dashed": true},
   }
   ```
   (values illustrative/tunable, mark as such — no playtesting basis yet, same as other density/
   timing constants elsewhere in this project). `"encircled"` deliberately has no entry — see
   Task 3.
5. **Pulse animation** — reuse `engagement_banner.gd`'s oscillating-alpha `_process` pattern
   (`_pulse_alpha`/`_pulse_dir` bouncing between two bounds, scaled by `delta`), applied per-route
   to the `Line2D`'s `modulate.a`, with the oscillation speed driven by `pulse_rate` from the style
   table — this directly gives "amber pulses slower" without a second animation system.
6. **Cut-off broken rendering**: when drawing from `last_known_supply_path` in cut_off mode, split
   the `Line2D` at the first subprovince along that cached path whose current owner
   (`GameState.subprovinces[id].owner_id`, once Batch 4 lands) is not friendly — render the
   friendly-side segment solid, omit the rest (or render it faded, whichever reads more clearly
   during manual review), and place the red interruption marker node at that break point.
7. Do not mutate `GameState` — read-only consumer.
8. Confirm layering: routes must render above `SUBPROVINCE_FILL_Z`/fog and below `WORLD_MARKER_Z`,
   verified visually and by the z-index test in Task 4.

## Task 3: Encircled Status Handling

**Files:**

- Modify: `client/src/systems/military/supply_line_overlay.gd`

**Work:**

1. Confirm during implementation whether an existing division-icon system already renders the
   Tier 3 "Kessel ring" indicator described in `STRATEGIC_COMBAT.md`'s UI table (red ring around
   the division dot) — this is plausible given that table's phrasing describes it as an existing
   spec item, but this batch's research did not locate the actual rendering code for it (it may not
   be implemented yet either, or may live in a division-icon script not covered by this batch's
   research scope).
2. If it exists: `supply_line_overlay.gd` does nothing extra for `status == "encircled"` beyond not
   drawing a normal route line (there's no path to draw in a true encirclement — Batch 5 explicitly
   never assigns this status itself, so in practice this branch is mostly unreachable until Batch 8
   lands, but the styling/branch should exist defensively rather than error on an unhandled enum
   value).
3. If no such indicator exists yet: that's a real gap outside this batch's file list (a division
   icon change, not an overlay/route change) — flag it back rather than building it inside
   `supply_line_overlay.gd`, since "alongside the existing unit indicator" in the phase doc implies
   the indicator is assumed to already exist or be someone else's concern.
4. Either way, `supply_line_overlay.gd` must not crash or draw a broken/empty line for `"encircled"`
   — handle it as an explicit no-line case, not a fallthrough to the `cut_off` branch.

## Task 4: Land Selection Popover Status Line

**Files:**

- Modify: `client/src/ui/hud/land_selection_popover.gd`

**Work:**

1. In `_refresh_content()`, alongside the existing `_supply.text` line (`land_selection_popover.gd:165`,
   currently showing `data.get("supply_status", "normal")` from the division dict), add a lookup of
   `GameState.supply_routes.get(_active_id, {})` and append a compact route summary — e.g. status
   word plus throughput percentage (`"Route: Degraded (62%)"`), or a second small Label sibling
   under `$Margin/Content/Body/Details/` if appending to the existing `_supply` Label reads as
   cluttered — decide the exact placement during implementation, the requirement is "compact," not
   a specific layout.
2. Update this text whenever `EventBus.supply_route_updated` fires for the currently-active
   division, not only on selection change — a route can change status while a unit stays selected.

## Task 5: Overlay Tests

**Files:**

- Create: `client/test/test_supply_line_overlay.gd`
- Create: `client/test/test_supply_line_overlay.tscn`

Model on `client/test/test_map_renderer_overlay_switch.gd`'s pattern: instantiate the overlay
script directly, inject a `FakeMapLoader` (subprovince polygon stubs, reusing Batch 6's fake if it
already exists) and a fake/real `GameState`, feed synthetic `SupplyRoute` dictionaries via direct
method calls or by emitting `EventBus.supply_route_updated`, assert on the resulting `Line2D`
point/color/visibility state.

**Required cases** (from `SUBPROVINCE_PHASES.md`'s Batch 7 required-test list):

- Selection creates a route line for the selected division.
- Multiple selection displays every selected division's route simultaneously.
- The active (vs. merely selected) division's route renders with the emphasized style.
- Deselecting a division removes its route line.
- An in-place route update (new `supply_route_updated` for an already-displayed division) updates
  the existing line rather than creating a duplicate.
- Own routes persist through simulated fog (emit `division_hidden` for an *own* unit — its route
  must NOT disappear, only foreign routes are visibility-gated).
- Foreign routes disappear on `division_hidden`/`division_vanishing` and reappear on
  `division_revealed`/`division_appeared`.
- Cut-off rendering uses the cached `last_known_supply_path`, not the (empty) path from the
  cut_off update itself, and places the marker at the correct break point given a synthetic
  ownership change.
- Animation (pulse) does not mutate `GameState` or any gameplay-relevant value — only visual
  properties change over sampled frames.
- Two overlapping routes remain visually distinguishable (basic sanity check — e.g. both have
  non-identical resolved point sets/colors given non-identical inputs, not a rendered-pixel
  comparison).

**Verification:**

```bash
godot --headless --path client client/test/test_supply_line_overlay.tscn
```

## Dependencies

No new dependencies. Reuses `map_loader.gd`'s subprovince polygon lookups (Batch 3),
`GameState.subprovinces` (Batch 4), `military_system.gd`'s selection/visibility signals (existing),
`engagement_banner.gd`'s pulse pattern (existing), `map_renderer.gd`'s style-table convention
(existing).

## Verification

```bash
godot --headless --path client client/test/test_supply_line_overlay.tscn
godot --headless --path client client/test/test_subprovince_renderer.tscn
godot --headless --path client client/test/test_map_renderer_overlay_switch.tscn
```

The latter two are regression checks against Batch 6 and existing overlay behavior.

## Manual Verification Gate

Batch 7 is complete only after manual review confirms:

1. Select one supplied unit; its route draws correctly styled by status.
2. Select multiple supplied units; all routes draw, active one emphasized.
3. Compare road (teal, faster pulse) vs. degraded/off-road (amber, slower pulse) styling
   side by side.
4. Break a route (e.g. capture a subprovince along it) and confirm the interruption marker appears
   at the correct point, using the cached-last-known-path behavior from the gap resolution above.
5. Test an encircled unit — confirm no broken/garbage line renders, and whatever existing indicator
   (or flagged gap, per Task 3) represents encirclement is not visually conflicting with this
   overlay.
6. Inspect a visible enemy unit's route; move it into fog and confirm the route disappears; bring
   it back into vision and confirm it reappears without a stale/incorrect path.
7. Confirm the overlay looks attractive without becoming map clutter with several routes visible
   at once — this is explicitly a subjective judgment call per the batch's own phrasing, not a
   pass/fail automated check.
8. Confirm the land-selection popover's route status line updates live as a selected unit's supply
   status changes.

Do not begin deeper system migration (Batch 8: supply/retreat/encirclement server-side rewiring)
until this gate is approved — Batch 8 changes what `SupplyRoute.status` values actually mean in
practice (particularly enabling `"encircled"` for the first time), and this batch's visual language
should be locked in first.
