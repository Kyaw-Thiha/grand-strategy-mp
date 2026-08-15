# Grand Strategy Multiplayer — Tactical Combat Design

> Confirmed design decisions for the division-level tactical combat layer.
> Last updated: July 2026 — added the Vehicle Sub-Status System (Mobility/Firepower/Armour/
> Optics), extending Armour Penetration and the existing Incapacitated state with deterministic,
> weapon-type-triggered degradation states; mirrored in AIR_COMBAT.md's Wing Sub-Status System
> for the equivalent air-side mechanic.
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

### Mid-game template assignment (Phase 6 MVP)

A player may switch an existing division to a different template while that division is out
of combat (via `ASSIGN_TEMPLATE` message from the DivisionTemplateViewerPanel). On switch:
- The division's `template_id` is updated immediately server-side
- `division_type`, `engagement_radius`, and `movement_profile_json` are recomputed from the
  new template's cell composition
- Grid cells are repopulated from the template's preset cell layout
- A `DIVISION_UPDATES` broadcast syncs the change to all clients
- The division does **not** change position or pause — composition updates in place

> **Future (Phase 8+):** Full redeployment mechanic — division removed from map, redeploys
> at nearest friendly city after a flat 1-minute delay, cannot be ordered during redeployment.
> Phase 6 uses immediate in-place assignment as an MVP simplification. When the full system
> lands, the `_confirm_template()` flow on the client stays the same; only the server handler
> and the redeployment UX change.

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

### Firing Order and Spillover

**Default firing order:** Attacking units fire in front-to-back, left-to-right sequence.
R5 (vanguard) fires before R4, which fires before R3, etc. Within a row, C1 fires before
C2, and so on.

**Priority fire (researchable perk):** Specific unit types can be researched to fire
before the default sequence:
- Artillery prep doctrine → artillery fires first (prep bombardment clears front row,
  enabling other units to reach deeper rows sooner)
- Cavalry charge doctrine → cavalry fires first (charge bonus hits before lines are set,
  especially powerful on Round 1)
- Sniper precision doctrine → snipers fire first (priority kill lands before mass damage)
- Commando strike doctrine → commandos fire first

Default: no unit has fire priority. All units follow the row-based sequence above.

**Spillover — row-cleared redirect:** When earlier attackers in the firing sequence fully
clear the frontmost enemy row (all cells incapacitated or destroyed), subsequent attackers
automatically redirect to the next occupied row. This is the only spillover condition.

**No spillover from n-cap:** If an attacker is configured to target n units but fewer
than n living units exist in the frontmost row, all damage concentrates on the available
units. There is NO redirect to the next row — the remaining "slots" are wasted.

**Simultaneous resolution:** The firing order list is determined from the round-start
state. A unit that is incapacitated mid-round by enemy fire still fires in the same round
— it was alive when the round began.

**Client preview:** Because there is no randomness in attack resolution, the client can
compute the exact same target assignments as the server for the upcoming round. The
`AttackPatternRegistry.simulate_round()` function performs this computation during the
inter-round timer window, allowing the UI to show each unit's intended targets before the
server's `ROUND_RESOLVED` message arrives.

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

**Design intent — standard infantry as the cheap, disposable delay unit:** standard infantry's
build cost is deliberately the lowest in the entire unit roster, by a wide margin. It is not
designed to win engagements against a properly combined-arms force — its role is to make
holding a wide or thin front economically trivial, so that a breakthrough against a screening
line of standard infantry is never an automatic collapse of the whole front. Three existing
mechanics already support this without further changes: the five-phase lethality escalation
(Contact → Firefight → Intense → Decisive → Annihilation) means a weak division facing a
stronger attacker absorbs only a soft version of the fight in the opening rounds, giving the
defending player time to reinforce or retreat rather than losing the engagement immediately;
the 20% HP incapacitation floor (the most forgiving floor of any unit category) means a
mauled infantry-heavy division loses comparatively little permanently; and 60% experience
retention on incapacitation means even a badly handled defensive screen keeps most of its
accumulated value. The combined effect: fielding standard infantry across a wide defensive
front should always be economically sound for any nation, regardless of how the rest of that
nation's army is built, because the cost of doing so is trivial relative to total economy.

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
- Columns 0, 1 (left side): search **rightward** through all columns (1→2→3→4)
- Column 2 (centre): search outward in both directions, left-first (1→3→0→4)
- Columns 3, 4 (right side): search **leftward** through all columns (2→1→0)
- First column found with targets → targets hit on **side armour** (reduced armour value)
- Shift distance 1 → **Tactical Flanking** bonus damage
- Shift distance 2+ → **Tactical Envelopment** (higher bonus)

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
first, prefer lower column index if equidistant) and targets **side armour**. Does not target both adjacent
columns simultaneously — picks one.

**Suppression profile:** Very low suppression output against armour. Primary effect is HP
damage when armour penetration threshold is met (see Armour Penetration System). AT below
penetration threshold deals zero damage.

**Fallback behavior:** When no armoured units exist anywhere on the enemy grid, AT guns
fall back to horizontal targeting (infantry-style frontmost-occupied-row targeting).
Armour is priority, not exclusive — AT guns never sit idle due to a lack of armoured
targets.

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

**Default priority target list (in order):**
1. Enemy snipers (`sniper`)
2. Force recon snipers (`force_recon_sniper`)
3. Flamethrowers (`flamethrower`)
4. Recon infantry (`recon_infantry`)
5. Machine gun teams (`mg`)
6. AT gun crews (`at_gun`)
7. Self-propelled AT guns (`at_gun_sp`)
8. AT infantry (`at_infantry`)
9. Commandos (`commando`)
10. Standard infantry (`infantry`) — fallback when no priority targets present

**Perk overrides:** The priority list can be replaced entirely by researchable perks (e.g. a counter-armour doctrine replaces the list with tank types). Available perks also raise `n_targets` (default 1).

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

### Artillery — recon-proportional weighted column targeting

**Units:** Field artillery, howitzer, self-propelled gun.

**Pattern:** Selects a target column via weighted random, then damages all living units
within an area around that column. Column weights blend two factors:

```
weight(col) = (1 − recon_value) × occupied_count(col)
            + recon_value       × value_score(col)
```

Where:
- `occupied_count(col)` = number of living enemy cells in that column
- `value_score(col)` = sum of `ARTY_UNIT_VALUE[unit_type]` for each living cell in the
  column (high-value targets like snipers and heavy tanks score 5; infantry score 1)

- At `recon_value = 0`: all occupied columns are equally likely by cell count (more
  units in a column = proportionally more weight)
- At `recon_value = 1`: high-value columns are strongly preferred (a single sniper
  in a column outweighs several infantry in another)

**Area expansion:** After column selection, all living cells in
`center_col ± area_radius` columns are targeted. Default `area_radius = 0` (single
column). Researchable perks raise it to 1 (3-column area) or 2 (full 5-column width).

**Damage falloff:** Cells further from the center column take reduced HP damage:

```
damage_mult(col) = max(0, 1.0 − falloff_per_col × |col − center_col|)
```

Default `falloff_per_col = 0.3`: center column = 1.0×, adjacent = 0.7×, two away = 0.4×.
Researchable perks can improve this (e.g. `arty_precision_fire` sets it to 0.5).

**Deterministic RNG:** The column selection uses a seeded LCG (djb2 hash of engagement_id
XOR round_number). Same engagement + same round = same result on server and client.

**Damage profile:** High HP damage to any unit hit. Moderate suppression. Effective against
infantry and lightly armoured targets. Cannot penetrate heavy armour.

**Recon dependency:** Artillery accuracy scales directly with accumulated recon value.
Early rounds (before recon builds) artillery is wasteful — shots scatter evenly across
all columns regardless of value. Investing in recon units converts it from a random
nuisance into a precision asset that strips high-value targets from the enemy grid.

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

> **Implementation status (Branches I & J):** Both the formation bonus engine (Branch I)
> and the terrain modifier engine (Branch J) are fully implemented and wired into combat,
> but ship with **zero active rules**. `getActiveFormationRules()` returns `[]` and
> `getActiveTerrainModifierRules()` returns `[]`, so both evaluators produce empty Maps
> and all lookups fall through to identity modifiers. The terrain engine supports per-cell,
> per-unit-type modifiers (`hp_dealt_mult`, `supp_dealt_mult`, `supp_resist_mult`,
> `supp_decay_mult`, `stealth_delta`, `flanking_enabled`) with multiplicative/AND/stacking
> rules. Concrete rules for both systems are added later via perk research. The
> `ROUND_RESOLVED` event carries the `formation_bonuses_active` field (currently empty)
> for UI display when rules are added.

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

### XP retention rules at engagement end

At the end of each engagement, accumulated XP (stored as `xp_pending` per cell during the
engagement) is committed with a retention multiplier based on the unit's state:

| Condition | XP retained |
|---|---|
| Unit HP > 50% at engagement end | 100% of engagement XP |
| Unit HP ≤ 50%, not incapacitated | 60% |
| Unit incapacitated, **division won** | 40% |
| Unit incapacitated, division lost/retreated | 0% |
| **Division destroyed** (encirclement, HP=0) | 0% for all units |

Perks can modify per unit type: lower the full-XP threshold, raise incapacitated retention,
or raise destroyed retention. See `xp_config` in `PerkDefinition`.

### Post-Elite XP

After reaching Elite (1000+ XP points), additional XP still provides stat benefits with
diminishing returns:
```
post_elite_bonus = POST_ELITE_SCALE × log1p((xp − 1000) / POST_ELITE_DECAY)
```
Applied additively to Elite-tier multipliers. Values `POST_ELITE_SCALE=0.05`,
`POST_ELITE_DECAY=500` — set by playtesting.

### Experience accumulation sources
- **Combat:** each round survived in active engagement contributes `xp_pending`. Retention
  multiplier applied at engagement end based on the unit's HP state (see table above).
- **Barracks building:** constructed in a province. Allows players to spend resources to
  accelerate experience gain for units stationed in or passing through during non-combat
  downtime. Trains up to the tier currently unlocked by research — a player who has not
  researched veteran doctrine cannot train past Seasoned even at level 3 barracks.

### XP UI display
XP tier badges and pending XP bar per cell are displayed in the tactical grid panel
and the DivisionBuilder UI (Branch G-Builder). The `xp_pending` field syncs live so the panel
can show XP earned so far in the current engagement.

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
tier and XP points**. When returned to active service in a new division, they continue from
their current tier. This makes elite commando and stealth recon units extremely valuable
across a session.

---

### Cavalry — off-road exploitation and reconnaissance

**Units:** Mounted cavalry, horse-drawn scouts.

**Availability:** Available to all nations from game start on the current western Europe
map. Nation-specific availability and bonuses are configurable via `nation_config` per
map for future historical scenarios.

**Grid combat role:** Horizontal attack like infantry. Gains a **charge bonus in Round 1
only** — increased HP damage and suppression in the opening round before the enemy can
react to mounted assault. After Round 1, combat values drop to standard infantry levels.
Cavalry cannot sustain a prolonged firefight effectively — it is a shock unit, not a
grinding unit.

**Damage profile:**
- Round 1: charge bonus — high HP damage vs infantry targets; suppression is lower than
  standard infantry (charge trades pinning power for shock damage)
- Round 2+: standard infantry values
- Highly vulnerable to MG fire — MG units are the primary hard counter to cavalry.
  Artillery suppression affects cavalry less than infantry (horses scatter and reform
  faster than stationary troops under bombardment)

**Strategic movement profile:**
- **Fastest off-road unit in the game** across most terrain types
- Particularly strong in forest, hills, and rough steppe — terrain that slows vehicles
  but not horses
- Slower than motorised units on paved roads (horses vs trucks on highways)
- Impassable in: swamp, glacier (same as all units)
- Future module: winter conditions penalty-free for cavalry while mechanised divisions
  are severely slowed — models historical utility of cavalry in Russian winters

**Observation contribution:** Medium-high — cavalry units contribute meaningfully to the
division's observation radius, second only to dedicated recon armoured cars. Fast-moving
horse scouts cover ground quickly and report enemy positions.

**Stealth:** Moderate in forest and hills; low in plains; zero in desert. A cavalry force
moving through forest is harder to detect than a motorised column.

**Design intent:** Cavalry is an early-game and terrain-specific tool. It provides fast
off-road force projection before motorisation research is available, and retains a niche
advantage on forest-heavy maps and in rough terrain throughout the game. It becomes less
central as mechanisation progresses but is never useless in the right context.

---

### Motorisation and Mechanisation

**Motorisation — single global research:**
Motorisation is a standalone research node in the General Technology panel (not part of
any unit specialisation tree). It represents the nation building sufficient truck
production capacity to transport infantry by vehicle.

- Once researched, most infantry unit types can be toggled to their motorised version
  in the division template builder
- **Effect:** purely strategic map speed upgrade — on-road and off-road movement costs
  improve to motorised profile values. Zero change to 5×5 grid combat stats
- **Units that can be motorised:** standard infantry, assault infantry, MG teams, AT
  infantry, recon infantry, flamethrower teams — any unit that would realistically
  ride in a truck
- **Units that cannot be motorised:** snipers (stealth role requires independent movement),
  commandos (same — unconventional movement is their core trait), towed AT guns and
  artillery (these already have towed-motorised movement costs baked into their base
  profile; the gun itself doesn't change, only the towing vehicle)
- Sits at mid-tier in the General Technology panel — available after meaningful economic
  investment but not a late-game unlock. Historically major powers had motorised
  divisions from 1939

**Mechanisation — armour research branch:**
Mechanisation is a distinct unit type (mechanised infantry) unlocked via the armour
research branch, not the infantry branch. Historically, mechanised infantry emerged from
panzer division doctrine — the Panzergrenadier concept grew from combined-arms armour
doctrine, not from infantry development.

- Requires medium tank research tier to be reached first before the mechanised infantry
  branch unlocks — representing that APCs only make sense in the context of a tank force
  to integrate with
- Mechanised infantry is a **different unit type in the 5×5 grid**, not a toggled version
  of standard infantry:
  - Partial armour value (vulnerable to AT weapons but resistant to small arms suppression)
  - Cannot be fully suppressed by MG fire alone
  - Higher off-road movement capability than motorised infantry (tracked or heavy
    all-wheel drive vehicles)
  - Higher cost per unit to build and maintain
- Specialisation path within the branch: basic APC (half-track) → improved APC (full
  tracked) → infantry fighting vehicle (IFV, provides fire support from the vehicle)
- Each upgrade improves the unit's armour value and suppression resistance in the grid

**Research tree structure summary:**
```
General Technology panel:
└── Motorisation ─── enables motorised toggle for applicable infantry

Armour research branch:
├── Light tank
├── Medium tank
│   └── Mechanised infantry (APC half-track)
│       └── Improved APC (full tracked)
│           └── IFV
└── Heavy tank
```

**Horse-drawn logistics (implicit, no separate mechanic):**
Artillery and heavy weapons before motorisation research are implicitly horse-drawn —
their base movement profile represents draught horse speed (faster than foot infantry
on roads, slower than trucks). When motorisation is researched and toggled, those units
switch to truck-towed movement costs. No separate horse logistics unit is required.

---

## Unit Incapacitated State

When a unit's HP drops below a threshold, it enters **Incapacitated** state rather than
being destroyed. This models the historical reality that most front-line units go to ground
and stop contributing long before they are completely eliminated.

> See also **Vehicle Sub-Status System** below (after Armour Penetration System) for the
> finer-grained Mobility/Firepower/Armour/Optics degradation states a unit can carry *above*
> this HP floor — Incapacitation is the terminal state; the sub-status system describes how
> a still-fighting unit is impaired on the way there.

### HP floor thresholds

| Unit category | Incapacitation threshold | Rationale |
|---|---|---|
| Infantry, MG, AT infantry, cavalry, sniper, commando, flamethrower, recon infantry | 20% of max HP | Leg infantry can go to ground and survive |
| Armoured units (light/medium/heavy tank, armoured car) | 30% of max HP | Mobility kills (broken track, wounded crew) happen before total destruction |
| Artillery, towed AT gun, AA gun | **No incapacitation** | Crew-served weapons cannot easily be abandoned; crews fought until overrun |

### Incapacitated state behaviour

While incapacitated:
- Deals zero damage and zero suppression — completely out of the fight
- Not targeted by enemy attacks (below the threshold of "worth shooting at")
- Not counted toward the division's retreat/destroy suppression threshold
  (same exclusion rule as stealthed units)
- HP does not decay further from combat damage — the unit is out of the fight,
  not continuing to die
- Recovers HP via supply at the standard rate once the division is no longer engaged

### Experience on incapacitation

A unit that went incapacitated during combat retains **60% of the experience** it would
have gained that combat. The unit did not fight through to the end — partial credit only.

If the **division is destroyed** while units are incapacitated, those units are also
destroyed even though their HP is above zero. Experience is lost entirely in this case.
The incapacitated state only preserves units if the division survives the engagement.

### What this prevents

Without this mechanic, a heavily damaged division that loses its front-line infantry would
have those units permanently destroyed — losing both their combat contribution and their
accumulated experience. With the floor, damaged front-line units drop out of the fight
temporarily but survive to recover. Players are less catastrophically punished for
sustaining damage, while the strategic cost of losing a battle (retreat, supply disruption,
HP recovery time) is preserved.

### Future extensibility

Doctrines can modify this mechanic:
- "Total war" doctrine: removes the incapacitation floor for a unit type — push through
  to the last man (higher lethality, more experience loss)
- "Manoeuvre doctrine": incapacitated units recover HP faster from supply
Not implemented in the base game — the mechanic is designed to be extensible.

---

## Armour Penetration System

Armoured units have two armour values:
- **Front armour:** applies when attacked from the front (standard column attack)
- **Side armour:** reduced value, applies when attacked via flanking/envelopment shift or
  side-targeted AT column traversal

AT units and other anti-armour weapons have an **armour penetration value**. Damage dealt
is determined by the ratio of pen to armour:

| Pen / Armour ratio | Damage dealt | Status applied (see Vehicle Sub-Status System below) |
|---|---|---|
| < 60% | 0% (no effect) | none |
| 60–69% | 20% | Mobility |
| 70–79% | 30% | Mobility |
| 80–89% | 40% | Firepower |
| 90–99% | 70% | Firepower |
| ≥ 100% | 100% | none (clean penetration — HP damage applies normally) |

The hard floor at 60% means under-gunned AT is not just weak — it is completely useless.
This prevents stacking under-spec AT for marginal effect (the HoI4 failure mode).

**Same ratio always produces the same status — this is the deterministic trigger for the
Mobility and Firepower flags below, not a separate random roll.** A marginal partial
penetration (60–79%) represents a hit that grazes running gear without reaching the crew
compartment; a stronger partial penetration (80–99%) represents a hit that reaches internal
components (turret ring, gun mount, breech) without full penetration. A clean penetration
(≥100%) is a normal kill-or-cripple HP hit and does not additionally apply a status — it
doesn't need to, the HP damage already speaks for itself.

---

## Vehicle Sub-Status System

Real armoured-warfare damage assessment has long used a three-way split for exactly this
situation — **M-kill** (mobility kill: tracks/engine/running gear disabled, vehicle may
retain full use of its weapons), **F-kill** (firepower kill: gun/turret disabled, vehicle
may still move), and **K-kill** (catastrophic: destroyed beyond repair). It's a real and
common outcome, not an edge case: it's claimed the Wehrmacht lost more Panther tanks to
mobility kills than to catastrophic kills across the entire war. This section extends the
existing Incapacitated state (above) with four independent, deterministic status flags that
give that distinction concrete mechanical teeth.

**Scope note on granularity:** these flags apply to the **whole unit cell** (e.g. the
"medium tank" cell, representing its full vehicle count), not to individual vehicles within
it. Tracking which specific vehicle in a 12-tank cell has which status would add bookkeeping
complexity for no real player-facing benefit at this scale — the cell either has a status or
it doesn't, exactly like fuel and combat readiness are wing-level rather than per-plane
values in `AIR_COMBAT.md`'s equivalent system.

### The four flags

A cell can carry any combination of these simultaneously — they are independent, not
mutually exclusive:

| Flag | Effect | Applies to |
|---|---|---|
| **Mobility** | Cannot move (or moves at drastically reduced speed); still fights from current position | Armoured/vehicle units only |
| **Firepower** | Reduced damage output | Any weapon-system unit (vehicles and crew-served weapons alike) |
| **Armour** | Reduced effective armour value — easier to penetrate on subsequent hits | Armoured/vehicle units only |
| **Optics** | −1 row/column reach in its attack pattern | Any unit with a targeted (non-AOE) attack pattern |

### Deterministic triggers

**Mobility and Firepower** come directly from the armour-pen-ratio table above — same ratio,
same status, every time. **Armour and Optics** are triggered by weapon *category* rather than
penetration ratio: HE/fragmentation-type attacks (artillery, bombs) that don't achieve
penetration can still crack vision blocks and periscopes without needing to penetrate armour
at all, so they're the deterministic Optics trigger; repeated hits to a cell already carrying
damage (any hit after the first non-destroying hit) deterministically add the Armour flag,
representing cumulative structural weakening at the same impact area — armour doesn't
degrade gracefully, but it does degrade with repetition.

No random rolls anywhere in this system — which attack type hit a cell always produces the
same status, exactly like the pen-ratio table it extends.

### Relationship to Incapacitation

These four flags are **intermediate** degradation states a cell passes through above the
Incapacitation HP floor — they describe *how* a still-fighting unit is impaired, not whether
it's still in the fight at all. Incapacitation (this document, above) remains the terminal
state once HP crosses the existing floor (20% infantry-type, 30% armoured), unchanged by this
system. A tank cell can be both Mobility- and Firepower-flagged while still well above its
30% Incapacitation floor — badly hurt, not out of the fight.

### Recovery

All four flags clear via the same supply-based recovery the Incapacitated state already
uses — no separate repair mechanic. A Mobility-flagged tank that holds its position and
receives supply recovers to full mobility; one whose division is destroyed while flagged is
lost with it, the same "you kept it only if you kept the ground" rule Incapacitation already
enforces.

### Stacking

Multiple simultaneous effects on the same flag type (e.g. two separate attackers both
landing Firepower-tier hits on the same cell) stack **multiplicatively**, consistent with
`terrain_modifier_system.ts`'s existing convention for percentage-style combat modifiers
(`hp_dealt_mult`, `supp_dealt_mult`, etc. are all documented as multiplicative there). This
gives a natural diminishing-returns shape without needing a separate curve or a floor clamp —
`0.8 × 0.8 = 0.64`, asymptotically approaching zero, never crossing it.

### Research perks

A perk can shift a unit's damage output toward deliberately causing a specific status rather
than raw HP damage — e.g. an anti-tank doctrine specialising in opportunistic mobility shots
against otherwise-impenetrable heavy armour (the historical role of under-gunned AT like the
Soviet PTRD-41 against late-war German tanks: unable to penetrate, but still capable of
disabling tracks or optics with an aimed shot). Exact perks are deferred per this document's
existing research scope.

---

## Stealth System

Certain units have a **stealth level** (integer ≥ 0). Anti-stealth is also an integer ≥ 0
per unit type. Stealth is evaluated **every round**, not just at engagement start.

**Reveal rule:** A unit is stealthed unless any active enemy unit has
`anti_stealth ≥ effective_stealth_level`. Re-checked at the start of each round.

**While stealthed:**
- The unit deals damage normally
- The unit cannot be targeted (takes zero incoming damage)
- The unit's HP and suppression values are **excluded** from the division's retreat/destroy
  threshold calculation
- If the division is destroyed while units remain stealthed, those units are placed into
  reserve and **retain their experience tier and XP**

**Base stealth levels (in `UNIT_COMBAT_STATS`):**

| Unit type | stealth_level | anti_stealth |
|---|---|---|
| sniper | 2 | 0 |
| force_recon_sniper | 2 | 2 |
| commando | 2 | 0 |
| recon_infantry | 0 | 1 |
| armoured_car | 0 | 2 |
| all others | 0 | 0 |

**Terrain stealth bonuses (perk-driven, extensible via research):**
Researched perks add terrain-specific stealth bonuses per unit type via `terrain_stealth_bonus`
in `PerkDefinition`. For example, a sniper with `sniper_forest_stealth` research gains
+1 stealth in light_forest and +2 in dense_forest.

`effective_stealth = base_stealth_level + terrain_bonus_from_perks(unit_type, cover)`

A sniper (base=2) in dense_forest with `sniper_forest_stealth` research has effective
stealth=4. Only a unit with anti_stealth ≥ 4 can reveal it.

**Anti-stealth units:** recon_infantry (anti=1), armoured_car (anti=2),
force_recon_sniper (anti=2). Stacking multiple anti-stealth units does NOT raise the
effective anti — only the highest anti_stealth value on the field counts.

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

**Both divisions' terrain is sampled, not just the defender's.** When combat initiates, the
server reads each division's own province `terrain_elevation` and `terrain_cover` fields from
`map_data.json` — Combat samples terrain per-pixel at sub-province resolution at each tick, reading against the cover/elevation raster at the division's live position. This is a
change from treating the defender's terrain as the sole input: elevation and cover are no
longer combined into a single defender-bonus/attacker-penalty pair. Instead, each bonus type
follows one of two distinct rules, depending on what it represents physically:

**Comparative bonuses (elevation) — cancel when both sides match, otherwise only the higher
side benefits.** Elevation represents a genuinely *relative* advantage — shooting downhill at
someone below you. It only means anything as a comparison between the two positions:

```
elevation_bonus[side] = elevation_atk_value[side.elevation]
                        if side.elevation_tier > other_side.elevation_tier
                        else 0
```

If both divisions are at the same elevation tier, neither has a relative high-ground
advantage — the bonus is zero for both, not just reduced. If the attacker holds hills and the
defender is on flat ground, the **attacker** gets the elevation bonus — this is a genuine
change from the previous model, where elevation only ever favoured the defender's terrain.
Elevation advantage belongs to whichever side is physically higher, attacker or defender.

**Absolute bonuses (cover) — never cancel, both sides receive their own independently.** Cover
represents concealment and physical obstruction, which is a property of where a given side is
standing, not a comparison between the two sides. Two divisions both fighting from within
dense forest both get real concealment from each other and from outside observation,
simultaneously — there is no reason for matching cover to cancel either side's bonus:

```
cover_bonus[side] = cover_def_value[side.cover]   # always applied, independent of the other side
```

Tier ordering, still used for the river/transition logic below but no longer used to cancel
cover bonuses against each other: `flat < hills < mountains` for elevation;
`plains/steppe < shrubland < light_forest/urban < dense_forest < jungle/swamp` for cover.

**What this changes concretely:** previously, only the defender's terrain mattered for cover
and elevation, and the attacker's own terrain only modified the size of the attacker's
*penalty* via a better/same/worse transition check. Now, both sides independently compute
their own elevation bonus (comparative, can be zero for one or both sides) and their own cover
bonus (absolute, never zero just because the other side shares it). An attacker fighting from
their own patch of forest into a defender's open ground gets their own forest cover bonus —
something the previous model could not represent at all.

**Attack penalty stays attacker-specific and terrain-derived, unchanged in spirit:** the
attacker still takes a movement/attack friction penalty derived from the *defender's* terrain
group (`cover_atk[defender.cover]`), since attacking into difficult ground is still harder
regardless of where the attacker is coming from. This is a friction cost, not a bonus, and
friction costs are not subject to the comparative/absolute split above — they were never
about who has the advantage, only about how hard the ground being attacked into is to assault.

**Transition modifier on the attack penalty (unchanged):** the attacker's own terrain still
checks against the defender's terrain tier to scale that penalty:
- Attacker terrain tier **better** than defender's (e.g. plains attacking into dense_forest):
  full attacker penalty applied
- Attacker terrain tier **same** as defender's (e.g. both in forest): attacker penalty reduced
  (~50% of standard penalty — attacker is not coming from worse conditions)
- Attacker terrain tier **better** in elevation (e.g. hills attacking into flat): attacker
  penalty further reduced (elevation advantage partially offsets the difficulty of the ground
  being assaulted)

This remains a 3-value lookup (better / same / worse) applied only to the attack-penalty
friction cost — it does not interact with the comparative elevation bonus or the absolute
cover bonus described above, which are computed independently for both sides.

### Unit-type terrain bonuses and restrictions

These bonuses stack on top of the base composable modifiers above. Exact numeric values are
refined in playtesting; the qualitative rules are confirmed. Per the asymmetric model just
established, **every bonus below applies to whichever side (attacker or defender) occupies
that terrain** — these are no longer defender-only. Where a terrain group's primary bonus is
elevation-derived (hills, mountains), it remains subject to the comparative cancel-on-match
rule; where it is cover-derived (forest, urban, etc.), both sides receive it independently and
it never cancels.

**`plains` / `steppe`:** (cover-derived, absolute)
- Armour: +% flanking damage bonus, +% column shift speed (room to manoeuvre) — applies to
  whichever side's armour is on this terrain
- Artillery: +% recon accumulation rate per round (clear sightlines)
- Infantry: no cover bonus; −% suppression resistance (no concealment)

**`light_forest`:** (cover-derived, absolute)
- Infantry: +% suppression resistance
- AT gun (specialised): +% penetration vs armour (ambush angles)
- Snipers: high stealth value
- Armour: −% flanking damage (reduced manoeuvre room)

**`dense_forest`:** (cover-derived, absolute)
- Infantry, AT gun: bonuses stronger than light_forest
- Armour: cannot use column shift flanking at all — fires only in own column
- Armour: may not enter dense_forest off-road (strategic map movement restriction)
- A future armour research branch may grant limited dense_forest passability to a
  specialised variant as a doctrinal choice — not in the base game; tracked as an open
  extension point, not a current rule

**`jungle`:** (cover-derived, absolute)
- Recon infantry: +% recon accumulation rate
- Infantry: +% suppression resistance
- Armour: impassable — cannot enter jungle even on road for tactical combat purposes
- Artillery: −% damage (poor sightlines, recon accumulation impaired)

**`urban`:** (cover-derived, absolute — and deliberately the strongest infantry cover bonus
in the game, retained as defender-favouring in spirit even under the symmetric model)
- Infantry: +% suppression resistance (street fighting cover) — the largest infantry cover
  bonus of any terrain group, intentionally. Urban terrain's whole identity is built around
  rewarding whoever is dug into the city, which in practice is overwhelmingly the defender:
  a defender's division is already sitting in the city at combat initiation, while an
  attacker fighting *into* urban terrain has to physically close through streets the
  defender already controls and has had time to prepare. The symmetric absolute-cover rule
  does not weaken this — it means an attacker who themselves ends up fighting from within the
  same city (a meeting battle resolving inside an urban province, or an attacker who
  Repositions into the urban area) also gets the bonus, the same way a defender entering
  forest mid-engagement would. This is correct: it rewards control of the urban terrain
  itself, regardless of nominal attacker/defender label, exactly like a river crossing
  rewards whoever has actually completed it rather than whoever was labelled attacker at
  combat start. It does not make urban terrain attacker-favouring — an attacker still has to
  fight through streets the defender already holds to get any benefit at all, and the
  defender had it from round one without needing to manoeuvre for it.
- Snipers: maximum stealth value, +1 priority target bonus
- Armour: cannot use column shift flanking (streets force straight movement)

**`hills`:** (elevation-derived bonus, comparative; cover-adjacent bonuses below remain
absolute)
- Artillery: +% damage — this is the elevation advantage and follows the comparative rule:
  applies only if the artillery's side holds a strictly higher elevation tier than the
  opposing side; cancels if both sides are at the same elevation
- Infantry: +% suppression resistance — this part is treated as a cover-adjacent absolute
  bonus (broken ground, dug-in positions), not elevation, so it does not cancel on match
- Armour: −% flanking damage

**`mountains`:** (elevation-derived bonus, comparative, plus a hard movement restriction)
- Infantry divisions only — armour, motorised, artillery divisions cannot enter off-road
- Road-only access for all non-infantry division types
- Infantry: strong suppression resistance bonus, treated as absolute (dug-in mountain
  positions), not subject to the elevation-cancel rule

**`swamp` / `glacier` / `tundra`:**
- No unit gains bonus
- Armour: impassable off-road; road-only
- All divisions: significant movement penalty (already in MAP_DATA_CONTRACT)

**`desert`:** (cover-derived, absolute)
- Armour: +% mobility bonus (open ground)
- Recon units: +% detection
- Infantry: −% suppression resistance (no cover)

### River crossing effects

The server checks whether the line segment between the two division centre points intersects
any river LineString in `rivers.geojson` at combat initiation. The check uses `river_size`
from the river feature to set the penalty tier and the **cap** on how long that penalty can
persist — but unlike most other terrain checks, river crossing status is **re-evaluated
continuously during combat**, not snapshotted once. This is a deliberate exception to the
"defender's terrain sampled at initiation" rule elsewhere in this document, made possible by
(and made meaningful by) the Reposition movement state — see Reposition below.

River crossing debuffs apply to the **attacker only**:

| river_size | Suppression resistance penalty | HP damage penalty | Cap (rounds) |
|---|---|---|---|
| `minor` | −15% suppression resistance | −10% HP damage | 2 rounds max |
| `major` | −30% suppression resistance | −25% HP damage | 3 rounds max |

**The cap is a ceiling, not a fixed duration.** A division is considered "crossing" for as
long as its current position remains on the opposite side of the river line from where it
started the engagement. The penalty is removed the round the division's position crosses the
river line — which can happen earlier than the cap if the attacker actively commits a
Reposition order toward the far bank and the crossing distance is short, or can ride out the
full cap if the attacker does nothing (the default, passive outcome — identical to what a
player who never opens the combat panel already experiences) or if the defender's positioning
maximises the crossing distance (see Reposition below).

This is intentionally a skill lever, not a flat cost: a player who recognises the river
penalty and actively repositions to close the crossing distance is rewarded with an earlier
end to the debuff. A player who does nothing experiences exactly the documented cap as a
worst case — nobody is ever penalised longer than the numbers above, only potentially less.

The adjacency contract already encodes river crossings via `border_type: "river"` edges.
The tactical combat system reads the river geometry directly for the crossing check, and
re-checks each engaged division's position against that line each round for the duration of
the cap.

---

### Per-Cell Terrain Modifier Engine

In addition to the strategic-layer terrain bonuses above, a per-cell, per-unit-type modifier engine evaluates each combat round via `terrain_modifier_system.ts`. It ships with **zero active rules** — `getActiveTerrainModifierRules()` returns `[]`, so `evaluateTerrainModifiers()` returns an empty Map and all cells use the identity modifier. Concrete rules are added later via perk research.

| Field | Type | Stacking | Description |
|---|---|---|---|
| `hp_dealt_mult` | number | Multiplicative | Multiplier on outgoing HP damage |
| `supp_dealt_mult` | number | Multiplicative | Multiplier on outgoing suppression |
| `supp_resist_mult` | number | Multiplicative | Multiplier on incoming suppression (< 1 = receive less) |
| `supp_decay_mult` | number | Multiplicative | Multiplier on suppression decay rate |
| `stealth_delta` | number | Additive | Bonus to base stealth_level per cell's unit type |
| `flanking_enabled` | boolean | AND (one false disables) | Gate on armour column shift flanking |

The engine mirrors `formation_rule_system.ts` in structure. `stealth_delta` values are folded into the existing perk-based stealth bonus records each round via `augmentedBonuses`. The `flanking_enabled` gate wraps `_resolveArmourColumn` — already short-circuited for dense_forest/urban at the function level, but kept as an extensibility point for future perks that may disable flanking for other terrain types.

---

## Attacker and Defender Determination

Combat initiates when two engagement area circles fully overlap. Attacker/defender status is
determined automatically using a five-tier system — no player input required.

### Tier 0 — War declared while engagement areas already overlap
This is checked first, before any movement-based tier, and covers a case the movement tiers
cannot resolve: two divisions sitting stationary and already overlapping while their nations
are neutral toward each other, with war then declared between them. No movement triggered the
overlap, so there is no movement vector to read.

If two divisions' engagement areas are already overlapping at the instant a war state begins
between their nations, **the nation that declared war is automatically the attacker.** The
other nation is the **defender** and receives its terrain bonuses (including the river
crossing penalty against the declaring nation, if applicable).

This is evaluated once, at the instant war begins, and only applies to that instant. Any
subsequent movement decision by either side — one issuing ADVANCE, one issuing HOLD, or both
adjusting position — is evaluated normally through Tiers 1–3 from that point forward; Tier 0
does not lock the assignment for the rest of the engagement, only for how it began.

**Why this is the correct assignment, not Meeting Battle:** nothing physically changed at the
moment war began — the only event that occurred is a diplomatic one, and the nation that chose
to declare war is, causally, the side that converted a neutral standoff into a fight. A
declaring nation always retains the option to manoeuvre its division away from a pre-existing
overlap before declaring, and be evaluated normally afterward; Tier 0 only applies when a
player chooses to declare while already nose-to-nose with a neutral division. A defending
nation's forward positioning before any war exists is a real commitment with its own
tradeoffs (reduced flexibility, exposure to being struck first elsewhere) — Tier 0 does not
make forward deployment a free, costless bet on a future defender bonus.

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
Both divisions stationary, or vectors genuinely identical, with no war just declared between
their nations (Tier 0 already covers the war-declaration case): the nation with fewer total
province holdings at that moment is the **defender** (smaller nation assumed on the back
foot). Rare edge case.

### Engagement area shape
**Circles**, not squares. Circles are uniform in all directions and correctly represent a
division's operational radius. Square engagement areas create axis-aligned geometric artifacts
with diagonal rivers and irregular terrain borders. Circle radii vary by division type as
established in STRATEGIC_COMBAT.md (armoured largest, defensive smallest).

---

## Movement During Combat: Reposition

An engaged division is not frozen in place for the duration of combat. Two distinct
active-movement options exist while engaged, deliberately kept far apart in speed so neither
is confused for the other:

- **Retreat** — full or boosted speed, manually available while Engaged or Suppressed, exits the
  engagement.
- **Reposition** — a new, slower movement option, available only while **below** the retreat
  threshold (i.e. not yet Suppressed), that moves the division a short distance *within or
  adjacent to* the current engagement without exiting combat.

**Speed:** combat itself imposes a baseline speed reduction on any engaged division — roughly
30% of normal off-road speed — representing the practical difficulty of manoeuvring while
under fire. Reposition moves at a further fraction of that already-reduced speed (a
deliberate crawl, slower than general in-combat movement capability), reflecting that
deliberately repositioning toward better ground is harder than simply holding a position
under the same fire. Exact constants are a playtesting question (see Open Questions); the
relative ordering is fixed: Reposition speed < general in-combat speed < Retreat speed.

**Availability:** Reposition is only available while the division's suppression is below the
retreat threshold. A Suppressed division cannot Reposition — at that point Retreat is the only
active-movement option. This boundary is intentional: without it, Reposition could function as
a "soft retreat" that lets a player dodge the Suppressed state's consequences, undermining why
that state exists.

**Trigger — explicit and separate from ordinary move orders, never automatic.** Reposition
does not happen as a side effect of any pre-existing order. If a division already had a move
order queued before combat began, that order follows the existing Move Order Persistence rule
(see STRATEGIC_COMBAT.md) — it is held and resumed automatically once the engagement ends, the
same as it always has been. It does **not** retroactively become a Reposition attempt just
because the division is now engaged. A player who wants in-combat repositioning must issue a
**new, distinct command** while the division is already engaged — either a fresh Reposition
order, or (UI detail, not yet finalised) a Move order specifically reissued after engagement
has started, which the client/server distinguish from a pre-combat move order by the fact
that it is issued *while* the COMBAT_STARTED state is already active on that division. This
is a deliberate extra step, not an oversight: Reposition is a niche, high-skill tool intended
for a player actively watching a specific engagement, not a default behaviour every division
performs automatically just because it happens to have somewhere to go. A division with a
queued pre-combat move order that gets pulled into an engagement does nothing unusual by
default — it simply waits, exactly as today, until the fight resolves.

**Scope:** Reposition is a terrain-seeking tool, not a disengagement tool. It is intended for
moving toward better ground within or immediately adjacent to the current engagement — for
example, a division caught on a road repositioning into nearby forest for the cover bonus, or
an attacker pushing toward the far bank of a river it is currently crossing (see River
crossing effects, above, and the riverbank positioning note below). It is not a general means
of disengaging without paying Retreat's costs.

**Terrain re-evaluation:** because Reposition can move a division across a terrain boundary
mid-engagement, terrain modifiers for an engaged division are **not** purely a one-time
snapshot taken at combat initiation for the duration of the fight — they are re-sampled as
the division's position changes via Reposition (continuously for river-crossing status, as
described above; on Reposition completion for cover/elevation terrain). Other terrain rules
in this document (the defender-primary sampling rule, the attacker/defender transition
modifier) are unaffected — Reposition changes *where* a division's terrain is sampled, not
which sampling rules apply once it's there.

**Riverbank positioning, restated precisely given Reposition's existence:** because an
attacker's river-crossing penalty is capped, not fixed, and ends the round their position
crosses the river line, a defender who sets up **well back from the riverbank** (rather than
tight against it) forces an attacker who has physically crossed to still cover further ground
before reaching the defender — keeping the attacker exposed to the river penalty, or to the
general in-combat speed reduction while still vulnerable, for longer. A defender sitting tight
against the bank shortens the attacker's effective crossing distance and lets a fast, well-
microed attacker shed the river penalty and close the gap sooner. This is a genuine
positional decision for the defender, not a fixed rule — it trades easier early access to the
engagement (tight to the bank) against denying the attacker an early end to their penalty
(set back from it).

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
An **EngagementBanner** floats on the strategic map at the midpoint between the two engaged
division icons. It shows a tug-of-war HP bar: the left half fills green proportional to the
attacker's average HP; the right half fills green proportional to the defender's average HP.
A ⚔ symbol sits at the centre as the click target. The banner's border pulses amber when
either side's HP drops below the suppression warning threshold (attacker < 20%, defender < 40%).

Clicking ⚔ opens the full 5×5 grid view:
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
- Incapacitation HP floor values (confirmed qualitatively: infantry ~20%,
  armour ~30%, artillery has no floor — exact values from playtesting)
- Experience retention on incapacitation (confirmed: 60% of combat gain)
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
- General in-combat movement speed reduction (target: roughly 30% of normal off-road speed —
  confirmed qualitatively, exact value from playtesting)
- Reposition speed specifically, as a further fraction of the general in-combat speed
  (confirmed qualitatively slower than general in-combat movement, faster than zero, slower
  than Retreat — exact value from playtesting)
- Elevation comparative bonus magnitudes per terrain tier, now applied to whichever side
  holds the higher tier rather than defender-only (values carry over from the existing
  elevation_def table; confirm they still feel correct once attacker-side application is
  possible)
- Standard infantry build cost relative to every other unit type — confirmed qualitatively
  as "lowest by a wide margin," exact resource cost vector from playtesting and balance
  against the broader unit-economy build-cost model
- Division count band per map size (target: roughly 5–15 per player, scaling with map size —
  confirmed qualitatively, exact numbers per small/large map from playtesting)

---

---

## Client-Side Preview System

The `AttackPatternRegistry` (`client/src/ui/hud/attack_pattern_registry.gd`) provides a
client-side simulation of attack resolution for the hover preview feature.

### simulate_round()

`simulate_round(attacker_cells, enemy_cells, round_number) → Dictionary[int, int[]]`

Maps each attacking cell's server index (0-24) to an array of enemy cell indices it would
target in the upcoming round. The simulation:
1. Creates a mutable copy of the enemy grid (`virtual`)
2. Gets the fire order (front-to-back, left-to-right)
3. For each attacker in order: finds targets against the current `virtual` state, then
   applies damage to `virtual` (handles within-round spillover correctly)
4. Returns the target map

### Hover Attack Preview

Hovering a friendly unit shows which enemy cells it will target. Hovering an enemy unit
shows which friendly cells that enemy would target. Target cells are highlighted with a
semi-transparent red overlay (`is_targeted` property on `UnitGlyphCell`).

### Artillery Preview Limitation

The client preview for artillery always targets the attacker's own column (`area_radius=0`).
The server uses a seeded LCG for weighted-random column selection based on recon value
and unit-type value scoring. This means the client preview is an approximation — the
server may target a different column than what the preview shows. Documented in
`attack_pattern_registry.gd` line 258-259.

---

## Incapacitated Cell Display

When a cell's HP drops below its floor threshold (20% for infantry, 30% for armour;
artillery/towed AT/AA have no incapacitation), the server sets `incapacitated: true` in
the `GridCellDelta`. The client displays:

- **HP bar**: shows 0 (no green fill) instead of the remaining HP
- **NATO icon**: dark semi-transparent overlay across the entire cell, plus a diagonal
  cross-out (X) drawn over the glyph area
- **Background**: dark grey tint via `C_INCAP` color

The HP floor is defined per unit type in `unit_combat_stats.ts` on the server and
`HP_FLOOR_PCT` in `attack_pattern_registry.gd` on the client.

---

## Fog-of-War / Stealth Display

When a cell has `stealthed: true` in the `GridCellDelta`, the client displays:

- **Dashed border**: muted green (`Color(0.50, 0.58, 0.50)`) dashed border around the cell
- **Glyph**: hidden — replaced by a centered "?" label in the same muted green
- **Background**: muted green tint

Stealthed cells are not targeted by enemy attacks and are excluded from the division's
retreat-suppression threshold calculation. The `stealthed` field is set server-side based
on the stealth level vs anti-stealth level check each round.

---

## Round Timer Display

The server includes `ticks_until_next_round` in each `ROUND_RESOLVED` broadcast
(always `ROUND_TICKS` = 20 ticks). The client displays a countdown timer:

- **Format**: `⏱ M:SS` next to the round number in the panel header
- **Behavior**: counts down from 20 seconds to 0 via `_process(delta)`
- **Update**: resets on each `ROUND_RESOLVED` event

The timer is purely a convenience feature — combat resolves server-side regardless of
whether the panel is open.

---

## Experience Tier Badges

Cells with `xp_tier` other than `"green"` display a 12×12 colored badge in the top-right
corner of the cell:

| Tier | Badge Color | Letter |
|------|-------------|--------|
| Seasoned | Yellow-green `Color(0.55, 0.72, 0.25)` | S |
| Veteran | Blue `Color(0.25, 0.45, 0.80)` | V |
| Elite | Purple `Color(0.60, 0.20, 0.80)` | E |
| Green | No badge | — |

The badge is drawn on top of the NATO icon but underneath the incapacitated overlay (if
active). Implemented via the `xp_tier` property on `UnitGlyphCell`.

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
