---
tags: [future-work, air-combat, phase-12]
status: deferred
dependency: airbase-levels (economy buildings phase)
---

# RELOCATE_FLEET — Air Fleet Relocation to Front

## What It Does

When a player selects an air fleet and clicks a target airbase on the map, the server
automatically distributes the fleet's wings across that airbase and nearby friendly
airbases in a way that provides optimal coverage of the new front. Each wing type is
placed at a depth appropriate for its operating range — fighters go close, strategic
bombers go further back.

Handler signature:
```
RELOCATE_FLEET { fleet_id, target_province_id, radius_deg? }
```

The ferry leg (getting each wing to its assigned base) is handled by the existing
`REDEPLOY_WING` + auto-staging logic. RELOCATE_FLEET only decides *which* base each
wing goes to.

## Design Decisions

**1. Coverage-based, not ferry-range-based.**
For each wing, the question is: "from candidate base B, can this wing cover target
front T?" — not "can this wing ferry from its current position to B?" The ferry is
already handled by REDEPLOY_WING + auto-staging.

**2. Wing type range determines placement depth.**
Different aircraft types have different effective operating ranges. Strategic and tactical
bombers can operate from bases further behind the front; fighters need forward basing.
The distribution must not assign a fighter to a base too far back to cover the front,
and must not waste a forward slot on a bomber that could operate from deeper.

**3. "Nearby" = radius around the clicked airbase.**
Candidate bases are all friendly provinces with city positions within a calibrated radius
of the target province. The radius should be anchored to typical fighter combat range
(the shortest-range type sets the zone size), since fighters define the minimum coverage
needed from any base in the set.

**4. Airbase level weighting.**
Higher-level airbases should receive proportionally more wing allocations. This is the
key differentiating factor between candidate bases. **Stubbed at uniform weight** until
`airbase_level` is added to `ProvinceState` (economy buildings phase).

**5. Load balancing.**
Spread wings across candidate bases to avoid congestion. The E-patch airbase recovery
congestion mechanic already models the cost of over-stacking (more wings at one base →
slower fuel and readiness recovery for all wings there).

**6. Any owned/allied province with a city position = valid airbase.**
No explicit `is_airbase` field exists in `ProvinceState`. This matches how
`_findNearestFriendlyAirbaseToPoint()` already identifies candidate bases in
`GameRoom.ts`. RELOCATE_FLEET uses the same province set.

## Why Deferred

Airbase level weighting (point 4) is what makes the distribution meaningfully non-trivial.
Without it, the algorithm reduces to pure load-balancing across all nearby bases equally,
which is not worth implementing only to rework it when levels land. The feature should be
built once, properly, after `airbase_level` is added to `ProvinceState`.

## Where to Implement

After the economy buildings phase adds `airbase_level: number = 0` to `ProvinceState`
(analogous to the existing `naval_base_level`), implement as part of a Branch I follow-up
or a dedicated air-fleet-improvements branch.

## Further Context

- Full design doc: `docs/AIR_COMBAT.md` → "Command Layer — Air Fleets → Fleet Relocation"
- Branch I spec: `plans/phase-12/phase-12-air-combat.md` → Branch I section
