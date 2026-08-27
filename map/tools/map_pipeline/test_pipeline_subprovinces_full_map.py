"""Full-map subprovince generation: orchestration, retry, manifest, and CLI policy.

These tests drive pipeline.run_* orchestration with a monkeypatched
generate_real_province so no real geometry work is needed — the unit under test is the
loop/skip-and-log/merge/retry/manifest behavior, not generation itself (covered by
test_subprovince_generator.py / test_subprovince_real_fixture.py).
"""

import json
import sys
from argparse import Namespace
from pathlib import Path

import pytest
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).parent))

import pipeline as pipeline_module
from subprovince_generator import SubprovincePolygon


def fake_gen(province_to_cells, broken=set()):
    """Return a generate_real_province stand-in producing one cell per requested province."""
    def generate(province_feature, sources, config):
        province_id = province_feature["properties"]["province_id"]
        if province_id in broken:
            raise ValueError(f"broken province: {province_id}")
        count = province_to_cells.get(province_id, 1)
        polygons = [SubprovincePolygon(
            f"{province_id}_sp_{i}", province_id, box(0, 0, 1, 1),
            "hinterland", "plains", "flat", False,
        ) for i in range(count)]
        adjacency = {p.subprovince_id: [] for p in polygons}
        return polygons, adjacency
    return generate


def make_sources(province_ids):
    return {"provinces": [
        {"type": "Feature", "geometry": None, "properties": {"province_id": pid}}
        for pid in province_ids
    ]}


def test_all_valid_provinces_merge_into_one_file(tmp_path):
    ids = ["p_a", "p_b", "p_c"]
    pipeline_module.generate_real_province = fake_gen({"p_a": 2, "p_b": 1, "p_c": 3})
    polygons, adjacency, succeeded, failed = pipeline_module.run_full_map_subprovince_generation(
        make_sources(ids), None, tmp_path)
    assert sorted(succeeded) == sorted(ids)
    assert failed == []
    assert {p.province_id for p in polygons} == set(ids)
    assert len(polygons) == 6
    # Merged adjacency covers every cell.
    assert set(adjacency) == {p.subprovince_id for p in polygons}

    # Write + manifest round-trip mirrors the merged output.
    pipeline_module.publish_subprovince_outputs(tmp_path, polygons, adjacency)
    pipeline_module.write_subprovince_manifest(tmp_path, succeeded, failed)
    report = json.loads((tmp_path / "subprovince_generation_report.json").read_text())
    assert set(report["succeeded"]) == set(ids)
    assert report["failed"] == []


def test_broken_province_is_skipped_logged_without_blocking_others(tmp_path, capsys):
    pipeline_module.generate_real_province = fake_gen(
        {"p_a": 1, "p_b": 1, "p_bad": 1, "p_c": 1}, broken={"p_bad"})
    polygons, _, succeeded, failed = pipeline_module.run_full_map_subprovince_generation(
        make_sources(["p_a", "p_b", "p_bad", "p_c"]), None, tmp_path)
    assert sorted(succeeded) == ["p_a", "p_b", "p_c"]
    assert failed == [{"province_id": "p_bad", "error": "broken province: p_bad"}]
    assert {p.province_id for p in polygons} == {"p_a", "p_b", "p_c"}
    captured = capsys.readouterr()
    assert "FAIL p_bad" in captured.err
    assert "ok p_c" in captured.out


def test_retry_regenerates_only_failures_and_merges(tmp_path):
    pipeline_module.generate_real_province = fake_gen(
        {"p_a": 2, "p_b": 1, "p_bad": 5}, broken={"p_bad"})
    polygons, adjacency, succeeded, failed = pipeline_module.run_full_map_subprovince_generation(
        make_sources(["p_a", "p_b", "p_bad"]), None, tmp_path)
    pipeline_module.publish_subprovince_outputs(tmp_path, polygons, adjacency)
    pipeline_module.write_subprovince_manifest(tmp_path, succeeded, failed)
    assert failed == [{"province_id": "p_bad", "error": "broken province: p_bad"}]
    original = json.loads((tmp_path / "subprovinces.geojson").read_text())
    original_ids = {f["properties"]["subprovince_id"] for f in original["features"]}

    # Fix the broken province, then retry.
    pipeline_module.generate_real_province = fake_gen(
        {"p_a": 2, "p_b": 1, "p_bad": 5}, broken=set())
    merged_polygons, merged_adjacency, succeeded2, failed2 = pipeline_module.run_subprovince_retry(
        make_sources(["p_a", "p_b", "p_bad"]), None, tmp_path)
    assert failed2 == []
    assert sorted(succeeded2) == ["p_a", "p_b", "p_bad"]
    # Untouched provinces' cells are still present, and the retried province replaced its old set.
    assert {p.province_id for p in merged_polygons} == {"p_a", "p_b", "p_bad"}
    assert {p.subprovince_id for p in merged_polygons} == (original_ids | {"p_bad_sp_0", "p_bad_sp_1", "p_bad_sp_2", "p_bad_sp_3", "p_bad_sp_4"})
    merged_ids = {p.subprovince_id for p in merged_polygons}
    assert set(merged_adjacency) == merged_ids


def test_retry_with_zero_failures_is_noop(tmp_path, monkeypatch):
    pipeline_module.generate_real_province = fake_gen({"p_a": 2})
    polygons, adjacency, succeeded, failed = pipeline_module.run_full_map_subprovince_generation(
        make_sources(["p_a"]), None, tmp_path)
    pipeline_module.publish_subprovince_outputs(tmp_path, polygons, adjacency)
    pipeline_module.write_subprovince_manifest(tmp_path, succeeded, failed)
    before = (tmp_path / "subprovinces.geojson").read_bytes()

    pipeline_module.generate_real_province = fake_gen({}, broken=set())
    merged, merged_adj, succeeded2, failed2 = pipeline_module.run_subprovince_retry(
        make_sources(["p_a"]), None, tmp_path)
    assert failed2 == [] and succeeded2 == ["p_a"]
    assert len(merged) == 2
    # republish produces identical bytes (deterministic no-op path).
    pipeline_module.publish_subprovince_outputs(tmp_path, merged, merged_adj)
    assert (tmp_path / "subprovinces.geojson").read_bytes() == before


def test_retry_without_manifest_fails_clearly(tmp_path):
    with pytest.raises(FileNotFoundError, match="subprovince_generation_report"):
        pipeline_module.run_subprovince_retry(make_sources(["p_a"]), None, tmp_path)


def test_full_map_and_single_province_flags_are_mutually_exclusive(tmp_path, monkeypatch, capsys):
    _patch_main_environment(tmp_path, monkeypatch, Namespace(
        map="m1", skip_dem=False, resource_preset=None,
        subprovince_province="p_a", subprovince_all_provinces=True,
        subprovince_retry_failed=False, subprovince_only=False))
    with pytest.raises(SystemExit) as exc:
        pipeline_module.main()
    assert exc.value.code == 1
    assert "mutually exclusive" in capsys.readouterr().err


def test_exit_nonzero_when_manifest_has_failures(tmp_path, monkeypatch, capsys):
    _patch_main_environment(tmp_path, monkeypatch, Namespace(
        map="m1", skip_dem=False, resource_preset=None,
        subprovince_province=None, subprovince_all_provinces=True,
        subprovince_retry_failed=False, subprovince_only=False))
    pipeline_module.generate_real_province = fake_gen(
        {"p_a": 1, "p_b": 1}, broken={"p_b"})
    pipeline_module.validate_all = lambda map_dir: make_sources(["p_a", "p_b"])
    with pytest.raises(SystemExit) as exc:
        pipeline_module.main()
    assert exc.value.code == 1
    report = json.loads((tmp_path / "client" / "assets" / "data" / "tmap" / "subprovince_generation_report.json").read_text())
    assert report["failed"] == [{"province_id": "p_b", "error": "broken province: p_b"}]


def test_two_full_runs_are_canonical_equivalent(tmp_path):
    pipeline_module.generate_real_province = fake_gen({"p_a": 2, "p_b": 1})
    outputs = []
    for i in range(2):
        run_dir = tmp_path / f"run{i}"
        polygons, adjacency, _, failed = pipeline_module.run_full_map_subprovince_generation(
            make_sources(["p_a", "p_b"]), None, run_dir)
        assert failed == []
        pipeline_module.publish_subprovince_outputs(run_dir, polygons, adjacency)
        outputs.append(run_dir / "subprovinces.geojson")
    assert outputs[0].read_bytes() == outputs[1].read_bytes()


def _patch_main_environment(tmp_path, monkeypatch, args):
    """Give main() a fake repo root + map dir it can resolve, and stub argv-derived inputs."""
    monkeypatch.setattr(pipeline_module, "REPO_ROOT", tmp_path)
    map_dir = tmp_path / "map" / args.map
    map_dir.mkdir(parents=True)
    (map_dir / "map.json").write_text(json.dumps({
        "map_id": "tmap", "bounds": [-1, 49, 1, 51], "dem_source": "none",
    }))
    monkeypatch.setattr(pipeline_module, "parse_args", lambda: args)
    monkeypatch.setattr(pipeline_module, "validate_all",
                        lambda map_dir: make_sources(["p_a", "p_b"]))
    monkeypatch.setattr(pipeline_module, "generate_real_province",
                        fake_gen({"p_a": 1, "p_b": 1}, broken=set()))