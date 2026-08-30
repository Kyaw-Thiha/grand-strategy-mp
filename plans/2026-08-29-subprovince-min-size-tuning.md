# Subprovince Minimum-Size Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the effective minimum size of road subprovince segments (so fragments truncated
near province borders/junctions/turns get absorbed into a neighbor instead of surviving as
undersized slivers) and raise the minimum size of hinterland subprovinces (so more undersized
cells get merged into surrounding terrain), by tuning two existing constants — no new algorithms.

**Architecture:** Both behaviors already exist in
`map/tools/map_pipeline/subprovince_generator.py`: `merge_slivers()` (called at the end of
`generate_subprovinces()`) absorbs any road cell under `config.road_min_area` into an adjacent
road/urban cell, and `_resolve_tiny_hinterland()` absorbs any hinterland cell under
`config.hinterland_tiny_grid_cells * grid_cell_area` into a same-terrain (preferred) or
different-terrain hinterland neighbor. Both thresholds are currently tuned far below what a
"normal" cell looks like, so genuinely undersized fragments slip through. This plan only raises
`default_config()`'s two constants and backs the change with tests that pin the new values and
demonstrate the merge behavior actually changes at realistic scale. The per-test-file `config()`
fixture in `test_subprovince_generator.py` uses its own hand-picked values independent of
`default_config()`, so existing unit tests are unaffected; the real-fixture suite is re-run
end-to-end on real map data to confirm the raised thresholds don't break partition topology
there (its optional baseline-hash test is git-ignored local scratch and skips itself, see
Task 4).

**Tech Stack:** Python, shapely, pytest.

## Global Constraints

- Verification command for this plan: `cd map/tools/map_pipeline && python -m pytest -q` (per
  AGENTS.md's Godot/game-server commands not applying here; this is the map pipeline's own test
  suite, run directly with pytest).
- Do not touch `_split_corridor`, `_noisy_road_corridor`, `_voronoi_hinterland_region`, or any
  other placement/segmentation algorithm — this plan is constant tuning plus test coverage only.
- Do not modify the per-test `config()` fixture in `test_subprovince_generator.py`
  (`map/tools/map_pipeline/test_subprovince_generator.py:31-49`) — its values are intentionally
  independent of `default_config()`.

---

### Task 1: Raise `road_min_area` and pin both new defaults with a test

**Files:**
- Modify: `map/tools/map_pipeline/subprovince_generator.py:100-119` (`default_config()`)
- Modify: `map/tools/map_pipeline/test_subprovince_generator.py:11-19` (import block)
- Test: `map/tools/map_pipeline/test_subprovince_generator.py` (new test near the top, after the
  `terrain_for` helper around line 60)

**Interfaces:**
- Consumes: `SubprovinceConfig` dataclass fields already defined at
  `subprovince_generator.py:45-63` (no field changes, only default values).
- Produces: `default_config().road_min_area == 4e8` and
  `default_config().hinterland_tiny_grid_cells == 30.0`, consumed by every caller of
  `default_config()` (`subprovince_io.py:325`, `test_subprovince_real_fixture.py`).

- [ ] **Step 1: Write the failing test**

Add to `test_subprovince_generator.py`, importing `default_config` alongside the existing
`subprovince_generator` imports (`test_subprovince_generator.py:11-19`):

```python
from subprovince_generator import (
    PolygonLabel,
    RoadInput,
    SubprovinceConfig,
    TerrainPatch,
    TerrainRaster,
    assign_stable_ids,
    default_config,
    generate_subprovinces,
    merge_slivers,
)
```

Then add the test:

```python
def test_default_config_raises_road_and_hinterland_minimums():
    # road_min_area is set relative to a nominal full segment's area (road_width *
    # road_segment_length = 10_000 * 80_000 = 8e8), high enough to catch segments truncated
    # near province borders/junctions/turns but well below the ~6e8 floor a normally-jittered
    # full segment can shrink to (road_segment_length jitters +/-12%), so untruncated segments
    # are never affected.
    cfg = default_config()
    assert cfg.road_width == 10_000.0
    assert cfg.road_segment_length == 80_000.0
    assert cfg.road_min_area == pytest.approx(4e8)
    # hinterland_tiny_grid_cells tripled from 10.0 to 30.0 so more undersized hinterland cells
    # get absorbed into surrounding terrain via the existing _resolve_tiny_hinterland merge.
    assert cfg.hinterland_tiny_grid_cells == pytest.approx(30.0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd map/tools/map_pipeline && python -m pytest test_subprovince_generator.py::test_default_config_raises_road_and_hinterland_minimums -v`
Expected: FAIL — `assert 30000000.0 == 4e8` (or similar, comparing current `road_min_area=30e6`
against the new expected `4e8`).

- [ ] **Step 3: Raise the two constants in `default_config()`**

In `subprovince_generator.py`, replace the `default_config()` body (currently
lines 100-119):

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd map/tools/map_pipeline && python -m pytest test_subprovince_generator.py::test_default_config_raises_road_and_hinterland_minimums -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add map/tools/map_pipeline/subprovince_generator.py map/tools/map_pipeline/test_subprovince_generator.py
git commit -m "tune: raise default road_min_area and hinterland_tiny_grid_cells"
```

---

### Task 2: Regression test — road fragments truncated near a border now merge

**Files:**
- Test: `map/tools/map_pipeline/test_subprovince_generator.py` (new test, place after
  `test_road_min_area_is_independent_of_generic_min_area`, currently ending at line 348)

**Interfaces:**
- Consumes: `merge_slivers(cells, min_area, tolerance, road_min_area=None)` from
  `subprovince_generator.py:911-975` (signature unchanged); `PolygonLabel(geometry, kind,
  cover_combat, elevation_type, is_capital)`.
- Produces: nothing new — this is a pure regression test demonstrating Task 1's constant change
  has the intended real-scale effect.

- [ ] **Step 1: Write the test**

```python
def test_default_road_min_area_absorbs_border_truncated_fragment():
    # A road cell sized like a segment truncated to ~45% of a nominal full segment (as can
    # happen when `_split_corridor`'s difference against a province border, or an adjacent
    # road's carve-out at a junction, clips a segment down) must be absorbed into its road
    # neighbor under the new default `road_min_area`, where it would have survived under the
    # old default of 30e6.
    truncated_area_side = 19_000.0  # ~3.6e8 sq units: below new 4e8 floor, above old 30e6 floor
    cells = [
        PolygonLabel(box(0, 0, truncated_area_side, 19_000.0), "road", "plains", "flat", False),
        PolygonLabel(box(truncated_area_side, 0, truncated_area_side + 80_000.0, 19_000.0),
                     "road", "plains", "flat", False),
    ]
    old_default_merged = merge_slivers(cells, min_area=10e6, tolerance=1.0, road_min_area=30e6)
    assert len(old_default_merged) == 2  # survives under the old, too-permissive floor

    new_default_merged = merge_slivers(cells, min_area=10e6, tolerance=1.0, road_min_area=4e8)
    assert len(new_default_merged) == 1
    assert new_default_merged[0].kind == "road"
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd map/tools/map_pipeline && python -m pytest test_subprovince_generator.py::test_default_road_min_area_absorbs_border_truncated_fragment -v`
Expected: PASS (both assertions — this test is not TDD-red-first since it exercises `merge_slivers`
directly with explicit `road_min_area` values on both sides of the change, not the new default
itself; if it fails, recompute `truncated_area_side` so `truncated_area_side * 19_000.0` sits
strictly between 30e6 and 4e8).

- [ ] **Step 3: Commit**

```bash
git add map/tools/map_pipeline/test_subprovince_generator.py
git commit -m "test: cover road_min_area border-truncated fragment absorption"
```

---

### Task 3: Regression test — undersized hinterland cells now merge into surrounding terrain

**Files:**
- Test: `map/tools/map_pipeline/test_subprovince_generator.py` (new test, place after
  `test_tiny_hinterland_absorbs_into_diff_terrain_with_no_nearby_match`, currently ending at
  line 389)

**Interfaces:**
- Consumes: `_resolve_tiny_hinterland(cells, config, grid_cell_area)` from
  `subprovince_generator.py:1054-1118` (signature unchanged).
- Produces: nothing new — regression test for Task 1's `hinterland_tiny_grid_cells` change.

- [ ] **Step 1: Write the test**

```python
def test_raised_hinterland_tiny_threshold_absorbs_previously_kept_cell():
    from subprovince_generator import _resolve_tiny_hinterland
    # A 20-unit-area hinterland cell with grid_cell_area=1.0 sits between the old threshold
    # (10.0) and the new default (30.0): the old threshold left it alone, the new one merges it
    # into the adjacent same-terrain cell.
    cells = [
        PolygonLabel(box(0, 0, 4, 5), "hinterland", "plains", "flat", False),
        PolygonLabel(box(4, 0, 14, 5), "hinterland", "plains", "flat", False),
    ]
    old_threshold_cfg = config().__class__(**{**config().__dict__, "hinterland_tiny_grid_cells": 10.0})
    old_result = _resolve_tiny_hinterland(cells, old_threshold_cfg, grid_cell_area=1.0)
    assert len(old_result) == 2  # 20 < 10*1.0 is false, so left alone under the old threshold

    new_threshold_cfg = config().__class__(**{**config().__dict__, "hinterland_tiny_grid_cells": 30.0})
    new_result = _resolve_tiny_hinterland(cells, new_threshold_cfg, grid_cell_area=1.0)
    assert len(new_result) == 1
    assert new_result[0].cover_combat == "plains"
    assert new_result[0].geometry.area == pytest.approx(70.0)
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd map/tools/map_pipeline && python -m pytest test_subprovince_generator.py::test_raised_hinterland_tiny_threshold_absorbs_previously_kept_cell -v`
Expected: PASS. (First assertion sanity-checks the *old* threshold's behavior is unchanged —
20 sq units is not less than `10.0 * 1.0`, so nothing merges. The second exercises the new
default value of 30.0.)

- [ ] **Step 3: Commit**

```bash
git add map/tools/map_pipeline/test_subprovince_generator.py
git commit -m "test: cover hinterland_tiny_grid_cells raised-threshold absorption"
```

---

### Task 4: Verify the real-fixture suite against the raised constants

`map/tools/map_pipeline/diagnostics/` is git-ignored local scratch (`map/.gitignore:7`), not a
tracked fixture — any `we6_baseline.json` you find there in a working checkout was generated
locally by a prior run and is not part of this branch. `test_real_province_output_matches_baseline_artifact`
(`test_subprovince_real_fixture.py`) skips itself when that file is absent, which is the normal
state for a fresh checkout/worktree, so there is nothing to regenerate or commit here — this task
is verification only, on the province-scale tests that *do* run unconditionally.

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: `generate_real_province(province, sources, config)` and `default_config()`, exercised
  by `test_subprovince_real_fixture.py`'s `test_serialized_round_trip_is_clean` and
  `test_real_province_is_deterministic_under_reordered_sources` — no signature changes.

- [ ] **Step 1: Run the real-fixture suite**

Run: `cd map/tools/map_pipeline && python -m pytest test_subprovince_real_fixture.py -v`
Expected: all tests pass except `test_real_province_output_matches_baseline_artifact`, which is
SKIPPED (no local `diagnostics/we6_baseline.json` present — expected, see above). In particular
`test_serialized_round_trip_is_clean` must pass: it runs `generate_real_province` end-to-end on
the real `we6_germany_01` province under the Task 1 constants and asserts the output is a clean,
gap-free, overlap-free partition (`total - union.area < 1e-8`) with unique subprovince IDs — this
is the real check that raising `road_min_area`/`hinterland_tiny_grid_cells` didn't break topology
on real map data, not the (skipped, purely informational) hash-pinning test.

- [ ] **Step 2: If Step 1 fails, diagnose before touching the constants again**

A validation error here (overlap, gap, or an exception from `merge_slivers`/
`_resolve_tiny_hinterland`) on real data that the synthetic unit tests didn't catch means the new
threshold values interact badly with real geometry at a scale the synthetic box-based tests don't
exercise. Do not silently lower the constants back — report the specific failure (province,
assertion, traceback) so the values can be reconsidered deliberately.

---

### Task 5: Full pipeline verification

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: the full `map/tools/map_pipeline` pytest suite.
- Produces: a final pass/fail signal for the whole plan.

- [ ] **Step 1: Run the full map pipeline test suite**

Run: `cd map/tools/map_pipeline && python -m pytest -q`
Expected: all tests pass (one skip is expected — see Task 4), including every test added in
Tasks 1-3.

- [ ] **Step 2: If anything else references the old constant values, fix it**

Run: `cd map/tools/map_pipeline && grep -rn "30e6\|hinterland_tiny_grid_cells=10" --include='*.py' .`
Expected: no remaining matches outside of `test_subprovince_generator.py`'s local `config()`
fixture (which intentionally keeps its own independent small values — leave it as-is per the
Global Constraints).

- [ ] **Step 3: Commit if Step 2 required any fix**

Only if Step 2 found something to change:

```bash
git add -A
git commit -m "fix: update remaining references to old subprovince minimum defaults"
```
