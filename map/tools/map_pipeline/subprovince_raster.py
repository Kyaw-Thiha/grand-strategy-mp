"""Raster primitives for authoritative subprovince generation."""

from dataclasses import dataclass
import heapq
from typing import Mapping, Sequence

import numpy as np
from affine import Affine
from rasterio.crs import CRS
from rasterio.features import rasterize, shapes
from shapely.geometry import Polygon, shape
from shapely.geometry.base import BaseGeometry


@dataclass(frozen=True)
class RasterGrid:
    transform: Affine
    width: int
    height: int
    crs: CRS
    nodata: int | None = -1

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        left = self.transform.c
        top = self.transform.f
        return (left, top - self.height * abs(self.transform.e),
                left + self.width * self.transform.a, top)

    def pixel_center(self, row: int, column: int) -> tuple[float, float]:
        return (self.transform.c + (column + 0.5) * self.transform.a,
                self.transform.f + (row + 0.5) * self.transform.e)

    def cell_window(self, geometry: "BaseGeometry") -> tuple[int, int, int, int]:
        """Return (row0, row1, col0, col1) pixel window enclosing a geometry's bounds."""
        min_x, min_y, max_x, max_y = geometry.bounds
        col0 = max(0, int(np.floor((min_x - self.transform.c) / self.transform.a)) - 1)
        col1 = min(self.width, int(np.ceil((max_x - self.transform.c) / self.transform.a)) + 1)
        row0 = max(0, int(np.floor((self.transform.f - max_y) / abs(self.transform.e))) - 1)
        row1 = min(self.height, int(np.ceil((self.transform.f - min_y) / abs(self.transform.e))) + 1)
        return row0, row1, col0, col1

    def sub_grid(self, row0: int, row1: int, col0: int, col1: int) -> "RasterGrid":
        """Return a translated RasterGrid covering rows [row0,row1) and cols [col0,col1)."""
        width = col1 - col0
        height = row1 - row0
        left = self.transform.c + col0 * self.transform.a
        top = self.transform.f + row0 * self.transform.e
        return RasterGrid(Affine(self.transform.a, 0, left, 0, self.transform.e, top),
                          width, height, self.crs, self.nodata)


def build_working_grid(
    bounds: tuple[float, float, float, float], resolution: float, crs: CRS
) -> RasterGrid:
    left, bottom, right, top = bounds
    if resolution <= 0:
        raise ValueError("raster resolution must be positive")
    if not crs.is_projected:
        raise ValueError("working CRS must be projected")
    if not np.all(np.isfinite(bounds)):
        raise ValueError("bounds must be finite")
    if not (right > left and top > bottom):
        raise ValueError("bounds must be ordered and non-empty")
    width = int(np.ceil((right - left) / resolution))
    height = int(np.ceil((top - bottom) / resolution))
    return RasterGrid(Affine(resolution, 0, left, 0, -resolution, top), width, height, crs)


def _check_movement_table(table: Mapping[str, float], name: str) -> None:
    for label, value in table.items():
        if value <= 0:
            raise ValueError(f"{name} movement for {label!r} must be positive")


def build_cost_raster(
    cover: np.ndarray,
    elevation: np.ndarray,
    cover_move: Mapping[str, float],
    elevation_move: Mapping[str, float],
) -> np.ndarray:
    if cover.shape != elevation.shape:
        raise ValueError("cover and elevation arrays must have matching shapes")
    _check_movement_table(cover_move, "cover")
    _check_movement_table(elevation_move, "elevation")
    try:
        cover_values = np.vectorize(cover_move.__getitem__, otypes=[float])(cover)
        elevation_values = np.vectorize(elevation_move.__getitem__, otypes=[float])(elevation)
    except KeyError as exc:
        raise ValueError(f"unknown terrain label: {exc.args[0]!r}") from exc
    return 1.0 / (cover_values * elevation_values)


def _validate_raster_shape(mask: np.ndarray, grid: RasterGrid) -> None:
    if mask.shape != (grid.height, grid.width):
        raise ValueError("raster mask shape does not match grid")


def rasterize_patch_mask(patch: BaseGeometry, grid: RasterGrid) -> np.ndarray:
    if patch.is_empty or not patch.is_valid:
        raise ValueError("patch must be non-empty and valid")
    return rasterize(
        [(patch, 1)], out_shape=(grid.height, grid.width), transform=grid.transform,
        fill=0, all_touched=False, dtype="uint8"
    ).astype(bool)


def rasterize_river_barriers(
    rivers: Sequence[BaseGeometry], bridge_gaps: Sequence[BaseGeometry],
    grid: RasterGrid, patch_mask: np.ndarray
) -> np.ndarray:
    _validate_raster_shape(patch_mask, grid)
    river_shapes = [(river, 1) for river in rivers if not river.is_empty and river.is_valid]
    gap_shapes = [(gap, 1) for gap in bridge_gaps if not gap.is_empty and gap.is_valid]
    barriers = rasterize(river_shapes, out_shape=patch_mask.shape, transform=grid.transform,
                         fill=0, all_touched=False, dtype="uint8").astype(bool) if river_shapes else np.zeros_like(patch_mask)
    gaps = rasterize(gap_shapes, out_shape=patch_mask.shape, transform=grid.transform,
                     fill=0, all_touched=False, dtype="uint8").astype(bool) if gap_shapes else np.zeros_like(patch_mask)
    return barriers & ~gaps & patch_mask


def split_patch_labels(
    cost: np.ndarray, patch_mask: np.ndarray, seeds: Sequence[tuple[int, int]],
    blocked_mask: np.ndarray | None = None
) -> np.ndarray:
    if cost.ndim != 2 or patch_mask.shape != cost.shape:
        raise ValueError("cost and patch mask must be matching two-dimensional arrays")
    if blocked_mask is None:
        blocked_mask = np.zeros_like(patch_mask, dtype=bool)
    if blocked_mask.shape != cost.shape:
        raise ValueError("blocked mask must match cost shape")
    if np.any(~np.isfinite(cost[patch_mask & ~blocked_mask])) or np.any(cost[patch_mask & ~blocked_mask] <= 0):
        raise ValueError("traversable costs must be finite and positive")
    normalized = sorted(set((int(row), int(column)) for row, column in seeds))
    if not normalized:
        raise ValueError("at least one seed is required")
    for row, column in normalized:
        if not (0 <= row < cost.shape[0] and 0 <= column < cost.shape[1]) or not patch_mask[row, column] or blocked_mask[row, column]:
            raise ValueError("seed must be inside the traversable patch")
    labels = np.full(cost.shape, -1, dtype=np.int32)
    best: dict[tuple[int, int], tuple[float, int, int, int]] = {}
    heap: list[tuple[float, int, int, int]] = []
    for rank, (row, column) in enumerate(normalized):
        candidate = (0.0, rank, row, column)
        best[(row, column)] = candidate
        heapq.heappush(heap, candidate)
    while heap:
        distance, rank, row, column = heapq.heappop(heap)
        if best.get((row, column)) != (distance, rank, row, column):
            continue
        labels[row, column] = rank
        for next_row, next_column in ((row - 1, column), (row + 1, column), (row, column - 1), (row, column + 1)):
            if not (0 <= next_row < cost.shape[0] and 0 <= next_column < cost.shape[1]):
                continue
            if not patch_mask[next_row, next_column] or blocked_mask[next_row, next_column]:
                continue
            candidate = (distance + float(cost[next_row, next_column]), rank, next_row, next_column)
            current = best.get((next_row, next_column))
            if current is None or candidate < current:
                best[(next_row, next_column)] = candidate
                heapq.heappush(heap, candidate)
    traversable = patch_mask & ~blocked_mask
    if np.any(labels[traversable] < 0):
        raise ValueError("traversable patch contains unreachable pixels")
    return labels


def vectorize_labels(labels: np.ndarray, grid: RasterGrid, source_mask: np.ndarray) -> list[tuple[int, Polygon]]:
    if labels.shape != source_mask.shape or labels.shape != (grid.height, grid.width):
        raise ValueError("labels, source mask, and grid dimensions must match")
    valid_labels = np.where(source_mask, labels, -1).astype(np.int32)
    expected_area = float(np.count_nonzero(valid_labels >= 0)) * abs(grid.transform.a * grid.transform.e)
    output: list[tuple[int, Polygon]] = []
    for geometry, value in shapes(valid_labels, mask=valid_labels >= 0, transform=grid.transform):
        label = int(value)
        polygon = shape(geometry)
        if label < 0 or polygon.is_empty:
            continue
        polygon_pixels = rasterize([(polygon, 1)], labels.shape, transform=grid.transform).astype(bool)
        if not np.any(polygon_pixels & source_mask):
            raise ValueError("vectorized geometry does not intersect source mask")
        output.append((label, polygon))
    actual_area = sum(polygon.area for _, polygon in output)
    tolerance = abs(grid.transform.a * grid.transform.e) * 1e-6 + 1e-9
    if abs(actual_area - expected_area) > tolerance:
        raise ValueError("vectorized area does not match labeled pixel area")
    return output


def clip_vectorized_labels(
    polygons: Sequence[tuple[int, Polygon]], source_patch: BaseGeometry
) -> list[tuple[int, Polygon]]:
    result: list[tuple[int, Polygon]] = []
    for label, polygon in polygons:
        clipped = polygon.intersection(source_patch)
        if clipped.is_empty:
            continue
        parts = list(clipped.geoms) if clipped.geom_type == "MultiPolygon" else [clipped]
        for part in parts:
            if part.geom_type != "Polygon" or part.is_empty:
                continue
            result.append((label, part))
    if not result:
        raise ValueError("clipping produced no polygons")
    return result
