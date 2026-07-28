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

The visibility system should be data-driven underneath, with `PointLight2D` used only as a visual presentation layer.

Do not let `PointLight2D` decide gameplay visibility. Lights should be generated from visibility data, not used as the source of truth.

The intended look:

- The whole map is dark by default.
- Friendly-owned land and friendly units create soft visible areas.
- `PointLight2D` should give the reveal a softer, more atmospheric edge.
- The visibility data should remain inspectable and replaceable later with server-provided vision.

Why:

- Data-driven visibility can later become server authoritative.
- Visual lights can be tuned or replaced without changing gameplay rules.
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

Add a `VisionSystem` that computes local player visibility from current client data, then renders that visibility with a dark map treatment plus `PointLight2D` reveal sources.

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
- If `GameState.provinces` does not yet have runtime ownership for the province, fall back to `MapLoader.get_province_data(province_id).get("nation_id", "")`.
- A province is visible if it is inside reveal radius of one of the local player's divisions.

Friendly divisions:

- Use `GameState.get_my_nation_divisions()` or equivalent read-only access.
- For each division, read:
  - `position_lng`
  - `position_lat`
  - `observation_radius`
- Project the division position with `MapLoader.project_lng_lat(...)`.
- Use `observation_radius` as a visual radius if practical. If the value is too small for map-scale rendering, add a clearly named multiplier constant in `VisionSystem`, such as `UNIT_VISION_RADIUS_MULTIPLIER`.

Friendly-owned land reveal:

- Start simple.
- For each visible owned province, reveal around its fill centroid or city/focus position.
- Prefer `MapLoader.get_province_focus_position(province_id)` when it returns a valid position.
- Fall back to the province fill centroid when focus position is unavailable.

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
  - `lobby_state_updated`
- Keep signal handlers small and call `refresh_visibility()`.

## Visual Layer Rules

Create all visual fog/vision nodes under `VisionSystem`, not inside `MapRenderer`.

Use a structure like:

```text
VisionSystem
├─ DarknessLayer
│  └─ CanvasModulate or ColorRect/Polygon2D overlay
└─ VisionLightLayer
   ├─ PointLight2D
   ├─ PointLight2D
   └─ ...
```

Use whichever Godot 4.7 2D lighting approach is most reliable:

- Prefer `CanvasModulate` plus `PointLight2D` if it works with the existing map CanvasItems.
- If `CanvasModulate` darkens UI/HUD, place it in world space under the map scene rather than under a HUD `CanvasLayer`.
- Do not darken UI panels.
- Do not make collision shapes visible.

Required visual behavior:

- Political map should still be readable in visible areas.
- Hidden/unseen areas should be very dark, not fully impossible to orient around unless that is necessary.
- Lights should have soft falloff.
- Owned provinces should produce broader, calmer reveal.
- Units should produce tighter, brighter reveal.

Recommended constants:

```gdscript
const DARKNESS_COLOR: Color = Color(0.02, 0.025, 0.035, 1.0)
const OWNED_PROVINCE_LIGHT_ENERGY: float = 0.55
const UNIT_LIGHT_ENERGY: float = 0.85
const OWNED_PROVINCE_LIGHT_RADIUS: float = 180.0
const UNIT_VISION_RADIUS_MULTIPLIER: float = 1.0
const MIN_UNIT_LIGHT_RADIUS: float = 90.0
const MAX_DYNAMIC_LIGHTS: int = 128
```

Tune these after a visual smoke test.

Performance guardrails:

- Do not create unbounded lights if later maps have many provinces/units.
- Pool or rebuild lights simply for V1, but cap total lights with `MAX_DYNAMIC_LIGHTS`.
- Prefer visible owned-province lights first, then friendly unit lights, or document the chosen order.
- If too many province lights are expensive, group owned-province reveal by nation components later. Do not implement that optimization unless needed for V1 stability.

## Data Versus Rendering Boundary

`VisionSystem` owns:

- Current local visible province set.
- Fog/darkness visual nodes.
- PointLight2D reveal nodes.
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
HOME=/tmp XDG_CONFIG_HOME=/tmp/godot-config XDG_DATA_HOME=/tmp/godot-data \
godot --headless --path client --check-only --script res://src/systems/map/vision_system.gd
```

```bash
HOME=/tmp XDG_CONFIG_HOME=/tmp/godot-config XDG_DATA_HOME=/tmp/godot-data \
godot --headless --path client --scene res://scenes/debug/map_debug.tscn --quit
```

Manual Godot verification:

- Run `res://scenes/debug/map_debug.tscn`.
- Confirm the map is dark by default.
- Confirm selected/local nation land is visible.
- Confirm local debug divisions create visible light around their positions.
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
- Friendly-owned land and friendly divisions create soft visible regions.
- `PointLight2D` is used only as visual output from data-driven visibility.
- `VisionSystem.is_province_visible(province_id)` returns the current local visibility result.
- No client code mutates `GameState`.
- Existing map renderer, interaction, camera, and military behavior remains functional.
- New implementation is documented briefly in this file or a small follow-up doc section if behavior changes.
