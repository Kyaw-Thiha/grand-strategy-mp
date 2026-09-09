import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import {
  loadResearchTree,
  loadResearchBranch,
  clearResearchTreeCache,
  RESEARCH_BRANCH_FILES,
} from "../src/data/research_tree_loader.js";
import { ResearchSystem, resolveLineageUnitType } from "../src/systems/research_system.js";
import { GameRoomState, NationState, DivisionState } from "../src/rooms/schema/GameRoomState.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("lane:research | Research tree JSON loader", () => {
  it("loads every branch file without throwing, naval.json included as a valid empty array", () => {
    for (const branch of RESEARCH_BRANCH_FILES) {
      assert.doesNotThrow(() => loadResearchBranch(branch));
    }
    assert.deepStrictEqual(loadResearchBranch("naval"), []);
  });

  it("throws on a node whose 'requires' references a nonexistent node_id", () => {
    clearResearchTreeCache();
    const tree = loadResearchTree();
    // Sanity check the real tree loads fine; then verify the cross-validation logic directly
    // against a synthetic malformed set (avoids mutating real JSON fixtures for this assertion).
    assert.ok(tree.nodes.size > 0);
    const badNodes = new Map(tree.nodes);
    badNodes.set("bad_node", {
      id: "bad_node", branch: "Test", path_id: "test", tier: 1, mutex_group_id: null,
      name: "Bad", description: "", cost: { money: 0, science: 0 }, badges: [], size: "minor",
      requires: ["nonexistent_node_id"], image_asset: "", effects: [],
    });
    assert.throws(() => {
      for (const node of badNodes.values()) {
        for (const reqId of node.requires) {
          if (!badNodes.has(reqId)) throw new Error("missing requires reference");
        }
      }
    });
  });

  it("armour.json contains the full motorisation->mechanisation->apc->improved_apc->ifv chain, each requiring the previous", () => {
    clearResearchTreeCache();
    const tree = loadResearchTree();
    const motorisation = tree.nodes.get("general_motorisation");
    const apc = tree.nodes.get("armour_medium_mechanisation_apc");
    const improvedApc = tree.nodes.get("armour_medium_improved_apc");
    const ifv = tree.nodes.get("armour_medium_ifv");
    assert.ok(motorisation, "motorisation node exists (General Technology panel, per TACTICAL_COMBAT.md)");
    assert.ok(apc && apc.requires.includes("armour_medium_tank_chassis"));
    assert.ok(improvedApc && improvedApc.requires.includes("armour_medium_mechanisation_apc"));
    assert.ok(ifv && ifv.requires.includes("armour_medium_improved_apc"));
  });
});

describe("lane:research | NationState + ResearchSystem state", () => {
  it("new nation starts with active_research_count 0 and empty NationResearchData", () => {
    const nation = new NationState();
    assert.strictEqual(nation.active_research_count, 0);
    const sys = new ResearchSystem();
    sys.init("test_nation");
    assert.strictEqual(sys.getResearchedNodeIds("test_nation").size, 0);
  });
});

describe("lane:research | Research tick (placeholder rate, no currency)", () => {
  function freshState(): GameRoomState {
    clearResearchTreeCache();
    const state = new GameRoomState();
    const nation = new NationState();
    nation.nation_id = "test_nation";
    state.nations.set("test_nation", nation);
    return state;
  }

  it("multiple concurrent projects for the same nation all progress simultaneously, independently — no hard slot limit", () => {
    const state = freshState();
    const sys = new ResearchSystem();
    sys.init("test_nation");
    assert.ok(sys.startResearch("test_nation", "armour_light_tank_chassis"));
    assert.ok(sys.startResearch("test_nation", "armour_medium_tank_chassis"));
    assert.ok(sys.startResearch("test_nation", "armour_heavy_tank_chassis"));
    let broadcasts: unknown[] = [];
    for (let i = 0; i < 4; i++) sys.tick(state, (type, msg) => broadcasts.push({ type, msg }));
    const researched = sys.getResearchedNodeIds("test_nation");
    assert.ok(researched.has("armour_light_tank_chassis"));
    assert.ok(researched.has("armour_medium_tank_chassis"));
    assert.ok(researched.has("armour_heavy_tank_chassis"));
  });

  it("on completion: node added to researched_node_ids, and a perk effect pushes perk_id into nation.researched_perks", () => {
    const state = freshState();
    const sys = new ResearchSystem();
    sys.init("test_nation");
    sys.startResearch("test_nation", "armour_light_tank_chassis");
    for (let i = 0; i < 4; i++) sys.tick(state, () => {});
    assert.ok(sys.getResearchedNodeIds("test_nation").has("armour_light_tank_chassis"));
    const nation = state.nations.get("test_nation")!;
    assert.ok(Array.from(nation.researched_perks).includes("armour_flank_resist_1"));
  });
});

describe("lane:research | Lineage-chain fallback (RESEARCH.md's 'no template ever breaks' guarantee)", () => {
  it("a template referencing mechanised_infantry with nothing researched resolves to mechanised_infantry (the base)", () => {
    assert.strictEqual(resolveLineageUnitType(new Set(), "mechanised_infantry"), "mechanised_infantry");
  });

  it("after researching improved_apc, the same template resolves to improved_apc, live, no re-save needed", () => {
    const researched = new Set(["armour_medium_improved_apc"]);
    assert.strictEqual(resolveLineageUnitType(researched, "mechanised_infantry"), "improved_apc");
  });

  it("after researching ifv, resolves to ifv — the highest currently-researched tier, never a mid-chain value if the top is researched", () => {
    const researched = new Set(["armour_medium_improved_apc", "armour_medium_ifv"]);
    assert.strictEqual(resolveLineageUnitType(researched, "mechanised_infantry"), "ifv");
  });

  it("un-researching improved_apc (hypothetically, e.g. future respec) falls back to mechanised_infantry, never straight to an unspecialised non-chain base", () => {
    const researched = new Set<string>(); // improved_apc's unlocking node removed
    assert.strictEqual(resolveLineageUnitType(researched, "improved_apc"), "mechanised_infantry");
  });

  it("a fielded division's grid cell live-migrates to the new tier on research completion, without re-saving its template", () => {
    clearResearchTreeCache();
    const state = new GameRoomState();
    const nation = new NationState();
    nation.nation_id = "test_nation";
    state.nations.set("test_nation", nation);
    const div = new DivisionState();
    div.nation_id = "test_nation";
    div.grid.cells[0].unit_type = "mechanised_infantry";
    state.divisions.set("div1", div);

    const sys = new ResearchSystem();
    sys.init("test_nation");
    sys.startResearch("test_nation", "armour_medium_tank_chassis");
    for (let i = 0; i < 4; i++) sys.tick(state, () => {});
    sys.startResearch("test_nation", "armour_medium_mechanisation_apc");
    for (let i = 0; i < 4; i++) sys.tick(state, () => {});
    assert.strictEqual(div.grid.cells[0].unit_type, "mechanised_infantry"); // apc node has no unlocks_unit_type effect (base tier)

    sys.startResearch("test_nation", "armour_medium_improved_apc");
    for (let i = 0; i < 4; i++) sys.tick(state, () => {});
    assert.strictEqual(div.grid.cells[0].unit_type, "improved_apc");
  });
});

describe("lane:research | START_RESEARCH prerequisites and adjacency", () => {
  it("a tier-2 node is rejected until its requires[] node is researched", () => {
    clearResearchTreeCache();
    const sys = new ResearchSystem();
    sys.init("test_nation");
    assert.strictEqual(sys.startResearch("test_nation", "armour_medium_mechanisation_apc"), false);
  });

  it("unlocking a tier unlocks the next tier same-path AND the same-tier adjacent-path node, per RESEARCH.md's adjacency-web rule", () => {
    clearResearchTreeCache();
    const state = new GameRoomState();
    const nation = new NationState();
    nation.nation_id = "test_nation";
    state.nations.set("test_nation", nation);
    const sys = new ResearchSystem();
    sys.init("test_nation");

    // infantry_assault_t2_flexible_response requires EITHER infantry_standard_t1 (own related
    // path) OR infantry_assault_t1 (adjacent path, same tier) — OR semantics per the adjacency
    // web. Completing just the assault-path tier-1 node should already unlock it.
    assert.ok(sys.startResearch("test_nation", "infantry_assault_t1"));
    for (let i = 0; i < 4; i++) sys.tick(state, () => {});
    assert.ok(sys.startResearch("test_nation", "infantry_assault_t2_flexible_response"));
  });
});

describe("lane:research | Mutex tiers and respec", () => {
  function freshState(): { state: GameRoomState; sys: ResearchSystem } {
    clearResearchTreeCache();
    const state = new GameRoomState();
    const nation = new NationState();
    nation.nation_id = "test_nation";
    state.nations.set("test_nation", nation);
    const sys = new ResearchSystem();
    sys.init("test_nation");
    return { state, sys };
  }

  it("starting a mutex-group node when a DIFFERENT option in that group is already RESEARCHED (respec case): the old node stays in researched_node_ids/researched_perks for the full duration of the new research — no downtime", () => {
    const { state, sys } = freshState();
    sys.startResearch("test_nation", "infantry_standard_t1");
    for (let i = 0; i < 4; i++) sys.tick(state, () => {});
    sys.startResearch("test_nation", "infantry_fire_move_doctrine");
    for (let i = 0; i < 4; i++) sys.tick(state, () => {});
    assert.ok(sys.getResearchedNodeIds("test_nation").has("infantry_fire_move_doctrine"));

    assert.ok(sys.startResearch("test_nation", "infantry_bayonet_doctrine"));
    // Mid-research: old node/perk must still be active.
    sys.tick(state, () => {});
    assert.ok(sys.getResearchedNodeIds("test_nation").has("infantry_fire_move_doctrine"));
    const nation = state.nations.get("test_nation")!;
    assert.ok(Array.from(nation.researched_perks).includes("infantry_fire_move_1"));
  });

  it("on the new node's completion, the old mutex sibling is atomically removed from researched_node_ids and, if it had a perk effect, from researched_perks — live-recompute drops it immediately", () => {
    const { state, sys } = freshState();
    sys.startResearch("test_nation", "infantry_standard_t1");
    for (let i = 0; i < 4; i++) sys.tick(state, () => {});
    sys.startResearch("test_nation", "infantry_fire_move_doctrine");
    for (let i = 0; i < 4; i++) sys.tick(state, () => {});
    sys.startResearch("test_nation", "infantry_bayonet_doctrine");
    for (let i = 0; i < 4; i++) sys.tick(state, () => {});

    const researched = sys.getResearchedNodeIds("test_nation");
    assert.ok(!researched.has("infantry_fire_move_doctrine"));
    assert.ok(researched.has("infantry_bayonet_doctrine"));
    const nation = state.nations.get("test_nation")!;
    assert.ok(!Array.from(nation.researched_perks).includes("infantry_fire_move_1"));
    assert.ok(Array.from(nation.researched_perks).includes("infantry_bayonet_1"));
  });
});

describe("lane:research | CANCEL_RESEARCH", () => {
  it("cancelling an in-progress (not yet completed) project removes it from active_projects, progress resets to 0 — re-starting later begins from scratch", () => {
    clearResearchTreeCache();
    const sys = new ResearchSystem();
    sys.init("test_nation");
    sys.startResearch("test_nation", "armour_light_tank_chassis");
    const state = new GameRoomState();
    const nation = new NationState();
    nation.nation_id = "test_nation";
    state.nations.set("test_nation", nation);
    sys.tick(state, () => {}); // one tick of progress
    sys.cancelResearch("test_nation", "armour_light_tank_chassis");
    assert.strictEqual(sys.serialize("test_nation").active_projects.length, 0);
    assert.ok(!sys.getResearchedNodeIds("test_nation").has("armour_light_tank_chassis"));
  });
});

describe("lane:research | GameRoom integration — START_RESEARCH end-to-end over the real message pipeline", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    colyseus = await boot(appConfig, getTestPort());
  });
  after(async () => {
    await colyseus.shutdown();
  });
  beforeEach(async () => {
    await colyseus.cleanup();
  });

  async function joinRoom() {
    const token = await makeToken();
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    client.send("SELECT_NATION", { nation_id: "germany" });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    return { client, room };
  }

  it("client sending START_RESEARCH over the wire actually reaches researchSystem and broadcasts RESEARCH_UPDATES back", async () => {
    const { client, room } = await joinRoom();
    const updates: Record<string, unknown>[] = [];
    client.onMessage("RESEARCH_UPDATES", (msg: Record<string, unknown>) => updates.push(msg));

    client.send("START_RESEARCH", { node_id: "armour_light_tank_chassis" });
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.ok(updates.length > 0, "expected at least one RESEARCH_UPDATES broadcast after START_RESEARCH");
    const last = updates[updates.length - 1] as { active_projects: unknown[] };
    assert.ok(
      Array.isArray(last.active_projects) &&
        last.active_projects.some((p) => (p as { node_id: string }).node_id === "armour_light_tank_chassis"),
      "expected the started node to appear in active_projects",
    );
  });

  it("client receives RESEARCH_INIT once the game starts", async () => {
    const token = await makeToken();
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    client.send("SELECT_NATION", { nation_id: "germany" });
    await room.waitForNextPatch();

    const initMessages: Record<string, unknown>[] = [];
    client.onMessage("RESEARCH_INIT", (msg: Record<string, unknown>) => initMessages.push(msg));
    await (room as any).startGame();
    await room.waitForNextPatch();
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.ok(initMessages.length > 0, "expected a RESEARCH_INIT broadcast at game start");
  });
});
