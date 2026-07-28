# CONTEXT

You are working in `grand-strategy-mp`, a Godot 4.7 multiplayer grand-strategy game.

Read these first:

- `wiki/docs/GAME_CONTEXT.md`
- `wiki/docs/MODULES.md`
- `wiki/docs/EDITOR_MAP_GENERATION.md`
- `wiki/docs/UI_UX_DESIGN.md`

Important architecture rules:

- `GameState` is read-only on the client. Only `NetManager` updates it from server broadcasts.
- UI and client systems must not write gameplay state.
- Cross-module communication should use `EventBus` or explicit setup injection, not ad-hoc global references.
- Server authority comes later. This task is a client-side visibility presentation prototype, not final server-side anti-cheat.

Current map state:

- Runtime map loading now uses generated binary scenes at `res://scenes/map/<map_id>.scn`.
- The generator is `client/src/utils/map-generator.gd`.
- `MapLoader` still reads JSON metadata from `res://assets/data/<map_id>/` for projection, province data, adjacency, terrain lookup, waypoints, camera focus, and UI.
- `MapLoader` instances the generated scene and exposes:
  - `get_province_node(province_id: String) -> Node2D`
  - `get_province_data(province_id: String) -> Dictionary`
  - `get_all_province_ids() -> Array[String]`
  - `project_lng_lat(lng: float, lat: float) -> Vector2`
  - `world_to_lng_lat(world_pos: Vector2) -> Vector2`
  - `get_map_bounds() -> Rect2`
- Generated map layers currently include:
  - `WaterLayer`
  - `Provinces`
  - `CollisionLayer`
  - `CoverLayer`
  - `ElevationLayer`
  - `RiversLayer`
  - `RoadsLayer`
- `MapRenderer` owns province coloring and overlay visibility. It should remain the owner of political/elevation/cover coloring.
- `MilitarySystem` owns division icons and reads division state from `GameState`.
- `map_debug.tscn` currently wires `MapLoader`, `MapRenderer`, `MapInteraction`, `CameraSystem`, and `MilitarySystem` together.

Design direction:

The visibility system is data-driven underneath and uses one combined render texture only
as its presentation layer. Rendering never decides gameplay visibility.

The intended look:

- The whole map is dark by default.
- Locally owned and allied land is fully visible to its exact province boundaries.
- Local-player units create soft radial visible areas; allied units do not share unit vision.
- The combined mask gives reveal sources a soft atmospheric edge without additive lighting.
- The visibility data should remain inspectable and replaceable later with server-provided vision.

Why:

- Data-driven visibility can later become server authoritative.
- Mask presentation can be tuned or replaced without changing gameplay rules.
- This avoids tying fog-of-war correctness to rendering brightness.

# INSTRUCTION

Implement a first-pass client-side vision system for the Godot game.

Before implementation:

- Create `wiki/client/vision/vision-system-plan.md` and list it in
  `wiki/client/vision/index.md` while work is active.
- Keep the plan phase-based and decision-complete.
- Do not mutate `GameState`.
- Do not add server logic yet.
- Keep changes scoped to client-side display/debug behavior.

## Goal

Add a `VisionSystem` that computes local player visibility from current client data, then
renders that visibility through a dark map treatment and one combined visibility mask.

For this first pass, preserve gameplay behavior:

- Province clicking should still work.
- Overlay buttons should still work.
- Division icons should still work.
- Camera movement and centering should still work.
- No commands should be submitted as part of visibility.

## Recommended Implementation Shape

Add a new script:

```text
client/src/systems/map/vision_system.gd
```

The system should be a normal `Node`, not an autoload.

Expose at minimum:

```gdscript
func setup(map_loader: Node, map_renderer: Node = null) -> void
func on_map_loaded(_province_count: int) -> void
func refresh_visibility() -> void
func is_province_visible(province_id: String) -> bool
```

Use strict GDScript typing. Do not rely on inference for `Variant` values from dictionaries or JSON.

Wire it into:

```text
client/scenes/debug/map_debug.tscn
client/src/debug/map_debug.gd
```

Place the `VisionSystem` node as a sibling of `MapLoader`, `MapRenderer`, and `MilitarySystem`.

## Visibility Data Rules For V1

Use client-side approximate visibility only.

Visible provinces:

- A province is visible if its current owner/nation matches `GameState.get_my_nation_id()`.
- A province is visible if its owner has an `"alliance"` relation from the local nation.
- Resolve runtime ownership from `owner_id`, then `nation_id`; if neither exists, fall back
  to `MapLoader.get_province_data(province_id).get("nation_id", "")`.
- A province is visible if it is inside reveal radius of one of the local player's divisions.
- Previously observed territory is not remembered. It returns to full fog as soon as no
  current territory or unit source reveals it.

Friendly divisions:

- Use `GameState.get_my_nation_divisions()` or equivalent read-only access.
- For each division, read:
  - `position_lng`
  - `position_lat`
  - `observation_radius`
- Project the division position with `MapLoader.project_lng_lat(...)`.
- Use `observation_radius` as a visual radius if practical. If the value is too small for map-scale rendering, add a clearly named multiplier constant in `VisionSystem`, such as `UNIT_VISION_RADIUS_MULTIPLIER`.

Friendly-territory reveal:

- Render every generated `Fill` and `FillPartXX` polygon for locally owned and allied
  provinces at full visibility.
- Do not use a city-, focus-, or centroid-centred radial reveal for territory.
- Preserve full visibility through the province boundary, then apply a subtle
  ten-world-pixel outward feather.
- Allied divisions do not add radial reveal; only local-player divisions do.

Visible data structure:

- Maintain a local `Dictionary` or typed set-like dictionary:

```gdscript
var _visible_provinces: Dictionary = {} # province_id -> true
```

- This is client display state only.
- Do not write it into `GameState`.

Refresh triggers:

- Refresh after `map_loaded`.
- Connect to relevant `EventBus` signals:
  - `division_added`
  - `division_updated`
  - `division_removed`
  - `province_captured`
  - `relation_changed`
  - `lobby_state_updated`
- Keep signal handlers small and call `refresh_visibility()`.

## Visual Layer Rules

Create all visual fog/vision nodes under `VisionSystem`, not inside `MapRenderer`.

Use a structure like:

```text
VisionSystem
├─ OceanBackground
├─ VisibilityMaskViewport
│  └─ VisibilitySources
└─ CombinedVisibilityFog
```

The mask viewport renders exact friendly-territory polygons and normalized local-division
radial stamps in separate texture channels, updating only when source state changes. A
world-space multiplicative polygon samples that texture above cartography and below
gameplay marker roots.

- Combine province and unit channels with a bounded maximum; overlapping sources never
  brighten normal map color.
- Keep fog and mask nodes in world space so camera pan, zoom, and input coordinates remain unchanged.
- Do not darken UI panels.
- Do not make collision shapes visible.

Required visual behavior:

- Political map should still be readable in visible areas.
- Hidden/unseen areas should be very dark, not fully impossible to orient around unless that is necessary.
- Province interiors should be uniformly visible with no brightness gradient or circular
  glow; only their narrow outward boundary is feathered.
- Units should produce tighter, brighter reveal.
- Cartography and labels render below the fog polygon. Divisions, routes, combat
  indicators, aircraft, and naval contacts render above it; their data-driven visibility
  rules decide whether they appear.
- Moving units update existing keyed stamps. Static province polygons rebuild only after
  ownership, alliance, or full visibility refreshes.
- Division scouting and observation ranges are selected-only outlines, never filled discs.

Recommended constants:

```gdscript
const DARKNESS_COLOR: Color = Color(0.34, 0.36, 0.42, 1.0)
const UNIT_REVEAL_STRENGTH: float = 1.0
const PROVINCE_FEATHER_WIDTH_WORLD: float = 10.0
const UNIT_VISION_RADIUS_MULTIPLIER: float = 1.0
const MIN_UNIT_REVEAL_RADIUS: float = 90.0
const MAX_VISIBILITY_SOURCES: int = 128
const MAX_MASK_DIMENSION: int = 2048
```

Tune these after a visual smoke test.

Performance guardrails:

- Render all eligible province fill parts so visibility correctness is never source-cap
  dependent; rebuild this static geometry only when territory relationships change.
- Cap dynamic local-division stamps with `MAX_VISIBILITY_SOURCES`.
- Cap mask texture resolution by its longest dimension.
- Request a viewport update only when a stamp is added, removed, moved, or resized.

## Data Versus Rendering Boundary

`VisionSystem` owns:

- Current local visible province set.
- Fog/darkness visual nodes.
- Combined visibility mask, exact friendly-territory polygons, and local-unit reveal stamps.
- Query method `is_province_visible(...)`.

`MapRenderer` still owns:

- Political/elevation/cover colors.
- Province highlight coloring.
- Nation labels.
- Overlay mode visibility.

Do not move overlay mode logic into `VisionSystem`.

For V1, do not hide enemy units or province labels based on visibility unless it can be done cleanly without touching gameplay state. The first goal is the map darkness/reveal visual layer and a queryable visibility set.

## Generated Map Scene Consideration

Because generated map scenes can now carry extra nodes, decide whether the vision container should be generated or runtime-created.

For V1, prefer runtime-created `VisionSystem` child layers so iteration does not require regenerating `western_europe_6.scn`.

Only modify `map-generator.gd` if a stable empty layer in generated scenes is clearly useful. If you add one, document it in `wiki/docs/EDITOR_MAP_GENERATION.md`.

## Debug Requirements

Add temporary debug affordances only if useful:

- A boolean export like `@export var vision_enabled: bool = true`.
- A method to toggle fog on/off from code.
- Console prints should be minimal and removed or gated behind a debug flag.

Do not add visible in-game instructional text.

## Verification

Run these checks:

```bash
godot --headless --path client res://tests/test_vision_render_boundary.tscn
```

```bash
godot --headless --path client res://scenes/debug/map_debug.tscn --quit
```

Manual Godot verification:

- Run `res://scenes/debug/map_debug.tscn`.
- Confirm the map is dark by default.
- Confirm selected/local nation land is visible.
- Confirm local debug divisions create soft circular visibility around their positions.
- Confirm political/elevation/cover buttons still switch overlays.
- Confirm province hover/click still works.
- Confirm military unit selection and movement input still works.
- Confirm UI/HUD is not darkened by the world fog.

Expected existing warnings:

- Missing `res://.env` can appear.
- Existing Godot doc parser warning may appear.
- Do not treat those as failures unless new visibility-specific errors appear.

## Acceptance Criteria

- `VisionSystem` exists and is wired into the debug map scene.
- The map has a dark default presentation.
- Locally owned and allied land is uniformly visible across exact province polygons with a
  narrow outward feather.
- Only local-player divisions create soft radial visible regions.
- Territory returns immediately to full fog when ownership, alliance, or unit coverage ends.
- Vision rendering contains no `PointLight2D`; overlapping mask sources stay normalized.
- `VisionSystem.is_province_visible(province_id)` returns the current local visibility result.
- No client code mutates `GameState`.
- Existing map renderer, interaction, camera, and military behavior remains functional.
- New implementation is documented briefly in this file or a small follow-up doc section if behavior changes.
