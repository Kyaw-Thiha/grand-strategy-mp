# Branch B-patch + Branch C: Lifecycle Handlers & Dubins Pathfinding

## Context

Branch B (`AirWingLifecycleSystem`) is complete and merged. This plan covers two things in one branch:

- **B-patch**: Two handlers missing from Branch B — `RETREAT_WING` (manual early-RTB override) and `REDEPLOY_WING` (transfer home base to a new airbase province). These are small additions to the existing `AirWingLifecycleSystem` and `GameRoom.ts`.
- **Branch C**: `DubinsPathfinder` (server-side kinematics), `AirSpatialBucket` (spatial pruning for swept contact checks), wiring into `gameTick`, new `SUBMIT_AIR_WING_MOVE` handler, and client-side `DubinsInterpolator.gd` + right-click-to-move in `air_wing_system.gd`.

**Test-Driven Development is mandatory.** Write failing tests first, then implement to make them pass. Do not write implementation before the corresponding test exists.

---

## Critical Pre-Read: Existing Code Facts

The execution agent MUST NOT misassume any of the following — these are confirmed from the actual codebase:

### Schema fields on `AirWingState` (`game-server/src/rooms/schema/AirWingState.ts`)
All these already exist: `wing_id`, `nation_id`, `aircraft_type`, `count`, `combat_readiness`, `position_lng`, `position_lat`, `heading_deg` (compass degrees: 0=north, 90=east, 180=south, 270=west), `lifecycle_state`, `mission`, `target_id`, `home_airbase_province_id`, `path_gen_id`, `path_elapsed_ms`, `weapon_ready`, `perk_multi_sortie`, `perk_strafing`, `perk_extended_range`, `perk_precision_bombing`.

**`path_gen_id` and `path_elapsed_ms` already exist on the schema** — do NOT add them again.

### Province / airbase coordinates
`ProvinceState` does **not** expose `position_lng` / `position_lat`. Server-side airbase coordinates must come from each province's `city_position` in `client/assets/data/western_europe_6/map_data.json`, via a small server-side lookup helper.

### Existing methods on `AirWingLifecycleSystem`
Already implemented: `tick()`, `assignMission()`, `triggerContact()`, `resolveEngagement()`, `disbandWing()`, `setPerk()`. Do NOT rewrite these.

Private maps that already exist: `_engagementTicks`, `_loiterTicks`, `_rtbTicks`, `_refuelTicks`, `_weaponCooldown`, `_lastEngagedTarget`.

### Existing message handlers in `GameRoom.ts`
Already registered: `ASSIGN_WING_MISSION` (calls `assignMission`), `DISBAND_WING`, `SET_WING_PERK`, `ASSIGN_TEMPLATE`. Test-only: `SET_WING_LIFECYCLE`, `SET_WING_READINESS`, `SET_WING_TARGET`, `SIMULATE_ENGAGEMENT_START`, `SPAWN_WING`.

**`ASSIGN_WING_MISSION` already exists** — Branch C updates it to also generate a Dubins path after calling `assignMission()`. Do NOT add a second handler registration for it.

### Test directory
`game-server/test/` (no `s`). Existing files relevant to this phase: `12a-air-wing-schema.test.ts`, `12b-air-wing-lifecycle.test.ts`, `GameRoom.test.ts`, `movement-jerk.test.ts`, `6a-grid-schema.test.ts`, `6b-perk-extensibility.test.ts`, `6b-round-system.test.ts`, `6-phase-gate.test.ts`.

### GDScript client
`client/src/systems/air/air_wing_system.gd` — already exists with left-click selection. No right-click yet.
`client/src/ui/hud/friendly_air_wing_panel.gd` — already exists, shows stats only, no buttons.
Right-click-to-move buttons (Move, Retreat) on the panel are **K-ui scope** — do NOT add them here.
`CommandQueue.submit(type, payload)` in `client/src/core/command_queue.gd` — the only way to send commands.
`_map_loader.world_to_lng_lat(world_pos)` — already exists; converts Godot Vector2 to lng/lat.
Current client wiring is node-based (`client/scenes/debug/map_debug.tscn` -> `client/src/debug/map_debug.gd` -> `AirWingSystem`), not an `AirSystem` autoload.

---

## Files to Create

| File | Purpose |
|------|---------|
| `game-server/test/12b-patch-lifecycle-handlers.test.ts` | B-patch tests |
| `game-server/test/12c-dubins-path.test.ts` | Branch C unit + integration tests |
| `game-server/src/systems/air_dubins_pathfinder.ts` | DubinsPathfinder class |
| `game-server/src/systems/air_spatial_bucket.ts` | AirSpatialBucket class |
| `client/src/systems/air/dubins_interpolator.gd` | Client-side path evaluator |

## Files to Modify

| File | Change |
|------|--------|
| `game-server/src/systems/air_wing_lifecycle_system.ts` | Add `startRedeploy`, `completeRedeploy`, `retreatWing`, `isPendingRedeploy` |
| `game-server/src/rooms/GameRoom.ts` | Add `airDubinsPathfinder` + `airSpatialBucket` fields, wire into tick, add `RETREAT_WING` / `REDEPLOY_WING` / `SUBMIT_AIR_WING_MOVE` handlers, update `ASSIGN_WING_MISSION`, add test-only `SET_PATH_ELAPSED` handler |
| `game-server/package.json` | Add two new test files to test scripts |
| `client/src/systems/air/air_wing_system.gd` | Right-click handler, `AIR_WING_PATH` message listener, interpolation in `_process`, dashed arc overlay |
| `client/src/core/event_bus.gd` | Add `signal air_wing_move_requested(wing_id, target_lng, target_lat)` |

---

## Step 1: B-patch — Write Tests First

Create `game-server/test/12b-patch-lifecycle-handlers.test.ts`.

**Standard test boilerplate (copy pattern from `6a-grid-schema.test.ts`):**

```typescript
import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE } from "../src/rooms/schema/AirWingState.js";
import {
  setRtbDurationTicksForTesting,
  setRefuelDurationTicksForTesting,
  setReadinessDecayForTesting,
  setReadinessRecoveryForTesting,
} from "../src/systems/air_wing_lifecycle_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

let colyseus: ColyseusTestServer<typeof appConfig>;

before(async () => {
  setRtbDurationTicksForTesting(2);
  setRefuelDurationTicksForTesting(1);
  setReadinessDecayForTesting(0.01);
  setReadinessRecoveryForTesting(0.5);
  colyseus = await boot(appConfig);
});

after(async () => {
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

async function spawnWing(client: any, room: any) {
  client.send("SPAWN_WING", {
    wing_id: "wing-1",
    nation_id: "germany",
    position_lng: 10,
    position_lat: 50,
    heading_deg: 0,
    home_airbase_province_id: "province-berlin",
  });
  await room.waitForNextPatch();
}
```

**RETREAT_WING tests:**

```typescript
describe("RETREAT_WING handler", () => {
  it("RETREAT_WING from TRANSIT → lifecycle becomes RTB", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await room.waitForNextPatch();
    client.send("RETREAT_WING", { wing_id: "wing-1" });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.RTB);
  });

  it("RETREAT_WING from ENGAGED → lifecycle becomes RTB", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.ENGAGED });
    await room.waitForNextPatch();
    client.send("RETREAT_WING", { wing_id: "wing-1" });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.RTB);
  });

  it("RETREAT_WING from LOITER → lifecycle becomes RTB", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.LOITER });
    await room.waitForNextPatch();
    client.send("RETREAT_WING", { wing_id: "wing-1" });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.RTB);
  });

  it("RETREAT_WING from IDLE → no-op (lifecycle stays IDLE)", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    // Wing is IDLE after spawn — no SET_WING_LIFECYCLE needed
    client.send("RETREAT_WING", { wing_id: "wing-1" });
    await new Promise(r => setTimeout(r, 200)); // no schema change expected
    assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.IDLE);
  });

  it("RETREAT_WING from RTB → no-op (lifecycle stays RTB)", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.RTB });
    await room.waitForNextPatch();
    client.send("RETREAT_WING", { wing_id: "wing-1" });
    await new Promise(r => setTimeout(r, 200));
    assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.RTB);
  });

  it("RETREAT_WING rejected for wings owned by a different nation", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SPAWN_WING", {
      wing_id: "wing-france", nation_id: "france",
      position_lng: 5, position_lat: 48, heading_deg: 0,
      home_airbase_province_id: "province-paris",
    });
    await room.waitForNextPatch();
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-france", lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await room.waitForNextPatch();
    client.send("RETREAT_WING", { wing_id: "wing-france" });
    await new Promise(r => setTimeout(r, 200));
    assert.strictEqual(room.state.air_wings.get("wing-france").lifecycle_state, WING_LIFECYCLE.TRANSIT,
      "ownership check must reject retreat of another nation's wing");
  });
});
```

**REDEPLOY_WING tests:**

```typescript
describe("REDEPLOY_WING handler", () => {
  it("REDEPLOY_WING when IDLE → lifecycle becomes TRANSIT", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("REDEPLOY_WING", { wing_id: "wing-1", new_province_id: "province-munich" });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.TRANSIT);
  });

  it("REDEPLOY_WING when not IDLE → rejected (lifecycle unchanged, home base unchanged)", async () => {
    const { client, room } = await joinRoom();
    await spawnWing(client, room);
    client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.TRANSIT });
    await room.waitForNextPatch();
    client.send("REDEPLOY_WING", { wing_id: "wing-1", new_province_id: "province-munich" });
    await new Promise(r => setTimeout(r, 200));
    assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.TRANSIT,
      "must stay TRANSIT — not re-transitioned");
    assert.strictEqual(room.state.air_wings.get("wing-1").home_airbase_province_id, "province-berlin",
      "home base must NOT change on rejected redeploy");
  });
});
```

---

## Step 2: B-patch — Implementation

### 2a. Add to `AirWingLifecycleSystem`

Add a new private map at the class level:
```typescript
private _pendingRedeployTarget: Map<string, string> = new Map();
```

Add these public methods:

```typescript
retreatWing(wingId: string, state: GameRoomState, broadcast: BroadcastFn): void {
  const wing = state.air_wings.get(wingId);
  if (!wing) return;
  const airborne = [WING_LIFECYCLE.TRANSIT, WING_LIFECYCLE.ENGAGED, WING_LIFECYCLE.LOITER];
  if (!(airborne as string[]).includes(wing.lifecycle_state)) return;
  this._engagementTicks.delete(wingId);
  this._loiterTicks.delete(wingId);
  wing.lifecycle_state = WING_LIFECYCLE.RTB;
  broadcast("WING_RTB", { wing_id: wingId, nation_id: wing.nation_id, reason: "player_retreat" });
}

startRedeploy(wingId: string, newProvinceId: string, state: GameRoomState): boolean {
  const wing = state.air_wings.get(wingId);
  if (!wing || wing.lifecycle_state !== WING_LIFECYCLE.IDLE) return false;
  this._pendingRedeployTarget.set(wingId, newProvinceId);
  wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
  return true;
}

completeRedeploy(wingId: string, state: GameRoomState): void {
  const newProvinceId = this._pendingRedeployTarget.get(wingId);
  if (!newProvinceId) return;
  const wing = state.air_wings.get(wingId);
  if (!wing) return;
  wing.home_airbase_province_id = newProvinceId;
  this._pendingRedeployTarget.delete(wingId);
  this._refuelTicks.set(wingId, 0);
  wing.lifecycle_state = WING_LIFECYCLE.REFUEL;
}

isPendingRedeploy(wingId: string): boolean {
  return this._pendingRedeployTarget.has(wingId);
}
```

Also in `disbandWing()`, add: `this._pendingRedeployTarget.delete(wingId);`

### 2b. Add handlers to `GameRoom.ts`

In the production `onMessage` block (same place as ASSIGN_WING_MISSION, DISBAND_WING):

```typescript
this.onMessage("RETREAT_WING", (client, msg: { wing_id: string }) => {
  const wing = this.state.air_wings.get(msg.wing_id);
  if (!wing) return;
  const nation = [...this.state.nations.values()].find(n => n.player_id === client.auth.sub);
  if (!nation || wing.nation_id !== nation.nation_id) return;
  this.airWingLifecycleSystem.retreatWing(msg.wing_id, this.state, broadcast);
});

this.onMessage("REDEPLOY_WING", (client, msg: { wing_id: string; new_province_id: string }) => {
  const wing = this.state.air_wings.get(msg.wing_id);
  if (!wing) return;
  const nation = [...this.state.nations.values()].find(n => n.player_id === client.auth.sub);
  if (!nation || wing.nation_id !== nation.nation_id) return;
  const ok = this.airWingLifecycleSystem.startRedeploy(msg.wing_id, msg.new_province_id, this.state);
  if (!ok) return;
  // Look up airbase coordinates from map data city_position, then generate a transit path.
  // If full arrival handling stays in Branch C, add a test-only arrival hook for this branch.
});
```

**Run B-patch tests before continuing:**
```bash
NODE_ENV=test mocha -r tsx test/12b-patch-lifecycle-handlers.test.ts --exit --timeout 15000
```

---

## Step 3: DubinsPathfinder — Types and Interfaces

Create `game-server/src/systems/air_dubins_pathfinder.ts`.

**Coordinate convention:**
- Positions: `{ lng: number, lat: number }` in degrees
- Headings: **compass degrees** externally (0=north, 90=east) matching `heading_deg` on AirWingState
- Internally convert to **math radians** (0=east, counterclockwise positive) for Dubins calculation: `mathRad = (90 - compassDeg) * Math.PI / 180`
- Turn radius in degrees (one degree ≈ 111 km)
- Flat-earth approximation is correct — game regions span < 5 degrees, error < 0.2%
- Use `TICK_MS = 1000` to match `GameRoom.ts`.

**Types:**

```typescript
export interface DubinsSegment {
  type: "arc" | "straight";
  length_deg: number;        // arc length or straight length in degrees
  // Only for arc segments:
  center_lng?: number;
  center_lat?: number;
  radius_deg?: number;
  start_angle_rad?: number;  // angle from center to start point in math radians
  sweep_rad?: number;        // signed arc angle: positive=CCW, negative=CW
}

export interface DubinsPath {
  path_gen_id: string;                 // UUID v4 — new on every path generation
  path_type: string;                   // "LSL"|"LSR"|"RSL"|"RSR"|"LRL"|"RLR"|"LOITER"
  segments: DubinsSegment[];
  total_length_deg: number;            // sum of all segment lengths
  start_lng: number;
  start_lat: number;
  start_heading_compass_deg: number;
  end_lng: number;
  end_lat: number;
  end_heading_compass_deg: number;
  turn_radius_deg: number;
  speed_deg_per_ms: number;
}

export interface WingPosition {
  lng: number;
  lat: number;
  heading_compass_deg: number;
}

// Shape of the AIR_WING_PATH broadcast message
export interface AirWingPathMessage extends DubinsPath {
  wing_id: string;
}
```

**Tunable constants with test setters:**

```typescript
let WING_SPEED_DEG_PER_MS = 0.0002;
let WING_TURN_RADIUS_DEG  = 0.3;
let ENGAGEMENT_RANGE_DEG  = 0.15;
const TICK_MS = 1000; // must match GameRoom tick interval

export function setWingSpeedForTesting(v: number)       { WING_SPEED_DEG_PER_MS = v; }
export function setTurnRadiusForTesting(v: number)      { WING_TURN_RADIUS_DEG = v; }
export function setEngagementRangeForTesting(v: number) { ENGAGEMENT_RANGE_DEG = v; }
```

**`DubinsPathfinder` class — required public API:**

```typescript
export class DubinsPathfinder {
  /** Transit path from startPos/heading to endPos. End heading is free (minimizes length). */
  computeTransitPath(
    startPos: { lng: number; lat: number },
    startHeadingCompassDeg: number,
    endPos: { lng: number; lat: number }
  ): DubinsPath

  /** RTB: must respect current heading at start. End heading = airbase entry heading. */
  computeRtbPath(
    startPos: { lng: number; lat: number },
    startHeadingCompassDeg: number,
    airbasePos: { lng: number; lat: number },
    airbaseEntryHeadingCompassDeg: number
  ): DubinsPath

  /** Closed orbit circle. path_type = "LOITER". Single arc segment, sweep_rad = 2π. */
  computeLoiterArc(
    centerPos: { lng: number; lat: number },
    radiusDeg: number
  ): DubinsPath

  /** Lead-pursuit path toward a moving target. */
  computePursuitPath(
    startPos: { lng: number; lat: number },
    startHeadingCompassDeg: number,
    targetPos: { lng: number; lat: number },
    targetVelocityDegPerMs: { dlng: number; dlat: number }
  ): DubinsPath

  /** Evaluate position along path at elapsed time. Clamps at path end (never throws). */
  evaluatePosition(path: DubinsPath, elapsedMs: number): WingPosition

  /**
    * Swept contact check for one GameRoom tick window.
   * Uses ≥10 analytic sample points across [0, windowMs]; returns true if any
   * sample has the two wings within engagementRangeDeg of each other.
   * pathAElapsedMs / pathBElapsedMs = elapsed before this window starts.
   */
  sweepCheck(
    pathA: DubinsPath, pathAElapsedMs: number,
    pathB: DubinsPath, pathBElapsedMs: number,
    engagementRangeDeg: number,
    windowMs: number
  ): boolean

  /**
   * Called each gameTick by GameRoom. Advances path_elapsed_ms, updates position/heading,
   * runs sweep checks, triggers triggerContact on hits, handles path completion.
   */
  tick(
    state: GameRoomState,
    tickMs: number,
    spatialBucket: AirSpatialBucket,
    lifecycleSystem: AirWingLifecycleSystem,
    broadcast: BroadcastFn
  ): void
}
```

**Dubins path algorithm notes for implementation:**

The 6 Dubins path types: LSL, RSR, LSR, RSL, RLR, LRL (L=left/CCW arc, R=right/CW arc, S=straight).

Standard implementation steps:
1. Convert start/end headings from compass degrees to math radians
2. Compute four tangent circle centers: `L_start = start + radius * (sin(θ), -cos(θ))` rotated left, `R_start` rotated right, same for end
3. For each of the 6 types, compute tangent lines between the two relevant circles; derive arc angles and straight length using closed-form geometry (see LaValle "Planning Algorithms" §5.4)
4. Discard invalid solutions (imaginary sqrt, negative arc lengths past 2π)
5. Select valid solution with minimum total length
6. Build segment array from the winning type

For **`computeTransitPath`** where end heading is free: try all 6 types with end heading = same as straight-segment direction for each type; pick shortest valid.

For **loiter arc**: single arc segment with `sweep_rad = 2 * Math.PI`. The wing enters the orbit tangentially from its current heading.

**`evaluatePosition` algorithm:**
```
distanceCovered = clamp(elapsedMs * speed_deg_per_ms, 0, total_length_deg)
cursor = { lng: start_lng, lat: start_lat, heading: start_heading_compass_deg }
for each segment:
  if distanceCovered <= segment.length_deg:
    t = distanceCovered  // remaining distance within this segment
    if segment.type === "straight":
      hdgRad = compassToMath(cursor.heading)
      return { lng: cursor.lng + t*cos(hdgRad), lat: cursor.lat + t*sin(hdgRad), heading: cursor.heading }
    else: // arc
      angleTraversed = t / segment.radius_deg   // unsigned radians
      signedAngle = sweep_rad > 0 ? +angleTraversed : -angleTraversed
      newAngle = segment.start_angle_rad + signedAngle
      return {
        lng: center_lng + radius * cos(newAngle),
        lat: center_lat + radius * sin(newAngle),
        heading: mathToCompass(newAngle + (π/2 if CCW else -π/2))
      }
  distanceCovered -= segment.length_deg
  cursor = advance_cursor_to_end_of_segment(segment)
return cursor  // clamped at end
```

**`tick()` implementation:**

```
for each wing in state.air_wings:
  if wing.path_gen_id === "": continue
  wing.path_elapsed_ms += tickMs
  if wing.lifecycle_state === LOITER:
    loiterPeriodMs = path.total_length_deg / speed
    wing.path_elapsed_ms = wing.path_elapsed_ms % loiterPeriodMs
  pos = evaluatePosition(storedPath[wing.wing_id], wing.path_elapsed_ms)
  wing.position_lng = pos.lng
  wing.position_lat = pos.lat
  wing.heading_deg = pos.heading_compass_deg

spatialBucket.clear()
for each TRANSIT or ENGAGED wing: spatialBucket.add(wing_id, wing.position_lng, wing.position_lat)

for each [wingIdA, wingIdB] in spatialBucket.getLocalPairs():
  if wings are enemies AND both in TRANSIT:
    if sweepCheck(pathA, pathA.elapsed, pathB, pathB.elapsed, ENGAGEMENT_RANGE_DEG, tickMs):
      lifecycleSystem.triggerContact(wingIdA, wingIdB, state)
      lifecycleSystem.triggerContact(wingIdB, wingIdA, state)

for each TRANSIT wing where path_elapsed_ms >= pathDurationMs:
  if lifecycleSystem.isPendingRedeploy(wingId):
    lifecycleSystem.completeRedeploy(wingId, state)
    // generate loiter arc at new province position (stays REFUEL via completeRedeploy)
  else:
    wing.lifecycle_state = LOITER
    loiterPath = computeLoiterArc({ lng: wing.position_lng, lat: wing.position_lat }, WING_TURN_RADIUS_DEG)
    storePath(wingId, loiterPath)
    wing.path_gen_id = loiterPath.path_gen_id
    wing.path_elapsed_ms = 0
    broadcast("AIR_WING_PATH", { wing_id: wingId, ...loiterPath })
```

The pathfinder must store active paths internally: `private _activePaths: Map<string, DubinsPath> = new Map()`. Set on path generation, delete in `disbandWing` (call a `clearPath(wingId)` method from GameRoom).

---

## Step 4: DubinsPathfinder — Pure Unit Tests

First section of `game-server/test/12c-dubins-path.test.ts` — no Colyseus server:

```typescript
import assert from "assert";
import { describe, it, before } from "mocha";
import { DubinsPathfinder, setWingSpeedForTesting, setTurnRadiusForTesting } from "../src/systems/air_dubins_pathfinder.js";
import { AirSpatialBucket } from "../src/systems/air_spatial_bucket.js";

const pf = new DubinsPathfinder();
const SPEED = 0.001;
const RADIUS = 0.2;

before(() => {
  setWingSpeedForTesting(SPEED);
  setTurnRadiusForTesting(RADIUS);
});

function headingDiff(a: number, b: number): number {
  const d = Math.abs((a - b + 360) % 360);
  return d > 180 ? 360 - d : d;
}
function dist(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  return Math.sqrt((a.lng - b.lng) ** 2 + (a.lat - b.lat) ** 2);
}
```

```typescript
it("computeTransitPath: evaluatePosition at t=0 returns start heading", () => {
  const path = pf.computeTransitPath({ lng: 10, lat: 50 }, 0, { lng: 11, lat: 50 });
  const start = pf.evaluatePosition(path, 0);
  assert.ok(headingDiff(start.heading_compass_deg, 0) < 1,
    `start heading must be 0 (north), got ${start.heading_compass_deg}`);
});

it("computeTransitPath: evaluatePosition at total time reaches end position", () => {
  const endPos = { lng: 11, lat: 50 };
  const path = pf.computeTransitPath({ lng: 10, lat: 50 }, 90, endPos);
  const totalMs = path.total_length_deg / SPEED;
  const end = pf.evaluatePosition(path, totalMs);
  assert.ok(dist(end, endPos) < 0.05, `end position dist=${dist(end, endPos).toFixed(4)} must be < 0.05`);
});

it("computeRtbPath: start heading matches current wing heading (no instant flip)", () => {
  // Wing heading south (180°), airbase north with entry heading 0°
  const path = pf.computeRtbPath({ lng: 10, lat: 51 }, 180, { lng: 10, lat: 50 }, 0);
  const start = pf.evaluatePosition(path, 0);
  assert.ok(headingDiff(start.heading_compass_deg, 180) < 1,
    `RTB start heading must be 180 (south), got ${start.heading_compass_deg}`);
});

it("computeLoiterArc: is a closed circle (start and end positions match)", () => {
  const center = { lng: 10, lat: 50 };
  const loiter = pf.computeLoiterArc(center, RADIUS);
  assert.strictEqual(loiter.path_type, "LOITER");
  assert.strictEqual(loiter.segments.length, 1, "loiter must be one arc segment");
  const totalMs = loiter.total_length_deg / SPEED;
  const startPos = pf.evaluatePosition(loiter, 0);
  const endPos   = pf.evaluatePosition(loiter, totalMs);
  assert.ok(dist(startPos, endPos) < 0.01,
    `loiter must be closed, gap=${dist(startPos, endPos).toFixed(4)}`);
});

it("computeLoiterArc: all sampled points are at constant radius from center", () => {
  const center = { lng: 10, lat: 50 };
  const loiter = pf.computeLoiterArc(center, RADIUS);
  const totalMs = loiter.total_length_deg / SPEED;
  for (let i = 0; i <= 8; i++) {
    const p = pf.evaluatePosition(loiter, (i / 8) * totalMs);
    const d = dist(p, center);
    assert.ok(Math.abs(d - RADIUS) < 0.01,
      `loiter point at t=${i}/8 is distance ${d.toFixed(4)} from center, expected ${RADIUS}`);
  }
});

it("evaluatePosition: position changes continuously (no teleport between segments)", () => {
  const path = pf.computeTransitPath({ lng: 10, lat: 50 }, 45, { lng: 11, lat: 51 });
  const totalMs = path.total_length_deg / SPEED;
  let prev = pf.evaluatePosition(path, 0);
  for (let i = 1; i <= 20; i++) {
    const cur = pf.evaluatePosition(path, (i / 20) * totalMs);
    const jump = dist(cur, prev);
    assert.ok(jump < 0.15,
      `position jump ${jump.toFixed(4)} at step ${i}/20 is too large — likely segment discontinuity`);
    prev = cur;
  }
});

it("sweepCheck: crossing paths within window → true", () => {
  // A goes east from (9.5, 50), B goes north from (10, 49.5) — they cross near (10, 50)
  const pathA = pf.computeTransitPath({ lng: 9.5, lat: 50 }, 90,  { lng: 10.5, lat: 50 });
  const pathB = pf.computeTransitPath({ lng: 10,  lat: 49.5 }, 0, { lng: 10,   lat: 50.5 });
  assert.strictEqual(pf.sweepCheck(pathA, 0, pathB, 0, 0.08, 2000), true,
    "crossing paths must be detected");
});

it("sweepCheck: parallel paths 0.5° apart → false", () => {
  const pathA = pf.computeTransitPath({ lng: 9.5, lat: 50.0 }, 90, { lng: 10.5, lat: 50.0 });
  const pathB = pf.computeTransitPath({ lng: 9.5, lat: 50.5 }, 90, { lng: 10.5, lat: 50.5 });
  assert.strictEqual(pf.sweepCheck(pathA, 0, pathB, 0, 0.08, 2000), false,
    "parallel paths 0.5° apart must not trigger contact");
});

it("sweepCheck: paths that already passed each other → false in this window", () => {
  const pathA = pf.computeTransitPath({ lng: 9.5, lat: 50 }, 90,  { lng: 10.5, lat: 50 });
  const pathB = pf.computeTransitPath({ lng: 10,  lat: 49.5 }, 0, { lng: 10,   lat: 50.5 });
  // Path A is 10 seconds past start — they've already crossed
  assert.strictEqual(pf.sweepCheck(pathA, 10_000, pathB, 0, 0.08, 500), false,
    "past crossing must not trigger in current window");
});
```

---

## Step 5: AirSpatialBucket — Tests + Implementation

Create `game-server/src/systems/air_spatial_bucket.ts`.

```typescript
export class AirSpatialBucket {
  constructor(cellSizeDeg = 2.0) {}
  clear(): void
  add(wingId: string, lng: number, lat: number): void
  /** Returns unique pairs (no duplicates) where both wings are in same or adjacent (8-neighbor) cell. */
  getLocalPairs(): Array<[string, string]>
}
```

**Unit tests (add to pure section of `12c-dubins-path.test.ts`):**

```typescript
it("AirSpatialBucket: wings in same cell produce exactly one pair", () => {
  const b = new AirSpatialBucket(1.0);
  b.add("wing-1", 10.2, 50.3);
  b.add("wing-2", 10.7, 50.8); // same 1° cell
  const pairs = b.getLocalPairs();
  assert.strictEqual(pairs.length, 1);
  const [a, x] = pairs[0];
  assert.ok((a === "wing-1" && x === "wing-2") || (a === "wing-2" && x === "wing-1"));
});

it("AirSpatialBucket: wings in diagonally adjacent cells produce a pair", () => {
  const b = new AirSpatialBucket(1.0);
  b.add("wing-1", 10.5, 50.5); // cell (10, 50)
  b.add("wing-2", 11.5, 51.5); // cell (11, 51) — diagonal neighbor
  const pairs = b.getLocalPairs();
  assert.strictEqual(pairs.length, 1, "diagonal neighbors must produce a pair");
});

it("AirSpatialBucket: wings two cells apart produce no pair", () => {
  const b = new AirSpatialBucket(1.0);
  b.add("wing-1", 10.5, 50.5); // cell (10, 50)
  b.add("wing-2", 12.5, 50.5); // cell (12, 50) — two cells away
  assert.strictEqual(b.getLocalPairs().length, 0, "two cells apart must not produce a pair");
});

it("AirSpatialBucket: three wings in same cell → 3 unique pairs, no duplicates", () => {
  const b = new AirSpatialBucket(1.0);
  b.add("wing-1", 10.2, 50.3);
  b.add("wing-2", 10.5, 50.5);
  b.add("wing-3", 10.8, 50.7);
  assert.strictEqual(b.getLocalPairs().length, 3);
});

it("AirSpatialBucket: clear() resets all assignments", () => {
  const b = new AirSpatialBucket(1.0);
  b.add("wing-1", 10.2, 50.3);
  b.add("wing-2", 10.7, 50.8);
  b.clear();
  b.add("wing-1", 10.2, 50.3); // only one wing re-added
  assert.strictEqual(b.getLocalPairs().length, 0);
});
```

---

## Step 6: Wire DubinsPathfinder into GameRoom

### 6a. Add fields

In `GameRoom.ts` alongside `airWingLifecycleSystem`:
```typescript
private airDubinsPathfinder = new DubinsPathfinder();
private airSpatialBucket    = new AirSpatialBucket();
```

### 6b. Add pathfinder to `gameTick()`

After the existing `this.airWingLifecycleSystem.tick(...)` line:
```typescript
this.airDubinsPathfinder.tick(this.state, TICK_MS, this.airSpatialBucket, this.airWingLifecycleSystem, broadcast);
```

### 6c. Update existing `ASSIGN_WING_MISSION` handler

Locate the existing handler. After `assignMission()` returns `true`, add:
```typescript
// Resolve target position from target_id
const targetPos = this._resolveTargetPosition(msg.target_id);
if (targetPos) {
  const path = this.airDubinsPathfinder.computeTransitPath(
    { lng: wing.position_lng, lat: wing.position_lat },
    wing.heading_deg,
    targetPos
  );
  wing.path_gen_id = path.path_gen_id;
  wing.path_elapsed_ms = 0;
  this.airDubinsPathfinder.storePath(wing.wing_id, path);
  broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...path } as AirWingPathMessage);
}
```

Add private helper:
```typescript
private _resolveTargetPosition(targetId: string): { lng: number; lat: number } | null {
  const targetWing = this.state.air_wings.get(targetId);
  if (targetWing) return { lng: targetWing.position_lng, lat: targetWing.position_lat };
  const province = this.state.provinces?.get(targetId);
  if (province) return this._provinceCityPositionLookup.get(province.province_id) ?? null;
  return null;
}
```

### 6d. Add `SUBMIT_AIR_WING_MOVE` handler (new)

```typescript
this.onMessage("SUBMIT_AIR_WING_MOVE", (client, msg: {
  wing_id: string;
  target_lng: number;
  target_lat: number;
}) => {
  const wing = this.state.air_wings.get(msg.wing_id);
  if (!wing) return;
  const nation = [...this.state.nations.values()].find(n => n.player_id === client.auth.sub);
  if (!nation || wing.nation_id !== nation.nation_id) return;
  const path = this.airDubinsPathfinder.computeTransitPath(
    { lng: wing.position_lng, lat: wing.position_lat },
    wing.heading_deg,
    { lng: msg.target_lng, lat: msg.target_lat }
  );
  wing.path_gen_id = path.path_gen_id;
  wing.path_elapsed_ms = 0;
  wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
  this.airDubinsPathfinder.storePath(wing.wing_id, path);
  broadcast("AIR_WING_PATH", { wing_id: msg.wing_id, ...path } as AirWingPathMessage);
});
```

### 6e. Update `REDEPLOY_WING` handler (from Step 2b)

After `startRedeploy()` returns `true`, add path generation to province:
```typescript
const provincePos = this._resolveTargetPosition(msg.new_province_id);
if (provincePos) {
  const path = this.airDubinsPathfinder.computeTransitPath(
    { lng: wing.position_lng, lat: wing.position_lat },
    wing.heading_deg,
    provincePos
  );
  wing.path_gen_id = path.path_gen_id;
  wing.path_elapsed_ms = 0;
  this.airDubinsPathfinder.storePath(wing.wing_id, path);
  broadcast("AIR_WING_PATH", { wing_id: msg.wing_id, ...path } as AirWingPathMessage);
}
```

### 6f. Add test-only `SET_PATH_ELAPSED` handler

In the `NODE_ENV === "test"` block:
```typescript
this.onMessage("SET_PATH_ELAPSED", (_client, msg: { wing_id: string; elapsed_ms: number }) => {
  const wing = this.state.air_wings.get(msg.wing_id);
  if (wing) wing.path_elapsed_ms = msg.elapsed_ms;
});
```

---

## Step 7: Integration Tests

Add integration section to `game-server/test/12c-dubins-path.test.ts` after the pure unit tests.

```typescript
// --- Integration tests (require Colyseus server) ---
import { ColyseusTestServer, boot } from "@colyseus/testing";
// ... same makeToken, boot, after, beforeEach, joinRoom, spawnWing as 12b-patch test ...
// Also import:
import { setWingSpeedForTesting, setTurnRadiusForTesting } from "../src/systems/air_dubins_pathfinder.js";
```

In `before()`:
```typescript
setWingSpeedForTesting(0.005); // fast for tests — wing covers 5° per second
setTurnRadiusForTesting(0.1);
```

**Test: SUBMIT_AIR_WING_MOVE**
```typescript
it("SUBMIT_AIR_WING_MOVE: sets path_gen_id, transitions to TRANSIT, broadcasts AIR_WING_PATH", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  const pathPromise = new Promise<any>(resolve => client.onMessage("AIR_WING_PATH", resolve));
  client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-1", target_lng: 15, target_lat: 55 });
  await room.waitForNextPatch();
  const wing = room.state.air_wings.get("wing-1");
  assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.TRANSIT);
  assert.ok(wing.path_gen_id !== "", "path_gen_id must be set");
  assert.strictEqual(wing.path_elapsed_ms, 0);
  const pathMsg = await pathPromise;
  assert.strictEqual(pathMsg.wing_id, "wing-1");
  assert.strictEqual(pathMsg.path_gen_id, wing.path_gen_id, "broadcast path_gen_id must match schema");
  assert.ok(Array.isArray(pathMsg.segments) && pathMsg.segments.length > 0);
  assert.ok(pathMsg.total_length_deg > 0);
});

it("SUBMIT_AIR_WING_MOVE: rejected for wrong nation", async () => {
  const { client, room } = await joinRoom();
  client.send("SPAWN_WING", { wing_id: "wing-france", nation_id: "france",
    position_lng: 5, position_lat: 48, heading_deg: 0, home_airbase_province_id: "province-paris" });
  await room.waitForNextPatch();
  client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-france", target_lng: 10, target_lat: 50 });
  await new Promise(r => setTimeout(r, 200));
  const wing = room.state.air_wings.get("wing-france");
  assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.IDLE, "must reject for other nation");
  assert.strictEqual(wing.path_gen_id, "", "path_gen_id must not be set");
});

it("path_elapsed_ms advances each game tick while TRANSIT", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-1", target_lng: 20, target_lat: 60 });
  await room.waitForNextPatch();
  assert.strictEqual(room.state.air_wings.get("wing-1").path_elapsed_ms, 0);
  (room as any).gameTick();
  await room.waitForNextPatch();
  assert.ok(room.state.air_wings.get("wing-1").path_elapsed_ms > 0, "elapsed must advance after tick");
});

it("wing position_lng changes each tick (wing is moving)", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room); // starts at (10, 50)
  client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-1", target_lng: 20, target_lat: 50 }); // go east
  await room.waitForNextPatch();
  const startLng = room.state.air_wings.get("wing-1").position_lng;
  (room as any).gameTick();
  await room.waitForNextPatch();
  assert.ok(room.state.air_wings.get("wing-1").position_lng > startLng,
    "wing moving east must increase position_lng");
});

it("TRANSIT wing transitions to LOITER when path completes", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-1", target_lng: 10.1, target_lat: 50 }); // short path
  await room.waitForNextPatch();
  client.send("SET_PATH_ELAPSED", { wing_id: "wing-1", elapsed_ms: 999_999 }); // past any path end
  await room.waitForNextPatch();
  (room as any).gameTick();
  await room.waitForNextPatch();
  assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.LOITER,
    "wing must enter LOITER after path completes with no redeploy pending");
});

it("REDEPLOY_WING arrival updates home_airbase_province_id and transitions to REFUEL", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room); // home = "province-berlin"
  client.send("REDEPLOY_WING", { wing_id: "wing-1", new_province_id: "province-munich" });
  await room.waitForNextPatch();
  assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.TRANSIT);
  client.send("SET_PATH_ELAPSED", { wing_id: "wing-1", elapsed_ms: 999_999 }); // test-only arrival hook
  await room.waitForNextPatch();
  (room as any).gameTick();
  await room.waitForNextPatch();
  const wing = room.state.air_wings.get("wing-1");
  assert.strictEqual(wing.home_airbase_province_id, "province-munich",
    "home base must update to new province on arrival");
  assert.ok(
    wing.lifecycle_state === WING_LIFECYCLE.REFUEL || wing.lifecycle_state === WING_LIFECYCLE.IDLE,
    `lifecycle must be REFUEL or IDLE after redeployment, got ${wing.lifecycle_state}`
  );
});

it("redirect mid-TRANSIT generates a new path_gen_id and resets elapsed", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-1", target_lng: 20, target_lat: 50 });
  await room.waitForNextPatch();
  const firstId = room.state.air_wings.get("wing-1").path_gen_id;
  client.send("SUBMIT_AIR_WING_MOVE", { wing_id: "wing-1", target_lng: 5, target_lat: 45 });
  await room.waitForNextPatch();
  assert.notStrictEqual(room.state.air_wings.get("wing-1").path_gen_id, firstId,
    "redirect must generate new path_gen_id");
  assert.strictEqual(room.state.air_wings.get("wing-1").path_elapsed_ms, 0,
    "elapsed must reset on redirect");
});

it("ASSIGN_WING_MISSION generates AIR_WING_PATH broadcast", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  const pathPromise = new Promise<any>(resolve => client.onMessage("AIR_WING_PATH", resolve));
  client.send("ASSIGN_WING_MISSION", { wing_id: "wing-1", mission: "interception", target_id: "province-berlin" });
  await room.waitForNextPatch();
  assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.TRANSIT);
  assert.ok(room.state.air_wings.get("wing-1").path_gen_id !== "");
  const pathMsg = await pathPromise;
  assert.strictEqual(pathMsg.wing_id, "wing-1");
});
```

---

## Step 8: Update package.json

Add the air-wing tests to the test scripts array in `game-server/package.json` (keep the existing `12a` / `12b` coverage and append the new B-patch / C files):
```json
"NODE_ENV=test mocha -r tsx test/12a-air-wing-schema.test.ts --exit --timeout 15000",
"NODE_ENV=test mocha -r tsx test/12b-air-wing-lifecycle.test.ts --exit --timeout 180000",
"NODE_ENV=test mocha -r tsx test/12b-patch-lifecycle-handlers.test.ts --exit --timeout 15000",
"NODE_ENV=test mocha -r tsx test/12c-dubins-path.test.ts --exit --timeout 30000"
```

---

## Step 9: Client — DubinsInterpolator.gd

Create `client/src/systems/air/dubins_interpolator.gd`.

```gdscript
class_name DubinsInterpolator
extends RefCounted

var _segments: Array = []
var _total_length_deg: float = 0.0
var _speed_deg_per_ms: float = 0.0002
var _is_loiter: bool = false
var _local_elapsed_ms: float = 0.0
var _start_lng: float = 0.0
var _start_lat: float = 0.0
var _start_heading: float = 0.0

func load_path(path_msg: Dictionary) -> void:
    _segments = path_msg.get("segments", [])
    _total_length_deg = path_msg.get("total_length_deg", 0.0)
    _speed_deg_per_ms = path_msg.get("speed_deg_per_ms", 0.0002)
    _is_loiter = path_msg.get("path_type", "") == "LOITER"
    _start_lng = path_msg.get("start_lng", 0.0)
    _start_lat = path_msg.get("start_lat", 0.0)
    _start_heading = path_msg.get("start_heading_compass_deg", 0.0)
    _local_elapsed_ms = 0.0

func correct_elapsed(server_elapsed_ms: float) -> void:
    # Blend toward server time — prevents snap jerk on patch arrival
    _local_elapsed_ms = lerpf(_local_elapsed_ms, server_elapsed_ms, 0.2)

func advance(delta_sec: float) -> void:
    _local_elapsed_ms += delta_sec * 1000.0
    if _is_loiter:
        var period_ms := _total_length_deg / _speed_deg_per_ms if _speed_deg_per_ms > 0 else 1.0
        _local_elapsed_ms = fmod(_local_elapsed_ms, period_ms)
    else:
        var max_ms := _total_length_deg / _speed_deg_per_ms if _speed_deg_per_ms > 0 else 0.0
        _local_elapsed_ms = minf(_local_elapsed_ms, max_ms)

func get_position() -> Dictionary:
    return _evaluate(_local_elapsed_ms)

func _evaluate(elapsed_ms: float) -> Dictionary:
    var dist_covered := elapsed_ms * _speed_deg_per_ms
    var cursor := { "lng": _start_lng, "lat": _start_lat, "heading_deg": _start_heading }
    for seg in _segments:
        var seg_len: float = seg.get("length_deg", 0.0)
        if dist_covered <= seg_len:
            return _eval_in_segment(seg, cursor, dist_covered)
        dist_covered -= seg_len
        cursor = _advance_to_end(seg, cursor)
    return cursor

func _eval_in_segment(seg: Dictionary, cursor: Dictionary, t: float) -> Dictionary:
    if seg.get("type") == "straight":
        var hdg_rad := _compass_to_math(cursor.heading_deg)
        return {
            "lng": cursor.lng + t * cos(hdg_rad),
            "lat": cursor.lat + t * sin(hdg_rad),
            "heading_deg": cursor.heading_deg
        }
    else:  # arc
        var radius: float = seg.get("radius_deg", 0.1)
        var sweep: float  = seg.get("sweep_rad", 0.0)
        var c_lng: float  = seg.get("center_lng", 0.0)
        var c_lat: float  = seg.get("center_lat", 0.0)
        var s_ang: float  = seg.get("start_angle_rad", 0.0)
        var angle_t := t / radius
        var signed  := angle_t if sweep >= 0.0 else -angle_t
        var new_ang := s_ang + signed
        var hdg_offset := PI / 2.0 if sweep >= 0.0 else -PI / 2.0
        return {
            "lng": c_lng + radius * cos(new_ang),
            "lat": c_lat + radius * sin(new_ang),
            "heading_deg": _math_to_compass(new_ang + hdg_offset)
        }

func _advance_to_end(seg: Dictionary, cursor: Dictionary) -> Dictionary:
    return _eval_in_segment(seg, cursor, seg.get("length_deg", 0.0))

func _compass_to_math(compass_deg: float) -> float:
    return deg_to_rad(90.0 - compass_deg)

func _math_to_compass(math_rad: float) -> float:
    return fmod(90.0 - rad_to_deg(math_rad) + 720.0, 360.0)
```

---

## Step 10: Client — Update air_wing_system.gd

### 10a. Add interpolator dict

At the top of `air_wing_system.gd`:
```gdscript
var _interpolators: Dictionary = {}  # wing_id (String) -> DubinsInterpolator
```

### 10b. Subscribe to AIR_WING_PATH

In `setup()` or wherever other room messages are subscribed, add:
```gdscript
# room_ref is however the existing code holds a reference to the Colyseus room
room_ref.on_message("AIR_WING_PATH", func(msg): _on_air_wing_path(msg))
```

If the current room-message flow routes through `client/src/systems/session/session_manager.gd`, wire the event there first and forward it to `AirWingSystem`.

```gdscript
func _on_air_wing_path(msg: Dictionary) -> void:
    var wing_id: String = msg.get("wing_id", "")
    if wing_id.is_empty(): return
    if not _interpolators.has(wing_id):
        _interpolators[wing_id] = DubinsInterpolator.new()
    _interpolators[wing_id].load_path(msg)
    if wing_id == _selected_wing_id:
        _draw_selected_wing_path(wing_id)
```

### 10c. Update _on_air_wing_updated to correct elapsed

In the existing `_on_air_wing_updated(wing_id)` handler:
```gdscript
var interp: DubinsInterpolator = _interpolators.get(wing_id)
if interp:
    # Get path_elapsed_ms from the GameState schema (however existing code accesses wing state)
    var wing_data = GameState.air_wings.get(wing_id)  # adjust to match existing access pattern
    if wing_data:
        interp.correct_elapsed(wing_data.path_elapsed_ms)
```

### 10d. Clean up on wing removal

In `_on_air_wing_removed(wing_id)`:
```gdscript
_interpolators.erase(wing_id)
```

### 10e. Smooth movement in _process

```gdscript
func _process(delta: float) -> void:
    for wing_id in _interpolators:
        var interp: DubinsInterpolator = _interpolators[wing_id]
        interp.advance(delta)
        var pos := interp.get_position()
        var icon = _icons.get(wing_id)
        if is_instance_valid(icon):
            var world_pos := _map_loader.lng_lat_to_world(Vector2(pos.lng, pos.lat))
            icon.global_position = world_pos
            icon.rotation = deg_to_rad(pos.heading_deg)
```

Note: `lng_lat_to_world()` must exist on `_map_loader`. If it doesn't exist (it's the inverse of `world_to_lng_lat()`), add it to `map_loader.gd` by inverting the existing transform.

### 10f. Right-click-to-move

In `handle_mouse_input(event, world_pos)`, add right-click branch alongside existing left-click:

```gdscript
elif event.button_index == MOUSE_BUTTON_RIGHT and event.pressed:
    if _selected_wing_id.is_empty():
        return false
    var lng_lat := _map_loader.world_to_lng_lat(world_pos)
    CommandQueue.submit("SUBMIT_AIR_WING_MOVE", {
        "wing_id": _selected_wing_id,
        "target_lng": lng_lat.x,
        "target_lat": lng_lat.y,
    })
    return true
```
This branch should only consume input when a wing is selected and the move request is valid; otherwise land right-click handling must continue to work.

### 10g. Dashed arc overlay

Add a `Line2D` child node in `_ready()`:
```gdscript
var _path_overlay: Line2D

func _ready() -> void:
    _path_overlay = Line2D.new()
    _path_overlay.default_color = Color(1, 1, 0, 0.6)  # yellow, semi-transparent
    _path_overlay.width = 1.5
    # Set dash pattern if Godot version supports it, otherwise use point spacing
    add_child(_path_overlay)
```

```gdscript
func _draw_selected_wing_path(wing_id: String) -> void:
    _path_overlay.clear_points()
    var interp: DubinsInterpolator = _interpolators.get(wing_id)
    if not interp: return
    var elapsed := interp._local_elapsed_ms
    var max_ms := interp._total_length_deg / interp._speed_deg_per_ms if interp._speed_deg_per_ms > 0 else 0.0
    var remaining_ms := max_ms - elapsed
    if remaining_ms <= 0: return
    for i in range(30):
        var t_extra := (float(i) / 29.0) * remaining_ms
        var pos := interp._evaluate(elapsed + t_extra)
        var world := _map_loader.lng_lat_to_world(Vector2(pos.lng, pos.lat))
        _path_overlay.add_point(world)

func _on_wing_selected(wing_id: String) -> void:
    # ... existing selection logic ...
    _draw_selected_wing_path(wing_id)

func _on_wing_deselected() -> void:
    # ... existing deselection logic ...
    _path_overlay.clear_points()
```

---

## Step 11: Add EventBus Signal

In `client/src/core/event_bus.gd`, add after existing air wing signals:
```gdscript
signal air_wing_move_requested(wing_id: String, target_lng: float, target_lat: float)
```

This signal is needed when the Move button is added in K-ui so the button can trigger a move through the system cleanly. Right-click in Branch C calls `CommandQueue.submit` directly (same pattern as land's `_submit_direct_move_order`).

---

## Step 12: Visual Verification Checklist

Run all server tests first:
```bash
cd game-server && npm test
```

All tests must pass. Then launch the game client and verify:

1. **Select wing → right-click map position** → wing icon begins smooth curved movement toward target; dashed yellow arc appears showing the path
2. **Right-click again while moving (redirect)** → wing curves toward new target smoothly (no teleport); arc redraws; path_gen_id changes in debug
3. **Wing reaches destination** → icon begins loitering (circling); arc overlay shows circle
4. **Trigger RETREAT_WING** (via test message or console) from a TRANSIT wing → lifecycle shows RTB; wing curves back to airbase respecting current heading (no flip)
5. **REDEPLOY_WING** → wing transits to new province; on arrival home airbase updates; wing refuels at new location

---

## Common Misassumptions — Critical

| Misassumption | Reality |
|---|---|
| `path_gen_id` and `path_elapsed_ms` need to be added to AirWingState | **They already exist** — adding again breaks the schema |
| `ASSIGN_WING_MISSION` doesn't exist yet | It exists; only update it to also generate a path |
| `heading_deg` is in radians | It is **compass degrees** (0=north, 90=east) — convert internally for math |
| sweepCheck must be purely analytic (no sampling) | Analytic sampling ≥10 points is sufficient and expected |
| `path_elapsed_ms` should wrap in the schema for loiter | Schema holds raw cumulative ms; wrapping happens in pathfinder `tick()` and `DubinsInterpolator.advance()` only |
| `evaluatePosition` past path end can return undefined/throw | Must clamp at path end and return end position — never throw |
| `DubinsInterpolator.correct_elapsed` should snap to server value | Use `lerpf(..., 0.2)` blend — snapping causes jerk every 1000ms patch |
| `AirSpatialBucket.getLocalPairs()` checks only same cell | Must check all **8 neighbors + own cell** (9 total) |
| `REDEPLOY_WING` works on airborne wings | Only allowed from IDLE — reject otherwise |
| `RETREAT_WING` = `DISBAND_WING` | DISBAND removes the wing; RETREAT only forces RTB lifecycle |
| Move/Retreat buttons on panel belong in this branch | Those belong in **K-ui** — do not add them here |
| `lng_lat_to_world()` exists on map_loader | May not exist — add it if missing as inverse of `world_to_lng_lat()` |
| `spawnWing` in tests doesn't need `heading_deg` | Always pass `heading_deg` explicitly so path start heading is deterministic |
| The pathfinder stores paths in AirWingState | Paths are stored in `DubinsPathfinder._activePaths: Map<string, DubinsPath>` — not in schema (too large) |
| `LOITER` path_elapsed_ms keeps growing forever | The `tick()` wraps it modulo loiter period so `evaluatePosition` always gives a valid position |
