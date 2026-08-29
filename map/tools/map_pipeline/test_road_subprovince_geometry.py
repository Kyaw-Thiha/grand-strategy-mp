from shapely.geometry import LineString, box, mapping

from road_subprovince_geometry import build_road_subprovince_geometry, serialize_road_subprovince_geometry


def _road_feature(line: LineString) -> dict:
    return {"type": "Feature", "geometry": mapping(line), "properties": {}}


def test_clips_road_line_to_cell_polygon():
    road = LineString([(0, 5), (20, 5)])
    cell = {"subprovince_id": "cell_a", "geometry": box(4, 0, 10, 10)}

    result = build_road_subprovince_geometry([cell], [_road_feature(road)], tolerance=1e-8)

    assert "cell_a" in result
    clipped = result["cell_a"]
    assert clipped.geom_type == "LineString"
    # Clipped to the cell's x-range [4, 10] along y=5.
    assert clipped.length == 6.0


def test_cell_with_no_intersecting_road_is_omitted():
    road = LineString([(0, 5), (20, 5)])
    cell = {"subprovince_id": "cell_far", "geometry": box(100, 100, 110, 110)}

    result = build_road_subprovince_geometry([cell], [_road_feature(road)], tolerance=1e-8)

    assert "cell_far" not in result


def test_picks_longest_component_when_road_touches_cell_twice():
    # A zig-zag road that clips the cell into two disjoint pieces — the longer must win.
    road = LineString([(0, 1), (4, 1), (4, 9), (6, 9), (6, 1), (10, 1)])
    cell = {"subprovince_id": "cell_b", "geometry": box(0, 0, 10, 2)}

    result = build_road_subprovince_geometry([cell], [_road_feature(road)], tolerance=1e-8)

    assert "cell_b" in result
    assert result["cell_b"].geom_type == "LineString"


def test_serialize_writes_expected_feature_collection(tmp_path):
    geometry_by_id = {"cell_a": LineString([(0, 0), (1, 1)])}
    output_path = tmp_path / "road_subprovince_geometry.geojson"

    serialize_road_subprovince_geometry(output_path, geometry_by_id)

    import json
    data = json.loads(output_path.read_text())
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) == 1
    assert data["features"][0]["properties"]["subprovince_id"] == "cell_a"
    assert data["features"][0]["geometry"]["type"] == "LineString"
