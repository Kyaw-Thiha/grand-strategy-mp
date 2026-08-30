"""Vector carve-order subprovince generation: city, urban, roads, then hinterland blobs.

The authoritative geometry comes from vector carve order and coarse terrain-majority
regions rather than per-pixel Dijkstra. Shared non-road borders are naturalized with
bounded deterministic noise so they look like real province borders: neither smooth
nor pixel-jagged.
"""

import math
from dataclasses import dataclass
from time import perf_counter
from typing import Sequence

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge, polygonize, unary_union
from shapely.strtree import STRtree

from subprovince_raster import (
    RasterGrid, rasterize_patch_mask,
)
from subprovince_validation import (
    build_subprovince_adjacency, validate_subprovince_adjacency,
    validate_subprovince_metadata, validate_subprovince_partition,
)


COVER_MOVE = {"plains": 1.0, "steppe": 1.1, "shrubland": 0.85, "light_forest": 0.75,
              "dense_forest": 0.6, "jungle": 0.35, "desert": 0.6, "swamp": 0.3,
              "tundra": 0.5, "glacier": 0.2, "urban": 0.8}
ELEVATION_MOVE = {"flat": 1.0, "hills": 0.7, "mountains": 0.4}

URBAN_COVER = "urban"


@dataclass(frozen=True)
class TerrainRaster:
    cover: np.ndarray
    elevation: np.ndarray
    grid: RasterGrid


@dataclass(frozen=True)
class SubprovinceConfig:
    city_radius: float
    city_noise_amplitude: float
    city_noise_wavelength: float
    urban_min_area: float
    urban_target_area: float
    road_width: float
    road_segment_length: float
    hinterland_target_area: float
    hinterland_max_area: float
    min_area: float
    road_min_area: float
    hinterland_tiny_grid_cells: float
    hinterland_split_grid_cells: float
    natural_noise_amplitude: float
    natural_noise_wavelength: float
    geometry_tolerance: float
    seed: int


@dataclass
class PolygonLabel:
    geometry: BaseGeometry
    kind: str
    cover_combat: str | None
    elevation_type: str | None
    is_capital: bool


@dataclass(frozen=True)
class SubprovincePolygon:
    subprovince_id: str
    province_id: str
    geometry: Polygon
    kind: str
    cover_combat: str | None
    elevation_type: str | None
    is_capital: bool


@dataclass(frozen=True)
class TerrainPatch:
    geometry: BaseGeometry
    cover_combat: str


@dataclass(frozen=True)
class RoadInput:
    geometry: BaseGeometry
    road_level: int = 1
    road_id: str | None = None
    corridor_id: str | None = None


def default_config() -> SubprovinceConfig:
    return SubprovinceConfig(
        city_radius=20_000.0,
        city_noise_amplitude=3_000.0,
        city_noise_wavelength=5_000.0,
        urban_min_area=50e6,
        urban_target_area=500e6,
        road_width=10_000.0,
        road_segment_length=80_000.0,
        hinterland_target_area=5e9,
        hinterland_max_area=30e9,
        min_area=10e6,
        # Roughly half of a nominal full segment's area (road_width * road_segment_length),
        # comfortably below the floor a normally-jittered full segment can shrink to (segment
        # length jitters +/-12% in `_split_corridor`), so this only catches segments actually
        # truncated by a province border, junction, or corridor difference-order carve-out —
        # not ordinary jitter.
        road_min_area=4e8,
        # In raster grid cells; tripled from the prior 10.0 so `_resolve_tiny_hinterland`
        # absorbs more undersized hinterland cells into same-terrain (preferred) or
        # different-terrain neighboring cells instead of leaving them undersized.
        hinterland_tiny_grid_cells=30.0,
        hinterland_split_grid_cells=300.0,
        natural_noise_amplitude=3_000.0,
        natural_noise_wavelength=10_000.0,
        geometry_tolerance=1.0,
        seed=0,
    )


class Timings:
    def __init__(self) -> None:
        self._marks: dict[str, float] = {}
        self._start = perf_counter()

    def mark(self, name: str) -> None:
        self._marks[name] = perf_counter() - self._start

    def report(self) -> None:
        ordered = sorted(self._marks.items())
        for name, seconds in ordered:
            print(f"  {name:<28} {seconds:.3f}s")


def _polygon_parts(geometry: BaseGeometry) -> list[Polygon]:
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type == "MultiPolygon":
        return list(geometry.geoms)
    if geometry.geom_type == "GeometryCollection":
        return [part for item in geometry.geoms for part in _polygon_parts(item)]
    return []


def _raster_cell(point: Point, grid: RasterGrid) -> tuple[int, int]:
    col = int(np.floor((point.x - grid.transform.c) / grid.transform.a))
    row = int(np.floor((grid.transform.f - point.y) / abs(grid.transform.e)))
    return row, col


def _dominant(values: np.ndarray) -> str | None:
    if values.size == 0:
        return None
    unique, counts = np.unique(values, return_counts=True)
    return str(unique[np.argmax(counts)])


def _metadata_for_polygon(polygon: BaseGeometry, terrain: TerrainRaster) -> tuple[str | None, str | None]:
    mask = rasterize_patch_mask(polygon, terrain.grid)
    if not np.any(mask):
        row, column = _raster_cell(polygon.representative_point(), terrain.grid)
        row = min(max(row, 0), terrain.grid.height - 1)
        column = min(max(column, 0), terrain.grid.width - 1)
        return str(terrain.cover[row, column]), str(terrain.elevation[row, column])
    return _dominant(terrain.cover[mask]), _dominant(terrain.elevation[mask])


def _det_amp(x: float, y: float, seed: int, amplitude: float) -> float:
    """Deterministic pseudo-random amplitude in [-amplitude, amplitude] from a position."""
    s = math.sin(x * 12.9898 + y * 78.233 + seed * 53.2391) * 43758.5453
    fraction = s - math.floor(s)
    return (fraction - 0.5) * 2.0 * amplitude


def _smoothstep(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return t * t * (3.0 - 2.0 * t)


def _lateral_profile(n_samples: int, amplitude: float, seed: int, key: str) -> list[float]:
    """Coherent signed lateral offsets sampled at `n+1` stations.

    A few control points are generated and interpolated so consecutive offsets form a
    slowly-varying curve instead of independent jumps.
    """
    if amplitude <= 0 or n_samples < 2:
        return [0.0] * (n_samples + 1)
    key_offset = sum(ord(c) for c in key)
    # One control point per station (control_count == n_samples) makes every station an
    # independent draw with no smoothing between them at all, since the interpolation parameter
    # lands exactly on an integer control index at every sample point — a proper sawtooth/zigzag
    # rather than a wave, most visible on short road segments where only a couple of stations
    # are visible at once. Halving the control density restores real smoothstep interpolation
    # between neighbors while keeping noise much finer than the original heavily-grouped
    # `n_samples // 3`.
    control_count = max(2, n_samples // 2)
    controls = [_det_amp(float(i * 7 + seed * 13 + key_offset), float(seed), seed, amplitude)
                for i in range(control_count + 1)]
    result = []
    for i in range(n_samples + 1):
        c = (i / n_samples) * control_count
        a = min(int(c), control_count)
        b = min(a + 1, control_count)
        t = _smoothstep(c - a)
        result.append(controls[a] * (1.0 - t) + controls[b] * t)
    return result


def _noisy_road_corridor(line: BaseGeometry, width: float, config: SubprovinceConfig) -> Polygon:
    """Road corridor with a coherently varied, curve-safe wavy boundary.

    Built by warping the boundary of shapely's own `line.buffer(half)` outward/inward by a
    smooth bounded profile (the same technique `_natural_wall` uses to naturalize hinterland
    walls), rather than hand-constructing a left/right offset ring from the raw centerline. A
    hand-built per-vertex offset ring is a classic "polygon offsetting" failure case at sharp
    turns — a road with a tight bend can self-intersect there regardless of how gentle the noise
    is, even on an otherwise long, normally-noised road. That previously fell back to a plain
    featureless buffer far more often than intended (roughly 1 in 8 real roads), which is what
    produced smooth capsule-shaped road cells overlapping messily with neighbors at junctions.
    Starting from `buffer()` — which is robust to curvature by construction — and only nudging
    its boundary by a bounded amount avoids that failure mode entirely.
    """
    half = max(width / 2.0, config.geometry_tolerance)
    length = line.length
    base = line.buffer(half)
    if length <= config.geometry_tolerance or base.is_empty or not base.is_valid:
        return base if not base.is_empty and base.is_valid else line.buffer(half)
    boundary = base.boundary
    if boundary.geom_type != "LineString" or boundary.length <= config.geometry_tolerance:
        return base
    # Capped well below `half` (the tightest local curvature, at the round end caps) so the
    # warp can never fold the boundary back on itself; also capped at a fraction of
    # road_segment_length so at least ~2.5 oscillations fit inside any single segment
    # `_split_corridor` later cuts out of this corridor.
    amplitude = min(max(width * 0.14, config.geometry_tolerance * 3.0), half * 0.15)
    wavelength = max(width * 0.5, config.geometry_tolerance * 20.0)
    wavelength = min(wavelength, config.road_segment_length * 0.4)
    blen = boundary.length
    n = max(int(blen / wavelength), 3)
    delta = _lateral_profile(n, amplitude, config.seed, "road_edge")

    def station(i):
        d = blen * i / n
        pt = boundary.interpolate(d)
        a = boundary.interpolate(max(d - 0.5, 0.0))
        b = boundary.interpolate(min(d + 0.5, blen))
        tx, ty = b.x - a.x, b.y - a.y
        norm = math.hypot(tx, ty) or 1e-9
        nx, ny = -ty / norm, tx / norm
        return pt, nx, ny

    ring = []
    for i in range(n + 1):
        pt, nx, ny = station(i)
        ring.append((pt.x + nx * delta[i], pt.y + ny * delta[i]))
    if len(ring) < 4:
        return base
    ring.append(ring[0])
    warped = Polygon(ring)
    if warped.is_valid and warped.area > width * length * 0.5:
        return warped
    return base


def _noise_perimeter(base: BaseGeometry, config: SubprovinceConfig, seed: int) -> Polygon:
    """Warp a polygon's boundary radially from its centroid with low-frequency noise."""
    boundary = base.boundary
    if boundary.length <= config.city_noise_wavelength * 1.2:
        return base
    centroid = base.centroid
    length = boundary.length
    estimated = max(int(length / config.city_noise_wavelength), 8)
    ring = []
    for i in range(estimated):
        pt = boundary.interpolate(length * i / estimated)
        angle = math.atan2(pt.y - centroid.y, pt.x - centroid.x)
        amp = _det_amp(pt.x, pt.y, seed, config.city_noise_amplitude)
        ring.append((pt.x + math.cos(angle) * amp, pt.y + math.sin(angle) * amp))
    if not ring:
        return base
    ring.append(ring[0])
    warped = Polygon(ring)
    if warped.is_valid and warped.area > 0:
        return warped
    return base


def _connected_agglomerations(geometries: Sequence[BaseGeometry],
                              simplify_tol: float) -> list[Polygon]:
    """Merge overlapping/touching urban polygons into connected agglomerations.

    Only polygons that actually touch or overlap are connected; nearby but separate
    settlements stay separate. A single mild simplification on the merged union drops
    pathological source micro-vertices while keeping every shared derived boundary identical.
    """
    valid = [geometry for geometry in geometries if geometry is not None and not geometry.is_empty]
    if not valid:
        return []
    combined = unary_union(valid)
    if simplify_tol > 0:
        combined = combined.simplify(simplify_tol, preserve_topology=True)
    return [part for part in _polygon_parts(combined) if not part.is_empty and part.area > 1e-9]


def _farthest_point_seeds(polygon: BaseGeometry, candidates: Sequence[Point], n: int) -> list[Point]:
    """Deterministic farthest-point sampling to spread `n` seeds inside a polygon."""
    if n <= 0:
        return []
    chosen = [polygon.representative_point()]
    for _ in range(n - 1):
        best, best_d = None, -1.0
        for candidate in candidates:
            distance = min(candidate.distance(seed) for seed in chosen)
            if distance > best_d:
                best_d, best = distance, candidate
        if best is None or best_d <= 0:
            break
        chosen.append(best)
    return chosen


def _voronoi_split(polygon: BaseGeometry, n: int, config: SubprovinceConfig) -> list[Polygon]:
    """Split a polygon into `n` natural cells from deterministic interior seeds."""
    from shapely.geometry import MultiPoint
    from shapely.ops import voronoi_diagram
    if n <= 1:
        return _polygon_parts(polygon)
    rng = np.random.default_rng(config.seed)
    spacing = math.sqrt(max(polygon.area / n, 1.0)) * 0.5
    candidates = _seed_points(polygon, spacing, rng)
    seeds = _farthest_point_seeds(polygon, candidates, n)
    if len(seeds) < 2:
        return _polygon_parts(polygon)
    envelope = polygon.buffer(max(config.geometry_tolerance * 4.0, 1.0))
    diagram = voronoi_diagram(MultiPoint(seeds), envelope=envelope, tolerance=0.0)
    cells = []
    for cell in (diagram.geoms if hasattr(diagram, "geoms") else [diagram]):
        clipped = cell.intersection(polygon)
        for piece in _polygon_parts(clipped):
            if piece.area > config.geometry_tolerance * 4.0:
                cells.append(piece)
    return cells or _polygon_parts(polygon)


def _urban_simplify_tol(geometry: BaseGeometry, config: SubprovinceConfig) -> float:
    """One mild simplification tolerance for a merged urban compound, scaled to its extent."""
    min_x, min_y, max_x, max_y = geometry.bounds
    span = max(max_x - min_x, max_y - min_y)
    return min(math.sqrt(max(config.urban_target_area, 1.0)) * 0.02, span * 0.03)


def _urban_compound(patch_geometries: Sequence[BaseGeometry],
                    config: SubprovinceConfig) -> list[Polygon]:
    """Merged, mildly simplified urban agglomerations used by both city and town stages."""
    valid = [g for g in patch_geometries if g is not None and not g.is_empty]
    if not valid:
        return []
    tol = _urban_simplify_tol(unary_union(valid), config)
    return _connected_agglomerations(valid, simplify_tol=tol)


def _round_urban_shape(agglomerate: BaseGeometry, config: SubprovinceConfig, seed: int) -> BaseGeometry:
    """Round a blocky source-patch agglomeration into an organic shape.

    Raw urban terrain patches are unioned rectangles, so a morphological close-then-open pass
    rounds off their corners first (allowed to grow slightly beyond the original footprint into
    surrounding non-urban land), then the existing radial perimeter noise is layered on top.
    """
    if agglomerate.is_empty:
        return agglomerate
    radius = max(config.natural_noise_wavelength, math.sqrt(max(agglomerate.area, 1.0)) * 0.12)
    rounded = (agglomerate.buffer(radius, join_style=1)
               .buffer(-radius * 1.5, join_style=1)
               .buffer(radius * 0.5, join_style=1))
    if rounded.is_empty or not rounded.is_valid:
        rounded = agglomerate
    warped = _noise_perimeter(rounded, config, seed)
    if warped.is_empty or not warped.is_valid:
        return rounded
    return warped


def _build_city_cell(province: BaseGeometry, patches: Sequence[TerrainPatch],
                     terrain: TerrainRaster, capital: Point | None,
                     config: SubprovinceConfig) -> PolygonLabel | None:
    if capital is None or not province.covers(capital):
        return None
    agglomerations = _urban_compound(
        [patch.geometry for patch in patches if patch.cover_combat == URBAN_COVER], config,
    )
    containing = None
    for agglomerate in agglomerations:
        if agglomerate.covers(capital) or agglomerate.distance(capital) < config.city_radius * 0.2:
            if containing is None or agglomerate.area > containing.area:
                containing = agglomerate
    if containing is not None and containing.area >= config.urban_min_area:
        containing = _round_urban_shape(containing, config, config.seed).intersection(province)
        if not containing.is_empty:
            cover, elevation = _metadata_for_polygon(containing, terrain)
            return PolygonLabel(containing, "capital", cover or URBAN_COVER, elevation, True)
    base = capital.buffer(config.city_radius).intersection(province)
    if base.is_empty:
        return None
    base = _noise_perimeter(base, config, config.seed).intersection(province)
    if base.is_empty:
        return None
    cover, elevation = _metadata_for_polygon(base, terrain)
    return PolygonLabel(base, "capital", cover or URBAN_COVER, elevation, True)


def _seed_points(patch: BaseGeometry, spacing: float, rng: np.random.Generator) -> list[Point]:
    """Deterministic jittered grid seeds inside a polygon.

    The staggered grid and its jitter are built with numpy array ops (meshgrid + one batched
    `rng.uniform` draw) and the containment check runs once through shapely's vectorized
    `contains` against a prepared patch, instead of a Python-level loop issuing one grid point,
    one RNG draw, and one `.contains()` call at a time. That per-point loop is the dominant
    cost for patches whose bounding box is much larger than their actual area (common for
    scattered real terrain patches split into many disjoint parts), since it re-walks the same
    bounding box millions of times to find comparatively few points that are actually inside.
    """
    min_x, min_y, max_x, max_y = patch.bounds
    spacing = max(spacing, 1e-9)
    x_even = np.arange(min_x + spacing / 2, max_x, spacing)
    x_odd = np.arange(min_x + spacing, max_x, spacing)
    y_values = np.arange(min_y + spacing / 2, max_y, spacing)
    parts_x, parts_y = [], []
    if x_even.size and y_values[0::2].size:
        grid_x, grid_y = np.meshgrid(x_even, y_values[0::2])
        parts_x.append(grid_x.ravel())
        parts_y.append(grid_y.ravel())
    if x_odd.size and y_values[1::2].size:
        grid_x, grid_y = np.meshgrid(x_odd, y_values[1::2])
        parts_x.append(grid_x.ravel())
        parts_y.append(grid_y.ravel())
    if not parts_x:
        return [patch.representative_point()]
    xs = np.concatenate(parts_x)
    ys = np.concatenate(parts_y)
    jitter = rng.uniform(-spacing * 0.15, spacing * 0.15, size=(xs.size, 2))
    xs = xs + jitter[:, 0]
    ys = ys + jitter[:, 1]
    shapely.prepare(patch)
    inside = shapely.contains(patch, shapely.points(xs, ys))
    points = [Point(x, y) for x, y in zip(xs[inside], ys[inside])]
    return points or [patch.representative_point()]


def _build_urban_cells(remaining: BaseGeometry, patches: Sequence[TerrainPatch],
                       terrain: TerrainRaster, config: SubprovinceConfig) -> list[PolygonLabel]:
    """Agglomerate remaining urban terrain into connected cells of a controlled size.

    Disconnected settlements stay separate; a settlement larger than the urban target is
    split into exactly ceil(area/target) natural cells from deterministic interior seeds.
    """
    agglomerations = _urban_compound(
        [patch.geometry for patch in patches if patch.cover_combat == URBAN_COVER], config,
    )
    cells: list[PolygonLabel] = []
    for agglomerate in agglomerations:
        if agglomerate.area < config.urban_min_area:
            continue  # too small to read as a town; leave it in `remaining`
        rounded = _round_urban_shape(agglomerate, config, config.seed)
        clipped = rounded.intersection(remaining)
        if clipped.is_empty or clipped.area <= config.geometry_tolerance:
            continue
        for part in _polygon_parts(clipped):
            if part.area <= config.geometry_tolerance:
                continue
            if part.area <= config.urban_target_area:
                pieces = [part]
            else:
                n = max(1, int(math.ceil(part.area / config.urban_target_area)))
                pieces = _voronoi_split(part, n, config)
            for piece in pieces:
                cover, elevation = _metadata_for_polygon(piece, terrain)
                cells.append(PolygonLabel(piece, "town", cover or URBAN_COVER, elevation, False))
    return cells


def _split_corridor(corridor: BaseGeometry, spine: BaseGeometry,
                    seg_len: float, config: SubprovinceConfig) -> list[Polygon]:
    parts = _polygon_parts(corridor)
    if not parts:
        return []
    if spine.length <= seg_len * 1.2:
        return parts
    blades: list[LineString] = []
    d = seg_len
    count = 0
    while d < spine.length - seg_len * 0.3:
        tangent = (spine.interpolate(min(d + 0.5, spine.length)).x - spine.interpolate(max(d - 0.5, 0)).x,
                   spine.interpolate(min(d + 0.5, spine.length)).y - spine.interpolate(max(d - 0.5, 0)).y)
        norm = math.hypot(tangent[0], tangent[1])
        if norm < 1e-9:
            d += seg_len
            continue
        nx, ny = -tangent[1] / norm, tangent[0] / norm
        pt = spine.interpolate(d)
        reach = max(config.road_width, seg_len) * 1.5
        # Slightly wavy cut blade: offset its midpoint perpendicular to itself so segment
        # ends don't read as perfectly straight.
        mid_amp = _det_amp(d, count * 11.0 + 3.0, config.seed, seg_len * 0.05)
        mid_amp = min(mid_amp, seg_len * 0.1)
        mid_line = LineString([(pt.x - nx * reach, pt.y - ny * reach),
                               (pt.x + nx * reach, pt.y + ny * reach)])
        mid = mid_line.interpolate(0.5, normalized=True)
        bx, by = mid.x + nx * mid_amp, mid.y + ny * mid_amp
        blades.append(LineString([mid_line.coords[0], (bx, by), mid_line.coords[1]]))
        count += 1
        d += seg_len + _det_amp(count * 17.0 + 5.0, d, config.seed, seg_len * 0.12)
    if not blades:
        return parts
    blade_union = unary_union(blades).buffer(config.geometry_tolerance)
    cut = corridor.difference(blade_union)
    pieces = [p for p in _polygon_parts(cut) if not p.is_empty and p.area > config.geometry_tolerance]
    return pieces or parts


def _build_road_cells(remaining: BaseGeometry, roads: Sequence[RoadInput],
                      terrain: TerrainRaster, config: SubprovinceConfig) -> tuple[list[PolygonLabel], BaseGeometry]:
    entries = []
    for road in sorted(roads, key=lambda item: item.geometry.wkb):
        corridor = _noisy_road_corridor(road.geometry, config.road_width, config).intersection(remaining)
        if not corridor.is_empty:
            entries.append((road, corridor))
    cells: list[PolygonLabel] = []
    prior: BaseGeometry | None = None
    all_corridors: list[BaseGeometry] = []
    for road, corridor in entries:
        all_corridors.append(corridor)
    roads_union = unary_union(all_corridors) if all_corridors else None
    remaining_out = remaining.difference(roads_union) if roads_union is not None and not roads_union.is_empty else remaining
    prior = None
    for road, corridor in entries:
        unique = corridor.difference(prior) if prior is not None else corridor
        prior = unary_union([prior, corridor]) if prior is not None else corridor
        if unique.is_empty or unique.area <= config.geometry_tolerance:
            continue
        cover, elevation = _metadata_for_polygon(unique, terrain)
        for piece in _split_corridor(unique, road.geometry, config.road_segment_length, config):
            if piece.area > config.geometry_tolerance:
                cells.append(PolygonLabel(piece, "road", cover, elevation, False))
    return cells, remaining_out


def _hinterland_seed_points(remaining: BaseGeometry, config: SubprovinceConfig) -> list[Point]:
    """Deterministic farthest-point seeds sized so the remaining land yields ~target blobs."""
    n = max(1, int(round(remaining.area / max(config.hinterland_target_area, 1.0))))
    rng = np.random.default_rng(config.seed)
    spacing = math.sqrt(max(remaining.area / n, 1.0)) * 0.5
    candidates = _seed_points(remaining, spacing, rng)
    seeds = _farthest_point_seeds(remaining, candidates, n)
    return seeds or [remaining.representative_point()]


def _merge_homogeneous_neighbors(cells: list[PolygonLabel], config: SubprovinceConfig) -> list[PolygonLabel]:
    """First absorb tiny fragments into a neighbor, then union adjacent blobs that share
    one dominant cover/elevation combination up to the max-area cap."""
    small_floor = max(config.min_area, config.hinterland_target_area * 0.5)
    changed = True
    while changed:
        changed = False
        i = 0
        while i < len(cells):
            small = cells[i]
            if small.geometry.area >= small_floor:
                i += 1
                continue
            best, best_shared = None, 0.0
            for j, other in enumerate(cells):
                if j == i:
                    continue
                shared = small.geometry.boundary.intersection(other.geometry.boundary)
                shared_len = shared.length if shared is not None else 0.0
                if shared_len > best_shared:
                    best_shared, best = shared_len, j
            if best is not None and best_shared > config.geometry_tolerance:
                other = cells[best]
                merged = small.geometry.union(other.geometry)
                if merged.geom_type in {"Polygon", "MultiPolygon"} and not merged.is_empty:
                    cells[best] = PolygonLabel(merged, other.kind, other.cover_combat, other.elevation_type, other.is_capital)
                    cells.pop(i)
                    changed = True
                    continue
            i += 1
    changed = True
    while changed:
        changed = False
        i = 0
        while i < len(cells):
            j = i + 1
            while j < len(cells):
                a, b = cells[i], cells[j]
                if (a.cover_combat, a.elevation_type) == (b.cover_combat, b.elevation_type):
                    shared = a.geometry.boundary.intersection(b.geometry.boundary)
                    if shared is not None and shared.length > config.geometry_tolerance and \
                            a.geometry.area + b.geometry.area <= config.hinterland_max_area:
                        merged = a.geometry.union(b.geometry)
                        if merged.geom_type in {"Polygon", "MultiPolygon"} and not merged.is_empty:
                            cells[i] = PolygonLabel(merged, a.kind, a.cover_combat, a.elevation_type, a.is_capital)
                            cells.pop(j)
                            changed = True
                            continue
                j += 1
            i += 1
    return cells


def _voronoi_hinterland_region(remaining: BaseGeometry, terrain: TerrainRaster,
                               config: SubprovinceConfig, forced_cover: str | None = None) -> list[PolygonLabel]:
    """Partition one region into large geometric blobs.

    Blobs come from a clipped Voronoi over deterministic far-spaced interior seeds, so the
    result is a handful of coherent cells rather than exact terrain fragments. `elevation_type`
    is sampled by majority vote afterwards (minority elevation inside a blob is allowed);
    `cover_combat` is fixed to `forced_cover` when given (the caller has already scoped
    `remaining` to a single cover_combat patch), otherwise it's also sampled by majority vote.
    """
    if remaining.is_empty or remaining.area <= config.geometry_tolerance:
        return []
    from shapely.geometry import MultiPoint
    from shapely.ops import voronoi_diagram
    tol = config.geometry_tolerance * 4.0
    seeds = _hinterland_seed_points(remaining, config)
    if len(seeds) < 2:
        cover, elevation = _metadata_for_polygon(remaining, terrain)
        return [PolygonLabel(remaining, "hinterland", forced_cover or cover or "plains", elevation or "flat", False)]
    diagram = voronoi_diagram(MultiPoint(seeds), envelope=box(*remaining.bounds), tolerance=0.0)
    cells: list[PolygonLabel] = []
    for cell in (diagram.geoms if hasattr(diagram, "geoms") else [diagram]):
        clipped = cell.intersection(remaining)
        for part in _polygon_parts(clipped):
            if part.area > tol:
                cells.append(PolygonLabel(part, "hinterland", None, None, False))
    for cell in cells:
        cover, elevation = _metadata_for_polygon(cell.geometry, terrain)
        cell.cover_combat = forced_cover or cover or "plains"
        cell.elevation_type = elevation or "flat"
    cells = _merge_homogeneous_neighbors(cells, config)
    return cells


def _split_config(config: SubprovinceConfig, grid_cell_area: float) -> SubprovinceConfig:
    """Config for splitting an oversized cell, with the internal homogeneous-merge cap clamped
    to `hinterland_split_grid_cells` instead of the much looser general-purpose
    `hinterland_max_area`.

    `_voronoi_hinterland_region` ends by re-merging adjacent same-(cover, elevation) Voronoi
    sub-cells back together up to `config.hinterland_max_area` (a large cap meant for normal
    generation). Reused unmodified, that re-merge can fuse an oversized cell's sub-pieces right
    back into something close to its original size whenever they share the same elevation label
    (common — most of a single terrain patch is often one elevation type), silently defeating
    the whole point of splitting it.
    """
    split_cap = config.hinterland_split_grid_cells * grid_cell_area
    if split_cap >= config.hinterland_max_area:
        return config
    return SubprovinceConfig(**{**config.__dict__, "hinterland_max_area": split_cap})


def _cell_for_natural_group(part: BaseGeometry, terrain: TerrainRaster, config: SubprovinceConfig,
                            forced_cover: str | None, grid_cell_area: float) -> list[PolygonLabel]:
    """One connected natural terrain group becomes one cell, unless it's oversized.

    A group at or under `hinterland_split_grid_cells` stays as a single cell (elevation sampled
    by majority vote, same as `_voronoi_hinterland_region`'s single-seed fallback). An oversized
    group is still split via the existing Voronoi-plus-homogeneous-merge machinery so it doesn't
    stay one enormous blob.
    """
    if part.area <= config.hinterland_split_grid_cells * grid_cell_area:
        cover, elevation = _metadata_for_polygon(part, terrain)
        return [PolygonLabel(part, "hinterland", forced_cover or cover or "plains", elevation or "flat", False)]
    return _voronoi_hinterland_region(part, terrain, _split_config(config, grid_cell_area), forced_cover=forced_cover)


def _build_hinterland_cells(remaining: BaseGeometry, terrain_patches: Sequence[TerrainPatch],
                            terrain: TerrainRaster, config: SubprovinceConfig) -> list[PolygonLabel]:
    """Partition the remaining land into cells that follow real terrain groups.

    `cover_combat` boundaries are a hard mask: `remaining` is grouped by each terrain patch's
    declared `cover_combat`, and each cover type's slice of the land is split into connected
    components, so a hinterland cell can never straddle a real cover-type transition. Each
    connected component becomes one cell directly unless it's oversized (see
    `_cell_for_natural_group`) — undersized components are handled afterward by
    `_resolve_tiny_hinterland`, not here. Any leftover area not covered by any patch (source-data
    gaps) falls back to the old whole-region majority-vote behavior so coverage is guaranteed.
    """
    if remaining.is_empty or remaining.area <= config.geometry_tolerance:
        return []
    grid_cell_area = abs(terrain.grid.transform.a * terrain.grid.transform.e)
    by_cover: dict[str, list[BaseGeometry]] = {}
    for patch in terrain_patches:
        by_cover.setdefault(patch.cover_combat, []).append(patch.geometry)
    cells: list[PolygonLabel] = []
    consumed: list[BaseGeometry] = []
    # Iterate cover keys and geometry parts in a stable order so the resulting cell list (and
    # therefore any downstream tie-breaking, e.g. in `_naturalize_partition`'s ownership
    # resolution) doesn't depend on the caller's `terrain_patches` ordering.
    for cover_combat in sorted(by_cover):
        geometries = sorted(by_cover[cover_combat], key=lambda g: g.wkb)
        slice_region = unary_union(geometries).intersection(remaining)
        if slice_region.is_empty or slice_region.area <= config.geometry_tolerance:
            continue
        consumed.append(slice_region)
        parts = sorted((p for p in _polygon_parts(slice_region) if p.area > config.geometry_tolerance),
                       key=lambda p: p.wkb)
        for part in parts:
            cells.extend(_cell_for_natural_group(part, terrain, config, cover_combat, grid_cell_area))
    consumed_union = unary_union(consumed) if consumed else None
    leftover = remaining.difference(consumed_union) if consumed_union is not None else remaining
    for part in sorted((p for p in _polygon_parts(leftover) if p.area > config.geometry_tolerance),
                       key=lambda p: p.wkb):
        if part.area > config.geometry_tolerance:
            cells.extend(_voronoi_hinterland_region(part, terrain, config, forced_cover=None))
    return cells


def _natural_wall(wall: LineString, config: SubprovinceConfig, seed: int) -> LineString:
    """Warps a wall with smooth, correlated, bounded displacement.

    Control points are sampled every ~wavelength/2 and their signed displacements are
    interpolated with a smoothstep so the result is a slowly-varying curve (jiggery but not
    sawtoothed). Displacement is capped well below the sample spacing so neighbouring kinks
    can never cross, which keeps the rebuilt partition closed.
    """
    length = wall.length
    if length < config.natural_noise_wavelength * 0.5:
        return wall
    wavelength = max(config.natural_noise_wavelength, 1.0)
    amp = max(config.natural_noise_amplitude, 0.0)
    estimated = max(int(length / wavelength * 2.0), 3)
    coords = []
    for i in range(estimated + 1):
        t = i / estimated
        pt = wall.interpolate(t, normalized=True)
        coords.append((pt.x, pt.y))
    n = len(coords)
    if n < 3:
        return wall
    # Signed control displacements at the interior sample points.
    signed = [0.0] * n
    for i in range(1, n - 1):
        signed[i] = _det_amp(coords[i][0], coords[i][1], seed, 1.0)

    def smoothstep(u: float) -> float:
        return u * u * (3.0 - 2.0 * u)

    out = [coords[0]]
    for i in range(1, n - 1):
        px, py = coords[i - 1]
        nx2, ny2 = coords[i + 1]
        dx, dy = nx2 - px, ny2 - py
        norm = math.hypot(dx, dy)
        if norm < 1e-9:
            out.append(coords[i])
            continue
        u = (norm * 0.5) / max(wavelength, 1e-9)
        blend = smoothstep(min(max(u, 0.0), 1.0))
        eff_amp = amp * (0.25 + 0.55 * abs(signed[i])) * blend
        nx, ny = -dy / norm, dx / norm
        if signed[i] < 0:
            nx, ny = -nx, -ny
        out.append((coords[i][0] + nx * eff_amp, coords[i][1] + ny * eff_amp))
    out.append(coords[-1])
    return LineString(out)


def _naturalize_partition(cells: Sequence[PolygonLabel], config: SubprovinceConfig,
                          remaining: BaseGeometry, rebuild=None,
                          noise_single_owner: bool = False) -> list[PolygonLabel]:
    """Simplify and naturalize walls in the partition.

    Shared walls between two non-road cells get coherent noise. When `noise_single_owner`
    is set, single-owner walls of `town` cells (their outer agglomeration boundary) are also
    noised, which is used for urban cells so small towns don't read as flat rectangles. A
    single wall is computed once and reused by both neighbors through a planar rebuild, so
    tiling stays exact. `rebuild(geometry, source_cell)` constructs the output record
    (defaults to a fresh PolygonLabel); pass `replace` to preserve ID-bearing records such as
    SubprovincePolygon.
    """
    if rebuild is None:
        rebuild = lambda geometry, cell: PolygonLabel(
            geometry, cell.kind, cell.cover_combat, cell.elevation_type, cell.is_capital)
    if not cells:
        return list(cells)
    # A single eligible cell has no shared walls; warp its outer boundary directly.
    if (len(cells) == 1 and noise_single_owner
            and config.natural_noise_amplitude > 0
            and cells[0].kind in {"town", "hinterland"}):
        warped = _noise_perimeter(cells[0].geometry, config, config.seed).intersection(remaining)
        if warped.is_empty or warped.area <= config.geometry_tolerance:
            return list(cells)
        return [rebuild(warped, cells[0])]
    tol = max(config.geometry_tolerance * 4.0, 1e-6)
    boundaries = []
    for cell in cells:
        boundary = cell.geometry.boundary
        if boundary is None or boundary.is_empty:
            continue
        if boundary.length <= tol or boundary.geom_type not in {"LineString", "MultiLineString"}:
            continue
        boundaries.append(boundary)
    if not boundaries:
        return list(cells)
    joined = unary_union(boundaries)
    try:
        walls = linemerge(joined)
    except ValueError:
        return list(cells)
    wall_list = list(walls.geoms) if hasattr(walls, "geoms") else [walls]
    smooth_tol = max(tol, config.natural_noise_wavelength * 0.12)
    index = STRtree([cell.geometry for cell in cells])

    def owners_for(midpoint):
        candidates = [cells[int(i)] for i in index.query(midpoint)
                      if cell_bounds_contain(cells[int(i)].geometry, midpoint)]
        return [cell for cell in candidates if cell.geometry.boundary.distance(midpoint) <= tol]

    new_walls = []
    for wall in wall_list:
        if wall.is_empty or wall.length <= tol:
            new_walls.append(wall)
            continue
        midpoint = wall.interpolate(0.5, normalized=True)
        owners = owners_for(midpoint)
        # A cover_combat boundary between two hinterland cells is a hard mask (per
        # SUBPROVINCE_PHASES.md) and must stay exact, not be smoothed/noised like an ordinary
        # same-cover shared wall.
        is_hard_cover_boundary = (len(owners) == 2 and owners[0].kind == "hinterland"
                                  and owners[1].kind == "hinterland"
                                  and owners[0].cover_combat != owners[1].cover_combat)
        if is_hard_cover_boundary:
            new_walls.append(wall)
        elif len(owners) == 2 and all(owner.kind in {"hinterland", "town"} for owner in owners):
            simplified = wall.simplify(smooth_tol, preserve_topology=True)
            if simplified.is_empty or simplified.geom_type != "LineString":
                simplified = wall
            new_walls.append(_natural_wall(simplified, config, config.seed))
        elif (len(owners) == 1 and noise_single_owner
              and owners[0].kind in {"town", "hinterland"}):
            simplified = wall.simplify(smooth_tol, preserve_topology=True)
            if simplified.is_empty or simplified.geom_type != "LineString":
                simplified = wall
            new_walls.append(_natural_wall(simplified, config, config.seed))
        else:
            # Single-owner walls (the compound's outer boundary against roads / city /
            # province) stay exact unless `noise_single_owner` opts them into noise.
            new_walls.append(wall)
    linework = unary_union([w for w in new_walls if not w.is_empty])
    faces = list(polygonize(linework))
    face_index = STRtree([cell.geometry for cell in cells])
    assigned: dict[int, list] = {id(cell): [] for cell in cells}
    for face in faces:
        if face.is_empty:
            continue
        rep = face.representative_point()
        hits = [cells[int(i)] for i in face_index.query(rep)
                if cell_bounds_contain(cells[int(i)].geometry, rep)]
        candidates = hits or list(cells)
        owner = max(candidates, key=lambda cell: face.intersection(cell.geometry).area)
        assigned[id(owner)].append(face)
    rebuilt = []
    absorbed: set[int] = set()
    for cell in cells:
        fid = id(cell)
        if assigned[fid]:
            continue
        # Union an orphan cell into the neighbour it overlaps most; keeps coverage and
        # avoids any possibility of a kept-orphan overlapping its neighbours.
        absorbed_into = max(range(len(cells)),
                            key=lambda i: cell.geometry.intersection(cells[i].geometry).area)
        if cells[absorbed_into] is not cell:
            assigned[id(cells[absorbed_into])].append(cell.geometry)
            absorbed.add(id(cell))
    for cell in cells:
        fid = id(cell)
        if not assigned[fid]:
            continue
        merged = unary_union(assigned[fid])
        if merged.geom_type not in {"Polygon", "MultiPolygon"} or merged.is_empty:
            continue
        clipped = merged.intersection(remaining)
        parts = _polygon_parts(clipped)
        if parts and sum(part.area for part in parts) > config.geometry_tolerance:
            rebuilt.append(rebuild(unary_union(parts), cell))
    # Guarantee coverage: any leftover region (where polygonize produced no face) is
    # unioned into the nearest rebuilt cell. Disjoint by construction, so no overlap.
    if rebuilt:
        miss_tol = max(config.geometry_tolerance * 4.0, 1e-6)
        union_r = unary_union([cell.geometry for cell in rebuilt])
        missing = remaining.difference(union_r)
        for part in _polygon_parts(missing):
            if part.area <= miss_tol:
                continue
            target_idx = min(range(len(rebuilt)),
                             key=lambda i: rebuilt[i].geometry.boundary.distance(part.representative_point()))
            merged = unary_union([rebuilt[target_idx].geometry, part]).intersection(remaining)
            new_parts = _polygon_parts(merged)
            rebuilt[target_idx] = rebuild(unary_union(new_parts) if new_parts else merged,
                                          rebuilt[target_idx])
    return rebuilt


def cell_bounds_contain(geometry: BaseGeometry, point: Point) -> bool:
    min_x, min_y, max_x, max_y = geometry.bounds
    return min_x <= point.x <= max_x and min_y <= point.y <= max_y


def merge_slivers(cells: Sequence[PolygonLabel], min_area: float, tolerance: float,
                  road_min_area: float | None = None) -> list[PolygonLabel]:
    """Absorb undersized cells into a neighbor.

    Road slivers use `road_min_area` (defaults to `min_area` if not given) instead of the
    generic threshold, since stray road fragments need a more aggressive cutoff than hinterland
    cells. Road slivers prefer an adjacent urban (town/capital) cell first, falling back to
    another road cell, and are left untouched if neither exists (never absorbed into
    hinterland). Non-road (hinterland) slivers keep the original longest-shared-boundary rule
    among non-capital, non-town neighbors, except a hinterland recipient must share the
    sliver's `cover_combat` (a road recipient is exempt, since roads already ignore cover-type
    boundaries by construction) so this cleanup pass can't silently erase the hard cover-type
    boundary between hinterland cells. A sliver with no valid recipient is marked unresolved and
    skipped so it never blocks merging the rest of the list.
    """
    road_min_area = min_area if road_min_area is None else road_min_area
    result = list(cells)
    unresolved: set[int] = set()
    while True:
        sliver_index = next(
            (i for i, cell in enumerate(result)
             if id(cell) not in unresolved and not cell.is_capital and cell.kind != "town"
             and cell.geometry.area < (road_min_area if cell.kind == "road" else min_area)),
            None)
        if sliver_index is None:
            break
        sliver = result[sliver_index]

        def shared_length(other: PolygonLabel) -> float:
            shared_geometry = sliver.geometry.boundary.intersection(other.geometry.boundary)
            return shared_geometry.length if shared_geometry is not None else 0.0

        if sliver.kind == "road":
            urban = sorted(
                ((shared_length(c), i) for i, c in enumerate(result)
                 if i != sliver_index and c.kind in {"town", "capital"} and shared_length(c) > tolerance),
                key=lambda item: (-item[0], item[1]))
            roads = sorted(
                ((shared_length(c), i) for i, c in enumerate(result)
                 if i != sliver_index and c.kind == "road" and shared_length(c) > tolerance),
                key=lambda item: (-item[0], item[1]))
            candidates = urban or roads
        else:
            candidates = sorted(
                ((shared_length(c), i) for i, c in enumerate(result)
                 if i != sliver_index and not c.is_capital and c.kind != "town" and shared_length(c) > tolerance
                 and (c.kind == "road" or c.cover_combat == sliver.cover_combat)),
                key=lambda item: (-item[0], item[1]))

        merged = False
        for _, recipient_index in candidates:
            recipient = result[recipient_index]
            merged_geometry = _valid_merged_polygon(recipient.geometry.union(sliver.geometry))
            if merged_geometry is None:
                continue
            result[recipient_index] = PolygonLabel(merged_geometry, recipient.kind, recipient.cover_combat,
                                                   recipient.elevation_type, recipient.is_capital)
            result.pop(sliver_index)
            merged = True
            break
        if not merged:
            # No recipient yields a single connected polygon; leave the sliver as its own cell
            # but keep scanning so it doesn't block merging any other sliver in the list.
            unresolved.add(id(sliver))
    return result


def _adjacent_indices(cells: Sequence[PolygonLabel], idx: int, tolerance: float) -> list[int]:
    """Direct-adjacency lookup scoped to one cell list, indexed rather than ID-keyed."""
    index = STRtree([cell.geometry for cell in cells])
    target = cells[idx].geometry
    candidates = index.query(box(*target.buffer(tolerance).bounds))
    neighbors = []
    for j in candidates:
        j = int(j)
        if j == idx:
            continue
        shared = target.boundary.intersection(cells[j].geometry.boundary)
        if shared is not None and shared.length > tolerance:
            neighbors.append(j)
    return neighbors


def _shared_boundary_length(a: PolygonLabel, b: PolygonLabel) -> float:
    shared = a.geometry.boundary.intersection(b.geometry.boundary)
    return shared.length if shared is not None else 0.0


def _find_same_terrain_within_two_hops(cells: Sequence[PolygonLabel], idx: int, tolerance: float,
                                       settled: set[int], small: float) -> tuple[list[int], int] | None:
    """Find a same-cover_combat hinterland cell reachable within 2 adjacency hops.

    Checks direct (1-hop) neighbors first; if none match, checks each 1-hop neighbor's own
    neighbors (2-hop). Returns `(intermediate_indices, target_index)` — `intermediate_indices`
    is empty for a direct match, or the single connecting cell for a 2-hop match (which must be
    absorbed too, since it physically separates the sliver from the target and a union of the
    two alone would not be a single connected polygon). Candidates are ranked by shared-boundary
    length (descending), then geometry WKB, for determinism. Cells already in `settled` (already
    modified by an action this pass, as either driver or recipient) are excluded from candidacy
    entirely — otherwise an already-merged cell could keep getting re-absorbed by a chain of
    other small cells, one after another, defeating the one-action-per-cell bound.

    A 1-hop neighbor is only ever used as a *pathway* to a 2-hop target if it's itself under
    `small` — otherwise a large, entirely legitimate cell of a different terrain that merely
    happens to sit between the sliver and a same-terrain cell would get fully absorbed as
    "connecting tissue," silently converting a large chunk of one terrain's territory into
    another's. A 1-hop neighbor of any size is still a valid *direct* match, just not a
    stepping-stone to something further away.
    """
    sliver = cells[idx]
    hop1 = sorted((i for i in _adjacent_indices(cells, idx, tolerance) if id(cells[i]) not in settled),
                 key=lambda i: (-_shared_boundary_length(sliver, cells[i]), cells[i].geometry.wkb))
    for i in hop1:
        if cells[i].kind == "hinterland" and cells[i].cover_combat == sliver.cover_combat:
            return [], i
    hop1_set = set(hop1) | {idx}
    for i in hop1:
        if cells[i].geometry.area >= small:
            continue
        hop2 = sorted((j for j in _adjacent_indices(cells, i, tolerance) if id(cells[j]) not in settled),
                      key=lambda j: (-_shared_boundary_length(cells[i], cells[j]), cells[j].geometry.wkb))
        for j in hop2:
            if j in hop1_set:
                continue
            if cells[j].kind == "hinterland" and cells[j].cover_combat == sliver.cover_combat:
                return [i], j
    return None


def _valid_merged_polygon(geometry: BaseGeometry) -> Polygon | None:
    """Return `geometry` as a single valid `Polygon`, retrying with `shapely.make_valid()` once
    if the raw union came out invalid or as a `MultiPolygon` — common for unions of directly
    adjacent, raster-derived/noise-warped cells whose shared boundary is only imprecisely
    identical on both sides. Returns `None` if it's still not a clean single polygon afterward.
    """
    if geometry.geom_type == "Polygon" and geometry.is_valid:
        return geometry
    fixed = shapely.make_valid(geometry)
    if fixed.geom_type == "Polygon" and fixed.is_valid:
        return fixed
    return None


def _resolve_tiny_hinterland(cells: Sequence[PolygonLabel], config: SubprovinceConfig,
                             grid_cell_area: float) -> list[PolygonLabel]:
    """Merge undersized hinterland cells, all thresholds in raster grid-cell area.

    1. If a same-cover_combat hinterland cell is reachable within 2 adjacency hops, absorb the
       whole path (sliver + any connecting cell + target) into one polygon.
    2. Else, absorb the sliver into the best (longest-shared-boundary) different-cover_combat
       hinterland neighbor.
    A sliver with no hinterland neighbor at all (e.g. only bordering roads) is left unchanged.

    Every cell gets at most one resolution action: the moment a cell is produced by a merge, it's
    marked `settled` and excluded from ever being picked again as a sliver — or being used as
    someone else's target/recipient — in this pass, even if its resulting size still happens to
    be under `small`. Without this, a cell that's merged but still nominally "small" immediately
    re-qualifies and chains into another merge, snowballing into one giant blob and silently
    erasing terrain granularity.
    """
    small = config.hinterland_tiny_grid_cells * grid_cell_area
    result = list(cells)
    settled: set[int] = set()
    guard = 0
    guard_limit = 4 * (len(result) + 1)
    while guard < guard_limit:
        guard += 1
        idx = next((i for i, cell in enumerate(result)
                   if id(cell) not in settled and cell.kind == "hinterland"
                   and cell.geometry.area < small), None)
        if idx is None:
            break
        sliver = result[idx]

        path = _find_same_terrain_within_two_hops(result, idx, config.geometry_tolerance, settled, small)
        if path is not None:
            intermediates, target = path
            merged = _valid_merged_polygon(unary_union([sliver.geometry, result[target].geometry]
                                                        + [result[i].geometry for i in intermediates]))
            if merged is not None:
                new_cell = PolygonLabel(merged, "hinterland", sliver.cover_combat,
                                        sliver.elevation_type, False)
                for i in sorted(intermediates + [target, idx], reverse=True):
                    result.pop(i)
                result.append(new_cell)
                settled.add(id(new_cell))
                continue

        neighbors = _adjacent_indices(result, idx, config.geometry_tolerance)
        diff_terrain = sorted(
            (i for i in neighbors if result[i].kind == "hinterland"
             and result[i].cover_combat != sliver.cover_combat
             and id(result[i]) not in settled),
            key=lambda i: (-_shared_boundary_length(sliver, result[i]), result[i].geometry.wkb))
        if not diff_terrain:
            settled.add(id(sliver))
            continue

        best = result[diff_terrain[0]]
        merged = _valid_merged_polygon(sliver.geometry.union(best.geometry))
        if merged is not None:
            merged_cell = PolygonLabel(merged, "hinterland", best.cover_combat, best.elevation_type, False)
            result[diff_terrain[0]] = merged_cell
            result.pop(idx)
            settled.add(id(merged_cell))
            continue
        settled.add(id(sliver))
    return result


def _split_oversized_hinterland(cells: Sequence[PolygonLabel], terrain: TerrainRaster,
                                config: SubprovinceConfig, grid_cell_area: float) -> list[PolygonLabel]:
    """Route any hinterland cell above `hinterland_split_grid_cells` through the existing
    Voronoi-plus-homogeneous-merge splitter, leaving smaller cells untouched.

    Runs after `_resolve_tiny_hinterland`'s merge pass, since a merge can occasionally push a
    cell above the split threshold (e.g. a small cell absorbed into an already-large neighbor),
    on top of any naturally oversized terrain patch that was never touched by that pass.
    """
    max_area = config.hinterland_split_grid_cells * grid_cell_area
    split_config = _split_config(config, grid_cell_area)
    result: list[PolygonLabel] = []
    for cell in cells:
        if cell.kind == "hinterland" and cell.geometry.area > max_area:
            result.extend(_voronoi_hinterland_region(cell.geometry, terrain, split_config,
                                                      forced_cover=cell.cover_combat))
        else:
            result.append(cell)
    return result


def assign_stable_ids(province_id: str, cells: Sequence[PolygonLabel]) -> list[SubprovincePolygon]:
    kind_order = {"capital": 0, "town": 1, "road": 2, "hinterland": 3}
    ordered = sorted(cells, key=lambda cell: (kind_order.get(cell.kind, 99), round(cell.geometry.centroid.y, 9),
                                               round(cell.geometry.centroid.x, 9), round(cell.geometry.area, 9),
                                               cell.geometry.wkb))
    return [SubprovincePolygon(f"{province_id}_sp_{index}", province_id, cell.geometry, cell.kind,
                               cell.cover_combat, cell.elevation_type, cell.is_capital)
            for index, cell in enumerate(ordered)]


def generate_subprovinces(province_id: str, province: BaseGeometry,
                          terrain_patches: Sequence[TerrainPatch], terrain: TerrainRaster,
                          roads: Sequence[RoadInput], rivers: Sequence[BaseGeometry],
                          bridge_gaps: Sequence[BaseGeometry], capital: Point | None,
                          towns: Sequence[Point], config: SubprovinceConfig,
                          report_timing: bool = False) -> list[SubprovincePolygon]:
    timings = Timings()
    if not province.is_valid or province.is_empty or not terrain.grid.crs.is_projected:
        raise ValueError("province must be valid and terrain CRS must be projected")
    if terrain.cover.shape != (terrain.grid.height, terrain.grid.width) or terrain.elevation.shape != terrain.cover.shape:
        raise ValueError("terrain arrays must match terrain grid")

    remaining = province
    urban_cells: list[PolygonLabel] = []
    road_cells: list[PolygonLabel] = []
    hinterland_cells: list[PolygonLabel] = []

    city_cell = _build_city_cell(province, terrain_patches, terrain, capital, config)
    if city_cell is not None:
        remaining = remaining.difference(city_cell.geometry)
    timings.mark("city")

    urban_cells = _build_urban_cells(remaining, terrain_patches, terrain, config)
    # Naturalize town boundaries (shared internal walls and outer agglomeration edges) with
    # bounded noise scaled to the compound so small towns don't read as flat rectangles. The
    # rebuild clips/absorbs inside the urban compound, never the whole province.
    if urban_cells:
        urban_region = unary_union([cell.geometry for cell in urban_cells])
        min_x, min_y, max_x, max_y = urban_region.bounds
        span = max(max_x - min_x, max_y - min_y)
        urban_cfg = SubprovinceConfig(**{
            **config.__dict__,
            "natural_noise_amplitude": min(config.natural_noise_amplitude, span * 0.04),
            "natural_noise_wavelength": min(config.natural_noise_wavelength, span * 0.12),
        })
        urban_cells = _naturalize_partition(urban_cells, urban_cfg, urban_region,
                                            noise_single_owner=True)
    urban_geom = unary_union([cell.geometry for cell in urban_cells]) if urban_cells else None
    if urban_geom is not None and not urban_geom.is_empty:
        remaining = remaining.difference(urban_geom)
    timings.mark("urban")

    road_cells, remaining = _build_road_cells(remaining, roads, terrain, config)
    timings.mark("roads")

    hinterland_cells = _build_hinterland_cells(remaining, terrain_patches, terrain, config)
    timings.mark("hinterland")

    grid_cell_area = abs(terrain.grid.transform.a * terrain.grid.transform.e)
    # Alternate merge/split until the hinterland cell count stops changing, instead of a fixed
    # number of rounds: a single round can leave fresh undersized edge pieces from the split (a
    # merge's own `settled` set only guarantees one action per cell per round), and empirically a
    # fixed short sequence converges far short of what the merge/split machinery can actually
    # achieve. Capped well above the rounds real provinces need in practice, purely as a runaway
    # guard, not a tuning knob — this loop is observed to reach a stable fixed point (no
    # oscillation) well under the cap.
    for _ in range(20):
        before = len(hinterland_cells)
        hinterland_cells = _resolve_tiny_hinterland(hinterland_cells, config, grid_cell_area)
        hinterland_cells = _split_oversized_hinterland(hinterland_cells, terrain, config, grid_cell_area)
        if len(hinterland_cells) == before:
            break
    timings.mark("hinterland-size-passes")

    # Naturalize shared borders between hinterland blobs (topology-safe, verified), after the
    # size-based passes so noise isn't wasted on boundaries that are about to be merged/split
    # away. Urban source polygons are pre-simplified at generation to drop dense source
    # micro-vertices, road/city cells stay clean, and urban internal splits are naturalized
    # separately.
    hinterland_cells = _naturalize_partition(hinterland_cells, config, remaining)
    timings.mark("naturalize")

    cells = ([city_cell] if city_cell is not None else []) + urban_cells + road_cells + hinterland_cells
    merged = merge_slivers(cells, config.min_area, config.geometry_tolerance, config.road_min_area)
    cells = merged
    timings.mark("sliver-merge")

    coverage_tolerance = max(config.geometry_tolerance * 16.0, 4.0 * (terrain.grid.transform.a ** 2))
    try:
        result = assign_stable_ids(province_id, cells)
        validate_subprovince_metadata(result)
        validate_subprovince_partition(province, result, config.geometry_tolerance, coverage_tolerance)
        adjacency = build_subprovince_adjacency(result, config.geometry_tolerance)
        validate_subprovince_adjacency(result, adjacency)
        timings.mark("validate")
    except Exception:
        # Retry naturalization with noise disabled if a boundary perturbation broke topology.
        reduced = SubprovinceConfig(**{**config.__dict__, "natural_noise_amplitude": 0.0})
        hinterland_cells = _naturalize_partition(hinterland_cells, reduced, remaining)
        cells = ([city_cell] if city_cell is not None else []) + urban_cells + road_cells + hinterland_cells
        cells = merge_slivers(cells, config.min_area, config.geometry_tolerance, config.road_min_area)
        timings.mark("naturalize(retry)")
        result = assign_stable_ids(province_id, cells)
        validate_subprovince_metadata(result)
        validate_subprovince_partition(province, result, config.geometry_tolerance, coverage_tolerance)
        adjacency = build_subprovince_adjacency(result, config.geometry_tolerance)
        validate_subprovince_adjacency(result, adjacency)
        timings.mark("validate(retry)")

    if report_timing:
        print("Timing:")
        timings.report()
    return result