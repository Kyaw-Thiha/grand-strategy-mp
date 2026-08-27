"""
Straight Voronoi vs. cost-weighted ("terrain-following") regions.

Real provincial borders aren't wiggly because someone added noise — they're
wiggly because they historically settled along ridgelines, rivers, and
watersheds: the places where it was equally hard (or easy) to project
control from either side. That's a *cost-distance* balance, not a
Euclidean one. So instead of asking "how do I make a Voronoi edge wavy",
the better question is "what if distance itself accounted for terrain".

Multi-source Dijkstra over a per-pixel cost field does exactly that: run
it from every seed at once, and whichever seed reaches a pixel with the
lowest *cumulative cost* (not straight-line distance) owns that pixel.
Where a ridge or a river sits between two seeds, the cheapest path from
either side tends to run along it rather than through it, so the boundary
settles onto the terrain feature instead of cutting a straight line
across it — which is the same reason real borders do that.

Bonus: this is a raster labeling, so full coverage is trivial and exact
by construction — every pixel gets exactly one label, no polygon topology
to get wrong. Vectorizing the result into clean polygons afterward is the
same raster-to-vector step the existing pipeline already runs for
cover.geojson and elevation.geojson.
"""

import heapq
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap

H, W = 140, 180
rng = np.random.default_rng(3)

# --- synthetic terrain: mostly flat, one diagonal ridge, one river gap ---
cost = np.ones((H, W))
yy, xx = np.mgrid[0:H, 0:W]
ridge_dist = np.abs((xx - 40) - 0.9 * (yy - 10))
cost += np.clip(6.0 - ridge_dist * 0.35, 0, 6.0)          # expensive ridge band
river_dist = np.abs((xx - 160) + 0.6 * (yy - 140))
cost += np.clip(3.0 - river_dist * 0.5, 0, 3.0)           # a second, thinner feature

# --- seeds scattered across the province, same seeds for both methods ---
n_seeds = 7
seeds = list(zip(
    rng.integers(10, H - 10, n_seeds),
    rng.integers(10, W - 10, n_seeds),
))


def euclidean_labels(shape, seeds):
    Hh, Ww = shape
    yy_, xx_ = np.mgrid[0:Hh, 0:Ww]
    best = np.full((Hh, Ww), np.inf)
    label = np.full((Hh, Ww), -1, dtype=int)
    for i, (sy, sx) in enumerate(seeds):
        d = (yy_ - sy) ** 2 + (xx_ - sx) ** 2
        mask = d < best
        best[mask] = d[mask]
        label[mask] = i
    return label


def cost_weighted_labels(cost, seeds):
    Hh, Ww = cost.shape
    dist = np.full((Hh, Ww), np.inf)
    label = np.full((Hh, Ww), -1, dtype=int)
    visited = np.zeros((Hh, Ww), dtype=bool)
    heap = []
    for i, (sy, sx) in enumerate(seeds):
        dist[sy, sx] = 0.0
        label[sy, sx] = i
        heapq.heappush(heap, (0.0, sy, sx))
    nbrs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    while heap:
        d, y, x = heapq.heappop(heap)
        if visited[y, x]:
            continue
        visited[y, x] = True
        for dy, dx in nbrs:
            ny, nx = y + dy, x + dx
            if 0 <= ny < Hh and 0 <= nx < Ww and not visited[ny, nx]:
                nd = d + cost[ny, nx]
                if nd < dist[ny, nx]:
                    dist[ny, nx] = nd
                    label[ny, nx] = label[y, x]
                    heapq.heappush(heap, (nd, ny, nx))
    return label


label_euclid = euclidean_labels((H, W), seeds)
label_cost = cost_weighted_labels(cost, seeds)

# coverage check — trivial for a raster, but let's actually prove it anyway
assert (label_euclid >= 0).all() and (label_cost >= 0).all(), "unlabeled pixels found"
print("euclidean coverage: every pixel labeled =", bool((label_euclid >= 0).all()))
print("cost-weighted coverage: every pixel labeled =", bool((label_cost >= 0).all()))
print(f"cells: {n_seeds} seeds -> {len(np.unique(label_euclid))} euclid regions, "
      f"{len(np.unique(label_cost))} cost-weighted regions")

cmap = ListedColormap(plt.cm.tab10(np.linspace(0, 1, n_seeds)))

fig, axes = plt.subplots(1, 2, figsize=(12, 5.2))
for ax, label, title in [
    (axes[0], label_euclid, "straight voronoi (euclidean distance)"),
    (axes[1], label_cost, "cost-weighted (distance through terrain)"),
]:
    ax.imshow(label, cmap=cmap, interpolation="nearest")
    ax.contour(cost, levels=[3.0], colors="black", linewidths=1.2, linestyles="--", alpha=0.6)
    sy, sx = zip(*seeds)
    ax.scatter(sx, sy, c="white", edgecolors="black", s=35, zorder=5)
    ax.set_title(title, fontsize=11)
    ax.set_xticks([]); ax.set_yticks([])

fig.suptitle("dashed line = ridge/river cost feature the boundary reacts to", fontsize=10, y=0.02)
plt.tight_layout()
plt.savefig("/home/claude/voronoi_vs_cost.png", dpi=150, bbox_inches="tight")
print("saved /home/claude/voronoi_vs_cost.png")
