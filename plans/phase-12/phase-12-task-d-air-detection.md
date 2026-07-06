# Branch D: Air Detection System

## Context

Branch D adds `AirDetectionSystem` — the binary visibility layer that gates air pathfinding.
Without it, wings have no concept of "can I see that enemy?", so interception logic can't work
and enemy icons are always visible (or always hidden). This is the prerequisite for Branch E
(air-to-air combat), which requires detection to gate the LOITER → pursuit transition.

All other branches (B, C, K-stubs) can run and merge in parallel — Branch D only depends on
Branch A (schema), which is already merged.

**Test-Driven Development is mandatory.** Write failing tests first, then implement.

---

## Critical Pre-Read: Existing Code Facts

The execution agent MUST NOT misassume any of the following:

### Schema — what already exists
- `AirWingState` fields confirmed: `wing_id`, `nation_id`, `aircraft_type`, `count`,
  `combat_readiness`, `position_lng`, `position_lat`, `heading_deg`, `lifecycle_state`,
  `mission`, `target_id`, `home_airbase_province_id`, `path_gen_id`, `path_elapsed_ms`,
  `weapon_ready`, perk booleans.
- **`is_detected` does NOT exist yet** — must be added in Step 1.
- `ProvinceState` has ONLY `province_id` and `owner_id`. No `radar_radius`, no buildings.
  **Do NOT add `radar_radius` to ProvinceState schema.** Store radar data inside
  `AirDetectionSystem._radars: Map<string, RadarEntry>` (province_id → entry).
- `DivisionState.observation_radius` exists and is in **km** (default 100 km). Must convert
  to degrees: `radius_deg = observation_radius_km / KM_PER_DEG` (default 111.32).
  `DivisionState` also has `position_lng`, `position_lat`, `nation_id` — all confirmed.
- `GameRoomState` top-level maps: `players`, `nations`, `provinces`, `divisions`, `relations`,
  `proposals`, `air_wings`.

### WING_LIFECYCLE and MISSION_TYPES exact values (enum / const)
```typescript
// enum WING_LIFECYCLE
IDLE = "idle", TRANSIT = "transit", ENGAGED = "engaged",
LOITER = "loiter", RTB = "rtb", REFUEL = "refuel"

// MISSION_TYPES (const object, not enum)
RECON = "recon", INTERCEPTION = "interception", AIR_SUPERIORITY = "air_superiority", ...
```

### AirWingLifecycleSystem — what already exists
Methods: `tick()`, `assignMission()`, `triggerContact()`, `resolveEngagement()`,
`disbandWing()`, `setPerk()`, `retreatWing()`, `startRedeploy()`, `completeRedeploy()`,
`isPendingRedeploy()`. Do NOT rewrite these.

**`triggerContact(wingId, targetWingId, state)`** transitions wingId IDLE/TRANSIT → ENGAGED.
Do NOT call it for detection — it's for confirmed combat contact. Detection needs a
**new method** `startInterceptionPursuit(wingId, targetWingId, state)` that transitions
LOITER → TRANSIT (see Step 4).

### GameRoom.ts — current gameTick order
```
movementSystem → combatSystem → supplySystem → frontlineSystem
→ airWingLifecycleSystem → airDubinsPathfinder
```
`AirDetectionSystem.tick()` slots in **after** `airDubinsPathfinder` (positions finalized
before detection runs). This means LOITER → TRANSIT transition takes effect on the next
tick's pathfinder run — one-tick delay is acceptable.

### Existing GameRoom handlers (already registered — DO NOT re-register)
Production: `ASSIGN_WING_MISSION`, `RETREAT_WING`, `REDEPLOY_WING`, `SUBMIT_AIR_WING_MOVE`,
`DISBAND_WING`, `SET_WING_PERK`. Test-only: `SET_WING_LIFECYCLE`, `SET_WING_READINESS`,
`SET_WING_TARGET`, `SET_PATH_ELAPSED`, `SIMULATE_ENGAGEMENT_START`, `SPAWN_WING`.

### Test directory and file naming
`game-server/test/` (no `s`). New file: **`12d-air-detection.test.ts`**, timeout 180 000 ms.
Copy boilerplate exactly from `12b-air-wing-lifecycle.test.ts` (has `startGame()`, full
`spawnWing` with overrides, `waitForWingState`/`waitForWingPredicate` helpers).

### Client — current state
- `air_wing_system.gd`: icons hidden/shown purely by `lifecycle_state !== "idle"`. No detection
  filter. Does NOT receive `_vision_system`.
- `event_bus.gd` has: `air_wing_added`, `air_wing_updated`, `air_wing_removed`,
  `air_wing_selected`, `air_wing_deselected`, `air_wing_path`. No detection signals yet.
- Debug circles: drawn via `draw_arc`/`draw_circle` in `_draw()` override on icon nodes.
  `division_icon.gd` is the pattern to follow.
- `map_debug.gd` calls `_air_wing_system.setup(_map_loader, _air_wing_layer)` — does NOT
  pass vision_system. You will add `_air_detection_system` as a new node and wire it.

### Nation hostility check
Use `state.relations` — check how `combat_system.ts` determines enemies and copy the same
pattern. For tests, it is simpler to spawn wings of different nations (e.g., "germany" vs
"france") and rely on the relation state that the game initialises for hostile nations.
**Do not hardcode "germany vs france" as the only hostile pair** — use the relation lookup.

---

## Files to Create

| File | Purpose |
|------|---------|
| `game-server/test/12d-air-detection.test.ts` | All detection tests |
| `game-server/src/systems/air_detection_system.ts` | AirDetectionSystem class |

## Files to Modify

| File | Change |
|------|--------|
| `game-server/src/rooms/schema/AirWingState.ts` | Add `is_detected` boolean field |
| `game-server/src/systems/air_wing_lifecycle_system.ts` | Add `startInterceptionPursuit` method |
| `game-server/src/rooms/GameRoom.ts` | Add `airDetectionSystem` field, wire into tick, add `SET_PROVINCE_RADAR` + `SET_WING_POSITION` test-only handlers |
| `game-server/package.json` | Add `12d-air-detection.test.ts` to test chain |
| `client/src/systems/air/air_wing_system.gd` | Filter enemy icon visibility by `is_detected` |
| `client/src/core/event_bus.gd` | Add `air_wing_detected` / `air_wing_detection_lost` signals |

---

## Step 1: Schema Addition — `is_detected` on AirWingState

### 1a. Write failing schema test first

In `game-server/test/12d-air-detection.test.ts`, add a pure unit test (no server needed):

```typescript
import assert from "assert";
import { describe, it } from "mocha";
import { AirWingState } from "../src/rooms/schema/AirWingState.js";

describe("AirWingState — is_detected field", () => {
  it("defaults is_detected to false", () => {
    const wing = new AirWingState();
    assert.strictEqual(wing.is_detected, false, "is_detected must default to false");
  });
});
```

Run it — expect failure (field does not exist yet).

### 1b. Add field to AirWingState

In `game-server/src/rooms/schema/AirWingState.ts`, add after `weapon_ready`:

```typescript
@type("boolean") is_detected: boolean = false;
```

Run the schema test — it should now pass.

---

## Step 2: Write All Detection Tests First

Create `game-server/test/12d-air-detection.test.ts` with the full test suite.

### Boilerplate (copy exactly from 12b pattern)

```typescript
import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, MISSION_TYPES, AIR_UNIT_TYPES } from "../src/rooms/schema/AirWingState.js";
import {
  setRtbDurationTicksForTesting,
  setRefuelDurationTicksForTesting,
  setReadinessDecayForTesting,
  setReadinessRecoveryForTesting,
} from "../src/systems/air_wing_lifecycle_system.js";
import {
  setPassiveWingRadiusForTesting,
  setReconWingRadiusForTesting,
  setKmPerDegForTesting,
} from "../src/systems/air_detection_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("12d — Air Detection System", function () {
  this.timeout(180_000);

  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    // Shrink detection radii for test speed; use round KM_PER_DEG so km→deg is easy to reason about
    setPassiveWingRadiusForTesting(0.5);   // 0.5° passive detection
    setReconWingRadiusForTesting(2.0);     // 2.0° recon detection
    setKmPerDegForTesting(100.0);          // 1° = 100 km → observation_radius=100km → 1.0°
    setRtbDurationTicksForTesting(2);
    setRefuelDurationTicksForTesting(1);
    setReadinessDecayForTesting(0.01);
    setReadinessRecoveryForTesting(0.5);
    colyseus = await boot(appConfig);
  });

  after(async () => {
    // Restore production defaults
    setPassiveWingRadiusForTesting(0.1);
    setReconWingRadiusForTesting(1.0);
    setKmPerDegForTesting(111.32);
    setRtbDurationTicksForTesting(5);
    setRefuelDurationTicksForTesting(5);
    setReadinessDecayForTesting(0.04);
    setReadinessRecoveryForTesting(0.06);
    await new Promise(r => setTimeout(r, 300));
    await colyseus.shutdown();
  });

  beforeEach(async () => { await colyseus.cleanup(); });

  async function joinRoom() {
    const token  = await makeToken();
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    client.send("SELECT_NATION", { nation_id: "germany" });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    return { client, room };
  }

  // Always pass position and heading explicitly so tests are deterministic.
  async function spawnWing(
    client: any, room: any,
    overrides: Record<string, unknown> = {}
  ) {
    const defaults: Record<string, unknown> = {
      wing_id:                  "wing-1",
      nation_id:                "germany",
      aircraft_type:            AIR_UNIT_TYPES.FIGHTER,
      count:                    10,
      heading_deg:              0,
      home_airbase_province_id: "province-berlin",
      position_lng:             10,
      position_lat:             50,
    };
    client.send("SPAWN_WING", { ...defaults, ...overrides });
    await room.waitForNextPatch();
  }
```

### Radar detection tests

```typescript
  describe("Radar detection", () => {
    it("wing inside radar radius → is_detected becomes true after tick", async () => {
      const { client, room } = await joinRoom();
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      // Germany radar at (9.8, 50) — distance 0.2°, within 1.0° radius
      client.send("SET_PROVINCE_RADAR", {
        province_id: "province-berlin", nation_id: "germany",
        position_lng: 9.8, position_lat: 50.0, radius_deg: 1.0,
      });
      await room.waitForNextPatch();
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-enemy").is_detected, true,
        "enemy wing inside radar must be detected");
    });

    it("wing outside radar radius → is_detected stays false", async () => {
      const { client, room } = await joinRoom();
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 15, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      client.send("SET_PROVINCE_RADAR", {
        province_id: "province-berlin", nation_id: "germany",
        position_lng: 10.0, position_lat: 50.0, radius_deg: 1.0,
      });
      await room.waitForNextPatch();
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-enemy").is_detected, false,
        "enemy wing 5° away from 1° radar must not be detected");
    });

    it("WING_DETECTED broadcast fires when detection state changes false→true", async () => {
      const { client, room } = await joinRoom();
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      const detectedPromise = new Promise<any>(resolve =>
        client.onMessage("WING_DETECTED", resolve));
      client.send("SET_PROVINCE_RADAR", {
        province_id: "province-berlin", nation_id: "germany",
        position_lng: 9.8, position_lat: 50.0, radius_deg: 1.0,
      });
      await room.waitForNextPatch();
      (room as any).gameTick();
      const msg = await detectedPromise;
      assert.strictEqual(msg.wing_id, "wing-enemy");
    });

    it("WING_LOST_DETECTION broadcast fires when detection lapses", async () => {
      const { client, room } = await joinRoom();
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      client.send("SET_PROVINCE_RADAR", {
        province_id: "province-berlin", nation_id: "germany",
        position_lng: 9.8, position_lat: 50.0, radius_deg: 1.0,
      });
      await room.waitForNextPatch();
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-enemy").is_detected, true);
      // Remove radar (radius 0), tick → lost detection
      const lostPromise = new Promise<any>(resolve =>
        client.onMessage("WING_LOST_DETECTION", resolve));
      client.send("SET_PROVINCE_RADAR", {
        province_id: "province-berlin", nation_id: "germany",
        position_lng: 9.8, position_lat: 50.0, radius_deg: 0,
      });
      await room.waitForNextPatch();
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-enemy").is_detected, false);
      const msg = await lostPromise;
      assert.strictEqual(msg.wing_id, "wing-enemy");
    });

    it("IDLE wing is not detected even inside radar radius", async () => {
      const { client, room } = await joinRoom();
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.IDLE,
      });
      client.send("SET_PROVINCE_RADAR", {
        province_id: "province-berlin", nation_id: "germany",
        position_lng: 10.0, position_lat: 50.0, radius_deg: 2.0,
      });
      await room.waitForNextPatch();
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-enemy").is_detected, false,
        "IDLE wings at home base must not be detected");
    });

    it("own wings are never marked is_detected by own sources", async () => {
      const { client, room } = await joinRoom();
      await spawnWing(client, room, {
        wing_id: "wing-own", nation_id: "germany",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      client.send("SET_PROVINCE_RADAR", {
        province_id: "province-berlin", nation_id: "germany",
        position_lng: 10.0, position_lat: 50.0, radius_deg: 2.0,
      });
      await room.waitForNextPatch();
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-own").is_detected, false,
        "own wing must never be detected by own radar");
    });
  });
```

### Recon wing detection tests

```typescript
  describe("Recon wing detection", () => {
    it("recon wing overflying enemy → enemy is_detected = true", async () => {
      const { client, room } = await joinRoom();
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      // German recon at (10.1, 50) — 0.1° apart, within 2.0° recon radius
      await spawnWing(client, room, {
        wing_id: "wing-recon", nation_id: "germany",
        position_lng: 10.1, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
        mission: MISSION_TYPES.RECON,
      });
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-enemy").is_detected, true,
        "recon wing within radius must detect enemy");
    });

    it("recon wing leaves area → detection lapses on next tick", async () => {
      const { client, room } = await joinRoom();
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      await spawnWing(client, room, {
        wing_id: "wing-recon", nation_id: "germany",
        position_lng: 10.1, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
        mission: MISSION_TYPES.RECON,
      });
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-enemy").is_detected, true);
      // Teleport recon wing far away using test handler
      client.send("SET_WING_POSITION", { wing_id: "wing-recon", position_lng: 30, position_lat: 50 });
      await room.waitForNextPatch();
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-enemy").is_detected, false,
        "detection must lapse when recon wing leaves area");
    });

    it("non-RECON wing 1.5° away uses passive radius and does NOT detect", async () => {
      const { client, room } = await joinRoom();
      // passive radius = 0.5° → 1.5° apart is outside; recon radius = 2.0° but this isn't RECON
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      await spawnWing(client, room, {
        wing_id: "wing-friendly", nation_id: "germany",
        position_lng: 11.5, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
        mission: MISSION_TYPES.INTERCEPTION,
      });
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-enemy").is_detected, false,
        "non-RECON wing 1.5° away must not detect with passive radius 0.5°");
    });
  });
```

### Division observation_radius tests

```typescript
  describe("Land division observation_radius detection", () => {
    it("division observation_radius reveals nearby enemy wing", async () => {
      const { client, room } = await joinRoom();
      // KM_PER_DEG = 100, observation_radius = 100 km → 1.0° radius
      // Enemy at (10, 50), division at (9.8, 50) → 0.2° apart, inside 1.0°
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      client.send("SPAWN_DIVISION", {
        division_id: "div-1", nation_id: "germany",
        position_lng: 9.8, position_lat: 50.0,
        observation_radius: 100, // km → 1.0° at KM_PER_DEG=100
      });
      await room.waitForNextPatch();
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-enemy").is_detected, true,
        "enemy wing within division observation radius must be detected");
    });

    it("division does not reveal wing beyond its observation radius", async () => {
      const { client, room } = await joinRoom();
      // Enemy at (10, 50), division at (9.8, 50) → 0.2° apart; radius = 0.1° (10 km)
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      client.send("SPAWN_DIVISION", {
        division_id: "div-1", nation_id: "germany",
        position_lng: 9.8, position_lat: 50.0,
        observation_radius: 10, // km → 0.1°
      });
      await room.waitForNextPatch();
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-enemy").is_detected, false,
        "wing outside division observation radius must not be detected");
    });
  });
```

### Passive wing detection test

```typescript
  describe("Passive wing detection", () => {
    it("friendly wing in flight detects nearby enemy within passive radius", async () => {
      const { client, room } = await joinRoom();
      // passive radius = 0.5°; friendly at (10.3, 50) → 0.3° from enemy at (10, 50)
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      await spawnWing(client, room, {
        wing_id: "wing-passive", nation_id: "germany",
        position_lng: 10.3, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
        mission: MISSION_TYPES.INTERCEPTION,
      });
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-enemy").is_detected, true,
        "enemy within passive wing radius must be detected");
    });
  });
```

### Detection-gating interception tests (key integration tests)

```typescript
  describe("Detection gates Interception LOITER → TRANSIT", () => {
    it("INTERCEPTION wing in LOITER breaks to TRANSIT when enemy is detected", async () => {
      const { client, room } = await joinRoom();
      await spawnWing(client, room, {
        wing_id: "wing-interceptor", nation_id: "germany",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.LOITER,
        mission: MISSION_TYPES.INTERCEPTION,
      });
      // French wing 0.2° away — within passive radius 0.5°
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 10.2, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      (room as any).gameTick();
      await room.waitForNextPatch();
      const interceptor = room.state.air_wings.get("wing-interceptor");
      assert.strictEqual(interceptor.lifecycle_state, WING_LIFECYCLE.TRANSIT,
        "LOITER interceptor must transition to TRANSIT on detection of enemy");
      assert.strictEqual(interceptor.target_id, "wing-enemy",
        "interceptor target_id must be set to the detected enemy wing");
    });

    it("INTERCEPTION wing in LOITER stays LOITER when no enemy is detected", async () => {
      const { client, room } = await joinRoom();
      await spawnWing(client, room, {
        wing_id: "wing-interceptor", nation_id: "germany",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.LOITER,
        mission: MISSION_TYPES.INTERCEPTION,
      });
      // No enemy wing in range at all
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-interceptor").lifecycle_state,
        WING_LIFECYCLE.LOITER, "interceptor must stay LOITER with no detected enemies");
    });

    it("AIR_SUPERIORITY wing in LOITER also pursues on detection", async () => {
      const { client, room } = await joinRoom();
      await spawnWing(client, room, {
        wing_id: "wing-superiority", nation_id: "germany",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.LOITER,
        mission: MISSION_TYPES.AIR_SUPERIORITY,
      });
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 10.2, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-superiority").lifecycle_state,
        WING_LIFECYCLE.TRANSIT);
    });

    it("non-INTERCEPTION wing in LOITER does NOT pursue on detection", async () => {
      const { client, room } = await joinRoom();
      await spawnWing(client, room, {
        wing_id: "wing-bomber", nation_id: "germany",
        position_lng: 10, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.LOITER,
        mission: MISSION_TYPES.TACTICAL_BOMBING,
      });
      await spawnWing(client, room, {
        wing_id: "wing-enemy", nation_id: "france",
        position_lng: 10.2, position_lat: 50,
        lifecycle_state: WING_LIFECYCLE.TRANSIT,
      });
      (room as any).gameTick();
      await room.waitForNextPatch();
      assert.strictEqual(room.state.air_wings.get("wing-bomber").lifecycle_state,
        WING_LIFECYCLE.LOITER,
        "bomber in LOITER must not break out to pursue detected enemy");
    });
  });
```

---

## Step 3: Implement AirDetectionSystem

Create `game-server/src/systems/air_detection_system.ts`.

```typescript
import { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, MISSION_TYPES } from "../rooms/schema/AirWingState.js";
import type { AirWingLifecycleSystem } from "./air_wing_lifecycle_system.js";

type BroadcastFn = (type: string, msg: unknown) => void;

// Module-level tunable constants — override in tests via exported setters
let PASSIVE_WING_RADIUS_DEG = 0.1;    // ~11 km passive detection radius for any airborne wing
let RECON_WING_RADIUS_DEG   = 1.0;    // ~111 km recon wing detection radius
let KM_PER_DEG              = 111.32; // converts DivisionState.observation_radius (km) to degrees

export function setPassiveWingRadiusForTesting(v: number) { PASSIVE_WING_RADIUS_DEG = v; }
export function setReconWingRadiusForTesting(v: number)   { RECON_WING_RADIUS_DEG = v; }
export function setKmPerDegForTesting(v: number)          { KM_PER_DEG = v; }

function euclidDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  return Math.sqrt((lng1 - lng2) ** 2 + (lat1 - lat2) ** 2);
}

export interface RadarEntry {
  position_lng: number;
  position_lat: number;
  radius_deg: number;
  nation_id: string;
}

export class AirDetectionSystem {
  private _radars: Map<string, RadarEntry> = new Map();
  private _prevDetected: Map<string, boolean> = new Map(); // instance-level, not module-level

  setRadarEntry(provinceId: string, entry: RadarEntry): void {
    if (entry.radius_deg <= 0) this._radars.delete(provinceId);
    else this._radars.set(provinceId, entry);
  }

  clearWing(wingId: string): void {
    this._prevDetected.delete(wingId);
  }

  isDetected(wingId: string): boolean {
    return this._prevDetected.get(wingId) ?? false;
  }

  tick(
    state: GameRoomState,
    lifecycleSystem: AirWingLifecycleSystem,
    broadcast: BroadcastFn
  ): void {
    const AIRBORNE = new Set([
      WING_LIFECYCLE.TRANSIT, WING_LIFECYCLE.ENGAGED,
      WING_LIFECYCLE.LOITER, WING_LIFECYCLE.RTB,
    ]);

    const airborneWings = [...state.air_wings.values()]
      .filter(w => AIRBORNE.has(w.lifecycle_state as WING_LIFECYCLE));

    // --- Compute detection for each airborne wing ---
    for (const wing of airborneWings) {
      let detected = false;

      // 1. Radar sources
      if (!detected) {
        for (const radar of this._radars.values()) {
          if (!_areNationsHostile(radar.nation_id, wing.nation_id, state)) continue;
          if (euclidDeg(wing.position_lng, wing.position_lat,
                        radar.position_lng, radar.position_lat) <= radar.radius_deg) {
            detected = true; break;
          }
        }
      }

      // 2. Airborne wing sources (recon = large radius, others = passive radius)
      if (!detected) {
        for (const source of airborneWings) {
          if (source.wing_id === wing.wing_id) continue;
          if (!_areNationsHostile(source.nation_id, wing.nation_id, state)) continue;
          const radius = source.mission === MISSION_TYPES.RECON
            ? RECON_WING_RADIUS_DEG : PASSIVE_WING_RADIUS_DEG;
          if (euclidDeg(wing.position_lng, wing.position_lat,
                        source.position_lng, source.position_lat) <= radius) {
            detected = true; break;
          }
        }
      }

      // 3. Division observation radii
      if (!detected) {
        for (const [, div] of state.divisions) {
          if (!_areNationsHostile(div.nation_id, wing.nation_id, state)) continue;
          const radiusDeg = div.observation_radius / KM_PER_DEG;
          if (euclidDeg(wing.position_lng, wing.position_lat,
                        div.position_lng, div.position_lat) <= radiusDeg) {
            detected = true; break;
          }
        }
      }

      // Update schema and fire events on change
      const wasDetected = this._prevDetected.get(wing.wing_id) ?? false;
      wing.is_detected = detected;
      this._prevDetected.set(wing.wing_id, detected);
      if (detected && !wasDetected)
        broadcast("WING_DETECTED", { wing_id: wing.wing_id, nation_id: wing.nation_id });
      else if (!detected && wasDetected)
        broadcast("WING_LOST_DETECTION", { wing_id: wing.wing_id, nation_id: wing.nation_id });
    }

    // --- LOITER → TRANSIT for interceptors that now have a detected target ---
    const INTERCEPT_MISSIONS = new Set([MISSION_TYPES.INTERCEPTION, MISSION_TYPES.AIR_SUPERIORITY]);
    for (const wing of airborneWings) {
      if (wing.lifecycle_state !== WING_LIFECYCLE.LOITER) continue;
      if (!INTERCEPT_MISSIONS.has(wing.mission as any)) continue;
      let bestTarget: string | null = null;
      let bestDist = Infinity;
      for (const enemy of airborneWings) {
        if (!_areNationsHostile(wing.nation_id, enemy.nation_id, state)) continue;
        if (!enemy.is_detected) continue;
        const d = euclidDeg(wing.position_lng, wing.position_lat,
                            enemy.position_lng, enemy.position_lat);
        if (d < bestDist) { bestDist = d; bestTarget = enemy.wing_id; }
      }
      if (bestTarget) lifecycleSystem.startInterceptionPursuit(wing.wing_id, bestTarget, state);
    }

    // --- Clean up stale detection entries for grounded/removed wings ---
    for (const [wingId] of this._prevDetected) {
      const wing = state.air_wings.get(wingId);
      if (!wing || !AIRBORNE.has(wing.lifecycle_state as WING_LIFECYCLE)) {
        this._prevDetected.delete(wingId);
        if (wing) wing.is_detected = false;
      }
    }
  }
}

function _areNationsHostile(nationA: string, nationB: string, state: GameRoomState): boolean {
  if (nationA === nationB) return false;
  // EXECUTION AGENT: Read combat_system.ts to find the exact _areEnemies / hostile check
  // on state.relations, then implement it here. Do NOT hardcode nation pairs.
  // Typical pattern: iterate state.relations, find entry covering (nationA, nationB),
  // check if relation_type === "war" (or whatever the enum value is in RelationState).
  return false; // stub — replace with real relation check
}
```

**Run tests after Step 3:**
```bash
NODE_ENV=test mocha -r tsx test/12d-air-detection.test.ts --exit --timeout 180000
```

The `_areNationsHostile` stub will cause all tests to fail because no nations are considered
hostile. Fix it before the tests can pass.

---

## Step 4: Add `startInterceptionPursuit` to AirWingLifecycleSystem

In `game-server/src/systems/air_wing_lifecycle_system.ts`, add this public method:

```typescript
startInterceptionPursuit(wingId: string, targetWingId: string, state: GameRoomState): void {
  const wing = state.air_wings.get(wingId);
  if (!wing) return;
  if (wing.lifecycle_state !== WING_LIFECYCLE.LOITER) return;
  const interceptMissions = [MISSION_TYPES.INTERCEPTION, MISSION_TYPES.AIR_SUPERIORITY];
  if (!(interceptMissions as string[]).includes(wing.mission)) return;
  this._loiterTicks.delete(wingId);  // cancel loiter counter
  wing.target_id = targetWingId;
  wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
}
```

---

## Step 5: Wire AirDetectionSystem into GameRoom

### 5a. Add field

```typescript
private airDetectionSystem = new AirDetectionSystem();
```

Import from `"../systems/air_detection_system.js"`.

### 5b. Wire into gameTick — after airDubinsPathfinder

```typescript
this.airDetectionSystem.tick(
  this.state,
  this.airWingLifecycleSystem,
  (type, msg) => this.broadcast(type, msg)
);
```

### 5c. Add test-only handlers (in the isDev / NODE_ENV=test block)

```typescript
this.onMessage("SET_PROVINCE_RADAR", (_client, msg: {
  province_id: string; nation_id: string;
  position_lng: number; position_lat: number; radius_deg: number;
}) => {
  this.airDetectionSystem.setRadarEntry(msg.province_id, {
    position_lng: msg.position_lng, position_lat: msg.position_lat,
    radius_deg: msg.radius_deg, nation_id: msg.nation_id,
  });
});

this.onMessage("SET_WING_POSITION", (_client, msg: {
  wing_id: string; position_lng: number; position_lat: number;
}) => {
  const wing = this.state.air_wings.get(msg.wing_id);
  if (wing) { wing.position_lng = msg.position_lng; wing.position_lat = msg.position_lat; }
});
```

### 5d. Clear on disband

In the `DISBAND_WING` handler, after removing the wing:
```typescript
this.airDetectionSystem.clearWing(msg.wing_id);
```

---

## Step 6: Update package.json

Append to the `test` script chain in `game-server/package.json`:
```
&& NODE_ENV=test mocha -r tsx test/12d-air-detection.test.ts --exit --timeout 180000
```

---

## Step 7: Client — Visibility gating

### 7a. Add EventBus signals

In `client/src/core/event_bus.gd`, after existing air wing signals:
```gdscript
signal air_wing_detected(wing_id: String)
signal air_wing_detection_lost(wing_id: String)
```

### 7b. Wire room messages

Find where `AIR_WING_PATH` room messages are wired in the client session layer and add:
```gdscript
room.on_message("WING_DETECTED",       func(msg): EventBus.air_wing_detected.emit(msg.wing_id))
room.on_message("WING_LOST_DETECTION", func(msg): EventBus.air_wing_detection_lost.emit(msg.wing_id))
```

### 7c. Filter enemy icon visibility in AirWingSystem

Add a centralised visibility helper. Call it from `_on_air_wing_added`,
`_on_air_wing_updated`, and on `air_wing_detected` / `air_wing_detection_lost` signals:

```gdscript
func _update_icon_visibility(wing_id: String) -> void:
    var icon = _icons.get(wing_id)
    if not is_instance_valid(icon): return
    var data = GameState.air_wings.get(wing_id)
    if not data: return
    # Check the actual field used by GameState/SessionManager for local player nation.
    # Do NOT hardcode "germany" — look at how MilitarySystem accesses local nation.
    var is_own := data.nation_id == GameState.local_nation_id
    var airborne := data.lifecycle_state != "idle" and data.lifecycle_state != "refuel"
    if is_own:
        icon.visible = airborne
    else:
        icon.visible = airborne and data.is_detected
```

### 7d. Debug detection overlay (optional — implement after server tests pass)

In `air_wing_icon.gd` `_draw()`, add behind a `show_detection_debug` bool:
```gdscript
if show_detection_debug and _is_airborne:
    draw_arc(Vector2.ZERO, DETECTION_PASSIVE_RADIUS_PX, 0.0, TAU, 32,
             Color(0.2, 0.8, 1.0, 0.25), 1.5)
```
Pattern follows `division_icon.gd`'s existing `draw_arc`/`draw_circle` in `_draw()`.

---

## Step 8: Visual Verification Checklist

Run all server tests:
```bash
cd game-server && npm test
```

All existing tests plus `12d` must pass. Then launch the client and verify:

1. Enemy wing with no detection source → no icon visible
2. Spawn friendly recon wing near enemy → enemy icon appears
3. Teleport recon wing away (`SET_WING_POSITION` console) → enemy icon disappears next tick
4. Add radar via `SET_PROVINCE_RADAR` covering enemy position → icon appears
5. Remove radar (radius 0) → icon disappears
6. German INTERCEPTION wing in LOITER, French wing enters passive radius → interceptor starts
   moving toward French wing (lifecycle = TRANSIT in schema inspector)
7. Own wings always visible regardless of enemy detection state

---

## Common Misassumptions — Critical

| Misassumption | Reality |
|---|---|
| `is_detected` already exists on AirWingState | **It does NOT** — must be added in Step 1 |
| `radar_radius` belongs on ProvinceState schema | **No** — ProvinceState stays minimal; radar stored in `AirDetectionSystem._radars` Map |
| `observation_radius` is in degrees | **It is in km** — divide by `KM_PER_DEG` (111.32) to get degrees |
| `triggerContact` handles detection-triggered pursuit | **No** — `triggerContact` → ENGAGED (combat). Detection uses new `startInterceptionPursuit` → TRANSIT |
| `_prevDetected` can be a module-level variable | **No** — must be instance-level; module-level leaks between test runs |
| Detection runs before pathfinder in gameTick | Detection runs **after** pathfinder — LOITER→TRANSIT takes effect on the NEXT tick's pathfinder run |
| `_areNationsHostile` can hardcode nation pairs | **Never** — read `combat_system.ts` for the exact relation-check pattern |
| IDLE and REFUEL wings should be checked for detection | **No** — only TRANSIT/ENGAGED/LOITER/RTB are detectable; IDLE/REFUEL are at home base |
| Tunable constants need setters on the class instance | Module-level vars with exported functions — same pattern as `air_dubins_pathfinder.ts` |
| Own-nation radar detects own wings | Detection only fires when `source.nation_id` is HOSTILE to `wing.nation_id` |
| All LOITER wings pursue detected enemies | Only `INTERCEPTION` and `AIR_SUPERIORITY` missions; TACTICAL_BOMBING etc. stay in LOITER |
| `SET_WING_POSITION` handler already exists | It does NOT — add it in Step 5c |
| `GameState.local_nation_id` is the right field name | Verify the actual field/method used by MilitarySystem for local player's nation before using it |
