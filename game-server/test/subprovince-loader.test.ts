import { describe, it } from "mocha";
import assert from "assert";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { loadSubprovinceGraph, parseSubprovinceGraph } from "../src/data/map_loader.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const gameServerRoot = join(__dir, "..");
const repoRoot = join(gameServerRoot, "..");
const REAL_MAP_ID = "western_europe_6";

function realAsset(filename: string) {
  return join(repoRoot, "client", "assets", "data", REAL_MAP_ID, filename);
}

function validSubprovince(count: number) {
  const features = [];
  for (let i = 0; i < count; i++) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
      },
      properties: {
        subprovince_id: `f_p_sp_${i}`,
        province_id: "f_p",
        kind: i === 0 ? "capital" : "hinterland",
        cover_combat: "plains",
        elevation_type: "flat",
        is_capital: i === 0,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function validAdjacency(ids: string[]) {
  return {
    type: "FeatureCollection",
    features: ids.map((id) => ({
      type: "Feature",
      geometry: null,
      properties: { subprovince_id: id, neighbors: ids.filter((n) => n !== id) },
    })),
  };
}

describe("lane:map-data | loadSubprovinceGraph returns the SubprovinceGraph", () => {
  it("loads the real western_europe_6 full-map output with matching node/neighbor counts", () => {
    const graph = loadSubprovinceGraph(REAL_MAP_ID);
    const source = JSON.parse(readFileSync(realAsset("subprovinces.geojson"), "utf-8"));
    assert.strictEqual(graph.nodes.size, source.features.length);
    assert.strictEqual(graph.neighbors.size, source.features.length);
    const sample = graph.nodes.get("we6_germany_01_sp_1");
    assert.ok(sample, "sample cell we6_germany_01_sp_1 exists");
    assert.strictEqual(sample!.provinceId, "we6_germany_01");
    assert.ok(["road", "hinterland", "town", "capital"].includes(sample!.kind));
    assert.strictEqual(typeof sample!.isCapital, "boolean");
    assert.ok(Array.isArray(sample!.polygon) && sample!.polygon.length >= 1);
    assert.ok(sample!.polygon.every((ring) => Array.isArray(ring) && ring.length >= 4));
  });

  it("polygon coordinates match the source GeoJSON outer rings", () => {
    const graph = loadSubprovinceGraph(REAL_MAP_ID);
    const source = JSON.parse(readFileSync(realAsset("subprovinces.geojson"), "utf-8"));
    const first = source.features[0];
    const id = first.properties.subprovince_id;
    const expected = first.geometry.type === "MultiPolygon"
      ? first.geometry.coordinates.map((part: any) => part[0])
      : [first.geometry.coordinates[0]];
    assert.deepStrictEqual(graph.nodes.get(id)!.polygon, expected);
  });

  it("returns cache-backed data on repeated calls (same object identity)", () => {
    const a = loadSubprovinceGraph(REAL_MAP_ID);
    const b = loadSubprovinceGraph(REAL_MAP_ID);
    assert.strictEqual(a, b);
  });
});

describe("lane:map-data | parseSubprovinceGraph fails clearly on bad assets", () => {
  const parse = (sp: unknown, adj: unknown) =>
    parseSubprovinceGraph(sp as any, adj as any, "tmap");

  it("fails when subprovinces is not a FeatureCollection", () => {
    assert.throws(() => parse({ type: "Feature", features: [] }, validAdjacency(["f_p_sp_0"])), /not a FeatureCollection/);
    assert.throws(() => parse(null, null), /not a FeatureCollection/);
  });

  it("fails on a malformed kind value", () => {
    const fc = validSubprovince(1);
    fc.features[0].properties.kind = "castle";
    assert.throws(() => parse(fc, validAdjacency(["f_p_sp_0"])), /invalid kind/);
  });

  it("accepts a MultiPolygon and exposes one ring per part", () => {
    const fc = validSubprovince(1);
    fc.features[0].geometry = {
      type: "MultiPolygon",
      coordinates: [
        [[[0, 0], [0, 1], [1, 1], [0, 0]]],
        [[[2, 2], [2, 3], [3, 3], [2, 2]]],
      ],
    };
    const graph = parse(fc, validAdjacency(["f_p_sp_0"]));
    assert.strictEqual(graph.nodes.get("f_p_sp_0")!.polygon.length, 2);
  });

  it("fails when geometry has no readable rings", () => {
    const fc = validSubprovince(1);
    fc.features[0].geometry = { type: "Polygon", coordinates: [] };
    assert.throws(() => parse(fc, validAdjacency(["f_p_sp_0"])), /Polygon or MultiPolygon/);
  });

  it("accepts zero-area artifact geometries with empty polygon rings", () => {
    const fc = validSubprovince(1);
    fc.features[0].geometry = { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[0, 0], [2, 2]]] };
    const graph = parse(fc, validAdjacency(["f_p_sp_0"]));
    assert.deepStrictEqual(graph.nodes.get("f_p_sp_0")!.polygon, []);
  });

  it("fails when adjacency references an unknown subprovince id", () => {
    assert.throws(
      () => parse(validSubprovince(1), validAdjacency(["f_p_sp_0", "ghost_id"])),
      /unknown subprovince/,
    );
  });

  it("fails when a subprovince is missing from the adjacency file", () => {
    assert.throws(
      () => parse(validSubprovince(3), validAdjacency(["f_p_sp_0"])),
      /missing from adjacency file/,
    );
  });

  it("exposes neighbor lists as plain string arrays keyed by id", () => {
    const fc = validSubprovince(3);
    const adj = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: null, properties: { subprovince_id: "f_p_sp_0", neighbors: ["f_p_sp_1", "f_p_sp_2"] } },
        { type: "Feature", geometry: null, properties: { subprovince_id: "f_p_sp_1", neighbors: ["f_p_sp_0"] } },
        { type: "Feature", geometry: null, properties: { subprovince_id: "f_p_sp_2", neighbors: ["f_p_sp_0"] } },
      ],
    };
    const graph = parse(fc, adj);
    assert.deepStrictEqual(graph.neighbors.get("f_p_sp_0"), ["f_p_sp_1", "f_p_sp_2"]);
    assert.ok(Array.isArray(graph.neighbors.get("f_p_sp_1")));
  });
});