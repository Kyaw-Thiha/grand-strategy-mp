import assert from "assert";
import { describe, it } from "mocha";
import { buildProvinceNeighbors, isBorderingStance } from "../src/systems/air_mission_targeting.js";
import { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { RelationState } from "../src/rooms/schema/GameRoomState.js";
import { ProvinceState } from "../src/rooms/schema/GameRoomState.js";

describe("lane:air-combat | Province neighbor graph", () => {
  it("builds an undirected neighbor map from one-directional adjacency edges", () => {
    const neighbors = buildProvinceNeighbors([
      { from_province: "a", to_province: "b" },
      { from_province: "b", to_province: "c" },
    ]);
    assert.deepStrictEqual([...neighbors.get("a")!].sort(), ["b"]);
    assert.deepStrictEqual([...neighbors.get("b")!].sort(), ["a", "c"]);
    assert.deepStrictEqual([...neighbors.get("c")!].sort(), ["b"]);
  });

  it("isBorderingStance is true when a neighbor province is owned by a war-stance nation", () => {
    const state = new GameRoomState();
    const a = new ProvinceState(); a.province_id = "a"; a.owner_id = "france";
    const b = new ProvinceState(); b.province_id = "b"; b.owner_id = "germany";
    state.provinces.set("a", a);
    state.provinces.set("b", b);
    const rel = new RelationState(); rel.from_id = "france"; rel.to_id = "germany"; rel.stance = "war";
    state.relations.set("france|germany", rel);
    const neighbors = buildProvinceNeighbors([{ from_province: "a", to_province: "b" }]);

    assert.strictEqual(isBorderingStance("a", "france", "war", state, neighbors), true);
    assert.strictEqual(isBorderingStance("a", "france", "neutral", state, neighbors), false);
  });

  it("isBorderingStance evaluates from the searching nation, not the province owner — allied airbase case", () => {
    // Province "a" is owned by an ALLY of "britain", not by britain itself.
    // "a" borders "b" (germany, at war with britain). This must still count as a
    // war-border for a British wing based at "a".
    const state = new GameRoomState();
    const a = new ProvinceState(); a.province_id = "a"; a.owner_id = "france";
    const b = new ProvinceState(); b.province_id = "b"; b.owner_id = "germany";
    state.provinces.set("a", a);
    state.provinces.set("b", b);
    const relBritainGermany = new RelationState();
    relBritainGermany.from_id = "britain"; relBritainGermany.to_id = "germany"; relBritainGermany.stance = "war";
    state.relations.set("britain|germany", relBritainGermany);
    const neighbors = buildProvinceNeighbors([{ from_province: "a", to_province: "b" }]);

    assert.strictEqual(isBorderingStance("a", "britain", "war", state, neighbors), true);
  });

  it("returns false for a province with no neighbors in the map", () => {
    const state = new GameRoomState();
    const neighbors = buildProvinceNeighbors([]);
    assert.strictEqual(isBorderingStance("isolated", "france", "war", state, neighbors), false);
  });
});
