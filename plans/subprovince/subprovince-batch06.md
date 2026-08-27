# Batch 6: 2D Subprovince Renderer

> **For agentic workers:** Implement this batch independently and stop at the manual verification
> gate. This batch only renders server-authoritative state — it never computes ownership, combat
> status, or fog visibility itself, and never mutates `GameState`. Do not touch supply-line
> visualization (Batch 7) or retire `frontline_overlay.gd` (Batch 9 — it's already dead code, see
> below, but stays in place until then).

**Goal:** Render subprovince ownership as flat-fill `Polygon2D`s below fog and below province
borders, visible only at close zoom, with a contested tint while a cell is combat-frozen and a
fade tween between owner colors on capture — replacing the old Dynamic Frontline System's
continuous shader-influence approach with discrete, mostly-static fills that only animate the
handful of cells actively transitioning.

**Architecture:** A new `subprovince_renderer.gd`, structurally parallel to the existing
`map_renderer.gd` (one `Polygon2D` per entity, react to `EventBus` signals, reuse the existing
`NATION_PALETTE`), attached as a sibling node in `game.tscn`/`map_debug.tscn`. Combat-freeze state
is inferred client-side from already-synced `DivisionState.combat_state`/position data — this
batch adds no new server files or events (per `SUBPROVINCE_PHASES.md`'s Batch 6 file list, which is
entirely client-side).

**Tech Stack:** GDScript, Godot 4.

## Scope

### Included

- `subprovince_renderer.gd`: one `Polygon2D` fill per subprovince, colored by owner nation.
- Zoom-gated soft-gray subprovince border lines (separate from fills), close-zoom-only.
- Contested tint while a cell is combat-frozen, inferred client-side (no new server sync).
- Interruptible fade tween per transitioning cell (owner → contested → resolved), correctly
  restarting from the live interpolated color if a second transition starts mid-flight.
- Z-index/layering so fills sit below fog and below province borders.
- Preserving existing province-level click collision untouched.
- `client/test/test_subprovince_renderer.gd`.

### Excluded

- Supply-line overlay rendering (Batch 7).
- Retiring `frontline_overlay.gd` (Batch 9) — it is already fully dead code (its `_draw()` is a
  no-op, all logic commented out; see Task 0 below), so there is nothing live to conflict with, but
  deleting/renaming the file is explicitly out of scope here.
- Any change to how ownership/combat-freeze is *computed* — this batch only visualizes state that
  Batches 4/5 already compute server-side or that's already client-synced (division combat_state).
- Subprovince selection/interaction — per Global Constraints, "the client preserves province-level
  interaction unless a later design explicitly adds subprovince selection." Fills are visual only,
  non-interactive, same as the borders (per the top-level Decisions section: "Subprovince borders
  are soft gray, close-zoom-only, below fog, and non-interactive").

## Prerequisite Gap

**Batches 3 and 4 are not yet implemented in the actual codebase** (confirmed by direct inspection
during this batch's research — `event_bus.gd` has no `subprovince_captured` signal,
`game_state.gd` has no `subprovinces` dict, `map_loader.gd` has no `get_subprovince_polygon`, and
`client/src/utils/map_projection.gd` doesn't exist). This plan is written against those batches'
*planned* interfaces (`subprovince-batch03.md`, `subprovince-batch04.md`) as the contract to
implement against. If Batch 6 work starts before Batches 3/4 land in the real tree, implement them
first — do not stub out equivalent one-off logic inside `subprovince_renderer.gd` just to unblock
this batch, since that would create a second, divergent copy of the loader/event contract.

## Task 0: Confirm Province Border Rendering Mechanism

Before writing any z-index or draw-order logic, confirm during implementation how province borders
are actually drawn today — research for this batch found `map_renderer.gd` colors province `Fill`
`Polygon2D` nodes but did **not** find a dedicated border/stroke node or script separate from the
fills themselves. "Province borders remain visually stronger than subprovince borders" (a Global
Constraint and a required Batch 6 test case) cannot be implemented correctly without knowing what
draws a province border today:

- If borders are implicit (adjacent province `Fill` polygons simply touching, no dedicated line
  node), then "stronger" borders likely means the *fill color contrast* at province edges, and
  subprovince borders need to be a distinctly softer, thinner, semi-transparent line drawn as a
  new dedicated line layer (e.g. `Line2D` per shared edge, or a single batched multi-line draw) —
  not "z-index below an existing border node," since none exists.
- If a dedicated border-drawing mechanism does exist somewhere not surfaced by this batch's
  research (e.g. inside `map-generator.gd`'s baked scene, or a shader), locate it and place the new
  subprovince border layer's z-index/opacity explicitly below and lighter than it.

Resolve this as the first implementation step and record the answer in this file's Task 2 before
proceeding, since it changes whether Task 2 is "add a new line layer" or "z-order against an
existing one."

## Task 1: Subprovince Fill Rendering

**Files:**

- Create: `client/src/systems/map/subprovince_renderer.gd`
- Modify: `client/src/systems/map/vision_render_layers.gd`

**Work:**

1. Add a new z-index constant to `vision_render_layers.gd`, e.g. `SUBPROVINCE_FILL_Z`, following
   the existing `OCEAN_BACKGROUND_Z`/`MAP_OCEAN_Z`/`CARTOGRAPHY_MAX_Z`/`FOG_OVERLAY_Z` convention
   (file currently defines `OCEAN_BACKGROUND_Z=-2, MAP_OCEAN_Z=-1, CARTOGRAPHY_MAX_Z=20,
   FOG_OVERLAY_Z=25, WORLD_MARKER_Z=30`). Set `SUBPROVINCE_FILL_Z` strictly between `MAP_OCEAN_Z`
   and province fill's effective z (province fills currently draw at implicit z=0 sibling order —
   pick a value that reliably sits below them, e.g. a small negative offset from 0, or explicitly
   set province `Fill` nodes' z-index too if Task 0 finds they need one to make the ordering
   deterministic rather than relying on node-tree sibling order). Must stay `< FOG_OVERLAY_Z (25)`.
2. On setup (`subprovince_renderer.setup(map_loader, game_state)`, called from `map_scene.gd`'s
   `_on_map_loaded()` per the wiring in Task 4), create one `Polygon2D` per subprovince ID from
   `map_loader.get_all_province_ids()` → `get_province_subprovince_ids(province_id)` →
   `get_subprovince_polygon(subprovince_id)`, matching `map_renderer.gd`'s per-entity node-creation
   pattern. Set `z_as_relative = false` and the constant from step 1.
3. Color each fill from `GameState.subprovinces[subprovince_id].owner_id`, resolved through
   `map_renderer.gd`'s existing `NATION_PALETTE` (reference it directly — e.g. via the
   `MapRenderer` script class, or extract the const if that turns out cleaner during
   implementation; do not create a third independent color table alongside `map_renderer.gd`'s and
   the already-dead one in `frontline_overlay.gd` — this is a real, cheap opportunity to not add to
   existing palette duplication, not a hard requirement to refactor `map_renderer.gd` itself).
4. Connect to `EventBus.subprovince_captured(subprovince_id, province_id, new_owner_id)`
   (Batch 4's signal) → look up the fill node, start the fade tween from Task 3 instead of setting
   color directly.
5. Do not mutate `GameState` from this file — read-only consumer, per Global Constraint #3 (UI/
   renderer never writes gameplay state) even though this isn't strictly "UI."

## Task 2: Subprovince Border Lines (Zoom-Gated)

**Files:**

- Modify: `client/src/systems/map/subprovince_renderer.gd`

**Work:**

1. Draw soft-gray subprovince border lines — implementation shape depends on Task 0's finding, but
   the default assumption (no existing dedicated border layer) is: build shared-edge line segments
   once at setup time from `subprovince_adjacency.geojson`'s neighbor pairs (each pair's shared
   polygon edge — reuse Batch 3's client-side adjacency data, do not recompute shared edges
   geometrically at runtime if the polygon vertex data already makes this easy: consecutive-vertex
   matching between neighbor polygons after projection), batched into as few `Line2D`/immediate-draw
   calls as practical rather than one node per edge, given the multi-thousand-edge scale flagged in
   Batch 4's planning.
2. Hide this layer by default; show it only above a new zoom threshold constant defined in this
   file (not reusing `NATION_LABEL_ZOOM_THRESHOLD` from `camera_system.gd`/`map_renderer.gd` — "close
   enough to distinguish subprovince lines" is a distinct visual concern from "close enough to hide
   nation labels," even though both are zoom-driven; pick an initial value and mark it tunable, same
   as the pipeline's density constants elsewhere in this project).
3. Connect to `CameraSystem.zoom_changed(level)` the same way `map_scene.gd:39` already wires
   `_camera_system.zoom_changed.connect(_map_renderer.on_zoom_changed)` — add an equivalent
   connection to this renderer's own zoom handler, rather than routing subprovince zoom logic
   through `map_renderer.gd`'s unrelated `on_zoom_changed`.
4. Border lines stay non-interactive (no `input_pickable`, no collision) — visual only, per the
   Decisions section.

## Task 3: Fade Transition and Contested Tint

**Files:**

- Modify: `client/src/systems/map/subprovince_renderer.gd`

**Work:**

1. **Fade tween**: on `subprovince_captured`, animate the fill's `color` property from its current
   color to the new owner's palette color over a configurable duration (`HANDOFF.md` proposes
   300-500ms, not confirmed by playtesting — use a named constant, mark tunable). Model on
   `map_renderer.gd`'s `_overlay_tween`/`_kill_overlay_tween()` pattern (store a
   `Dictionary[subprovince_id -> Tween]` since transitions are per-cell and multiple can run
   concurrently, unlike `map_renderer.gd`'s single shared `_overlay_tween`).
2. **Interrupted-transition restart** (no existing precedent in the codebase — this is genuinely
   new logic, confirmed by research): when a second `subprovince_captured` arrives for a cell whose
   tween is still running, do **not** call `.kill()` and restart from the old target color. Instead:
   read the fill's *current, live-interpolated* `color` (its value at kill time is whatever the
   tween last set — `Tween.kill()` does not reset the property), kill the old tween, and start the
   new tween from that just-read color to the new target. Verify this actually works as assumed
   during implementation — confirm `Polygon2D.color` genuinely holds the live interpolated value at
   the moment of `.kill()` in Godot 4's tween implementation (this is stated as the expected
   mechanism per Godot's tween model, but this batch's test in Task 5 is what actually proves it,
   not this plan).
3. **Contested tint**: while `SubprovinceSystem.isCombatFrozen(subprovince_id)` is true
   server-side, ownership doesn't change (per Batch 4), but the fill should render a distinct
   contested tint instead of a flat owner color, without any new server sync (per Batch 6's
   client-only file list). Infer freeze state client-side:
   - Listen for changes to `GameState.divisions[*].combat_state` transitioning into/out of
     `"engaged"`/`"suppressed"` (the same two values Batch 4 established as the active-combat
     states) for divisions whose position falls inside a subprovince this renderer tracks.
   - Resolve "which subprovince is this division in" using the same client-side polygon data
     Batch 3 loads (`get_subprovince_polygon`), narrowed to the division's current province (via
     whatever province-lookup the client already does for existing division-in-province logic — do
     not brute-force point-in-polygon against every subprovince on the map for every division;
     confirm the client has an existing province-for-division lookup to narrow the candidate set
     before falling back to a full scan, since a full per-frame scan against thousands of polygons
     is the kind of cost this architecture is explicitly trying to avoid).
   - Maintain a small `frozen_subprovince_ids: Dictionary` (expected to be tiny — only cells with
     active tactical combat, not the whole map) and re-tint affected fills when it changes. This
     computation should be event-driven (react to combat_state changes as they arrive), not a
     per-frame poll.
   - If, during implementation, this turns out to need data the client doesn't already have
     (e.g. no existing division-to-province lookup to narrow the scan), that's a real gap to flag
     back rather than silently building an expensive full-map scan — a minimal server-side addition
     (e.g. including `subprovince_id` directly on synced `DivisionState`, decided against in Batch 4
     to keep schema minimal, but revisitable if the client-side alternative proves impractical) is
     an acceptable escalation path, not a silent workaround.
4. Contested tint takes visual precedence over the fade tween — if a cell is frozen mid-fade,
   the tint should still show as combat-frozen state rather than continuing to interpolate toward
   the pre-freeze target (this can't fire in practice today since Batch 4's freeze gate prevents
   `SUBPROVINCE_CAPTURED` from firing on frozen cells in the first place, but a fade already in
   flight when a *different* nearby division starts a fight in the same cell is possible — resolve
   this edge case with whichever behavior is simpler to implement correctly rather than the "ideal"
   one, and note the choice in code).

## Task 4: Scene and Wiring

**Files:**

- Modify: `client/scenes/game/game.tscn`
- Modify: `client/scenes/debug/map_debug.tscn`
- Modify: `client/src/game/map_scene.gd`

**Work:**

1. Add a `SubprovinceRenderer` node (script: `subprovince_renderer.gd`) as a sibling of
   `MapRenderer` in both scenes, matching the existing flat node-tree convention.
2. In `map_scene.gd`, add `@onready var _subprovince_renderer: Node = $SubprovinceRenderer`
   alongside the existing `@onready` block, and call
   `_subprovince_renderer.setup(_map_loader, game_state)` (or equivalent) in `_on_map_loaded()`
   right after the existing `_map_renderer.setup(...)` call (`map_scene.gd:140`), and connect zoom
   per Task 2 step 3 in the same place `_camera_system.zoom_changed` is already wired
   (`map_scene.gd:39`).
3. Do not touch `MapInteraction`'s province click collision wiring — confirm after this change that
   clicking a province still resolves to the province (not a subprovince, since subprovinces stay
   non-interactive) by re-running whatever existing manual/automated province-click check exists.

## Task 5: Renderer Tests

**Files:**

- Create: `client/test/test_subprovince_renderer.gd`
- Create: `client/test/test_subprovince_renderer.tscn`

Model directly on `client/test/test_map_renderer_overlay_switch.gd` (closest existing structural
match — fake data-source pattern, `await get_tree().create_timer(...).timeout` +
`await get_tree().process_frame` to sample mid-tween state, custom `_assert_true`/`_assert_eq`
helpers, `print("[PASS]...")` / `get_tree().quit(0/1)`). Build a `FakeMapLoader` exposing
`get_all_province_ids`, `get_province_subprovince_ids`, `get_subprovince_polygon` returning small
synthetic polygons (2-3 subprovinces is enough), and a fake `GameState` with a small
`subprovinces`/`divisions` dict.

**Required cases** (from `SUBPROVINCE_PHASES.md`'s Batch 6 required-test list):

- Geometry projection: fill polygon vertices match the projected coordinates from
  `get_subprovince_polygon`.
- Initial ownership: fill color matches `GameState.subprovinces[id].owner_id`'s palette color on
  first load, no tween involved.
- Single-cell ownership update: `subprovince_captured` signal updates exactly the affected fill,
  no others.
- Fade transition: sampled mid-tween color is strictly between the old and new owner colors (same
  technique as `test_map_renderer_overlay_switch.gd` lines 103-116).
- Interrupted transition restart: start a transition, sample its live color partway through,
  trigger a second transition before the first completes, assert the new tween starts from the
  sampled live color, not from the original pre-first-transition color and not from the
  first-transition's target color.
- Contested tint: simulate a division entering `"engaged"` state inside a tracked subprovince,
  assert the fill switches to the contested tint without an ownership change.
- Fog layering: assert the fill's z-index is below `VisionRenderLayers.FOG_OVERLAY_Z`.
- Province-border precedence: assert whatever Task 0/2 establishes as the enforceable signal of
  "province borders draw stronger" (exact assertion depends on Task 0's finding — write this test
  after Task 0 resolves the mechanism, not before).
- Close-zoom visibility: border layer is hidden below the zoom threshold, visible above it.

**Verification:**

```bash
godot --headless --path client client/test/test_subprovince_renderer.tscn
```

## Dependencies

No new dependencies. Reuses `map_renderer.gd`'s `NATION_PALETTE`, `vision_render_layers.gd`'s
z-index convention, `camera_system.gd`'s `zoom_changed` signal, and Batch 3/4's client loader and
event contracts.

## Verification

```bash
godot --headless --path client client/test/test_subprovince_renderer.tscn
godot --headless --path client client/test/test_map_renderer_overlay_switch.tscn
godot --headless --path client client/test/test_generated_map_overlay_meshes.tscn
```

The latter two are regression checks — this batch must not change existing province rendering or
overlay-mode-switch behavior.

## Manual Verification Gate

Batch 6 is complete only after manual review confirms:

1. Zoom from strategic to close view; subprovince fills are present at all zoom levels but border
   lines appear only at close zoom, and remain visibly softer/thinner than province borders.
2. Fog correctly hides enemy subprovince fills/borders the same way it already hides other
   enemy-territory detail (confirm no fill "bleeds through" fog).
3. A capture transition visibly fades from old owner color through to the new owner color over the
   configured duration, without a hard color pop.
4. Triggering a second capture on a cell mid-fade visibly continues smoothly from the current
   blended color rather than snapping or restarting from the original color.
5. A contested cell (division in active combat there) shows the distinct tint without implying
   ownership has changed, and reverts to the correct flat owner color once combat resolves.
6. Province-level click-to-select still functions identically to before this batch; subprovinces
   are confirmed non-interactive (clicking one does nothing on its own).
7. Visual density is reasonable at close zoom — not overwhelming/cluttered — this is a subjective
   check per the batch's own gate wording ("Approve visual density and boundary treatment").
8. Confirm 2D map ownership rendering matches server events exactly (spot-check a live capture
   sequence against server logs/events, not just visually plausible).

Do not begin Batch 7 (supply-line visualization) until this gate is approved.
