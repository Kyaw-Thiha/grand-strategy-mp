import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { Encoder } from "@colyseus/schema";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import {
  scoreCandidate,
  buildClaimsRegistry,
  visibleEnemyWingsOfTypes,
  anyVisibleEnemyWing,
  resolveInterceptionTargets,
  resolveAirSuperiorityTargets,
  setAirMissionTargetingEnabledForTesting,
} from "../src/systems/air_mission_targeting.js";
import { GameRoomState, RelationState, ProvinceState } from "../src/rooms/schema/GameRoomState.js";
import { AirWingState, MISSION_TYPES, WING_LIFECYCLE } from "../src/rooms/schema/AirWingState.js";
import {
  setPassiveWingRadiusForTesting,
  setReconWingRadiusForTesting,
  setKmPerDegForTesting,
} from "../src/systems/air_detection_system.js";
import { setEngagementRangeForTesting } from "../src/systems/air_dubins_pathfinder.js";
import { setAttackRangeForTesting } from "../src/systems/air_combat_system.js";

function setRelation(state: GameRoomState, a: string, b: string, stance: string): void {
  const rel = new RelationState();
  rel.from_id = a;
  rel.to_id = b;
  rel.stance = stance;
  state.relations.set(`${a}|${b}`, rel);
}

function makeWing(id: string, nationId: string, lng: number, lat: number, aircraftType: string): AirWingState {
  const w = new AirWingState();
  w.wing_id = id;
  w.nation_id = nationId;
  w.aircraft_type = aircraftType;
  w.position_lng = lng;
  w.position_lat = lat;
  w.home_airbase_province_id = "home_prov";
  return w;
}

/** Detection stub that reports every wing as detected by every nation. */
const ALL_DETECTED = { getWingDetectedByNations: (_wingId: string) => new Set(["us", "de", "fr"]) };
const NONE_DETECTED = { getWingDetectedByNations: (_wingId: string) => new Set<string>() };

function makeResolvePosition(positions: Record<string, { lng: number; lat: number }>) {
  return (id: string): { lng: number; lat: number } | null => positions[id] ?? null;
}

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

describe("lane:air-combat | visibleEnemyWingsOfTypes / anyVisibleEnemyWing", () => {
  it("only returns hostile, type-matching, detected wings", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const bomber = makeWing("de_bomber", "de", 1, 0, "tactical_bomber");
    const fighter = makeWing("de_fighter", "de", 1, 0, "fighter");
    const neutral = makeWing("fr_bomber", "fr", 1, 0, "tactical_bomber"); // not hostile (neutral)
    state.air_wings.set("de_bomber", bomber);
    state.air_wings.set("de_fighter", fighter);
    state.air_wings.set("fr_bomber", neutral);

    const result = visibleEnemyWingsOfTypes("us", new Set(["tactical_bomber", "strategic_bomber"]), state, ALL_DETECTED);
    assert.deepStrictEqual(result.map(w => w.wing_id), ["de_bomber"]);
  });

  it("excludes wings not detected by the viewer", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    state.air_wings.set("de_bomber", makeWing("de_bomber", "de", 1, 0, "tactical_bomber"));
    const result = visibleEnemyWingsOfTypes("us", new Set(["tactical_bomber"]), state, NONE_DETECTED);
    assert.deepStrictEqual(result, []);
  });

  it("anyVisibleEnemyWing ignores aircraft type entirely", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    state.air_wings.set("de_recon", makeWing("de_recon", "de", 1, 0, "recon_plane"));
    const result = anyVisibleEnemyWing("us", state, ALL_DETECTED);
    assert.deepStrictEqual(result.map(w => w.wing_id), ["de_recon"]);
  });
});

describe("lane:air-combat | Interception tier chain", () => {
  it("tier 1 prioritizes bombers over fighters and low-alt bombers", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("interceptor", "us", 0, 0, "fighter");
    state.air_wings.set("interceptor", wing);
    state.air_wings.set("de_bomber", makeWing("de_bomber", "de", 1, 0, "strategic_bomber"));
    state.air_wings.set("de_fighter", makeWing("de_fighter", "de", 0.5, 0, "fighter"));

    const result = resolveInterceptionTargets(wing, state, new Map(), ALL_DETECTED, new Map(), makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 1, targetId: "de_bomber" });
  });

  it("tier 2 targets low-altitude bombers when no strategic/tactical bomber is visible", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("interceptor", "us", 0, 0, "fighter");
    state.air_wings.set("interceptor", wing);
    state.air_wings.set("de_cas", makeWing("de_cas", "de", 1, 0, "cas_plane"));
    state.air_wings.set("de_fighter", makeWing("de_fighter", "de", 0.5, 0, "fighter"));

    const result = resolveInterceptionTargets(wing, state, new Map(), ALL_DETECTED, new Map(), makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 2, targetId: "de_cas" });
  });

  it("tier 3 engages any visible enemy wing when no bomber type is present", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("interceptor", "us", 0, 0, "fighter");
    state.air_wings.set("interceptor", wing);
    state.air_wings.set("de_fighter", makeWing("de_fighter", "de", 0.5, 0, "fighter"));

    const result = resolveInterceptionTargets(wing, state, new Map(), ALL_DETECTED, new Map(), makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 3, targetId: "de_fighter" });
  });

  it("falls back to patrol tiers (>=4) when no enemy wing is visible at all", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("interceptor", "us", 0, 0, "fighter");
    state.air_wings.set("interceptor", wing);

    const p1 = new ProvinceState(); p1.province_id = "p1"; p1.owner_id = "us";
    state.provinces.set("p1", p1);
    const resolvePosition = makeResolvePosition({ p1: { lng: 0, lat: 0 }, home_prov: { lng: 0, lat: 0 } });

    const result = resolveInterceptionTargets(wing, state, new Map(), ALL_DETECTED, new Map(), resolvePosition);
    assert.ok(result !== null && result.tier >= 4, `expected a patrol-fallback tier, got ${JSON.stringify(result)}`);
    assert.strictEqual(result!.targetId, "p1");
  });
});

describe("lane:air-combat | Air Superiority tier chain", () => {
  it("tier 1 prioritizes fighters over low-alt and heavy bombers (reversed from Interception)", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("as_wing", "us", 0, 0, "fighter");
    state.air_wings.set("as_wing", wing);
    state.air_wings.set("de_fighter", makeWing("de_fighter", "de", 1, 0, "fighter"));
    state.air_wings.set("de_bomber", makeWing("de_bomber", "de", 0.5, 0, "strategic_bomber"));

    const result = resolveAirSuperiorityTargets(wing, state, new Map(), ALL_DETECTED, new Map(), makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 1, targetId: "de_fighter" });
  });

  it("tier 2 targets low-alt bombers when no enemy fighter is visible", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("as_wing", "us", 0, 0, "fighter");
    state.air_wings.set("as_wing", wing);
    state.air_wings.set("de_cas", makeWing("de_cas", "de", 1, 0, "dive_bomber"));
    state.air_wings.set("de_bomber", makeWing("de_bomber", "de", 0.5, 0, "tactical_bomber"));

    const result = resolveAirSuperiorityTargets(wing, state, new Map(), ALL_DETECTED, new Map(), makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 2, targetId: "de_cas" });
  });

  it("tier 3 targets strategic/tactical bombers when no fighter or low-alt bomber is visible", () => {
    const state = new GameRoomState();
    setRelation(state, "us", "de", "war");
    const wing = makeWing("as_wing", "us", 0, 0, "fighter");
    state.air_wings.set("as_wing", wing);
    state.air_wings.set("de_bomber", makeWing("de_bomber", "de", 0.5, 0, "tactical_bomber"));

    const result = resolveAirSuperiorityTargets(wing, state, new Map(), ALL_DETECTED, new Map(), makeResolvePosition({}));
    assert.deepStrictEqual(result, { tier: 3, targetId: "de_bomber" });
  });
});

// ── Step 5: AirMissionTargetingSystem end-to-end (full room integration) ──────────

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("lane:air-combat | AirMissionTargetingSystem end-to-end", function () {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  let previousDevMode: string | undefined;

  before(async () => {
    previousDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = "true";
    Encoder.BUFFER_SIZE = 256 * 1024;
    setPassiveWingRadiusForTesting(0.5);
    setReconWingRadiusForTesting(2.0);
    setKmPerDegForTesting(100.0);
    setEngagementRangeForTesting(0); // must not trigger combat before targeting/paths assert
    setAttackRangeForTesting(0);     // ditto for AirCombatSystem's own separate attack range
    // AirMissionTargetingSystem defaults OFF under NODE_ENV=test (every other test suite in
    // this repo predates it and manually assigns target_ids that would otherwise get
    // silently overwritten by real patrol-fallback data) — turn it on for this describe
    // block specifically, since it's the one exercising the system end-to-end.
    setAirMissionTargetingEnabledForTesting(true);
    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    if (previousDevMode === undefined) delete process.env.DEV_MODE;
    else process.env.DEV_MODE = previousDevMode;
    setPassiveWingRadiusForTesting(0.1);
    setReconWingRadiusForTesting(1.0);
    setKmPerDegForTesting(111.32);
    setEngagementRangeForTesting(0.3);
    setAttackRangeForTesting(0.3);
    setAirMissionTargetingEnabledForTesting(false);
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

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

  function setNationRelation(room: any, nationA: string, nationB: string, stance: string): void {
    const relation = room.state.relations.get(`${nationA}|${nationB}`)
      ?? room.state.relations.get(`${nationB}|${nationA}`);
    assert.ok(relation, `missing relation ${nationA}|${nationB}`);
    relation.stance = stance;
  }

  function getRoomWing(room: any, wingId: string): any {
    const wing = room.state.air_wings.get(wingId);
    assert.ok(wing, `missing wing ${wingId}`);
    return wing;
  }

  function spawnWing(client: any, msg: {
    wing_id: string;
    nation_id: string;
    aircraft_type?: string;
    position_lng?: number;
    position_lat?: number;
    lifecycle_state?: string;
    mission?: string;
    target_id?: string;
    home_airbase_province_id?: string;
  }): void {
    client.send("SPAWN_WING", msg);
  }

  async function tickRoom(room: any): Promise<void> {
    (room as any).gameTick();
    await room.waitForNextPatch();
  }

  /**
   * Radar-based detection covering the whole test area — passive wing/division detection
   * would require the detecting nation to already have an airborne wing or a division near
   * the target, which these tests don't set up (the wing under test starts IDLE/LOITER, not
   * airborne). A wide radar keeps detection independent of that and focuses each test on the
   * targeting system itself.
   */
  function setWideRadar(room: any, nationId: string): void {
    (room as any).airDetectionSystem.setRadarEntry(`${nationId}_test_radar`, {
      position_lng: 15, position_lat: 50, radius_deg: 20, nation_id: nationId,
    });
  }

  it("an idle interception wing with a visible enemy bomber launches toward it and gets a path", async () => {
    const { client, room } = await joinRoom();
    setNationRelation(room, "germany", "france", "war");
    setWideRadar(room, "germany");

    spawnWing(client, {
      wing_id: "de_int_1", nation_id: "germany", aircraft_type: "fighter",
      position_lng: 10, position_lat: 50,
      lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.INTERCEPTION,
    });
    spawnWing(client, {
      wing_id: "fr_bomber_1", nation_id: "france", aircraft_type: "strategic_bomber",
      position_lng: 10.3, position_lat: 50,
      lifecycle_state: WING_LIFECYCLE.TRANSIT,
    });
    await room.waitForNextPatch();

    const pathEvents: any[] = [];
    client.onMessage("AIR_WING_PATH", (msg: any) => pathEvents.push(msg));

    // First tick lets detection populate is_detected; second tick lets the targeting
    // system react to it (both systems already run within a single gameTick(), but two
    // ticks removes any doubt about ordering/timing for this end-to-end assertion).
    await tickRoom(room);
    await tickRoom(room);

    const interceptor = getRoomWing(room, "de_int_1");
    assert.strictEqual(interceptor.target_id, "fr_bomber_1");
    assert.strictEqual(interceptor.lifecycle_state, WING_LIFECYCLE.TRANSIT);
    assert.ok(pathEvents.some(e => e.wing_id === "de_int_1"),
      "expected an AIR_WING_PATH broadcast for the interceptor");
  });

  it("a freshly-committing interceptor prefers the less-claimed bomber; an already-committed one does not swap (hysteresis)", async () => {
    // NOTE: the naive "both interceptors converge then spread apart" framing is wrong per
    // AIR_COMBAT.md's hysteresis rule ("within the same tier it keeps its current pick") —
    // an interceptor already committed to a valid tier-1 target never swaps to a different,
    // merely-less-crowded tier-1 target. The only way two interceptors legitimately end up
    // on different bombers is if one of them commits for the FIRST time (never targeted
    // anything before) after the second bomber already exists — crowd-balance only steers
    // a fresh decision, never a reassignment away from a currently-valid target.
    const { client, room } = await joinRoom();
    setNationRelation(room, "germany", "france", "war");
    setWideRadar(room, "germany");

    spawnWing(client, {
      wing_id: "de_int_1", nation_id: "germany", aircraft_type: "fighter",
      position_lng: 10, position_lat: 50,
      lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.INTERCEPTION,
    });
    spawnWing(client, {
      wing_id: "fr_bomber_a", nation_id: "france", aircraft_type: "strategic_bomber",
      position_lng: 10.3, position_lat: 50,
      lifecycle_state: WING_LIFECYCLE.TRANSIT,
    });
    await room.waitForNextPatch();
    await tickRoom(room);
    await tickRoom(room);
    assert.strictEqual(getRoomWing(room, "de_int_1").target_id, "fr_bomber_a",
      "precondition: interceptor 1 must commit to bomber A first");

    // Now bring in a second interceptor (never committed before) and a second bomber that
    // is far closer to interceptor 2 than bomber A is, and uncrowded.
    spawnWing(client, {
      wing_id: "de_int_2", nation_id: "germany", aircraft_type: "fighter",
      position_lng: 20, position_lat: 50,
      lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.INTERCEPTION,
    });
    spawnWing(client, {
      wing_id: "fr_bomber_b", nation_id: "france", aircraft_type: "strategic_bomber",
      position_lng: 20.3, position_lat: 50,
      lifecycle_state: WING_LIFECYCLE.TRANSIT,
    });
    await room.waitForNextPatch();
    await tickRoom(room);
    await tickRoom(room);

    assert.strictEqual(getRoomWing(room, "de_int_1").target_id, "fr_bomber_a",
      "already-committed interceptor 1 must NOT swap targets (hysteresis)");
    assert.strictEqual(getRoomWing(room, "de_int_2").target_id, "fr_bomber_b",
      "freshly-committing interceptor 2 should pick the closer, uncrowded bomber");
  });

  it("hysteresis: a wing does not abandon its tier-1 target for another same-tier target", async () => {
    const { client, room } = await joinRoom();
    setNationRelation(room, "germany", "france", "war");
    setWideRadar(room, "germany");

    spawnWing(client, {
      wing_id: "de_int_1", nation_id: "germany", aircraft_type: "fighter",
      position_lng: 10, position_lat: 50,
      lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.INTERCEPTION,
    });
    spawnWing(client, {
      wing_id: "fr_bomber_a", nation_id: "france", aircraft_type: "strategic_bomber",
      position_lng: 10.3, position_lat: 50,
      lifecycle_state: WING_LIFECYCLE.TRANSIT,
    });
    await room.waitForNextPatch();
    await tickRoom(room);
    await tickRoom(room);
    assert.strictEqual(getRoomWing(room, "de_int_1").target_id, "fr_bomber_a",
      "precondition: interceptor must commit to bomber A first");

    // Bomber B: closer to the interceptor than A, and uncrowded — a strictly better score
    // under scoreCandidate, but still only tier 1, same as A.
    spawnWing(client, {
      wing_id: "fr_bomber_b", nation_id: "france", aircraft_type: "strategic_bomber",
      position_lng: 10.05, position_lat: 50,
      lifecycle_state: WING_LIFECYCLE.TRANSIT,
    });
    await room.waitForNextPatch();
    await tickRoom(room);

    assert.strictEqual(getRoomWing(room, "de_int_1").target_id, "fr_bomber_a",
      "wing must keep its current tier-1 pick despite a closer, uncrowded same-tier candidate");
  });

  it("responsiveness: a patrolling wing with only a border-patrol target switches to a newly-visible enemy bomber within one tick", async () => {
    const { client, room } = await joinRoom();
    setNationRelation(room, "germany", "france", "war");
    setWideRadar(room, "germany");

    const interceptor = getRoomWing(room, "germany_wing_01");
    interceptor.mission = MISSION_TYPES.INTERCEPTION;
    interceptor.lifecycle_state = WING_LIFECYCLE.LOITER;
    interceptor.position_lng = 10;
    interceptor.position_lat = 50;
    // Simulate an existing lower-tier (patrol-fallback) target — any real, still-existing
    // entity works here since only the mission/lifecycle_state combination matters for this
    // assertion, not the exact tier number the wing arrived at it through.
    interceptor.target_id = "we6_germany_06";

    spawnWing(client, {
      wing_id: "fr_bomber_1", nation_id: "france", aircraft_type: "strategic_bomber",
      position_lng: 10.3, position_lat: 50,
      lifecycle_state: WING_LIFECYCLE.TRANSIT,
    });
    await room.waitForNextPatch();

    await tickRoom(room);

    const updated = getRoomWing(room, "germany_wing_01");
    assert.strictEqual(updated.target_id, "fr_bomber_1",
      "expected the wing to switch from its patrol target to the newly-visible bomber within one tick");
    assert.strictEqual(updated.lifecycle_state, WING_LIFECYCLE.TRANSIT);
  });

  it("a manually-assigned interception target (is_manual: true) is NOT overridden by auto-search, even when a closer/better-scoring enemy exists", async () => {
    const { client, room } = await joinRoom();
    setNationRelation(room, "germany", "france", "war");
    setWideRadar(room, "germany");

    spawnWing(client, {
      wing_id: "de_int_manual", nation_id: "germany", aircraft_type: "fighter",
      position_lng: 10, position_lat: 50,
      lifecycle_state: WING_LIFECYCLE.IDLE, mission: MISSION_TYPES.IDLE,
    });
    // The player's manual pick: far away, so auto-search would never prefer it on its own.
    spawnWing(client, {
      wing_id: "fr_bomber_manual", nation_id: "france", aircraft_type: "strategic_bomber",
      position_lng: 15, position_lat: 50,
      lifecycle_state: WING_LIFECYCLE.TRANSIT,
    });
    await room.waitForNextPatch();

    client.send("ASSIGN_WING_MISSION", {
      wing_id: "de_int_manual",
      mission: MISSION_TYPES.INTERCEPTION,
      target_id: "fr_bomber_manual",
      is_manual: true,
    });
    await room.waitForNextPatch();
    assert.strictEqual(getRoomWing(room, "de_int_manual").target_id, "fr_bomber_manual",
      "precondition: manual assignment must land");

    // Spawn a closer, uncrowded enemy bomber that a fresh auto-search would strongly prefer.
    spawnWing(client, {
      wing_id: "fr_bomber_closer", nation_id: "france", aircraft_type: "strategic_bomber",
      position_lng: 10.1, position_lat: 50,
      lifecycle_state: WING_LIFECYCLE.TRANSIT,
    });
    await room.waitForNextPatch();

    await tickRoom(room);
    await tickRoom(room);
    await tickRoom(room);

    assert.strictEqual(getRoomWing(room, "de_int_manual").target_id, "fr_bomber_manual",
      "manually-assigned target must survive auto-search ticks even with a closer enemy available");
  });
});
