# Batch 2: Real Province Pipeline Integration

> **For agentic workers:** Implement this batch independently and stop at the manual verification gate. Do not integrate server/client runtime behavior in this batch.

**Goal:** Integrate the Batch 1 subprovince generator with real map data for one selected province, producing validated deterministic GeoJSON and adjacency output.

**Architecture:** `subprovince_io.py` adapts validated WGS84 GeoJSON into the projected, aligned inputs required by Batch 1. `pipeline.py` invokes the adapter only when an explicit province is selected, validates everything in memory, and publishes outputs only after successful serialization.

**Tech Stack:** Python, NumPy, Rasterio, Shapely, PyProj, pytest, GeoJSON.

## Scope

### Included

- Real GeoJSON source adaptation.
- Projected CRS conversion.
- Shared cover/elevation raster creation.
- Road, river, city, and terrain-patch preparation.
- Explicit one-province CLI mode.
- Subprovince and adjacency GeoJSON serialization.
- Pipeline failure handling.
- Deterministic output tests.
- Diagnostic inspection tooling.
- Manual review of one real province.

### Excluded

- Full-map subprovince generation.
- Server loading.
- Client loading or rendering.
- Capture or supply logic.
- Changes to Batch 1 algorithm behavior unless an interface defect blocks integration.
- Bridge-source implementation. The current source data has no explicit bridge layer.

## Batch 1 Interface Freeze

Before implementation, compare the actual Batch 1 implementation with:

- `plans/subprovince/subprovince-batch01.md`
- `map/tools/map_pipeline/subprovince_generator.py`
- `map/tools/map_pipeline/subprovince_raster.py`
- `map/tools/map_pipeline/subprovince_validation.py`

The adapter consumes:

```python
    province_id,
    province,
    terrain_patches,
    terrain,
    roads,
    rivers,
    bridge_gaps,
    capital,
    towns,
    config,
) -> list[SubprovincePolygon]
```

Expected Batch 1 records are:

```text
TerrainRaster
RasterGrid
SubprovinceConfig
TerrainPatch
RoadInput
SubprovincePolygon
```

If Batch 1’s actual interfaces differ, update this plan before implementation. Do not silently add compatibility wrappers.

## Task 1: Add Explicit Province Selection

**Files:**

- Modify: `map/tools/map_pipeline/pipeline.py`
- Create/update: `map/tools/map_pipeline/test_pipeline_subprovinces.py`

Add:

```text
--subprovince-province <province_id>
```

Example:

```bash
map/.env/bin/python map/tools/map_pipeline/pipeline.py \
  --map europe_1938_6 \
  --skip-dem \
  --subprovince-province we6_germany_01
```

Rules:

- The flag is opt-in.
- Without the flag, no subprovince generation occurs.
- An invalid province ID fails clearly.
- Batch 2 never silently generates all provinces.
- Existing behavior remains unchanged when the flag is omitted.
- The selected province comes from the validated original source features.

Test:

- Valid ID is accepted.
- Invalid ID fails.
- Omitted ID skips generation.
- Only the selected province is sent to the generator.

## Task 2: Implement Real-Map Adapter

**File:**

- Create: `map/tools/map_pipeline/subprovince_io.py`

Implement:

```python
    province_geometry: BaseGeometry,
) -> CRS:
```

Requirements:

- Return one deterministic projected metric CRS.
- Use the same CRS for every source layer and raster.
- Do not use longitude/latitude degrees for areas, buffers, spacing, radii, or raster resolution.
- Transform final output back to EPSG:4326 before serialization.
- Keep the CRS selection deterministic from the province or explicit map configuration.

Implement:

```python
    province_geometry: BaseGeometry,
    cover_features: Sequence[dict],
    working_crs: CRS,
) -> list[TerrainPatch]:
```

Requirements:

- Use `cover_combat`, not `cover_visual`.
- Transform and clip features to the selected province.
- Preserve hard `cover_combat` boundaries.
- Normalize source feature order.
- Reject unknown or missing combat terrain labels.
- Handle `cover_code=0` according to the Batch 1 contract; do not silently discard it.

Implement:

```python
    province_geometry: BaseGeometry,
    cover_features: Sequence[dict],
    elevation_features: Sequence[dict],
    working_crs: CRS,
    resolution: float,
) -> TerrainRaster:
```

Requirements:

- Cover and elevation use one shared `RasterGrid`.
- Both arrays have identical shape, transform, extent, and CRS.
- Cover raster values use `cover_combat`.
- Elevation accepts both `elev_type` and `elevation_type`.
- Missing terrain coverage raises an error.
- Rasterization uses the Batch 1 pixel-center convention.
- Resolution is expressed in projected units.

Implement:

```python
    province_geometry: BaseGeometry,
    road_features: Sequence[dict],
    working_crs: CRS,
) -> list[RoadInput]:
```

Requirements:

- Accept supported line geometries.
- Clip roads to the selected province.
- Preserve `road_id`, `road_level`, and `corridor_id` where supported.
- Sort roads by stable source properties and geometry.
- Do not vary road corridor geometry by `road_level`.

Implement:

```python
    province_geometry: BaseGeometry,
    river_features: Sequence[dict],
    working_crs: CRS,
) -> list[BaseGeometry]:
```

Requirements:

- Accept `LineString` and `MultiLineString`.
- Clip rivers to the selected province.
- Preserve geometry for barrier rasterization.
- Normalize source ordering.
- Pass `bridge_gaps=[]`; the current source schema has no bridge layer.
- Do not infer bridge gaps from road intersections in this batch.

Implement:

```python
    province_id: str,
    city_features: Sequence[dict],
    working_crs: CRS,
) -> tuple[Point | None, list[Point]]:
```

Requirements:

- Select the capital using `cities.geojson.properties.is_capital`.
- Match cities by `province_id`.
- Transform points into the working CRS.
- Reject multiple capital points.
- Return `towns=[]` because the current source has no separate town source.

## Task 3: Add Adapter Validation

**Files:**

- Modify: `map/tools/map_pipeline/validate.py` only for source checks belonging to existing validation.
- Modify: `map/tools/map_pipeline/subprovince_io.py`
- Test: `map/tools/map_pipeline/test_pipeline_subprovinces.py`

Validate before calling the generator:

- Selected province geometry is valid.
- Province geometry is `Polygon` or `MultiPolygon`.
- Cover and elevation features intersect the province.
- Cover and elevation provide complete rasterizable coverage.
- Cover labels are valid.
- Elevation labels are valid.
- Roads have valid geometry and identifiers.
- Rivers have valid geometry and identifiers.
- City lookup returns at most one capital.
- All source geometry transforms successfully.
- Clipped source geometry does not unexpectedly become empty.

All subprovince coverage, overlap, metadata, and adjacency failures must terminate the selected run. Warnings must not produce partial output.

## Task 4: Build Real-Province Orchestration

**File:**

- Create: `map/tools/map_pipeline/subprovince_io.py`

Implement:

```python
    province_feature: dict,
    sources: dict,
    config: SubprovinceConfig,
) -> tuple[list[SubprovincePolygon], dict[str, list[str]]]:
```

Execution order:

1. Read province ID and geometry.
2. Choose the working CRS.
3. Transform the province geometry.
4. Build the shared cover/elevation raster.
5. Build terrain patches.
6. Build road inputs.
7. Build river inputs.
8. Build capital and town inputs.
9. Pass `bridge_gaps=[]`.
10. Call Batch 1 `generate_subprovinces`.
11. Validate the partition.
12. Validate metadata.
13. Assign stable IDs if Batch 1 does not already do so.
14. Build adjacency from final polygons.
15. Validate adjacency.
16. Return only after all validation succeeds.

This function must not write files. Output serialization is a separate concern.

## Task 5: Serialize Derived GeoJSON

**File:**

- Create: `map/tools/map_pipeline/subprovince_io.py`

Implement:

```python
    output_path: Path,
    polygons: Sequence[SubprovincePolygon],
) -> None:
```

Write a valid `FeatureCollection` to:

```text
client/assets/data/<map_id>/subprovinces.geojson
```

Required properties:

```json
{
  "subprovince_id": "we6_germany_01_sp_0000",
  "province_id": "we6_germany_01",
  "kind": "hinterland",
  "cover_combat": "plains",
  "elevation_type": "flat",
  "is_capital": false
}
```

Rules:

- Coordinates are EPSG:4326.
- Flatten `MultiPolygon` output before writing.
- Preserve raster-derived staircase boundaries.
- Do not simplify or smooth.
- Sort features by `subprovince_id`.
- Use stable coordinate precision consistent with existing pipeline output.
- Write only the selected province.
- Serialize only after validation succeeds.

Implement:

```python
    output_path: Path,
    adjacency: Mapping[str, Sequence[str]],
) -> None:
```

Write a `FeatureCollection` to:

```text
client/assets/data/<map_id>/subprovince_adjacency.geojson
```

Each feature has null geometry and properties:

```json
{
  "subprovince_id": "we6_germany_01_sp_0000",
  "neighbors": ["we6_germany_01_sp_0001"]
}
```

Sort features and neighbor arrays deterministically. Do not serialize adjacency before final sliver merging and final geometry validation.

## Task 6: Integrate Pipeline Publishing

**File:**

- Modify: `map/tools/map_pipeline/pipeline.py`

Add imports for the adapter, Batch 1 generator, and validation functions.

When `--subprovince-province` is present:

1. Run existing `validate_all(map_dir)`.
2. Resolve the selected province from original source features.
3. Use original province geometry, not simplified `build_provinces()` geometry.
4. Build `SubprovinceConfig` from explicit Batch 2 values.
5. Generate the selected province in memory.
6. Validate the complete result.
7. Write both output files only after validation succeeds.
8. Extend the summary with selected province, subprovince count, adjacency count, and validation status.

Do not add generated files to `PASSTHROUGH_FILES`. They are explicitly derived outputs.

Failure behavior:

- Exit non-zero.
- Do not publish partial output.
- Do not replace valid output with incomplete output.
- Propagate generator and validation errors with the selected province ID in the message.

Use temporary staging files or a temporary staging directory when needed so both outputs are published atomically after successful generation.

When the flag is omitted, retain the current pipeline behavior and print:

```text
Subprovinces: not generated (no province selected)
```

## Task 7: Add Real-Province Tests

**Files:**

- Create: `map/tools/map_pipeline/test_pipeline_subprovinces.py`
- Create: `map/tools/map_pipeline/test_subprovince_real_fixture.py`

Use the existing source data under:

```text
map/europe_1938_6/
```

Initial selected province:

```text
we6_germany_01
```

Test:

- The selected province exists.
- Its source geometry is valid.
- Intersecting cover and elevation features exist.
- Roads and rivers adapt correctly.
- Cover and elevation share one grid.
- Projected working geometry uses metric units.
- Final geometry returns to WGS84.
- Capital selection uses the city `is_capital` field.
- No unsupported town source is invented.
- `bridge_gaps=[]` is handled explicitly.
- Generator errors propagate.
- Validation errors prevent output publication.
- Output paths are correct.
- GeoJSON properties are complete.
- Feature ordering is stable.
- Adjacency serialization is stable.
- No other province appears in the output.
- Reordered source features produce equivalent output.
- Two runs produce canonical-equivalent output.

Add a deliberately incomplete terrain fixture and assert that generation fails without publishing output.

## Task 8: Add Inspection Tool

**File:**

- Create: `map/tools/map_pipeline/inspect_subprovinces.py`

Command:

```bash
map/.env/bin/python map/tools/map_pipeline/inspect_subprovinces.py \
  --map europe_1938_6 \
  --province we6_germany_01
```

Report:

- Subprovince count.
- Counts by kind.
- Counts by cover combat type.
- Counts by elevation type.
- Adjacency degree statistics.
- Coverage and overlap diagnostics.
- Missing bridge-source information.

Produce a diagnostic overlay containing:

- Province boundary.
- Cover patches.
- Elevation patches.
- Roads.
- Rivers.
- Generated subprovince boundaries.

Also produce a diagnostic view showing raster-derived edge detail. The tool must not modify source files or generated assets.

## Dependencies

The current `requirements.txt` contains Shapely, Rasterio, and NumPy. Add `pyproj` only if it is imported directly by the adapter rather than accessed through an existing dependency API. Do not add unrelated packages.

## Verification Commands

Run focused Batch 2 tests:

```bash
map/.env/bin/python -m pytest \
  map/tools/map_pipeline/test_pipeline_subprovinces.py -v
```

```bash
map/.env/bin/python -m pytest \
  map/tools/map_pipeline/test_subprovince_real_fixture.py -v
```

Run all pipeline tests:

```bash
map/.env/bin/python -m pytest \
  map/tools/map_pipeline -v
```

Run the selected-province pipeline:

```bash
map/.env/bin/python map/tools/map_pipeline/pipeline.py \
  --map europe_1938_6 \
  --skip-dem \
  --subprovince-province we6_germany_01
```

Run the inspection tool:

```bash
map/.env/bin/python map/tools/map_pipeline/inspect_subprovinces.py \
  --map europe_1938_6 \
  --province we6_germany_01
```

## Manual Verification Gate

Batch 2 is complete only after manual review confirms:

1. The selected real province generates successfully.
2. No other province is included.
3. Generated geometry overlays the source province correctly.
4. Cover-combat boundaries are never crossed.
5. Elevation affects internal subdivision.
6. Raster-derived edges are visibly irregular rather than overly smooth.
7. Capital behavior matches `cities.geojson`.
8. Road cells are present and correctly classified.
9. River barriers behave as configured.
10. Missing bridge data is explicitly reported.
11. No gaps, overlaps, invalid polygons, or unexpected disconnected recipients exist.
12. Polygon count is reasonable.
13. Adjacency is structurally and visually correct.
14. Two exports have identical IDs, metadata, adjacency, and geometry.
15. Existing pipeline behavior is unchanged when `--subprovince-province` is omitted.

Do not begin full-map generation until this gate is approved.
