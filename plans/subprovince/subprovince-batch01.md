# Batch 1: Subprovince Generation Core

> **For agentic workers:** Implement this batch independently and stop at the manual verification gate. Do not integrate `pipeline.py`, real map data, server code, client code, or runtime loading in this batch.

**Goal:** Build a deterministic, topology-safe Python library that generates authoritative raster-derived subprovince polygons from normalized synthetic inputs.

**Architecture:** Vector geometry handles the carving order and hard boundaries. Oversized terrain patches are rasterized onto an explicit aligned grid, split with deterministic multi-source Dijkstra, and vectorized in one shared operation. Final polygons are validated, merged, assigned stable IDs, and used to build adjacency.

**Tech Stack:** Python, NumPy, Rasterio, Shapely, pytest.

## Scope

### Included

- Core typed records and configuration.
- Raster grid construction.
- Cover/elevation cost raster creation.
- Patch masks and river barriers.
- Deterministic multi-source Dijkstra.
- Shared raster-label vectorization.
- Capital, town, road, and terrain-patch carving.
- Topology-safe sliver merging.
- Stable IDs and metadata.
- Partition and adjacency validation.
- Synthetic fixtures and tests.

### Excluded

- `pipeline.py` integration.
- Real map data adapters.
- Full-map export.
- Server or client changes.
- Supply, capture, retreat, or encirclement.
- Runtime map loading.
- Documentation reconciliation outside this batch.

Existing prototype files are references only and remain unchanged:

- `plans/subprovince/subprovince_gen.py`
- `plans/subprovince/terrain_cost_split.py`
- `plans/subprovince/cost_voronoi_demo.py`

## Authoritative Geometry Rules

- `cover_combat` patch boundaries are hard boundaries.
- Elevation affects subdivision only inside one cover patch.
- Capital and town cells are not subdivided.
- Road corridor width and spacing do not depend on `road_level`.
- Rivers are hard barriers except for explicit bridge gaps.
- Raster-derived pixel edges are authoritative and retain their staircase/noisy detail.
- Seed jitter happens before Dijkstra, never after polygonization.
- All labels from one patch are vectorized together.
- Authoritative polygons are not smoothed, simplified, or independently edge-noised.
- Slivers merge through shared-edge topology only.
- Adjacency is generated after all merging and final geometry validation.
- Generated `kind` values (`capital`/`town`/`road`/`hinterland`) and shared-edge adjacency are
  the inputs the planned server **urban capture cascade** consumes at runtime
  (urban/city → adjacent road/hinterland, one hop). Batch 1 only guarantees the generated
  metadata and topology; it adds no runtime capture behavior.

## Task 1: Define Core Types and Configuration

**Files:**

- Create: `map/tools/map_pipeline/subprovince_generator.py`
- Create: `map/tools/map_pipeline/subprovince_raster.py`

Define the following records:

```python
@dataclass(frozen=True)
class RasterGrid:
    transform: Affine
    width: int
    height: int
    crs: CRS
    nodata: int | None
```

```python
@dataclass(frozen=True)
class TerrainRaster:
    cover: np.ndarray
    elevation: np.ndarray
    grid: RasterGrid
```

```python
@dataclass(frozen=True)
class SubprovinceConfig:
    target_cell_area: float
    road_width: float
    road_spacing: float
    road_jitter: float
    hinterland_spacing: float
    capital_radius: float
    town_radius: float
    min_area: float
    raster_resolution: float
    geometry_tolerance: float
    seed: int
```

```python
@dataclass
class PolygonLabel:
    geometry: BaseGeometry
    kind: str
    cover_combat: str | None
    elevation_type: str | None
    is_capital: bool
```

```python
@dataclass
class SubprovincePolygon:
    subprovince_id: str
    province_id: str
    geometry: Polygon
    kind: str
    cover_combat: str | None
    elevation_type: str | None
    is_capital: bool
```

Use explicit movement tables matching the subprovince contract. Do not import waypoint cost constants from `pipeline.py`.

```python
COVER_MOVE = {
    "plains": 1.0,
    "steppe": 1.1,
    "shrubland": 0.85,
    "light_forest": 0.75,
    "dense_forest": 0.6,
    "jungle": 0.35,
    "desert": 0.6,
    "swamp": 0.3,
    "tundra": 0.5,
    "glacier": 0.2,
    "urban": 0.8,
}

ELEVATION_MOVE = {
    "flat": 1.0,
    "hills": 0.7,
    "mountains": 0.4,
}
```

## Task 2: Implement Raster Mechanics

**File:** `map/tools/map_pipeline/subprovince_raster.py`

Implement:

```python
def build_working_grid(
    bounds: tuple[float, float, float, float],
    resolution: float,
    crs: CRS,
) -> RasterGrid:
```

The grid must explicitly define width, height, affine transform, CRS, bounds, and pixel-center behavior. Reject non-positive resolution and invalid bounds.

Implement:

```python
def build_cost_raster(
    cover: np.ndarray,
    elevation: np.ndarray,
    cover_move: Mapping[str, float],
    elevation_move: Mapping[str, float],
) -> np.ndarray:
```

Requirements:

- Use `1 / (cover_move * elevation_move)`.
- Reject unknown labels.
- Reject non-positive movement values.
- Reject mismatched array shapes.
- Return a floating-point array with the original shape.

Implement:

```python
def rasterize_patch_mask(
    patch: BaseGeometry,
    grid: RasterGrid,
) -> np.ndarray:
```

Use one documented pixel-center convention, equivalent to `all_touched=False`, and use it for every Batch 1 raster operation.

Implement:

```python
def rasterize_river_barriers(
    rivers: Sequence[BaseGeometry],
    bridge_gaps: Sequence[BaseGeometry],
    grid: RasterGrid,
    patch_mask: np.ndarray,
) -> np.ndarray:
```

Return a boolean mask where river pixels are blocked and explicit bridge gaps clear the barrier. Ignore barriers outside the patch. A high cost is not a substitute for a hard barrier.

## Task 3: Implement Deterministic Multi-Source Dijkstra

**File:** `map/tools/map_pipeline/subprovince_raster.py`

Implement:

```python
def split_patch_labels(
    cost: np.ndarray,
    patch_mask: np.ndarray,
    seeds: Sequence[tuple[int, int]],
    blocked_mask: np.ndarray | None = None,
) -> np.ndarray:
```

Requirements:

- Use four-neighbor movement.
- Label every traversable patch pixel exactly once.
- Return `-1` outside the patch and on blocked pixels.
- Reject seeds outside the patch or on blocked pixels.
- Reject or deterministically deduplicate duplicate seeds.
- Normalize seed ordering before heap initialization.
- Resolve equal-cost ties with stable seed rank, row, then column ordering.
- Never traverse outside `patch_mask`.
- Raise a validation error for unreachable traversable pixels.

Tests must cover complete labeling, containment, cost-sensitive boundaries, equal-cost ties, reordered seeds, invalid seeds, river barriers, bridge gaps, and disconnected masks.

## Task 4: Vectorize Labels Without Breaking Topology

**File:** `map/tools/map_pipeline/subprovince_raster.py`

Implement:

```python
def vectorize_labels(
    labels: np.ndarray,
    grid: RasterGrid,
    source_mask: np.ndarray,
) -> list[tuple[int, Polygon]]:
```

Requirements:

- Use `rasterio.features.shapes` once for the complete label raster.
- Exclude `-1` labels.
- Preserve disconnected components as separate polygons when required.
- Preserve pixel-derived staircase boundaries.
- Do not simplify.
- Verify output geometry intersects the source mask.
- Verify vectorized area agrees with labeled-pixel area within raster tolerance.

Implement:

```python
def clip_vectorized_labels(
    polygons: Sequence[tuple[int, Polygon]],
    source_patch: BaseGeometry,
) -> list[tuple[int, Polygon]]:
```

Clip only to the source patch, flatten `MultiPolygon` results, reject empty output, and do not smooth or simplify.

## Task 5: Implement Oversized Terrain-Patch Splitting

**File:** `map/tools/map_pipeline/subprovince_generator.py`

Implement:

```python
def split_oversized_patch(
    patch: BaseGeometry,
    terrain: TerrainRaster,
    seeds: Sequence[Point],
    rivers: Sequence[BaseGeometry],
    bridge_gaps: Sequence[BaseGeometry],
    config: SubprovinceConfig,
) -> list[PolygonLabel]:
```

Flow:

1. Create the patch mask on the shared grid.
2. Convert point seeds to raster cells.
3. Build the cost raster.
4. Build river barriers.
5. Run deterministic Dijkstra.
6. Vectorize all labels together.
7. Clip to the original patch.
8. Assign cover and dominant elevation metadata.
9. Return `PolygonLabel` objects.

Tests must prove that an elevation ridge changes internal boundaries while the cover-patch boundary remains unchanged.

## Task 6: Implement Vector Carving and Orchestration

**File:** `map/tools/map_pipeline/subprovince_generator.py`

Implement:

```python
def generate_subprovinces(
    province_id: str,
    province: BaseGeometry,
    terrain_patches: Sequence[TerrainPatch],
    terrain: TerrainRaster,
    roads: Sequence[RoadInput],
    rivers: Sequence[BaseGeometry],
    bridge_gaps: Sequence[BaseGeometry],
    capital: Point | None,
    towns: Sequence[Point],
    config: SubprovinceConfig,
) -> list[SubprovincePolygon]:
```

Use this exact carving order:

1. Capital ring.
2. Town cells.
3. Road corridor.
4. Remaining geometry intersected with terrain patches.
5. Oversized-patch raster subdivision.
6. Sliver merging.
7. Metadata assignment.
8. Stable ID assignment.
9. Partition validation.
10. Adjacency generation and validation.

Requirements:

- Capital cells are never split or merged.
- Town cells are never split.
- Road geometry is independent of `road_level`.
- Terrain-patch boundaries remain hard.
- Empty and invalid geometry is rejected or handled according to explicit tolerance rules.
- Source feature order is normalized before processing.
- Randomness uses a seeded `numpy.random.Generator`.
- IDs are assigned after all merging.

Implement:

```python
def assign_stable_ids(
    province_id: str,
    cells: Sequence[PolygonLabel],
) -> list[SubprovincePolygon]:
```

Sort cells with a documented stable key before assigning `{province_id}_sp_{index}` IDs. The key must not depend on input feature order.

## Task 7: Replace Prototype Sliver Merging

**File:** `map/tools/map_pipeline/subprovince_generator.py`

Implement:

```python
def merge_slivers(
    cells: Sequence[PolygonLabel],
    min_area: float,
    tolerance: float,
) -> list[PolygonLabel]:
```

Requirements:

- Never merge capital or town cells.
- Select recipients by actual shared boundary length.
- Do not use arbitrary proximity buffers.
- Reject slivers with no meaningful shared edge.
- Preserve total area.
- Revalidate geometry after merges.
- Preserve recipient metadata.
- Reject unexpected disconnected `MultiPolygon` recipients.
- Recompute adjacency only after all merges.

Tests must cover one-neighbor, multi-neighbor, corner-only, protected-cell, area-conservation, and no-neighbor cases.

## Task 8: Implement Validation and Adjacency

**File:** `map/tools/map_pipeline/subprovince_validation.py`

Implement:

```python
def validate_subprovince_partition(
    province: BaseGeometry,
    polygons: Sequence[SubprovincePolygon],
    tolerance: float,
) -> None:
```

Check non-empty valid geometries, province containment, coverage, overlap tolerance, and area conservation.

Implement:

```python
def validate_subprovince_metadata(
    polygons: Sequence[SubprovincePolygon],
) -> None:
```

Check unique IDs, matching province IDs, valid kinds, capital flags, and required terrain metadata.

Implement:

```python
def build_subprovince_adjacency(
    polygons: Sequence[SubprovincePolygon],
    tolerance: float,
) -> dict[str, list[str]]:
```

Use shared boundary length greater than tolerance. Exclude corner-only contact and self-links. Sort neighbors deterministically.

Implement:

```python
def validate_subprovince_adjacency(
    polygons: Sequence[SubprovincePolygon],
    adjacency: Mapping[str, Sequence[str]],
) -> None:
```

Check referenced IDs, symmetry, duplicate neighbors, self-links, and corner-only exclusion.

## Task 9: Synthetic Test Matrix

**Files:**

- Create: `map/tools/map_pipeline/test_subprovince_generator.py`
- Create: `map/tools/map_pipeline/test_subprovince_raster.py`

Create synthetic fixtures for:

1. A rectangular province with two exact cover patches.
2. A concave province.
3. A diagonal elevation ridge inside one cover patch.
4. Capital and overlapping town points.
5. A road crossing the province.
6. A river without a bridge.
7. A river with one bridge gap.
8. Equal-cost symmetric seeds.
9. Diagonal-touch cells.
10. Incomplete terrain coverage.
11. A narrow feature near raster resolution.
12. A sliver with multiple possible neighbors.

Required assertions:

- Complete coverage within tolerance.
- No overlaps.
- No cover-combat boundary crossing.
- Capital and town cells remain intact.
- Road cells have `kind="road"`.
- Hinterland cells inherit terrain metadata.
- IDs are stable and correctly formatted.
- Adjacency is symmetric and excludes corner-only contact.
- Sliver merging conserves area.
- River barriers and bridge gaps behave correctly.
- Missing coverage raises an error.
- Dijkstra ties are deterministic.
- Polygonization uses one shared label raster.

Follow current pipeline test conventions by inserting the map-pipeline directory into `sys.path`. Use `tmp_path` only for diagnostic raster or GeoJSON artifacts.

## Verification

Run the focused Batch 1 suite:

```bash
python3 -m pytest map/tools/map_pipeline/test_subprovince_generator.py -v
python3 -m pytest map/tools/map_pipeline/test_subprovince_raster.py -v
```

Run all existing pipeline tests:

```bash
python3 -m pytest map/tools/map_pipeline -v
```

Batch 1 is not allowed to modify or invoke `pipeline.py` integration behavior.

## Manual Verification Gate

After automated tests pass:

1. Generate synthetic diagnostic output.
2. View cover/elevation source layers and generated boundaries together.
3. Confirm internal boundaries respond to elevation pixels.
4. Confirm hard cover boundaries remain fixed.
5. Confirm edges are irregular rather than overly smooth.
6. Confirm no gaps or overlaps are visible.
7. Confirm river crossings occur only at bridge gaps.
8. Confirm capital and town cells remain intact.
9. Confirm polygon count is reasonable.
10. Re-run generation and confirm visually identical output.

Batch 1 is complete only after manual review confirms that authoritative raster geometry looks acceptably realistic without post-vectorization noise or topology defects.
