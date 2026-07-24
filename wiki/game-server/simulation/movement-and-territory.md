# Movement and Territory

Movement turns a division's ordered waypoints into a changing world position. Territory rules prevent a division from accepting a route through neutral territory, while combat later decides whether a division can capture an enemy-held province.

# Details

## Movement orders

`SUBMIT_MOVE_ORDER` replaces a division's existing path after verifying that every waypoint exists. The server trims the requested path at the first neutral-territory waypoint; own, allied, and at-war territory remain eligible. It also stores an optional exact final click position for the last part of a route.

`HOLD` clears movement. `REPOSITION` is a separate, short movement order for an engaged or suppressed division and remains constrained by the engagement boundary.

## Per-tick movement

The movement system advances divisions along the loaded waypoint graph. Road nodes use road speed; terrain-grid nodes use the division template's terrain-cost profile. Each tick can consume one or more waypoints, and the division records consumed IDs for client reconciliation.

Division templates determine whether a force is classified as infantry, motorised, or armoured, along with its movement profile, observation radius, and engagement radius.

`game-server/src/systems/movement_system.ts`, `MovementSystem.tick()`, skips idle or engaged divisions before advancing a valid order:

```ts
for (const division of state.divisions.values()) {
  const hasFinalPos = division.final_position_lng > -998;
  if (division.move_order.length === 0 && !hasFinalPos) continue;
  if (division.combat_state === "engaged" || division.combat_state === "suppressed") continue;
  division.consumed_waypoint_ids.splice(0, division.consumed_waypoint_ids.length);
  if (division.move_order.length > 0) {
    this._advanceDivision(division, speedMult);
  }
}
```

This is the authoritative per-tick gate behind a submitted route and its client reconciliation data.

## Territory and capture

Province ownership comes from live `ProvinceState`, not the map's initial owner. During combat processing, an eligible non-retreating division captures an enemy-held province only when it is inside that province's polygon and no at-war enemy contests the province city within the configured radius.

Capture emits `PROVINCE_CAPTURED`. The room then checks whether the captured province was an airbase and may force affected enemy wings to redeploy or disband.

# Related Notes

- [[game-server/simulation/index|Simulation]]
- [[game-server/maps-and-starting-state|Maps and Starting State]]
- [[game-server/simulation/ground-combat|Ground Combat and Supply]]
- [[game-server/simulation/air-operations|Air Operations]]
