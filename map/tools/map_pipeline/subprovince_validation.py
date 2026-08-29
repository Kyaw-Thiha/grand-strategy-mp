"""Validation and shared-edge adjacency for generated subprovinces."""

from typing import Mapping, Sequence

from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.geometry import box
from shapely.geometry.base import BaseGeometry


class SubprovinceValidationError(ValueError):
    """Raised when generated subprovince geometry or metadata is invalid."""


def validate_subprovince_partition(province: BaseGeometry, polygons: Sequence,
                                   tolerance: float, coverage_tolerance: float | None = None) -> None:
    if province.is_empty or not province.is_valid or not polygons:
        raise SubprovinceValidationError("province and polygon list must be non-empty and valid")
    for polygon in polygons:
        if polygon.geometry.is_empty or not polygon.geometry.is_valid:
            raise SubprovinceValidationError("subprovince geometry is empty or invalid")
        if not province.covers(polygon.geometry) and not province.buffer(tolerance).covers(polygon.geometry):
            raise SubprovinceValidationError("subprovince lies outside province")
    union = unary_union([polygon.geometry for polygon in polygons])
    total_area = sum(polygon.geometry.area for polygon in polygons)
    if coverage_tolerance is None:
        coverage_tolerance = max(tolerance, province.area * 1e-9)
    overlap = total_area - union.area
    if overlap > coverage_tolerance:
        raise SubprovinceValidationError(f"subprovince overlap exceeds tolerance: {overlap}")
    gap = province.difference(union).area
    if gap > coverage_tolerance:
        raise SubprovinceValidationError(f"subprovince coverage is incomplete: {gap}")
    outside = union.difference(province).area
    if outside > coverage_tolerance:
        raise SubprovinceValidationError(f"subprovince coverage extends outside province: {outside}")


def validate_subprovince_metadata(polygons: Sequence) -> None:
    ids = [polygon.subprovince_id for polygon in polygons]
    if len(ids) != len(set(ids)):
        raise SubprovinceValidationError("subprovince IDs must be unique")
    if not polygons:
        raise SubprovinceValidationError("at least one subprovince is required")
    province_ids = {polygon.province_id for polygon in polygons}
    if len(province_ids) != 1:
        raise SubprovinceValidationError("all subprovinces must belong to one province")
    valid_kinds = {"road", "hinterland", "town", "capital"}
    if any(polygon.kind not in valid_kinds for polygon in polygons):
        raise SubprovinceValidationError("unknown subprovince kind")
    if any(polygon.is_capital != (polygon.kind == "capital") for polygon in polygons):
        raise SubprovinceValidationError("capital metadata is inconsistent")
    if any(polygon.kind in {"road", "hinterland"} and not polygon.cover_combat for polygon in polygons):
        raise SubprovinceValidationError("terrain subprovinces require cover metadata")


def build_subprovince_adjacency(polygons: Sequence, tolerance: float) -> dict[str, list[str]]:
    """Build shared-edge adjacency using a spatial index for candidate pairs."""
    polygon_list = list(polygons)
    adjacency = {polygon.subprovince_id: set() for polygon in polygon_list}
    index = STRtree([polygon.geometry for polygon in polygon_list])
    for left in polygon_list:
        left_id = left.subprovince_id
        bbox = left.geometry.buffer(tolerance).bounds
        for right_index in index.query(box(*left.geometry.buffer(tolerance).bounds)):
            right = polygon_list[int(right_index)]
            right_id = right.subprovince_id
            if right_id == left_id or right_id in adjacency[left_id]:
                continue
            shared = left.geometry.boundary.intersection(right.geometry.boundary)
            if shared is not None and shared.length > tolerance:
                adjacency[left_id].add(right_id)
                adjacency[right_id].add(left_id)
    return {identifier: sorted(neighbors) for identifier, neighbors in adjacency.items()}


def build_cross_province_adjacency(
    polygons_by_province: Mapping[str, Sequence],
    province_adjacency: Sequence[Mapping[str, str]],
    tolerance: float,
) -> dict[str, list[str]]:
    """
    Connects subprovince cells across a province boundary wherever the two provinces are
    already linked in the province-level adjacency graph and their generated cells share a
    real geometric boundary. Reuses build_subprovince_adjacency's exact shared-edge test (it
    doesn't inspect province_id itself, so calling it on the concatenation of two provinces'
    cells is sufficient) and discards same-province edges from the result, since those are
    already covered by each province's own intra-province adjacency.

    border_type/passable_by are deliberately not consulted: the pipeline currently has no
    non-land border_type and passable_by is always the full unit list, so gating on either
    would be a no-op today.
    """
    cross_edges: dict[str, set[str]] = {}
    for edge in province_adjacency:
        from_province = edge["from_province"]
        to_province = edge["to_province"]
        from_cells = polygons_by_province.get(from_province)
        to_cells = polygons_by_province.get(to_province)
        if not from_cells or not to_cells:
            continue  # one or both provinces failed generation or weren't selected this run

        from_ids = {polygon.subprovince_id for polygon in from_cells}
        to_ids = {polygon.subprovince_id for polygon in to_cells}
        combined_adjacency = build_subprovince_adjacency([*from_cells, *to_cells], tolerance)
        for left_id, neighbor_ids in combined_adjacency.items():
            if left_id not in from_ids:
                continue
            for right_id in neighbor_ids:
                if right_id not in to_ids:
                    continue
                cross_edges.setdefault(left_id, set()).add(right_id)
                cross_edges.setdefault(right_id, set()).add(left_id)

    return {identifier: sorted(neighbors) for identifier, neighbors in cross_edges.items()}


def validate_subprovince_adjacency(polygons: Sequence, adjacency: Mapping[str, Sequence[str]]) -> None:
    identifiers = {polygon.subprovince_id for polygon in polygons}
    if set(adjacency) != identifiers:
        raise SubprovinceValidationError("adjacency keys must match polygon IDs")
    for identifier, neighbors in adjacency.items():
        if identifier in neighbors or len(neighbors) != len(set(neighbors)):
            raise SubprovinceValidationError("adjacency contains self-links or duplicates")
        if any(neighbor not in identifiers for neighbor in neighbors):
            raise SubprovinceValidationError("adjacency references an unknown polygon")
        for neighbor in neighbors:
            left = next(polygon for polygon in polygons if polygon.subprovince_id == identifier)
            right = next(polygon for polygon in polygons if polygon.subprovince_id == neighbor)
            shared = left.geometry.boundary.intersection(right.geometry.boundary)
            if shared is None or shared.length <= 0:
                raise SubprovinceValidationError("adjacency contains corner-only contact")
            if identifier not in adjacency.get(neighbor, ()):
                raise SubprovinceValidationError("adjacency must be symmetric")
