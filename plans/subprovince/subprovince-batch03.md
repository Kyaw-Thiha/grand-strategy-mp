# Batch 3: Full Assets and Loaders

> **For agentic workers:** Implement this batch independently and stop at the manual verification
> gate. Do not add ownership, capture, supply, retreat, or encirclement logic in this batch — that
> is Batch 4+. This batch only makes the full generated subprovince graph loadable by the server
> and the client.

**Goal:** Generate the subprovince graph for every province in a map, publish it under
`client/assets/data/<map_id>/`, and load it once per game-server room and once per client map
load, with matching IDs and polygon counts on both sides. No gameplay code reads this data yet.

**Architecture:** `pipeline.py` gains a full-map subprovince mode that loops every province,
generates each independently, and publishes a per-province success/failure manifest instead of
failing the whole run on one bad province — see "Full-map generation and retry" below. The server
gets a `loadSubprovinceGraph` export added to `game-server/src/data/map_loader.ts` (a modification,
not a new file — `SUBPROVINCE_PHASES.md`'s Batch 3 file list only lists `map_loader.ts` as
modified; the dedicated `game-server/src/data/subprovince_loader.ts` room-lifecycle wrapper is a
Batch 4 file, created there to avoid the two batches claiming the same new file) that parses the
two GeoJSON `FeatureCollection`s into the
`SubprovinceGraph` shape already specified in `SUBPROVINCE_PHASES.md`. The client's
`map_loader.gd` gets equivalent parsing plus lookups, reusing a shared projection helper factored
out of `map-generator.gd` so runtime-projected subprovince polygons align exactly with the
already-baked province geometry.

**Tech Stack:** Python, GeoPandas/Shapely (pipeline), TypeScript (server), GDScript (client).

## Scope

### Included

- `pipeline.py` full-map subprovince generation mode with per-province skip-and-log failure
  handling and a standalone retry command for just the failed provinces.
- Server `loadSubprovinceGraph` export added to `map_loader.ts`: parse `subprovinces.geojson` +
  `subprovince_adjacency.geojson` into `SubprovinceGraph`, cached like existing map data. Batch 4
  owns the per-room lifecycle wrapper (`subprovince_loader.ts`) that calls this.
- Client `map_loader.gd` additions: parse the same two files, project polygons through the shared
  projection helper, expose province→subprovince and ID→polygon lookups.
- Shared Mercator projection extraction from `map-generator.gd` so bake-time and runtime
  projection use identical math.
- Server and client tests proving both sides see matching IDs and polygon counts against the same
  generated fixture.
- Fail-clearly behavior on missing/malformed/mismatched subprovince assets (this is new
  authoritative data — silent `push_warning`/`console.warn` fallback like the existing
  `waypoints.json` loader is not acceptable here).

### Excluded

- Subprovince ownership, capture, combat-freeze (Batch 4).
- Supply/retreat/encirclement graph queries (Batch 5).
- Any client rendering of subprovince geometry or borders (Batch 6).
- Changes to Batch 1/2 generator/adapter algorithm behavior, unless an interface defect actually
  blocks integration — if so, update this plan section explicitly rather than silently adding a
  compatibility wrapper.
- Reconciling the zero-padded-ID example in `MAP_DATA_CONTRACT.md`/`SUBPROVINCE_PHASES.md` — noted
  as a doc-only fix in Task 6, not a generator or parser behavior change.

## Batch 1/2 Interface Freeze

Before implementation, confirm these against the actual files (Batch 1/2 may still be uncommitted
workspace changes — do not start Batch 3's pipeline task until `subprovince_generator.py`,
`subprovince_io.py`, and `subprovince_validation.py` are in a state their owners consider frozen):

- `subprovince_io.generate_real_province(province_feature, sources, config) -> (list[SubprovincePolygon], dict[str, list[str]])`
  (`map/tools/map_pipeline/subprovince_io.py`, imported into `pipeline.py:36`) — this is the
  per-province entry point the full-map loop will call once per province feature.
- `subprovince_io.publish_subprovince_outputs(output_dir, polygons, adjacency) -> None`
  (`pipeline.py:1640`) — currently called once for the single selected province; the full-map
  mode must accumulate every province's polygons/adjacency and call this once with the merged
  lists, not once per province (one `subprovinces.geojson` covering the whole map, per the
  contract's existing single-file format).
- **Confirmed:** `subprovince_id` is **not** zero-padded in real output (`{province_id}_sp_{index}`,
  `subprovince_generator.py:242`, e.g. `we6_germany_01_sp_0`, `..._sp_190`). Treat IDs as opaque
  strings everywhere in this batch — do not parse, pad, sort-by-width, or otherwise assume a fixed
  format. See Task 6 for the doc correction.
- **Confirmed:** real `kind` values observed so far are `{"hinterland", "road"}`; the generator
  also produces `"town"` and `"capital"` (`subprovince_generator.py:216`,
  `subprovince_validation.py:46` ties `is_capital` to `kind == "capital"`). The TS
  `SubprovinceDefinition["kind"]` union (`"road" | "hinterland" | "town" | "capital"`) matches this
  — no change needed, just confirm the loader rejects any other string as malformed.
- Real per-province run currently writes `client/assets/data/western_europe_6/subprovinces.geojson`
  and `subprovince_adjacency.geojson` for `we6_germany_01` only (239 features) — this is Batch 2's
  manual-verification output, not full-map data, and has been **overwritten** by Task 1's full-map
  run (89 provinces, ~6,140 cells at the current map.json subprovince config).

## Full-Map Generation and Retry

Decision: full-map generation **skips and logs** a province that fails validation rather than
aborting the whole run, so a single bad province doesn't force a full multi-hour regeneration.
This differs from the single-province mode's "no partial output" rule, which still applies
per-province — a failed province contributes nothing to the merged output, but provinces that
succeeded are still published.

- Add `--subprovince-all-provinces` (new flag, independent of the existing single-province
  `--subprovince-province`; the two are mutually exclusive — reject both being passed together).
- Loop every province feature from validated source data (same source `validate_all(map_dir)`
  province features the single-province mode already uses), calling `generate_real_province` per
  province inside a `try/except`.
- On success: accumulate `(province_id, polygons, adjacency)`.
- On failure: record `{province_id, error}` in memory; do not accumulate; continue the loop.
- After the loop: merge all successful provinces' polygons/adjacency into single flat lists and
  call `publish_subprovince_outputs` once, covering only the provinces that succeeded.
- Always write a manifest file, `client/assets/data/<map_id>/subprovince_generation_report.json`,
  containing `{"succeeded": [province_id, ...], "failed": [{"province_id": ..., "error": ...}, ...]}`.
  This is a diagnostic artifact, not a contract file consumed by the server/client loaders.
- Add `--subprovince-retry-failed`: reads the existing report, re-runs `generate_real_province`
  only for the `failed` list, and **merges** newly-succeeding provinces into the existing published
  `subprovinces.geojson`/`subprovince_adjacency.geojson` (read the existing files, drop any
  features belonging to a province in the retry set, add the newly generated ones, re-publish
  atomically) rather than starting over. Update the manifest to reflect the new success/failure
  split.
- Exit non-zero if any province is in the `failed` list after a run (surfaces the problem in CI/
  scripted use) even though output for the succeeded provinces was still published — the caller
  decides whether a partial map is acceptable.
- Print a summary line per province plus final counts, matching the existing pipeline's summary
  style (`pipeline.py`'s existing `Subprovinces:` summary block).

## Task 1: Full-Map Pipeline Mode

**Files:**

- Modify: `map/tools/map_pipeline/pipeline.py`
- Modify: `map/tools/map_pipeline/subprovince_io.py` only if a merge/retry helper belongs there
  rather than in `pipeline.py` itself (prefer keeping orchestration in `pipeline.py`, matching the
  existing single-province flow, and only add a pure merge function to `subprovince_io.py` if it's
  reused by both the initial run and the retry path).
- Create: `map/tools/map_pipeline/test_pipeline_subprovinces_full_map.py`

**Work:**

1. Add `--subprovince-all-provinces` and `--subprovince-retry-failed` CLI flags per the section
   above.
2. Implement the per-province loop with skip-and-log failure handling.
3. Implement the manifest read/write (`subprovince_generation_report.json`).
4. Implement retry-and-merge against existing published output.
5. Ensure atomic publish: stage merged output, only replace the live files after the full loop (or
   retry pass) completes — a crash mid-loop must not corrupt already-published output.
6. Extend the pipeline summary with full-map subprovince counts (succeeded provinces, failed
   provinces, total cells, total adjacency nodes).

**Tests:**

- Full-map mode with all provinces valid produces one merged `subprovinces.geojson` covering every
  province.
- One deliberately-broken province (reuse Batch 2's incomplete-terrain fixture pattern) is skipped,
  logged in the manifest, and does not block the other provinces from publishing.
- Exit code is non-zero when the manifest has any failed province.
- `--subprovince-retry-failed` regenerates only the failed provinces and merges them into existing
  output without touching the untouched provinces' features.
- Retry against a manifest with zero failures is a no-op that doesn't rewrite output.
- `--subprovince-province` and `--subprovince-all-provinces` together is rejected with a clear
  error.
- Two full runs on the same source data produce canonical-equivalent output (same determinism
  guarantee as Batch 2's single-province mode).

**Verification:**

```bash
map/.env/bin/python -m pytest \
  map/tools/map_pipeline/test_pipeline_subprovinces_full_map.py -v
```

```bash
map/.env/bin/python map/tools/map_pipeline/pipeline.py \
  --map europe_1938_6 --skip-dem --subprovince-all-provinces
```

## Task 2: Server Subprovince Parsing

**Files:**

- Modify: `game-server/src/data/map_loader.ts`
- Create: `game-server/test/subprovince-loader.test.ts`

Adding this to `map_loader.ts` rather than a new `subprovince_loader.ts` is deliberate: the master
plan's Batch 4 file list already creates `game-server/src/data/subprovince_loader.ts` as a
room-lifecycle wrapper (per-room load, GameRoomState wiring). Putting the raw-parsing function in
`map_loader.ts` here keeps this batch's output a pure, room-agnostic parser that Batch 4 imports
and wraps, instead of two batches independently claiming the same filename.

**Interfaces** (already specified in `SUBPROVINCE_PHASES.md`'s Batch 3 section, reproduced here for
this file's implementation target):

```ts
type SubprovinceDefinition = {
  id: string;
  provinceId: string;
  kind: "road" | "hinterland" | "town" | "capital";
  coverCombat: string | null;
  elevationType: string | null;
  isCapital: boolean;
  /** Outer ring(s): one ring for a simple Polygon, several for a MultiPolygon. */
  polygon: Array<Array<[number, number]>>;
};

type SubprovinceGraph = {
  nodes: Map<string, SubprovinceDefinition>;
  neighbors: Map<string, string[]>;
};

function loadSubprovinceGraph(mapId: string): SubprovinceGraph;
```

**Work:**

1. Resolve `client/assets/data/<mapId>/subprovinces.geojson` and
   `subprovince_adjacency.geojson` using the same path-resolution pattern as
   `movement_system.ts`'s `loadWaypoints` (`join(dirname(fileURLToPath(import.meta.url)), "../..", "client", "assets", "data", mapId, ...)`).
2. Use `getCachedFile<FeatureCollection>()` from `game-server/src/data/map_cache.ts` for both
   files, matching the existing caching convention.
3. Parse each `subprovinces.geojson` feature into a `SubprovinceDefinition`:
   `properties.subprovince_id → id`, `properties.province_id → provinceId`,
   `properties.kind → kind`, `properties.cover_combat → coverCombat`,
   `properties.elevation_type → elevationType`, `properties.is_capital → isCapital`,
   `geometry` → `polygon` as a **list of outer rings** — one ring (`coordinates[0]`) for a
   `Polygon`, and `coordinates[i][0]` per part for a `MultiPolygon`, which the generator emits
   for fragmented sliver cells (verified: 624 of 6,140 cells on `western_europe_6`). Treat a
   `Polygon`/`MultiPolygon` with no readable ring as malformed. A non-area geometry
   (`LineString`/`MultiLineString`/`Point` — zero-length segments that `make_valid` reduces;
   observed 2 in 6,140) is a degenerate artifact: keep the cell as a graph node with an empty
   `polygon` list, not a loader failure.
4. Reject any `kind` value outside the four documented values as malformed.
5. Parse each `subprovince_adjacency.geojson` feature into `neighbors.set(subprovince_id, neighbor_ids)`.
6. **Fail clearly, do not warn-and-continue:** throw a descriptive error (including `mapId` and the
   offending file) if either file is missing, is not valid JSON, is not a `FeatureCollection`, has a
   feature with missing required properties, or if `subprovince_adjacency.geojson` references an
   `id` not present in `subprovinces.geojson` (or vice versa). This is a deliberate departure from
   `loadWaypoints`'s soft-fail — subprovince data is going to be load-bearing for capture/supply in
   Batch 4+, so a missing/malformed asset should fail room startup, not silently produce an empty
   graph.
7. Do **not** wire this into `GameRoom.startGame()`'s existing `loadWaypoints`/`loadMapData` call
   block yet, and do not add a field to `GameRoomState.ts` — that schema is Colyseus-networked
   state (`@type MapSchema`/`ArraySchema`), and `SubprovinceGraph`'s `Map`/nested-polygon shape is
   server-only authoritative data with no client-sync analog (same as how province polygons already
   work: static client-loaded data, never present in synced room state). Wiring the loader into
   room startup and choosing where the loaded graph lives on `GameRoom` is Batch 4's job, since
   that's where it's first consumed. This batch only needs `loadSubprovinceGraph` to exist, be
   correct, and be tested in isolation.

**Tests** (new file, `game-server/test/subprovince-loader.test.ts`, no `getTestPort()` needed since
this doesn't spin up a Colyseus room — a plain unit test is sufficient, but still use the
`describe("lane:map-data | ...")` prefix convention for consistency):

- Loads the real `western_europe_6` fixture (or a small synthetic fixture under
  `game-server/test/fixtures/` if the real data's full-map regeneration from Task 1 isn't available
  yet when this task starts — prefer the real fixture once Task 1 has run) and produces the
  expected node/neighbor counts.
- `polygon` outer rings match the source GeoJSON ring coordinate order (Polygon and MultiPolygon).
- A MultiPolygon cell exposes one ring per part; a zero-area artifact cell keeps its node with an
  empty ring list.
- Missing `subprovinces.geojson` throws with `mapId` in the message.
- Missing `subprovince_adjacency.geojson` throws.
- Malformed `kind` value throws.
- Adjacency referencing an unknown `id` throws.
- Neighbor lists are exposed as plain string arrays keyed by `id`.
- Repeated calls for the same `mapId` return cache-backed data without re-reading the file (mirrors
  `map_cache.ts`'s existing dedupe behavior).

**Verification:**

```bash
cd game-server && npm test -- subprovince-loader
cd game-server && npm run build
```

## Task 3: Shared Client Projection Helper

**Files:**

- Modify: `client/src/utils/map-generator.gd`
- Create: `client/src/utils/map_projection.gd` (new shared script, `class_name MapProjection`)
- Modify: `client/src/systems/map/map_loader.gd`

**Work:**

1. Extract `MAP_CANVAS_WIDTH`, `MAP_CANVAS_HEIGHT`, `_mercator_raw()`, and the center/scale
   projection math currently duplicated between `map-generator.gd` (~lines 6-7, 585, 593, 604) and
   `map_loader.gd`'s `_setup_projection`/`_project`/`world_to_lng_lat` into
   `client/src/utils/map_projection.gd` as static functions or a small stateful class
   (`MapProjection.new(bounds)` computing center/scale once, exposing `project(lng, lat)` and
   `unproject(vec)`).
2. Update `map-generator.gd` to call the shared helper instead of its own copy, so baked province
   scene geometry and any future runtime projection use byte-identical math.
3. Update `map_loader.gd` to use the shared helper for its existing province projection (no
   behavior change expected — this is a refactor-in-place, verified by the existing province
   loading tests still passing) and for the new subprovince polygon projection in Task 4.

**Tests:**

- Add or extend a GDScript test asserting `MapProjection` produces the same output as the current
  `map_loader.gd._project()` for a set of known lng/lat inputs, both before and after the refactor
  (snapshot the pre-refactor output first, then assert equality post-refactor) — this is the
  correctness guard the research flagged: subprovince polygons projected at runtime must land
  exactly where the pre-baked province scene expects them.

**Verification:**

```bash
godot --headless --path client client/test/test_generated_map_overlay_meshes.tscn
```

(No behavior change expected in this test's existing assertions; it's the closest existing
regression check on baked scene geometry.)

## Task 4: Client Subprovince Loading and Lookups

**Files:**

- Modify: `client/src/systems/map/map_loader.gd`
- Modify: `client/test/test_generated_map_overlay_meshes.gd`
- Create: `client/test/test_subprovince_loader.gd`
- Create: `client/test/test_subprovince_loader.tscn`

**Work:**

1. In `load_map(map_id)`, load `subprovinces.geojson` and `subprovince_adjacency.geojson` via the
   existing `_load_json(path)` helper, following the same `res://` / `client/assets/data/<map_id>/`
   resolution `map_data.json` already uses.
2. Parse into `_subprovince_data: Dictionary` (`subprovince_id → {province_id, kind, cover_combat,
   elevation_type, is_capital, raw_polygon}`) and `_subprovince_adjacency: Dictionary`
   (`subprovince_id → PackedStringArray` of neighbor IDs).
3. Add `get_subprovince_data(subprovince_id) -> Dictionary`.
4. Add `get_province_subprovince_ids(province_id) -> PackedStringArray` (reverse lookup, built once
   at load time alongside the primary dictionary — do not scan all subprovinces on every call).
5. Add `get_subprovince_polygon(subprovince_id) -> PackedVector2Array`, projecting the raw
   `[lng, lat]` ring through the Task 3 shared `MapProjection` helper (matches
   `get_province_polygon`-equivalent convention if one exists; if not, this establishes it).
6. Add `get_subprovince_neighbors(subprovince_id) -> PackedStringArray`.
7. **Fail clearly:** on missing or malformed subprovince files, `push_error()` (not
   `push_warning()`) and leave the map load in a failed state the caller can detect (mirror
   whatever failure signal `load_map` already uses for a missing `map_data.json`, since that's
   already a hard-required file — subprovince data should be treated the same way now that it's
   authoritative graph data, not the softer treatment `waypoints.json`/`terrain_lookup.json`
   currently get).
8. No scene nodes, no rendering — this batch only builds in-memory lookups. `Polygon2D` creation is
   Batch 6.
9. Extend `client/test/test_generated_map_overlay_meshes.gd` only if a natural assertion point
   exists there (e.g. confirming the loaded scene's province count still matches after this
   change); otherwise leave it untouched and rely on the new dedicated test file — decide this
   in-place while implementing rather than forcing an edit into an unrelated test.

**Tests** (`client/test/test_subprovince_loader.gd`, following
`test_generated_map_overlay_meshes.gd`'s headless `extends Node` / `_ready()` / `get_tree().quit()`
pattern):

- Loading a map with real subprovince data populates `_subprovince_data` with the expected count.
- `get_subprovince_data` returns correct properties for a known ID.
- `get_province_subprovince_ids` returns only IDs belonging to that province.
- `get_subprovince_polygon` returns a non-empty `PackedVector2Array` whose points fall within the
  parent province's projected bounds.
- `get_subprovince_neighbors` returns the expected neighbor set for a known ID and is symmetric
  where the source data is symmetric.
- Missing `subprovinces.geojson` triggers the failure path (not a silent empty dictionary).
- Polygon projection matches the same known lng/lat fixture points used in Task 3's projection
  test (cross-check that the loader is actually using the shared helper, not a stray local copy).

**Verification:**

```bash
godot --headless --path client client/test/test_subprovince_loader.tscn
```

## Task 5: Cross-Check Server/Client Parity

**Files:**

- Create: `game-server/test/subprovince-loader-parity.test.ts` (or extend Task 2's test file if a
  single file reads more naturally)

**Work:**

Add a test that loads the same generated fixture (the full-map or single-province output from
Task 1, whichever is available and committed at implementation time) through the server loader and
independently parses the raw GeoJSON in the test itself (not through the client, which isn't
reachable from a server test), then asserts:

- Same total subprovince count.
- Same set of IDs.
- Same set of `province_id → subprovince_id[]` groupings.
- Same adjacency edges (as an unordered set of `{a, b}` pairs).

This substitutes for an actual cross-runtime check (Godot and Node can't easily run in one test)
but proves the server loader isn't dropping or misparsing anything relative to the source file —
the manual verification gate below covers the actual client-side visual/count comparison.

**Verification:**

```bash
cd game-server && npm test -- subprovince-loader-parity
```

## Task 6: Documentation Correction

**Files:**

- Modify: `docs/MAP_DATA_CONTRACT.md`
- Modify: `plans/subprovince/SUBPROVINCE_PHASES.md` if its Batch 2 section's example ID is corrected
  alongside

**Work:**

1. Replace the zero-padded ID example (`we6_germany_01_sp_0000` / `eur_france_01_sp_0142`) with the
   actual unpadded format (`we6_germany_01_sp_0`) in both documents' example JSON.
2. Add one sentence to `MAP_DATA_CONTRACT.md`'s Subprovinces section stating IDs are not
   fixed-width and consumers must not assume padding.
3. Update the stale "Reference implementation: prototype scripts... not yet integrated into
   pipeline.py" line (`MAP_DATA_CONTRACT.md`, noted in research as already inaccurate post-Batch-2)
   to reflect that generation is now integrated, single-province and full-map.

**Verification:**

```bash
python3 scripts/check-docs.py
```

## Dependencies

No new Python dependencies expected (Task 1 reuses Batch 2's adapter). No new server dependencies
(Task 2 uses existing `fs`/`getCachedFile`). No new client dependencies (Task 3/4 are pure
GDScript).

## Full Batch Verification

```bash
map/.env/bin/python -m pytest map/tools/map_pipeline -v
```

```bash
cd game-server && npm test && npm run build
```

```bash
godot --headless --path client client/test/test_generated_map_overlay_meshes.tscn
godot --headless --path client client/test/test_subprovince_loader.tscn
```

```bash
python3 scripts/check-docs.py
```

## Manual Verification Gate

Batch 3 is complete only after manual review confirms:

1. `pipeline.py --subprovince-all-provinces` generates the full map (or a representative subset
   agreed with whoever owns the map data, if full-map generation is too slow to run repeatedly
   during review) and produces `subprovince_generation_report.json` with an accurate
   succeeded/failed split.
2. `--subprovince-retry-failed` correctly regenerates only failed provinces without disturbing
   already-published ones (verify by diffing output before/after a retry run with zero new
   failures — output should be byte-identical for untouched provinces).
3. The server parser (`loadSubprovinceGraph` in `map_loader.ts`) loads the full generated map and
   reports the same total subprovince and adjacency counts printed in the pipeline summary.
4. The client (`map_loader.gd`) loads the same map and reports matching counts.
5. A spot-checked subprovince polygon renders (via ad hoc debug print or temporary visualization,
   not the Batch 6 renderer) in the correct location relative to its parent province's existing
   boundary — confirms the Task 3 shared-projection fix actually resolved potential misalignment.
6. Existing province-level map loading, click handling, and the existing
   `test_generated_map_overlay_meshes` assertions remain unaffected.
7. Missing/corrupted subprovince files on either side produce a clear failure, not a silent empty
   graph — verified by temporarily renaming a file and re-running the loader test.
8. `docs/MAP_DATA_CONTRACT.md`'s ID example matches real output.

Do not begin Batch 4 (ownership/capture) until this gate is approved.
