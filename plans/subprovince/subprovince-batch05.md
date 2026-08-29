# Batch 5: Supply Graph and City Cascade

> **For agentic workers:** Implement this batch independently and stop at the manual verification
> gate. This batch builds the shared route-query primitive and city-capture cascade only. It does
> **not** implement the three-tier Out-of-Supply/Cut-Off/Encircled status system, retreat pathing,
> or true (ring-based) encirclement detection — those are Batch 8's job, over the same graph this
> batch builds. Do not wire `DivisionState.supply_status` transitions here. Do not add client
> rendering — that is Batch 7 (route visualization) and Batch 6 (subprovince fill), both later.

**Goal:** Give every division a queryable, deterministic supply route to the nearest reachable
friendly-or-allied hub over the subprovince adjacency graph — road-preferred, off-road-permitted at
continuously blended reduced throughput, with an enemy-occupied-cell exception restricted to the
occupying unit. Implement city-capture cascade so that when a capital-kind subprovince flips owner,
surviving former-defender-occupied cells and one preserved supply route survive the flip instead of
every remaining cell in the province flipping indiscriminately.

**Architecture:** `supply_graph.ts` is a new, stateless-per-call module: given a `SubprovinceGraph`
(loaded by Batch 4's `subprovince_loader.ts`) plus current ownership (`GameRoomState.subprovinces`)
plus a starting subprovince, it runs deterministic Dijkstra and returns a `SupplyRoute`. It has no
knowledge of divisions, ticks, or events — pure graph query, easy to unit test in isolation.
`supply_system.ts` (currently disabled per Batch 4/5 research — its `tick()` hard-returns before
reaching any old logic) gets a new exported method that calls `supply_graph.ts` once per division
per supply tick and pushes filtered route events, without touching or re-enabling the old
geometric `_corridorOpen`/`_isEncircled` code paths at all. City cascade lives in
`subprovince_system.ts` (Batch 4's file), hooked into `combat_system.ts`'s existing
`PROVINCE_CAPTURED` broadcast rather than duplicating province-capture detection.

**Tech Stack:** TypeScript, Colyseus.

## Scope

### Included

- Deterministic single-source Dijkstra over `SubprovinceGraph.neighbors`, cost-weighted by
  road/off-road and by ownership (friendly cheap, enemy-occupied-exception expensive-but-valid,
  everything else unreachable).
- Continuous throughput blending from the road/off-road hop mix along the selected route (see
  "Route Cost and Throughput Model" below — this replaces the earlier "binary off-road fallback"
  framing from `HANDOFF.md`'s open-questions table, resolved during this batch's planning).
- `SupplyRoute` computation, `open`/`degraded`/`cut_off` status (not `encircled` — see below).
- Enemy-occupied-cell exception: an enemy-owned cell may only appear in the *occupying unit's own*
  route, never in any other division's route search.
- City-capture cascade: preserve occupied former-defender cells and one valid supply route,
  otherwise flip the rest of the province's subprovinces.
- Route visibility filtering (own always, allied/foreign gated by `server_visibility_system.ts`).
- `game-server/test/subprovince-supply.test.ts`, `game-server/test/subprovince-city-cascade.test.ts`.

### Excluded

- The three-tier `OUT_OF_SUPPLY`/`CUT_OFF`/`ENCIRCLED` ring-based BFS checks from
  `STRATEGIC_COMBAT.md`'s "Supply and encirclement — three-tier status system" section — that
  section's pseudocode (`ring(n)`, checked at hop-distances 1-3) is Batch 8's "Replace old
  distance-based encirclement logic" work item, over this batch's graph. This batch's `SupplyRoute`
  is a route-quality object for one division, not the tier/debuff system.
- `DivisionState.supply_status` mutation — untouched in this batch.
- Retreat pathing — Batch 8, though it will reuse this batch's cost model (friendly cheap, contested
  medium, enemy/neutral expensive-but-traversable, per `STRATEGIC_COMBAT.md`'s retreat-pathing
  paragraph).
- Supply-line visual overlay — Batch 7.
- Re-enabling `supply_system.ts`'s old geometric `tick()` logic, or removing it — untouched, stays
  disabled exactly as found. Batch 8 removes it.

## Batch 4 Interface Freeze

Batch 4 (`plans/subprovince/subprovince-batch04.md`) may not be implemented yet when this batch
starts — confirm the actual state of these before writing code, and implement Batch 4 first if it's
still missing rather than reimplementing pieces of it inline here:

- `SubprovinceGraph.neighbors: Map<string, string[]>` — the adjacency this batch's Dijkstra walks.
- `state.subprovinces: MapSchema<SubprovinceState>` (`owner_id`, `province_id` per cell) — the
  ownership this batch's cost function reads.
- `SubprovinceSystem.getSubprovinceAtPosition(position) -> string | null` — used to resolve a
  division's starting node.
- **This batch depends on Batch 4's capital-cell exemption fix** (added during this batch's
  planning — capital-kind cells no longer flip via generic occupancy, only via cascade). If Batch 4
  was implemented before that fix landed, apply the fix first; city cascade in this batch is the
  *only* mechanism that should ever change a capital cell's owner, and that invariant breaks if
  Batch 4's generic capture path can also touch it.
- `SUBPROVINCE_CAPTURED` / `CaptureDelta` event shape from Batch 4 Task 3 step 7.

## Route Cost and Throughput Model

Resolved during this batch's planning (see conversation — supply flow is a continuous blend, not a
binary road/off-road fallback choice):

```
ROAD_THROUGHPUT     = 1.0     # config constant, tunable
OFF_ROAD_THROUGHPUT  = <config, e.g. 0.4-0.6>   # tunable, same spirit as COVER_MOVE/ELEVATION_MOVE

edge_cost(sp) = 1 / hop_throughput(sp)   # cheaper edges preferred by Dijkstra, same inversion
                                          # pattern already used for the generation-time cost
                                          # raster (1 / (cover_move * elevation_move))

hop_throughput(sp) =
    ROAD_THROUGHPUT      if sp.kind == "road"
    OFF_ROAD_THROUGHPUT  otherwise (hinterland/town; capital cells are hubs, not transit hops)

valid_edge(sp, requestingNationId) =
    FRIENDLY(sp)                                            # owner in {self, allies}
    or (sp.owner is enemy and sp is occupied by a division   # the enemy-occupied-cell exception,
        belonging to requestingNationId)                     # restricted to that exact requester
```

- `FRIENDLY(sp)` reuses the same ownership/alliance definition `STRATEGIC_COMBAT.md`'s three-tier
  section already defines — don't invent a second alliance check; call whatever helper
  `combat_system.ts`'s `_areNationsAtWar`/an alliance lookup already exposes.
- Dijkstra runs from the division's current subprovince to the nearest reachable hub (see "What
  counts as a hub" below), over `valid_edge`-passing nodes only.
- After the cheapest path is found, `throughputRatio` is computed as the hop-count-weighted blend
  along the *selected* path:
  ```
  throughputRatio = (roadHopCount * ROAD_THROUGHPUT + offRoadHopCount * OFF_ROAD_THROUGHPUT) / totalHops
  ```
  (excluding any enemy-occupied-exception hop from this average — flag that hop separately via
  `blockedSubprovinceId` instead, since it's not really "throughput," it's a single-unit special
  case; if the path includes one, set `blockedSubprovinceId` to its ID and still compute
  `throughputRatio` from the remaining friendly hops).
- **Status derivation** (this batch only produces three of the four documented values):
  - `"cut_off"` — no path exists at all under `valid_edge`.
  - `"open"` — path exists and `throughputRatio` is at or above a configurable threshold (all or
    nearly all road hops).
  - `"degraded"` — path exists but `throughputRatio` is below that threshold (meaningful off-road
    mileage).
  - `"encircled"` is a valid value in the shared `SupplyRoute` type (per `SUBPROVINCE_PHASES.md`)
    but this batch's code must never assign it — that requires the ring-based Tier 3 check Batch 8
    adds. Document this explicitly in `supply_graph.ts`'s module comment so nobody "completes" the
    enum by guessing at ring logic prematurely.

## What Counts as a Hub

Not explicitly defined anywhere in the maintained docs beyond "supply hub" and "supply hub
building" (`STRATEGIC_COMBAT.md:397,1193`) — no subprovince-graph-level definition exists yet. This
batch adopts the closest existing concept and flags it for confirmation rather than blocking on it:

**Assumption for this batch:** a subprovince is a supply hub if `kind == "capital"` and its
`province_id`'s province is owned by a friendly-or-allied nation. This reuses the same capital-cell
concept Batch 4 already threads through (province capitals), and matches the old
`supply_system.ts`'s now-disabled `ProvinceCity` concept (one city point per province, loaded from
`map_data.json`). Confirm this against whoever owns the "supply hub building" economy concept
referenced at `STRATEGIC_COMBAT.md:1193` before finalizing — if hubs are meant to be a distinct,
separately-placed/upgradable building rather than every owned capital automatically, that's a
bigger scope change this batch doesn't currently account for, and should come back as a plan
amendment rather than a silent assumption baked into shipped code.

## Task 1: Supply Graph Core

**Files:**

- Create: `game-server/src/systems/supply_graph.ts`
- Create: `game-server/test/subprovince-supply-graph.test.ts` (pure unit tests, no Colyseus room —
  this module takes plain data in, returns plain data out)

**Interface:**

```ts
type SupplyRoute = {
  divisionId: string;
  sourceHubId: string | null;
  subprovinceIds: string[];
  status: "open" | "degraded" | "cut_off" | "encircled";
  throughputRatio: number;
  blockedSubprovinceId: string | null;
};

function findSupplyRoute(
  graph: SubprovinceGraph,
  ownership: ReadonlyMap<string, { ownerId: string; provinceId: string }>,
  hubs: ReadonlySet<string>,
  startSubprovinceId: string,
  requestingNationId: string,
  isFriendly: (ownerId: string) => boolean,
  isOccupiedByRequester: (subprovinceId: string) => boolean,
  divisionId: string,
): SupplyRoute;
```

**Work:**

1. Implement deterministic multi-target Dijkstra (single source, multiple candidate hub targets —
   stop at the first hub reached, since costs are non-negative and Dijkstra pops in increasing cost
   order) using the cost model above.
2. **Deterministic tie-breaking** (explicitly required by `SUBPROVINCE_PHASES.md`): when two
   candidate paths have equal total cost, prefer the one with the lexicographically smaller sorted
   `subprovinceIds` list — never rely on Map/object iteration order or insertion order for this
   comparison, matching Batch 1's precedent for deterministic Dijkstra over the generation raster
   (`subprovince_raster.py`'s `split_patch_labels` seed-rank/row/column tie-break — same spirit,
   analogous but not identical mechanism since this is a graph, not a raster).
3. If `startSubprovinceId` itself is not a valid node, throw (caller error, not a route status).
4. If no path exists to any hub under `valid_edge`, return `status: "cut_off"`, `sourceHubId: null`,
   `subprovinceIds: [startSubprovinceId]`, `throughputRatio: 0`.
5. No caching, no mutation, no I/O in this module — pure function of its inputs, so it's trivially
   testable and reusable by Batch 8's retreat pathing later without dragging in room/tick state.

**Tests:**

- Road route wins over an equivalent-length off-road route (lower cost, selected preferentially).
- Off-road-only route is still valid and reachable, with `throughputRatio` reflecting the blend
  (not a hard binary open/degraded cutoff — verify a partially-off-road route lands strictly
  between full-road and full-off-road `throughputRatio` values).
- Enemy-owned occupied cell is traversable only when `isOccupiedByRequester` is true for that
  specific division's search; a second division's search over the identical graph must not use it.
- Enemy-owned unoccupied cell is never traversable regardless of requester.
- No path under `valid_edge` produces `status: "cut_off"`.
- Deterministic tie-break: construct a graph with two equal-cost paths, confirm the same route is
  returned across repeated calls and after reordering the input `neighbors` map's iteration order.
- Multiple candidate hubs: nearest reachable one wins, not necessarily the first in iteration order.
- `blockedSubprovinceId` is set only when the path actually used the enemy-occupied exception, and
  is `null` otherwise.

## Task 2: Supply System Integration

**Files:**

- Modify: `game-server/src/systems/supply_system.ts`
- Modify: `game-server/src/systems/subprovince_system.ts`

**Work:**

1. Add a new exported method to `SupplySystem` (name it distinctly from the disabled `tick()`, e.g.
   `computeSubprovinceRoutes(state) -> SupplyRoute[]`) that, for every living division
   (`combat_state !== "destroyed"`), resolves its subprovince via `SubprovinceSystem.getSubprovinceAtPosition`
   and calls `findSupplyRoute`.
2. Do not touch, call, or remove the existing disabled `tick()`/`_corridorOpen`/`_isEncircled`
   code — leave it exactly as-is, dead but present, for Batch 8 to remove.
3. `SubprovinceSystem` exposes the hub set (per "What Counts as a Hub" above) and the
   friendly/alliance check, since `SupplySystem` needs both to call `findSupplyRoute` — decide
   during implementation whether this lives as a small exported helper on `SubprovinceSystem` or a
   shared module both import; avoid duplicating the alliance-check logic that already exists in
   `combat_system.ts`.
4. This method is called from `GameRoom.gameTick()` (Task 4), not automatically inside
   `SupplySystem` itself, keeping the same injection-based-broadcast pattern as every other system.

## Task 3: City-Capture Cascade

**Files:**

- Modify: `game-server/src/systems/subprovince_system.ts`
- Modify: `game-server/src/systems/combat_system.ts` (hook point only — see below, not a rewrite of
  `_checkProvinceCapture`)

**Work:**

1. **Hook point**: when `combat_system.ts`'s `_checkProvinceCapture` is about to broadcast
   `PROVINCE_CAPTURED` (flipping `province.owner_id` from `oldOwner` to `newOwner`), call a new
   `SubprovinceSystem.cascadeCityCapture(provinceId, oldOwner, newOwner, state, broadcast)` right
   after the province flip, before returning from that tick's capture pass. Confirm the exact
   integration point against the current `_checkProvinceCapture` implementation at
   `combat_system.ts:~1115-1155` during implementation — this batch adds a call, it does not
   restructure that method.
2. **Identify surviving former-defender-occupied cells**: scan `state.divisions` for
   `nation_id === oldOwner && combat_state !== "destroyed"` whose resolved subprovince (via
   `getSubprovinceAtPosition`) is inside `provinceId`. Collect the set of subprovince IDs those
   divisions currently occupy — these are preserved, not flipped.
3. **Select one preserved supply route**: call `findSupplyRoute` from the province's capital
   subprovince (now owned by `newOwner`, since the province just flipped) — no wait, the route
   needs to be found *for the old owner* (a route the defender can still use to reach one of their
   *other* remaining hubs elsewhere on the map), starting from one of the preserved
   defender-occupied cells identified in step 2, with `requestingNationId = oldOwner` and
   `isFriendly` evaluated against `oldOwner`'s current ownership (post-flip, so the just-captured
   capital itself no longer counts as friendly for this search — the defender needs a route to a
   *different* hub they still own elsewhere). If multiple defender-occupied cells exist, try each
   (deterministically ordered — sort by subprovince ID) and take the first that finds an `"open"`
   or `"degraded"` route; if none do, no route is preserved.
4. **Apply the cascade**: for every subprovince in `provinceId` currently owned by `oldOwner` that
   is **not** in the preserved-occupied set from step 2 and **not** on the preserved route from step
   3, flip its `owner_id` to `newOwner`. Cells in either preserved set keep `owner_id = oldOwner`.
5. **No valid route case**: if step 3 finds nothing, per the Decisions section
   ("If no valid supply route exists, city capture preserves only occupied former-defender cells"),
   skip step 3's preservation entirely — only the step-2 occupied set survives.
6. **Events**: one `SUBPROVINCE_CAPTURED` per actually-flipped cell (reuse Batch 4's event
   plumbing/filtering exactly — this is not a new event type), plus, if useful for later debugging,
   a single informational log line summarizing the cascade (province, preserved-occupied count,
   preserved-route length or "none") — not a new broadcast type, just a server log.
7. **The capital cell itself**: flips to `newOwner` as part of `PROVINCE_CAPTURED`'s own effect
   (province ownership and its capital cell's ownership are the same fact — `owner_id` on the
   capital subprovince should simply be kept in sync with `province.owner_id` at this hook point,
   which is also the *only* place a capital cell's `owner_id` ever changes, per Batch 4's exemption
   fix).

**Tests** (`game-server/test/subprovince-city-cascade.test.ts`, same structural model as Batch 4's
`subprovince-capture.test.ts` — `boot`/`getTestPort`/`SPAWN_DIVISION`, `describe("lane:subprovince | ...")`):

- City cascade preserves occupied former-defender cells (spawn a surviving defender division inside
  a non-capital cell in the province, capture the capital, confirm that specific cell's owner is
  unchanged while others flip).
- City cascade preserves the selected supply route (defender divisions positioned so a valid route
  to another owned hub exists; confirm every cell on that route keeps `owner_id = oldOwner`).
- City cascade does not preserve unrelated cells (a cell neither occupied nor on the preserved
  route flips to `newOwner`).
- No-route case: remove the defender's other hubs/connectivity, confirm only occupied cells survive
  and nothing route-shaped is preserved.
- Capital cell's `owner_id` changes exactly once, synchronized with `province.owner_id`, never via
  Batch 4's generic occupancy path (spawn an attacking division standing directly inside the
  capital polygon *without* capturing the province — confirm the capital cell does not flip until
  `_checkProvinceCapture` itself fires).
- One `SUBPROVINCE_CAPTURED` event per actually-flipped cell, none for preserved cells.

## Task 4: GameRoom Wiring

**Files:**

- Modify: `game-server/src/rooms/GameRoom.ts`

**Work:**

1. In `gameTick()`, call `supplySystem.computeSubprovinceRoutes(state)` once per supply tick
   (reuse whatever tick-interval gating the old disabled system used, e.g. a `SUPPLY_TICK_INTERVAL`
   constant, rather than computing routes every single tick unconditionally).
2. Push route results as filtered per-client events (new event type, e.g. `"SUPPLY_ROUTE_UPDATE"`,
   payload = one division's `SupplyRoute`), following the exact three-branch filter pattern
   `broadcastFilteredDivisionUpdates`/`broadcastFilteredAirWingUpdates` already establish: own
   nation always receives it, allied always receives it, otherwise gated by
   `serverVisibilitySystem.canNationSeeDivision(nation, divisionId)`.
3. Do not add a `SupplyRoute`/route field to any Colyseus schema — event-only, per Batch 4's
   established precedent (`GameRoomState.ts`'s existing `// server-side only — not schema-synced`
   comments on `DivisionState.grid` and `provinceNeighbors` are the direct model to follow; routes
   are inherently per-recipient-filtered data, which schema sync cannot express in this codebase).
4. Confirm cascade's hook point (Task 3, step 1) actually fires within the same `gameTick()` pass as
   `_checkProvinceCapture`, not a separate tick — the province flip and its cascade must be atomic
   from an observer's perspective (no tick where the province shows a new owner but subprovinces
   still show the old one, or vice versa).

## Task 5: Route Visibility Filtering

**Files:**

- Modify: `game-server/src/systems/server_visibility_system.ts` only if it needs a new exposed
  method; otherwise this task is satisfied entirely by Task 4 reusing `canNationSeeDivision`
  directly and this file needs no change — confirm during implementation rather than adding an
  unnecessary wrapper.

**Work:**

1. Confirm `canNationSeeDivision` is sufficient as-is for gating whether a *foreign* division's
   route is visible (per `SUBPROVINCE_PHASES.md`: "Visible foreign routes are inspectable
   end-to-end while the unit remains visible").
2. Own-nation and allied routes bypass this check entirely (always sent), matching Task 4 step 2.

## Dependencies

No new dependencies. Reuses `SubprovinceGraph`/ownership from Batch 4, alliance/war-state helpers
from `combat_system.ts`, and the existing filtered-broadcast pattern from `GameRoom.ts`.

## Verification

```bash
cd game-server && npm test -- subprovince-supply-graph
cd game-server && npm test -- subprovince-supply
cd game-server && npm test -- subprovince-city-cascade
cd game-server && npm run build
cd game-server && npm run test:full
```

## Manual Verification Gate

Batch 5 is complete only after manual review confirms:

1. A road route is chosen over an equivalent off-road route in a live match; a fully off-road route
   is still accepted (division not falsely marked cut off) with a visibly lower throughput value.
2. An enemy-owned, occupied cell supplies only its occupying division — a second friendly division
   routed through the same area cannot use that cell.
3. Capture a city with enemy units still inside; confirm occupied enemy cells remain under the old
   owner, one supply route remains connected if one exists, and removing that route (e.g. by cutting
   the corridor) leaves only occupied cells preserved on a subsequent capture test.
4. Confirm the capital cell's ownership changes only at the moment `PROVINCE_CAPTURED` fires, never
   from simple occupancy.
5. Own routes remain visible through fog; a foreign unit's route disappears from other clients'
   received events once that unit leaves vision (spot-check against `canNationSeeDivision`'s
   existing behavior for the same division's other data).
6. `supply_system.ts`'s old disabled `tick()` path is confirmed untouched and still inert — no
   regression in whatever currently depends on `DivisionState.supply_status` staying wherever it
   currently sits.
7. Confirm the "what counts as a hub" assumption (capital-kind cells of friendly-or-allied-owned
   provinces) against whoever owns the supply-hub-building economy concept, per the flagged
   assumption above — resolve before sign-off, not after.

Do not begin Batch 6 (2D renderer) or Batch 8 (tier/retreat/encirclement migration) until this gate
is approved — Batch 8 in particular depends on this batch's cost model and route primitive being
stable.
