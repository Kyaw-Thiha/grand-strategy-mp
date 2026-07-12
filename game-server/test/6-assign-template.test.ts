import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import {
  setRoundTicksForTesting,
  setCombatGraceTicksForTesting,
} from "../src/systems/combat_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("lane:tactical | ASSIGN_TEMPLATE handler", function () {
  this.timeout(60_000);
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setRoundTicksForTesting(3);
    setCombatGraceTicksForTesting(1);
    colyseus = await boot(appConfig, getTestPort());
  });
  after(async () => {
    setRoundTicksForTesting(20);
    setCombatGraceTicksForTesting(10);
    await colyseus.shutdown();
  });
  beforeEach(async () => { await colyseus.cleanup(); });

  async function startGame() {
    const token = await makeToken();
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    const divId = [...room.state.divisions.keys()][0];
    return { room, client, divId };
  }

  it("sets template_id on the division", async () => {
    const { room, client, divId } = await startGame();
    client.send("ASSIGN_TEMPLATE", {
      division_id: divId,
      template_id: "preset_infantry",
      cells: [
        { cell_index: 0, unit_type: "recon_infantry" },
        { cell_index: 5, unit_type: "infantry" },
        { cell_index: 6, unit_type: "infantry" },
      ],
    });
    await room.waitForNextPatch();
    const div = room.state.divisions.get(divId);
    assert.strictEqual(div!.template_id, "preset_infantry");
  });

  it("populates grid cells from the message", async () => {
    const { room, client, divId } = await startGame();
    client.send("ASSIGN_TEMPLATE", {
      division_id: divId,
      template_id: "preset_combined_arms",
      cells: [
        { cell_index: 0,  unit_type: "recon_infantry" },
        { cell_index: 5,  unit_type: "medium_tank"    },
        { cell_index: 10, unit_type: "artillery"       },
      ],
    });
    await room.waitForNextPatch();
    const div = room.state.divisions.get(divId);
    const grid = (div as any).grid;
    assert.strictEqual(grid.cells[0].unit_type,  "recon_infantry");
    assert.strictEqual(grid.cells[5].unit_type,  "medium_tank");
    assert.strictEqual(grid.cells[10].unit_type, "artillery");
    assert.strictEqual(grid.cells[1].unit_type,  "");
  });

  it("clears previously-set cells when new template is assigned", async () => {
    const { room, client, divId } = await startGame();
    client.send("ASSIGN_TEMPLATE", {
      division_id: divId,
      template_id: "preset_combined_arms",
      cells: [{ cell_index: 0, unit_type: "infantry" }],
    });
    await room.waitForNextPatch();
    client.send("ASSIGN_TEMPLATE", {
      division_id: divId,
      template_id: "preset_infantry",
      cells: [{ cell_index: 5, unit_type: "recon_infantry" }],
    });
    await room.waitForNextPatch();
    const grid = (room.state.divisions.get(divId) as any).grid;
    assert.strictEqual(grid.cells[0].unit_type, "");
    assert.strictEqual(grid.cells[5].unit_type, "recon_infantry");
  });

  it("recomputes division_type based on assigned cells", async () => {
    const { room, client, divId } = await startGame();
    client.send("ASSIGN_TEMPLATE", {
      division_id: divId,
      template_id: "preset_armoured",
      cells: [
        { cell_index: 0,  unit_type: "heavy_tank"   },
        { cell_index: 1,  unit_type: "heavy_tank"   },
        { cell_index: 5,  unit_type: "medium_tank"  },
        { cell_index: 6,  unit_type: "medium_tank"  },
        { cell_index: 10, unit_type: "armoured_car" },
      ],
    });
    await room.waitForNextPatch();
    const div = room.state.divisions.get(divId);
    assert.strictEqual(div!.division_type, "armoured");
  });

  it("is rejected when division is engaged", async () => {
    const { room, client, divId } = await startGame();
    const div = room.state.divisions.get(divId);
    (div as any).combat_state = "engaged";
    const originalId = div!.template_id;
    client.send("ASSIGN_TEMPLATE", {
      division_id: divId,
      template_id: "preset_infantry",
      cells: [{ cell_index: 0, unit_type: "infantry" }],
    });
    await room.waitForNextPatch();
    assert.strictEqual(div!.template_id, originalId);
  });

  it("is a no-op for non-existent division", async () => {
    const { room, client } = await startGame();
    client.send("ASSIGN_TEMPLATE", {
      division_id: "nonexistent-div",
      template_id: "preset_infantry",
      cells: [{ cell_index: 0, unit_type: "infantry" }],
    });
    await room.waitForNextPatch();
    // passes if no crash
  });
});
