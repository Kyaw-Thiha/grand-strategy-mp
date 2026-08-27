"""
Same technique as before, now driven by the real numbers from
MAP_DATA_CONTRACT.md instead of a synthetic ridge — proving the cost
field is a direct, un-invented reuse of data that already exists.

Two-level structure, matching what's been discussed:
  - cover_combat patches are still the HARD boundary. A subprovince never
    crosses from dense_forest into plains — that edge is drawn from the
    patch polygon itself, untouched by anything below.
  - INSIDE a patch that's too big for one subprovince, elevation_type can
    still vary (cover and elevation are independent layers), so there's
    real terrain texture to subdivide against. That's where cost-weighted
    flood fill replaces plain Euclidean Voronoi: it decides how the
    internal split bends, not whether the patch boundary itself moves.

cost(pixel) = 1 / (cover_move[cover_combat] * elevation_move[elevation_type])
This is the exact inverse of the existing off-road movement multiplier —
slow terrain is expensive to traverse, so a boundary prefers to run along
it rather than through it, for the same reason a division does.
"""

import heapq
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap

# --- real values, copied from MAP_DATA_CONTRACT.md, not invented ---------
COVER_MOVE = {
    "plains": 1.0, "steppe": 1.1, "shrubland": 0.85, "light_forest": 0.75,
    "dense_forest": 0.6, "jungle": 0.35, "desert": 0.6, "swamp": 0.3,
    "tundra": 0.5, "glacier": 0.2, "urban": 0.8,
}
ELEV_MOVE = {"flat": 1.0, "hills": 0.7, "mountains": 0.4}


def terrain_cost(cover, elevation):
    return 1.0 / (COVER_MOVE[cover] * ELEV_MOVE[elevation])


H, W = 130, 200

# --- cover_combat layer: two patches, a hard boundary between them -------
cover = np.full((H, W), "plains", dtype=object)
cover[:, :110] = "dense_forest"           # west patch — the one we'll split
forest_mask = cover == "dense_forest"

# --- elevation_type layer: independent of cover, a mountain band cutting
#     diagonally through the forest patch (real texture to react to) -----
elevation = np.full((H, W), "flat", dtype=object)
yy, xx = np.mgrid[0:H, 0:W]
band = np.abs((xx - 55) - 0.55 * (yy - 20))
elevation[band < 14] = "mountains"

cost = np.zeros((H, W))
for cv in np.unique(cover):
    for el in np.unique(elevation):
        mask = (cover == cv) & (elevation == el)
        cost[mask] = terrain_cost(cv, el)

print("cost range inside forest patch:",
      f"{cost[forest_mask].min():.2f} - {cost[forest_mask].max():.2f}",
      "(flat dense_forest vs mountain dense_forest)")

# --- seed the forest patch (too big for one subprovince) -----------------
rng = np.random.default_rng(11)
forest_ys, forest_xs = np.where(forest_mask)
n_seeds = 5
idx = rng.choice(len(forest_ys), n_seeds, replace=False)
seeds = list(zip(forest_ys[idx], forest_xs[idx]))


def split_patch(cost_field, mask, seeds, weighted):
    Hh, Ww = mask.shape
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
            if 0 <= ny < Hh and 0 <= nx < Ww and mask[ny, nx] and not visited[ny, nx]:
                step = cost_field[ny, nx] if weighted else 1.0
                nd = d + step
                if nd < dist[ny, nx]:
                    dist[ny, nx] = nd
                    label[ny, nx] = label[y, x]
                    heapq.heappush(heap, (nd, ny, nx))
    return label


label_euclid = split_patch(cost, forest_mask, seeds, weighted=False)
label_cost = split_patch(cost, forest_mask, seeds, weighted=True)

# --- coverage check: every forest pixel labeled, patch boundary untouched
for name, label in [("euclidean", label_euclid), ("cost-weighted", label_cost)]:
    inside_ok = (label[forest_mask] >= 0).all()
    outside_ok = (label[~forest_mask] == -1).all()
    print(f"{name}: every forest pixel labeled = {inside_ok}, "
          f"plains patch untouched = {outside_ok}")

cmap = ListedColormap(plt.cm.Set2(np.linspace(0, 1, n_seeds)))
fig, axes = plt.subplots(1, 2, figsize=(12, 5.5))
for ax, label, title in [
    (axes[0], label_euclid, "euclidean split inside the forest patch"),
    (axes[1], label_cost, "cost-weighted split (real cover + elevation)"),
]:
    disp = np.ma.masked_where(~forest_mask, label)
    ax.imshow(np.where(cover == "plains", 0.92, 1.0), cmap="Greys", vmin=0, vmax=1)
    ax.imshow(disp, cmap=cmap, interpolation="nearest", alpha=0.9)
    ax.contour(elevation == "mountains", levels=[0.5], colors="black",
               linewidths=1.1, linestyles="--", alpha=0.7)
    ax.plot([110, 110], [0, H - 1], color="black", linewidth=2)  # patch boundary
    sy, sx = zip(*seeds)
    ax.scatter(sx, sy, c="white", edgecolors="black", s=30, zorder=5)
    ax.set_title(title, fontsize=10.5)
    ax.set_xticks([]); ax.set_yticks([])

fig.suptitle("solid line = forest/plains patch boundary (never crossed) · "
             "dashed line = mountain band inside the forest patch", fontsize=9.5, y=0.03)
plt.tight_layout()
plt.savefig("/home/claude/terrain_cost_split.png", dpi=150, bbox_inches="tight")
print("saved /home/claude/terrain_cost_split.png")
