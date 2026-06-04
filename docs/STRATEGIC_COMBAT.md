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

**Off-road movement:**
- All divisions can move off-road
- Off-road speed is significantly reduced, scaled by terrain type
- Dense forest: slow. Open plains: moderate. Mountains and jungle: impassable for most
  unit types (armor, motorized, artillery)
- Light infantry can traverse most terrain types off-road

**On-road movement:**
- Road level dictates exact movement speed (dirt track → paved road → highway)
- Fastest possible movement is always on roads
- Roads are the only viable route for supply (see Supply System)

**Strategic implication:** Roads are primary objectives. Key junctions, mountain passes, and
bridges are naturally high-value targets — capturing or destroying them has cascading
logistical consequences.

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

### Division dot and engagement areas

Each division is represented as a dot on the strategic map with two concentric areas:

**Observation area (large radius):**
- Reveals enemy division positions within range as dots on the player's map
- At low observation value, enemy composition shows as "?" — unit types unknown
- As observation value increases (via recon units in the division template, or sustained
  proximity), enemy composition begins to reveal progressively
- Enemy divisions with high stealth composition reduce how much is revealed even at high
  observation values

**Engagement area (smaller radius):**
- Set per division **type** — not per template composition. Division type is the dot's
  strategic identity on the map:
  - Armoured division: largest engagement area (aggressive, fast-moving)
  - Motorised division: medium-large
  - Infantry division: medium
  - Defensive / fortified division: smallest (holds ground, does not reach out)
- When two engagement areas **fully overlap**, tactical combat initiates automatically
- Partial overlap does not trigger combat — the observation area handles the pre-contact
  warning window. There is no third intermediate state between observation contact and
  full combat
- Combat initiation is a consequence of movement decisions, not a separate button

### Flanking at the strategic layer

When a division is already engaged in tactical combat and a second enemy division's
engagement area fully overlaps it simultaneously, the second division gains a **flank
attack bonus** — a percentage bonus to all damage dealt in its tactical grid combat
against the engaged target.

When the flanking division is itself engaged by a friendly ally unit committing to the
fight, the flanking division stops attacking the original target and redirects to the new
threat. This allows players to relieve a division under pressure by committing a supporting
force — rescuing a failing engagement is a real strategic option.

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

### Supply and encirclement

**Cut off from supply via land:**
When a division's road connection to a supply hub is cut (enemy captures a node on the only
supply path), the division is out of supply. It can still retreat — but must move across
land it still controls rather than using roads, so retreat speed is reduced significantly.

**Full encirclement:**
When a division is surrounded on all sides by enemy-controlled territory with no land escape
route (even off-road), it cannot retreat regardless of suppression state. In this condition:
- The division is destroyed even if it has significant remaining HP
- Supply starvation accelerates HP decay until the division is eliminated
- This is the primary decisive outcome of a successful encirclement manoeuvre — destroying
  an enemy division through positional failure rather than attrition

This rule is the key incentive to cut roads and encircle rather than push frontally.
Frontal pushes force retreats. Encirclements destroy.

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
- **Defenders:** auto-retreat when suppressed and a road is open (see Retreat)
- **Attackers:** must manually order retreat — no auto-retreat. Player must decide whether
  to hold the suppressed position or pull back. This asymmetry rewards aggressive play and
  creates meaningful attacker decisions under pressure

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
| Retreat | Suppressed + road open | Division falls back, position lost, division survives |
| Destruction (encirclement) | Suppressed + no retreat route | Division eliminated — the decisive result |
| Destruction (attrition) | All grid units destroyed via HP damage | Division eliminated |
| Hold | Defender holds suppression below threshold | Attacker attrition continues, no position change |
| Breakthrough | Attacker clears enemy front row with no reserve behind it | Road axis opens, exploitation movement possible |

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
- Off-road speed penalties per terrain type (exact values)
- HP attrition rate for out-of-supply divisions (must feel urgent but not instant)
- HP attrition rate for encircled divisions (faster than out-of-supply to create urgency
  to attempt breakout or accept loss)

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
