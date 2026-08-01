# Air Operations

Air operations control the live wings that fly from province airbases, carry out missions, detect enemies, fight other wings, and attack ground forces. The server owns wing movement, fuel, readiness, damage, mission outcome, and visibility; the client visualizes the paths and resulting state.

# Details

## Wing lifecycle and movement

Wings move through `idle`, `transit`, `engaged`, `loiter`, `rtb`, `refuel`, and `relocate`. Fuel limits range and causes return-to-base behavior; readiness affects combat and bombing effectiveness and recovers at base. Engine, weapon, instrument, and fuel damage further affect operations.

The pathfinder generates curved, heading-aware paths for transit, return-to-base, loiter, pursuit, and redeployment. It broadcasts `AIR_WING_PATH` and tracks an authoritative path ID and elapsed time for client interpolation.

`game-server/src/systems/air_wing_lifecycle_system.ts`, `AirWingLifecycleSystem.tick()`, begins by measuring idle wings at each base:

```ts
tick(state: GameRoomState, _tickCount: number, broadcast: BroadcastFn): void {
  const changed: string[] = [];
  const wingsPerBase = new Map<string, number>();
  for (const w of state.air_wings.values()) {
    if (w.lifecycle_state === WING_LIFECYCLE.IDLE && w.home_airbase_province_id) {
      wingsPerBase.set(w.home_airbase_province_id, (wingsPerBase.get(w.home_airbase_province_id) ?? 0) + 1);
    }
  }
}
```

The lifecycle system evaluates this live room data; the client only renders the resulting wing updates.

## Missions, bases, and staging

`MISSION_TYPES` defines 14 mission identifiers including a new `IDLE` mission. The `assignMission()` function has an early-exception for `IDLE` that skips the `TRANSIT` state transition, letting a wing stay grounded. The `CREATE_WING` handler spawns new wings at a province airbase with `mission = IDLE` and `lifecycle_state = IDLE`; province coordinates are resolved via `_provinceCityPositionLookup`. `ADJUST_WING_SIZE` lets players change wing count with a ±delta clamped to zero.

`autoAssignEscort()` provides round-robin escort pairing: heavy fighters prioritize strategic/tactical bombers, fighters prioritize CAS/dive/naval bombers. Only airborne (`TRANSIT`/`ENGAGED`/`LOITER`) friendly bombers are candidate targets. Orphaned escorts (when their assigned bomber is disbanded) re-run auto-assignment automatically.

Wings carry a `perk_air_combat` field, set via `SET_WING_PERK`. When enabled, the combat system reads `attack_vs_air_perked` from the stat table (currently only `cas_plane`/`dive_bomber` have a perked override of 0.15, vs base 0.05) instead of the base `attack_vs_air`, making the perk a pure damage-effectiveness multiplier. `serializeWing()` now includes all six perk fields including the previously-missing `perk_splash`.

Players can assign missions, move a wing, order it home, redeploy it to an owned or allied province, disband it, and toggle existing wing perks. Out-of-range movement can queue a return first or select a nearer friendly staging base. A captured hostile airbase likewise triggers redeployment or disbanding.

Mission identifiers include interception, air superiority, escort, tactical bombing, reconnaissance, logistics, and several future strategic/naval missions. **Current:** implementation is most developed for interception/air superiority movement and tactical bombing; the full mission list is not a promise that each mission resolves gameplay effects.

## Detection and air combat

Detection combines airborne wing observation, reconnaissance, and configured radar entries. It controls `is_detected`, detection/loss events, private visibility notifications, and automatic interception pursuit.

The air-combat system finds hostile candidates, deconflicts pairings, applies surprise when visibility differs, calculates losses and component damage, and transitions wings through engagement, return, destruction, or recovery.

## Server-side visibility and area-of-interest filtering

**Current.** `ServerVisibilitySystem` (`game-server/src/systems/server_visibility_system.ts`) filters division and wing broadcasts so each connected client only receives unit data it should see. It runs each tick after detection is complete and before division and wing broadcasts.

Visibility for each nation is computed from four sources:
- **Ownership** — a nation always sees its own divisions and wings.
- **Alliance** — nations share all detected unit positions with allies.
- **Detection** — `AirDetectionSystem` reports which enemy divisions and wings are visible through airborne wing observation, radar, or ground division observation radius.
- **Province ownership** — any unit inside a player's owned province is visible regardless of nearby friendly forces.

The system replaces the previous global broadcasts in `GameRoom.gameTick()`:

- `DIVISION_UPDATES`: formerly sent to all clients; now sent per-client with only the divisions `canNationSeeDivision()` returns.
- `AIR_WING_UPDATES`: filtered through `broadcastFilteredAirWingUpdates()`, which additionally always sends own and allied wings.
- `DIVISION_APPEARED` / `DIVISION_VANISHED`: sent per-nation when a division enters or leaves a player's visible set.
- `AIR_WING_VANISHED`: sent when a wing leaves visibility (distinct from `AIR_WING_DESTROYED` — destroyed is permanent, vanished is temporary fog-of-war loss).

Idle and refuelling wings at base are not broadcast to hostile nations. Wings in transit, loiter, combat, or returning-to-base are visible to hostile nations only when inside detection coverage or over a hostile-owned province.

Province polygon data is loaded separately from the existing province init via `geo_utils.ts` (`loadProvincePIPData`), which builds bounding-box-accelerated point-in-polygon entries from `map_data.json`. The `findProvinceAtPoint` function uses ray-casting against province polygon rings.

### Alliance visibility propagation

After per-nation visibility is computed, the system propagates each nation's visible entities to all allied nations. This means if Germany detects a French division, Germany's ally United Kingdom also receives that division — even if the UK has no units near it.

### Broadcast helpers

Two helpers extracted into `GameRoom.ts`:

```ts
// Replaces 6 identical inline patterns
private broadcastToNation(type: string, msg: unknown, nationId: string): void

// Wraps per-client wing filtering with own/allied fast path
private broadcastFilteredAirWingUpdates(msg: { wings: unknown[] }): void
```

### Test support

`game-server/test/12j-server-visibility-aoi.test.ts` covers 11 visibility scenarios: own-nation visibility, enemy hiding, land-to-land observation, province ownership reveal, vanish on range-out, alliance sharing, idle-wing hiding, airborne detection, wing vanish, and province ownership for wings.

## Mission auto-targeting

**Current.** `AirMissionTargetingSystem` (`game-server/src/systems/air_mission_targeting.ts`) drives per-tick target selection for every retargetable (`IDLE`/`LOITER`/`TRANSIT`) wing that isn't `IDLE`/`ESCORT`-missioned. It runs in `GameRoom.gameTick()` after `AirWingLifecycleSystem.tick()` (so this tick's LOITER/IDLE transitions are visible) and before the RTB/Dubins path ticks (so a freshly-committed TRANSIT wing gets its path advanced the same tick). See `AIR_COMBAT.md`'s "Mission Auto-Targeting & Patrol Priority" section for the authoritative per-mission tier chains, crowd-balancing formula, and hysteresis rule this module implements — this note only summarizes the implementation shape.

- Each mission (Interception, Air Superiority, Tactical Bombing, Strategic Bombing sub-missions, Naval sub-missions, Recon) has its own exported tier-chain resolver function; `AirMissionTargetingSystem._resolveForMission` dispatches on `wing.mission`.
- A `claims` registry (`buildClaimsRegistry`) and a per-tick `TickCache` (memoizing border-division and hostile-province scans per `(nationId[, stance])`) are built once per `tick()` call and threaded through every wing's resolution that tick, not rebuilt per wing.
- Hysteresis: a wing only abandons its current target for a strictly better tier or when the current target becomes invalid (`_targetStillValid`); `_wingTier` tracks the last-committed tier alongside the mission it was computed under, since tier numbers aren't comparable across different missions' chains.
- A wing under player-directed manual targeting (right-click interception/tactical-bombing/industry-bombing target selection, `ASSIGN_WING_MISSION`'s `is_manual` flag) is excluded from auto-search via `registerManualTarget`/`clearManualTarget` until its manual target becomes invalid — distinct from `air_dubins_pathfinder.ts`'s own `registerManualTarget`, which only feeds interception's lost-contact loiter behavior.
- Defaults ON in real games, OFF under `NODE_ENV=test` (`setAirMissionTargetingEnabledForTesting`) — most existing test suites predate this system and manually assign `target_id`s that patrol-fallback would otherwise overwrite. `test/12l-mission-targeting-air.test.ts`'s end-to-end describe block opts back in to exercise it live.

## Ground attack

Tactical-bombing wings loitering near an engagement or targeted division select tactical cells through aircraft-specific bombing patterns. The bombing system applies HP and suppression damage to those cells and the affected division, then reports the strike to the relevant players.

## Strategic bombing

Strategic bombers (STRATEGIC_BOMBER and TACTICAL_BOMBER) on AREA, INDUSTRY, OIL, or LOGISTICS missions damage province-level scalars instead of the tactical grid. `AirStrategicBombingSystem` (`game-server/src/systems/air_strategic_bombing_system.ts`) runs each tick after the tactical bombing system. It filters for LOITER wings with strategic missions, resolves their target province, applies the mission-specific damage, and transitions the wing to RTB.

**Current:** four mission types:
- **AREA** — reduces `population` and `infrastructure` on the target province.
- **INDUSTRY** — reduces `industry` on the target province.
- **OIL** — sets `oil_bombed_until_ms` to `Date.now() + OIL_DEBUFF_DURATION_MS` (2 minutes by default).
- **LOGISTICS** — no-op stub that still calls `resolveWingBombed` to RTB the wing.

Damage per plane per run uses `PROVINCE_BOMBING_STATS` in `air_bombing_stats.ts`. The damage formula is `planes × combat_readiness × DAMAGE_SCALE`. Province scalars never go below 0. The system broadcasts `AIR_BOMBING_PROVINCE_RESULT` to the attacker and defender nation and `PROVINCE_AA_FIRED` to all clients.

## Province fixed AA

`ProvinceAaSystem` (`game-server/src/systems/air_province_aa_system.ts`) checks fixed AA once per bombing run. AA strength per province is set via `setProvinceAaStrength()` (used by the `SET_PROVINCE_AA` test handler). Damage formula:

```
floor(strength × wingCount × altitudeMult × AA_DAMAGE_COEFFICIENT)
```

Low-altitude aircraft (`cas_plane`, `dive_bomber`, `fighter`, `naval_bomber`) take 1.5× damage; high-altitude aircraft take 1.0×. The system runs inside `AirStrategicBombingSystem.tick()` before province damage is applied. When AA destroys the entire wing, the bombing run is skipped. `PROVINCE_AA_FIRED` is broadcast to all clients (flak is visible to all players).

## Naval Bomber Missions

**Current (Branch H).** Naval bombers (`NAVAL_BOMBER` aircraft type) operate over sea zones rather than the land tactical grid. All naval missions are gated by naval fog-of-war: a bomber needs a contact marker to have a target. `AirNavalBomberSystem` (`game-server/src/systems/air_naval_bomber_system.ts`) runs each tick after the strategic bombing system. It maintains marker lifetimes, resolves port strikes, and forwards anti-ship/anti-sub/trade interdiction missions as Phase 13-ready stubs.

### Naval Contact Marker system

The fuzzy contact marker is the mechanism that bridges naval fog-of-war and air strike targeting. A detected enemy flotilla position generates a marker — a randomized-radius position valid for a limited window — rather than exposing the flotilla's exact coordinates. A naval bomber must physically reach the marker before it expires; if not, the strike whiffs.

`NavalContactMarkerState` schema fields:

| Field | Type | Purpose |
|---|---|---|
| `marker_id` | string | Unique ID |
| `nation_id` | string | Owning nation (only they see it) |
| `quality` | enum | `MARITIME_PATROL`, `CARGO_SINKING`, `FLOTILLA_SCOUT` |
| `position_lng/lat` | number | Randomized contact position |
| `radius_deg` | number | Uncertainty radius (derived from quality) |
| `expires_at_ms` | number | Absolute expiry timestamp |
| `is_refreshable` | boolean | True for MARITIME_PATROL — expiry resets while patrol wing is on-station |

Quality tier defaults (playtesting-bound):

| Quality | radius_deg | duration_ms | refreshable |
|---|---|---|---|
| `MARITIME_PATROL` | 0.15 | 60 000 | true |
| `CARGO_SINKING` | 0.8 | 20 000 | false |
| `FLOTILLA_SCOUT` | 0.4 | 40 000 | false |

The server expiry tick removes markers past `expires_at_ms` and broadcasts `CONTACT_MARKER_EXPIRED`. A `CREATE_NAVAL_CONTACT` handler exists for test harness seeding. Phase 13 wires three real callers: maritime patrol wing tick, cargo sinking event, and flotilla scouting tick.

### Mission stubs and interfaces

**Current.** Anti-ship, Anti-submarine, and Trade interdiction handlers exist with the correct event payload shape but produce no game effect until Phase 13 supplies real flotilla data. Trade interdiction calls `resolveWingBombed` immediately — Phase 13's cargo system will intercept the tick. Anti-ship and anti-sub check `state.naval_contact_markers` for the target marker and broadcast `NAVAL_BOMBER_STRIKE_HIT` or `NAVAL_BOMBER_STRIKE_MISSED` accordingly.

### Port strike

Port strike is **fully implemented in Branch H**. A naval bomber targeting a coastal province degrades `naval_base_level` on `ProvinceState` (field added in Branch H; default 0). No province fixed AA fires on port strike (unlike strategic bombing). In Phase 13, the same strike also resolves HP damage against docked ships, reduced proportionally by `naval_base_level`.

### Splash damage perk

**Current.** `perk_splash = true` on `AirWingState` routes the naval bomber strike through an `IFlotillaProvider` interface: primary target takes full damage, 15% splashes across remaining flotilla members. The interface is defined and the math guard is implemented in Branch H; `StubFlotillaProvider` returns an empty member list until Phase 13 injects a real implementation. No air code changes needed in Phase 13.

### Phase 13 seams

| Stub in Branch H | Phase 13 wires |
|---|---|
| `getFlotillaMembers()` returns `[]` | Real flotilla composition from `FlotillaState` |
| `refreshContact()` is defined but uncalled | Maritime patrol wing tick calls it |
| Trade interdiction fires event, no consumer | Phase 13 cargo system subscribes |
| Anti-ship targets mock highest-value contact | Real ship priority from `FlotillaState` |
| Anti-sub targets no real contacts | Real submarine detection from Phase 13 |

### Visual checks (Branch H)

| Check | Action | Expected |
|---|---|---|
| Marker appears | Seed `MARITIME_PATROL` via `CREATE_NAVAL_CONTACT` | Translucent circle on own-nation client |
| Radius matches quality | Seed all three tiers side-by-side | `CARGO_SINKING` ~5× wider than `MARITIME_PATROL` |
| Marker fades and expires | Seed `CARGO_SINKING`, watch 20 s | Alpha fades; circle disappears; `CONTACT_MARKER_EXPIRED` fires |
| Enemy blindness | Two clients; seed for nation A | Nation B sees nothing |
| Port strike hit | Naval bomber reaches coastal province in time | Province panel: `naval_base_level` reduced; no flak burst |
| Port strike miss | Seed marker, let it expire, bomber arrives late | Bomber RTBs; no province effect; `NAVAL_BOMBER_STRIKE_MISSED` |
| Strike event fires | Bomber reaches marker before expiry | `NAVAL_BOMBER_STRIKE_HIT` fires; wing RTBs |

# Related Notes

- [[game-server/simulation/index|Simulation]]
- [[game-server/game-state|Authoritative Game State]]
- [[game-server/maps-and-starting-state|Maps and Starting State]]
- [[game-server/simulation/ground-combat|Ground Combat and Supply]]
- [[docs/AIR_COMBAT|Air Combat]] — authoritative design source for mission auto-targeting and patrol priority
