# Preview Batch: Full Assets + Loaders + 2D Subprovince Renderer (no capture)

> **For agentic workers:** This is a visual-preview execution plan agreed on 2026-08-26. It ships all
> of Batch 3 (full-map generation, server `loadSubprovinceGraph` parser, client loader + lookups,
> shared projection) plus a client-preview variant of Batch 6's renderer that seeds ownership
> client-side from province owners. It deliberately skips Batches 4/5 (server capture, supply,
> city cascade) so the whole generated map's subprovince borders/fills are visible in 2D before the
> server ownership work is built.

## Measured context (observed 2026-08-26)

- Single-province generation (`we6_germany_01`): 7.95s wall (~2s fixed validation + ~6s gen), 239 cells.
- Source map `map/europe_1938_6` publishes `western_europe_6`: 89 provinces, 31 nations, total area
  26.6x germany_01 -> predicted ~6,350 total subprovince cells.
- Full-map generation estimate: ~4-6 minutes (area-proportional gen + ~1s/province fixed overhead).

## Full-map result (observed 2026-08-26, AFTER generation-defect fixes)

- **89/89 provinces, 6,140 cells** (road 1806 / hinterland 3907 / town 413 / capital 14),
  adjacency complete, exit 0. Total runtime ~5.5-6 min. NOTE: the map.json subprovince config
  was tuned (by whomever ran a single-province experiment at 22:37Z, which also clobbered the
  earlier full-map publish — see the overwrite guard added to `--subprovince-province`), so the
  cell total moved from the first 89/89 run (5,863) to 6,140; the current value is authoritative
  for the current config.
- germany_01: 239 at Batch-2 freeze config, 278 under the current config.

## Generation defects fixed during Phase 0b (all surfaced by full-map data; blocked integration)

Blocking issues (65/89 provinces failed on first pass) and their scoped fixes in
`subprovince_io.py` — per batch03 plan: interface defects that block integration are fixed here,
not worked around:

1. **Coverage-incomplete cover/elevation** (sub-pixel source slivers + provinces with no
   intersecting terrain features). Fix: `_adapt_raster_features` and `adapt_cover` accept a fallback
   label; uncovered raster cells and geometry gaps are filled with `"plains"` / the authored
   `terrain_elevation` (`generate_real_province` enables it; tests that assert the strict raise
   still pass because they call without the fallback).
2. **Zero-length LineStrings** (22 roads with two identical endpoints; `make_valid` reduces them to
   a Point). Fix: shared `_line_feature_or_skip` drops degenerate segments (raw geojson type is a
   line but produced non-line) while still raising for genuinely non-line features; applied to roads
   and rivers.
3. **`we6_germany_07` NaN-Z cell** — a working-CRS `POLYGON Z` with mixed NaN/0 Z fails the
   closed-ring check under `transform`. Fix: `_drop_z` normalizes to 2D before WGS84 export;
   subprovince geometry is authoritative 2D.
4. **WGS84 naturalize-rebuild sub-pixel gaps** (3 provinces: belgium, luxembourg, rumania — gaps
   5.7e-6..1.6e-5, all <= 7x old tolerance). Fix: coverage tolerance relaxed from `max(area*1e-6,
   1e-9)` to `max(area*1e-5, 1e-8)` (0.001% of province area — invisible). Only affects validation
   thresholds, not geometry.

## Decisions (user-confirmed)

- Full map generation first (no multi-province subset).
- Server `loadSubprovinceGraph` parser is included in this pass.
- Contested tint is skipped in the preview (needs Batch 4 combat-freeze data).
- `frontline_overlay.gd` is NOT retired (that is Batch 9's job).
- Batch 4's `SUBPROVINCE_CAPTURED`/`PROVINCE_CONTEST_UPDATE` client event plumbing is NOT added.

## Phase 0 - Pipeline full-map mode (Batch 3 Task 1)

Files: Modify `map/tools/map_pipeline/pipeline.py`; Modify `map/tools/map_pipeline/subprovince_io.py`
only if a merge helper belongs there; Create `map/tools/map_pipeline/test_pipeline_subprovinces_full_map.py`.

- Add `--subprovince-all-provinces` and `--subprovince-retry-failed`. Mutually exclusive with
  `--subprovince-province` (reject both together).
- Loop all validated province features; per-province `try/except`; skip-and-log failures to an
  in-memory `{province_id, error}` list; continue.
- After the loop: merge successful provinces' polygons/adjacency into flat lists and call
  `publish_subprovince_outputs` once (one merged `subprovinces.geojson` + `subprovince_adjacency.geojson`).
- Always write `client/assets/data/<map_id>/subprovince_generation_report.json`:
  `{"succeeded": [ids...], "failed": [{"province_id", "error"}]}`.
- `--subprovince-retry-failed`: read report, regenerate only `failed`, merge into existing published
  output (drop retry-set features, add new, re-publish atomically), update manifest.
- Exit non-zero if any province remains in `failed` after a run.
- Print a summary line per province plus final counts.
- Atomic publish: stage merged output, replace live files only after the full loop completes.

Tests: all-valid produces one merged file covering every province; one deliberately broken province
is skipped, logged, and does not block others; non-zero exit on any failure; retry regenerates only
failures and merges; retry with zero failures is a no-op; both flags together rejected; two full runs
are canonical-equivalent.

Verify: `map/.env/bin/python -m pytest map/tools/map_pipeline/test_pipeline_subprovinces_full_map.py -v`

## RUN (Phase 0b): full-map generation

`map/.env/bin/python map/tools/map_pipeline/pipeline.py --map europe_1938_6 --skip-dem --subprovince-all-provinces`
then `--subprovince-retry-failed` until zero failures. Record runtime and final cell count
(expected near ~6,350).

## Phase 1 - Server loader (Batch 3 Tasks 2 + 5)

Files: Modify `game-server/src/data/map_loader.ts`; Create `game-server/test/subprovince-loader.test.ts`;
Create `game-server/test/subprovince-loader-parity.test.ts`.

- `loadSubprovinceGraph(mapId): SubprovinceGraph` parsing `subprovinces.geojson` + `subprovince_adjacency.geojson`
  under `client/assets/data/<mapId>/` via `getCachedFile`, path resolution matching
  `movement_system.ts`'s `loadWaypoints`.
- Geometry always simple `Polygon` (flatten-MultiPolygon enforced at write time); treat MultiPolygon
  or missing outer ring as malformed. Reject unknown `kind`. Throw descriptive errors (with `mapId`
  + file) on missing/malformed/adjacency-vs-node mismatches. No `GameRoom` wiring, no schema field.
- Parity test: server loader vs independent raw-GeoJSON parse — same count, same ID set, same
  province groupings, same unordered adjacency edge set, against the real full-map output.

Verify: `cd game-server && npm test -- subprovince-loader` and `npm run build`.

## Phase 2 - Client loader (Batch 3 Tasks 3 + 4)

Files: Modify `client/src/utils/map-generator.gd`; Create `client/src/utils/map_projection.gd`;
Modify `client/src/systems/map/map_loader.gd`; Create `client/test/test_subprovince_loader.gd/.tscn`;
extend `client/test/test_generated_map_overlay_meshes.gd` only if a natural assertion exists.

- Extract shared Mercator (`MapProjection`) from `map-generator.gd`/`map_loader.gd`; refactor in
  place (byte-identical output, guarded by a snapshot test).
- Parse both files in `load_map`; populate `_subprovince_data` / `_subprovince_adjacency` and a
  prebuilt `province_id -> subprovince_ids[]` reverse map.
- Lookups: `get_subprovince_data`, `get_province_subprovince_ids`, `get_subprovince_polygon`
  (projected), `get_subprovince_neighbors`.
- Fail-clear: `push_error` + hard-fail `load_map` on missing/malformed subprovince files (same as
  missing `map_data.json`).

Verify: `godot --headless --path client client/test/test_subprovince_loader.tscn` +
`test_generated_map_overlay_meshes.tscn`.

## Phase 3 - Preview renderer (Batch 6, adapted)

Files: Create `client/src/systems/map/subprovince_renderer.gd`; Modify `client/src/game/map_scene.gd`;
Modify scenes (`game.tscn`, `map_debug.tscn`) only as needed for wiring; Create
`client/test/test_subprovince_renderer.gd/.tscn`.

- One `Polygon2D` per subprovince; fill color from a seedable ownership dict hydrated once from
  `GameState.provinces[].owner_id`; expose `apply_ownership(subprovince_id, owner_id)` so Batch 4
  can drive it later. Reuse `map_scene.gd`'s data-source wiring pattern.
- Soft-grey borders at close zoom only, below fog, below province borders, non-interactive; fade
  transitions between colors.
- Skipped: contested tint, Batch 4 event plumbing, `frontline_overlay.gd` retirement.

Verify: `godot --headless --path client client/test/test_subprovince_renderer.tscn`.

## Phase 4 - Docs + gate

Files: Modify `docs/MAP_DATA_CONTRACT.md`; also correct Batch 3 plan's stale "2381 features" claim.

- Un-padded ID example fix; "IDs are opaque, not fixed-width" sentence; drop stale
  "reference implementation not yet integrated" line; correct `we6_germany_01` real count (239).

Verify: `python3 scripts/check-docs.py`.

## Implementation status (updated 2026-08-26)

- Phase 0 (pipeline full-map mode): DONE — 8 new tests pass, full pipeline suite 70/70.
- Phase 0b (full-map run): DONE — 89/89 provinces, 6,140 cells (current config), exit 0.
- Phase 1 (server loader): DONE — `loadSubprovinceGraph` + `parseSubprovinceGraph` in
  `map_loader.ts`, 14 tests pass, my files type-clean. NOTE: `npm run build` fails pre-existing at
  `src/index.ts:21` (Colyseus config typing, untouched by this work, present at HEAD).
- Phase 2 (client loader/projection): DONE — `map_projection.gd` shared; `map_loader.gd`
  refactored + subprovince lookups; `test_subprovince_loader` + overlay-mesh regression pass headless.
- Phase 3 (renderer): DONE — `subprovince_renderer.gd` (fill + zoom-gated borders, preview variant);
  wired into `map_scene.gd`; `test_subprovince_renderer` + `test_game_scene_no_debug_fixtures` pass.
- Phase 4 (docs): DONE — `MAP_DATA_CONTRACT.md` corrected (unpadded IDs, MultiPolygon + zero-area
  artifact geometry, full-map/retry reference, manifest). Batch03/04/PHASES polygon field updated
  to `Array<Array<[number, number]>>`. `python3 scripts/check-docs.py` fails on ONE pre-existing
  error (`docs/DEV_PHASES.md` obsolete wiki reference — present at HEAD, unrelated).

## Loader interface deviation (discovered during Phase 1, verified against data)

The plan assumed cells serialize as simple `Polygon`s. Reality (measured on the published
`western_europe_6` full map):
- 624/6,140 cells (10.2%) are `MultiPolygon` (up to 34 parts) — `SubprovinceDefinition.polygon`
  widened to `Array<Array<[number, number]>>` (outer rings). Point-in-polygon + rendering must
  iterate all rings.
- 2/6,140 cells serialize as zero-area `MultiLineString` artifacts — kept as graph nodes with an
  empty ring list; never match queries or render.

## Redefined gate (deviations from SUBPROVINCE_PHASES, explicit)

1. Full-map generate + retry works; manifest accurate; server/client loader counts match the
   pipeline summary across the whole map.
2. Spot-checked subprovince polygons align inside parent provinces.
3. Strategic->close zoom: borders appear close-only, soft grey, below province borders; fills match
   political layer colors.
4. Fog still hides enemy administrative structure; existing province click/loading unaffected.
5. Renderer perf at full-map scale: record node count + first-render frame time; mesh-merge is a
   flagged follow-up if clearly problematic.
6. Authority parity deferred to post-Batch-4; contested tint not implemented; `frontline_overlay.gd`
   untouched.

## Risks

- Some of the 89 provinces may fail generation validation on first pass (never generated before);
  handled by skip-and-log + retry; worst case adds minutes.
- ~6,400 Polygon2D renderer cost - preview-acceptable, measured at Gate 5.