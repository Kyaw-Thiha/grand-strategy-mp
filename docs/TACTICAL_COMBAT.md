# Grand Strategy Multiplayer — Tactical Combat Design

> Confirmed design decisions for the division-level tactical combat layer.
> Last updated: June 2026.
> This document covers the 5×5 grid system, unit archetypes, combat resolution, and the
> interface between tactical outcomes and the strategic layer defined in STRATEGIC_COMBAT.md.

---

## Design Philosophy

Tactical combat is an **auto-battler**. Players preset their division templates before the game
begins and cannot edit a division's composition while it is actively engaged. The grid resolves
automatically each round. Players who never open the combat panel still receive reasonable
outcomes. Players who study and optimise their compositions extract a meaningful edge.

This satisfies two tenets simultaneously:
- **Casual accessible:** set a preset template and let it fight. No split-second decisions required.
- **Sweaty depth:** endless optimisation of grid composition, unit placement, and counter-matching
  is available to players who want it. The ceiling is high; the floor is forgiving.

There is no dominant meta template. Unit types are deliberately specialised — each excels in one
role and is weak or irrelevant in others. No single composition counters everything. The correct
template is always contextual: terrain, enemy composition, front width, and mission type all
shift the optimal answer.

---

## The 5×5 Grid

Each division is represented as a 5×5 grid of unit slots. 25 cells total. Rows and columns are
the two tactical axes.

```
     C1    C2    C3    C4    C5
R1 [ -- ][ -- ][ -- ][ -- ][ -- ]   ← back row (deepest, most protected)
R2 [ -- ][ -- ][ -- ][ -- ][ -- ]
R3 [ -- ][ -- ][ -- ][ -- ][ -- ]
R4 [ -- ][ -- ][ -- ][ -- ][ -- ]
R5 [ -- ][ -- ][ -- ][ -- ][ -- ]   ← front row (closest to enemy, first contact)
```

**Why 5×5 over 4×4:**
Five columns create a contested centre (C3) that can be threatened from both flanks. In a 4×4
grid there is no true centre — the two middle columns are symmetric and neither is more exposed
than the other. The centre column in 5×5 creates a strategic focal point: armour placed there
can be flanked from either direction, making its placement a genuine decision.

**Grid orientation in combat:**
When two divisions engage, their grids face each other. The enemy's R5 is the row closest to
your R5. Attacks travel across this interface. Units in R5 are most exposed; units in R1 are
deepest in reserve.

---

## Template System

### Pre-game templates
Players bring a saved division template into the game. Templates are set in three ways:

1. **Nation presets** — historically flavoured templates provided for each nation. Available in
   the lobby to all players regardless of account. A German player gets panzer and infantry
   presets appropriate to the 1939 period. Immediately playable with zero setup.
2. **Custom saved templates** — created in the main menu template builder before joining any
   game, saved to the player's account via Supabase and persisted across sessions.
3. **Mid-game creation** — players can create and save new templates during a game when a
   division is out of combat. The new template is written to their account immediately.

### Mid-game redeployment
A player may switch an existing division to a different template while that division is out of
combat. On switch:
- The division is removed from the map
- It redeploys at the nearest friendly city with the new template's composition
- Redeployment takes a flat **1 minute** of game time regardless of distance
- The division cannot be ordered or engaged during redeployment
- New templates only apply to freshly redeployed or newly spawned divisions — existing divisions
  in the field keep their current composition until explicitly redeployed

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
Each round maps to an escalation phase. Lethality increases as the engagement deepens.

| Phase | Rounds | Lethality | Name (suggested) |
|---|---|---|---|
| 1 | Round 1 | Low | Contact |
| 2 | Round 2 | Moderate | Firefight |
| 3 | Round 3 | High | Intense |
| 4 | Round 4 | Very high | Decisive |
| 5 | Round 5+ | Maximum | Annihilation |

From Round 5 onward, lethality remains at maximum until one side retreats or is destroyed.

**Design intent:** Early rounds are forgiving. A division that accidentally engaged the wrong
enemy, or a player who forgot their division was fighting, takes a soft version of the battle
in Rounds 1–2. This is intentional. Casuals are not catastrophically punished for mistakes
made early in an engagement.

### Force recon exception
Certain units bypass the lethality ramp and deal full damage from Round 1 regardless of phase.
These are specialist units whose role is rapid, precise early engagement:
- Tank recon variants (specialised light tanks with recon role)
- Late-war armoured cars with recon specialisation
- Commando units
- Sniper specialisations with force recon designation

This is a deliberate depth lever for experienced players. A player who knows their opponent
favours heavy, slow compositions can pre-load force recon units and deal disproportionate
early-round damage before lethality ramps for the rest of the field.

---

## Dual-Bar Combat: Suppression and HP

Every unit in the grid has two independent health values:

### HP (hit points)
- Represents permanent combat capability
- Damage to HP is not recovered during combat
- HP recovers slowly via supply between engagements
- When a unit's HP reaches zero it is destroyed and removed from the grid permanently
- When all units in a division reach zero HP the division is destroyed (see Strategic Layer Link)

### Suppression bar
- Represents temporary combat effectiveness loss — a unit pinned under fire not shooting back
- Fills when the unit receives suppression-typed attacks
- Decays naturally each round (base decay rate set by playtesting)
- Decays 2–3× faster during retreat
- Does **not** reset instantly on retreat — carry-over suppression models the disorder of
  withdrawal
- When the suppression bar is full the unit deals zero damage and zero suppression but also
  receives reduced incoming HP damage (modelling a soldier fully in cover, not shooting back,
  but also not easily killed)

### Division-level suppression threshold
When the **average suppression** across all active (non-stealth, non-destroyed) units in a
division exceeds a threshold, the division triggers the Suppressed state at the strategic layer.

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
- "Front row" = the frontmost row in the enemy grid that contains at least one living unit.
- "Column" of a unit = the column it currently occupies in its own grid.
- Attacks are resolved simultaneously each round — not sequentially.

---

### Infantry archetypes — horizontal attack pattern

**Units:** Standard infantry, assault infantry, mechanised infantry, recon infantry.

**Pattern:** Attacks the front row of the enemy grid. Hits all living units in R5 of the
enemy (or the deepest populated row if R5 is empty). Attack is distributed across all
units in that row proportional to the attacker's soft attack value.

**Damage profile:** Soft attack only. Deals no meaningful damage to armoured units regardless
of row position (soft attack vs front armour = negligible). Infantry's job is to attrit enemy
infantry and force the front row to thin, exposing rear rows.

**Recon infantry:** Identical pattern but contributes recon value each round, scaling
artillery and CAS accuracy for the division (see Recon System).

---

### Machine gun — horizontal attack, suppression specialist

**Units:** Heavy machine gun teams, vehicle-mounted MGs.

**Pattern:** Same horizontal front-row targeting as infantry.

**Damage profile:** Very high suppression output against infantry. Low HP damage. Negligible
effect against armour. The primary tool for pinning enemy infantry into the full-suppression
state (unit stops firing, takes reduced damage). Effective at reducing division-level
suppression average toward the retreat threshold.

**Key distinction from AT:** MG suppresses infantry effectively. AT does not. These are not
interchangeable. A player who fills columns with MG to suppress infantry and AT to threaten
armour has built a full-spectrum anti-ground composition but has sacrificed offensive infantry
presence and HP damage throughput — a genuine tradeoff.

---

### Armour archetypes — vertical column attack

**Units:** Light tank, medium tank, heavy tank, armoured car.

**Pattern:** Attacks all living units in its own column of the enemy grid, from R5 upward.
Depth rule: a tank in its own R3 can only strike enemy R3, R4, and R5 — it cannot fire
"through" its own front rows into the enemy's back rows. A tank in R5 strikes all five
enemy rows in its column.

**Column shift — flanking and envelopment:**
When a tank's column in the enemy grid is empty (no living units), it shifts to find a target:

- **Columns C1 and C2** (left flank): shift right to the nearest occupied column. Gain
  **Tactical Flanking** — bonus damage multiplier applied to all targets in that column.
- **Column C3** (centre): shift toward the nearest occupied column (random if equidistant).
  Gain Tactical Flanking.
- **Columns C4 and C5** (right flank): shift left to the nearest occupied column. Gain
  **Tactical Flanking**.
- If the first shift column is also empty, shift one further in the same direction. Gain
  **Tactical Envelopment** — higher bonus damage multiplier than flanking. Targets hit are
  considered to be struck on their **side armour** (reduced armour value, see Armour System).

**Armour resistance to suppression:** Armoured units have high base suppression resistance.
Suppression against armour is only meaningful from: dedicated AT units, aircraft (CAS/dive
bombers), and specific AT specialisations. Standard infantry, MG, and most artillery deal
negligible suppression to armour.

---

### Anti-tank infantry and AT gun — column selective targeting

**Units:** AT infantry, towed AT gun, self-propelled AT gun.

**Primary target:** Armoured units only. AT deals negligible damage and negligible suppression
to non-armoured units. It does not substitute for MG or standard infantry in any context.

**Pattern:** Targets armoured units in its own column first (from front row upward, same depth
rule as armour). If no armour is present in the column:
- Shifts toward the nearest occupied column containing armour (picks one direction — nearest
  first, random if equidistant)
- Targets the **side armour** of armour in that column (reduced armour value)
- Does not target both adjacent columns simultaneously — picks one

**Suppression profile:** Very low suppression output against armour. Primary effect is HP
damage when armour penetration threshold is met (see Armour Penetration System). AT that
fails to meet the penetration threshold deals zero damage — not reduced damage.

---

### Anti-aircraft gun — column selective targeting (air threats)

**Units:** Light AA gun, heavy AA gun, self-propelled AA.

**Primary role:** Counters air units attacking the division (see Air-Land Interface). During
ground-only combat AA guns contribute minimally to the land grid — they are not general-purpose
anti-infantry units. Their value is purely in reducing incoming air damage.

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
6. Standard infantry (fallback if no priority targets present)

**Damage profile:** High HP damage to infantry targets. Low suppression. Bypasses cover
bonuses that infantry receive in certain terrain. The sniper's job is to remove high-value
units before they can dominate a round.

**Stealth:** Snipers gain stealth in urban terrain. Zero stealth in open plains or desert.
Terrain-dependent stealth values apply (see Stealth System).

---

### Flamethrower — area of effect

**Units:** Flamethrower infantry team, vehicle-mounted flamethrower.

**Pattern:** AOE centred on a 3-column wide, 2-row deep zone. The zone is anchored at a
fixed offset from the flamethrower's own position — it always fires 1 row ahead of itself
into the enemy grid, covering 3 columns (its own column and one column either side, clamped
to grid edges).

Example: a flamethrower in R5, C3 of the attacker's grid fires into enemy R5 and R4, across
C2, C3, and C4 of the enemy. A flamethrower placed in R4 fires into enemy R4 and R3 (3 columns
wide), reaching deeper into the enemy formation.

**This makes row placement meaningful:** A flamethrower in R5 only suppresses the enemy front
rows. A flamethrower in R4 reaches the second rank where tanks and AT guns typically sit.
Placing flamethrowers in R4 is therefore a deliberate choice to counter reserve-row armour —
at the cost of having less infantry in the front row to absorb incoming fire.

**Damage profile:** Extreme suppression against infantry. Moderate HP damage against infantry.
Zero effect against armoured units (armour is immune to flame suppression).

---

### Artillery — recon-proportional random area hit

**Units:** Field artillery, howitzer, self-propelled gun.

**Pattern:** Hits a random cell (or 2×2 cell cluster for upgraded variants) in the enemy grid.
The target cell is chosen randomly, but the probability weights shift toward occupied cells
proportional to the division's current recon value.

- At zero recon: fully random across all 25 cells. Many shots land on empty cells.
- At maximum recon: weighted heavily toward occupied cells, with priority to high-value targets
  identified by the recon system.

**Damage profile:** High HP damage to any unit hit. Moderate suppression. Effective against
both infantry and lightly armoured targets. Cannot penetrate heavy armour.

**Recon dependency:** Artillery effectiveness scales directly with the recon value accumulated
during the engagement. Early rounds (before recon builds) artillery is wasteful. Investing in
recon infantry, recon light tanks, or air recon converts artillery from a random nuisance into
a precision asset. This is one of the primary skill levers for experienced players.

---

## Armour Penetration System

Armoured units have two armour values:
- **Front armour:** applies when attacked from the front (standard column attack)
- **Side armour:** reduced value, applies when attacked via flanking/envelopment shift or
  side-targeted AT column traversal

AT units and other anti-armour weapons have an **armour penetration value**. Damage dealt is
determined by the ratio of pen to armour:

| Pen / Armour ratio | Damage dealt |
|---|---|
| < 60% | 0% (no effect) |
| 60–69% | 20% |
| 70–79% | 30% |
| 80–89% | 40% |
| 90–99% | 70% |
| ≥ 100% | 100% |

This discrete scale rewards investment in the correct pen tier without requiring percentage
min-maxing. A player who reaches the 70% tier gets a meaningful jump in damage (30%) as
positive feedback for their tech/template choice. The hard floor at 60% means under-gunned
AT is not just weak — it is completely useless. This prevents the HoI4 failure mode where
any pen value provides some damage and therefore stacking under-spec AT is worth doing.

---

## Stealth System

Certain units have a **stealth level** that varies by terrain. Stealth is not a binary on/off —
it is a value that must be exceeded by an enemy's **anti-stealth level** to reveal the unit.

**While stealthed:**
- The unit deals damage normally
- The unit cannot be targeted (takes zero incoming damage)
- The unit's HP and suppression values are **excluded** from the division's retreat/destroy
  threshold calculation. The division may retreat even if all stealthed units are at full health
- If the division is destroyed while units remain stealthed, those units are not lost — they
  are placed into reserve

**Terrain stealth examples (exact values set by playtesting):**
- Sniper: high stealth in urban, moderate in forest, zero in open plains or desert
- AT gun (specialised): moderate stealth in forest and hills, zero in open terrain
- AT infantry (specialised): moderate stealth in forest, urban; zero in plains
- Commandos: high stealth in most terrain types

**Anti-stealth:** Units with anti-stealth level greater than the target's stealth level reveal
the stealthed unit. Revealed units lose stealth for the remainder of that combat round and can
be targeted normally.

---

## Recon System

Recon is a **shared engagement value** that accumulates over combat rounds and is consumed by
artillery targeting, CAS damage scaling, and high-altitude bombing. It is not per-unit — it
belongs to the division engagement as a whole.

**Recon sources (land):**
- Recon infantry: contributes recon value each round (base rate)
- Recon light tank variants: higher recon rate per round
- Armoured car with recon specialisation: high recon rate
- Each combat round of any active engagement contributes a small baseline recon value
  regardless of unit composition (representing natural observation during sustained contact)

**Recon sources (air and naval):**
See AIR_COMBAT.md and NAVAL_COMBAT.md. Air recon and naval detection feed into the same
unified recon value for their respective engagement contexts.

**Detection vs recon:**
- **Recon** — targeting accuracy for weapons (artillery, CAS, high-altitude bombing)
- **Detection** — revealing hidden/stealthed units and enemy positions

Detection is a subset of the recon system. High recon does not automatically reveal stealth
units unless dedicated anti-stealth units are present. Both values are tracked per engagement.

---

## Engagement and Observation on the Strategic Map

### Division dot and engagement area
Each division is represented as a dot on the strategic map. The dot has two concentric areas:

**Observation area (large radius):**
- Reveals enemy division positions within range as dots on the player's map
- At low observation value, enemy composition shows as "?" — unit types unknown
- As observation value increases (via recon units in the template, or sustained proximity),
  composition begins to reveal
- Stealth composition in enemy divisions reduces how much reveals even at high observation

**Engagement area (smaller radius):**
- Set per division **type** (not per template composition):
  - Armoured division: largest engagement area (aggressive, fast-moving)
  - Motorised division: medium-large
  - Infantry division: medium
  - Defensive/fortified division: smallest (holds ground rather than reaching out)
- When two engagement areas **fully overlap**, combat initiates automatically
- Partial overlap does not trigger combat — the observation area handles the pre-contact warning
- Combat initiation is therefore a consequence of movement decisions, not a separate button

### Flanking bonus at strategic layer
When a division is already engaged in tactical combat and a second enemy division's engagement
area overlaps it simultaneously, the second division gains a **flank attack bonus** — a
percentage increase to all damage dealt in its tactical grid combat against the engaged target.

When the flanking division is itself engaged by a friendly ally unit, it stops attacking the
original target and redirects to the new threat. This allows players to relieve a division
under pressure by committing supporting forces.

---

## Link to Strategic Combat States

Tactical grid outcomes feed directly into the strategic layer states defined in
STRATEGIC_COMBAT.md. This is the seam between the two systems.

| Tactical grid outcome | Strategic layer state triggered |
|---|---|
| Division average suppression ≥ retreat threshold (base 60%) | → Suppressed |
| Suppressed + road open + no manual hold order (defender) | → Retreat |
| Suppressed + no auto-retreat (attacker) — player must manually order | → stays Suppressed until ordered |
| All units destroyed or suppressed to zero simultaneously + encircled | → Destroyed |
| Enemy front row (R5) cleared with no enemy reserves behind it | → Breakthrough — road axis opens |
| Retreat completed — division reaches friendly node | → Engaged ends, suppression decays rapidly |

**Important:** Stealthed units are excluded from the retreat/destroy threshold calculation.
A division with 4 stealthed commandos and 1 visible suppressed infantry unit will retreat based
on the visible unit's state alone. The commandos survive into reserve regardless.

---

## Combat UI

### Without opening the grid panel
Visible on the strategic map combat icon at all times:
- **HP bar:** aggregate HP of all non-stealthed units in the division
- **Suppression indicator:** border colour pulses amber when approaching threshold, red when
  threshold exceeded
- **Round indicator:** small number or dot sequence showing current escalation phase (1–5)
- **On hover:** attacker and defender names, round number and phase name, both divisions'
  HP and suppression bars, whether air support is active over this combat

### Opening the grid panel
A combat button appears over the active combat icon on the strategic map. Clicking opens
the full 5×5 grid view as a panel. Players can see:
- All living units in both grids with current HP and suppression bars
- Attack pattern visualisation for the current round (which cells are targeting which)
- Recon value accumulation indicator
- Round timer countdown

The panel can be closed at any time. Combat continues regardless of whether the panel is open.

---

## Open Questions (To Be Resolved in Playtesting)

- Exact round duration: 15, 20, or 30 seconds per round
- Base suppression decay rate per round and the faster decay multiplier during retreat
- Exact recon value contribution rates per unit type per round
- Stealth level values per unit per terrain type
- Anti-stealth level values per counter-unit type
- Flank attack bonus percentage at strategic layer
- Armour pen values for each AT unit variant (must be set relative to armour values of
  each tank variant — a coupled balance problem)
- Exact suppression output values for MG vs flamethrower vs AT (AT must be very low;
  MG and flamethrower are the primary suppressors)
- Column shift flanking damage multiplier and envelopment damage multiplier values

---

## Out of Scope for This Document

**Air-land interface** — CAS and tactical bomber damage patterns against the land grid,
and the recon dependency of high-altitude strikes. See AIR_COMBAT.md.

**Supply effects on tactical combat** — out-of-supply attrition rates and encirclement
destruction. See STRATEGIC_COMBAT.md supply section and the upcoming SUPPLY_SYSTEM.md.

**Naval tactical combat** — see NAVAL_COMBAT.md.

**Future unit types** — politics, tech tree unlocks, and doctrine-specific unit variants
are later modules. Their attack patterns will follow the archetypes defined here.
