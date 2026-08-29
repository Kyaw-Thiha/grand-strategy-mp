"""Clips real road centerlines to their corresponding road-kind subprovince cells.

Road-kind subprovince cells are generated as buffers around chunks of the map's real road
`LineString`s (see `subprovince_generator.py`'s `road_width`/`road_segment_length` config), so a
cell's intersection with its source road line is well-defined and geometrically exact. This module
recovers that exact sub-segment per cell so the client can draw supply lines that literally follow
the road, instead of a straight line through the cell's centroid.

Deliberately independent of `SubprovincePolygon`/`RoadInput`: this operates purely on already-
published GeoJSON (subprovince cells + road lines), so it can run standalone against shipped data,
or as a normal step inside the pipeline's `main()`.
"""

import json
from pathlib import Path
from typing import Mapping, Sequence

from shapely.geometry import shape, mapping
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree


def _longest_line_component(geometry: BaseGeometry) -> BaseGeometry | None:
    """Reduces a LineString/MultiLineString/GeometryCollection intersection result to a single
    LineString: the longest component when there are several (e.g. a cell that brushes the road
    at more than one place). Returns None for an empty or non-line result."""
    if geometry.is_empty:
        return None
    if geometry.geom_type == "LineString":
        return geometry
    if geometry.geom_type in ("MultiLineString", "GeometryCollection"):
        candidates = [g for g in getattr(geometry, "geoms", []) if g.geom_type == "LineString" and not g.is_empty]
        if not candidates:
            return None
        return max(candidates, key=lambda g: g.length)
    return None


def build_road_subprovince_geometry(
    road_cells: Sequence[dict],
    road_features: Sequence[dict],
    tolerance: float,
) -> dict[str, BaseGeometry]:
    """
    road_cells: dicts with at least {"subprovince_id": str, "geometry": shapely geometry} for
    kind == "road" cells only (callers filter before calling).
    road_features: raw GeoJSON road features (dicts with "geometry"), e.g. roads.json's
    "features" list.
    tolerance: minimum clipped-length to accept — mirrors build_subprovince_adjacency's tolerance
    convention (discards corner-touch/near-zero-length artifacts from float precision).

    Returns a mapping of subprovince_id -> clipped LineString for every road cell where a
    real, non-degenerate intersection with some road line was found. Cells with no match
    (e.g. buffered past the tolerance from any road, or a data mismatch) are simply omitted —
    callers/consumers must treat this as a best-effort map, not a complete one.
    """
    road_geoms = [shape(f["geometry"]) for f in road_features if f.get("geometry")]
    if not road_geoms:
        return {}
    index = STRtree(road_geoms)

    result: dict[str, BaseGeometry] = {}
    for cell in road_cells:
        cell_id = cell["subprovince_id"]
        cell_geometry = cell["geometry"]
        best: BaseGeometry | None = None
        for candidate_index in index.query(cell_geometry):
            road_geometry = road_geoms[int(candidate_index)]
            clipped = _longest_line_component(road_geometry.intersection(cell_geometry))
            if clipped is None or clipped.length <= tolerance:
                continue
            if best is None or clipped.length > best.length:
                best = clipped
        if best is not None:
            result[cell_id] = best
    return result


def serialize_road_subprovince_geometry(output_path: Path, geometry_by_id: Mapping[str, BaseGeometry]) -> None:
    features = [{"type": "Feature", "geometry": mapping(geometry), "properties": {
        "subprovince_id": identifier,
    }} for identifier, geometry in sorted(geometry_by_id.items())]
    output_path.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                      ensure_ascii=False, separators=(",", ":")) + "\n")
