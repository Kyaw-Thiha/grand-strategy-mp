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

### Air Fleets — the same two-tier pattern extended to air

> Added July 2026 alongside AIR_COMBAT.md's real-time wing redesign. Air wings are
> individually selectable, real-time, pathfinding units (see AIR_COMBAT.md) — the same
> command-layer scaling pressure land divisions create at 30–40 units applies even sooner to
> a late-game air force of dozens of wings.

**Macro (Air Fleet level):** a player groups wings into an Air Fleet and issues it a
strategic directive — "hold air superiority over this front," "interdict this supply
network" — and the system auto-assigns individual wings to fulfil it, the same division of
labour as an Army Group's advance axis handling column logistics automatically.

**Micro (wing level):** any individual wing can be selected and overridden at any time —
retasked, given a specific target, pulled home early. Micro is always available but never
required, matching AIR_COMBAT.md's floor/ceiling principle for air specifically.

**Why this matters more for air than it first appears:** land divisions are deliberately kept
to a low count per player (see Design intent below); air wings have no equivalent hard
ceiling in the current design, and a maxed air-doctrine nation could plausibly field several
dozen. Air Fleets are the actual answer to commanding that scale without it becoming a second
job, reusing this exact pattern rather than inventing new command UX for air.

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

### Marshalling — a division's state before it exists on this map at all

A newly-raised division does not appear on the strategic map immediately. It exists
first in a **Marshalling** state (off-map, no dot, no position) while its template slots
fill from the national unit-type Reserve — full mechanics in RESOURCE_ECONOMY.md's
Reserve and Marshalling sections. Two things about this state matter specifically at the
strategic-map layer:

- **Early deployment threshold:** a player may deploy a marshalling division once it
  reaches ≥50% aggregate HP (a whole-division percentage against total template HP, not
  a headcount or per-slot threshold). Only once deployed does the division get a dot and
  become part of everything described below (engagement areas, flanking, road stacking,
  the three-tier supply status).
- **Deployment is the moment the fill-rate model switches.** Before deployment, the
  division fills at a fast flat national Marshalling rate; after deployment, it switches
  permanently to this section's road-segment flow rate for any remaining fill, even if
  still below 100% strength. A player deploying early is trading marshalling's
  guaranteed speed for whatever the front's actual supply infrastructure can support,
  which may be slower — a real tradeoff, not a free action.

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

When a second (or third, fourth, etc.) enemy division's engagement area overlaps a
division already in tactical combat, flanking may apply — but only if the angle between
attackers is sufficiently wide. Two units attacking from roughly the same direction is
weight of numbers, not flanking.

**Angle-based flanking determination (two attackers):**
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

**Generalisation to three or more attackers:** the same table applies, but the angle fed
into it is the **widest angle between any two attackers**, not a fixed pair. Concretely:
compute the angle at the defender between every pairwise combination of attacking
divisions' position vectors, and take the maximum. That maximum angle is looked up
against the table above exactly as the two-attacker case already is.

This is a direct extrapolation, not a new rule: with exactly two attackers there is only
one pair to measure, so the "widest pair" reduces to the existing single-angle case
automatically. Adding a third attacker can only ever widen or maintain the existing
spread (a new attacker either falls inside the arc already covered by the two widest
existing attackers, in which case the maximum is unchanged, or it extends the arc
further, in which case the maximum increases) — it can never narrow the classification
a defender is already suffering. This monotonic property means the rule never produces
a surprising downgrade (e.g. going from "rear attacked" back to "flanked" by virtue of a
third division arriving) purely as an artefact of which pair happens to be measured.

**Classification timing with 3+ attackers:** as with the two-attacker case, the
classification is re-evaluated and locked at the moment each *new* division's engagement
area first overlaps — not continuously every tick. A third division joining an existing
two-attacker engagement triggers one fresh evaluation at that instant (now considering
all three pairwise angles), which then holds until a fourth division joins or one of the
existing attackers disengages.

**Engagement area visibility enables flanking play:** Because enemy engagement areas
are visible as faded circles, a player can judge whether their manoeuvring division
will reach the 90° threshold before committing. Without that visibility, flanking
angle is guesswork. This is why engagement area visibility is confirmed for both
own and enemy divisions. With 3+ attackers, this same visibility lets a player
judge the *widest pairwise gap* among all currently-engaged friendly divisions before
committing a new one — useful for deliberately closing a gap to upgrade a flank into a
rear attack, or recognising that a new division would fall inside the existing arc and
contribute nothing beyond weight of numbers.

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

**Upstream source — production and Reserve (RESOURCE_ECONOMY.md):** what a division
actually draws through this flow graph is a *resource-mix vector* sourced from the
national unit-type Reserve, not an abstract "supply points" scalar. When Reserve is
empty for a needed unit type, this road-segment flow rate is no longer the only
bottleneck — the effective draw becomes `min(production_rate, road_segment_flow_rate)`,
since the delivery channel and the factory line producing what it's carrying are now in
series, not parallel. A newly-raising division uses the same `min()` logic but against
a flat national Marshalling rate instead of this road-segment flow rate until it
deploys — see RESOURCE_ECONOMY.md's Reserve and Marshalling sections, and the Division
Representation section below for the deployment-state distinction this implies.

**Relationship to subprovinces (see Subprovince Capture System, below):** "road segment"
here continues to mean the road graph itself, not the road-corridor *subprovince* cells that
now also exist along the same roads — they're two views of the same physical corridor, not
two competing graphs. The open question is whether supply flow should stay gated to
friendly/allied-owned road-corridor subprovinces exclusively (matching the existing
"exclusively along roads" rule in MAP_DATA_CONTRACT.md), or whether it should be allowed to
fall back onto non-road subprovinces at reduced throughput when a division is off-road. Not
yet decided — see that section's open question.

### Supply and encirclement — three-tier status system

> **Status: Active.** Connectivity for all three tiers is now computed as a query over the
> subprovince adjacency graph (see Subprovince Capture System, below) instead of the earlier
> waypoint-influence-percentage version. Same three tiers, same debuffs, same design intent —
> only the connectivity check underneath changed. If you're looking at this from an older
> version of this doc: the `≥50%`/`≥70%` influence thresholds and the 8-direction radius
> sample are gone; replaced with graph-exact checks that need no tuned percentage at all.

Supply cutoff and true encirclement are distinct historical and gameplay states. A
division typically progresses through all three tiers as a pocket closes — each tier
gives the player a window to respond before the situation becomes fatal.

**Design intent:** The three-tier system avoids the wargame failure mode where supply
cutoff instantly creates an unbreakable "death pocket." Historical pockets (Demyansk,
Korsun, Ruhr) were often contested for weeks or months. In a 1–4 hour session, the
transitions happen over minutes, but the same logic applies — a player who responds to
the Out of Supply notification quickly can restore the supply chain. Only if they ignore
both early warnings does the true Kessel close.

**Shared definitions**, used by all three tiers:

```
FRIENDLY(sp) := sp.owner in {self, allies}
BLOCKED(sp)  := not FRIENDLY(sp)          # enemy OR neutral — a neutral nation's
                                           # territory is not an escape route or a
                                           # supply path, same rule everywhere below

ring(n) := subprovinces at exact hop-distance n from the division's current
           subprovince, found by breadth-first search over the subprovince
           adjacency graph (subprovince_adjacency.geojson — see MAP_DATA_CONTRACT.md)
```

---

**Tier 1 — Out of Supply**

*Trigger:*
```
path_exists = subprovince_graph_search(
    start      = division.subprovince,
    goal       = any friendly-or-allied-owned supply hub,
    valid_edge = lambda sp: FRIENDLY(sp) and sp.kind == "road"
)
if not path_exists: status = OUT_OF_SUPPLY
```
No path exists to any friendly-or-allied supply hub walking only through friendly-or-allied
**road-corridor** subprovinces. The division can still move and retreat freely.

*Debuffs:*
- HP recovery rate → 0 (no supply reaching the division; wounds do not heal)
- Suppression threshold degrades slowly each tick (morale erodes under supply stress)
- Movement speed reduced (fuel and rations running low)

*Can retreat:* Yes — clean retreat on friendly-or-allied ground is still possible.

*Player window:* Push a relief force to reopen a road-corridor path, or order a retreat
before the situation worsens. The notification "Supply route severed — [division]" fires
immediately when this status is triggered.

---

**Tier 2 — Cut Off**

*Trigger (checked only if Out of Supply):*
```
for n in [3, 2, 1]:                      # outermost ring checked first
    if all(BLOCKED(sp) for sp in ring(n)):
        status = CUT_OFF
        break
```
Equivalently: Cut Off iff ring(1), ring(2), or ring(3) around the division has zero
friendly-or-allied subprovinces — the escape chain is broken at that distance band, even if
rings closer in or farther out still have friendly ground. The division is administratively
isolated, but enemy divisions are not yet physically present in every direction — a costly
fighting breakout may still be possible.

*Debuffs:* All Tier 1 debuffs, plus:
- Retreat command now triggers a **fighting withdrawal** through enemy/neutral-owned
  ground — the retreating division takes HP damage proportional to how much of the escape
  path is `BLOCKED`, and moves at reduced speed

*Can retreat:* Yes — but costly. The division fights its way out rather than retreating
cleanly. A weakened division attempting a fighting withdrawal risks being destroyed before
reaching friendly ground.

*Player window:* Attempt the breakout now before physical forces close the pocket, or
mount a relief attack from outside to reopen one of the broken rings.

---

**Tier 3 — Encircled (true Kessel)**

*Trigger (checked only if Cut Off):*
```
for n in [2, 1]:
    if all(BLOCKED(sp) for sp in ring(n)):
        status = ENCIRCLED
        break
```
Equivalently: Encircled iff ring(1) or ring(2) around the division has zero
friendly-or-allied subprovinces. Because this check (rings 1–2) is a strict subset of Cut
Off's check (rings 1–3), Encircled can never fire without Cut Off having already fired in
the same evaluation — the tier-escalation invariant below holds automatically, with no
separate ordering logic required.

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

**Retreat pathing** (also used outside these three checks, whenever a division retreats):
cheapest path from the division's subprovince to a friendly-or-allied road-corridor cell or
supply hub, cost-weighted by ownership — friendly/allied cells cheap, contested cells medium,
enemy/neutral cells expensive (and only traversable under the Tier 2 fighting-withdrawal
rule). Road-corridor cells keep their natural speed advantage with no special-casing needed,
since they're already the cheap edges in this same graph.

All three checks run server-side each supply tick, over the same subprovince adjacency graph
already used for capture and rendering — no separate data structure to maintain. Status
degrades one tier at a time within a single tick's cascading check — a division cannot jump
directly from normal to Encircled without the check having passed through Out of Supply and
Cut Off first, in that order, in that same evaluation.

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

### Move Trigger: Click, Not Drag

Movement is triggered by the click described above (hotkey/button to enter move mode,
then a single click to commit), never by pressing and dragging from the division's
current position. This is a deliberate choice, not an oversight: the genre converged on
click-to-move specifically because it lets the entire game be played with the mouse
alone, with no extra time-consuming step — the destination is communicated by one
unambiguous, instantaneous action. Drag-to-move would also collide structurally with
**Box Selection** (below), which is itself a click-and-drag gesture — the same input
cannot mean both "select everything in this box" and "move the unit under my cursor" at
once. Drag is reserved entirely for *refining* a move that has already been triggered —
see Waypoint Drag Refinement and Formation Move below — never for triggering the move
itself.

### Waypoint Drag Refinement

While placing any waypoint — the final destination or any intermediate shift-click
waypoint in a chain — the player can press and hold rather than click-and-release, drag
to fine-tune the exact position, and release to commit. This applies identically to every
waypoint in a shift-move chain, not only the last one: each press-hold-drag-release cycle
commits one waypoint and is independent of the others in the chain.

- While held, the **ghost dot** for that waypoint (see Waypoint Visualisation above)
  follows the cursor live, reusing the existing ghost-dot rendering rather than
  introducing a second preview element
- Releasing commits the waypoint at the cursor's final position at release time
- The full-precision path to that waypoint is computed once, on release — not
  continuously during the drag. During the drag itself, only a cheap live estimate is
  shown (the abstract-layer distance/route estimate from the hierarchical pathfinding
  structure — see `PATHFINDING.md`), to avoid running full A* dozens of times per second
  for a single drag gesture
- This is the same interaction pattern proven in other RTS titles for editing an existing
  waypoint after the fact (hover an existing waypoint, drag it, release); this game
  applies the identical press-drag-release gesture at the moment of initial placement
  instead, so the player gets the same precision in one continuous motion rather than a
  separate place-then-edit step

### Box Selection

Double-press-and-drag (or a configurable single-drag, see Open Questions) over empty map
space draws a selection rectangle; on release, every division dot whose position falls
inside the rectangle is added to the current selection. Standard modifiers apply:
`Shift + drag` adds to the existing selection rather than replacing it; `Ctrl + drag`
removes the boxed divisions from the existing selection.

Box selection is visually and input-wise distinct from Waypoint Drag Refinement above —
the former only triggers when the drag starts over empty map space with no move mode
active and no waypoint being placed; the latter only triggers while a waypoint is
actively being placed. The two gestures cannot be issued simultaneously, so there is no
ambiguity about which one a given drag means.

**Interaction with control groups:** a box selection does not itself create or alter a
saved control group (`0`–`9`, per the keybind scheme in `UI_UX_DESIGN.md` §9) — it only
sets the current selection. A player who wants to save the result presses `Ctrl + [0-9]`
afterward, exactly as with any other selection method.

### Formation Move (Multi-Division Group Move)

When two or more divisions are selected (via box selection or `Shift`-click) and a move
order is issued to a single destination point, the divisions do **not** converge on that
single point. They spread into a **formation** around it — the universal convention
across the genre, chosen specifically because naive single-point convergence is a
well-documented bad outcome (units overlapping uselessly at one spot) rather than a
stylistic preference.

**Shape and spacing:**
- Divisions arrange in a **grid formation**: rows of divisions, a fixed number per row,
  with the destination point at the formation's centre. A small selection (2–4 divisions)
  resolves to a single row; larger selections wrap to additional rows behind it
- **Spacing between adjacent divisions in the formation is derived from engagement
  radius, not an arbitrary new constant.** Each division already has a composition-based
  engagement radius (~30 map units for heavy armoured, ~50 for pure infantry — see
  Division Representation on the Strategic Map). Formation spacing is set to **at least
  the sum of the two divisions' engagement radii** at every adjacent pair, so that
  divisions arriving in formation do not have overlapping engagement areas with each
  other by default. This is what makes the spacing feel natural rather than arbitrary:
  it's reusing a number the division already has for a different purpose (combat
  initiation) rather than inventing a new "formation spacing" constant, and it has the
  practical benefit of not accidentally creating friendly-fire-adjacent engagement
  overlaps purely from how a group move resolved
- Divisions with larger engagement radii (infantry-heavy) naturally claim more space in
  the formation than divisions with smaller radii (armoured-heavy) — the formation is not
  uniformly spaced, it reflects each division's actual footprint
- **Slot assignment** (which specific division goes to which grid position) minimises
  total travel distance using a cheap nearest-available-slot heuristic, not an optimal
  assignment algorithm — the selection sizes in this game (a handful of divisions per
  player, never RTS-scale unit counts) make the marginal optimality gain of a fully
  optimal assignment not worth its higher computational cost

**Consolidation exception — pre-existing stacks:** if two or more of the *selected*
divisions are already stacked together (sharing a single province, per the existing
Stack UI) before the move order is issued, that stack is treated as **one formation
slot**, not unstacked into the spread. The group move spreads *stacks and unstacked
divisions* into formation, never breaks an existing deliberate stack apart as a side
effect of a group move. This preserves Stack UI's existing role as the explicit,
opt-in tool for intentional stacking — a group move should never silently undo a stacking
decision the player made on purpose, nor should it silently force two never-stacked
divisions arriving in formation into an unintended stack at the destination, which is why
formation spread is the default for everything that wasn't already a stack going in.

---

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
> `UI_UX_DESIGN.md` §9, and is implemented in `InputMap` as part of **Phase 5 — UI
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
runtime via the settings UI built in Phase 5. GDScript handles keyboard input cleanly
through `InputMap`. A left-handed mirror preset ships as a second named default mapping,
not a runtime-computed mirror.

---

## Subprovince Capture System

> **Status: Active — replaces the Dynamic Frontline System that previously occupied this
> section.** That design (continuous per-tick influence blending, 50%/70% thresholds, a
> shader-rendered isoline) is superseded, not merely deferred; it is not being resumed. This
> replacement was chosen after the influence-based approach was actually implemented once
> before and found not to work in practice.

### Overview

Provinces are subdivided at map-build time into **subprovinces** — a static, pre-baked mesh
of small polygons that exactly partition each province (no gaps, no overlaps, proven at
build time — see Generation, below). Ownership of each subprovince is a discrete per-nation
flag, changed by literal occupancy, not a continuous influence value computed fresh every
tick. This removes an entire category of problems the old design had: no isoline shader, no
tuned percentage thresholds, no per-tick recomputation across the whole map. Ownership is a
flag on a precomputed graph node — checked and changed, not calculated.

Subprovinces are also now the shared substrate for supply connectivity, retreat pathing, and
encirclement (see Supply System, above) — all three run as queries over one subprovince
adjacency graph instead of three separate mechanisms built on three different ideas of
"territory."

### Subprovince Generation (Pipeline, Build-Time Only)

Generated once per map export, alongside `waypoints.json` — never regenerated at runtime,
never hand-edited. See MAP_DATA_CONTRACT.md's Subprovinces section for the file format.
Prototype reference implementations (not yet wired into `pipeline.py`) are attached to the
handoff for this feature — see HANDOFF.md.

**Carving order is what guarantees terrain-type boundaries are never crossed:**

1. **Capital ring.** Buffer the city point by a fixed radius, clip to the province. Flagged
   `is_capital = true`, exempt from the normal capture rule below — changes owner only on
   city/province capture.
2. **Merged town cells.** Every other `urban` cover_combat patch in the province becomes
   exactly one subprovince regardless of size — never subdivided, unlike hinterland patches.
   These flip under the normal capture rule; only the capital ring is locked.
3. **Road corridor.** Buffer every road centerline by one fixed width and seed spacing,
   identical for every `road_level` — `road_level` continues to govern movement/animation
   speed only, never corridor geometry. Seed points along the centerline (jittered, roughly
   1.5–2.5km spacing), Voronoi-partition the buffered strip from those seeds. Produces the
   chain of small cells that gets captured one at a time advancing down a road.
4. **Hinterland fill, terrain-patch-first.** Whatever remains is intersected against each
   `cover_combat` patch *before* anything else happens to it. A patch small enough becomes
   one subprovince as-is. A patch too large for one capture-sized cell is subdivided, but
   only within that single patch — a subprovince edge can never cross from one cover_combat
   type into another, because it is never handed geometry spanning two types to begin with.
5. **Terrain-cost-weighted split for oversized patches**, not a plain geometric Voronoi
   split. Seed the patch (jittered points), then run multi-source Dijkstra over a per-pixel
   cost raster instead of straight-line distance:
   ```
   cost(pixel) = 1 / (cover_move[cover_combat(pixel)] × elevation_move[elevation_type(pixel)])
   ```
   `cover_move` / `elevation_move` are this document's existing off-road movement multiplier
   tables (Layer 2) — inverted, since they're speed values (higher = faster) and Dijkstra
   needs a cost value (higher = more expensive to cross). Because `cover_combat` is constant
   inside one patch by construction (step 4), the texture this reacts to comes from
   `elevation_type`, an independent layer that can still vary underneath a single cover
   patch — a forest block spanning both flat ground and a ridge, for example. Boundaries
   inside a subdivided patch bend to run along the expensive terrain rather than cut straight
   across it, for the same underlying reason a real administrative border would. This is a
   raster labeling, so full coverage inside the patch is exact by construction — every pixel
   gets exactly one owner, no polygon-topology edge cases to get wrong. Vectorize the result
   back into polygons using the same raster→vector step already used for `cover.geojson` and
   `elevation.geojson`.
6. **Rivers** remain a hard splitter, the same role they already play at the province level
   — a thin, very-high-cost band stamped along `rivers.geojson` into the cost raster, crossed
   only at a deliberate low-cost gap where a bridge exists.
7. **Sliver merge.** Any cell below a minimum area threshold merges into whichever neighbor
   it shares the most boundary with. Reassigns area, never discards it.

**Do not add cosmetic noise to finished polygon edges after the fact.** A prototype pass
tried wobbling each cell's boundary post-hoc for a hand-drawn look and it silently broke
exact tiling — two cells sharing a border each perturbed their own copy of it independently,
opening real gaps (measured ~2% of area on a test province; a "fix" using coordinate-matched
edge keys made it worse, since boundaries built by different operations don't reliably share
bit-identical coordinates even when they're the same line). Irregularity belongs in the seed
jitter (steps 3/5) and the terrain-cost field (step 5) — both exact-tiling-safe by
construction. A genuinely wavy *rendered* edge on top of this should be a purely cosmetic
mesh-displacement effect in Godot, fully decoupled from the authoritative server polygon —
capture, supply, and encirclement must all agree on the exact geometry; only the server's
copy is allowed to be authoritative.

**Full coverage is a build-time assertion, not an assumption:**
`province_polygon.difference(unary_union(all_subprovinces_in_province)).area` must equal 0
(within float tolerance) before the pipeline accepts the export. Fail the build otherwise.

### Capture Rule

- A subprovince flips to a nation's ownership the instant any of that nation's units
  physically occupies its polygon. No radius, no engagement-area involvement — literal
  occupancy only.
- **Ownership is sticky at the province level, not the subprovince level.** As long as the
  attacking nation has at least one living unit anywhere in the province, everything they've
  captured stays captured, even cells they're no longer standing on. Only when the attacker
  has zero units left in the province — all destroyed or retreated out — do all subprovinces
  they'd captured there revert to the defender, in a single pass, at once.
- **Combat freezes color.** A subprovince with an active tactical-combat instance keeps
  showing whichever nation held it before the fight started until that instance resolves —
  no flip mid-fight, regardless of which side currently has units standing on it.
- **(Open — confirm before implementing)** Whether recon-classified units should be excluded
  from triggering a flip, as they were excluded from contributing to the old influence
  system. Current default: no exclusion, any unit type flips a cell it occupies.
- **(Open — confirm before implementing)** Whether a city capture cascades to instantly flip
  every remaining un-captured subprovince in that province to the new owner, or whether
  subprovinces the attacker never physically touched stay defender-colored until
  individually captured. Leaning toward cascade, for consistency with the existing "province
  ownership transfers... immediately" rule, but this hasn't been explicitly confirmed against
  the discrete-ownership model.

### Rendering — Fade Transition

Ownership flips are authoritative and instantaneous server-side — retreat, supply, and
encirclement all need to agree on the true state immediately. The *rendered* color is
purely client-side and eases: old nation color → neutral gray → new nation color, roughly
300–500ms each half. If a cell flips again before a tween finishes, restart the tween from
its current interpolated color rather than queuing the new one — a cell changing hands
repeatedly should look unsettled, not laggy.

This replaces the old shader-based isoline rendering entirely: flat per-polygon fill, no
influence-blend shader math, no distance-falloff computation, no ownership-bonus scalar.
There is no frontline "line" to compute or smooth anymore — the visible boundary between two
differently-colored adjacent subprovince polygons *is* the front line.

**(Open — confirm before implementing)** Should the "combat in progress" frozen-color state
render identically to the fade-transition's neutral-gray hold, so an active fight reads
visually the same as "undecided"? Or should it stay the pre-combat solid color throughout
the fight? Both were discussed, not resolved.

### City Capture and Ownership Transfer

Unchanged trigger from the previous design: a division physically occupying the city node
flips province ownership immediately. What changes is only what happens to the rest of the
subprovince mosaic at that moment — see the cascade-vs-no-cascade open question above.

### Frontline Visibility by Player Type

Same intent as before, simplified mechanism:

- **Belligerent nations:** full subprovince ownership visible, plus own division
  positions/compositions. Enemy division positions only within observation radius; enemy
  composition hidden unless observation or alliance intelligence-sharing reveals it.
- **Neutral nations:** province-level macro picture only —
  `owned_subprovince_count / total_subprovince_count` per nation, per province, is cheap to
  compute and broadcast, giving neutrals the same "newspaper-level" intelligence the old
  influence percentage gave them, without exposing subprovince- or division-level detail.

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
| Out of Supply (Tier 1) | No path to a friendly/allied supply hub through friendly/allied road-corridor subprovinces | No HP recovery, slow suppression threshold decay, reduced speed | Yes — clean retreat |
| Cut Off (Tier 2) | ring(1), ring(2), or ring(3) around the division has zero friendly/allied subprovinces | All Tier 1 + fighting withdrawal on retreat (takes damage moving) | Yes — costly |
| Encircled (Tier 3) | ring(1) or ring(2) around the division has zero friendly/allied subprovinces | All Tier 2 + armour fuel decay, escalating debuffs per tick | No — disabled |

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
- Subprovince generation constants — `target_cell_area`, `hinterland_spacing` (fine-density
  starting point chosen; exact values from playtesting against session-length targets), road
  corridor buffer width/spacing (confirmed uniform across all `road_level`s; exact values
  TBD), capital/town buffer radius, sliver `min_area` merge threshold
- Whether recon-classified units are excluded from triggering a subprovince capture flip
  (see Subprovince Capture System — Capture Rule)
- Whether city capture cascades to flip every remaining subprovince in the province, or only
  ones the attacker physically touched (see Subprovince Capture System — Capture Rule)
- Fade-transition duration for subprovince ownership color changes (300–500ms per half
  proposed, not confirmed by playtesting) and whether the combat-frozen state should render
  as the same neutral-gray hold or stay solid pre-combat color throughout the fight
- Whether road-segment supply flow stays gated exclusively to friendly/allied road-corridor
  subprovinces, or falls back to non-road subprovinces at reduced throughput when a division
  is off-road (see Supply System — Model: Road Segment Flow Rate)
- Movement profile recomputation trigger debounce (avoid recomputing on every keystroke
  during template editing — trigger on save/confirm)
- Box selection trigger gesture: double-press-and-drag vs. a plain single-drag over empty
  space (confirmed: must not collide with Waypoint Drag Refinement or any other existing
  drag gesture; exact trigger from playtesting and feel-testing against accidental
  selection while panning)
- Formation Move row width (how many divisions per row before wrapping to a new row
  behind) and exact slot-assignment heuristic; confirmed nearest-available-slot is cheap
  enough at this game's division counts, exact tie-breaking rule from playtesting
- Waypoint Drag Refinement's live-preview throttle interval during an active drag
  (confirmed: abstract-layer estimate only during drag, full-precision path computed once
  on release; exact estimate refresh rate from playtesting and performance profiling)
- Three-or-more-attacker flanking: confirmed the classification uses the maximum
  pairwise angle among all attackers; exact UI treatment for showing all pairwise angles
  (or just the winning pair) in the tactical combat panel from playtesting
- Marshalling rate constant and the ≥50% aggregate-HP early-deployment threshold are
  confirmed qualitatively; exact `MARSHALLING_RATE` value from playtesting
  (RESOURCE_ECONOMY.md)

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
