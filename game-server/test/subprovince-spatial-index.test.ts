import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSubprovinceSpatialIndex, findSubprovinceAtPoint } from "../src/data/subprovince_loader.js";
import type { SubprovinceGraph } from "../src/data/map_loader.js";

describe("lane:subprovince | subprovince spatial index", () => {
  it("finds the subprovince containing a point via bbox-filtered PIP", () => {
    const graph: SubprovinceGraph = {
      nodes: new Map([
        ["sp_a", { id: "sp_a", provinceId: "p1", kind: "hinterland", coverCombat: null, elevationType: null, isCapital: false, polygon: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] }],
        ["sp_b", { id: "sp_b", provinceId: "p1", kind: "hinterland", coverCombat: null, elevationType: null, isCapital: false, polygon: [[[1, 0], [1, 1], [2, 1], [2, 0], [1, 0]]] }],
      ]),
      neighbors: new Map([["sp_a", ["sp_b"]], ["sp_b", ["sp_a"]]]),
    };
    const entries = buildSubprovinceSpatialIndex(graph);
    assert.equal(findSubprovinceAtPoint(0.5, 0.5, entries), "sp_a");
    assert.equal(findSubprovinceAtPoint(1.5, 0.5, entries), "sp_b");
    assert.equal(findSubprovinceAtPoint(5, 5, entries), null);
  });

  it("skips nodes with empty polygon lists (zero-area artifact cells)", () => {
    const graph: SubprovinceGraph = {
      nodes: new Map([
        ["sp_empty", { id: "sp_empty", provinceId: "p1", kind: "hinterland", coverCombat: null, elevationType: null, isCapital: false, polygon: [] }],
      ]),
      neighbors: new Map([["sp_empty", []]]),
    };
    const entries = buildSubprovinceSpatialIndex(graph);
    assert.equal(entries.length, 0);
    assert.equal(findSubprovinceAtPoint(0, 0, entries), null);
  });
});
