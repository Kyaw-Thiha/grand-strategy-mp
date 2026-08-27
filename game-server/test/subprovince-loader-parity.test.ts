import { describe, it } from "mocha";
import assert from "assert";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { loadSubprovinceGraph } from "../src/data/map_loader.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const gameServerRoot = join(__dir, "..");
const repoRoot = join(gameServerRoot, "..");
const MAP_ID = "western_europe_6";
const asset = (name: string) =>
  JSON.parse(readFileSync(join(repoRoot, "client", "assets", "data", MAP_ID, name), "utf-8"));

function unorderedEdge(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

describe("lane:map-data | subprovince-loader parity against generated source", () => {
  const graph = loadSubprovinceGraph(MAP_ID);
  const rawSp = asset("subprovinces.geojson");
  const rawAdj = asset("subprovince_adjacency.geojson");

  it("matches total subprovince count and ID set", () => {
    const ids = new Set(rawSp.features.map((f: any) => f.properties.subprovince_id));
    assert.strictEqual(graph.nodes.size, rawSp.features.length);
    assert.strictEqual(graph.neighbors.size, ids.size);
    for (const id of graph.nodes.keys()) assert.ok(ids.has(id), `server node ${id} absent from source`);
    for (const id of ids) assert.ok(graph.nodes.has(id), `source subprovince ${id} absent from server graph`);
  });

  it("matches province -> subprovince groupings", () => {
    const byProv = new Map<string, string[]>();
    for (const f of rawSp.features) {
      const prov = f.properties.province_id as string;
      byProv.set(prov, [...(byProv.get(prov) ?? []), f.properties.subprovince_id as string]);
    }
    const serverByProv = new Map<string, string[]>();
    for (const node of graph.nodes.values()) {
      serverByProv.set(node.provinceId, [...(serverByProv.get(node.provinceId) ?? []), node.id]);
    }
    assert.strictEqual(serverByProv.size, byProv.size);
    for (const [prov, ids] of byProv) {
      assert.deepStrictEqual(new Set(serverByProv.get(prov) ?? []), new Set(ids), `grouping mismatch for ${prov}`);
    }
  });

  it("matches adjacency as an unordered edge set", () => {
    const sourceEdges = new Set<string>();
    for (const f of rawAdj.features) {
      const id = f.properties.subprovince_id;
      for (const n of f.properties.neighbors) sourceEdges.add(unorderedEdge(id, n));
    }
    const serverEdges = new Set<string>();
    for (const [id, neighbors] of graph.neighbors) {
      for (const n of neighbors) serverEdges.add(unorderedEdge(id, n));
    }
    assert.strictEqual(sourceEdges.size, serverEdges.size, "edge count mismatch");
    for (const e of sourceEdges) assert.ok(serverEdges.has(e), `missing server edge ${e}`);
  });
});