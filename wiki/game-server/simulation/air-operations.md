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

# Related Notes

- [[game-server/simulation/index|Simulation]]
- [[game-server/game-state|Authoritative Game State]]
- [[game-server/maps-and-starting-state|Maps and Starting State]]
- [[game-server/simulation/ground-combat|Ground Combat and Supply]]
