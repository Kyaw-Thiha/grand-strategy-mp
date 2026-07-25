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

Players can assign missions, move a wing, order it home, redeploy it to an owned or allied province, disband it, and toggle existing wing perks. Out-of-range movement can queue a return first or select a nearer friendly staging base. A captured hostile airbase likewise triggers redeployment or disbanding.

Mission identifiers include interception, air superiority, escort, tactical bombing, reconnaissance, logistics, and several future strategic/naval missions. **Current:** implementation is most developed for interception/air superiority movement and tactical bombing; the full mission list is not a promise that each mission resolves gameplay effects.

## Detection and air combat

Detection combines airborne wing observation, reconnaissance, and configured radar entries. It controls `is_detected`, detection/loss events, private visibility notifications, and automatic interception pursuit.

The air-combat system finds hostile candidates, deconflicts pairings, applies surprise when visibility differs, calculates losses and component damage, and transitions wings through engagement, return, destruction, or recovery.

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

# Related Notes

- [[game-server/simulation/index|Simulation]]
- [[game-server/game-state|Authoritative Game State]]
- [[game-server/maps-and-starting-state|Maps and Starting State]]
- [[game-server/simulation/ground-combat|Ground Combat and Supply]]
