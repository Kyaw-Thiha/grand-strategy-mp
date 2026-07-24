# Ground Combat and Supply

Ground combat resolves hostile divisions that enter each other's engagement range. It changes division and tactical-cell health, suppression, combat state, stacks, province ownership, and eventually the availability of supply. Supply describes whether a division can still trace a usable route through friendly territory.

# Details

## Combat lifecycle

The combat system detects eligible hostile engagements after an initial grace period, maintains active pairs, resolves rounds at a configured tick interval, and ends engagements through retreat, destruction, diplomacy, or separation beyond the disengagement boundary.

Combat considers division templates, tactical cells, terrain cover/elevation, river crossings, flanking, armour and penetration, suppression, recon, stealth, experience, stacks, and researched perks. It emits strategic summaries (`COMBAT_RESULT`) and tactical deltas (`ROUND_RESOLVED`).

`game-server/src/rooms/GameRoom.ts` calls the combat system during the authoritative tick and broadcasts its resulting events:

```ts
this.movementSystem.tick(this.state);
const pendingCaptures: Array<{ province_id: string; new_owner_id: string }> = [];
const combatChanged = this.combatSystem.tick(this.state, this.tickCount, (type, msg) => {
  this.broadcast(type, msg);
  if (type === "PROVINCE_CAPTURED") {
    pendingCaptures.push(msg as { province_id: string; new_owner_id: string });
  }
});
```

This ordering means combat sees movement that has already advanced for the tick, while clients receive the server-resolved event afterward.

## Retreat, stacks, and destruction

Players may order a division to retreat from its current opponents. The combat system also rotates or retreats forces according to suppression and stack rules. Destroyed divisions have their orders and engagements cleared and emit `UNIT_DESTROYED`.

Nearby compatible divisions form stacks. Stack order determines the front position; players may reorder a valid non-engaged stack through `REORDER_STACK`.

## Supply

The supply system periodically assigns `normal`, `out_of_supply`, `cut_off`, or `encircled` to each living division. It checks live province ownership, nearby friendly territory, enemy engagement zones, and whether a corridor back to friendly territory remains open.

Supply changes emit loss/restoration events and update the division's replicated supply state. It is a current strategic status system, not yet an economy or stockpile simulation.

## Frontline status

`FrontlineSystem` contains an influence-based province-front calculation, but its `tick()` currently returns immediately. **Current:** the client renders frontline information directly from division positions; the server does not publish `FRONTLINE_BATCH` updates.

# Related Notes

- [[game-server/simulation/index|Simulation]]
- [[game-server/simulation/movement-and-territory|Movement and Territory]]
- [[game-server/simulation/tactical-divisions|Tactical Divisions]]
- [[game-server/game-state|Authoritative Game State]]
