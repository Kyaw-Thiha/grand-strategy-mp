# Combat-Avoidance Pathfinding — Design

> Adds a new pathfinding heuristic: routes avoid active combat zones unless the segment's
> destination waypoint is itself inside that zone. Builds on the existing A* engine and
> waypoint-chain machinery documented in `docs/PATHFINDING.md`.

## Problem

Today, `pathfinder.gd`'s A* has no awareness of active combat. A unit ordered to move
across the map can path directly through an ongoing engagement between other divisions,
which reads as unintended — the player almost never wants their unit to march through a
battle it has nothing to do with.

## Goal

If a computed path would pass through the combined engagement radius of an active combat,
and the segment's final destination is **not** inside that same combat's radius, the
pathfinder should exclude that zone and route around it. If the destination legitimately
lies inside the zone (including one waypoint of a multi-waypoint chain), the unit should
still be able to walk into it — avoidance must not block a deliberate destination.

## Non-goals

- No server-side path validation/rerouting. Movement stays a client-side UX concern — the
  server continues to accept whatever waypoint path the client sends
  (`movement_system.ts` does not re-plan around combat, and this design does not change that).
- No fog-of-war gating. `COMBAT_STARTED`/`COMBAT_ENDED` are already broadcast room-wide via
  Colyseus's plain `broadcast()` (not `_broadcastToFilteredNations`), so all clients already
  see all active combats today; this feature only consumes that existing visibility, it does
  not change it.
- No new "combat radius" value — reuses the existing `ENGAGEMENT_RADIUS_KM = 25.0` constant
  (`military_system.gd:26`) already used for the engagement-circle UI overlay.

## Data model changes

### Server (`game-server/src/systems/combat_system.ts`)

`ActivePair`/`EngagementRef` already carry `engagement_id` (lines 268, 277) but it is not
sent to the client. Add it to the two relevant broadcasts:

- `COMBAT_STARTED` (line 566-571): add `engagement_id: pair.engagement_id`.
- `COMBAT_ENDED` (lines 1437, 1443): add `engagement_id: pair.engagement_id` (both call
  sites already have `pair` in scope).

No new broadcast type, no protocol version bump — purely additive fields.

### Client (`client/src/core/game_state.gd`)

New dictionary, alongside the existing `divisions`/`stacks` state:

```gdscript
## engagement_id -> {division_a: String, division_b: String}
var active_engagement_pairs: Dictionary = {}
```

- Populated in `_apply_combat_started` (currently only sets `is_meeting_battle`, game_state.gd:226-231):
  also store `active_engagement_pairs[data.get("engagement_id", "")] = {division_a: ..., division_b: ...}`.
- Erased in the `COMBAT_ENDED` handler (`session_manager.gd:56-64`): remove the entry keyed
  by `data.get("engagement_id", "")`.
- If `engagement_id` is ever empty (defensive — shouldn't happen post server change), skip
  storing/erasing rather than polluting the dictionary with an empty key.

## Combat zone construction (`military_system.gd`)

A new pure helper, rebuilt fresh on every pathfinding call rather than kept incrementally in
sync with `GameState` (avoids drift, and is cheap — bounded by the number of active
engagements, not graph size):

```gdscript
## Groups active engagement pairs into combat clusters and resolves each
## participant's current position. Rebuilt per call; not cached.
func _build_combat_zones() -> Array[Dictionary]:
    # 1. Union-find over GameState.active_engagement_pairs, joining any two pairs
    #    that share a division_id (handles e.g. 2 attackers vs 1 defender as one zone).
    # 2. For each resulting cluster, resolve every division's position_lng/position_lat
    #    from GameState.divisions.
    # Returns: [{division_ids: Array[String], positions: Array[Vector2]}, ...]
```

The per-zone radius is not stored — callers reuse the existing `ENGAGEMENT_RADIUS_KM`
constant directly, so there is a single source of truth for the radius value.

## A* hard-exclusion (`pathfinder.gd`)

Mirrors the existing neutral-territory exclusion (`_is_neutral_for`, docs lines 219-240)
exactly — same per-neighbor-expansion shape, same "target node is exempt" precedent:

```gdscript
## True if `node_id` falls inside a combat zone that does NOT contain `to_id`.
## `to_id` is always exempt from its own zone (a deliberate destination inside
## an active combat is allowed).
func _is_in_hostile_combat_zone(node_id: String, to_id: String, combat_zones: Array[Dictionary]) -> bool:
    if node_id == to_id:
        return false
    var node_pos: Vector2 = ... # lng/lat of node_id
    var dest_pos: Vector2 = ... # lng/lat of to_id
    for zone in combat_zones:
        var dest_in_zone: bool = false
        for pos in zone["positions"]:
            if dest_pos.distance_to(pos) <= ENGAGEMENT_RADIUS_DEG:
                dest_in_zone = true
                break
        if dest_in_zone:
            continue  # this zone is the legitimate target — never exclude for it
        for pos in zone["positions"]:
            if node_pos.distance_to(pos) <= ENGAGEMENT_RADIUS_DEG:
                return true
    return false
```

`dest_in_zone` is a per-zone, per-query value — compute it once up front for all zones
before the neighbor-expansion loop starts (not recomputed per node), so the added cost is
O(zones) once per query plus O(zones × participants) per node visited, not O(zones ×
participants × nodes_visited × 2).

`_astar_impl` gains a new parameter `combat_zones: Array[Dictionary] = []` (default empty
so existing callers and tests are unaffected). Both forward and backward neighbor
expansions get one added condition next to the existing neutral check:

```gdscript
if v != to_id and (_is_neutral_for(v, player_nation_id, relations) or _is_in_hostile_combat_zone(v, to_id, combat_zones)):
    continue
```

This is a hard exclusion (matching neutral-territory precedent), not a cost multiplier
(unlike shift-move road avoidance). Rationale: cost is comparable to the existing neutral
check (bounded by active-engagement count, realistically tens of zones with a handful of
participants each — trivial against a search that touches at most a few thousand nodes),
and the existing `find_nearest_reachable()` fallback already handles the "zone fully blocks
the only route" case by routing to the nearest reachable node short of the zone, without
any new fallback logic required.

## Integration point

Unlike shift-move road avoidance (only active from segment 2 onward in a chain, docs lines
270-274), combat avoidance must apply to **every** segment, including plain single-click
moves — this is a safety concern, not a road-preference nuance. It plugs in wherever
`find_path(...)` is already called in `military_system.gd`:

- `_handle_move_click` / `_handle_right_click_move`
- `_recompute_chain` (per-milestone loop)
- other existing call sites passing `GameState.get_my_nation_id()` / `GameState.relations`

Each call site computes `_build_combat_zones()` once and threads it through to
`find_path(...)`, the same way `GameState.relations` is already threaded through today. For
a multi-waypoint chain, each segment's own destination waypoint is what gets checked against
each zone — so a segment whose target waypoint sits inside a zone is naturally exempt for
*that* zone (per the `to_id` check above), while a later segment continuing past that
waypoint toward a target outside the zone is not exempt, and is excluded from crossing back
into it.

## Testing

- Add cases to `client/tests/test_smooth_path.gd` (or a sibling test file) with a synthetic
  `combat_zones` value:
  - Path detours around a zone when the destination lies outside it.
  - Path routes directly through when the destination lies inside it (no exclusion).
  - Multi-waypoint chain: zone sits around waypoint 2; segment 1→2 is unaffected (waypoint 2
    is the destination), but a hypothetical continuing segment 2→3 (destination outside the
    zone) is excluded from re-entering it.
- No new server-side test needed beyond confirming `engagement_id` is present in the
  `COMBAT_STARTED`/`COMBAT_ENDED` payload shape, which existing `game-server` combat tests
  already assert against.

## Documentation

After implementation and verification, add a new section to `docs/PATHFINDING.md` (following
the existing style of "Shift-Move Road Avoidance" / "Neutral Territory Exclusion") describing
the combat-zone exclusion mechanism, its constants, and its interaction with multi-waypoint
chains.
