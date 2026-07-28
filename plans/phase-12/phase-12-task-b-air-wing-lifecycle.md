# Phase 12 — Task B: Air Wing Lifecycle System

## Branch: `feat/air-wing-lifecycle`
**Starts after `feat/air-wing-schema` (Branch A) merges.**

---

## Purpose

This branch builds the server-side state machine that drives every air wing through its
lifecycle (IDLE → TRANSIT → ENGAGED → LOITER/RTB → REFUEL → IDLE). It also adds the
production message handlers for player commands (`ASSIGN_WING_MISSION`, `DISBAND_WING`,
`SET_WING_PERK`) and the readiness/weapon-cooldown subsystems.

**What this branch does NOT do:**
- Does not compute real Dubins paths — that is Branch C. TRANSIT is a time-stub here.
- Does not detect contacts — that is Branch D. ENGAGED is triggered via a test handler here.
- Does not apply combat damage — that is Branch E, which will call `resolveEngagement()`.
- Does not update any client UI — that is Branch K-stubs (already done) and K-ui.

---

## Critical Background: How the Server Tick Works

**DO NOT use Node's `setInterval`. Use `this.clock.setInterval` from Colyseus.**

`GameRoom` starts its game loop in `startGame()`:
```typescript
this.clock.setInterval(() => this.gameTick(), TICK_MS); // TICK_MS = 1000ms
```

Each `gameTick()` call currently does this (in order):
```typescript
this.movementSystem.tick(this.state);
const combatChanged = this.combatSystem.tick(this.state, this.tickCount, (type, msg) => this.broadcast(type, msg));
const supplyChanged = this.supplySystem.tick(this.state, this.tickCount, (type, msg) => this.broadcast(type, msg));
this.frontlineSystem.tick(this.state, this.tickCount, (type, msg) => this.broadcast(type, msg));
// ...then DIVISION_UPDATES broadcast
```

The broadcast callback signature throughout the codebase is:
```typescript
(type: string, msg: unknown) => void
```

**The new `AirWingLifecycleSystem.tick()` must be added inside `gameTick()` in `GameRoom.ts`.**

**CRITICAL FOR TESTS: `gameTick()` exits immediately if `this.state.phase !== "running"`**
(line ~770 in GameRoom.ts). The game loop only starts when `startGame()` is called, which
sets `phase = "running"` and starts `this.clock.setInterval(...)`. Any test that needs
lifecycle tick transitions MUST call `await (room as any).startGame()` after joining.
Without this, `SPAWN_WING` will add wings to state but no ticks will ever fire and all
`waitForWingState` calls will hang until timeout.

The exact pattern used by `6b-round-system.test.ts` is:
```typescript
await (room as any).startGame();
await room.waitForNextPatch(); // wait for the first post-start state patch
```

Note: `startGame()` also calls `spawnDivisions()`, which spawns the map's default army
divisions and broadcasts `DIVISIONS_SPAWNED`. This is harmless for air lifecycle tests
(they only read `air_wings`), but be aware these extra state patches exist.
`has_host_pass` in the JWT does NOT matter when calling `startGame()` directly — the
private method bypasses the normal host-session and ready-count checks in the
`START_GAME` message handler.

---

## Critical Background: State Machine Transitions

The post-engagement decision (multi-sortie) was revised from the original plan.
LOITER is NOT a mandatory cooldown. Here is the exact decision tree:

```
After ENGAGED resolves:
  ├── if perk_multi_sortie == false → RTB
  └── if perk_multi_sortie == true:
        ├── wing.target_id is set AND differs from _lastEngagedTarget[wingId]
        │     → TRANSIT  (new target already queued by targeting system)
        └── otherwise (target_id empty, or same as last engaged target)
              → LOITER   (orbiting, waiting for detection to provide a new target)

LOITER exits:
  ├── wing.target_id is set (Branch D/E will set this) → TRANSIT
  └── MAX_LOITER_TICKS elapsed with no target → RTB

Force RTB (overrides any state except IDLE/REFUEL):
  → combat_readiness <= READINESS_RTB_THRESHOLD
```

The lifecycle system tracks `_lastEngagedTarget: Map<string, string>` internally
(NOT in schema — pure server memory) to distinguish "same target" from "new target".

---

## Critical Background: serializeWing Must Be Shared

`_serializeWing` was added to `GameRoom.ts` by Branch K-stubs. The lifecycle system also
needs to serialize wings for `AIR_WING_UPDATES` broadcasts. **Do not duplicate the
serialization logic.** Instead, extract it into an exported function in `AirWingState.ts`:

```typescript
// In AirWingState.ts — add this exported function:
export function serializeWing(wing: AirWingState): Record<string, unknown> {
  return {
    wing_id:                  wing.wing_id,
    nation_id:                wing.nation_id,
    aircraft_type:            wing.aircraft_type,
    count:                    wing.count,
    combat_readiness:         wing.combat_readiness,
    position_lng:             wing.position_lng,
    position_lat:             wing.position_lat,
    heading_deg:              wing.heading_deg,
    lifecycle_state:          wing.lifecycle_state,
    mission:                  wing.mission,
    target_id:                wing.target_id,
    home_airbase_province_id: wing.home_airbase_province_id,
    path_gen_id:              wing.path_gen_id,
    path_elapsed_ms:          wing.path_elapsed_ms,
    weapon_ready:             wing.weapon_ready,
    perk_multi_sortie:        wing.perk_multi_sortie,
    perk_strafing:            wing.perk_strafing,
    perk_extended_range:      wing.perk_extended_range,
    perk_precision_bombing:   wing.perk_precision_bombing,
  };
}
```

**Include ALL schema fields** — `path_gen_id`, `path_elapsed_ms`, and all four `perk_*`
booleans are real fields on `AirWingState` (added in Branch A). Omitting them means
`AIR_WING_UPDATES` would silently drop perk state, breaking `SET_WING_PERK` broadcasts.

Then update `GameRoom.ts` to replace `private _serializeWing(wing)` with an import:
```typescript
import { AirWingState, serializeWing, ... } from "./schema/AirWingState.js";
// Replace all `this._serializeWing(wing)` with `serializeWing(wing)` in GameRoom.ts
```

---

## Critical Background: MapSchema Iteration

`GameRoomState.air_wings` is a Colyseus `MapSchema<AirWingState>`. **Do NOT use
`Object.entries()` or `Object.keys()` on it — they do not work on MapSchema.**

Correct iteration:
```typescript
for (const [wingId, wing] of state.air_wings.entries()) { ... }
```

Correct single lookup:
```typescript
const wing = state.air_wings.get(wingId);
if (!wing) return;
```

---

## Critical Background: Schema Field Mutation

Write directly to schema fields — do not call setters or constructors:
```typescript
wing.lifecycle_state = WING_LIFECYCLE.RTB;  // correct
wing.combat_readiness = Math.max(READINESS_FLOOR, wing.combat_readiness - READINESS_DECAY_PER_TICK);
```

Do NOT call `new AirWingState()` inside the lifecycle system. Wing creation is handled by
the `SPAWN_WING` handler in `GameRoom.ts` (test-only and DEV_MODE paths). There is no
production `CREATE_WING` handler in this branch — that is out of scope here.

---

## Critical Background: Message Handler Registration

In `GameRoom.ts`, there are THREE categories of handlers registered in `onCreate()`:

1. **Production handlers** (top level, always registered):
   ```typescript
   this.onMessage("ASSIGN_WING_MISSION", (client, msg) => ...);
   this.onMessage("DISBAND_WING",        (client, msg) => ...);
   this.onMessage("SET_WING_PERK",       (client, msg) => ...);
   ```

2. **DEV_MODE handlers** (inside `if (process.env.DEV_MODE === "true")`):
   ```typescript
   this.onMessage("DEV_TELEPORT", ...);  // existing
   // optionally add DEV_SPAWN_WING here for visual dev testing
   ```

3. **Test-only handlers** (inside `if (process.env.NODE_ENV === "test")`):
   ```typescript
   this.onMessage("SET_WING_READINESS",         ...);
   this.onMessage("SET_WING_LIFECYCLE",          ...);
   this.onMessage("SET_WING_TARGET",             ...);
   this.onMessage("SIMULATE_ENGAGEMENT_START",   ...);
   ```
   There is NO `TRIGGER_ENGAGEMENT_RESOLVE` handler. Engagement auto-resolves via the
   tick counter (`ENGAGEMENT_AUTO_RESOLVE_TICKS`), which is set to 2 in the test
   `before()` hook. A test handler is therefore unnecessary.

   `SIMULATE_ENGAGEMENT_START` is needed to properly seed `_lastEngagedTarget` so the
   "same target → LOITER" test works. It calls `lifecycleSystem.triggerContact()`, which
   is the same code path Branch C will use. This ensures the "same target" and "new target"
   test cases exercise the real decision logic, not a degenerate empty-map shortcut.

Production handlers **must** validate ownership: check that the client's player owns the
nation that owns the wing. Silently return (no error) for unknown wing IDs (defensive).

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/src/systems/air_wing_lifecycle_system.ts` | Lifecycle state machine + readiness + cooldown |
| `game-server/test/12b-air-wing-lifecycle.test.ts` | All lifecycle tests |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/schema/AirWingState.ts` | Add exported `serializeWing()` function |
| `game-server/src/rooms/GameRoom.ts` | Import system; add to gameTick(); add handlers; update to use exported `serializeWing` |

---

## Step-by-Step Implementation (TDD Order)

### STEP 1 — Extract `serializeWing` from GameRoom into AirWingState.ts

**File:** `game-server/src/rooms/schema/AirWingState.ts`

Add this at the bottom of the file (after all the interface definitions):

```typescript
export function serializeWing(wing: AirWingState): Record<string, unknown> {
  return {
    wing_id:                  wing.wing_id,
    nation_id:                wing.nation_id,
    aircraft_type:            wing.aircraft_type,
    count:                    wing.count,
    combat_readiness:         wing.combat_readiness,
    position_lng:             wing.position_lng,
    position_lat:             wing.position_lat,
    heading_deg:              wing.heading_deg,
    lifecycle_state:          wing.lifecycle_state,
    mission:                  wing.mission,
    target_id:                wing.target_id,
    home_airbase_province_id: wing.home_airbase_province_id,
    path_gen_id:              wing.path_gen_id,
    path_elapsed_ms:          wing.path_elapsed_ms,
    weapon_ready:             wing.weapon_ready,
    perk_multi_sortie:        wing.perk_multi_sortie,
    perk_strafing:            wing.perk_strafing,
    perk_extended_range:      wing.perk_extended_range,
    perk_precision_bombing:   wing.perk_precision_bombing,
  };
}
```

**File:** `game-server/src/rooms/GameRoom.ts`

1. Add `serializeWing` to the import from `"./schema/AirWingState.js"`:
   ```typescript
   import { AirWingState, WING_LIFECYCLE, serializeWing } from "./schema/AirWingState.js";
   ```

2. Delete the `private _serializeWing(wing: AirWingState)` method body entirely.

3. Replace every `this._serializeWing(wing)` call with `serializeWing(wing)`.

---

### STEP 2 — Write the test file BEFORE implementing the system

**File:** `game-server/test/12b-air-wing-lifecycle.test.ts`

Write this file completely before creating `air_wing_lifecycle_system.ts`. The tests
define the expected behaviour; the implementation must satisfy them.

```typescript
import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, MISSION_TYPES, AIR_UNIT_TYPES } from "../src/rooms/schema/AirWingState.js";
import {
  setWeaponCooldownTicksForTesting,
  setEngagementAutoResolveTicksForTesting,
  setMaxLoiterTicksForTesting,
  setRtbDurationTicksForTesting,
  setRefuelDurationTicksForTesting,
  setReadinessDecayForTesting,
  setReadinessRecoveryForTesting,
} from "../src/systems/air_wing_lifecycle_system.js";
```

**Timeout:** `this.timeout(180_000)` — lifecycle tests involve real ticks.

**before() hook:**
```typescript
before(async () => {
  // Speed up all tick-counted timers for fast tests.
  // ENGAGEMENT_AUTO_RESOLVE_TICKS must be 2 (not 1) so the first tick sets
  //   weapon_ready=false (observable) and the second tick resolves the engagement.
  //   With 1, both happen in the same tick — too fast to observe weapon_ready=false.
  // RTB_DURATION_TICKS must be 2 (not 1) so the RTB state is observable before
  //   transitioning to REFUEL. With 1, force-RTB sets RTB and the switch case
  //   immediately advances to REFUEL in the same tick.
  setWeaponCooldownTicksForTesting(1);
  setEngagementAutoResolveTicksForTesting(2);
  setMaxLoiterTicksForTesting(2);
  setRtbDurationTicksForTesting(2);
  setRefuelDurationTicksForTesting(1);
  // decay=0.1: observable (TRANSIT wing goes 1.0→0.9 on tick 1) but SLOW ENOUGH that
  // ENGAGED wings won't hit the RTB threshold (0.25) within ENGAGEMENT_AUTO_RESOLVE_TICKS=2
  // ticks (1.0→0.9→0.8 — both well above 0.25). decay=0.5 would cause force-RTB on tick 2
  // (1.0→0.5→0.15 ≤ 0.25) before resolveEngagement() can run, breaking multi-sortie tests.
  setReadinessDecayForTesting(0.1);
  setReadinessRecoveryForTesting(0.5);   // recover fast: 2 ticks to full from 0.0
  colyseus = await boot(appConfig);
});
```

**after() hook** (always drain 300ms before shutdown):
```typescript
after(async () => {
  // Restore production defaults
  setWeaponCooldownTicksForTesting(3);
  setEngagementAutoResolveTicksForTesting(2);
  setMaxLoiterTicksForTesting(15);
  setRtbDurationTicksForTesting(5);
  setRefuelDurationTicksForTesting(5);
  setReadinessDecayForTesting(0.04);
  setReadinessRecoveryForTesting(0.06);
  await new Promise(r => setTimeout(r, 300));
  await colyseus.shutdown();
});
```

**beforeEach:** `await colyseus.cleanup();`

**joinRoom() helper** — MUST call `startGame()` so `gameTick()` actually runs.
`has_host_pass` value in the JWT is irrelevant here because we call the private
`startGame()` method directly, bypassing the normal `START_GAME` handler checks.

CRITICAL: SELECT_NATION must be called BEFORE startGame() because SELECT_NATION only works
in the "lobby" phase. Production handlers (ASSIGN_WING_MISSION, DISBAND_WING, SET_WING_PERK)
check that the sender owns the wing's nation. getNationForPlayer(userId) matches
`nation.player_id === userId`. SELECT_NATION sets player_id on the "germany" nation object,
which is why the default spawnWing uses `nation_id: "germany"`.
```typescript
async function joinRoom() {
  const token  = await makeToken();
  const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
  const client = await colyseus.connectTo(room, { token });
  await room.waitForNextPatch();
  // Claim "germany" BEFORE startGame — SELECT_NATION only works in lobby phase.
  // This wires player_id → "germany" so production handlers pass ownership checks.
  client.send("SELECT_NATION", { nation_id: "germany" });
  await room.waitForNextPatch(); // LOBBY_STATE_UPDATE
  // Start the game loop — without this, gameTick() exits early and no lifecycle
  // transitions ever fire. Same pattern used by 6b-round-system.test.ts.
  await (room as any).startGame();
  await room.waitForNextPatch(); // first post-start state patch after phase/division changes
  return { client, room };
}
```

**Helper: spawnWing**
```typescript
async function spawnWing(client: any, room: any, overrides: Record<string, unknown> = {}) {
  const defaults = {
    wing_id:                  "wing-1",
    nation_id:                "germany",
    aircraft_type:            AIR_UNIT_TYPES.FIGHTER,
    count:                    10,
    lifecycle_state:          WING_LIFECYCLE.IDLE,
    mission:                  MISSION_TYPES.INTERCEPTION,
    home_airbase_province_id: "berlin",
  };
  client.send("SPAWN_WING", { ...defaults, ...overrides });
  await room.waitForNextPatch();
}
```

**Helper: waitForWingState** (polls until wing.lifecycle_state matches or timeout):
```typescript
async function waitForWingState(
  room: any,
  wingId: string,
  expectedState: string,
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const wing = room.state.air_wings.get(wingId);
    if (wing?.lifecycle_state === expectedState) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    // Race waitForNextPatch against the remaining deadline so the helper actually
    // respects timeoutMs even when patches stop arriving (e.g. when a transition
    // never fires). Without this race, room.waitForNextPatch() can block forever
    // and the while-loop deadline check is never re-evaluated.
    await Promise.race([
      room.waitForNextPatch(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("deadline")), remaining)
      ),
    ]).catch(() => { /* deadline expired — fall through to deadline check */ });
  }
  const wing = room.state.air_wings.get(wingId);
  throw new Error(
    `waitForWingState timed out: expected "${expectedState}", got "${wing?.lifecycle_state}"`
  );
}

async function waitForWingPredicate(
  room: any,
  wingId: string,
  predicate: (wing: any | undefined) => boolean,
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const wing = room.state.air_wings.get(wingId);
    if (predicate(wing)) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await Promise.race([
      room.waitForNextPatch(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("deadline")), remaining)
      ),
    ]).catch(() => { /* deadline expired — fall through to deadline check */ });
  }
  const wing = room.state.air_wings.get(wingId);
  throw new Error(`waitForWingPredicate timed out for wing ${wingId}; last state was ${wing?.lifecycle_state}`);
}

async function waitForWingRemoval(
  room: any,
  wingId: string,
  timeoutMs = 10_000
): Promise<void> {
  await waitForWingPredicate(room, wingId, (wing) => !wing, timeoutMs);
}
```

---

#### Test Group 1: ASSIGN_WING_MISSION (IDLE → TRANSIT)

```typescript
it("ASSIGN_WING_MISSION transitions IDLE wing to TRANSIT", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);

  client.send("ASSIGN_WING_MISSION", {
    wing_id:   "wing-1",
    mission:   MISSION_TYPES.INTERCEPTION,
    target_id: "enemy-wing-99",
  });
  await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);

  const wing = room.state.air_wings.get("wing-1");
  assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.TRANSIT);
  assert.strictEqual(wing.mission,         MISSION_TYPES.INTERCEPTION);
  assert.strictEqual(wing.target_id,       "enemy-wing-99");
});

it("ASSIGN_WING_MISSION on a TRANSIT wing updates mission and target without double-transition", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  client.send("ASSIGN_WING_MISSION", { wing_id: "wing-1", mission: MISSION_TYPES.INTERCEPTION, target_id: "t1" });
  await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);

  // Re-assign while in TRANSIT — should update target without crashing
  client.send("ASSIGN_WING_MISSION", { wing_id: "wing-1", mission: MISSION_TYPES.AIR_SUPERIORITY, target_id: "t2" });
  await room.waitForNextPatch();
  const wing = room.state.air_wings.get("wing-1");
  assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.TRANSIT);
  assert.strictEqual(wing.mission,         MISSION_TYPES.AIR_SUPERIORITY);
  assert.strictEqual(wing.target_id,       "t2");
});

it("ASSIGN_WING_MISSION on an ENGAGED wing is rejected (wing not reassigned to TRANSIT)", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  // Use SET_WING_LIFECYCLE test handler to get into ENGAGED without Branch C pathfinding
  client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.ENGAGED });
  await room.waitForNextPatch(); // wait for ENGAGED schema change

  client.send("ASSIGN_WING_MISSION", { wing_id: "wing-1", mission: MISSION_TYPES.INTERCEPTION, target_id: "t1" });
  // DO NOT use waitForNextPatch() here — ASSIGN is rejected (no schema change emitted).
  // waitForNextPatch() would hang because the lifecycle system's ENGAGED tick won't
  // fire until the next 1000ms interval. Use a short timeout instead.
  // We also can't assert === ENGAGED because the tick may transition the wing to RTB
  // within 2000ms (ENGAGEMENT_AUTO_RESOLVE_TICKS=2). Instead, assert it was NOT
  // accepted into TRANSIT — the only wrong outcome if the rejection guard is missing.
  await new Promise(r => setTimeout(r, 200));
  const wing = room.state.air_wings.get("wing-1");
  assert.notStrictEqual(wing.lifecycle_state, WING_LIFECYCLE.TRANSIT,
    "ENGAGED wing must not be moved to TRANSIT by a rejected ASSIGN_WING_MISSION");
});

it("ASSIGN_WING_MISSION on unknown wing_id is a no-op (no crash)", async () => {
  const { client, room } = await joinRoom();
  client.send("ASSIGN_WING_MISSION", { wing_id: "nonexistent", mission: MISSION_TYPES.INTERCEPTION, target_id: "t1" });
  // No schema change is emitted for a rejected command. Use a timeout, not waitForNextPatch.
  await new Promise(r => setTimeout(r, 200));
  assert.ok(room.state); // no crash
});
```

---

#### Test Group 2: ENGAGED → RTB (single-sortie default)

```typescript
it("single-sortie wing auto-resolves ENGAGED → RTB after engagement ticks", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  // Use SET_WING_LIFECYCLE to bypass Branch C (no pathfinding yet)
  client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.ENGAGED });
  await room.waitForNextPatch();

  // ENGAGEMENT_AUTO_RESOLVE_TICKS is set to 2 in before() — tick 1 sets weapon_ready=false,
  // tick 2 resolves the engagement. waitForWingState polls until RTB is observed.
  await waitForWingState(room, "wing-1", WING_LIFECYCLE.RTB);
  const wing = room.state.air_wings.get("wing-1");
  assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.RTB);
});

it("single-sortie wing progresses RTB → REFUEL → IDLE", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.RTB });
  await room.waitForNextPatch();

  await waitForWingState(room, "wing-1", WING_LIFECYCLE.REFUEL);
  await waitForWingState(room, "wing-1", WING_LIFECYCLE.IDLE);
  const wing = room.state.air_wings.get("wing-1");
  assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.IDLE);
});
```

---

#### Test Group 3: Multi-sortie post-engagement transitions

```typescript
it("multi-sortie wing: no new target after ENGAGED → LOITER", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  // SPAWN_WING does not set perk fields — use SET_WING_PERK after spawn.
  // perk_multi_sortie: true is what gates LOITER vs RTB after engagement.
  client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "multi_sortie", value: true });
  await room.waitForNextPatch();
  // Use SIMULATE_ENGAGEMENT_START to set _lastEngagedTarget (internal map).
  // SET_WING_LIFECYCLE bypasses triggerContact(), so _lastEngagedTarget stays empty.
  // With an empty _lastEngagedTarget, any non-empty target_id looks "new" → TRANSIT.
  // SIMULATE_ENGAGEMENT_START calls lifecycleSystem.triggerContact(wing_id, target_id, state)
  // which populates _lastEngagedTarget correctly before the engagement resolves.
  client.send("SIMULATE_ENGAGEMENT_START", { wing_id: "wing-1", target_wing_id: "enemy-wing-99" });
  await room.waitForNextPatch(); // ENGAGED state set by handler

  // Let engagement auto-resolve (ENGAGEMENT_AUTO_RESOLVE_TICKS=2 ticks).
  // target_id remains "" after engagement (no new target queued).
  // multi-sortie logic: no new target → LOITER.
  await waitForWingState(room, "wing-1", WING_LIFECYCLE.LOITER);
  assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.LOITER);
});

it("multi-sortie wing: new target queued before ENGAGED resolves → TRANSIT directly", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  // SPAWN_WING does not set perk fields — use SET_WING_PERK after spawn.
  client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "multi_sortie", value: true });
  await room.waitForNextPatch();
  // SIMULATE_ENGAGEMENT_START seeds _lastEngagedTarget with "enemy-wing-99" and
  // transitions the wing to ENGAGED.
  client.send("SIMULATE_ENGAGEMENT_START", { wing_id: "wing-1", target_wing_id: "enemy-wing-99" });
  await room.waitForNextPatch(); // ENGAGED

  // Before engagement resolves, assign a DIFFERENT target — this is the "new target" case.
  client.send("SET_WING_TARGET", { wing_id: "wing-1", target_id: "enemy-wing-100" });
  await room.waitForNextPatch();

  // multi-sortie logic: current target_id ("enemy-wing-100") !== lastEngaged ("enemy-wing-99")
  // → skip LOITER → go directly to TRANSIT.
  await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);
  assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.TRANSIT);
  assert.strictEqual(room.state.air_wings.get("wing-1").target_id,       "enemy-wing-100");
});

it("multi-sortie wing: same target after ENGAGED → LOITER (recency penalty, not re-engage)", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  // SPAWN_WING does not set perk fields — use SET_WING_PERK after spawn.
  client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "multi_sortie", value: true });
  await room.waitForNextPatch();
  // SIMULATE_ENGAGEMENT_START seeds _lastEngagedTarget = "enemy-wing-99" and enters ENGAGED.
  // To exercise the actual SAME-TARGET branch, queue the same target again before resolve.
  // resolveEngagement() then compares:
  //   target_id ("enemy-wing-99") === _lastEngagedTarget[wingId] ("enemy-wing-99")
  // which is NOT a new target, so the wing must go to LOITER, not TRANSIT.
  client.send("SIMULATE_ENGAGEMENT_START", { wing_id: "wing-1", target_wing_id: "enemy-wing-99" });
  await room.waitForNextPatch(); // ENGAGED
  client.send("SET_WING_TARGET", { wing_id: "wing-1", target_id: "enemy-wing-99" });
  await room.waitForNextPatch();

  // Let engagement auto-resolve. Same target re-queued → LOITER with stale target cleared.
  await waitForWingState(room, "wing-1", WING_LIFECYCLE.LOITER);
  const wing = room.state.air_wings.get("wing-1");
  assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.LOITER);
  assert.strictEqual(wing.target_id, "", "same-target LOITER path must clear stale target_id after resolve");
});

it("multi-sortie wing in LOITER: target assigned → transitions to TRANSIT", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "multi_sortie", value: true });
  await room.waitForNextPatch();
  client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.LOITER });
  await room.waitForNextPatch();

  client.send("SET_WING_TARGET", { wing_id: "wing-1", target_id: "new-target-wing" });
  await waitForWingState(room, "wing-1", WING_LIFECYCLE.TRANSIT);
  assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.TRANSIT);
});

it("multi-sortie wing in LOITER: MAX_LOITER_TICKS elapsed with no target → RTB", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "multi_sortie", value: true });
  await room.waitForNextPatch();
  client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.LOITER });
  await room.waitForNextPatch();
  // MAX_LOITER_TICKS is 2 in tests; no target will be set → RTB after 2 ticks
  await waitForWingState(room, "wing-1", WING_LIFECYCLE.RTB);
});
```

---

#### Test Group 4: Readiness

```typescript
it("combat_readiness decays each tick while airborne (TRANSIT)", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room, { lifecycle_state: WING_LIFECYCLE.TRANSIT });
  const before = room.state.air_wings.get("wing-1").combat_readiness;
  await waitForWingPredicate(room, "wing-1", (wing) => !!wing && wing.combat_readiness < before);
  const after = room.state.air_wings.get("wing-1").combat_readiness;
  assert.ok(after < before, "readiness must decay while airborne");
});

it("combat_readiness never decays below READINESS_FLOOR (0.15)", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  client.send("SET_WING_READINESS", { wing_id: "wing-1", combat_readiness: 0.16 });
  await room.waitForNextPatch(); // handler patch: readiness override
  client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.TRANSIT });
  await room.waitForNextPatch(); // handler patch: lifecycle override
  // With decay=0.1 in tests, 0.16 - 0.1 = 0.06 which is below the floor (0.15).
  // The floor clamp must prevent it dropping below 0.15.
  await waitForWingPredicate(room, "wing-1", (wing) => !!wing && wing.combat_readiness < 0.16);
  const wing = room.state.air_wings.get("wing-1");
  assert.ok(wing.combat_readiness >= 0.15, `readiness must be >= 0.15, got ${wing.combat_readiness}`);
});

it("combat_readiness recovers each tick while IDLE at base", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  client.send("SET_WING_READINESS", { wing_id: "wing-1", combat_readiness: 0.5 });
  await room.waitForNextPatch();

  const before = room.state.air_wings.get("wing-1").combat_readiness;
  await room.waitForNextPatch(); // one tick in IDLE
  const after = room.state.air_wings.get("wing-1").combat_readiness;
  assert.ok(after > before, "readiness must recover while IDLE");
});

it("combat_readiness does not exceed 1.0 while recovering", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  // Readiness at 0.9, recovery rate 0.5 → would exceed 1.0 without clamp
  client.send("SET_WING_READINESS", { wing_id: "wing-1", combat_readiness: 0.9 });
  await room.waitForNextPatch();
  await room.waitForNextPatch(); // one tick
  const wing = room.state.air_wings.get("wing-1");
  assert.ok(wing.combat_readiness <= 1.0, "readiness must not exceed 1.0");
});

it("combat_readiness also recovers during REFUEL", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  client.send("SET_WING_READINESS", { wing_id: "wing-1", combat_readiness: 0.3 });
  await room.waitForNextPatch(); // handler patch: readiness override
  client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.REFUEL });
  await room.waitForNextPatch(); // handler patch: REFUEL override

  const before = room.state.air_wings.get("wing-1").combat_readiness;
  await waitForWingPredicate(room, "wing-1", (wing) => !!wing && wing.combat_readiness > before);
  const after = room.state.air_wings.get("wing-1").combat_readiness;
  assert.ok(after > before, "readiness must recover during REFUEL too");
});

it("force RTB from LOITER when readiness hits RTB threshold (0.25)", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  // Set readiness just above the RTB threshold (0.25). With decay=0.1, one tick gives
  // 0.30 - 0.1 = 0.20 ≤ 0.25 → force-RTB fires on the first tick.
  client.send("SET_WING_READINESS", { wing_id: "wing-1", combat_readiness: 0.30 });
  client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.LOITER });
  await room.waitForNextPatch();
  await room.waitForNextPatch();

  await waitForWingState(room, "wing-1", WING_LIFECYCLE.RTB);
});
```

---

#### Test Group 5: Weapon cooldown

```typescript
it("weapon_ready starts true; firing sets it false on first ENGAGED tick", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  assert.strictEqual(room.state.air_wings.get("wing-1").weapon_ready, true);

  // SET_WING_LIFECYCLE changes lifecycle_state immediately, but weapon_ready flips only
  // when the first ENGAGED tick runs. Do not count raw patches here — handler and tick
  // patches can coalesce depending on timing. Wait on the actual predicate instead.
  client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.ENGAGED });
  await room.waitForNextPatch(); // handler patch: lifecycle_state = ENGAGED
  await waitForWingPredicate(room, "wing-1", (wing) => !!wing && wing.weapon_ready === false);
  const wing = room.state.air_wings.get("wing-1");
  assert.strictEqual(wing.weapon_ready, false, "weapon_ready must be false after first ENGAGED tick");
});

it("weapon_ready returns to true after WEAPON_COOLDOWN_TICKS ticks", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  // Wait on predicates rather than fixed patch counts: handler and tick patches are not
  // guaranteed to arrive as three distinct boundaries.
  client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.ENGAGED });
  await room.waitForNextPatch(); // handler patch: lifecycle_state = ENGAGED
  await waitForWingPredicate(room, "wing-1", (wing) => !!wing && wing.weapon_ready === false);
  assert.strictEqual(room.state.air_wings.get("wing-1").weapon_ready, false, "sanity check");
  // Second ENGAGED tick resolves the engagement and also finishes the cooldown because
  // WEAPON_COOLDOWN_TICKS=1 in tests. Wait until both facts are true.
  await waitForWingPredicate(room, "wing-1", (wing) =>
    !!wing && wing.weapon_ready === true && wing.lifecycle_state === WING_LIFECYCLE.RTB
  );
  assert.strictEqual(room.state.air_wings.get("wing-1").weapon_ready, true);
  assert.strictEqual(room.state.air_wings.get("wing-1").lifecycle_state, WING_LIFECYCLE.RTB);
});
```

---

#### Test Group 6: DISBAND_WING

```typescript
it("DISBAND_WING removes wing from air_wings and broadcasts WING_DESTROYED", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);

  const destroyedPromise = new Promise<any>((resolve) => {
    client.onMessage("WING_DESTROYED", resolve);
  });

  client.send("DISBAND_WING", { wing_id: "wing-1" });
  const msg = await destroyedPromise;
  // WING_DESTROYED is a room message; the client-side air_wings removal arrives via
  // the next schema patch. Wait for removal explicitly before asserting on room.state.
  await waitForWingRemoval(room, "wing-1");

  assert.strictEqual(msg.wing_id, "wing-1");
  assert.ok(!room.state.air_wings.has("wing-1"), "wing must be removed from state");
});

it("DISBAND_WING on unknown wing_id is a no-op (no crash)", async () => {
  const { client, room } = await joinRoom();
  client.send("DISBAND_WING", { wing_id: "nonexistent" });
  // No schema change is emitted — use timeout, not waitForNextPatch (would hang).
  await new Promise(r => setTimeout(r, 200));
  assert.ok(room.state); // no crash
});
```

---

#### Test Group 7: SET_WING_PERK

```typescript
it("SET_WING_PERK sets perk_multi_sortie to true", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  assert.strictEqual(room.state.air_wings.get("wing-1").perk_multi_sortie, false);

  client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "multi_sortie", value: true });
  await room.waitForNextPatch();
  assert.strictEqual(room.state.air_wings.get("wing-1").perk_multi_sortie, true);
});

it("SET_WING_PERK for unknown perk name is a no-op (no crash)", async () => {
  const { client, room } = await joinRoom();
  await spawnWing(client, room);
  client.send("SET_WING_PERK", { wing_id: "wing-1", perk: "nonexistent_perk", value: true });
  // Handler silently ignores unknown perk names — no schema field changes, no patch emitted.
  // Use timeout, not waitForNextPatch (would hang or observe an unrelated tick patch).
  await new Promise(r => setTimeout(r, 200));
  assert.ok(room.state.air_wings.get("wing-1")); // wing still exists, no crash
});
```

---

#### Test Group 8: AIR_WING_UPDATES broadcast

```typescript
it("lifecycle tick broadcasts AIR_WING_UPDATES with accurate wing state after lifecycle change", async () => {
  // NOTE: AIR_WING_UPDATES is broadcast every tick for any wing where didChange=true
  // (readiness decay, cooldown flip, state change — any of these). This test confirms
  // (1) a broadcast arrives after switching to TRANSIT, and (2) the serialized wing
  // in the broadcast accurately reflects the current lifecycle_state. It does NOT
  // specifically prove the state-change *caused* the broadcast (readiness decay on the
  // now-airborne TRANSIT wing is sufficient cause in the same tick).
  const { client, room } = await joinRoom();
  await spawnWing(client, room);

  // Register listener BEFORE triggering the change so we don't miss a fast broadcast.
  const updateReceived = new Promise<any>((resolve) => {
    client.onMessage("AIR_WING_UPDATES", resolve);
  });

  client.send("SET_WING_LIFECYCLE", { wing_id: "wing-1", lifecycle_state: WING_LIFECYCLE.TRANSIT });
  await room.waitForNextPatch(); // handler: schema lifecycle_state = TRANSIT

  const msg = await updateReceived; // tick fires ≤1000ms later, includes wing-1
  assert.ok(Array.isArray(msg.wings), "AIR_WING_UPDATES.wings must be an array");
  const w = msg.wings.find((w: any) => w.wing_id === "wing-1");
  assert.ok(w, "AIR_WING_UPDATES must include wing-1");
  // Verify serializeWing() faithfully reflects the updated state, including the
  // path/perk fields that Branch A added to the schema and this branch now shares.
  assert.strictEqual(w.lifecycle_state, WING_LIFECYCLE.TRANSIT,
    "broadcast must serialize the current lifecycle_state accurately");
  assert.strictEqual(w.path_gen_id, "");
  assert.strictEqual(w.path_elapsed_ms, 0);
  assert.strictEqual(w.weapon_ready, true);
  assert.strictEqual(w.perk_multi_sortie, false);
  assert.strictEqual(w.perk_strafing, false);
  assert.strictEqual(w.perk_extended_range, false);
  assert.strictEqual(w.perk_precision_bombing, false);
});
```

---

### STEP 3 — Implement `air_wing_lifecycle_system.ts`

**File:** `game-server/src/systems/air_wing_lifecycle_system.ts`

Create this file. Read the full contract below carefully before writing any code.

Start the file with these imports:

```typescript
import type { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, serializeWing } from "../rooms/schema/AirWingState.js";
```

#### 3a — Constants (configurable for testing)

```typescript
// Module-level mutable constants — mutated ONLY by the exported test helpers below.
let READINESS_DECAY_PER_TICK  = 0.04;   // per tick while airborne
let READINESS_RECOVERY_RATE   = 0.06;   // per tick while IDLE or REFUEL
let READINESS_RTB_THRESHOLD   = 0.25;   // force RTB at or below this
const READINESS_FLOOR         = 0.15;   // hard floor — combat_readiness never goes below this

let WEAPON_COOLDOWN_TICKS          = 3;
let ENGAGEMENT_AUTO_RESOLVE_TICKS  = 2;   // ticks before auto-resolving ENGAGED (stub for Branch E)
let MAX_LOITER_TICKS               = 15;  // ticks before LOITER → RTB if no target
let RTB_DURATION_TICKS             = 5;   // ticks in RTB → REFUEL
let REFUEL_DURATION_TICKS          = 5;   // ticks in REFUEL → IDLE

// Exported testing helpers — export these as named functions, NOT as properties.
export function setWeaponCooldownTicksForTesting(n: number): void { WEAPON_COOLDOWN_TICKS = n; }
export function setEngagementAutoResolveTicksForTesting(n: number): void { ENGAGEMENT_AUTO_RESOLVE_TICKS = n; }
export function setMaxLoiterTicksForTesting(n: number): void { MAX_LOITER_TICKS = n; }
export function setRtbDurationTicksForTesting(n: number): void { RTB_DURATION_TICKS = n; }
export function setRefuelDurationTicksForTesting(n: number): void { REFUEL_DURATION_TICKS = n; }
export function setReadinessDecayForTesting(rate: number): void { READINESS_DECAY_PER_TICK = rate; }
export function setReadinessRecoveryForTesting(rate: number): void { READINESS_RECOVERY_RATE = rate; }
```

#### 3b — Class structure

```typescript
type BroadcastFn = (type: string, msg: unknown) => void;

export class AirWingLifecycleSystem {
  // Internal tick counters — NOT in schema, pure server memory:
  private _engagementTicks:  Map<string, number> = new Map(); // wing_id → ticks spent in ENGAGED
  private _loiterTicks:      Map<string, number> = new Map(); // wing_id → ticks spent in LOITER
  private _rtbTicks:         Map<string, number> = new Map(); // wing_id → ticks spent in RTB
  private _refuelTicks:      Map<string, number> = new Map(); // wing_id → ticks spent in REFUEL
  private _weaponCooldown:   Map<string, number> = new Map(); // wing_id → cooldown ticks remaining
  private _lastEngagedTarget:Map<string, string> = new Map(); // wing_id → last engaged target_id

  tick(state: GameRoomState, _tickCount: number, broadcast: BroadcastFn): void { ... }

  // Called by ASSIGN_WING_MISSION handler (and optionally by Branch C for detection)
  assignMission(wingId: string, mission: string, targetId: string, state: GameRoomState): boolean { ... }

  // Called by Branch C when swept contact is detected (stub call target for future branch)
  triggerContact(wingId: string, targetWingId: string, state: GameRoomState): void { ... }

  // Called by Branch E when combat round resolves; also called by auto-resolve in tick()
  resolveEngagement(wingId: string, state: GameRoomState, broadcast: BroadcastFn): void { ... }

  // Called by DISBAND_WING handler
  disbandWing(wingId: string, state: GameRoomState, broadcast: BroadcastFn): void { ... }

  // Called by SET_WING_PERK handler
  setPerk(wingId: string, perk: string, value: boolean, state: GameRoomState): boolean { ... }
}
```

#### 3c — `tick()` implementation logic

```typescript
tick(state: GameRoomState, _tickCount: number, broadcast: BroadcastFn): void {
  const changed: string[] = [];

  for (const [wingId, wing] of state.air_wings.entries()) {
    let didChange = false;

    // 1. Readiness: decay while airborne, recover while IDLE/REFUEL
    const isAirborne = wing.lifecycle_state !== WING_LIFECYCLE.IDLE
                    && wing.lifecycle_state !== WING_LIFECYCLE.REFUEL;
    if (isAirborne) {
      const prev = wing.combat_readiness;
      wing.combat_readiness = Math.max(READINESS_FLOOR,
        wing.combat_readiness - READINESS_DECAY_PER_TICK);
      if (wing.combat_readiness !== prev) didChange = true;
    } else {
      const prev = wing.combat_readiness;
      wing.combat_readiness = Math.min(1.0,
        wing.combat_readiness + READINESS_RECOVERY_RATE);
      if (wing.combat_readiness !== prev) didChange = true;
    }

    // 2. Weapon cooldown
    const cooldown = this._weaponCooldown.get(wingId) ?? 0;
    if (cooldown > 0) {
      const newCooldown = cooldown - 1;
      this._weaponCooldown.set(wingId, newCooldown);
      if (newCooldown === 0 && !wing.weapon_ready) {
        wing.weapon_ready = true;
        didChange = true;
      }
    }

    // 3. Force RTB if readiness at or below threshold (overrides any airborne state)
    if (isAirborne && wing.combat_readiness <= READINESS_RTB_THRESHOLD
        && wing.lifecycle_state !== WING_LIFECYCLE.RTB) {
      wing.lifecycle_state = WING_LIFECYCLE.RTB;
      this._rtbTicks.set(wingId, 0);
      this._engagementTicks.delete(wingId);
      this._loiterTicks.delete(wingId);
      broadcast("WING_RTB", { wing_id: wingId, nation_id: wing.nation_id, reason: "low_readiness" });
      didChange = true;
    }

    // 4. State-machine tick transitions
    switch (wing.lifecycle_state) {
      case WING_LIFECYCLE.ENGAGED: {
        // Start weapon cooldown on first tick in ENGAGED
        if (!this._engagementTicks.has(wingId)) {
          this._engagementTicks.set(wingId, 0);
          wing.weapon_ready = false;
          this._weaponCooldown.set(wingId, WEAPON_COOLDOWN_TICKS);
          didChange = true;
        }
        const ticks = (this._engagementTicks.get(wingId) ?? 0) + 1;
        this._engagementTicks.set(wingId, ticks);
        if (ticks >= ENGAGEMENT_AUTO_RESOLVE_TICKS) {
          this.resolveEngagement(wingId, state, broadcast);
          didChange = true;
        }
        break;
      }
      case WING_LIFECYCLE.LOITER: {
        // Check if a new target has been queued (set by Branch D/E via SET_WING_TARGET)
        if (wing.target_id !== "") {
          wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
          this._loiterTicks.delete(wingId);
          didChange = true;
          break;
        }
        const ticks = (this._loiterTicks.get(wingId) ?? 0) + 1;
        this._loiterTicks.set(wingId, ticks);
        if (ticks >= MAX_LOITER_TICKS) {
          wing.lifecycle_state = WING_LIFECYCLE.RTB;
          this._loiterTicks.delete(wingId);
          this._rtbTicks.set(wingId, 0);
          broadcast("WING_RTB", { wing_id: wingId, nation_id: wing.nation_id, reason: "mission_complete" });
          didChange = true;
        }
        break;
      }
      case WING_LIFECYCLE.RTB: {
        const ticks = (this._rtbTicks.get(wingId) ?? 0) + 1;
        this._rtbTicks.set(wingId, ticks);
        if (ticks >= RTB_DURATION_TICKS) {
          wing.lifecycle_state = WING_LIFECYCLE.REFUEL;
          this._rtbTicks.delete(wingId);
          this._refuelTicks.set(wingId, 0);
          didChange = true;
        }
        break;
      }
      case WING_LIFECYCLE.REFUEL: {
        const ticks = (this._refuelTicks.get(wingId) ?? 0) + 1;
        this._refuelTicks.set(wingId, ticks);
        if (ticks >= REFUEL_DURATION_TICKS) {
          wing.lifecycle_state = WING_LIFECYCLE.IDLE;
          this._refuelTicks.delete(wingId);
          didChange = true;
        }
        break;
      }
    }

    if (didChange) changed.push(wingId);
  }

  if (changed.length > 0) {
    broadcast("AIR_WING_UPDATES", {
      wings: changed.map(id => serializeWing(state.air_wings.get(id)!))
    });
  }
}
```

#### 3d — `resolveEngagement()` implementation

This is the post-engagement transition decision:

```typescript
resolveEngagement(wingId: string, state: GameRoomState, broadcast: BroadcastFn): void {
  const wing = state.air_wings.get(wingId);
  if (!wing) return;

  this._engagementTicks.delete(wingId); // clear engagement timer regardless

  if (!wing.perk_multi_sortie) {
    // Single sortie: always RTB
    wing.lifecycle_state = WING_LIFECYCLE.RTB;
    this._rtbTicks.set(wingId, 0);
    broadcast("WING_RTB", { wing_id: wingId, nation_id: wing.nation_id, reason: "mission_complete" });
    return;
  }

  // Multi-sortie: check for a new target
  const lastTarget = this._lastEngagedTarget.get(wingId) ?? "";
  const hasNewTarget = wing.target_id !== "" && wing.target_id !== lastTarget;

  if (hasNewTarget) {
    // New target queued — go directly to TRANSIT
    wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
    // Do NOT clear target_id — it holds the new target
  } else {
    // No new target (or same target — recency penalty applies when Branch E re-evaluates)
    wing.lifecycle_state = WING_LIFECYCLE.LOITER;
    wing.target_id = "";   // clear stale target; Branch D/E will set a new one when available
    this._loiterTicks.set(wingId, 0);
  }
}
```

**IMPORTANT:** `_lastEngagedTarget` is set ONLY by `triggerContact()` (and therefore only
via `SIMULATE_ENGAGEMENT_START` in tests). The `SET_WING_LIFECYCLE` test handler does NOT
set it — it bypasses `triggerContact()` entirely and leaves `_lastEngagedTarget` absent for
that wing. This is intentional: `SET_WING_LIFECYCLE` is used for non-multi-sortie tests
(single-sortie, readiness, weapon cooldown, RTB chain) where the "same vs new target"
decision is irrelevant. Multi-sortie tests MUST use `SIMULATE_ENGAGEMENT_START` to seed
`_lastEngagedTarget` correctly before the engagement resolves.

#### 3e — `assignMission()` implementation

```typescript
assignMission(wingId: string, mission: string, targetId: string, state: GameRoomState): boolean {
  const wing = state.air_wings.get(wingId);
  if (!wing) return false;
  // Cannot reassign while ENGAGED (combat is in progress)
  if (wing.lifecycle_state === WING_LIFECYCLE.ENGAGED) return false;

  wing.mission    = mission;
  wing.target_id  = targetId;
  // IDLE and LOITER → TRANSIT. TRANSIT: just update target, stay in TRANSIT.
  if (wing.lifecycle_state === WING_LIFECYCLE.IDLE
   || wing.lifecycle_state === WING_LIFECYCLE.LOITER) {
    wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
    this._loiterTicks.delete(wingId);
  }
  return true;
}
```

#### 3f — `triggerContact()` stub (for Branch C)

```typescript
triggerContact(wingId: string, targetWingId: string, state: GameRoomState): void {
  const wing = state.air_wings.get(wingId);
  if (!wing || wing.lifecycle_state !== WING_LIFECYCLE.TRANSIT) return;
  this._lastEngagedTarget.set(wingId, targetWingId);
  wing.lifecycle_state = WING_LIFECYCLE.ENGAGED;
  // DO NOT seed _engagementTicks here. The first ENGAGED tick uses
  //   if (!this._engagementTicks.has(wingId)) { ... weapon_ready=false; cooldown start }
  // to detect first contact. Pre-seeding would skip weapon_ready=false initialization.
}
```

#### 3g — `disbandWing()` implementation

```typescript
disbandWing(wingId: string, state: GameRoomState, broadcast: BroadcastFn): void {
  const wing = state.air_wings.get(wingId);
  if (!wing) return;

  const nationId = wing.nation_id;
  state.air_wings.delete(wingId);

  // Clean up all internal state for this wing
  this._engagementTicks.delete(wingId);
  this._loiterTicks.delete(wingId);
  this._rtbTicks.delete(wingId);
  this._refuelTicks.delete(wingId);
  this._weaponCooldown.delete(wingId);
  this._lastEngagedTarget.delete(wingId);

  broadcast("WING_DESTROYED", {
    wing_id: wingId,
    nation_id: nationId,
    destroyed_by_wing_id: "",  // empty = disbanded by player (not combat kill)
  });
}
```

#### 3h — `setPerk()` implementation

```typescript
setPerk(wingId: string, perk: string, value: boolean, state: GameRoomState): boolean {
  const wing = state.air_wings.get(wingId);
  if (!wing) return false;
  switch (perk) {
    case "multi_sortie":      wing.perk_multi_sortie      = value; return true;
    case "strafing":          wing.perk_strafing          = value; return true;
    case "extended_range":    wing.perk_extended_range    = value; return true;
    case "precision_bombing": wing.perk_precision_bombing = value; return true;
    default: return false; // Unknown perk names: silently ignored (no crash)
  }
}
```

---

### STEP 4 — Wire `AirWingLifecycleSystem` into `GameRoom.ts`

**File:** `game-server/src/rooms/GameRoom.ts`

#### 4a — Import

```typescript
import { AirWingLifecycleSystem } from "../systems/air_wing_lifecycle_system.js";
```

#### 4b — Field initializer (alongside other systems)

```typescript
private airWingLifecycleSystem = new AirWingLifecycleSystem();
```

#### 4c — `gameTick()` call

Add this line to `gameTick()`, **after** `this.frontlineSystem.tick(...)`:

```typescript
this.airWingLifecycleSystem.tick(this.state, this.tickCount,
  (type, msg) => this.broadcast(type, msg));
```

Do NOT add it before the existing systems — air lifecycle should run after land systems.

#### 4d — Production message handlers (in `onCreate()`, top-level)

Add these three handlers to the main handler block (not inside DEV_MODE or NODE_ENV gates):

```typescript
this.onMessage("ASSIGN_WING_MISSION", (client, msg: {
  wing_id: string;
  mission: string;
  target_id: string;
}) => {
  if (this.state.phase !== "running") return;
  // Ownership check
  const player = this.state.players.get(client.sessionId);
  if (!player) return;
  const nation = this.getNationForPlayer(player.userId);
  if (!nation) return;
  const wing = this.state.air_wings.get(msg.wing_id);
  if (!wing || wing.nation_id !== nation.nation_id) return;

  const didChange = this.airWingLifecycleSystem.assignMission(
    msg.wing_id,
    msg.mission,
    msg.target_id,
    this.state
  );
  if (!didChange) return;
  // Broadcast updated wing state only when something actually changed.
  const updated = this.state.air_wings.get(msg.wing_id);
  if (updated) this.broadcast("AIR_WING_UPDATES", { wings: [serializeWing(updated)] });
});

this.onMessage("DISBAND_WING", (client, msg: { wing_id: string }) => {
  if (this.state.phase !== "running") return;
  const player = this.state.players.get(client.sessionId);
  if (!player) return;
  const nation = this.getNationForPlayer(player.userId);
  if (!nation) return;
  const wing = this.state.air_wings.get(msg.wing_id);
  if (!wing || wing.nation_id !== nation.nation_id) return;

  this.airWingLifecycleSystem.disbandWing(msg.wing_id, this.state,
    (type, m) => this.broadcast(type, m));
});

this.onMessage("SET_WING_PERK", (client, msg: {
  wing_id: string;
  perk: string;
  value: boolean;
}) => {
  if (this.state.phase !== "running") return;
  const player = this.state.players.get(client.sessionId);
  if (!player) return;
  const nation = this.getNationForPlayer(player.userId);
  if (!nation) return;
  const wing = this.state.air_wings.get(msg.wing_id);
  if (!wing || wing.nation_id !== nation.nation_id) return;

  const didChange = this.airWingLifecycleSystem.setPerk(msg.wing_id, msg.perk, msg.value, this.state);
  if (!didChange) return;
  const updated = this.state.air_wings.get(msg.wing_id);
  if (updated) this.broadcast("AIR_WING_UPDATES", { wings: [serializeWing(updated)] });
});
```

#### 4e — Test-only handlers (inside the `if (process.env.NODE_ENV === "test")` block)

Add these AFTER the existing test-only handlers. Do NOT replace `SPAWN_WING`.

```typescript
this.onMessage("SET_WING_LIFECYCLE", (_client, msg: {
  wing_id: string;
  lifecycle_state: string;
}) => {
  const wing = this.state.air_wings.get(msg.wing_id);
  if (!wing) return;
  wing.lifecycle_state = msg.lifecycle_state;
});

this.onMessage("SET_WING_READINESS", (_client, msg: {
  wing_id: string;
  combat_readiness: number;
}) => {
  const wing = this.state.air_wings.get(msg.wing_id);
  if (!wing) return;
  wing.combat_readiness = Math.max(0, Math.min(1, msg.combat_readiness));
});

this.onMessage("SET_WING_TARGET", (_client, msg: {
  wing_id: string;
  target_id: string;
}) => {
  const wing = this.state.air_wings.get(msg.wing_id);
  if (!wing) return;
  wing.target_id = msg.target_id;
});

// Seeds _lastEngagedTarget (private internal map) by calling the real triggerContact()
// method on the lifecycle system. This is REQUIRED for multi-sortie tests that check the
// "new target vs same target" decision: SET_WING_LIFECYCLE bypasses triggerContact() so
// _lastEngagedTarget stays empty, making every non-empty target_id appear "new" → TRANSIT.
// With SIMULATE_ENGAGEMENT_START, the internal map is correctly seeded.
//
// CRITICAL: triggerContact() guards on TRANSIT (returns early if the wing is not TRANSIT).
// Since tests spawn wings as IDLE by default, this handler must force the wing to TRANSIT
// first, then call triggerContact(). This mirrors the real production path (wing flies to
// target in TRANSIT, detection fires, contact is triggered).
this.onMessage("SIMULATE_ENGAGEMENT_START", (_client, msg: {
  wing_id: string;
  target_wing_id: string;
}) => {
  const wing = this.state.air_wings.get(msg.wing_id);
  if (!wing) return;
  // Force TRANSIT so triggerContact()'s guard is satisfied, then let it do
  // the rest: _lastEngagedTarget[wing_id] = target_wing_id, lifecycle → ENGAGED.
  wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
  this.airWingLifecycleSystem.triggerContact(msg.wing_id, msg.target_wing_id, this.state);
});
```

---

### STEP 5 — Run the 12a tests to confirm no regressions

```bash
cd game-server
NODE_ENV=test npx mocha -r tsx test/12a-air-wing-schema.test.ts --exit --timeout 15000
```

Expected: all 12 existing tests still pass. If any fail, you broke something in Step 1
(the `serializeWing` extraction). Fix before proceeding.

---

### STEP 6 — Run the 12b tests

```bash
cd game-server
NODE_ENV=test npx mocha -r tsx test/12b-air-wing-lifecycle.test.ts --exit --timeout 180000
```

Expected: all lifecycle tests pass. The timeout is 180s — with test tick rates set in
`before()`, most tests complete in under 10 seconds total. If a `waitForWingState` call
times out (10s), the state machine transition is not firing. Debug by adding a
`console.log` inside `gameTick()` to confirm the lifecycle system is being called.

---

### STEP 7 — Run ALL existing tests to confirm no regressions

```bash
cd game-server
NODE_ENV=test npx mocha -r tsx test/GameRoom.test.ts test/movement-jerk.test.ts --exit --timeout 15000 && \
NODE_ENV=test npx mocha -r tsx test/6a-grid-schema.test.ts --exit --timeout 15000 && \
NODE_ENV=test npx mocha -r tsx test/6b-perk-extensibility.test.ts --exit --timeout 15000 && \
NODE_ENV=test npx mocha -r tsx test/6b-round-system.test.ts --exit --timeout 180000 && \
NODE_ENV=test npx mocha -r tsx test/6-phase-gate.test.ts --exit --timeout 180000 --grep 'Phase 6 gate'
```

All must pass before the branch is considered done.

---

## Common Mistakes to Avoid

1. **DO NOT** put `ASSIGN_WING_MISSION`, `DISBAND_WING`, or `SET_WING_PERK` inside the
   `NODE_ENV === "test"` block. They are production handlers. Only `SET_WING_LIFECYCLE`,
   `SET_WING_READINESS`, `SET_WING_TARGET`, and `SIMULATE_ENGAGEMENT_START` are test-only.

2. **DO NOT** call `state.air_wings.forEach(...)`. Use `state.air_wings.entries()` for
   iteration — `forEach` on a Colyseus MapSchema may not behave as expected with
   TypeScript destructuring.

3. **DO NOT** store the broadcast function permanently on the class instance. It is passed
   as a parameter to `tick()` on every call. Do not assign it to `this._broadcast`.

4. **DO NOT** create a `new AirWingLifecycleSystem()` inside the `NODE_ENV === "test"`
   block. The single instance declared as a GameRoom field is shared between test handlers
   and the `tick()` call. This is intentional — otherwise test handlers and tick would
   operate on different internal state maps.

5. **`_lastEngagedTarget` must be set BEFORE the wing enters ENGAGED** so that when
   `resolveEngagement()` runs, it can compare the current `wing.target_id` against it.
   The test handler `SET_WING_LIFECYCLE` bypasses `triggerContact()`, so
   `_lastEngagedTarget` will be empty for test-triggered engagements. That is fine — an
   empty `_lastEngagedTarget` means any non-empty `target_id` will be treated as "new".

6. **DO NOT** call `this.broadcast(...)` directly from `AirWingLifecycleSystem`. The
   system only calls the `broadcast: BroadcastFn` callback that is passed in. This keeps
   the system decoupled from the room and testable in isolation.

7. **`WING_DESTROYED` event** from `disbandWing()` is player-initiated. Combat kills
   (from Branch E) will also emit `WING_DESTROYED` with a non-empty `destroyed_by_wing_id`.
   Keep the field in the broadcast payload so Branch E can reuse the same event shape.

8. **Do NOT run tests with `DEV_MODE=true`**. `SPAWN_WING` is registered in both the
   `DEV_MODE` gate (line ~151) and the `NODE_ENV=test` gate (line ~231). If both env
   vars are set simultaneously, Colyseus will register the handler twice and may emit a
   duplicate-handler warning or behave unexpectedly. Always run the test suite with only
   `NODE_ENV=test` set, not `DEV_MODE=true`.

9. **The `waitForWingState` helper** calls `room.waitForNextPatch()` in a loop. This works
   because the Colyseus test server's `waitForNextPatch()` resolves on the *next* state
   patch, not on a fixed timer. When the server ticks and mutates a schema field, Colyseus
   automatically emits a state patch. If you see `waitForWingState` hanging, check that
   the lifecycle system is actually being called in `gameTick()` and that it is actually
   mutating a schema field (not just an internal Map).
