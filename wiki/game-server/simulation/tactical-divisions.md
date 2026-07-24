# Tactical Divisions

Each division has a 5×5 tactical formation that determines the units fighting inside it. The grid stores the health, suppression, experience, incapacitation, and stealth of individual unit cells, allowing a battle to affect the division unevenly rather than as one undifferentiated health pool.

# Details

## Formation state

`ASSIGN_TEMPLATE` updates an idle division's template ID and grid cells, then recalculates its broad division type, movement profile, and engagement radius. Template assignment is rejected while the division is engaged, retreating, or suppressed.

Rows have strategic meaning: rear, reserve, support, assault, and vanguard. Current row perks give different damage, suppression, resistance, or recovery modifiers by row.

`game-server/src/types/tactical_types.ts` supplies the unit identifiers stored in tactical cells:

```ts
export const UnitType = {
  INFANTRY: "infantry",
  ASSAULT_INF: "assault_infantry",
  RECON_INF: "recon_infantry",
  MG: "mg",
  CAVALRY: "cavalry",
  LIGHT_TANK: "light_tank",
} as const;
```

These values are the concrete cell types used by templates and combat systems, rather than display-only labels.

## Combat resolution

Ground combat selects tactical targets using unit-specific attack patterns. Damage and suppression apply to cells, can incapacitate them, and then contribute to the division's aggregate HP and combat condition. Recon, stealth, armour/penetration, experience tiers, and river/terrain conditions influence the result.

`ROUND_RESOLVED` carries tactical grid deltas for the client; `DIVISION_UPDATES` carries the serialized current grid for ordinary strategic updates.

## Planned extensibility

The formation-rule and terrain-modifier systems already define rule formats and evaluation paths, but both currently return no active rules. **Planned:** research/perk content will activate formation relationships and unit-type-specific terrain modifiers.

# Related Notes

- [[game-server/simulation/index|Simulation]]
- [[game-server/game-state|Authoritative Game State]]
- [[game-server/simulation/ground-combat|Ground Combat and Supply]]
- [[game-server/commands-and-events|Commands and Events]]
