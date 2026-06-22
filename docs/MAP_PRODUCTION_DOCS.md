# Map Production Docs

Reference doc for building game maps. Covers where to get source data, how to process it in QGIS,
and how it gets rendered in-game. Sections get filled in as we go.

---

## Data Sources

### Physical

From [Natural Earth — 10m Physical Vectors](https://www.naturalearthdata.com/downloads/10m-physical-vectors/)

| Layer | Link | Notes |
|---|---|---|
| Land | [ne_10m_land.zip](https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/physical/ne_10m_land.zip) | Landmass polygons |
| Ocean | [ne_10m_ocean.zip](https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/physical/ne_10m_ocean.zip) | Our base water / constraint layer |
| Rivers + lakes | [ne_10m_rivers_lake_centerlines_scale_rank.zip](https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/physical/ne_10m_rivers_lake_centerlines_scale_rank.zip) | Centerlines only, good enough for reference |

**Heightmap / elevation** (not on Natural Earth, separate sources):

| Source | Link | Notes |
|---|---|---|
| Copernicus EU-DEM (30m) | [files.gpxz.io/eudem_buffered.zip](https://files.gpxz.io/eudem_buffered.zip) | Best quality, Europe-focused, free |
| SRTM (90m) via OpenTopography | [opentopography.org](https://opentopography.org) | Coarser, draw-a-rectangle download, needs free API key |

**Vegetation / land cover** (forest, jungle, desert, tundra classification):

| Source | Link | Notes |
|---|---|---|
| Copernicus Global Land Cover 100m | [zenodo.org/records/3939038](https://zenodo.org/records/3939038) | Download only `Discrete-Classification-map` (1.7GB) + `Forest-Type-layer` (1.0GB). Skip the rest — they're fraction/probability layers we don't need |

### Cultural

From [Natural Earth — 10m Cultural Vectors](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/)

| Layer | Link | Notes |
|---|---|---|
| Countries | [ne_10m_admin_0_countries_lakes.zip](https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/cultural/ne_10m_admin_0_countries_lakes.zip) | Modern borders — reference only, not used for game provinces |
| Provinces | [ne_10m_admin_1_states_provinces_lakes.zip](https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/cultural/ne_10m_admin_1_states_provinces_lakes.zip) | Modern admin boundaries — useful as a structural reference, not historical |
| Populated places | [ne_10m_populated_places.zip](https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/cultural/ne_10m_populated_places.zip) | Cities as points |
| Roads | [ne_10m_roads.zip](https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/cultural/ne_10m_roads.zip) | Global coverage |
| Ports | [ne_10m_ports.zip](https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/cultural/ne_10m_ports.zip) | Useful for placing `buildings.port` candidates |
| Urban areas | [ne_10m_urban_areas.zip](https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/cultural/ne_10m_urban_areas.zip) | Urban footprint polygons |
| Historical borders (1939) | [icr.ethz.ch/data/cshapes](https://icr.ethz.ch/data/cshapes/) → direct GeoJSON: [CShapes-2.0.geojson](https://icr.ethz.ch/data/cshapes/CShapes-2.0.geojson) | **Reference only — CC BY-NC-SA license, cannot ship commercially.** Filter by `gwsdate`/`gweyear` to isolate 1939. Province polygons we draw on top are original work |

**Roads — actual usable road network** (since Natural Earth roads are NA-only):

| Source | How | Notes |
|---|---|---|
| OpenStreetMap via QuickOSM | QGIS plugin → Vector → QuickOSM → query `highway=motorway` / `highway=trunk` over canvas extent | Gets real vector road data, free, commercial-friendly (ODbL) |
| OpenStreetMap via Geofabrik | [download.geofabrik.de](https://download.geofabrik.de/europe.html) | Bulk regional `.osm.pbf` extracts if QuickOSM is too slow for large areas |
| OSM XYZ tile layer | QGIS Browser panel → XYZ Tiles → OpenStreetMap | Instant visual reference, not exportable, good for eyeballing while drawing |

---

## Map Preprocessing

All preprocessing is done in Python (OGR/GDAL/numpy) via numbered scripts in `scripts/`. The pipeline is deterministic and idempotent — re-run any script to rebuild from source.

---

### 1. Water Bodies (`scripts/01_base_water.py`)

Clip the NE ocean polygon to the map extent. From the NE rivers+lakes centerlines file, extract lake polygons with area > 0.05 deg² (~600 km²) — this keeps major lakes like Vänern and Lake Geneva while dropping small ones. The Black Sea, Caspian Sea, and Sea of Azov are classified as `water_type='sea'`; everything else as `lake` or `ocean`.

Output: `base_water.geojson` — the hard constraint layer. Every subsequent terrain layer is differenced against the full water union so land never overlaps water.

---

### 2. Terrain Cover (`scripts/02_prepare_rasters.py`, `03_terrain_classify.py`, `08_merge_urban.py`, `12_add_towns.py`)

**Source:** Copernicus PROBAV Global Land Cover raster (100m). Resampled to 0.05° using MODE (preserves the most common land cover code per cell).

**Critical preprocessing step:** PROBAV code 80 (permanent water bodies) is treated as nodata. Without this, the Mediterranean Sea gets classified as flat farmland — the same raster value as the Sahara — forming one giant connected polygon that breaks the coastline difference step.

**Classification rules (PROBAV code + latitude → cover_visual):**

| PROBAV code | Latitude rule | cover_visual |
|---|---|---|
| 40 (cropland) | — | farmland |
| 30 (herbaceous) | ≥ 35°N | grassland |
| 30 (herbaceous) | < 35°N | steppe |
| 20 (shrubland) | < 45°N | mediterranean_scrub |
| 20 (shrubland) | ≥ 45°N | heathland |
| 121–126 (open forest) | — | open_forest |
| 111–116 (closed forest) | ≥ 50°N | boreal_forest |
| 111–116 (closed forest) | 25–50°N | temperate_forest |
| 111–116 (closed forest) | < 25°N | jungle |
| 60–68 (bare/sparse) | < 35°N | hot_desert |
| 60–68 (bare/sparse) | ≥ 35°N | cold_desert |
| 90 (wetland) | ≥ 30°N | wetland |
| 90 (wetland) | < 30°N | mangrove |
| 100 (moss/lichen) | — | tundra |
| 70–72 (snow/ice) | — | glacier |
| 50 (urban) | — | urban |
| any valid, unmatched | — | farmland (fallback) |

Latitude is used alongside the PROBAV code because many codes mean different things in different climates (e.g. code-30 grassland in northern Europe vs semi-arid steppe in North Africa).

**Urban refinement:** The PROBAV-50 urban footprints are coarse raster blobs. They are replaced by NE 10m urban area polygons that intersect WE6 city points — these have real building footprint shapes. Existing cover features that overlap the new urban polygons are trimmed.

**Town classification:** Urban features without a WE6 city within 0.05° are reclassified as `town` (cover code 17). Additionally, NE urban areas with scalerank ≤ 4 that don't intersect any city are added as new `town` features. Both urban and town use `cover_combat='urban'` — the distinction is visual only.

---

### 3. Terrain Elevation (`scripts/02_prepare_rasters.py`, `03_terrain_classify.py`)

**Source:** Copernicus EU-DEM tiles (30m, EPSG:3035). Merged into a VRT, warped to EPSG:4326 at 0.005°.

Slope is computed with `gdaldem slope`, then resampled to 0.05° using MAX resampling — MAX preserves mountain peaks that would otherwise average away at coarser resolution.

**Classification:** slope ≤ 5° = flat, 5–20° = hills, > 20° = mountains.

---

### 4. Vectorization + Gap Fill (`scripts/04_vectorize.py`, `05_difference.py`, `13_fill_cover_gaps.py`, `14_subtract_water.py`, `15_clip_and_fill.py`)

Both rasters are vectorized at 0.05° resolution (one polygon per raster cell), dissolved by code, simplified by 0.01°, and small fragments (< 0.005 deg²) dropped.

The ocean + all lakes union is then subtracted from every terrain polygon via geometric difference. Results are exploded to singleparts — OGR's Difference() returns MULTIPOLYGON, and keeping it as one feature would create artifacts spanning the original bounding box.

Both layers are clipped to the province union boundary — no terrain features exist outside province polygons.

Residual gaps remain after all this (hairline seams where 0.05° raster grid edges don't align with vector province boundaries). These are filled province by province: for each gap polygon, find all cover/elevation features intersecting the same province and assign the type of whichever has the largest intersection area with the gap. Water body holes are explicitly skipped — lakes stay empty.

---

### 5. Roads (`scripts/11_rebuild_roads.py`, `16_fix_and_clip_roads.py`)

**Source:** NE 10m roads. Filter: `expressway = 1 OR scalerank ≤ 5`.

**road_level assignment:**
- Level 3 (highway): `expressway = 1` OR `scalerank ≤ 4`
- Level 2 (paved road): `scalerank = 5`

There is no level 1 in NE data — that would require OSM. The level distinction in NE is effectively binary: major highways vs significant national roads.

**6-step cleaning pipeline:**

1. **Filter + clip** — apply the expressway/scalerank filter, clip LineStrings to the map extent, explode MultiLineString to singleparts. ~1560 segments after this step.

2. **Endpoint snap (0.05°)** — build a spatial index of all segment endpoints. For each endpoint, find other endpoints from different segments within 0.05°. Union-find groups these into clusters; all endpoints in a cluster snap to the group representative's coordinates. This closes the topology gaps that prevent the network from connecting (NE roads have small gaps at administrative boundaries).

3. **Water crossing removal** — build the ocean union (non-lake water bodies). Remove any segment whose intersection with ocean exceeds 0.01° in length. This catches ferry routes and mislabelled roads that appear to cross the sea in source data.

4. **Dead-end snap (0.3°)** — a dead-end is a segment endpoint touched by only one segment (degree-1 node). If the nearest city or port is within 0.3°, snap the endpoint to that anchor's coordinates. This connects roads that stop just short of a settlement.

5. **Stub removal** — remove segments that are dead-ends on *both* ends (degree-1 at both endpoints). These are hanging stubs with no network value. Repeated up to 5 iterations until stable, since removing stubs can expose new stubs in chains.

6. **Isolated component removal** — build connected components (union-find on endpoints). Drop any entire component where no city or port is within 0.2° of any point on any segment in that component. Removes road clusters that float in the middle of nowhere with no settlement anchor.

**corridor_id** is assigned as `{nation_id}_{direction}`. Nation is determined by which province polygon contains the segment's midpoint (nearest centroid as fallback). Direction is the segment's dominant bearing, taken modulo 180° first (so NE and SW segments share the same corridor axis) then mapped to one of four labels: `n` (≤22.5° or ≥157.5°), `ne` (22.5–67.5°), `e` (67.5–112.5°), `se` (112.5–157.5°).

Finally, all roads are clipped to the province union so no segment extends outside province boundaries.

---

### 6. Ports and Cities (`scripts/09_port_city_merge.py`, `09b_snap_port_cities.py`, `10_dedup_ports.py`)

**Port-city merge:** For each port within 0.15° of a WE6 city, the port is removed and the city gains `has_port=True`. The city point is moved to the port's exact coordinates — which puts it on the coastline. Road endpoints that matched the old city coordinates are updated to follow. If multiple ports are within 0.15°, the nearest one is used for positioning; all matched ports are removed.

**Coastline snap:** After the above, any `has_port=True` city still more than 0.005° from the coastline is snapped to the nearest vertex on the ocean polygon boundary. This handles cases where a port was in an estuary or slightly offshore in the source data.

**Port deduplication:** The remaining ports (those not merged into a city) are deduplicated per province. Within each province, if two or more ports are within 0.3° of each other, only the one with the lowest port_id (earliest in the original Natural Earth selection) is kept. This removes redundant clusters like Rotterdam/Hook of Holland or Gdańsk/Gdynia that represent the same port complex.

### 7. Client Asset Build (`tools/map_pipeline/pipeline.py`)

Converts the finished GeoJSONs into files Godot and the server actually consume.

**Run:**
```bash
python map/tools/map_pipeline/pipeline.py --map europe_1938_6
python map/tools/map_pipeline/pipeline.py --map europe_1938_6 --skip-dem   # skip heightmap regen
```

**Input:** `map/{map_dir}/` — all GeoJSONs, `terrain_lookup.json`, `map.json`

**Output:** `client/assets/data/{map_id}/`

**Steps:**

1. **Validate** — runs schema checks on all source files before touching anything. Any failure exits immediately.

2. **Build provinces** — for each province polygon: simplify with Shapely (tolerance from `map.json`, default `0.001°` ≈ 100m), fix invalid geometry with `buffer(0)`, keep exterior rings only, round to 6 decimal places. Merges `has_port` from `cities.geojson`. Reconstructs nested `buildings` and `resources` dicts from the flat QGIS field names (`bld_fort`, `res_steel`, etc.).

3. **Build adjacency** — O(n²) province pairs with bounding-box pre-filter. Shared border detected via Shapely `intersection()`, linear parts only. Border type priority: river (intersects major river) > coast (intersects water boundary) > open. Finds highest `road_level` crossing each border.

4. **Write `map_data.json`** — provinces + adjacency in compact JSON (no whitespace).

5. **Copy passthrough files** — `cover`, `elevation`, `base_water`, `rivers`, `roads` GeoJSONs are renamed `.json` and copied unchanged. `terrain_lookup.json` is copied as-is. These are for Godot visual rendering; the server never reads them.

6. **Generate waypoints** — three-tier graph written to `waypoints.json` (coarse, client A*) and `waypoints_terrain.json` (fine, server):
   - *Road graph:* sample road LineStrings at `0.007°` intervals (~750m), deduplicate, link consecutive samples per road.
   - *Coarse terrain grid:* non-uniform spacing based on terrain type (see table); connects to road nodes within `0.11°`.
   - *Fine terrain grid:* uniform `0.07°` grid, server-only, written to separate file.

   | Terrain complexity | Grid spacing |
   |---|---|
   | Open (plains, steppe, desert, tundra) | 0.20° (~22 km) |
   | Medium (light forest, shrubland, hills) | 0.10° (~11 km) |
   | Complex (dense forest, jungle, urban, mountains) | 0.07° (~7.5 km) |

7. **Build heightmap** — finds EU-DEM tiles overlapping map bounds, mosaics, reprojects to WGS84, clips to bounds, writes `heightmap.tif` at 2048px wide (height preserves aspect ratio). Uses deflate compression.

---

## Map Rendering

All rendering happens in `client/src/systems/map/`. Entry point is `MapLoader.load_map(map_id)`.

---

### Coordinate Projection

All JSON files use WGS84 (lng/lat). MapLoader projects to a 4096×3000px Godot canvas using Web Mercator:

```
x = lng × π/180
y = ln(tan(π/4 + lat × π/360))
```

Both axes are then centered and scaled to fit the map bounds onto the canvas. Y is negated (GDScript +Y is down).

---

### Layer Stack

Layers render in this order (earlier = further back):

| Layer | Source file | Godot node | Visibility |
|---|---|---|---|
| Water | `base_water.json` | Polygon2D | Always |
| Province fill | `map_data.json` | Polygon2D | Always |
| Province border | `map_data.json` | Line2D | Always |
| Cover overlay | `cover.json` | Polygon2D | "Cover" mode only |
| Elevation overlay | `elevation.json` | Polygon2D | "Elevation" mode only |
| Rivers | `rivers.json` | Line2D | Always |
| Roads | `roads.json` | Line2D | Always |
| Division icons | game state | DivisionIcon scene | Always |
| City markers | `map_data.json` | Polygon2D | Zoom ≥ 0.6 |
| Nation labels | derived (BFS) | Label | Zoom < 0.6, political mode |

---

### Province Nodes

Each province instantiates `scenes/systems/map/province.tscn`:

```
ProvinceNode (Node2D)
  ├─ Fill (Polygon2D)          — main coloured fill
  ├─ Border (Line2D)           — outline
  ├─ Clickbox (Area2D)         — mouse input
  │   └─ Shape (CollisionPolygon2D)
  ├─ CityLabel (Label)
  └─ UnitAnchor (Node2D)       — division icon attach point
```

Islands and multi-polygon provinces get an extra Polygon2D + Area2D + CollisionPolygon2D per additional ring. In political mode, province color is keyed by `nation_id` via MapRenderer's palette (26 nation colors, gray fallback).

---

### Overlay Coloring

`MapRenderer.set_overlay_mode("political"|"elevation"|"cover")` shows/hides the two overlay layers. Province fill opacity is unchanged — overlays sit on top.

**Cover** (alpha 0.7, keyed by `cover_visual`):
- farmland → tan `(0.76, 0.70, 0.50)`
- grassland → light green `(0.65, 0.80, 0.45)`
- forest variants → dark green `(0.35, 0.50, 0.25)`
- desert variants → sand / cool gray
- urban → gray `(0.55, 0.55, 0.60)` / town slightly warmer

**Elevation** (alpha 0.7, keyed by `elev_type`):
- flat → `(0.70, 0.85, 0.60)`
- hills → `(0.55, 0.70, 0.35)`
- mountains → `(0.60, 0.50, 0.40)`

---

### Linear Features

**Rivers** (`rivers.json`) — Line2D, color `(0.2, 0.5, 0.9, 0.8)`:
- major → 3px, minor → 2px, stream → 1px

**Roads** (`roads.json`) — Line2D, color `(0.6, 0.4, 0.2, 0.9)`:
- level 3 (highway) → 2px, level 2 (paved) → 1px

---

### Waypoint Pathfinding

`waypoints.json` is loaded by MilitarySystem. Pathfinder runs a two-phase bidirectional A*:

1. If the unit is off-road, find the nearest road entry node first.
2. Full A* search across the combined road + terrain graph.

Edge cost formulas:
- **Road edge:** `0.05 × distance_deg × river_penalty × road_multiplier`
- **Off-road edge:** `distance_deg × base_cost × terrain_profile_cost × river_penalty`

River crossing penalties by size: none → 1.0, stream → 1.8, minor → 3.0, major → 4.5.

`terrain_profile_cost` comes from the division's movement profile (infantry vs armour vs motorised, etc.).

Post-search string-pulling removes collinear waypoints.

---

### Heightmap

`heightmap.tif` is present in `client/assets/data/{map_id}/` but not yet consumed by the renderer. Reserved for future terrain shading.
