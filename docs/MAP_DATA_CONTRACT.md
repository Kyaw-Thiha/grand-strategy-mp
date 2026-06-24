# Grand Strategy Multiplayer — Map Data Contract

> Defines all map layers, data schemas, authoring workflow (QGIS), pipeline, and Godot import.
> Feed this file to Claude Code alongside ARCHITECTURE.md when working on any map, pipeline, or rendering system.
> Last updated: May 2026.

---

## Design Philosophy

Maps use **large provinces** — not HoI4's hundreds of small provinces but meaningful strategic regions
each containing a main city, varied terrain, and one or more road connections. A Europe map has
roughly 80–150 provinces total. This keeps the game readable and sessions completable in 1–4 hours.

The map is composed of seven distinct layers. Each layer has a single responsibility.
No layer duplicates data owned by another layer. The server only ever reads processed JSON.
The terrain raster and heightmap are client-side only.

---

## The Six Layers

```
[6] Province layer        — vector polygons. What players own and fight over.
[5] Road network layer    — vector lines. Supply arteries + fast movement corridors.
[4] River network layer   — vector lines. Natural barriers, inform adjacency costs.
[3] Cover layer           — vector polygons. Vegetation/land-use. cover_visual (rendering) + cover_combat (mechanics).
[2] Elevation layer       — vector polygons. Slope-derived height bands: flat | hills | mountains.
[1] Base water layer      — vector polygons. Oceans, seas, and large lakes. Hard constraint — nothing crosses it.
```

Plus two raster inputs used only during authoring and rendering, never by the server:

```
DEM raster (SRTM/Copernicus)  — elevation source for terrain classification and heightmap export
Heightmap export (GeoTIFF)    — sent to Godot for terrain shading and visual rendering
```

---

## Layer 1 — Base Water

**Purpose:** Defines ocean and sea polygons. The constraint layer everything else must respect.
Provinces cannot overlap it. Roads cannot cross it unless an explicit strait crossing is tagged.
Rivers terminate at it.

**Format:** `base_water.geojson`

```json
{
  "type": "Feature",
  "geometry": { "type": "Polygon", "coordinates": [[...]] },
  "properties": {
    "water_id":   "north_sea",
    "name":       "North Sea",
    "water_type": "sea"         // "sea" | "ocean" | "lake" (large lakes only)
  }
}
```

**Strait crossings** are tagged as adjacency edges (see Adjacency section) with
`border_type: "strait"`. The English Channel, Bosphorus, and Gibraltar are examples.
Naval movement across straits is governed by the adjacency entry, not by the water polygon.

---

## Layer 2 — Elevation + Cover (Two-Layer Terrain System)

**Purpose:** Defines terrain across the map as two composable layers. Elevation drives defense and
movement penalties. Cover drives vegetation/land-use combat modifiers. Both are used by Godot for
visual rendering; province-level dominant values are pre-computed for O(1) mechanics queries.

**Source:** Copernicus DEM raster → slope analysis → elevation polygons; PROBAV land-cover raster → cover polygons.

---

### Layer 2a — Elevation

**Format:** `elevation.geojson`

```json
{
  "type": "Feature",
  "geometry": { "type": "Polygon", "coordinates": [[...]] },
  "properties": {
    "elevation_type": "hills",   // "flat" | "hills" | "mountains"  (gap-fill features use this field)
    "elev_type":      "hills",   // same values — original pipeline features use this field
    "elev_code":      2          // 1=flat, 2=hills, 3=mountains, 0=pipeline gap-fill
  }
}
```

Note: `elev_type` and `elevation_type` are the same field split across pipeline stages — treat identically.

**Elevation off-road movement modifiers:**

| elevation_type | Move multiplier | Defense bonus |
|---|---|---|
| `flat`      | 1.0× | 0 |
| `hills`     | 0.7× | +20% |
| `mountains` | 0.4× | +40% |

---

### Layer 2b — Cover

**Format:** `cover.geojson`

```json
{
  "type": "Feature",
  "geometry": { "type": "Polygon", "coordinates": [[...]] },
  "properties": {
    "cover_visual":  "boreal_forest",   // 17 visual types — used for rendering
    "cover_combat":  "dense_forest",    // 11 combat groups — used for mechanics
    "cover_code":    7                  // integer code; 0 = pipeline gap-fill cell
  }
}
```

**cover_visual → cover_combat mapping** is defined in `terrain_lookup.json["cover_combat"]`.
Load at startup. **Do not hardcode** this mapping in Godot — read from the JSON.

**Cover visual types (17):** `farmland`, `grassland`, `steppe`, `mediterranean_scrub`, `heathland`,
`open_forest`, `boreal_forest`, `temperate_forest`, `jungle`, `hot_desert`, `cold_desert`,
`wetland`, `mangrove`, `tundra`, `glacier`, `urban`, `town`

**Cover combat groups and movement modifiers (11):**

| cover_combat | Move multiplier | Attack penalty | Defense bonus |
|---|---|---|---|
| `plains`       | 1.0× | 0 | 0 |
| `steppe`       | 1.1× | 0 | 0 |
| `shrubland`    | 0.85× | 0 | +5% |
| `light_forest` | 0.75× | −5% | +10% |
| `dense_forest` | 0.6× | −10% | +15% |
| `jungle`       | 0.35× | −20% | +10% |
| `desert`       | 0.6× | 0 | 0 |
| `swamp`        | 0.3× | −15% | +5% |
| `tundra`       | 0.5× | −5% | 0 |
| `glacier`      | 0.2× | −30% | 0 |
| `urban`        | 0.8× | −15% | +30% |

Note: `town` maps to `urban` combat group. Both use the same mechanics.

**Tactical combat unit-type constraints by cover_combat (summary — full detail in
TACTICAL_COMBAT.md):**

| cover_combat | Armour off-road | Armour column flanking | Notes |
|---|---|---|---|
| `plains` / `steppe` | Passable | Bonus | Armour and artillery gain tactical bonuses |
| `shrubland` | Passable | Normal | No unit-type restrictions |
| `light_forest` | Passable | Penalised | AT and infantry gain stealth/ambush bonuses |
| `dense_forest` | **Impassable** | **Disabled** | Armour cannot enter; flanking blocked for all |
| `jungle` | **Impassable** (incl. on road for tactical) | — | Armour cannot participate in jungle engagements |
| `desert` | Passable | Bonus | Armour mobility bonus; infantry lose cover |
| `swamp` | **Impassable** off-road | — | Road-only for armour |
| `tundra` | Passable (degraded) | Normal | Standard penalties apply |
| `glacier` | **Impassable** off-road | — | Road-only for all heavy units |
| `urban` | Passable | **Disabled** | Streets prevent column shift flanking |

---

### terrain_lookup.json

Reference file mapping integer codes to strings and visual types to combat groups:

```json
{
  "elev_map":     { "1": "flat", "2": "hills", "3": "mountains" },
  "cover_map":    { "1": "farmland", ..., "16": "urban", "17": "town" },
  "cover_combat": { "farmland": "plains", "boreal_forest": "dense_forest", "town": "urban", ... }
}
```

---

### Composable modifiers (runtime computation)

```
movement_cost  = base × elevation_move[province.terrain_elevation] × cover_move[cover_combat]
attack_penalty = elevation_atk[province.terrain_elevation]         + cover_atk[cover_combat]
defense_bonus  = elevation_def[province.terrain_elevation]         + cover_def[cover_combat]
```

`cover_combat` is derived from `province.terrain_cover` via `terrain_lookup.json["cover_combat"]`
at load time. Province-level fields (`terrain_elevation`, `terrain_cover`) are used for all
mechanics — cell layers are rendering only.

**Tactical combat terrain query:**
When tactical combat initiates, the server samples the **defender's province** for terrain
modifiers using the O(1) province-level fields. No per-pixel sampling occurs at runtime.

```
defender_terrain = provinces[defender_province_id].terrain_elevation
                 + provinces[defender_province_id].terrain_cover  →  cover_combat group

attacker_penalty = attack_penalty(defender_terrain)   // attacker attacks into defender's ground
defender_bonus   = defense_bonus(defender_terrain)    // defender holds their own ground
```

**Transition modifier** (applied to attacker_penalty):
The attacker's own terrain is also checked to apply a secondary modifier:

| Attacker terrain vs defender terrain | Modifier to attacker_penalty |
|---|---|
| Attacker terrain tier **worse** than defender | Full penalty (1.0×) |
| Attacker terrain tier **same** as defender | Reduced penalty (~0.5× — attacker not at disadvantage) |
| Attacker terrain tier **better** (elevation advantage) | Further reduced penalty (~0.25×) |

Tier ordering: `flat < hills < mountains` for elevation;
`plains/steppe < shrubland < light_forest/urban < dense_forest < jungle/swamp` for cover.

This is a 3-value lookup computed at combat initiation, not a full combinatorial matrix.

---

**QGIS / pipeline authoring notes:**
- Elevation: slope raster → classify slope < 5° = flat, 5–20° = hills, > 20° = mountains → vectorise → ocean difference → province clip
- Cover: PROBAV land-cover raster → classify codes → vectorise → urban merge → ocean difference → province clip → gap fill
- Both layers are clipped to province union; holes exist where water bodies (ocean + lakes) are
- `cover_code = 0` and `elev_code = 0` mark gap-fill cells added by the pipeline — mechanically valid, do not filter them out

---

## Layer 3 — River Network

**Purpose:** Rivers are natural province borders and crossing barriers. They inform adjacency
`border_type` values during the pipeline build step. In Godot they are rendered as visual lines.

**Format:** `rivers.geojson`

```json
{
  "type": "Feature",
  "geometry": { "type": "LineString", "coordinates": [[...]] },
  "properties": {
    "river_id":   "eur_river_rhine",
    "name":       "Rhine",
    "river_size": "major",        // "major" | "minor"
    "map_id":     "europe_1939"
  }
}
```

Major rivers impose a crossing penalty on any adjacency edge they intersect.
The pipeline detects river intersections with province borders automatically and sets
`border_type: "river"` on the relevant adjacency edges.

Rivers are used by Godot for visual rendering only. The server never reads `rivers.geojson`
for supply or movement — the river crossing information is already encoded in adjacency edge
`border_type` values.

**Tactical combat river crossing penalty:**
The tactical combat system reads `rivers.geojson` directly at combat initiation to check
whether the line segment between the two division centres intersects a river LineString.
If it does, a crossing penalty applies to the **attacker only** for the opening rounds:

| river_size | Suppression resistance penalty | HP damage penalty | Duration |
|---|---|---|---|
| `minor` | −15% suppression resistance | −10% HP damage dealt | Rounds 1–2 only |
| `major` | −30% suppression resistance | −25% HP damage dealt | Rounds 1–3 |

The check is performed once at combat initiation, not every round. The penalty fades
automatically after the specified number of rounds regardless of combat state — troops have
completed the crossing and reformed on the far bank. This models the historical reality
that the crossing itself is the dangerous moment, not the fighting once troops are across.

This is the only case where the server reads river geometry directly. All other river
mechanics (movement cost, supply) use the adjacency `border_type` values.

**Sources:** OSM waterways via Geofabrik. Filter to `waterway=river` and `waterway=canal`.
Cross-reference against 1938/1939 historical maps — most major rivers are unchanged.

---

## Layer 4 — Road Network

**Purpose:** Strategic movement corridors and the exclusive supply network.
Only major arteries are included — highways, key national roads, main rail lines.
Local roads and tracks are NOT on this layer; local connectivity is captured by
`province.infrastructure` instead.

**Format:** `roads.geojson`

```json
{
  "type": "Feature",
  "geometry": { "type": "LineString", "coordinates": [[...]] },
  "properties": {
    "road_id":      "eur_road_autobahn_a1",
    "corridor_id":  "autobahn_a1",           // groups segments for corridor upgrades
    "name":         "Autobahn A1",
    "road_level":   3,                        // 1=dirt track, 2=paved road, 3=highway
    "map_id":       "europe_1939"
  }
}
```

**Road levels and movement:**

| road_level | Name | On-road speed | Supply throughput |
|---|---|---|---|
| 1 | Dirt track | 1.5× base | Low |
| 2 | Paved road | 2.5× base | Medium |
| 3 | Highway | 4.0× base | High |

**Corridor upgrades:** Roads are upgraded at corridor level, not segment level.
All segments sharing a `corridor_id` upgrade together when the player invests in that corridor.
This prevents per-segment micromanagement while preserving meaningful strategic investment.
A Europe map should have 15–30 named corridors. Each corridor = one upgrade decision.

**Supply flows exclusively along roads.** Off-road movement produces no supply flow.
A division that advances off-road immediately begins drawing down its carried supply reserves.

**QGIS authoring steps:**
1. Load OSM roads layer (Geofabrik extract, filter to motorway, trunk, primary)
2. Load OSM railways layer (cross-reference — major rail = road_level 2 for supply purposes)
3. Manually trace and simplify onto the road layer, snapping endpoints to province borders
4. Assign corridor_id by grouping connected segments that form a strategic axis
5. Set road_level by historical classification (Autobahn = 3, Route Nationale = 2, etc.)
6. Export as `roads.geojson`

---

## Layer 5 — Province Layer

**Purpose:** The primary game layer. Defines what players own, fight over, and manage.
Each province contains exactly one city which is the capture point for ownership.

**Format:** `provinces.geojson`

```json
{
  "type": "Feature",
  "geometry": { "type": "Polygon", "coordinates": [[...]] },
  "properties": {
    "province_id":  "eur_france_01",
    "name":         "Île-de-France",
    "map_id":       "europe_1939",
    "nation_id":    "france",
    "is_capital":   true,
    "is_core":      ["france"],

    "city": {
      "name":     "Paris",
      "position": [2.3522, 48.8566]
    },

    "population":     80,
    "industry":       60,
    "infrastructure": 70,

    "buildings": {
      "fort":       0,
      "port":       0,
      "airbase":    0,
      "supply_hub": 1,
      "factory":    2
    },

    "resources": {
      "money":     0,
      "grain":     30,
      "iron":      20,
      "oil":       0,
      "rubber":    0,
      "nitrates":  0,
      "tungsten":  0,
      "chromium":  0,
      "aluminium": 0,
      "uranium":   0
    },

    "vp_value":     3,
    "is_objective": true,
    "notes":        ""
  }
}
```

### Field Reference

**Identity**

| Field | Type | Description |
|---|---|---|
| `province_id` | string | Globally unique, stable forever. Format: `{map_id_short}_{nation_id}_{index}`. Never reassign. |
| `name` | string | Display name shown in UI |
| `map_id` | string | Which map this province belongs to |
| `nation_id` | string | Nation that owns this province at game start |
| `is_capital` | bool | Is this the nation's capital province? |
| `is_core` | string[] | Nation IDs with historical claim. Affects diplomacy and manpower |

**City**

The city is the capture point. Whoever controls the city controls the province.
It is also the anchor for unit stack icons, building icons, and province labels in Godot.

| Field | Type | Description |
|---|---|---|
| `city.name` | string | Display name of the main city |
| `city.position` | [lng, lat] | Godot renders unit stacks and labels here |

**Economy**

All values are 0–100 relative scales, not absolute numbers. The server applies
multipliers from config to produce actual per-tick output.

| Field | Type | Description |
|---|---|---|
| `population` | int 0–100 | Per-province population stock. Grows over the session (rate set by config, accelerated by Grain Farm / Infrastructure buildings — see ECONOMY_BUILDINGS.md). Manpower for unit recruitment is derived from this value, not tracked as a separate field — see RESOURCE_ECONOMY.md, Population and Manpower. Also feeds end-of-session VP weighting: effective VP contribution scales with `vp_value` × population reached, not `vp_value` alone. |
| `industry` | int 0–100 | Multiplier layer on top of resource-extraction building output and local money production. Every extraction building produces its full base-tier output with zero industry allocated — industry is purely additive upside, fed by the national Industry Pool (see ECONOMY_BUILDINGS.md), not a precondition for baseline output. Affected by bombing. |
| `infrastructure` | int 0–100 | Two roles: (1) economic growth multiplier for the province; (2) off-road movement speed modifier for divisions moving through or out of this province. High infra = faster local movement even off-road. Does NOT define road quality — that is the road network layer. |

**Buildings**

Starting state only. All values begin at 0 unless set during map authoring.
Players build and upgrade during the game. Maximum level for all buildings is 5.

This list covers the strategic-layer/military buildings defined directly in this
contract. Civilian buildings (School, Hospital, Infrastructure perk tree, Warehouse/
Depot, Shipyard, Town Hall) and resource extraction/processing buildings (one per
resource in the Resources section below) are defined in full, including their research
perk trees, in ECONOMY_BUILDINGS.md — not restated here. Both sets of buildings share
this same `buildings` object and the same 0–5 level cap; ECONOMY_BUILDINGS.md does not
introduce a second building-storage mechanism.

| Building | Effect |
|---|---|
| `fort` | Increases defender strength and organisation recovery rate |
| `port` | Enables naval access and coastal supply. Province must border base_water or strait |
| `airbase` | Enables air unit operations from this province |
| `supply_hub` | Generates supply flow outward into the road graph. Primary supply source |
| `factory` | Feeds the national Industry Pool (see ECONOMY_BUILDINGS.md) and increases unit production speed. Does not directly multiply any single province's resource output — industry is a national pool, not a per-province effect |

**Resources**

Envelope is fixed: ten keys, replacing the prior five-key placeholder
(`manpower, steel, oil, fuel, coal`). All values are 0–100 relative abundance scales —
the amount a province can extract before any building or industry multiplier is applied.
Full mechanic definition for every resource (which of them are common-tier vs.
restricted-tier, and each restricted resource's distinct mechanical shape — rate
modifier, stat-table shift, or hard draw-block) is in RESOURCE_ECONOMY.md, not here.
This contract only fixes the schema.

```json
"resources": {
  "money":     0,
  "grain":     0,
  "iron":      0,
  "oil":       0,
  "rubber":    0,
  "nitrates":  0,
  "tungsten":  0,
  "chromium":  0,
  "aluminium": 0,
  "uranium":   0
}
```

`money` at the province level represents passive local trade/tax abundance feeding
national money income (boosted further by port-city trade activity — see
RESOURCE_ECONOMY.md), not a province-level spendable balance. `grain` and `iron` are the
common-tier resources every nation has meaningful baseline access to. The remaining
seven are restricted-tier and are expected to be sparse/zero on most provinces by
design — see RESOURCE_ECONOMY.md for how each one's scarcity is meant to feel distinct
from the others.

**Victory**

| Field | Type | Description |
|---|---|---|
| `vp_value` | int 0–5 | 0 = not a victory point. 1–5 = strategic weight for win condition scoring |
| `is_objective` | bool | Named objective shown on map. Paris, Berlin, Moscow etc. |
| `terrain_elevation` | string | Dominant elevation type: `flat \| hills \| mountains`. Pre-computed from raster pipeline — do not hand-edit. Used for O(1) mechanics queries. |
| `terrain_cover` | string | Dominant cover_visual type across the province (e.g. `boreal_forest`, `farmland`). Pre-computed. Derive combat group via `terrain_lookup.json["cover_combat"]` at load time. |

**province_id naming convention:**
```
eur_france_01     europe map, France, first province
eur_germany_02    europe map, Germany, second province
asia_japan_01     asia map, Japan, first province
```

Index is assigned sequentially when the province is created and never changes.
If a province is deleted, its ID is retired — never reused.

---

## Layer 6 — City Points

```
File:     cities.geojson
Geometry: Point  (one per province, at city_lng / city_lat)
CRS:      EPSG:4326
```

### Schema

| Field | Type | Example | Notes |
|---|---|---|---|
| `city_id` | String | `"city_001"` | Sequential, never reused |
| `province_id` | String | `"we6_france_03"` | FK → provinces.province_id |
| `nation_id` | String | `"france"` | Slug, same as parent province |
| `city_name` | String | `"Paris"` | Display name |
| `is_capital` | Boolean | `true` | True = national capital |
| `has_port` | Boolean | `true` | True if a port point was merged into this city during the pipeline. The city point is snapped to the coastline. This city acts as both a city and a naval access point. |
| `map_id` | String | `"western_europe_6"` | Map scope slug |

### Gameplay mechanic

Whoever controls the **city point** controls the parent province.

- Province resources (`res_*`, `industry`) accrue to the controller of the city.
- Losing the city = losing the province, even if the province polygon is otherwise surrounded by friendly units.
- Capturing an enemy city captures the province (and all its resource income).
- `is_capital = true` marks the nation's capital city — losing it applies a national morale penalty (exact value defined in game rules, not here).

### Authoring notes

- Exactly **one city per province** — no provinces without a city.
- City position is inherited from `ne_10m_populated_places`, selected by:
  1. National capital (`ADM0CAP = 1`) inside the polygon
  2. Highest `POP_MAX` inside the polygon
  3. Nearest populated place within 0.75° of the province centroid
  4. Polygon centroid (fallback only)
- `is_capital` is set by matching `city_name` against the known national capitals list (not derived from province attributes).
- Do not move city points manually — they are regenerated from the province pipeline.

---

## Layer 7 — Ports

```
File:     ports.geojson
Geometry: Point (snapped to coastline boundary)
CRS:      EPSG:4326
Source:   ne_10m_ports (Natural Earth), clipped to map extent
```

### Schema

| Field | Type | Example | Notes |
|---|---|---|---|
| `port_id` | String | `"port_001"` | Sequential |
| `name` | String | `"Rotterdam"` | From Natural Earth |
| `map_id` | String | `"western_europe_6"` | Map scope slug |

### Gameplay mechanic

- Ports are **sea-access nodes** on the coastline.
- A province that contains a port allows naval embark/disembark.
- Ports count as **anchor points** for road connectivity — a road segment touching a port is considered "anchored" and is not removed as an isolate.
- Controlling a port province gives sea-trade income (modifier defined in game rules).

### Authoring notes

- Points are snapped to the nearest position on the `base_water` polygon boundary, ensuring every port sits exactly on the coast.
- Source data has ~266 ports within the Western Europe extent. No manual curation applied.
- Do not move port points manually — regenerate from ne_10m_ports if needed.

---

## Adjacency Contract

Adjacency is a **separate file** from provinces. It encodes the crossing properties of every
shared border between two provinces. This is the data structure the server uses for:
- Movement validation (is this path legal for this unit type?)
- Supply graph (road_level on each edge = throughput capacity)
- Pathfinding cost lookup (client-side A* uses these edge weights)

**Format:** `adjacency.geojson`

```json
{
  "type": "Feature",
  "geometry": { "type": "LineString", "coordinates": [[...]] },
  "properties": {
    "from_province":  "eur_france_01",
    "to_province":    "eur_germany_02",

    "road_id":        "eur_road_autobahn_a1",
    "road_level":     3,

    "border_type":    "river",
    "passable_by":    ["infantry", "armor", "motorized", "artillery"],

    "map_id":         "europe_1939"
  }
}
```

**Adjacency is undirected.** `from_province` and `to_province` are just labels — the edge
applies equally in both directions. The pipeline generates one entry per shared border.

**`road_id` and `road_level`** are null if no strategic road crosses this border.
A border with no road can still be crossed off-road if terrain permits.

**`border_type` values:**

| border_type | Description | Default crossing modifier |
|---|---|---|
| `open` | No special feature | 1.0× |
| `river` | River crossing | 1.6× (off-road); roads cross at 1.0× via bridge |
| `mountain_pass` | Tagged narrow pass through mountains | 2.0× infantry; others impassable |
| `coast` | Coastal border (land meets water) | 1.0× |
| `strait` | Water crossing with explicit crossing point | Naval/amphibious only unless bridged |

**`passable_by`** lists unit types that can cross this border **off-road**.
On-road crossing is always available if `road_level` is non-null, for all unit types.
Mountain and jungle borders default to infantry-only off-road unless a pass is tagged.

**Movement cost computation (server-side, runtime):**

```
on_road_cost  = 1.0  (road_level governs speed, not cost)
offroad_cost  = border_type_penalty
              × destination_province.infrastructure_modifier
              × destination_terrain.terrain_type_multiplier
```

Infrastructure and terrain type are looked up at runtime — not baked into the adjacency edge —
so that bombing, upgrades, and supply state affect movement without re-baking map data.

**Pipeline auto-generation:**
The Python pipeline auto-generates adjacency entries by:
1. Finding all shared edges between province polygons (via Shapely intersection)
2. Checking river layer for intersections → sets `border_type: "river"`
3. Checking road layer for intersections → sets `road_id` and `road_level`
4. Checking terrain layer at the border midpoint → informs `passable_by` defaults
5. Checking base_water for any border touching water → sets `border_type: "coast"`

Human review in QGIS is required for: mountain passes (must be manually tagged),
strait crossings (must be manually added), and any border the pipeline classifies incorrectly.

---

## Province Infrastructure vs Road Network — Distinction

This is a common confusion point. The rule is simple:

| Concern | Where it lives | What it affects |
|---|---|---|
| Strategic road quality | `road_network` layer → `road_level` | On-road movement speed, supply throughput |
| Road upgrades | `corridor_id` grouping | Player invests in a corridor, all segments upgrade |
| Local connectivity | `province.infrastructure` | Economic growth rate, off-road movement speed modifier |
| Bombing effect | `province.infrastructure` reduced by server | Slows economy AND local off-road movement |

A province with `infrastructure: 80` and no road through it is economically productive and
easy to traverse off-road — but useless for supply and slow for on-road movement.
A province with `infrastructure: 20` but a highway through it has fast on-road movement
and high supply capacity — but poor economy and slow off-road flanking.

---

## Heightmap and Visual Terrain Rendering

The DEM raster serves double duty:

**In QGIS (build time):**
- Source data for terrain classification (slope analysis → terrain vector polygons)
- Visual reference when drawing province borders (follow ridgelines, valleys)

**In Godot (runtime):**
- Loaded as a GeoTIFF texture alongside the map
- Used for terrain shading: elevation → surface normal → directional light shading
- Creates the physical relief feel of a WW2-era topographic map

The heightmap is **never read by the server**. It is client-side rendering data only.

**Export from QGIS:**
Raster → Save As → GeoTIFF, clipped to map bounds, resolution sufficient for the target
render resolution (256×256 per province is a reasonable starting point for a Europe map).

---

## Waypoints Graph — waypoints.json

**Purpose:** Pre-baked off-road navigation graph used by the client for A* pathfinding.
Generated by the pipeline from terrain rasters. Never hand-edited.

**Format:** `waypoints.json`

```json
{
  "nodes": [
    {
      "id": "wp_0042",
      "lng": 6.12,
      "lat": 50.77,
      "cover_combat": "light_forest",
      "elevation": "hills"
    }
  ],
  "edges": [
    {
      "from": "wp_0042",
      "to": "wp_0043",
      "base_cost": 1.31,
      "river_size": null
    },
    {
      "from": "wp_0099",
      "to": "wp_0100",
      "base_cost": 2.4,
      "river_size": "major"
    }
  ],
  "road_connections": [
    {
      "road_node_id": "road_junction_A1_NL",
      "waypoint_id": "wp_0042"
    }
  ]
}
```

**base_cost** is the raw composable terrain cost: `cover_move × elevation_move` from the
MAP_DATA_CONTRACT composable modifiers table. It is unit-type agnostic — the division's
movement profile multiplier is applied at pathfinding time, not baked into the graph.

**river_size** is non-null only on edges that cross a river LineString. The edge receives
a crossing penalty multiplier at pathfinding time proportional to river_size (minor/major).

**road_connections** links road graph endpoints (from roads.geojson) to their nearest
waypoint node, enabling seamless transition between on-road and off-road pathfinding in
a single unified A* search.

**Pipeline generation:**
```python
# Pseudocode for waypoint generation step
interval_m = 750  # sample every ~750 metres
for lng, lat in grid_sample(map_bounds, interval_m):
    cover = sample_raster(cover_raster, lng, lat)
    elev  = sample_raster(elevation_raster, lng, lat)
    if not is_water(lng, lat):
        nodes.append(WaypointNode(lng, lat, cover_combat[cover], elev))

for node_a, node_b in neighbour_pairs(nodes, max_distance=interval_m * 1.5):
    base_cost = cover_move[node_a.cover] * elevation_move[node_a.elevation]
    river = check_river_crossing(node_a, node_b, rivers_geojson)
    edges.append(WaypointEdge(node_a, node_b, base_cost, river))

for road_endpoint in road_graph.endpoints():
    nearest_wp = nearest_node(nodes, road_endpoint.position)
    road_connections.append((road_endpoint.id, nearest_wp.id))
```

The graph is rebuilt from scratch any time the terrain or road layers are re-exported.
It is never edited by hand. The `godot/assets/data/` folder is always derived output.

---

## Pathfinding Architecture

Pathfinding is **client-side**. The server validates, not computes.

**Two-level unified graph:**

```
Player draws advance axis (macro) or selects move target (micro)
        ↓
Client runs A* over the unified road + waypoint graph:
  - Road edges (from roads.geojson graph):
      cost = road_base_cost (very low; road_level governs animation speed)
  - Waypoint edges (from waypoints.json):
      cost = edge.base_cost × division.movement_profile[edge.cover_combat][edge.elevation]
      if movement_profile value == infinity: edge excluded (impassable terrain)
  - River-crossing waypoint edges:
      cost += river_crossing_penalty[edge.river_size]
        ↓
Road edges naturally win A* competition due to dramatically lower cost.
Off-road routes only win when no road path exists or player draws through off-road terrain.
        ↓
Client sends ordered list of waypoint/road node IDs to server via MOVE_UNIT command
        ↓
Server validates:
  1. Each consecutive pair is a valid graph edge
  2. Division movement profile permits traversal of each edge terrain
  3. No enemy unit blocks the path (unless attack order)
        ↓
Server executes movement, broadcasts state delta to all clients
```

**Division movement profile** is pre-computed from the template at save time and cached.
The profile maps each terrain combination to a cost multiplier derived from the slowest
unit in the template for that terrain. See STRATEGIC_COMBAT.md for full specification.

**Graph sizes (approximate for western Europe map):**
- Road graph: ~200–400 nodes (road junctions and endpoints)
- Waypoint graph: ~2,000–5,000 nodes at 750m sampling interval
- Combined graph: tractable for A* — queries run in milliseconds on the client

Both graphs are loaded at game start from `map_data.json` (road graph, embedded in
adjacency data) and `waypoints.json` (waypoint graph). Both are fixed at pipeline time —
no dynamic edges — so A* graph structure never changes during a session. Only edge costs
change at pathfinding time via the division movement profile multiplier.

---

## QGIS Authoring Workflow

### Layer stack (load in this order, bottom to top)

```
[1] DEM hillshade raster          ← bottom, visual reference only
[2] Base water polygons           ← constraint layer
[3] OSM roads (reference)         ← reference only, not edited
[4] OSM rivers (reference)        ← reference only, not edited
[5] Terrain vector polygons       ← editable, computed from DEM
[6] River network (game layer)    ← editable, simplified from OSM
[7] Road network (game layer)     ← editable, simplified from OSM
[8] Province polygons             ← editable, primary authoring layer
```

### Snapping configuration (critical)

Enable snapping for all editable layers: Settings → Snapping Options → Enable Snapping.
Set mode to "Vertex and Segment". Tolerance: 1px.

Province borders must share exact vertices with adjacent provinces — no gaps, no overlaps.
Gaps produce rendering seams in Godot and break adjacency detection in the pipeline.
The pipeline will throw an error if gaps > 0.001° are detected between adjacent polygons.

### Province layer schema (define before drawing anything)

Create the province layer with these exact fields. Set non-null constraints on required fields.
QGIS will enforce the schema on every new feature.

| Field name | Type | Required | Notes |
|---|---|---|---|
| province_id | String(50) | Yes | Set manually on creation |
| name | String(100) | Yes | |
| map_id | String(50) | Yes | |
| nation_id | String(50) | Yes | |
| is_capital | Boolean | Yes | Default false |
| is_core | String(200) | No | JSON array as string e.g. `["france","vichy"]` |
| city_name | String(100) | Yes | |
| city_lng | Real | Yes | |
| city_lat | Real | Yes | |
| population | Integer | Yes | 0–100. Per-province population stock — see RESOURCE_ECONOMY.md |
| industry | Integer | Yes | 0–100. Multiplier layer, not a spendable stock — see RESOURCE_ECONOMY.md |
| infrastructure | Integer | Yes | 0–100 |
| bld_fort | Integer | Yes | Default 0 |
| bld_port | Integer | Yes | Default 0 |
| bld_airbase | Integer | Yes | Default 0 |
| bld_supply_hub | Integer | Yes | Default 0 |
| bld_factory | Integer | Yes | Default 0 |
| bld_school | Integer | Yes | Default 0. See ECONOMY_BUILDINGS.md |
| bld_hospital | Integer | Yes | Default 0. See ECONOMY_BUILDINGS.md |
| bld_warehouse | Integer | Yes | Default 0. See ECONOMY_BUILDINGS.md |
| bld_shipyard | Integer | Yes | Default 0. Requires bld_port > 0 in the same province — see ECONOMY_BUILDINGS.md |
| bld_town_hall | Integer | Yes | Default 0. See ECONOMY_BUILDINGS.md |
| bld_res_grain | Integer | Yes | Default 0. Grain Farm/Granary — see ECONOMY_BUILDINGS.md |
| bld_res_iron | Integer | Yes | Default 0. Iron Mine |
| bld_res_oil | Integer | Yes | Default 0. Oil Derrick (Offshore Platform tier unlocked by research, not a separate field) |
| bld_res_rubber | Integer | Yes | Default 0. Rubber Plantation |
| bld_res_nitrates | Integer | Yes | Default 0. Nitrate Works |
| bld_res_tungsten | Integer | Yes | Default 0. Tungsten Mine |
| bld_res_chromium | Integer | Yes | Default 0. Chromium Mine |
| bld_res_aluminium | Integer | Yes | Default 0. Bauxite Mine + Refinery, tracked as one combined level — see ECONOMY_BUILDINGS.md |
| bld_res_uranium | Integer | Yes | Default 0. Uranium Mine |
| res_money | Integer | Yes | Default 0 |
| res_grain | Integer | Yes | Default 0 |
| res_iron | Integer | Yes | Default 0 |
| res_oil | Integer | Yes | Default 0 |
| res_rubber | Integer | Yes | Default 0 |
| res_nitrates | Integer | Yes | Default 0 |
| res_tungsten | Integer | Yes | Default 0 |
| res_chromium | Integer | Yes | Default 0 |
| res_aluminium | Integer | Yes | Default 0 |
| res_uranium | Integer | Yes | Default 0 |
| vp_value | Integer | Yes | Default 0 |
| is_objective | Boolean | Yes | Default false |
| notes | String(500) | No | Stripped by pipeline |

Buildings and resources are flat fields in QGIS (QGIS does not support nested JSON natively).
The pipeline reassembles them into nested objects in the output JSON. Resource-extraction
building fields (`bld_res_*`) are kept distinct from generic buildings (`bld_*`) and from
the resource abundance fields (`res_*`) themselves — abundance is what a province *has*,
the `bld_res_*` level is what's been *built* to extract it, and the two are independent
(see RESOURCE_ECONOMY.md and ECONOMY_BUILDINGS.md for how they combine at runtime).

### Claude Code + QGIS MCP integration

Install `qgis_mcp_plugin` into QGIS (copy to QGIS profile plugins folder, restart QGIS).
Configure in Claude Code's MCP config. Claude Code can then:

- Load all reference layers automatically at session start
- Run PyQGIS scripts to auto-generate province grids as starting drafts
- Validate that all features conform to the schema (no missing required fields)
- Run the pipeline script and trigger Godot to reload the map for visual verification
- Screenshot the Godot result for review

Example Claude Code prompt for map authoring:
> "Load the Europe 1939 reference layers, generate an initial province grid for France
> split into 8 provinces following the Loire and Rhine river boundaries, validate the schema,
> run the pipeline, and screenshot the Godot render."

---

## Pipeline — QGIS to Godot

**Location:** `tools/map_pipeline/pipeline.py`

**Inputs:**
- `provinces.geojson` — exported from QGIS province layer
- `adjacency.geojson` — auto-generated by pipeline from province topology + road/river layers
- `terrain.geojson` — exported from QGIS terrain layer
- `rivers.geojson` — exported from QGIS river network layer
- `roads.geojson` — exported from QGIS road network layer
- `base_water.geojson` — exported from QGIS base water layer

**Outputs (written to `godot/assets/data/<map_id>/`):**
- `map_data.json` — provinces + adjacency merged, Godot-native format
- `waypoints.json` — pre-baked off-road navigation graph for pathfinding (see below)
- `terrain.geojson` — passed through (for Godot visual layer)
- `rivers.geojson` — passed through (for Godot visual layer)
- `roads.geojson` — passed through (for Godot visual layer)
- `heightmap.tif` — copied from source (for Godot terrain shader)

**Pipeline steps:**

```
1.  Validate schema — fail loudly on any missing required field
2.  Simplify province polygon geometry — reduce vertex count for Godot performance
3.  Detect province adjacency — Shapely shared-edge intersection
4.  Classify adjacency edges — river/coast/open from river and water layers
5.  Assign road_level to edges — from road layer intersection
6.  Assign passable_by defaults — from terrain layer at border midpoint
7.  Reconstruct nested JSON — flatten QGIS fields back to nested buildings/resources objects
8.  Write map_data.json
9.  Generate waypoint graph — sample terrain rasters at regular intervals (~500m–1km),
    assign cover_combat + elevation to each node, compute raw edge costs from composable
    modifiers (cover_move × elevation_move), flag river-crossing edges with river_size,
    connect road graph endpoints to nearest waypoint nodes. Write waypoints.json.
10. Copy through terrain, rivers, roads, heightmap
11. Print summary: province count, adjacency edge count, waypoint node count, validation warnings
```

Run: `python tools/map_pipeline/pipeline.py --map europe_1939`

The pipeline is idempotent — re-run it as many times as needed. Source of truth is always
the QGIS project files. Godot output is always derived, never hand-edited.

---

## Godot — Map Data Loading

**Loaded at game start by `MapLoader` (see MODULES.md).**

```gdscript
# src/systems/map/map_loader.gd
# Reads map_data.json → instantiates Polygon2D nodes → builds province registry
# Reads terrain.geojson → instantiates terrain overlay polygons
# Reads roads.geojson → instantiates road line nodes
# Reads rivers.geojson → instantiates river line nodes
# Loads heightmap.tif → assigns to terrain shader uniform
```

**What the server reads:** Only `map_data.json` (provinces + adjacency).
**What the client reads:** All files. Terrain, rivers, roads, and heightmap are client rendering only.

**Province node structure in Godot:**

```
Node2D (province root)
  └── Polygon2D         ← province fill colour (ownership), polygon from map_data.json
  └── Line2D            ← province border
  └── Sprite2D          ← city icon at city.position
  └── Label             ← city name
  └── Node2D            ← unit stack anchor (city.position)
  └── Node2D            ← building icons
```

Province coordinates are stored in geographic space (longitude/latitude) and projected
to Godot screen space by a single projection function in `MapLoader`. This function is
the only place coordinate transformation happens — everything else works in Godot screen space.

---

## Reference Sources

| Source | What it provides | License | Use |
|---|---|---|---|
| aourednik/historical-basemaps | 1938 national borders + city locations | Public domain | Starting reference for province drawing |
| CShapes 2.0 (ETH Zurich) | 1939 national borders, high accuracy | CC BY-NC-SA 4.0 | Reference only (NC clause — do not ship) |
| Stanford "Building the New Order" | Month-by-month WW2 borders 1938–44 | Academic | Historical accuracy validation |
| Geofabrik / OpenStreetMap | Roads, rivers, land use | ODbL 1.0 | Road and river layers (commercial OK) |
| SRTM / Copernicus DEM | Global elevation | Public domain | Terrain classification + heightmap |

**Licence note:** CShapes NC clause means it cannot be shipped as part of a commercial product.
Use it as a visual reference in QGIS only. The province polygons you draw in QGIS are original
work and are not derived from CShapes geometrically.

---

## Files Checked Into Git

```
map/
├── source/
│   ├── europe_1939.qgz          ← QGIS project file (source of truth)
│   ├── provinces.geojson        ← exported from pipeline
│   ├── cities.geojson           ← exported from pipeline (one point per province)
│   ├── ports.geojson            ← exported from pipeline (snapped to coastline)
│   ├── cover.geojson            ← pipeline output (two-layer terrain system)
│   ├── elevation.geojson        ← pipeline output (two-layer terrain system)
│   ├── terrain_lookup.json      ← code→string + cover_visual→cover_combat mapping
│   ├── rivers.geojson           ← exported from QGIS / pipeline
│   ├── roads.geojson            ← exported from pipeline
│   └── base_water.geojson       ← exported from QGIS
├── tools/
│   └── map_pipeline/
│       ├── pipeline.py
│       └── validate.py
└── README.md                    ← how to run the pipeline

godot/assets/data/europe_1939/   ← pipeline output, NOT hand-edited
├── map_data.json
├── waypoints.json
├── cover.geojson
├── elevation.geojson
├── terrain_lookup.json
├── rivers.geojson
├── roads.geojson
└── heightmap.tif
```

The `godot/assets/data/` folder is generated output. If it conflicts in git, regenerate from source.
Never edit files in `godot/assets/data/` by hand.
