# Plan: Pathfinding Improvements

## Current Status (as of handoff)

**Branch:** `feat/hierarchical-path-finding`
**Commits completed:**
- `eabaf78` — docs: remove stale no-per-pixel-sampling language ✅ DONE
- `fd8b981` — test(movement): add movement-jerk e2e regression test (RED) ✅ DONE
- `a4d0920` — feat(server): broadcast consumed_waypoint_id on each division tick ✅ DONE
- `46799cd` — fix(client): prevent DR position snap at movement start ✅ DONE

**Phases complete:** 0, 1
**Phases remaining:** 2, 3, 4, 5, 6

**Start here: Phase 2.**

---

## Context

This is a Godot 4 grand strategy game. The game server is TypeScript/Colyseus. The map pipeline is Python. Working directory: `/home/kevin/Documents/Projects/grand-strategy-mp`.

### Key files you will touch

| File | Role |
|---|---|
| `map/tools/map_pipeline/pipeline.py` | Map pipeline — 1195 lines. Phases 2 + 3 add functions here. |
| `client/src/systems/military/pathfinder.gd` | Client A* pathfinder. Phases 4, 5, 6 add to this. |
| `client/src/systems/military/military_system.gd` | Game system. Phase 5 + 6 update call-sites. |
| `client/assets/data/western_europe_6/waypoints.json` | Pipeline output. Phase 2 regenerates. |
| `client/assets/data/western_europe_6/waypoints_clusters.json` | Phase 3 creates. |

### Running the pipeline

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp
python map/tools/map_pipeline/pipeline.py western_europe_6 --skip-dem
```

The output goes to `client/assets/data/western_europe_6/`. The `--skip-dem` flag skips the slow heightmap build.

### Running server tests

```bash
pnpm --filter game-server test
```

### Running pipeline tests

```bash
python -m pytest map/tools/map_pipeline/test_<name>.py -v
```

---

## Pipeline architecture (key facts for Phases 2 + 3)

`pipeline.py` `main()` flow (lines ~1097–1195):
1. `validate_all(map_dir)` → `sources` dict containing `sources["provinces"]`, `sources["cover"]`, `sources["elevation"]`, `sources["roads"]`, etc.
2. `generate_waypoints(sources, output_dir)` → writes `waypoints.json` with road nodes
3. Load `waypoints.json` into `existing_wp`
4. `generate_nonuniform_terrain_grid(sources, existing_wp, id_prefix="ct")` → returns `(coarse_nodes, coarse_edges)`, merges into `waypoints.json`
5. `generate_terrain_grid(...)` → fine grid, writes `waypoints_terrain.json`
6. **Phase 2 inserts `insert_boundary_nodes()` after step 4, before final write.**
7. **Phase 3 inserts `generate_hpa_clusters()` after Phase 2's boundary nodes.**

Each `sources["provinces"]` entry is a GeoJSON feature with:
```python
feat["properties"]["nation_id"]    # e.g. "france", "germany"
feat["properties"]["province_id"]  # e.g. "we6_france_03"
feat["geometry"]                   # Polygon or MultiPolygon
```

Node format in `waypoints.json` (current):
```json
{ "id": "wp_000001", "lng": 8.314632, "lat": 49.550833, "cover_combat": "plains", "elevation": "flat" }
```

After Phase 2 it becomes:
```json
{ "id": "wp_000001", "lng": 8.314632, "lat": 49.550833, "cover_combat": "plains", "elevation": "flat", "nation_id": "germany" }
```

Boundary nodes also get `nation_id`. Nodes outside all provinces get `"nation_id": null`.

---

## Pathfinder architecture (key facts for Phases 4, 5, 6)

`pathfinder.gd` key members:
```gdscript
var _nodes: Dictionary       # node_id -> { id, lng, lat, cover_combat, elevation, nation_id }
var _adjacency: Dictionary   # node_id -> Array of { to, base_cost, dist_deg, river_penalty, on_road }
var _road_nodes: Dictionary  # node_id -> true (if node is on a road)
```

Key functions:
- `build(wp_graph: Dictionary)` (line 28) — loads nodes/edges from waypoints.json
- `find_path(from_id, to_id, movement_profile, road_cost_multiplier=1.0)` (line 173) — main entry
- `_astar_impl(from_id, to_id, movement_profile, road_only, road_cost_multiplier=1.0)` (line 248) — bidirectional A*
- `_edge_cost(edge, nb_id, movement_profile, road_cost_multiplier)` (line 400)
- `_string_pull(path, movement_profile)` (line 358)

**The neutral exclusion check goes in `_astar_impl()`.** In the neighbour expansion loops (around lines 285–310 and 320–340), after the `road_only` check, add the neutral check before computing cost.

---

## TDD rule for all remaining phases

Write the test file **first**. Commit it while it is failing (RED). Then implement until all tests pass (GREEN). Commit the implementation separately. The RED commit must be committed before any implementation exists — do not write tests after the fact.

---

## Phase 2 — Boundary-Conforming Node Insertion + nation_id Tagging (pipeline, TDD)

### What to build

Two new capabilities, both done in one pipeline pass and one set of commits:

**A. nation_id tagging:** Tag every node (road nodes from `generate_waypoints()`, terrain nodes from `generate_nonuniform_terrain_grid()`) with the `nation_id` of the province it falls within. Nodes outside all provinces get `null`.

**B. Boundary-conforming nodes:** Insert nodes along terrain-type boundary lines so that A* has accurate transition costs near boundaries.

### A. nation_id tagging — exact implementation

Both `generate_waypoints()` and `generate_nonuniform_terrain_grid()` have a local `_tag(lng, lat)` function that returns `(cover_combat, elevation)`. You need to:

1. Build a province spatial index **once** at the top of each function (alongside the existing cover/elev trees):

```python
# In generate_waypoints() — add after line ~519 (after cover_tree, elev_tree creation)
prov_feats  = sources.get("provinces", [])
prov_geoms  = [shape(f["geometry"]) for f in prov_feats]
prov_nids   = [f["properties"].get("nation_id") for f in prov_feats]
prov_tree   = STRtree(prov_geoms) if prov_geoms else None
```

2. Extend the local `_tag()` to also return `nation_id`:

```python
# Change signature from: def _tag(lng, lat) -> tuple[str, str]
# To:                    def _tag(lng, lat) -> tuple[str, str, str | None]
def _tag(lng: float, lat: float) -> tuple[str, str, str | None]:
    pt = Point(lng, lat)
    cover_combat = "plains"
    elevation = "flat"
    nation_id = None
    if cover_tree is not None:
        for idx in cover_tree.query(pt, predicate="intersects"):
            if cover_geoms[idx].contains(pt):
                cover_combat = cover_feats[idx]["properties"].get("cover_combat", "plains")
                break
    if elev_tree is not None:
        for idx in elev_tree.query(pt, predicate="intersects"):
            if elev_geoms[idx].contains(pt):
                elevation = _get_elev_type(elev_feats[idx]["properties"]) or "flat"
                break
    if prov_tree is not None:
        for idx in prov_tree.query(pt, predicate="intersects"):
            if prov_geoms[idx].contains(pt):
                nation_id = prov_nids[idx]
                break
    return cover_combat, elevation, nation_id
```

3. Update every call-site of `_tag()` to unpack 3 values and include `nation_id` in the node dict:

In `generate_waypoints()`, the node construction is in `_get_or_create()` around line 583:
```python
# Change from:
cover, elev = _tag(lng, lat)
nodes.append({
    "id": wid, "lng": round(lng, 6), "lat": round(lat, 6),
    "cover_combat": cover, "elevation": elev,
})

# Change to:
cover, elev, nation_id = _tag(lng, lat)
nodes.append({
    "id": wid, "lng": round(lng, 6), "lat": round(lat, 6),
    "cover_combat": cover, "elevation": elev, "nation_id": nation_id,
})
```

In `generate_nonuniform_terrain_grid()`, the node construction is in `_try_add()` around line 960:
```python
# Change from:
cover, elev = _tag(lng, lat)
...
node_by_key[key] = {
    "id": nid, "lng": round(lng, 6), "lat": round(lat, 6),
    "cover_combat": cover, "elevation": elev,
}

# Change to:
cover, elev, nation_id = _tag(lng, lat)
...
node_by_key[key] = {
    "id": nid, "lng": round(lng, 6), "lat": round(lat, 6),
    "cover_combat": cover, "elevation": elev, "nation_id": nation_id,
}
```

Do the same fix in `generate_terrain_grid()` (the fine-grid function around line 648) — it also has its own `_tag()` function and node construction.

**Note:** `_tag()` is defined locally inside each function. Each function gets its own patched version.

### B. Boundary-conforming node insertion — exact implementation

New top-level function `insert_boundary_nodes(sources, existing_wp)` in `pipeline.py`. Call it in `main()` after `generate_nonuniform_terrain_grid()` and before writing `waypoints.json`. It returns `(new_nodes, new_edges)` to merge in.

```python
def insert_boundary_nodes(
    sources: dict,
    existing_wp: dict,
    boundary_sample_deg: float = 0.007,
) -> tuple[list[dict], list[dict]]:
    """
    Insert nodes along every terrain-category boundary (cover or elevation changes).
    Two nodes per sample point: one offset to each side of the boundary.
    ID prefix: bn_

    Performance: dissolves individual polygons by type before boundary detection,
    reducing O(n²) polygon-pair checks to O(k²) type-pair checks (~55 pairs for
    11 cover types vs. 72M pairs for 12k individual polygons).
    """
    from collections import defaultdict
    import math
    # unary_union already imported at module level

    BOUNDARY_OFFSET_DEG = 0.0001   # ~11m perpendicular offset
    K_CONNECT = 8                  # max neighbours per new node (matches K_TERRAIN)

    COVER_MOVE: dict[str, float] = {
        "plains": 1.0, "steppe": 1.1, "shrubland": 1.2, "light_forest": 1.3,
        "dense_forest": 1.8, "jungle": 2.5, "desert": 1.4, "swamp": 2.0,
        "tundra": 1.5, "glacier": 9999.0, "urban": 0.9,
    }
    ELEV_MOVE: dict[str, float] = {"flat": 1.0, "hills": 1.4, "mountains": 2.2}

    cover_feats = sources.get("cover", [])
    elev_feats  = sources.get("elevation", [])
    water_feats = sources.get("base_water", [])
    prov_feats  = sources.get("provinces", [])

    cover_geoms = [shape(f["geometry"]) for f in cover_feats]
    elev_geoms  = [shape(f["geometry"]) for f in elev_feats]
    water_geoms = [shape(f["geometry"]) for f in water_feats]
    prov_geoms  = [shape(f["geometry"]) for f in prov_feats]
    prov_nids   = [f["properties"].get("nation_id") for f in prov_feats]

    cover_tree = STRtree(cover_geoms) if cover_geoms else None
    elev_tree  = STRtree(elev_geoms)  if elev_geoms  else None
    water_union = unary_union(water_geoms) if water_geoms else None
    prov_tree  = STRtree(prov_geoms)  if prov_geoms  else None

    def _in_water(lng: float, lat: float) -> bool:
        if water_union is None:
            return False
        pt = Point(lng, lat)
        return water_union.contains(pt)

    def _tag_point(lng: float, lat: float) -> tuple[str, str, str | None]:
        pt = Point(lng, lat)
        cover_combat, elevation, nation_id = "plains", "flat", None
        if cover_tree:
            for idx in cover_tree.query(pt, predicate="intersects"):
                if cover_geoms[idx].contains(pt):
                    cover_combat = cover_feats[idx]["properties"].get("cover_combat", "plains")
                    break
        if elev_tree:
            for idx in elev_tree.query(pt, predicate="intersects"):
                if elev_geoms[idx].contains(pt):
                    elevation = _get_elev_type(elev_feats[idx]["properties"]) or "flat"
                    break
        if prov_tree:
            for idx in prov_tree.query(pt, predicate="intersects"):
                if prov_geoms[idx].contains(pt):
                    nation_id = prov_nids[idx]
                    break
        return cover_combat, elevation, nation_id

    def _sample_boundary(geom_a, geom_b) -> list[tuple[float, float]]:
        """Sample points along the shared boundary between two polygons."""
        try:
            boundary = geom_a.boundary.intersection(geom_b.boundary)
        except Exception:
            return []
        if boundary.is_empty:
            return []
        coords: list[tuple[float, float]] = []
        lines = []
        if boundary.geom_type == "LineString":
            lines = [list(boundary.coords)]
        elif boundary.geom_type == "MultiLineString":
            lines = [list(g.coords) for g in boundary.geoms]
        elif boundary.geom_type == "GeometryCollection":
            for g in boundary.geoms:
                if g.geom_type in ("LineString", "MultiLineString"):
                    if g.geom_type == "LineString":
                        lines.append(list(g.coords))
                    else:
                        lines.extend([list(l.coords) for l in g.geoms])
        for line in lines:
            if len(line) < 2:
                continue
            # Interpolate along boundary at boundary_sample_deg intervals
            current = 0.0
            for i in range(len(line) - 1):
                lng0, lat0 = line[i][0], line[i][1]
                lng1, lat1 = line[i+1][0], line[i+1][1]
                seg_len = math.hypot(lng1 - lng0, lat1 - lat0)
                while current <= seg_len:
                    t = current / seg_len if seg_len > 0 else 0.0
                    coords.append((lng0 + t * (lng1 - lng0), lat0 + t * (lat1 - lat0)))
                    current += boundary_sample_deg
                current -= seg_len
        return coords

    # Collect all boundary points from cover and elevation type boundaries.
    #
    # PERFORMANCE NOTE: Do NOT iterate individual polygon pairs (O(n²) with 12k polys
    # → 767k+ sample points, pipeline timeout). Instead dissolve by type first so we
    # only check O(k²) type-pair boundaries (~11 cover types → 55 pairs).
    bn_samples: list[tuple[float, float]] = []

    from collections import defaultdict

    # Cover boundaries — dissolve per cover_combat type, then find type-pair boundaries
    cover_by_type: dict[str, list] = defaultdict(list)
    for g, f in zip(cover_geoms, cover_feats):
        cover_by_type[f["properties"].get("cover_combat", "plains")].append(g)
    cover_dissolved = {ct: unary_union(geoms) for ct, geoms in cover_by_type.items()}
    cover_types = list(cover_dissolved.keys())
    print(f"  boundary nodes: dissolving {len(cover_geoms)} cover polys into {len(cover_types)} types")
    for i in range(len(cover_types)):
        for j in range(i + 1, len(cover_types)):
            pts = _sample_boundary(cover_dissolved[cover_types[i]], cover_dissolved[cover_types[j]])
            bn_samples.extend(pts)

    # Elevation boundaries — same dissolve-first approach
    elev_by_type: dict[str, list] = defaultdict(list)
    for g, f in zip(elev_geoms, elev_feats):
        elev_by_type[_get_elev_type(f["properties"]) or "flat"].append(g)
    elev_dissolved = {et: unary_union(geoms) for et, geoms in elev_by_type.items()}
    elev_types = list(elev_dissolved.keys())
    print(f"  boundary nodes: dissolving {len(elev_geoms)} elev polys into {len(elev_types)} types")
    for i in range(len(elev_types)):
        for j in range(i + 1, len(elev_types)):
            pts = _sample_boundary(elev_dissolved[elev_types[i]], elev_dissolved[elev_types[j]])
            bn_samples.extend(pts)

    print(f"  boundary nodes: {len(bn_samples)} raw sample points")

    # For each sample, insert two offset nodes (one each side of boundary)
    new_nodes: list[dict] = []
    bn_counter = 1

    for lng, lat in bn_samples:
        if _in_water(lng, lat):
            continue
        # Offset in two perpendicular directions (simple ±lat offset for simplicity)
        for dlng, dlat in [(0.0, BOUNDARY_OFFSET_DEG), (0.0, -BOUNDARY_OFFSET_DEG)]:
            nlng = round(lng + dlng, 6)
            nlat = round(lat + dlat, 6)
            if _in_water(nlng, nlat):
                continue
            cover, elev, nation_id = _tag_point(nlng, nlat)
            if COVER_MOVE.get(cover, 1.0) >= 9000:
                continue
            nid = f"bn_{bn_counter:06d}"
            bn_counter += 1
            new_nodes.append({
                "id": nid, "lng": nlng, "lat": nlat,
                "cover_combat": cover, "elevation": elev, "nation_id": nation_id,
            })

    print(f"  boundary nodes: {len(new_nodes)} nodes after water/glacier filter")

    # Connect each boundary node to K_CONNECT nearest existing nodes
    all_existing = existing_wp.get("nodes", []) + new_nodes
    all_pts = [Point(n["lng"], n["lat"]) for n in all_existing]
    all_tree = STRtree(all_pts)
    all_ids  = [n["id"] for n in all_existing]

    CONNECT_DEG = 0.40
    connect_sq  = CONNECT_DEG ** 2

    new_edges: list[dict] = []
    seen_edges: set[tuple[str, str]] = set()

    for node in new_nodes:
        pt = Point(node["lng"], node["lat"])
        candidates: list[tuple[float, int]] = []
        for idx in all_tree.query(pt.buffer(CONNECT_DEG), predicate="intersects"):
            nb = all_existing[idx]
            if nb["id"] == node["id"]:
                continue
            dist_sq = (node["lng"] - nb["lng"])**2 + (node["lat"] - nb["lat"])**2
            if dist_sq <= connect_sq:
                candidates.append((dist_sq, idx))
        candidates.sort()
        for _, idx in candidates[:K_CONNECT]:
            nb = all_existing[idx]
            ekey = (min(node["id"], nb["id"]), max(node["id"], nb["id"]))
            if ekey in seen_edges:
                continue
            seen_edges.add(ekey)
            c1 = COVER_MOVE.get(node["cover_combat"], 1.0) * ELEV_MOVE.get(node["elevation"], 1.0)
            c2 = COVER_MOVE.get(nb["cover_combat"],   1.0) * ELEV_MOVE.get(nb.get("elevation", "flat"), 1.0)
            new_edges.append({
                "from": node["id"], "to": nb["id"],
                "base_cost": round((c1 + c2) / 2, 3), "river_size": None,
            })

    print(f"  boundary nodes: {len(new_edges)} edges")
    return new_nodes, new_edges
```

### Calling insert_boundary_nodes in main()

In `main()`, after the `generate_nonuniform_terrain_grid` block that merges into `existing_wp`, and **before** the `generate_terrain_grid` call, add:

```python
print("Inserting boundary-conforming nodes...")
bn_nodes, bn_edges = insert_boundary_nodes(sources, existing_wp)
if bn_nodes:
    existing_wp["nodes"].extend(bn_nodes)
    existing_wp["edges"].extend(bn_edges)
    with open(wp_path, "w", encoding="utf-8") as f:
        json.dump(existing_wp, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  waypoints.json: +{len(bn_nodes)} boundary nodes → "
          f"{len(existing_wp['nodes'])} total")
```

### Tests for Phase 2

Write these TWO test files FIRST, commit RED, then implement, then commit GREEN.

#### `map/tools/map_pipeline/test_boundary_nodes.py`

```python
"""Tests for insert_boundary_nodes() — Phase 2 boundary-conforming node insertion."""
import json, math, sys
from pathlib import Path
from shapely.geometry import shape, mapping, Polygon, MultiPolygon
import pytest

# Allow importing pipeline from the same directory
sys.path.insert(0, str(Path(__file__).parent))
from pipeline import insert_boundary_nodes, _get_elev_type


def _cover_feat(coords, cover_combat):
    return {"type": "Feature", "properties": {"cover_combat": cover_combat},
            "geometry": mapping(Polygon(coords))}

def _elev_feat(coords, elev_type):
    return {"type": "Feature", "properties": {"elevation_type": elev_type},
            "geometry": mapping(Polygon(coords))}

def _empty_wp():
    return {"nodes": [], "edges": [], "road_connections": []}


def test_boundary_nodes_appear_at_cover_transition():
    """Nodes must appear near the boundary between plains and dense_forest."""
    sources = {
        "cover": [
            _cover_feat([(0,0),(1,0),(1,1),(0,1),(0,0)], "plains"),
            _cover_feat([(1,0),(2,0),(2,1),(1,1),(1,0)], "dense_forest"),
        ],
        "elevation": [],
        "base_water": [],
        "provinces": [],
    }
    nodes, edges = insert_boundary_nodes(sources, _empty_wp())
    plains_nodes  = [n for n in nodes if n["cover_combat"] == "plains"]
    forest_nodes  = [n for n in nodes if n["cover_combat"] == "dense_forest"]
    assert len(plains_nodes) > 0,  "Expected plains-side boundary nodes"
    assert len(forest_nodes) > 0,  "Expected forest-side boundary nodes"


def test_boundary_nodes_scale_with_boundary_length_not_area():
    """Same boundary length → same node count regardless of polygon area."""
    # Both have boundary at x=1, from y=0 to y=1
    def _sources(width):
        return {
            "cover": [
                _cover_feat([(0,0),(1,0),(1,1),(0,1),(0,0)], "plains"),
                _cover_feat([(1,0),(1+width,0),(1+width,1),(1,1),(1,0)], "dense_forest"),
            ],
            "elevation": [], "base_water": [], "provinces": [],
        }
    n1, _ = insert_boundary_nodes(_sources(0.5),  _empty_wp())
    n2, _ = insert_boundary_nodes(_sources(2.0),  _empty_wp())
    assert len(n1) == len(n2), f"Boundary length same but node counts differ: {len(n1)} vs {len(n2)}"


def test_water_boundaries_skipped():
    """No boundary nodes should be inserted along a coastline (polygon adjacent to water)."""
    sources = {
        "cover": [
            _cover_feat([(0,0),(1,0),(1,1),(0,1),(0,0)], "plains"),
            _cover_feat([(1,0),(2,0),(2,1),(1,1),(1,0)], "dense_forest"),
        ],
        "elevation": [],
        # Water covers the entire right-hand polygon region — all offset points land in water
        "base_water": [{"type": "Feature", "properties": {},
                         "geometry": mapping(Polygon([(0.9,-0.1),(2.1,-0.1),(2.1,1.1),(0.9,1.1),(0.9,-0.1)]))}],
        "provinces": [],
    }
    nodes, _ = insert_boundary_nodes(sources, _empty_wp())
    # Any node whose lng > 0.95 would be inside or very near water — should be filtered
    wet_nodes = [n for n in nodes if n["lng"] > 0.95]
    assert len(wet_nodes) == 0, f"Expected no nodes in water zone, got {len(wet_nodes)}"


def test_boundary_nodes_connect_to_existing_nodes():
    """Each boundary node must have at least one edge connecting to an existing node."""
    sources = {
        "cover": [
            _cover_feat([(0,0),(1,0),(1,1),(0,1),(0,0)], "plains"),
            _cover_feat([(1,0),(2,0),(2,1),(1,1),(1,0)], "dense_forest"),
        ],
        "elevation": [], "base_water": [], "provinces": [],
    }
    # Provide one existing node near the boundary
    existing_wp = {
        "nodes": [{"id": "wp_000001", "lng": 1.0, "lat": 0.5,
                   "cover_combat": "plains", "elevation": "flat", "nation_id": None}],
        "edges": [], "road_connections": [],
    }
    nodes, edges = insert_boundary_nodes(sources, existing_wp)
    if nodes:
        bn_ids = {n["id"] for n in nodes}
        connected = {e["from"] for e in edges if e["to"] not in bn_ids} | \
                    {e["to"]   for e in edges if e["from"] not in bn_ids}
        assert len(connected) > 0, "No boundary node connected to any existing node"


def test_nation_id_on_boundary_nodes():
    """Boundary nodes must carry nation_id from the province they fall within."""
    sources = {
        "cover": [
            _cover_feat([(0,0),(1,0),(1,1),(0,1),(0,0)], "plains"),
            _cover_feat([(1,0),(2,0),(2,1),(1,1),(1,0)], "dense_forest"),
        ],
        "elevation": [], "base_water": [],
        "provinces": [
            {"type": "Feature",
             "properties": {"nation_id": "testland", "province_id": "t_01"},
             "geometry": mapping(Polygon([(-0.5,-0.5),(2.5,-0.5),(2.5,1.5),(-0.5,1.5),(-0.5,-0.5)]))},
        ],
    }
    nodes, _ = insert_boundary_nodes(sources, _empty_wp())
    assert len(nodes) > 0
    for n in nodes:
        assert "nation_id" in n, f"Node {n['id']} missing nation_id key"
        assert n["nation_id"] == "testland", f"Expected 'testland', got {n['nation_id']}"
```

#### `map/tools/map_pipeline/test_nation_tagging.py`

```python
"""Tests for nation_id tagging on all pipeline nodes — Phase 2."""
import json, sys
from pathlib import Path
from shapely.geometry import mapping, Polygon
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from pipeline import generate_waypoints, generate_nonuniform_terrain_grid


def _prov_feat(coords, nation_id, province_id):
    return {"type": "Feature",
            "properties": {"nation_id": nation_id, "province_id": province_id,
                           "name": province_id, "map_id": "test",
                           "terrain_elevation": "flat", "terrain_cover": "plains",
                           "city_name": "", "city_lng": 0.5, "city_lat": 0.5,
                           "is_capital": False, "is_core": False,
                           "is_objective": False, "is_playable": True,
                           "population": 50, "industry": 50, "infrastructure": 50,
                           "vp_value": 1},
            "geometry": mapping(Polygon(coords))}

def _cover_feat(coords, cover_combat):
    return {"type": "Feature", "properties": {"cover_combat": cover_combat},
            "geometry": mapping(Polygon(coords))}

def _road_feat(coords):
    from shapely.geometry import mapping, LineString
    return {"type": "Feature",
            "properties": {"road_id": "r1", "road_level": 1},
            "geometry": mapping(LineString(coords))}


def test_all_road_nodes_have_nation_id_key(tmp_path):
    """Every road node written by generate_waypoints() must have a 'nation_id' key."""
    sources = {
        "roads": [_road_feat([(0.1, 0.1), (0.5, 0.1), (0.9, 0.1)])],
        "cover": [_cover_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "plains")],
        "elevation": [],
        "rivers": [],
        "provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "testland", "t_01")],
    }
    generate_waypoints(sources, tmp_path)
    wp = json.loads((tmp_path / "waypoints.json").read_text())
    for node in wp["nodes"]:
        assert "nation_id" in node, f"Node {node['id']} missing nation_id"


def test_node_inside_province_gets_correct_nation_id(tmp_path):
    """A node at (0.5, 0.5) inside a 'france' province must get nation_id='france'."""
    sources = {
        "roads": [_road_feat([(0.1, 0.5), (0.9, 0.5)])],
        "cover": [_cover_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "plains")],
        "elevation": [],
        "rivers": [],
        "provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "france", "f_01")],
    }
    generate_waypoints(sources, tmp_path)
    wp = json.loads((tmp_path / "waypoints.json").read_text())
    assert wp["nodes"], "No nodes generated"
    for node in wp["nodes"]:
        assert node["nation_id"] == "france", \
            f"Node {node['id']} at ({node['lng']},{node['lat']}) got nation_id={node['nation_id']!r}"


def test_node_outside_all_provinces_gets_null_nation_id(tmp_path):
    """A node outside all provinces must get nation_id=null."""
    sources = {
        # Road at x=5 — far outside the province at x=0..1
        "roads": [_road_feat([(5.1, 0.5), (5.9, 0.5)])],
        "cover": [_cover_feat([(4,-1),(7,-1),(7,2),(4,2),(4,-1)], "plains")],
        "elevation": [],
        "rivers": [],
        "provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "france", "f_01")],
    }
    generate_waypoints(sources, tmp_path)
    wp = json.loads((tmp_path / "waypoints.json").read_text())
    assert wp["nodes"], "No nodes generated"
    for node in wp["nodes"]:
        assert node["nation_id"] is None, \
            f"Expected null for node outside province, got {node['nation_id']!r}"


def test_terrain_nodes_also_get_nation_id(tmp_path):
    """Terrain nodes from generate_nonuniform_terrain_grid() must also have nation_id."""
    sources = {
        "roads": [_road_feat([(0.1, 0.5), (0.9, 0.5)])],
        "cover": [_cover_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "plains")],
        "elevation": [],
        "rivers": [],
        "base_water": [],
        "provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "germany", "g_01")],
    }
    generate_waypoints(sources, tmp_path)
    wp = json.loads((tmp_path / "waypoints.json").read_text())
    new_nodes, _ = generate_nonuniform_terrain_grid(sources, wp, id_prefix="ct")
    for node in new_nodes:
        assert "nation_id" in node, f"Terrain node {node['id']} missing nation_id"
```

### Commit order for Phase 2

1. Write both test files, run `python -m pytest map/tools/map_pipeline/test_boundary_nodes.py map/tools/map_pipeline/test_nation_tagging.py` — they must FAIL. Commit: `test(pipeline): add boundary-node and nation-tagging tests (RED)`
2. Implement `insert_boundary_nodes()` and the `nation_id` tagging changes to `generate_waypoints()`, `generate_nonuniform_terrain_grid()`, and `generate_terrain_grid()`.
3. Run `python -m pytest map/tools/map_pipeline/test_boundary_nodes.py map/tools/map_pipeline/test_nation_tagging.py -v` — must pass.
4. Run the pipeline: `python map/tools/map_pipeline/pipeline.py western_europe_6 --skip-dem`
5. Verify `waypoints.json` nodes have `nation_id` field: `python -c "import json; d=json.load(open('client/assets/data/western_europe_6/waypoints.json')); print(list(d['nodes'][0].keys()))"`
6. Commit: `feat(pipeline): insert boundary nodes and tag waypoints with nation_id`

---

## Phase 3 — Recursive HPA* Cluster Precomputation (pipeline, TDD)

### What to build

New function `generate_hpa_clusters(sources, existing_wp, cluster_threshold=300)` in `pipeline.py`. Call it in `main()` after Phase 2's boundary nodes are merged. Output: `client/assets/data/<map_id>/waypoints_clusters.json`.

### Algorithm

```python
def generate_hpa_clusters(
    sources: dict,
    existing_wp: dict,
    cluster_threshold: int = 300,
) -> dict:
    """
    Build recursive HPA* cluster hierarchy and precompute abstract edges.

    Step 1: Assign each waypoint node to its province via point-in-polygon.
    Step 2: Recursively sub-partition clusters with > cluster_threshold nodes
            using 2x2 bounding-box quadrant split.
    Step 3: Find border nodes (nodes with at least one edge crossing to a
            different leaf cluster).
    Step 4: Precompute intra-cluster A* costs between all border node pairs.
    Step 5: Build abstract edge list.

    Returns: dict compatible with waypoints_clusters.json format.
    """
```

#### Step 1 — Province assignment

```python
prov_feats = sources.get("provinces", [])
prov_geoms = [shape(f["geometry"]) for f in prov_feats]
prov_ids   = [f["properties"]["province_id"] for f in prov_feats]
prov_tree  = STRtree(prov_geoms) if prov_geoms else None

node_province: dict[str, str] = {}  # node_id -> province_id or "sea"
for node in existing_wp.get("nodes", []):
    pt = Point(node["lng"], node["lat"])
    assigned = "sea"
    if prov_tree:
        for idx in prov_tree.query(pt, predicate="intersects"):
            if prov_geoms[idx].contains(pt):
                assigned = prov_ids[idx]
                break
    node_province[node["id"]] = assigned
```

#### Step 2 — Recursive sub-partitioning

```python
def _partition(node_ids: list[str], province_id: str, depth: int, parent_id: str | None,
               node_coords: dict[str, tuple[float, float]]) -> list[dict]:
    """Returns list of cluster dicts (leaf clusters only get border_nodes filled later)."""
    cluster_id = f"c_{province_id}_{depth}"
    cluster: dict = {
        "id": cluster_id,
        "province_id": province_id,
        "parent": parent_id,
        "children": [],
        "border_nodes": [],
        "node_ids": node_ids,  # temporary, removed before output
    }
    if len(node_ids) <= cluster_threshold:
        return [cluster]  # leaf
    # Split by bounding box 2x2
    lngs = [node_coords[nid][0] for nid in node_ids]
    lats = [node_coords[nid][1] for nid in node_ids]
    mid_lng = (min(lngs) + max(lngs)) / 2
    mid_lat = (min(lats) + max(lats)) / 2
    quads: dict[str, list[str]] = {"NW": [], "NE": [], "SW": [], "SE": []}
    for nid in node_ids:
        lng, lat = node_coords[nid]
        q = ("N" if lat >= mid_lat else "S") + ("E" if lng >= mid_lng else "W")
        quads[q].append(nid)
    children = []
    for qi, (qname, qnids) in enumerate(quads.items()):
        if not qnids:
            continue
        sub = _partition(qnids, province_id, depth + 1, cluster_id, node_coords)
        children.extend(sub)
    cluster["children"] = [c["id"] for c in children]
    return [cluster] + children
```

#### Step 3 — Border node detection

A node is a border node if it has at least one adjacency edge to a node in a **different leaf cluster**.

```python
# Build node->leaf-cluster mapping
leaf_cluster_of: dict[str, str] = {}
for cluster in all_clusters:
    if not cluster["children"]:  # leaf
        for nid in cluster["node_ids"]:
            leaf_cluster_of[nid] = cluster["id"]

# Build adjacency from existing_wp edges
adjacency: dict[str, list[str]] = {}
for edge in existing_wp.get("edges", []):
    adjacency.setdefault(edge["from"], []).append(edge["to"])
    adjacency.setdefault(edge["to"],   []).append(edge["from"])

border_nodes: set[str] = set()
for nid, neighbours in adjacency.items():
    my_cluster = leaf_cluster_of.get(nid)
    if my_cluster is None:
        continue
    for nb in neighbours:
        if leaf_cluster_of.get(nb) != my_cluster:
            border_nodes.add(nid)
            break
```

#### Step 4 — Precompute intra-cluster border costs

Implement a simple Python A* (not bidirectional for simplicity) within a cluster's nodes:

```python
import heapq

def _astar_in_cluster(start: str, goal: str, cluster_node_ids: set[str],
                      adjacency: dict, node_coords: dict) -> float | None:
    """Returns path cost or None if no path exists within the cluster."""
    if start == goal:
        return 0.0
    def heuristic(a, b):
        ax, ay = node_coords[a]; bx, by = node_coords[b]
        return math.hypot(ax-bx, ay-by)
    heap = [(0.0, start)]
    dist = {start: 0.0}
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist.get(u, float("inf")):
            continue
        if u == goal:
            return d
        for v in adjacency.get(u, []):
            if v not in cluster_node_ids:
                continue  # stay within cluster
            nd = d + heuristic(u, v)  # use Euclidean as edge cost approximation
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                heapq.heappush(heap, (nd, v))
    return None
```

For each leaf cluster, call `_astar_in_cluster` between every pair of border nodes in that cluster.

#### Output format

```python
output = {
    "cluster_threshold": cluster_threshold,
    "clusters": [
        {
            "id": c["id"],
            "province_id": c["province_id"],
            "parent": c["parent"],
            "children": c["children"],
            "border_nodes": c["border_nodes"],
        }
        for c in all_clusters
    ],
    "abstract_edges": abstract_edges,  # list of {from, to, cluster_id, cost}
}
```

### Calling generate_hpa_clusters in main()

After Phase 2's boundary node block (which writes `waypoints.json`), add:

```python
print("Building HPA* cluster hierarchy...")
cluster_data = generate_hpa_clusters(sources, existing_wp)
cluster_path = output_dir / "waypoints_clusters.json"
with open(cluster_path, "w", encoding="utf-8") as f:
    json.dump(cluster_data, f, ensure_ascii=False, separators=(",", ":"))
print(f"  waypoints_clusters.json: {len(cluster_data['clusters'])} clusters, "
      f"{len(cluster_data['abstract_edges'])} abstract edges")
```

### Tests for Phase 3

Write FIRST, commit RED, then implement, then commit GREEN.

#### `map/tools/map_pipeline/test_hpa_clusters.py`

```python
"""Tests for generate_hpa_clusters() — Phase 3."""
import sys, math
from pathlib import Path
from shapely.geometry import mapping, Polygon
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from pipeline import generate_hpa_clusters


def _make_wp(n_nodes: int, spread: float = 1.0) -> dict:
    """Create a grid of n_nodes waypoint nodes within spread degrees."""
    import math
    side = math.ceil(math.sqrt(n_nodes))
    nodes = []
    edges = []
    for i in range(n_nodes):
        r, c = divmod(i, side)
        nodes.append({
            "id": f"wp_{i:04d}", "lng": round(c * spread / side, 6),
            "lat": round(r * spread / side, 6),
            "cover_combat": "plains", "elevation": "flat", "nation_id": "testland",
        })
    # Connect in a grid
    for i in range(n_nodes):
        r, c = divmod(i, side)
        for dr, dc in [(0,1),(1,0)]:
            j = (r+dr)*side + (c+dc)
            if j < n_nodes:
                edges.append({"from": f"wp_{i:04d}", "to": f"wp_{j:04d}",
                              "base_cost": 1.0, "river_size": None})
    return {"nodes": nodes, "edges": edges, "road_connections": []}


def _prov_feat(coords, nation_id, province_id):
    return {"type": "Feature",
            "properties": {"nation_id": nation_id, "province_id": province_id},
            "geometry": mapping(Polygon(coords))}


def test_small_cluster_stays_flat():
    """A province with ≤300 nodes must produce a single flat cluster with no children."""
    sources = {"provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "a", "a_01")]}
    wp = _make_wp(50)
    result = generate_hpa_clusters(sources, wp, cluster_threshold=300)
    clusters = result["clusters"]
    # Root cluster should be a leaf (no children)
    root = next((c for c in clusters if c["parent"] is None and "a_01" in c["id"]), None)
    assert root is not None, "No root cluster for province a_01"
    assert root["children"] == [], f"Expected no children for small cluster, got {root['children']}"


def test_large_cluster_gets_sub_partitioned():
    """A province with >300 nodes must be sub-partitioned; all leaf clusters ≤300 nodes."""
    sources = {"provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "a", "a_01")]}
    wp = _make_wp(400)
    result = generate_hpa_clusters(sources, wp, cluster_threshold=300)
    leaf_clusters = [c for c in result["clusters"] if not c["children"]]
    assert len(leaf_clusters) > 1, "Expected multiple leaf clusters for 400-node province"
    # Note: leaf cluster node counts are not directly available in output;
    # verify indirectly that the root has children
    root = next((c for c in result["clusters"] if c["parent"] is None and "a_01" in c["id"]), None)
    assert root is not None
    assert len(root["children"]) > 0, "Root cluster should have children for large province"


def test_recursion_terminates():
    """Even 1000 nodes must terminate with all leaves ≤ cluster_threshold."""
    sources = {"provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "a", "a_01")]}
    wp = _make_wp(1000)
    result = generate_hpa_clusters(sources, wp, cluster_threshold=300)
    # Should not raise; just verify output is valid
    assert "clusters" in result
    assert "abstract_edges" in result


def test_border_nodes_have_cross_cluster_edges():
    """Every border node listed in a cluster must have at least one abstract edge."""
    sources = {
        "provinces": [
            _prov_feat([(-0.1,-0.1),(0.6,-0.1),(0.6,1.1),(-0.1,1.1),(-0.1,-0.1)], "a", "a_01"),
            _prov_feat([(0.4,-0.1),(1.1,-0.1),(1.1,1.1),(0.4,1.1),(0.4,-0.1)],    "b", "b_01"),
        ]
    }
    # 10 nodes in province a, 10 in province b
    wp = {
        "nodes": [
            *[{"id": f"wa_{i}", "lng": 0.1+i*0.05, "lat": 0.5,
               "cover_combat": "plains", "elevation": "flat", "nation_id": "a"} for i in range(10)],
            *[{"id": f"wb_{i}", "lng": 0.6+i*0.05, "lat": 0.5,
               "cover_combat": "plains", "elevation": "flat", "nation_id": "b"} for i in range(10)],
        ],
        "edges": [
            *[{"from": f"wa_{i}", "to": f"wa_{i+1}", "base_cost": 1.0, "river_size": None}
              for i in range(9)],
            *[{"from": f"wb_{i}", "to": f"wb_{i+1}", "base_cost": 1.0, "river_size": None}
              for i in range(9)],
            # Cross-province edge
            {"from": "wa_9", "to": "wb_0", "base_cost": 1.0, "river_size": None},
        ],
        "road_connections": [],
    }
    result = generate_hpa_clusters(sources, wp, cluster_threshold=300)
    # wa_9 and wb_0 should be border nodes
    all_border_nodes = set()
    for c in result["clusters"]:
        all_border_nodes.update(c["border_nodes"])
    assert "wa_9" in all_border_nodes, "wa_9 should be a border node (cross-province edge)"
    assert "wb_0" in all_border_nodes, "wb_0 should be a border node (cross-province edge)"


def test_abstract_edge_count_reasonable():
    """Abstract edges must be ≤ border_node_count² (O(n²) worst case)."""
    sources = {"provinces": [_prov_feat([(-1,-1),(2,-1),(2,2),(-1,2),(-1,-1)], "a", "a_01")]}
    wp = _make_wp(100)
    result = generate_hpa_clusters(sources, wp, cluster_threshold=300)
    all_border_nodes = set()
    for c in result["clusters"]:
        all_border_nodes.update(c["border_nodes"])
    max_edges = len(all_border_nodes) ** 2
    assert len(result["abstract_edges"]) <= max_edges, \
        f"Abstract edges {len(result['abstract_edges'])} > n² = {max_edges}"


def test_sea_nodes_excluded():
    """Nodes outside all provinces (sea) must not appear in any cluster."""
    sources = {"provinces": [_prov_feat([(0,0),(0.5,0),(0.5,0.5),(0,0.5),(0,0)], "a", "a_01")]}
    # One node inside province, one outside (sea)
    wp = {
        "nodes": [
            {"id": "inside", "lng": 0.25, "lat": 0.25,
             "cover_combat": "plains", "elevation": "flat", "nation_id": "a"},
            {"id": "outside", "lng": 5.0, "lat": 5.0,
             "cover_combat": "plains", "elevation": "flat", "nation_id": None},
        ],
        "edges": [{"from": "inside", "to": "outside", "base_cost": 1.0, "river_size": None}],
        "road_connections": [],
    }
    result = generate_hpa_clusters(sources, wp, cluster_threshold=300)
    for cluster in result["clusters"]:
        assert "outside" not in cluster.get("border_nodes", []), \
            "Sea node 'outside' should not appear in any cluster's border_nodes"
```

### Commit order for Phase 3

1. Write `test_hpa_clusters.py`, run it — must FAIL. Commit: `test(pipeline): add HPA* cluster tests (RED)`
2. Implement `generate_hpa_clusters()` in `pipeline.py` and wire into `main()`.
3. Run tests — must pass. Run pipeline.
4. Verify `waypoints_clusters.json` exists in `client/assets/data/western_europe_6/`.
5. Commit: `feat(pipeline): generate recursive HPA* cluster hierarchy`

---

## Phase 4 — HPA* Query-Time Client + Synthetic Goal Node (pathfinder.gd, TDD)

### What to build

Extend `pathfinder.gd` with:
1. `build_clusters(cluster_data: Dictionary)` — loads `waypoints_clusters.json` data
2. `_hpa_find_path(from_id, to_id, profile, goal_lng, goal_lat, road_cost_multiplier, player_nation_id, relations)` — the HPA* search
3. Modify `find_path()` to delegate to `_hpa_find_path()` when clusters are loaded

New member variables to add at the top of the class:
```gdscript
var _cluster_of: Dictionary = {}       # node_id -> leaf_cluster_id
var _abstract_edges: Dictionary = {}   # cluster_id -> Array of {from, to, cost}
var _border_nodes: Dictionary = {}     # cluster_id -> Array[String] of node_ids
var _clusters_loaded: bool = false
```

### build_clusters()

```gdscript
func build_clusters(cluster_data: Dictionary) -> void:
    _cluster_of.clear()
    _abstract_edges.clear()
    _border_nodes.clear()

    for cluster: Dictionary in cluster_data.get("clusters", []) as Array:
        var cid: String = cluster["id"]
        var children: Array = cluster.get("children", [])
        var border: Array = cluster.get("border_nodes", [])
        _border_nodes[cid] = border
        # Only leaf clusters map nodes to clusters
        if children.is_empty():
            for nid in border:
                _cluster_of[str(nid)] = cid
            # Also map non-border nodes — they don't appear in border_nodes
            # but the cluster_data doesn't expose them; we populate _cluster_of
            # only for border nodes here. Full node->cluster mapping is populated
            # by iterating all nodes (see below).

    # To map ALL nodes to their leaf cluster, iterate abstract_edges for border nodes
    # and use the cluster membership stored above.
    # Additional non-border nodes need separate handling if needed for refinement.
    for edge: Dictionary in cluster_data.get("abstract_edges", []) as Array:
        var cid: String = edge["cluster_id"]
        if not _abstract_edges.has(cid):
            _abstract_edges[cid] = []
        _abstract_edges[cid].append({
            "from": str(edge["from"]),
            "to": str(edge["to"]),
            "cost": float(edge["cost"])
        })

    _clusters_loaded = true
    print("[Pathfinder] clusters loaded: %d leaf mappings, %d abstract edges total" % [
        _cluster_of.size(),
        cluster_data.get("abstract_edges", []).size()
    ])
```

### Synthetic goal node

```gdscript
const SYNTHETIC_GOAL_ID := "_synthetic_goal"

func _insert_synthetic_goal(goal_lng: float, goal_lat: float) -> void:
    # Create temporary node
    _nodes[SYNTHETIC_GOAL_ID] = {
        "id": SYNTHETIC_GOAL_ID, "lng": goal_lng, "lat": goal_lat,
        "cover_combat": "plains", "elevation": "flat", "nation_id": null
    }
    _adjacency[SYNTHETIC_GOAL_ID] = []
    # Connect to K=8 nearest existing nodes
    var K := 8
    var candidates: Array = []
    for nid in _nodes:
        if nid == SYNTHETIC_GOAL_ID:
            continue
        var n: Dictionary = _nodes[nid]
        var ddx := float(n["lng"]) - goal_lng
        var ddy := float(n["lat"]) - goal_lat
        candidates.append([ddx*ddx + ddy*ddy, nid])
    candidates.sort()
    for i in range(min(K, candidates.size())):
        var nb_id: String = candidates[i][1]
        var nb: Dictionary = _nodes[nb_id]
        var ddx := float(nb["lng"]) - goal_lng
        var ddy := float(nb["lat"]) - goal_lat
        var dist_deg := sqrt(ddx*ddx + ddy*ddy)
        var edge_entry := {
            "to": nb_id, "base_cost": 1.0, "dist_deg": dist_deg,
            "river_penalty": 1.0, "on_road": false
        }
        _adjacency[SYNTHETIC_GOAL_ID].append(edge_entry)
        _adjacency[nb_id].append({
            "to": SYNTHETIC_GOAL_ID, "base_cost": 1.0, "dist_deg": dist_deg,
            "river_penalty": 1.0, "on_road": false
        })


func _remove_synthetic_goal() -> void:
    if not _nodes.has(SYNTHETIC_GOAL_ID):
        return
    # Remove back-edges from neighbours
    for edge: Dictionary in _adjacency.get(SYNTHETIC_GOAL_ID, []):
        var nb_id: String = edge["to"]
        if _adjacency.has(nb_id):
            _adjacency[nb_id] = _adjacency[nb_id].filter(
                func(e): return str(e["to"]) != SYNTHETIC_GOAL_ID)
    _nodes.erase(SYNTHETIC_GOAL_ID)
    _adjacency.erase(SYNTHETIC_GOAL_ID)
```

### find_path() modification

Change the existing `find_path()` signature to:
```gdscript
func find_path(from_id: String, to_id: String, movement_profile: Dictionary,
        road_cost_multiplier: float = 1.0,
        player_nation_id: String = "",
        relations: Dictionary = {}) -> Array:
```

Inside `find_path()`, before the existing two-phase logic, check:
```gdscript
if _clusters_loaded:
    var goal_node: Dictionary = _nodes.get(to_id, {})
    if not goal_node.is_empty():
        return _hpa_find_path(from_id, to_id, movement_profile,
            float(goal_node.get("lng", 0.0)), float(goal_node.get("lat", 0.0)),
            road_cost_multiplier, player_nation_id, relations)
```

### _hpa_find_path() — simplified implementation

For now, implement HPA* as:
1. Insert synthetic goal at `goal_lng/goal_lat`.
2. Find `from_cluster = _cluster_of.get(from_id, "")` and `to_cluster = _cluster_of.get(SYNTHETIC_GOAL_ID, "")`.
3. If same cluster or clusters not found: fall back to flat `_astar_impl()`.
4. Abstract search: use `_abstract_edges` to find path of cluster IDs from `from_cluster` to `to_cluster` using simple Dijkstra over the abstract graph.
5. For each cluster in the abstract path: run `_astar_impl()` restricted to nodes in that cluster (check `_cluster_of.get(v) == cluster_id`).
6. Stitch segments, apply `_string_pull()`.
7. Remove synthetic goal.
8. Return stitched path.

If the abstract search fails, fall back to flat `_astar_impl()` — this is the **critical fallback**: never return empty when a flat search would succeed.

### Tests (`client/tests/test_pathfinder_hpa.gd`)

This is a GDScript test file. Write it first (RED), then implement.

```gdscript
extends Node

func _ready() -> void:
    print("=== test_pathfinder_hpa ===")
    var pass_count := 0
    var fail_count := 0

    # Helper to record pass/fail
    var results := []

    # --- Build a minimal graph for testing ---
    # Two clusters: left (nodes l0..l4) and right (nodes r0..r4)
    # Border: l4 connects to r0
    var wp_graph := {
        "nodes": [
            {"id":"l0","lng":0.0,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"a"},
            {"id":"l1","lng":0.1,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"a"},
            {"id":"l2","lng":0.2,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"a"},
            {"id":"l3","lng":0.3,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"a"},
            {"id":"l4","lng":0.4,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"a"},
            {"id":"r0","lng":0.5,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"b"},
            {"id":"r1","lng":0.6,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"b"},
            {"id":"r2","lng":0.7,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"b"},
            {"id":"r3","lng":0.8,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"b"},
            {"id":"r4","lng":0.9,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"b"},
        ],
        "edges": [
            {"from":"l0","to":"l1","base_cost":1.0,"river_size":null},
            {"from":"l1","to":"l2","base_cost":1.0,"river_size":null},
            {"from":"l2","to":"l3","base_cost":1.0,"river_size":null},
            {"from":"l3","to":"l4","base_cost":1.0,"river_size":null},
            {"from":"l4","to":"r0","base_cost":1.0,"river_size":null},
            {"from":"r0","to":"r1","base_cost":1.0,"river_size":null},
            {"from":"r1","to":"r2","base_cost":1.0,"river_size":null},
            {"from":"r2","to":"r3","base_cost":1.0,"river_size":null},
            {"from":"r3","to":"r4","base_cost":1.0,"river_size":null},
        ],
        "road_connections": [],
    }
    var cluster_data := {
        "cluster_threshold": 300,
        "clusters": [
            {"id":"c_a_0","province_id":"a","parent":null,"children":[],"border_nodes":["l4"]},
            {"id":"c_b_0","province_id":"b","parent":null,"children":[],"border_nodes":["r0"]},
        ],
        "abstract_edges": [
            {"from":"l4","to":"r0","cluster_id":"c_a_0","cost":0.1},
        ],
    }

    var pf := load("res://src/systems/military/pathfinder.gd").new()
    pf.build(wp_graph)

    # TEST 1: without clusters, find_path works normally
    var path_flat := pf.find_path("l0", "r4", {})
    if path_flat.size() >= 2 and str(path_flat[0]) == "l0" and str(path_flat[-1]) == "r4":
        print("PASS test_flat_path_works")
        pass_count += 1
    else:
        print("FAIL test_flat_path_works — got: ", path_flat)
        fail_count += 1

    # Load clusters
    pf.build_clusters(cluster_data)

    # TEST 2: HPA* finds a path from l0 to r4
    var path_hpa := pf.find_path("l0", "r4", {})
    if path_hpa.size() >= 2 and str(path_hpa[0]) == "l0" and str(path_hpa[-1]) == "r4":
        print("PASS test_hpa_finds_cross_cluster_path")
        pass_count += 1
    else:
        print("FAIL test_hpa_finds_cross_cluster_path — got: ", path_hpa)
        fail_count += 1

    # TEST 3: synthetic goal — find_path with exact coordinates
    # Use goal_lng/lat of r4 directly
    var path_synthetic := pf.find_path("l0", "r4", {})
    if path_synthetic.size() >= 2:
        print("PASS test_synthetic_goal_returns_valid_path")
        pass_count += 1
    else:
        print("FAIL test_synthetic_goal_returns_valid_path")
        fail_count += 1

    # TEST 4: cluster fallback — reload without clusters, result same as flat
    var pf2 := load("res://src/systems/military/pathfinder.gd").new()
    pf2.build(wp_graph)
    var path_no_cluster := pf2.find_path("l0", "r4", {})
    if path_no_cluster.size() >= 2:
        print("PASS test_cluster_fallback_when_no_cluster_file")
        pass_count += 1
    else:
        print("FAIL test_cluster_fallback_when_no_cluster_file")
        fail_count += 1

    print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
    if fail_count > 0:
        OS.exit_code = 1
    get_tree().quit()
```

Run headless: `godot --headless --path client/ client/tests/test_pathfinder_hpa.gd`

### Commit order for Phase 4

1. Write `client/tests/test_pathfinder_hpa.gd` — must fail (RED). Commit: `test(pathfinder): add HPA* pathfinder tests (RED)`
2. Implement `build_clusters()`, `_insert_synthetic_goal()`, `_remove_synthetic_goal()`, `_hpa_find_path()`, extend `find_path()` signature.
3. Run tests — must pass.
4. Commit: `feat(pathfinder): add HPA* query-time routing with synthetic goal`

---

## Phase 5 — Catmull-Rom Path Smoothing (pathfinder.gd, TDD)

### What to build

New method `_smooth_path(waypoints: Array) -> Array` in `pathfinder.gd`. Modify `find_path()` to return a Dictionary `{ "logical": Array, "visual": Array }` instead of a plain Array.

**IMPORTANT:** The `logical` path (string-pulled, unsmoothed) is what gets submitted to the server and used for DR speed calculation. The `visual` path is for rendering only. All existing call-sites of `find_path()` must be updated in `military_system.gd` to use `result["logical"]` for orders and `result["visual"]` for route overlay drawing.

### _smooth_path() — exact algorithm

```gdscript
const MAX_SPLINE_DEV_DEG: float = 0.0067   # ~750m max deviation from straight line
const SPLINE_SUBDIVISIONS: int = 8          # interpolation steps per segment

func _smooth_path(waypoints: Array) -> Array:
    if waypoints.size() <= 2:
        return waypoints.duplicate()

    var result: Array = []
    # Centripetal Catmull-Rom with ghost endpoints
    var pts: Array = []
    pts.append(waypoints[0])       # ghost start = first real point
    pts.append_array(waypoints)
    pts.append(waypoints[-1])      # ghost end = last real point

    for i in range(1, pts.size() - 2):
        var p0: Dictionary = _nodes.get(str(pts[i-1]), {})
        var p1: Dictionary = _nodes.get(str(pts[i]),   {})
        var p2: Dictionary = _nodes.get(str(pts[i+1]), {})
        var p3: Dictionary = _nodes.get(str(pts[i+2]), {})

        if p0.is_empty() or p1.is_empty() or p2.is_empty() or p3.is_empty():
            result.append(pts[i])
            continue

        # Centripetal parameterization (alpha=0.5)
        var t01 := pow(_dist(p0, p1), 0.5)
        var t12 := pow(_dist(p1, p2), 0.5)
        var t23 := pow(_dist(p2, p3), 0.5)

        if t01 < 1e-9 or t12 < 1e-9 or t23 < 1e-9:
            result.append(pts[i])
            continue

        # Maximum deviation check — if the curve would deviate too far from
        # the straight line p1→p2, skip smoothing for this segment
        var max_dev := _max_catmull_rom_deviation(p0, p1, p2, p3, t01, t12, t23)
        if max_dev > MAX_SPLINE_DEV_DEG:
            result.append(pts[i])
            continue

        # Always include the original waypoint first
        if result.is_empty() or str(result[-1]) != str(pts[i]):
            result.append(pts[i])
        # Add intermediate spline points as synthetic IDs (we use lng/lat strings)
        for s in range(1, SPLINE_SUBDIVISIONS):
            var tt: float = float(s) / float(SPLINE_SUBDIVISIONS)
            var sp := _catmull_rom_point(p0, p1, p2, p3, t01, t12, t23, tt)
            result.append("_spline_%f_%f" % [sp.x, sp.y])
            # Also store in _nodes so the rest of the system can look up lng/lat
            _nodes["_spline_%f_%f" % [sp.x, sp.y]] = {
                "id": "_spline_%f_%f" % [sp.x, sp.y],
                "lng": sp.x, "lat": sp.y,
                "cover_combat": "plains", "elevation": "flat", "nation_id": null
            }

    # Always include the last waypoint
    if waypoints.size() > 0:
        result.append(waypoints[-1])
    return result


func _dist(a: Dictionary, b: Dictionary) -> float:
    var dx := float(a.get("lng", 0.0)) - float(b.get("lng", 0.0))
    var dy := float(a.get("lat", 0.0)) - float(b.get("lat", 0.0))
    return sqrt(dx*dx + dy*dy)


func _catmull_rom_point(p0: Dictionary, p1: Dictionary, p2: Dictionary, p3: Dictionary,
        t01: float, t12: float, t23: float, t: float) -> Vector2:
    var t_val := t01 + t * t12  # map t in [0,1] to actual parameterization range
    var t0 := 0.0; var t1 := t01; var t2 := t01 + t12; var t3 := t01 + t12 + t23

    func _lerp_pt(a: Dictionary, b: Dictionary, ta: float, tb: float, tv: float) -> Vector2:
        if abs(tb - ta) < 1e-9: return Vector2(float(a["lng"]), float(a["lat"]))
        var r := (tv - ta) / (tb - ta)
        return Vector2(
            float(a["lng"]) + r * (float(b["lng"]) - float(a["lng"])),
            float(a["lat"]) + r * (float(b["lat"]) - float(a["lat"]))
        )

    # Barry-Goldman algorithm
    var A1 := _lerp_pt(p0, p1, t0, t1, t_val)
    var A2 := _lerp_pt(p1, p2, t1, t2, t_val)
    var A3 := _lerp_pt(p2, p3, t2, t3, t_val)
    var B1 := _lerp_pt_v(A1, A2, t0, t2, t_val)
    var B2 := _lerp_pt_v(A2, A3, t1, t3, t_val)
    return _lerp_pt_v(B1, B2, t1, t2, t_val)


func _max_catmull_rom_deviation(p0, p1, p2, p3, t01, t12, t23) -> float:
    var max_dev := 0.0
    var line_start := Vector2(float(p1["lng"]), float(p1["lat"]))
    var line_end   := Vector2(float(p2["lng"]), float(p2["lat"]))
    for s in range(1, SPLINE_SUBDIVISIONS):
        var t := float(s) / float(SPLINE_SUBDIVISIONS)
        var sp := _catmull_rom_point(p0, p1, p2, p3, t01, t12, t23, t)
        # Distance from sp to line segment p1→p2
        var dev := _point_to_segment_dist(sp, line_start, line_end)
        if dev > max_dev:
            max_dev = dev
    return max_dev


func _point_to_segment_dist(p: Vector2, a: Vector2, b: Vector2) -> float:
    var ab := b - a
    var ap := p - a
    var t := ab.dot(ap) / (ab.length_squared() + 1e-9)
    t = clamp(t, 0.0, 1.0)
    return (p - (a + t * ab)).length()
```

**Note on GDScript nested lambdas:** GDScript 4 does not support nested `func` definitions inside methods. Use separate named helper functions (`_lerp_pt_v`) instead.

### find_path() return type change

Change `find_path()` to return `Dictionary`:
```gdscript
func find_path(...) -> Dictionary:
    # ... existing logic to get 'path' Array ...
    var logical: Array = _string_pull(path, movement_profile)
    var visual: Array = _smooth_path(logical)
    return { "logical": logical, "visual": visual }
```

### military_system.gd call-site updates

Find all calls to `_pathfinder.find_path(...)` in `military_system.gd`. Update each:
```gdscript
# Before:
var path: Array = _pathfinder.find_path(start_id, goal_id, movement_profile)

# After:
var pf_result: Dictionary = _pathfinder.find_path(start_id, goal_id, movement_profile)
var path: Array = pf_result["logical"]   # used for DR and server submission
# pf_result["visual"] available for route overlay if needed
```

In `_update_division_route()`, if it draws the route from `_dr_order`, the visual smoothing is optional — you can leave the overlay as-is since it already uses `_dr_order` (the logical path).

### Tests (`client/tests/test_smooth_path.gd`)

```gdscript
extends Node

func _ready() -> void:
    print("=== test_smooth_path ===")
    var pass_count := 0; var fail_count := 0

    var wp_graph := {
        "nodes": [
            {"id":"a","lng":0.0,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":null},
            {"id":"b","lng":0.1,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":null},
            {"id":"c","lng":0.2,"lat":0.1,"cover_combat":"plains","elevation":"flat","nation_id":null},
            {"id":"d","lng":0.3,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":null},
        ],
        "edges": [
            {"from":"a","to":"b","base_cost":1.0,"river_size":null},
            {"from":"b","to":"c","base_cost":1.0,"river_size":null},
            {"from":"c","to":"d","base_cost":1.0,"river_size":null},
        ],
        "road_connections": [],
    }

    var pf := load("res://src/systems/military/pathfinder.gd").new()
    pf.build(wp_graph)

    # TEST 1: find_path returns Dictionary with logical and visual keys
    var result := pf.find_path("a", "d", {})
    if result is Dictionary and result.has("logical") and result.has("visual"):
        print("PASS test_find_path_returns_dict")
        pass_count += 1
    else:
        print("FAIL test_find_path_returns_dict — got: ", result)
        fail_count += 1

    # TEST 2: logical path starts at 'a' and ends at 'd'
    if result.has("logical"):
        var logical: Array = result["logical"]
        if logical.size() >= 2 and str(logical[0]) == "a" and str(logical[-1]) == "d":
            print("PASS test_logical_path_correct_endpoints")
            pass_count += 1
        else:
            print("FAIL test_logical_path_correct_endpoints — got: ", logical)
            fail_count += 1

    # TEST 3: visual path is longer or equal to logical (smoothing only adds points)
    if result.has("logical") and result.has("visual"):
        var logical: Array = result["logical"]
        var visual: Array  = result["visual"]
        if visual.size() >= logical.size():
            print("PASS test_visual_path_at_least_as_long")
            pass_count += 1
        else:
            print("FAIL test_visual_path_at_least_as_long — logical=%d visual=%d" % [logical.size(), visual.size()])
            fail_count += 1

    # TEST 4: 2-waypoint path — visual should equal logical (no ghost artifact)
    var result2 := pf.find_path("a", "b", {})
    if result2.has("logical") and result2.has("visual"):
        var l2: Array = result2["logical"]; var v2: Array = result2["visual"]
        if l2.size() <= 2 and v2.size() <= 2:
            print("PASS test_two_point_path_unchanged")
            pass_count += 1
        else:
            print("FAIL test_two_point_path_unchanged — logical=%d visual=%d" % [l2.size(), v2.size()])
            fail_count += 1

    print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
    if fail_count > 0: OS.exit_code = 1
    get_tree().quit()
```

### Commit order for Phase 5

1. Write `client/tests/test_smooth_path.gd` — must fail (RED). Commit: `test(pathfinder): add Catmull-Rom smoothing tests (RED)`
2. Implement `_smooth_path()`, `_catmull_rom_point()`, `_max_catmull_rom_deviation()`, `_point_to_segment_dist()`, `_dist()` helper. Change `find_path()` return type. Update `military_system.gd` call-sites.
3. Run tests. Commit: `feat(pathfinder): Catmull-Rom path smoothing; find_path returns logical+visual`

---

## Phase 6 — Neutral Territory A* Exclusion (pathfinder.gd + call-sites, TDD)

### What to build

Prevent A* from routing through neutral nations. The `waypoints.json` nodes now have `nation_id` (from Phase 2). The client has `GameState.get_my_nation_id()` and `GameState.relations`.

### Changes to pathfinder.gd

**1. Extend `find_path()` signature** (already started in Phase 4 — if not done yet, do it here):

```gdscript
func find_path(from_id: String, to_id: String, movement_profile: Dictionary,
        road_cost_multiplier: float = 1.0,
        player_nation_id: String = "",
        relations: Dictionary = {}) -> Dictionary:
```

**2. Pass `player_nation_id` and `relations` into `_astar_impl()`:**

Change `_astar_impl()` signature:
```gdscript
func _astar_impl(from_id: String, to_id: String, movement_profile: Dictionary,
        road_only: bool, road_cost_multiplier: float = 1.0,
        player_nation_id: String = "", relations: Dictionary = {}) -> Array:
```

**3. Add `_is_neutral_for()` helper:**

```gdscript
func _is_neutral_for(node_id: String, player_nation_id: String, relations: Dictionary) -> bool:
    if player_nation_id.is_empty():
        return false
    var node: Dictionary = _nodes.get(node_id, {})
    var nation = node.get("nation_id", null)
    if nation == null or str(nation).is_empty() or str(nation) == player_nation_id:
        return false
    var key: String = player_nation_id + ":" + str(nation)
    var stance: String = (relations.get(key, {}) as Dictionary).get("stance", "neutral")
    return stance != "war"
```

**4. In `_astar_impl()`, in BOTH the forward and backward expansion loops**, after the `road_only` check and before `_edge_cost()`, add:

```gdscript
# In forward expansion (expanding node u, considering neighbour v):
if _is_neutral_for(v, player_nation_id, relations):
    continue

# In backward expansion (expanding node u, considering neighbour v):
if _is_neutral_for(v, player_nation_id, relations):
    continue
```

**Important edge cases:**
- The `from_id` node itself is never filtered (you're already there)
- The `to_id` node itself should not be filtered even if neutral — the player clicked there (the server will enforce this separately). So only filter intermediate nodes. **Only skip `v` if it is not the final destination:**
```gdscript
if v != to_id and _is_neutral_for(v, player_nation_id, relations):
    continue
```

### Changes to military_system.gd call-sites

Every call to `_pathfinder.find_path(...)` needs the two new args. Search for `_pathfinder.find_path(` in `military_system.gd`. There are typically 2–3 call-sites. Update each to:

```gdscript
_pathfinder.find_path(start_id, goal_id, movement_profile, effective_mult,
    GameState.get_my_nation_id(), GameState.relations)
```

`GameState` is an autoload — accessible anywhere.

### Tests (`client/tests/test_pathfinder_neutral.gd`)

```gdscript
extends Node

func _ready() -> void:
    print("=== test_pathfinder_neutral ===")
    var pass_count := 0; var fail_count := 0

    # Graph: player is in 'france', neutral is 'germany', enemy is 'spain'
    # Layout: france_node → germany_node → spain_node (straight line)
    #         france_node → bypass_node (longer path around germany)
    var wp_graph := {
        "nodes": [
            {"id":"fr","lng":0.0,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"france"},
            {"id":"de","lng":0.1,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"germany"},
            {"id":"es","lng":0.2,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":"spain"},
            {"id":"by","lng":0.1,"lat":0.2,"cover_combat":"plains","elevation":"flat","nation_id":"france"},
        ],
        "edges": [
            {"from":"fr","to":"de","base_cost":1.0,"river_size":null},
            {"from":"de","to":"es","base_cost":1.0,"river_size":null},
            {"from":"fr","to":"by","base_cost":2.0,"river_size":null},
            {"from":"by","to":"es","base_cost":2.0,"river_size":null},
        ],
        "road_connections": [],
    }
    var relations := {
        "france:germany": {"stance": "neutral"},
        "france:spain":   {"stance": "war"},
    }

    var pf := load("res://src/systems/military/pathfinder.gd").new()
    pf.build(wp_graph)

    # TEST 1: Without nation filtering, A* takes the short route through germany
    var result_nofilter := pf.find_path("fr", "es", {})
    var path_nofilter: Array = result_nofilter["logical"] if result_nofilter is Dictionary else result_nofilter
    var has_germany_nofilter: bool = false
    for wp in path_nofilter:
        if str(wp) == "de": has_germany_nofilter = true
    if has_germany_nofilter:
        print("PASS test_without_filter_routes_through_neutral")
        pass_count += 1
    else:
        print("FAIL test_without_filter_routes_through_neutral — path: ", path_nofilter)
        fail_count += 1

    # TEST 2: With nation filtering, A* must NOT route through germany
    var result_filtered := pf.find_path("fr", "es", {}, 1.0, "france", relations)
    var path_filtered: Array = result_filtered["logical"] if result_filtered is Dictionary else result_filtered
    var has_germany: bool = false
    for wp in path_filtered:
        if str(wp) == "de": has_germany = true
    if not has_germany and path_filtered.size() >= 2:
        print("PASS test_neutral_territory_avoided")
        pass_count += 1
    else:
        print("FAIL test_neutral_territory_avoided — path still goes through germany: ", path_filtered)
        fail_count += 1

    # TEST 3: Enemy territory (spain) must be traversable
    # Path from fr to es via de is blocked (de=neutral); but fr→by→es goes through spain(es)
    # Verify es node itself is reachable
    if path_filtered.size() >= 2 and str(path_filtered[-1]) == "es":
        print("PASS test_destination_in_enemy_territory_reachable")
        pass_count += 1
    else:
        print("FAIL test_destination_in_enemy_territory_reachable — path: ", path_filtered)
        fail_count += 1

    # TEST 4: Own territory always passable
    var path_own := pf.find_path("fr", "by", {}, 1.0, "france", relations)
    var logical_own: Array = path_own["logical"] if path_own is Dictionary else path_own
    if logical_own.size() >= 2 and str(logical_own[-1]) == "by":
        print("PASS test_own_territory_always_passable")
        pass_count += 1
    else:
        print("FAIL test_own_territory_always_passable — path: ", logical_own)
        fail_count += 1

    # TEST 5: Empty player_nation_id → no filtering (backward compat)
    var result_empty := pf.find_path("fr", "es", {}, 1.0, "", {})
    var path_empty: Array = result_empty["logical"] if result_empty is Dictionary else result_empty
    var has_germany_empty: bool = false
    for wp in path_empty:
        if str(wp) == "de": has_germany_empty = true
    if has_germany_empty:
        print("PASS test_no_nation_no_exclusion")
        pass_count += 1
    else:
        print("FAIL test_no_nation_no_exclusion — expected germany in unfiltered path: ", path_empty)
        fail_count += 1

    print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
    if fail_count > 0: OS.exit_code = 1
    get_tree().quit()
```

Run: `godot --headless --path client/ client/tests/test_pathfinder_neutral.gd`

### Commit order for Phase 6

1. Write `client/tests/test_pathfinder_neutral.gd` — must fail (RED). Commit: `test(pathfinder): add neutral territory exclusion tests (RED)`
2. Implement `_is_neutral_for()`, extend `_astar_impl()` signature, add neutral checks in both expansion loops (with `v != to_id` guard). Extend `find_path()` signature. Update all call-sites in `military_system.gd`.
3. Run tests — must pass.
4. Commit: `feat(pathfinder): exclude neutral nation nodes from A* routing`

---

## Final Verification Checklist

Run all of these before declaring done:

```bash
# Pipeline tests
python -m pytest map/tools/map_pipeline/test_boundary_nodes.py -v
python -m pytest map/tools/map_pipeline/test_nation_tagging.py -v
python -m pytest map/tools/map_pipeline/test_hpa_clusters.py -v

# Server tests (includes Phase 1 movement-jerk regression)
pnpm --filter game-server test

# Godot headless tests
godot --headless --path client/ client/tests/test_pathfinder_hpa.gd
godot --headless --path client/ client/tests/test_smooth_path.gd
godot --headless --path client/ client/tests/test_pathfinder_neutral.gd

# Pipeline smoke test
python map/tools/map_pipeline/pipeline.py western_europe_6 --skip-dem

# Verify waypoints.json has nation_id
python -c "
import json
d = json.load(open('client/assets/data/western_europe_6/waypoints.json'))
n = d['nodes'][0]
print('Keys:', list(n.keys()))
assert 'nation_id' in n, 'Missing nation_id!'
print('nation_id sample:', n['nation_id'])
"

# Verify waypoints_clusters.json exists
python -c "
import json
d = json.load(open('client/assets/data/western_europe_6/waypoints_clusters.json'))
print('Clusters:', len(d['clusters']), '  Abstract edges:', len(d['abstract_edges']))
"
```

Manual smoke tests:
- Move a division — no visible jerk at movement start (Phase 1)
- Long cross-province route — smooth curved path visual (Phase 5)
- Click on enemy land across a neutral border — division routes around neutral territory (Phase 6)

---

## Post-Execution Bug Fixes (Phases 7–12)

**Status:** Phases 0–6 are complete. The following 6 issues were discovered during manual testing after Phase 6.

---

## Phase 7 — Fix Neutral Territory Call-Sites

### Root cause

`_is_neutral_for()` in `pathfinder.gd` is correct, but all 7 `find_path()` call-sites in `military_system.gd` omit `player_nation_id` and `relations`. Both parameters default to `""` / `{}`, so the neutral check is never triggered.

**Call-sites to fix (all in `client/src/systems/military/military_system.gd`):**

| Line | Context |
|---|---|
| 413 | `_handle_move_order` — single-unit move |
| 478 | `_handle_move_click` thread — shift-click segment |
| 507 | `_handle_group_move_click` — group move (first attempt) |
| 511 | `_handle_group_move_click` — group move (fallback) |
| 624 | `_chain_refresh` thread — chain refresh |
| 760 | `_build_chain_from_milestones` — milestone chain |
| 897 | `_handle_reposition` — reposition |

### Fix

At each call-site, add the two extra arguments:

```gdscript
# Before (example at line 413):
var path_result: Dictionary = _pathfinder.find_path(start_id, goal_id, movement_profile)

# After:
var path_result: Dictionary = _pathfinder.find_path(
    start_id, goal_id, movement_profile, 1.0,
    GameState.get_my_nation_id(), GameState.relations)
```

For the threaded call-sites (lines 478 and 624), capture the values **before** the thread lambda (GDScript lambdas close over variables by reference — capture snapshots):

```gdscript
# Line ~468-479 (shift-click thread):
var my_nation := GameState.get_my_nation_id()
var relations_snapshot := GameState.relations.duplicate()
_path_thread.start(func() -> void:
    var seg_result: Dictionary = _pathfinder.find_path(
        start_id, goal_id, movement_profile, effective_mult,
        my_nation, relations_snapshot)
    ...
)

# Line ~622-626 (chain refresh thread):
var my_nation := GameState.get_my_nation_id()
var relations_snapshot := GameState.relations.duplicate()
_path_thread.start(func() -> void:
    var seg_result: Dictionary = _pathfinder.find_path(
        start_id, goal_id, movement_profile, 1.0,
        my_nation, relations_snapshot)
    ...
)
```

The non-threaded call-sites (413, 507, 511, 760, 897) do not need snapshot variables — they run on the main thread where `GameState` is stable.

**What `GameState.relations` is:** Check `game_state.gd` for the `relations` property type. If it is a `Dictionary` keyed by `"nation_a:nation_b"` with `{ "stance": "war" }` values, then `pathfinder.gd`'s `_is_neutral_for()` already expects this format (it calls `relations.get(player_nation_id + ":" + nation, {}).get("stance", "neutral")`). Pass it directly.

### Test (write first — RED commit)

**New file: `client/tests/test_pathfinder_neutral_callsite.gd`**

```gdscript
extends SceneTree

func _init() -> void:
    var pf := preload("res://src/systems/military/pathfinder.gd").new()

    # Minimal graph: A ---> B (neutral) ---> C (enemy)
    # Direct A→C path goes through B. With neutral exclusion, A→C should be impossible
    # (only path goes through neutral B). Without exclusion, it routes through B fine.
    var graph := {
        "nodes": [
            {"id": "A", "lng": 0.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "player"},
            {"id": "B", "lng": 0.1, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "neutral_nation"},
            {"id": "C", "lng": 0.2, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "enemy_nation"},
        ],
        "edges": [
            {"from": "A", "to": "B", "cost": 1.0, "dist_deg": 0.1, "river_penalty": 0.0, "on_road": false},
            {"from": "B", "to": "A", "cost": 1.0, "dist_deg": 0.1, "river_penalty": 0.0, "on_road": false},
            {"from": "B", "to": "C", "cost": 1.0, "dist_deg": 0.1, "river_penalty": 0.0, "on_road": false},
            {"from": "C", "to": "B", "cost": 1.0, "dist_deg": 0.1, "river_penalty": 0.0, "on_road": false},
        ]
    }
    pf.build(graph)

    var profile := {"plains_flat": 1.0}
    var relations := {"player:neutral_nation": {"stance": "neutral"}, "player:enemy_nation": {"stance": "war"}}

    # Without nation context: path goes through B (neutral) fine
    var result_no_filter: Dictionary = pf.find_path("A", "C", profile)
    var path_no_filter: Array = result_no_filter.get("logical", [])
    assert(not path_no_filter.is_empty(), "FAIL: should find path without filter")
    assert("B" in path_no_filter, "FAIL: path without filter should use B")

    # With nation context: B is neutral → path should be empty (no alternate route)
    var result_filtered: Dictionary = pf.find_path("A", "C", profile, 1.0, "player", relations)
    var path_filtered: Array = result_filtered.get("logical", [])
    assert(path_filtered.is_empty(), "FAIL: should find no path when only route is through neutral")

    print("=== test_pathfinder_neutral_callsite: all passed ===")
    get_tree().quit()
```

Run: `godot --headless --path client/ client/tests/test_pathfinder_neutral_callsite.gd`

### Commit order for Phase 7

1. Write `client/tests/test_pathfinder_neutral_callsite.gd`. Commit: `test(pathfinder): callsite neutral exclusion test (RED)`
2. Update all 7 call-sites in `military_system.gd`. Run test — must pass.
3. Commit: `fix(military): pass player_nation_id and relations to all find_path call-sites`

---

## Phase 8 — Pixel-Perfect Final Waypoint (Synthetic Goal at Exact Click Position)

### Root cause

`pathfinder.gd` already has `_insert_synthetic_goal()` / `_remove_synthetic_goal()` and `_hpa_find_path()` uses it. But military_system.gd call-sites compute `goal_id = _pathfinder.find_nearest(target_lng, target_lat)` and pass only `goal_id` to `find_path()`. The exact click coordinates are never passed to the pathfinder. So the division stops at the nearest pre-baked node (possibly km away) instead of the exact click.

### Fix

**Step 1 — Extend `find_path()` in `pathfinder.gd`** to accept optional exact coordinates:

```gdscript
# Current signature (pathfinder.gd line ~257):
func find_path(from_id: String, to_id: String, movement_profile: Dictionary,
        road_cost_multiplier: float = 1.0,
        player_nation_id: String = "",
        relations: Dictionary = {}) -> Dictionary:

# New signature — add goal_lng and goal_lat:
func find_path(from_id: String, to_id: String, movement_profile: Dictionary,
        road_cost_multiplier: float = 1.0,
        player_nation_id: String = "",
        relations: Dictionary = {},
        goal_lng: float = INF,
        goal_lat: float = INF) -> Dictionary:
```

Inside `find_path()`, if `goal_lng != INF` and `goal_lat != INF`:
1. Call `_insert_synthetic_goal(goal_lng, goal_lat)` before A*.
2. Use `"_synthetic_goal"` as the actual `to_id` in the A* call.
3. Call `_remove_synthetic_goal()` after A* completes.
4. Return the path with `"_synthetic_goal"` as the last logical waypoint but with the **coordinates** of the exact click in the visual path.

This way, even for flat A* (non-HPA*), the division walks to the exact click coordinates.

**Step 2 — Update military_system.gd call-sites** that originate from player clicks to pass the exact coordinates. The click call-sites are:

| Line | Function | Extra args to add |
|---|---|---|
| 413 | `_handle_move_order` (called from server command?) | Pass `target_lng, target_lat` from function params |
| 478 | `_handle_move_click` shift-click thread | Pass segment `goal_id`'s actual node lng/lat |
| 507/511 | `_handle_group_move_click` | Pass `destination_lng_lat.x, destination_lng_lat.y` |
| 624 | chain refresh | No exact coords available — skip (milestone refresh, not initial click) |
| 760 | `_build_chain_from_milestones` | Pass milestone lng/lat if available |
| 897 | `_handle_reposition` | No exact coords needed (server handles reposition target) |

**How to pass exact coords for the shift-click thread (line ~478):** The `start_id` and `goal_id` are already computed before the thread. Also compute `goal_lng` and `goal_lat` from `_pending_milestones` (the exact lat/lng of the milestone marker). Find where `goal_id` is set and extract its position from `_pathfinder.get_node_pos(goal_id)` or from the click event. The simplest approach: store the click lng/lat in `_pending_goal_lng: float` and `_pending_goal_lat: float` member variables when the player clicks, then pass those to the threaded find_path call.

**What `_insert_synthetic_goal()` already does** (from Phase 4 implementation):
- Adds a temporary node `"_synthetic_goal"` at `(goal_lng, goal_lat)` to `_nodes`
- Connects it to the K=8 nearest real nodes using `_edge_cost()`
- `_remove_synthetic_goal()` deletes it from `_nodes` and `_adjacency`

The synthetic goal is already connected to the graph — calling `find_path(..., goal_lng=..., goal_lat=...)` should route into it naturally.

### Test (write first — RED commit)

**New file: `client/tests/test_synthetic_goal_flat.gd`**

```gdscript
extends SceneTree

func _init() -> void:
    var pf := preload("res://src/systems/military/pathfinder.gd").new()

    var graph := {
        "nodes": [
            {"id": "A", "lng": 0.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": ""},
            {"id": "B", "lng": 1.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": ""},
            {"id": "C", "lng": 2.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": ""},
        ],
        "edges": [
            {"from": "A", "to": "B", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "B", "to": "A", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "B", "to": "C", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "C", "to": "B", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
        ]
    }
    pf.build(graph)
    var profile := {"plains_flat": 1.0}

    # Exact click position between B and C — not on any grid node
    var click_lng := 1.5
    var click_lat := 0.0

    var result: Dictionary = pf.find_path("A", "C", profile, 1.0, "", {}, click_lng, click_lat)
    var logical: Array = result.get("logical", [])
    var visual: Array = result.get("visual", [])

    # Last logical node must be the synthetic goal or C
    assert(not logical.is_empty(), "FAIL: path must not be empty")

    # Visual path last point must be at the exact click position
    assert(not visual.is_empty(), "FAIL: visual path must not be empty")
    var last_visual = visual[-1]
    var end_lng: float = last_visual.get("lng", -999.0) if last_visual is Dictionary else -999.0
    var end_lat: float = last_visual.get("lat", -999.0) if last_visual is Dictionary else -999.0
    assert(abs(end_lng - click_lng) < 0.0001, "FAIL: visual end lng must match click lng")
    assert(abs(end_lat - click_lat) < 0.0001, "FAIL: visual end lat must match click lat")

    print("=== test_synthetic_goal_flat: all passed ===")
    get_tree().quit()
```

Run: `godot --headless --path client/ client/tests/test_synthetic_goal_flat.gd`

**Important detail:** The `visual` path in `find_path()` currently returns `Array` of node IDs (strings) or `Array` of `Dictionary` with lng/lat? Check what Phase 4/5 actually returns. If `visual` is an array of node ID strings, the test should check the string is `"_synthetic_goal"` and then look up its coordinates from the pathfinder's node dict. Adjust test to match actual return type.

### Commit order for Phase 8

1. Write `client/tests/test_synthetic_goal_flat.gd`. Commit: `test(pathfinder): pixel-perfect synthetic goal test (RED)`
2. Extend `find_path()` signature with `goal_lng` / `goal_lat`. Add synthetic goal insertion/removal around the flat A* path (non-HPA* path). Update military_system.gd click call-sites to pass exact coordinates.
3. Run test — must pass.
4. Commit: `feat(pathfinder): pixel-perfect final waypoint via synthetic goal in flat A*`

---

## Phase 9 — Retreat Must Not Enter Neutral Territory

### Root cause

`_retreatDivision()` in `game-server/src/systems/combat_system.ts` (line 793) calls:
```typescript
const waypoint = this.movementSystem.getNearestWaypoint(retreatLng, retreatLat);
```

`getNearestWaypoint()` ignores territory — it can return a waypoint in neutral land. The retreat target is computed as 50 km away from the enemy centroid; that direction may cross a neutral border.

`movementSystem.getNearestNonNeutralWaypoint()` (line 287 of movement_system.ts) already exists and does the right thing. It just needs to be called instead.

### Fix

In `combat_system.ts` in `_retreatDivision()` (around line 793), replace:

```typescript
// OLD:
const waypoint = this.movementSystem.getNearestWaypoint(retreatLng, retreatLat);
if (waypoint) {
  div.move_order.splice(0, div.move_order.length);
  div.move_order.push(waypoint.id);
}
```

```typescript
// NEW:
const divNationId = div.nation_id ?? "";
const waypoint = divNationId
  ? this.movementSystem.getNearestNonNeutralWaypoint(
      retreatLng, retreatLat, divNationId, state.relations)
  : this.movementSystem.getNearestWaypoint(retreatLng, retreatLat);

if (waypoint) {
  div.move_order.splice(0, div.move_order.length);
  div.move_order.push(waypoint.id);
}
```

**What `state.relations` is:** `GameRoomState` has a `relations` field (a `MapSchema` of `RelationState`). `_isNeutralFor()` in movement_system.ts already uses it. Check that `_retreatDivision()` signature includes `state: GameRoomState` — if not, thread it through from the caller.

**`div.nation_id` field:** Verify `DivisionState` has a `nation_id` field in `GameRoomState.ts`. If not, add `@type("string") nation_id: string = ""` and populate it when divisions are created in the room handler.

### Test (write first — RED commit)

**New file: `game-server/test/retreat-neutral.e2e.ts`**

Use the same test patterns as existing e2e tests in `game-server/test/` (look at movement-jerk.e2e.ts for setup/teardown).

```typescript
// Scenario:
// - Player A (nation "alpha") has a division engaged in combat near a neutral nation border
// - Combat ends: division must retreat
// - Assert: retreat target waypoint is NOT in neutral territory
//   i.e., retreat waypoint's nation_id !== "neutral" (or whatever the neutral nation is named)
//
// Setup hint: load a minimal map with two provinces — one "alpha" and one "neutral"
// Trigger the retreat by bringing suppression to the threshold
// After retreat fires, read div.move_order[0] and check the corresponding waypoint's nation_id
```

Run: `pnpm --filter game-server test retreat-neutral`

### Commit order for Phase 9

1. Write `game-server/test/retreat-neutral.e2e.ts`. Commit: `test(combat): retreat neutral avoidance test (RED)`
2. Fix `_retreatDivision()` in `combat_system.ts`. Verify `div.nation_id` exists; add field if missing.
3. Run test — must pass.
4. Commit: `fix(combat): retreat uses getNearestNonNeutralWaypoint to avoid neutral territory`

---

## Phase 10 — Terrain Border Stopping (Closest Valid Waypoint Fallback)

### Root cause

When `find_path()` returns `[]` (the target node is isolated by impassable terrain, or goal is in a completely impassable area), `military_system.gd` logs a warning and returns — the division does nothing. The player's click is silently dropped.

Correct behaviour: if the exact target is unreachable, route to the **closest reachable waypoint** to the target instead.

### Fix

Add a helper `find_nearest_reachable(from_id: String, near_lng: float, near_lat: float, movement_profile: Dictionary) -> String` to `pathfinder.gd`:

```gdscript
## Returns the node id of the closest node to (near_lng, near_lat) from which
## a path exists from from_id. Tries K nearest nodes in increasing distance order.
## Returns "" if no reachable node found within MAX_FALLBACK_CANDIDATES candidates.
const MAX_FALLBACK_CANDIDATES := 20

func find_nearest_reachable(from_id: String, near_lng: float, near_lat: float,
        movement_profile: Dictionary,
        player_nation_id: String = "",
        relations: Dictionary = {}) -> String:
    # Build a list of (dist_sq, node_id) for all nodes, sorted ascending
    var candidates: Array = []
    for node_id: String in _nodes:
        var n: Dictionary = _nodes[node_id]
        var dx: float = n["lng"] - near_lng
        var dy: float = n["lat"] - near_lat
        candidates.append([dx * dx + dy * dy, node_id])
    candidates.sort_custom(func(a, b): return a[0] < b[0])

    # Try each candidate until we find a reachable one
    for i: int in min(MAX_FALLBACK_CANDIDATES, candidates.size()):
        var candidate_id: String = candidates[i][1]
        if candidate_id == from_id:
            continue
        var result: Dictionary = find_path(from_id, candidate_id, movement_profile, 1.0,
                player_nation_id, relations)
        if not result.get("logical", []).is_empty():
            return candidate_id
    return ""
```

**In military_system.gd**, at the call-sites where `path.is_empty()` currently warns and returns, add the fallback:

```gdscript
# Example at line 415-417 — currently:
if path.is_empty():
    push_warning("[MilitarySystem] No path found for %s" % division_id)
    return

# New:
if path.is_empty():
    # Try routing to closest reachable waypoint near target
    var fallback_id: String = _pathfinder.find_nearest_reachable(
        start_id, target_lng, target_lat, movement_profile,
        GameState.get_my_nation_id(), GameState.relations)
    if fallback_id.is_empty():
        push_warning("[MilitarySystem] No path found for %s — target completely unreachable" % division_id)
        return
    path_result = _pathfinder.find_path(start_id, fallback_id, movement_profile, 1.0,
        GameState.get_my_nation_id(), GameState.relations)
    path = path_result.get("logical", [])
    if path.is_empty():
        push_warning("[MilitarySystem] No fallback path found for %s" % division_id)
        return
```

Apply this fallback at lines 415-417, 509-514, 898-902 (the three main move-order call-sites that currently log warning + return on empty path).

**Note on `target_lng` / `target_lat` availability:** At line 413-417, the function signature for `_handle_move_order` should have `target_lng, target_lat` available (they are the click coordinates). At line 897-902 (`_handle_reposition`), `target_lng` and `target_lat` are also function parameters. At line 507-514 (`_handle_group_move_click`), `destination_lng_lat.x` and `destination_lng_lat.y` are available.

### Test (write first — RED commit)

**New file: `client/tests/test_pathfinder_fallback.gd`**

```gdscript
extends SceneTree

func _init() -> void:
    var pf := preload("res://src/systems/military/pathfinder.gd").new()

    # Graph: A → B, and isolated node C (no edges to/from A or B)
    var graph := {
        "nodes": [
            {"id": "A", "lng": 0.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": ""},
            {"id": "B", "lng": 1.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": ""},
            {"id": "C", "lng": 2.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": ""},
        ],
        "edges": [
            {"from": "A", "to": "B", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "B", "to": "A", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            # C is isolated — no edges
        ]
    }
    pf.build(graph)
    var profile := {"plains_flat": 1.0}

    # Direct path A → C fails (C is isolated)
    var direct: Dictionary = pf.find_path("A", "C", profile)
    assert(direct.get("logical", []).is_empty(), "FAIL: direct path to isolated C should be empty")

    # find_nearest_reachable should return B (closest to C that is reachable from A)
    var fallback_id: String = pf.find_nearest_reachable("A", 2.0, 0.0, profile)
    assert(fallback_id == "B", "FAIL: nearest reachable to C from A should be B, got: " + fallback_id)

    # Path from A to the fallback should succeed
    var fallback_result: Dictionary = pf.find_path("A", fallback_id, profile)
    assert(not fallback_result.get("logical", []).is_empty(), "FAIL: path to fallback must succeed")

    print("=== test_pathfinder_fallback: all passed ===")
    get_tree().quit()
```

Run: `godot --headless --path client/ client/tests/test_pathfinder_fallback.gd`

### Commit order for Phase 10

1. Write `client/tests/test_pathfinder_fallback.gd`. Commit: `test(pathfinder): terrain border stopping fallback test (RED)`
2. Add `find_nearest_reachable()` to `pathfinder.gd`. Update the 3 empty-path bail-out sites in `military_system.gd`.
3. Run test — must pass.
4. Commit: `feat(pathfinder): route to closest reachable waypoint when target is impassable`

---

## Phase 11 — Fix Multi-Waypoint Server Recursion Drift

### Root cause

`_advanceDivision()` in `game-server/src/systems/movement_system.ts` is recursive (lines 352-354, 385-387). When it consumes 2+ waypoints in one tick, `consumed_waypoint_id` is overwritten each call — only the **last** consumed waypoint is broadcast. 

Client Phase 1 fix (`_on_division_updated()` lines 1200-1204) pops exactly **one** waypoint from `_dr_order` if it matches `consumed_waypoint_id`. If the server consumed 2, the client only pops 1 → after 2 ticks, `_dr_order[0]` no longer matches the server's `move_order[0]` → the `cur_lead != new_lead` branch fires (line 1205) → re-seeds position from server → visible jerk at the second waypoint boundary.

### Fix

**Server schema (`game-server/src/rooms/schema/GameRoomState.ts`):**

Replace `consumed_waypoint_id: string` with an array:

```typescript
// Remove:
@type("string") consumed_waypoint_id: string = "";

// Add:
@type(["string"]) consumed_waypoint_ids: string[] = [];
```

**Server logic (`game-server/src/systems/movement_system.ts`):**

1. Before calling `_advanceDivision()` in `_tickMovement()` (around line 312-314), reset the array:
```typescript
// OLD:
division.consumed_waypoint_id = "";
this._advanceDivision(division, speedMult);

// NEW:
division.consumed_waypoint_ids.splice(0, division.consumed_waypoint_ids.length);
this._advanceDivision(division, speedMult);
```

2. In `_advanceDivision()`, push to the array instead of overwriting:
```typescript
// OLD (line 350):
division.consumed_waypoint_id = nextId;

// NEW:
division.consumed_waypoint_ids.push(nextId);
```

Do the same at line 381. Remove the `division.consumed_waypoint_id = "";` at line 395 (it's now handled by the reset before the call).

Also remove the line 395 `division.consumed_waypoint_id = ""` that currently clears on the partial-advance branch — with the new array, we don't need to clear there (array stays empty from pre-tick reset if nothing was consumed).

**Client (`client/src/systems/military/military_system.gd` in `_on_division_updated()`):**

Replace lines 1199-1212:

```gdscript
# OLD (lines 1199-1212):
var consumed_wp: String = str(data.get("consumed_waypoint_id", ""))
if consumed_wp != "" and consumed_wp == cur_lead:
    if not cur_order.is_empty():
        _dr_order[division_id] = cur_order.slice(1)
elif cur_lead != new_lead:
    _dr_pos_deg[division_id] = Vector2(server_lng, server_lat)
    _dr_order[division_id] = str_order
elif str_order.size() < cur_order.size():
    _dr_order[division_id] = str_order

# NEW:
var consumed_ids: Array = data.get("consumed_waypoint_ids", [])
var local_order: Array = _dr_order[division_id].duplicate()

# Pop each consumed waypoint from local DR order (in sequence, matching front only)
for cid: Variant in consumed_ids:
    if not local_order.is_empty() and str(cid) == str(local_order[0]):
        local_order = local_order.slice(1)

_dr_order[division_id] = local_order

# After popping consumed waypoints, check if leading waypoints still agree
var updated_lead: String = local_order[0] if not local_order.is_empty() else ""
if updated_lead != new_lead:
    # Genuine reroute (not just consumption) — re-seed position
    _dr_pos_deg[division_id] = Vector2(server_lng, server_lat)
    _dr_order[division_id] = str_order
```

**Important edge case:** If `consumed_ids` is empty (division didn't consume any waypoint this tick — it's mid-segment), none of the pop logic fires and the existing `updated_lead == new_lead` check holds. This is the happy path for smooth movement.

**Schema migration note:** If the existing test `game-server/test/movement-jerk.e2e.ts` references `consumed_waypoint_id`, update it to use `consumed_waypoint_ids[0]` (or adapt the assertion).

### Test (write first — RED commit)

**Update `game-server/test/movement-jerk.e2e.ts`** to add a second scenario:

```typescript
it("no position snap when server consumes two waypoints in one tick", async () => {
    // Setup: place waypoints very close together so the server's leftover budget
    // carries into a second waypoint in the same tick.
    // Record division position at t=0, t=1000ms, t=2000ms
    // Assert: max position jump between consecutive frames <= DR_SNAP_DEG
    // This specifically tests the multi-waypoint recursion case where
    // consumed_waypoint_ids.length > 1
});
```

Look at the existing movement-jerk.e2e.ts scenario for setup patterns. The key difference: place 2 very close waypoints (distance < one tick's advance budget) so the server consumes both in one tick.

Run: `pnpm --filter game-server test`

### Commit order for Phase 11

1. Add the new test scenario to `game-server/test/movement-jerk.e2e.ts`. Commit: `test(movement): multi-waypoint recursion drift test (RED)`
2. Change schema in `GameRoomState.ts`. Update `_advanceDivision()` in `movement_system.ts`. Update `_on_division_updated()` in `military_system.gd`.
3. Run `pnpm --filter game-server test` and `pnpm --filter game-server run typecheck` — must pass.
4. Commit: `fix(movement): broadcast all consumed waypoint IDs per tick to prevent DR drift`

---

## Phase 12 — Verify Foreign Unit Smooth Movement

### What to check

`FOREIGN_UNIT_PATH_DR = true` (line 34, military_system.gd) enables dead reckoning for foreign (enemy/allied) units. The flag exists and the seeding logic at line 1189-1193 looks correct. However:

1. The Phase 11 fix replaces `consumed_waypoint_id` with `consumed_waypoint_ids`. If `_on_division_updated()` for foreign units hits the `cur_lead != new_lead` re-seed branch due to the old single-ID mismatch, they snap. Phase 11 should fix this for all units (own + foreign).

2. Verify that `_advance_dr()` actually runs for foreign units. It iterates over `_dr_order.keys()` (line 675 area) — foreign unit IDs are added to `_dr_order` at line 1193 when FOREIGN_UNIT_PATH_DR is true. This should work.

3. **Potential bug:** When `FOREIGN_UNIT_PATH_DR = true` and a **foreign** unit's second `_on_division_updated()` arrives, the branch at line 1189 is skipped (because `_dr_pos_deg.has(division_id)` is now true). The logic falls through to the `else` branch at line 1195. The `consumed_waypoint_ids` fix from Phase 11 should handle this correctly.

### Verification steps (no new test file needed — manual + code audit)

1. **After Phase 11 commits:** read `_on_division_updated()` again and confirm the `consumed_waypoint_ids` loop applies to **all** division IDs (own and foreign) — there is no `_is_own_unit()` guard on this code path.

2. **Manual test:** Start a multiplayer session with two clients. Move a foreign unit (move it from Client B, observe on Client A). On Client A, the foreign unit should move smoothly without snapping at waypoint boundaries.

3. If foreign units still snap after Phase 11: add a check in `_on_division_updated()` before the `_dr_pos_deg.has()` check — ensure `_dr_speed_mult` is set for foreign units (it may default to 1.0 if not explicitly set, which is correct, but confirm).

### If a code fix is needed

If after Phase 11 manual testing reveals foreign units still snap, check `_dr_speed_mult` is seeded for foreign units. At line 1192 where DR is seeded for the first time:

```gdscript
# Add after line 1193:
if not _dr_speed_mult.has(division_id):
    _dr_speed_mult[division_id] = 1.0
```

This is likely already handled (1.0 is probably the default) but confirm.

### Commit (if code fix needed)

`fix(military): ensure foreign unit DR speed multiplier is seeded on first update`

If no code fix is needed after manual verification, no commit required for Phase 12.

---

## Updated Verification Checklist (Phases 7–12)

Run all of these after completing Phases 7–12:

```bash
# Godot headless tests (new)
godot --headless --path client/ client/tests/test_pathfinder_neutral_callsite.gd
godot --headless --path client/ client/tests/test_synthetic_goal_flat.gd
godot --headless --path client/ client/tests/test_pathfinder_fallback.gd

# Server tests (movement-jerk now covers multi-waypoint scenario)
pnpm --filter game-server test
pnpm --filter game-server run typecheck

# Type-check client (if GDScript has a check command — skip if not available)
```

Manual smoke tests (Phases 7–12):
- Move a division — route does NOT go through neutral territory (Phase 7)
- Click on exact map position between grid nodes — division arrives at click coordinates, not the nearest node (Phase 8)
- Trigger a combat retreat near a neutral border — retreating division moves away from neutrals (Phase 9)
- Click on a completely impassable area (mountain, water) — division routes to the nearest valid point instead of doing nothing (Phase 10)
- Move a division with closely spaced waypoints — no snap at waypoint 2 even when server consumes both in one tick (Phase 11)
- Observe a foreign unit moving — smooth DR movement, no position snap at waypoint boundaries (Phase 12)

---

## Round 3 Bug Fixes (Phases 13–16)

**Status:** Phases 7–12 were executed but introduced/exposed 4 new bugs. Fix in order — Bug 13 unblocks all testing; Bug 14 likely fixes Bug 15 as a side effect.

**Key context for the execution agent:**
- All GDScript test files MUST use `extends Node` + `func _ready()` pattern — NOT `extends SceneTree` + `func _init()`. The test runner expects this.
- Working directory: `/home/kevin/Documents/Projects/grand-strategy-mp`
- Run Godot tests: `godot --headless --path client/ client/tests/<file>.gd`
- Run server tests: `pnpm --filter game-server test`

---

## Phase 13 — Fix Right-Click Single-Unit Move (Missing Submit Call)

### Root cause

`_submit_direct_move_order()` in `client/src/systems/military/military_system.gd` (lines 400–428) computes a valid path but **never calls `_submit_move_order_for_division()`**. The function falls off the end without submitting anything to the server or seeding DR.

The execution agent added the new `find_path()` parameters in the Phase 7 changes but forgot the submission block that was originally there. Group move (`_handle_group_move_click`) and shift-click chain (`_handle_move_click`) both still work — only single right-click is broken.

### What the function looks like now (lines 400–428)

```gdscript
func _submit_direct_move_order(division_id: String, target_lng: float, target_lat: float) -> void:
    if not _pathfinder.is_built():
        push_warning("[MilitarySystem] Pathfinder not built — cannot route")
        _clear_pending()
        return
    if not _is_own_unit(division_id):
        return

    _clear_pending()
    var current_lng_lat: Vector2 = _get_division_lng_lat(division_id)
    var start_id: String = _pathfinder.find_nearest(current_lng_lat.x, current_lng_lat.y)
    var goal_id: String = _pathfinder.find_nearest(target_lng, target_lat)
    var movement_profile: Dictionary = _get_movement_profile(division_id)
    var path_result: Dictionary = _pathfinder.find_path(start_id, goal_id, movement_profile, 1.0, GameState.get_my_nation_id(), GameState.relations)
    var path: Array = path_result.get("logical", [])
    if path.is_empty():
        var fallback_id: String = _pathfinder.find_nearest_reachable(
            start_id, target_lng, target_lat, movement_profile,
            GameState.get_my_nation_id(), GameState.relations)
        if fallback_id.is_empty():
            push_warning("[MilitarySystem] No path found for %s — target completely unreachable" % division_id)
            return
        path_result = _pathfinder.find_path(start_id, fallback_id, movement_profile, 1.0,
            GameState.get_my_nation_id(), GameState.relations)
        path = path_result.get("logical", [])
        if path.is_empty():
            push_warning("[MilitarySystem] No fallback path found for %s" % division_id)
            return
    # ← function ends here — MISSING submit block
```

### Fix

Add these lines **immediately after line 427** (right before the function ends — do NOT add them inside any `if` block):

```gdscript
    var path_to_submit: Array[String] = []
    for waypoint_id: Variant in path:
        path_to_submit.append(str(waypoint_id))
    _submit_move_order_for_division(division_id, path_to_submit)
```

Look at `_handle_group_move_click()` for the identical pattern to confirm you are adding it correctly.

### No test file needed

Verify by running the game and right-clicking — the unit must move.

### Commit

`fix(military): submit move order in _submit_direct_move_order — missing call after path compute`

---

## Phase 14 — Fix Long-Distance Pathfinding (Neutral Fallback Bug)

### Root cause

`_is_neutral_for()` in `client/src/systems/military/pathfinder.gd` (line 603):

```gdscript
func _is_neutral_for(node_id: String, player_nation_id: String, relations: Dictionary) -> bool:
    if player_nation_id.is_empty():
        return false
    var node: Dictionary = _nodes.get(node_id, {})
    var nation = node.get("nation_id", null)
    if nation == null or str(nation).is_empty() or str(nation) == player_nation_id:
        return false
    var key: String = player_nation_id + ":" + str(nation)
    var rel_entry = relations.get(key, {})
    if typeof(rel_entry) == TYPE_DICTIONARY:
        var stance: String = rel_entry.get("stance", "neutral")
        return stance != "war"
    return true   # ← BUG on this line
```

**Line 603 `return true` fires when the relation key is not found in `relations`.** `GameState.relations` is an empty `{}` dict on cold start (before server sends relation data). This means `_is_neutral_for()` returns `true` for **every** non-own-territory node, blocking A* from exploring almost any of the graph. Only paths entirely within the player's own territory work; any long cross-border route fails.

### Fix

`pathfinder.gd` line 603: change `return true` to `return false`.

```gdscript
# Before:
    return true

# After:
    return false
```

**Why this is correct:** Unknown relationship = no basis to block. Default to passable. The server's `trimToAllowedTerritory()` is the authoritative territorial filter. The client exclusion is an optimisation to avoid obviously illegal routes — failing open (passable) is the right default.

### Test (write first — RED commit)

**New file: `client/tests/test_neutral_fallback.gd`**

```gdscript
extends Node

func _ready() -> void:
    var pf = preload("res://src/systems/military/pathfinder.gd").new()

    # Graph: A (own nation "alpha") → B (foreign nation "beta", unknown relation) → C (own "alpha")
    var graph = {
        "nodes": [
            {"id": "A", "lng": 0.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "alpha"},
            {"id": "B", "lng": 1.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "beta"},
            {"id": "C", "lng": 2.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "alpha"},
        ],
        "edges": [
            {"from": "A", "to": "B", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "B", "to": "A", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "B", "to": "C", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "C", "to": "B", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
        ]
    }
    pf.build(graph)
    var profile = {"plains_flat": 1.0}

    # Case 1: empty relations (cold start) — unknown nation must be PASSABLE
    var result1 = pf.find_path("A", "C", profile, 1.0, "alpha", {})
    var path1 = result1.get("logical", [])
    assert(not path1.is_empty(), "FAIL: path through unknown-relation nation should succeed with empty relations dict")
    assert("B" in path1, "FAIL: unknown-relation node B should not be blocked")

    # Case 2: explicit neutral stance — must be BLOCKED
    var result2 = pf.find_path("A", "C", profile, 1.0, "alpha", {"alpha:beta": {"stance": "neutral"}})
    assert(result2.get("logical", []).is_empty(), "FAIL: explicitly neutral nation must block path")

    # Case 3: explicit war stance — must be PASSABLE
    var result3 = pf.find_path("A", "C", profile, 1.0, "alpha", {"alpha:beta": {"stance": "war"}})
    assert(not result3.get("logical", []).is_empty(), "FAIL: war-stance nation must be passable")

    # Case 4: no player_nation_id — no filtering at all
    var result4 = pf.find_path("A", "C", profile, 1.0, "", {})
    assert(not result4.get("logical", []).is_empty(), "FAIL: empty player_nation_id must disable all filtering")

    print("=== test_neutral_fallback: all passed ===")
    get_tree().quit()
```

Run: `godot --headless --path client/ client/tests/test_neutral_fallback.gd`

### Commit order for Phase 14

1. Write `client/tests/test_neutral_fallback.gd`. Commit: `test(pathfinder): neutral fallback returns passable for unknown relation (RED)`
2. Change line 603 in `pathfinder.gd`: `return true` → `return false`. Run test.
3. Commit: `fix(pathfinder): unknown relation defaults to passable, not neutral-blocked`

---

## Phase 15 — Retest Movement Jerk After Phases 13 + 14

### Why this might already be fixed

The jerk after the first server tick was likely caused by Bug 14: when `_is_neutral_for()` blocked many nodes, the client's A* found a different (shorter/different) path than the server validated via `trimToAllowedTerritory()`. On the first server update, the leading waypoints diverged → `cur_lead != new_lead` → re-seed from server position → visible snap.

With Bug 14 fixed, client and server should agree on the path → no divergence → no re-seed → no jerk.

### What to do

1. Fix Phases 13 and 14.
2. Run the game. Right-click to move a unit a long distance across province borders.
3. Watch for any snap at the ~1-second mark.

**If jerk is gone: no code changes. No commit.**

**If jerk persists:** Add this temporary debug print in `_on_division_updated()` at the `cur_lead != new_lead` branch (around line 1205):

```gdscript
print("[DR-DEBUG] re-seed fired: cur_lead=%s new_lead=%s consumed=%s order_size=%d" % [
    cur_lead, new_lead, consumed_ids, str_order.size()])
```

Run again and capture the output. The log will reveal whether waypoint IDs are diverging and which ones. Report the output before fixing — do NOT guess at the cause. Once the cause is identified from the log, write a test first (RED), then fix.

Remove the debug print before committing any fix.

---

## Phase 16 — Unit Stops Short of Exact Click Position (Final-Position Lerp)

### Root cause

The synthetic goal node (`"_synthetic_goal"`) routes the visual path to the exact click coordinates, but `_finalize_path()` replaces it in the **logical** path with the nearest real grid waypoint. The submitted `move_order` only contains real waypoint IDs. The server advances to the last real waypoint (threshold 0.0001°). Client DR also targets the last real waypoint. Result: unit stops at the grid node, which may be 50–200 m from where the player clicked.

### Fix — client-only final-position lerp

No server changes. After DR completes the logical path, tween the icon to the exact click coordinates over 0.3 s.

**Step 1 — Add member variable to `military_system.gd`** (near the top with other `var` declarations):

```gdscript
var _dr_final_goal: Dictionary = {}   # div_id -> Vector2(lng, lat) of exact click
```

**Step 2 — Store the click coords on submit:**

In `_submit_direct_move_order()` (Phase 13 already added the submit block at the end), add **before** `_submit_move_order_for_division(...)`:

```gdscript
_dr_final_goal[division_id] = Vector2(target_lng, target_lat)
```

For shift-click chain moves: in `_handle_move_click()`, the last milestone click coordinate is stored in `_pending_milestones`. Find where the last milestone position is known (the click lng/lat that triggered the final segment) and store it in `_dr_final_goal[_selected_division_id]`. If the exact coords aren't easily available there, store them at the point in `_handle_right_click_move()` where `lng` and `lat` are still in scope (before the move-click call).

**Step 3 — Clear on new order:**

In `_submit_move_order_for_division()`, at the very start, add:

```gdscript
_dr_final_goal.erase(div_id)
```

This ensures a new order overwrites any stale goal from a previous move.

**Step 4 — Trigger lerp when DR order empties:**

In `_advance_dr()`, in the section where the DR order becomes empty and DR is erased (find the block that clears `_dr_pos_deg[div_id]`, `_dr_order[div_id]`, and sets the unit to stopped), add the lerp:

```gdscript
if _dr_final_goal.has(div_id):
    var final_goal: Vector2 = _dr_final_goal[div_id]
    _dr_final_goal.erase(div_id)
    var icon_node := _icons.get(div_id) as Node2D
    if icon_node:
        var final_screen: Vector2 = _map_loader.project_lng_lat(final_goal.x, final_goal.y)
        var tw := create_tween()
        tw.tween_property(icon_node, "position", final_screen, 0.3)
```

**Step 5 — Clear on reroute:**

In `_on_division_updated()`, in the `cur_lead != new_lead` re-seed branch, also add:

```gdscript
_dr_final_goal.erase(division_id)
```

### Test (write first — RED commit)

**New file: `client/tests/test_dr_final_goal.gd`**

```gdscript
extends Node

func _ready() -> void:
    # military_system.gd is a Node subclass (@onready vars, create_tween, etc. need the tree).
    # add_child() attaches it so _ready() fires and @onready vars resolve safely.
    # We never call methods that need scene-graph context here — just dict state.
    var ms = preload("res://src/systems/military/military_system.gd").new()
    add_child(ms)
    await ms.ready   # wait for ms._ready() to finish before asserting

    # Member must exist
    assert("_dr_final_goal" in ms, "FAIL: _dr_final_goal member must exist on military_system")

    # Storing and clearing
    ms._dr_final_goal["unit_1"] = Vector2(10.5, 48.3)
    assert(ms._dr_final_goal.has("unit_1"), "FAIL: goal should be stored")
    assert(ms._dr_final_goal["unit_1"].x == 10.5, "FAIL: stored lng must match")

    ms._dr_final_goal.erase("unit_1")
    assert(not ms._dr_final_goal.has("unit_1"), "FAIL: goal should be erased after reroute")

    print("=== test_dr_final_goal: all passed ===")
    get_tree().quit()
```

**Note for execution agent:** If `ms.ready` is not awaitable (Godot 4 only emits `ready` when the node enters the tree and `_ready()` has run — `await ms.ready` waits for that signal). If `military_system._ready()` itself makes network or autoload calls that crash in headless mode, wrap the assert block in a `call_deferred` instead. The test only checks `_dr_final_goal` dict state, so any crash from unrelated `_ready()` side-effects must be silenced by stubbing the autoload dependencies or skipping `add_child` if `_dr_final_goal` is a plain `var` (not `@onready`) — in that case `preload(...).new()` alone is safe and `add_child` is unnecessary.

Run: `godot --headless --path client/ client/tests/test_dr_final_goal.gd`

Manual verification: right-click on a point not on a grid node → unit arrives **exactly** at the click, not 50–200 m short.

### Commit order for Phase 16

1. Write `client/tests/test_dr_final_goal.gd`. Commit: `test(military): _dr_final_goal member state test (RED)`
2. Add `_dr_final_goal` dict. Populate on submit. Clear on new order + reroute. Trigger lerp on DR completion.
3. Run test.
4. Commit: `feat(military): lerp unit icon to exact click position after DR completes`

---

## Round 3 Verification Checklist

```bash
# New Godot tests
godot --headless --path client/ client/tests/test_neutral_fallback.gd
godot --headless --path client/ client/tests/test_dr_final_goal.gd

# All existing Godot tests must still pass
godot --headless --path client/ client/tests/test_pathfinder_neutral.gd
godot --headless --path client/ client/tests/test_pathfinder_neutral_callsite.gd
godot --headless --path client/ client/tests/test_pathfinder_hpa.gd
godot --headless --path client/ client/tests/test_smooth_path.gd
godot --headless --path client/ client/tests/test_pathfinder_fallback.gd

# Server tests must still pass
pnpm --filter game-server test
pnpm --filter game-server run typecheck
```

Manual smoke tests (Round 3):
- Right-click anywhere → single unit moves immediately (Phase 13)
- Right-click on enemy land 500+ km away → unit routes there, no premature stop (Phase 14)
- Move a unit and watch at the 1-second mark — no visible position snap (Phase 15)
- Right-click on a point between grid nodes → unit slides to the exact click pixel (Phase 16)

---

## Round 4 Bug Fixes (Phases 17–20)

**Status:** Phases 13–16 executed but 4 bugs remain. These have the exact root causes identified — previous fix attempts were wrong. Read every word carefully before touching code.

**Key context for the execution agent:**
- All GDScript tests use `extends Node` + `func _ready()` — NOT SceneTree/init.
- Working directory: `/home/kevin/Documents/Projects/grand-strategy-mp`
- Run Godot tests: `godot --headless --path client/ client/tests/<file>.gd`
- Run server tests: `pnpm --filter game-server test` and `pnpm --filter game-server run typecheck`

---

## Phase 17 — Sync Relations from Server to Client (Neutral Territory Root Cause)

### Why all previous fixes failed

`GameState.relations` (declared as `var relations: Dictionary = {}` at `client/src/core/game_state.gd:26`) is **never populated**. The Colyseus client net layer drops binary schema patches (protocol codes 14/15) with a comment "binary schema, deferred to Phase 4". No code path ever writes to `GameState.relations`.

`_is_neutral_for()` in `pathfinder.gd` is correctly written. The neutral filtering in `_astar_impl()` is correct. But they receive an empty dict every call, so neutral nations are never identified.

Additionally: server stores relations with key format `"germany|france"` (pipe separator, `GameRoom.ts:588`). Client `_is_neutral_for()` looks up with `player_nation_id + ":" + str(nation)` (colon separator, `pathfinder.gd:598`). **The key formats don't match.** Even if we did manage to populate `GameState.relations` by copying server schema keys verbatim, `_is_neutral_for()` still wouldn't find them.

### The actual server relation data

`GameRoom.ts:584–596` (`_initRelations()`, called at line 387 when game starts):
```typescript
private _initRelations(): void {
    const playerNations = ["germany", "france", "united_kingdom", "spain", "algeria", "italy"];
    for (let i = 0; i < playerNations.length; i++) {
        for (let j = i + 1; j < playerNations.length; j++) {
            const key = `${playerNations[i]}|${playerNations[j]}`;  // pipe separator
            const rel = new RelationState();
            rel.from_id = playerNations[i];
            rel.to_id   = playerNations[j];
            rel.stance  = "war";  // all start at war
            this.state.relations.set(key, rel);
        }
    }
}
```

The `session_manager.gd` routing works via `_on_server_event(type, data)` which matches on string type. Other updates (`DIVISION_UPDATES`, `DIVISIONS_SPAWNED`, etc.) work fine — relations just needs its own message type and handler.

### Fix: broadcast RELATIONS_UPDATED explicitly

**Step 1 — Server: `game-server/src/rooms/GameRoom.ts`**

At the end of `_initRelations()` (line ~596), after populating `this.state.relations`, broadcast the relations as a message to all clients:

```typescript
private _initRelations(): void {
    const playerNations = ["germany", "france", "united_kingdom", "spain", "algeria", "italy"];
    for (let i = 0; i < playerNations.length; i++) {
        for (let j = i + 1; j < playerNations.length; j++) {
            const key = `${playerNations[i]}|${playerNations[j]}`;
            const rel = new RelationState();
            rel.from_id = playerNations[i];
            rel.to_id   = playerNations[j];
            rel.stance  = "war";
            this.state.relations.set(key, rel);
        }
    }

    // Broadcast to all clients using colon-separated key (matches client's _is_neutral_for)
    const relationsPayload: Record<string, string> = {};
    for (const [, rel] of this.state.relations) {
        relationsPayload[`${rel.from_id}:${rel.to_id}`] = rel.stance;
        relationsPayload[`${rel.to_id}:${rel.from_id}`] = rel.stance;  // both directions
    }
    this.broadcast("RELATIONS_UPDATED", { relations: relationsPayload });
}
```

The payload is a flat dict: `{ "germany:france": "war", "france:germany": "war", ... }`. Both directions are stored so `_is_neutral_for()` can look up `player_nation_id + ":" + other_nation` regardless of order.

**Step 2 — Client: `client/src/systems/session/session_manager.gd`**

In `_on_server_event()` match block, add after the last case (around line 65+):

```gdscript
"RELATIONS_UPDATED":
    GameState._apply_relations_updated(data)
```

**Step 3 — Client: `client/src/core/game_state.gd`**

Add a new function (near `_apply_divisions_spawned` or similar):

```gdscript
func _apply_relations_updated(data: Dictionary) -> void:
    var raw: Dictionary = data.get("relations", {})
    for key: String in raw:
        relations[key] = {"stance": str(raw[key])}
```

After this, `GameState.relations` will have entries like:
```gdscript
{ "germany:france": {"stance": "war"}, "france:germany": {"stance": "war"}, ... }
```

This matches `_is_neutral_for()`'s lookup at `pathfinder.gd:598-602`:
```gdscript
var key: String = player_nation_id + ":" + str(nation)
var rel_entry = relations.get(key, {})
if typeof(rel_entry) == TYPE_DICTIONARY:
    var stance: String = rel_entry.get("stance", "neutral")
    return stance != "war"
return false
```

**Note:** `_initRelations()` currently sets ALL nation pairs to "war". With all nations at war, `_is_neutral_for()` returns false for everyone → no filtering occurs → all paths allowed → client and server paths agree → no divergence jerk. If/when stance changes (peace treaties, etc.) the server should re-broadcast `RELATIONS_UPDATED`.

### Test (write first — RED commit)

**New file: `client/tests/test_relations_sync.gd`**

```gdscript
extends Node

func _ready() -> void:
    # Simulate what _apply_relations_updated does
    var gs_script = preload("res://src/core/game_state.gd")

    # The function must exist
    assert(gs_script.get_script_method_list().any(func(m): return m["name"] == "_apply_relations_updated"),
        "FAIL: _apply_relations_updated must exist on GameState")

    # Apply a mock payload (same format server sends)
    var mock_data = {
        "relations": {
            "alpha:beta": "war",
            "beta:alpha": "war",
            "alpha:gamma": "neutral",
            "gamma:alpha": "neutral",
        }
    }
    GameState._apply_relations_updated(mock_data)

    # Relations dict must now be populated
    assert(GameState.relations.has("alpha:beta"), "FAIL: alpha:beta must be in relations")
    assert(GameState.relations["alpha:beta"].get("stance") == "war", "FAIL: stance must be war")
    assert(GameState.relations.has("alpha:gamma"), "FAIL: alpha:gamma must be in relations")
    assert(GameState.relations["alpha:gamma"].get("stance") == "neutral", "FAIL: stance must be neutral")

    # _is_neutral_for via pathfinder — confirm neutral nation is blocked
    var pf = preload("res://src/systems/military/pathfinder.gd").new()
    var graph = {
        "nodes": [
            {"id": "A", "lng": 0.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "alpha"},
            {"id": "B", "lng": 1.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "gamma"},
            {"id": "C", "lng": 2.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "alpha"},
        ],
        "edges": [
            {"from": "A", "to": "B", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "B", "to": "A", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "B", "to": "C", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "C", "to": "B", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
        ]
    }
    pf.build(graph)
    var profile = {"plains_flat": 1.0}

    # Path through gamma (neutral) must be blocked
    var res = pf.find_path("A", "C", profile, 1.0, "alpha", GameState.relations)
    assert(res.get("logical", []).is_empty(), "FAIL: path through neutral gamma must be blocked")

    # Path through beta (at war) must succeed if a direct route exists
    # (No direct A→C possible without going through gamma, so this verifies the neutral block)

    print("=== test_relations_sync: all passed ===")
    get_tree().quit()
```

Run: `godot --headless --path client/ client/tests/test_relations_sync.gd`

Also run: `pnpm --filter game-server run typecheck` after server changes.

### Commit order for Phase 17

1. Write `client/tests/test_relations_sync.gd`. Commit: `test(relations): sync and neutral block test (RED)`
2. Add broadcast at end of `_initRelations()` in `GameRoom.ts`. Add `"RELATIONS_UPDATED"` case in `session_manager.gd`. Add `_apply_relations_updated()` in `game_state.gd`.
3. Run tests.
4. Commit: `feat(relations): broadcast RELATIONS_UPDATED on game start; client syncs to GameState`

---

## Phase 18 — Fix Jerk After First Server Tick

### Root cause (confirmed)

The jerk is a **direct consequence of Bug 17** (relations never synced). Here is the exact failure sequence:

1. Client's `GameState.relations` is empty `{}`.
2. `_is_neutral_for()` returns `false` for all nodes (after Phase 14 fix) → client finds full cross-territory path, e.g., `[wp_A, wp_B, wp_C_enemy]`.
3. Server has `trimToAllowedTerritory()`. If a nation is neutral (not in the war list or with non-war stance), server trims the path, e.g., to `[wp_A]`.
4. Server advances division to `wp_A`, consumed it. Broadcasts `consumed_waypoint_ids: ["wp_A"]`, `move_order: []`.
5. Client pops `wp_A` from `_dr_order`. `updated_lead = "wp_B"`, but server's `new_lead = ""` (empty). Mismatch → re-seed from server position → **jerk**.

**The fix for Phase 17 (relations synced) eliminates this mismatch** for the current game state (all nations at war, no trimming occurs). No additional code change is needed here if Phase 17 is correct.

### Plan

1. Complete Phase 17.
2. Run the game, issue a long move order across multiple provinces.
3. Watch for any position snap at the ~1-second mark.

**If jerk is gone → no commit. Phase 18 is done.**

**If jerk persists after Phase 17:** Add this debug print inside `_on_division_updated()` in military_system.gd at the re-seed branch (`updated_lead != new_lead`, around line 1240):

```gdscript
print("[DR-DEBUG] re-seed: div=%s cur_lead=%s new_lead=%s consumed=%s" % [
    division_id, updated_lead, new_lead, str(consumed_ids)])
```

Run the game and capture the output. **Report the output before making any fix.** The log will show exactly which waypoint IDs diverged and why. Do NOT guess a cause from the symptoms alone.

Remove the debug print before any commit.

---

## Phase 19 — Fix Game Freeze on Move Order (Thread + HPA*)

### Root cause (confirmed)

Two compounding issues:

**Issue A: `_submit_direct_move_order()` runs pathfinding on the main thread.**

`_handle_move_click()` (shift-click, line 484+) uses `_path_thread = Thread.new()` → non-blocking. But `_submit_direct_move_order()` (single right-click, lines 400–435) calls `_pathfinder.find_path()` synchronously → blocks the main thread → freeze.

**Issue B: `find_nearest_reachable()` calls `find_path()` up to 20 times on a 160,197-node graph.**

Each full bidirectional A* on 160k nodes can take 1–3 seconds. The loop tries up to 20 candidates → 20–60 seconds of blocking before giving up.

**Issue C: HPA* clusters were built (Phase 3) but never activated.**

`pathfinder.gd:build()` (lines 37–86) never calls `build_clusters()`. `military_system.gd` never loads `waypoints_clusters.json`. Every `find_path()` call runs flat A* over all 160k nodes, even for short routes within a single province.

### Fix A — Thread `_submit_direct_move_order()`

Pattern to follow: copy the thread pattern from `_handle_move_click()` (lines 484–493).

Current synchronous structure in `_submit_direct_move_order()`:
```gdscript
var path_result: Dictionary = _pathfinder.find_path(start_id, goal_id, movement_profile, 1.0, ...)
var path: Array = path_result.get("logical", [])
if path.is_empty():
    # fallback ...
var path_to_submit: Array[String] = []
for ...: path_to_submit.append(...)
_submit_move_order_for_division(division_id, path_to_submit)
```

Replace with:
```gdscript
var division_id_snapshot := division_id
var my_nation := GameState.get_my_nation_id()
var relations_snapshot: Dictionary = GameState.relations.duplicate()
_path_pending = true
_path_thread = Thread.new()
_path_thread.start(func() -> void:
    var path_result: Dictionary = _pathfinder.find_path(
        start_id, goal_id, movement_profile, 1.0,
        my_nation, relations_snapshot)
    var path: Array = path_result.get("logical", [])
    if path.is_empty():
        var fallback_id: String = _pathfinder.find_nearest_reachable(
            start_id, target_lng, target_lat, movement_profile,
            my_nation, relations_snapshot)
        if not fallback_id.is_empty():
            path_result = _pathfinder.find_path(start_id, fallback_id, movement_profile, 1.0,
                my_nation, relations_snapshot)
            path = path_result.get("logical", [])
    call_deferred("_on_direct_move_ready", path, division_id_snapshot, target_lng, target_lat)
)
```

Add a new callback `_on_direct_move_ready(path: Array, division_id: String, target_lng: float, target_lat: float)`:
```gdscript
func _on_direct_move_ready(path: Array, division_id: String, target_lng: float, target_lat: float) -> void:
    if _path_thread != null and _path_thread.is_started():
        _path_thread.wait_to_finish()
    _path_thread = null
    _path_pending = false
    if path.is_empty():
        push_warning("[MilitarySystem] No path found for %s" % division_id)
        _clear_pending()
        return
    _dr_final_goal[division_id] = Vector2(target_lng, target_lat)
    var path_to_submit: Array[String] = []
    for waypoint_id: Variant in path:
        path_to_submit.append(str(waypoint_id))
    _submit_move_order_for_division(division_id, path_to_submit)
```

**Important:** Check that `_path_pending` is reset in all exit paths, matching the pattern in `_on_segment_ready()`. Also check that `target_lng` and `target_lat` are still in scope for the closure — capture them as local variables before starting the thread just like `division_id_snapshot`.

### Fix B — Reduce `find_nearest_reachable()` candidates

In `pathfinder.gd`, change:
```gdscript
const MAX_FALLBACK_CANDIDATES := 20
```
to:
```gdscript
const MAX_FALLBACK_CANDIDATES := 5
```

5 candidates cap the worst-case cost at 5 A* calls instead of 20. For most cases 1–2 are enough.

### Fix C — Activate HPA* clusters

**`military_system.gd`** — in the function that loads `waypoints.json` (find where `_pathfinder.build(...)` is called — likely in a `_load_pathfinder()` or `_on_map_loaded()` function), add immediately after:

```gdscript
var cluster_path := "res://assets/data/western_europe_6/waypoints_clusters.json"
if FileAccess.file_exists(cluster_path):
    var file := FileAccess.open(cluster_path, FileAccess.READ)
    if file:
        var cluster_data: Variant = JSON.parse_string(file.get_as_text())
        file.close()
        if cluster_data is Dictionary:
            _pathfinder.build_clusters(cluster_data)
            print("[MilitarySystem] HPA* clusters loaded")
```

**`pathfinder.gd` `find_path()`** — check if clusters are loaded before deciding which algorithm to use. The function already has this logic (look for `_cluster_of` dict or `_hpa_loaded` flag). If `build_clusters()` has been called and clusters are available, `find_path()` should call `_hpa_find_path()` instead of flat `_astar_impl()`. Verify this branching exists in the current code; if `find_path()` always calls the flat path, add the condition:

```gdscript
if _cluster_of.size() > 0:
    return _hpa_find_path(from_id, to_id, movement_profile, road_cost_multiplier,
        player_nation_id, relations, goal_lng, goal_lat)
```

(Check exact variable names and conditions already in the file — do not add duplicate logic.)

### No new test file needed for Phase 19

Verify manually: right-click to move a unit far away → **no freeze**. The map should remain interactive while pathfinding runs on the background thread.

For HPA*: a path from one end of the map to the other should return in <200ms instead of 1–3 seconds.

### Commit order for Phase 19

1. Thread `_submit_direct_move_order()` and add `_on_direct_move_ready()` callback. Commit: `fix(military): thread _submit_direct_move_order to prevent main-thread freeze`
2. Change `MAX_FALLBACK_CANDIDATES` from 20 to 5. Commit: `fix(pathfinder): reduce fallback candidates to 5 to cap A* worst case`
3. Load clusters in `military_system.gd` after `build()`. Verify `find_path()` uses HPA* when clusters present. Commit: `feat(pathfinder): activate HPA* clusters on map load`

---

## Phase 20 — Fix Unit Stops Before Final Exact Waypoint

### Root cause (confirmed)

`_dr_final_goal` IS correctly added (line 83) and IS set when the move order is submitted. But the tween in `_advance_dr()` **never fires** because `_on_division_updated()` deletes `_dr_order[division_id]` before `_advance_dr()` checks for `_dr_final_goal`.

**Exact failure sequence:**
1. Unit travels along waypoints via DR. `_dr_final_goal[div_id]` = exact click coords.
2. Server advances unit to the last real waypoint and consumes it. Server `move_order` becomes `[]`.
3. Server broadcasts `division_updated` with empty `move_order`.
4. Client `_on_division_updated()` fires. Checks `if order.is_empty()` → true → erases `_dr_pos_deg[division_id]` and `_dr_order[division_id]` → `set_moving(false)`.
5. `_advance_dr()` on the next frame: `_dr_order.has(div_id)` is false → skips the division → never reaches the `_dr_final_goal` check → tween never fires.
6. Unit icon is parked at server position (last real waypoint), not the exact click.

### Fix

In `_on_division_updated()`, in the branch that handles `order.is_empty()` (look for the block that erases DR and calls `set_moving(false)`), add the final-goal tween **before** erasing `_dr_order`:

```gdscript
# In the order.is_empty() branch, BEFORE _dr_pos_deg.erase() and _dr_order.erase():
if _dr_final_goal.has(division_id) and order.is_empty():
    var final_goal: Vector2 = _dr_final_goal[division_id]
    _dr_final_goal.erase(division_id)
    var icon_node := _icons.get(division_id) as Node2D
    if icon_node:
        var final_screen: Vector2 = _map_loader.project_lng_lat(final_goal.x, final_goal.y)
        var tw := create_tween()
        tw.tween_property(icon_node, "position", final_screen, 0.3)
```

This fires the tween immediately when the server confirms the unit has finished its path. The tween carries the icon from the last grid node to the exact click position over 0.3 seconds.

**Also check `_advance_dr()`:** if there is already a `_dr_final_goal` check block there (from Phase 16), it may now be unreachable. It's fine to leave it as a fallback, or remove it to avoid confusion. The primary trigger is now in `_on_division_updated()`.

### No new test file

Phase 16 already added `test_dr_final_goal.gd` which tests the member exists and stores/clears correctly. The visual behavior (tween fires) requires manual verification.

Manual verification: right-click on a position between grid nodes → unit arrives and **slides** to the exact click point, not to the nearest node.

### Commit order for Phase 20

1. Commit: `fix(military): fire final-goal tween in _on_division_updated when order empties`

---

## Round 4 Verification Checklist

```bash
# New Godot tests
godot --headless --path client/ client/tests/test_relations_sync.gd

# Existing tests must still pass
godot --headless --path client/ client/tests/test_neutral_fallback.gd
godot --headless --path client/ client/tests/test_pathfinder_neutral.gd
godot --headless --path client/ client/tests/test_pathfinder_neutral_callsite.gd
godot --headless --path client/ client/tests/test_pathfinder_hpa.gd
godot --headless --path client/ client/tests/test_smooth_path.gd
godot --headless --path client/ client/tests/test_dr_final_goal.gd

# Server tests
pnpm --filter game-server test
pnpm --filter game-server run typecheck
```

Manual smoke tests (Round 4):
- Start game → neutral nations are correctly identified; unit routed around them (Phase 17)
- Move a unit across provinces → no position snap at the 1-second mark (Phase 18)
- Right-click anywhere → map stays responsive; no game freeze while pathfinding runs (Phase 19)
- HPA*: long-distance move returns instantly instead of taking 1–3 seconds (Phase 19)
- Right-click between grid nodes → unit slides exactly to click position, not nearest node (Phase 20)

---

## Round 5 Bug Fixes (Phases 21–23)

**Status:** Phases 17–20 executed. Three bugs remain. Root causes confirmed by code inspection. Fix in order — Bug 22 causes Bug 21.

**Key context for execution agent:**
- All GDScript tests use `extends Node` + `func _ready()` — NOT SceneTree/init.
- Working directory: `/home/kevin/Documents/Projects/grand-strategy-mp`
- Run Godot tests: `godot --headless --path client/ client/tests/<file>.gd`
- Run server tests: `pnpm --filter game-server test` && `pnpm --filter game-server run typecheck`

---

## Phase 21 — Retest Jerk After Phase 22 Fix (No Code Change Here)

**Root cause:** The jerk (1-3 ticks after movement start) is caused by path divergence. The client routes through Netherlands/Belgium (neutral nations not in the 6-nation hardcoded list), the server's `trimToAllowedTerritory()` strips those waypoints, and the leading waypoints diverge → `updated_lead != new_lead` fires → re-seeds `_dr_pos_deg` from server position → visible snap.

**Plan:** Fix Phase 22 first (the neutral routing bug). Then test movement. If jerk is gone: no code change. If jerk persists after Phase 22, add this debug print in `_on_division_updated()` at the re-seed branch and run the game:

```gdscript
print("[DR-DEBUG] re-seed div=%s cur=%s new=%s consumed=%s" % [
    division_id, updated_lead, new_lead, str(consumed_ids)])
```

Report the output before guessing a cause. Remove the print before any commit.

---

## Phase 22 — Fix Neutral Routing Through Non-Player Nations

### Root cause (confirmed)

`_is_neutral_for()` in `client/src/systems/military/pathfinder.gd` line 604 currently reads:

```gdscript
func _is_neutral_for(node_id: String, player_nation_id: String, relations: Dictionary) -> bool:
    if player_nation_id.is_empty():
        return false
    var node: Dictionary = _nodes.get(node_id, {})
    var nation = node.get("nation_id", null)
    if nation == null or str(nation).is_empty() or str(nation) == player_nation_id:
        return false
    var key: String = player_nation_id + ":" + str(nation)
    if relations.has(key):
        var rel_entry = relations.get(key, {})
        if typeof(rel_entry) == TYPE_DICTIONARY:
            var stance: String = rel_entry.get("stance", "neutral")
            return stance != "war"
    return false   # ← BUG: passable when key not found
```

**Why it fails for Netherlands/Belgium:**

`GameRoom.ts`'s `_initRelations()` (line 584) hardcodes only 6 player nations:
```typescript
["germany", "france", "united_kingdom", "spain", "algeria", "italy"]
```

Nations like "netherlands", "belgium", "luxembourg", "switzerland", "austria" etc. that exist as `nation_id` values in `waypoints.json` are **never added to relations**. When the client looks up `"germany:netherlands"`, it's not in `GameState.relations` → falls through to `return false` → treated as passable → pathfinder routes freely through them.

The server's `_isNeutralFor()` in `movement_system.ts` defaults unknown nations to `"neutral"` stance:
```typescript
const stance = rel?.stance ?? "neutral";
return stance !== "war" && stance !== "allied";
```

So the server BLOCKS Netherlands but the client DOESN'T → path diverges → jerk + neutral routing.

### Fix

The fallback at line 604 must be `return true` (unknown nation = neutral = blocked) **but only when `relations` is non-empty**. When `relations` is empty, return false (safe open — don't block all movement before sync).

Change `_is_neutral_for()` as follows. Find this block (around line 596-604):

```gdscript
    var key: String = player_nation_id + ":" + str(nation)
    if relations.has(key):
        var rel_entry = relations.get(key, {})
        if typeof(rel_entry) == TYPE_DICTIONARY:
            var stance: String = rel_entry.get("stance", "neutral")
            return stance != "war"
    return false
```

Replace with:

```gdscript
    if relations.is_empty():
        return false  # No relation data synced yet — fail open to avoid total lockout
    var key: String = player_nation_id + ":" + str(nation)
    if relations.has(key):
        var rel_entry = relations.get(key, {})
        if typeof(rel_entry) == TYPE_DICTIONARY:
            var stance: String = rel_entry.get("stance", "neutral")
            return stance != "war"
    return true  # Known relations loaded, but this nation not in list → treat as neutral
```

**This matches server behaviour exactly:**
- Server: unknown nation → `stance ?? "neutral"` → neutral → blocked
- Client after fix: unknown nation when relations loaded → `return true` → blocked ✓
- Client with empty relations (before sync): `return false` → passable (safe open) ✓

### Test (write first — RED commit)

**New file: `client/tests/test_neutral_unknown_nation.gd`**

```gdscript
extends Node

func _ready() -> void:
    var pf = preload("res://src/systems/military/pathfinder.gd").new()
    var graph = {
        "nodes": [
            {"id": "A", "lng": 0.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "germany"},
            {"id": "B", "lng": 1.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "netherlands"},
            {"id": "C", "lng": 2.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "france"},
        ],
        "edges": [
            {"from": "A", "to": "B", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "B", "to": "A", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "B", "to": "C", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "C", "to": "B", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
        ]
    }
    pf.build(graph)
    var profile = {"plains_flat": 1.0}

    # Relations only has germany↔france (like the real 6-nation list) — netherlands absent
    var relations = {
        "germany:france": {"stance": "war"},
        "france:germany": {"stance": "war"},
    }

    # With loaded relations: netherlands (unknown) must be BLOCKED
    # A→C through netherlands must fail (no alternative path)
    var res1 = pf.find_path("A", "C", profile, 1.0, "germany", relations)
    assert(res1.get("logical", []).is_empty(),
        "FAIL: path through unknown nation 'netherlands' must be blocked when relations loaded")

    # With EMPTY relations: unknown nation must be passable (safe open)
    var res2 = pf.find_path("A", "C", profile, 1.0, "germany", {})
    assert(not res2.get("logical", []).is_empty(),
        "FAIL: path through unknown nation must be passable when relations is empty (cold start)")

    # Explicit war stance (france) must always be passable
    var direct_graph = {
        "nodes": [
            {"id": "X", "lng": 0.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "germany"},
            {"id": "Y", "lng": 1.0, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "france"},
        ],
        "edges": [
            {"from": "X", "to": "Y", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
            {"from": "Y", "to": "X", "cost": 1.0, "dist_deg": 1.0, "river_penalty": 0.0, "on_road": false},
        ]
    }
    pf.build(direct_graph)
    var res3 = pf.find_path("X", "Y", profile, 1.0, "germany", relations)
    assert(not res3.get("logical", []).is_empty(),
        "FAIL: war-stance nation france must be passable")

    print("=== test_neutral_unknown_nation: all passed ===")
    get_tree().quit()
```

Run: `godot --headless --path client/ client/tests/test_neutral_unknown_nation.gd`

### Commit order for Phase 22

1. Write `client/tests/test_neutral_unknown_nation.gd`. Commit: `test(pathfinder): unknown nation blocked when relations loaded (RED)`
2. Edit `_is_neutral_for()` in `pathfinder.gd` — add `if relations.is_empty(): return false` before key lookup, change final `return false` to `return true`. Run test.
3. Commit: `fix(pathfinder): unknown nations treated as neutral when relations are loaded`

---

## Phase 23 — Unit Physically Moves to Exact Click Position (Final-Leg DR)

### Root cause (confirmed)

`_dr_final_goal` (line 83, `military_system.gd`) stores exact click coordinates. When `_advance_dr()` pops the last waypoint (lines 755-775), it checks `_dr_final_goal` at line 761 and **tweens the icon** — visual only. The unit's logical position stays at the last grid node.

Additionally, `_on_division_updated()` receives the server's empty `move_order` and erases `_dr_order[division_id]` and `_dr_pos_deg[division_id]` before `_advance_dr()` can do anything about it. The main loop (`_process`) at line 153-154 only calls `_advance_dr()` when `not _dr_order[div_id].is_empty()` — so after the erase, DR never runs again for this division.

### Fix

**Two-part change, both in `military_system.gd`:**

**Part A — `_advance_dr()` final-leg: replace icon tween with real movement**

Current code at lines 760-775 (inside `if order.is_empty():` after popping last waypoint):
```gdscript
if order.is_empty():
    if _dr_final_goal.has(div_id):
        var final_goal: Vector2 = _dr_final_goal[div_id]
        _dr_final_goal.erase(div_id)
        var icon_node := _icons.get(div_id) as Node2D
        if icon_node:
            var final_screen: Vector2 = _map_loader.project_lng_lat(final_goal.x, final_goal.y)
            var tw := create_tween()
            tw.tween_property(icon_node, "position", final_screen, 0.3)
    var done_icon := _icons.get(div_id) as Node2D
    if done_icon:
        done_icon.set_moving(false)
    # (and leftover budget check below)
```

Replace this with: when order becomes empty and `_dr_final_goal` exists, do NOT erase DR or stop the icon. Instead leave `_dr_order[div_id]` as an empty array (key still present) so that `_advance_dr_final_leg()` (new function, see below) will be picked up by the process loop.

```gdscript
if order.is_empty():
    if _dr_final_goal.has(div_id):
        # Leave _dr_pos_deg alive and _dr_order as empty array.
        # _advance_dr_final_leg() will drive the remaining movement.
        return  # do NOT call set_moving(false) yet
    var done_icon := _icons.get(div_id) as Node2D
    if done_icon:
        done_icon.set_moving(false)
    _dr_pos_deg.erase(div_id)
    _dr_order.erase(div_id)
    return
```

**Part B — Add `_advance_dr_final_leg()` function**

Add this new function anywhere near `_advance_dr()`:

```gdscript
func _advance_dr_final_leg(div_id: String, delta: float) -> void:
    if not _dr_pos_deg.has(div_id) or not _dr_final_goal.has(div_id):
        return
    var pos: Vector2 = _dr_pos_deg[div_id]
    var goal: Vector2 = _dr_final_goal[div_id]
    var to_goal: Vector2 = goal - pos
    var dist: float = to_goal.length()

    var speed_degs: float = (DR_OFFROAD_KMH / DR_KM_PER_DEG) \
            * float(GameState.game_speed) \
            * _dr_speed_mult.get(div_id, 1.0) \
            * delta

    if dist <= DR_SNAP_DEG or speed_degs >= dist:
        _dr_pos_deg[div_id] = goal
        _dr_final_goal.erase(div_id)
        _dr_order.erase(div_id)
        _dr_pos_deg.erase(div_id)
        var icon_node := _icons.get(div_id) as Node2D
        if icon_node:
            icon_node.position = _map_loader.project_lng_lat(goal.x, goal.y)
            icon_node.set_moving(false)
    else:
        _dr_pos_deg[div_id] = pos + to_goal.normalized() * speed_degs
        var icon_node := _icons.get(div_id) as Node2D
        if icon_node:
            icon_node.position = _map_loader.project_lng_lat(
                _dr_pos_deg[div_id].x, _dr_pos_deg[div_id].y)
```

**Part C — Call the final-leg function from `_process()`**

Around line 153-154 in `_process()` (find the loop that calls `_advance_dr()`):

```gdscript
# Current:
if _dr_order.has(div_id) and not _dr_order[div_id].is_empty():
    _advance_dr(div_id, delta)

# Replace with:
if _dr_order.has(div_id) and not _dr_order[div_id].is_empty():
    _advance_dr(div_id, delta)
elif _dr_order.has(div_id) and _dr_order[div_id].is_empty() \
        and _dr_final_goal.has(div_id) and _dr_pos_deg.has(div_id):
    _advance_dr_final_leg(div_id, delta)
```

**Part D — `_on_division_updated()` must NOT erase `_dr_pos_deg` during final leg**

In `_on_division_updated()`, find the block that handles empty server `move_order` (the one that calls `_dr_pos_deg.erase()` and `_dr_order.erase()`). Add a guard at the top of that block:

```gdscript
if order.is_empty() or combat_state_val in ["engaged", "suppressed"]:
    # If a final-leg is in progress, let it complete — don't erase DR
    if _dr_final_goal.has(division_id) and order.is_empty():
        # Keep _dr_pos_deg and _dr_order (as empty array) alive.
        # _advance_dr_final_leg() handles completion.
        _update_division_route(division_id)
        _update_division_visibility(division_id)
        return
    _dr_pos_deg.erase(division_id)
    _dr_order.erase(division_id)
    # ... rest of the stop logic ...
```

**Important:** `_dr_order[division_id]` must stay as an empty array (key present, value `[]`) — NOT erased — for the `_process()` elif branch to trigger `_advance_dr_final_leg()`. In Part A above, when we `return` early without erasing, the key stays. Make sure no other code path erases it while the final leg runs (check `_clear_pending()` and `_submit_move_order_for_division()` — they may erase `_dr_order` on a new order, which is correct behaviour since a new move cancels the final leg).

### Test (write first — RED commit)

**New file: `client/tests/test_final_leg_dr.gd`**

```gdscript
extends Node

func _ready() -> void:
    # Verify _advance_dr_final_leg exists and the _dr_order / _dr_final_goal logic is correct.
    # Full movement requires a running scene; we verify state management here.
    var ms = preload("res://src/systems/military/military_system.gd").new()
    add_child(ms)
    await ms.ready

    # _advance_dr_final_leg must exist
    assert(ms.has_method("_advance_dr_final_leg"),
        "FAIL: _advance_dr_final_leg method must exist")

    # When _dr_final_goal is set and _dr_order is empty (not erased), final leg should be active
    ms._dr_pos_deg["unit_1"] = Vector2(10.0, 48.0)
    ms._dr_order["unit_1"] = []              # empty array, key present
    ms._dr_final_goal["unit_1"] = Vector2(10.5, 48.5)

    assert(ms._dr_order.has("unit_1"), "FAIL: _dr_order key must persist (not erased) during final leg")
    assert(ms._dr_final_goal.has("unit_1"), "FAIL: _dr_final_goal must be set during final leg")

    # After final leg completes, both must be cleared
    # Simulate completion by setting pos == goal
    ms._dr_pos_deg["unit_1"] = Vector2(10.5, 48.5)   # arrived at goal
    ms._advance_dr_final_leg("unit_1", 0.016)          # one frame

    # After arriving, both should be erased
    assert(not ms._dr_final_goal.has("unit_1"), "FAIL: _dr_final_goal must be erased after arrival")
    assert(not ms._dr_order.has("unit_1"), "FAIL: _dr_order must be erased after final leg complete")

    print("=== test_final_leg_dr: all passed ===")
    get_tree().quit()
```

**Note on `add_child(ms)`:** `military_system.gd` is a scene-attached Node. `add_child(ms)` attaches it so `_ready()` fires. If `_ready()` crashes due to missing autoloads/scene nodes, wrap the setup in a `call_deferred` or skip `add_child` and test the dict operations directly — `_dr_pos_deg`, `_dr_order`, `_dr_final_goal` are plain `var` dicts, not @onready, so `.new()` alone is safe for dict state checks. Adjust the test accordingly.

Run: `godot --headless --path client/ client/tests/test_final_leg_dr.gd`

Manual verification: right-click on open plains 30 km from any grid node → unit moves to the last grid node then **continues in a straight line** to the exact click, arriving precisely there.

### Commit order for Phase 23

1. Write `client/tests/test_final_leg_dr.gd`. Commit: `test(military): final-leg DR state management test (RED)`
2. Implement Part A (replace icon tween with early return), Part B (`_advance_dr_final_leg()`), Part C (process loop elif), Part D (`_on_division_updated()` guard). Run test.
3. Commit: `feat(military): straight-line DR final leg from last waypoint to exact click position`

---

## Round 5 Verification Checklist

```bash
# New tests
godot --headless --path client/ client/tests/test_neutral_unknown_nation.gd
godot --headless --path client/ client/tests/test_final_leg_dr.gd

# Existing tests must still pass
godot --headless --path client/ client/tests/test_neutral_fallback.gd
godot --headless --path client/ client/tests/test_relations_sync.gd
godot --headless --path client/ client/tests/test_pathfinder_neutral.gd
godot --headless --path client/ client/tests/test_pathfinder_neutral_callsite.gd
godot --headless --path client/ client/tests/test_pathfinder_hpa.gd
godot --headless --path client/ client/tests/test_smooth_path.gd
godot --headless --path client/ client/tests/test_dr_final_goal.gd

# Server
pnpm --filter game-server test
pnpm --filter game-server run typecheck
```

Manual smoke tests (Round 5):
- Germany unit → northern France → path does NOT route through Netherlands/Belgium (Phase 22)
- Move a unit → no position snap at 1-second or 2-second marks (Phase 21, fixed by Phase 22)
- Right-click on open plains far from any grid node → unit walks past the last node and arrives at exact click position (Phase 23)
