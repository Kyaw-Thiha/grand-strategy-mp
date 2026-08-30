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

## City-Snapping (Point 3, `military_system.gd`)

**Problem this solves:** for clicks clearly meant to land on a city (a deliberate target
rather than a few pixels off the dot), the player's intent reads as "go to *that city*",
not "go to whatever pixel I happened to click." Currently A* routes to the nearest
road/terrain node, so a click 50 m off the city center can route to a node on the
opposite side of the city from where the player expected the unit to stop.

**Approach:** before invoking pathfinding, the click coordinates are passed through
`_snap_click_to_nearest_city(lng, lat)` (called from `_handle_right_click_move` and
`_handle_move_click`). If any city position is within `CITY_SNAP_RADIUS_DEG = 0.005` of
the click (~500 m at Western European latitudes), the click coordinates are replaced
with the nearest city's `city_position` from `provinces.geojson`. The snapped
coordinates then flow through `_map_loader.world_to_lng_lat` → synthetic-goal insertion →
A* → DR the same way raw clicks always have.

**Why a small radius:** the radius is deliberately tighter than the road snap radius
(`ROAD_SEARCH_RADIUS_SQ = 0.015²`, ~1.5 km). Roads are a routing preference — we don't
care if a click "near" a road snaps to it, because road choice is incidental to the
player's intent. Cities, on the other hand, are a deliberate UX target — snapping should
feel like the unit explicitly walked into the city, not that the click was a few hundred
meters off and we guessed wrong. 500 m is roughly the size of a small city footprint
plus margin; clicks just outside read as "open terrain near a city" and stay un-snapped.

**City data source:** `provinces[i].city_position` (`map/tools/map_pipeline/pipeline.py` line
240 — `[city_lng, city_lat]`), already loaded into the client at runtime via
`MapLoader._province_data`. `MilitarySystem._build_city_index` does one O(province_count) pass
at setup; click-time snap is then an O(cities) linear scan per click — well under 1 ms in
practice. Cities are deliberately absent from the waypoint graph itself, so this client-side
index is the only lookup path.

**Server impact:** none. The snapped vs raw lng/lat is indistinguishable over the wire —
the server still runs `resolveFinalPosition` against its full graph. The snap is purely a
client-side "where do I want this unit to go" intent expression.

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

### Known limitation: no hydration on join/reconnect

`GameState.active_engagement_pairs` is populated only by the `COMBAT_STARTED` broadcast.
A client that joins or reconnects mid-game receives no such broadcast for battles already
in progress, so combat-avoidance does not apply to any pre-existing engagement until it
ends and a fresh `COMBAT_STARTED` fires. This is fail-open — identical to pre-feature
behavior — and not addressed by this feature; building hydration is tracked separately.

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

### Entry shape (Points 2 + 4)

`_dr_order[div_id]` is an `Array` of homogeneous entry dictionaries, all consumed by the same
`_advance_dr()` loop. Each entry has shape `{id: String, lng: float, lat: float, kmh: float}`:

| Entry kind   | `id`      | `lng`/`lat` source                              | `kmh` source                          |
|--------------|-----------|--------------------------------------------------|----------------------------------------|
| Real waypoint| waypoint id (e.g. `"w_123"`) | the graph node's coords             | terrain lookup at build time           |
| Jitter sub-point | `""`  | `_inject_offroad_jitter` output (Point 2)        | inherited from segment's source real waypoint |
| Terminal hop  | `""`     | `resolve_final_position` output (Point 4)        | inherited from chain's last real waypoint |

The `id == ""` discriminator lets the suffix-match logic in `_on_division_updated` skip
synthetic entries (sub-points and terminal are never in the server's `consumed_waypoint_ids`),
while `_advance_dr()` treats every entry uniformly.

### Speed formula (mirrors `movement_system.ts` exactly)

```
road waypoint:    DR_ROAD_KMH                       = 60.0 km/h
off-road waypoint: DR_OFFROAD_KMH / terrain_cost    (DR_OFFROAD_KMH = 20.0)
conversion:        DR_KM_PER_DEG                    = 111.0 km/deg
advance/frame:     (kmh / DR_KM_PER_DEG) × GameState.game_speed × delta
```

`kmh` is **precomputed per entry at build time** (`_waypoint_kmh` in `pathfinder.gd` for real
waypoints; inherited for sub-points and the terminal). The per-frame loop in `_advance_dr()` no
longer does any terrain or profile lookup — it just reads `entry["kmh"]` and multiplies by
`_dr_speed_mult[div_id]` (1.0× normal, 0.30× for reposition — matches server's `REPOSITION_SPEED`).

### Waypoint consumption

`_advance_dr()` processes the front of `_dr_order` each frame. When distance to the
front entry's `(lng, lat)` falls below `DR_SNAP_DEG = 0.0001°` (~11 m), the entry is consumed
and popped from the queue. Real entries update `_dr_last_real_kmh[div_id]` (cached so that a
mid-flight server-broadcast `final_position_lng/lat` update can build a fresh terminal entry
without losing the speed carryover). Leftover delta time is carried forward recursively through
the next entry, allowing multiple entries to be consumed in a single frame at high game speeds.

### Final-hop (Point 4) — first-class trailing entry

The exact-click terminal hop is the **last entry in `_dr_order`**, identified by `id == ""`
just like a jitter sub-point. There is no separate "last-mile" phase — the same `_advance_dr()`
loop that consumes real waypoints and jitter sub-points also consumes the terminal. The
behavioural differences from a real waypoint are:

- **`kmh` is inherited** from the chain's last real waypoint (no terrain recomputation, no
  destination/terrain averaging — the original code's `(base + dest) / 2` "smooth"
  deceleration was actually a 3× speed jump that read as a teleport).
- **Built lazily**: appended by `_submit_move_order_for_division` for self-submitted moves,
  and by `_on_division_updated` / `_build_server_entries` / `_refresh_terminal_entry` for
  foreign units (mirroring the server's authoritative `final_position_lng/lat` broadcast).
- **Refreshed when server changes its mind**: `_refresh_terminal_entry()` overwrites the tail
  in place if the server's broadcast `final_position_lng/lat` differs from what the client
  predicted (the client's pre-submit `resolve_final_position` only sees the road-only graph;
  the server resolves against the full road+terrain graph).

`_target_positions` synchronisation: After each terminal step, `_target_positions[div_id]` is
updated to match the icon's current position. This prevents the `_process` else-branch from
lerping the icon back to a stale position when `_dr_order` is empty.

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
IDs may not match `_dr_order`'s front (which may now be a sub-point with `id == ""`,
not the server's next real waypoint). The comparison filters `_dr_order` to real-id
entries (`str(entry["id"]) != ""`) before the suffix check, since the server has no
notion of synthetic sub-points:

```
cur_real_ids = filter(_dr_order[div_id], entry => entry.id != "")
if cur_real_ids is non-empty and cur_real_ids.size <= str_order.size:
    str_tail = str_order.slice(str_order.size - cur_real_ids.size)
    if cur_real_ids == str_tail:
        # Client is ahead but on the same route — advance position forward
        # to match the server's last consumed waypoint
    else:
        # Real divergence — full reset to server position
```

This prevents the client from snapping backward when DR has simply outpaced server
consumption. Only real route changes (server rerouted) trigger a full reset.

**`at_final_goal` guard:**
When `_dr_order` is empty (client has consumed everything including the terminal) and the
server still has trailing real waypoints in `str_order`, the next broadcast will catch up via
`consumed_waypoint_ids`. Once the server clears `final_position_lng/lat` (arrived), the
client syncs its `_target_positions` to the server's position, which matches the client's
already-arrived icon position (no visual snap).

### `_process` dispatch

The `_process` loop decides per frame whether to call `_advance_dr`:

```
if _dr_order has div_id and not _dr_order[div_id].is_empty():
    _advance_dr(div_id, delta)
    _update_division_route(div_id)
else:
    lerp icon toward _target_positions
```

Point 4 collapsed `_dr_final_goal` into `_dr_order`, so a non-empty check on `_dr_order` is
sufficient — the terminal hop is just the last entry in the queue.

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

## Off-road Jitter (Point 2, client-side rendering)

**Problem this solves:** off-road segments of the path (any segment between two non-road
nodes, including terrain-to-terrain and terrain-to-road transitions) trace as dead-straight
lines on the HUD overlay and as dead-straight animation for the unit icon, which reads as
mechanical and "wrong" — road geometry already implies natural curves, but off-road travel
should look like it's cutting through uneven terrain rather than a laser beam. This is purely
a rendering concern: the *route* the waypoint list describes is unchanged, and the server
still ticks through the same real waypoint ids.

**Approach:** after A* + string-pulling produce the path's real waypoint ids, an additional
post-processing pass (`Pathfinder._inject_offroad_jitter`) expands the list into the entry
shape DR consumes (see "Entry shape" above). For each pair of consecutive real waypoints:

- If both are road nodes → no jitter (just the two endpoints, road geometry is already
  "jittery" in spirit and adding noise would look unstable on a path the player expects to be
  smooth).
- If at least one is off-road → subdivide the segment into `N` interior sub-points, each
  offset perpendicular to the segment by a smoothstep-tapered noise amplitude.

**Constants:**

| Constant                 | Value       | Meaning                                                  |
|--------------------------|-------------|----------------------------------------------------------|
| `JITTER_AMP_DEG`         | `0.003` (~330 m) | Max perpendicular offset. Below the road-node sampling distance (~750 m / `0.007°`) so a jittered sub-point can never stray far enough to cross into a different road's snap radius. |
| `JITTER_SUBDIV_STEP_DEG` | `0.015` (~1.7 km) | Target segment length between sub-points. Between road-node spacing and complex-tier terrain spacing, so short off-road segments generate 2 sub-points, longer ones up to 6. |
| `MIN_JITTER_SUBDIVISIONS`| `2`         | Always emit at least this many sub-points per off-road segment. |
| `MAX_JITTER_SUBDIVISIONS`| `6`         | Cap the count on long off-road segments to bound cost. |

**Taper:** the offset amplitude follows a smoothstep `6t⁵ - 15t⁴ + 10t³` over each segment,
which is zero (and zero-derivative) at both endpoints. Consecutive off-road segments therefore
join seamlessly without visible kinks at the shared waypoint.

**Determinism:** the noise value is a pure function of `(division_id, segment_index, sub_index)`
via FNV-1a hashing — no global RNG state, no call-order dependency. The same call always
returns the same list. This is what lets the icon animation, the HUD route line, and other
players' HUD (all derived from the same call) agree on the geometry, and what makes the wobble
stable across reconciliation / replays.

**Terrain-safety constraint:** the noise amplitude (`0.003°`) is well below the
road-node spacing (`0.007°`) and the `ROAD_PROXIMITY_DEG` snap radius (`0.003°`) — the
jittered sub-points cannot stray far enough from the original straight segment to enter a
different corridor or cross into impassable terrain the A* route was chosen to avoid.

**Scope:** this is purely a client-side rendering step, applied on the main thread (not the
pathfinding Thread) by the consumer (`military_system._compute_visual_chain`). The server's
authoritative waypoint list stays as the un-jittered string ids; only DR consumption, the
HUD route overlay, and the ghost overlay see the jittered entry list. Shift-move chains,
group moves, and single-click moves all pass through the same helper, so the wobble is
applied uniformly everywhere a client-visible path is built.
