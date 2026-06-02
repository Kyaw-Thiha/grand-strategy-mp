# Grand Strategy Multiplayer — Strategic Combat Design

> Confirmed design decisions for the strategic layer of combat.
> Last updated: May 2026.
> Tactical combat (division-level grid system) is a separate design space — see TACTICAL_COMBAT.md (TBD).

---

## Movement System

### Core Model: Free Movement with Road Priority

Units move freely across the map but road network is the dominant factor in all movement, supply, and strategic planning.

**Off-road movement:**
- All divisions can move off-road
- Off-road speed is significantly reduced, scaled by terrain type
- Dense forest: slow. Open plains: moderate. Mountains and jungle: impassable for most unit types (armor, motorized, artillery)
- Light infantry can traverse most terrain types off-road

**On-road movement:**
- Road level dictates exact movement speed (dirt track → paved road → highway)
- Fastest possible movement is always on roads
- Roads are the only viable route for supply (see Supply System)

**Strategic implication:** Roads are primary objectives. Key junctions, mountain passes, and bridges are naturally high-value targets — capturing or destroying them has cascading logistical consequences.

---

## Command Layer

### Two-tier command: Macro and Micro

Designed to scale naturally from early-game narrow fronts to late-game wide fronts without forcing the player to micromanage.

**Macro (Army Group level):**
- Player draws an advance axis along a road corridor (Line War-inspired draw command, constrained to road network)
- All divisions assigned to that army group flow along the axis automatically
- System handles road priority, column depth ordering, and advance pacing
- Player sets the objective; the system handles column logistics
- Supply automatically follows the same axis

**Micro (Division level):**
- Player can select any individual division and override its orders at any time
- Manual orders: hold position, retreat to a specific junction, flank via a specific off-road route
- Micro is always available but not required

**Scaling behaviour:** Narrow fronts (early game, e.g. Franco-German border with 6–10 divisions) are naturally managed at micro level. Wide fronts (late game, e.g. Eastern Front scale with 30–40 divisions) create organic pressure toward macro command. The game does not lock the player into either mode — friction teaches strategy.

---

## Supply System

### Model: Road Segment Flow Rate

Supply is modeled as a flow rate per road segment, not as discrete individual entities. This keeps server simulation load manageable while preserving full strategic meaning.

**Supply hub:**
- A building constructed in a province
- Defines the rate at which supply is generated (supply/tick)
- Feeds into the road network from its node outward
- Capturing an enemy supply hub forces them onto longer, thinner supply lines — a primary strategic objective

**Flow mechanics:**
- Each road segment between two nodes has a current supply throughput capacity
- Supply flows from hub → road graph → divisions drawing from their current segment
- Divisions draw supply from whatever segment they occupy
- If a road segment is cut (enemy captures a node, air interdiction, enemy unit blocks the road), flow to everything downstream is reduced or stopped

**Visual representation:**
- Truck sprites animated along roads as a client-side cosmetic effect driven by segment throughput value
- Lit roads = active supply flow. Dim/broken roads = supply disrupted
- Simulation is pure graph flow math — sprites are display only

**Air interdiction:**
- Air units attack road segments, not individual trucks
- A successful strike reduces that segment's throughput capacity for N ticks
- Visually: segment dims, supply flow to downstream divisions drops
- Divisions undersupplied: take increased attrition, strength degrades over time

---

## Division Representation

### NATO Military Symbols (Rectangle Icons)

Divisions are represented as NATO standard rectangle unit symbols on the map.

**Why:**
- Immediately recognisable to the HoI4 / grand strategy audience
- Communicates unit type at a glance without UI clutter
- Scales cleanly — 40 NATO rectangles on a map is readable; 40 illustrated portraits is chaos
- Sits naturally in a road column as stacked icons

**Icon anatomy:**
- Rectangle body with unit type symbol inside (infantry, armor, motorized, artillery, supply)
- HP bar rendered below the rectangle
- State communicated via border/fill colour (see Combat States)
- Stack badge (number) shown when multiple divisions collapse at macro zoom

---

## Road Column and Stacking

### Horizontal column at micro zoom, vertical stack at macro zoom

**Micro zoom (division-level):**
- Each division occupies a distinct position along the road, spaced horizontally
- Column depth is spatially visible — front division physically further toward the enemy than reserves
- Players can see gaps in the line as empty road segments
- Divisions can be dragged to reposition along the road

**Macro zoom (army group level):**
- Divisions on the same road axis within a threshold distance collapse into a single vertical stack icon
- Stack badge shows division count
- Badge colour reflects the front division's current state
- Clicking the stack expands back to individual icons

**Column ordering:**
- Front division (closest to enemy) is the active combatant
- Subsequent divisions in the column are reserves, ordered by proximity to front
- When the front division retreats or is destroyed, the next division in the column automatically advances to become the new front

**Note on retreat visual:** When a front division retreats backward through the column, the current confirmed representation is a vertical stack at macro zoom. Two-lane road rendering (retreat lane / advance lane) is a candidate approach for a later visual polish pass.

---

## Combat States

Every division cycles through the following states. All combat resolution is server-side (Colyseus). Client displays results only.

### Engaged
- Division is actively fighting
- Organisation (org) drops fast each combat tick
- Strength (str) drops slowly
- Can attack and defend normally

### Suppressed
- Triggered when org reaches zero
- Cannot initiate attacks
- Takes increased strength damage per tick
- Player has a window to manually order retreat
- If no order given and suppression crosses threshold, division auto-retreats along its supply road

### Retreat
- Division moves back along the road it came from toward the nearest friendly node
- Next division in column automatically advances to fill the front position
- Retreating division recovers org during retreat
- Strength damage stops unless under pursuit fire

### Destroyed
- Triggered when a suppressed division is cut off (road blocked, encircled) and cannot retreat
- Strength decays to zero → division eliminated
- This is the primary satisfying destruction outcome — a consequence of positional failure, not a random roll

### Attacker vs Defender asymmetry
- **Defenders:** auto-retreat when suppressed and road is open
- **Attackers:** must manually order retreat; no auto-retreat
- This asymmetry rewards aggressive play and creates meaningful decisions about how far to push a suppressed division

---

## Combat Victory Conditions (Strategic Layer)

Hybrid push-back and destruction model. Neither pure HoI4 (push-back only → stale fronts) nor pure Call of War (destruction only → arbitrary outcomes).

| Outcome | Trigger | Result |
|---|---|---|
| Retreat | Suppressed + road open | Division falls back, position lost, division survives |
| Destruction | Suppressed + encircled/cut off | Division eliminated, dramatic moment |
| Hold | Defender holds org above zero | Attacker attrition continues, no position change |
| Breakthrough | Attacker destroys/routes front division with no reserve behind it | Road axis opens, exploitation possible |

**Design intent:** Sessions must resolve. Stale fronts are avoided by ensuring that suppressed divisions without depth behind them will be destroyed rather than indefinitely pushed back. Column depth (number of reserve divisions) is a meaningful investment, not just a number.

---

## Open Questions (To Be Resolved in Playtesting)

- Do retreating divisions take passive strength damage during the retreat move, or only when in active combat? This determines how punishing overextension is.
- Exact org and strength decay rates per combat tick — balance question.
- Threshold distance for macro zoom stack collapse.
- Road throughput capacity values per road level.
- Supply generation rate for supply hub building.
- Off-road speed penalties per terrain type (exact values).

---

## Out of Scope for This Document

**Tactical combat** — the division-level grid system (4×4 or 5×5 grid, unit composition within a division, tactical combat rules) is a separate design space. See TACTICAL_COMBAT.md (TBD).

**Air combat** — referenced here only as an interdiction mechanic against road segments. Full air system design is TBD.

**Naval** — not addressed.
