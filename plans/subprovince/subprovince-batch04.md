# Batch 4: Basic Server Capture

> **For agentic workers:** Implement this batch independently and stop at the manual verification
> gate. Do not implement supply, retreat, encirclement, or city-cascade logic here — that is
> Batch 5. Do not add client rendering — that is Batch 6. Client work in this batch is limited to
> receiving and storing capture events, nothing visual.

**Goal:** Give the server authoritative, occupancy-based ownership of every subprovince: initialize
from province ownership, flip on literal unit occupancy (including recon), stay flipped while the
capturing nation has a living unit anywhere in the province, revert in one pass when it leaves, and
freeze during active tactical combat. Sync ownership to clients and emit one event per changed cell.

**Architecture:** A new `SubprovinceSystem` owns all subprovince ownership state and capture logic,
mirroring `combat_system.ts`'s existing `_checkProvinceCapture` pattern (broadcast-callback
injection, invoked from `GameRoom.gameTick()` right after movement resolves). A new
`subprovince_loader.ts` wraps Batch 3's room-agnostic `loadSubprovinceGraph` (added to
`map_loader.ts`) with per-room caching and is the only place `GameRoom.ts` touches for loading.
Ownership state syncs to clients as a Colyseus `MapSchema`, same mechanism already used for
`provinces`/`divisions` — see "Sync Strategy" below for why, and what to verify at scale.

**Tech Stack:** TypeScript, Colyseus, GDScript (client event plumbing only, no rendering).

## Scope

### Included

- `SubprovinceSystem`: graph load, ownership init, occupancy capture, sticky ownership, one-pass
  revert, combat-freeze skip, `SUBPROVINCE_CAPTURED` events.
- `subprovince_loader.ts`: per-room graph loading, wrapping Batch 3's parser.
- `SubprovinceState` Colyseus schema and `GameRoomState.subprovinces` MapSchema.
- Belligerent/neutral event filtering.
- Minimal client plumbing: `EventBus` signal, `GameState` storage dict, `SessionManager` dispatch
  case. No renderer, no visual change.
- `game-server/test/subprovince-capture.test.ts`.

### Excluded

- Supply graph, route cost, throughput, city cascade (Batch 5).
- Retreat pathing, encirclement (Batch 8).
- Any `Polygon2D`/visual rendering, fade transitions, contested tint (Batch 6).
- Recon-exclusion special-casing — already resolved in `SUBPROVINCE_PHASES.md`'s Decisions/Global
  Constraints: "Any unit, including recon, can capture by literal polygon occupancy." Not a
  question for this batch.
- City-capture cascade behavior — that requires the supply graph (Batch 5) to pick a preserved
  route, so it's explicitly out of scope here even though `combat_system.ts` already has province
  capture. Batch 4's `checkCaptureAfterMovement` exempts capital-kind cells from its own generic
  flip (see Task 3, step 4) but does not itself flip them on province capture either — a capital
  cell's owner simply doesn't change in this batch. Batch 5 is what actually flips it, hooking into
  `combat_system.ts`'s existing `PROVINCE_CAPTURED` broadcast.

## Batch 3 Interface Freeze

Before implementation, confirm against the actual state of `game-server/src/data/map_loader.ts`
(Batch 3 may not be implemented yet — if `loadSubprovinceGraph` doesn't exist there when this batch
starts, implement it first, exactly as specified in `plans/subprovince/subprovince-batch03.md`
Task 2, rather than duplicating a second parser inside `subprovince_loader.ts`):

```ts
type SubprovinceDefinition = {
  id: string; provinceId: string;
  kind: "road" | "hinterland" | "town" | "capital";
  coverCombat: string | null; elevationType: string | null; isCapital: boolean;
  /** Outer ring(s): one ring for a simple Polygon, several for a MultiPolygon.
   *  Zero-area artifact cells carry an empty list and never match a query. */
  polygon: Array<Array<[number, number]>>;
};
type SubprovinceGraph = { nodes: Map<string, SubprovinceDefinition>; neighbors: Map<string, string[]> };
function loadSubprovinceGraph(mapId: string): SubprovinceGraph;
```

`subprovince_loader.ts` (this batch's file) is a thin room-lifecycle wrapper around this, not a
second parser: `loadSubprovinceGraphForRoom(mapId) -> SubprovinceGraph` that just calls
`loadSubprovinceGraph` (already cached at the file level by `map_cache.ts`, so no extra caching
logic needed here beyond a one-line re-export/wrapper for naming symmetry with the other
`load*ForRoom`-style calls already used in `GameRoom.startGame()`).

## Sync Strategy

Subprovince ownership syncs as a full Colyseus `MapSchema`, the same mechanism already used for
`provinces` and `divisions`. Reasoning, and what must be verified before sign-off:

- Colyseus's binary protocol diffs incrementally — per-tick network cost is proportional to how
  many subprovinces actually change owner that tick (a handful along an active front line), not
  the total map count, regardless of whether the map has hundreds or tens of thousands of cells.
- The one real cost this approach has is the **initial full-state send on room join** (every
  subprovince serialized once). Keep `SubprovinceState` schema fields minimal — `owner_id` and
  `province_id` only, no polygon geometry (`polygon` stays in the Batch 3 client-loaded static
  file, never duplicated into synced state, same as how province polygons are handled today).
- Do not add `subprovince_id` as a schema field — it's already the `MapSchema` key.
- **Manual verification gate requirement**: measure actual join payload size and steady-state
  patch size against a full-scale generated map (not just the single-province dev fixture) before
  approving this batch. If that measurement shows a real problem, that's a scoped follow-up, not
  something to solve preemptively here with a heavier event-sourced rewrite.

## Task 1: Subprovince Room Loader

**Files:**

- Create: `game-server/src/data/subprovince_loader.ts`

**Interface:**

```ts
function loadSubprovinceGraphForRoom(mapId: string): SubprovinceGraph;
```

**Work:**

1. Wrap Batch 3's `loadSubprovinceGraph` (from `map_loader.ts`).
2. Build a spatial index for point-in-polygon lookup at room-init time — reuse the bbox-accelerated
   pattern from `geo_utils.ts`'s `ProvincePIPEntry`/`loadProvincePIPData` (bbox pre-filter before
   exact `pointInPolygon`), since a linear scan over tens of thousands of polygons per division
   per tick is not acceptable. Return this alongside the graph (or expose a separate
   `buildSubprovinceSpatialIndex(graph)` function that `SubprovinceSystem` calls once and holds).
3. Propagate `loadSubprovinceGraph`'s "fail clearly" behavior — do not swallow errors here.

**Tests:** covered by Task 4's `subprovince-capture.test.ts` (loading is exercised as part of room
startup, no separate unit test file needed for a one-line wrapper — if the spatial index build
gets non-trivial, add a focused test for it here instead).

## Task 2: SubprovinceState Schema

**Files:**

- Modify: `game-server/src/rooms/schema/GameRoomState.ts`

**Work:**

1. Add:
   ```ts
   class SubprovinceState extends Schema {
     @type("string") province_id: string = "";
     @type("string") owner_id: string = "";
   }
   ```
2. Add `subprovinces = new MapSchema<SubprovinceState>();` to `GameRoomState`, alongside the
   existing `provinces`/`divisions` maps, keyed by `subprovince_id`.
3. Do not add polygon/geometry fields — see Sync Strategy above.

## Task 3: SubprovinceSystem

**Files:**

- Create: `game-server/src/systems/subprovince_system.ts`
- Modify: `game-server/src/systems/combat_system.ts` (only to expose whatever `combat_state`
  read access `isCombatFrozen` needs, if not already public — no change to existing capture logic)

**Interfaces** (from `SUBPROVINCE_PHASES.md`, this batch's implementation target):

```ts
class SubprovinceSystem {
  loadForRoom(mapId: string): void;
  initializeOwnership(state: GameRoomState): void;
  getSubprovinceAtPosition(position: { lng: number; lat: number }): string | null;
  checkCaptureAfterMovement(division: DivisionState, state: GameRoomState,
    broadcast: (sessionFilter: (nationId: string) => boolean, type: string, msg: unknown) => void
  ): CaptureDelta[];
  revertNationCaptureIfProvinceEmpty(nationId: string, provinceId: string,
    state: GameRoomState, broadcast: (...) => void
  ): CaptureDelta[];
  isCombatFrozen(subprovinceId: string): boolean;
}
type CaptureDelta = { subprovinceId: string; newOwner: string | null };
```

**Work:**

1. **Load and index** — call `loadSubprovinceGraphForRoom` and the spatial index build once, during
   `GameRoom.startGame()` (see Task 5), not in `onCreate()` (matches existing `loadWaypoints`/
   `loadMapData` timing).
2. **Initialize ownership** — for every subprovince, set `owner_id = provinces.get(province_id).owner_id`.
   Populate `state.subprovinces` schema map at the same time.
3. **Position resolution** — `getSubprovinceAtPosition` does a bbox-filtered point-in-polygon
   lookup against the spatial index from Task 1. Return `null` if the position falls in no known
   subprovince (log once per unmatched division per tick at most — this can legitimately happen at
   province edges/coordinate precision boundaries and must not throw or spam).
4. **Capture check** — `checkCaptureAfterMovement(division, ...)`:
   - Resolve the division's subprovince via `getSubprovinceAtPosition(division.position_lng, division.position_lat)`.
   - **Skip capital-kind cells entirely** (`subprovince.kind === "capital"` / `is_capital === true`).
     Per `docs/STRATEGIC_COMBAT.md`'s Subprovince Capture System section, capital cells are
     "exempt from the normal capture rule — changes owner only on city/province capture," i.e. they
     never flip via literal occupancy. They stay locked to `province.owner_id` until Batch 5's city
     cascade flips them as part of a `PROVINCE_CAPTURED` event. This is a correction to this batch's
     original scope, added after Batch 5 planning surfaced the conflict — without it, a capital
     cell would flip on simple occupancy exactly like a hinterland cell, contradicting the
     documented design and making Batch 5's cascade trigger ambiguous (a capital's owner could
     already have silently diverged from its province's owner before the cascade ever runs).
   - Skip if `null`, if `division.combat_state` is `"retreating"` or `"destroyed"` (same skip list
     already used by `_checkProvinceCapture` in `combat_system.ts:~1120` — confirm the exact
     `DivisionState.combat_state` enum values against the current schema before implementing, since
     research only directly observed `"retreating"`/`"destroyed"`; there is a further "currently in
     active tactical combat" state this batch depends on for step 6 below and its exact string
     value must be confirmed too), or if `isCombatFrozen(subprovinceId)`.
   - If `division.nation_id !== subprovince.owner_id`: flip `owner_id = division.nation_id`,
     record a `CaptureDelta`.
   - Called once per division per tick, right after `movementSystem.tick()` resolves positions —
     see Task 5 for exact tick placement.
5. **Sticky ownership + revert** — track, per `(province_id)`, the set of nation IDs that currently
   own at least one subprovince there but are not the province's own `owner_id` (this is the
   "attacker" set — maintain it incrementally as captures/reverts happen, don't rescan the whole
   map every tick). Each tick, for every `(attackerNationId, provinceId)` pair in that set, check
   whether the attacker still has a living division (`combat_state !== "destroyed"`) anywhere in
   the province (reuse `combat_system.ts`'s existing in-province check helper if one is exposed, or
   the same point-in-polygon-against-province-boundary approach `_checkProvinceCapture` already
   uses). If not, call `revertNationCaptureIfProvinceEmpty`: set every subprovince currently owned
   by that nation in that province back to `province.owner_id`, in one pass, recording one
   `CaptureDelta` per reverted cell, and remove the pair from the tracked attacker set.
6. **Combat freeze** — `isCombatFrozen(subprovinceId)` returns true if any division whose resolved
   subprovince is this one has `combat_state === "engaged"` or `"suppressed"` (confirmed against
   `DivisionState`'s schema comment: full enum is `"idle"|"engaged"|"suppressed"|"retreating"|"destroyed"`;
   `"engaged"`/`"suppressed"` are the active-tactical-combat states, already used as the skip
   condition elsewhere, e.g. `movement_system.ts:313`). Frozen cells keep their current `owner_id` in the schema — no `combat_frozen` field needed on
   `SubprovinceState`, this is purely a gate on step 4/5's writes, not a stored flag (Batch 6's
   renderer, when built, infers "contested" client-side by cross-referencing whichever mechanism
   the client already uses to know a division is in active combat, not from new schema state added
   here — flag this explicitly for Batch 6 rather than solving it now).
7. **Events** — for every `CaptureDelta`, call the injected broadcast with `"SUBPROVINCE_CAPTURED"`
   and `{ subprovince_id, province_id, new_owner_id, captured_by }`, filtered per recipient:
   - **Belligerents** (nations at war with either the old or new owner, using the existing
     `_areNationsAtWar(a, b, state.relations)` helper — reuse it, don't reimplement) receive the
     full per-cell event, following `GameRoom.ts`'s `broadcastFilteredAirWingUpdates` structural
     pattern (iterate clients, resolve nation, filter, `client.send`).
   - **Neutral nations** (not at war with either side) receive a coarser aggregated update instead
     of the raw cell event: batch all `CaptureDelta`s for a given `(province_id, tick)` into one
     `"PROVINCE_CONTEST_UPDATE"` message with `{ province_id, contested: boolean }` — no
     `subprovince_id`, no exact counts, just whether that province currently has any
     non-owner-controlled subprovinces this tick. This is a new, minimal event type scoped to this
     batch's neutral-filtering requirement; do not build a richer neutral payload than this without
     a design reason, since neutrals aren't supposed to see front-line detail at all.
   - The Colyseus schema (`state.subprovinces`) itself is visible to every connected client
     regardless of belligerent status, since it's not currently filtered per-client (same as
     `provinces`/`divisions` today) — the event filtering above only controls the *notification*,
     not the underlying synced state. If full ownership-map visibility to neutrals turns out to be
     undesired, that's a fog/visibility-system change out of scope for this batch (flag it, don't
     solve it here — `server_visibility_system.ts` doesn't currently filter `provinces` either, so
     this is consistent with existing behavior, not a regression).

## Task 4: Server Tests

**Files:**

- Create: `game-server/test/subprovince-capture.test.ts`

Model structurally on `game-server/test/12b-air-wing-lifecycle.test.ts`: `boot(appConfig,
getTestPort())`, `describe("lane:subprovince | Basic Server Capture", ...)`, `createRoom`/
`connectTo`, drive with direct `(room as any).gameTick()` calls, place divisions deterministically
via the existing test-only `SPAWN_DIVISION` message (`GameRoom.ts:~547`) so positions land inside
known subprovinces without relying on real pathfinding.

**Required cases** (from `SUBPROVINCE_PHASES.md`'s Batch 4 automated-verification list):

- Literal occupancy captures a cell (division spawned inside a subprovince polygon it doesn't own
  flips ownership after one tick).
- Capital-kind cells never flip via `checkCaptureAfterMovement`, even under otherwise-identical
  occupancy conditions that would flip a hinterland/road cell in the same tick.
- Radius-only presence does not capture (division positioned near but outside the polygon boundary
  leaves ownership unchanged).
- Recon captures (spawn a recon-type division inside enemy territory, confirm it flips ownership
  same as any other unit type).
- Sticky ownership works (captured cell stays owned by the attacker across multiple ticks while
  their division remains in the province, even if the division moves to a different subprovince
  within the same province).
- Complete revert works (attacker's division leaves the province or is destroyed; all of that
  attacker's captured cells in that province revert to the province owner in the same tick,
  verified in one `gameTick()` call, not gradually).
- Combat freeze works (a division with the active-combat `combat_state` value does not trigger a
  capture flip even though it occupies enemy territory; confirm the freeze lifts and capture
  proceeds once combat resolves).
- One `SUBPROVINCE_CAPTURED` event is emitted per changed cell, not batched into one event for
  multiple simultaneous captures.
- Neutral observers receive `PROVINCE_CONTEST_UPDATE`, not `SUBPROVINCE_CAPTURED`, and never see a
  `subprovince_id` in what they receive.
- Belligerent observers receive full-detail `SUBPROVINCE_CAPTURED` events.
- Initial ownership after `startGame()` matches each subprovince's province owner before any
  capture occurs.
- `getSubprovinceAtPosition` returns `null` (not a throw) for a position outside all known
  subprovinces.

**Verification:**

```bash
cd game-server && npm test -- subprovince-capture
cd game-server && npm run build
```

Then the full suite before considering the batch done:

```bash
cd game-server && npm run test:full
```

## Task 5: GameRoom Wiring

**Files:**

- Modify: `game-server/src/rooms/GameRoom.ts`

**Work:**

1. In `startGame()`, alongside the existing `loadWaypoints`/`loadMapData` calls
   (`GameRoom.ts:~1259-1265`), add `this.subprovinceSystem.loadForRoom(this.state.map_id)` followed
   by `this.subprovinceSystem.initializeOwnership(this.state)`.
2. In `gameTick()`, immediately after `this.movementSystem.tick(this.state)` and before (or
   interleaved with, if ordering the freeze-check against `combatSystem.tick()`'s own
   `combat_state` mutation requires it — verify actual write order against `combat_state` during
   implementation rather than assuming) `this.combatSystem.tick(...)`, call
   `checkCaptureAfterMovement` for every division, and `revertNationCaptureIfProvinceEmpty` for
   every tracked attacker/province pair, wiring both through the broadcast callback per Task 3.
3. Keep this entirely separate from `_checkProvinceCapture`'s existing province-level capture path
   — per Global Constraints, "Keep existing province capture behavior separate." Do not merge or
   replace province-level ownership logic; subprovince ownership initializes *from* province
   ownership but does not feed back into it in this batch (province capture still happens however
   it happens today).

## Task 6: Client Event Plumbing (No Rendering)

**Files:**

- Modify: `client/src/core/event_bus.gd`
- Modify: `client/src/core/game_state.gd`
- Modify: `client/src/systems/session/session_manager.gd`
- Modify: `client/src/net/net_manager.gd` only if inspection during implementation shows an actual
  gap in its type-agnostic dispatch (research found `net_manager.gd`'s `server_event_received`
  signal is already generic — confirm this still holds and skip this file if so, rather than
  making a change for the sake of matching the master file list).

**Work:**

1. `event_bus.gd`: add `signal subprovince_captured(subprovince_id: String, province_id: String, new_owner_id: String)`
   and `signal province_contest_updated(province_id: String, contested: bool)`, mirroring the
   existing `province_captured` signal (`event_bus.gd:8`).
2. `game_state.gd`: add a `subprovinces: Dictionary` store (new top-level dict, keyed by
   `subprovince_id`, values `{province_id, owner_id}`) and `_apply_subprovince_captured(data)` /
   `_apply_province_contest_updated(data)`, mirroring `_apply_province_captured`
   (`game_state.gd:176-186`) exactly — update the dict, emit the `EventBus` signal, nothing else.
3. `session_manager.gd`: add `"SUBPROVINCE_CAPTURED"` and `"PROVINCE_CONTEST_UPDATE"` cases to the
   existing `match type:` block (`session_manager.gd:~85`), dispatching to the new `GameState`
   methods.
4. Still need a way for the client to receive the **initial full ownership snapshot** on room join
   (Colyseus schema sync handles this automatically once `state.subprovinces` exists — confirm
   `NetManager`'s existing state-sync listener, whatever already populates `GameState.provinces`
   from `room.state.provinces` on join/patch, is generic enough to pick up the new
   `state.subprovinces` map the same way with zero additional code; if it's hardcoded per-map-name
   instead of iterating `room.state` generically, that's a pre-existing gap this batch needs to
   close, not a new one to work around).
5. No `Polygon2D`, no color, no fade — confirmed out of scope, Batch 6's job.

## Dependencies

No new dependencies. Reuses existing `geo_utils.ts` point-in-polygon primitives, existing Colyseus
schema/broadcast conventions, existing client event-dispatch pattern.

## Verification

```bash
cd game-server && npm test -- subprovince-capture
cd game-server && npm run build
cd game-server && npm run test:full
```

No Godot test is required for Task 6 alone (no scene/rendering change), but run the existing
generated-map test to confirm no regression from the `GameRoomState.ts`/`GameRoom.ts` changes
propagating unexpectedly into client-visible behavior:

```bash
godot --headless --path client client/test/test_generated_map_overlay_meshes.tscn
```

## Manual Verification Gate

Batch 4 is complete only after manual review confirms:

1. Move a unit across several subprovinces in a live multiplayer match; ownership flips on literal
   occupancy only, not proximity.
2. A recon unit explicitly tested and confirmed to capture the same as any other unit type.
3. Leaving a province reverts all of that nation's captured cells there in one visible pass, not
   gradually.
4. Starting tactical combat on an occupied enemy cell freezes its ownership until combat resolves.
5. Event timing: `SUBPROVINCE_CAPTURED` fires once per changed cell, observed directly in network
   traffic or server logs during a multi-cell capture event.
6. Neutral-observer client (a third nation not at war with either side) receives only
   `PROVINCE_CONTEST_UPDATE`, never a `subprovince_id`.
7. **Sync scale check**: connect a client to a room running a full-scale generated map (not the
   single-province dev fixture) and measure initial join payload size and steady-state per-tick
   patch size during active front-line movement. Record the numbers. If they indicate a real
   problem (define "problem" concretely before measuring — e.g. join payload noticeably increasing
   load time, or patch size causing observable tick-rate impact — rather than judging by feel),
   flag it as a follow-up batch rather than reworking sync strategy inside this one.
8. Existing province-level capture behavior (`_checkProvinceCapture`) is unaffected — run an
   existing province-capture scenario and confirm no behavior change.

Do not begin Batch 5 (supply graph, city cascade) until this gate is approved — Batch 5 depends on
this batch's ownership state and capture-delta events being correct and stable.
