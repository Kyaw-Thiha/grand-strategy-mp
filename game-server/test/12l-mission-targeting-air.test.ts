import assert from "assert";
import { describe, it } from "mocha";
import { scoreCandidate, buildClaimsRegistry } from "../src/systems/air_mission_targeting.js";
import { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { AirWingState, MISSION_TYPES } from "../src/rooms/schema/AirWingState.js";

describe("lane:air-combat | Shared crowd-balance and scoring", () => {
  it("closer candidates score higher than farther ones at equal claim count", () => {
    const near = scoreCandidate(0.1, 0);
    const far  = scoreCandidate(2.0, 0);
    assert.ok(near > far);
  });

  it("a candidate with more existing claims scores lower than an equally-distant less-claimed one", () => {
    const uncrowded = scoreCandidate(1.0, 0);
    const crowded   = scoreCandidate(1.0, 3);
    assert.ok(uncrowded > crowded);
  });

  it("buildClaimsRegistry counts wings by mission+target_id, keyed by target_id", () => {
    const state = new GameRoomState();
    const w1 = new AirWingState(); w1.wing_id = "w1"; w1.mission = MISSION_TYPES.TACTICAL_BOMBING; w1.target_id = "div_1";
    const w2 = new AirWingState(); w2.wing_id = "w2"; w2.mission = MISSION_TYPES.TACTICAL_BOMBING; w2.target_id = "div_1";
    const w3 = new AirWingState(); w3.wing_id = "w3"; w3.mission = MISSION_TYPES.TACTICAL_BOMBING; w3.target_id = "div_2";
    state.air_wings.set("w1", w1); state.air_wings.set("w2", w2); state.air_wings.set("w3", w3);
    const claims = buildClaimsRegistry(state);
    assert.strictEqual(claims.get("div_1"), 2);
    assert.strictEqual(claims.get("div_2"), 1);
    assert.strictEqual(claims.get("nonexistent") ?? 0, 0);
  });
});
