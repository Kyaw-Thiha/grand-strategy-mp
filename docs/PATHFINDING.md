# Pathfinding — Implementation Reference

> Technical reference for the pathfinding system as implemented.
> For design intent and UX decisions see `STRATEGIC_COMBAT.md`.
> Source files: `map/tools/map_pipeline/pipeline.py`, `client/src/systems/military/pathfinder.gd`,
> `client/src/systems/military/military_system.gd`.

---

## Waypoint Graph (`pipeline.py`)

The graph is pre-baked at pipeline time and written to
`client/assets/data/<map_id>/waypoints.json`. It combines road nodes and a non-uniform
terrain grid into a single unified graph.

### Road nodes

Sampled from `roads.geojson` at `SAMPLE_DEG = 0.007°` (~750 m at 50°N). Long segments
are interpolated so no gap exceeds that spacing. Each node stores `cover_combat`,
`elevation`, and `base_cost = COVER_MOVE[cover] × ELEV_MOVE[elevation]`.

### Non-uniform terrain grid

Three independent tier sweeps; no overlaps; deduplicated at ~100 m resolution.

| Tier | Terrain types | Grid step | Approx spacing |
|---|---|---|---|
| Open | plains, steppe, desert, tundra | 0.20° | ~22 km |
| Medium | light_forest, shrubland, hills | 0.10° | ~11 km |
| Complex | dense_forest, jungle, swamp, urban, mountains | 0.07° | ~7.5 km |

Longitude steps are latitude-corrected (`lng_step = tier_step / cos(lat_mid)`) so
geographic spacing is roughly uniform regardless of where on the map.

### Terrain cost tables

```
COVER_MOVE:  plains=1.0, steppe=1.1, shrubland=1.2, light_forest=1.3,
             dense_forest=1.8, jungle=2.5, desert=1.4, swamp=2.0,
             tundra=1.5, glacier=9999.0, urban=0.9

ELEV_MOVE:   flat=1.0, hills=1.4, mountains=2.2
```

`base_cost = COVER_MOVE × ELEV_MOVE` is stored per node at pipeline time.

### Edge costs

- **Road edge:** `0.05 × dist_deg × river_penalty`
- **Terrain edge:** `dist_deg × base_cost × river_penalty`

Road cost base (0.05/deg) vs terrain base (1.0+/deg) gives roads a ~20× raw preference,
which the two-phase routing exploits explicitly rather than relying on A* alone.

### River penalties

Applied to edges whose line segment intersects a river feature. Road crossings (bridges)
are exempt.

| River size | Multiplier |
|---|---|
| minor | 1.8× |
| moderate | 3.0× |
| major | 4.5× |

### Connectivity

- **Terrain-to-terrain:** K=8 nearest neighbours within `CONNECT_DEG = 0.40°`
  (chosen to exceed the latitude-corrected open-tier E-W step of ~0.285° and its
  diagonal ~0.348°, while staying below the English Channel gap of ~0.55°)
- **Terrain-to-road snap:** K=3 nearest road nodes within `ROAD_CONNECT_DEG = 0.11°`

An edge is a road edge only if **both** endpoints are road nodes. A terrain node snapped
to a road node uses terrain-cost edges — it does not inherit road speed.

---

## Core A* (`pathfinder.gd`)

**Algorithm:** Bidirectional A* — forward frontier (start→goal) and backward frontier
(goal→start) run simultaneously. Terminates when `mu` (best complete path found via a
shared node) < sum of both frontier priorities.

**Heuristic:** `sqrt(dx² + dy²) × ROAD_COST_BASE × 10.0` — intentionally inadmissible
(10× multiplier) to accelerate convergence. Road preference is handled by cost structure,
not heuristic admissibility.

**Edge cost at query time:**

```
road edge:    0.05 × dist_deg × river_penalty × road_cost_multiplier
terrain edge: dist_deg × base_cost × profile_cost × river_penalty
```

`profile_cost` is looked up from the division's `movement_profile` by key
`"cover_combat_elevation"`. If `profile_cost == INF` the edge is excluded — A* cannot
route through terrain that is impassable for this division type.

---

## Two-Phase Routing (`pathfinder.gd` lines 173–217)

Applied before every path computation. Tries cheaper sub-queries before falling back to
the full graph:

**Phase 1 — Off-road purity check:**
If both start and goal are off-road nodes, run full A* once. If the result contains no
road nodes, return it immediately. The player is routing deep off-road and road-seeking
behaviour is unwanted.

**Phase 2 — Road entry pre-check:**
Find the nearest road node within `ROAD_SEARCH_RADIUS_SQ = 0.015°²` (~1.5 km).
- Start on road → road-only A* straight to goal
- Start off-road → off-road A* to nearest road node, then road-only A* to goal
If both segments succeed, join and return.

**Phase 3 — Full graph fallback:**
Route across the entire unified graph. Road edges at 0.05/deg win naturally over
terrain at 1.0+/deg, but this phase has no explicit road-snapping guarantee.

---

## String-Pulling (`pathfinder.gd` lines 358–397)

Post-processes the raw A* waypoint list to remove redundant intermediate nodes:

- Greedy forward pass: from each waypoint, skip ahead to the furthest reachable node
  whose straight-line segment is passable
- Skip is accepted if: Euclidean distance ≤ `MAX_SKIP_DIST_SQ = 0.05°²` (~5 km) **and**
  all intermediate nodes along the straight line have non-infinite `movement_profile` cost
- Typically reduces a 20-node raw path to 5–8 nodes on open routes

Note: the check uses straight-line distance and node passability, not a continuous
terrain sample along the segment. Thin impassable strips narrower than the node spacing
may occasionally be crossed after pulling.

---

## Shift-Move Road Avoidance (`military_system.gd` lines 263–344, `pathfinder.gd` lines 128–164)

Only activates from **segment 2 onward** in a shift-move chain. Single move orders always
use the normal two-phase algorithm unchanged.

### Road crossing check

Before computing any avoidance, `road_crosses_segment(from_id, to_id)` samples the
segment at `ROAD_CROSS_SAMPLE_DEG = 0.002°` (~200 m) intervals. If any sample falls
within `ROAD_PROXIMITY_DEG = 0.003°` (~300 m) of a road node, a road naturally exists
between the waypoints — use the normal algorithm for this segment (player is likely
fine with road routing).

### Avoidance multiplier

When no road crosses the segment:

```
dist_to_road     = nearest_road_node_distance(previous_waypoint)
avoidance_factor = clamp(dist_to_road / OFFROAD_THRESHOLD_DEG, 0.0, 1.0)
road_multiplier  = 1.0 + avoidance_factor × (MAX_ROAD_MULTIPLIER - 1.0)
```

| Constant | Value | Meaning |
|---|---|---|
| `OFFROAD_THRESHOLD_DEG` | 0.014° (~1.4 km) | Distance at which avoidance reaches maximum |
| `MAX_ROAD_MULTIPLIER` | 13.0 | Road edges become ~2× pricier than plains at maximum |

Range: 1.0 (no avoidance, on or near road) → 13.0 (strong avoidance, deep off-road).

The multiplier inflates road edge costs in A* for this segment only. Roads can still be
crossed when terrain is impassable — they are just not actively sought.

### Avoidance in practice

| Previous waypoint distance to road | Multiplier | Effect |
|---|---|---|
| 0 m (on road) | 1.0 | Normal algorithm — road preferred |
| 700 m | ~6.0 | Roads roughly neutral with plains |
| 1400 m+ | 13.0 | Roads 2× more expensive than plains |

---

## Dead Reckoning (`military_system.gd` lines 418–477)

The client drives unit animation entirely from the validated waypoint list. No server
acknowledgement is awaited per waypoint.

**Speed formula (mirrors `movement_system.ts` exactly):**

```
road node:    DR_ROAD_KMH   = 60.0 km/h
off-road:     DR_OFFROAD_KMH / terrain_cost  (DR_OFFROAD_KMH = 20.0)
conversion:   DR_KM_PER_DEG = 111.0 km/deg
```

**Server corrections:**
- `division_updated` from Colyseus state: trim local waypoint order when server has consumed
  leading waypoints; re-seed from server position if leading waypoint diverges (reroute)
- Foreign units (other players) use the same DR loop — see `FOREIGN_UNIT_PATH_DR` flag in
  `military_system.gd` to toggle back to legacy lerp mode for performance testing
