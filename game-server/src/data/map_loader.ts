export interface NationDefinition {
  id: string;
  name: string;
  colour: string;
  capital_province_id: string;
}

/**
 * Returns the nation definitions for a given map.
 * Add a new case here when a new map is added to the game.
 */
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

export async function getMapNationIds(mapId: string): Promise<string[]> {
  const nations = await getMapNations(mapId);
  return nations.map((n) => n.id);
}
