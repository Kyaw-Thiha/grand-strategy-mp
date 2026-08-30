# Pathfinding — Implementation Reference

> Technical reference for the pathfinding system as implemented.
> For design intent and UX decisions see `STRATEGIC_COMBAT.md`.
> Source files: `map/tools/map_pipeline/pipeline.py`, `client/src/systems/military/pathfinder.gd`,
> `client/src/systems/military/military_system.gd`, `game-server/src/systems/movement_system.ts`.

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

**Heuristic:** `sqrt(dx² + dy²) × ROAD_COST_BASE` — admissible and consistent: `ROAD_COST_BASE`
is a true global lower bound on cost-per-degree (roads are always the cheapest edge type; every
off-road edge costs at least `1.0 × dist_deg`). An earlier `× 10.0` weighting was tried to
accelerate convergence but was inadmissible — it could make the bidirectional meet-in-the-middle
termination check settle on a costlier off-road detour before exploring a cheaper nearby road
route. Reverted; see `client/tests/test_pathfinder_admissible_heuristic.gd` for the regression
test. Road preference itself is still driven by the cost structure (0.05 vs 1.0+ per degree),
not by heuristic weighting.

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

## Synthetic Goal — Pixel-Perfect Destination

By default A* routes to the nearest waypoint from the click position. For pixel-perfect
destination, the client inserts a **synthetic goal** node at the exact click coordinates
before routing.

### Insertion (`pathfinder.gd:_insert_synthetic_goal`)

A temporary node `_synthetic_goal` is added to `_nodes` at `(goal_lng, goal_lat)` with
`cover_combat: "plains"`, `elevation: "flat"`. It is connected to the K=8 nearest
non-neutral waypoint nodes via bidirectional terrain-cost edges.

**Two-pass connection:**
1. Collect K nearest nodes where `_is_neutral_for()` returns false (non-neutral)
2. If zero non-neutral nodes are found within the entire graph, the synthetic goal
   remains unconnected — no path to it is possible. This is correct: clicking in
   or near neutral territory should fail to find a route.

**Neutral filter rationale:** The A* engine already checks neutrality at
edge-expansion time (see Neutral Territory Exclusion below). Connecting the synthetic
goal to neutral nodes would be useless — A* would skip them at search time.

### Removal (`pathfinder.gd:_remove_synthetic_goal`)

After A* completes, `_synthetic_goal` is removed from `_nodes` and `_adjacency`,
including back-edges from its neighbours. The path is then post-processed:
`_substitute_synthetic()` replaces all `_synthetic_goal` references with the original
`to_id` (the nearest waypoint). The exact click position is preserved as `_dr_final_goal`
for the dead reckoning last mile.

### HPA* bypass

The synthetic goal is never present in the HPA* cluster data (`_cluster_of`). When
clusters are loaded and a synthetic goal is active, the `_hpa_find_path` call detects
`to_cluster == ""` and falls through to flat bidirectional A*. No HPA* acceleration
applies to the synthetic goal routing.

---

## Route-to-Closest-Reachable-Waypoint Fallback (`pathfinder.gd:find_nearest_reachable`)

When the primary `find_path` returns an empty path, the client tries a fallback:
`find_nearest_reachable()` sorts all nodes by Euclidean distance to the click position,
skips `SYNTHETIC_GOAL_ID`, and attempts `find_path` to each of the top
`MAX_FALLBACK_CANDIDATES = 5` nodes. Returns the first candidate that produces a
non-empty path, or `""` if none work.

This handles cases where the click position's nearest waypoint is impassable (e.g.
clicked in a lake or glacier) but a slightly more distant waypoint is reachable.

---

## Neutral Territory Exclusion

### Client-side A* (`pathfinder.gd:_is_neutral_for`)

The `_is_neutral_for(node_id, player_nation_id, relations)` function checks whether a
waypoint node belongs to a nation the player is not at war with:

```
is_neutral_for(node_id, player_nation_id, relations):
    if player_nation_id is empty → false (no one to be neutral toward)
    if node.nation_id is null or same as player_nation_id → false (own or unclaimed)
    if relations is empty → false (cold start — no data yet, fail open)
    key = player_nation_id + ":" + node.nation_id
    if relations has key:
        stance = relations[key].stance
        return stance != "war"  # only war stance allows passage
    return true  # nation absent from relations → treat as neutral (blocked)
```

**In `_astar_impl`:** both forward and backward neighbor expansions check
`if v != to_id and _is_neutral_for(v, player_nation_id, relations): continue`.
The target node (`to_id`) is exempt — the search must be able to reach it even if
it lies in neutral territory. Synthetic goals at click positions bypass this by
having `nation_id: null` (never flagged as neutral).

**Relations data source:** `RELATIONS_UPDATED` is broadcast at game start and on
diplomatic changes. The client stores it in `GameState.relations`. The pathfinder
receives a snapshot at each `find_path` call.

### Server-side (`game-server/src/systems/movement_system.ts`)

The server mirrors the same logic in `_isNeutralFor()` for path validation and
`trimToAllowedTerritory()` for move order processing (see Territory Movement
Restriction in `STRATEGIC_COMBAT.md`).

---

## Combat-Zone Exclusion

Active combats exclude their combined engagement radius from A* routing, unless the
segment's own destination waypoint lies inside that same radius — a unit will detour
around an ongoing battle it has nothing to do with, but can still be deliberately routed
into one.

### Zone construction (`military_system.gd:_build_combat_zones`)

`GameState.active_engagement_pairs` (`engagement_id -> {division_a, division_b}`,
populated from the server's `COMBAT_STARTED`/`COMBAT_ENDED` broadcasts) is unioned via a
simple union-find: any two pairs sharing a division_id merge into one cluster, so a
"two attackers vs one defender" fight — which is two separate `ActivePair`s
server-side — becomes a single combat zone client-side. Each cluster's zone is the set
of its participants' current positions; the exclusion radius itself reuses
`ENGAGEMENT_RADIUS_KM = 25.0` (military_system.gd) / `ENGAGEMENT_RADIUS_DEG = 25.0/111.0`
(pathfinder.gd) — the same constant already used for the engagement-circle UI overlay.

Zones are rebuilt fresh on every pathfinding call rather than cached, since the cost is
bounded by the number of active engagements (not graph size), and this avoids any risk of
the cached zones drifting out of sync with `GameState`.

### Exclusion in `_astar_impl`

Mirrors neutral-territory exclusion exactly: both forward and backward neighbor
expansions add `_is_in_hostile_combat_zone(v, combat_zones, zone_exempt)` alongside the
existing `_is_neutral_for` check, and the segment's own `to_id` is always exempt from
exclusion (a node cannot be excluded by being its own destination). `zone_exempt` — which
zones the destination sits inside — is precomputed once per query
(`_combat_zone_exemptions`), not recomputed per node, so the added cost per node visited
is `O(zones)` distance checks, comparable to the existing neutral-territory lookup.

This is a **hard exclusion**, not a cost multiplier (unlike shift-move road avoidance):
if a combat zone fully blocks the only route to a destination, `find_nearest_reachable`'s
existing fallback (see "Route-to-Closest-Reachable-Waypoint Fallback" above) already
handles it by routing to the nearest reachable node short of the zone — no new fallback
logic was needed.

### Multi-waypoint chains

Each segment of a shift-move chain (`_recompute_chain`) computes its own combat zones
snapshot and calls `find_path` with its own milestone as `to_id`. A segment whose
destination waypoint sits inside a combat zone is exempt for that zone; a later segment
continuing past that waypoint toward a destination outside the zone is not — it will
detour around re-entering it. `_submit_reposition_order` (the reposition-during-combat
path used while a division is already engaged) does not apply this exclusion — that
function's whole purpose is computing a path constrained to stay within an active
combat's boundary.

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

## Hierarchical Layer (HPA*-style abstraction)

> **Status:** Pipeline cluster generation is implemented. Client-side HPA* routing is
> code-complete but the synthetic goal bypass (to_cluster is always empty) means flat A*
> is used for all right-click moves. HPA* only activates for non-synthetic targets
> (group move offset positions).

**Problem this solves:** the unified graph (road nodes at ~750m spacing plus the 3-tier
terrain grid at 7.5–22km spacing) gives the precision needed for combat-relevant terrain
decisions, but a full bidirectional A* search across the *entire* graph for a long-distance
move order is the source of the "pathfinding feels slow" problem on larger maps. Coarsening
the base graph to fix this would trade away exactly the terrain precision that matters near
combat. The fix is not to choose between fast-and-coarse or slow-and-precise — it's to add
a second, abstract layer on top of the existing graph, which stays untouched.

**Approach:** standard Hierarchical Pathfinding A* (HPA*). The base graph (every node and
edge described above) is partitioned into clusters at pipeline time — provinces are the
natural cluster unit for this game, since they're already a first-class concept in the map
data, rather than an arbitrary geometric grid. For every cluster, the pipeline pre-computes
and caches the optimal path cost between every pair of "border nodes" (nodes on the
cluster's edge that connect to a neighbouring cluster). This produces a small abstract
graph — one node per border crossing, not one node per terrain/road sample — on top of the
full-detail graph.

**Query-time behaviour:**
1. Run a cheap search on the **abstract graph** first — cluster-to-cluster, using the
   pre-cached border-crossing costs. This identifies which sequence of clusters the route
   should pass through, without touching most of the full-detail graph at all.
2. Run the existing full-precision bidirectional A* (unchanged, same two-phase routing and
   string-pulling as already specified above) **only within the clusters the abstract path
   actually crosses** — and always at full precision in the cluster containing the actual
   start point and the cluster containing the actual goal point, since that's where
   combat-relevant terrain precision matters most.
3. Stitch the per-cluster detailed segments together at the border-crossing nodes the
   abstract search already identified.

---

## Dead Reckoning (`military_system.gd`)

The client drives unit animation entirely from the validated waypoint list. No server
acknowledgement is awaited per waypoint — DR runs at 60fps from the client's local order
queue.

### Speed formula (mirrors `movement_system.ts` exactly)

```
road node:    DR_ROAD_KMH   = 60.0 km/h
off-road:     DR_OFFROAD_KMH / terrain_cost  (DR_OFFROAD_KMH = 20.0)
conversion:   DR_KM_PER_DEG = 111.0 km/deg
advance/frame = (kmh / DR_KM_PER_DEG) × GameState.game_speed × delta
```

A speed multiplier `_dr_speed_mult` is applied per division:
- Normal movement: 1.0×
- Reposition (in-combat): 0.30× (matches server's `REPOSITION_SPEED`)

### Waypoint consumption

`_advance_dr()` processes the front of `_dr_order` each frame. When distance to the
next waypoint falls below `DR_SNAP_DEG = 0.0001°` (~11 m), the waypoint is consumed
and popped from the queue. Leftover delta time is carried forward recursively through
the next waypoint, allowing multiple waypoints to be consumed in a single frame at
high game speeds.

### Last-mile — final goal advancement

When the last waypoint is consumed and `_dr_final_goal` is set (the exact click
position), DR enters the **last mile** phase. Rather than stopping at the last
waypoint, `_advance_dr_last_mile()` advances the icon frame-by-frame toward the
exact click position:

1. Each frame, compute distance remaining to `_dr_final_goal`
2. If within `DR_SNAP_DEG` → snap to final position, erase `_dr_final_goal`,
   set `_target_positions`, park icon with `set_moving(false)`
3. Otherwise → compute speed from **weighted average** of last-waypoint speed
   and destination terrain speed

**Weighted speed formula:**

```
base_speed:
  if last_waypoint was a road node → DR_ROAD_KMH (60)
  else                           → DR_OFFROAD_KMH / last_waypoint_terrain_cost

dest_speed:
  DR_OFFROAD_KMH / synthetic_goal_terrain_cost   (always "plains_flat" = 1.0)

final_speed = (base_speed + dest_speed) × 0.5
```

This averaging eliminates the speed discontinuity when the unit arrives at the
last waypoint via road (60 km/h) and transitions to off-road last mile (20 km/h).
The resulting speed of (60 + 20) / 2 = 40 km/h is a smooth deceleration rather
than a jarring 3× slowdown.

**`_target_positions` synchronisation:** After each last-mile step,
`_target_positions[div_id]` is updated to match the icon's current position.
This prevents the `_process` else-branch from lerping the icon back to a stale
position when `_dr_order` is empty but `_dr_final_goal` is still active.

**Visual path:** During the last mile, `_update_division_route()` appends the
final goal position as a visual endpoint to the route overlay, so the player sees
the complete path including the last leg.

### Server corrections

`_on_division_updated()` handles Colyseus state patches for each division:

**Consumed waypoint trimming:**
The server broadcasts `consumed_waypoint_ids` each tick. The client trims its local
`_dr_order` by checking if the first element matches each consumed ID:

```
for cid in consumed_waypoint_ids:
    if local_order is not empty and cid == local_order[0]:
        pop front
_dr_order[div_id] = local_order
```

**Client-ahead detection (suffix match):**
When the client's DR has consumed waypoints faster than the server, the consumed
IDs may not match the client's `local_order` front. A suffix match is used instead:

```
if local_order is not empty and local_order.size <= str_order.size:
    str_tail = str_order.slice(str_order.size - local_order.size)
    if local_order == str_tail:
        # Client is ahead but on the same route — advance position forward
        # to match the server's last consumed waypoint
    else:
        # Real divergence — full reset to server position
```

This prevents the client from snapping backward when DR simply outpaced server
consumption. Only real route changes (server rerouted) trigger a full reset.

**`at_final_goal` guard:**
When `local_order` is empty and `_dr_final_goal` is active (client in last mile),
the handler returns early — the server still has final_position_lng set. When the
server clears `final_position_lng` (arrived at its own final destination), the
client syncs its `_target_positions` to the server's position, which should
match the client's already-arrived icon position (no visual snap).

### `_process` dispatch

The `_process` loop decides per frame whether to call `_advance_dr`:

```
if _dr_order has div_id and (not _dr_order[div_id] is empty or _dr_final_goal has div_id):
    _advance_dr(div_id, delta)
    _update_division_route(div_id)
else:
    lerp icon toward _target_positions
```

This ensures `_advance_dr` is called even when `_dr_order` is empty, as long as
`_dr_final_goal` is still active (last-mile phase). Without the `_dr_final_goal`
check, the `else` branch would lerp the icon back to a stale `_target_positions`
on every frame after the last waypoint is consumed.

---

## Thread Safety

Pathfinding runs in a separate `Thread` to avoid blocking the main game loop. The
thread calls `_pathfinder.find_path()`, which previously mutated shared state via
`_insert_synthetic_goal()` / `_remove_synthetic_goal()`. Two concurrent threads
mutating the same GDScript Dictionary causes hash table corruption.

### Generation counter (`_path_gen`)

Each move request increments `_path_gen`. The deferred callback (`_on_direct_move_ready`,
`_on_segment_ready`) receives the generation ID and discards stale results:

```
if gen != _path_gen: return
```

This prevents a callback from a cancelled thread (e.g. user pressed ESC) from
overwriting state set by a newer request.

### Synthetic goal lifecycle on main thread

`_insert_synthetic_goal()` is called on the main thread **before** the thread
starts. The thread calls `find_path()` with `_skip_synthetic_lifecycle = true`,
which skips all insert/remove calls and performs a read-only A* search.
`_remove_synthetic_goal()` is called in `_on_direct_move_ready()` on the main
thread after the thread completes.

### `_clear_pending` waits for thread

`_clear_pending()` calls `_path_thread.wait_to_finish()` before clearing any
state, preventing a second thread from spawning while the first is still running.

### Read-only A* during fallback

`find_nearest_reachable()` skips `SYNTHETIC_GOAL_ID` in its candidate iteration
to prevent routing to the temporary node. When called from the thread with
`_skip_synthetic_lifecycle`, the fallback `find_path` calls use the flag to
skip lifecycle management.

---

## Path Smoothing (client-side, cosmetic only)

**Problem this solves:** the raw waypoint list (post string-pulling) is a polyline of
straight-line segments. Dead reckoning faithfully animates a division along that polyline,
which means the division's heading snaps sharply at every waypoint — visually jagged
movement, especially at any waypoint where the route changes direction by a wide angle.
This is a rendering problem, not a pathfinding problem: the *route* the waypoint list
describes is correct and unchanged by anything in this section.

**Approach:** a **centripetal Catmull-Rom spline** is fit through the waypoint list
client-side, after string-pulling and before handing the list to the dead-reckoning
animator. The spline passes exactly through every original waypoint (it does not
approximate or skip any of them, unlike a Bézier curve) while replacing the straight-line
segments between them with a smooth curve, so the division's heading changes continuously
through a turn instead of snapping. The centripetal variant specifically (rather than the
uniform variant) is required — the uniform variant can produce loops or self-intersections
on paths with unevenly-spaced waypoints, which this game's waypoint lists routinely have
(road nodes are densely spaced at ~750m, terrain nodes far sparser).

**Terrain-safety constraint:** a spline fit through waypoints can cut a corner that the
original A* route deliberately avoided (routing around a lake or impassable terrain
feature). To prevent this, the spline's maximum deviation from the original straight-line
polyline is clamped to a small bound (on the order of the base graph's road-node sampling
distance, ~750m) — the curve is only ever allowed to round off a corner by an amount that
cannot plausibly cut across terrain the route was already routed to avoid. If a deviation
bound would be exceeded at any segment (a genuinely sharp, necessary turn — e.g. squeezing
between two impassable features), that segment falls back to a straight line rather than
forcing a smooth curve through terrain the pathfinder explicitly avoided.

**Scope:** this is purely a client-side rendering step. It does not change which nodes
dead reckoning's speed formula or server corrections operate against — the server and the
authoritative waypoint list remain exactly as specified above; only the visual
interpolation between consecutive waypoints changes from a straight line to a clamped
spline segment.
