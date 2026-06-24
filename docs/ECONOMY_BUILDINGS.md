# Grand Strategy Multiplayer — Economy & Civilian Building Design

> Confirmed design decisions for the province-level economic layer: civilian buildings,
> resource extraction buildings, the industry allocation system, and the perk-based
> research trees that govern how every building in this document grows in capability.
> Last updated: June 2026.
> This document covers civilian buildings, resource extraction/processing buildings,
> the national industry pool, and building-level research trees. Military buildings
> (fort, supply hub, radar, command post, etc.) and unit specialization research are
> covered in a separate pass — see Out of Scope below. Combat mechanics referenced here
> (incapacitation, experience retention, supply tiers) are defined in TACTICAL_COMBAT.md
> and STRATEGIC_COMBAT.md and are not redefined here.

---

## Design Philosophy

Two principles govern every building in this document:

**1. The building does the heavy lifting. Industry is a bonus, never a precondition.**
A resource extraction building produces its full base-tier output with zero industry
allocated to it. A player who never opens the industry allocation panel still has a
complete, functional economy. A player who actively manages allocation extracts
meaningfully more from the same buildings. No building's baseline function depends on
a system the player might forget to touch — forgetting to allocate industry costs
optimization, never function.

**2. Research adds and redistributes perks. Building level scales magnitude only.**
Every building's base level does exactly one thing, and that one thing scales in
strength as the building is upgraded (level 1 → level 5). Leveling up a building never
unlocks a new category of effect — it only makes the existing effect stronger. New
effects (perks) are unlocked exclusively through research. Once a perk is researched,
it automatically scales with building level going forward, the same way the base effect
does — there is no need to re-research a perk at every level.

Research is not purely additive. Some research nodes add a wholly new perk. Others let
the player **redistribute** strength between perks the building already has — trading
some of one effect for more of another. This means two players who both researched the
same building can end up with meaningfully different buildings, specialized toward
different playstyles, without either being objectively wrong.

**Why this matters for playstyle diversity:** because perks can pull a building's
identity in genuinely different directions, the *placement* of that building often
matters too. A hospital specialized toward casualty reduction wants to sit safely in
the rear. A hospital specialized toward supply throughput wants to sit close to the
front, where it can actually contribute to feeding active divisions. The research tree
doesn't just change numbers — it changes where on the map a building wants to live, and
that's a real strategic decision, not a stat optimization puzzle.

---

## The Perk Tree Shape (applies to every building below)

Every building's research tree follows the same structural rules established for unit
specialization (see the unit research design tenets — out of scope for this document,
referenced for shape only):

- **Paths are spatially adjacent, not hard-locked, not a free-for-all.** A building has
  2–4 named paths (its "archetypes" — what the building can be optimized toward).
  Unlocking a tier in one path unlocks the next tier in that same path, plus the same
  tier in the immediately adjacent path(s). Distant paths cost more by structure (more
  total nodes to cross), not by an arbitrary tax.
- **Paths are not mutually exclusive by default.** A player can freely invest across
  all of a building's paths if they choose to spread their research. Nothing locks a
  player out of a path just because they invested in an adjacent one.
- **Specific tiers can be locked as mutually exclusive choice-points.** At a small
  number of deliberately chosen tiers, the perks on offer across paths become a single
  choice — pick one of the three (or however many), and the others at that *specific
  tier* become unavailable. This is a tier-local lock, not a path-local one: choosing
  the casualty-reduction perk at a locked tier does not prevent the player from later
  picking up supply-throughput perks at a different, unlocked tier in the adjacent
  path. Players are free to take all available perks across all paths at any
  non-locked tier if they invest enough — locks exist only where a deliberate
  this-or-that identity choice is wanted, not as a general path-exclusivity rule.
- **Width and depth scale with building complexity**, using smaller bands than units
  (buildings are a supporting system, not the main event):

| Building complexity | Paths (width) | Tiers (depth) |
|---|---|---|
| Simple | 1–2 | 2–3 |
| Standard | 2–3 | 4 |
| Complex | 3 | 5–6 |
| Flagship-equivalent | 3–4 | 6–7 |

---

## The Industry Pool

All factory output across every province a player owns feeds **one national pool** —
not a per-province resource the player manages individually. The player allocates this
pool across a single panel with live, freely-adjustable sliders:

- One slice per resource (the 10 resource types — see resource buildings below)
- One slice for construction speed (building/upgrade queue speed nationally)
- One slice for unit production speed

**Diminishing returns apply per slice independently.** Pouring 80% of the pool into one
slice does not yield proportionally more than spreading allocation — each slice
saturates on its own curve. This prevents any single allocation choice from snowballing
uncontrollably over the course of a session.

**Reallocation is near-instant** (live sliders, at most a short cooldown to prevent
frame-perfect micromanagement) — deliberately not HOI4's multi-day production-line
commitment, which doesn't fit this game's session length.

**New factories default-allocate to money production and construction speed.** This
default is changeable by the player at any time, but the unmodified default is always a
safe, sensible, positive outcome — never a wasted or punishing one.

**The relationship between buildings and the pool:** a resource extraction building's
*tier/level* sets its base output ceiling (produced at full value with zero industry
allocated). The industry pool's allocation to that resource type is a multiplier on top
of every building of that type the player owns nationally — a player with many oil
buildings across many provinces gets more absolute value from the same allocation
percentage than a player with one province's worth of oil buildings. The buildings
define capability; the pool defines optimization.

---

## Civilian Buildings

### School

**Base effect:** science production (scales with level). Small population growth
bonus is present at base level as a secondary, fixed effect (does not require research
to exist, only to grow beyond its base magnitude).

**Complexity:** Standard (2 paths, 4 tiers)

**Path A — Curriculum (science yield):**
- T1: increases science output magnitude beyond base level scaling
- T2: adjacent-path link to Path B opens
- T3: unlocks a perk converting a portion of school science output into a flat research
  speed bonus for whichever research panel the player is currently prioritizing
- T4: further increases Curriculum's T1 effect magnitude

**Path B — Officer Corps (military synergy):**
- T2: unlocks a perk where the school contributes to the experience-tier training rate
  of the barracks building in the same province (see TACTICAL_COMBAT.md's barracks
  training mechanic) — a school-barracks synergy unique to this path
- T3: increases the T2 contribution magnitude
- T4: unlocks a perk improving the population-growth secondary effect specifically
  (literacy → growth), pulling some identity back toward the population side without
  sacrificing the Officer Corps military synergy

No locked tiers on School — both paths are complementary rather than competing
identities, so there's no natural choice-point worth forcing.

---

### Hospital

**Base effect:** casualty reduction (scales with level), pooled **nationally** across
every hospital the player owns, with **hard diminishing returns** on the pooled total.
The first hospital contributes its full per-level value; each additional hospital
contributes a shrinking fraction, asymptotically approaching a cap well short of making
any unit unkillable. This is a deliberate, non-negotiable design constraint — no
hospital-stacking strategy should ever produce invincible units. Population growth is
present as a base-level secondary effect, same status as School's.

**Complexity:** Complex (3 paths, 5–6 tiers)

**Path A — Triage (casualty reduction specialization):**
- T1: extends the diminishing-returns cap slightly higher than base
- T3: unlocks faster recovery-rate out of the Incapacitated state specifically (ties
  directly into TACTICAL_COMBAT.md's incapacitation mechanic — incapacitated units
  reach HP-recovery eligibility sooner)
- **T5 — locked, mutually exclusive with Path C's T5:** choose **Mass Casualty
  Protocol** (pushes the pooled national casualty-reduction cap meaningfully higher
  than any other combination achieves) or **Rapid Reconstitution** (incapacitated
  units return to active combat duty significantly faster, independent of the
  recovery-rate perk from T3, which governs eligibility — this governs actual return
  speed once eligible)

**Path B — Logistics Integration (supply specialization):**
*Base hospital has zero effect on supply — this entire path is research-gated from
nothing, consistent with "base = minimal, research = where new effects live."*
- T2: unlocks the hospital contributing to local supply-graph throughput at all (see
  STRATEGIC_COMBAT.md's flow-based supply model — this hospital becomes a minor
  secondary supply source in its province)
- T4: increases the T2 contribution magnitude meaningfully
- T5 (not locked — Path B has no exclusive choice-point, deliberately, since its
  identity is singular: throughput): a perk increasing the building's own structural
  HP/durability specifically *because* a Logistics-specialized hospital is expected to
  sit closer to the front line near active combat, where it's exposed to bombardment
  and air interdiction that a rear-positioned Triage hospital never faces. This is the
  building-level expression of the positional tradeoff: specializing toward supply
  throughput is rewarded with a survivability perk precisely because that
  specialization demands forward placement.

**Path C — Field Medicine (adjacent to Path A, experience-focused):**
- T1: unlocks a perk pushing the experience-retention-on-incapacitation percentage
  (TACTICAL_COMBAT.md's base 60% retention) higher for divisions recovering in this
  province — a genuinely different lever from Path A's raw casualty-count focus, even
  though both are "hospital things"
- T3: increases the T1 retention bonus further
- **T5 — locked, mutually exclusive with Path A's T5:** choose **Veteran Cadre**
  (pushes experience retention close to full, at the cost of forgoing Path A's T5
  choice entirely — a hospital built around preserving veteran experience above all
  else) — this is presented as the third option alongside Path A's two T5 choices,
  i.e. the T5 lock is a three-way choice across Paths A and C combined, not two
  separate two-way locks

**Positional design intent, stated explicitly:** Path A/C (Triage, Field Medicine) are
adjacent and both reward rear placement — a hospital built this way is safest far from
the front. Path B (Logistics Integration) is the outlier, explicitly rewarding forward
placement near active combat, and its T5 survivability perk exists specifically to make
that forward exposure survivable. A player choosing Path B is choosing a different map
position, not just a different stat — this is the clearest example in the building
roster of research changing *where a building wants to live*, not just what it does.

---

### Infrastructure

**Base effect:** off-road movement speed bonus for divisions moving through or out of
the province (already established in MAP_DATA_CONTRACT.md), scaling with level. Small
population growth bonus present at base level, same status as School/Hospital.

**Complexity:** Standard (3 paths, 4 tiers)

**Path A — Trade Network (money specialization):**
- T1: unlocks money production as a new perk (not present at base level — Infrastructure
  starts as a pure movement/population building, money is research-gated)
- T2: increases T1 magnitude — deliberately designed so that with this path invested,
  Infrastructure's money output becomes genuinely competitive with Factory's base money
  output. This is intentional redundancy: provinces with poor resource deposits but
  strong road position should have a real money-generating answer that doesn't depend
  on Factory's resource-extraction synergy.
- T4: further increases T1/T2 magnitude

**Path B — Logistics Corridor (supply specialization):**
- T1: unlocks a perk where Infrastructure contributes to the supply-graph throughput
  of road segments passing through the province (extends STRATEGIC_COMBAT.md's
  flow-rate model — Infrastructure becomes a throughput multiplier on the existing
  road graph, not a new supply source)
- T3: increases the throughput contribution magnitude

**Path C — Public Works (population specialization, adjacent to both A and B):**
- T2: increases the base population-growth secondary effect beyond what level scaling
  alone provides
- T4: unlocks a perk where high Infrastructure level in a province slightly increases
  the province's `industry` value growth rate (per the population→industry relationship
  established for the broader economy system) — Infrastructure indirectly helping the
  whole province's economic ceiling rise faster over a session, not just its own output

No locked tiers on Infrastructure — all three paths are genuinely complementary
(money, supply, population all reinforce a "developed province" identity rather than
competing for it), so forcing a choice here would work against the building's purpose.

---

### Warehouse / Depot

**Base effect:** raises the storage ceiling (the cap below which a sudden resource
cutoff doesn't instantly zero a province out) for resources in the province, scaling
with level. This is the only civilian building whose core identity is a **buffer**, not
a generator — a deliberately different mechanical shape from every other building in
this document.

**Complexity:** Simple (2 paths, 3 tiers)

**Path A — Bulk Storage:**
- T1: increases the storage ceiling magnitude beyond base level scaling
- T3: unlocks a perk allowing overflow above the ceiling to convert automatically into
  a small money trickle (sell-off) rather than being wasted outright

**Path B — Hardened Storage:**
- T1: unlocks resistance to a portion of stockpile loss from air interdiction/bombing
  of the province (Warehouse becomes the building that protects accumulated reserves
  specifically against the existing infra-strike mechanic, rather than against
  day-to-day consumption)
- T2: increases the resistance magnitude

---

### Shipyard (Civilian)

**Base effect:** produces trade convoy capacity (distinct from the naval dockyard's
warship production) — the resource that backs standing player-to-player trade routes
and is consumed by naval blockade/interdiction. Requires a port in the same province.

**Complexity:** Standard (2 paths, 4 tiers)

**Path A — Throughput:**
- T1: increases convoy capacity output magnitude
- T3: unlocks a perk reducing the time a sunk/damaged convoy takes to be replaced from
  capacity reserve

**Path B — Resilience:**
- T2: unlocks a perk reducing the probability of a cargo-sinking event against routes
  originating from this shipyard specifically (a province-level counter to the
  naval-side submarine-raiding mechanic, distinct from any naval escort unit's
  contribution)
- T4: increases the T2 reduction magnitude

---

### Town Hall / Administrative Center

**Base effect:** increases the population-to-victory-point weighting conversion rate
for its province specifically (a province's effective end-of-session VP contribution
scales with base `vp_value` × population reached — Town Hall is the building that
directly targets that multiplier). This is the concrete building target for a nation
playing a development/turtle strategy rather than a conquest strategy.

**Complexity:** Standard (2 paths, 4 tiers)

**Path A — Civic Pride:**
- T1: increases the VP-weighting conversion magnitude beyond base scaling
- T3: unlocks a perk extending the same conversion bonus to a small radius of adjacent
  owned provinces, not just the province the Town Hall sits in — rewarding a
  contiguous, developed heartland rather than scattered single-province investment

**Path B — Continuity:**
- T2: unlocks a perk reducing how much a province's accumulated population-to-VP
  progress is set back if the province is briefly captured and recaptured during the
  session — protects a developing nation's long-term investment from being entirely
  erased by a single bad battle, without making captured provinces risk-free to hold
- T4: increases the T2 protection magnitude

---

## Resource Extraction & Processing Buildings

All ten resources (money, grain, iron — common tier; oil, rubber, nitrates/sulfur,
tungsten, chromium, aluminium, uranium — restricted tier) have a dedicated extraction
or processing building. As established in the Design Philosophy above, **every one of
these produces its full base-tier output with zero industry allocated** — the perk
trees below describe what research unlocks on top of that guaranteed baseline, not
what's required to reach the baseline.

Resource buildings use the same **archetype** framing as units, but the archetype axis
is *what the building optimizes for* rather than combat doctrine. Three recurring
archetype identities appear across multiple resources, named consistently for clarity:

- **Yield** — raw output maximization
- **Efficiency** — better behavior under stress (allocation throttling, ramp time,
  interdiction resistance) rather than higher peak output
- **Reach** — unlocks access to deposits/methods not available to the base building at
  all, rather than improving the existing deposit

Not every resource gets all three — deliberately. Some resources stay narrow by design
(see Tungsten and Chromium below), consistent with the principle that not every system
needs maximum richness to be well-designed.

---

### Iron Mine

**Base effect:** standard linear-ish extraction scaling with building level. The
baseline case — nothing exotic, by design, since Iron is the common-tier resource every
nation needs reliable access to.

**Complexity:** Standard (2 paths, 4 tiers)

**Path A — Yield:**
- T1/T2/T4: straightforward magnitude increases to base extraction

**Path B — Reclamation (Reach-adjacent):**
- T2: unlocks a perk converting a portion of destroyed-unit wreckage in the province
  (from combat resolved on this province's territory) into bonus iron output — a small
  reward for fighting defensively on home ground rather than only on enemy territory,
  tying combat outcomes back into the economy without introducing a new combat mechanic
- T4: increases the wreckage-conversion rate

---

### Grain Farm / Granary

**Base effect:** standard grain output scaling with level, and (per the population
system) this building directly contributes to the province's population growth rate —
not just a passive side-effect like the civilian buildings above, but Grain Farm's
actual secondary identity.

**Complexity:** Standard (2 paths, 4 tiers)

**Path A — Yield:**
- T1: unlocks **Mechanized Agriculture** as a perk — meaningfully increases raw grain
  output
- T3: increases Mechanized Agriculture's magnitude further
- *Tradeoff built into this path, not a separate lock:* taking Mechanized Agriculture
  reduces this building's population-growth secondary contribution somewhat (real-world
  tractors/fertilizer historically displaced rural population growth) — stated as a
  direct trade within the perk itself, not a tier-lock, since it's a soft tradeoff
  rather than a hard either/or identity choice

**Path B — Smallholding (population specialization):**
- T2: increases the population-growth secondary contribution beyond base scaling,
  explicitly the inverse tradeoff to Path A's Mechanized Agriculture
- T4: further increases the population contribution

---

### Oil Derrick / Offshore Platform

**Base effect:** standard land-based extraction scaling with level.

**Complexity:** Complex (3 paths, 6 tiers)

**Path A — Yield:**
- T1/T2: magnitude increases to base extraction
- T4: unlocks a synergy perk increasing extraction rate proportional to the province's
  current `industry` value specifically (on top of the separate national industry pool
  allocation — a building-level reward for being sited in an already-developed province)

**Path B — Efficiency (allocation-throttle specialization):**
*This path exists specifically to soften the oil-allocation-priority mechanic
established for the unit-economy layer — see the unit/resource economy design for the
military/economy/balanced allocation toggle.*
- T2: unlocks a perk reducing the civilian-economy throughput penalty incurred when the
  player throttles oil toward military priority — a derrick built this way keeps more
  of its output flowing to the civilian economy even under wartime allocation pressure
- T5: increases the T2 mitigation magnitude

**Path C — Reach (adjacent to Path A, geography-expanding):**
- T3: unlocks **Offshore Platform** as a constructable building type in coastal
  provinces with adjacent sea access — not a tier upgrade to the land derrick, a
  structurally separate building unlocking sea-zone oil deposits that don't exist as
  land-province resources at all
- T6 (locked, mutually exclusive with nothing at this tier — single capstone, not a
  this-or-that choice): unlocks **Deep-Sea / Arctic Drilling**, extending Offshore
  Platform's reach to sea zones previously inaccessible at any tech level. Deliberately
  the most expensive node on this tree — reaching it mid-session should be a notable,
  lobby-visible commitment, not a quiet incremental step.

---

### Rubber Plantation / Synthetic Plant

**Base effect:** standard extraction, but with a **ramp-up mechanic unique to this
resource** — a newly built plantation takes longer than other extraction buildings to
reach its full base-tier output (modeling real rubber trees taking years to mature).
This ramp exists at base level regardless of research.

**Complexity:** Complex (3 paths, 5 tiers)

**Path A — Yield:**
- T1/T3: magnitude increases to base extraction once ramped

**Path B — Efficiency (ramp-speed specialization):**
- T2: unlocks a perk shortening the ramp-up period specifically — the building reaches
  full output sooner after construction
- T4: further shortens ramp time

**Path C — Synthesis (Reach, geography-independent):**
- T1: unlocks **Synthetic Rubber Plant** as an alternative building type, available to
  any nation regardless of geography, with a steeper industry-allocation-to-output
  ratio than the natural plantation — everyone can eventually get some rubber, but it's
  cheaper to lean on the real deposit if you have it
- T5 (locked, mutually exclusive with nothing at this tier — capstone): unlocks
  **Polymer Synthesis**, pushing the synthetic building's output to fully match natural
  plantation output regardless of geography, at very high research cost. A
  rubber-poor nation can fully escape its geographic disadvantage here, but only by
  committing heavily — deliberately balanced so this neither trivializes rubber scarcity
  nor leaves a resource-poor nation permanently locked out of parity.

---

### Nitrate Works (Natural Deposit) / Synthetic Works

**Base effect:** standard extraction from natural deposits, scaling with level.

**Complexity:** Complex (3 paths, 5 tiers)

**Path A — Yield:**
- T1/T3: magnitude increases to base natural-deposit extraction

**Path B — Synthesis (Reach, geography-independent, mirrors Rubber's Path C):**
- T1: unlocks **Synthetic Works** (Haber-process-equivalent) as an alternative building
  type, available to any nation, geography-independent, steeper allocation-to-output
  ratio than natural deposits — same "everyone can get some, real deposits are cheaper"
  shape as Rubber, since both resources share the real-world dynamic of having a viable
  industrial substitute
- T5 (locked, capstone): unlocks **Catalytic High-Yield Synthesis**, doubling synthetic
  output at steep research cost — same balancing logic and narrative role as Rubber's
  Polymer Synthesis capstone

**Path C — Efficiency (adjacent to Path A, consumption-side):**
- T2: unlocks a perk reducing how fast nitrate stockpiles deplete from sustained
  infantry/artillery ammunition expenditure specifically (the attrition mechanic
  established for this resource at the unit-supply layer) — a building-level lever on
  the *consumption* side, distinct from every other resource building in this section,
  which only ever affect the *production* side

---

### Tungsten Mine

**Base effect:** standard hard-rock extraction scaling with level. Low base output
everywhere by design — tungsten deposits are genuinely rare.

**Complexity:** Simple (1 path, 3 tiers) — **deliberately narrow.**

**Path A — Yield (the only axis):**
- T1/T2/T3: magnitude increases to base extraction

No Reach or Efficiency path exists for Tungsten, and no synthetic alternative building
exists. This is intentional, not an oversight: Tungsten's identity lives at the
unit-supply layer as the substitution resource (scarcity downgrades AT/penetration
tier rather than blocking production — see the unit-economy design). Giving it a
synthetic escape valve here would undercut that identity by letting a building brute-
force around the mechanic that makes Tungsten distinct. Keeping this building simple
is a deliberate choice consistent with "not every building needs maximum richness."

---

### Chromium Mine

**Base effect:** standard rare-deposit extraction scaling with level. Same rarity
profile as Tungsten.

**Complexity:** Simple (1 path, 3 tiers) — **deliberately narrow, same reasoning as
Tungsten.**

**Path A — Yield (the only axis):**
- T1/T2/T3: magnitude increases to base extraction

No synthetic path. Chromium's identity is the hard-gate premium resource (below a
threshold, the nation's premium unit tier is locked out entirely) — that identity
depends on chromium staying genuinely scarce and ungamble-around-able. A late capstone
("Alloy Reclamation," converting destroyed-armour wreckage into chromium, mirroring
Iron's Reclamation path) is intentionally *not* offered here, because it would let a
chromium-poor nation farm its way to parity simply by surviving battles — undermining
the resource's role as a genuine geographic constraint. (Contrast with Iron's
Reclamation path, where Iron's identity as an abundant common-tier resource means a
small wreckage bonus doesn't threaten anything.)

---

### Bauxite Mine + Refinery (Aluminium)

**Base effect:** a genuine **two-stage building chain**, structurally distinct from
every single-building resource above. The mine extracts bauxite; the refinery converts
bauxite into usable aluminium. Both stages scale independently with their own building
level.

**Complexity:** Complex (3 paths, 6 tiers) — paths are split across the two stages
deliberately, so a player can specialize toward *which stage* they push.

**Path A — Mine Yield:**
- T1/T3: magnitude increases to bauxite extraction specifically

**Path B — Refinery Yield:**
- T2/T4: magnitude increases to bauxite-to-aluminium conversion efficiency specifically
  — a mine-heavy nation that under-invests here ends up exporting raw bauxite value it
  can't fully convert, while a refinery-heavy nation can profitably import bauxite from
  a trade partner and convert it at a premium. This is the resource where the
  building-level choice most directly creates an inter-nation trade relationship, by
  design.

**Path C — Advanced Fabrication (Reach, capstone-only):**
- T6 (locked, capstone): unlocks the high-end air-doctrine supply ceiling described in
  the unit-economy design (Aluminium's role as the tech-multiplier resource gating
  late-game air unit sustainment) — this is purely a research unlock, not a new
  building, keeping Aluminium's identity as "the resource whose ceiling is set by tech
  investment, not building investment" consistent at the top of its tree.

---

### Uranium Mine

**Base effect:** standard rare-deposit extraction. The mine itself is genuinely cheap
and simple to build — by design, the bottleneck for Uranium is never the building.

**Complexity:** Simple (1 path, 2 tiers) — **the simplest tree in the entire resource
roster, by design.**

**Path A — Yield (the only axis):**
- T1/T2: magnitude increases to base extraction

Uranium's entire strategic identity lives in the *unit/economy research tree*, not
here — a nation that pours research investment into reaching uranium-tier technology
can do so far earlier than any calendar-bound historical pace would suggest, precisely
because nothing about the mine building gates that pace. This is the deliberate inverse
of Tungsten/Chromium (where geography dominates and the building stays narrow because
the *resource* is meant to stay scarce) — here the building stays narrow because the
*research path*, not the building, is meant to be the entire story.

---

## Open Questions (To Be Resolved in Playtesting)

- Exact diminishing-returns curve shape and constants for industry pool allocation per
  resource slice (logarithmic vs. other saturating curve — shape confirmed, constants
  not)
- Exact diminishing-returns cap and curve for Hospital's pooled national casualty
  reduction (confirmed qualitatively: must never approach invincibility — exact cap
  from playtesting)
- Building slot count per province (leaning toward 5, matching the existing universal
  building-level cap, but not confirmed) and per-level upgrade cost curve steepness
- Exact tier-lock placement for Hospital's three-way T5 choice (Path A ×2 + Path C ×1)
  — confirmed structurally, exact research-cost weighting not set
- Money output parity target between Infrastructure (Path A, fully invested) and
  Factory base output — confirmed as a design intent ("genuinely competitive, not
  dominant either way"), exact numbers from playtesting
- Ramp-up duration for Rubber Plantation before reaching full base output
- Mechanized Agriculture's exact population-growth tradeoff magnitude (Grain Farm
  Path A)
- Ratio penalty for synthetic vs. natural extraction (Rubber Synthetic Plant, Nitrate
  Synthetic Works) before and after their respective capstone nodes
- New-factory default allocation split between money production and construction
  speed (confirmed both are viable defaults; exact starting split not set)
- Reallocation cooldown length for the industry pool sliders (confirmed "near-instant,"
  exact seconds not set)

---

## Out of Scope for This Document

**Military buildings** (fort, supply hub, radar, command post, coastal battery,
anti-air network, listening post) — placement model, command-post radius mechanics,
and their own perk trees are a separate design pass.

**Unit specialization research** (Infantry, Armoured, Artillery, Air, Naval doctrine
trees) — covered by the unit research design tenets and the per-branch trees built on
top of them. This document's perk-tree *shape* (adjacency, width/depth bands, tier-local
mutual exclusivity) is shared with that system but the actual unit trees are not
defined here.

**Exact resource-to-nation/map placement** — which nations start with access to which
resources, and whether resources remain province-level scalars or gain any point-placed
component, is a map-authoring decision covered elsewhere.

**Research panel top-level structure** (which sub-panel each tree lives in, hotkey
allocation) — the Economy & Industry panel referenced throughout this document as the
home for these trees is defined at the panel-structure level elsewhere; this document
defines tree contents, not panel chrome.
