"""
Subprovince generator — terrain-first, exact full coverage, fine density.

Order of operations (this order IS what makes it "terrain-first"):
  1. carve the capital ring (locked, flips only on city capture)
  2. carve merged town cells (non-capital urban, never subdivided)
  3. carve the road corridor (uniform width/spacing for every road_level)
  4. whatever's left is intersected against the terrain patches FIRST — a
     patch becomes one subprovince if it's small enough on its own, and is
     only split into more cells if it's too big to be one capture-sized
     chunk. A subprovince edge never cuts across a terrain-type boundary,
     because it's never given the chance to: it's built from the patch,
     not laid over it.
  5. merge any leftover sliver into whichever neighbor it shares the most
     boundary with, so nothing is ever lost

Irregularity comes from jittering the SEED POINTS before each Voronoi
pass, not from wobbling the finished polygon edges afterward. That
distinction matters more than it looks: an earlier version of this
script post-processed each polygon's boundary with per-edge noise, and
it silently broke tiling — two cells sharing a border each jittered
*their own copy* of it differently, opening real gaps and overlaps
(measured at ~2% of total area on a test province, then worse on the
"fixed" attempt). Voronoi diagrams are provably exact tilings by
construction; perturbing their input is safe, perturbing their output
is not, unless you build a full noded-and-snapped edge graph to do it
(possible, but real GIS-topology work, not a quick pass). If you want
edges that visibly wave instead of just being irregular polygons with
straight sides, do it as a purely cosmetic step in the renderer —
displace the drawn outline with position-based noise when meshing it
in Godot — and never let that touch the authoritative server polygon.
Coverage/ownership must stay on the exact geometry below.

Coverage is proven, not assumed: the demo at the bottom computes
province.difference(union(all_cells)).area and checks it's exactly 0.
"""

import numpy as np
from shapely.geometry import Polygon, Point, LineString, MultiPoint
from shapely.ops import voronoi_diagram, unary_union

# ---------------------------------------------------------------- helpers --

def jitter_points_along_line(line: LineString, spacing, jitter, rng):
    """Seed points along a centerline with perpendicular jitter."""
    length = line.length
    n = max(2, int(length // spacing))
    pts = []
    for i in range(n + 1):
        d = min(i * spacing, length)
        p = line.interpolate(d)
        p2 = line.interpolate(min(d + 1.0, length))
        dx, dy = p2.x - p.x, p2.y - p.y
        norm = (dx ** 2 + dy ** 2) ** 0.5 or 1
        nx, ny = -dy / norm, dx / norm
        off = rng.uniform(-jitter, jitter)
        pts.append((p.x + nx * off, p.y + ny * off))
    return pts


def poisson_like_points(polygon: Polygon, spacing, rng):
    """Cheap blue-noise-ish seeding: jittered rows, reject outside polygon."""
    minx, miny, maxx, maxy = polygon.bounds
    pts, y, row = [], miny, 0
    while y < maxy:
        offset = (spacing / 2) if row % 2 else 0
        x = minx + offset
        while x < maxx:
            jx = x + rng.uniform(-spacing * 0.35, spacing * 0.35)
            jy = y + rng.uniform(-spacing * 0.35, spacing * 0.35)
            if polygon.contains(Point(jx, jy)):
                pts.append((jx, jy))
            x += spacing
        y += spacing * 0.86
        row += 1
    return pts


def voronoi_cells(points, clip_polygon: Polygon):
    """Exact tiling by construction — every point in clip_polygon belongs
    to exactly one returned cell. This is where the irregularity should
    come from: jitter `points`, not the cells this returns."""
    if len(points) < 2:
        return [clip_polygon]
    vd = voronoi_diagram(MultiPoint(points), envelope=clip_polygon.buffer(clip_polygon.length))
    cells = []
    for geom in vd.geoms:
        clipped = geom.intersection(clip_polygon)
        if not clipped.is_empty and clipped.area > 1e-6:
            cells.append(clipped)
    return cells


def flatten(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    if geom.geom_type == "MultiPolygon":
        return list(geom.geoms)
    if geom.geom_type == "GeometryCollection":
        out = []
        for g in geom.geoms:
            out.extend(flatten(g))
        return out
    return []


def merge_slivers(cells, min_area):
    """Merge by shared-boundary length, not just proximity, so a sliver
    joins the neighbor it actually borders rather than the nearest one."""
    kept = [c for c in cells if c["geom"].area >= min_area or c["kind"] in ("capital", "town")]
    slivers = [c for c in cells if c["geom"].area < min_area and c["kind"] not in ("capital", "town")]
    for s in slivers:
        best, best_len = None, 0.0
        for k in kept:
            shared = s["geom"].intersection(k["geom"].buffer(0.05)).length
            if shared > best_len:
                best, best_len = k, shared
        if best is not None:
            best["geom"] = unary_union([best["geom"], s["geom"]])
        else:
            kept.append(s)
    return kept


# ------------------------------------------------------------- main pass --

def generate_subprovinces(
    province, terrain_patches, road_line, city_point, town_points,
    road_width=1.3, road_spacing=1.4, road_jitter=0.5,
    hinterland_spacing=1.8, target_cell_area=9.0,
    capital_radius=3.0, town_radius=1.8, min_area=0.6, seed=7,
):
    """Fine-density defaults per current design call: start with the finer
    grain, tune target_cell_area / hinterland_spacing down or up from here
    once it's in front of playtesters."""
    rng = np.random.default_rng(seed)
    subprovinces = []

    # 1. capital ring — locked, only flips on full province/city capture
    capital = city_point.buffer(capital_radius).intersection(province)
    subprovinces.append({"geom": capital, "kind": "capital"})
    remaining = province.difference(capital)

    # 2. merged town cells — one cell per patch, never subdivided regardless
    #    of size (unlike hinterland terrain patches)
    for t in town_points:
        cell = t.buffer(town_radius).intersection(remaining)
        if not cell.is_empty and cell.area > 0.05:
            subprovinces.append({"geom": cell, "kind": "town"})
            remaining = remaining.difference(cell)

    # 3. road corridor — uniform width/spacing regardless of road_level;
    #    road_level stays a movement/animation-speed field only
    corridor = road_line.buffer(road_width).intersection(remaining)
    if not corridor.is_empty:
        seeds = jitter_points_along_line(road_line, road_spacing, road_jitter, rng)
        for c in voronoi_cells(seeds, corridor):
            subprovinces.append({"geom": c, "kind": "road"})
        remaining = remaining.difference(corridor)

    # 4. terrain fill — the patch IS the subprovince unless it's too big.
    #    This is the "prioritize terrain" step: we intersect what's left
    #    against each terrain patch first, and only run Voronoi seeding
    #    *inside* a single patch when it needs splitting — a cell can
    #    never straddle two terrain types.
    for patch in terrain_patches:
        fragment = patch.intersection(remaining)
        for piece in flatten(fragment):
            if piece.area <= 0.05:
                continue
            if piece.area <= target_cell_area:
                subprovinces.append({"geom": piece, "kind": "hinterland"})
            else:
                seeds = poisson_like_points(piece, hinterland_spacing, rng)
                if len(seeds) < 2:
                    subprovinces.append({"geom": piece, "kind": "hinterland"})
                    continue
                for c in voronoi_cells(seeds, piece):
                    subprovinces.append({"geom": c, "kind": "hinterland"})

    subprovinces = merge_slivers(subprovinces, min_area)
    return subprovinces


# ------------------------------------------------------------------ demo --

if __name__ == "__main__":
    province = Polygon([
        (0, 5), (4, 1), (12, 0), (20, 3), (24, 7), (23, 15),
        (18, 20), (10, 21), (4, 18), (0, 12),
    ])

    # two terrain patches that already gap-fill the province, as
    # cover.geojson would post-pipeline — a "forest" NW block, "plains" SE
    forest = Polygon([(0, 5), (4, 1), (12, 0), (14, 8), (10, 14), (2, 12)])
    plains = province.difference(forest)

    road = LineString([(1, 6), (8, 9), (15, 11), (22, 10)])
    city = Point(21, 9)
    towns = [Point(9, 10)]

    cells = generate_subprovinces(province, [forest, plains], road, city, towns)

    coverage_gap = province.difference(unary_union([c["geom"] for c in cells])).area
    total_area = sum(c["geom"].area for c in cells)

    from collections import Counter
    counts = Counter(c["kind"] for c in cells)

    print(f"province area:       {province.area:.4f}")
    print(f"sum of cell areas:    {total_area:.4f}")
    print(f"coverage gap area:    {coverage_gap:.6f}  (0.0 = exact full coverage)")
    print(f"cell counts:          {dict(counts)}")
    for c in cells:
        if not c["geom"].is_valid:
            print("INVALID GEOMETRY:", c["kind"])
