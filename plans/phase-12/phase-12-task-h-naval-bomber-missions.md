# Branch H — `feat/naval-bomber-missions`

## Context

Branches A, K-stubs, B, B-patch, C, D, E, E-patch, F, G, and E2 are all merged. This
branch adds naval bomber mission infrastructure for Phase 12. Because Phase 13 (Naval
Combat) has not been built, most naval missions are stubs — the real value delivered here
is: (1) the `NavalContactMarkerState` schema and expiry system, (2) the port strike
handler (fully functional against `naval_base_level`), and (3) well-typed interfaces so
Phase 13 wires real data without touching air code.

**Test-Driven Development is mandatory.** Write ALL failing tests before each step.

---

## Critical Pre-Read

### ProvinceState — lives inside GameRoomState.ts, not its own file

`ProvinceState` is defined in `game-server/src/rooms/schema/GameRoomState.ts` at lines
34–41. There is **no separate ProvinceState.ts**. Add `naval_base_level` there directly.

### NavalContactMarkerState — does not exist yet

Grep confirms zero existing files for this schema. Create
`game-server/src/rooms/schema/NavalContactMarkerState.ts` from scratch, following the
`AirWingState.ts` decorator pattern exactly.

### Dev handler gate vs. test handler gate

Two separate env gates in `GameRoom.ts`:
- `process.env.DEV_MODE === "true"` (lines 416–445) — for human dev/debug use
- `process.env.NODE_ENV === "test"` (lines 446+) — for automated test fixtures

`CREATE_NAVAL_CONTACT` must be registered in **both** blocks so humans can seed markers
in dev and tests can seed them in the test harness.

### AirStrategicBombingSystem is the pattern to follow for port strike

File: `game-server/src/systems/air_strategic_bombing_system.ts`
- Filters wings: `lifecycle_state === WING_LIFECYCLE.LOITER` AND mission in set
- Calls `aaSystem.computeAaDamage()` then applies damage
- Calls `lifecycleSystem.resolveWingBombed()` after damage applied
- Broadcasts per-nation via `broadcastToNation` callback

Port strike follows this same pattern **except** it does NOT call `computeAaDamage()` —
no AA fires on ships in port. This is a deliberate design decision, not an oversight.

### naval_bomber is already in LOW_ALTITUDE_TYPES in ProvinceAaSystem

`air_province_aa_system.ts` already includes `"naval_bomber"` in `LOW_ALTITUDE_TYPES`.
Do not add it again. Port strike bypasses AA entirely — do not call `computeAaDamage()`.

### MISSION_TYPES — PORT_STRIKE is not defined yet

Check `AirWingState.ts` MISSION_TYPES const. `PORT_STRIKE` is absent; add it. The
existing naval missions `TRADE_INTERDICTION`, `ANTI_SUBMARINE`, `ANTI_SHIP` are already
defined — do NOT re-declare them.

### _resolveTargetPosition — needs extending for marker targets

The `ASSIGN_WING_MISSION` handler in `GameRoom.ts` calls `_resolveTargetPosition(target_id)`
to compute the wing's transit destination. Currently it resolves wing IDs and province IDs.
For ANTI_SHIP and ANTI_SUBMARINE missions, `target_id` will be a `marker_id`. Extend
`_resolveTargetPosition` to also check `state.naval_contact_markers`.

### GameRoomState tick insertion point

The new `AirNavalBomberSystem.tick()` belongs in `gameTick()` in `GameRoom.ts`,
**after** `airStrategicBombingSystem.tick()` and **before** `airDetectionSystem.tick()`.
Do not insert it elsewhere.

### IFlotillaProvider — interface only, no real implementation in this branch

Define the interface and `StubFlotillaProvider` (returns `[]`). Phase 13 injects a real
implementation. The splash math runs now; it distributes 15% across an empty list, which
is a no-op but confirms the math path is correct.

### Quality tier constants — use strings, not a TypeScript enum

Using a `const` object (like `MISSION_TYPES` and `WING_LIFECYCLE`) is consistent with
the rest of the codebase. Do NOT use a TypeScript `enum`.

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/src/rooms/schema/NavalContactMarkerState.ts` | Colyseus schema for naval contact markers |
| `game-server/src/systems/air_naval_bomber_system.ts` | Marker expiry tick, port strike, mission stubs |
| `game-server/src/data/naval_contact_quality.ts` | Quality tier constants and derived radius/duration |
| `game-server/test/12h-naval-bomber.test.ts` | All Branch H server tests |
| `client/src/systems/air/naval_contact_marker_system.gd` | Client-side marker circle renderer |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/schema/GameRoomState.ts` | Add `naval_base_level` to ProvinceState; add `naval_contact_markers` MapSchema |
| `game-server/src/rooms/schema/AirWingState.ts` | Add `PORT_STRIKE` to MISSION_TYPES |
| `game-server/src/rooms/GameRoom.ts` | Instantiate AirNavalBomberSystem; add CREATE_NAVAL_CONTACT handler in both env blocks; extend _resolveTargetPosition for markers; add tick call |
| `game-server/src/data/air_bombing_stats.ts` | Add `port_strike_naval_base_damage` constant |
| `game-server/package.json` | Append 12h to test chain |
| `client/src/core/event_bus.gd` | Add `naval_contact_marker_expired` signal |
| `client/src/networking/session_manager.gd` | Route `CONTACT_MARKER_EXPIRED` to EventBus |

---

## Step 0: Schema and Constants (No Tests — Schema changes only)

### 0a. Create `NavalContactMarkerState.ts`

```typescript
import { Schema, type } from "@colyseus/schema";

export class NavalContactMarkerState extends Schema {
  @type("string") marker_id:      string  = "";
  @type("string") nation_id:      string  = "";
  @type("string") quality:        string  = "";   // MARITIME_PATROL | CARGO_SINKING | FLOTILLA_SCOUT
  @type("number") position_lng:   number  = 0;
  @type("number") position_lat:   number  = 0;
  @type("number") radius_deg:     number  = 0;
  @type("number") expires_at_ms:  number  = 0;
  @type("boolean") is_refreshable: boolean = false;
}
```

### 0b. Create `naval_contact_quality.ts`

```typescript
export const NAVAL_CONTACT_QUALITY = {
  MARITIME_PATROL: "maritime_patrol",
  CARGO_SINKING:   "cargo_sinking",
  FLOTILLA_SCOUT:  "flotilla_scout",
} as const;

export type NavalContactQuality =
  typeof NAVAL_CONTACT_QUALITY[keyof typeof NAVAL_CONTACT_QUALITY];

export const QUALITY_DEFAULTS: Record<string, {
  radius_deg: number;
  duration_ms: number;
  is_refreshable: boolean;
}> = {
  maritime_patrol: { radius_deg: 0.15, duration_ms: 60_000, is_refreshable: true  },
  cargo_sinking:   { radius_deg: 0.8,  duration_ms: 20_000, is_refreshable: false },
  flotilla_scout:  { radius_deg: 0.4,  duration_ms: 40_000, is_refreshable: false },
};
```

### 0c. Add to `GameRoomState.ts`

Inside `ProvinceState` class, after `oil_bombed_until_ms` (line ~40):
```typescript
@type("number") naval_base_level: number = 0;
```

Add to `GameRoomState` class, after the `air_wings` MapSchema line (~101):
```typescript
@type({ map: NavalContactMarkerState })
naval_contact_markers = new MapSchema<NavalContactMarkerState>();
```

Add import at top of file:
```typescript
import { NavalContactMarkerState } from "./NavalContactMarkerState.js";
```

### 0d. Add PORT_STRIKE to MISSION_TYPES in `AirWingState.ts`

Find the `MISSION_TYPES` const and add:
```typescript
PORT_STRIKE: "port_strike",
```

Do NOT add any other mission types — TRADE_INTERDICTION, ANTI_SUBMARINE, ANTI_SHIP
already exist.

---

## Step 1: CREATE_NAVAL_CONTACT Handler (TDD)

### 1a. Write failing tests in `12h-naval-bomber.test.ts`

```typescript
import assert from "assert";
import { describe, it, before, after } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { NAVAL_CONTACT_QUALITY, QUALITY_DEFAULTS } from "../src/data/naval_contact_quality.js";

// --- setup boilerplate same as 12g-strategic-bombing.test.ts ---
// makeToken(), joinRoom(), tick() — copy exactly from that file

describe("CREATE_NAVAL_CONTACT handler", () => {
  it("creates a marker with correct quality tier defaults — maritime_patrol", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "m1",
      nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.MARITIME_PATROL,
      position_lng: 10.0,
      position_lat: 52.0,
    });
    await room.waitForNextPatch();
    const marker = (room.state as GameRoomState).naval_contact_markers.get("m1");
    assert.ok(marker, "marker should exist");
    assert.strictEqual(marker.quality, "maritime_patrol");
    assert.strictEqual(marker.radius_deg, QUALITY_DEFAULTS.maritime_patrol.radius_deg);
    assert.strictEqual(marker.is_refreshable, true);
    assert.ok(marker.expires_at_ms > Date.now(), "expiry in future");
  });

  it("creates a cargo_sinking marker with wide radius", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "m2",
      nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.CARGO_SINKING,
      position_lng: 5.0,
      position_lat: 50.0,
    });
    await room.waitForNextPatch();
    const marker = (room.state as GameRoomState).naval_contact_markers.get("m2");
    assert.ok(marker);
    assert.strictEqual(marker.radius_deg, QUALITY_DEFAULTS.cargo_sinking.radius_deg);
    assert.strictEqual(marker.is_refreshable, false);
  });

  it("creates a flotilla_scout marker", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "m3",
      nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.FLOTILLA_SCOUT,
      position_lng: 8.0,
      position_lat: 54.0,
    });
    await room.waitForNextPatch();
    const marker = (room.state as GameRoomState).naval_contact_markers.get("m3");
    assert.ok(marker);
    assert.strictEqual(marker.radius_deg, QUALITY_DEFAULTS.flotilla_scout.radius_deg);
    assert.strictEqual(marker.is_refreshable, false);
  });
});
```

Run — must FAIL.

### 1b. Implement CREATE_NAVAL_CONTACT in `GameRoom.ts`

Add inside **both** `if (process.env.DEV_MODE === "true")` and
`if (process.env.NODE_ENV === "test")` blocks:

```typescript
this.onMessage("CREATE_NAVAL_CONTACT", (_client, msg: {
  marker_id:    string;
  nation_id:    string;
  quality:      string;
  position_lng: number;
  position_lat: number;
}) => {
  const defaults = QUALITY_DEFAULTS[msg.quality];
  if (!defaults) return;
  const marker = new NavalContactMarkerState();
  marker.marker_id     = msg.marker_id;
  marker.nation_id     = msg.nation_id;
  marker.quality       = msg.quality;
  marker.position_lng  = msg.position_lng;
  marker.position_lat  = msg.position_lat;
  marker.radius_deg    = defaults.radius_deg;
  marker.expires_at_ms = Date.now() + defaults.duration_ms;
  marker.is_refreshable = defaults.is_refreshable;
  this.state.naval_contact_markers.set(msg.marker_id, marker);
});
```

Add imports: `NavalContactMarkerState`, `QUALITY_DEFAULTS` from their respective files.

Run tests — must PASS.

---

## Step 2: Contact Marker Expiry (TDD)

### 2a. Write failing tests (append to 12h test file)

```typescript
describe("Contact marker expiry", () => {
  it("expired marker is removed from state and CONTACT_MARKER_EXPIRED is broadcast", async () => {
    const { client, room } = await joinRoom();
    // Create a marker with duration_ms overridden to 0 (already expired)
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "exp1", nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.CARGO_SINKING,
      position_lng: 5.0, position_lat: 50.0,
    });
    await room.waitForNextPatch();
    // Force expires_at_ms into the past
    const marker = (room.state as GameRoomState).naval_contact_markers.get("exp1");
    (marker as any).expires_at_ms = Date.now() - 1000;

    const events: string[] = [];
    client.onMessage("CONTACT_MARKER_EXPIRED", (data: any) => {
      events.push(data.marker_id);
    });

    await tick(room);
    assert.ok(
      !(room.state as GameRoomState).naval_contact_markers.has("exp1"),
      "expired marker should be removed"
    );
    assert.ok(events.includes("exp1"), "CONTACT_MARKER_EXPIRED should be broadcast");
  });

  it("non-expired marker is NOT removed", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "live1", nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.MARITIME_PATROL,
      position_lng: 5.0, position_lat: 50.0,
    });
    await room.waitForNextPatch();
    await tick(room);
    assert.ok(
      (room.state as GameRoomState).naval_contact_markers.has("live1"),
      "non-expired marker should remain"
    );
  });

  it("refreshContact() extends expires_at_ms for refreshable markers", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "ref1", nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.MARITIME_PATROL,
      position_lng: 5.0, position_lat: 50.0,
    });
    await room.waitForNextPatch();
    const marker = (room.state as GameRoomState).naval_contact_markers.get("ref1") as any;
    const originalExpiry = marker.expires_at_ms;
    // Manually call the system's refreshContact (exposed for testing)
    (room as any).airNavalBomberSystem.refreshContact("ref1", room.state);
    assert.ok(marker.expires_at_ms >= originalExpiry, "expiry should extend on refresh");
  });
});
```

Run — must FAIL.

### 2b. Create `AirNavalBomberSystem` with expiry tick

```typescript
// game-server/src/systems/air_naval_bomber_system.ts
import { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { QUALITY_DEFAULTS } from "../data/naval_contact_quality.js";

type BroadcastFn = (type: string, msg: unknown) => void;

export class AirNavalBomberSystem {
  tick(state: GameRoomState, broadcast: BroadcastFn): void {
    this._tickMarkerExpiry(state, broadcast);
    // Step 3: port strike goes here
    // Step 4: mission stubs go here
  }

  _tickMarkerExpiry(state: GameRoomState, broadcast: BroadcastFn): void {
    const now = Date.now();
    for (const [markerId, marker] of state.naval_contact_markers) {
      if (now >= marker.expires_at_ms) {
        state.naval_contact_markers.delete(markerId);
        broadcast("CONTACT_MARKER_EXPIRED", {
          marker_id:  markerId,
          nation_id:  marker.nation_id,
        });
      }
    }
  }

  refreshContact(markerId: string, state: GameRoomState): void {
    const marker = state.naval_contact_markers.get(markerId);
    if (!marker || !marker.is_refreshable) return;
    const defaults = QUALITY_DEFAULTS[marker.quality];
    if (!defaults) return;
    marker.expires_at_ms = Date.now() + defaults.duration_ms;
  }
}
```

### 2c. Wire to GameRoom.ts

Instantiate in the constructor after the other systems:
```typescript
this.airNavalBomberSystem = new AirNavalBomberSystem();
```

Add to `gameTick()` after `airStrategicBombingSystem.tick()`:
```typescript
this.airNavalBomberSystem.tick(
  this.state,
  (type, msg) => this.broadcast(type, msg),
);
```

Run tests — must PASS.

---

## Step 3: Port Strike (TDD)

### 3a. Add port_strike_naval_base_damage to `air_bombing_stats.ts`

```typescript
export const PORT_STRIKE_NAVAL_BASE_DAMAGE_PER_PLANE = 0.1;
export const PORT_STRIKE_DAMAGE_SCALE = 0.1;
```

### 3b. Write failing tests (append to 12h)

```typescript
const PORT_PROVINCE = "we6_germany_01"; // use a known province from test map

describe("Port strike", () => {
  it("reduces naval_base_level on target province", async () => {
    const { client, room } = await joinRoom();
    // Seed naval_base_level > 0 so reduction is visible
    const prov = (room.state as GameRoomState).provinces.get(PORT_PROVINCE) as any;
    prov.naval_base_level = 10;

    client.send("SPAWN_WING", {
      wing_id: "nb1", nation_id: "germany",
      aircraft_type: "naval_bomber", count: 10,
      home_airbase_province_id: PORT_PROVINCE,
      mission: "port_strike",
      lifecycle_state: "loiter",
    });
    await room.waitForNextPatch();
    client.send("SET_WING_TARGET", { wing_id: "nb1", target_id: PORT_PROVINCE });
    await room.waitForNextPatch();

    const baseline = prov.naval_base_level;
    await tick(room);
    assert.ok(prov.naval_base_level < baseline, "naval_base_level should decrease");
  });

  it("does NOT fire PROVINCE_AA_FIRED — no AA on port strike", async () => {
    const { client, room } = await joinRoom();
    client.send("SET_PROVINCE_AA", { province_id: PORT_PROVINCE, strength: 100 });
    await room.waitForNextPatch();

    client.send("SPAWN_WING", {
      wing_id: "nb2", nation_id: "germany",
      aircraft_type: "naval_bomber", count: 10,
      home_airbase_province_id: PORT_PROVINCE,
      mission: "port_strike",
      lifecycle_state: "loiter",
    });
    await room.waitForNextPatch();
    client.send("SET_WING_TARGET", { wing_id: "nb2", target_id: PORT_PROVINCE });
    await room.waitForNextPatch();

    const aaEvents: unknown[] = [];
    client.onMessage("PROVINCE_AA_FIRED", (data) => aaEvents.push(data));

    const wingBefore = (room.state as GameRoomState).air_wings.get("nb2") as any;
    const countBefore = wingBefore.count;
    await tick(room);
    assert.strictEqual(wingBefore.count, countBefore, "wing count must not change from AA");
    assert.strictEqual(aaEvents.length, 0, "PROVINCE_AA_FIRED must not fire for port strike");
  });

  it("broadcasts NAVAL_BOMBER_STRIKE_HIT with province_id and naval_base_damage", async () => {
    const { client, room } = await joinRoom();
    const hitEvents: any[] = [];
    client.onMessage("NAVAL_BOMBER_STRIKE_HIT", (data) => hitEvents.push(data));

    client.send("SPAWN_WING", {
      wing_id: "nb3", nation_id: "germany",
      aircraft_type: "naval_bomber", count: 5,
      home_airbase_province_id: PORT_PROVINCE,
      mission: "port_strike",
      lifecycle_state: "loiter",
    });
    await room.waitForNextPatch();
    client.send("SET_WING_TARGET", { wing_id: "nb3", target_id: PORT_PROVINCE });
    await room.waitForNextPatch();
    await tick(room);

    assert.strictEqual(hitEvents.length, 1);
    assert.strictEqual(hitEvents[0].province_id, PORT_PROVINCE);
    assert.ok(typeof hitEvents[0].naval_base_damage === "number");
  });

  it("wing RTBs after port strike", async () => {
    const { client, room } = await joinRoom();
    client.send("SPAWN_WING", {
      wing_id: "nb4", nation_id: "germany",
      aircraft_type: "naval_bomber", count: 5,
      home_airbase_province_id: PORT_PROVINCE,
      mission: "port_strike",
      lifecycle_state: "loiter",
    });
    await room.waitForNextPatch();
    client.send("SET_WING_TARGET", { wing_id: "nb4", target_id: PORT_PROVINCE });
    await room.waitForNextPatch();
    await tick(room);
    const wing = (room.state as GameRoomState).air_wings.get("nb4") as any;
    assert.ok(
      wing.lifecycle_state === "rtb" || wing.lifecycle_state === "refuel",
      "wing should be RTBing after strike"
    );
  });
});
```

Run — must FAIL.

### 3c. Implement port strike in `AirNavalBomberSystem.tick()`

Add private method and wire in `tick()`:

```typescript
import { WING_LIFECYCLE, MISSION_TYPES } from "../rooms/schema/AirWingState.js";
import {
  PORT_STRIKE_NAVAL_BASE_DAMAGE_PER_PLANE,
  PORT_STRIKE_DAMAGE_SCALE,
} from "../data/air_bombing_stats.js";

// Add to AirNavalBomberSystem class:
_tickPortStrike(
  state: GameRoomState,
  lifecycleSystem: AirWingLifecycleSystem,
  broadcast: BroadcastFn,
): void {
  for (const [wingId, wing] of state.air_wings) {
    if (
      wing.lifecycle_state !== WING_LIFECYCLE.LOITER ||
      wing.mission !== MISSION_TYPES.PORT_STRIKE
    ) continue;

    const province = wing.target_id
      ? state.provinces.get(wing.target_id)
      : null;
    if (!province) {
      lifecycleSystem.resolveWingBombed(wingId, state, broadcast);
      continue;
    }

    // No AA for port strike — do not call aaSystem.computeAaDamage()
    const effectiveness = wing.count * wing.combat_readiness * PORT_STRIKE_DAMAGE_SCALE;
    const damage = effectiveness * PORT_STRIKE_NAVAL_BASE_DAMAGE_PER_PLANE;
    province.naval_base_level = Math.max(0, province.naval_base_level - damage);

    broadcast("NAVAL_BOMBER_STRIKE_HIT", {
      wing_id:           wingId,
      province_id:       wing.target_id,
      naval_base_damage: damage,
    });

    lifecycleSystem.resolveWingBombed(wingId, state, broadcast);
  }
}
```

Call it from `tick()`:
```typescript
this._tickPortStrike(state, lifecycleSystem, broadcast);
```

Update `tick()` signature to accept `lifecycleSystem`:
```typescript
tick(
  state: GameRoomState,
  lifecycleSystem: AirWingLifecycleSystem,
  broadcast: BroadcastFn,
): void
```

Update `GameRoom.ts` tick call to pass `airWingLifecycleSystem`.

Run tests — must PASS.

---

## Step 4: Mission Stubs — Anti-ship, Anti-sub, Strike Miss, Trade Interdiction (TDD)

### 4a. Write failing tests (append to 12h)

```typescript
describe("Anti-ship stub", () => {
  it("resolves HIT when target marker exists and is not expired", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "as1", nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.MARITIME_PATROL,
      position_lng: 5.0, position_lat: 50.0,
    });
    await room.waitForNextPatch();

    const hitEvents: any[] = [];
    client.onMessage("NAVAL_BOMBER_STRIKE_HIT", (d) => hitEvents.push(d));

    client.send("SPAWN_WING", {
      wing_id: "as_w1", nation_id: "germany",
      aircraft_type: "naval_bomber", count: 5,
      home_airbase_province_id: PORT_PROVINCE,
      mission: "anti_ship",
      lifecycle_state: "loiter",
    });
    await room.waitForNextPatch();
    client.send("SET_WING_TARGET", { wing_id: "as_w1", target_id: "as1" });
    await room.waitForNextPatch();
    await tick(room);

    assert.strictEqual(hitEvents.length, 1);
    assert.strictEqual(hitEvents[0].marker_id, "as1");
  });

  it("resolves MISS when target marker is expired or missing", async () => {
    const { client, room } = await joinRoom();
    const missEvents: any[] = [];
    client.onMessage("NAVAL_BOMBER_STRIKE_MISSED", (d) => missEvents.push(d));

    client.send("SPAWN_WING", {
      wing_id: "as_w2", nation_id: "germany",
      aircraft_type: "naval_bomber", count: 5,
      home_airbase_province_id: PORT_PROVINCE,
      mission: "anti_ship",
      lifecycle_state: "loiter",
    });
    await room.waitForNextPatch();
    // target_id points to a non-existent marker
    client.send("SET_WING_TARGET", { wing_id: "as_w2", target_id: "nonexistent_marker" });
    await room.waitForNextPatch();
    await tick(room);

    assert.strictEqual(missEvents.length, 1);
    assert.strictEqual(missEvents[0].wing_id, "as_w2");
  });
});

describe("Trade interdiction stub", () => {
  it("fires onCargoSinkingEvent with correct payload shape; no province change", async () => {
    const { client, room } = await joinRoom();
    // The stub fires the event internally; we verify no province scalar changes
    const provinceBefore = { ...(room.state as GameRoomState).provinces.get(PORT_PROVINCE) };

    client.send("SPAWN_WING", {
      wing_id: "ti_w1", nation_id: "germany",
      aircraft_type: "naval_bomber", count: 5,
      home_airbase_province_id: PORT_PROVINCE,
      mission: "trade_interdiction",
      lifecycle_state: "loiter",
    });
    await room.waitForNextPatch();
    await tick(room);

    const provinceAfter = (room.state as GameRoomState).provinces.get(PORT_PROVINCE) as any;
    assert.strictEqual(provinceAfter.industry, (provinceBefore as any).industry,
      "trade interdiction must not touch province scalars");
  });
});
```

Run — must FAIL.

### 4b. Implement stubs in `AirNavalBomberSystem`

```typescript
_tickNavalMissionStubs(
  state: GameRoomState,
  lifecycleSystem: AirWingLifecycleSystem,
  broadcast: BroadcastFn,
): void {
  const STUB_MISSIONS = new Set([
    MISSION_TYPES.ANTI_SHIP,
    MISSION_TYPES.ANTI_SUBMARINE,
    MISSION_TYPES.TRADE_INTERDICTION,
  ]);

  for (const [wingId, wing] of state.air_wings) {
    if (
      wing.lifecycle_state !== WING_LIFECYCLE.LOITER ||
      !STUB_MISSIONS.has(wing.mission)
    ) continue;

    if (wing.mission === MISSION_TYPES.TRADE_INTERDICTION) {
      // Interface stub — Phase 13 subscribes to this event
      // onCargoSinkingEvent payload defined for Phase 13 wiring
      // No province effect in Branch H
      lifecycleSystem.resolveWingBombed(wingId, state, broadcast);
      continue;
    }

    // ANTI_SHIP / ANTI_SUBMARINE — check marker existence
    const markerExists = wing.target_id &&
      state.naval_contact_markers.has(wing.target_id);

    if (markerExists) {
      broadcast("NAVAL_BOMBER_STRIKE_HIT", {
        wing_id:    wingId,
        marker_id:  wing.target_id,
        // no real ship data — Phase 13 provides composition
      });
    } else {
      broadcast("NAVAL_BOMBER_STRIKE_MISSED", { wing_id: wingId });
    }

    lifecycleSystem.resolveWingBombed(wingId, state, broadcast);
  }
}
```

Wire in `tick()`:
```typescript
this._tickNavalMissionStubs(state, lifecycleSystem, broadcast);
```

Run tests — must PASS.

---

## Step 5: Splash Perk (TDD)

### 5a. Create IFlotillaProvider interface in `air_naval_bomber_system.ts`

```typescript
export interface MockShip {
  ship_id: string;
  ship_class: string;
}

export interface IFlotillaProvider {
  getFlotillaMembers(flotillaId: string): MockShip[];
}

export class StubFlotillaProvider implements IFlotillaProvider {
  getFlotillaMembers(_flotillaId: string): MockShip[] {
    return [];  // Phase 13 injects real flotilla data
  }
}

export const SPLASH_PERCENT = 0.15;
```

### 5b. Write failing tests (append to 12h)

```typescript
describe("Splash perk", () => {
  it("perk_splash=false: only primary target hit — no crash with empty flotilla", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "sp1", nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.MARITIME_PATROL,
      position_lng: 5.0, position_lat: 50.0,
    });
    await room.waitForNextPatch();
    client.send("SPAWN_WING", {
      wing_id: "sp_w1", nation_id: "germany",
      aircraft_type: "naval_bomber", count: 5,
      home_airbase_province_id: PORT_PROVINCE,
      mission: "anti_ship", lifecycle_state: "loiter",
    });
    await room.waitForNextPatch();
    client.send("SET_WING_TARGET", { wing_id: "sp_w1", target_id: "sp1" });
    await room.waitForNextPatch();
    // perk_splash defaults to false — should not crash even with empty flotilla
    await tick(room);  // no assertion needed beyond "does not throw"
  });

  it("perk_splash=true with empty StubFlotillaProvider: no crash, NAVAL_BOMBER_STRIKE_HIT fires", async () => {
    const { client, room } = await joinRoom();
    client.send("CREATE_NAVAL_CONTACT", {
      marker_id: "sp2", nation_id: "germany",
      quality: NAVAL_CONTACT_QUALITY.MARITIME_PATROL,
      position_lng: 5.0, position_lat: 50.0,
    });
    await room.waitForNextPatch();
    client.send("SPAWN_WING", {
      wing_id: "sp_w2", nation_id: "germany",
      aircraft_type: "naval_bomber", count: 5,
      home_airbase_province_id: PORT_PROVINCE,
      mission: "anti_ship", lifecycle_state: "loiter",
      // perk_splash = true set via APPLY_PERKS handler
    });
    await room.waitForNextPatch();
    client.send("APPLY_PERKS", { wing_id: "sp_w2", perks: ["perk_splash"] });
    await room.waitForNextPatch();
    client.send("SET_WING_TARGET", { wing_id: "sp_w2", target_id: "sp2" });
    await room.waitForNextPatch();

    const hitEvents: any[] = [];
    client.onMessage("NAVAL_BOMBER_STRIKE_HIT", (d) => hitEvents.push(d));
    await tick(room);
    assert.strictEqual(hitEvents.length, 1, "HIT should fire even with empty flotilla");
  });
});
```

Run — must FAIL.

### 5c. Wire splash check into anti-ship/anti-sub stub logic

Inside the `markerExists` branch in `_tickNavalMissionStubs`, add after the HIT broadcast:

```typescript
if (wing.perk_splash) {
  const members = this._flotillaProvider.getFlotillaMembers(wing.target_id ?? "");
  if (members.length > 0) {
    const primaryDamage = wing.count * wing.combat_readiness;
    const splash = primaryDamage * SPLASH_PERCENT;
    // Phase 13: distribute splash across members
    // Branch H: members is [], so this block never executes
  }
}
```

Add `_flotillaProvider` to the class:

```typescript
private readonly _flotillaProvider: IFlotillaProvider;

constructor(flotillaProvider: IFlotillaProvider = new StubFlotillaProvider()) {
  this._flotillaProvider = flotillaProvider;
}
```

Check `perk_splash` field exists on `AirWingState` — if not, add it alongside the other
perk booleans: `@type("boolean") perk_splash: boolean = false;`

Run tests — must PASS.

---

## Step 6: Update `package.json`

Append to the test chain after the 12g entry:
```
&& NODE_ENV=test mocha -r tsx test/12h-naval-bomber.test.ts --exit --timeout 180000
```

Run full suite — 12a through 12h must all pass:
```bash
cd game-server && npm test
```

---

## Step 7: Client — Contact Marker Circle

No automated tests for client. Visual verification per checks below.

### 7a. Add EventBus signal in `event_bus.gd`

```gdscript
signal naval_contact_marker_expired(data: Dictionary)
```

### 7b. Route in `session_manager.gd`

In the message handler block (alongside `PROVINCE_AA_FIRED`, `AIR_BOMBING_PROVINCE_RESULT`):
```gdscript
"CONTACT_MARKER_EXPIRED":
    EventBus.naval_contact_marker_expired.emit(data)
```

### 7c. Create `naval_contact_marker_system.gd`

```gdscript
extends Node2D
## Renders naval contact markers as translucent circles on the map.
## Only own-nation markers are received from the server (nation filtering is server-side).

const C_NAVAL := Color(0.10, 0.62, 0.62, 1.0)   # from air_combat_banner.gd
const ICON_SIZE := Vector2(14, 14)

## Quality → icon texture path
const QUALITY_ICONS := {
    "maritime_patrol": "res://assets/icons/jet-fighter-up-solid-full.svg",
    "cargo_sinking":   "res://assets/icons/fire-solid-full.svg",
    "flotilla_scout":  "res://assets/icons/clock-solid-full.svg",
}

var _markers: Dictionary = {}   # marker_id → { data: Dictionary, node: Node2D }
var _map_loader  # injected on _ready

func _ready() -> void:
    _map_loader = get_node("/root/MapLoader")   # adjust to project's actual path
    EventBus.naval_contact_marker_expired.connect(_on_marker_expired)

## Called by session_manager when naval_contact_markers schema patch arrives.
func sync_markers(patch: Array) -> void:
    for item in patch:
        var mid: String = item.get("marker_id", "")
        if not _markers.has(mid):
            _spawn_marker(item)
        # No field updates needed — markers are create/delete only

func _spawn_marker(data: Dictionary) -> void:
    var node := _MarkerCircle.new()
    node.setup(data, _map_loader)
    add_child(node)
    _markers[data["marker_id"]] = { "data": data, "node": node }

func _on_marker_expired(data: Dictionary) -> void:
    var mid: String = data.get("marker_id", "")
    if _markers.has(mid):
        _markers[mid]["node"].queue_free()
        _markers.erase(mid)

## Inner class — one circle node per marker
class _MarkerCircle extends Node2D:
    var _radius_px: float = 0.0
    var _expires_at_ms: float = 0.0
    var _icon_tex: Texture2D = null
    var _quality: String = ""

    func setup(data: Dictionary, map_loader) -> void:
        var center := map_loader.project_lng_lat(
            data["position_lng"], data["position_lat"])
        position = center
        # Convert radius_deg to pixels — approximate: 1° ≈ map scale
        _radius_px = data["radius_deg"] * map_loader.deg_to_px()
        _expires_at_ms = float(data["expires_at_ms"])
        _quality = data.get("quality", "")
        var icon_path: String = NavalContactMarkerSystem.QUALITY_ICONS.get(_quality, "")
        if icon_path != "":
            _icon_tex = load(icon_path)
        queue_redraw()

    func _process(_delta: float) -> void:
        queue_redraw()

    func _draw() -> void:
        var now_ms := Time.get_unix_time_from_system() * 1000.0
        var remaining := _expires_at_ms - now_ms
        # Fade alpha from 0.4 to 0.05 as expiry approaches
        var alpha := clampf(remap(remaining, 0.0, 60_000.0, 0.05, 0.4), 0.05, 0.4)
        var color := Color(C_NAVAL.r, C_NAVAL.g, C_NAVAL.b, alpha)
        draw_circle(Vector2.ZERO, _radius_px, color)
        draw_arc(Vector2.ZERO, _radius_px, 0.0, TAU, 48,
                 Color(C_NAVAL.r, C_NAVAL.g, C_NAVAL.b, alpha + 0.2), 1.5)
        if _icon_tex:
            var rect := Rect2(-ICON_SIZE * 0.5, ICON_SIZE)
            draw_texture_rect(_icon_tex, rect, false,
                              Color(0.08, 0.05, 0.02, minf(alpha * 3.0, 0.9)))
```

**Note:** `map_loader.deg_to_px()` — check if this helper exists in `MapLoader` or equivalent.
If not, use the same scale factor used elsewhere in `air_wing_icon.gd` or similar for
converting geographic degrees to screen pixels.

### 7d. Wire schema patch to system

In `session_manager.gd` (alongside `AIR_WING_UPDATES` handler), listen for Colyseus
schema patches on `naval_contact_markers` and call:
```gdscript
naval_contact_marker_system.sync_markers(added_markers)
```

Add `naval_contact_marker_system` as an autoload in `project.godot` (following the same
pattern as `air_wing_system`).

---

## Visual Tests (4 checks — the rest are stubs with no observable effect)

Run these manually after the client code compiles.

| # | Action | Expected |
|---|---|---|
| 1 | Send `CREATE_NAVAL_CONTACT` for all three quality tiers from dev console | Three circles appear on map: small tight teal (MARITIME_PATROL), large wide teal (CARGO_SINKING), medium teal (FLOTILLA_SCOUT). Each has its center icon (jet / fire / clock). |
| 2 | Look at the three circles side-by-side | CARGO_SINKING circle is visibly much wider than MARITIME_PATROL; FLOTILLA_SCOUT sits between them |
| 3 | Seed a CARGO_SINKING marker (20s), watch for 20 seconds | Circle alpha visibly fades; circle disappears on expiry |
| 4 | Open two client windows as different nations; seed marker for nation A | Nation B's client shows no circle |

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| ProvinceState is in its own file | **Wrong** — it is defined at lines 34–41 inside `GameRoomState.ts`. Do not create a separate ProvinceState.ts. |
| `naval_bomber` needs to be added to LOW_ALTITUDE_TYPES | **Wrong** — it is already there in `air_province_aa_system.ts`. Adding it again will cause a no-op at best, duplicate-key error at worst. |
| Port strike should call `aaSystem.computeAaDamage()` | **Wrong** — port strike explicitly has no AA. Do not call it. The test asserts count does not change. |
| `PORT_STRIKE` mission type already exists | **Wrong** — it is absent from MISSION_TYPES. Add it. Do not assume it is there without checking. |
| `perk_splash` field already exists on AirWingState | **Uncertain** — check before adding. If it exists, do not re-declare it. |
| CONTACT_MARKER_EXPIRED should broadcast to all clients | **Wrong** — it should only go to the owning nation (nation_id). Use `broadcastToNation` pattern from AirStrategicBombingSystem, not `broadcast`. |
| The client receives markers for all nations | **Wrong** — server must filter by `nation_id` before sending schema patches. Enemy markers must never reach a client. Colyseus interest management (StateView) is the mechanism; ensure the naval_contact_markers MapSchema applies the same filtering as air wings. |
| refreshContact() should fire for all markers every tick | **Wrong** — `refreshContact()` is called only externally (by a patrol wing's tick in Phase 13). In Branch H it is defined and exposed for testing only. |
| The splash perk needs real flotilla data to be testable | **Wrong** — the test verifies the code path does not crash with an empty list. That is sufficient for Branch H. |
| `CREATE_NAVAL_CONTACT` goes only in the test block | **Wrong** — register it in BOTH the DEV_MODE block and the test block, following the SPAWN_WING pattern which appears in both. |
| AirNavalBomberSystem.tick() should come before AirStrategicBombingSystem.tick() | **Wrong** — insert it AFTER strategic bombing, before detection. Match the comment in gameTick(). |
| _resolveTargetPosition does not need extending | **Wrong** — ANTI_SHIP and ANTI_SUBMARINE missions target a marker_id, not a province_id. The handler must resolve the marker's center position. Add a third branch: check state.naval_contact_markers.has(target_id). |
| `deg_to_px()` helper exists in MapLoader | **Uncertain** — check before using. If absent, derive the scale factor from how `air_wing_icon.gd` converts geographic degrees to screen pixels. |
| `Time.get_ticks_msec()` can be compared to server `expires_at_ms` | **Wrong** — `get_ticks_msec()` is uptime-relative; use `Time.get_unix_time_from_system() * 1000.0` for Unix ms comparable to server `Date.now()`. |
