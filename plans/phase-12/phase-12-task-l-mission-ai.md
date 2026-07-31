# Branch L — `feat/air-mission-ai`

## Context

Branch K-ui (`feat/air-client-ui`) shipped the UI for assigning missions to air wings, but
most missions have no real auto-targeting behind them. This branch adds a full tiered
auto-targeting and patrol system for every mission, per the design now recorded in
`wiki/docs/AIR_COMBAT.md`'s "Mission Auto-Targeting & Patrol Priority" section (read that
section before starting — it is the authoritative source for every tier order and constant
name used below; this plan is the execution detail behind it).

**Confirmed by codebase investigation, not assumption:**
- Only Interception/Air Superiority have any auto-search today, and it is a single
  "nearest visible hostile wing" rule with no type-priority, no patrol fallback, no
  crowd-balancing (`air_detection_system.ts:115-136`, quoted in full below).
- Tactical Bombing, Area/Industry/Oil/Logistics, all four naval missions, and Recon have
  **zero** auto-targeting — `target_id` is only ever set by a client message today.
- Escort auto-assignment is already fully correct (`air_wing_lifecycle_system.ts:264-309`)
  and matches `wiki/docs/AIR_COMBAT.md`'s Escort spread logic exactly. **Do not touch
  Escort in this branch** beyond what Step 2's `isAutoTargetedMission` rename requires
  (Escort must stay excluded from the new generic search).
- Real province-adjacency data (159 edges, 89 provinces) already exists in
  `client/assets/data/western_europe_6/map_data.json`'s `adjacency` array and is parsed
  then silently discarded by `GameRoom.ts:_initProvinces` (confirmed: the parse type at
  `GameRoom.ts:2203-2213` has no `adjacency` field at all).
- There is no naval flotilla schema anywhere in the codebase — naval combat only has
  `NavalContactMarkerState` (a per-nation fog-of-war contact blip: `marker_id, nation_id,
  quality, position_lng, position_lat, radius_deg, expires_at_ms, is_refreshable`), and
  `AirNavalBomberSystem` uses a `StubFlotillaProvider` that returns `[]`
  (`air_naval_bomber_system.ts:22-27`). **This means "friendly naval units" to patrol over
  (Interception/Air Superiority fallback tiers) do not exist as queryable state.** This
  plan's patrol fallback tiers therefore cover **land divisions only** — the naval half of
  those two fallback tiers is dropped for this branch as a hard scope cut forced by missing
  data, not an oversight. Flag this to the user if it wasn't already accepted; it is called
  out again in Common Misassumptions.
- `assignMission()` (`air_wing_lifecycle_system.ts:228-255`) currently forces
  IDLE/LOITER→TRANSIT **unconditionally**, even when `targetId === ""`. Combined with
  `_resolveTargetPosition("")` returning `null` (`GameRoom.ts:2236-2246`) and
  `GameRoom.ts:210-211` short-circuiting before computing any path, a wing assigned a
  mission with no target today gets stuck in TRANSIT with no path forever. This is a real
  pre-existing bug this branch must fix (Step 2), not new behavior to design around.

**Test-Driven Development is mandatory.** Write ALL failing tests before each step's
implementation.

---

## Critical Pre-Read

### `air_detection_system.ts` — the interception-pursuit block THIS BRANCH REPLACES

Lines 115–136, verbatim (this is deleted and replaced by the new
`AirMissionTargetingSystem` in Step 4 — do not leave both running, they will fight over
`wing.target_id`):

```typescript
    // ── Interception pursuit trigger ────────────────────────────────────────
    const INTERCEPTION_PURSUIT_RANGE_DEG = 2.0;
    for (const wing of airborneWings) {
      if (wing.lifecycle_state !== WING_LIFECYCLE.LOITER) continue;
      if (wing.mission !== MISSION_TYPES.INTERCEPTION && wing.mission !== MISSION_TYPES.AIR_SUPERIORITY) continue;

      let bestTarget: string | null = null;
      let bestDist = Infinity;
      for (const enemy of airborneWings) {
        if (!this._areNationsHostile(wing.nation_id, enemy.nation_id, state)) continue;
        if (!enemy.is_detected) continue;
        const dist = euclidDeg(wing.position_lng, wing.position_lat, enemy.position_lng, enemy.position_lat);
        if (dist < bestDist && dist <= INTERCEPTION_PURSUIT_RANGE_DEG) {
          bestDist = dist;
          bestTarget = enemy.wing_id;
        }
      }

      if (bestTarget) {
        lifecycleSystem.startInterceptionPursuit(wing.wing_id, bestTarget, state);
      }
    }
```

`airborneWings` (built at `air_detection_system.ts:79-86`) is a plain array of wing-like
objects (type `AirborneWingSnapshot`, NOT `AirWingState` schema instances — it's a
filtered snapshot), already scoped to `TRANSIT | ENGAGED | LOITER | RTB` lifecycle states.
The new system needs the *live* `AirWingState` objects (to read/write `target_id` etc.), so
it must build its own candidate list from `state.air_wings.values()` — do not try to reuse
`airborneWings` from this file.

`getWingDetectedByNations(wingId: string): Set<string>` (`air_detection_system.ts:65-67`)
and `getVisibleDivisionsForNation(nationId: string): Set<string>`
(`air_detection_system.ts:69-71`) are the two query methods the new system must use for
diplomacy-aware, per-nation visibility — both already exist and are already populated every
tick by `air_detection_system.ts`'s own `tick()`, which runs **before**
`airWingLifecycleSystem.tick()` in `GameRoom.ts`'s main loop (see ordering below). This is
exactly the reusable "visibility helper" the design doc refers to — no new detection
plumbing needed, only these two read-only queries.

### `air_wing_lifecycle_system.ts` — full relevant methods, verbatim

`assignMission()` — lines 228–255, **the exact bug to fix in Step 2**:

```typescript
  assignMission(wingId: string, mission: string, targetId: string, state: GameRoomState): boolean {
    const wing = state.air_wings.get(wingId);
    if (!wing) return false;
    if (wing.lifecycle_state === WING_LIFECYCLE.ENGAGED && mission !== MISSION_TYPES.IDLE) return false;

    wing.mission    = mission;
    wing.target_id  = targetId;

    if (mission === MISSION_TYPES.IDLE) {
      const ls = wing.lifecycle_state;
      if (ls === WING_LIFECYCLE.TRANSIT
       || ls === WING_LIFECYCLE.LOITER
       || ls === WING_LIFECYCLE.ENGAGED) {
        wing.lifecycle_state = WING_LIFECYCLE.RTB;
        this._engagementTicks.delete(wingId);
        this._loiterTicks.delete(wingId);
        this._pendingRedeployTarget.delete(wingId);
      }
      return true;
    }

    if (wing.lifecycle_state === WING_LIFECYCLE.IDLE
     || wing.lifecycle_state === WING_LIFECYCLE.LOITER) {
      wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;   // ← BUG: forces TRANSIT even if targetId === ""
      this._loiterTicks.delete(wingId);
    }
    return true;
  }
```

`tick()`'s LOITER case — lines 157–189, **the exact block to generalize in Step 2**:

```typescript
        case WING_LIFECYCLE.LOITER: {
          const isPatrolMission = wing.mission === MISSION_TYPES.INTERCEPTION
                                || wing.mission === MISSION_TYPES.AIR_SUPERIORITY;
          // Patrol wings re-sortie when a new interception target is assigned
          if (isPatrolMission && wing.target_id !== "") {
            wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
            this._loiterTicks.delete(wingId);
            didChange = true;
            break;
          }
          // Ground-attack specific loiter timeout (shorter than generic MAX_LOITER_TICKS)
          if (GROUND_ATTACK_MISSIONS.has(wing.mission)) {
            const gaCount = (_groundAttackLoiterCount.get(wingId) ?? 0) + 1;
            _groundAttackLoiterCount.set(wingId, gaCount);
            if (gaCount >= GROUND_ATTACK_LOITER_MAX_TICKS) {
              _groundAttackLoiterCount.delete(wingId);
              this.resolveWingBombed(wingId, state, broadcast);
              didChange = true;
              break;
            }
          }

          const ticks = (this._loiterTicks.get(wingId) ?? 0) + 1;
          this._loiterTicks.set(wingId, ticks);
          if (!isPatrolMission && ticks >= MAX_LOITER_TICKS) {
            this.applyLandingDecay(wingId, state);
            wing.lifecycle_state = WING_LIFECYCLE.RTB;
            this._loiterTicks.delete(wingId);
            broadcast("WING_RTB", { wing_id: wingId, nation_id: wing.nation_id, reason: "mission_complete" });
            didChange = true;
          }
          break;
        }
```

**`isPatrolMission` currently only covers Interception/Air Superiority.** Once the new
system starts setting `target_id` on a LOITERing Tactical Bombing/Strategic
Bombing/Naval/Recon wing (e.g. a wing patrolling a border that just found a real target),
this block must also relaunch those missions, or the newly-set `target_id` sits unused
until the wing separately times out via `GROUND_ATTACK_LOITER_MAX_TICKS` (only 2 of the 7
mission families) or `MAX_LOITER_TICKS` (15 ticks — a long, wrong delay for the rest).
Step 2 renames this to `isAutoTargetedMission` and widens the set to every mission this
branch adds search to (all of `MISSION_TYPES` except `IDLE` and `ESCORT`).

`startInterceptionPursuit()` — lines 319–328 (kept, still used by the new system's enemy-
wing tiers — do not delete):

```typescript
  startInterceptionPursuit(wingId: string, targetWingId: string, state: GameRoomState): void {
    const wing = state.air_wings.get(wingId);
    if (!wing) return;
    if (wing.lifecycle_state !== WING_LIFECYCLE.LOITER) return;
    if (wing.mission !== MISSION_TYPES.INTERCEPTION && wing.mission !== MISSION_TYPES.AIR_SUPERIORITY) return;

    this._loiterTicks.delete(wingId);
    wing.target_id = targetWingId;
    wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
  }
```

This method only handles the LOITER→TRANSIT transition + `target_id` write for the two
original missions. **It does not compute or store a path.** Confirmed by grep: no call to
`computeTransitPath`/`storePath` anywhere in `air_wing_lifecycle_system.ts`. This matters —
see the next section.

### How every other place in the codebase computes+stores a path — the pattern the new system MUST follow

There is no "the pathfinder notices `target_id` changed and recomputes automatically"
mechanism anywhere in this codebase. Every single call site that gives a wing a new
destination — `GameRoom.ts`'s `ASSIGN_WING_MISSION` handler (213–223), the RELOCATE-path
loop (1542–1551), the pending-transit loops (1570–1576, 1590–1596) — explicitly computes
and stores the path itself, in this exact shape:

```typescript
const startHeading = (Math.atan2(
  targetPos.lng - wing.position_lng,
  targetPos.lat - wing.position_lat,
) * 180 / Math.PI + 360) % 360;
const path = this.airDubinsPathfinder.computeTransitPath(
  { lng: wing.position_lng, lat: wing.position_lat },
  startHeading,   // or wing.heading_deg, both patterns appear — atan2-toward-target is used at RELOCATE/pending-transit sites, wing.heading_deg at ASSIGN_WING_MISSION
  targetPos,
  getAirUnitStats(wing.aircraft_type).min_turn_radius_deg,
);
this.airDubinsPathfinder.storePath(wing.wing_id, path);
wing.path_gen_id = path.path_gen_id;
wing.path_elapsed_ms = 0;
broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...path });
```

**The new `AirMissionTargetingSystem` must do this itself, explicitly, every time it commits
a new target for a wing.** Do not assume `air_dubins_pathfinder.tick()` will pick up a bare
`target_id` change on its own — nothing in the codebase does that for any mission other than
the one narrow `startInterceptionPursuit` LOITER→TRANSIT case, and even that case relies on
`GameRoom.ts:_assignRtbPaths`-style follow-up plumbing that this plan has not traced in
full. **Do not skip this — before writing Step 3, grep `air_dubins_pathfinder.ts`'s
`tick()` for any code that computes a path for a TRANSIT wing with no stored path, and
confirm whether `startInterceptionPursuit`-triggered wings currently get a path at all
in practice (write a quick throwaway test if unsure).** If such fallback logic exists, the
explicit compute-and-store below is merely redundant-but-safe; if it doesn't exist, the
explicit call is load-bearing. Either way, doing it explicitly is correct.

### `GameRoom.ts` — main tick ordering (lines 1477–1621, relevant excerpt)

```typescript
      this.airDetectionSystem.tick(this.state, this.airWingLifecycleSystem,
        (type, msg) => this.broadcast(type, msg),
        (type, msg, nationId) => this.broadcastToNation(type, msg, nationId));

      this.serverVisibilitySystem.tick(/* ... */);

      const wingBroadcast = (type: string, msg: any) => {
        if (type === "AIR_WING_UPDATES") this.broadcastFilteredAirWingUpdates(msg);
        else this.broadcast(type, msg);
      };
      this.airWingLifecycleSystem.tick(this.state, this.tickCount, wingBroadcast);

      this._assignRtbPaths(true);
      this.airDubinsPathfinder.tick(this.state, TICK_MS, this.airSpatialBucket,
        this.airWingLifecycleSystem, wingBroadcast);
      this.airCombatSystem.tick(this.state, this.airWingLifecycleSystem, wingBroadcast);
      this._assignRtbPaths(false);

      // RELOCATE path loop, pending-transit loops ...

      this.airBombingSystem.tick(/* ... */);
      this.airStrategicBombingSystem.tick(/* ... */);
      this.airNavalBomberSystem.tick(/* ... */);
```

**The new `airMissionTargetingSystem.tick()` call goes immediately after
`airDetectionSystem.tick()` and before `airWingLifecycleSystem.tick()`.** Reasoning: it
needs `airDetectionSystem`'s freshly-updated `getWingDetectedByNations`/
`getVisibleDivisionsForNation` (populated by the call just before it), and it needs to run
before `airWingLifecycleSystem.tick()`'s LOITER-case relaunch logic so a newly-committed
`target_id` is visible to that same tick's state-machine pass (matching the deleted
interception-pursuit block's original position — it ran inside `airDetectionSystem.tick()`,
i.e. before the lifecycle tick, same slot).

`_resolveTargetPosition()` (`GameRoom.ts:2236-2246`) is `private` on `GameRoom`, not
exported. The new system lives in `systems/`, so `GameRoom.ts` must pass a bound resolver
function into the new system's `tick()` call: `this._resolveTargetPosition.bind(this)`.
Do not duplicate this method's logic inside the new file — province city-position data
(`_provinceCityPositionLookup`) is a `GameRoom`-private field with no schema equivalent, so
there is no way to resolve a province position from inside `systems/` without this callback.

### `ProvinceState` has no position field — reuse the existing lookup, don't add one

Confirmed: `ProvinceState` (`GameRoomState.ts:35-43`) has `province_id, owner_id, industry,
population, infrastructure, oil_bombed_until_ms, naval_base_level` — no lng/lat. City
position lives only in `GameRoom.ts`'s private `_provinceCityPositionLookup: Map<string,
{lng,lat}>`, populated once in `_initProvinces()`. This is why Step 4 passes
`_resolveTargetPosition` as a callback rather than trying to read province positions
directly from `state.provinces` inside the new system.

### `map_data.json` adjacency shape (verbatim, one entry)

```json
{
  "from_province": "we6_united_kingdom_01",
  "to_province": "we6_united_kingdom_04",
  "border_type": "coast",
  "road_id": "road_0045",
  "road_level": 3,
  "passable_by": ["infantry", "armor", "motorized", "artillery"]
}
```

Adjacency is undirected in intent (a border between two provinces) but each edge is stored
once, not twice — the neighbor map must add both directions when building the lookup (see
Step 1).

### Relation stance — exact strings and lookup key format

`RelationState.stance` (`GameRoomState.ts:76-80`) is one of the literal strings `"war"`,
`"neutral"`, `"alliance"` (confirmed by grep — no other values exist anywhere).
`state.relations` is a `MapSchema<RelationState>` keyed `` `${nationA}|${nationB}` `` (pipe,
not colon — colon-joined keys only appear in `broadcastRelations()`'s outbound payload, a
different, unrelated format). Every system file that needs stance reads it directly,
inline, exactly like this (`air_detection_system.ts:247-251`):

```typescript
private _areNationsHostile(nationA: string, nationB: string, state: GameRoomState): boolean {
  if (nationA === nationB) return false;
  const rel = state.relations.get(`${nationA}|${nationB}`) ?? state.relations.get(`${nationB}|${nationA}`);
  return (rel?.stance ?? "neutral") === "war";
}
```

The new system must use this same direct-read pattern (`state.relations.get(...)` with both
key orders), not a `GameRoom`-private helper — `getRelationStance`/`getRelationKey`
(`GameRoom.ts:2048-2081`) are `private` methods on `GameRoom` and are NOT passed to systems
anywhere in the existing codebase; every system re-implements the same two-line lookup
inline instead. Follow that precedent — do not add a new callback parameter for this one.

### Division and wing fields needed for scoring/patrol

`DivisionState` (`GameRoomState.ts:47-72`) relevant fields: `division_id, nation_id,
division_type, position_lng, position_lat`. `AirWingState` (`AirWingState.ts:58-122`)
relevant fields: `wing_id, nation_id, aircraft_type, mission, target_id, lifecycle_state,
position_lng, position_lat, heading_deg`. `MISSION_TYPES` and `WING_LIFECYCLE` are both
exported from `AirWingState.ts` (lines 19–47) — import from there, not redefine.

### Aircraft-type groupings needed for tier filters (verbatim from `AIR_UNIT_TYPES`, `AirWingState.ts:5-14`)

```typescript
export const AIR_UNIT_TYPES = {
  CAS_PLANE: "cas_plane", DIVE_BOMBER: "dive_bomber", FIGHTER: "fighter",
  NAVAL_BOMBER: "naval_bomber", HEAVY_FIGHTER: "heavy_fighter",
  STRATEGIC_BOMBER: "strategic_bomber", TACTICAL_BOMBER: "tactical_bomber",
  RECON_PLANE: "recon_plane",
} as const;
```

Groupings used repeatedly below (define as module-level `Set`s in the new file):
- `BOMBER_TYPES = {strategic_bomber, tactical_bomber}` (Interception tier 1 / Air
  Superiority tier 3)
- `LOW_ALT_BOMBER_TYPES = {cas_plane, dive_bomber}` (Interception tier 2 / Air Superiority
  tier 2)
- `FIGHTER_TYPES = {fighter, heavy_fighter}` (Air Superiority tier 1)

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/src/systems/air_mission_targeting.ts` | New tiered auto-targeting/patrol system (Steps 3) |
| `game-server/test/12l-mission-targeting-air.test.ts` | Interception + Air Superiority tier chain tests |
| `game-server/test/12l-mission-targeting-ground.test.ts` | Tactical Bombing + Strategic Bombing tier chain tests |
| `game-server/test/12l-mission-targeting-recon-naval.test.ts` | Recon + Naval tier chain tests |
| `game-server/test/12l-border-adjacency.test.ts` | Province neighbor parsing + border-stance helper tests |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/schema/GameRoomState.ts` | Add non-schema `provinceNeighbors: Map<string, string[]>` field on `GameRoomState`, mirroring `DivisionState.grid`'s existing "server-side only — not schema-synced" pattern |
| `game-server/src/rooms/GameRoom.ts` | Parse `adjacency` in `_initProvinces`; instantiate + call new system in main tick loop; pass `_resolveTargetPosition` callback |
| `game-server/src/systems/air_wing_lifecycle_system.ts` | Fix `assignMission()` empty-target bug; rename/widen `isPatrolMission`→`isAutoTargetedMission`; add `resetLoiterTicks()` passthrough |
| `game-server/src/systems/air_detection_system.ts` | Delete the interception-pursuit block (lines 115–136) — replaced by the new system |
| `game-server/test-lanes.json` | Add the 4 new test files to the `air-combat` lane's `tests` array |

---

## Step 1: Province Neighbor Data

### 1a. Write failing tests

Create `game-server/test/12l-border-adjacency.test.ts`:

```typescript
import assert from "assert";
import { describe, it } from "mocha";
import { buildProvinceNeighbors, isBorderingStance } from "../src/systems/air_mission_targeting.js";
import { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { RelationState } from "../src/rooms/schema/GameRoomState.js";
import { ProvinceState } from "../src/rooms/schema/GameRoomState.js";

describe("lane:air-combat | Province neighbor graph", () => {
  it("builds an undirected neighbor map from one-directional adjacency edges", () => {
    const neighbors = buildProvinceNeighbors([
      { from_province: "a", to_province: "b" },
      { from_province: "b", to_province: "c" },
    ]);
    assert.deepStrictEqual([...neighbors.get("a")!].sort(), ["b"]);
    assert.deepStrictEqual([...neighbors.get("b")!].sort(), ["a", "c"]);
    assert.deepStrictEqual([...neighbors.get("c")!].sort(), ["b"]);
  });

  it("isBorderingStance is true when a neighbor province is owned by a war-stance nation", () => {
    const state = new GameRoomState();
    const a = new ProvinceState(); a.province_id = "a"; a.owner_id = "france";
    const b = new ProvinceState(); b.province_id = "b"; b.owner_id = "germany";
    state.provinces.set("a", a);
    state.provinces.set("b", b);
    const rel = new RelationState(); rel.from_id = "france"; rel.to_id = "germany"; rel.stance = "war";
    state.relations.set("france|germany", rel);
    const neighbors = buildProvinceNeighbors([{ from_province: "a", to_province: "b" }]);

    assert.strictEqual(isBorderingStance("a", "france", "war", state, neighbors), true);
    assert.strictEqual(isBorderingStance("a", "france", "neutral", state, neighbors), false);
  });

  it("isBorderingStance evaluates from the searching nation, not the province owner — allied airbase case", () => {
    // Province "a" is owned by an ALLY of "britain", not by britain itself.
    // "a" borders "b" (germany, at war with britain). This must still count as a
    // war-border for a British wing based at "a".
    const state = new GameRoomState();
    const a = new ProvinceState(); a.province_id = "a"; a.owner_id = "france";
    const b = new ProvinceState(); b.province_id = "b"; b.owner_id = "germany";
    state.provinces.set("a", a);
    state.provinces.set("b", b);
    const relBritainGermany = new RelationState();
    relBritainGermany.from_id = "britain"; relBritainGermany.to_id = "germany"; relBritainGermany.stance = "war";
    state.relations.set("britain|germany", relBritainGermany);
    const neighbors = buildProvinceNeighbors([{ from_province: "a", to_province: "b" }]);

    assert.strictEqual(isBorderingStance("a", "britain", "war", state, neighbors), true);
  });

  it("returns false for a province with no neighbors in the map", () => {
    const state = new GameRoomState();
    const neighbors = buildProvinceNeighbors([]);
    assert.strictEqual(isBorderingStance("isolated", "france", "war", state, neighbors), false);
  });
});
```

Run — must FAIL (module doesn't exist yet).

### 1b. Add non-schema field to `GameRoomState`

In `game-server/src/rooms/schema/GameRoomState.ts`, inside the `GameRoomState` class
(after the existing `@type` fields, following the exact precedent of `DivisionState.grid`
at line 71 — a plain class field with no `@type` decorator, commented as server-only):

```typescript
  // Province-to-province adjacency, parsed once from map_data.json at room init.
  // Server-side only — not schema-synced, mirrors DivisionState.grid's pattern above.
  provinceNeighbors: Map<string, string[]> = new Map();
```

### 1c. Create `game-server/src/systems/air_mission_targeting.ts` — Part 1 (border adjacency)

Start the new file with:

```typescript
import { GameRoomState } from "../rooms/schema/GameRoomState.js";

export function buildProvinceNeighbors(
  adjacency: Array<{ from_province: string; to_province: string }>,
): Map<string, string[]> {
  const neighbors = new Map<string, string[]>();
  const addEdge = (a: string, b: string): void => {
    if (!neighbors.has(a)) neighbors.set(a, []);
    neighbors.get(a)!.push(b);
  };
  for (const edge of adjacency) {
    addEdge(edge.from_province, edge.to_province);
    addEdge(edge.to_province, edge.from_province);
  }
  return neighbors;
}

function getRelationStance(nationA: string, nationB: string, state: GameRoomState): string {
  if (nationA === nationB) return "alliance";
  const rel = state.relations.get(`${nationA}|${nationB}`) ?? state.relations.get(`${nationB}|${nationA}`);
  return rel?.stance ?? "neutral";
}

/**
 * True if province `provinceId` has at least one neighbor province owned by a nation
 * whose relation to `viewerNationId` is `stance`. Evaluated from the viewer's own nation,
 * not the province's owner — a wing based at an allied airbase correctly sees "my ally
 * borders the enemy" as a valid war-border.
 */
export function isBorderingStance(
  provinceId: string,
  viewerNationId: string,
  stance: "war" | "neutral",
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
): boolean {
  const neighborIds = provinceNeighbors.get(provinceId);
  if (!neighborIds) return false;
  for (const neighborId of neighborIds) {
    const neighbor = state.provinces.get(neighborId);
    if (!neighbor || !neighbor.owner_id) continue;
    if (getRelationStance(viewerNationId, neighbor.owner_id, state) === stance) return true;
  }
  return false;
}
```

Run the 1a tests — must PASS.

### 1d. Wire adjacency parsing into `_initProvinces`

In `game-server/src/rooms/GameRoom.ts`, extend the parse type and loop in `_initProvinces()`
(lines 2199–2234). Current type (lines 2203–2213) has no `adjacency` field — add one, and
add the parse call after the existing `provinces` loop:

```typescript
      const raw = getCachedFile<{
        provinces: Array<{ /* ...unchanged... */ }>;
        adjacency?: Array<{ from_province: string; to_province: string }>;
      }>(dataPath);
      for (const p of raw.provinces ?? []) {
        // ...unchanged...
      }
      this.state.provinceNeighbors = buildProvinceNeighbors(raw.adjacency ?? []);
      console.log(`[GameRoom] initialized ${this.state.provinces.size} provinces`);
```

Add the import at the top of `GameRoom.ts`:
```typescript
import { buildProvinceNeighbors } from "../systems/air_mission_targeting.js";
```

### Notes for execution agent (Step 1)

- `buildProvinceNeighbors` is a pure function with no `state` dependency — safe to call
  once at init and store the result on `state.provinceNeighbors` for the lifetime of the
  room.
- Do not add `@type` to `provinceNeighbors` — it's server-only, exactly like
  `DivisionState.grid`. Adding `@type` would attempt to sync a `Map<string,string[]>`
  through Colyseus schema, which is not a supported schema shape and will break.

---

## Step 2: Fix `assignMission` Empty-Target Bug + Widen LOITER Relaunch

### 2a. Write failing tests

Add to `game-server/test/12b-air-wing-lifecycle.test.ts` (existing Branch B test file —
this is a fix to existing lifecycle behavior, not new-file territory):

```typescript
describe("lane:air-combat | assignMission with empty target_id", () => {
  it("does NOT force TRANSIT when targetId is empty — wing stays IDLE for auto-search to pick up", async () => {
    // Spawn an IDLE wing, assignMission(wingId, "tactical_bombing", "", state)
    // Assert wing.lifecycle_state remains WING_LIFECYCLE.IDLE (not TRANSIT)
    // Assert wing.mission === "tactical_bombing" (mission still recorded)
  });

  it("DOES transition IDLE to TRANSIT when targetId is non-empty (unchanged existing behavior)", async () => {
    // Spawn an IDLE wing, assignMission(wingId, "tactical_bombing", "some_division_id", state)
    // Assert wing.lifecycle_state === WING_LIFECYCLE.TRANSIT
  });

  it("LOITER wing with a non-air-superiority/interception mission relaunches to TRANSIT when target_id is set externally", async () => {
    // Spawn a wing in LOITER with mission "tactical_bombing", target_id ""
    // Manually set wing.target_id = "some_id" (simulating the new targeting system's commit)
    // Tick the lifecycle system once
    // Assert wing.lifecycle_state === WING_LIFECYCLE.TRANSIT
  });
});
```

Run — must FAIL.

### 2b. Fix `assignMission()`

In `game-server/src/systems/air_wing_lifecycle_system.ts`, change lines 249–253:

```typescript
// BEFORE:
    if (wing.lifecycle_state === WING_LIFECYCLE.IDLE
     || wing.lifecycle_state === WING_LIFECYCLE.LOITER) {
      wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      this._loiterTicks.delete(wingId);
    }
    return true;

// AFTER:
    if (targetId !== "" && (wing.lifecycle_state === WING_LIFECYCLE.IDLE
     || wing.lifecycle_state === WING_LIFECYCLE.LOITER)) {
      wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
      this._loiterTicks.delete(wingId);
    }
    return true;
```

A wing assigned a mission with `targetId === ""` now stays in its current lifecycle state
(IDLE, most commonly) with `wing.mission` recorded. The new `AirMissionTargetingSystem`
(Step 3) picks it up on the very next tick, finds a target, and explicitly transitions it
to TRANSIT with a computed path — the same explicit-compute-and-store pattern documented in
the Critical Pre-Read.

**Also update `GameRoom.ts`'s `ASSIGN_WING_MISSION` handler** — after this fix, calling
`computeTransitPath`/`storePath` at lines 213–223 when `targetPos` resolves from an empty
`target_id` is already guarded by the existing `if (!targetPos || !updated) return;` at
line 211, since `_resolveTargetPosition("")` still returns `null`. **No change needed
there** — confirm this by re-reading lines 210–223 before assuming otherwise; the guard
already exists and now correctly does nothing when a player assigns a mission with no
target, leaving the wing IDLE for auto-search to pick up.

### 2c. Widen `isPatrolMission` → `isAutoTargetedMission`

In `game-server/src/systems/air_wing_lifecycle_system.ts`, add near the top-level constants
(after `GROUND_ATTACK_MISSIONS` at line 46):

```typescript
const AUTO_TARGETED_MISSIONS = new Set([
  MISSION_TYPES.INTERCEPTION,
  MISSION_TYPES.AIR_SUPERIORITY,
  MISSION_TYPES.TACTICAL_BOMBING,
  MISSION_TYPES.AREA,
  MISSION_TYPES.INDUSTRY,
  MISSION_TYPES.OIL,
  MISSION_TYPES.LOGISTICS,
  MISSION_TYPES.RECON,
  MISSION_TYPES.TRADE_INTERDICTION,
  MISSION_TYPES.ANTI_SUBMARINE,
  MISSION_TYPES.ANTI_SHIP,
  MISSION_TYPES.PORT_STRIKE,
]);
```

This is every `MISSION_TYPES` value except `IDLE` and `ESCORT` — confirm against the
verbatim `MISSION_TYPES` list in the Critical Pre-Read before typing this out, do not
guess the member names.

In `tick()`'s LOITER case (lines 157–166), replace:

```typescript
// BEFORE:
          const isPatrolMission = wing.mission === MISSION_TYPES.INTERCEPTION
                                || wing.mission === MISSION_TYPES.AIR_SUPERIORITY;
          // Patrol wings re-sortie when a new interception target is assigned
          if (isPatrolMission && wing.target_id !== "") {

// AFTER:
          const isPatrolMission = AUTO_TARGETED_MISSIONS.has(wing.mission);
          // Auto-targeted wings re-sortie when the targeting system commits a new target
          if (isPatrolMission && wing.target_id !== "") {
```

(Every other reference to the local variable `isPatrolMission` later in the same case block
— lines 181 — is unchanged; only its definition and the one comment above it change.)

**Do not rename the variable itself** (`isPatrolMission`) unless you also update every use
in the same function — the simplest correct diff is exactly the two-line replacement above,
keeping the variable name to minimize the diff surface. The constant is named
`AUTO_TARGETED_MISSIONS` for clarity at its definition site; the local variable can keep
its existing name.

### 2d. Add `resetLoiterTicks` passthrough

The new targeting system (Step 3) needs to clear a wing's loiter-tick counter when it
force-relaunches a wing out of LOITER, exactly like `startInterceptionPursuit` already does
internally (`this._loiterTicks.delete(wingId)` at line 325). `_loiterTicks` is `private` —
add a public passthrough in `air_wing_lifecycle_system.ts`, near `getEngagementTarget()`
(line 450):

```typescript
  resetLoiterTicks(wingId: string): void {
    this._loiterTicks.delete(wingId);
  }
```

### 2e. Run full existing lifecycle + escort suites

```bash
cd game-server && npx mocha -r tsx test/12b-air-wing-lifecycle.test.ts test/12k-escort-auto-assign.test.ts --exit --timeout 180000
```

Must still pass unchanged — this step must not break existing escort or lifecycle
behavior. If any existing test relied on the old unconditional TRANSIT-on-assign behavior
with an empty target, that test encoded the bug and must be corrected, not preserved.

---

## Step 3: The New Targeting System — Shared Scoring + Candidate Helpers

### 3a. Write failing tests (shared scoring behavior)

Add to `game-server/test/12l-mission-targeting-air.test.ts`:

```typescript
import assert from "assert";
import { describe, it } from "mocha";
import { scoreCandidate, buildClaimsRegistry } from "../src/systems/air_mission_targeting.js";
import { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { AirWingState, MISSION_TYPES } from "../src/rooms/schema/AirWingState.js";

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
```

Run — must FAIL.

### 3b. Implement shared scoring + claims registry

Append to `game-server/src/systems/air_mission_targeting.ts`:

```typescript
const CROWD_WEIGHT = 0.15;   // placeholder — playtesting-tunable, see AIR_COMBAT.md Open Questions

function euclidDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  return Math.sqrt((lng1 - lng2) ** 2 + (lat1 - lat2) ** 2);
}

export function scoreCandidate(distDeg: number, claimCount: number): number {
  const distanceFalloff = 1 / (1 + distDeg);
  return distanceFalloff - CROWD_WEIGHT * claimCount;
}

/** Counts live wings currently assigned (by mission+target_id) to each target_id. */
export function buildClaimsRegistry(state: GameRoomState): Map<string, number> {
  const claims = new Map<string, number>();
  for (const wing of state.air_wings.values()) {
    if (!wing.target_id) continue;
    claims.set(wing.target_id, (claims.get(wing.target_id) ?? 0) + 1);
  }
  return claims;
}

/** Picks the highest-scoring candidate id from a list of {id, lng, lat}. Ties broken by id string. */
function pickBest<T extends { id: string; lng: number; lat: number }>(
  candidates: T[],
  fromLng: number,
  fromLat: number,
  claims: Map<string, number>,
): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const dist = euclidDeg(fromLng, fromLat, c.lng, c.lat);
    const score = scoreCandidate(dist, claims.get(c.id) ?? 0);
    if (score > bestScore || (score === bestScore && (!best || c.id < best.id))) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
```

`buildClaimsRegistry` keys by raw `target_id` across all id namespaces (wing/division/
province ids). This is safe only because none of those id spaces collide in this codebase
today — see Common Misassumptions for why this is a deliberate simplification, not an
oversight.

Run the 3a tests — must PASS.

---

## Step 4: Per-Mission Tier Chains

This is the bulk of the new file. Each mission gets a function
`resolveXTargets(wing, state, provinceNeighbors, detectionSystem): {tier: number, targetId: string} | null`
called from the main `tick()` loop (Step 5). Lower `tier` number = higher priority (tier 1
beats tier 2). Returning `null` means "nothing found at any tier — leave the wing where it
is" (the final "stay at base" fallback needs no explicit tier — a wing with nothing found
and no existing target simply stays IDLE, per `assignMission`'s Step 2 fix).

### 4a. Shared candidate-gathering helpers

```typescript
function isHostile(nationA: string, nationB: string, state: GameRoomState): boolean {
  if (nationA === nationB) return false;
  const rel = state.relations.get(`${nationA}|${nationB}`) ?? state.relations.get(`${nationB}|${nationA}`);
  return (rel?.stance ?? "neutral") === "war";
}

function isFriendly(nationA: string, nationB: string, state: GameRoomState): boolean {
  if (nationA === nationB) return true;
  const rel = state.relations.get(`${nationA}|${nationB}`) ?? state.relations.get(`${nationB}|${nationA}`);
  return (rel?.stance ?? "neutral") === "alliance";
}

/** Enemy air wings visible to `viewerNationId`, restricted to the given aircraft types. */
function visibleEnemyWingsOfTypes(
  viewerNationId: string,
  types: Set<string>,
  state: GameRoomState,
  detectionSystem: { getWingDetectedByNations(wingId: string): Set<string> },
): AirWingState[] {
  const result: AirWingState[] = [];
  for (const wing of state.air_wings.values()) {
    if (!isHostile(viewerNationId, wing.nation_id, state)) continue;
    if (!types.has(wing.aircraft_type)) continue;
    if (!detectionSystem.getWingDetectedByNations(wing.wing_id).has(viewerNationId)) continue;
    result.push(wing);
  }
  return result;
}

/** Any visible enemy air wing, regardless of type — the "no bomber found, engage anything" tail tier. */
function anyVisibleEnemyWing(
  viewerNationId: string,
  state: GameRoomState,
  detectionSystem: { getWingDetectedByNations(wingId: string): Set<string> },
): AirWingState[] {
  const result: AirWingState[] = [];
  for (const wing of state.air_wings.values()) {
    if (!isHostile(viewerNationId, wing.nation_id, state)) continue;
    if (!detectionSystem.getWingDetectedByNations(wing.wing_id).has(viewerNationId)) continue;
    result.push(wing);
  }
  return result;
}

/** Friendly (own or allied) land divisions near a border of the given stance. */
function friendlyDivisionsNearBorder(
  viewerNationId: string,
  stance: "war" | "neutral",
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
): DivisionState[] {
  // NOTE: DivisionState has no province_id field — it only has a raw lng/lat position.
  // "Near a border" for a division therefore cannot be answered via isBorderingStance
  // (which is province-keyed). Approximate it instead: a division counts as
  // "near a war/neutral border" if it is within BORDER_PROXIMITY_DEG of the city
  // position of ANY province that itself borders that stance. Build the set of
  // qualifying border-province positions once per call, then filter divisions by
  // proximity to that set. This requires the same GameRoom._resolveTargetPosition-style
  // city-position lookup the rest of this file already needs as a callback — see 4d.
  throw new Error("implemented in 4d alongside the resolvePosition callback threading");
}
```

**Read this carefully before implementing `friendlyDivisionsNearBorder`:** `DivisionState`
(confirmed in the Critical Pre-Read) has `position_lng`/`position_lat` but no
`province_id`. There is no existing "which province is this division standing in" query
anywhere in the codebase (confirmed by grep during investigation — division-to-province
containment is not a solved problem here; land movement uses a separate waypoint/terrain
graph, not province polygons). **This plan does not attempt point-in-polygon containment.**
Section 4d below gives the exact approximation to use instead: a division counts as
"near a border of stance X" if its position is within a flat proximity threshold
(`BORDER_PROXIMITY_DEG`, placeholder `1.5`, same order of magnitude as
`INTERCEPTION_PURSUIT_RANGE_DEG = 2.0` already used elsewhere in this codebase) of the city
position of any province that itself borders a stance-X neighbor. This is a pragmatic
approximation flagged explicitly — do not attempt real polygon-containment, it is out of
scope and the map's polygon data is not loaded into `game-server` at runtime.

### 4b. Interception tier chain

```typescript
const BOMBER_TYPES = new Set(["strategic_bomber", "tactical_bomber"]);
const LOW_ALT_BOMBER_TYPES = new Set(["cas_plane", "dive_bomber"]);
const FIGHTER_TYPES = new Set(["fighter", "heavy_fighter"]);
const BORDER_PROXIMITY_DEG = 1.5; // placeholder, see 4a note

interface TierResult { tier: number; targetId: string; }

function resolveInterceptionTargets(
  wing: AirWingState,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  detectionSystem: { getWingDetectedByNations(wingId: string): Set<string> },
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): TierResult | null {
  const nationId = wing.nation_id;

  const tier1 = visibleEnemyWingsOfTypes(nationId, BOMBER_TYPES, state, detectionSystem);
  const best1 = pickBest(tier1.map(w => ({ id: w.wing_id, lng: w.position_lng, lat: w.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (best1) return { tier: 1, targetId: best1.id };

  const tier2 = visibleEnemyWingsOfTypes(nationId, LOW_ALT_BOMBER_TYPES, state, detectionSystem);
  const best2 = pickBest(tier2.map(w => ({ id: w.wing_id, lng: w.position_lng, lat: w.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (best2) return { tier: 2, targetId: best2.id };

  const tier3 = anyVisibleEnemyWing(nationId, state, detectionSystem);
  const best3 = pickBest(tier3.map(w => ({ id: w.wing_id, lng: w.position_lng, lat: w.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (best3) return { tier: 3, targetId: best3.id };

  // Tiers 4-6: patrol fallback over friendly divisions/cities near a border, then own cities.
  // Implemented via the shared resolvePatrolFallback helper — see 4e.
  return resolvePatrolFallback(wing, state, provinceNeighbors, claims, resolvePosition, /* startTier */ 4);
}
```

### 4c. Air Superiority tier chain (mirrors Interception with reversed air-to-air priority)

```typescript
function resolveAirSuperiorityTargets(
  wing: AirWingState,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  detectionSystem: { getWingDetectedByNations(wingId: string): Set<string> },
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): TierResult | null {
  const nationId = wing.nation_id;

  const tier1 = visibleEnemyWingsOfTypes(nationId, FIGHTER_TYPES, state, detectionSystem);
  const best1 = pickBest(tier1.map(w => ({ id: w.wing_id, lng: w.position_lng, lat: w.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (best1) return { tier: 1, targetId: best1.id };

  const tier2 = visibleEnemyWingsOfTypes(nationId, LOW_ALT_BOMBER_TYPES, state, detectionSystem);
  const best2 = pickBest(tier2.map(w => ({ id: w.wing_id, lng: w.position_lng, lat: w.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (best2) return { tier: 2, targetId: best2.id };

  const tier3 = visibleEnemyWingsOfTypes(nationId, BOMBER_TYPES, state, detectionSystem);
  const best3 = pickBest(tier3.map(w => ({ id: w.wing_id, lng: w.position_lng, lat: w.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (best3) return { tier: 3, targetId: best3.id };

  // Tiers 4-6: war-border patrol, then neutral-border patrol, then spread across own cities.
  return resolvePatrolFallback(wing, state, provinceNeighbors, claims, resolvePosition, /* startTier */ 4);
}
```

**Note the difference from Interception's fallback order:** Air Superiority tries a
war-stance border first, then a neutral-stance border, then own-city spread — it does NOT
have Interception's "duplicate onto an already-patrolled unit" tier, because
`resolvePatrolFallback`'s own-city tier already allows duplication implicitly once claim
counts stop mattering (see 4e — the "duplicate allowed" tier is realized by simply not
filtering out already-claimed candidates in the final own-city tier, not by a separate
explicit tier). Confirm this matches `wiki/docs/AIR_COMBAT.md`'s current text for both
missions before implementing — the two chains are similar but not identical in tier count.

### 4d. Position-resolution threading

Every tier function above takes `resolvePosition: (id: string) => {lng,lat} | null` as a
parameter — this is `GameRoom._resolveTargetPosition` passed in by reference from Step 6's
wiring. It resolves wing IDs, division IDs, AND province IDs (via
`_provinceCityPositionLookup`), covering every candidate type this file produces. Use it
for `friendlyDivisionsNearBorder`'s border-province-position lookups too:

```typescript
function friendlyDivisionsNearBorder(
  viewerNationId: string,
  stance: "war" | "neutral",
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): DivisionState[] {
  const borderProvincePositions: Array<{ lng: number; lat: number }> = [];
  for (const [provinceId] of state.provinces) {
    if (!isBorderingStance(provinceId, viewerNationId, stance, state, provinceNeighbors)) continue;
    const pos = resolvePosition(provinceId);
    if (pos) borderProvincePositions.push(pos);
  }
  if (borderProvincePositions.length === 0) return [];

  const result: DivisionState[] = [];
  for (const division of state.divisions.values()) {
    if (!isFriendly(viewerNationId, division.nation_id, state)) continue;
    const nearAny = borderProvincePositions.some(p =>
      euclidDeg(division.position_lng, division.position_lat, p.lng, p.lat) <= BORDER_PROXIMITY_DEG);
    if (nearAny) result.push(division);
  }
  return result;
}
```

Import `DivisionState` from `../rooms/schema/GameRoomState.js` at the top of the file.

### 4e. Shared patrol fallback (used by Interception, Air Superiority, Recon)

```typescript
function resolvePatrolFallback(
  wing: AirWingState,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
  startTier: number,
): TierResult | null {
  const nationId = wing.nation_id;

  const warBorderDivs = friendlyDivisionsNearBorder(nationId, "war", state, provinceNeighbors, resolvePosition);
  const bestWar = pickBest(
    warBorderDivs.map(d => ({ id: d.division_id, lng: d.position_lng, lat: d.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (bestWar) return { tier: startTier, targetId: bestWar.id };

  const neutralBorderDivs = friendlyDivisionsNearBorder(nationId, "neutral", state, provinceNeighbors, resolvePosition);
  const bestNeutral = pickBest(
    neutralBorderDivs.map(d => ({ id: d.division_id, lng: d.position_lng, lat: d.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (bestNeutral) return { tier: startTier + 1, targetId: bestNeutral.id };

  // Own cities, nearest to home airbase first — "nearest" measured from the wing's
  // home airbase per the design doc, NOT from the wing's current position (this is the
  // one tier in this file that intentionally uses a different distance origin).
  const homePos = resolvePosition(wing.home_airbase_province_id);
  const ownProvinces: Array<{ id: string; lng: number; lat: number }> = [];
  for (const [provinceId, province] of state.provinces) {
    if (province.owner_id !== nationId) continue;
    const pos = resolvePosition(provinceId);
    if (pos) ownProvinces.push({ id: provinceId, lng: pos.lng, lat: pos.lat });
  }
  if (ownProvinces.length > 0 && homePos) {
    const best = pickBest(ownProvinces, homePos.lng, homePos.lat, claims);
    if (best) return { tier: startTier + 2, targetId: best.id };
  }

  return null; // stay at base — assignMission's Step 2 fix leaves the wing IDLE
}
```

**Note on "duplicate onto an already-patrolled unit/city" (Interception's tier 6):** this
plan deliberately does NOT implement it as a separate tier. `pickBest`/`scoreCandidate`
already always returns a best candidate if the candidate list is non-empty, regardless of
existing claims (claims only affect score ordering, never exclude a candidate). So if any
friendly division or own city exists at all, `resolvePatrolFallback` already returns a
result even if every candidate is already claimed by another wing — this **is** the
"duplicate allowed" behavior, achieved for free by the scoring design rather than a
separate explicit code path. Confirm this reasoning holds before adding a redundant tier —
it should not be needed.

### 4f. Tactical Bombing tier chain

```typescript
function resolveTacticalBombingTargets(
  wing: AirWingState,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  detectionSystem: { getVisibleDivisionsForNation(nationId: string): Set<string> },
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): TierResult | null {
  const nationId = wing.nation_id;
  const visibleDivIds = detectionSystem.getVisibleDivisionsForNation(nationId);

  const candidates: Array<{ id: string; lng: number; lat: number }> = [];
  for (const divId of visibleDivIds) {
    const div = state.divisions.get(divId);
    if (!div) continue;
    if (isFriendly(nationId, div.nation_id, state)) continue; // must be enemy
    candidates.push({ id: div.division_id, lng: div.position_lng, lat: div.position_lat });
  }
  const best = pickBest(candidates, wing.position_lng, wing.position_lat, claims);
  if (best) return { tier: 1, targetId: best.id };

  // Tier 2: patrol over friendly units near a war-stance border, within max range from
  // home airbase. Reuses friendlyDivisionsNearBorder; the "within max range" constraint
  // is enforced by the caller filtering candidates against wing fuel/range BEFORE calling
  // this function is out of scope for this helper — see the Misassumptions entry on this.
  const warBorderDivs = friendlyDivisionsNearBorder(nationId, "war", state, provinceNeighbors, resolvePosition);
  const bestPatrol = pickBest(
    warBorderDivs.map(d => ({ id: d.division_id, lng: d.position_lng, lat: d.position_lat })),
    wing.position_lng, wing.position_lat, claims);
  if (bestPatrol) return { tier: 2, targetId: bestPatrol.id };

  return null; // tier 3: stay at base
}
```

**`getVisibleDivisionsForNation` returns visibility for the OBSERVING nation** — confirmed
via `_computeDivisionVisibility` (`air_detection_system.ts:194-206`, `if (div.nation_id ===
wing.nation_id) continue`), so it already excludes the observer's own divisions from the
result. It does not, however, exclude allied divisions from an enemy's perspective or vice
versa in a 3+ nation game — the explicit `isFriendly` filter above is still required to
correctly exclude a friendly division that happens to be visible in the set for some other
reason. Do not assume the set is already enemy-only.

### 4g. Strategic Bombing tier chain (Area / Industry / Oil / Logistics)

Same two-tier shape as Tactical Bombing but against province-level strategic targets
instead of divisions, and with only 2 tiers total (no border-patrol fallback, per the
design doc — a nation at peace has nothing to bomb and simply stays home):

```typescript
function resolveStrategicBombingTargets(
  wing: AirWingState,
  state: GameRoomState,
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): TierResult | null {
  const nationId = wing.nation_id;
  const candidates: Array<{ id: string; lng: number; lat: number }> = [];
  for (const [provinceId, province] of state.provinces) {
    if (!province.owner_id || !isHostile(nationId, province.owner_id, state)) continue;
    const pos = resolvePosition(provinceId);
    if (pos) candidates.push({ id: provinceId, lng: pos.lng, lat: pos.lat });
  }
  const best = pickBest(candidates, wing.position_lng, wing.position_lat, claims);
  if (best) return { tier: 1, targetId: best.id };
  return null; // tier 2: stay at base
}
```

Used identically for all four missions (`AREA`, `INDUSTRY`, `OIL`, `LOGISTICS`) — the
mission-specific effect (which scalar gets hit) is entirely handled downstream by
`air_strategic_bombing_system.ts`, unaffected by this branch. This function only decides
WHICH enemy province to fly toward, not what happens on arrival.

**This tier chain does not filter by visibility/detection at all**, unlike every other
tier chain in this file. Confirm this is intentional before implementing: strategic bombing
targets provinces (a form of static, always-known geography — the design doc's Strategic
Bombing section targets "the city point," not a moving contact requiring detection), so
there is no equivalent "is this province currently spotted" concept the way there is for
wings/divisions. If this assumption is wrong, flag it back rather than guessing — the
existing manual-targeting flow (Branch H, `industry` mission via right-click) also never
checked detection for province targets, which supports this being correct.

### 4h. Naval mission tier chain (Trade Interdiction / Anti-Submarine / Anti-Ship / Port Strike)

```typescript
function resolveNavalTargets(
  wing: AirWingState,
  state: GameRoomState,
  claims: Map<string, number>,
): TierResult | null {
  const nationId = wing.nation_id;
  const candidates: Array<{ id: string; lng: number; lat: number }> = [];
  for (const [markerId, marker] of state.naval_contact_markers) {
    if (marker.nation_id !== nationId) continue; // markers are per-observer, already fog-of-war filtered
    candidates.push({ id: markerId, lng: marker.position_lng, lat: marker.position_lat });
  }
  const best = pickBest(candidates, wing.position_lng, wing.position_lat, claims);
  if (best) return { tier: 1, targetId: best.id };
  return null; // tier 2: stay at base
}
```

**Read `air_naval_bomber_system.ts` fully before implementing this** — confirmed during
investigation that naval flotillas are entirely stubbed
(`StubFlotillaProvider.getFlotillaMembers` always returns `[]`), so in practice this tier
chain has very little to actually find today; `state.naval_contact_markers` is real state
that does get populated/expired, but whether it is populated by anything other than test
harnesses in the current codebase needs verification — do not assume real naval gameplay
already generates these markers in a live game. This is a legitimate, narrow scope
limitation inherited from naval combat's current implementation state, not a defect in this
plan. `_resolveTargetPosition` does NOT resolve `naval_contact_markers` ids (confirmed:
only wing → division → province, in that order) — so a naval-mission wing's `target_id`
being a marker id means `GameRoom.ts`'s existing path-computation call sites will fail to
resolve it. **Step 6 must add a fourth branch to `_resolveTargetPosition` for
`naval_contact_markers`, or naval missions in this branch will silently never get a
computed path.** This is called out again in Common Misassumptions — do not miss it.

### 4i. Recon tier chain

```typescript
const RECON_ESCORT_BOMBER_TYPES = new Set(["strategic_bomber", "tactical_bomber"]);

function resolveReconTargets(
  wing: AirWingState,
  state: GameRoomState,
  provinceNeighbors: Map<string, string[]>,
  claims: Map<string, number>,
  resolvePosition: (id: string) => { lng: number; lat: number } | null,
): TierResult | null {
  const nationId = wing.nation_id;

  // Tier 1: escort-follow a friendly strategic/tactical bomber not already accompanied
  // by another recon wing. "Not accompanied" = no other RECON-mission wing already has
  // target_id set to this bomber's wing_id (checked via the claims registry, since claims
  // is keyed by target_id exactly like escort's own escortCounts pattern).
  const candidateBombers: Array<{ id: string; lng: number; lat: number }> = [];
  for (const bomber of state.air_wings.values()) {
    if (bomber.nation_id !== nationId) continue;
    if (!RECON_ESCORT_BOMBER_TYPES.has(bomber.aircraft_type)) continue;
    if ((claims.get(bomber.wing_id) ?? 0) > 0) continue; // already has a recon escort
    candidateBombers.push({ id: bomber.wing_id, lng: bomber.position_lng, lat: bomber.position_lat });
  }
  const bestBomber = pickBest(candidateBombers, wing.position_lng, wing.position_lat, claims);
  if (bestBomber) return { tier: 1, targetId: bestBomber.id };

  // Tiers 2-4: patrol ahead of a friendly land unit in/near enemy territory, then general
  // war-border patrol, then neutral-border patrol. Reuses the same friendlyDivisionsNearBorder
  // + resolvePatrolFallback machinery as Interception/Air Superiority — "patrol ahead of"
  // vs "patrol near" is a movement-style distinction (see AIR_COMBAT.md), not a different
  // target-selection rule, so tier 2 here targets the SAME war-border division candidates
  // as tier 4 of resolvePatrolFallback, just at a higher tier number for Recon specifically.
  return resolvePatrolFallback(wing, state, provinceNeighbors, claims, resolvePosition, /* startTier */ 2);
}
```

**`claims.get(bomber.wing_id) > 0` as the "not already recon'd" check is a simplification**
worth flagging: `buildClaimsRegistry` counts ALL wings targeting a given id, regardless of
mission — so a bomber that happens to also be an ESCORT target (a fighter escorting it) or
an Interception target (an enemy hunting it) would incorrectly read as "already recon'd."
If this cross-mission contamination matters in practice, build a second,
recon-mission-only claims map instead of reusing the shared one for this specific check.
Given recon and escort/interception target different entity kinds in the common case
(recon targets a bomber wing_id; escort's claims also key by bomber wing_id — this DOES
collide), **this is a real bug risk, not a hypothetical** — escort's `target_id` is also a
bomber's `wing_id`. Build a recon-specific counter instead:

```typescript
function buildReconEscortCounts(state: GameRoomState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const wing of state.air_wings.values()) {
    if (wing.mission !== MISSION_TYPES.RECON || !wing.target_id) continue;
    counts.set(wing.target_id, (counts.get(wing.target_id) ?? 0) + 1);
  }
  return counts;
}
```

...and use `buildReconEscortCounts(state).get(bomber.wing_id) ?? 0` for the "already
accompanied" check in tier 1 above, instead of the shared `claims` map. Keep using the
shared `claims` map for `pickBest`'s scoring in the same function — only the "already
accompanied" gate needs the recon-specific count.

---

## Step 5: Main `tick()` Entry Point

### 5a. Write failing integration tests

Add representative end-to-end tests to `game-server/test/12l-mission-targeting-air.test.ts`
(pattern — follow existing test file conventions in `test/12d-air-detection.test.ts` for
room setup boilerplate):

```typescript
describe("lane:air-combat | AirMissionTargetingSystem end-to-end", () => {
  it("an idle interception wing with a visible enemy bomber launches toward it and gets a path", async () => {
    // Spawn nation A interception wing (IDLE, mission=interception, target_id="")
    // Spawn nation B strategic_bomber wing within detection range, at war with A
    // Tick the room until detection populates is_detected / getWingDetectedByNations
    // Tick once more for the targeting system
    // Assert wing.target_id === bomberWingId, wing.lifecycle_state === TRANSIT,
    //   and an AIR_WING_PATH broadcast was sent for this wing
  });

  it("two interception wings targeting the same lone bomber spread when a second bomber appears", async () => {
    // Spawn 2 interceptors, 1 bomber initially — both interceptors target it (expected,
    //   duplicate-allowed is not a concept for tier-1 enemy targeting, only for patrol
    //   fallback — confirm both legitimately converge on the sole target)
    // Spawn a second bomber — tick again — assert the two interceptors now target
    //   DIFFERENT bombers (crowd-balance pulled the second-committed interceptor toward
    //   the now-less-claimed new bomber) — NOTE: due to hysteresis (Step 3 shared
    //   mechanism), an interceptor already committed to tier 1 will NOT swap to a
    //   different tier-1 target just because it's less crowded — same-tier reassignment
    //   only happens for a wing that hasn't committed yet, or whose current target become
    //   invalid. Write this test to match hysteresis behavior, not a naive "always
    //   rebalances" assumption — re-read the hysteresis rule in AIR_COMBAT.md before
    //   writing this assertion.
  });

  it("hysteresis: a wing does not abandon its tier-1 target for another same-tier target", async () => {
    // Spawn 1 interceptor already targeting bomber A (tier 1)
    // Spawn bomber B, closer and less-claimed than A
    // Tick — assert wing.target_id is STILL bomber A (same tier, no switch)
  });

  it("responsiveness: a patrolling wing with only a border-patrol target switches to a newly-visible enemy bomber within one tick", async () => {
    // Spawn interceptor already LOITERing at a border-patrol division (tier 4/5/6)
    // Introduce a new visible enemy bomber
    // Tick once — assert wing.target_id switches to the bomber, tier improves to 1
  });
});
```

Run — must FAIL (system doesn't exist yet).

### 5b. Implement `AirMissionTargetingSystem`

Append to `game-server/src/systems/air_mission_targeting.ts`:

```typescript
import { AirWingState, MISSION_TYPES, WING_LIFECYCLE } from "../rooms/schema/AirWingState.js";
import { DivisionState } from "../rooms/schema/GameRoomState.js";
import { getAirUnitStats } from "../data/air_unit_stats.js";
import type { AirWingLifecycleSystem } from "./air_wing_lifecycle_system.js";
import type { AirDubinsPathfinder } from "./air_dubins_pathfinder.js"; // confirm exact export name before use

type BroadcastFn = (type: string, msg: unknown) => void;
type DetectionQueries = {
  getWingDetectedByNations(wingId: string): Set<string>;
  getVisibleDivisionsForNation(nationId: string): Set<string>;
};
type ResolvePositionFn = (id: string) => { lng: number; lat: number } | null;

const RETARGETABLE_STATES = new Set([WING_LIFECYCLE.IDLE, WING_LIFECYCLE.LOITER, WING_LIFECYCLE.TRANSIT]);

export class AirMissionTargetingSystem {
  private _wingTier: Map<string, number> = new Map();

  tick(
    state: GameRoomState,
    detectionSystem: DetectionQueries,
    lifecycleSystem: AirWingLifecycleSystem,
    pathfinder: AirDubinsPathfinder,
    resolvePosition: ResolvePositionFn,
    broadcast: BroadcastFn,
  ): void {
    const claims = buildClaimsRegistry(state);
    const reconCounts = buildReconEscortCounts(state);
    const provinceNeighbors = state.provinceNeighbors;
    const changed: string[] = [];

    for (const wing of state.air_wings.values()) {
      if (wing.mission === MISSION_TYPES.IDLE || wing.mission === MISSION_TYPES.ESCORT) continue;
      if (!RETARGETABLE_STATES.has(wing.lifecycle_state as WING_LIFECYCLE)) continue;

      const result = this._resolveForMission(wing, state, provinceNeighbors, detectionSystem, claims, reconCounts, resolvePosition);
      if (!result) continue;

      const currentTargetStillValid = wing.target_id !== "" && this._targetStillValid(wing.target_id, state);
      const previousTier = this._wingTier.get(wing.wing_id) ?? Infinity;

      const shouldCommit =
        !currentTargetStillValid ||
        result.tier < previousTier ||
        (result.tier === previousTier && result.targetId === wing.target_id);

      if (!shouldCommit) continue;
      if (result.targetId === wing.target_id && result.tier === previousTier) continue; // already on it, no-op

      const targetPos = resolvePosition(result.targetId);
      if (!targetPos) continue;

      wing.target_id = result.targetId;
      this._wingTier.set(wing.wing_id, result.tier);

      if (wing.lifecycle_state === WING_LIFECYCLE.IDLE || wing.lifecycle_state === WING_LIFECYCLE.LOITER) {
        wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
        lifecycleSystem.resetLoiterTicks(wing.wing_id);
      }

      const startHeading = (Math.atan2(
        targetPos.lng - wing.position_lng,
        targetPos.lat - wing.position_lat,
      ) * 180 / Math.PI + 360) % 360;
      const path = pathfinder.computeTransitPath(
        { lng: wing.position_lng, lat: wing.position_lat },
        startHeading,
        targetPos,
        getAirUnitStats(wing.aircraft_type).min_turn_radius_deg,
      );
      pathfinder.storePath(wing.wing_id, path);
      wing.path_gen_id = path.path_gen_id;
      wing.path_elapsed_ms = 0;
      broadcast("AIR_WING_PATH", { wing_id: wing.wing_id, ...path });
      changed.push(wing.wing_id);
    }

    if (changed.length > 0) {
      broadcast("AIR_WING_UPDATES", { wings: changed.map(id => serializeWingForBroadcast(state, id)) });
    }
  }

  private _targetStillValid(targetId: string, state: GameRoomState): boolean {
    const asWing = state.air_wings.get(targetId);
    if (asWing) return asWing.is_detected; // enemy wing target — still valid only if still detected
    if (state.divisions.has(targetId)) return true;   // division/patrol target — always valid while it exists
    if (state.provinces.has(targetId)) return true;   // province target — always valid while it exists
    if (state.naval_contact_markers.has(targetId)) return true;
    return false; // target no longer exists in any collection
  }

  private _resolveForMission(
    wing: AirWingState,
    state: GameRoomState,
    provinceNeighbors: Map<string, string[]>,
    detectionSystem: DetectionQueries,
    claims: Map<string, number>,
    reconCounts: Map<string, number>,
    resolvePosition: ResolvePositionFn,
  ): TierResult | null {
    switch (wing.mission) {
      case MISSION_TYPES.INTERCEPTION:
        return resolveInterceptionTargets(wing, state, provinceNeighbors, detectionSystem, claims, resolvePosition);
      case MISSION_TYPES.AIR_SUPERIORITY:
        return resolveAirSuperiorityTargets(wing, state, provinceNeighbors, detectionSystem, claims, resolvePosition);
      case MISSION_TYPES.TACTICAL_BOMBING:
        return resolveTacticalBombingTargets(wing, state, provinceNeighbors, detectionSystem, claims, resolvePosition);
      case MISSION_TYPES.AREA:
      case MISSION_TYPES.INDUSTRY:
      case MISSION_TYPES.OIL:
      case MISSION_TYPES.LOGISTICS:
        return resolveStrategicBombingTargets(wing, state, claims, resolvePosition);
      case MISSION_TYPES.TRADE_INTERDICTION:
      case MISSION_TYPES.ANTI_SUBMARINE:
      case MISSION_TYPES.ANTI_SHIP:
      case MISSION_TYPES.PORT_STRIKE:
        return resolveNavalTargets(wing, state, claims);
      case MISSION_TYPES.RECON:
        return resolveReconTargets(wing, state, provinceNeighbors, reconCounts, resolvePosition);
      default:
        return null;
    }
  }
}
```

**`serializeWingForBroadcast` does not exist yet under that name** — the correct existing
function is `serializeWing(wing: AirWingState)` exported from `AirWingState.ts` (verbatim
in the Critical Pre-Read). Replace the placeholder call with:
```typescript
import { serializeWing } from "../rooms/schema/AirWingState.js";
// ...
broadcast("AIR_WING_UPDATES", { wings: changed.map(id => serializeWing(state.air_wings.get(id)!)) });
```

**`resolveReconTargets`'s signature above takes `claims`, but Step 4i's implementation
needs `reconCounts` for its "already accompanied" gate** — pass `reconCounts` as the
`claims` parameter specifically for the tier-1 gate check inside `resolveReconTargets`, but
continue using the wing's normal `claims` (not `reconCounts`) for `pickBest`'s scoring in
tiers 2-4 of that same function (the patrol fallback tiers use the shared registry like
every other mission). This means `resolveReconTargets`'s actual signature needs BOTH maps
passed in — revise Step 4i's function signature to accept `claims: Map<string,number>,
reconCounts: Map<string,number>` as two separate parameters, and update the call site in
`_resolveForMission` accordingly. **This is a real signature mismatch between Step 4i and
Step 5b as drafted here — resolve it by adding the second parameter, do not silently drop
one of the two maps.**

Run the 5a tests — must PASS (adjust exact assertions once the harness's actual room-setup
helper names are confirmed against existing test files' boilerplate — do not invent new
helper names, reuse whatever `test/12d-air-detection.test.ts` already uses).

### 5c. Confirm `AirDubinsPathfinder`'s exact exported class/type name

The Critical Pre-Read confirmed `computeTransitPath`, `storePath`, and `computeLoiterArc`
as methods on a class instance (`this.airDubinsPathfinder` in `GameRoom.ts`), but did not
confirm the exact exported class name for the `import type` statement above. Before this
compiles, grep `air_dubins_pathfinder.ts` for its `export class` declaration and correct
the import if it isn't literally `AirDubinsPathfinder`.

---

## Step 6: Wire Into `GameRoom.ts`

### 6a. Delete the old interception-pursuit block

In `game-server/src/systems/air_detection_system.ts`, delete lines 115–136 (the entire
"Interception pursuit trigger" block quoted in full in the Critical Pre-Read) from
`tick()`. Leave everything else in the file unchanged — `_areNationsHostile` stays (other
code in this file still uses it), as do all detection/visibility mechanics.

### 6b. Add naval marker resolution to `_resolveTargetPosition`

In `game-server/src/rooms/GameRoom.ts`, extend `_resolveTargetPosition()` (lines
2236–2246):

```typescript
// BEFORE:
  private _resolveTargetPosition(targetId: string): { lng: number; lat: number } | null {
    const targetWing = this.state.air_wings.get(targetId);
    if (targetWing) {
      return { lng: targetWing.position_lng, lat: targetWing.position_lat };
    }
    const targetDiv = this.state.divisions.get(targetId);
    if (targetDiv) {
      return { lng: targetDiv.position_lng, lat: targetDiv.position_lat };
    }
    return this._provinceCityPositionLookup.get(targetId) ?? null;
  }

// AFTER:
  private _resolveTargetPosition(targetId: string): { lng: number; lat: number } | null {
    const targetWing = this.state.air_wings.get(targetId);
    if (targetWing) {
      return { lng: targetWing.position_lng, lat: targetWing.position_lat };
    }
    const targetDiv = this.state.divisions.get(targetId);
    if (targetDiv) {
      return { lng: targetDiv.position_lng, lat: targetDiv.position_lat };
    }
    const marker = this.state.naval_contact_markers.get(targetId);
    if (marker) {
      return { lng: marker.position_lng, lat: marker.position_lat };
    }
    return this._provinceCityPositionLookup.get(targetId) ?? null;
  }
```

### 6c. Instantiate and call the new system

Add a private field near the other system instances (grep for `private airDetectionSystem`
to find the right spot and match its declaration style):

```typescript
private airMissionTargetingSystem = new AirMissionTargetingSystem();
```

Add the import at the top of `GameRoom.ts`:
```typescript
import { AirMissionTargetingSystem } from "../systems/air_mission_targeting.js";
```

In the main tick loop, insert the call immediately after `this.airDetectionSystem.tick(...)`
and before `this.serverVisibilitySystem.tick(...)` (matching the ordering rationale in the
Critical Pre-Read):

```typescript
      this.airDetectionSystem.tick(this.state, this.airWingLifecycleSystem,
        (type, msg) => this.broadcast(type, msg),
        (type, msg, nationId) => this.broadcastToNation(type, msg, nationId));

      this.airMissionTargetingSystem.tick(
        this.state,
        this.airDetectionSystem,
        this.airWingLifecycleSystem,
        this.airDubinsPathfinder,
        (id: string) => this._resolveTargetPosition(id),
        (type, msg) => this.broadcast(type, msg),
      );

      this.serverVisibilitySystem.tick(/* ...unchanged... */);
```

Use an arrow function `(id: string) => this._resolveTargetPosition(id)` rather than
`.bind(this)` — matches the existing style of every other inline callback already passed to
system `tick()` calls in this same block (e.g. `(type, msg) => this.broadcast(type, msg)`).

### Notes for execution agent (Step 6)

- `this.airDetectionSystem` itself satisfies the `DetectionQueries` structural type from
  Step 5b (it has both `getWingDetectedByNations` and `getVisibleDivisionsForNation` as
  public methods) — pass the instance directly, no adapter needed.
- Confirm `this.state.provinceNeighbors` is populated before the first tick — it's set in
  `_initProvinces()`, which must run during room setup before the game loop starts. Grep
  for the `_initProvinces(` call site to confirm ordering; do not assume.

---

## Step 7: Test Lanes

### 7a. Update `game-server/test-lanes.json`

Add all four new test files (from "Files to Create") to the `air-combat` lane's `tests`
array, alongside the existing `12k-*` entries:

```json
        "test/12k-escort-auto-assign.test.ts",
        "test/12k-wing-management.test.ts",
        "test/12l-border-adjacency.test.ts",
        "test/12l-mission-targeting-air.test.ts",
        "test/12l-mission-targeting-ground.test.ts",
        "test/12l-mission-targeting-recon-naval.test.ts"
```

Every new test file's top-level `describe()` must be prefixed `"lane:air-combat | "` per
`AGENTS.md` — already followed in every test snippet above; confirm no copy-paste dropped
the prefix.

### 7b. Run full verification

```bash
cd game-server && npm test
cd game-server && npm run test:full
cd game-server && npm run build
```

All must pass before this branch is considered done.

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| `air_dubins_pathfinder.tick()` automatically recomputes a path when `target_id` changes | **Unverified — do not assume.** Every other call site in the codebase computes and stores paths explicitly; this plan's new system does the same explicitly rather than relying on unconfirmed pathfinder-internal behavior. Verify before assuming otherwise. |
| Naval missions can target real friendly/enemy flotillas | **Wrong** — no flotilla schema exists anywhere in the codebase; `AirNavalBomberSystem` uses a stub that returns `[]`. Naval targeting in this branch operates against `NavalContactMarkerState` only, which is itself a fog-of-war marker, not a unit. |
| Interception/Air Superiority's "patrol over friendly land AND naval units" fallback covers naval units | **Wrong, and dropped from scope in this branch** — there is no queryable friendly naval unit state. Only land divisions are covered. Flag this to the user; it's a forced scope cut, not an oversight. |
| `ProvinceState` has a position field usable directly from `systems/` code | **Wrong** — city position lives only in `GameRoom.ts`'s private `_provinceCityPositionLookup`, populated from `map_data.json`'s `city_position` field, never mirrored onto the schema. The new system receives it via a passed-in `resolvePosition` callback, not direct schema access. |
| Land divisions can be checked for "which province they're standing in" to determine border proximity | **Wrong** — `DivisionState` has no `province_id` field, and no containment query exists anywhere in this codebase. This plan approximates "near a border" via flat proximity to border-province city positions (`BORDER_PROXIMITY_DEG`), not true polygon containment. |
| `buildClaimsRegistry`'s target_id-keyed counts are mission-specific | **Wrong** — it counts across ALL missions sharing the same `target_id` value. This causes a real collision between Escort's bomber-targeting and Recon's bomber-escort-following (both use a bomber `wing_id` as `target_id`) — Step 4i's `buildReconEscortCounts` exists specifically to avoid this collision for Recon's "already accompanied" check. Do not assume the shared registry is safe for every per-mission gate; only use it for scoring (`pickBest`), not for exclusion checks that need mission-specific counts. |
| The hysteresis rule means a wing never re-evaluates once it has a target | **Wrong** — it re-evaluates every tick (Step 5b's loop runs over every retargetable wing every call); hysteresis only prevents SWITCHING to a same-or-lower-tier different target, not the re-evaluation itself. An invalidated target (destroyed, undetected) always triggers a fresh search regardless of tier. |
| `isPatrolMission`/`AUTO_TARGETED_MISSIONS` should include `ESCORT` | **Wrong** — Escort has its own separate, already-correct auto-assignment system (`autoAssignEscort`); it must stay excluded from both this constant and the new targeting system's main loop (`wing.mission === MISSION_TYPES.ESCORT` is explicitly skipped in Step 5b's loop). |
| Strategic Bombing's target search should check detection/visibility like every other mission | **Needs confirmation, not a safe assumption** — this plan targets provinces without a detection check (matching existing manual-targeting precedent from Branch H), but flag this back if it turns out to be wrong rather than silently diverging from the rest of the file's pattern. |
| `resolvePatrolFallback`'s own-city tier needs an explicit "duplicate allowed" tier per the design doc's wording | **Not needed** — `pickBest` never excludes claimed candidates, only deprioritizes them via score; a non-empty candidate list always returns a result regardless of existing claims, which already IS the duplicate-allowed behavior. Adding a separate explicit tier for this would be redundant dead code. |
| Tactical Bombing's "within max range from home airbase" constraint on its border-patrol fallback tier is implemented in this plan | **Not implemented as written** — Step 4f's tier 2 does not filter by wing range/fuel. If this constraint is required before merging, it needs an explicit fuel-based range check added to `resolveTacticalBombingTargets`'s tier 2, using the same `min_turn_radius_deg`/fuel-derived max-range math already used in `GameRoom._findNearestFriendlyAirbaseToPoint` (`maxRange = (1.0 - FUEL_RTB_THRESHOLD) / FUEL_DECAY_TRANSIT * 0.0002 * 1000`) as a reference — not copied verbatim here because this plan does not thread fuel-decay constants into `air_mission_targeting.ts`. Flag this gap explicitly rather than silently shipping an unbounded-range patrol tier. |
| `CROWD_WEIGHT = 0.15` and `BORDER_PROXIMITY_DEG = 1.5` are final balanced values | **Wrong** — both are placeholders explicitly flagged for playtesting, consistent with every other constant in `wiki/docs/AIR_COMBAT.md`'s Open Questions section. Do not treat them as tuned. |
