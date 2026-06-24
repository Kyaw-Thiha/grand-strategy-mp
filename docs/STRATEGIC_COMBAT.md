# Grand Strategy Multiplayer — Strategic Combat Design

> Confirmed design decisions for the strategic layer of combat.
> Last updated: June 2026.
> Tactical combat detail is in TACTICAL_COMBAT.md.
> Air combat detail is in AIR_COMBAT.md.
> Naval combat detail is in NAVAL_COMBAT.md.

---

## Movement System

### Core Model: Free Movement with Road Priority

Units move freely across the map but road network is the dominant factor in all movement,
supply, and strategic planning.

**On-road movement:**
- Road level dictates exact movement speed (dirt track → paved road → highway)
- Fastest possible movement is always on roads
- Roads are the only viable route for supply (see Supply System)
- On-road movement uses the road graph directly — all division types move at road speed;
  individual unit speed differences only matter off-road

**Off-road movement:**
- Off-road speed uses a weighted formula: `speed = (min_unit_speed × 0.4) + (mean_unit_speed × 0.6)`
- The slowest unit pulls the division down but does not cap it entirely — adding one slow
  unit meaningfully reduces speed without making the division as slow as that unit alone
- This is per terrain combination: the formula is applied using each unit's cost for that
  specific terrain, stored in the pre-computed movement profile (see Division Movement Profile)
- Impassability remains a hard binary: if any unit has impassable cost (∞) for a terrain,
  the whole division's profile entry for that terrain is ∞ — the weighted formula does not apply
- Dense forest, jungle, swamp, glacier: impassable off-road for armoured and heavy units
- Mountains: impassable off-road for all non-infantry division types (road only)
- All divisions are slower off-road than on-road in any terrain

**Strategic implication:** Roads are primary objectives. Key junctions, mountain passes, and
bridges are naturally high-value targets — capturing or destroying them has cascading
logistical consequences. Adding slow support units (artillery, heavy AT) costs operational
speed — a deliberate combined-arms tradeoff, not a binary penalty.

### Division Movement Profile

Each division template has a pre-computed **movement profile** — a lookup table of 33 values
(11 cover_combat groups × 3 elevation bands) representing the movement cost per terrain
combination for that specific template.

**How it is computed:**
```
for each terrain_combination in (cover_combat × elevation):
    costs = [unit.terrain_cost[terrain_combination] for unit in template.filled_cells]
    if any(c == infinity for c in costs):
        profile[terrain_combination] = infinity          # hard impassable — any unit blocks
    else:
        min_cost  = min(costs)
        mean_cost = sum(costs) / len(costs)
        profile[terrain_combination] = (min_cost * 0.4) + (mean_cost * 0.6)
```

The weighted formula `(min × 0.4) + (mean × 0.6)` is intuitive: a player can mentally
estimate their speed as "pulled toward the slowest unit but not fully capped by it."
Impassability remains a hard binary — if any single unit cannot enter a terrain, the whole
division cannot enter it off-road. The weighted formula only applies to passable terrain.

**When it is computed:**
- When a template is first saved or edited in the division builder
- When a research upgrade changes any unit type's terrain cost profile
- Once computed, it is cached — pathfinding uses the cached profile with O(1) lookup per
  waypoint graph edge

**Why this approach:**
- Division type taxonomies (armoured/infantry/motorised/defensive) are UI labels only,
  determining engagement radius and icon symbol. They do not govern movement costs.
- Movement costs come entirely from the composition of the template. A division with 6
  light tanks + 12 infantry has a different profile from one with 6 heavy tanks + 12
  infantry, even if both are classified as "armoured."
- Research upgrades that improve a specific unit's terrain costs automatically propagate
  to the movement profile on next recomputation. No new division types needed.

**Division type classification (engagement radius only):**
Three types, derived from template composition. No "Defensive" type — division type
is purely a derived label for engagement radius and map icon; it does not affect
movement costs or combat stats.

- Armoured cells (light/medium/heavy tank, armoured car) >= 40% of filled cells:
  **Armoured division** — smallest engagement radius (precision instrument; player
  controls exactly when it commits; tight footprint avoids accidental engagements)
- Armoured cells 15–39%: **Motorised/mixed division** — medium radius
- Otherwise: **Infantry division** — largest engagement radius (holds wide front
  line; forward scouts range far; makes contact earliest on broad front)

**Why infantry has the largest radius:** Infantry spreads across terrain and
maintains a wide screen. Armoured divisions concentrate combat power and choose
when to commit — a small radius gives the player that deliberate control. A large
armoured radius would cause accidental engagements mid-manoeuvre and make flanking
moves harder (the flanking division clips the enemy's engagement area too early).

**Engagement radius formula (composition-based, tunable):**
```
base_radius        = 50  # infantry floor (map units)
armoured_fraction  = armoured_cells / total_filled_cells
cavalry_fraction   = cavalry_cells  / total_filled_cells

radius = base_radius
       - (max(0, armoured_fraction - 0.15) / 0.10) * 5   # -5 per 10% armour above 15%
       - (cavalry_fraction / 0.10) * 2                    # -2 per 10% cavalry
radius = clamp(radius, 30, 50)                            # floor 30, ceiling 50
```

Approximate results:
- Pure infantry template: ~50 map units
- Motorised mix (25% armoured): ~42 map units
- Heavy armoured (60% armoured): ~30 map units (floor)

Recomputed whenever the template is saved — same trigger as the movement profile.

### Pathfinding Architecture

Client-side bidirectional A* over a two-level unified graph. Server validates the submitted
path. Full implementation reference: `docs/PATHFINDING.md`.

**Level 1 — Road graph:** Road network from `roads.geojson`. Road edges have a fixed low
cost (0.05/deg); road_level governs animation speed, not pathfinding cost. All division
types use the road graph identically.

**Level 2 — Waypoint graph:** A non-uniform terrain grid pre-baked by the pipeline,
stored in `waypoints.json`. Three density tiers: open terrain (~22 km spacing), medium
complexity (~11 km), dense/complex (~7.5 km). Each node stores `cover_combat` and
`elevation`; each edge stores `base_cost = cover_move × elevation_move`.

**At pathfinding time:**
`edge_cost = base_cost × division_movement_profile[terrain]`. Impassable terrain
(`profile_cost == INF`) is excluded from the search entirely.

**Two-phase routing:** Pathfinding runs an off-road purity pre-check, then a road entry
pre-check (route to the nearest road node, then road-only to goal). Only if both fail
does it fall back to the full unified graph. This is explicit routing logic, not just
cost-weighting.

**String-pulling:** After A* returns a raw waypoint list, a greedy pass removes redundant
intermediate nodes, producing clean straight segments between key turns.

**Shift-move road avoidance:** On the second and later segments of a shift-move chain,
a continuous avoidance multiplier (1.0–13.0×) inflates road costs based on how deep
off-road the previous waypoint was. A road crossing check (200 m sample intervals) gates
this — if a road naturally lies between waypoints, the normal algorithm is used instead.

**River crossing:** Edges crossing a river LineString are flagged at pipeline time with
a multiplier (minor 1.8×, moderate 3.0×, major 4.5×). Road crossings (bridges) exempt.

**Server validation:** The client submits the ordered waypoint list. The server validates
each step against the division's server-side movement profile and the authoritative graph.
Invalid paths are rejected and the client receives a correction.

---

## Command Layer

### Two-tier command: Macro and Micro

Designed to scale naturally from early-game narrow fronts to late-game wide fronts without
forcing the player to micromanage.

**Macro (Army Group level):**
- Player draws an advance axis along a road corridor (Line War-inspired draw command,
  constrained to road network)
- All divisions assigned to that army group flow along the axis automatically
- System handles road priority, column depth ordering, and advance pacing
- Player sets the objective; the system handles column logistics
- Supply automatically follows the same axis

**Micro (Division level):**
- Player can select any individual division and override its orders at any time
- Manual orders: hold position, retreat to a specific junction, flank via a specific
  off-road route
- Micro is always available but not required

**Scaling behaviour:** Narrow fronts (early game, e.g. Franco-German border with 6–10
divisions) are naturally managed at micro level. Wide fronts (late game, e.g. Eastern Front
scale with 30–40 divisions) create organic pressure toward macro command. The game does not
lock the player into either mode — friction teaches strategy.

---

## Division Representation on the Strategic Map

### Design intent: few divisions, deep composition

The strategic layer is deliberately designed around a **small number of divisions per
player** (roughly 5–15 depending on map size, not the dozens-to-fifty-plus division counts
seen in HoI4 or in micro-heavy RTS-adjacent wargames). This is a load-bearing design decision,
not an incidental one, and it follows directly from where this game places its depth.

**The genre's spectrum, and why this game sits where it does:** HoI4 places significant depth
in managing a large number of divisions directly — a demanding but rewarding loop for players
willing to invest the time. Steel Division 2 places depth in real-time micro of a smaller
number of units, but its own playerbase's most persistent complaint is that this tips into
what players call "micromanagement hell" — the skill ceiling becomes "manage more units
faster than your opponent" rather than "make better strategic decisions," and even the
developers' own stated philosophy (the game's balance should not *force* micromanagement,
only reward it situationally) is widely felt to not fully hold in practice. Call of War sits
at the opposite end — low division counts, low moment-to-moment micro, optimised for casual
accessibility, but correspondingly shallow.

**This game's answer:** depth lives inside each division's 25-cell composition (the auto-
battler tactical grid, already designed so that players who never open the combat panel still
get reasonable outcomes, while players who study composition extract a meaningful edge), not
in the raw count of dots a player must click and route across the strategic map. Keeping
division count low is therefore not a simplification made *despite* wanting depth — it is
what makes the existing tactical-grid depth the dominant skill expression, rather than
competing with a second, separate micro-heavy skill expression (managing many strategic-map
dots) that would otherwise crowd it out, the same way Steel Division 2's real-time unit count
crowds out its own otherwise-solid combined-arms mechanics for a large share of its
playerbase. A 1–4 hour session does not have room for both a deep composition-building layer
and a deep division-count-management layer to coexist without one undermining the other.

### Division dot and engagement areas

Each division is represented as a dot on the strategic map with three concentric areas:

**Scouting range (large outer ring):**
- Always the largest ring — forward scouts ranging ahead of the division's main body
- Reveals enemy division positions within range as dots on the player's map
- Enemy movement paths (dotted waypoint trail) are only visible when the enemy division
  dot is within the player's scouting range — same visibility gate
- Ally and map-sharing nations: all paths visible regardless of scouting range
- Neutral nations: see province-level frontline colour wash but not division dots
  or paths outside their own scouting areas

**Scouting radius determination:**
- The division's scouting radius equals the **maximum** scouting range among all recon
  units present in the template — not the sum or average
- Multiple recon units add redundancy (if the best is killed mid-combat, the next best
  takes over) but do not geometrically stack range
- Units contributing to scouting radius: recon infantry (base range), recon light tank
  variants (medium range), armoured car with recon specialisation (high range), cavalry
  (medium range — fast-moving scouts)
- Research upgrades improve specific unit types' scouting range; the division's effective
  radius updates on next movement profile recomputation
- A division with no recon units has a short baseline scouting radius representing basic
  forward visibility from the unit's vanguard

**Observation range (inner ring, inside scouting range):**
- A second, shorter-radius circle within which partial-to-full enemy composition
  becomes visible — rather than just seeing the dot and its movement
- At base observation range (standard recon infantry): unit category counts visible
  (e.g. "3 armoured, 8 infantry, 2 support") but not specific types
- At upgraded observation (research-improved recon unit): specific unit types visible
  (e.g. "medium tanks, MG teams, AT guns")
- At maximum observation (elite recon armoured car, highest research tier): full grid
  composition visible — exactly what units are in the enemy 5×5 grid
- **Observation radius determination:** max of recon units in the template (same rule
  as scouting radius — not cumulative). Research upgrades two separate axes per recon
  unit: (1) observation radius and (2) composition detail quality. Both increase
  independently on the recon unit research tree
- Observation range is not shown by default on the map — only shown when the player
  hovers over an enemy division dot that is within observation range. A partial or full
  composition panel appears on hover
- **Historical grounding:** US military doctrine explicitly classified recon as
  close/short-range (composition detail) and distant/long-range (position and
  movement only). The two-range system directly reflects this doctrine
- Stealth units in the enemy division are not revealed by observation unless the
  scouting unit has sufficient anti-stealth level (same anti-stealth rules as
  tactical grid)

**Engagement area (composition-based radius, circular):**
- Radius computed from template composition at save time (see Division Movement Profile
  section for the formula). Infantry division: ~50 map units. Armoured division: ~30
  map units. Smaller armoured radius gives the player precise control over when the
  division commits — avoiding accidental engagements mid-flanking-manoeuvre
- **Visible to both own and enemy players** — own engagement area shown as a solid
  circle; enemy engagement areas shown as a faded/dashed circle. This is essential
  for players to judge flanking angle and avoid accidental contact
- When two engagement areas **fully overlap**, tactical combat initiates automatically
  using the attacker/defender determination system
- Partial overlap does not trigger combat — observation area handles pre-contact
  warning. No third intermediate state between observation contact and full combat
- Combat initiation is a consequence of movement decisions, not a separate button

### Flanking at the strategic layer

When a second enemy division's engagement area overlaps a division already in tactical
combat, flanking may apply — but only if the angle between the two attackers is
sufficiently wide. Two units attacking from roughly the same direction is weight of
numbers, not flanking.

**Angle-based flanking determination:**
The angle is measured at the defender's position, between the two lines connecting the
defender to each attacker (dot product of the two vectors). Classification is set at
the moment the second division's engagement area first overlaps — not continuously
updated mid-combat, preventing unexpected bonus loss from minor positional drift.

| Angle between attackers (at defender) | Classification | Tactical bonus |
|---|---|---|
| < 90° | Converging frontal assault | No flanking bonus — weight of numbers only |
| 90°–135° | Flank attack | Standard flanking bonus (% damage increase) |
| 135°–180° | Deep flank / rear attack | Enhanced flanking bonus (enemy facing away) |

**Why 90° as the threshold:** A second attacker at exactly 90° to the primary
attacker is perpendicular to the main axis of engagement — the true geometric flank.
Anything less is still broadly frontal. The 135° threshold for rear attack reflects
that the defender's formation is now facing away from one attacker entirely.

**Engagement area visibility enables flanking play:** Because enemy engagement areas
are visible as faded circles, a player can judge whether their manoeuvring division
will reach the 90° threshold before committing. Without that visibility, flanking
angle is guesswork. This is why engagement area visibility is confirmed for both
own and enemy divisions.

**Relief mechanic:** When the flanking division is itself engaged by a friendly ally
unit, it redirects to the new threat and stops attacking the original target. This
allows players to relieve a division under pressure — rescuing a failing engagement
by committing a supporting force that pulls the flanker's attention away.

---

## Supply System

### Model: Road Segment Flow Rate

Supply is modelled as a flow rate per road segment, not as discrete individual entities.
This keeps server simulation load manageable while preserving full strategic meaning.

**Supply hub:**
- A building constructed in a province
- Defines the rate at which supply is generated (supply/tick)
- Feeds into the road network from its node outward
- Capturing an enemy supply hub forces them onto longer, thinner supply lines — a primary
  strategic objective

**Flow mechanics:**
- Each road segment between two nodes has a current supply throughput capacity
- Supply flows from hub → road graph → divisions drawing from their current segment
- Divisions draw supply from whatever segment they occupy
- If a road segment is cut (enemy captures a node, air interdiction, enemy unit physically
  blocks the road), flow to everything downstream is reduced or stopped

**Visual representation:**
- Truck sprites animated along roads as a client-side cosmetic effect driven by segment
  throughput value
- Lit roads = active supply flow. Dim/broken roads = supply disrupted
- Simulation is pure graph flow math — sprites are display only

**Air interdiction of supply:**
- Air units attack road segments, not individual trucks
- A successful logistics strike reduces that segment's throughput capacity for N ticks
- Visually: segment dims, supply flow to downstream divisions drops
- Low-altitude logistics strike: does not depend on recon. Direct effect.
- High-altitude logistics strike: damage proportional to recon value
- Divisions undersupplied: take increased attrition, strength degrades over time

### Supply and encirclement — three-tier status system

Supply cutoff and true encirclement are distinct historical and gameplay states. A
division typically progresses through all three tiers as a pocket closes — each tier
gives the player a window to respond before the situation becomes fatal.

**Design intent:** The three-tier system avoids the wargame failure mode where supply
cutoff instantly creates an unbreakable "death pocket." Historical pockets (Demyansk,
Korsun, Ruhr) were often contested for weeks or months. In a 1–4 hour session, the
transitions happen over minutes, but the same logic applies — a player who responds to
the Out of Supply notification quickly can restore the supply chain. Only if they ignore
both early warnings does the true Kessel close.

---

**Tier 1 — Out of Supply**

*Trigger:* Supply connectivity check fails — no path of ≥50% friendly-influenced
waypoints exists between the division and any friendly supply hub (see Dynamic Frontline
System for influence computation). The division can still move and retreat freely.

*Debuffs:*
- HP recovery rate → 0 (no supply reaching the division; wounds do not heal)
- Suppression threshold degrades slowly each tick (morale erodes under supply stress)
- Movement speed reduced (fuel and rations running low)

*Can retreat:* Yes — clean retreat on open friendly-influenced ground is still possible.

*Player window:* Push a relief force to restore the influence chain, or order a retreat
before the situation worsens. The notification "Supply route severed — [division]" fires
immediately when this status is triggered.

---

**Tier 2 — Cut Off**

*Trigger:* No retreat path exists through friendly-influenced ground (≥50% friendly) in
any direction — not even off-road. The division is administratively isolated. However,
enemy divisions are not yet physically present in all directions — a costly fighting
breakout may still be possible.

*Debuffs:* All Tier 1 debuffs, plus:
- Retreat command now triggers a **fighting withdrawal** through enemy-influenced ground
  — the retreating division takes HP damage proportional to enemy influence density along
  the escape path, and moves at reduced speed

*Can retreat:* Yes — but costly. The division fights its way out rather than retreating
cleanly. A weakened division attempting a fighting withdrawal risks being destroyed before
reaching friendly ground.

*Player window:* Attempt the breakout now before physical forces close the pocket, or
mount a relief attack from outside to restore a friendly-influenced corridor.

---

**Tier 3 — Encircled (true Kessel)**

*Trigger:* 8-direction check (N, NE, E, SE, S, SW, W, NW sampled from division centre)
shows that every direction has either:
- An enemy division's engagement area overlapping within that radius, OR
- ≥70% enemy influence on the waypoint graph in that direction

The higher threshold (70% vs 50%) for true encirclement prevents influence-wash exploits
where an attacking player who rapidly advances their frontline gets full encirclement
status without actually committing covering forces to close the pocket.

*Debuffs:* All Tier 1 and Tier 2 debuffs, plus:
- **All units:** suppression threshold lowered further — morale degrades faster
- **Armoured units:** damage output decays per tick (fuel starvation — tanks become
  stationary pillboxes). After sufficient ticks fully encircled, armoured units deal
  zero damage entirely
- **Infantry units:** slower degradation than armour — infantry can dig in and resist
  longer without supply (historically: Demyansk, Korsun). Still substantial, just slower
- Debuffs stack each tick — the longer the encirclement holds, the faster the division
  collapses

*Can retreat:* No — retreat command disabled. No escape route exists.

*Destruction trigger:* When the last division in the encircled stack hits its suppression
threshold, it is destroyed — not retreated. Experience, template, and equipment are all
lost permanently. This is the most decisive outcome in the game.

*Consequence for large divisions:* A fully-filled expensive division that reaches Tier 3
is catastrophically costly to lose. This creates strong incentive to maintain escape
routes and not overcommit large forces to exposed positions. The encirclement mechanic
is why an inferior player can meaningfully defeat a superior but encircled force — even
high-HP, high-experience divisions collapse under stacking Tier 3 debuffs.

---

**Detection algorithms:**

```
OUT_OF_SUPPLY:
  path_exists = waypoint_graph_search(
      start = division.position,
      goal  = any friendly supply hub,
      valid_edge = lambda e: friendly_influence(e) >= 0.50
  )
  if not path_exists: status = OUT_OF_SUPPLY

CUT_OFF (checked only if OUT_OF_SUPPLY):
  escape_exists = waypoint_graph_search(
      start = division.position,
      goal  = any friendly-influenced territory boundary,
      valid_edge = lambda e: True   # any edge passable — cost proportional to enemy influence
  )
  if not escape_exists: status = CUT_OFF

ENCIRCLED (checked only if CUT_OFF):
  directions = [N, NE, E, SE, S, SW, W, NW]
  blocked = 0
  for direction in directions:
      sample_point = division.position + direction * engagement_radius
      if enemy_division_overlaps(sample_point) or enemy_influence(sample_point) >= 0.70:
          blocked += 1
  if blocked == 8: status = ENCIRCLED
```

All three checks run server-side each supply tick. Status degrades one tier at a time —
a division cannot jump directly from normal to Encircled without passing through the
intermediate states.

---


## Move Order Persistence Through Combat

**Move orders survive engagement initiation.** A division with an active move order that
gets pulled into combat does not lose its order. After the combat resolves (if the division
did not retreat or get destroyed), it automatically resumes following the move order from
its current position. **This is the default for any pre-existing move order, with no
exception for combat:** a move order issued before engagement, or an ordinary move order
issued during combat as described below, queues for execution after the fight and does not
cause any movement while the division remains engaged.

**Move orders can be issued during combat.** While a division is actively engaged, the
player can issue a move order for it to execute after the combat concludes. The division
queues the order and acts on it once the engagement ends. This is still true after the
introduction of Reposition (see TACTICAL_COMBAT.md — Movement During Combat): an ordinary
move order, however and whenever issued, is always queue-for-after-combat behaviour. It is
never automatically reinterpreted as a Reposition attempt. Reposition is a separate,
explicitly-issued command available only while engaged and only below the retreat
threshold — a player who wants in-combat movement must deliberately invoke it; nothing a
division was doing or had queued before or during combat causes Reposition-style movement
on its own.

**Defender status is locked at combat initiation.** Issuing a move order to a defending
division during combat does not reclassify it as an attacker. The attacker/defender
determination (see the five-tier system in TACTICAL_COMBAT.md, including Tier 0 for the
war-declared-while-overlapping case) is fixed at the moment combat begins and does not
change based on orders issued afterward. A defending division given a move order
mid-combat is still a defender for all terrain bonus and suppression threshold purposes —
it simply has a queued destination it will head to after the fight.

---

## Movement UX and Hotkeys

### Move Order Flow

1. **Click division dot** to select it — shows engagement area (solid circle) and
   observation area (faded circle)
2. **Press move hotkey `M`** (or click Move button in bottom UI panel) — cursor changes
   to move mode; division remains selected and highlighted
3. **Single click on map:** division pathfinds to destination, waypoint created, division
   deselected, move mode exits
4. **Shift + click on map:** waypoint created at that position; division stays selected;
   move mode stays active; player can continue shift-clicking to chain multiple waypoints
5. **Final click without shift:** last destination set, move mode exits, division deselected
6. **Escape:** cancel move mode, clear all pending waypoints, division deselected
7. **Right-click any waypoint** in an existing chain: deletes that waypoint; subsequent
   waypoints reorder automatically; division continues on updated path

### Waypoint Visualisation

- Dotted line connecting current position → each waypoint in sequence
- At each waypoint and at the final destination: a **ghost dot** (faded, transparent)
  showing the predicted division position with its engagement area circle drawn faintly
- Observation radius **not** shown on ghost dots by default — only shown on hover of a
  ghost dot (avoids map clutter)
- On hover of ghost dot: predicted observation radius appears + tooltip showing estimated
  time to reach that waypoint at current division speed
- Ghost dots and paths are visible to the owning player and to allied / map-sharing nations
- Enemy / neutral nations: ghost dots are visible only if they fall within that player's
  own observation radius (same visibility gate as division dots)

### Clicking a Moving Division

Clicking a division that is already moving along a waypoint chain shows the **remaining
waypoints** highlighted with ghost dots. The player can:
- Right-click any remaining waypoint to delete it
- Shift-click new positions to append to the chain
- The division continues moving along the existing path until the player confirms changes

### Default Hotkey Layout

> **Superseded.** The scheme below (Q/E/R/F panels, M/H/G/X unit orders) was the original
> placeholder and predates the full UI/UX design pass. The current, finalized keybind scheme
> — including the rationale for every choice, the ergonomics-over-mnemonics principle, control
> groups, camera bookmarks, and the map-mode/relationship-overlay keys — lives in
> `UI_UX_DESIGN.md` §9, and is implemented in `InputMap` as part of **Phase 4.5 — UI
> Foundation** in `DEV_PHASES.md`. Notably: Move is now bound to `Space` (not `M`), Retreat
> is `C` (not `G`), Hold is `G` (not `H`), and panel hotkeys are `Q/E/T/Y` (Diplomacy moved
> from `R` to `T`, since `R` is needed for Retreat's ergonomic position; Politics moved from
> `F` to a reserved `U`). Treat the bullets below as historical context only — implement from
> `UI_UX_DESIGN.md` §9, not from here.

All bindings are remappable in settings. Stored in a local config file. Shown in
tooltips on all UI buttons ("Move [Space]", "Hold [G]").

**Map navigation (unchanged):**
- `W A S D` — map pan

**Modifier:**
- `Shift + click` — add waypoint to chain (in move mode)

**Implementation note:** All bindings defined in Godot's `InputMap` and remappable at
runtime via the settings UI built in Phase 4.5. GDScript handles keyboard input cleanly
through `InputMap`. A left-handed mirror preset ships as a second named default mapping,
not a runtime-computed mirror.

---

## Dynamic Frontline System

> **Status: Deferred — planned for a later development phase (supply system milestone).**

### Overview

The dynamic frontline is a continuous visual representation of territorial influence that
shifts in real time as divisions move, advance, and retreat. It is distinct from province
ownership — provinces change hands only when their city is captured. Between city captures,
the frontline colour wash communicates who is dominating each part of the map at a glance.

This serves two purposes: aesthetic (the map reads like a living battlefield) and
intelligence (experienced players read colour intensity to identify weakening fronts before
divisions have physically retreated).

### Influence Computation (Server-Side, Per Tick)

Both sides' units contribute influence simultaneously. The frontline colour is the net
result of all nations' influence values competing in each province — not a binary
ownership flag. A province with equal forces from both sides shows a centred frontline.
A province with heavy attacking force vs light defending force shows the frontline pushed
deep into the defender's territory even before the city falls.

**Unit-based influence (all nations):**

```
unit_influence[nation][province] = sum(
  division_aggregate_hp_fraction × distance_falloff
  for each division of that nation whose engagement area overlaps this province
)
```

- **division_aggregate_hp_fraction:** sum of all living unit HPs in the division's grid
  normalised by the maximum possible HP for a full 25-unit grid. A full fresh division
  projects maximum influence. A battered near-destroyed division projects near zero.
  This makes the frontline a genuine intelligence signal — a fading colour region reveals
  a weakening front before the division has physically retreated
- **distance_falloff:** divisions whose engagement area centre is closer to the province
  contribute more than divisions whose area only clips the province edge
- **Recon units do not contribute to influence.** Recon observes, it does not control.
  Prevents cheap recon-cap exploits where players paint territory without committing
  real forces

**Ownership bonus (province owner only):**

The nation that owns a province gets a passive influence bonus from that ownership —
representing administrative control, population, infrastructure, and road network:

```
province_influence[nation] = unit_influence[nation][province]
                            + (ownership_bonus if province.owner == nation else 0)
```

The ownership bonus is a fixed scalar (exact value set by playtesting — large enough
that ownership matters, small enough that a strong attacking force can overcome it).

**Total influence and frontline rendering:**

```
total_influence[province] = sum(province_influence[nation] for all nations)
nation_share[nation]      = province_influence[nation] / total_influence[province]
```

At 50%+ share for one nation, the frontline isoline passes through toward that nation.
At full dominance (100% share), the province interior is fully that nation's colour.

**City capture — the ownership flip and influence inversion:**

When a division captures a city node, two things happen simultaneously:

1. Province ownership transfers to the capturing nation. Income, supply, and the
   ownership bonus immediately flip to the new owner
2. **Influence roles invert:** The previous defender loses the ownership bonus and
   now projects influence only from where their actual units are plus roads they still
   physically control. They are now in the same position the attacker was in before
   the capture — projecting influence outward from unit positions only

The frontline does not instantly snap to fully new-owner-coloured. If the previous owner
still has units nearby, their unit-based influence persists — the colour shifts from the
ownership bonus flip but the frontline line stays near the actual force positions. Both
sides push against each other from their new relative positions.

**Roads and retreat influence:**

A division retreating from a captured province continues to project influence along roads
it still physically controls (i.e. roads not yet dominated by enemy influence). The
frontline colour along friendly-controlled road corridors remains friendly even as the
province interior shifts. This makes the post-capture situation legible at a glance:
friendly colour along a road means it is still defended; enemy colour washing over it
means it has been abandoned.

### Province Colour Rendering (Client-Side Shader)

**Province interiors** are rendered with a colour wash shader driven by influence values:
- Base colour: the province's current **owner's predefined nation colour** (e.g. France
  blue, Germany grey, Britain khaki). This is the default when no foreign influence
  is present.
- As a foreign nation's influence increases, their predefined nation colour bleeds into
  the province interior, proportional to their influence advantage.
- At full foreign dominance, the interior is fully that nation's colour.
- Multiple nations can partially influence the same province — their colours blend
  proportionally.

**Province borders** never change. The geographic province boundary is always visible
and static — it is the political map, not the military map.

**The frontline line** — the visual boundary between influence zones within a province —
is rendered client-side as the isoline at the 50% influence threshold. It is smoothed
with a curve fit to appear organic rather than pixelated. It has no mechanical role —
it is purely cosmetic.

**Nation colours are predefined per nation** and never change during a session. France is
always France's colour. A province being dominated by Germany simply has Germany's colour
washing into it — the province border still shows France's political ownership until the
city is captured.

### City Capture and Ownership Transfer

**City capture** is the only event that transfers province ownership:
- A division physically occupies the city node (the province's capital city position)
- Province ownership transfers to the capturing nation immediately
- The province's **baseline colour** switches to the new owner's predefined nation colour
- The ownership bonus in the influence computation flips to the new owner — the previous
  owner loses it instantly and now projects influence only from unit positions and
  roads they still physically control (same rules as an attacker before capture)
- The previous owner's influence does not disappear — their units still project
  unit-based influence from wherever those units are. The frontline moves but does not
  instantly jump to fully new-owner-coloured if defending units are still nearby

Between city captures, the frontline colour wash can shift back and forth freely as
military forces advance and retreat. A province can be fully dominated by enemy influence
colours for an extended period without changing ownership — ownership only snaps on city
capture.

**Visual reading of encirclements:** A province surrounded by enemy-influenced territory
that still shows the original owner's city (and thus their baseline colour) is visually
readable as a pocket — the original colour partially holds due to unit influence even as
enemy colour dominates the surrounding territory. Makes encirclements legible without
any special UI overlay.

**Visual reading of post-capture retreats:** After a city falls, friendly colour
persisting along road corridors behind the new front signals those roads are still
defended by retreating forces. Enemy colour washing over roads signals abandonment.
Players can read the strategic situation from the colour map alone.

### Supply Connectivity via Frontline

Supply connectivity is a separate check from the road-graph supply flow system. It uses
the influence map to determine whether a division's supply route is secured:

**Connectivity rule:** Starting from the division's position, trace backward through the
waypoint graph toward the nearest supply hub. If every waypoint along the path is in
friendly-influenced territory (influence value > 50% for the owning nation), the division
is supply-connected. If any waypoint is neutral or enemy-influenced with no friendly unit
securing it, the connection is broken.

**What this means in practice:**
- Division advancing along a road with friendly territory behind it → supply connected
- Division going off-road with other friendly units behind it forming a continuous
  influenced chain → supply connected as long as the chain is unbroken
- Division going off-road with no friendly units behind it, ground becoming neutral →
  supply severed; player receives notification; out-of-supply attrition begins
- Enemy advance that cuts through the influence chain without physically touching the road
  → supply severed; models historical "deep penetration cuts supply" without requiring the
  attacker to physically block the road

This makes influence map penetration mechanically meaningful — a fast armoured advance
that creates a bulge in the enemy's territory can sever supply to divisions behind the
front line even before physically encircling them.

**Supply chain notification:** When a division's influence-connectivity check fails, the
player receives: "Supply route severed — [division name] — [province name]". The supply
status indicator on the division icon shifts to show out-of-supply state.

### Frontline Visibility by Player Type

**Belligerent nations (at war):** See full frontline colour wash and their own division
positions/compositions. Enemy division positions visible within observation radius only;
enemy composition shows as "?" unless observation value is high enough or alliance
intelligence sharing is active.

**Neutral nations:** See the frontline colour wash at province level (the macro picture —
which provinces are being pressured, which fronts are moving) but do not see individual
division dots or compositions beyond what their own observation areas would reveal. This
gives neutral players newspaper-level information about the war:
- "France is losing ground in Alsace" — visible from colour shift
- "Germany has 4 armoured divisions on the border" — not visible without alliance or recon

**Why neutral players see the frontline wash:**
Diplomatic decisions require macro-level information. A neutral nation deciding whether to
intervene needs to see who is winning, not fight blind. Broadcasting province-level
influence scalars to all players is cheap server-side — it is a small payload of numbers
per province, not complex unit data.

**Why neutral players do not see division details:**
Intelligence has value. A neutral player who can see all division compositions has no
incentive to invest in alliances that grant intelligence sharing, and the fog-of-war
system loses meaning. Province-level colour is enough for informed diplomacy.

**Server mechanics:** Influence values are computed once per tick and broadcast to all
connected players. Division position and composition data is filtered per-player by the
existing observation radius system. No additional server complexity is required — the
frontline system uses data already being computed.

---

## Division Representation (Visual)

### NATO Military Symbols (Rectangle Icons)

Divisions are represented as NATO standard rectangle unit symbols on the strategic map.

**Why:**
- Immediately recognisable to the HoI4 / grand strategy audience
- Communicates unit type at a glance without UI clutter
- Scales cleanly — 40 NATO rectangles on a map is readable; 40 illustrated portraits is chaos
- Sits naturally in a road column as stacked icons

**Icon anatomy:**
- Rectangle body with unit type symbol inside (infantry, armor, motorized, artillery, supply)
- HP bar rendered below the rectangle
- State communicated via border/fill colour (see Combat States)
- Suppression indicator: border pulses amber when approaching retreat threshold, red when
  threshold exceeded
- Round indicator: small dot sequence or number showing current escalation phase (1–5)
- Stack badge (number) shown when multiple divisions collapse at macro zoom

---

## Road Column and Stacking

### Horizontal column at micro zoom, vertical stack at macro zoom

**Micro zoom (division-level):**
- Each division occupies a distinct position along the road, spaced horizontally
- Column depth is spatially visible — front division physically further toward the enemy
  than reserves
- Players can see gaps in the line as empty road segments
- Divisions can be dragged to reposition along the road

**Macro zoom (army group level):**
- Divisions on the same road axis within a threshold distance collapse into a single
  vertical stack icon
- Stack badge shows division count
- Badge colour reflects the front division's current state
- Clicking the stack expands back to individual icons

**Column ordering:**
- Front division (closest to enemy) is the active combatant
- Subsequent divisions in the column are reserves, ordered by proximity to front
- When the front division retreats or is destroyed, the next division in the column
  automatically advances to become the new front

**Note on retreat visual:** When a front division retreats backward through the column, the
current confirmed representation is a vertical stack at macro zoom. Two-lane road rendering
(retreat lane / advance lane) is a candidate approach for a later visual polish pass.

### Positional Stacking (Same Location)

When allied divisions overlap on the same map position (not in a road column, but literally
co-located — e.g. multiple divisions defending a mountain pass), they form a **positional
stack** with an ordered position list.

**Stack structure:**
- Divisions in a positional stack have a numbered order (first, second, third...)
- Players can manually reorder the stack at any time when not in combat
- The stack appears as a single dot with a badge count on the strategic map

**Combat rotation:**
- Only the **first division** in the stack engages the enemy at any time
- When the first division's suppression reaches the retreat threshold, it does not
  physically retreat off the map — instead it **rotates to the back of the stack** and
  the second division steps forward as the new front
- This is true for both defenders and attackers
- Rotation is invisible to the enemy at the strategic level — the combat icon continues
  without indicating a rotation. A sweaty player who opens the combat panel will see
  different units in the front grid and can react accordingly
- Actual retreat only occurs when the **last division in the stack** hits suppression
  threshold — that division retreats along the supply road as normal

**Supply priority for stacked divisions:**
- Supply flows to the **first division in the stack first** (front of queue gets priority)
- Excess flows to second, third, etc.
- If supply is constrained, the front division remains supplied while rear stack divisions
  begin degrading — historically accurate and creates meaningful pressure to maintain
  strong supply before committing deep stacks

**Design intent — stacking is a tool, not a default:**
Stacking is primarily useful at chokepoints (mountain passes, river crossings, city
defences) where width is limited and depth buys time. Players are not expected to maintain
large stacks everywhere. The economic cost of concentrating multiple divisions in one
location means other fronts are weakened. An attacker who identifies a stack and bypasses
it via a flanking route forces the defender to abandon the position or split their forces.

**Encirclement of a stack:**
Encirclement applies to the whole stack. If surrounded, rotation within the stack does not
help — the rotated division also has no retreat path. The entire stack is destroyed when
the last division hits suppression threshold with no escape route.

**5×5 grid and template fill:**
Just as stacks are a tool rather than a default, fully filling the 5×5 division grid is
not expected or required. Most divisions in play will have partially filled grids. A player
concentrating resources into one large fully-filled division makes a different tradeoff from
one spreading the same resources into several smaller divisions — the large division hits
harder in a single engagement but cannot be in two places at once and is vulnerable to
encirclement. Economy governs these choices; there is no mechanical cap enforcing either.

---

## River Crossing Unit Exceptions

Certain unit types negate or modify the river crossing penalty applied to attackers.
This follows the same design pattern as the force recon lethality exception — specialist
units bypass disadvantages that generic units face.

**Units that fully negate river crossing penalty:**
- **Commandos:** Trained specifically for river crossings. Negate penalty entirely. Also
  gain a small stealth bonus in rounds 1–2 of the engagement — they cross quietly and
  hit before the defender realises they are across
- **Marines / amphibious assault infantry:** Negate crossing penalty. No additional
  offensive bonus — amphibious capability is their primary trait
- **Amphibious tank variants:** A specific upgrade path within the armour research tree.
  Standard tanks take the full crossing penalty; the amphibious variant negates it

**Units that reduce river crossing penalty:**
- **Engineers (future unit):** When present in the division template, reduce the crossing
  penalty by 50% for all other units in the division — they build improvised crossings
  under fire. Not a full negate but meaningful on river-heavy maps

**Design pattern note:** These exceptions establish the extensibility point for riverine
warfare specialisation in later modules. New unit types or research upgrades can negate
or modify crossing penalties by following this same pattern. Not all exceptions are
implemented in the base game — the mechanism is confirmed.

---

## Division Status Visual Indicators

All status indicators are visible on the strategic map without opening any panel.
They stack cleanly — a division can show multiple simultaneous indicators.
The encircled ring is always the most visually dominant; all others are secondary.

### Division dot states

| Status | Visual indicator | Notes |
|---|---|---|
| Normal | Standard NATO rectangle icon | No overlay |
| Engaged | Combat icon appears over engagement point; division dot pulses subtly | Combat icon shows HP bars, round phase dots, suppression pulse |
| Out of Supply (Tier 1) | Small amber supply icon below division dot | Warning — demands attention but not urgent |
| Cut Off (Tier 2) | Supply icon turns red; broken chain symbol appears | More prominent — action required |
| Encircled (Tier 3) | Red ring around the division dot (the Kessel symbol) | Most dominant indicator — unmistakable |
| Flanked (standard, 90°–135°) | Small diagonal arrow on the flanking division dot | Communicates to both players: flanker knows bonus is active; defender knows they are flanked |
| Rear attacked (deep flank, 135°–180°) | Double diagonal arrow on the flanking division dot | Enhanced bonus version |
| Meeting battle | Distinct combat icon (two arrows meeting head-on) | Different from the standard crossed-swords engaged icon |
| Retreating | Retreat arrow on dot pointing direction of movement | Distinct from normal move order arrow |
| Redeploying | Dot greyed out with gear/refresh symbol | Template switch in progress; 1-minute cooldown |
| Incapacitated units | Visible only inside the 5×5 grid panel (greyed-out cell slots) | Not shown on strategic map — grid-level detail only |

### Tactical combat pop-up

When two divisions are engaged, a **combat button** appears on the combat icon — a small
crossed-swords symbol distinct from the icon itself. Clicking it opens the 5×5 vs 5×5
tactical grid panel as an overlay. The panel shows:

- Both 5×5 grids live with per-unit HP and suppression bars
- Experience tier badge per unit cell (Green/Seasoned/Veteran/Elite)
- Formation bonus indicators — glow on cells with active adjacency synergies
- Active row perk labels per row
- Attack pattern overlay for the current round
- Recon value accumulation indicator
- Terrain modifier display (e.g. "Dense forest — armour flanking disabled")
- River crossing penalty indicator and remaining rounds if active
- Round timer countdown (Contact / Firefight / Intense / Decisive / Annihilation)
- Flanking angle indicator if a second attacker is present (showing the measured angle
  and which bonus tier is active)

The panel can be closed at any time. Combat continues regardless of whether it is open.

---

## Combat States

Every division cycles through the following states. All simulation is server-side (Colyseus).
Client displays results only.

These states are driven by outcomes from the tactical grid (see TACTICAL_COMBAT.md —
Strategic Layer Link section). The tactical grid feeds upward; the strategic layer acts on it.

### Engaged
- Tactical combat is active between this division and at least one enemy division
- The 5×5 grid is resolving rounds automatically
- Organisation (org) / suppression in the tactical grid is actively changing
- Division can still receive reinforcement (additional divisions joining the engagement)

### Suppressed
- Triggered when average suppression across the division's tactical grid reaches the retreat
  threshold (base 60% — modifiable by future doctrine and general systems)
- Cannot initiate new attacks on other divisions
- Takes increased HP attrition each strategic tick
- **Defenders:** auto-retreat when suppressed and a road is open (see Retreat).
  Suppression threshold: base 60%
- **Attackers:** auto-retreat at a **higher suppression threshold (base 80%)**. Attackers
  have committed voluntarily and hold longer before breaking — only when the attack is truly
  failing does the system pull them back. Manual retreat is always available at any
  suppression level for a player who wants to cut losses early. If encircled, auto-retreat
  never fires regardless of suppression — encirclement destruction takes precedence

### Retreat
- Division moves back along its supply road toward the nearest friendly node
- Next division in column automatically advances to fill the front position
- Retreating division's suppression decays at 2–3× the normal rate (rapid recovery during
  withdrawal, modelling the relief of leaving the firefight)
- Suppression does not reset instantly — carry-over suppression models the disorder of
  withdrawal
- HP damage during retreat: stops unless under active pursuit fire from the advancing enemy

### Destroyed
- Triggered when a suppressed division is cut off (road blocked, fully encircled) and
  cannot retreat
- Or when all units in the tactical grid are destroyed (HP reaches zero across the whole grid)
- Division is permanently eliminated — experience, template, and equipment all lost
- This is the primary satisfying destruction outcome — a consequence of positional failure or
  sustained attrition, not a random roll

---

## Combat Victory Conditions (Strategic Layer)

Hybrid push-back and destruction model. Neither pure HoI4 (push-back only → stale fronts)
nor pure Call of War (destruction only → arbitrary outcomes).

| Outcome | Trigger | Result |
|---|---|---|
| Retreat (defender) | Suppressed (≥60%) + road open | Division falls back, position lost, division survives |
| Retreat (attacker) | Suppressed (≥80%) + escape route exists | Division falls back; manual retreat available at any level |
| Fighting withdrawal | Cut Off (Tier 2) + suppressed | Division retreats but takes damage during movement |
| Destruction (Kessel) | Encircled (Tier 3) + suppressed | Division eliminated — the decisive result |
| Destruction (attrition) | All grid units destroyed via HP damage | Division eliminated |
| Hold | Defender holds suppression below threshold | Attacker attrition continues, no position change |
| Breakthrough | Attacker clears enemy front row with no reserve behind it | Road axis opens, exploitation movement possible |

**Supply/encirclement status effects:**

| Status | Trigger | Debuffs | Can retreat? |
|---|---|---|---|
| Out of Supply (Tier 1) | Supply connectivity < 50% friendly influence on path to hub | No HP recovery, slow suppression threshold decay, reduced speed | Yes — clean retreat |
| Cut Off (Tier 2) | No friendly-influenced retreat path in any direction | All Tier 1 + fighting withdrawal on retreat (takes damage moving) | Yes — costly |
| Encircled (Tier 3) | All 8 directions blocked: enemy presence or ≥70% enemy influence | All Tier 2 + armour fuel decay, escalating debuffs per tick | No — disabled |

**Design intent:** Sessions must resolve. Stale fronts are avoided by ensuring that suppressed
divisions without column depth behind them are destroyed rather than indefinitely pushed back.
Column depth (number of reserve divisions) is a meaningful strategic investment, not just a
number — it is the difference between losing one division and losing the front.

---

## Open Questions (To Be Resolved in Playtesting)

- Exact org and strength decay rates per combat tick
- Suppression decay rate per round (base) and the retreat multiplier (2–3× base)
- Threshold distance for macro zoom stack collapse
- Road throughput capacity values per road level
- Supply generation rate for supply hub building
- HP attrition rate for out-of-supply divisions (must feel urgent but not instant)
- HP attrition rate for encircled divisions (faster than out-of-supply)
- Encirclement armour damage decay rate per tick (target: meaningful degradation within
  3–5 ticks; zero output after ~8–10 ticks fully encircled)
- Encirclement suppression threshold reduction rate (how fast does morale break under
  encirclement pressure)
- Division type classification thresholds (confirmed: armoured >= 40%, motorised
  15–39%; no Defensive type; exact boundary values from playtesting)
- Engagement radius formula constants (confirmed: base 50 infantry, -5 per 10%
  armoured above 15%, -2 per 10% cavalry, clamp [30, 50]; exact values from
  playtesting — particularly the floor of 30 and ceiling of 50)
- Flanking angle bonus percentages (standard flank bonus % and enhanced rear
  attack bonus % — qualitatively confirmed, exact values from playtesting)
- Waypoint graph sampling interval (target: one waypoint per ~500m–1km real-world distance
  — balance between path quality and graph size)
- Movement profile recomputation trigger debounce (avoid recomputing on every keystroke
  during template editing — trigger on save/confirm)

---

## Nation Configuration and Extensibility

Each nation in a map is defined by a `nation_config` object loaded at game start.
The current western Europe map uses a balanced `nation_config` for all nations — all
nations have identical unit availability, research starting points, and no unique modifiers.

**`nation_config` fields (extensible per map):**
- `available_units` — which unit types appear in the division builder for this nation
- `unit_stat_modifiers` — flat or percentage modifiers on specific unit type stats
  (e.g. German panzer +10% armour, Soviet infantry +15% suppression resistance in winter)
- `unique_unit_unlocks` — nation-exclusive units not available to others
- `research_starting_unlocks` — research nodes already unlocked at game start
- `starting_templates` — historically appropriate preset templates
- `cavalry_available` — boolean; true for all nations on current map

**Game Master support:** A game master role can override `nation_config` values mid-session
or define scenario-specific rules (e.g. historical scenario with Germany starting with
Blitzkrieg doctrine already researched). This is a configuration layer above the engine —
no engine code changes required for new scenarios.

**Current map:** Cavalry available to all nations. No unique modifiers. All nations start
at the same research position. Nation differentiation comes through player decisions and
map starting positions, not built-in advantages.

**Future maps:** Can define any combination of `nation_config` values without touching
engine code. The engine reads `nation_config` at game start and applies it — it never
hardcodes assumptions about nation identity.

---

## Relationship to Other Combat Layers

**Tactical combat (TACTICAL_COMBAT.md):**
The 5×5 grid resolves inside each strategic combat engagement. Grid outcomes (suppression
threshold, HP depletion, breakthrough) feed directly into the strategic states above.
The seam between layers is explicit — see TACTICAL_COMBAT.md Strategic Layer Link section.

**Air combat (AIR_COMBAT.md):**
Air wings assigned to a province affect ongoing tactical grid combats in that province via
CAS damage patterns. Air interdiction affects road segment throughput. Air superiority over
a province strips enemy CAS support from their engaged divisions.

**Naval combat (NAVAL_COMBAT.md):**
Naval supply interdiction affects land division supply rates indirectly — convoy raiding
reduces the supply reaching coastal and port-dependent provinces, which flows through to
road segment throughput and eventually to division out-of-supply attrition.
