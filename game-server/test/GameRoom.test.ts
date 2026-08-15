import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import { DivisionState, GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { setCombatGraceTicksForTesting } from "../src/systems/combat_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(payload: object, secret = jwtSecret) {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(secret);
}

describe("lane:core | GameRoom", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setCombatGraceTicksForTesting(0);
    colyseus = await boot(appConfig, getTestPort());
  });
  after(async () => {
    setCombatGraceTicksForTesting(10);
    await colyseus.shutdown();
  });
  beforeEach(async () => await colyseus.cleanup());

  describe("onAuth()", () => {
    it("accepts a valid JWT and returns the payload", async () => {
      const token = await makeToken({ sub: "user-123", steam_id: "dev_steamid", has_host_pass: false });
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const client = await colyseus.connectTo(room, { token });

      assert.strictEqual(client.sessionId, room.clients[0].sessionId);
    });

    it("rejects a JWT signed with the wrong secret", async () => {
      const wrongSecret = new TextEncoder().encode("wrong-secret");
      const token = await makeToken({ sub: "user-123", steam_id: "dev_steamid", has_host_pass: false }, wrongSecret);
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});

      await assert.rejects(() => colyseus.connectTo(room, { token }));
    });

    it("rejects a request with no token", async () => {
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      await assert.rejects(() => colyseus.connectTo(room, {}));
    });
  });

  describe("onJoin()", () => {
    it("adds the player to room state with correct fields", async () => {
      const token = await makeToken({ sub: "user-abc", steam_id: "dev_steamid", has_host_pass: true });
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const client = await colyseus.connectTo(room, { token });

      await room.waitForNextPatch();

      const player = room.state.players.get(client.sessionId);
      assert.strictEqual(player?.userId, "user-abc");
      assert.strictEqual(player?.hasHostPass, true);
    });
  });

  describe("SEND_CHAT", () => {
    it("broadcasts a trimmed chat message with sender email to all clients", async () => {
      const tokenA = await makeToken({
        sub: "user-a",
        email: "alpha@example.com",
        steam_id: "dev_steamid",
        has_host_pass: true,
      });
      const tokenB = await makeToken({
        sub: "user-b",
        email: "bravo@example.com",
        steam_id: "dev_steamid",
        has_host_pass: false,
      });
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const clientA = await colyseus.connectTo(room, { token: tokenA });
      const clientB = await colyseus.connectTo(room, { token: tokenB });

      const receivedA = new Promise<any>(resolve => clientA.onMessage("CHAT_MESSAGE", resolve));
      const receivedB = new Promise<any>(resolve => clientB.onMessage("CHAT_MESSAGE", resolve));

      clientA.send("SEND_CHAT", { message: "  Hold the line.  " });

      const [messageA, messageB] = await Promise.all([receivedA, receivedB]);
      for (const message of [messageA, messageB]) {
        assert.strictEqual(message.user_id, "user-a");
        assert.strictEqual(message.email, "alpha@example.com");
        assert.strictEqual(message.message, "Hold the line.");
        assert.match(message.time, /^\d{2}:\d{2}$/);
      }
    });

    it("does not broadcast blank chat messages", async () => {
      const token = await makeToken({
        sub: "user-a",
        email: "alpha@example.com",
        steam_id: "dev_steamid",
        has_host_pass: true,
      });
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const client = await colyseus.connectTo(room, { token });
      let received = false;
      client.onMessage("CHAT_MESSAGE", () => {
        received = true;
      });

      client.send("SEND_CHAT", { message: "   " });
      await room.waitForNextPatch();

      assert.strictEqual(received, false);
    });
  });

  describe("onLeave()", () => {
    it("removes the player from room state on disconnect", async () => {
      const token = await makeToken({ sub: "user-abc", steam_id: "dev_steamid", has_host_pass: false });
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const client = await colyseus.connectTo(room, { token });

      await room.waitForNextPatch();
      assert.strictEqual(room.state.players.size, 1);

      client.leave();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.players.size, 0);
    });
  });

  describe("HOLD", () => {
    async function setupHoldRoom() {
      const tokenA = await makeToken({ sub: "user-a", steam_id: "dev_steamid", has_host_pass: true });
      const tokenB = await makeToken({ sub: "user-b", steam_id: "dev_steamid", has_host_pass: true });
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const clientA = await colyseus.connectTo(room, { token: tokenA });
      const clientB = await colyseus.connectTo(room, { token: tokenB });
      await room.waitForNextPatch();

      room.state.phase = "running";
      room.state.nations.get("germany")!.player_id = "user-a";
      room.state.nations.get("france")!.player_id = "user-b";

      const division = new DivisionState();
      division.division_id = "germany_div_test";
      division.nation_id = "germany";
      room.state.divisions.set(division.division_id, division);

      (room as any).serverVisibilitySystem = {
        canNationSeeDivision: (nationId: string, divisionId: string) =>
          nationId === "germany" && divisionId === division.division_id,
      };
      const serverClientA = room.clients.find(client => client.sessionId === clientA.sessionId)!;
      const serverClientB = room.clients.find(client => client.sessionId === clientB.sessionId)!;
      const sentToA: Array<{ type: string; message: any }> = [];
      const sentToB: Array<{ type: string; message: any }> = [];
      (serverClientA as any).send = (type: string, message: any) => sentToA.push({ type, message });
      (serverClientB as any).send = (type: string, message: any) => sentToB.push({ type, message });
      const hold = (client: typeof room.clients[number]) =>
        (room as any).handleHold(client, { division_id: division.division_id });

      return {
        room,
        division,
        sentToA,
        sentToB,
        hold,
        serverClientA,
        serverClientB,
      };
    }

    function assertHoldUpdate(messages: Array<{ type: string; message: any }>) {
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].type, "DIVISION_UPDATES");
      assert.strictEqual(messages[0].message.divisions.length, 1);
      assert.strictEqual(messages[0].message.divisions[0].division_id, "germany_div_test");
      assert.deepStrictEqual(messages[0].message.divisions[0].move_order, []);
      assert.strictEqual(messages[0].message.divisions[0].final_position_lng, -999);
      assert.strictEqual(messages[0].message.divisions[0].final_position_lat, -999);
    }

    it("stops active route movement and broadcasts the cleared destination", async () => {
      const { division, sentToA, sentToB, hold, serverClientA } = await setupHoldRoom();
      division.move_order.push("waypoint_a", "waypoint_b");
      division.final_position_lng = 12.5;
      division.final_position_lat = 48.25;

      hold(serverClientA);

      assert.strictEqual(division.move_order.length, 0);
      assert.strictEqual(division.final_position_lng, -999);
      assert.strictEqual(division.final_position_lat, -999);
      assertHoldUpdate(sentToA);
      assert.strictEqual(sentToB.length, 0);
    });

    it("stops final-target-only movement", async () => {
      const { division, sentToA, sentToB, hold, serverClientA } = await setupHoldRoom();
      division.final_position_lng = 7.25;
      division.final_position_lat = 46.5;

      hold(serverClientA);

      assert.strictEqual(division.move_order.length, 0);
      assert.strictEqual(division.final_position_lng, -999);
      assert.strictEqual(division.final_position_lat, -999);
      assertHoldUpdate(sentToA);
      assert.strictEqual(sentToB.length, 0);
    });

    it("does not alter or broadcast a stopped division", async () => {
      const { division, sentToA, sentToB, hold, serverClientA } = await setupHoldRoom();

      hold(serverClientA);

      assert.strictEqual(division.move_order.length, 0);
      assert.strictEqual(division.final_position_lng, -999);
      assert.strictEqual(division.final_position_lat, -999);
      assert.strictEqual(sentToA.length, 0);
      assert.strictEqual(sentToB.length, 0);
    });

    it("does not alter or broadcast movement outside the running phase", async () => {
      const { room, division, sentToA, sentToB, hold, serverClientA } = await setupHoldRoom();
      room.state.phase = "lobby";
      division.move_order.push("waypoint_a");
      division.final_position_lng = 12.5;
      division.final_position_lat = 48.25;

      hold(serverClientA);

      assert.deepStrictEqual([...division.move_order], ["waypoint_a"]);
      assert.strictEqual(division.final_position_lng, 12.5);
      assert.strictEqual(division.final_position_lat, 48.25);
      assert.strictEqual(sentToA.length, 0);
      assert.strictEqual(sentToB.length, 0);
    });

    it("does not alter or broadcast combat movement", async () => {
      const { division, sentToA, sentToB, hold, serverClientA } = await setupHoldRoom();
      division.combat_state = "engaged";
      division.move_order.push("waypoint_a");
      division.final_position_lng = 12.5;
      division.final_position_lat = 48.25;

      hold(serverClientA);

      assert.deepStrictEqual([...division.move_order], ["waypoint_a"]);
      assert.strictEqual(division.final_position_lng, 12.5);
      assert.strictEqual(division.final_position_lat, 48.25);
      assert.strictEqual(sentToA.length, 0);
      assert.strictEqual(sentToB.length, 0);
    });

    it("does not alter or broadcast movement owned by another player", async () => {
      const { division, sentToA, sentToB, hold, serverClientB } = await setupHoldRoom();
      division.move_order.push("waypoint_a");
      division.final_position_lng = 12.5;
      division.final_position_lat = 48.25;

      hold(serverClientB);

      assert.deepStrictEqual([...division.move_order], ["waypoint_a"]);
      assert.strictEqual(division.final_position_lng, 12.5);
      assert.strictEqual(division.final_position_lat, 48.25);
      assert.strictEqual(sentToA.length, 0);
      assert.strictEqual(sentToB.length, 0);
    });
  });

  describe("RETREAT", () => {
    async function setupRetreatRoom() {
      const tokenA = await makeToken({ sub: "user-a", steam_id: "dev_steamid", has_host_pass: true });
      const tokenB = await makeToken({ sub: "user-b", steam_id: "dev_steamid", has_host_pass: true });
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const clientA = await colyseus.connectTo(room, { token: tokenA });
      const clientB = await colyseus.connectTo(room, { token: tokenB });
      await room.waitForNextPatch();

      room.state.phase = "running";
      room.state.nations.get("germany")!.player_id = "user-a";
      room.state.nations.get("france")!.player_id = "user-b";

      const division = new DivisionState();
      division.division_id = "germany_div_retreat";
      division.nation_id = "germany";
      division.combat_state = "engaged";
      division.position_lng = 10;
      division.position_lat = 50;
      division.engaged_with.push("france_div_enemy");
      room.state.divisions.set(division.division_id, division);

      const enemy = new DivisionState();
      enemy.division_id = "france_div_enemy";
      enemy.nation_id = "france";
      enemy.combat_state = "engaged";
      enemy.position_lng = 10.1;
      enemy.position_lat = 50;
      enemy.engaged_with.push(division.division_id);
      room.state.divisions.set(enemy.division_id, enemy);

      (room as any).serverVisibilitySystem = {
        canNationSeeDivision: (nationId: string, divisionId: string) =>
          nationId === "germany" && divisionId === division.division_id,
      };
      const serverClientA = room.clients.find(client => client.sessionId === clientA.sessionId)!;
      const serverClientB = room.clients.find(client => client.sessionId === clientB.sessionId)!;
      const sentToA: Array<{ type: string; message: any }> = [];
      const sentToB: Array<{ type: string; message: any }> = [];
      (serverClientA as any).send = (type: string, message: any) => sentToA.push({ type, message });
      (serverClientB as any).send = (type: string, message: any) => sentToB.push({ type, message });
      const retreat = (client: typeof room.clients[number]) =>
        (room as any).handleRetreat(client, { division_id: division.division_id });

      return {
        room,
        division,
        enemy,
        sentToA,
        sentToB,
        retreat,
        serverClientA,
        serverClientB,
      };
    }

    function assertRetreatUpdate(messages: Array<{ type: string; message: any }>) {
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].type, "DIVISION_UPDATES");
      assert.strictEqual(messages[0].message.divisions.length, 1);
      assert.strictEqual(messages[0].message.divisions[0].division_id, "germany_div_retreat");
      assert.strictEqual(messages[0].message.divisions[0].combat_state, "retreating");
    }

    for (const combatState of ["engaged", "suppressed"] as const) {
      it(`starts and visibility-filters an owned ${combatState} division retreat`, async () => {
        const { division, sentToA, sentToB, retreat, serverClientA } = await setupRetreatRoom();
        division.combat_state = combatState;

        retreat(serverClientA);

        assert.strictEqual(division.combat_state, "retreating");
        assert.strictEqual(division.engaged_with.length, 0);
        assertRetreatUpdate(sentToA);
        assert.strictEqual(sentToB.length, 0);
      });
    }

    for (const combatState of ["idle", "retreating", "destroyed"] as const) {
      it(`rejects an owned ${combatState} division`, async () => {
        const { division, sentToA, sentToB, retreat, serverClientA } = await setupRetreatRoom();
        division.combat_state = combatState;

        retreat(serverClientA);

        assert.strictEqual(division.combat_state, combatState);
        assert.deepStrictEqual([...division.engaged_with], ["france_div_enemy"]);
        assert.strictEqual(sentToA.length, 0);
        assert.strictEqual(sentToB.length, 0);
      });
    }

    it("rejects Retreat outside the running phase", async () => {
      const { room, division, sentToA, sentToB, retreat, serverClientA } = await setupRetreatRoom();
      room.state.phase = "lobby";

      retreat(serverClientA);

      assert.strictEqual(division.combat_state, "engaged");
      assert.strictEqual(sentToA.length, 0);
      assert.strictEqual(sentToB.length, 0);
    });

    it("rejects a division owned by another player", async () => {
      const { division, sentToA, sentToB, retreat, serverClientB } = await setupRetreatRoom();

      retreat(serverClientB);

      assert.strictEqual(division.combat_state, "engaged");
      assert.strictEqual(sentToA.length, 0);
      assert.strictEqual(sentToB.length, 0);
    });

    it("rejects stale combat state without a live opposing engagement", async () => {
      const { room, division, enemy, sentToA, sentToB, retreat, serverClientA } = await setupRetreatRoom();
      enemy.combat_state = "retreating";

      retreat(serverClientA);

      assert.strictEqual(division.combat_state, "engaged");
      assert.deepStrictEqual([...division.engaged_with], [enemy.division_id]);
      assert.strictEqual(sentToA.length, 0);
      assert.strictEqual(sentToB.length, 0);
      assert.strictEqual(room.state.divisions.get(division.division_id), division);
    });
  });

  describe("DIPLOMACY_ACTION", () => {
    async function setupRunningRoom(assignments: Record<string, string>) {
      const room = await colyseus.createRoom<GameRoomState>("game_room", {});
      const clients: Record<string, any> = {};
      for (const [userId] of Object.entries(assignments)) {
        const token = await makeToken({
          sub: userId,
          email: `${userId}@example.com`,
          steam_id: "dev_steamid",
          has_host_pass: true,
        });
        clients[userId] = await colyseus.connectTo(room, { token });
      }
      await room.waitForNextPatch();
      for (const [userId, nationId] of Object.entries(assignments)) {
        const nation = room.state.nations.get(nationId);
        if (nation) nation.player_id = userId;
      }
      (room as any).startGame();
      await room.waitForNextPatch();
      return { room, clients };
    }

    function stance(room: any, a: string, b: string): string {
      return room.state.relations.get(`${a}|${b}`)?.stance
        ?? room.state.relations.get(`${b}|${a}`)?.stance
        ?? "neutral";
    }

    function setStance(room: any, a: string, b: string, value: string): void {
      const relation = room.state.relations.get(`${a}|${b}`)
        ?? room.state.relations.get(`${b}|${a}`);
      assert.ok(relation, `missing relation ${a}|${b}`);
      relation.stance = value;
    }

    function wait(ms = 100): Promise<void> {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    it("starts matches with all nation pairs neutral", async () => {
      const { room } = await setupRunningRoom({ "user-a": "germany" });

      assert.strictEqual(stance(room, "germany", "france"), "neutral");
      assert.strictEqual(stance(room, "germany", "italy"), "neutral");
      assert.strictEqual(stance(room, "france", "italy"), "neutral");
    });

    it("invite pulls only the selected nation from its current alliance", async () => {
      const { room, clients } = await setupRunningRoom({
        "user-a": "germany",
        "user-b": "france",
      });
      setStance(room, "france", "italy", "alliance");

      const targetPrompt = new Promise<any>(resolve =>
        clients["user-b"].onMessage("DIPLOMACY_INTERACTIVE_NOTIFICATION", resolve)
      );
      const relationsUpdated = new Promise<any>(resolve =>
        clients["user-a"].onMessage("RELATIONS_UPDATED", resolve)
      );
      clients["user-a"].send("DIPLOMACY_ACTION", {
        action: "invite",
        target_nation_id: "france",
      });
      const prompt = await targetPrompt;
      assert.match(prompt.message, /invited you/);
      clients["user-b"].send("DIPLOMACY_VOTE_RESPONSE", {
        vote_id: prompt.vote_id,
        accept: true,
      });
      await relationsUpdated;
      await room.waitForNextPatch();

      assert.strictEqual(stance(room, "germany", "france"), "alliance");
      assert.strictEqual(stance(room, "france", "italy"), "neutral");
      assert.strictEqual(stance(room, "germany", "italy"), "neutral");
    });

    it("war and peace apply alliance versus alliance", async () => {
      const { room, clients } = await setupRunningRoom({
        "user-a": "germany",
        "user-b": "spain",
      });
      setStance(room, "germany", "france", "alliance");
      setStance(room, "spain", "italy", "alliance");

      clients["user-a"].send("DIPLOMACY_ACTION", {
        action: "declare_war",
        target_nation_id: "spain",
      });
      await room.waitForNextPatch();

      assert.strictEqual(stance(room, "germany", "spain"), "war");
      assert.strictEqual(stance(room, "france", "spain"), "war");
      assert.strictEqual(stance(room, "germany", "italy"), "war");
      assert.strictEqual(stance(room, "france", "italy"), "war");

      const peacePrompts: any[] = [];
      clients["user-b"].onMessage("DIPLOMACY_INTERACTIVE_NOTIFICATION", (msg: any) => {
        peacePrompts.push(msg);
      });
      // Filter to the peace RELATIONS_UPDATED only — the declare_war broadcast can
      // arrive late (after this listener is registered) and resolve prematurely.
      const relationsUpdated = new Promise<any>(resolve =>
        clients["user-a"].onMessage("RELATIONS_UPDATED", (msg: any) => {
          const r = msg.relations as Record<string, string>;
          if (r["germany:spain"] === "neutral" || r["spain:germany"] === "neutral") resolve(msg);
        })
      );
      clients["user-a"].send("DIPLOMACY_ACTION", {
        action: "make_peace",
        target_nation_id: "spain",
      });
      while (peacePrompts.length < 1) {
        await wait(25);
      }
      clients["user-b"].send("DIPLOMACY_VOTE_RESPONSE", {
        vote_id: peacePrompts[0].vote_id,
        accept: true,
      });
      await relationsUpdated;
      await room.waitForNextPatch();

      assert.strictEqual(stance(room, "germany", "spain"), "neutral");
      assert.strictEqual(stance(room, "france", "italy"), "neutral");
    });

    it("quit and kick make the separated nation neutral toward everyone", async () => {
      const { room, clients } = await setupRunningRoom({
        "user-a": "germany",
        "user-b": "france",
      });
      setStance(room, "germany", "france", "alliance");
      setStance(room, "germany", "italy", "alliance");
      setStance(room, "france", "italy", "alliance");
      setStance(room, "germany", "spain", "war");
      setStance(room, "france", "spain", "war");
      setStance(room, "italy", "spain", "war");

      clients["user-a"].send("DIPLOMACY_ACTION", { action: "quit_alliance" });
      await room.waitForNextPatch();

      assert.strictEqual(stance(room, "germany", "france"), "neutral");
      assert.strictEqual(stance(room, "germany", "italy"), "neutral");
      assert.strictEqual(stance(room, "germany", "spain"), "neutral");
      assert.strictEqual(stance(room, "france", "italy"), "alliance");

      clients["user-b"].send("DIPLOMACY_ACTION", {
        action: "kick",
        target_nation_id: "italy",
      });
      await room.waitForNextPatch();

      assert.strictEqual(stance(room, "france", "italy"), "neutral");
      assert.strictEqual(stance(room, "italy", "spain"), "neutral");
    });

    it("sends diplomacy notifications only to affected player nations", async () => {
      const { clients } = await setupRunningRoom({
        "user-a": "germany",
        "user-b": "france",
        "user-c": "spain",
      });
      const seenA: any[] = [];
      const seenB: any[] = [];
      const seenC: any[] = [];
      clients["user-a"].onMessage("DIPLOMACY_NOTIFICATION", (msg: any) => seenA.push(msg));
      clients["user-b"].onMessage("DIPLOMACY_NOTIFICATION", (msg: any) => seenB.push(msg));
      clients["user-c"].onMessage("DIPLOMACY_NOTIFICATION", (msg: any) => seenC.push(msg));
      const targetPrompt = new Promise<any>(resolve =>
        clients["user-b"].onMessage("DIPLOMACY_INTERACTIVE_NOTIFICATION", resolve)
      );

      clients["user-a"].send("DIPLOMACY_ACTION", {
        action: "invite",
        target_nation_id: "france",
      });
      const prompt = await targetPrompt;
      clients["user-b"].send("DIPLOMACY_VOTE_RESPONSE", {
        vote_id: prompt.vote_id,
        accept: true,
      });
      await wait();

      assert.strictEqual(seenA.length, 2);
      assert.strictEqual(seenB.length, 1);
      assert.strictEqual(seenC.length, 0);
      assert.match(seenA[0].message, /sent an alliance invitation to france/);
      assert.match(seenA[1].message, /invited france/);
    });

    it("allied divisions do not engage, and peace stops active combat", async () => {
      const { room, clients } = await setupRunningRoom({
        "user-a": "germany",
        "user-b": "france",
      });
      setStance(room, "germany", "france", "alliance");
      clients["user-a"].send("SPAWN_DIVISION", {
        division_id: "ally_a",
        nation_id: "germany",
        position_lng: 0,
        position_lat: 0,
      });
      clients["user-a"].send("SPAWN_DIVISION", {
        division_id: "ally_b",
        nation_id: "france",
        position_lng: 0.001,
        position_lat: 0.001,
      });
      await room.waitForNextPatch();

      (room as any).gameTick();
      assert.strictEqual(room.state.divisions.get("ally_a")!.combat_state, "idle");
      assert.strictEqual(room.state.divisions.get("ally_b")!.combat_state, "idle");

      setStance(room, "germany", "france", "neutral");
      clients["user-a"].send("DIPLOMACY_ACTION", {
        action: "declare_war",
        target_nation_id: "france",
      });
      await room.waitForNextPatch();
      (room as any).gameTick();
      assert.strictEqual(room.state.divisions.get("ally_a")!.combat_state, "engaged");
      assert.strictEqual(room.state.divisions.get("ally_b")!.combat_state, "engaged");

      const targetPeaceVote = new Promise<any>(resolve =>
        clients["user-b"].onMessage("DIPLOMACY_INTERACTIVE_NOTIFICATION", resolve)
      );
      const combatEnded = new Promise<any>(resolve =>
        clients["user-a"].onMessage("COMBAT_ENDED", resolve)
      );
      clients["user-a"].send("DIPLOMACY_ACTION", {
        action: "make_peace",
        target_nation_id: "france",
      });
      const peacePrompt = await targetPeaceVote;
      clients["user-b"].send("DIPLOMACY_VOTE_RESPONSE", {
        vote_id: peacePrompt.vote_id,
        accept: true,
      });
      await combatEnded;
      await room.waitForNextPatch();

      assert.strictEqual(room.state.divisions.get("ally_a")!.combat_state, "idle");
      assert.strictEqual(room.state.divisions.get("ally_b")!.combat_state, "idle");
    });

    it("keeps war votes hidden from the target until the vote passes", async () => {
      const { clients } = await setupRunningRoom({
        "user-a": "germany",
        "user-b": "france",
      });
      let targetInteractiveCount = 0;
      const targetResults: any[] = [];
      clients["user-b"].onMessage("DIPLOMACY_INTERACTIVE_NOTIFICATION", () => targetInteractiveCount++);
      clients["user-b"].onMessage("DIPLOMACY_NOTIFICATION", (msg: any) => targetResults.push(msg));

      clients["user-a"].send("DIPLOMACY_ACTION", {
        action: "declare_war",
        target_nation_id: "france",
      });
      await wait();

      assert.strictEqual(targetInteractiveCount, 0);
      assert.strictEqual(targetResults.length, 1);
      assert.match(targetResults[0].message, /declared war/);
    });

    it("rejects overlapping diplomacy proposals involving the same nations", async () => {
      const { clients } = await setupRunningRoom({
        "user-a": "germany",
        "user-b": "france",
        "user-c": "spain",
      });
      const errors: any[] = [];
      clients["user-a"].onMessage("ERROR", (msg: any) => errors.push(msg));

      clients["user-a"].send("DIPLOMACY_ACTION", {
        action: "invite",
        target_nation_id: "france",
      });
      await wait();
      clients["user-a"].send("DIPLOMACY_ACTION", {
        action: "declare_war",
        target_nation_id: "spain",
      });
      await wait();

      assert.strictEqual(errors.length, 1);
      assert.match(errors[0].message, /already active/);
    });
  });
});
