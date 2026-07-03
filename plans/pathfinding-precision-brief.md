# Pathfinding Precision — Supplementary Brief

> **Status:** Discussion notes, not yet reflected in `PATHFINDING.md` / `DEV_PHASES.md` / `STRATEGIC_COMBAT.md`.
> This document assumes you already have full access to those docs — it does **not** repeat
> what's already specified there (waypoint graph structure, two-phase routing, string-pulling,
> shift-move avoidance, dead reckoning, path smoothing). It only covers what was decided in
> discussion that the docs don't yet say, plus one doc-staleness flag you should resolve first.

---

## 0. Doc staleness to resolve before touching any of this

`TACTICAL_COMBAT.md` and `MAP_DATA_CONTRACT.md` currently say combat samples terrain via
**pre-computed O(1) province-level fields, explicitly "no per-pixel sampling occurs at
runtime."** This is **stale**. Actual current behavior, per `UI_UX_DESIGN.md` §3 (which is
correct) and confirmed in discussion: combat samples terrain **per-pixel, at sub-province
resolution, at each combat tick**, reading directly against the cover/elevation raster data
at the division's live position — not via province-level lookup.

**Action:** update `TACTICAL_COMBAT.md`'s "How terrain is determined for combat" section and
`MAP_DATA_CONTRACT.md`'s "Tactical combat terrain query" section to reflect per-pixel runtime
sampling against the raster, not the O(1) province field lookup. Everything below assumes the
corrected (per-pixel) model is the real one.

---

## 1. Hierarchical layer: recursive sub-partitioning for large clusters — NOT a flat 2 levels

**Correction from earlier discussion:** a flat 2-level design (base graph + one abstract
layer over province clusters, full stop) was initially proposed and is **wrong** once actual
province sizing is accounted for. Updated conclusion: **recursively sub-partition any
cluster that's too large, as many levels deep as its size requires — most clusters stay
flat at 2 levels; large ones get as much internal sub-partitioning as the threshold check
calls for (expected to be one extra level — 3 total — for the current map's large nations,
see the worked numbers below, but this should fall out of the threshold check, not be
hardcoded).**

### Why the flat-2-level reasoning broke

The original reasoning assumed "province = cluster" meant *small, local* clusters, and
treated the 2-vs-3-level question as a function of total cluster *count* (~80–150 provinces
→ ~150-node abstract graph → trivially fast to search → no need for a 3rd level).

That count-based reasoning is fine as far as it goes, but it misses the actual bottleneck:
the documented HPA* design always runs **full-precision A* inside the start cluster and the
goal cluster, regardless of cluster size**. The 2-level design's speed guarantee rests on an
unstated assumption that "a cluster" is small enough that full-detail search inside one is
cheap. That assumption fails here, because **provinces are not sized to real-world
geographic provinces — they're sized to balance province *count* across nations**, and major
nations get few, large provinces. Confirmed example: France, UK, Germany, Spain, Algeria,
Italy are each ~8 provinces on the Western Europe map — meaning a single France-province is
roughly **250km across** (a France-sized province is an aggregation of 2–3 real-world
provinces, not one). Rough node-count estimate for a single cluster that size, using the
existing tier spacings already in `PATHFINDING.md`: ~150 nodes if dominated by open terrain
(22km tier) up to ~1,200+ if dominated by complex terrain (7.5km tier), *plus* potentially
thousands of road nodes if the cluster has a dense road network. A move from one side of
such a province to the other never crosses a cluster boundary, so it never benefits from the
abstract-layer shortcut — it pays full bidirectional A* over a node count in the
hundreds-to-low-thousands every time. That is exactly the slow case the hierarchical layer
exists to prevent, and a flat 2-level design lets it fall straight through.

This also directly affects future maps: any map covering more geography at the same or
coarser province granularity makes this worse, not better, since cluster size — not cluster
count — is the driver. This is a forward-looking correctness issue, not just a current-map
edge case.

### What to build instead

1. At pipeline time, **after province-clusters are formed exactly as already documented**,
   compute each cluster's internal node count (or a geometric size proxy, e.g. bounding-box
   diagonal) and compare against a threshold.
2. **Clusters below the threshold** (expect this to cover most minor nations — e.g. the
   1–3-province nations mentioned in discussion) stay exactly as currently specified in
   `PATHFINDING.md`'s Hierarchical Layer section: flat, single abstract-layer membership,
   no further changes needed.
3. **Clusters above the threshold** (expect large nations like France/UK/Germany/Spain/
   Algeria/Italy to hit this) get **recursively sub-partitioned internally** using the same
   border-node-caching HPA* mechanism already specified for the province-level abstract
   layer — i.e., the same technique, applied as many levels deeper as needed, only where a
   cluster is big enough to need it. This is the literal "more than two levels" extension
   the source paper describes (clusters of clusters) — see the paper link at the end of
   this document — applied selectively rather than globally.

   **Implement this as a recursive rule, not a fixed extra level:** after splitting a
   cluster, re-check each resulting sub-cluster against the same threshold, and split again
   if it's still over. Do not hardcode "exactly one extra level" / "exactly 3 levels total"
   — the number of levels that result should fall out of the threshold check, not be a
   constant anywhere in the code. This is what makes the fix self-scaling for future maps
   (see point 5) without needing to be revisited if a future map has even larger clusters
   than anything on the current map.

   **Sanity check on current map sizes, so you know what to expect in practice (not a
   target to hit, just context):** for the ~250km France-sized clusters in the current
   Western Europe map, a single round of splitting (e.g. a 2×2 or 3×3 geometric split)
   already brings each sub-cluster down to roughly 65–130km across, which — even in the
   worst case (complex terrain tier, 7.5km node spacing) — is on the order of 100–300
   nodes per sub-cluster, comfortably in "fast bidirectional A*" territory. So for *this*
   map, the recursion is expected to terminate after one extra level in practice (3 levels
   total for large clusters, 2 for small ones) — but that should be an emergent result of
   the threshold check on real node counts, not something hardcoded as "split exactly
   once."
4. **Query-time behavior is otherwise unchanged**: cheap search at the top abstract layer
   to pick which top-level clusters a route crosses (as already documented) → for any
   top-level cluster that turns out to be sub-partitioned, run a cheap abstract search over
   its internal sub-clusters to narrow further (recursing through however many levels that
   cluster actually has) → full-precision A* only inside the specific deepest-level
   sub-cluster(s) actually touched by start/goal. The end result: a long move across a
   large country-sized province gets the same speed benefit a cross-province move already
   gets today, instead of silently paying full-detail cost just because it happens not to
   cross a top-level province boundary.
5. This is self-scaling for future bigger maps: the size *threshold*, applied recursively,
   decides how many levels of sub-partitioning a given cluster needs, so a future map with
   even larger or more geographically uneven provinces automatically gets however much
   sub-partitioning it needs, without anyone needing to notice and manually add a 4th or 5th
   level later. The threshold is the only number that should ever need revisiting; the level
   count should never be a magic constant in the codebase.

### What does NOT need this

Small clusters (most minor nations, 1–3 provinces total) should be left flat — don't apply
sub-partitioning uniformly everywhere. The cost of sub-clustering (extra precompute, extra
cache, extra query-time hop) only pays for itself where a cluster is actually big enough for
within-cluster full-detail search to be the expensive case. Uniformly sub-clustering every
province regardless of size would reintroduce the original objection to a blanket 3rd
level — paying overhead somewhere it isn't needed.

### Open question to settle during implementation (not a design blocker)

What the size/node-count threshold should actually be, and whether to key it off node count,
bounding-box diagonal, or something else. Suggest validating against real numbers once the
boundary-node work in §3 is in and node counts are known precisely, rather than guessing a
number now.

---

## 2. Base graph density: keep the existing non-uniform 3-tier grid as-is for interiors

Discussion conclusion: **do not increase uniform node density anywhere.** The existing
3-tier system (open 22km / medium 11km / complex 7.5km, per `PATHFINDING.md`) is correctly
sized — it puts precision where combat-relevant terrain complexity actually lives and leaves
homogeneous interior terrain (most of the map's area) coarse, which is fine because nothing
differentiates one plains patch from its neighbor for *routing* purposes.

Increasing uniform density was considered and rejected: it would multiply node count (and
therefore full-detail A* cost inside hierarchical clusters) for no gameplay benefit, directly
undermining the speed win the hierarchical layer (§1) exists to provide.

**This conclusion does NOT mean "terrain precision doesn't matter" — see §3, which is the
actual fix for the real problem that motivated this whole discussion.**

---

## 3. NEW WORK — Boundary-conforming node insertion

This is the real gap the discussion surfaced, and it's not covered anywhere in the existing
docs. The existing pipeline (`MAP_DATA_CONTRACT.md` step 9 / `PATHFINDING.md`'s waypoint
generation) places nodes on a **regular geometric grid sampled at fixed intervals**, then
reads whatever terrain happens to fall at each grid point. It does **not** place nodes *at*
terrain category boundaries — boundary alignment with the uniform grid is incidental, never
intentional. This means a route's cost field can be wrong near a boundary the grid didn't
happen to land on, and — more importantly — a narrow impassable feature near a boundary can
be missed entirely (this is the same class of bug `PATHFINDING.md` already flags for
string-pulling: "thin impassable strips narrower than node spacing may occasionally be
crossed after pulling," just showing up at graph-generation time instead).

### What to build

Add a new pipeline sub-step, after the existing uniform 3-tier sweep, in `pipeline.py`'s
waypoint generation:

1. **Detect boundaries directly from the source vector geometry**, not the raster. The
   cover and elevation polygon layers (`cover.geojson`, `elevation.geojson` per
   `MAP_DATA_CONTRACT.md` Layer 2) already have exact boundary lines between every pair of
   adjacent polygons with different `cover_combat` or `elevation_type` values — this is
   vector geometry the pipeline already has access to, not something that needs new
   authoring.
2. **Insert nodes along every such boundary line**, at a fixed sampling interval along the
   boundary (reuse the existing `SAMPLE_DEG`-style approach — e.g. one node every ~750m
   along the boundary, matching road-node density, not the coarser terrain-tier spacing).
   Each inserted node should carry the `cover_combat`/`elevation` of whichever side of the
   boundary it's intended to represent (consider inserting a pair of nodes, one per side,
   very close together at each sample point, if a single shared node can't unambiguously
   represent both sides' cost — implementation detail, use judgement here).
3. **Process ALL adjacent category-pair boundaries uniformly — not a curated subset.**
   Discussion explicitly considered and rejected restricting this to "combat-meaningful"
   transitions only (e.g. entering/leaving urban, entering/leaving dense_forest, river
   crossings). Reasoning: node count from this step scales with **total boundary length**,
   not with how many category-pairs you choose to care about — skipping some transitions
   doesn't meaningfully reduce node count, it just reintroduces the same gap for whichever
   transitions get skipped. Process every boundary the vector data contains, with no
   category allowlist/denylist to maintain.
4. **Connect boundary nodes into the existing graph** using the same connectivity rules
   already specified (`CONNECT_DEG` terrain-to-terrain K=8, `ROAD_CONNECT_DEG` K=3) — no new
   connectivity logic needed, boundary nodes are just ordinary graph members.
5. River and urban boundaries are **not a special case** — they fall out of this mechanism
   automatically, since they're exactly where `cover_combat` changes most often per unit
   area. No separate "densify near rivers/urban" rule is needed on top of "insert nodes at
   all boundaries."

### Cost expectation

Bounded by total polygon boundary length across the map's cover/elevation layers, which is a
modest, roughly-fixed quantity for an 80–150 province map (not proportional to map area) —
expect low thousands of additional nodes at most, concentrated where boundaries actually run,
with zero new nodes in homogeneous interior terrain (most of the map). This should not
meaningfully change cluster sizes for the hierarchical layer (§1) — boundary nodes simply
join whichever province-cluster they geometrically fall in.

### What this fixes

- A* cost fields near a boundary now reflect the true boundary location, not an
  extrapolation from a uniform-grid node that may be many km away on the wrong side.
- Narrow impassable features near/at a boundary (e.g. a thin dense_forest tongue blocking
  armor) are represented in the graph instead of being silently averaged away.
- This is what makes the route-cost information a player sees (ETA tooltips on ghost
  dots, "can my armor even get there") trustworthy — see §4 for why this is NOT what makes
  final unit position exact; that's a separate, already-solved concern.

### What this does NOT need to solve

Per discussion: **in-transit path visual/geometric precision is explicitly out of scope.**
The route a division travels only needs to follow the existing heuristic rules already
specified (two-phase routing, string-pulling, shift-move avoidance) — it does not need to be
pixel-perfect, and boundary nodes are not being added to make the rendered path hug terrain
more tightly. They exist purely so cost/passability computation near boundaries is correct.

---

## 4. NEW WORK — Exact goal-point resolution (synthetic goal node insertion)

This is the fix for "can a unit actually end up at the exact spot the player clicked,
especially when that spot is deliberately chosen for its terrain (e.g. just inside an urban
polygon for the cover bonus)." Not covered in any existing doc.

### The problem

Currently, a player's move-order click is an arbitrary continuous (lng, lat) coordinate, but
nothing in `pathfinder.gd`'s documented two-phase routing describes how that coordinate
becomes a graph goal. If goal resolution just means "search to the nearest existing
pre-baked node," then in open terrain (22km tier spacing) a player's intended destination
could resolve to a node many km away — potentially on the wrong side of a terrain boundary
from what they were visually aiming for. Given combat reads terrain at the division's actual
live position (per §0's correction), this is a real gameplay outcome, not just a visual
nitpick: the player sees themselves clicking "into the city" and may get combat resolved as
if they're standing in a field.

### The fix

1. On move-order click (and on each shift-click waypoint, and on Waypoint Drag Refinement's
   final release position), insert the player's **exact** clicked/released coordinate as a
   **synthetic query-time node** — not a snap to the nearest pre-existing node.
2. Connect this synthetic node into the graph using the same K-nearest-neighbour
   connectivity already specified for terrain-to-terrain and terrain-to-road connections
   (reuse `CONNECT_DEG` / `ROAD_CONNECT_DEG` logic).
3. Run the existing two-phase A* (unchanged) against the graph-plus-synthetic-node. No
   change to the pre-baked graph itself, no pipeline cost — this is query-time only. This is
   independent of how many hierarchical levels are active for the cluster the goal falls in
   (see §1) — the synthetic node is inserted into whichever level's full-detail graph
   ultimately runs the precise search.
4. The division's final waypoint is therefore the player's true click position, exact, not
   an approximation.

### Why this alone is sufficient for "exact final position" — no further work needed

Per `PATHFINDING.md`'s existing Dead Reckoning and Path Smoothing sections: dead reckoning
already interpolates continuously between waypoints (it is not snapped to a discrete grid at
render time), and the centripetal Catmull-Rom spline already passes **exactly** through
every waypoint in the list, including the final one. So once the goal *itself* is exact
(this section's fix), the division's actual final resting position is already pixel-exact,
automatically, with zero changes to dead reckoning or path smoothing. Per-pixel combat
sampling (§0) then reads exactly the position the player intended.

**Important scope boundary, confirmed in discussion:** this fix is about the *destination*
only. It does not, and should not, attempt to make the *route leading there* pixel-precise —
that's explicitly out of scope (see end of §3). The in-transit path still only needs to
follow the existing heuristic rules.

### Relationship between §3 and §4 — both are needed, for different reasons

These solve two different problems and neither substitutes for the other:

- **§4 alone** gets the unit to the exact clicked point, but the *route cost/ETA the player
  sees while deciding to click there* could still be wrong if the graph near that point
  never represented the real boundary (no boundary nodes near the goal → K-nearest
  connectivity for the synthetic node might connect across a boundary it doesn't know
  exists, implying a route/cost that isn't real).
- **§3 alone** makes route costs and passability correct near boundaries, but without §4 the
  unit would still stop at the nearest *pre-existing* node rather than the player's actual
  intended pixel.
- **Together:** exact final position (§4) + trustworthy cost/passability information leading
  there (§3).

---

## 5. Open implementation question to flag back to design (not yours to decide)

How should the boundary-node insertion interval (§3, step 2) be chosen? Discussion did not
settle on a specific number beyond "reuse something like the existing 750m road-node
spacing as a starting point." Flag this as a tunable to validate against actual pipeline
runtime once implemented, not a fixed requirement.

---

## Reference paper

Original HPA* paper, hosted directly by one of the authors (Martin Müller, University of
Alberta) — this is the canonical source for the hierarchical layer design in
`PATHFINDING.md`:

**Botea, A., Müller, M., & Schaeffer, J. (2004). "Near Optimal Hierarchical Path-Finding."
Journal of Game Development, 1(1), 7–28.**

PDF: http://webdocs.cs.ualberta.ca/~mmueller/ps/2004/hpastar.pdf

Relevant for: the general N-level cluster/border-node abstraction technique behind
`PATHFINDING.md`'s Hierarchical Layer section (§1 above confirms why we're deliberately
stopping at 2 levels despite the paper supporting more), and the published benchmark
(~10x speedup, paths within ~1% of optimal) that `PATHFINDING.md` already cites.
