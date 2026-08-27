"""Adapters between validated WGS84 map sources and the Batch 1 generator."""

from __future__ import annotations

from dataclasses import replace
import json
import tempfile
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np
from pyproj import Transformer
from rasterio.crs import CRS
from rasterio.features import rasterize
from shapely.geometry import Point, shape, mapping
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform, unary_union
from shapely.validation import make_valid
from shapely.validation import make_valid

from subprovince_generator import (
    ELEVATION_MOVE, COVER_MOVE, RoadInput, SubprovinceConfig,
    SubprovincePolygon, TerrainPatch, TerrainRaster, generate_subprovinces,
)
from subprovince_raster import build_working_grid
from subprovince_validation import (
    build_subprovince_adjacency, validate_subprovince_adjacency,
    validate_subprovince_metadata, validate_subprovince_partition,
)

WGS84 = CRS.from_epsg(4326)


def _source_geometry(feature: dict) -> BaseGeometry:
    geometry = feature.get("geometry")
    if not geometry:
        raise ValueError("source feature is missing geometry")
    result = shape(geometry)
    if result.is_empty:
        raise ValueError("source feature geometry is empty")
    return make_valid(result) if not result.is_valid else result


def _projector(source: CRS, target: CRS):
    transformer = Transformer.from_crs(source, target, always_xy=True)
    return transformer.transform


def _project(geometry: BaseGeometry, target: CRS) -> BaseGeometry:
    projected = transform(_projector(WGS84, target), geometry)
    return make_valid(projected) if not projected.is_valid else projected


def _polygon_parts(geometry: BaseGeometry) -> list[BaseGeometry]:
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type == "MultiPolygon":
        return list(geometry.geoms)
    if geometry.geom_type == "GeometryCollection":
        return [part for part in geometry.geoms if part.geom_type in {"Polygon", "MultiPolygon"}]
    return []


class _ProjectionCache:
    """Memoize projected source geometry per feature to avoid repeated transforms."""

    def __init__(self, working_crs: CRS) -> None:
        self._working_crs = working_crs
        self._cache: dict[int, BaseGeometry] = {}

    def project(self, feature: dict) -> BaseGeometry:
        key = id(feature)
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        projected = _project(_source_geometry(feature), self._working_crs)
        self._cache[key] = projected
        return projected


def choose_working_crs(province_geometry: BaseGeometry) -> CRS:
    """Choose the deterministic UTM metric CRS containing the province centroid."""
    if province_geometry.is_empty or not province_geometry.is_valid:
        raise ValueError("province geometry must be valid and non-empty")
    if province_geometry.geom_type not in {"Polygon", "MultiPolygon"}:
        raise ValueError("province geometry must be Polygon or MultiPolygon")
    centroid = province_geometry.centroid
    zone = min(60, max(1, int((centroid.x + 180) // 6) + 1))
    epsg = (32600 if centroid.y >= 0 else 32700) + zone
    return CRS.from_epsg(epsg)


def _ordered_features(features: Sequence[dict], key_fields: Sequence[str],
                      province: BaseGeometry | None = None) -> list[dict]:
    eligible = []
    for feature in features:
        try:
            geometry = _source_geometry(feature)
        except ValueError:
            if province is None:
                raise
            continue
        if province is None or geometry.intersects(province):
            eligible.append(feature)
    return sorted(eligible, key=lambda feature: (
        tuple(str((feature.get("properties") or {}).get(key, "")) for key in key_fields),
        _source_geometry(feature).wkb,
    ))


def adapt_cover(province_geometry: BaseGeometry, cover_features: Sequence[dict],
                working_crs: CRS, cache: _ProjectionCache | None = None) -> list[TerrainPatch]:
    province = _project(province_geometry, working_crs)
    result = []
    project = cache.project if cache is not None else lambda feature: _project(_source_geometry(feature), working_crs)
    for feature in _ordered_features(cover_features, ("cover_code", "cover_combat"), province_geometry):
        props = feature.get("properties") or {}
        label = props.get("cover_combat")
        if label not in COVER_MOVE:
            raise ValueError(f"unknown or missing cover_combat label: {label!r}")
        clipped = project(feature).intersection(province)
        result.extend(TerrainPatch(part, label) for part in _polygon_parts(clipped) if not part.is_empty)
    if not result:
        raise ValueError("no cover features intersect province")
    covered = unary_union([patch.geometry for patch in result])
    uncovered = province.difference(covered)
    # Source polygons can leave sub-pixel cracks after projection. Preserve
    # complete province coverage without altering substantive source boundaries.
    if not uncovered.is_empty and uncovered.area <= province.area * 0.001:
        largest = max(range(len(result)), key=lambda index: result[index].geometry.area)
        fallback = result[largest]
        result[largest] = TerrainPatch(fallback.geometry.union(uncovered), fallback.cover_combat)
    elif not uncovered.is_empty:
        raise ValueError("cover terrain coverage is incomplete")
    return result


def _adapt_raster_features(province_geometry: BaseGeometry, features: Sequence[dict],
                           working_crs: CRS, resolution: float, *, elevation: bool,
                           cache: _ProjectionCache | None = None) -> TerrainRaster:
    province = _project(province_geometry, working_crs)
    grid = build_working_grid(province.bounds, resolution, working_crs)
    province_mask = rasterize([(province, 1)], out_shape=(grid.height, grid.width),
                              transform=grid.transform, fill=0, all_touched=False,
                              dtype="uint8").astype(bool)
    if not np.any(province_mask):
        raise ValueError("province does not contain any raster cells")
    labels = ELEVATION_MOVE if elevation else COVER_MOVE
    project = cache.project if cache is not None else lambda feature: _project(_source_geometry(feature), working_crs)
    shapes = []
    for feature in _ordered_features(features, ("elev_code", "cover_code", "elev_type", "elevation_type", "cover_combat"), province_geometry):
        props = feature.get("properties") or {}
        label = (props.get("elev_type") or props.get("elevation_type")) if elevation else props.get("cover_combat")
        if label not in labels:
            field = "elevation_type" if elevation else "cover_combat"
            raise ValueError(f"unknown or missing {field} label: {label!r}")
        geometry = project(feature).intersection(province)
        if not geometry.is_empty:
            shapes.append((geometry, list(labels).index(label)))
    if not shapes:
        raise ValueError("terrain coverage has no features intersecting province")
    values = rasterize(shapes, out_shape=(grid.height, grid.width), transform=grid.transform,
                       fill=-1, all_touched=False, dtype="int16")
    if np.any(province_mask & (values < 0)):
        kind = "elevation" if elevation else "cover"
        raise ValueError(f"{kind} terrain coverage is incomplete")
    # The shared rectangular grid includes cells outside an irregular province.
    # They never participate in generation, but still need valid table labels
    # because Batch 1 builds one cost raster for the complete grid.
    values[~province_mask] = 0
    decoded = np.array(list(labels), dtype=object)[values]
    if elevation:
        return TerrainRaster(np.empty_like(decoded, dtype=object), decoded, grid)
    return TerrainRaster(decoded, np.empty_like(decoded, dtype=object), grid)


def build_terrain_raster(province_geometry: BaseGeometry, cover_features: Sequence[dict],
                         elevation_features: Sequence[dict], working_crs: CRS,
                         resolution: float, cache: _ProjectionCache | None = None) -> TerrainRaster:
    """Rasterize cover and elevation on exactly one projected grid."""
    cover = _adapt_raster_features(province_geometry, cover_features, working_crs, resolution,
                                   elevation=False, cache=cache)
    elevation = _adapt_raster_features(province_geometry, elevation_features, working_crs, resolution,
                                       elevation=True, cache=cache)
    return TerrainRaster(cover.cover, elevation.elevation, cover.grid)


def adapt_roads(province_geometry: BaseGeometry, road_features: Sequence[dict],
                working_crs: CRS, cache: _ProjectionCache | None = None) -> list[RoadInput]:
    province = _project(province_geometry, working_crs)
    result = []
    project = cache.project if cache is not None else lambda feature: _project(_source_geometry(feature), working_crs)
    for feature in _ordered_features(road_features, ("road_id", "road_level", "corridor_id"), province_geometry):
        props = feature.get("properties") or {}
        geometry = _source_geometry(feature)
        if geometry.geom_type not in {"LineString", "MultiLineString"}:
            raise ValueError("road geometry must be LineString or MultiLineString")
        clipped = project(feature).intersection(province)
        if not clipped.is_empty:
            result.append(RoadInput(clipped, int(props.get("road_level", 1)),
                                    props.get("road_id"), props.get("corridor_id")))
    return sorted(result, key=lambda road: (road.road_id or "", road.road_level, road.geometry.wkb))


def adapt_rivers(province_geometry: BaseGeometry, river_features: Sequence[dict],
                 working_crs: CRS, cache: _ProjectionCache | None = None) -> list[BaseGeometry]:
    province = _project(province_geometry, working_crs)
    result = []
    project = cache.project if cache is not None else lambda feature: _project(_source_geometry(feature), working_crs)
    for feature in _ordered_features(river_features, ("river_id", "name"), province_geometry):
        geometry = _source_geometry(feature)
        if geometry.geom_type not in {"LineString", "MultiLineString"}:
            raise ValueError("river geometry must be LineString or MultiLineString")
        clipped = project(feature).intersection(province)
        if not clipped.is_empty:
            result.append(clipped)
    return result


def adapt_cities(province_id: str, city_features: Sequence[dict],
                 working_crs: CRS) -> tuple[Point | None, list[Point]]:
    capitals = []
    for feature in _ordered_features(city_features, ("city_id", "name"), None):
        props = feature.get("properties") or {}
        if props.get("province_id") == province_id and props.get("is_capital"):
            point = _project(_source_geometry(feature), working_crs)
            if point.geom_type != "Point":
                raise ValueError("city geometry must be Point")
            capitals.append(point)
    if len(capitals) > 1:
        raise ValueError(f"province {province_id} has multiple capital points")
    return (capitals[0] if capitals else None), []


def generate_real_province(province_feature: dict, sources: dict,
                           config: SubprovinceConfig) -> tuple[list[SubprovincePolygon], dict[str, list[str]]]:
    """Adapt one source province, generate it, validate it, and return WGS84 output."""
    province_id = (province_feature.get("properties") or {}).get("province_id")
    if not province_id:
        raise ValueError("selected province is missing province_id")
    source_province = _source_geometry(province_feature)
    working_crs = choose_working_crs(source_province)
    province = _project(source_province, working_crs)
    cache = _ProjectionCache(working_crs)
    terrain = build_terrain_raster(source_province, sources["cover"], sources["elevation"], working_crs,
                                   5_000.0, cache=cache)
    patches = adapt_cover(source_province, sources["cover"], working_crs, cache=cache)
    roads = adapt_roads(source_province, sources.get("roads", []), working_crs, cache=cache)
    rivers = adapt_rivers(source_province, sources.get("rivers", []), working_crs, cache=cache)
    capital, towns = adapt_cities(province_id, sources.get("cities", []), working_crs)
    polygons = generate_subprovinces(province_id, province, patches, terrain, roads, rivers,
                                     [], capital, towns, config, report_timing=True)
    to_wgs84 = _projector(working_crs, WGS84)
    # Snap all output to a shared WGS84 precision grid (6 dp ~ sub-metre) so shared walls
    # between adjacent cells stay bit-identical after transformation, then clip to the
    # rounded province so exterior slivers disappear. This keeps the serialized partition
    # overlap- and gap-free by construction.
    snap = lambda x, y, *_: (round(x, 6), round(y, 6))
    wgs84_province = transform(snap, transform(to_wgs84, province))
    wgs84_province = make_valid(wgs84_province) if not wgs84_province.is_valid else wgs84_province
    output = []
    for polygon in polygons:
        geometry = transform(snap, transform(to_wgs84, polygon.geometry))
        geometry = make_valid(geometry) if not geometry.is_valid else geometry
        clipped = geometry.intersection(wgs84_province)
        parts = _polygon_parts(clipped)
        geometry = unary_union(parts) if parts else geometry
        output.append(replace(polygon, geometry=geometry))
    # Reprojection can leave micro self-intersections that make_valid repairs with tiny
    # neighbour overlaps / gaps. Run the topology-safe planar rebuild (noise disabled, in
    # WGS84 degree units) on the snapped cells so the final partition tiles cleanly.
    snap_area = sum(cell.geometry.area for cell in output)
    snap_overlap = snap_area - unary_union([cell.geometry for cell in output]).area
    if snap_overlap > 1e-8:
        from subprovince_generator import _naturalize_partition, default_config as _default_config
        degree_cfg = _default_config()
        degree_cfg = SubprovinceConfig(**{
            **degree_cfg.__dict__,
            "natural_noise_amplitude": 0.0,
            "natural_noise_wavelength": 0.01,
            "geometry_tolerance": 1e-8,
            "seed": config.seed,
        })
        output = _naturalize_partition(
            output, degree_cfg, wgs84_province,
            rebuild=lambda geometry, source: replace(source, geometry=geometry),
        )
    # Strict re-validation in WGS84: after generator-side shared-edge simplification this
    # must be overlap- and gap-free within a tiny tolerance; anything larger is a bug.
    validate_subprovince_partition(wgs84_province, output, 1e-6,
                                   coverage_tolerance=max(wgs84_province.area * 1e-6, 1e-9))
    validate_subprovince_metadata(output)
    adjacency = build_subprovince_adjacency(output, 1e-8)
    validate_subprovince_adjacency(output, adjacency)
    return output, adjacency


def serialize_subprovinces(output_path: Path, polygons: Sequence[SubprovincePolygon]) -> None:
    features = []
    for polygon in sorted(polygons, key=lambda item: item.subprovince_id):
        features.append({"type": "Feature", "geometry": mapping(polygon.geometry), "properties": {
            "subprovince_id": polygon.subprovince_id, "province_id": polygon.province_id,
            "kind": polygon.kind, "cover_combat": polygon.cover_combat,
            "elevation_type": polygon.elevation_type, "is_capital": polygon.is_capital,
        }})
    output_path.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                      ensure_ascii=False, separators=(",", ":")) + "\n")


def serialize_adjacency(output_path: Path, adjacency: Mapping[str, Sequence[str]]) -> None:
    features = [{"type": "Feature", "geometry": None, "properties": {
        "subprovince_id": identifier, "neighbors": sorted(set(neighbors))
    }} for identifier, neighbors in sorted(adjacency.items())]
    output_path.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                      ensure_ascii=False, separators=(",", ":")) + "\n")


def publish_subprovince_outputs(output_dir: Path, polygons: Sequence[SubprovincePolygon],
                                adjacency: Mapping[str, Sequence[str]]) -> None:
    """Publish both derived files together, leaving existing files untouched on failure."""
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="subprovinces-", dir=output_dir.parent) as staging:
        staging_dir = Path(staging)
        serialize_subprovinces(staging_dir / "subprovinces.geojson", polygons)
        serialize_adjacency(staging_dir / "subprovince_adjacency.geojson", adjacency)
        output_dir.mkdir(parents=True, exist_ok=True)
        (staging_dir / "subprovinces.geojson").replace(output_dir / "subprovinces.geojson")
        (staging_dir / "subprovince_adjacency.geojson").replace(output_dir / "subprovince_adjacency.geojson")
