"""Render and inspect subprovince output for a real province or synthetic fixture.

Usage:
    inspect_subprovinces.py --map europe_1938_6 --province we6_germany_01 [--svg out.svg]
    inspect_subprovinces.py --synthetic [--svg out.svg]
"""

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from rasterio.crs import CRS
from shapely.geometry import LineString, Point, box, mapping, shape
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).parent))

from subprovince_generator import (
    RoadInput,
    TerrainPatch,
    TerrainRaster,
    default_config,
    generate_subprovinces,
)
from subprovince_raster import build_working_grid

KIND_COLORS = {
    "capital": "#3b3b3b",
    "town": "#8a8a8a",
    "road": "#c9a86b",
    "hinterland": "#b6d7a8",
}
COVER_COLORS = {
    "plains": "#cfe3a0", "steppe": "#d9c89a", "shrubland": "#c5b57a",
    "light_forest": "#a8c77f", "dense_forest": "#5d8f4f", "jungle": "#2f6b3a",
    "desert": "#e7d7a8", "swamp": "#7fae8f", "tundra": "#c8d6df",
    "glacier": "#eef5f7", "urban": "#b0b0b0",
}


def _synthetic_sources():
    province = box(0, 0, 40, 40)
    grid = build_working_grid((0, 0, 40, 40), 1.0, CRS.from_epsg(3857))
    cover = np.full((40, 40), "plains", dtype=object)
    cover[:, 20:] = "forest"
    elevation = np.full((40, 40), "flat", dtype=object)
    elevation[:20, :] = "hills"
    terrain = TerrainRaster(cover, elevation, grid)
    patches = [TerrainPatch(province, "plains")]
    roads = [RoadInput(LineString([(0, 4), (40, 4)]), 2)]
    return province, patches, terrain, roads


def render_svg(cells, province_bounds, out: Path, projection="wgs84") -> None:
    features = []
    for cell in cells:
        props = {"kind": cell.kind, "cover_combat": cell.cover_combat,
                 "elevation_type": cell.elevation_type}
        if cell.is_capital:
            c = KIND_COLORS["capital"]
        elif cell.kind == "town":
            c = KIND_COLORS["town"]
        elif cell.kind == "road":
            c = KIND_COLORS["road"]
        else:
            c = COVER_COLORS.get(cell.cover_combat or "", "#dddddd")
        features.append((c, cell.geometry))
    min_x, min_y, max_x, max_y = province_bounds
    width = max_x - min_x or 1.0
    height = max_y - min_y or 1.0
    scale = 800.0 / max(width, height)
    ox, oy = min_x, max_y
    parts = []
    for color, geom in features:
        geoms = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
        for poly in geoms:
            paths = []
            for ring in [poly.exterior] + list(poly.interiors):
                coords = ring.coords
                if len(coords) < 3:
                    continue
                d = "M " + " L ".join(
                    f"{((x - ox) * scale):.1f},{((oy - y) * scale):.1f}" for x, y, *_ in coords
                ) + " Z"
                paths.append(d)
            parts.append(f'<path d="{" ".join(paths)}" fill="{color}" stroke="#333" stroke-width="0.5" />')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="{(height * scale):.0f}" '
           f'viewBox="0 0 800 {(height * scale):.0f}">\n{chr(10).join(parts)}\n</svg>')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg)
    print(f"wrote {out}")


def summarize(cells, province=None):
    from collections import Counter
    total = sum(c.geometry.area for c in cells)
    union = unary_union([c.geometry for c in cells])
    kinds = Counter(c.kind for c in cells)
    print(f"cells={len(cells)}  area={total:,.3f}" + (f"  province={province.area:,.3f}" if province is not None else ""))
    print("kinds:", dict(kinds))
    coverage = Counter(c.cover_combat for c in cells)
    print("cover:", dict(coverage))
    print(f"overlap={total - union.area:,.4f}" + (f"  gap={province.difference(union).area:,.4f}" if province is not None else ""))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--map", default="europe_1938_6")
    parser.add_argument("--province", default="we6_germany_01")
    parser.add_argument("--synthetic", action="store_true")
    parser.add_argument("--svg", default=None, help="write an SVG render")
    args = parser.parse_args()

    if args.synthetic:
        province, patches, terrain, roads = _synthetic_sources()
        cells = generate_subprovinces("synthetic", province, patches, terrain, roads, [], [],
                                      Point(2, 2), [], default_config(), report_timing=True)
        bounds = province
    else:
        from subprovince_io import generate_real_province
        root = Path("map") / args.map
        sources = {n: json.loads((root / f"{n}.geojson").read_text())["features"]
                   for n in ("provinces", "cover", "elevation", "roads", "rivers", "cities")}
        feature = next(f for f in sources["provinces"] if f["properties"]["province_id"] == args.province)
        cells, _ = generate_real_province(feature, sources, default_config())
        min_x = min(c.geometry.bounds[0] for c in cells)
        min_y = min(c.geometry.bounds[1] for c in cells)
        max_x = max(c.geometry.bounds[2] for c in cells)
        max_y = max(c.geometry.bounds[3] for c in cells)
        bounds = box(min_x, min_y, max_x, max_y)

    if args.svg:
        render_svg(cells, bounds.bounds, Path(args.svg))
    summarize(cells, bounds if args.synthetic else None)


if __name__ == "__main__":
    main()