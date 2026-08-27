import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findSupplyRoute, findRetreatPath } from "../src/systems/supply_graph.js";
import { ring, computeSupplyTier } from "../src/systems/supply_system.js";
import type { SubprovinceGraph } from "../src/data/map_loader.js";

function def(id: string, provinceId: string, kind: "road" | "hinterland" | "capital") {
  return { id, provinceId, kind, coverCombat: null, elevationType: null, isCapital: kind === "capital", polygon: [] };
}

function graphOf(nodes: Array<ReturnType<typeof def>>, edges: Array<[string, string]>): SubprovinceGraph {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const neighbors = new Map<string, string[]>();
  for (const n of nodes) neighbors.set(n.id, []);
  for (const [a, b] of edges) { neighbors.get(a)!.push(b); neighbors.get(b)!.push(a); }
  return { nodes: nodeMap, neighbors };
}

describe("lane:subprovince | supply graph core", () => {
  it("prefers a road route over an equal-length off-road route", () => {
    const graph = graphOf(
      [def("start", "p1", "hinterland"), def("road1", "p1", "road"), def("hub", "p1", "capital"), def("off1", "p1", "hinterland")],
      [["start", "road1"], ["road1", "hub"], ["start", "off1"], ["off1", "hub"]],
    );
    const ownership = new Map([
      ["start", { ownerId: "fr", provinceId: "p1" }], ["road1", { ownerId: "fr", provinceId: "p1" }],
      ["hub", { ownerId: "fr", provinceId: "p1" }], ["off1", { ownerId: "fr", provinceId: "p1" }],
    ]);
    const route = findSupplyRoute(graph, ownership, new Set(["hub"]), "start", "fr", () => true, () => false, "d1");
    assert.deepEqual(route.subprovinceIds, ["start", "road1", "hub"]);
    assert.equal(route.status, "open");
  });

  it("accepts an off-road-only route with reduced throughputRatio strictly between full-road and full-off-road", () => {
    const graph = graphOf(
      [def("start", "p1", "hinterland"), def("mid", "p1", "hinterland"), def("hub", "p1", "capital")],
      [["start", "mid"], ["mid", "hub"]],
    );
    const ownership = new Map([
      ["start", { ownerId: "fr", provinceId: "p1" }], ["mid", { ownerId: "fr", provinceId: "p1" }], ["hub", { ownerId: "fr", provinceId: "p1" }],
    ]);
    const route = findSupplyRoute(graph, ownership, new Set(["hub"]), "start", "fr", () => true, () => false, "d1");
    assert.ok(route.throughputRatio < 1.0 && route.throughputRatio > 0, `expected 0 < ratio < 1, got ${route.throughputRatio}`);
    assert.equal(route.status, "degraded");
  });

  it("enemy-occupied cell is traversable only for the occupying division's own search", () => {
    const graph = graphOf(
      [def("start", "p1", "hinterland"), def("enemy", "p1", "hinterland"), def("hub", "p1", "capital")],
      [["start", "enemy"], ["enemy", "hub"]],
    );
    const ownership = new Map([
      ["start", { ownerId: "fr", provinceId: "p1" }], ["enemy", { ownerId: "de", provinceId: "p1" }], ["hub", { ownerId: "fr", provinceId: "p1" }],
    ]);
    const isFriendly = (owner: string) => owner === "fr";
    const routeForOccupier = findSupplyRoute(graph, ownership, new Set(["hub"]), "start", "fr", isFriendly, (id) => id === "enemy", "occupier");
    assert.equal(routeForOccupier.status, "open");
    assert.equal(routeForOccupier.blockedSubprovinceId, "enemy");

    const routeForOther = findSupplyRoute(graph, ownership, new Set(["hub"]), "start", "fr", isFriendly, () => false, "other");
    assert.equal(routeForOther.status, "cut_off");
  });

  it("returns cut_off with no path under valid_edge", () => {
    const graph = graphOf([def("start", "p1", "hinterland"), def("hub", "p1", "capital")], []);
    const ownership = new Map([["start", { ownerId: "fr", provinceId: "p1" }], ["hub", { ownerId: "fr", provinceId: "p1" }]]);
    const route = findSupplyRoute(graph, ownership, new Set(["hub"]), "start", "fr", () => true, () => false, "d1");
    assert.equal(route.status, "cut_off");
    assert.equal(route.sourceHubId, null);
    assert.deepEqual(route.subprovinceIds, ["start"]);
    assert.equal(route.throughputRatio, 0);
  });

  it("deterministic tie-break: reordering the neighbors map does not change the selected route", () => {
    const graph1 = graphOf(
      [def("start", "p1", "hinterland"), def("a", "p1", "road"), def("b", "p1", "road"), def("hub", "p1", "capital")],
      [["start", "a"], ["a", "hub"], ["start", "b"], ["b", "hub"]],
    );
    const reorderedNeighbors = new Map([...graph1.neighbors].reverse());
    const graph2: SubprovinceGraph = { nodes: graph1.nodes, neighbors: reorderedNeighbors };
    const ownership = new Map([
      ["start", { ownerId: "fr", provinceId: "p1" }], ["a", { ownerId: "fr", provinceId: "p1" }],
      ["b", { ownerId: "fr", provinceId: "p1" }], ["hub", { ownerId: "fr", provinceId: "p1" }],
    ]);
    const r1 = findSupplyRoute(graph1, ownership, new Set(["hub"]), "start", "fr", () => true, () => false, "d1");
    const r2 = findSupplyRoute(graph2, ownership, new Set(["hub"]), "start", "fr", () => true, () => false, "d1");
    assert.deepEqual(r1.subprovinceIds, r2.subprovinceIds);
  });

  it("nearest reachable hub wins among multiple candidates, not first-in-iteration-order", () => {
    // hubNear is one hop from start (direct edge); hubFar is two hops (via far1). This is a
    // genuine cost difference — the brief's original fixture connected both hubs via a single
    // intermediate road cell each, making them exactly equidistant and unable to exercise
    // "nearest wins" at all (it just reproduced insertion-order tie-breaking).
    const graph = graphOf(
      [def("start", "p1", "hinterland"), def("hubNear", "p1", "capital"), def("far1", "p1", "road"), def("hubFar", "p1", "capital")],
      [["start", "hubNear"], ["start", "far1"], ["far1", "hubFar"]],
    );
    const ownership = new Map([
      ["start", { ownerId: "fr", provinceId: "p1" }], ["hubNear", { ownerId: "fr", provinceId: "p1" }],
      ["far1", { ownerId: "fr", provinceId: "p1" }], ["hubFar", { ownerId: "fr", provinceId: "p1" }],
    ]);
    const route = findSupplyRoute(graph, ownership, new Set(["hubFar", "hubNear"]), "start", "fr", () => true, () => false, "d1");
    assert.equal(route.sourceHubId, "hubNear");
  });
});

describe("lane:subprovince | ring-based supply tier", () => {
  const isFriendlyUs = (owner: string) => owner === "us";

  describe("ring", () => {
    it("returns nodes at exact hop-distance n, not within-n", () => {
      // s -> {a,b,c} (ring 1) -> {d,e} (ring 2, reachable only via a/b)
      const graph = graphOf(
        [def("s", "p1", "hinterland"), def("a", "p1", "hinterland"), def("b", "p1", "hinterland"),
         def("c", "p1", "hinterland"), def("d", "p1", "hinterland"), def("e", "p1", "hinterland")],
        [["s", "a"], ["s", "b"], ["s", "c"], ["a", "d"], ["b", "e"]],
      );
      assert.deepEqual([...ring(graph, "s", 1)].sort(), ["a", "b", "c"]);
      assert.deepEqual([...ring(graph, "s", 2)].sort(), ["d", "e"]);
    });

    it("returns an empty array once n exceeds the graph's radius from start", () => {
      const graph = graphOf(
        [def("s", "p1", "hinterland"), def("a", "p1", "hinterland")],
        [["s", "a"]],
      );
      assert.deepEqual(ring(graph, "s", 5), []);
    });

    it("excludes the start node and closer rings from a farther ring", () => {
      const graph = graphOf(
        [def("s", "p1", "hinterland"), def("a", "p1", "hinterland"), def("b", "p1", "hinterland")],
        [["s", "a"], ["a", "b"]],
      );
      assert.deepEqual(ring(graph, "s", 2), ["b"]);
      assert.ok(!ring(graph, "s", 2).includes("s"));
      assert.ok(!ring(graph, "s", 2).includes("a"));
    });
  });

  describe("computeSupplyTier", () => {
    it("is encircled when ring(1) and ring(2) are entirely non-friendly, regardless of ring(3)", () => {
      // s -[a1,a2: enemy, ring1]- -[b1,b2: enemy, ring2]- -[c1,c2: friendly, ring3]
      const graph = graphOf(
        [def("s", "p1", "hinterland"), def("a1", "p1", "hinterland"), def("a2", "p1", "hinterland"),
         def("b1", "p1", "hinterland"), def("b2", "p1", "hinterland"),
         def("c1", "p1", "hinterland"), def("c2", "p1", "hinterland")],
        [["s", "a1"], ["s", "a2"], ["a1", "b1"], ["a2", "b2"], ["b1", "c1"], ["b2", "c2"]],
      );
      const ownership = new Map([
        ["s", { ownerId: "us", provinceId: "p1" }],
        ["a1", { ownerId: "de", provinceId: "p1" }], ["a2", { ownerId: "de", provinceId: "p1" }],
        ["b1", { ownerId: "de", provinceId: "p1" }], ["b2", { ownerId: "de", provinceId: "p1" }],
        ["c1", { ownerId: "us", provinceId: "p1" }], ["c2", { ownerId: "us", provinceId: "p1" }],
      ]);
      const tier = computeSupplyTier(graph, ownership, new Set(), isFriendlyUs, "s");
      assert.equal(tier, "encircled");
    });

    it("is cut_off when only ring(3) is entirely non-friendly and ring(1)/(2) still have friendly presence", () => {
      const graph = graphOf(
        [def("s", "p1", "hinterland"), def("a1", "p1", "hinterland"), def("a2", "p1", "hinterland"),
         def("b1", "p1", "hinterland"), def("b2", "p1", "hinterland"),
         def("c1", "p1", "hinterland"), def("c2", "p1", "hinterland")],
        [["s", "a1"], ["s", "a2"], ["a1", "b1"], ["a2", "b2"], ["b1", "c1"], ["b2", "c2"]],
      );
      const ownership = new Map([
        ["s", { ownerId: "us", provinceId: "p1" }],
        ["a1", { ownerId: "us", provinceId: "p1" }], ["a2", { ownerId: "us", provinceId: "p1" }],
        ["b1", { ownerId: "us", provinceId: "p1" }], ["b2", { ownerId: "us", provinceId: "p1" }],
        ["c1", { ownerId: "de", provinceId: "p1" }], ["c2", { ownerId: "de", provinceId: "p1" }],
      ]);
      // No hubs reachable, so pathExists is false even though ring(1)/(2) are friendly-owned —
      // findSupplyRoute-style throughput/hub-reachability is a separate concern from this test.
      const tier = computeSupplyTier(graph, ownership, new Set(), isFriendlyUs, "s");
      assert.equal(tier, "cut_off");
    });

    it("is normal for an off-road-only but fully friendly-connected path to a hub (Tier 1 Correction)", () => {
      // Every hop is "hinterland" (off-road) — the Tier 1 Correction says this still counts as
      // connected for reachability; only throughput (a Batch 5 concern) would be reduced.
      const graph = graphOf(
        [def("s", "p1", "hinterland"), def("mid", "p1", "hinterland"), def("hub", "p1", "hinterland")],
        [["s", "mid"], ["mid", "hub"]],
      );
      const ownership = new Map([
        ["s", { ownerId: "us", provinceId: "p1" }],
        ["mid", { ownerId: "us", provinceId: "p1" }],
        ["hub", { ownerId: "us", provinceId: "p1" }],
      ]);
      const tier = computeSupplyTier(graph, ownership, new Set(["hub"]), isFriendlyUs, "s");
      assert.equal(tier, "normal");
    });

    it("is out_of_supply when no ring(1)/(2)/(3) is entirely non-friendly, but no path to a hub exists", () => {
      // Friendly presence survives in every ring (a1, b2, c1), but no hub is reachable at all
      // (hubs is empty), so the division is loosely disconnected rather than sealed at any ring.
      const graph = graphOf(
        [def("s", "p1", "hinterland"), def("a1", "p1", "hinterland"), def("a2", "p1", "hinterland"),
         def("b1", "p1", "hinterland"), def("b2", "p1", "hinterland"),
         def("c1", "p1", "hinterland"), def("c2", "p1", "hinterland")],
        [["s", "a1"], ["s", "a2"], ["a1", "b1"], ["a2", "b2"], ["b1", "c1"], ["b2", "c2"]],
      );
      const ownership = new Map([
        ["s", { ownerId: "us", provinceId: "p1" }],
        ["a1", { ownerId: "us", provinceId: "p1" }], ["a2", { ownerId: "de", provinceId: "p1" }],
        ["b1", { ownerId: "de", provinceId: "p1" }], ["b2", { ownerId: "us", provinceId: "p1" }],
        ["c1", { ownerId: "us", provinceId: "p1" }], ["c2", { ownerId: "de", provinceId: "p1" }],
      ]);
      const tier = computeSupplyTier(graph, ownership, new Set(), isFriendlyUs, "s");
      assert.equal(tier, "out_of_supply");
    });
  });
});

describe("lane:subprovince | retreat-cost graph search", () => {
  const isFriendlyFr = (owner: string) => owner === "fr";
  const neverFrozen = () => false;

  it("can traverse enemy-owned unoccupied ground, unlike findSupplyRoute in the same topology", () => {
    const graph = graphOf(
      [def("start", "p1", "hinterland"), def("enemy", "p1", "hinterland"), def("hub", "p1", "capital")],
      [["start", "enemy"], ["enemy", "hub"]],
    );
    const ownership = new Map([
      ["start", { ownerId: "fr", provinceId: "p1" }],
      ["enemy", { ownerId: "de", provinceId: "p1" }],
      ["hub", { ownerId: "fr", provinceId: "p1" }],
    ]);

    // findSupplyRoute is cut_off in this topology (no occupied-by-requester exception applies).
    const supplyRoute = findSupplyRoute(graph, ownership, new Set(["hub"]), "start", "fr", isFriendlyFr, () => false, "d1");
    assert.equal(supplyRoute.status, "cut_off");

    // findRetreatPath succeeds by crossing the enemy cell at the expensive tier.
    const retreat = findRetreatPath(graph, ownership, new Set(["hub"]), "start", "fr", isFriendlyFr, neverFrozen);
    assert.deepEqual(retreat.subprovinceIds, ["start", "enemy", "hub"]);
  });

  it("blockedFraction is 0 for an all-friendly path", () => {
    const graph = graphOf(
      [def("start", "p1", "hinterland"), def("mid", "p1", "hinterland"), def("hub", "p1", "capital")],
      [["start", "mid"], ["mid", "hub"]],
    );
    const ownership = new Map([
      ["start", { ownerId: "fr", provinceId: "p1" }],
      ["mid", { ownerId: "fr", provinceId: "p1" }],
      ["hub", { ownerId: "fr", provinceId: "p1" }],
    ]);
    const retreat = findRetreatPath(graph, ownership, new Set(["hub"]), "start", "fr", isFriendlyFr, neverFrozen);
    assert.deepEqual(retreat.subprovinceIds, ["start", "mid", "hub"]);
    assert.equal(retreat.blockedFraction, 0);
  });

  it("blockedFraction is 1 for a path with no friendly ground reachable before the target", () => {
    const graph = graphOf(
      [def("start", "p1", "hinterland"), def("enemy", "p1", "hinterland"), def("hub", "p1", "capital")],
      [["start", "enemy"], ["enemy", "hub"]],
    );
    const ownership = new Map([
      ["start", { ownerId: "fr", provinceId: "p1" }],
      ["enemy", { ownerId: "de", provinceId: "p1" }],
      ["hub", { ownerId: "fr", provinceId: "p1" }],
    ]);
    const retreat = findRetreatPath(graph, ownership, new Set(["hub"]), "start", "fr", isFriendlyFr, neverFrozen);
    assert.deepEqual(retreat.subprovinceIds, ["start", "enemy", "hub"]);
    assert.equal(retreat.blockedFraction, 1);
  });

  it("blockedFraction is proportional for a mixed path (1 enemy hop out of 3 total -> 1/3)", () => {
    const graph = graphOf(
      [
        def("start", "p1", "hinterland"), def("h1", "p1", "hinterland"), def("h2", "p1", "hinterland"),
        def("h3", "p1", "hinterland"), def("hub", "p1", "capital"),
      ],
      [["start", "h1"], ["h1", "h2"], ["h2", "h3"], ["h3", "hub"]],
    );
    const ownership = new Map([
      ["start", { ownerId: "fr", provinceId: "p1" }],
      ["h1", { ownerId: "fr", provinceId: "p1" }],
      ["h2", { ownerId: "de", provinceId: "p1" }],
      ["h3", { ownerId: "fr", provinceId: "p1" }],
      ["hub", { ownerId: "fr", provinceId: "p1" }],
    ]);
    const retreat = findRetreatPath(graph, ownership, new Set(["hub"]), "start", "fr", isFriendlyFr, neverFrozen);
    assert.deepEqual(retreat.subprovinceIds, ["start", "h1", "h2", "h3", "hub"]);
    assert.equal(retreat.blockedFraction, 1 / 3);
  });

  it("prefers a longer friendly-only path over a shorter path that crosses enemy ground", () => {
    // Direct route start -> enemy -> hub is 1 hop through enemy ground (cost 20 * road-throughput
    // inversion at minimum = 20). The friendly detour start -> a -> b -> hub is 3 friendly
    // off-road hops (cost 2.0 each = 6 total, since "a"/"b" are "hinterland" rather than "road"
    // so they don't themselves qualify as retreat targets and terminate the search early), which
    // is cheaper than the single enemy hop despite having more hops — this is only true because
    // of the cost-tier ordering, not hop count.
    const graph = graphOf(
      [
        def("start", "p1", "hinterland"), def("enemy", "p1", "road"), def("hub", "p1", "capital"),
        def("a", "p1", "hinterland"), def("b", "p1", "hinterland"),
      ],
      [["start", "enemy"], ["enemy", "hub"], ["start", "a"], ["a", "b"], ["b", "hub"]],
    );
    const ownership = new Map([
      ["start", { ownerId: "fr", provinceId: "p1" }],
      ["enemy", { ownerId: "de", provinceId: "p1" }],
      ["hub", { ownerId: "fr", provinceId: "p1" }],
      ["a", { ownerId: "fr", provinceId: "p1" }],
      ["b", { ownerId: "fr", provinceId: "p1" }],
    ]);
    const retreat = findRetreatPath(graph, ownership, new Set(["hub"]), "start", "fr", isFriendlyFr, neverFrozen);
    assert.deepEqual(retreat.subprovinceIds, ["start", "a", "b", "hub"]);
    assert.equal(retreat.blockedFraction, 0);
  });

  it("contested (combat-frozen) ground costs less than non-frozen enemy ground", () => {
    // Two single-hop routes to the same-cost target: one through a combat-frozen enemy cell,
    // one through a non-frozen enemy cell. The frozen route must win since contested < enemy/neutral.
    const graph = graphOf(
      [
        def("start", "p1", "hinterland"), def("frozen", "p1", "hinterland"), def("hubA", "p1", "capital"),
        def("cold", "p1", "hinterland"), def("hubB", "p1", "capital"),
      ],
      [["start", "frozen"], ["frozen", "hubA"], ["start", "cold"], ["cold", "hubB"]],
    );
    const ownership = new Map([
      ["start", { ownerId: "fr", provinceId: "p1" }],
      ["frozen", { ownerId: "de", provinceId: "p1" }],
      ["hubA", { ownerId: "fr", provinceId: "p1" }],
      ["cold", { ownerId: "de", provinceId: "p1" }],
      ["hubB", { ownerId: "fr", provinceId: "p1" }],
    ]);
    const isCombatFrozen = (id: string) => id === "frozen";
    const retreat = findRetreatPath(graph, ownership, new Set(["hubA", "hubB"]), "start", "fr", isFriendlyFr, isCombatFrozen);
    assert.deepEqual(retreat.subprovinceIds, ["start", "frozen", "hubA"]);
  });

  it("deterministic tie-break: reordering the neighbors map does not change the selected path", () => {
    const graph1 = graphOf(
      [def("start", "p1", "hinterland"), def("a", "p1", "road"), def("b", "p1", "road"), def("hub", "p1", "capital")],
      [["start", "a"], ["a", "hub"], ["start", "b"], ["b", "hub"]],
    );
    const reorderedNeighbors = new Map([...graph1.neighbors].reverse());
    const graph2: SubprovinceGraph = { nodes: graph1.nodes, neighbors: reorderedNeighbors };
    const ownership = new Map([
      ["start", { ownerId: "fr", provinceId: "p1" }], ["a", { ownerId: "fr", provinceId: "p1" }],
      ["b", { ownerId: "fr", provinceId: "p1" }], ["hub", { ownerId: "fr", provinceId: "p1" }],
    ]);
    const r1 = findRetreatPath(graph1, ownership, new Set(["hub"]), "start", "fr", isFriendlyFr, neverFrozen);
    const r2 = findRetreatPath(graph2, ownership, new Set(["hub"]), "start", "fr", isFriendlyFr, neverFrozen);
    assert.deepEqual(r1.subprovinceIds, r2.subprovinceIds);
  });

  it("returns the start cell with blockedFraction 0 when the start is already a valid retreat target", () => {
    const graph = graphOf([def("start", "p1", "road")], []);
    const ownership = new Map([["start", { ownerId: "fr", provinceId: "p1" }]]);
    const retreat = findRetreatPath(graph, ownership, new Set(), "start", "fr", isFriendlyFr, neverFrozen);
    assert.deepEqual(retreat.subprovinceIds, ["start"]);
    assert.equal(retreat.blockedFraction, 0);
  });

  it("falls back to the start cell with blockedFraction 0 when the graph is disconnected from start", () => {
    const graph = graphOf([def("start", "p1", "hinterland"), def("hub", "p1", "capital")], []);
    const ownership = new Map([
      ["start", { ownerId: "fr", provinceId: "p1" }],
      ["hub", { ownerId: "fr", provinceId: "p1" }],
    ]);
    const retreat = findRetreatPath(graph, ownership, new Set(["hub"]), "start", "fr", isFriendlyFr, neverFrozen);
    assert.deepEqual(retreat.subprovinceIds, ["start"]);
    assert.equal(retreat.blockedFraction, 0);
  });
});
