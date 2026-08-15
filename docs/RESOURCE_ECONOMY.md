# Grand Strategy Multiplayer — Resource Economy Design

> The foundational resource layer: the resource roster itself, what each resource's
> distinct mechanic is, how unit build cost and supply draw work, population vs.
> manpower, and the player-driven market. ECONOMY_BUILDINGS.md (buildings and their
> research trees) is built on top of everything in this document and references it
> throughout — this document is the foundation it assumes already exists.
> Last updated: June 2026.
> Combat mechanics referenced here (incapacitation, experience retention, supply
> tiers, armour penetration thresholds) are defined in TACTICAL_COMBAT.md and
> STRATEGIC_COMBAT.md and are not redefined here. Building-level production and
> research trees for every resource named here are defined in ECONOMY_BUILDINGS.md.

---

## Design Philosophy

Two failure modes from the wider genre were deliberately designed against, and every
mechanic below should be read against them:

**Reject the flat-stockpile model (HoI4, Civ6).** In both, most strategic resources
resolve to one of two shapes: a flat per-unit build cost, or a flat per-unit upkeep —
different resources are functionally interchangeable numbers with different names. This
game instead assigns each restricted resource to exactly one of three distinct
*mechanical shapes* (see Restricted Resources below), so that running low on oil, low on
chromium, and low on tungsten each produce a genuinely different in-game experience, not
three flavours of the same debuff.

**Reject the simulated-market model (Victoria 3).** Vic3's price-discovery and
shortage-cascade market is a remarkable simulation, but it demands hours to read and
react to — wrong fit for a game that has to resolve in 1–4 hours. This game's market
(see Player-Driven Market below) is **real, not simulated**: prices emerge from actual
player orders matched against each other, the way EVE Online's market works, rather
than from a formula modelling abstract supply/demand pressure.

Every resource, in addition, must clear a single bar: **running out should never feel
like a cosmetic recolour of running out of something else.** Where two resources would
otherwise behave the same way, one of them is wrong and needs a different mechanic.

---

## The Resource Roster

Ten resources, in two tiers. This replaces the placeholder five-key envelope
(`manpower, steel, oil, fuel, coal`) currently in MAP_DATA_CONTRACT.md — see Schema
Migration Notes at the end of this document for the exact field-level change.

### Common tier — every nation has meaningful access

| Resource | Role |
|---|---|
| **Money** | Universal currency. Trade medium for both market mechanisms below. Boosted by port-city trade activity, making naval blockade economically meaningful, not just territorially. |
| **Grain** | Soft population/manpower ceiling. Every nation can produce enough to function; well-developed nations produce a comfortable surplus. |
| **Iron** | Baseline industrial input. Every basic military unit needs it. Most nations have *some* access; a few (e.g. a Sweden-equivalent) have much more. Differs in degree, not in kind, across nations. |

### Restricted tier — geographically concentrated, each with a distinct mechanical shape

Every restricted resource is assigned to exactly one of three mechanical buckets, so
that no two resources resolve scarcity the same way:

| Bucket | Meaning | Resources |
|---|---|---|
| **Rate modifier** | Shortage = slower, never blocked | Oil, Rubber, Nitrates/Sulfur |
| **Stat-table shift** | Shortage = weaker, never slower, never blocked | Tungsten |
| **Hard draw-block on a subset** | Shortage = that subset stops sustaining entirely; rest of the division unaffected | Chromium, Aluminium |
| **Research-bound, not geography-bound** | Shortage is irrelevant; the constraint is research investment, not deposits | Uranium |

The sections below define each resource's mechanic in full.

---

## Oil

**Mechanical shape:** continuous flow, soft debuff curve, never a hard block.

Oil is consumed continuously by upkeep of oil-dependent unit types (motorised infantry,
all armour, all naval units, all air units) — not paid once at build time the way most
of a unit's cost is (see Unit Build Cost vs. Supply Draw below). Units that do not
consume oil (standard infantry, towed artillery, AT guns) are completely unaffected by
an oil shortage, regardless of severity.

**Debuff curve (soft, not a cliff):**

| Demand met | Effect on oil-consuming units only |
|---|---|
| 100%–50% | Negligible to minor movement/readiness penalty |
| 50%–20% | Penalty curve steepens — visible but not crippling |
| <20% | Severe penalty — but never a hard stop. A starved unit becomes slow and unreliable, never an immobile pillbox. |

This curve is deliberately soft at every point: HoI4's hard-stranded-unit outcome at zero
fuel is explicitly the new-player-frustration failure mode this design avoids. Running
dry should feel like a fading blitzkrieg, not a broken unit.

**Allocation priority (player-facing control):** a single 3-way toggle per nation —
**Military priority** (front-line units draw first, civilian economy/synthetic-refinery
upkeep throttles first under scarcity), **Balanced** (default), or **Economy priority**
(industry/research buildings draw first, military units absorb the debuff first). This
is deliberately a nation-wide toggle, not a per-division setting — granular enough to
create a real tradeoff, coarse enough to avoid HoI4-style per-unit micromanagement.

**Interaction with supply:** an oil-starved unit's HP recovery rate degrades even while
nominally *in* supply (Tier 0/no-penalty supply status per STRATEGIC_COMBAT.md), on top
of the readiness penalty above — sustained national oil shortage makes oil-dependent
units heal slower at the front, not just move slower, without changing their supply
*tier* classification.

---

## Rubber

**Mechanical shape:** stockpile that depletes from vehicle production *and* vehicle
combat wear — distinct consumption shape from oil's continuous-flow-by-upkeep model.

Rubber is drawn down by (1) the build cost of new vehicle-type units at production time,
and (2) ongoing attrition from vehicle-type units' participation in combat (tracks and
tyres wear under fire, modelled simply as a per-combat-round rubber drain proportional to
how many vehicle-type units in a division are actively engaged).

**Effect of shortage:** rather than a readiness penalty (oil's mechanic), rubber
shortage slows the **HP recovery rate specifically for vehicle-type units**, leaving
non-vehicle units in the same division unaffected. A tank division fighting a long,
grinding campaign bleeds rubber continuously from the fighting itself, independent of
how much new armour it's building — a genuinely different pressure from oil's "did I
remember to keep production running" question.

---

## Nitrates / Sulfur

**Mechanical shape:** mirror of Rubber, but targets infantry/artillery ammunition
expenditure instead of vehicle wear — the pairing that differentiates army-composition
playstyle.

Depletes from sustained ammunition expenditure by infantry and artillery-type units in
combat. Effect of shortage: slows **HP recovery rate specifically for infantry/artillery-
type units**, mirroring rubber's mechanic exactly but targeting the opposite half of a
combined-arms force. A tank-heavy nation worries about rubber; an infantry/artillery-
heavy nation worries about nitrates. The same shortage shape, applied to a different
half of the roster, is what makes army composition a real strategic identity rather than
a single "more is better" axis.

---

## Tungsten

**Mechanical shape:** substitution — the only resource in the roster where scarcity
changes a combat *stat-table lookup*, never a rate and never a hard block.

TACTICAL_COMBAT.md already defines an armour penetration threshold scale
(60/70/80/90/100% thresholds → 0/20/30/40/70/100% damage). Tungsten availability shifts
which row of that table a nation's AT/tank-gun units resolve combat against:

- **Full tungsten access:** units resolve at the table's top penetration tier.
- **Zero tungsten:** units still fight, still produce, still fully function — combat
  simply resolves at a meaningfully lower penetration tier on the same table, modelling
  a real-world molybdenum-equivalent substitute. There is no production block, no
  recovery-rate penalty, and no readiness penalty from tungsten scarcity — the entire
  effect lives in this one stat-table shift.

This is deliberately the only resource that works this way. No synthetic-tungsten
building exists (see ECONOMY_BUILDINGS.md's Tungsten Mine entry) — adding one would let
a building brute-force around the exact mechanic that makes tungsten distinct.

---

## Chromium

**Mechanical shape:** hard gate on a unit subset — premium-tier units only, rest of the
division unaffected.

Chromium-gated units are the premium tier within each unit class (heavy tank tier,
battleship belt-armour tier, and equivalents). Below a national chromium threshold,
these specific unit types cannot be built at all. Above the threshold but with chromium
flow interrupted, **existing chromium-gated units in a division stop being able to draw
supply entirely** — they enter a no-HP-recovery state immediately, independent of the
division's broader supply-tier status, while every other unit in the same division
continues to draw supply and recover normally. This is the resource that should feel
like losing a key, not losing a number: a chromium-starved nation doesn't lose the
division, it loses the ability to sustain its premium component specifically.

No synthetic-chromium path exists, and none should be added — chromium's whole identity
depends on staying genuinely scarce and ungamble-around-able (see ECONOMY_BUILDINGS.md's
Chromium Mine entry for the explicit reasoning against an "Alloy Reclamation" capstone
that would undermine this).

---

## Aluminium

**Mechanical shape:** tech-gated ceiling, hard draw-block past a tech-determined cap —
the resource whose constraint is defined by research investment, not raw deposit size.

Aluminium is nearly irrelevant early in a session, when air doctrine research is thin.
As a nation's air-doctrine tree deepens, aluminium becomes the resource that sets a hard
ceiling on air-unit supply throughput — air units cannot be resupplied past a research-
determined readiness ceiling without sufficient aluminium flow, the same hard-draw-block
mechanic as chromium, but applied specifically to air units and scaled by tech tier
rather than being a flat threshold. A nation that has not invested in air doctrine simply
never hits this ceiling, because the ceiling itself doesn't meaningfully exist yet for
them.

Aluminium is also the one restricted resource built on a genuine two-stage building
chain (bauxite mine → refinery — see ECONOMY_BUILDINGS.md), making it the resource most
likely to create a real inter-nation trade relationship: a mine-heavy nation exporting
raw bauxite to a refinery-heavy nation is a natural, emergent trade pattern rather than a
designed one.

---

## Uranium

**Mechanical shape:** research-bound, not geography-bound. The mine itself is
deliberately cheap and simple (see ECONOMY_BUILDINGS.md's Uranium Mine entry) — the
bottleneck is entirely on the research side, and a nation that pours research investment
into uranium-tier technology can reach it far earlier than any calendar-bound historical
pace, by design.

**Non-nuclear use case (confirmed):** uranium functions as a **research-currency
injection**, not a weapon. A nation with uranium access that completes a specific tech
node receives a large, one-time boost to its research currency (see Research Investment
below) — uranium becomes the resource that occasionally lets a nation buy a research
lead, never a doomsday button. This was chosen over an alternative alloy-hardening use
case (uranium-derived armour/penetrator tier above chromium's) specifically to keep
uranium mechanically simple, given how rare it is on any given map — one clear use case,
not two competing ones.

---

## Unit Build Cost, Production, and Supply Draw

Three separate mechanics that plug into each other, deliberately not merged into one
continuous-upkeep model (Stellaris's per-unit continuous upkeep was explicitly considered
and rejected — see Why Not Continuous Upkeep below):

1. **Build cost** — what a unit consumes from the resource-cost vector.
2. **`build_points`** — how long a unit takes to produce, independent of (1).
3. **Supply draw** — the ongoing resource-vector cost of keeping a fielded unit healthy.

### Division raising is unit-level under the hood, not a single lump payment

A division template is still raised with one click, exactly as before — that player-facing
action doesn't change. What changes is what happens underneath it: raising a template
creates a set of independently-fillable demand slots (one per template line) rather than
deducting the whole division's cost in one lump sum at raise time. Each slot is filled by
an individual unit, produced or drawn from Reserve, and its resource cost is deducted
per-unit as that happens — not summed and charged up front. See Reserve and Marshalling,
below, for how slots actually get filled.

### Build cost — resource vector, deducted per unit as it is produced or drawn from Reserve

Each unit type has a resource cost vector (money + iron + manpower, plus oil/rubber/
chromium/etc. depending on unit type — armour costs rubber and iron, AT guns at the
premium tier cost chromium, and so on). This part of the model is unchanged from the
original design: flat, known cost per unit, not a continuously compounding tax.

**Manpower as part of this vector specifically:** infantry-type units carry a higher
manpower-cost component; armour/mechanised units carry a lower one, reflecting real crew-
size ratios (a tank battalion has far fewer soldiers than an equivalent infantry
battalion). This is baked into the existing per-unit cost vector, not a separate system.

### `build_points` — a second, separate cost axis: how long, not what

Resource cost answers "what does this unit consume." A new, separate field —
**`build_points`** — answers "how long does this unit take to produce." Higher-tier units
(e.g. a heavy tank vs. a light tank) carry higher `build_points`, independent of how their
resource cost vector compares. This is deliberately not folded into the resource vector,
because it's consumed by a different scarce thing: a production building's own tick
capacity, not the nation's resource stockpile.

A unit's effective time-to-complete at a given production building is:

```
effective_build_rate = base_rate(building_type, building_level) × industry_pool_unit_speed_multiplier
time_to_complete = unit.build_points / effective_build_rate
```

`base_rate` scales with building level only, the same "level scales magnitude, research
adds perks" rule every building in ECONOMY_BUILDINGS.md already follows.
`industry_pool_unit_speed_multiplier` is the Industry Pool's existing unit-production-speed
slice, which this finally gives a concrete formula to act on. Which five buildings produce
which unit categories, and their research-tree shape, is specified in
ECONOMY_BUILDINGS.md.

### Reserve — the buffer between production and consumption

Produced units don't attach to a division the instant they're finished. They flow into a
national **Reserve** first:

- **Land/air Reserve** is a fungible HP-equivalent pool per unit type — not a list of
  discrete unit objects. Producing 100 HP-equivalent of Medium Tank and later drawing 60
  for a division slot is simple subtraction, mirroring how an air wing already tracks
  `count (doubles as HP pool)` rather than individual aircraft (see TACTICAL_COMBAT.md /
  AIR_COMBAT.md).
- **Naval Reserve** is a pool of discrete ship objects, each with individual HP — ships
  are not fungible. This matches naval's existing repair/construction model in
  NAVAL_COMBAT.md without any change.
- **Storage cap:** Reserve is not unlimited. This does not introduce a new building — it
  extends Warehouse's existing Bulk Storage path (ECONOMY_BUILDINGS.md) to also buffer
  unit-type Reserve stock, alongside the ten resources it already caps.
- **Scope:** Reserve stock is produced at whichever province holds the relevant building,
  but is drawn from differently depending on the consumer — see Marshalling below for new
  divisions, and Supply draw below for fielded ones.

Both a newly-raising division (filling its template slots) and an already-fielded,
damaged division (topping up lost HP) draw from this same national Reserve. When Reserve
covers demand, the draw is limited only by the relevant delivery channel's own rate (see
below). When Reserve is empty for a needed type, fresh production becomes the bottleneck
instead — the delivery channel and the factory line are then in series, not parallel, and
the slower of the two throttles the whole draw:

```
effective_fill_rate = min(production_rate, delivery_channel_rate)
```

A fast factory behind a slow delivery channel is still slow; a fast channel behind an
idle factory is still idle. This is the same bottleneck logic the existing road-segment
flow-rate model already uses elsewhere in STRATEGIC_COMBAT.md — this system just adds a
new upstream source feeding into it, not a new kind of math.

### Reserve status — deficit/excess severity

For UI and scheduler-priority purposes, each Reserve category's health is expressed as a
**net rate relative to that category's own storage cap**, not a raw HP/tick number — this
normalises across unit types whose absolute production/consumption rates aren't
comparable (Infantry's ±50/tick and Tank's ±2/tick can represent the same relative
severity):

```
severity = (production_rate - consumption_rate) / reserve_cap_per_tick
```

Five bands (placeholder thresholds, TBD from playtesting, structurally confirmed):

| Band | Severity range |
|---|---|
| Heavy deficit | ≤ −15% |
| Light deficit | −15% to −2% |
| Neutral | −2% to +2% |
| Slight surplus | +2% to +15% |
| Heavy surplus | ≥ +15% |

**Zero-demand edge case:** a unit type with no current demand at all (no marshalling
template or fielded division currently wants it) reads as **Neutral**, never as a
deficit — zero supply against zero demand is not a problem, and classifying it as a
deficit would be a false alarm every game starts with by default.

### Marshalling — filling a division before it deploys

A newly-raised division exists off-map in a **Marshalling** state before the player sends
it to the front. During Marshalling, its delivery channel is a flat national constant —
`MARSHALLING_RATE` — independent of province and independent of building level, and
deliberately fast relative to normal field supply (exact value: playtesting). If Reserve
is empty for a needed type, the fill rate drops to `min(production_rate,
MARSHALLING_RATE)` per the formula above.

**Early deployment:** once a marshalling division reaches **≥50% aggregate HP** — computed
as `(sum of current HP across present units) / (sum of full HP across all template-target
units)`, a whole-division percentage against total HP, not a headcount or per-slot
threshold — the player may deploy it early. Doing so trades the fast, guaranteed
`MARSHALLING_RATE` for whatever the front's actual field-supply infrastructure can support,
which may be slower. This is a real, legible strategic tradeoff: fielding sooner at the
cost of a potentially slower fill from then on, not simply "the number goes up regardless."
Once deployed, a division permanently switches to the field supply-graph delivery channel
described next, even if still below 100% strength.

### Supply draw — proportional flow, drawn continuously while in the field

Once deployed, a division's supply draw at any tick equals **(missing HP fraction) ×
(unit's build cost, expressed as the same resource vector used at production time)**. This
draw is satisfied first from Reserve if available, and is delivered via the supply graph
already defined in STRATEGIC_COMBAT.md (hub → road graph → division's current segment) —
the delivery channel rate in the `min()` formula above is this road-segment flow rate for
a division in the field. The flow itself is a *resource-mix vector*, not a flat scalar
"supply points" value: a tank-heavy division's draw is mostly oil + rubber; an infantry-
heavy division's draw is mostly nitrates + grain. The same road segment carries a
different effective resource mix depending on what's moving through it, which is free
emergent depth from the existing flow-graph system rather than a new one.

**Where this plugs into the existing three-tier supply status (STRATEGIC_COMBAT.md):**
Tier 1 (Out of Supply) already sets HP recovery rate to zero. Resource-specific
debuffs from this document apply *underneath* that tier system, not instead of it — a
division that is nominally in full supply connectivity can still suffer oil's readiness
penalty or rubber's vehicle-recovery penalty if the *nation* lacks the resource, even
though the *graph connectivity* is fine. Supply tier answers "can this division reach a
hub at all"; resource shortage answers "does the nation have enough of what this
division specifically needs, once it's connected."

### Which unit gets produced next — the allocation algorithm

Which idle production building builds what, and which fielded/marshalling demand gets
served first, is governed by a national auto-scheduling algorithm (pull-based: idle
buildings request an order rather than being re-evaluated every tick), ranked primarily
by each demand slot's missing-HP percentage, cost-weighted by `build_points` when a
building must choose between producible types. Full specification of this algorithm is
out of scope for this document — see the Unit Production System implementation handoff.

### Why not continuous per-unit upkeep (Stellaris model) — rejected, explicitly

Stellaris's per-ship continuous alloy upkeep was evaluated and rejected because it
creates a "binge-build" trap: a continuously compounding cost discourages steady
military spending and instead rewards saving up and dumping an entire fleet at once,
since the upkeep cost of what you already own compounds with anything new you build. That
incentive is exactly wrong for a 1–4 hour session, where continuous, readable engagement
is the goal. Fixed cost at raise time avoids this entirely — there is no "wait to build"
incentive, because cost does not compound with existing holdings.

---

## Population and Manpower

Split into two distinct values, replacing the single overloaded `population` field
currently in MAP_DATA_CONTRACT.md (see Schema Migration Notes).

### Population — per-province stock, grows over time, rewards being left alone

Population grows steadily over the course of a session via a flat or lightly-
accelerating tick-based rate — deliberately not HoI4's multi-week drift-toward-target
model (entirely invisible inside a 1–4 hour session) or Victoria 3's full demographic
simulation (far too much machinery for a side-system).

**Population is the resource a defensive, "turtling" nation invests in.** A nation
holding its core provinces and building civilian infrastructure sees population compound
over the session; an aggressive nation spending manpower on conquest and absorbing
battle losses sacrifices some of that growth. This tension requires no policy or law
layer — it falls directly out of "population grows when undisturbed, manpower draws it
down."

**Population feeds end-of-session scoring.** A province's effective VP contribution at
final scoring scales with (base `vp_value` × population reached), not `vp_value` alone.
This directly differentiates a "turtle and develop" nation from a "conquer everything but
never develop" nation at the scoring layer, reusing the existing `vp_value` field rather
than introducing a new scoring mechanic. (See ECONOMY_BUILDINGS.md's Town Hall building
for the concrete player-facing lever that targets this multiplier directly.)

### Manpower — recruitable fraction of population, drawn down by unit cost

Manpower is not tracked as an independent province stock — it is the recruitable portion
of population, drawn down as part of each unit's build-cost vector (see Unit Build Cost
above) and regenerating from population at a steady, visible per-tick rate.

**Recovery is tick-based, not HoI4's multi-week drift.** A nation that has taken heavy
losses needs time (ticks, not in-game weeks) to recover manpower — the same mechanical
shape as a division healing on the supply graph, kept consistent rather than introducing
a second recovery model.

**Soft cap, not hard cap, at low manpower-to-population ratios.** Recruiting from a
heavily exhausted manpower pool does not become impossible — it becomes progressively
more expensive (a cost multiplier on new unit builds), mirroring real conscription strain
without needing a HoI4-style conscription-law tier ladder. This keeps manpower in the
same "rate modifier" mechanical bucket as oil/rubber/nitrates, rather than introducing a
fourth shape solely for manpower.

---

## Industry — the Multiplier Layer

Industry is not a resource a player spends — it is the multiplier layer sitting on top
of every resource-extraction building in ECONOMY_BUILDINGS.md. Full mechanic (the
national pool, per-slice diminishing returns, default allocation) is defined in
ECONOMY_BUILDINGS.md's "The Industry Pool" section and is not repeated here. The load-
bearing rule from that section, restated for completeness: **every extraction building
produces its full base-tier output with zero industry allocated** — industry is always
upside, never a precondition, so a player who never touches the allocation panel still
has a fully functional economy.

Population contributes to a province's `industry` value growth rate (see
ECONOMY_BUILDINGS.md's Infrastructure building, Path C), making population a quiet
second-order input into the whole economy beyond its direct VP-weighting role above.

---

## Player-Driven Market

Two complementary mechanisms, deliberately imbalanced in friction so that one is always
the better long-term choice and the other survives as a real but costly fallback.

### Spot market — instant, money-only, penalized

A global per-resource order book: players post buy or sell orders, and matching orders
resolve immediately, the same pattern as EVE Online's player-driven exchange — prices
emerge from real player orders, never a simulated supply/demand formula.

**Money-only, no resource-for-resource barter.** The spot market trades each resource
against money exclusively. This keeps it a single, simple liquidity pool instead of
needing a full N² exchange-pair matrix; anyone wanting direct resource-for-resource
substitution is pushed toward standing trade routes (below), where that's negotiated
bilaterally instead.

**Symmetric spread penalty, ~10–20%, applied to both legs.** A matched sell order pays
the seller roughly 80–90% of their listed price; a matched buy order costs the buyer
roughly 110–120% of the going rate. The difference is burned (a money sink, not
redistributed to any other player or pool — avoids a "who gets the skim" balance
question and gives a clean inflation-control lever for playtesting). Applying the
penalty symmetrically on both sides is deliberate: a one-sided penalty (sellers only)
would leave rational players always selling spot and only ever buying via trade routes,
which undercuts the goal of making trade routes strictly better for both legs of a
transaction, not just one.

**NPC liquidity floor.** A baseline AI buy/sell wall at a slightly-worse-than-fair price
ensures a player is never stuck unable to trade simply because no human has posted an
order yet — the same discoverability/empty-lobby safety-net logic already applied
elsewhere in this game's design, here applied to the market instead of the matchmaking
queue.

### Standing trade routes — slower to establish, higher value, real geography

A persistent pipe between two specific points, not a one-off transaction:

- **Port-to-port**, between any two nations with naval access — reuses NAVAL_COMBAT.md's
  existing blockade/trade-disruption mechanics directly. A standing route's throughput
  scales with the same blockade percentage already defined for naval interdiction; no new
  disruption math is needed.
- **Capital-to-capital or province-to-province, land routes, neighbours only.** A land
  trade route is only possible between nations that share a border. This makes border
  control and buffer-state diplomacy matter economically, not just militarily — a
  landlocked nation surrounded by hostile neighbours is meaningfully economically
  isolated, a real strategic consequence rather than a flavour detail.
- **Third-party transit rights.** A landlocked nation can route a land trade line through
  a third nation's territory if that third nation explicitly grants a transit-rights
  diplomacy flag. This gives small/minor nations a genuine economic role as transit
  corridors, distinct from and complementary to their military "minor nation problem"
  weakness — a buffer state that can't fight can still matter economically.
- **Resource-for-resource barter is allowed here**, unlike the spot market — this is
  where a mine-heavy aluminium nation trades raw bauxite to a refinery-heavy partner, or
  a chromium-rich nation trades for oil, negotiated directly between the two parties.

**No spread penalty on trade routes** — the friction here is setup time and geographic/
diplomatic exposure (a route can be cut by blockade, by losing the relevant border, or by
a transit nation revoking rights), not a price haircut. This is the intended trade-off:
spot market = instant but expensive; trade routes = cheaper but exposed and requires an
actual relationship (a shared border, or a granted transit right, or naval security).

---

## Open Questions (To Be Resolved in Playtesting)

- Exact oil debuff curve constants at each of the three demand-met bands
- Exact rubber/nitrate attrition rate per combat round, scaled by how many relevant unit
  types are actively engaged
- Tungsten's exact penetration-tier downgrade at each tungsten-availability band
  (confirmed: a stat-table shift, not a flat percentage; exact table mapping from
  playtesting)
- Chromium/aluminium hard-draw-block thresholds (confirmed qualitatively: a national
  stock/flow threshold below which the gated subset stops drawing supply; exact
  threshold values from playtesting)
- Aluminium's tech-tier-to-ceiling mapping (which air-doctrine research tiers raise the
  aluminium-gated supply ceiling, and by how much)
- Uranium's research-currency injection magnitude, and which specific tech node triggers it
- Manpower soft-cap cost-multiplier curve at low manpower-to-population ratios
- Population growth rate (flat vs. lightly-accelerating — shape leaning toward the
  latter, exact curve from playtesting) and its tick cadence
- Population-to-VP-weight conversion formula exact constants (the base `vp_value` ×
  population-reached relationship — confirmed shape, not confirmed numbers)
- Spot market spread percentage (10% vs. 20%, or a value in between)
- NPC liquidity floor's exact spread-from-fair-price and refresh behaviour
- Whether reallocation of the industry pool needs any switching cooldown at all, or can
  be fully free (see ECONOMY_BUILDINGS.md's own open question on this)
- Exact `build_points` value per unit type/tier, and exact production `base_rate` per
  building level for each of the five production buildings (ECONOMY_BUILDINGS.md)
- Exact `MARSHALLING_RATE` constant
- Default deploy-stream vs. supply-stream production split when Reserve is empty and both
  compete for the same unit type (currently specified as a flat 50/50, adjustable
  weighting deferred to a post-launch iteration — not v1 scope)
- Whether a newly-*constructed* ship auto-joins its owner's assigned flotilla the way a
  *repaired* ship already does (NAVAL_COMBAT.md), or requires manual assignment
- Exact severity band thresholds for Reserve status (±2%/±15% given as placeholders in
  Reserve status — deficit/excess severity, above; structurally confirmed, exact cutoffs
  from playtesting)

---

## Schema Migration Notes (for MAP_DATA_CONTRACT.md)

The resource envelope in MAP_DATA_CONTRACT.md (`manpower, steel, oil, fuel, coal`) is
superseded by the ten-resource roster in this document. The corresponding schema change
is applied directly to MAP_DATA_CONTRACT.md alongside this document (see that file's
Economy and Resources sections) rather than restated here in full — summary of the
change: `population` is split from its prior dual role ("manpower pool and general
economic weight") into a pure population/growth field, with manpower no longer tracked
as an independent per-province field at all (it is derived from population, per
Population and Manpower above, not stored separately); the `resources` envelope's five
placeholder keys are replaced with the ten resources defined in this document
(`money, grain, iron, oil, rubber, nitrates, tungsten, chromium, aluminium, uranium`).

---

## Out of Scope for This Document

**Building-level production and research trees** for every resource and civilian
building named here — covered in full by ECONOMY_BUILDINGS.md, which this document
underpins.

**Military buildings** (fort, supply hub, radar, command post, etc.) and their
interaction with this economy — a separate design pass, noted as out of scope in
ECONOMY_BUILDINGS.md as well.

**Exact resource-to-nation/map placement** — which nations start with access to which
resources is a map-authoring decision, not a mechanics decision, and is not covered
here.
