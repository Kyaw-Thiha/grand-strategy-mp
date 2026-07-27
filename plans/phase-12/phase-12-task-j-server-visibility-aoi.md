# Branch J — `feat/air-networking-aoi`

## Execution Progress

| Step | Status | Commit | Notes |
|---|---|---|---|
| Step 1: Create `geo_utils.ts` | ✅ DONE | `58e1277` | Reviewed, approved |
| Step 2: Refactor `AirDetectionSystem` | ✅ DONE | `8d4f7f3` | Reviewed, approved. 15/15 tests pass |
| Step 3: Write failing tests (TDD) | ⚠️ PARTIAL | uncommitted | Agent interrupted. `12j-server-visibility-aoi.test.ts` exists in working tree (untracked), `GameRoom.ts` modified (SET_DIVISION_POSITION added). Need to verify, commit, and confirm tests fail as expected |
| Step 4: Create `ServerVisibilitySystem` | ❌ TODO | — | |
| Step 5: Wire into `GameRoom.ts` | ❌ TODO | — | 5a–5g |
| Step 6: Update `package.json` | ❌ TODO | — | |
| Step 7: Client — EventBus Signals | ❌ TODO | — | |
| Step 8: Client — `session_manager.gd` handlers | ❌ TODO | — | |
| Step 9: Client — `game_state.gd` | ❌ TODO | — | |
| Step 10: Animations (`division_icon.gd`, `air_wing_icon.gd`) | ❌ TODO | — | |
| Step 11: `military_system.gd` + `detection_ring.gd` | ❌ TODO | — | |
| Step 12: `air_wing_system.gd` | ❌ TODO | — | |
| Step 13: Verification | ❌ TODO | — | |

**Base commit (branch start):** `fc5020b`
**Resume at:** Step 3 — check working tree, commit partial work, then proceed to Step 4.

## Context

All unit updates (divisions and air wings) currently broadcast to every connected client with no
server-side filtering. Each client receives position/state data for units it has no business
seeing — enemy divisions hidden in fog of war, undetected enemy wings. This wastes bandwidth
(meaningful at large maps and end-game unit counts), breaks fog-of-war integrity, and enables
client-side cheating by reading raw WebSocket frames.

This branch adds server-side per-nation visibility filtering for both divisions and air wings,
driven by a new `ServerVisibilitySystem`. It also adds fog-emerge/fade animations on the client
when units appear or disappear. Binary schema + StateView is deferred to a future infrastructure
branch — see `wiki/future-works/binary-schema-sync.md`.

**Test-Driven Development is mandatory.** Write ALL failing tests before implementing each step.

---

## Critical Pre-Read: Existing Code Facts

The execution agent MUST NOT misassume any of the following.

### `is_detected` is a single boolean, NOT per-nation

`AirWingState.ts` line 95:
```typescript
@type("boolean") is_detected: boolean = false;
```
It means "detected by at least one hostile nation." There is no per-nation detection tracking for
wings yet. Branch J adds it by refactoring `AirDetectionSystem._isWingDetected()` into
`_canNationDetectWing(observerNationId, ...)` and computing a `Map<wingId, Set<nationId>>`
each tick. The single `is_detected` boolean is kept for backwards compatibility.

**Note:** `WING_LIFECYCLE` has 7 values (including `RELOCATE`), not 6. Step 4's `_computeWingVisibility`
`IDLE_STATES` intentionally excludes `RELOCATE` — wings in ferry flight are airborne and remain
detectable to enemies, same as any other airborne wing.

### `AirDetectionSystem` already outputs per-nation division visibility

`air_detection_system.ts` has:
```typescript
private _prevVisibleDivisions: Map<string, Set<string>> = new Map();
getVisibleDivisionsForNation(nationId: string): Set<string> {
  return this._prevVisibleDivisions.get(nationId) ?? new Set();
}
```
`ServerVisibilitySystem` uses this directly as one of its visibility inputs. Do not recompute
air-to-ground division visibility — call `getVisibleDivisionsForNation()`.

### `_pointInPolygon` is private to `movement_system.ts`

Exact signature (line 200–211):
```typescript
private _pointInPolygon(px: number, py: number, polygon: number[][]): boolean
```
Ray-casting algorithm. `polygon` is a flat array of `[lng, lat]` pairs. The map data polygon
format is `number[][][]` (array of rings; each ring is array of `[lng, lat]` pairs).
Extract this as a standalone function to `geo_utils.ts`. Do NOT modify `movement_system.ts` —
leave its private copy in place.

### `_initProvinces` does NOT load polygon data

`GameRoom._initProvinces()` loads `city_position` into `_provinceCityPositionLookup` and
`province_id`/`nation_id`/`population`/`industry`/`infrastructure` into `ProvinceState` — but
does NOT load `polygons`. `ServerVisibilitySystem` must load polygon data itself from
`map_data.json` via `getCachedFile` at the same path pattern as `MovementSystem.loadMapData()`.

### `map_data.json` province polygon format

Each province has a `polygons: number[][][]` field — array of rings, each ring an array of
`[lng, lat]` pairs. A province can have multiple rings. The `city_position: [number, number]`
field is `[lng, lat]`.

### `gameTick()` insertion point for `ServerVisibilitySystem`

Current tail of `gameTick()` (lines 1525–1548):
```
airDetectionSystem.tick()          ← line 1525
← INSERT ServerVisibilitySystem.tick() HERE ←
const toUpdate = new Set(...)      ← line 1540
// serialize + broadcast division updates ← line 1541–1548
```
`ServerVisibilitySystem.tick()` runs AFTER all detection is complete. The division update
broadcast loop (lines 1540–1548) is replaced with per-client filtered sends.

### `broadcastToNation` inline pattern — 6 copies

All 6 are identical (lines 469, 741, 1484, 1500, 1515, 1530):
```typescript
for (const c of this.clients) {
  const p = this.state.players.get(c.sessionId);
  if (!p) continue;
  const n = this.getNationForPlayer(p.userId);
  if (!n || n.nation_id !== nationId) continue;
  c.send(type, msg);
}
```
Extract to a private helper method in Step 5a. All 6 call sites are updated to use the helper.

### `getAllianceFor(nationId)` returns Set including self

`GameRoom.ts` line 1937. Returns `Set<string>` containing `nationId` plus all BFS-reachable
allied nations. `ServerVisibilitySystem` receives this as a constructor-injected callback
(same pattern as other systems receiving `broadcastToNation`).

### System constructor injection pattern

Most systems are initialized as property declarations. Systems needing post-`_initProvinces`
data are declared with `!` and initialized after:
```typescript
// In GameRoom property declarations:
private serverVisibilitySystem!: ServerVisibilitySystem;
// In onCreate(), after _initProvinces():
this.serverVisibilitySystem = new ServerVisibilitySystem(
  getCachedFile<MapData>(dataPath).provinces,  // polygon data
  this._provinceCityPositionLookup,             // city positions
);
```

### Division update guard in `game_state.gd`

`_apply_division_updates()` (line 83–98) skips unknown divisions:
```gdscript
if div_id.is_empty() or not divisions.has(div_id):
    continue
```
New divisions from `DIVISION_APPEARED` must be added before `DIVISION_UPDATES` can update them.
Use a separate `_apply_division_appeared()` method (same logic as `_apply_divisions_spawned()`
but for a single division dict).

### Air wing update creates-or-updates

`_apply_air_wing_updates()` (line 288–298) has no guard — `air_wings[id] = wing_data` always.
When a wing first becomes visible (server sends full payload via normal `AIR_WING_UPDATES`),
it's naturally created as new. No `AIR_WING_APPEARED` event needed — reuse existing flow.

### Icon structure — leaf `Node2D` with `_draw()`

Both `division_icon.gd` and `air_wing_icon.gd` are standalone `Node2D` nodes with no children.
All rendering is done in `_draw()`. `CanvasItem.modulate.a` controls alpha across all `_draw()`
output — this is the animation handle. Tweening `modulate.a` fades the icon without touching
`_draw()` code.

### Animation pattern — mirror `set_selected()` in `division_icon.gd`

`division_icon.gd` already has a 100ms selection pop animation (lines 84–154) using:
- `_selection_animation_elapsed: float` state variable
- `set_process(true)` to enable `_process(delta)` during animation
- `queue_redraw()` each frame
- `set_process(false)` when animation completes

Mirror this pattern for `reveal()` / `conceal()`. Use `Tween` (already used in the project for
loading screen and notification feed) for simplicity — no need to manage elapsed manually.

### `_icons` dictionaries

- `military_system._icons: Dictionary` — keyed by `division_id`, value is the `DivisionIcon` node; has `get_icons()` accessor
- `air_wing_system._icons: Dictionary` — keyed by `wing_id`, value is the `AirWingIcon` node; no `get_icons()` accessor
- Neither has a `get_icon(id)` helper. Access via `_icons.get(id)` directly.

### Existing EventBus signals (do NOT re-add)

From `event_bus.gd` (confirmed in Branch G task file):
`division_added`, `division_updated`, `division_removed`, `division_revealed`, `division_hidden`,
`air_wing_added`, `air_wing_updated`, `air_wing_removed`, `air_wing_detected`,
`air_wing_detection_lost`. The following do NOT exist yet — add in Step 7.

### Existing session_manager.gd handlers (do NOT re-add)

Lines 130–170 already handle: `AIR_WING_UPDATES`, `AIR_WING_PATH`, `WING_DETECTED`,
`WING_LOST_DETECTION`, `RADAR_UPDATED`, `AIR_WING_STAGING`, `AIR_WING_DESTROYED`,
`AIR_COMBAT_STARTED`, `AIR_COMBAT_ENDED`, `AIR_WING_RTB_QUEUED`, `AIR_WING_MOVE_REJECTED`,
`AIR_BOMBING_PROVINCE_RESULT`, `PROVINCE_AA_FIRED`.

### Test boilerplate from `test/12d-air-detection.test.ts`

```typescript
before(async () => {
  colyseus = await boot(appConfig, getTestPort());
});
after(async () => { await colyseus.close(); });
beforeEach(async () => { await colyseus.cleanup(); });
// helpers:
makeToken(sub?)                  // JWT
joinRoom(nationId?)              // returns { client, room }
setRelation(room, a, b, stance)
tickRoom(room)                   // gameTick() + waitForNextPatch()
```
For multi-client visibility tests, call `joinRoom()` twice. Check `@colyseus/testing` pattern for
joining an existing room by ID (e.g. `colyseus.sdk.joinById(room.roomId, {}, token)`).

### Test handlers already registered (do NOT re-register)

`SPAWN_WING`, `SPAWN_DIVISION`, `SET_RELATION`, `SET_CELL`, `SPAWN_NATION`, `APPLY_PERKS`,
`SET_WING_LIFECYCLE`, `SET_WING_READINESS`, `SET_WING_FUEL`, `SET_WING_TARGET`,
`SET_WING_COUNT`, `SET_WING_STATUS_FUEL`, `SET_PATH_ELAPSED`, `SET_PROVINCE_RADAR`,
`SET_WING_POSITION`, `SET_PROVINCE_OWNER`, `SET_PROVINCE_AA`.

New handler needed: `SET_DIVISION_POSITION { division_id, lng, lat }`.

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/src/utils/geo_utils.ts` | Shared `pointInPolygon()` + province polygon loader |
| `game-server/src/systems/server_visibility_system.ts` | Per-nation visibility orchestrator |
| `game-server/test/12j-server-visibility-aoi.test.ts` | All Branch J tests |
| `client/src/systems/military/detection_ring.gd` | Short-lived radar ping VFX node |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/systems/air_detection_system.ts` | Add per-nation wing detection Map; expose getter |
| `game-server/src/rooms/GameRoom.ts` | Extract `broadcastToNation()` helper; wire visibility system; per-client division/wing broadcast filtering; new test handler |
| `game-server/package.json` | Append 12j to test chain |
| `client/src/core/event_bus.gd` | Add 4 new signals |
| `client/src/core/game_state.gd` | Add `_apply_division_appeared()`, handle `DIVISION_VANISHED` and `AIR_WING_VANISHED` |
| `client/src/systems/session/session_manager.gd` | Add 3 new message handlers |
| `client/src/systems/military/division_icon.gd` | Add `reveal()` and `conceal() -> Signal` methods |
| `client/src/systems/air/air_wing_icon.gd` | Add `reveal()` and `conceal() -> Signal` methods |
| `client/src/systems/military/military_system.gd` | Handle `division_appeared`, `division_vanishing`; radar ping VFX |
| `client/src/systems/air/air_wing_system.gd` | Handle `air_wing_vanishing`; call `reveal()` on newly detected wings |

---

## Step 1: Create `geo_utils.ts`

Create `game-server/src/utils/geo_utils.ts`:

```typescript
import { getCachedFile } from "../utils/cache.js"; // use same import pattern as movement_system
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/** Ray-casting point-in-polygon. polygon is [[lng,lat], ...] */
export function pointInPolygon(px: number, py: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export interface ProvincePIPEntry {
  province_id: string;
  nation_id:   string;
  polygons:    number[][][];
  minLng: number; maxLng: number;
  minLat: number; maxLat: number;
}

/** Loads province polygon data from map_data.json and builds bounding-box-accelerated PIP entries. */
export function loadProvincePIPData(mapId: string): ProvincePIPEntry[] {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const dataPath = join(__dir, "../../..", "client", "assets", "data", mapId, "map_data.json");
  const raw = getCachedFile<{
    provinces: Array<{ province_id: string; nation_id: string; polygons: number[][][] }>;
  }>(dataPath);

  return raw.provinces.map(p => {
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const ring of p.polygons) {
      for (const coord of ring) {
        if (coord[0] < minLng) minLng = coord[0];
        if (coord[0] > maxLng) maxLng = coord[0];
        if (coord[1] < minLat) minLat = coord[1];
        if (coord[1] > maxLat) maxLat = coord[1];
      }
    }
    return { province_id: p.province_id, nation_id: p.nation_id, polygons: p.polygons, minLng, maxLng, minLat, maxLat };
  });
}

/** Returns the province_id of the province containing (lng, lat), or null if none. */
export function findProvinceAtPoint(
  lng: number,
  lat: number,
  entries: ProvincePIPEntry[],
): string | null {
  for (const e of entries) {
    if (lng < e.minLng || lng > e.maxLng || lat < e.minLat || lat > e.maxLat) continue;
    for (const ring of e.polygons) {
      if (pointInPolygon(lng, lat, ring)) return e.province_id;
    }
  }
  return null;
}
```

> **Verify the correct import path for `getCachedFile`** by reading `movement_system.ts` — it
> uses `getCachedFile` too; use the same import path.

---

## Step 2: Refactor `AirDetectionSystem` for Per-Nation Wing Detection

**Read `air_detection_system.ts` in full before modifying.**

### 2a. Add per-nation tracking field and getter

Add after the existing `_prevDetected` field:
```typescript
private _prevWingDetectedByNation: Map<string, Set<string>> = new Map();
// wingId → set of nationIds that currently detect this wing (excludes own/allies)

getWingDetectedByNations(wingId: string): Set<string> {
  return this._prevWingDetectedByNation.get(wingId) ?? new Set();
}
```

### 2b. Rename and refactor `_isWingDetected` → `_canNationDetectWing`

The current method checks "can ANY hostile nation see this wing." Replace with a method that
checks "can THIS SPECIFIC nation see this wing":

```typescript
private _canNationDetectWing(
  observerNationId: string,
  wingId: string,
  wingNationId: string,
  wingLng: number,
  wingLat: number,
  state: GameRoomState,
  airborneWingsList: AirborneWingSnapshot[],
): boolean {
  // Radar: only this observer's radars count
  for (const radar of this._radars.values()) {
    if (radar.nation_id !== observerNationId) continue;
    if (euclidDeg(wingLng, wingLat, radar.position_lng, radar.position_lat) <= radar.radius_deg)
      return true;
  }
  // Other airborne wings belonging to observerNation
  for (const source of airborneWingsList) {
    if (source.wing_id === wingId) continue;
    if (source.nation_id !== observerNationId) continue;
    const radius = source.mission === MISSION_TYPES.RECON
      ? RECON_WING_RADIUS_DEG
      : getObservationDeg(source.aircraft_type);
    if (euclidDeg(wingLng, wingLat, source.position_lng, source.position_lat) <= radius)
      return true;
  }
  // Ground divisions belonging to observerNation
  for (const division of state.divisions.values()) {
    if (division.nation_id !== observerNationId) continue;
    const radiusDeg = division.observation_radius / KM_PER_DEG;
    if (euclidDeg(wingLng, wingLat, division.position_lng, division.position_lat) <= radiusDeg)
      return true;
  }
  return false;
}
```

### 2c. Rewrite wing detection loop in `tick()`

Replace the existing air-to-air detection loop:

```typescript
// ── Air-to-air detection (per-nation) ───────────────────────────────────
const newWingDetectedByNation = new Map<string, Set<string>>();
for (const wing of airborneWings) {
  const detectors = new Set<string>();
  for (const [nationId] of state.nations) {
    if (nationId === wing.nation_id) continue;
    if (!this._areNationsHostile(nationId, wing.nation_id, state)) continue;
    if (this._canNationDetectWing(
      nationId, wing.wing_id, wing.nation_id,
      wing.position_lng, wing.position_lat, state, airborneWings,
    )) {
      detectors.add(nationId);
    }
  }
  newWingDetectedByNation.set(wing.wing_id, detectors);
  // Backwards compat: is_detected = detected by any hostile nation
  const detected = detectors.size > 0;
  const wasDetected = this._prevDetected.get(wing.wing_id) ?? false;
  wing.is_detected = detected;
  this._prevDetected.set(wing.wing_id, detected);
  if (detected && !wasDetected) {
    broadcast("WING_DETECTED", { wing_id: wing.wing_id, nation_id: wing.nation_id });
  } else if (!detected && wasDetected) {
    broadcast("WING_LOST_DETECTION", { wing_id: wing.wing_id, nation_id: wing.nation_id });
  }
}
this._prevWingDetectedByNation = newWingDetectedByNation;
```

**Run 12d tests after Step 2 — must all still pass:**
```bash
cd game-server && NODE_ENV=test mocha -r tsx test/12d-air-detection.test.ts --exit --timeout 180000
```

---

## Step 3: Write All Failing Tests (TDD — write before implementing ServerVisibilitySystem)

Create `game-server/test/12j-server-visibility-aoi.test.ts`. Copy boilerplate from
`test/12d-air-detection.test.ts`. Add 2-client test infrastructure.

### Multi-client join helper

Read `@colyseus/testing` docs / existing test files for joining an existing room by ID.
Add to the test file:
```typescript
async function joinSecondClient(room: any, nationId: string) {
  const client2 = await colyseus.sdk.joinById(room.roomId, {}, makeToken("user2"));
  await client2.send("SELECT_NATION", { nation_id: nationId });
  return client2;
}
```

### New test handler — add to GameRoom (see Step 5f)

`SET_DIVISION_POSITION { division_id, lng, lat }` — sets division position directly for test setup.

### Division visibility tests

**Own nation always sees own divisions:**
- Spawn german division; tick; germany client receives DIVISION_UPDATES for it.

**Enemy division not visible without detection:**
- 2 clients (germany, france) at war. Spawn french division far from german units.
- Tick. Germany client receives NO DIVISION_UPDATES containing the french division.
- Germany client does NOT receive DIVISION_APPEARED for the french division.

**Land-to-land observation:**
- Spawn german division at (10, 50). Spawn french division at (10.5, 50) — within 100km default observation radius.
- Set germany/france at war. Tick.
- Germany client receives DIVISION_APPEARED for french division.

**Province ownership reveals enemy division:**
- Set province "we6_germany_01" owner = germany. Spawn french division at city position of that province (use PIP to confirm it's inside).
- Set germany/france at war. German division far away (outside observation range).
- Tick. Germany receives DIVISION_APPEARED for french division (province ownership trigger).

**Division vanishes when out of range:**
- Spawn french division within german observation range → DIVISION_APPEARED sent.
- Move french division far away (use SET_DIVISION_POSITION). Tick.
- Germany client receives DIVISION_VANISHED for french division.

**Allied nations share vision:**
- Germany and UK in alliance. Spawn french division visible to german unit (within obs range).
- UK client should also receive the french division (via alliance sharing from germany's detection).

### Wing visibility tests

**Own wings always visible:**
- Spawn german wing (idle). Tick. German client gets AIR_WING_UPDATES for it.

**Idle enemy wing not sent to hostile:**
- 2 clients. Spawn french wing in IDLE state. Tick.
- Germany client receives NO AIR_WING_UPDATES for the french wing.

**Airborne + detected wing is sent:**
- Spawn french wing in TRANSIT state. Spawn german division within detection radius of french wing.
- Set war. Tick. Germany receives AIR_WING_UPDATES for french wing.

**Wing vanishes when detection lost:**
- Wing detected → AIR_WING_UPDATES flowing. Move wing out of range. Tick.
- Germany receives AIR_WING_VANISHED for the french wing.
- After AIR_WING_VANISHED: subsequent ticks do NOT send AIR_WING_UPDATES to germany.

**Province ownership reveals flying wing:**
- German-owned province. French wing flying over it (position inside province polygon). Tick.
- Germany receives AIR_WING_UPDATES for french wing (province ownership detection).

### Alliance vision tests

**Allied nation sees partner's visible enemies:**
- Germany and UK allied. France at war with germany. French division visible to german unit.
- UK client should receive the french division.

### `broadcastToNation` helper refactor regression

Run 12a–12h full suite after Step 5a to confirm helper extraction doesn't break anything.

**Run all tests now — new tests MUST FAIL; existing suites must still pass:**
```bash
cd game-server && NODE_ENV=test mocha -r tsx test/12j-server-visibility-aoi.test.ts --exit --timeout 180000
```

---

## Step 4: Create `ServerVisibilitySystem`

Create `game-server/src/systems/server_visibility_system.ts`:

```typescript
import { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE } from "../rooms/schema/AirWingState.js";
import { findProvinceAtPoint, ProvincePIPEntry } from "../utils/geo_utils.js";
import type { AirDetectionSystem } from "./air_detection_system.js";

type BroadcastToClientFn = (clientSessionId: string, type: string, msg: unknown) => void;
type GetAllianceFn       = (nationId: string) => Set<string>;

const KM_PER_DEG = 111.32;

export class ServerVisibilitySystem {
  private _pipEntries:  ProvincePIPEntry[];
  private _prevDivVis:  Map<string, Set<string>> = new Map(); // nationId → Set<divisionId>
  private _prevWingVis: Map<string, Set<string>> = new Map(); // nationId → Set<wingId>

  constructor(pipEntries: ProvincePIPEntry[]) {
    this._pipEntries = pipEntries;
  }

  canNationSeeDivision(nationId: string, divisionId: string): boolean {
    return this._prevDivVis.get(nationId)?.has(divisionId) ?? false;
  }

  canNationSeeWing(nationId: string, wingId: string): boolean {
    return this._prevWingVis.get(nationId)?.has(wingId) ?? false;
  }

  tick(
    state:             GameRoomState,
    detectionSystem:   AirDetectionSystem,
    getAlliance:        GetAllianceFn,
    broadcastToClient: BroadcastToClientFn,
    getClientNation:   (sessionId: string) => string | null,
    clients:           Iterable<{ sessionId: string }>,
  ): void {
    const newDivVis  = this._computeDivisionVisibility(state, detectionSystem, getAlliance);
    const newWingVis = this._computeWingVisibility(state, detectionSystem, getAlliance);

    // ── Division appeared / vanished ────────────────────────────────────
    for (const [nationId, newVisible] of newDivVis) {
      const prevVisible = this._prevDivVis.get(nationId) ?? new Set<string>();
      for (const divId of newVisible) {
        if (!prevVisible.has(divId)) {
          const div = state.divisions.get(divId);
          if (!div) continue;
          this._sendToNation(nationId, "DIVISION_APPEARED", serializeDivision(div), broadcastToClient, getClientNation, clients);
        }
      }
      for (const divId of prevVisible) {
        if (!newVisible.has(divId)) {
          this._sendToNation(nationId, "DIVISION_VANISHED", { division_id: divId }, broadcastToClient, getClientNation, clients);
        }
      }
    }
    for (const [nationId, prevVisible] of this._prevDivVis) {
      if (!newDivVis.has(nationId)) {
        for (const divId of prevVisible) {
          this._sendToNation(nationId, "DIVISION_VANISHED", { division_id: divId }, broadcastToClient, getClientNation, clients);
        }
      }
    }

    // ── Wing vanished ───────────────────────────────────────────────────
    for (const [nationId, prevVisible] of this._prevWingVis) {
      const newVisible = newWingVis.get(nationId) ?? new Set<string>();
      for (const wingId of prevVisible) {
        if (!newVisible.has(wingId)) {
          this._sendToNation(nationId, "AIR_WING_VANISHED", { wing_id: wingId }, broadcastToClient, getClientNation, clients);
        }
      }
    }

    this._prevDivVis  = newDivVis;
    this._prevWingVis = newWingVis;
  }

  private _computeDivisionVisibility(
    state: GameRoomState,
    detection: AirDetectionSystem,
    getAlliance: GetAllianceFn,
  ): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    for (const [divId, div] of state.divisions.entries()) {
      const divProvinceId = findProvinceAtPoint(div.position_lng, div.position_lat, this._pipEntries);
      const divProvinceOwnerId = divProvinceId ? state.provinces.get(divProvinceId)?.owner_id : null;
      for (const [nationId] of state.nations) {
        if (div.nation_id === nationId) { this._addToResult(result, nationId, divId); continue; }
        if (getAlliance(div.nation_id).has(nationId)) { this._addToResult(result, nationId, divId); continue; }
        if (detection.getVisibleDivisionsForNation(nationId).has(divId)) { this._addToResult(result, nationId, divId); continue; }
        if (divProvinceOwnerId === nationId) { this._addToResult(result, nationId, divId); continue; }
        // Land-to-land observation
        for (const [, observerDiv] of state.divisions.entries()) {
          if (observerDiv.nation_id !== nationId) continue;
          const radiusDeg = observerDiv.observation_radius / KM_PER_DEG;
          const dx = div.position_lng - observerDiv.position_lng;
          const dy = div.position_lat - observerDiv.position_lat;
          if (Math.sqrt(dx * dx + dy * dy) <= radiusDeg) { this._addToResult(result, nationId, divId); break; }
        }
      }
    }
    return result;
  }

  private _computeWingVisibility(
    state: GameRoomState,
    detection: AirDetectionSystem,
    getAlliance: GetAllianceFn,
  ): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    const IDLE_STATES = new Set([WING_LIFECYCLE.IDLE, WING_LIFECYCLE.REFUEL]);
    for (const [wingId, wing] of state.air_wings.entries()) {
      const wingProvinceId = findProvinceAtPoint(wing.position_lng, wing.position_lat, this._pipEntries);
      const wingProvinceOwnerId = wingProvinceId ? state.provinces.get(wingProvinceId)?.owner_id : null;
      for (const [nationId] of state.nations) {
        if (wing.nation_id === nationId) { this._addToResult(result, nationId, wingId); continue; }
        if (getAlliance(wing.nation_id).has(nationId)) { this._addToResult(result, nationId, wingId); continue; }
        if (IDLE_STATES.has(wing.lifecycle_state as any)) continue;
        if (detection.getWingDetectedByNations(wingId).has(nationId)) { this._addToResult(result, nationId, wingId); continue; }
        if (wingProvinceOwnerId === nationId) { this._addToResult(result, nationId, wingId); continue; }
      }
    }
    return result;
  }

  private _addToResult(result: Map<string, Set<string>>, nationId: string, entityId: string): void {
    if (!result.has(nationId)) result.set(nationId, new Set());
    result.get(nationId)!.add(entityId);
  }

  private _sendToNation(
    nationId: string,
    type: string,
    msg: unknown,
    broadcastToClient: BroadcastToClientFn,
    getClientNation: (sessionId: string) => string | null,
    clients: Iterable<{ sessionId: string }>,
  ): void {
    for (const client of clients) {
      if (getClientNation(client.sessionId) === nationId) broadcastToClient(client.sessionId, type, msg);
    }
  }
}

function serializeDivision(div: any): Record<string, unknown> {
  // Read the existing division serialization in GameRoom.ts (lines 1540–1548)
  // and use the SAME fields. Do NOT invent a new schema.
  return { /* ... match existing serialization ... */ } as any;
}
```

> **Read the existing division serialization code in `GameRoom.ts`** (the loop at lines
> 1540–1548) to find the exact fields serialized for DIVISION_UPDATES. Use those same fields
> for DIVISION_APPEARED — the client expects the same shape.

---

## Step 5: Wire into `GameRoom.ts`

### 5a. Extract `broadcastToNation()` helper

Add private method before `gameTick()`:
```typescript
private broadcastToNation(type: string, msg: unknown, nationId: string): void {
  for (const c of this.clients) {
    const p = this.state.players.get(c.sessionId);
    if (!p) continue;
    const n = this.getNationForPlayer(p.userId);
    if (!n || n.nation_id !== nationId) continue;
    c.send(type, msg);
  }
}
```
Replace all 6 inline copies with `this.broadcastToNation(type, msg, nationId)`.
**Run full 12a–12h test suite after this change before proceeding.**

### 5b. Import and declare

```typescript
import { ServerVisibilitySystem } from "../systems/server_visibility_system.js";
import { loadProvincePIPData }    from "../utils/geo_utils.js";

// In class body (after existing system declarations):
private serverVisibilitySystem!: ServerVisibilitySystem;
```

### 5c. Initialize after `_initProvinces()`

```typescript
this._initProvinces(this.state.map_id);
// Add immediately after (same pattern as airStrategicBombingSystem):
this.serverVisibilitySystem = new ServerVisibilitySystem(
  loadProvincePIPData(this.state.map_id),
);
```

### 5d. Insert `ServerVisibilitySystem.tick()` after `airDetectionSystem.tick()`

```typescript
this.serverVisibilitySystem.tick(
  this.state,
  this.airDetectionSystem,
  (nationId) => this.getAllianceFor(nationId),
  (sessionId, type, msg) => {
    const client = this.clients.find(c => c.sessionId === sessionId);
    client?.send(type, msg);
  },
  (sessionId) => {
    const p = this.state.players.get(sessionId);
    if (!p) return null;
    return this.getNationForPlayer(p.userId)?.nation_id ?? null;
  },
  this.clients,
);
```

### 5e. Replace division broadcast with per-client filtered sends

After the existing `const toUpdate = new Set([...activeBefore, ...combatChanged, ...supplyChanged])`:
```typescript
// Replace: this.broadcast("DIVISION_UPDATES", { divisions: serialized })
// With:
for (const client of this.clients) {
  const p = this.state.players.get(client.sessionId);
  if (!p) continue;
  const nation = this.getNationForPlayer(p.userId);
  if (!nation) continue;
  const visibleUpdates = [...toUpdate]
    .filter(divId => this.serverVisibilitySystem.canNationSeeDivision(nation.nation_id, divId))
    .map(divId => /* same serialization as before */);
  if (visibleUpdates.length > 0) client.send("DIVISION_UPDATES", { divisions: visibleUpdates });
}
```

### 5f. Filter AIR_WING_UPDATES

Search `GameRoom.ts` for all `broadcast("AIR_WING_UPDATES"` calls. Replace each with:
```typescript
for (const client of this.clients) {
  const p = this.state.players.get(client.sessionId);
  if (!p) continue;
  const nation = this.getNationForPlayer(p.userId);
  if (!nation) continue;
  const visibleWings = (msg.wings as any[]).filter(
    w => this.serverVisibilitySystem.canNationSeeWing(nation.nation_id, w.wing_id)
  );
  if (visibleWings.length > 0) client.send("AIR_WING_UPDATES", { wings: visibleWings });
}
```

### 5g. New test-only handler

Inside `NODE_ENV === "test"` block:
```typescript
this.onMessage("SET_DIVISION_POSITION", (
  _client, msg: { division_id: string; lng: number; lat: number },
) => {
  const div = this.state.divisions.get(msg.division_id);
  if (div) { div.position_lng = msg.lng; div.position_lat = msg.lat; }
});
```

---

## Step 6: Update `package.json`

Append to the `test` script:
```
&& NODE_ENV=test mocha -r tsx test/12j-server-visibility-aoi.test.ts --exit --timeout 180000
```

**Run full suite — 12a through 12j must all pass:**
```bash
cd game-server && npm test
```

---

## Step 7: Client — EventBus Signals

In `event_bus.gd`, add after the last division signal:
```gdscript
signal division_appeared(division_id: String)
signal division_vanishing(division_id: String)
signal air_wing_vanishing(wing_id: String)
signal division_radar_ping(division_id: String)
```

---

## Step 8: Client — `session_manager.gd` Message Handlers

In the `match type:` block, after `AIR_WING_DESTROYED`:

```gdscript
"DIVISION_APPEARED":
    GameState._apply_division_appeared(data)
"DIVISION_VANISHED":
    EventBus.division_vanishing.emit(data.get("division_id", ""))
"AIR_WING_VANISHED":
    EventBus.air_wing_vanishing.emit(data.get("wing_id", ""))
```

---

## Step 9: Client — `game_state.gd`

Add `_apply_division_appeared()` (mirrors `_apply_divisions_spawned()` for a single dict):
```gdscript
func _apply_division_appeared(data: Dictionary) -> void:
    var div_id: String = data.get("division_id", "")
    if div_id.is_empty():
        return
    if divisions.has(div_id):
        for key: String in data:
            divisions[div_id][key] = data[key]
        EventBus.division_updated.emit(div_id)
        return
    divisions[div_id] = data.duplicate()
    EventBus.division_appeared.emit(div_id)
```

---

## Step 10: Animations — `division_icon.gd` and `air_wing_icon.gd`

Add to both files:

```gdscript
func reveal() -> void:
    modulate.a = 0.0
    scale = Vector2(0.8, 0.8)
    var tw := create_tween().set_parallel(true)
    tw.tween_property(self, "modulate:a", 1.0, 0.3).set_ease(Tween.EASE_OUT)
    tw.tween_property(self, "scale", Vector2.ONE, 0.3).set_ease(Tween.EASE_OUT)

func conceal() -> Signal:
    var tw := create_tween()
    tw.tween_property(self, "modulate:a", 0.0, 0.4)
    return tw.finished
```

---

## Step 11: `military_system.gd` — Division Appear / Vanish

### 11a. Connect new signals in `setup()`

```gdscript
EventBus.division_appeared.connect(_on_division_appeared)
EventBus.division_vanishing.connect(_on_division_vanishing)
EventBus.division_revealed.connect(_on_division_revealed_with_ping)
```
Disconnect in `cleanup()` / `_exit_tree()`.

### 11b. `_on_division_appeared()`

```gdscript
func _on_division_appeared(division_id: String) -> void:
    _on_division_added(division_id)
    var icon: Node2D = _icons.get(division_id) as Node2D
    if is_instance_valid(icon) and icon.has_method("reveal"):
        icon.reveal()
```

### 11c. `_on_division_vanishing()`

```gdscript
func _on_division_vanishing(division_id: String) -> void:
    var icon: Node2D = _icons.get(division_id) as Node2D
    if not is_instance_valid(icon) or not icon.has_method("conceal"):
        _do_division_removal(division_id)
        return
    var finished: Signal = icon.conceal()
    await finished
    _do_division_removal(division_id)

func _do_division_removal(division_id: String) -> void:
    GameState.divisions.erase(division_id)
    EventBus.division_removed.emit(division_id)
```

### 11d. Radar ping VFX

Rename existing `division_revealed` connection to `_on_division_revealed_with_ping`:

```gdscript
func _on_division_revealed_with_ping(division_id: String) -> void:
    _on_division_revealed(division_id)
    var icon: Node2D = _icons.get(division_id) as Node2D
    if is_instance_valid(icon):
        _spawn_radar_ping(icon.position)

func _spawn_radar_ping(pos: Vector2) -> void:
    var ring := Node2D.new()
    ring.position = pos
    _icon_layer.add_child(ring)
    ring.set_script(load("res://src/systems/military/detection_ring.gd"))
```

Create `client/src/systems/military/detection_ring.gd`:
```gdscript
extends Node2D
var _radius := 0.0
var _alpha  := 1.0

func _ready() -> void:
    var tw := create_tween().set_parallel(true)
    tw.tween_property(self, "_radius", 30.0, 0.6)
    tw.tween_property(self, "_alpha",  0.0,  0.6)
    tw.chain().tween_callback(queue_free)
    set_process(true)

func _process(_delta: float) -> void:
    queue_redraw()

func _draw() -> void:
    draw_arc(Vector2.ZERO, _radius, 0.0, TAU, 32, Color(0.2, 0.9, 1.0, _alpha), 2.0)
```

---

## Step 12: `air_wing_system.gd` — Wing Vanish + Reveal

### 12a. Connect new signal

```gdscript
EventBus.air_wing_vanishing.connect(_on_air_wing_vanishing)
```

### 12b. `_on_air_wing_vanishing()`

```gdscript
func _on_air_wing_vanishing(wing_id: String) -> void:
    var icon: Node2D = _icons.get(wing_id) as Node2D
    if not is_instance_valid(icon) or not icon.has_method("conceal"):
        _do_wing_removal(wing_id)
        return
    var finished: Signal = icon.conceal()
    await finished
    _do_wing_removal(wing_id)

func _do_wing_removal(wing_id: String) -> void:
    GameState.air_wings.erase(wing_id)
    EventBus.air_wing_removed.emit(wing_id)
```

### 12c. Reveal animation for newly detected enemy wings

In `_on_air_wing_added()`, after icon setup:
```gdscript
var is_enemy: bool = data.get("nation_id", "") != GameState.get_my_nation_id()
if is_enemy and icon.has_method("reveal"):
    icon.reveal()
```

---

## Step 13: Verification Checklist

**Server tests:**
```bash
cd game-server && npm test
```
All suites 12a–12j must pass.

**Client visual checks:**

1. **Own divisions always visible** — own units never flicker or disappear.
2. **Enemy division invisible at start** — no enemy icon visible when out of detection range.
3. **Division fog-emerge** — enemy division fades in with scale-up over ~0.3s when spotted.
4. **Division fade-out** — enemy division fades out over ~0.4s when leaving range, then disappears.
5. **Province ownership reveal** — enemy division inside own province is visible with no nearby units.
6. **Air wing invisible when idle** — enemy idle wing never appears to hostile clients.
7. **Air wing reveal** — enemy wing fades in when it takes off and enters detection range.
8. **Wing fade-out** — `AIR_WING_VANISHED` triggers conceal animation.
9. **Radar ping** — recon wing spotting produces brief cyan expanding ring (~0.6s).
10. **No cheating** — browser devtools WebSocket inspector shows no data for unseen entities.

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| `is_detected` tracks which specific nation detects a wing | **Wrong** — single bool ("any hostile nation"). Per-nation tracking added by Step 2. |
| `AirDetectionSystem` already has `getWingDetectedByNations` | **Wrong** — it only has `getVisibleDivisionsForNation`. Step 2 adds the wing equivalent. |
| `_pointInPolygon` can be imported from `movement_system` | **Wrong** — it's private. Extract to `geo_utils.ts`. |
| `_initProvinces` loads polygon data | **Wrong** — only loads `city_position`. Load polygons separately in `ServerVisibilitySystem`. |
| `getAllianceFor(nationId)` does NOT include `nationId` itself | **Wrong** — it DOES include self. |
| DIVISION_APPEARED needs a different payload shape than DIVISION_UPDATES | **Wrong** — same field set. Read existing serialization in GameRoom.ts. |
| `air_wing_added` signal is only for own wings | **Wrong** — fires for any new wing in GameState. Only animate reveal for enemy wings (Step 12c). |
| `AIR_WING_VANISHED` and `AIR_WING_DESTROYED` are the same | **Wrong** — DESTROYED = shot down (permanent). VANISHED = left visibility (temporary). |
| `_on_division_vanishing` can call `queue_free()` directly | **Wrong** — must `await icon.conceal()` first. |
| Province ownership check uses centroid distance | **Wrong** — use `findProvinceAtPoint()` (real PIP). |
| `broadcastToNation` helper refactor is risk-free | **Must verify** — run full 12a–12h suite after Step 5a. |
| IDLE/REFUEL wings should NOT be sent to allies | **Wrong** — allied nations always see them. Only hostile/neutral nations skip idle wings. |
| Detection ring needs a `.tscn` scene file | **Wrong** — plain GDScript, instantiate via `load("...").new()`. |
