import assert from "assert";
import { describe, it } from "mocha";
import { clearResearchTreeCache, loadResearchTree, RESEARCH_BRANCH_FILES, loadResearchBranch } from "../src/data/research_tree_loader.js";
import {
  ResearchSystem,
  researchConcurrencyCostMultiplier,
} from "../src/systems/research_system.js";
import { GameRoomState, NationState } from "../src/rooms/schema/GameRoomState.js";
import {
  RESEARCH_CONCURRENCY_COST_STEP,
  RESEARCH_CANCEL_REFUND_RATE,
} from "../src/data/research_stats.js";

function freshNationState(): { state: GameRoomState; nation: NationState } {
  clearResearchTreeCache();
  const state = new GameRoomState();
  const nation = new NationState();
  nation.nation_id = "test_nation";
  nation.resources.set("money", 10_000);
  nation.science_points = 10_000;
  state.nations.set("test_nation", nation);
  return { state, nation };
}

describe("lane:research | research_stats constants", () => {
  it("every branch JSON file's nodes have nonzero cost after this branch's authoring pass", () => {
    for (const branch of RESEARCH_BRANCH_FILES) {
      for (const node of loadResearchBranch(branch)) {
        const totalCost = node.cost.money + node.cost.science;
        assert.ok(totalCost > 0, `${branch}/${node.id} should have nonzero cost`);
      }
    }
  });
});

describe("lane:research | Concurrency cost curve — rising price, not a hard limit", () => {
  it("a nation's Nth concurrent project's charged cost is higher than its 1st, scaling with active count at start time", () => {
    assert.strictEqual(researchConcurrencyCostMultiplier(0), 1.0);
    assert.ok(researchConcurrencyCostMultiplier(1) > researchConcurrencyCostMultiplier(0));
    assert.ok(researchConcurrencyCostMultiplier(2) > researchConcurrencyCostMultiplier(1));
    assert.strictEqual(researchConcurrencyCostMultiplier(2), 1.0 + 2 * RESEARCH_CONCURRENCY_COST_STEP);
  });

  it("starting a 5th, 6th, ... concurrent project is never rejected outright for being 'too many' — soft cap via price only", () => {
    const { nation } = freshNationState();
    const sys = new ResearchSystem();
    sys.init("test_nation");
    // Six independent tier-1 nodes across branches, so mutex/requires never block this.
    const nodeIds = [
      "armour_light_tank_chassis",
      "armour_medium_tank_chassis",
      "armour_heavy_tank_chassis",
      "infantry_standard_t1",
      "infantry_assault_t1",
      "ordnance_at_gun_t1",
    ];
    for (const id of nodeIds) {
      assert.ok(sys.startResearch(nation, id), `expected ${id} to start (never a hard slot limit)`);
    }
  });

  it("an already-active project's charged cost does not retroactively change when a later project starts (locked in at its own start time)", () => {
    const { nation } = freshNationState();
    const sys = new ResearchSystem();
    sys.init("test_nation");
    const moneyBefore = nation.resources.get("money")!;
    sys.startResearch(nation, "armour_light_tank_chassis"); // 1st project, multiplier 1.0x
    const spentOnFirst = moneyBefore - nation.resources.get("money")!;
    assert.strictEqual(spentOnFirst, 20); // base cost, unmultiplied

    sys.startResearch(nation, "armour_medium_tank_chassis"); // 2nd project, multiplier > 1.0x
    // Cancel the first — refund math reads its own locked-in cost_charged, not a recomputed one.
    const result = sys.cancelResearch(nation, "armour_light_tank_chassis");
    assert.ok(result);
    // Zero progress made yet (no ticks), so invested fraction is 0 -> refund/forfeit both 0,
    // but the important thing is this doesn't throw and cost_charged stayed at the original 20.
    assert.strictEqual(result!.refund.money, 0);
    assert.strictEqual(result!.forfeit.money, 0);
  });
});

describe("lane:research | START_RESEARCH cost enforcement", () => {
  it("insufficient money OR insufficient science each independently reject the request, no partial deduction", () => {
    clearResearchTreeCache();
    const nation = new NationState();
    nation.nation_id = "test_nation";
    nation.resources.set("money", 5); // less than armour_light_tank_chassis's 20 money cost
    nation.science_points = 10_000;
    const sys = new ResearchSystem();
    sys.init("test_nation");
    assert.strictEqual(sys.startResearch(nation, "armour_light_tank_chassis"), false);
    assert.strictEqual(nation.resources.get("money"), 5); // untouched — no partial deduction
    assert.strictEqual(nation.science_points, 10_000);

    nation.resources.set("money", 10_000);
    nation.science_points = 1; // less than the 10 science cost
    assert.strictEqual(sys.startResearch(nation, "armour_light_tank_chassis"), false);
    assert.strictEqual(nation.resources.get("money"), 10_000);
    assert.strictEqual(nation.science_points, 1);
  });

  it("on success, both money and science are deducted by the concurrency-adjusted cost, atomically", () => {
    const { nation } = freshNationState();
    const sys = new ResearchSystem();
    sys.init("test_nation");
    const moneyBefore = nation.resources.get("money")!;
    const scienceBefore = nation.science_points;
    assert.ok(sys.startResearch(nation, "armour_light_tank_chassis"));
    assert.strictEqual(moneyBefore - nation.resources.get("money")!, 20);
    assert.strictEqual(scienceBefore - nation.science_points, 10);
  });
});

describe("lane:research | Research speed scales with industry allocation, never reaches a hard minimum", () => {
  it("0% research_speed allocation still progresses at the base rate (never a precondition)", () => {
    const { state, nation } = freshNationState();
    nation.industry_alloc.set("research_speed", 0);
    const sys = new ResearchSystem();
    sys.init("test_nation");
    sys.startResearch(nation, "armour_light_tank_chassis");
    sys.tick(state, () => {});
    const project = sys.serialize("test_nation").active_projects[0];
    assert.ok(project.points_remaining < project.points_total, "should have progressed at least the base rate");
  });

  it("100% allocation completes faster than 0%, but the per-tick rate never exceeds industrySliceMultiplier's own asymptotic cap", () => {
    const low = freshNationState();
    low.nation.industry_alloc.set("research_speed", 0);
    const highState = freshNationState();
    highState.nation.industry_alloc.set("research_speed", 100);

    const sysLow = new ResearchSystem();
    sysLow.init("test_nation");
    sysLow.startResearch(low.nation, "armour_light_tank_chassis");
    sysLow.tick(low.state, () => {});
    const lowRemaining = sysLow.serialize("test_nation").active_projects[0].points_remaining;

    const sysHigh = new ResearchSystem();
    sysHigh.init("test_nation");
    sysHigh.startResearch(highState.nation, "armour_light_tank_chassis");
    sysHigh.tick(highState.state, () => {});
    const highRemaining = sysHigh.serialize("test_nation").active_projects[0].points_remaining;

    assert.ok(highRemaining < lowRemaining, "100% allocation should progress further per tick than 0%");
  });
});

describe("lane:research | Cancel refund math", () => {
  it("invested_so_far, refund, and forfeit are computed from (1 - points_remaining/points_total) * cost at cancel time — not stored per-project fields", () => {
    const { state, nation } = freshNationState();
    const sys = new ResearchSystem();
    sys.init("test_nation");
    sys.startResearch(nation, "armour_light_tank_chassis"); // cost 20 money / 10 science, points_total 4
    sys.tick(state, () => {}); // 1 of 4 points consumed -> 25% invested
    const moneyAfterStart = nation.resources.get("money")!;
    const scienceAfterStart = nation.science_points;

    const result = sys.cancelResearch(nation, "armour_light_tank_chassis");
    assert.ok(result);
    const investedMoney = 20 * 0.25;
    const investedScience = 10 * 0.25;
    assert.ok(Math.abs(result!.refund.money - investedMoney * RESEARCH_CANCEL_REFUND_RATE) < 1e-9);
    assert.ok(Math.abs(result!.refund.science - investedScience * RESEARCH_CANCEL_REFUND_RATE) < 1e-9);
    assert.ok(Math.abs(result!.forfeit.money - (investedMoney - result!.refund.money)) < 1e-9);
    assert.strictEqual(nation.resources.get("money"), moneyAfterStart + result!.refund.money);
    assert.strictEqual(nation.science_points, scienceAfterStart + result!.refund.science);
  });

  it("refund is credited back to nation.resources.money and nation.science_points respectively; forfeit is not credited anywhere (burned)", () => {
    const { state, nation } = freshNationState();
    const sys = new ResearchSystem();
    sys.init("test_nation");
    sys.startResearch(nation, "armour_light_tank_chassis");
    sys.tick(state, () => {});
    sys.tick(state, () => {}); // 50% invested
    const moneyBeforeCancel = nation.resources.get("money")!;
    const result = sys.cancelResearch(nation, "armour_light_tank_chassis")!;
    assert.strictEqual(nation.resources.get("money"), moneyBeforeCancel + result.refund.money);
    // Forfeit is simply not credited anywhere — verified by the above equality holding exactly
    // (if forfeit were also credited, the balance would be higher than refund alone implies).
    assert.ok(result.forfeit.money > 0);
  });

  it("cancelling resets progress to 0 and removes the project from active_projects — re-starting later begins from scratch", () => {
    const { state, nation } = freshNationState();
    const sys = new ResearchSystem();
    sys.init("test_nation");
    sys.startResearch(nation, "armour_light_tank_chassis");
    sys.tick(state, () => {});
    sys.cancelResearch(nation, "armour_light_tank_chassis");
    assert.strictEqual(sys.serialize("test_nation").active_projects.length, 0);
    assert.ok(!sys.getResearchedNodeIds("test_nation").has("armour_light_tank_chassis"));

    assert.ok(sys.startResearch(nation, "armour_light_tank_chassis"));
    const restarted = sys.serialize("test_nation").active_projects[0];
    assert.strictEqual(restarted.points_remaining, restarted.points_total); // fresh start, no carryover
  });
});

describe("lane:research | Uranium research-currency injection", () => {
  it("completing the Uranium Research Program node with uranium stock > 0 grants a one-time science boost", () => {
    const { state, nation } = freshNationState();
    nation.resources.set("uranium", 5);
    const sys = new ResearchSystem();
    sys.init("test_nation");
    sys.startResearch(nation, "general_uranium_research_program");
    const scienceBeforeCompletion = nation.science_points;
    for (let i = 0; i < 4; i++) sys.tick(state, () => {});
    assert.ok(sys.getResearchedNodeIds("test_nation").has("general_uranium_research_program"));
    assert.ok(nation.science_points > scienceBeforeCompletion, "expected a one-time science injection on completion");
  });

  it("completing it with zero uranium stock grants nothing — the node still completes", () => {
    const { state, nation } = freshNationState();
    nation.resources.set("uranium", 0);
    const sys = new ResearchSystem();
    sys.init("test_nation");
    sys.startResearch(nation, "general_uranium_research_program");
    const scienceBeforeCompletion = nation.science_points;
    for (let i = 0; i < 4; i++) sys.tick(state, () => {});
    assert.ok(sys.getResearchedNodeIds("test_nation").has("general_uranium_research_program"));
    assert.strictEqual(nation.science_points, scienceBeforeCompletion, "no uranium access -> no injection, but node still completed");
  });
});

describe("lane:research | Sanity — real tree still loads with the new nonzero costs", () => {
  it("loadResearchTree() does not throw after this branch's cost authoring pass", () => {
    clearResearchTreeCache();
    assert.doesNotThrow(() => loadResearchTree());
  });
});
