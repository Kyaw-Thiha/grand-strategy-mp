import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SubprovinceSystem } from "../src/systems/subprovince_system.js";
import { GameRoomState, ProvinceState, DivisionState } from "../src/rooms/schema/GameRoomState.js";

const noop = () => {};

/** Real western_europe_6 subprovince cells with centroids verified (via a one-off probe script)
 *  to resolve back to themselves through SubprovinceSystem.getSubprovinceAtPosition, so tests can
 *  exercise real polygon data without depending on any particular cell's exact geometry. */
const ALBANIA_PROVINCE_ID = "we6_albania_01";
const ALBANIA_CELL_A = { id: "we6_albania_01_sp_1", lng: 20.281317477125427, lat: 39.93642136794463 };
const ALBANIA_CELL_B = { id: "we6_albania_01_sp_10", lng: 19.961995780816245, lat: 41.193797385506066 };
const AUSTRIA_PROVINCE_ID = "we6_austria_01";
const AUSTRIA_CAPITAL_CELL = { id: "we6_austria_01_sp_0", lng: 16.256885297297295, lat: 47.90904000900901 };

function makeDivision(nationId: string, position: { lng: number; lat: number }, combatState = "idle"): DivisionState {
  const division = new DivisionState();
  division.division_id = `${nationId}-${position.lng}-${position.lat}-${Math.random()}`;
  division.nation_id = nationId;
  division.position_lng = position.lng;
  division.position_lat = position.lat;
  division.combat_state = combatState;
  return division;
}

function makeState(): { state: GameRoomState; sys: SubprovinceSystem } {
  const sys = new SubprovinceSystem();
  sys.loadForRoom("western_europe_6");
  const state = new GameRoomState();

  const albania = new ProvinceState();
  albania.province_id = ALBANIA_PROVINCE_ID;
  albania.owner_id = "albania";
  state.provinces.set(ALBANIA_PROVINCE_ID, albania);

  const austria = new ProvinceState();
  austria.province_id = AUSTRIA_PROVINCE_ID;
  austria.owner_id = "austria";
  state.provinces.set(AUSTRIA_PROVINCE_ID, austria);

  sys.initializeOwnership(state);
  return { state, sys };
}

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

  it("captures a non-capital cell via literal occupancy by an idle enemy division", () => {
    const { state, sys } = makeState();
    const division = makeDivision("germany", ALBANIA_CELL_A, "idle");
    state.divisions.set(division.division_id, division);

    const deltas = sys.checkCaptureAfterMovement(division, state, noop);

    assert.equal(deltas.length, 1);
    assert.deepEqual(deltas[0], { subprovinceId: ALBANIA_CELL_A.id, newOwner: "germany" });
    assert.equal(state.subprovinces.get(ALBANIA_CELL_A.id)!.owner_id, "germany");
  });

  it("never flips a capital-kind cell via checkCaptureAfterMovement", () => {
    const { state, sys } = makeState();
    const division = makeDivision("germany", AUSTRIA_CAPITAL_CELL, "idle");
    state.divisions.set(division.division_id, division);

    const deltas = sys.checkCaptureAfterMovement(division, state, noop);

    assert.equal(deltas.length, 0);
    assert.equal(state.subprovinces.get(AUSTRIA_CAPITAL_CELL.id)!.owner_id, "austria");
  });

  it("does not capture while retreating or destroyed", () => {
    for (const combatState of ["retreating", "destroyed"]) {
      const { state, sys } = makeState();
      const division = makeDivision("germany", ALBANIA_CELL_A, combatState);
      state.divisions.set(division.division_id, division);

      const deltas = sys.checkCaptureAfterMovement(division, state, noop);

      assert.equal(deltas.length, 0, `expected no capture while ${combatState}`);
      assert.equal(state.subprovinces.get(ALBANIA_CELL_A.id)!.owner_id, "albania");
    }
  });

  it("freezes a cell under active combat regardless of division processing order within the tick", () => {
    const { state, sys } = makeState();
    const engaged = makeDivision("belgium", ALBANIA_CELL_A, "engaged");
    const idle = makeDivision("germany", ALBANIA_CELL_A, "idle");
    const thirdParty = makeDivision("france", ALBANIA_CELL_A, "idle");
    state.divisions.set(engaged.division_id, engaged);
    state.divisions.set(idle.division_id, idle);
    state.divisions.set(thirdParty.division_id, thirdParty);

    // Full freeze-scan pass must run before any capture pass, per resetFreezeTracking's contract.
    sys.resetFreezeTracking();
    sys.scanCombatFreeze(state.divisions.values());

    // Process the idle (would-be capturer) divisions BEFORE the engaged division to prove the
    // freeze marker is already in place regardless of iteration order.
    const idleDeltas = sys.checkCaptureAfterMovement(idle, state, noop);
    const thirdPartyDeltas = sys.checkCaptureAfterMovement(thirdParty, state, noop);
    const engagedDeltas = sys.checkCaptureAfterMovement(engaged, state, noop);

    assert.equal(idleDeltas.length, 0);
    assert.equal(thirdPartyDeltas.length, 0);
    assert.equal(engagedDeltas.length, 0);
    assert.equal(state.subprovinces.get(ALBANIA_CELL_A.id)!.owner_id, "albania");
  });

  it("keeps captured ownership sticky across an unrelated second checkCaptureAfterMovement pass", () => {
    const { state, sys } = makeState();
    const capturer = makeDivision("germany", ALBANIA_CELL_A, "idle");
    const elsewhereInProvince = makeDivision("germany", ALBANIA_CELL_B, "idle");
    state.divisions.set(capturer.division_id, capturer);
    state.divisions.set(elsewhereInProvince.division_id, elsewhereInProvince);

    const firstPass = sys.checkCaptureAfterMovement(capturer, state, noop);
    assert.equal(firstPass.length, 1);
    assert.equal(state.subprovinces.get(ALBANIA_CELL_A.id)!.owner_id, "germany");

    // Second, unrelated pass over the same division (already owns the cell) must not disturb it.
    const secondPass = sys.checkCaptureAfterMovement(capturer, state, noop);
    assert.equal(secondPass.length, 0);
    assert.equal(state.subprovinces.get(ALBANIA_CELL_A.id)!.owner_id, "germany");
  });

  it("reverts every captured cell in a province when the attacker's last division there is gone", () => {
    const { state, sys } = makeState();
    const divisionA = makeDivision("germany", ALBANIA_CELL_A, "idle");
    const divisionB = makeDivision("germany", ALBANIA_CELL_B, "idle");
    state.divisions.set(divisionA.division_id, divisionA);
    state.divisions.set(divisionB.division_id, divisionB);

    assert.equal(sys.checkCaptureAfterMovement(divisionA, state, noop).length, 1);
    assert.equal(sys.checkCaptureAfterMovement(divisionB, state, noop).length, 1);
    assert.equal(state.subprovinces.get(ALBANIA_CELL_A.id)!.owner_id, "germany");
    assert.equal(state.subprovinces.get(ALBANIA_CELL_B.id)!.owner_id, "germany");

    // Remove germany's only presence in the province.
    divisionA.combat_state = "destroyed";
    divisionB.combat_state = "destroyed";

    const revertDeltas = sys.revertNationCaptureIfProvinceEmpty("germany", ALBANIA_PROVINCE_ID, state, noop);

    const revertedIds = revertDeltas.map((d) => d.subprovinceId).sort();
    assert.deepEqual(revertedIds, [ALBANIA_CELL_A.id, ALBANIA_CELL_B.id].sort());
    for (const delta of revertDeltas) assert.equal(delta.newOwner, "albania");
    assert.equal(state.subprovinces.get(ALBANIA_CELL_A.id)!.owner_id, "albania");
    assert.equal(state.subprovinces.get(ALBANIA_CELL_B.id)!.owner_id, "albania");
  });
});
