# Land Unit Movement Improvements — Findings & Design Notes

Status: **Points 2, 3, 4 implemented; Point 1 design approved but not yet implemented;
Point 5 invariant verified preserved.** Points 2-4 shipped behind a single coordinated
change to `military_system.gd` and `pathfinder.gd`. Concrete implementation anchors (line
numbers, function names) for each implemented point are below. Point 1 still requires a
separate implementation pass — see its section for the approved design and open
implementation questions.

## Background reading

- `docs/PATHFINDING.md` is the authoritative design doc for the existing waypoint-graph
  pathfinding system (road/terrain graph construction, bidirectional A*, HPA*, last-mile
  handling, shift-move road avoidance).
- Core files:
  - `client/src/systems/military/pathfinder.gd` — client A* engine, synthetic goal
    insertion, string-pulling, `_smooth_path`, `resolve_final_position`.
  - `client/src/systems/military/military_system.gd` — move-order orchestration,
    dead-reckoning (DR) animation loop, HUD route drawing, server reconciliation.
  - `game-server/src/systems/movement_system.ts` — authoritative server tick, move-order
    validation, last-mile advancement.
  - `game-server/src/rooms/GameRoom.ts` — move order submission entry point
    (`handleSubmitMoveOrder`).
  - `game-server/src/rooms/schema/GameRoomState.ts` — synced `DivisionState` schema
    fields (`move_order`, `consumed_waypoint_ids`, `final_position_lng/lat`).

---

## Point 1 — Single-click routes look unintuitive (APPROVED DESIGN)

**Problem:** For single right-click moves, the bidirectional A* picks the true
time-optimal route, but it sometimes visibly detours onto roads in a way that looks wrong
to the player even though it genuinely is faster given the speed/cost figures. The ask is
to make the chosen route *feel* more intuitive without abandoning true optimality by more
than a small, bounded margin.

**Scope:** single-click moves only (waypoint index 0, `shift_held == false`). Do **not**
touch the existing shift-move road-avoidance heuristic
(`military_system.gd:632`, `OFFROAD_THRESHOLD_DEG`/`MAX_ROAD_MULTIPLIER` at lines 34/36,
`_compute_avoidance_multiplier` at 751-752) — that is a separate, already-working
mechanism for multi-waypoint shift-click chains and should be left alone.

**Key fact that makes this safe:** the server does **not** independently re-run
pathfinding or judge path optimality. `movement_system.ts:176-181`
(`validateMoveOrder`) only checks that each submitted waypoint ID exists in the graph; it
doesn't even require consecutive waypoints to be edge-connected. The only other gate is
`trimToAllowedTerritory` (neutral/hostile land). So a client-side route-selection change
needs **no server-side mirroring** — whatever legal path the client submits is what gets
walked.

**Approved design:** run the existing bidirectional A* **twice** for a single-click move:

1. Normal search → true-optimal path, cost `C_opt`.
2. A second search using a "direction-biased" edge cost: same base costs, plus a penalty
   proportional to how much each edge's heading deviates from the straight bearing
   start→goal. This produces a more direct-looking route, cost `C_dir`.
3. If `C_dir <= C_opt * TOLERANCE` (tolerance is a tunable constant, starting suggestion
   ~1.10, i.e. 10% time-cost premium allowed), use the direction-biased path. Otherwise
   fall back to the true-optimal path.

Rationale for this shape (vs. baking directness into the base edge costs): baking it in
would change what is actually the fastest route (contradicts the goal — the user
confirmed the "weird" road route genuinely is faster and should still be chosen when the
gap is large), and the base costs are relied on elsewhere (ETA display, potentially future
supply/logistics reasoning, HPA* abstraction) — polluting them would need to be
re-validated everywhere. Doing it as a bounded post-hoc tie-break confines the change to
single-click route selection, costs one extra bounded A* search (already off-thread), and
mirrors the existing pattern used by the shift-move heuristic (layered on top, not baked
into base costs).

**Open implementation questions for the execution/planning pass:**
- Exact tolerance constant and whether it should vary by unit type/terrain.
- Exact heading-penalty formula for the biased search (e.g. `penalty = k * (1 - cos(edge_bearing - goal_bearing))` scaled against edge distance).
- Whether "meaningfully straighter" needs a minimum improvement threshold too (avoid
  swapping to the biased path for a negligible visual difference at the cost of an extra
  search every time).

---

## Point 2 — Off-road paths should have jitter/noise (IMPLEMENTED)

**Design (chosen):** off-road segments of the path now subdivide + offset perpendicular to
the segment by deterministic noise, applied AFTER the cost-optimal waypoint sequence is
fixed — purely a rendering-layer perturbation between consecutive real waypoints.
Road-to-road segments pass through unchanged (road geometry already implies curves; adding
noise on top reads as instability).

**Scope:** the jitter applies to the actual animated DR icon path, the HUD route line,
and the ghost overlay preview (cheap — same `_compute_visual_chain` helper threads the
same entry list through all three). Shift-move chains, group moves, and single-click
moves all route through the same helper, so the wobble is uniform everywhere a
client-visible path is built.

**Determinism:** noise is a pure function of `(division_id, segment_index, sub_index)` via
FNV-1a hashing — no global RNG state, no call-order dependency. The same call always
returns the same list, so this client's icon, this client's HUD, and other players' HUD
(all derived from the same call) draw the same wobble for the same route, and the wobble
is stable across reconciliation / replays.

**Constants (tunable, playtesting-required):**

| Constant                 | Value       | Meaning                                                  |
|--------------------------|-------------|----------------------------------------------------------|
| `JITTER_AMP_DEG`         | `0.003` (~330 m) | Max perpendicular offset. Below the road-node sampling distance (~750 m / `0.007°`) so a jittered sub-point can never stray far enough to cross into a different road's snap radius. |
| `JITTER_SUBDIV_STEP_DEG` | `0.015` (~1.7 km) | Target segment length between sub-points. |
| `MIN_JITTER_SUBDIVISIONS`| `2`         | Always emit at least this many sub-points per off-road segment. |
| `MAX_JITTER_SUBDIVISIONS`| `6`         | Cap on long off-road segments to bound cost. |

Sub-points join smoothly: amplitude follows a smoothstep `6t⁵ - 15t⁴ + 10t³` over each
segment, zero (and zero-derivative) at both endpoints — consecutive segments join at the
shared real waypoint without visible kinks.

**Implementation anchors:**
- `client/src/systems/military/pathfinder.gd:_inject_offroad_jitter` (post-string-pull
  expansion of real waypoint ids into the new entry shape — see "Entry shape" note below)
- `client/src/systems/military/pathfinder.gd:_waypoint_kmh` (centralised speed lookup)
- `client/src/systems/military/pathfinder.gd:_jitter_noise` (FNV-1a hash → [-1, 1])
- `client/src/systems/military/military_system.gd:_compute_visual_chain` (consumer-side
  wrapper that threads the result through DR seeding, HUD line, and ghost overlay)

**Removed dead code:** the original `_smooth_path` Catmull-Rom spline (which computed a
`"visual"` key never read by any consumer and mutated the shared `_nodes` dict as a side
effect) is deleted along with its helpers (`_catmull_rom_point`, `_lerp_pt`, `_lerp_pt_v`,
`_max_catmull_rom_deviation`, `_point_to_segment_dist`, `_dist`) and constants
(`MAX_SPLINE_DEV_DEG`, `SPLINE_SUBDIVISIONS`). `_build_path_result` now returns
`{ "logical": ... }` only.

---

## Point 3 — Clicking near a city should route toward the city point (IMPLEMENTED)

**Design (chosen):** `MilitarySystem._snap_click_to_nearest_city(lng, lat)` runs before
synthetic-goal insertion for both right-click (`_handle_right_click_move`) and shift-click
chain (`_handle_move_click`) flows. If any city position is within `CITY_SNAP_RADIUS_DEG
= 0.005` (~500 m at Western European latitudes) of the click, the click coordinates are
replaced with the nearest city's `city_position`.

**Data source:** cities are deliberately absent from the waypoint graph (they're a
strategic/UX concept, not a routing concept), so the client-side index is the only
lookup path. `provinces[i].city_position` is already loaded at runtime via
`MapLoader._province_data`; `_build_city_index` does one O(province_count) pass at setup
and `_snap_click_to_nearest_city` is O(cities) linear scan per click — well under1 ms.

**Why this radius:** deliberately tighter than `ROAD_SEARCH_RADIUS_SQ = 0.015²` (~1.5 km).
Roads are a routing preference — we don't care if a click near a road snaps to it, because
road choice is incidental to the player's intent. Cities, on the other hand, are a
deliberate UX target — snapping should feel like the unit explicitly walked into the city,
not that the click was a few hundred meters off and we guessed wrong. 500 m is roughly the
size of a small city footprint plus margin; clicks just outside read as "open terrain near
a city" and stay un-snapped.

**Server impact:** none. Snapped vs raw lng/lat is indistinguishable over the wire — the
server still runs `resolveFinalPosition` against its full graph. The snap is purely a
client-side "where do I want this unit to go" intent expression.

**Implementation anchors:**
- `client/src/systems/military/military_system.gd:_city_index` (field)
- `client/src/systems/military/military_system.gd:_build_city_index`
- `client/src/systems/military/military_system.gd:_snap_click_to_nearest_city`
- Called from `_handle_right_click_move` (~line 478) and `_handle_move_click` (~line 386).

---

## Point 4 — Last-mile hop looks like a teleport (IMPLEMENTED)

**Design (chosen):** the exact-click terminal is now the **last entry in `_dr_order`**
(identified by `id == ""`, the same discriminator as a jitter sub-point), not a separate
`_dr_final_goal` field. The terminal is consumed by the same `_advance_dr()` loop that
handles real waypoints and sub-points; there is no separate "last-mile" phase.

**Behavioural changes vs. the old `_advance_dr_last_mile`:**
- **Speed carryover, no averaging.** Terminal `kmh` is inherited from the chain's last
  real waypoint (cached in `_dr_last_real_kmh` per division). The original `(base + dest) /
  2` formula produced a 3× speed jump — the destination terrain's cost is irrelevant since
  the click was already validated as passable and the icon is *arriving*, not *transiting*.
- **Built lazily.** Self-submitted: appended by `_submit_move_order_for_division` after
  `_compute_visual_chain`. Foreign units: appended by `_build_server_entries` /
  `_refresh_terminal_entry` from the server's authoritative `final_position_lng/lat`
  broadcast. Mirrors the existing self / foreign symmetry (Point 5 invariant).
- **Refreshed mid-flight.** `_refresh_terminal_entry` overwrites the tail in place when the
  server's broadcast `final_position_lng/lat` differs from the client's prediction — this
  is what happens when client-side `resolve_final_position` (road-only graph) and the
  server's `resolveFinalPosition` (full road+terrain graph) disagree, a real and ongoing
  artifact of the asymmetric graphs.

**Entry shape (the data refactor that makes this work):** `_dr_order[div_id]` is now an
`Array` of homogeneous entry dictionaries, all consumed by the same DR loop. Each entry:

| Entry kind   | `id`      | `lng`/`lat` source                              | `kmh` source                          |
|--------------|-----------|--------------------------------------------------|----------------------------------------|
| Real waypoint| waypoint id | the graph node's coords             | terrain lookup at build time           |
| Jitter sub-point | `""`  | `_inject_offroad_jitter` output (Point 2)        | inherited from segment's source real waypoint |
| Terminal hop  | `""`     | `resolve_final_position` output (Point 4)        | inherited from chain's last real waypoint |

**Suffix-match adaptation:** the consumed-trimming logic in `_on_division_updated` filters
`_dr_order` to real-id entries (`str(entry["id"]) != ""`) before the suffix-match against
the server's `str_order` — synthetic entries are never in the server's
`consumed_waypoint_ids`, so they're consumed purely by the client's distance check.

**Terrain/neutrality validation preserved:** `resolve_final_position` (client mirror of
server's `resolveFinalPosition`) is unchanged — the terminal it returns still passes the
distance-cap + neutral-territory/terrain-passability sweep. No regression on commit
`d9efe6e`'s "no walking through impassable/enemy ground during final hop" guarantee.

**Self / foreign parity preserved:** every consumer of `_dr_order` (icon animation,
HUD route, ghost overlay, suffix-match trimming) is reached identically for self and
foreign units through the shared `_on_division_updated` / `_advance_dr` /
`_update_division_route` path. See `_refresh_terminal_entry` and `_build_server_entries`.

**Removed dead code:** `_advance_dr_last_mile` (entire function), `_dr_final_goal`
Dictionary field, `_dr_last_waypoint_road` / `_dr_last_waypoint_terrain` scalars (replaced
by `_dr_last_real_kmh[div_id]` and entry-baked `kmh`).

**Implementation anchors:**
- `client/src/systems/military/military_system.gd:_dr_last_real_kmh` (field)
- `client/src/systems/military/military_system.gd:_advance_dr` (simplified loop)
- `client/src/systems/military/military_system.gd:_submit_move_order_for_division`
  (append terminal after `_compute_visual_chain`)
- `client/src/systems/military/military_system.gd:_on_division_updated` (foreign terminal
  sync via `_refresh_terminal_entry`, server-final-cleared trim, reroute full reset)
- `client/src/systems/military/military_system.gd:_build_server_entries` (foreign seed)
- `client/src/systems/military/military_system.gd:_refresh_terminal_entry` (mid-flight
  server-correction)

---

## Point 5 — Self vs. foreign-unit rendering parity (VERIFIED, NO FIX NEEDED — PRESERVE AS INVARIANT)

**Finding:** other players' units are **not** rendered via network-position
interpolation. Foreign units are run through the exact same client-side DR
(dead-reckoning) waypoint-replay code as the player's own units
(`FOREIGN_UNIT_PATH_DR = true`, `military_system.gd:38`; single shared handler
`_on_division_updated`, `military_system.gd:1401-1538`), fed the same `move_order`
waypoint list broadcast via the Colyseus schema (`GameRoomState.ts:80,86`). The
last-mile hop also fires identically for foreign units, since `final_position_lng/lat`
is a synced schema field read for all divisions, not just the locally-controlled ones
(`military_system.gd:1445-1457`).

The only difference between self and foreign rendering is a ~0.15s reconciliation lerp
(`RECONCILE_DURATION_S`, `military_system.gd:206`) applied only when the client's
predicted DR waypoint queue is genuinely *not* a prefix/suffix match of the server's
authoritative order (confirmed via `military_system.gd:1509-1534`: the common case where
prediction matches server consumption takes the `is_ahead` branch and never touches the
reconcile lerp at all — this only fires on real desync events: reroutes, combat
interrupts, lag spikes). This is working as intended and is not "too frequent."

**Preservation under Points 2 + 4:** the entry-shape refactor preserves parity
deliberately. Every consumer of `_dr_order` (icon animation in `_advance_dr`, HUD line in
`_update_division_route`, ghost overlay in `_get_chain_positions`, suffix-match trimming
in `_on_division_updated`) threads through the same data source and the same projection
helper (`_project_entries_to_world`) for both self and foreign. The terminal hop is built
identically — `_submit_move_order_for_division` for self and `_build_server_entries` /
`_refresh_terminal_entry` for foreign both produce an entry list with the same shape and
the same kmh inheritance rule. The 0.15 s reconcile lerp still applies only on real
divergence.
