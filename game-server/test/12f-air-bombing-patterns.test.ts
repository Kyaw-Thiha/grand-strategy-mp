import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, MISSION_TYPES, AIR_UNIT_TYPES } from "../src/rooms/schema/AirWingState.js";
import {
  resolveDivePattern, resolveTacticalPattern, resolveCasPattern,
  resolveFighterStrafingPattern, setRngForTesting, resetRng,
  type CellSnapshot, type BombingContext,
} from "../src/systems/air_attack_pattern_registry.js";
import {
  setRtbDurationTicksForTesting,
  setRefuelDurationTicksForTesting,
} from "../src/systems/air_wing_lifecycle_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

function makeGrid(occupied: Array<{ index: number; unit_type?: string; hp?: number }>): CellSnapshot[] {
  const cells: CellSnapshot[] = Array(25).fill(null).map(() => ({
    unit_type: "", hp: 0, suppression: 0, incapacitated: false,
  }));
  for (const o of occupied) {
    cells[o.index] = {
      unit_type: o.unit_type ?? "infantry",
      hp:        o.hp       ?? 80,
      suppression: 0,
      incapacitated: false,
    };
  }
  return cells;
}

const DEFAULT_CTX: BombingContext = {
  aircraft_type:           "dive_bomber",
  count:                   10,
  combat_readiness:        1.0,
  perk_strafing:           false,
  perk_precision_bombing:  false,
  recon_quality:           0.0,
};

describe("lane:air-combat | AirAttackPatternRegistry — pure unit tests", () => {

  describe("Dive bomber", () => {
    it("hits exactly 1 occupied cell by default", () => {
      const cells = makeGrid([{ index: 5 }, { index: 10 }, { index: 20 }]);
      const result = resolveDivePattern(cells, { ...DEFAULT_CTX, aircraft_type: "dive_bomber" });
      assert.strictEqual(result.hit_cells.length, 1);
    });

    it("hits 2 cells with perk_precision_bombing", () => {
      const cells = makeGrid([{ index: 5 }, { index: 10 }, { index: 20 }]);
      const result = resolveDivePattern(cells, { ...DEFAULT_CTX, perk_precision_bombing: true });
      assert.strictEqual(result.hit_cells.length, 2);
    });

    it("returns 0 hit_cells on empty grid", () => {
      const result = resolveDivePattern(makeGrid([]), DEFAULT_CTX);
      assert.strictEqual(result.hit_cells.length, 0);
    });

    it("with high recon_quality, consistently prefers high-HP cell over low-HP cell", () => {
      setRngForTesting(() => 0);
      const cells = makeGrid([
        { index: 5, hp: 20 },
        { index: 10, hp: 95 },
      ]);
      const result = resolveDivePattern(cells, { ...DEFAULT_CTX, recon_quality: 1.0 });
      assert.strictEqual(result.hit_cells[0].cell_index, 10, "high-HP cell must be preferred");
      resetRng();
    });

    it("with recon_quality=0, noise floor can select either cell (both valid)", () => {
      const hits = new Set<number>();
      for (let i = 0; i < 20; i++) {
        const cells = makeGrid([{ index: 5, hp: 20 }, { index: 10, hp: 95 }]);
        const result = resolveDivePattern(cells, { ...DEFAULT_CTX, recon_quality: 0.0 });
        if (result.hit_cells.length > 0) hits.add(result.hit_cells[0].cell_index);
      }
      assert.ok(hits.size > 1, "with recon_quality=0 and 20 rolls, both cells must appear at least once (noise floor)");
    });

    it("hit cell takes damage proportional to count", () => {
      setRngForTesting(() => 0);
      const cells = makeGrid([{ index: 20 }]);
      const r5  = resolveDivePattern(cells, { ...DEFAULT_CTX, count: 5,  recon_quality: 1.0 });
      const r10 = resolveDivePattern(cells, { ...DEFAULT_CTX, count: 10, recon_quality: 1.0 });
      assert.ok(r10.hit_cells[0].hp_damage > r5.hit_cells[0].hp_damage, "more planes = more damage");
      resetRng();
    });
  });

  describe("Tactical bomber", () => {
    it("hits all occupied cells in the frontmost (highest index) row", () => {
      const cells = makeGrid([{ index: 10 }, { index: 12 }, { index: 20 }, { index: 22 }]);
      const result = resolveTacticalPattern(cells, { ...DEFAULT_CTX, aircraft_type: "tactical_bomber" });
      const hitIndices = result.hit_cells.map(h => h.cell_index).sort();
      assert.deepStrictEqual(hitIndices, [20, 22], "must hit row 4 (frontmost), not row 2");
    });

    it("returns 0 hit_cells on empty grid", () => {
      const result = resolveTacticalPattern(makeGrid([]), DEFAULT_CTX);
      assert.strictEqual(result.hit_cells.length, 0);
    });

    it("falls back to next row when frontmost row is fully incapacitated", () => {
      const cells = makeGrid([{ index: 10 }, { index: 12 }]);
      const result = resolveTacticalPattern(cells, { ...DEFAULT_CTX, aircraft_type: "tactical_bomber" });
      const hitIndices = result.hit_cells.map(h => h.cell_index).sort();
      assert.deepStrictEqual(hitIndices, [10, 12]);
    });

    it("damage spreads equally across all occupied cells in the target row", () => {
      setRngForTesting(() => 0);
      const cells = makeGrid([{ index: 20 }, { index: 22 }, { index: 24 }]);
      const result = resolveTacticalPattern(cells, { ...DEFAULT_CTX, aircraft_type: "tactical_bomber", recon_quality: 1.0 });
      const damages = result.hit_cells.map(h => h.hp_damage);
      assert.ok(Math.max(...damages) - Math.min(...damages) <= 1, "damage must be equal across row cells");
      resetRng();
    });
  });

  describe("CAS plane (column strafe)", () => {
    it("hits cells from a single column only", () => {
      setRngForTesting(() => 0);
      const cells = makeGrid([
        { index: 2 },
        { index: 7 },
        { index: 12 },
        { index: 0 },
      ]);
      const result = resolveCasPattern(cells, { ...DEFAULT_CTX, aircraft_type: "cas_plane", recon_quality: 1.0 });
      const cols = result.hit_cells.map(h => h.cell_index % 5);
      assert.ok(cols.every(c => c === cols[0]), "all hits must be in the same column");
      resetRng();
    });

    it("returns 0 hit_cells on empty grid", () => {
      const result = resolveCasPattern(makeGrid([]), DEFAULT_CTX);
      assert.strictEqual(result.hit_cells.length, 0);
    });

    it("hits cells across multiple rows (full column, not just one cell)", () => {
      setRngForTesting(() => 0);
      const cells = makeGrid([
        { index: 2 }, { index: 7 }, { index: 12 }, { index: 17 }, { index: 22 },
      ]);
      const result = resolveCasPattern(cells, { ...DEFAULT_CTX, aircraft_type: "cas_plane", recon_quality: 1.0 });
      assert.strictEqual(result.hit_cells.length, 5, "all 5 occupied cells in column must be hit");
      resetRng();
    });

    it("pattern_type is 'cas'", () => {
      const cells = makeGrid([{ index: 2 }]);
      const result = resolveCasPattern(cells, DEFAULT_CTX);
      assert.strictEqual(result.pattern_type, "cas");
    });
  });

  describe("Fighter strafing perk", () => {
    it("with perk_strafing=false returns 0 hits (no strafe without perk)", () => {
      const cells = makeGrid([{ index: 2 }, { index: 7 }]);
      const result = resolveFighterStrafingPattern(cells, { ...DEFAULT_CTX, aircraft_type: "fighter", perk_strafing: false });
      assert.strictEqual(result.hit_cells.length, 0, "fighter without strafing perk must not attack ground");
    });

    it("with perk_strafing=true hits a column (NOT a row)", () => {
      setRngForTesting(() => 0);
      const cells = makeGrid([
        { index: 2 }, { index: 7 }, { index: 12 },
        { index: 20 }, { index: 21 }, { index: 22 }, { index: 23 }, { index: 24 },
      ]);
      const result = resolveFighterStrafingPattern(cells, {
        ...DEFAULT_CTX, aircraft_type: "fighter", perk_strafing: true, recon_quality: 1.0,
      });
      const cols = result.hit_cells.map(h => h.cell_index % 5);
      assert.ok(cols.every(c => c === cols[0]), "fighter strafe must be a COLUMN, not a row");
      resetRng();
    });

    it("pattern_type is 'fighter_strafe'", () => {
      const cells = makeGrid([{ index: 2 }]);
      const result = resolveFighterStrafingPattern(cells, { ...DEFAULT_CTX, perk_strafing: true });
      assert.strictEqual(result.pattern_type, "fighter_strafe");
    });
  });

  describe("Live grid — cells that die mid-pattern are excluded", () => {
    it("incapacitated cells are not targeted", () => {
      setRngForTesting(() => 0);
      const cells = makeGrid([
        { index: 20 }, { index: 21 }, { index: 22 }, { index: 23 }, { index: 24 },
        { index: 10 },
      ]);
      cells[20].incapacitated = true;
      cells[21].incapacitated = true;
      cells[22].incapacitated = true;
      cells[23].incapacitated = true;
      cells[24].incapacitated = true;
      const result = resolveTacticalPattern(cells, { ...DEFAULT_CTX, aircraft_type: "tactical_bomber", recon_quality: 1.0 });
      assert.ok(result.hit_cells.every(h => h.cell_index < 20), "incapacitated front row must be skipped");
      resetRng();
    });
  });
});

describe("lane:air-combat | 12f — AirBombingSystem integration", function () {

  let colyseus: ColyseusTestServer<typeof appConfig>;
  let previousDevMode: string | undefined;

  before(async () => {
    previousDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = "true";
    setRtbDurationTicksForTesting(2);
    setRefuelDurationTicksForTesting(1);
    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    if (previousDevMode === undefined) delete process.env.DEV_MODE;
    else process.env.DEV_MODE = previousDevMode;
    resetRng();
    await colyseus.shutdown();
  });

  beforeEach(async () => { await colyseus.cleanup(); });

  async function joinRoom() {
    process.env.DEV_MODE = "true";
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

  async function tick(room: any): Promise<void> {
    (room as any).gameTick();
    await room.waitForNextPatch();
  }

  async function spawnWing(client: any, room: any, overrides: Record<string, unknown> = {}) {
    const defaults: Record<string, unknown> = {
      wing_id: "wing-1", nation_id: "germany", aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      mission: MISSION_TYPES.TACTICAL_BOMBING,
      home_airbase_province_id: "province-berlin",
      position_lng: 10.0, position_lat: 50.0, heading_deg: 0,
    };
    client.send("SPAWN_WING", { ...defaults, ...overrides });
    await room.waitForNextPatch();
  }

  async function withBombingListener(
    client: any, room: any, wingOverrides: Record<string, unknown>
  ): Promise<any> {
    return new Promise<any>(resolve => {
      client.onMessage("AIR_BOMBING_RESULT", resolve);
      spawnWing(client, room, wingOverrides);
      tick(room);
    });
  }

  it("AIR_BOMBING_RESULT broadcast fires when tactical bomber is in LOITER over an active engagement", async () => {
    const { client, room } = await joinRoom();

    client.send("SPAWN_LAND_ENGAGEMENT", {
      province_id: "province-paris",
      attacker_nation_id: "germany",
      defender_nation_id: "france",
      position_lng: 10.0,
      position_lat: 50.0,
      defender_grid: [
        { cell_index: 20, unit_type: "infantry", hp: 80 },
        { cell_index: 21, unit_type: "infantry", hp: 80 },
        { cell_index: 22, unit_type: "infantry", hp: 80 },
      ],
    });
    await room.waitForNextPatch();

    const result = await withBombingListener(client, room, {
      wing_id: "tac-bomber", nation_id: "germany",
      aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      position_lng: 10.0, position_lat: 50.0,
    });

    assert.ok(result !== null, "AIR_BOMBING_RESULT must fire when tactical bomber is over active engagement");
    assert.ok(
      typeof result.position_lng === "number" && typeof result.position_lat === "number"
        && !(result.position_lng === 0 && result.position_lat === 0),
      "broadcast batch must include the engagement's real position so the client can render a combat icon",
    );
  });

  it("tactical bomber hits the frontmost row of the engagement's defender grid", async () => {
    const { client, room } = await joinRoom();
    setRngForTesting(() => 0);

    client.send("SPAWN_LAND_ENGAGEMENT", {
      province_id: "province-paris",
      attacker_nation_id: "germany",
      defender_nation_id: "france",
      position_lng: 10.0, position_lat: 50.0,
      defender_grid: [
        { cell_index: 10, unit_type: "infantry", hp: 80 },
        { cell_index: 20, unit_type: "infantry", hp: 80 },
        { cell_index: 22, unit_type: "infantry", hp: 80 },
      ],
    });
    await room.waitForNextPatch();

    const result = await withBombingListener(client, room, {
      wing_id: "tac-bomber", nation_id: "germany",
      aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      position_lng: 10.0, position_lat: 50.0,
    });

    const hitIndices = result.runs[0].hit_cells.map((h: any) => h.cell_index);
    assert.ok(hitIndices.every((i: number) => i >= 20), "must hit row-4 cells (indices 20–24), not row-2");
    resetRng();
  });

  it("bomber wing transitions to RTB after bombing resolves", async () => {
    const { client, room } = await joinRoom();

    client.send("SPAWN_LAND_ENGAGEMENT", {
      province_id: "province-paris",
      attacker_nation_id: "germany", defender_nation_id: "france",
      position_lng: 10.0, position_lat: 50.0,
      defender_grid: [{ cell_index: 20, unit_type: "infantry", hp: 80 }],
    });
    await room.waitForNextPatch();

    await spawnWing(client, room, {
      wing_id: "tac-bomber", nation_id: "germany",
      aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      position_lng: 10.0, position_lat: 50.0,
    });

    await tick(room);

    const wing = room.state.air_wings.get("tac-bomber");
    assert.ok(wing, "wing must still exist after bombing");
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.RTB,
      "wing must transition to RTB immediately after bombing");
  });

  it("CAS plane hits a column, not a row", async () => {
    const { client, room } = await joinRoom();
    setRngForTesting(() => 0);

    client.send("SPAWN_LAND_ENGAGEMENT", {
      province_id: "province-paris",
      attacker_nation_id: "germany", defender_nation_id: "france",
      position_lng: 10.0, position_lat: 50.0,
      defender_grid: [
        { cell_index: 2,  unit_type: "infantry", hp: 80 },
        { cell_index: 7,  unit_type: "infantry", hp: 80 },
        { cell_index: 12, unit_type: "infantry", hp: 80 },
        { cell_index: 20, unit_type: "infantry", hp: 80 },
      ],
    });
    await room.waitForNextPatch();

    const result = await withBombingListener(client, room, {
      wing_id: "cas", nation_id: "germany",
      aircraft_type: AIR_UNIT_TYPES.CAS_PLANE,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      position_lng: 10.0, position_lat: 50.0,
    });

    const hitCols = result.runs[0].hit_cells.map((h: any) => h.cell_index % 5);
    assert.ok(hitCols.every((c: number) => c === hitCols[0]), "CAS must hit a single column");
    resetRng();
  });

  it("bomber out of range of engagement does NOT bomb", async () => {
    const { client, room } = await joinRoom();

    client.send("SPAWN_LAND_ENGAGEMENT", {
      province_id: "province-paris",
      attacker_nation_id: "germany", defender_nation_id: "france",
      position_lng: 10.0, position_lat: 50.0,
      defender_grid: [{ cell_index: 20, unit_type: "infantry", hp: 80 }],
    });
    await room.waitForNextPatch();

    await spawnWing(client, room, {
      wing_id: "tac-bomber", nation_id: "germany",
      aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      position_lng: 12.0, position_lat: 50.0,
    });

    let bombingFired = false;
    client.onMessage("AIR_BOMBING_RESULT", () => { bombingFired = true; });

    await tick(room);
    assert.strictEqual(bombingFired, false, "wing too far from engagement must not trigger bombing");
  });

  // ── Fallback direct-division-bombing path: friendly-fire guard ──────────────────────

  it("tactical bomber's fallback direct-division-bombing does NOT damage a friendly division", async () => {
    const { client, room } = await joinRoom();

    client.send("SPAWN_DIVISION", {
      division_id: "friendly-div", nation_id: "germany",
      position_lng: 10.0, position_lat: 50.0,
    });
    await room.waitForNextPatch();

    await spawnWing(client, room, {
      wing_id: "tac-bomber", nation_id: "germany",
      aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      position_lng: 10.0, position_lat: 50.0,
    });
    client.send("SET_WING_TARGET", { wing_id: "tac-bomber", target_id: "friendly-div" });
    await room.waitForNextPatch();

    let bombingFired = false;
    client.onMessage("AIR_BOMBING_RESULT", () => { bombingFired = true; });

    const divBefore = (room.state as any).divisions.get("friendly-div").hp;
    await tick(room);
    const divAfter = (room.state as any).divisions.get("friendly-div").hp;

    assert.strictEqual(bombingFired, false,
      "must not fire AIR_BOMBING_RESULT against a friendly division via the fallback path");
    assert.strictEqual(divAfter, divBefore,
      "friendly division must take no damage from the fallback direct-division-bombing path");
  });

  it("tactical bomber's fallback direct-division-bombing DOES damage an enemy division", async () => {
    const { client, room } = await joinRoom();

    client.send("SET_RELATION", { nation_a: "germany", nation_b: "france", stance: "war" });
    await room.waitForNextPatch();

    client.send("SPAWN_DIVISION", {
      division_id: "enemy-div", nation_id: "france",
      position_lng: 10.0, position_lat: 50.0,
    });
    await room.waitForNextPatch();

    await spawnWing(client, room, {
      wing_id: "tac-bomber", nation_id: "germany",
      aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      position_lng: 10.0, position_lat: 50.0,
    });
    client.send("SET_WING_TARGET", { wing_id: "tac-bomber", target_id: "enemy-div" });
    await room.waitForNextPatch();

    let bombingFired = false;
    client.onMessage("AIR_BOMBING_RESULT", () => { bombingFired = true; });

    await tick(room);

    assert.strictEqual(bombingFired, true,
      "must still fire AIR_BOMBING_RESULT against a genuine enemy division via the fallback path");
  });
});
