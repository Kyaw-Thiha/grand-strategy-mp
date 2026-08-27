import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { SubprovinceSystem } from "../src/systems/subprovince_system.js";
import { GameRoomState, ProvinceState, DivisionState } from "../src/rooms/schema/GameRoomState.js";

describe("lane:subprovince | SubprovinceSystem core", () => {
  it("initializes subprovince owner_id from province owner_id", () => {
    const sys = new SubprovinceSystem();
    sys.loadForRoom("western_europe_6");
    const state = new GameRoomState();
    const province = new ProvinceState();
    province.province_id = "we6_germany_01";
    province.owner_id = "germany";
    state.provinces.set("we6_germany_01", province);

    sys.initializeOwnership(state);

    let sawGermanCell = false;
    for (const [, sp] of state.subprovinces) {
      if (sp.province_id === "we6_germany_01") {
        assert.equal(sp.owner_id, "germany");
        sawGermanCell = true;
      }
    }
    assert.ok(sawGermanCell, "expected at least one we6_germany_01 subprovince");
  });

  it("getSubprovinceAtPosition returns null outside all known polygons", () => {
    const sys = new SubprovinceSystem();
    sys.loadForRoom("western_europe_6");
    assert.equal(sys.getSubprovinceAtPosition({ lng: -999, lat: -999 }), null);
  });
});
