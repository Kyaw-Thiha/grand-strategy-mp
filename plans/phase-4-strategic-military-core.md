# Phase 4 — Strategic Military Core

## Context

Phases 1–3 complete. `GameRoomState` has skeleton `UnitState` and `ProvinceState`. Map renders correctly (89 provinces, 159 adjacency edges). Session loop (lobby → game → postgame) works. Division templates, combat, and supply do not yet exist. This plan implements the full strategic layer before the tactical 5×5 grid (Phase 5).

The phase is split into five independently-testable sub-phases, each with its own verification gate and bot script.

---

## Sub-phases Overview

| Sub-phase | Theme | Verification |
|-----------|-------|--------------|
| **4A** | Pipeline + Division Foundation + Road Movement | Divisions on map, move on roads |
| **4B** | Pathfinding + Move Order UX | A*, terrain restrictions, ghost dots, hotkeys |
| **4C** | Engagement + Combat + Province Capture | Two divisions fight, province captured |
| **4D** | Stacking + Three-Tier Supply/Encirclement | Stack rotates, encircled division destroyed |
| **4E** | Frontline System + Observation Stub | Colour wash renders, supply severs via influence |

---

## Key Design Decisions (settled in discussion)

1. **Unit terrain costs**: Static data file (`unit_terrain_costs.json`) with per-unit costs for each of 33 terrain combos (11 cover_combat × 3 elevation). Copied to both `game-server/src/data/` and `client/assets/data/`. Server computes movement profile at spawn, stores it in DivisionState, broadcasts to client once (not every tick). Client uses it for A*.

2. **Division movement profile formula**: `(min_cost × 0.4) + (mean_cost × 0.6)` per terrain. Hard impassable if ANY unit has ∞ cost.

3. **Default Phase 4 template**: Same template applied to all spawned divisions. Mixed composition: 10 `standard_infantry` + 4 `machine_gun` + 2 `light_artillery` = 16 cells → 0% armoured → Infantry division type.

4. **Starting positions** (`starting_positions.ts`): 8 divisions per playable nation. Germany and France positioned near Rhine/Maginot border for immediate testable combat. Non-playable neutral nations: 2 divisions at/near capital, server-controlled, stationary.
   - Germany: 8 divisions — cluster near Rhineland/Palatinate/Bavaria border + Rhine interior
   - France: 8 divisions — Maginot Line corridor + reserves near Paris/Lyon corridor
   - UK: 8 divisions — home islands + Channel coast
   - Italy: 8 divisions — Northern Italy + Po Valley + Rome area
   - Spain: 8 divisions — near Madrid, Barcelona, and southern provinces
   - Algeria: 8 divisions — near Algiers, Oran, Constantine
   - Non-playable neutrals (Netherlands, Belgium, Switzerland, etc.): 2 divisions near capital, stationary, neutral

5. **Simplified combat (Phase 4)**: Per tick, each division deals `base_rate × hp_fraction × type_multiplier × terrain_modifier` damage and suppression to the other. Values tunable by playtesting. Replaced entirely by the tactical grid in Phase 5 — Phase 4 combat is intentionally placeholder.

5b. **Division types — three only (no Defensive)**: Armoured (≥40% armoured cells), Motorised (15–39% armoured), Infantry (remainder). Division type is a derived UI label only — governs engagement radius and NATO icon symbol. Does NOT affect movement costs or combat stats.

5c. **Engagement radius — composition-based formula** (not a fixed constant per type):
```
base_radius       = 50  # infantry floor
armoured_fraction = armoured_cells / total_filled_cells
cavalry_fraction  = cavalry_cells  / total_filled_cells
radius = base_radius
       - (max(0, armoured_fraction - 0.15) / 0.10) * 5   # -5 per 10% armour above 15%
       - (cavalry_fraction / 0.10) * 2                    # -2 per 10% cavalry
radius = clamp(radius, 30, 50)
```
Approx results: pure infantry ≈ 50, motorised mix ≈ 42, heavy armoured ≈ 30. Recomputed on template save.

5d. **Angle-based flanking** (replaces simple multiplier): Classification set at the moment the second division's engagement area first overlaps — locked, not recalculated mid-combat.
- < 90° between attackers at defender: converging frontal assault — no bonus
- 90°–135°: FLANK_ATTACK → standard flanking bonus (% damage increase, exact % from playtesting)
- 135°–180°: REAR_ATTACK → enhanced flanking bonus (enemy facing away)
- Events: `FLANK_ATTACK { attacker_id, target_id, angle }` and `REAR_ATTACK { attacker_id, target_id, angle }` broadcast on classification

6. **Stacking — two modes**:
   - **Permanent positional stack**: Both units same-nation, both stationary (speed < threshold), distance < stack_threshold → assign shared `stack_id`, ordered by arrival time. Full stack rotation mechanics apply.
   - **Combat-only temporary grouping**: Two moving friendly units both engage same enemy → `combat_group_id` tracks coordination for that combat only. NOT a positional stack. Flanking CAN apply if they approach from genuinely different directions (angle > threshold). After combat, each resumes its own move order.

7. **Province capture**: Capturing division must be within `capture_radius` of city node coordinates (threshold leeway for zoom-out). If any enemy division's engagement area overlaps the city node, that enemy is considered "defending city" — capture blocked until the defender is retreated or destroyed.

8. **Scouting (Phase 4)**: Stub only. Server filters division position data per-player by observation radius. Hover over enemy dot within scouting radius shows "?" or basic category counts. Full composition reveal deferred to Phase 5. Update `DEV_PHASES.md` to note this.

9. **Frontline distance falloff**: Linear: `1 - (distance / max_distance)`. Quadratic option deferred to playtesting.

10. **LERP smoothing (client)**: No client-side prediction. Visual positions lerp toward server positions at 10× speed in `_process(delta)`. Snap directly if distance > snap_threshold (handles redeployments). Same lerp for HP bars, suppression bars, influence values.

11. **DATA_CONTRACTS.md**: Update `MOVE_UNIT` command to `SUBMIT_MOVE_ORDER` with waypoint array as part of 4A. Update `UnitState` schema to `DivisionState`. Add all new events.

12. **Encirclement detection algorithm** (from STRATEGIC_COMBAT.md):
    - Tier 1 OUT_OF_SUPPLY: BFS on waypoint graph toward supply hub, edges valid if influence ≥ 50% friendly. No path → out of supply.
    - Tier 2 CUT_OFF: BFS in any direction for friendly-influenced territory. No escape → cut off. Retreat now triggers fighting withdrawal (HP damage proportional to enemy influence along escape path).
    - Tier 3 ENCIRCLED: Sample 8 directions from division centre. All 8 blocked by enemy engagement area overlap OR ≥70% enemy influence → encircled. Retreat disabled. Status degrades one tier at a time only.

---

## Files Reference

### New data files
- `game-server/src/data/unit_terrain_costs.ts`
- `client/assets/data/unit_terrain_costs.json` (same data, Godot-readable)
- `game-server/src/data/maps/western_europe_6/starting_positions.ts`
- `game-server/src/data/maps/western_europe_6/nation_config.ts`
- `game-server/src/data/maps/western_europe_6/default_template.ts`

### Modified server files
- `game-server/src/rooms/schema/GameRoomState.ts` — expand `UnitState` to full `DivisionState`
- `game-server/src/rooms/GameRoom.ts` — game loop tick, Phase 4 handlers

### New server system files
- `game-server/src/systems/movement_system.ts`
- `game-server/src/systems/combat_system.ts`
- `game-server/src/systems/supply_system.ts`
- `game-server/src/systems/frontline_system.ts`

### Pipeline
- `map/tools/map_pipeline/pipeline.py` — add `generate_waypoints()` step (after adjacency build, step ~5), write separate `waypoints.json`

### New client files
- `client/src/systems/military/military_system.gd`
- `client/src/systems/military/pathfinder.gd`
- `client/src/systems/military/combat_system.gd`
- `client/src/systems/military/frontline_renderer.gd`
- `client/src/systems/military/notification_system.gd`
- `client/src/systems/military/stack_ui.gd`
- `client/scenes/systems/military/division_icon.tscn`
- `client/scenes/systems/military/combat_icon.tscn`

### Modified client files
- `client/src/core/game_state.gd` — add `divisions: Dictionary`, division getters
- `client/src/core/event_bus.gd` — add Phase 4 signals
- `client/src/systems/map/map_loader.gd` — load `waypoints.json`
- `client/src/systems/map/map_renderer.gd` — baseline colour flip on PROVINCE_CAPTURED

### Updated docs
- `docs/DATA_CONTRACTS.md` — `SUBMIT_MOVE_ORDER`, `DivisionState` schema, all Phase 4 events
- `docs/DEV_PHASES.md` — mark scouting composition reveal as deferred to Phase 5

---

## Phase 4A — Pipeline + Division Foundation + Road Movement

**Goal**: Waypoints generated. Divisions spawn on game start, render on map, move on roads.

### Pipeline (`pipeline.py`)

Add `generate_waypoints()` after the adjacency build step. Output: separate `client/assets/data/<map_id>/waypoints.json`.

```
Input:  cover.geojson, elevation.geojson, rivers.geojson, roads.geojson, base_water.geojson
Output: waypoints.json
```

Schema:
```json
{
  "nodes": [
    { "id": "wp_0001", "lng": 7.12, "lat": 50.77, "cover_combat": "light_forest", "elevation": "hills" }
  ],
  "edges": [
    { "from": "wp_0001", "to": "wp_0002", "base_cost": 1.05, "river_size": null }
  ],
  "road_connections": [
    { "road_node_id": "rn_a1_001", "waypoint_id": "wp_0001" }
  ]
}
```

`base_cost` = `cover_move × elevation_move` from MAP_DATA_CONTRACT composable table.
Sample at ~750m intervals. Skip cells covered by base_water. Flag river-crossing edges.
Print waypoint node count in pipeline summary alongside province count.

### Server: Schema

Expand `UnitState` in `GameRoomState.ts` to full `DivisionState`. Key new fields:

```typescript
@type("string") division_id: string
@type("string") nation_id: string
@type("string") division_type: string        // "armoured"|"motorised"|"infantry"
@type("number") position_lng: number
@type("number") position_lat: number
@type("number") hp: number                   // 0–100
@type("number") suppression: number          // 0–100
@type("string") combat_state: string         // "idle"|"engaged"|"suppressed"|"retreating"|"destroyed"
@type("string") supply_status: string        // "normal"|"out_of_supply"|"cut_off"|"encircled"
@type("number") observation_radius: number
@type("number") engagement_radius: number    // computed from template composition at spawn/template change
@type("string") movement_profile_json: string  // JSON of 33-value table, sent once on change
@type(["string"]) move_order: ArraySchema<string>  // ordered waypoint/road node IDs
@type("string") stack_id: string             // "" if not stacked
@type("number") stack_position: number       // 0 = front
@type("string") attacker_role: string        // "attacker"|"defender"|"meeting"|""
@type(["string"]) engaged_with: ArraySchema<string>
```

Retain existing `UnitState` name or rename; keep existing skeleton maps (`units`, `provinces`, etc.) — just expand.

### Server: Data files

`unit_terrain_costs.ts` — define costs for each unit type × 33 terrain combos:
```typescript
export const UNIT_TERRAIN_COSTS: Record<string, Record<string, number>> = {
  standard_infantry: { plains_flat: 1.0, plains_hills: 1.4, ..., glacier_mountains: Infinity },
  machine_gun:       { ... },
  light_artillery:   { ... },
  light_tank:        { plains_flat: 0.9, ..., dense_forest_flat: Infinity, ... },
  // etc.
}
```

`nation_config.ts` — defines unit availability per nation (all same for western_europe_6):
```typescript
export const NATION_CONFIG = {
  available_units: ["standard_infantry", "machine_gun", "light_artillery", "light_tank"],
  cavalry_available: true,
  research_starting_unlocks: [],
}
```

`default_template.ts` — 10 standard_infantry + 4 machine_gun + 2 light_artillery in 5×5 grid positions.

`starting_positions.ts` — per-nation spawn configs with historical WGS84 coordinates.

### Server: Movement system (`movement_system.ts`)

```typescript
computeMovementProfile(template, unitTerrainCosts) → number[33]
classifyDivisionType(template) → "armoured"|"motorised"|"infantry"
computeObservationRadius(template) → number  // max of recon units; baseline if none
computeEngagementRadius(template) → number   // composition-based formula (see Key Design Decision 5c)
tickMovement(divisions, roadGraph, waypointGraph, dt)  // advance each division along move_order
```

Observation radius baseline (no recon units): 100 map units. Engagement radius: computed per template via formula — pure infantry ≈ 50, heavy armoured ≈ 30, clamp [30, 50].

### Server: GameRoom handlers (4A)

- `onGameStart()` — read `starting_positions.ts`, spawn DivisionState objects into `state.units` map
- `SUBMIT_MOVE_ORDER { division_id, waypoints: string[] }` — validate that division belongs to sender's nation; validate path (each consecutive pair is a valid edge in road or waypoint graph); set `division.move_order`
- `HOLD { division_id }` — clear `division.move_order`
- Game loop: `this.clock.setInterval(() => this.gameTick(), 1000)`. 4A tick only calls `movementSystem.tick()`.

### Client (4A)

**`game_state.gd`**: Add `divisions: Dictionary` (division_id → division data dict). Update `_apply_server_delta()` to populate it. Add getters: `get_division(id)`, `get_my_divisions()`, `get_divisions_for_nation(nation_id)`.

**`event_bus.gd`**: Add signals: `division_added(division_id)`, `division_updated(division_id)`, `division_removed(division_id)`.

**`map_loader.gd`**: Load `waypoints.json` alongside existing files. Expose `get_waypoint_graph()` returning node and edge arrays.

**`military_system.gd`** (4A scope only):
- On `division_added`: instantiate `division_icon.tscn` at server position
- In `_process(delta)`: LERP all division icon positions toward server positions
- Render NATO rectangle icon (Infantry symbol for now), HP bar below
- Render engagement circle (solid, small) and observation circle (faded, larger)
- Click detection: select division → highlight, show radii, display info panel stub

**`division_icon.tscn`**: Node2D with Sprite2D (NATO rectangle), Label (nation initial), ProgressBar (HP), Circle2D nodes for engagement/observation areas.

### Verification gate (4A)

1. Run pipeline → `waypoints.json` generated, count printed in summary
2. Start game with 2 players → all 6 nations' divisions appear at correct starting positions
3. Select Germany division near Rhine → press M → click road junction in France → division moves along road
4. HP bar and engagement/observation circles visible on all division icons

**Bot script**: `game-server/test/4a-divisions.e2e.ts`
- Join as bot → wait for GAME_STARTED → assert 6 playable nations × 8 divisions + non-playable neutrals × 2 divisions exist in state
- Send `SUBMIT_MOVE_ORDER` for own division with 3 road waypoints → assert position advances after 3 ticks

---

## Phase 4B — Pathfinding + Move Order UX

**Goal**: Full A* over the unified road + waypoint graph. All move UX implemented.

### Client: `pathfinder.gd`

Builds unified graph from `map_loader.get_waypoint_graph()` + roads (via `road_connections`). Runs A* at request time with division's movement profile as edge cost multiplier. Returns ordered node ID list.

Key rules:
- Road edges: very low base cost (all divisions use roads at road speed)
- Waypoint edges: `base_cost × movement_profile[cover_combat][elevation]`
- Edge excluded from search if movement_profile value is Infinity (impassable)
- River-flagged edges: multiply cost by `river_crossing_penalty[river_size]`
- Heuristic: Euclidean distance to goal in map coordinates

### Client: Move UX (in `military_system.gd`)

Move mode state machine:
```
IDLE → (select division) → SELECTED → (press M) → MOVE_MODE
MOVE_MODE → (single click) → pathfind, submit SUBMIT_MOVE_ORDER, → IDLE
MOVE_MODE → (shift+click) → add waypoint to chain, stay in MOVE_MODE
MOVE_MODE → (escape) → clear pending waypoints, → IDLE
MOVE_MODE → (right-click waypoint ghost) → delete waypoint from chain
SELECTED → (click moving division) → show remaining waypoints, re-enter MOVE_MODE
```

Ghost dot rendering: At each waypoint in the chain, render faded division icon + faded engagement circle. On hover of ghost dot: show observation radius faintly + tooltip with estimated arrival time (`distance_remaining / division_speed`). Ghost dots visible to owner and allies only; enemy/neutral see them only if within their own observation radius.

Hotkeys (all via `InputMap`, remappable):
- Panel: Q=Military, E=Economy, R=Diplomacy, F=Politics, Tab=toggle panels, Escape=close/cancel
- Unit (when selected): M=Move, H=Hold, G=Retreat, X=Cancel orders
- Modifier: Shift+click=add waypoint in move mode

### Server: Path validation

`SUBMIT_MOVE_ORDER` now validates off-road waypoint edges against `division.movement_profile_json`. Any edge that is impassable for the division type → reject with error event. Client shows rejection notification.

### Server: Off-road movement tick

When division's current move_order waypoint is a waypoint node (not road node), advance at:
`speed = base_speed × (1 / movement_profile[edge.cover_combat][edge.elevation])`

Movement order persistence: Division in combat keeps its move_order. After combat resolves (if not retreated/destroyed), automatically resumes from current position.

Defender status lock: Move order issued to a defending division mid-combat does NOT reclassify it as attacker.

### Verification gate (4B)

1. Infantry division: draw off-road route through light_forest → accepted, division advances
2. Armoured division: attempt route through dense_forest off-road → rejected by server
3. Same armoured division: route through dense_forest VIA ROAD → accepted
4. Shift+click builds waypoint chain → ghost dots appear at each waypoint
5. Escape cancels move mode, ghost dots disappear
6. Right-click ghost dot → removes that waypoint from chain
7. Hotkeys Q/E/R/F/Tab/Escape work for panels; M/H/G/X work when division selected

**Bot script**: `game-server/test/4b-pathfinding.e2e.ts`
- Submit valid infantry off-road path through light_forest → assert accepted
- Submit armoured path through dense_forest off-road → assert rejected with error event
- Submit road-only armoured path through same area → assert accepted

---

## Phase 4C — Engagement + Combat + Province Capture

**Goal**: Divisions fight, combat resolves via simplified model, provinces can be captured.

### Server: Engagement detection (`combat_system.ts`)

Each game tick:
- For each pair of divisions from different nations: check `distance(a, b) ≤ a.engagement_radius + b.engagement_radius`
- If fully overlapping and not already engaged: determine attacker/defender, fire COMBAT_STARTED

**Attacker/defender determination (4-tier)**:
1. Explicit orders: ADVANCE order vs HOLD order → clear winner
2. Movement vector: angle between movement vector and intercept line < 45° → attacker
3. Both advancing toward each other → MEETING_BATTLE (neither gets terrain bonus)
4. Tie-breaker: nation with fewer provinces is defender

**Terrain modifiers** (applied at combat initiation, not per tick):
- Read `provinces[midpoint_province].terrain_elevation` and `terrain_cover` → derive cover_combat via terrain_lookup
- `attacker_penalty = elevation_atk + cover_atk` (from MAP_DATA_CONTRACT composable table)
- `defender_bonus = elevation_def + cover_def`
- Transition modifier: compare attacker terrain tier vs midpoint tier (3-value lookup: better/same/worse)

**River crossing check** (at initiation, NOT per tick):
- Check if segment between division centres intersects any river in `rivers.geojson`
- If yes: apply crossing penalty to attacker for rounds 1–2 (minor) or 1–3 (major)

### Server: Simplified combat resolution

Per tick while `combat_state == "engaged"`:
```typescript
const dealt = base_attrition_rate 
            × (division.hp / 100)          // weaker divisions deal less
            × type_multiplier[division.division_type]
            × terrain_modifier
            - crossing_penalty_if_active

target.hp         -= dealt * hp_damage_fraction
target.suppression += dealt * suppression_fraction
```

`type_multiplier`: armoured=1.4, motorised=1.2, infantry=1.0 (tunable; no Defensive type).

**Auto-retreat triggers**:
- Defender: suppression ≥ 60% AND retreat path exists → auto-retreat
- Attacker: suppression ≥ 80% AND escape route exists → auto-retreat
- Manual RETREAT command always available regardless of suppression level
- Encirclement (Tier 3) disables auto-retreat entirely

**Retreat movement**: Division assigned a retreat waypoint path toward nearest friendly node. `combat_state = "retreating"`. Suppression decays 2–3× faster during retreat. HP damage stops (unless pursuit fire — deferred to later polish).

### Server: Stacking

**Permanent positional stack**:
- Each tick: check pairs of same-nation divisions with `distance < stack_threshold` AND both `speed < stationary_threshold`
- Assign shared `stack_id` (UUID), set `stack_position` by arrival order
- Only division at `stack_position == 0` is the active combatant
- On front division suppression ≥ threshold: rotate (increment all stack_positions, wrap front to back) → STACK_ROTATION event

**Combat-only temporary grouping**:
- Two moving friendly units engage same enemy → track via `engaged_with` IDs
- Flanking applies if their positions are ≥ flanking_angle apart from enemy's perspective
- After combat: no stack assigned; each resumes its own move_order

### Server: Province capture

Each tick: for divisions with `combat_state == "idle"` or "engaged":
- Check `distance(division.position, province.city_position) ≤ capture_radius` (e.g., 20 map units)
- Check no enemy division has engagement area overlapping city: `distance(enemy.position, city) ≤ enemy.engagement_radius`
- If within range AND no defender overlapping city AND division.nation ≠ province.owner:
  - `province.owner_id = division.nation_id`
  - Fire `PROVINCE_CAPTURED { province_id, new_owner_id, old_owner_id }`

### Server: Flanking (angle-based)

When a second enemy division's engagement area overlaps a division already engaged:
1. Compute angle at defender between line-to-attacker-1 and line-to-attacker-2 (dot product of the two unit vectors)
2. Classify at the moment of second contact — **locked, not updated mid-combat** (prevents bonus loss from minor positional drift)

| Angle | Classification | Action |
|-------|----------------|--------|
| < 90° | Converging frontal assault | No bonus; weight of numbers only |
| 90°–135° | Flank attack | Apply `flank_damage_bonus` multiplier to second attacker; fire `FLANK_ATTACK` event |
| 135°–180° | Rear attack (deep flank) | Apply `rear_damage_bonus` multiplier (higher than flank); fire `REAR_ATTACK` event |

- `FLANK_ATTACK { attacker_id, target_id, angle }` and `REAR_ATTACK { attacker_id, target_id, angle }` broadcast to all players
- If the flanking division is itself engaged by a friendly ally → redirects to new threat (relief mechanic)

### Client: `combat_system.gd`

On `COMBAT_STARTED`: spawn `combat_icon.tscn` between the two division positions. Show Engaged or Meeting Battle icon variant (two arrows meeting head-on, distinct from standard crossed-swords). HP bar and suppression pulse (amber border → red border as threshold approaches).

On `FLANK_ATTACK`: add small diagonal arrow indicator on the flanking division dot.
On `REAR_ATTACK`: add double diagonal arrow indicator on the flanking division dot.
On `COMBAT_RESULT` / `UNIT_DESTROYED`: update icons, remove destroyed division icon.
On `PROVINCE_CAPTURED`: trigger `MapRenderer.update_province_owner(province_id, new_owner_id)`.

**Division dot status indicators** (stackable, all rendered in `military_system.gd`):
- Engaged: subtle pulse on division dot; combat icon over engagement point
- Retreating: retreat arrow on dot pointing direction of withdrawal
- Redeploying (future): dot greyed out with gear symbol

**Engagement area rendering** (in `division_icon.tscn`):
- Own engagement area: solid circle
- Enemy engagement areas: faded/dashed circle — visible to all players; essential for judging flanking angle before committing
- Observation area: larger faded circle, always outside engagement area
- (Scouting range innermost circle — hover-only, deferred to 4E)

### Client: `notification_system.gd` (4C scope)

Simple toast queue. Notifications for: COMBAT_STARTED (for own divisions), PROVINCE_CAPTURED (for own provinces), UNIT_DESTROYED (for own divisions), suppression threshold warning.

### Verification gate (4C)

1. Germany and France divisions advance → engagement areas overlap → COMBAT_STARTED fires → combat icon appears
2. Enemy engagement area visible as faded/dashed circle before contact — own division can see it before entering
3. Terrain bonus: France division holding Alsace hills → Germany attacker takes terrain penalty
4. Meeting battle: both advance head-on → Meeting Battle icon (two-arrows, not crossed-swords)
5. Both advance, Germany pushes France to 60% suppression → France auto-retreats
6. Attacker holds until 80% suppression, then auto-retreats
7. Germany division advances to undefended French city within capture_radius → PROVINCE_CAPTURED
8. French defending division in city range → Germany cannot capture until defender retreats
9. Second German division approaches already-engaged French at 85° → no flanking bonus, no event
10. Reposition second German to 95° → FLANK_ATTACK fires → diagonal arrow on attacker dot → standard bonus applied
11. Reposition second German to 140° → REAR_ATTACK fires → double diagonal arrow → enhanced bonus applied
12. Angle locked at first contact — minor drift during combat does NOT change the bonus tier

**Bot script**: `game-server/test/4c-combat.e2e.ts`
- Two bots on opposing nations, advance to contact → assert COMBAT_STARTED
- Wait for suppression threshold → assert auto-retreat fires
- Advance to undefended city → assert PROVINCE_CAPTURED

---

## Phase 4D — Stacking + Three-Tier Supply/Encirclement

**Goal**: Stack rotation mechanics, three-tier supply/encirclement, encircled division destroyed.

### Server: Stack mechanics (expand `combat_system.ts`)

- Only `stack_position == 0` division engages enemy
- On position-0 suppression ≥ threshold: increment all stack_positions, wrap front to back. Fire STACK_ROTATION. Next division (new position 0) becomes active combatant.
- Actual retreat only when the LAST division (position = max) hits threshold
- Supply priority: supply distributed to stack_position 0 first, overflow to subsequent positions

Stack reordering command: `REORDER_STACK { stack_id, new_order: string[] }` — allowed when NOT engaged.

Encirclement applies to whole stack: all divisions in the stack are Tier 3 encircled together.

### Server: Supply and encirclement system (`supply_system.ts`)

Runs every N ticks (same interval as supply tick, e.g., every 5 seconds):

```typescript
// Tier 1: OUT_OF_SUPPLY
const supplyPath = waypointGraphSearch({
  start: division.position,
  goalPredicate: (node) => nodeHasSupplyHub(node, friendlyNation),
  edgeValid: (edge) => getInfluence(edge, friendlyNation) >= 0.50
})
if (!supplyPath) division.supply_status = "out_of_supply"

// Tier 2: CUT_OFF (only if already out_of_supply)
const escapePath = waypointGraphSearch({
  start: division.position,
  goalPredicate: (node) => isFriendlyInfluencedBoundary(node, friendlyNation),
  edgeValid: () => true  // any edge — cost proportional to enemy influence
})
if (!escapePath) division.supply_status = "cut_off"

// Tier 3: ENCIRCLED (only if already cut_off)
const DIRECTIONS = [N, NE, E, SE, S, SW, W, NW]
const blockedCount = DIRECTIONS.filter(dir => {
  const samplePoint = offset(division.position, dir, division.engagement_radius)
  return enemyDivisionOverlaps(samplePoint) || getEnemyInfluence(samplePoint) >= 0.70
}).length
if (blockedCount === 8) division.supply_status = "encircled"

// Status can only degrade one tier per check
```

**Debuffs applied per supply tick**:

Tier 1 (out_of_supply):
- HP recovery rate → 0
- Suppression threshold degrades by small amount per tick
- Movement speed multiplied by 0.7

Tier 2 (cut_off): All Tier 1 debuffs. Retreat path calculated through enemy-influenced ground — during retreat movement, division takes HP damage = `enemy_influence_density × fighting_withdrawal_rate`.

Tier 3 (encircled): All Tier 2 debuffs. Retreat command disabled. Additionally:
- Armoured units: `damage_output_multiplier -= armour_decay_rate_per_tick` (floor 0, after ~8–10 ticks)
- Infantry units: `suppression_threshold -= infantry_decay_rate_per_tick` (slower than armour)
- When last stack division hits suppression threshold → `combat_state = "destroyed"`, fire UNIT_DESTROYED

**Events**: OUT_OF_SUPPLY, CUT_OFF, DIVISION_ENCIRCLED (when reaching Tier 3), STACK_ROTATION, SUPPLY_SEVERED_FRONTLINE, SUPPLY_RESTORED_FRONTLINE (when status improves).

### Client (4D)

**`stack_ui.gd`**: When a stack selected, show ordered list panel. Drag-to-reorder sends REORDER_STACK (blocked if engaged). Show "FRONT" badge on position 0.

**Division icon updates** (in `military_system.gd`):
- Tier 1 (out_of_supply): small amber supply icon below division dot
- Tier 2 (cut_off): supply icon turns red + broken chain symbol
- Tier 3 (encircled): red ring around division dot — most dominant indicator, always on top

**`notification_system.gd` additions**: Stack rotation toast, encirclement warning, supply severed, cut off warning.

### Verification gate (4D)

1. Two German divisions placed at same position → form permanent positional stack → stack UI shows order
2. Stack front division engages → hits 60% suppression → rotates to back → second steps forward → combat continues
3. Last stack division suppressed with no escape route → Tier 3 ENCIRCLED fires → armoured damage decays over ticks → division destroyed (not retreated)
4. Single division advancing beyond friendly influence → Tier 1 OUT_OF_SUPPLY fires → attrition begins
5. Enemy flanking cuts all influence paths → Tier 2 CUT_OFF fires → retreat triggers fighting withdrawal (division takes HP damage moving)
6. All 8 directions blocked at ≥70% enemy influence → Tier 3 fires → retreat disabled

**Bot script**: `game-server/test/4d-encirclement.e2e.ts`
- Bot surrounds a single division using 4 bot divisions → assert three-tier progression fires in order
- Assert encircled division destroyed after suppression threshold reached

---

## Phase 4E — Frontline System + Observation Stub

**Goal**: Province colour wash renders, supply connectivity via influence works, scouting stubbed.

### Server: Frontline system (`frontline_system.ts`)

Runs same interval as supply tick (every 5–10 seconds):

```typescript
for each province:
  total_influence = 0
  nation_shares = {}
  
  for each nation:
    // Unit-based influence
    unit_inf = sum(
      division.hp / 100 * linearFalloff(division.position, province)
      for division of this nation where engagementAreaOverlaps(division, province)
      if division is NOT purely recon
    )
    // Ownership bonus (fixed scalar, tunable)
    owner_bonus = (province.owner_id == nation) ? OWNERSHIP_BONUS : 0
    
    province_influence[nation] = unit_inf + owner_bonus
    total_influence += province_influence[nation]
  
  for each nation:
    nation_shares[nation] = province_influence[nation] / max(total_influence, 0.001)
  
  broadcast FRONTLINE_UPDATED { province_id, nation_shares }
```

`linearFalloff(divisionPos, province)`: `1 - distance(divisionPos, province.centroid) / max_falloff_distance`. Clamped 0–1.

**City capture influence handling**: On PROVINCE_CAPTURED, ownership_bonus immediately flips to new owner. Previous owner retains unit-based influence from wherever their units still are — frontline does NOT snap to fully-new-owner-coloured instantly.

**Per-player visibility filtering**: Server already filters DivisionState broadcast by observation radius (done in 4A). Neutral nations receive the same FRONTLINE_UPDATED payload (province-level scalars only) but do NOT receive enemy division position data outside their observation areas.

**Scouting stub**: Server computes `scouting_radius` per division (max of recon units' scouting range; baseline if none). On client requesting hover info for enemy division within scouting radius: return category counts string (e.g. "2 armoured, 10 infantry"). Composition detail deferred — add note in DEV_PHASES.md: "Full scouting composition reveal deferred to Phase 5."

### Client: `frontline_renderer.gd`

Subscribes to FRONTLINE_UPDATED. For each province:
- Lerp `influence_values[province_id][nation]` toward received values (smooth transition)
- Drive province fill shader: `mix(owner_colour, dominant_foreign_colour, foreign_share)`
- Isoline at 50% threshold: compute crossing point within province polygon, draw as smoothed Line2D (Catmull-Rom spline with 4+ control points per segment)

Province borders remain static Line2D nodes — never updated.

### Client: `map_renderer.gd` update

On `EventBus.province_captured(province_id, new_owner_id)`: update the province node's baseline colour to `new_owner_id`'s predefined colour. `FrontlineRenderer` continues to overlay influence wash on top.

### Update docs

`docs/DATA_CONTRACTS.md`:
- Replace `MOVE_UNIT { unit_id, target_province_id }` with `SUBMIT_MOVE_ORDER { division_id, waypoints: string[] }`
- Add `DivisionState` schema replacing old `UnitState` skeleton
- Add all Phase 4 events: COMBAT_STARTED, COMBAT_RESULT, MEETING_BATTLE_STARTED, PROVINCE_CAPTURED, UNIT_DESTROYED, STACK_ROTATION, OUT_OF_SUPPLY, CUT_OFF, DIVISION_ENCIRCLED, SUPPLY_SEVERED_FRONTLINE, SUPPLY_RESTORED_FRONTLINE, FRONTLINE_UPDATED, FLANK_ATTACK, REAR_ATTACK

`docs/DEV_PHASES.md`: Mark scouting composition reveal as deferred to Phase 5, add stub note.

### Verification gate (4E)

1. German division advances into French province → province interior colour starts bleeding toward Germany grey
2. French division holds in same province → both nations' influence shown simultaneously; frontline isoline sits where forces balance
3. Division takes HP damage → colour intensity fades proportionally (hp_fraction drives it)
4. Recon-only division advances → does NOT shift province colour (recon excluded from influence)
5. Province captured → baseline colour flips instantly to new owner → previous owner's unit influence persists where their units are → smooth transition, not instant snap
6. Enemy armoured advance cuts influence chain between division and supply hub → SUPPLY_SEVERED_FRONTLINE fires → OUT_OF_SUPPLY begins
7. Neutral player: sees colour wash on map, does NOT see enemy division dots outside their observation radius

**Bot script**: `game-server/test/4e-frontline.e2e.ts`
- Advance bot divisions → assert FRONTLINE_UPDATED events with increasing nation_share for advancing nation
- Assert province capture: flip in ownership_bonus reflected in next FRONTLINE_UPDATED

---

## Game Loop Architecture

```typescript
// GameRoom.ts onCreate():
const TICK_MS = 1000
this.clock.setInterval(() => this.gameTick(), TICK_MS)

// Supply/frontline run every N ticks (e.g., every 5 ticks = 5 seconds)
private tickCount = 0

private gameTick() {
  if (this.state.phase !== "running") return
  this.tickCount++
  
  movementSystem.tick(this.state, this.mapData)         // every tick
  combatSystem.tick(this.state, this.mapData)           // every tick
  
  if (this.tickCount % SUPPLY_TICK_INTERVAL === 0) {
    supplySystem.tick(this.state, this.mapData)         // every N ticks
    frontlineSystem.tick(this.state, this.mapData)      // every N ticks
  }
}
```

---

## Bot Test Scripts Summary

| Script | Phase | Tests |
|--------|-------|-------|
| `game-server/test/4a-divisions.e2e.ts` | 4A | Divisions spawn, move order accepted, position advances |
| `game-server/test/4b-pathfinding.e2e.ts` | 4B | Valid off-road path accepted, impassable path rejected |
| `game-server/test/4c-combat.e2e.ts` | 4C | Combat starts, auto-retreat fires, province captured |
| `game-server/test/4d-encirclement.e2e.ts` | 4D | Three-tier progression, encircled division destroyed |
| `game-server/test/4e-frontline.e2e.ts` | 4E | FRONTLINE_UPDATED values correct, scouting stub |

---

## Open Questions (deferred to playtesting)

- Exact attrition rates per tick (HP damage, suppression damage)
- `base_attrition_rate` value and `type_multiplier` constants
- `OWNERSHIP_BONUS` scalar (tunable: large enough to matter, small enough attacker force can overcome)
- Stack collapse threshold distance (for macro zoom)
- Waypoint sampling interval (targeting ~750m)
- Supply tick interval (targeting 5–10 seconds game time)
- Frontline smoothing parameters (Catmull-Rom tension)
- `capture_radius` exact value
- `stack_threshold` distance (when to auto-form positional stack)
- `flank_damage_bonus` multiplier (standard 90°–135° flank — qualitatively confirmed, exact % from playtesting)
- `rear_damage_bonus` multiplier (enhanced 135°–180° rear attack — higher than flank, exact % from playtesting)
- Armour decay rate (target: meaningful degradation 3–5 ticks, zero output 8–10 ticks)
