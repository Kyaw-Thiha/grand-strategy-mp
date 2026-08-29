# Handoff — Subprovince Capture System

> Give this file to the coding agent alongside the three updated docs and three prototype
> scripts listed below. It exists so the agent doesn't have to reconstruct the reasoning
> behind the design from a chat log — everything it needs to start implementing is either
> in this file or pointed to from it.

## What changed, in one paragraph

The Dynamic Frontline System (continuous per-tick influence blending across a shader-rendered
isoline, with 50%/70% percentage thresholds) is **replaced, not deferred** — it was actually
implemented once before and didn't work out in practice. In its place: every province is
subdivided at map-build time into small polygons called **subprovinces**, which partition the
province exactly (no gaps, proven at build time). Ownership of each subprovince is a discrete
per-nation flag that flips on literal unit occupancy, not a computed influence value. This
same subprovince graph is now also the substrate for supply connectivity, retreat pathing, and
encirclement, replacing three previously-separate waypoint-influence-based mechanisms with one
graph and one set of queries over it.

## Where the actual spec lives now

Don't treat this handoff as the spec — it's a map, not the territory. The updated sections are:

- **`STRATEGIC_COMBAT.md` → "Subprovince Capture System"** (replaces the old "Dynamic
  Frontline System" section in the same location) — generation algorithm, capture rule,
  rendering/fade transition, visibility by player type.
- **`STRATEGIC_COMBAT.md` → "Supply and encirclement — three-tier status system"** (same
  location as before, rewritten) — the three tiers, now defined as subprovince-graph queries
  instead of waypoint-influence-percentage checks.
- **`STRATEGIC_COMBAT.md` → "Open Questions"** — six new bullets appended, covering every
  unresolved item from this design pass (also listed below, consolidated).
- **`MAP_DATA_CONTRACT.md` → "Subprovinces — subprovinces.geojson"** (new section, inserted
  after "Waypoints Graph") — the file format, adjacency format, and generation summary.
- **`DEV_PHASES.md`** — five targeted edits in Phase 4 and Phase 7's checklists and
  verification-gate prose, replacing the 128×128 grid / GPU shader / 8-direction-check
  implementation plan with the subprovince-graph equivalent.

**These are edited copies, not your live project files** (Claude's project knowledge is
read-only). Diff these three against your actual repo and merge — don't just drop them in
wholesale, in case anything else has moved since May/June 2026's "Last updated" dates on
these docs.

## Reference implementation — three prototype scripts

None of these are wired into `tools/map_pipeline/pipeline.py`. They're working, tested
proof-of-concept code for the three hardest sub-problems, written against synthetic
coordinates and toy geometry — not against real `cover.geojson`/`elevation.geojson` data.
Treat them as "here's the algorithm, verified correct" rather than "here's the PR."

1. **`subprovince_gen.py`** — the full generation pipeline: capital ring → town cells → road
   corridor (Voronoi from jittered seeds along the centerline) → terrain-patch-first
   hinterland fill → sliver merge. Includes a coverage-verification assertion
   (`province.difference(union(all_cells)).area == 0`) that actually passes. **Read the
   module docstring before touching this** — it documents a real bug that was found and
   fixed during development (post-hoc polygon-edge jittering breaks exact tiling; the fix was
   to jitter seed points before Voronoi, not polygon edges after). Don't reintroduce that
   pattern.
2. **`cost_voronoi_demo.py`** — proves the concept of cost-weighted (multi-source Dijkstra)
   region splitting versus plain Euclidean Voronoi, using a synthetic ridge/river cost field.
   This is what "boundaries should follow terrain, not cut straight through it" looks like as
   working code, before real values were plugged in.
3. **`terrain_cost_split.py`** — the same technique, but driven by the *actual*
   `cover_move`/`elevation_move` tables from `MAP_DATA_CONTRACT.md` instead of a synthetic
   ridge, and demonstrates the two-level structure that matters for correctness: the
   cover_combat patch boundary (forest vs. plains) is provably identical whether the internal
   split is Euclidean or cost-weighted — the cost field only ever affects subdivision
   *inside* a single patch, never whether a subprovince crosses a terrain-type boundary.

**Integration work still needed**, not present in the prototypes:
- Real rasterization from `cover.geojson`/`elevation.geojson` polygons (the prototypes use
  hand-built synthetic patches).
- Real coordinate system handling (prototypes use arbitrary unit grids, not projected map
  coordinates).
- Wiring the raster→vector step to whatever the pipeline already uses for
  `cover.geojson`/`elevation.geojson` (see `MAP_DATA_CONTRACT.md`'s pipeline notes) instead of
  the prototypes' `shapely.voronoi_diagram`-only approach for the road corridor and any
  non-cost-weighted splits.
- `subprovince_adjacency.geojson` generation (shared-edge test between final polygons) —
  not built in any prototype yet, described in the doc but not implemented.
- The build-time coverage assertion needs to become a real pipeline failure condition (fail
  the export, not just print a warning), per `MAP_DATA_CONTRACT.md`'s Subprovinces section.

## Consolidated open questions

Everything below is flagged inline in `STRATEGIC_COMBAT.md` too — collected here so nothing
gets missed before implementation starts. None of these block starting the pipeline/generation
work; several of them (marked) do block the capture-logic and rendering work.

| Question | Where it matters | Status |
|---|---|---|
| Exclude recon units from triggering a capture flip? | **Blocks capture logic** | Default: no exclusion. Confirm before implementing. |
| Does city capture cascade-flip all remaining subprovinces? | **Resolved** | No whole-mosaic flip. Finalized: one-hop cascade from an urban/city cell to adjacent road cells, then one hop from those roads to adjacent hinterland; no hinterland→hinterland or road→road chaining (see `STRATEGIC_COMBAT.md` — Capture Rule). Runtime cascade is planned server behavior, not yet implemented; current server capture is province-level only (`CAPTURE_RADIUS_KM`/`CONTEST_RADIUS_KM`). |
| Does the combat-frozen state render as the neutral-gray fade-hold, or stay solid pre-combat color? | Blocks renderer polish only, not core logic | Not resolved either way. |
| Fade-transition duration (300–500ms proposed) | Tunable, not blocking | Needs playtesting. |
| Does road-segment supply flow stay strictly gated to friendly/allied road-corridor subprovinces, or fall back to non-road subprovinces at reduced throughput off-road? | **Meaningfully changes the "roads are primary objectives" strategic pillar** — flag for a design decision, not an engineering default | Not decided. Current doc text notes the existing "exclusively along roads" rule and doesn't override it. |
| Subprovince tuning constants (city radius/noise, urban target area, road corridor width/segment length, hinterland target/max area, natural-noise amplitude/wavelength, sliver `min_area`) | Pipeline tuning constants | Configurable in `SubprovinceConfig` / `map.json` `subprovince` block; exact values from playtesting. |

## Suggested implementation order

1. **Pipeline first, in isolation.** Get `subprovince_gen.py`'s logic integrated into
   `pipeline.py` against real map data for one province, verify the coverage assertion holds
   on real geometry (not just the synthetic test case), commit `subprovinces.geojson` +
   `subprovince_adjacency.geojson` for that one province before scaling to the full map.
2. **Server: graph load + capture flip**, no supply/encirclement yet — get
   `SUBPROVINCE_CAPTURED` events firing correctly (literal occupancy, province-wide sticky
   ownership, combat-freeze) before layering the three-tier system on top of the same graph.
3. **Server: three-tier system** against the now-working capture graph — this is mostly a
   direct transcription of the pseudocode in `STRATEGIC_COMBAT.md`'s Supply System section,
   the hard part (the graph itself) is already done by step 2.
4. **Client renderer** — flat fill + fade tween, much simpler than the shader approach it
   replaces; can be built and visually verified against step 2's events before step 3 lands.
5. Resolve the two capture-logic open questions (recon exclusion, cascade behaviour) before
   step 2 locks in, not after — they change what the flip logic actually does, not just how
   it's tuned.

## One thing worth a second look, unrelated to this feature

While cross-referencing `MAP_DATA_CONTRACT.md`'s Waypoints Graph section against this new
work: `waypoints.json`'s generation pseudocode sets `base_cost = cover_move × elevation_move`
directly and uses it as an A* edge cost. `cover_move`/`elevation_move` are documented as speed
multipliers (flat = 1.0, mountains = 0.4 — lower is slower), and the existing Movement System
section elsewhere confirms this. If that's right, `base_cost` for mountains (0.4) comes out
*lower* than for flat ground (1.0), which would make A* treat mountains as cheaper/faster to
cross than flat terrain — backwards. The subprovince cost field built for this feature
deliberately inverts the same tables (`cost = 1 / (cover_move × elevation_move)`) for exactly
this reason. Not fixed here — it's the existing waypoint pathfinding system, out of scope for
this handoff — but worth a second look before it ships, since it may already be compensated
for elsewhere (e.g. inside `division_movement_profile`) in a way that wasn't obvious from the
docs alone.
