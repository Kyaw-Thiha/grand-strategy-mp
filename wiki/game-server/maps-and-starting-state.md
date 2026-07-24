# Maps and Starting State

The game server turns a selected map into a playable starting match. It defines playable nation slots, loads province ownership and movement data, then spawns the divisions and air wings that exist when the game begins.

# Details

## Current map

**Current:** `western_europe_6` is the only map recognized by `getMapNations()`. It supplies playable nations, starting positions, starting air wings, a default division template, and shared nation availability configuration.

`GameRoom` starts with this map ID by default. Adding another map requires a corresponding case in the map loader; map data alone is not sufficient.

`game-server/src/data/map_loader.ts`, `getMapNations()`, explicitly recognizes the current map ID:

```ts
export async function getMapNations(mapId: string): Promise<NationDefinition[]> {
  switch (mapId) {
    case "western_europe_6": {
      const mod = await import(`./maps/${mapId}/nations.js`);
      return mod.default as NationDefinition[];
    }
    default:
      throw new Error(`Unknown map: ${mapId}`);
  }
}
```

This is the code-level reason a new asset folder alone does not create a selectable server map.

## Loaded game data

| Data                      | Used for                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `map_data.json`           | Province IDs, initial owners, city positions, polygons, terrain, and province capture. |
| `waypoints.json`          | Road-connected movement graph and river segments.                                      |
| `waypoints_terrain.json`  | Optional server-only off-road terrain graph.                                           |
| map nation definitions    | Playable nation slots in the lobby.                                                    |
| starting-position modules | Initial divisions and air wings.                                                       |
| default template          | Starting division composition, movement profile, and engagement radius.                |

The live map assets are read from `client/assets/data/<map-id>/`. The game server therefore depends on client map data for simulation inputs; cached file reads avoid reparsing the same asset within a process.

## Starting forces

At game start, the server initializes every province from its map owner, creates neutral relationships between playable nations, and spawns configured ground divisions and air wings. Playable and neutral nations can both have starting ground forces; player assignment is only available for the map's playable nation slots.

## Airbases and capture

An air wing's home airbase references a province ID. When a province is captured, a wing based there remains only if the new owner is the same nation or an ally. Otherwise the server redeploys it to the nearest friendly airbase or disbands it when no valid base exists.

# Related Notes

- [[game-server/index|Game Server]]
- [[game-server/room-lifecycle|Room Lifecycle]]
- [[game-server/simulation/movement-and-territory|Movement and Territory]]
- [[game-server/simulation/air-operations|Air Operations]]
