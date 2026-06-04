# Grand Strategy Multiplayer — Air Combat Design

> Confirmed design decisions for the air combat layer.
> Last updated: June 2026.
> Air combat interacts with land tactical combat (see TACTICAL_COMBAT.md),
> strategic supply (see STRATEGIC_COMBAT.md), and naval combat (see NAVAL_COMBAT.md).

---

## Design Philosophy

Air combat runs as a **parallel system** alongside land and naval combat. Players assign air
wings to provinces and set missions. Resolution happens automatically each round. Players who
never open the air panel still benefit from their air assignments — they just extract less
value from them than players who optimise formation, mission timing, and counter-air doctrine.

Air is the layer that rewards investment in map-wide awareness. A player who tracks where
enemy air wings are assigned can intercept them, strip their CAS support, and interdict their
supply lines — all without a single land unit moving. A player who ignores air entirely is
vulnerable to all of the above.

---

## Air Wing Formation — The 3×5 Grid

Each air wing is represented as a **3×5 grid**:
- **Rows = altitude bands** (3 rows: Low, Medium, High)
- **Columns = formation slots** (5 columns)

```
        C1     C2     C3     C4     C5
Low  [ -- ][ -- ][ -- ][ -- ][ -- ]   ← deck altitude: CAS, dive bombers, low fighters
Med  [ -- ][ -- ][ -- ][ -- ][ -- ]   ← medium altitude: escort fighters, heavy fighters
High [ -- ][ -- ][ -- ][ -- ][ -- ]   ← high altitude: strategic bombers, TAC bombers, recon
```

**Why altitude rows matter:**
Aircraft effectiveness, survivability, and mission capability are all altitude-dependent.
A dive bomber placed in the High row is out of its effective altitude — it deals reduced damage.
A heavy fighter placed in the Low row is exposed to ground AA fire it was not designed to absorb.
The 3×5 formation is preset in the template builder, just like the land 5×5 grid. Players
who understand altitude doctrine extract significantly more from the same aircraft types.

### Template system
Air wing templates follow the same three-tier system as land division templates:
- **Nation presets** — historically appropriate air wing configurations per nation
- **Custom saved templates** — built in the main menu template builder, persisted to account
- **Mid-game creation** — editable when the wing is not actively engaged in combat

Redeployment to a new template requires the wing to be stood down from its current mission.
Flat 1-minute redeployment time, same as land.

---

## Air Wing Missions

An air wing is assigned to a **province** with a **mission type**. Mission assignment is the
primary player action for air — not micromanaging individual aircraft.

### Ground attack missions

**Close Air Support (CAS)**
- Assigned to a province with active or expected land combat
- Low-altitude aircraft (CAS planes, dive bombers in Low row) deal full damage
- High-altitude aircraft deal damage proportional to current recon value
- Targets are chosen randomly from divisions in combat in the province;
  divisions currently in active tactical combat are prioritised over idle divisions
- Without active land combat in the province: CAS deals only a reduced percentage of normal
  damage (aircraft cannot identify targets without a ground battle to orient on)
- Damage lands on the **land tactical grid** using the patterns below (see Air-Land Damage
  Patterns)

**Logistics Strike**
- Attacks the road supply network in the province
- Low-altitude logistics strike: does not depend on recon value. Simulates direct attack on
  a supply convoy — reduces the throughput capacity of one road segment in the province for
  N ticks (exact value set by playtesting)
- High-altitude logistics strike: depends on recon value. Simulates bridge/road damage —
  reduces the supply flow rate of the road segment proportionally to recon. At zero recon,
  minimal effect. At maximum recon, significant throughput reduction for longer duration

**Infrastructure Strike**
- Attacks buildings and province infrastructure directly
- Low-altitude infra strike: does not depend on recon. Deals targeted damage to specific
  buildings with priority on fortifications (fort level reduction). Limited total damage per
  strike — not capable of destroying a fully fortified province in one pass
- High-altitude infra strike: depends on recon value. Deals more significant infrastructure
  damage (industry reduction, building damage) but requires recon to locate specific targets.
  At zero recon, bombs fall on generic infrastructure. At maximum recon, hits priority targets

### Air superiority missions

**Air Superiority**
- Prioritises attacking enemy fighters (low-altitude fighters and high-altitude heavy fighters)
- Wing enters combat with all enemy air wings assigned to the same province
- Does not prioritise bombers — leaves them to conduct their missions while fighters duel

**Interception**
- Prioritises attacking enemy bombers rather than fighters
- Forces enemy bombing wings to divert and deal reduced damage on their current mission
- Specialised interception aircraft have reduced detection signatures (harder for enemy to
  target them before they reach the bombers)

### Naval missions
See NAVAL_COMBAT.md for port strike and naval strike mission details.

---

## Air-Land Damage Patterns

When a CAS or ground attack mission strikes a land division in combat, the damage lands on
the tactical 5×5 grid using specific patterns. These patterns mirror the land unit attack
patterns by design — air is an extension of the combined-arms system, not a separate layer.

**CAS bomb (low-altitude precision strike)**
- Hits a 1×1 or 2×2 cell cluster in the enemy grid
- Target cell is chosen proportional to recon value (same system as land artillery)
- At zero recon: random cell
- At maximum recon: weighted toward high-value targets (same priority list as sniper)
- Deals high HP damage to the targeted cell(s). Moderate suppression.
- Low-altitude aircraft are exposed to enemy AA guns during this attack

**Tactical bombing run (medium/high altitude horizontal)**
- Hits an entire **row** of the enemy grid
- Row targeting: defaults to the front row (R5). With sufficient recon, can be directed to
  a specific row (e.g. targeting R2 where artillery typically sits)
- Deals moderate HP damage and moderate suppression across all units in the row
- High-altitude aircraft are not exposed to small arms AA but are vulnerable to heavy AA guns

**Rocket and MG strafing run (low-altitude)**
- Hits an entire **column** of the enemy grid
- Column is chosen randomly, weighted toward occupied columns proportional to recon
- Deals moderate HP damage and high suppression to all units in the column
- Models historical fighter-bomber strafing of vehicle columns
- Exposed to all AA gun types due to low altitude and slow attack run

**Dive bomber (high-to-low attack)**
- Operates from High row but drops to Low altitude during the attack run
- Hits a 1×1 cell with high precision (high recon weighting even at moderate recon values)
- Deals very high HP damage to the target cell
- Vulnerable to AA guns during the attack dive despite starting at high altitude

---

## Air-to-Air Combat

When two or more nations have air wings assigned to the same province, air-to-air combat
resolves as a **shadow combat** — parallel to the land battle, not interrupting it.

### Detection and attack scaling
All air-to-air attacks are proportional to **detection value**:

| Detection | Attack dealt |
|---|---|
| 100% | 100% |
| 50% | ~50% (linear decay) |
| 0% | 5% minimum |

The 5% floor ensures that even completely undetected air wings still pose some threat —
a lone recon plane over a province is never completely safe, just much harder to hit.

**Detection sources:**
- Radar buildings in the province: significant detection bonus (most reliable source)
- Recon planes assigned to the province: generate detection each round
- Other air units have small passive detection values — they see each other to a degree
- Maritime patrol aircraft over coastal provinces contribute detection

### Distance penalty
Damage dealt by aircraft is reduced proportionally to distance from their home air base:
- Near and medium range: mild to negligible penalty
- Very long range: significant damage reduction (aircraft arrive low on fuel, less effective)
- The penalty is not linear — it only becomes significant at extreme range. Most tactical
  situations within a theatre are unaffected.

### Air combat location
The position where air combat is resolved corresponds to where the land battle is happening:
- Over provinces with active land combat: air combat happens over the combat zone
- For infra strike missions: combat happens near the targeted city/building
- For logistics strike without land combat: combat happens randomly within the province
- For CAS without active land combat: combat happens randomly within the province
- For naval missions: see NAVAL_COMBAT.md

### Mission priority interactions
When an Air Superiority wing engages an enemy CAS wing over a province:
- The enemy CAS wing is forced into air-to-air combat
- Each round the enemy CAS wing spends fighting reduces that round's ground attack output
- If the enemy CAS wing loses enough strength, it is driven off and the ground attack mission
  fails for that round
- A player who establishes air superiority over a province effectively neutralises enemy CAS
  over that province for as long as they maintain it

---

## Recon and Detection System (Air Layer)

**Detection** is the air equivalent of land recon. Both feed into the same unified recon value
for their respective engagement contexts — land recon affects land tactical targeting, air
detection affects air combat effectiveness and high-altitude bombing accuracy.

**Air recon sources:**
- Dedicated recon planes assigned to a province: generate detection value each round
- Other air units contribute small passive detection
- Radar buildings: province-level detection bonus, persistent (not per-round)

**What high detection enables:**
- Air-to-air attacks deal closer to full damage
- High-altitude CAS bombing becomes more accurate (fewer wasted bombs on empty cells)
- High-altitude logistics strike deals proportionally more damage
- High-altitude infra strike hits priority targets rather than generic infrastructure

**Maritime patrol aircraft** over sea zones generate naval detection rather than land recon.
See NAVAL_COMBAT.md for how naval detection differs from land/air recon.

---

## AA Gun Interaction

AA guns in a land division's 5×5 grid defend against air attacks targeting that division.

**AA effectiveness:**
- Light AA guns: effective against low-altitude aircraft (CAS, dive bombers, strafing fighters)
- Heavy AA guns: effective against medium and high-altitude aircraft
- AA guns deal damage to air units attacking the division, reducing their strength over
  multiple missions
- A division with well-placed AA is significantly more resistant to air attack than one without
- AA guns do not contribute meaningfully to land-vs-land combat (see TACTICAL_COMBAT.md)

**Air unit survivability:**
- Low-altitude missions are inherently riskier — exposed to both light and heavy AA
- High-altitude missions avoid light AA but remain vulnerable to heavy AA and interceptors
- Air unit strength lost to AA is recovered between missions at a rate proportional to supply
  reaching the home air base

---

## Open Questions (To Be Resolved in Playtesting)

- Exact round duration for air combat rounds relative to land rounds (same cadence or different)
- Base recon contribution rate per recon plane per round
- Detection decay rate when recon planes are not present (does detection persist between rounds
  or must it be maintained?)
- Exact damage reduction percentages for CAS without active land combat
- Specific AA damage values per gun type against each aircraft altitude band
- Distance penalty curve — at exactly what range does the significant penalty begin?
- Logistics strike throughput reduction values per road level per strike type

---

## Out of Scope for This Document

**Naval air missions** (port strike, naval strike, carrier operations) — see NAVAL_COMBAT.md.

**Tech tree unlocks** — aircraft variant stats, specialisation trees, and era-appropriate
aircraft types are later modules. The attack patterns and mission types defined here are
stable across all aircraft generations.

**Strategic bombing of cities and industry** — not yet designed. Infra strike as defined here
covers tactical-level building damage. City-level economic bombing is a later module scope.
