"""Benchmark subprovince generation on synthetic provinces of growing size.

Verifies the generator scales roughly linearly with province area rather than
quadratically with cell count (the pre-optimization behavior).
"""

import json
import sys
from pathlib import Path
import time

import numpy as np
from rasterio.crs import CRS
from shapely.geometry import Point, box

sys.path.insert(0, str(Path(__file__).parent))

from subprovince_generator import SubprovinceConfig, TerrainPatch, TerrainRaster, generate_subprovinces
from subprovince_raster import build_working_grid


def run(size: int) -> float:
    grid = build_working_grid((0, 0, size, size), 1, CRS.from_epsg(3857))
    terrain = TerrainRaster(np.full((size, size), "plains", dtype=object),
                            np.full((size, size), "flat", dtype=object), grid)
    patch = TerrainPatch(box(0, 0, size, size), "plains")
    config = SubprovinceConfig(16, 1, 4, 0, 4, 1, 0.75, 0.2, 1, 1e-6, 7)
    start = time.time()
    result = generate_subprovinces(f"p{size}", box(0, 0, size, size), [patch], terrain,
                                   [], [], [], Point(1, 1), [], config)
    elapsed = time.time() - start
    return len(result), elapsed


def main() -> None:
    rows = []
    for size in (8, 12, 16, 20, 24):
        cells, elapsed = run(size)
        rows.append({"size": size, "cells": cells, "seconds": round(elapsed, 3),
                     "seconds_per_cell_ms": round(elapsed / max(cells, 1) * 1000, 3)})
    print(json.dumps(rows, indent=2))
    first = rows[0]
    last = rows[-1]
    print(f"cells grew {first['cells']}->{last['cells']} "
          f"({round(last['cells'] / first['cells'], 1)}x), "
          f"time grew {first['seconds']}->{last['seconds']} "
          f"({round(last['seconds'] / first['seconds'], 1)}x)")


if __name__ == "__main__":
    main()