import sys
from pathlib import Path

import numpy as np
import pytest
from rasterio.crs import CRS
from shapely.geometry import LineString, Point, Polygon, box

sys.path.insert(0, str(Path(__file__).parent))

from subprovince_generator import (
    PolygonLabel,
    RoadInput,
    SubprovinceConfig,
    TerrainPatch,
    TerrainRaster,
    assign_stable_ids,
    generate_subprovinces,
    merge_slivers,
)
from subprovince_raster import build_working_grid
from subprovince_validation import (
    SubprovinceValidationError,
    build_cross_province_adjacency,
    build_subprovince_adjacency,
    validate_subprovince_partition,
)


def config(tag=""):
    base = dict(
        city_radius=3.0,
        city_noise_amplitude=0.2,
        city_noise_wavelength=2.0,
        urban_min_area=4.0,
        urban_target_area=20.0,
        road_width=2.0,
        road_segment_length=8.0,
        hinterland_target_area=100.0,
        hinterland_max_area=400.0,
        min_area=0.5,
        road_min_area=1.5,
        hinterland_tiny_grid_cells=10.0,
        hinterland_split_grid_cells=150.0,
        natural_noise_amplitude=0.2,
        natural_noise_wavelength=4.0,
        geometry_tolerance=1e-6,
        seed=7,
    )
    return SubprovinceConfig(**base)


def terrain_for(bounds=(0, 0, 40, 40), cover="plains", elev="flat"):
    grid = build_working_grid(bounds, 1.0, CRS.from_epsg(3857))
    shape = (grid.height, grid.width)
    return TerrainRaster(
        np.full(shape, cover, dtype=object),
        np.full(shape, elev, dtype=object),
        grid,
    )


def test_city_fallback_forms_capital_without_overlap():
    province = box(0, 0, 20, 20)
    terrain = terrain_for(bounds=(0, 0, 20, 20))
    patches = [TerrainPatch(province, "plains")]
    result = generate_subprovinces(
        "p", province, patches, terrain, [], [], [], Point(5, 5), [], config()
    )
    capitals = [cell for cell in result if cell.is_capital]
    assert len(capitals) == 1 and capitals[0].kind == "capital"
    validate_subprovince_partition(province, result, 1e-6, coverage_tolerance=1e-3)


def test_city_uses_urban_patch_when_large_neighbor_exists():
    province = box(0, 0, 20, 20)
    terrain = terrain_for(bounds=(0, 0, 20, 20))
    urban = box(2, 2, 10, 10)
    patches = [TerrainPatch(province, "plains"), TerrainPatch(urban, "urban")]
    result = generate_subprovinces(
        "p", province, patches, terrain, [], [], [], Point(5, 5), [], config()
    )
    capitals = [cell for cell in result if cell.is_capital]
    assert len(capitals) == 1
    assert capitals[0].geometry.area >= 64.0 * 0.8


def test_urban_patches_become_town_cells_and_are_carved():
    province = box(0, 0, 30, 30)
    terrain = terrain_for(bounds=(0, 0, 30, 30))
    urban = box(20, 20, 24, 24)
    patches = [TerrainPatch(province, "plains"), TerrainPatch(urban, "urban")]
    result = generate_subprovinces(
        "p", province, patches, terrain, [], [], [], Point(2, 2), [], config()
    )
    towns = [cell for cell in result if cell.kind == "town"]
    assert towns
    # a road crossing the town region must not overlap it
    road = [RoadInput(LineString([(0, 22), (30, 22)]), 2)]
    result2 = generate_subprovinces(
        "p", province, patches, terrain, road, [], [], Point(2, 2), [], config()
    )
    validate_subprovince_partition(province, result2, 1e-6, coverage_tolerance=1e-3)
    town_area = sum(cell.geometry.area for cell in result2 if cell.kind == "town")
    assert town_area > 0


def test_undersized_urban_patch_is_not_carved_as_town():
    province = box(0, 0, 30, 30)
    terrain = terrain_for(bounds=(0, 0, 30, 30))
    tiny_urban = box(20, 20, 21, 21)  # area 1 < urban_min_area (4.0)
    patches = [TerrainPatch(province, "plains"), TerrainPatch(tiny_urban, "urban")]
    result = generate_subprovinces(
        "p", province, patches, terrain, [], [], [], Point(2, 2), [], config()
    )
    towns = [cell for cell in result if cell.kind == "town"]
    assert towns == []
    validate_subprovince_partition(province, result, 1e-6, coverage_tolerance=1e-3)


def test_road_cells_are_clean_and_non_overlapping():
    province = box(0, 0, 40, 40)
    terrain = terrain_for(bounds=(0, 0, 40, 40))
    patches = [TerrainPatch(province, "plains")]
    roads = [RoadInput(LineString([(0, 4), (40, 4)]), 2)]
    result = generate_subprovinces(
        "p", province, patches, terrain, roads, [], [], Point(2, 2), [], config()
    )
    road_cells = [cell for cell in result if cell.kind == "road"]
    assert road_cells
    for cell in road_cells:
        assert cell.geometry.is_valid
        assert cell.geometry.geom_type in {"Polygon", "MultiPolygon"}
    validate_subprovince_partition(province, result, 1e-6, coverage_tolerance=1e-3)


def test_hinterland_blobs_follow_cover_elevation_majority():
    province = box(0, 0, 40, 40)
    grid = build_working_grid((0, 0, 40, 40), 1.0, CRS.from_epsg(3857))
    cover = np.full((40, 40), "plains", dtype=object)
    cover[:, 20:] = "forest"
    elevation = np.full((40, 40), "flat", dtype=object)
    elevation[:20, :] = "hills"
    terrain = TerrainRaster(cover, elevation, grid)
    # cover_combat is a hard mask, so the vector patches must match the raster split (one
    # patch per cover type) for hinterland generation to actually produce both labels.
    patches = [TerrainPatch(box(0, 0, 20, 40), "plains"), TerrainPatch(box(20, 0, 40, 40), "forest")]
    result = generate_subprovinces(
        "p", province, patches, terrain, [], [], [], None, [], config()
    )
    validate_subprovince_partition(province, result, 1e-6, coverage_tolerance=1e-3)
    hinter = [cell for cell in result if cell.kind == "hinterland"]
    assert len(hinter) >= 2
    combos = {(cell.cover_combat, cell.elevation_type) for cell in hinter}
    assert combos >= {("plains", "flat"), ("forest", "hills")}


def test_hinterland_splits_along_cover_boundary():
    # Two large same-elevation patches of different cover_combat, sized well above
    # hinterland_target_area, so the old whole-region Voronoi would have been free to draw a
    # cell straddling x=20; the cover_combat hard mask must prevent that.
    province = box(0, 0, 40, 40)
    terrain = terrain_for(bounds=(0, 0, 40, 40))
    patches = [TerrainPatch(box(0, 0, 20, 40), "plains"), TerrainPatch(box(20, 0, 40, 40), "forest")]
    result = generate_subprovinces(
        "p", province, patches, terrain, [], [], [], None, [], config()
    )
    validate_subprovince_partition(province, result, 1e-6, coverage_tolerance=1e-3)
    hinter = [cell for cell in result if cell.kind == "hinterland"]
    assert len(hinter) >= 2
    for cell in hinter:
        min_x, _, max_x, _ = cell.geometry.bounds
        assert max_x <= 20 + 1e-6 or min_x >= 20 - 1e-6, "hinterland cell crosses the cover boundary"
        if max_x <= 20 + 1e-6:
            assert cell.cover_combat == "plains"
        else:
            assert cell.cover_combat == "forest"


def test_hinterland_allows_minority_terrain_inside_blob():
    province = box(0, 0, 40, 40)
    grid = build_working_grid((0, 0, 40, 40), 1.0, CRS.from_epsg(3857))
    cover = np.full((40, 40), "plains", dtype=object)
    cover[5:6, 5:6] = "swamp"  # single minority pixel
    terrain = TerrainRaster(cover, np.full((40, 40), "flat", dtype=object), grid)
    result = generate_subprovinces(
        "p", province, [TerrainPatch(province, "plains")], terrain, [], [], [], None, [], config()
    )
    validate_subprovince_partition(province, result, 1e-6, coverage_tolerance=1e-3)
    hinter = [cell for cell in result if cell.kind == "hinterland"]
    assert any(cell.cover_combat == "plains" for cell in hinter)


def test_hinterland_stays_one_cell_when_under_split_threshold():
    from subprovince_generator import _build_hinterland_cells
    province = box(0, 0, 10, 10)  # area 100, under the test config's split threshold of 150
    terrain = terrain_for(bounds=(0, 0, 10, 10))
    patches = [TerrainPatch(province, "plains")]
    cells = _build_hinterland_cells(province, patches, terrain, config())
    assert len(cells) == 1
    assert cells[0].cover_combat == "plains"
    assert cells[0].geometry.area == pytest.approx(100.0)


def test_hinterland_splits_when_over_split_threshold():
    from subprovince_generator import _build_hinterland_cells
    province = box(0, 0, 20, 25)  # area 500, over the test config's split threshold of 150
    terrain = terrain_for(bounds=(0, 0, 20, 25))
    patches = [TerrainPatch(province, "plains")]
    cells = _build_hinterland_cells(province, patches, terrain, config())
    assert len(cells) > 1
    assert all(cell.cover_combat == "plains" for cell in cells)
    assert sum(cell.geometry.area for cell in cells) == pytest.approx(500.0)


def test_deterministic_under_reordered_sources():
    province = box(0, 0, 40, 40)
    terrain = terrain_for(bounds=(0, 0, 40, 40))
    patches = [TerrainPatch(box(0, 0, 20, 40), "plains"), TerrainPatch(box(20, 0, 40, 40), "forest")]
    roads = [RoadInput(LineString([(0, 6), (40, 6)]), 2)]
    one = generate_subprovinces("p", province, patches, terrain, roads, [], [], Point(3, 3), [], config())
    two = generate_subprovinces(
        "p", province, list(reversed(patches)), terrain, list(reversed(roads)), [], [], Point(3, 3), [], config()
    )
    assert [(x.subprovince_id, x.geometry.wkb) for x in one] == [(x.subprovince_id, x.geometry.wkb) for x in two]


def test_naturalization_keeps_roads_clean(capsys):
    province = box(0, 0, 40, 40)
    terrain = terrain_for(bounds=(0, 0, 40, 40))
    roads = [RoadInput(LineString([(0, 4), (40, 4)]), 2)]
    result = generate_subprovinces(
        "p", province, [TerrainPatch(province, "plains")], terrain, roads, [], [], Point(2, 2), [],
        config(), report_timing=True
    )
    road_cells = [cell for cell in result if cell.kind == "road"]
    assert road_cells
    out = capsys.readouterr().out
    assert "Timing:" in out


def test_lateral_profile_smooths_between_stations():
    from subprovince_generator import _lateral_profile
    # control_count == n_samples (one control point per station) makes every station an
    # independent draw with zero smoothing between neighbors - a sawtooth, not a wave. Halving
    # the control density should keep consecutive stations noticeably correlated.
    values = _lateral_profile(n_samples=12, amplitude=10.0, seed=3, key="road_left")
    diffs = [abs(values[i + 1] - values[i]) for i in range(len(values) - 1)]
    assert sum(diffs) / len(diffs) < 10.0


def test_partition_validation_rejects_overlap_and_gap():
    province = box(0, 0, 10, 10)
    poly_a = assign_stable_ids("p", [
        PolygonLabel(box(0, 0, 6, 10), "hinterland", "plains", "flat", False),
        PolygonLabel(box(4, 0, 10, 10), "hinterland", "forest", "flat", False),  # overlaps
    ])
    with pytest.raises(SubprovinceValidationError, match="overlap"):
        validate_subprovince_partition(province, poly_a, 1e-6, coverage_tolerance=1e-3)
    poly_b = assign_stable_ids("p", [
        PolygonLabel(box(0, 0, 5, 10), "hinterland", "plains", "flat", False),
    ])
    with pytest.raises(SubprovinceValidationError, match="incomplete"):
        validate_subprovince_partition(province, poly_b, 1e-6, coverage_tolerance=1e-3)


def test_sliver_merging_conserves_area():
    cells = [
        PolygonLabel(box(0, 0, 2, 2), "hinterland", "plains", "flat", False),
        PolygonLabel(box(2, 0, 3, 2), "hinterland", "plains", "flat", False),
    ]
    merged = merge_slivers(cells, min_area=3.0, tolerance=1e-6)
    assert len(merged) == 1
    assert merged[0].geometry.area == pytest.approx(6.0)


def test_sliver_does_not_merge_into_protected_cell():
    cells = [
        PolygonLabel(box(0, 0, 2, 2), "capital", "urban", "flat", True),
        PolygonLabel(box(2, 0, 2.2, 2), "hinterland", "plains", "flat", False),
    ]
    assert len(merge_slivers(cells, 1.0, 1e-6)) == 2


def test_road_sliver_prefers_urban_then_road_neighbor():
    # A small road sliver touching both a town and a hinterland cell should join the town.
    cells = [
        PolygonLabel(box(0, 0, 2, 2), "town", "urban", "flat", False),
        PolygonLabel(box(2, 0, 2.2, 2), "road", "plains", "flat", False),
        PolygonLabel(box(2.2, 0, 4, 2), "hinterland", "plains", "flat", False),
    ]
    merged = merge_slivers(cells, min_area=1.0, tolerance=1e-6)
    assert len(merged) == 2
    town = next(cell for cell in merged if cell.kind == "town")
    assert town.geometry.area == pytest.approx(4.4)

    # With no urban neighbor, a small road sliver joins an adjacent road cell instead.
    cells = [
        PolygonLabel(box(0, 0, 2, 2), "road", "plains", "flat", False),
        PolygonLabel(box(2, 0, 2.2, 2), "road", "plains", "flat", False),
        PolygonLabel(box(2.2, 0, 4, 2), "hinterland", "plains", "flat", False),
    ]
    merged = merge_slivers(cells, min_area=1.0, tolerance=1e-6)
    road_cells = [cell for cell in merged if cell.kind == "road"]
    assert len(road_cells) == 1
    assert road_cells[0].geometry.area == pytest.approx(4.4)

    # With neither an urban nor a road neighbor, the road sliver is left untouched.
    cells = [
        PolygonLabel(box(0, 0, 0.2, 2), "road", "plains", "flat", False),
        PolygonLabel(box(0.2, 0, 4, 2), "hinterland", "plains", "flat", False),
    ]
    merged = merge_slivers(cells, min_area=1.0, tolerance=1e-6)
    assert len(merged) == 2
    assert any(cell.kind == "road" and cell.geometry.area == pytest.approx(0.4) for cell in merged)


def test_unresolvable_sliver_does_not_block_other_slivers():
    # The first sliver (isolated, no neighbor at all) cannot merge; the second sliver has a
    # valid hinterland neighbor and must still be merged despite the first one's failure.
    cells = [
        PolygonLabel(box(-5, -5, -4.8, -4), "road", "plains", "flat", False),
        PolygonLabel(box(0, 0, 2, 2), "hinterland", "plains", "flat", False),
        PolygonLabel(box(2, 0, 2.2, 2), "hinterland", "plains", "flat", False),
    ]
    merged = merge_slivers(cells, min_area=1.0, tolerance=1e-6)
    assert len(merged) == 2
    assert any(cell.kind == "road" for cell in merged)
    hinterland = next(cell for cell in merged if cell.kind == "hinterland")
    assert hinterland.geometry.area == pytest.approx(4.4)


def test_road_min_area_is_independent_of_generic_min_area():
    # A road cell above the generic min_area but below road_min_area is still a sliver and
    # merges into its road neighbor; an equivalently-sized hinterland cell in the same list,
    # which only has to clear the smaller generic min_area, is left alone.
    cells = [
        PolygonLabel(box(0, 0, 1.2, 1), "road", "plains", "flat", False),
        PolygonLabel(box(1.2, 0, 3, 1), "road", "plains", "flat", False),
        PolygonLabel(box(3, 0, 4.2, 1), "hinterland", "plains", "flat", False),
        PolygonLabel(box(4.2, 0, 6, 1), "hinterland", "plains", "flat", False),
    ]
    merged = merge_slivers(cells, min_area=1.0, tolerance=1e-6, road_min_area=1.5)
    road_cells = [cell for cell in merged if cell.kind == "road"]
    hinterland_cells = [cell for cell in merged if cell.kind == "hinterland"]
    assert len(road_cells) == 1
    assert road_cells[0].geometry.area == pytest.approx(3.0)
    assert len(hinterland_cells) == 2


def test_hinterland_sliver_does_not_cross_cover_boundary():
    cells = [
        PolygonLabel(box(0, 0, 2, 2), "hinterland", "plains", "flat", False),
        PolygonLabel(box(2, 0, 2.2, 2), "hinterland", "forest", "flat", False),
        PolygonLabel(box(2.2, 0, 5, 2), "hinterland", "forest", "flat", False),
    ]
    merged = merge_slivers(cells, min_area=1.0, tolerance=1e-6)
    assert len(merged) == 2
    plains = next(cell for cell in merged if cell.cover_combat == "plains")
    forest = next(cell for cell in merged if cell.cover_combat == "forest")
    assert plains.geometry.area == pytest.approx(4.0)
    assert forest.geometry.area == pytest.approx(6.0)


def test_tiny_hinterland_merges_same_terrain_two_hops_away():
    from subprovince_generator import _resolve_tiny_hinterland
    # sliver (plains) | intermediate (forest) | target (plains) — sliver and target don't
    # touch directly, only through the intermediate, so a valid merge must absorb all three.
    cells = [
        PolygonLabel(box(0, 0, 1, 2), "hinterland", "plains", "flat", False),
        PolygonLabel(box(1, 0, 3, 2), "hinterland", "forest", "flat", False),
        PolygonLabel(box(3, 0, 7, 2), "hinterland", "plains", "flat", False),
    ]
    result = _resolve_tiny_hinterland(cells, config(), grid_cell_area=1.0)
    assert len(result) == 1
    assert result[0].cover_combat == "plains"
    assert result[0].geometry.area == pytest.approx(14.0)


def test_tiny_hinterland_absorbs_into_diff_terrain_with_no_nearby_match():
    from subprovince_generator import _resolve_tiny_hinterland
    cells = [
        PolygonLabel(box(0, 0, 1, 2), "hinterland", "plains", "flat", False),
        PolygonLabel(box(1, 0, 5, 2), "hinterland", "forest", "flat", False),
    ]
    result = _resolve_tiny_hinterland(cells, config(), grid_cell_area=1.0)
    assert len(result) == 1
    assert result[0].cover_combat == "forest"
    assert result[0].geometry.area == pytest.approx(10.0)


def test_tiny_hinterland_left_alone_with_no_candidates():
    from subprovince_generator import _resolve_tiny_hinterland
    cells = [
        PolygonLabel(box(0, 0, 1, 2), "hinterland", "plains", "flat", False),
        PolygonLabel(box(1, 0, 5, 2), "road", "plains", "flat", False),
    ]
    result = _resolve_tiny_hinterland(cells, config(), grid_cell_area=1.0)
    assert len(result) == 2
    sliver = next(cell for cell in result if cell.kind == "hinterland")
    assert sliver.geometry.area == pytest.approx(2.0)


def test_tiny_hinterland_settles_after_one_action_no_chain_snowball():
    from subprovince_generator import _resolve_tiny_hinterland
    # A chain of small plains segments joined by tiny forest bridges. Without settling each
    # cell after one resolution action, repeated 2-hop same-terrain merging would chain through
    # every bridge and collapse the whole thing into a single giant cell (total area 4.6, still
    # under the small threshold of 10, so nothing would stop the chain).
    cells = [
        PolygonLabel(box(0, 0, 1, 1), "hinterland", "plains", "flat", False),
        PolygonLabel(box(1, 0, 1.2, 1), "hinterland", "forest", "flat", False),
        PolygonLabel(box(1.2, 0, 2.2, 1), "hinterland", "plains", "flat", False),
        PolygonLabel(box(2.2, 0, 2.4, 1), "hinterland", "forest", "flat", False),
        PolygonLabel(box(2.4, 0, 3.4, 1), "hinterland", "plains", "flat", False),
        PolygonLabel(box(3.4, 0, 3.6, 1), "hinterland", "forest", "flat", False),
        PolygonLabel(box(3.6, 0, 4.6, 1), "hinterland", "plains", "flat", False),
    ]
    total_area = sum(cell.geometry.area for cell in cells)
    result = _resolve_tiny_hinterland(cells, config(), grid_cell_area=1.0)
    assert len(result) > 1
    assert sum(cell.geometry.area for cell in result) == pytest.approx(total_area)


def test_adjacency_excludes_corner_only_contact():
    cells = assign_stable_ids(
        "p",
        [
            PolygonLabel(box(0, 0, 1, 1), "hinterland", "plains", "flat", False),
            PolygonLabel(box(1, 1, 2, 2), "hinterland", "plains", "flat", False),
        ],
    )
    adjacency = build_subprovince_adjacency(cells, 1e-6)
    assert all(not neighbors for neighbors in adjacency.values())


def test_adjacency_matches_brute_force_and_ignores_order():
    raw = [
        PolygonLabel(box(0, 0, 1, 1), "hinterland", "plains", "flat", False),
        PolygonLabel(box(1, 0, 2, 1), "hinterland", "plains", "flat", False),
        PolygonLabel(box(0, 1, 1, 2), "hinterland", "plains", "flat", False),
        PolygonLabel(box(2, 0, 3, 0.2), "hinterland", "plains", "flat", False),
    ]
    cells = assign_stable_ids("p", raw)
    indexed = build_subprovince_adjacency(cells, 1e-6)
    reference = {}
    for left in cells:
        reference[left.subprovince_id] = sorted(
            right.subprovince_id for right in cells
            if right is not left
            and (left.geometry.boundary.intersection(right.geometry.boundary).length or 0) > 1e-6
        )
    assert {k: sorted(v) for k, v in indexed.items()} == reference
    reordered = build_subprovince_adjacency(list(reversed(cells)), 1e-6)
    assert {k: sorted(v) for k, v in reordered.items()} == {k: sorted(v) for k, v in indexed.items()}


def test_cross_province_adjacency_connects_touching_cells_of_adjacent_provinces():
    p1_cells = assign_stable_ids("p1", [
        PolygonLabel(box(0, 0, 1, 1), "hinterland", "plains", "flat", False),
    ])
    p2_cells = assign_stable_ids("p2", [
        PolygonLabel(box(1, 0, 2, 1), "hinterland", "plains", "flat", False),
    ])
    province_adjacency = [{"from_province": "p1", "to_province": "p2"}]
    cross = build_cross_province_adjacency(
        {"p1": p1_cells, "p2": p2_cells}, province_adjacency, 1e-6,
    )
    assert cross[p1_cells[0].subprovince_id] == [p2_cells[0].subprovince_id]
    assert cross[p2_cells[0].subprovince_id] == [p1_cells[0].subprovince_id]


def test_cross_province_adjacency_skips_touching_cells_with_no_province_adjacency_entry():
    p1_cells = assign_stable_ids("p1", [
        PolygonLabel(box(0, 0, 1, 1), "hinterland", "plains", "flat", False),
    ])
    p2_cells = assign_stable_ids("p2", [
        PolygonLabel(box(1, 0, 2, 1), "hinterland", "plains", "flat", False),
    ])
    # Geometry touches, but no province_adjacency entry links p1/p2 — must produce no edges.
    cross = build_cross_province_adjacency({"p1": p1_cells, "p2": p2_cells}, [], 1e-6)
    assert cross == {}


def test_cross_province_adjacency_excludes_same_province_edges():
    p1_cells = assign_stable_ids("p1", [
        PolygonLabel(box(0, 0, 1, 1), "hinterland", "plains", "flat", False),
        PolygonLabel(box(1, 0, 2, 1), "hinterland", "plains", "flat", False),
    ])
    p2_cells = assign_stable_ids("p2", [
        PolygonLabel(box(2, 0, 3, 1), "hinterland", "plains", "flat", False),
    ])
    province_adjacency = [{"from_province": "p1", "to_province": "p2"}]
    cross = build_cross_province_adjacency(
        {"p1": p1_cells, "p2": p2_cells}, province_adjacency, 1e-6,
    )
    # p1's own two touching cells must NOT appear here (that's intra-province adjacency,
    # already produced by build_subprovince_adjacency elsewhere) — only the p1/p2 boundary edge.
    p1_a, p1_b = p1_cells[0].subprovince_id, p1_cells[1].subprovince_id
    p2_only = p2_cells[0].subprovince_id
    assert p1_a not in cross or p1_b not in cross[p1_a]
    assert cross.get(p1_b) == [p2_only]
    assert cross.get(p2_only) == [p1_b]


def test_city_noise_is_deterministic():
    province = box(0, 0, 40, 40)
    terrain = terrain_for(bounds=(0, 0, 40, 40))
    args = lambda cfg: ("p", province, [TerrainPatch(province, "plains")], terrain, [], [], [],
                        Point(10, 10), [], cfg)
    one = generate_subprovinces(*args(config()))
    two = generate_subprovinces(*args(config()))
    assert [(x.subprovince_id, x.geometry.wkb) for x in one] == [(x.subprovince_id, x.geometry.wkb) for x in two]


def test_road_corridor_has_irregular_edges():
    from subprovince_generator import _noisy_road_corridor, _split_corridor
    spine = LineString([(0, 0), (100, 0)])
    corridor = _noisy_road_corridor(spine, 2.0, config())
    xs = sorted(set(round(x, 4) for x, y in corridor.exterior.coords))
    # A smooth strip would be two x buckets; irregular edges have several x stations.
    assert len(xs) >= 4
    ys = sorted(set(round(y, 4) for x, y in corridor.exterior.coords))
    assert len(ys) >= 2
    pieces = _split_corridor(corridor, spine, 8.0, config())
    assert len(pieces) >= 2
    assert sum(p.area for p in pieces) == pytest.approx(corridor.area, rel=1e-3)


def test_road_cells_are_deterministic_and_non_overlapping():
    from subprovince_generator import _noisy_road_corridor, _split_corridor
    cfg = config()
    spine = LineString([(0, 2), (80, 2)])
    one = _noisy_road_corridor(spine, 2.0, cfg)
    two = _noisy_road_corridor(spine, 2.0, cfg)
    assert one.wkb == two.wkb


def test_single_cell_town_gets_noisy_boundary():
    from subprovince_generator import _urban_compound, _build_urban_cells
    province = box(0, 0, 40, 40)
    terrain = terrain_for(bounds=(0, 0, 40, 40))
    urban = box(6, 6, 10, 9)  # small rectangle; area 12 < urban_target_area -> single town
    patches = [TerrainPatch(province, "plains"), TerrainPatch(urban, "urban")]
    result = generate_subprovinces("p", province, patches, terrain, [], [], [], None, [], config())
    towns = [cell for cell in result if cell.kind == "town"]
    assert len(towns) == 1
    coords = set(towns[0].geometry.exterior.coords[:-1])
    # Noised boundary has more than the 4 rectangle corners.
    assert len(coords) > 4