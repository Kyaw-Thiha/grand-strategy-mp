import sys
from pathlib import Path

import numpy as np
import pytest
from rasterio.crs import CRS
from shapely.geometry import box, LineString

sys.path.insert(0, str(Path(__file__).parent))

from subprovince_raster import (
    build_cost_raster,
    build_working_grid,
    clip_vectorized_labels,
    rasterize_patch_mask,
    rasterize_river_barriers,
    split_patch_labels,
    vectorize_labels,
)


def test_working_grid_uses_pixel_centers_and_rejects_invalid_inputs():
    grid = build_working_grid((0, 0, 2.1, 3.1), 1.0, CRS.from_epsg(3857))
    assert (grid.width, grid.height) == (3, 4)
    assert grid.pixel_center(0, 0) == (0.5, 2.6)
    with pytest.raises(ValueError):
        build_working_grid((0, 0, 1, 1), 0, CRS.from_epsg(3857))


def test_cost_raster_is_inverse_movement_product():
    result = build_cost_raster(
        np.array([["plains", "forest"]]),
        np.array([["flat", "hills"]]),
        {"plains": 1.0, "forest": 0.5},
        {"flat": 1.0, "hills": 0.5},
    )
    np.testing.assert_allclose(result, [[1.0, 4.0]])
    with pytest.raises(ValueError):
        build_cost_raster(np.array([["unknown"]]), np.array([["flat"]]), {"plains": 1}, {"flat": 1})


def test_patch_mask_and_river_barrier_respect_pixel_centers_and_bridge_gap():
    grid = build_working_grid((0, 0, 4, 4), 1, CRS.from_epsg(3857))
    patch_mask = rasterize_patch_mask(box(0, 0, 4, 4), grid)
    barriers = rasterize_river_barriers(
        [LineString([(2, 0), (2, 4)])],
        [box(1.5, 1.5, 2.5, 2.5)],
        grid,
        patch_mask,
    )
    assert barriers[0, 2]
    assert barriers[3, 2]
    assert not barriers[1, 2]
    assert not barriers[2, 2]


def test_dijkstra_is_complete_and_seed_order_independent():
    cost = np.ones((3, 5), dtype=float)
    mask = np.ones((3, 5), dtype=bool)
    first = split_patch_labels(cost, mask, [(1, 0), (1, 4)])
    second = split_patch_labels(cost, mask, [(1, 4), (1, 0)])
    np.testing.assert_array_equal(first, second)
    assert set(np.unique(first)) == {0, 1}
    assert first[1, 2] == 0


def test_dijkstra_rejects_blocked_seed_and_unreachable_pixel():
    mask = np.ones((2, 3), dtype=bool)
    blocked = np.zeros_like(mask)
    blocked[0, 1] = True
    with pytest.raises(ValueError):
        split_patch_labels(np.ones((2, 3)), mask, [(0, 1)], blocked)
    disconnected = np.array([[True, False, True]])
    with pytest.raises(ValueError):
        split_patch_labels(np.ones((1, 3)), disconnected, [(0, 0)])


def test_vectorization_preserves_pixel_area_and_clip():
    grid = build_working_grid((0, 0, 3, 2), 1, CRS.from_epsg(3857))
    labels = np.array([[0, 0, 1], [0, 1, 1]], dtype=np.int32)
    mask = labels >= 0
    polygons = vectorize_labels(labels, grid, mask)
    assert sum(poly.area for _, poly in polygons) == pytest.approx(6.0)
    clipped = clip_vectorized_labels(polygons, box(0, 0, 2, 2))
    assert sum(poly.area for _, poly in clipped) == pytest.approx(3.0)
