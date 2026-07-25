# Authoritative Game State

The room state is the server's live model of a match. It contains who is connected, which nations are selected, who owns each province, where divisions and air wings are, and the diplomatic relationships that control legal movement and combat.

It is temporary match state, not persistence. The Godot client receives a replicated subset through Colyseus and additional serialized events; it must treat the server as authoritative.

# Details

## Top-level state

| State collection                | What it contains                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `phase`, `map_id`, `game_speed` | Match lifecycle, selected map, and current speed vote value.                            |
| `players`                       | Connected session IDs mapped to account ID, Steam ID, and host-pass claim.              |
| `nations`                       | Playable nation slots, assigned player IDs, readiness, and researched perk IDs.         |
| `provinces`                     | Current owner, industry, population, infrastructure, and oil-disruption timer for every province loaded from the map. |
| `divisions`                     | Live ground forces, orders, combat state, supply, stacks, and tactical grid.            |
| `relations`                     | Pairwise diplomatic stance: neutral, war, or alliance.                                  |
| `proposals`                     | Replicated proposal shape; current diplomacy voting is also tracked in room-local maps. |
| `air_wings`                     | Live aircraft groups, position, fuel, readiness, mission, path, damage, and perks.      |

`game-server/src/rooms/schema/GameRoomState.ts` declares the replicated room collections:

```ts
@type("string") phase: string = "lobby";
@type("string") map_id: string = "western_europe_6";
@type({ map: PlayerState })   players   = new MapSchema<PlayerState>();
@type({ map: NationState })   nations   = new MapSchema<NationState>();
@type({ map: ProvinceState }) provinces = new MapSchema<ProvinceState>();
@type({ map: DivisionState }) divisions = new MapSchema<DivisionState>();
```

The Colyseus schema identifies the room-owned collections that clients can observe; it is not a client write model.

## Divisions and tactical grids

A division records its nation, geographical position, HP, suppression, movement and reposition orders, engagement state, supply status, stack membership, and opponent IDs. It also has a 5×5 tactical grid of unit cells.

Each grid cell stores unit type, HP, suppression, experience, incapacitation, and stealth. The grid is server-side rather than Colyseus-schema synchronized; the server includes it in division serialization and combat-round events where clients need it.

## Province bombing fields

**Current:** every province now has `industry`, `population`, `infrastructure` (default 50) and `oil_bombed_until_ms` (default 0). These are loaded from `map_data.json` at game start and modified by strategic bombing. They are Colyseus schema fields so the client can read live values.

## Air wings

An air wing is a group of one aircraft type. Its state includes the number of operational aircraft, fuel, combat readiness, world position, heading, lifecycle state, mission, target, home airbase, generated path, weapons readiness, detection, component damage, and current perk flags.

Wing lifecycle states are `idle`, `transit`, `engaged`, `loiter`, `rtb`, `refuel`, and `relocate`.

## State that is not replicated

`GameRoom` also keeps the host session ID, game start time, map city lookup, player emails for chat, and active diplomacy votes in ordinary in-memory structures. Simulation systems keep caches such as movement graphs, active combat pairs, path data, radar entries, and air spatial buckets. These are implementation state, not client-owned game state.

# Related Notes

- [[game-server/index|Game Server]]
- [[game-server/commands-and-events|Commands and Events]]
- [[game-server/simulation/tactical-divisions|Tactical Divisions]]
- [[game-server/simulation/air-operations|Air Operations]]
