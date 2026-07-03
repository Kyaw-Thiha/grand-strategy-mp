# Map Rendering — Phase 2 Implementation Plan

> ⚠️ **ARCHIVED — Phase 2 implemented 2026-06-01.**
> Pipeline: `map/tools/map_pipeline/pipeline.py`
> Godot modules: `client/src/systems/map/`
> Debug scene: `client/scenes/debug/map_debug.tscn`
> See `docs/MODULES.md` and `docs/MAP_DATA_CONTRACT.md` for current spec.

## Context

Phase 2 of the dev roadmap. Goal: province map renders in Godot from real GeoJSON data, click and camera work. No server dependency — this is all local pipeline + Godot client work. The map data lives in `map/europe_1938_6/` (9 GeoJSON/JSON files + EU-DEM tiles). The pipeline processes them into a Godot-native format, and four Godot modules render and interact with it.

**Verification gate:** Launch Godot → map renders → click provinces → camera pans/zooms/accelerates smoothly.

---

## Phase A — Python Pipeline

Produces `client/assets/data/western_europe_6/` from source files.

### New files
- `map/europe_1938_6/map.json` — map metadata
- `map/tools/map_pipeline/validate.py` — schema validation (called by pipeline)
- `map/tools/map_pipeline/pipeline.py` — main pipeline script

### `map.json` shape
```json
{
  "map_id": "western_europe_6",
  "source_dir": "europe_1938_6",
  "bounds": { "min_lng": -12.3, "max_lng": 22.0, "min_lat": 33.0, "max_lat": 59.9 },
  "dem_source": "shared/dem"
}
```

### Pipeline steps (in order)
1. `validate.py` — check all required fields on every feature; fail loudly
2. Simplify province polygons — `shapely.simplify(tolerance=0.005)` to reduce vertex count
3. Detect adjacency — Shapely shared-edge intersection between every province pair
4. Classify adjacency edges:
   - Intersects `rivers.geojson` major river → `border_type: "river"`
   - Touches `base_water.geojson` polygon → `border_type: "coast"`
   - Otherwise → `border_type: "open"`
5. Assign road_level — check `roads.geojson` intersection per edge → set `road_id`, `road_level`
6. Assign `passable_by` defaults from border_type (mountain edges → infantry only, else all)
7. Reconstruct nested JSON — flat `bld_*`, `res_*` fields → `buildings{}`, `resources{}`
8. Write `map_data.json` (provinces + adjacency, Godot-native)
9. Pass through `cover.geojson`, `elevation.geojson`, `terrain_lookup.json`, `rivers.geojson`, `roads.geojson`
10. Mosaic DEM tiles covering map bounds (rasterio) → clip → write `heightmap.tif`
11. Print summary: province count, adjacency edge count, warnings

**Run:** `python map/tools/map_pipeline/pipeline.py --map europe_1938_6`

**Python deps:** `shapely`, `rasterio`, `numpy`

### `map_data.json` output format
```json
{
  "map_id": "western_europe_6",
  "bounds": { "min_lng": -12.3, "max_lng": 22.0, "min_lat": 33.0, "max_lat": 59.9 },
  "provinces": [
    {
      "province_id": "we6_france_01",
      "name": "Île-de-France",
      "nation_id": "france",
      "is_capital": true,
      "is_playable": true,
      "city_name": "Paris",
      "city_position": [2.35, 48.86],
      "polygon": [[lng, lat], "..."],
      "terrain_elevation": "flat",
      "terrain_cover": "urban",
      "population": 80, "industry": 60, "infrastructure": 70,
      "buildings": { "fort": 0, "port": 0, "airbase": 0, "supply_hub": 1, "factory": 2 },
      "resources": { "manpower": 40, "steel": 0, "oil": 0, "fuel": 0, "coal": 10, "money": 0 },
      "vp_value": 3,
      "is_objective": true
    }
  ],
  "adjacency": [
    {
      "from_province": "we6_france_01",
      "to_province": "we6_germany_01",
      "border_type": "river",
      "road_level": 3,
      "road_id": "road_0023",
      "passable_by": ["infantry", "armor", "motorized", "artillery"]
    }
  ]
}
```

### Data quirks to handle
- `elevation.geojson` features use either `elev_type` OR `elevation_type` (never both) — read whichever is present
- `cover_code = 0` gap-fill cells are valid — do not filter them out

---

## Phase B — Godot Modules

### New files
- `client/scenes/systems/map/province.tscn` — province node template
- `client/src/systems/map/map_loader.gd`
- `client/src/systems/map/map_renderer.gd`
- `client/src/systems/map/map_interaction.gd`
- `client/src/systems/map/camera_system.gd`

### Province scene template (`province.tscn`)
```
ProvinceNode (Node2D)
  ├── Fill (Polygon2D)              ← ownership fill color
  ├── Border (Line2D)               ← province outline
  ├── Clickbox (Area2D)
  │   └── Shape (CollisionPolygon2D)   ← same vertices as Fill
  ├── CityLabel (Label)             ← positioned at city_position
  ├── CityIcon (Sprite2D)           ← positioned at city_position
  └── UnitAnchor (Node2D)           ← unit stack anchor (used in Phase 4)
```

### MapLoader (`map_loader.gd`)
Runs once at game/debug start. Everything else depends on it.

**Responsibilities:**
- Load `map_data.json` → instantiate province template per province → add to scene
- Coordinate projection: `_project(lng, lat) → Vector2` — Mercator, scaled to fill canvas. **Only place in the codebase that touches geographic coordinates.**
- Store registry: `_provinces: Dictionary[String, Node2D]`
- Load `cover.geojson`, `elevation.geojson` → overlay polygon layers (behind province fills)
- Load `rivers.geojson`, `roads.geojson` → Line2D visual layers
- Load `terrain_lookup.json` → cache as `_terrain_lookup: Dictionary`
- Emit `map_loaded(province_count)` when done

**Key methods:**
- `load_map(map_id: String)`
- `get_province_node(province_id: String) → Node2D`
- `get_province_data(province_id: String) → Dictionary`
- `get_all_province_ids() → Array[String]`
- `get_terrain_lookup() → Dictionary`

**Projection (Mercator):**
```gdscript
func _project(lng: float, lat: float) -> Vector2:
    var x = lng * PI / 180.0
    var y = log(tan(PI / 4.0 + lat * PI / 360.0))
    return Vector2(
        (x - _proj_center.x) * _scale,
        -(y - _proj_center.y) * _scale
    )
# _scale chosen so full map fills MAP_CANVAS_SIZE (4096×3000 world pixels)
```

### MapRenderer (`map_renderer.gd`)
Pure display — no input, no game logic.

**Responsibilities:**
- On `map_loaded`: color all province fills based on current overlay mode
- Overlay modes: `political | elevation | cover` (supply added later)
  - `political`: color by `nation_id` from a hardcoded palette dict
  - `elevation`: tint fill by `terrain_elevation` (flat/hills/mountains)
  - `cover`: show cover cell layer, hide province fills
- Respond to `EventBus.province_captured` → recolor affected province
- Highlight selected province (blue tint)

**Data source pattern:** Takes a `data_source` with `get_province(id) → Dict`.
- Game mode: pass `GameState`
- Debug mode: pass thin wrapper calling `MapLoader.get_province_data(id)`
No special cases inside MapRenderer itself.

**Key methods:**
- `set_overlay_mode(mode: String)`
- `highlight_province(province_id: String, colour: Color)`
- `clear_highlights()`
- `refresh_province(province_id: String)`

### MapInteraction (`map_interaction.gd`)
All mouse input on provinces lives here.

**Click detection:** Each province's `Area2D` + `CollisionPolygon2D` (built by MapLoader) emits:
- `mouse_entered` → hover
- `mouse_exited` → unhover
- `input_event` with `InputEventMouseButton` → click / right-click

MapInteraction connects to these signals for all provinces after `map_loaded`.

**State:** `_selected_id: String`, `_hovered_id: String`

**Emits:** `province_clicked(id)`, `province_hovered(id)`, `province_right_clicked(id)`, `selection_cleared()`

### CameraSystem (`camera_system.gd`)
Owns the `Camera2D`. Nothing else touches zoom or pan.

**WASD movement model:**
- Each frame, collect held directions into `Vector2`, normalize it (ensures diagonal = same speed as cardinal)
- `_move_speed` starts at `BASE_SPEED` (200 px/s) the moment any key is pressed, ramps to `MAX_SPEED` (1200 px/s) via `move_toward(_move_speed, MAX_SPEED, ACCELERATION * delta)` (ACCELERATION ≈ 1000)
- When all WASD keys released: `_move_speed = 0.0` instantly — no coasting

**Edge scroll:**
- When any WASD key is held: edge scroll ignored (WASD takes priority)
- When no WASD held: mouse within `EDGE_MARGIN` (20px) of screen edge → constant speed (400 px/s), no ramp

**Zoom:**
- Scroll wheel → step `_target_zoom`
- `Ctrl++` / `Ctrl+-` → step `_target_zoom` by fixed increment (0.25)
- Each frame: `camera.zoom = lerp(camera.zoom, _target_zoom, ZOOM_SPEED * delta)` — smooth for both scroll and keyboard
- Clamped to `[MIN_ZOOM, MAX_ZOOM]`

**Key methods:**
- `pan_to_province(province_id: String)` — lerp camera to province node position
- `pan_to_position(pos: Vector2)`
- `set_zoom(level: float)`
- `enable_edge_scroll(enabled: bool)`

---

## Phase C — Debug Scene

### New files
- `client/scenes/debug/map_debug.tscn`
- `client/src/debug/map_debug.gd`

### What it does
- Instantiates MapLoader, MapRenderer, MapInteraction, CameraSystem — no auth, no server, no SessionManager
- Calls `MapLoader.load_map("western_europe_6")` on `_ready()`
- Passes MapLoader as data source to MapRenderer
- HUD panel (top-left corner):
  - Province info on hover: name, nation, terrain_elevation, terrain_cover, vp_value
  - Overlay mode toggle buttons: Political / Elevation / Cover
  - Province count label

**How to launch:** Set `scenes/debug/map_debug.tscn` as main scene in Project Settings, or Scene → Run Specific Scene from editor.

---

## Module Wiring

```
MapLoader
  ──(map_loaded)──────────────→ MapRenderer.on_map_loaded()
  ──(map_loaded)──────────────→ MapInteraction.on_map_loaded()  [connects Area2D signals]

MapInteraction
  ──(province_clicked)────────→ MapRenderer.highlight_province()
  ──(province_hovered)────────→ DebugPanel.show_province_info()

EventBus
  ──(province_captured)───────→ MapRenderer.refresh_province()   [game mode only]

CameraSystem
  reads MapLoader.get_province_node()   [for pan_to_province]
  [input-driven internally]

MapDebug
  wires all four modules, bypasses auth/session entirely
```

---

## File Output Summary

**Pipeline output:**
```
client/assets/data/western_europe_6/
├── map_data.json
├── cover.geojson
├── elevation.geojson
├── terrain_lookup.json
├── rivers.geojson
├── roads.geojson
└── heightmap.tif
```

**Godot source:**
```
client/
├── scenes/
│   ├── systems/map/province.tscn
│   └── debug/map_debug.tscn
└── src/
    ├── systems/map/
    │   ├── map_loader.gd
    │   ├── map_renderer.gd
    │   ├── map_interaction.gd
    │   └── camera_system.gd
    └── debug/
        └── map_debug.gd
```

---

## Verification

1. `python map/tools/map_pipeline/pipeline.py --map europe_1938_6` → 89 provinces, adjacency edges, zero errors
2. Set `map_debug.tscn` as main scene, run Godot
3. Map fills viewport, provinces colored by nation
4. Hover province → info panel updates
5. Click province → highlights blue
6. WASD: slow start → ramps up → instant stop on release
7. W+D: moves northeast at same speed as W alone
8. Cursor at screen edge (no WASD): gentle constant scroll
9. Scroll wheel + Ctrl++/Ctrl+-: smooth zoom in/out
