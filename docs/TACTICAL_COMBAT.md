# Grand Strategy Multiplayer — Tactical Combat Design

> Confirmed design decisions for the division-level tactical combat layer.
> Last updated: June 2026.
> This document covers the 5×5 grid system, unit archetypes, combat resolution, terrain
> integration, positional mechanics, unit experience, formation bonuses, attacker/defender
> determination, and the interface between tactical outcomes and the strategic layer defined
> in STRATEGIC_COMBAT.md.

---

## Design Philosophy

Tactical combat is an **auto-battler**. Players preset their division templates before the
game begins and cannot edit a division's composition while it is actively engaged. The grid
resolves automatically each round. Players who never open the combat panel still receive
reasonable outcomes. Players who study and optimise their compositions extract a meaningful
edge.

This satisfies two tenets simultaneously:
- **Casual accessible:** set a preset template and let it fight. No split-second decisions
  required.
- **Sweaty depth:** endless optimisation of grid composition, unit placement, row positioning,
  formation synergies, terrain template matching, and unit experience management is available
  to players who want it. The ceiling is high; the floor is forgiving.

There is no dominant meta template. Unit types are deliberately specialised — each excels in
one role and is weak or irrelevant in others. No single composition counters everything. The
correct template is always contextual: terrain, enemy composition, experience levels, front
width, and mission type all shift the optimal answer.

---

## The 5×5 Grid

Each division is represented as a 5×5 grid of unit slots. 25 cells total. Rows and columns
are the two tactical axes.

```
     C1    C2    C3    C4    C5
R1 [ -- ][ -- ][ -- ][ -- ][ -- ]   ← back row (deepest, most protected, no perk)
R2 [ -- ][ -- ][ -- ][ -- ][ -- ]   ← Reserve
R3 [ -- ][ -- ][ -- ][ -- ][ -- ]   ← Support
R4 [ -- ][ -- ][ -- ][ -- ][ -- ]   ← Assault
R5 [ -- ][ -- ][ -- ][ -- ][ -- ]   ← Vanguard (front row, closest to enemy)
```

**Why 5×5 over 4×4:**
Five columns create a contested centre (C3) that can be threatened from both flanks. Four
columns have no true centre — the two middle columns are symmetric and neither is more exposed.
The centre column in 5×5 creates a strategic focal point: armour placed there can be flanked
from either direction, making its placement a genuine decision.

**Grid orientation in combat:**
When two divisions engage, their grids face each other. The enemy's R5 is the row closest to
your R5. Attacks travel across this interface. Units in R5 are most exposed; units in R1 are
deepest in reserve.

---

## Template System

### Pre-game templates
Players bring a saved division template into the game. Templates are set in three ways:

1. **Nation presets** — historically flavoured templates provided for each nation. Available
   in the lobby to all players regardless of account. A German player gets panzer and infantry
   presets appropriate to the 1939 period. Immediately playable with zero setup.
2. **Custom saved templates** — created in the main menu template builder before joining any
   game, saved to the player's account via Supabase and persisted across sessions.
3. **Mid-game creation** — players can create and save new templates during a game when a
   division is out of combat. The new template is written to their account immediately.

### Mid-game redeployment
A player may switch an existing division to a different template while that division is out
of combat. On switch:
- The division is removed from the map
- It redeploys at the nearest friendly city with the new template's composition
- Redeployment takes a flat **1 minute** of game time regardless of distance
- The division cannot be ordered or engaged during redeployment
- New templates only apply to freshly redeployed or newly spawned divisions — existing
  divisions in the field keep their current composition until explicitly redeployed

### Locked during combat
The grid composition is **locked** while a division is engaged. No editing, no redeployment
orders. This prevents reactive composition swapping in response to observing the enemy grid.
Pre-planning is the skill, not in-the-moment editing.

---

## Combat Rounds and Lethality Escalation

### Round structure
Tactical combat resolves in discrete **rounds**. Each round lasts a fixed duration (target:
20 seconds, exact value set by playtesting at 15/20/30 seconds).

### Five escalation phases

| Phase | Rounds | Lethality | Name |
|---|---|---|---|
| 1 | Round 1 | Low | Contact |
| 2 | Round 2 | Moderate | Firefight |
| 3 | Round 3 | High | Intense |
| 4 | Round 4 | Very high | Decisive |
| 5 | Round 5+ | Maximum | Annihilation |

From Round 5 onward, lethality remains at maximum until one side retreats or is destroyed.

**Design intent:** Early rounds are forgiving. A division that accidentally engaged the wrong
enemy takes a soft version of the battle in Rounds 1–2. Casuals are not catastrophically
punished for mistakes made early in an engagement.

### Force recon exception
Certain units bypass the lethality ramp and deal full damage from Round 1:
- Tank recon variants (specialised light tanks with recon role)
- Late-war armoured cars with recon specialisation
- Commando units
- Sniper specialisations with force recon designation

This is a deliberate depth lever for experienced players. A player who pre-loads force recon
can deal disproportionate early-round damage before lethality ramps for the rest of the field.

---

## Dual-Bar Combat: Suppression and HP

Every unit in the grid has two independent health values:

### HP (hit points)
- Represents permanent combat capability
- Damage to HP is not recovered during combat
- HP recovers slowly via supply between engagements
- When a unit's HP reaches zero it is destroyed and removed from the grid permanently
- When all units in a division reach zero HP the division is destroyed

### Suppression bar
- Represents temporary combat effectiveness loss
- Fills when the unit receives suppression-typed attacks
- Decays naturally each round (base decay rate set by playtesting)
- Decays 2–3× faster during retreat
- Does **not** reset instantly on retreat — carry-over suppression models withdrawal disorder
- When the suppression bar is full: unit deals zero damage and zero suppression, but also
  receives reduced incoming HP damage (fully in cover, not fighting back, not easily killed)

### Division-level suppression threshold
When the **average suppression** across all active (non-stealth, non-destroyed) units exceeds
the threshold, the division triggers Suppressed state at the strategic layer.

Base threshold: 60% average suppression. Modifiable by future systems:
- General traits (later module)
- Doctrine bonuses (later module)
- Morale effects (later module)

---

## Unit Archetypes and Attack Patterns

All combat resolution is **server-side** (Colyseus). The client displays results only.

### Attack pattern conventions
- **Row** = horizontal axis (R1–R5). R5 is the front (closest to enemy).
- **Column** = vertical axis (C1–C5).
- **Front row** = the frontmost row in the enemy grid that contains at least one living unit.
  If R5 is empty, check R4. If R4 has one unit, all damage concentrates on that one unit —
  no damage is distributed to empty cells.
- Attacks are resolved simultaneously each round — not sequentially.

---

### Infantry archetypes — horizontal attack pattern

**Units:** Standard infantry, assault infantry, mechanised infantry, recon infantry.

**Pattern:** Attacks the frontmost occupied row of the enemy grid (the first row from R5
upward that contains at least one living unit). Damage is distributed only among living units
in that row — empty cells receive nothing.

**Damage profile:** Soft attack only. Deals no meaningful damage to armoured units regardless
of row position. Infantry's job is to attrit enemy infantry and force the front row to thin,
exposing rear rows to subsequent rounds.

**Recon infantry:** Identical pattern but contributes recon value each round.

---

### Machine gun — horizontal attack, suppression specialist

**Units:** Heavy machine gun teams, vehicle-mounted MGs.

**Pattern:** Same horizontal frontmost-occupied-row targeting as infantry.

**Damage profile:** Very high suppression output against infantry. Low HP damage. Negligible
effect against armour. The primary tool for pinning enemy infantry into the full-suppression
state (unit stops firing, takes reduced damage).

**Key distinction from AT:** MG suppresses infantry effectively. AT does not. These are not
interchangeable.

---

### Armour archetypes — vertical column attack

**Units:** Light tank, medium tank, heavy tank, armoured car.

**Pattern:** Attacks all living units in its own column of the enemy grid, from R5 upward.

**Depth rule:** A tank in its own R3 can only strike enemy R3, R4, and R5 — it cannot fire
through its own front rows into the enemy's back rows. A tank in R5 strikes all five enemy
rows in its column.

**Column shift — flanking and envelopment:**
When a tank's column in the enemy grid is empty, it shifts to find targets:
- C1, C2 (left flank): shift right to the nearest occupied column → **Tactical Flanking**
  bonus damage
- C3 (centre): shift toward nearest occupied column (random if equidistant) → Tactical
  Flanking
- C4, C5 (right flank): shift left → Tactical Flanking
- If the first shift column is also empty, shift one further → **Tactical Envelopment**
  (higher bonus), targets hit on **side armour** (reduced armour value)

**In dense_forest or urban terrain:** Armour cannot use column shift flanking at all. Fires
only in its own column, even if that column is empty. Terrain blocks outflanking manoeuvre.

**Armour resistance to suppression:** High base suppression resistance. Suppression only
meaningful from AT units, aircraft, and specific AT specialisations.

---

### Anti-tank infantry and AT gun — column selective targeting

**Units:** AT infantry, towed AT gun, self-propelled AT gun.

**Primary target:** Armoured units only. AT deals negligible damage and suppression to
non-armoured units. It does not substitute for MG or standard infantry.

**Pattern:** Targets armoured units in its own column first. If no armour in the column,
shifts toward the nearest occupied column containing armour (picks one direction — nearest
first, random if equidistant) and targets **side armour**. Does not target both adjacent
columns simultaneously — picks one.

**Suppression profile:** Very low suppression output against armour. Primary effect is HP
damage when armour penetration threshold is met (see Armour Penetration System). AT below
penetration threshold deals zero damage.

---

### Anti-aircraft gun — column selective targeting (air threats)

**Units:** Light AA gun, heavy AA gun, self-propelled AA.

**Primary role:** Counters air units attacking the division (see AIR_COMBAT.md). During
ground-only combat AA contributes minimally to the land grid — not a general-purpose
anti-infantry unit. Value is entirely in reducing incoming air damage.

---

### Sniper — selective targeting across entire grid

**Units:** Sniper team, force recon sniper specialisation.

**Pattern:** Ignores row and column restrictions. Targets anywhere in the enemy 5×5 grid.

**Priority target list (in order):**
1. Enemy snipers
2. Flamethrowers
3. Force recon units
4. Machine gun teams
5. AT gun crews
6. Standard infantry (fallback when no priority targets present)

**Damage profile:** High HP damage to infantry targets. Low suppression. Bypasses cover
bonuses that infantry receive in certain terrain.

**Stealth:** Gains stealth in urban (high) and forest (moderate). Zero stealth in plains or
desert. See Stealth System.

---

### Flamethrower — area of effect

**Units:** Flamethrower infantry team, vehicle-mounted flamethrower.

**Pattern:** AOE centred on a 3-column wide, 2-row deep zone. Zone anchored at a fixed
offset from the flamethrower's own position — always fires 1 row ahead of itself into the
enemy grid, covering 3 columns (its own column and one column either side, clamped to grid
edges).

**Example:** Flamethrower in R5, C3 fires into enemy R5 and R4, across C2, C3, C4.
Flamethrower in R4, C3 fires into enemy R4 and R3 — reaching deeper into the formation.

**Row placement creates a genuine decision:** R5 placement suppresses enemy front rows.
R4 placement reaches the second rank where tanks and AT guns typically sit — a deliberate
counter-armour positioning choice, at the cost of fewer infantry in the front row to absorb
incoming fire.

**Damage profile:** Extreme suppression against infantry. Moderate HP damage against infantry.
Zero effect against armoured units — armour is immune to flame suppression.

---

### Artillery — recon-proportional random area hit

**Units:** Field artillery, howitzer, self-propelled gun.

**Pattern:** Hits a random cell (or 2×2 cluster for upgraded variants) in the enemy grid.
Target cell chosen randomly, but probability weights shift toward occupied cells proportional
to the division's current recon value.

- At zero recon: fully random across all 25 cells. Many shots land on empty cells.
- At maximum recon: weighted heavily toward occupied cells, prioritising high-value targets.

**Damage profile:** High HP damage to any unit hit. Moderate suppression. Effective against
infantry and lightly armoured targets. Cannot penetrate heavy armour.

**Recon dependency:** Artillery effectiveness scales directly with accumulated recon value.
Early rounds (before recon builds) artillery is wasteful. Investing in recon units converts
it from a random nuisance into a precision asset — a primary skill lever for experienced
players.

---

## Row Positional Perks

Each row grants a passive bonus to all units placed in it. These represent the tactical
reality of a unit's position in the formation. Bonuses are small and consistent — they
shift the optimal placement of specific unit types without making sub-optimal placement
useless.

| Row | Name | Passive bonus |
|---|---|---|
| R5 | Vanguard | +% suppression dealt. Exposed front line — aggressive contact fire rewarded |
| R4 | Assault | +% HP damage dealt. Second wave hitting already-disrupted enemies |
| R3 | Support | +% suppression resistance. Protected enough to maintain steady fire |
| R2 | Reserve | Faster suppression decay rate. Partial relief from fire, faster recovery |
| R1 | — | No bonus. Simply the deepest protection. Filling R1 is a durability choice |

**Design intent:** R1 grants no bonus — it is pure safety. A player who fills R1 gains depth
(units survive longer) but not power. A player who only fills R5–R3 gets more concentrated
firepower but dies faster under sustained fire. This is a genuine tradeoff, not a dominant
choice.

**Examples of row perk decisions:**
- A flamethrower in R4 (Assault, +% HP damage) deals more HP damage. The same flamethrower
  in R5 (Vanguard, +% suppression) pins the enemy harder. Both are valid.
- An MG in R3 (Support, +% suppression resistance) maintains fire longer without being pinned.
  An MG in R5 deals more suppression but is the first to take fire.
- Artillery in R1 has no perk — but it is the deepest and safest position. This is correct:
  artillery's value comes from recon accumulation over rounds, not from a row bonus.

**No column perks.** Column positioning already has deep mechanical expression through the
armour flanking/envelopment system and AT column traversal. Adding separate column perks
would duplicate or conflict with existing mechanics.

---

## Formation Bonuses (Adjacent Unit Synergies)

When specific unit types are placed **adjacent** (horizontally or diagonally) in the grid,
they unlock a passive bonus for one or both units. Bonuses are visible in the grid builder
UI when the placement condition is met (small indicator icon on the relevant cells).

Formation bonuses are **emergent** — a casual player who doesn't know about them gets no
penalty; they just don't receive the bonus. A sweaty player discovers, plans, and builds
around them deliberately.

### Confirmed formation bonuses

**AT gun + MG (adjacent):**
The AT gun gains +% suppression against armour targets. The MG's fire forces tank crews to
button up, degrading situational awareness and making them easier to target precisely.
Historical: combined anti-armour fire support doctrine.

**Sniper + Recon infantry (adjacent):**
The sniper gains +1 priority target level — can target the next item down the priority list
even when a higher-priority target exists. The recon unit spots for the sniper, enabling
more selective fire.

**Flamethrower + Assault infantry (adjacent):**
Assault infantry in the same or adjacent cells gain immunity to the flamethrower's own AOE
suppression. They are trained to advance with FT support without being pinned by it.
Historical: flamethrower assault teams operated in tight coordination with infantry.

**MG + MG (same row, any two columns):**
Both MGs deal +% suppression to their shared target row (overlapping fields of fire).
Historical: interlocking fields of fire — the core of WW2 defensive doctrine.

**Artillery + Recon infantry (adjacent):**
Artillery's recon accumulation rate increases each round. The recon infantry actively spots
for the artillery rather than passively contributing the base rate.

*Additional formation bonuses may be added as new unit types are introduced in later modules.
The pattern is: historical combined-arms tactics → mechanic. If no historical precedent exists
for an adjacency, no bonus is designed.*

---

## Unit Experience System

Units accumulate experience through combat and training. Experience is uncapped but follows
a diminishing returns curve — each tier takes progressively more combat rounds and victories
to reach.

### Tier thresholds (approximate — exact values set by playtesting)

| Tier | HP bonus | Suppression resistance | Recon contribution | Combat to reach |
|---|---|---|---|---|
| Green | — | — | Base | Starting tier |
| Seasoned | +10% | +5% | +10% | 2–3 battles |
| Veteran | +20% | +15% | +25% | 5–8 total battles |
| Elite | +35% | +25% | +40% | Session-long achievement |

### Experience accumulation sources
- **Combat:** each round survived in active engagement contributes experience. Winning the
  engagement contributes a larger bonus.
- **Barracks building:** constructed in a province. Allows players to spend resources to
  accelerate experience gain for units stationed in or passing through during non-combat
  downtime. Trains up to the tier currently unlocked by research — a player who has not
  researched veteran doctrine cannot train past Seasoned even at level 3 barracks.

### Irreplaceability
When a unit is destroyed its experience is gone permanently. A rebuilt unit starts at Green.
This creates genuine attachment to experienced units and creates a strategic cost to throwing
Veteran units into hopeless engagements.

Experience is **per unit slot in the grid** — not per division template. If a division is
redeployed to a new template, its experienced units are disbanded and the experience is lost.
This is the primary cost of mid-game template switching: you sacrifice earned experience for
compositional flexibility.

### Experience and stealthed units
Stealthed units that survive a destroyed division into reserve **retain their experience
tier**. When returned to active service in a new division, they continue from their current
tier. This makes elite commando and stealth AT units extremely valuable across a session.

---

## Armour Penetration System

Armoured units have two armour values:
- **Front armour:** applies when attacked from the front (standard column attack)
- **Side armour:** reduced value, applies when attacked via flanking/envelopment shift or
  side-targeted AT column traversal

AT units and other anti-armour weapons have an **armour penetration value**. Damage dealt
is determined by the ratio of pen to armour:

| Pen / Armour ratio | Damage dealt |
|---|---|
| < 60% | 0% (no effect) |
| 60–69% | 20% |
| 70–79% | 30% |
| 80–89% | 40% |
| 90–99% | 70% |
| ≥ 100% | 100% |

The hard floor at 60% means under-gunned AT is not just weak — it is completely useless.
This prevents stacking under-spec AT for marginal effect (the HoI4 failure mode).

---

## Stealth System

Certain units have a **stealth level** that varies by terrain. Stealth is a value that must
be exceeded by an enemy's **anti-stealth level** to reveal the unit.

**While stealthed:**
- The unit deals damage normally
- The unit cannot be targeted (takes zero incoming damage)
- The unit's HP and suppression values are **excluded** from the division's retreat/destroy
  threshold calculation
- If the division is destroyed while units remain stealthed, those units are placed into
  reserve and **retain their experience tier**

**Terrain stealth values (exact values set by playtesting):**
- Sniper: high stealth in urban, moderate in forest, zero in plains or desert
- AT gun (specialised): moderate stealth in forest and hills, zero in open terrain
- AT infantry (specialised): moderate stealth in forest, urban; zero in plains
- Commandos: high stealth in most terrain types; zero in plains and desert

**Anti-stealth:** Units with anti-stealth level greater than the target's stealth level
reveal the stealthed unit. Revealed units lose stealth for the remainder of that combat
round.

---

## Recon System

Recon is a **shared engagement value** that accumulates over combat rounds and is consumed
by artillery targeting, CAS damage scaling, and high-altitude bombing.

**Recon sources (land):**
- Recon infantry: contributes recon value each round (base rate; +bonus when adjacent to
  artillery — see Formation Bonuses)
- Recon light tank variants: higher recon rate per round
- Armoured car with recon specialisation: high recon rate
- Each combat round contributes a small baseline recon value regardless of composition

**Recon sources (air and naval):** See AIR_COMBAT.md and NAVAL_COMBAT.md.

**Detection vs recon:**
- **Recon** — targeting accuracy for weapons
- **Detection** — revealing hidden/stealthed units and enemy positions
Detection is a subset. High recon does not automatically reveal stealth units unless
dedicated anti-stealth units are present.

---

## Terrain Integration

### How terrain is determined for combat

**Defender's terrain is primary.** When combat initiates, the terrain modifiers (cover and
elevation bonuses/penalties) are sampled at the **centre of the defending division's position**
on the strategic map. The server reads the province's `terrain_elevation` and `terrain_cover`
fields from `map_data.json` — pre-computed O(1) lookups, not per-pixel sampling at runtime.

**Defender receives:** terrain defense bonuses from the MAP_DATA_CONTRACT composable system
(`defense_bonus = elevation_def + cover_def`).

**Attacker receives:** terrain attack penalty from the same composable system
(`attack_penalty = elevation_atk + cover_atk`).

**Transition modifier:** The attacker's terrain is also checked to apply a secondary modifier
to the attacker's penalty:
- Attacker terrain tier **better** than defender (e.g. plains attacking into dense_forest):
  full attacker penalty applied
- Attacker terrain tier **same** as defender (e.g. both in forest): attacker penalty reduced
  (~50% of standard penalty — attacker is not coming from worse conditions)
- Attacker terrain tier **better** in elevation (e.g. hills attacking into flat):
  attacker penalty further reduced (elevation advantage partially offsets defender terrain)

Tier ordering for comparison: `flat < hills < mountains` for elevation;
`plains/steppe < shrubland < light_forest/urban < dense_forest < jungle/swamp` for cover.

This is a 3-value lookup (better / same / worse), not a full combinatorial matrix.

### Unit-type terrain bonuses and restrictions

These bonuses stack on top of the base composable modifiers from MAP_DATA_CONTRACT.
Exact numeric values are refined in playtesting; the qualitative rules are confirmed.

**`plains` / `steppe`:**
- Armour: +% flanking damage bonus, +% column shift speed (room to manoeuvre)
- Artillery: +% recon accumulation rate per round (clear sightlines)
- Infantry: no cover bonus; −% suppression resistance (no concealment)

**`light_forest`:**
- Infantry: +% suppression resistance
- AT gun (specialised): +% penetration vs armour (ambush angles)
- Snipers: high stealth value
- Armour: −% flanking damage (reduced manoeuvre room)

**`dense_forest`:**
- Infantry, AT gun: bonuses stronger than light_forest
- Armour: cannot use column shift flanking at all — fires only in own column
- Armour: may not enter dense_forest off-road (strategic map movement restriction)

**`jungle`:**
- Recon infantry: +% recon accumulation rate
- Infantry: +% suppression resistance
- Armour: impassable — cannot enter jungle even on road for tactical combat purposes
- Artillery: −% damage (poor sightlines, recon accumulation impaired)

**`urban`:**
- Infantry: +% suppression resistance (street fighting cover)
- Snipers: maximum stealth value, +1 priority target bonus
- Armour: cannot use column shift flanking (streets force straight movement)

**`hills`:**
- Artillery: +% damage (elevation advantage)
- Infantry: +% suppression resistance
- Armour: −% flanking damage

**`mountains`:**
- Infantry divisions only — armour, motorised, artillery divisions cannot enter off-road
- Road-only access for all non-infantry division types
- Infantry: strong suppression resistance bonus

**`swamp` / `glacier` / `tundra`:**
- No unit gains bonus
- Armour: impassable off-road; road-only
- All divisions: significant movement penalty (already in MAP_DATA_CONTRACT)

**`desert`:**
- Armour: +% mobility bonus (open ground)
- Recon units: +% detection
- Infantry: −% suppression resistance (no cover)

### River crossing effects

The server checks whether the line segment between the two division centre points intersects
any river LineString in `rivers.geojson`. The check uses `river_size` from the river feature.
This check is performed once at combat initiation — not every round.

River crossing debuffs apply to the **attacker only**, during early rounds only:

| river_size | Suppression resistance penalty | HP damage penalty | Duration |
|---|---|---|---|
| `minor` | −15% suppression resistance | −10% HP damage | Rounds 1–2 only |
| `major` | −30% suppression resistance | −25% HP damage | Rounds 1–3 |

Penalty fades after the specified rounds — troops have completed the crossing and reformed.
This is intentionally harsher than a flat static penalty: the crossing moment is the
dangerous part, not the fighting once across.

The adjacency contract already encodes river crossings via `border_type: "river"` edges.
The tactical combat system reads the river geometry directly for the crossing check.

---

## Attacker and Defender Determination

Combat initiates when two engagement area circles fully overlap. Attacker/defender status is
determined automatically using a four-tier system — no player input required.

### Tier 1 — Explicit orders (clearest case)
If one division has an active ADVANCE order toward the enemy's province and the other has a
HOLD or no movement order, the advancing division is the **attacker**. The stationary division
is the **defender** and receives its terrain bonuses.

### Tier 2 — Movement vector angle (the parallel-movement case)
When both divisions are moving, compute the angle between each division's movement vector and
the line connecting the two division centres at the moment of engagement.

- Division whose movement vector points **within 45° of the intercept line** = attacker
- Division whose vector is **more than 45° from the intercept line** = defender (even if
  moving — they are moving roughly parallel, not toward the enemy)

This cleanly handles the "moving slightly parallel" case: a division moving along a border
has ~90° angle to the intercept line and is the defender even though technically in motion.
The division that turned toward it is the attacker.

### Tier 3 — Meeting battle (both advancing toward each other)
When both divisions are genuinely advancing toward each other (both vectors within 45° of
the intercept line), a **meeting battle** state is declared:

- Neither division receives defender terrain bonuses
- Both receive the attacker's terrain penalty of the other's position (each is attacking
  into the other's space)
- Neither gets suppression resistance from terrain
- The combat icon on the strategic map uses a distinct **meeting battle** icon — different
  from standard "Engaged" — so players understand why they're taking more punishment

Meeting battles are historically accurate (encounter battles were chaotic and expensive for
both sides). They also create a strategic incentive: reaching a province first and holding
it converts a meeting battle into a proper defence with terrain bonuses.

### Tier 4 — Fallback tie-breaker
Both divisions stationary, or vectors genuinely identical: the nation with fewer total
province holdings at that moment is the **defender** (smaller nation assumed on the back
foot). Rare edge case.

### Engagement area shape
**Circles**, not squares. Circles are uniform in all directions and correctly represent a
division's operational radius. Square engagement areas create axis-aligned geometric artifacts
with diagonal rivers and irregular terrain borders. Circle radii vary by division type as
established in STRATEGIC_COMBAT.md (armoured largest, defensive smallest).

---

## Engagement and Observation on the Strategic Map

### Division dot and engagement area
Each division is represented as a dot on the strategic map with two concentric circular areas:

**Observation area (large radius):**
- Reveals enemy division positions within range as dots on the player's map
- At low observation value, enemy composition shows as "?" — unit types unknown
- As observation value increases (via recon units in the template, or sustained proximity),
  composition begins to reveal progressively
- Stealth composition in enemy divisions reduces how much reveals even at high observation

**Engagement area (smaller radius, circular):**
- Set per division **type** (not per template composition):
  - Armoured division: largest engagement area
  - Motorised division: medium-large
  - Infantry division: medium
  - Defensive/fortified division: smallest
- When two engagement areas fully overlap, combat initiates automatically using the
  attacker/defender determination system above
- Partial overlap does not trigger combat — observation area handles pre-contact warning

### Flanking bonus at strategic layer
When a division is already engaged and a second enemy division's engagement area fully
overlaps it simultaneously, the second division gains a **flank attack bonus** — a percentage
increase to all damage dealt in its tactical grid combat against the engaged target.

When the flanking division is itself engaged by a friendly ally unit, it redirects to the
new threat — allowing players to relieve a division under pressure by committing support.

---

## Link to Strategic Combat States

Tactical grid outcomes feed directly into strategic layer states in STRATEGIC_COMBAT.md.

| Tactical grid outcome | Strategic layer state triggered |
|---|---|
| Division average suppression ≥ retreat threshold (base 60%) | → Suppressed |
| Suppressed + road open + no manual hold order (defender) | → Retreat |
| Suppressed + no auto-retreat (attacker) | → stays Suppressed until manually ordered |
| All units destroyed/suppressed to zero + encircled | → Destroyed |
| Enemy front row cleared with no reserves behind it | → Breakthrough — road axis opens |
| Retreat completed — division reaches friendly node | → Engaged ends, suppression decays rapidly |

**Stealthed units** are excluded from the retreat/destroy threshold calculation.
A division with 4 stealthed commandos and 1 visible suppressed infantry unit will retreat
based on the visible unit's state alone. The commandos survive into reserve with experience
retained.

---

## Combat UI

### Without opening the grid panel
Visible on the strategic map combat icon at all times:
- **HP bar:** aggregate HP of all non-stealthed units in the division
- **Suppression indicator:** border pulses amber when approaching threshold, red when exceeded
- **Round indicator:** small number showing current escalation phase (1–5)
- **Combat type icon:** standard "Engaged" vs distinct "Meeting Battle" icon
- **On hover:** attacker and defender names, round number and phase name, both divisions'
  HP and suppression bars, active terrain modifier names, whether air support is active,
  whether a river crossing penalty is in effect

### Opening the grid panel
A combat button appears over the active combat icon. Clicking opens the full 5×5 grid view:
- All living units in both grids with current HP and suppression bars
- Experience tier badge per unit (Green/Seasoned/Veteran/Elite)
- Active formation bonus indicators (glow on cells with active adjacency synergies)
- Active row perk labels per row
- Attack pattern visualisation for the current round
- Recon value accumulation indicator
- River crossing penalty indicator and remaining rounds if active
- Round timer countdown

The panel can be closed at any time. Combat continues regardless.

---

## Open Questions (To Be Resolved in Playtesting)

- Exact round duration: 15, 20, or 30 seconds per round
- Base suppression decay rate per round and faster decay multiplier during retreat
- Exact recon value contribution rates per unit type per round
- Stealth level values per unit per terrain type (exact numbers)
- Anti-stealth level values per counter-unit type
- Flank attack bonus percentage at strategic layer
- Armour pen values per AT variant vs armour values per tank variant (coupled balance)
- Exact suppression output values: MG vs flamethrower vs AT (AT must be very low)
- Column shift flanking and envelopment damage multiplier values
- Row perk percentage bonuses (R5 suppression%, R4 HP damage%, R3 suppression resistance%,
  R2 decay rate multiplier) — all confirmed qualitatively, exact values from playtesting
- Formation bonus magnitudes (confirmed qualitatively, exact values from playtesting)
- Experience tier combat thresholds (target: Green→Seasoned 2–3 battles, Seasoned→Veteran
  5–8, Veteran→Elite session-long)
- Barracks training speed and resource cost per tier
- Transition terrain modifier percentages (same-terrain penalty reduction ~50% of standard —
  exact value from playtesting)
- River crossing penalty exact values (minor: −15% suppression resistance, −10% HP damage;
  major: −30%, −25% — confirmed qualitatively, exact numbers from playtesting)

---

## Out of Scope for This Document

**Air-land interface** — CAS and tactical bomber damage patterns against the land grid,
recon dependency of high-altitude strikes. See AIR_COMBAT.md.

**Supply effects on tactical combat** — out-of-supply attrition rates and encirclement
destruction. See STRATEGIC_COMBAT.md.

**Naval tactical combat** — see NAVAL_COMBAT.md.

**Future unit types** — tech tree unlocks and doctrine-specific variants are later modules.
Their attack patterns will follow the archetypes defined here. Their formation bonuses will
follow the historical combined-arms principle.
