type CellKey = string;

function floorCell(value: number, cellSizeDeg: number): number {
  return Math.floor(value / cellSizeDeg);
}

export class AirSpatialBucket {
  private _cellSizeDeg: number;
  private _cells: Map<CellKey, Set<string>> = new Map();

  constructor(cellSizeDeg = 2.0) {
    this._cellSizeDeg = cellSizeDeg;
  }

  clear(): void {
    this._cells.clear();
  }

  add(wingId: string, lng: number, lat: number): void {
    const key = `${floorCell(lng, this._cellSizeDeg)}:${floorCell(lat, this._cellSizeDeg)}`;
    if (!this._cells.has(key)) {
      this._cells.set(key, new Set());
    }
    this._cells.get(key)!.add(wingId);
  }

  getLocalPairs(): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    const seen = new Set<string>();

    for (const [key, wingIds] of this._cells.entries()) {
      const [xRaw, yRaw] = key.split(":");
      const cellX = Number(xRaw);
      const cellY = Number(yRaw);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighborKey = `${cellX + dx}:${cellY + dy}`;
          const neighborWingIds = this._cells.get(neighborKey);
          if (!neighborWingIds) continue;

          for (const wingA of wingIds) {
            for (const wingB of neighborWingIds) {
              if (wingA === wingB) continue;
              const a = wingA < wingB ? wingA : wingB;
              const b = wingA < wingB ? wingB : wingA;
              const pairKey = `${a}|${b}`;
              if (seen.has(pairKey)) continue;
              seen.add(pairKey);
              pairs.push([a, b]);
            }
          }
        }
      }
    }

    return pairs;
  }
}
