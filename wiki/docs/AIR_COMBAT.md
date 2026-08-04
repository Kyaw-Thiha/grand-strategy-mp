# Grand Strategy Multiplayer — Air Combat Design

> Confirmed design decisions for the air combat layer.
> Last updated: August 2026 — mission auto-targeting & patrol priority implemented in
> Branch L (`feat/air-mission-ai`), concrete tuning values from implementation added to
> relevant sections, resolved open questions moved to their own subsection.
> **This is a full replacement of the previous province-assigned, round-resolved air combat
> design.** Air wings are now individually selectable, real-time, pathfinding units — closer
> to naval flotillas than to the old abstracted model. See "Relationship to Other Combat
> Layers" at the end of this document for what changed and why.
> Air combat interacts with land tactical combat (see TACTICAL_COMBAT.md),
> strategic supply (see STRATEGIC_COMBAT.md), and naval combat (see NAVAL_COMBAT.md).

---

## Design Philosophy

Air combat moves from HoI4-style abstraction to something closer to Call of War: **wings are
individual, selectable, map-pathfinding units**, not values assigned to a province and
resolved in the background. A wing has a position, a heading, a mission, and moves in real
time.

This is a genuine departure from this game's tactical grid (`TACTICAL_COMBAT.md`'s explicit
"never add real-time grid micromanagement" rule) and from naval's zone-abstraction — but it
does not import Wargame: Red Dragon's real-time-twitch demands along with it. The distinction
that makes this safe: **real-time simulation clock, not real-time control requirement.** A
wing given a mission needs zero further clicks to behave sensibly indefinitely — it finds
targets, attacks, returns to refuel, and relaunches on its own. Manual override (retasking, a
specific target, pulling a wing home early) is always available and rewards map-aware
players, but is never required to get a reasonable outcome. Same floor/ceiling philosophy as
everywhere else in this game, applied to a genuinely real-time layer for the first time.

The atomic unit is the **wing**, not the individual aircraft — mirroring the naval flotilla
precedent (`NAVAL_COMBAT.md`), not a literal per-plane roster. A wing is **homogeneous**: one
aircraft type, one count. This keeps entity count sane at scale (a wing is a strategic
commitment, the same order of magnitude as a land division or naval flotilla, not a swarm of
individually-tracked planes) and matches how real air forces were actually organised —
squadrons flew one type.

---

## The Air Wing

**State:** aircraft type, count (doubles as HP pool), fuel, combat readiness, position,
heading, current mission, current target (if any), home airbase, weapon/ordnance-ready state.

**Fuel** decays fast while airborne (faster than readiness) and is the primary range limiter.
When fuel drops to a threshold, the wing is forced to RTB regardless of its current mission.
Fuel refills quickly at base (~5 ticks to full). Ferry flights (RELOCATE state) consume fuel
normally — a wing ferrying to a distant staging base may arrive depleted and must refuel
before it can execute a queued mission. RTB is suppressed during RELOCATE so the wing always
completes the ferry leg regardless of remaining fuel. Fuel is the mechanic that makes
distant missions more costly than close ones; a wing sent far from base may not have enough
fuel for the return leg, and the dynamic range ellipse (see Pathfinding) makes this visible
to the player in real time.

**Combat readiness** decays slowly while airborne — much slower than fuel — and represents
crew fatigue, ordnance depletion, and airframe wear. It does not force RTB; a wing can
operate at low readiness, but it scales outgoing damage, making exhausted wings markedly
less effective. Readiness refills slowly at base, representing maintenance and rest. This
creates a meaningful choice between flying a partially-recovered wing sooner versus waiting
for full readiness. Research perks that lower the decay rate are a legible, readable upgrade
on either axis.

The two-axis model separates concerns cleanly: **fuel governs where a wing can go**
(range, forced RTB), **readiness governs how hard it hits when it gets there** (damage
scaling). A wing on a short-range mission can sortie again quickly after a fast refuel;
the same wing flying repeated long sorties accumulates readiness degradation that no quick
refuel can fix — it needs ground time.

**Wings are raised and templated like land/naval units** — nation presets, custom saved
templates, mid-game creation when not engaged. A template is just aircraft type + count,
since composition depth now lives in mission choice and positioning rather than in a grid.

---

## Wing Lifecycle

```
Idle (at base) → Transit (to target) → Engaged (mission/combat)
     │                                          │
     │ (redeploy order)           ┌─────────────┴─────────────┐
     │                      multi-sortie perk            base case
     ▼                            │                           │
Relocate (ferry to new base) Loiter (orbit target,      RTB (curved return)
     │                        cooldown)                       │
     ▼                            │                     Refuel/rearm at base
Refuel at new base                └──► back to Transit        │
     │                                 (next target)          └──► Idle
     └──► Idle (or queued mission)
```

Single-sortie wings (the default) fly one engagement, then must RTB and refuel before
launching again. A multi-sortie perk lets a wing loiter near its last target for a short
cooldown (10–20s, exact value playtesting-bound) instead of immediately returning — long
enough that a target isn't struck twice almost instantly, short enough to matter tactically.
This is the same orbit-path logic used for Interception's default wait-for-a-target state
below — one piece of pathfinding, two uses.

**RELOCATE** is a distinct airborne state for ferry flights between airbases. It can be
ordered from any state — from ground states (IDLE, REFUEL) it starts immediately; from any
airborne state the wing RTBs first, then begins the ferry. During RELOCATE: fuel does not
decay (ferry range benefit), enemy contact does not trigger engagement (wing is in transit
posture, not combat posture), and the player cannot redirect the wing (committed flight). A
mission assigned before the relocation completes is queued and auto-starts after landing and
refuelling at the new base.

Only wings not in `Idle` need a rendered icon/path at all — a base-camped reserve fleet never
touches the map, which is most of the answer to the UI-clutter risk of individually-tracked
wings at scale.

---

## Pathfinding

Land/naval pathfinding is A* over a terrain-and-road graph (`PATHFINDING.md`). Air doesn't
touch terrain — it's a kinematics problem, and a well-established one: **Dubins paths**
(straight legs joined by minimum-turn-radius arcs) give a flyable route from any position and
heading to any target, and that same technique's arc-only special case is exactly the
loiter/orbit pattern used for cooldowns and for Interception's wait state. RTB uses a Dubins
path back to base respecting current heading — it turns around, it doesn't flip.

**Interception without a visible target:** since enemy wings are only visible when inside
someone's detection coverage (see Detection & Visibility), a wing on Interception or Air
Superiority with nothing currently spotted doesn't sit idle — it flies to a patrol area and
loiters (same orbit code) until a target is spotted, then breaks off to intercept. This is
the intended lever for skilled play: a player can send an obvious threat toward one flank to
pull enemy interceptors there, then commit the real strike through the gap. Default
behaviour needs no player input; reading and exploiting it is the skill ceiling.

**Interception and Air Superiority targeting priority** are full tiered search chains, not a
single preference — see "Mission Auto-Targeting & Patrol Priority" below for every mission's
complete chain, the shared crowd-balancing and border-adjacency mechanisms behind the patrol
fallback tiers, and the per-tick responsiveness/hysteresis rule that governs when a wing
switches targets.

**Chasing a moving target:** once a target is spotted, an interceptor generates a pursuit
path (lead pursuit, a standard missile-guidance technique) toward the target's current or
predicted position, recomputed periodically — not continuously — to keep this server-cheap.

**Dynamic range circle.** When a wing is selected, a live circle overlay centred on the wing
shows how far it can travel from its current position given remaining fuel. The radius shrinks
in real time as fuel decays (client-side interpolation gives smooth sub-tick updates). When
fuel drops to the RTB threshold, the circle collapses to a small warning ring. The circle
represents one-way reach from the wing's current position; the server's RTB threshold
reserves enough fuel for the return leg automatically.

**Auto-staging.** If a transit order targets a point beyond the wing's max range from its
home airbase, the server automatically finds the nearest friendly airbase that is itself
within range of the target, relocates the wing there first (RELOCATE state), and fires the
original transit order after the wing lands and refuels. A brief notification confirms the
staging. If no such airbase exists, the order falls through as a normal transit (wing will
RTB when fuel runs low before reaching the target).

**Server-authoritative movement.** Land pathfinding is client-computed and server-validated
after the fact; air needs to be **server-authoritative from the start**, because combat
outcomes now hinge on exact intercept timing in a way land's discrete rounds never did.
Positions stay closed-form (deterministic Dubins/pursuit curves), so this doesn't cost
meaningful bandwidth — the client extrapolates the same curve the server computes, and the
server only needs to broadcast a path-generation ID and elapsed time, not raw positions,
exactly the same trick land's dead-reckoning already uses for waypoint chains.

**Contact detection stays on the existing 500ms room tick** — no new faster subsystem
needed. Because positions are analytic curves, the server can run a *swept* check each tick
("did these two paths come within engagement range at any point during this window") instead
of sampling more frequently. Cheap, and scoped only to wings already near each other via
spatial bucketing.

---

## Aircraft Types & Missions

Two altitude bands, not three — the original three-row split collapsed cleanly once AA
effectiveness was checked: heavy AA already treats medium and high altitude identically, so
a third band added no defensive distinction, only formation-building overhead.

**Exact aircraft variants, research archetypes, and perk trees are later modules** (see Out
of Scope) — this section defines the confirmed roster of archetypes and their eligible
missions, not final unit stats.

### Low altitude

| Type | Missions |
|---|---|
| CAS plane | Tactical bombing, Interception, Air Superiority |
| Dive bomber | Tactical bombing, Interception, Air Superiority |
| Fighter | Interception, Air Superiority, (Tactical bombing via research perk) |
| Naval bomber | Trade interdiction, Anti-submarine, Anti-ship |

### High altitude

| Type | Missions |
|---|---|
| Heavy fighter | Interception, Air Superiority, Escort, (Tactical bombing via research perk) |
| Strategic bomber | Logistics / Area / Industry / Oil bombing |
| Tactical bomber | Logistics / Area / Industry / Oil bombing, Tactical bombing |
| Recon plane | Recon |

**Escort eligibility is range-gated, not type-gated.** Heavy Fighter reaches deep
strategic-bomber missions by design (longer range, lower readiness decay, and — see
Detection & Visibility — an observation range close to its attack range, which is the actual
mechanism that makes it viable as an escort rather than just a stat difference). Standard
Fighter is not hard-blocked from Escort, but its shorter range, faster readiness decay, and
short observation range make it naturally unsuited to deep escort and well suited to
short-range tactical escort near the front, matching the real history of short-ranged
fighters failing at deep escort (the Bf 109 over Britain, ~10 minutes loiter time before
having to turn back) without needing a hardcoded rule. A future drop-tank-style research perk
is one plausible way Fighter later reaches deep-escort viability; a Heavy-Fighter-style
archetype is the other route (slower, worse in a straight dogfight against enemy Fighters,
but long-ranged and better-sighted from the start, mirroring the historical Bf 110) —
research specifics are deferred, per this document's scope (mechanics before perks).

---

## Damage Patterns

**Dive bomber** — single-cell precision target on the enemy tactical grid. Base priority is
recon-weighted (same shape as artillery); a research perk can swap in a fixed priority list
(sniper's targeting model) or raise target count per engagement.

**Tactical bomber (Tactical bombing mission)** — hits the **front-occupied row**,
prioritising soft (non-armoured) targets — carpet bombing. Starts covering only 2–3 cells
from one side of the row; a research perk expands coverage to the full row.

**CAS bomber (Tactical bombing mission)** — hits a **column** (IL-2-style anti-column
strafing/rocket run), same partial-then-full-coverage research progression as tactical
bomber, mirrored for columns instead of rows.

**Fighter's strafing perk (Tactical bombing mission)** — also a **column** pattern, not row —
a deliberate divergence from Tactical bomber's carpet-bombing row, keeping Fighter's light
ordnance mechanically distinct from a dedicated bomber's heavier pattern rather than a
weaker copy of the same attack.

**Naval bomber** — see Naval Missions below; flotillas have no internal grid, so its damage
shape is a different axis (single-target vs. splash) rather than cell/row/column.

All of the above land damage on the **land tactical grid** using the existing attack-pattern
machinery in `TACTICAL_COMBAT.md` — air is an extension of the combined-arms system, not a
separate resolution path. CAS/tactical-bombing damage injected mid-round is safe against
`TACTICAL_COMBAT.md`'s existing attack patterns, since those already re-check live grid state
at resolution time (e.g. infantry "targets first row with at least one living unit") rather
than a cached start-of-round snapshot — verify this holds once the round loop is
implemented, but no redesign should be needed there.

---

## Combat Resolution

**Combat resolves per engagement, not per tick.** A wing gets one decisive exchange per
sortie (or per engagement within a multi-sortie flight) — this is not attrition ground down
tick-by-tick the way a land tactical round is; it's closer to "one pass, then reload/RTB
before the next chance." Attrition happens **across separate sorties over a battle**, not
within one continuous dogfight. This matters for calibration: the numbers below need to make
one exchange meaningful, not survivable-by-default.

**Attack vs. Defense — one rule covers bombers, fighters, and the reload-vulnerability case:**

```
damage_dealt = weapon_ready ? Attack_value : Defense_value
```

Every wing has an Attack-vs-air value (its main offensive punch, gated by weapon-ready/
reload cooldown) and a small, always-available Defense-vs-air value (passive return fire —
tail gunner, deflection shot). A pure bomber simply has `Attack_vs_air = 0` — a data value,
not a special-cased code path, the same pattern `TACTICAL_COMBAT.md` uses for AA guns having
no ground-attack role. Defense value target: **~10–15% of Attack** — enough that a caught-
reloading wing is still meaningfully worse off, not enough to make catching it a free kill.

**Calibrating Attack_value — the lethality ratio.** Define `L` as the fraction of an equal-
strength opponent's HP a full-strength, full-readiness, non-surprised wing deals in one
exchange:

```
L = (H_attacker × Attack_value_per_plane) / H_opponent
```

Target **L = 0.15–0.35** for a fair, mutually-spotted fight — high enough that one exchange
has real stakes, low enough that two alert equal wings meeting head-on don't erase each other
in a single pass. This replaces any per-tick attrition framing; `L` is the thing to tune, not
a tick count.

**Surprise — the mechanism that makes detection asymmetry matter.** Attack range is uniform
across all aircraft types (see Detection & Visibility); observation range is not. A wing can
therefore be within striking distance of a target it hasn't itself been spotted by — the
mechanical version of a WWII "bounce," where a widely-cited estimate holds that roughly 80%
of aerial kills were surprise attacks the victim never saw coming. On the tick an engagement
first triggers, if the attacker had the target in detection coverage *before* this tick and
the target did not have the attacker detected, the attacker's damage this exchange gets a
surprise multiplier:

```
damage_dealt = weapon_ready ? Attack_value × S : Defense_value
```

Target **S = 2.0–3.0×**. At the top of that range, `L × S` can approach or exceed 1.0 —
meaning a well-executed surprise attack against an equal-strength wing can credibly wipe it
out in the one pass it gets. That asymmetry is intentional: a fair, mutually-spotted fight
stays in the grinding 15–35% range; a successful bounce is close to decisive. Skill (setting
up the detection gap) should matter more than the base matchup. If both sides detected each
other on the same tick (a head-on meeting), neither gets `S` — fair fight.

A pure bomber gains nothing from being the surprise attacker (`Attack_vs_air = 0` regardless
of `S`) and loses nothing extra from being surprised (it was always in the Defense branch) —
surprise only matters between Attack-capable targets, which is the historically honest
outcome: bombers died to being outnumbered or unescorted, not to being bounced.

**Why this still produces real attrition across a battle, not just coin-flips:** the multi-
sortie loiter-cooldown (see Wing Lifecycle) is literally "how many separate chances does this
wing get," and combat-readiness decay means a wing's later sorties in a long session hit for
less than its first (lower readiness scales `Attack_value_per_plane` down directly). A wing
that survives an early bounce and keeps flying doesn't face a flat risk each time out — it
gets progressively weaker, reusing the fatigue mechanic already designed for a different
reason.

**Target deconfliction.** When multiple friendly wings could each independently pick the same
"best" enemy target, greedy unique-target assignment prevents pile-ups: sort engaged
friendlies, each claims its highest-scoring **still-unclaimed** enemy contact, removing it
from the pool. If attackers outnumber targets, overflow doubles up on the highest-value
remaining target rather than sitting idle. Cheap (O(n log n)), no new infrastructure.

**Auto-target weighting** (for any mission's auto-search with no manually selected target):
utility score = `distance_falloff(from current wing position) − CROWD_WEIGHT × claims(target)
+ noise_floor`. The noise floor matters for the same reason the old detection formula kept a
5% minimum — a purely greedy nearest-target algorithm is predictable and gameable. The crowd
term is what generalizes deconfliction beyond same-tick attack-range ties: it spreads wings
across distinct targets even while several are still inbound/in-transit, not just once they
arrive. See "Mission Auto-Targeting & Patrol Priority" below for the full shared mechanism
(distance is measured from the wing's own current position, not its home airbase) and how
every mission's tiered search consumes it.

---

## Wing Sub-Status System

Mirrors `TACTICAL_COMBAT.md`'s Vehicle Sub-Status System directly — same four-category
shape, same deterministic reasoning, same multiplicative stacking convention. Applied
**wing-wide, not per-plane**: HP (plane count) is unaffected by status; status is a flag on
the whole wing with a magnitude, multiplying the wing's derived values. This is simpler than
per-plane bucketing and more consistent with how fuel and readiness already work — both are
wing-level scalars, not tracked per individual aircraft, so status shouldn't be the one thing
that isn't.

### The four flags

| Flag | Effect | Historical anchor |
|---|---|---|
| **Engine** | Reduced speed | Direct mobility-kill equivalent |
| **Weapons** | Reduced Attack/Defense value | Direct firepower-kill equivalent |
| **Fuel tank** | Faster fuel decay, forces earlier RTB | Self-sealing tanks existed specifically because fuel-tank hits were the line between "damaged" and "explosion" — and the tradeoff was real: self-sealing tanks cut fuel capacity 20–30% (e.g. the P-38 went from 410 to 300 gallons), a direct precedent for "surviving this costs you range" |
| **Instruments** | −1 row/column reach in its attack pattern | Bombsight/gunsight damage — same logic as a tank's Optics flag |

### Deterministic triggers

Which status a wing takes is determined by **what kind of attack hit it**, not a roll —
same principle as the tank system, applied to air-specific attack sources:
- **Defense-value return fire** (small-arms-scale, glancing hits) → **Instruments**. Weak
  hits tend to land on soft external components rather than critical structure.
- **AA fire specifically** (province fixed AA or flotilla pooled AA — not air-to-air) →
  **Fuel tank**. Flak-vs-fuel-tank is the single best-documented non-fatal aircraft damage
  category of the war; self-sealing tanks were the direct historical response to exactly
  this pattern.
- **A fighter's full Attack value landing without destroying the target** → **Engine or
  Weapons**. Concentrated cannon fire that doesn't down a plane outright typically disables
  one or the other.

Same attack type always produces the same status, exactly like the tank table it mirrors.

### Applying status to combat math

Individual planes don't hold fractional status — the flag and its magnitude apply once to
the whole wing:

```
wing_effective_attack = HP_count × Attack_value_per_plane × status_modifiers
```

Where `status_modifiers` is the product of every active flag's multiplier (multiplicative
stacking, consistent with `terrain_modifier_system.ts`'s existing convention) — e.g. a
Weapons-flagged wing might apply ×0.6; add a second Weapons-tier hit and it becomes
×0.6 × 0.6 = ×0.36, not ×0.2 (additive) or a flat re-roll. Same shape recommended for Engine
(speed), Fuel tank (decay rate), and Instruments (pattern coverage) — each status modifies
its own relevant value the same way.

### Recovery

All four flags clear on RTB and refuel/rest, same as fuel and readiness — no separate repair
system. A wing that doesn't make it home with an active flag doesn't get the chance to clear
it, the same "you only keep it if you get it back" logic `TACTICAL_COMBAT.md`'s Incapacitated
state already uses for land units left behind in a retreat.

---

## Wing Size & Formation Density

Bigger wings aren't strictly better, and the reason is historical rather than an arbitrary
balance lever. The USAAF's "combat box" bomber formation is a real case of *increasing*
returns to size, capped by a real counter-pressure rather than an artificial one: a 54-plane
"wing box" could mass up to ~700 defensive machine guns in overlapping fields of fire — a
genuine escalating mutual-defense benefit from flying in a bigger group. But larger
formations were also easier for flak to hit — a large, bunched formation flying straight and
level on a bomb run was a far better target than a small, loose one. This is the actual
historical reason formation size oscillated across the war (54-plane boxes when fighters
were the dominant threat, shrinking back to 36 once flak overtook fighters as the primary
killer by mid-1944) rather than one size simply winning.

**The same two-sided pressure applies to wing size here:**
- **Bigger wings get a saturating Defense-value bonus** (mutual covering fire) —
  increasing, but with diminishing marginal benefit past a certain size, so it plateaus
  rather than rewarding infinite stacking. **Current implementation:** `defense_bonus =
  min(count / 36, 1.0) × 0.4` applied as `1 / (1 + defense_bonus)` saturation on
  incoming damage — a 36-plane wing takes ~28.6% less air-to-air damage than a
  singleton.
- **Bigger wings take more AA damage** (both province fixed AA and flotilla pooled AA scale
  up somewhat with wing size — a denser formation is a better flak target). Roughly linear,
  no saturation expected.

Where these cross is a genuine, emergent sweet spot rather than a hard cap — the same shape
of reasoning naval flotillas already use for their 15–20 ship cap, arrived at through a
trade-off instead of a flat number. A reasonable real-world anchor for playtesting: the
actual historical progression was 18/36/54 planes, settling on 36 as the wartime standard
once both threats (fighters and flak) mattered simultaneously.

---

## Airbase Capacity — Soft, via Recovery Congestion

Airbase capacity is **soft, not a hard wing-slot cap**: more wings stationed at one base
means each wing's fuel and readiness recovery rate while `Idle` gets marginally slower,
representing shared ground crew and maintenance bandwidth. **Current implementation:**
`congestion_factor = 1 / (1 + max(0, wingsAtBase - 3) × 0.15)` — the first 3 wings at a
base recover at full rate; each additional wing beyond that multiplies recovery speed by a
progressively smaller factor (6 wings = 0.69×, never reaches zero). This is continuous
pressure, never a wall — it rewards building more airbases without making a single base feel
like it hit a ceiling, and it's the same shape as manpower recruitment in
`RESOURCE_ECONOMY.md` (**progressively more expensive, never hard-blocked**), just applied
to ground-crew bandwidth instead of manpower.

This stacks cleanly with Wing Size & Formation Density above without the two fighting each
other: size pressure discourages one mega-wing; base-congestion pressure discourages
spamming many small wings at the same field. Between the two, there's no hard wall anywhere —
just gradients pushing toward a moderate number of moderately-sized wings spread across more
than one airbase, without a single arbitrary cost multiplier.

---

## Escort

A wing on Escort is assigned to a specific friendly bomber wing, not a fixed destination or
target category. Its path follows the bomber's path; its engagement trigger is "an enemy wing
is currently attacking my assigned bomber," not nearest-enemy targeting. This is genuinely
different logic from Air Superiority/Interception (which hunt categories) and needs its own
code path. If the assigned bomber is destroyed or completes its mission and RTBs, the escort
wing follows it home automatically rather than needing a fresh order.

---

## Detection & Visibility

Air reuses **land's observation-radius model**, not naval's opaque/fuzzy-contact model — a
plane in open sky has no physical hiding mechanism equivalent to a submerged submarine, so
there's no reason to duplicate naval's fog-of-war shape here. An enemy wing is visible to you
if it is currently inside the detection coverage of a radar building, a friendly wing, or a
land division's observation radius — binary, continuously updated, not time-boxed.

**Attack range is uniform across all aircraft types; observation range is not.** This
deliberate gap is what makes the surprise mechanic in Combat Resolution meaningful — a wing
can be well within striking distance of a target before that target's own (shorter)
observation range would ever reveal the attacker back. Recon Plane carries by far the
largest observation range of any type, matching its sole Recon mission. Every other type's
observation range is comparatively short by default — including bombers, which is why an
unescorted bomber wing is genuinely blind to an incoming interceptor until very late.

**Heavy Fighter is the deliberate exception, and it's the actual answer to escort viability:**
rather than fixing the escort-vulnerability problem with raw stat bumps, Heavy Fighter's
observation range sits close to its attack range — nothing can get within striking distance
of it, or the bomber it's protecting, without being spotted first. This matches the real
historical job of an escort (mutual lookout to prevent bounces, not just surviving one
better) more directly than a Defense-value buff would. A smaller Defense-value bonus on top
is reasonable as a secondary cushion — even real escorts got bounced sometimes (Bf 110s
needed their own escort at times despite being purpose-built for exactly this role) — but
observation range is the primary lever, not Defense value.

**Sources:**
- **Radar building** — reveals all air units in a region; also boosts naval detection chance
  in the same area. Not tied to the city point (sited independently, like the supply hub).
  Full building design (levels, cost, perk tree) is deferred to the "military buildings" pass
  flagged in `ECONOMY_BUILDINGS.md`; this document defines only its functional effect on air
  detection.
- **Recon plane** — extends observation/scouting visibility, literally revealing new targets
  to other wings. Detection is **not persistent** — a recon plane must keep hovering over a
  target area for the detection (and therefore the ability of other wings to path toward it)
  to hold; break contact and the target goes dark again.
- **Other air units** — small passive detection, same as before.

This also answers how a strike wing "finds" a target it didn't spot itself: recon holds
visibility on an area, a bombing wing already inbound (or retasked) completes the kill —
mirroring how real strike missions were vectored onto contacts held by a separate spotter.

**The exception this doesn't cover: air-to-land.** Attack-range-beyond-observation-range
creates surprise for air-to-air combat, but a bombing run still requires being essentially on
top of the target — there's no equivalent "attack from beyond where you'd be seen" for
ground targets without a guided stand-off weapon, which real stand-off munitions did exist
for (Germany's radio-guided Fritz X and Hs 293 glide bombs, released up to several miles from
a ship target) but are explicitly deferred — see Out of Scope.

---

## Strategic Bombing

Four sub-targets, all confirmed:

| Mission | Hits | Geography |
|---|---|---|
| **Logistics** | Road segment throughput, for N ticks | Real road/supply-hub geometry — distance-decayed AA exposure |
| **Area** *(renamed from "civilian")* | Population / infrastructure | City point — full AA exposure |
| **Industry** | The province's `industry` scalar (`MAP_DATA_CONTRACT.md` already flags this field "Affected by bombing") | City point — full AA exposure |
| **Oil** | Provincial oil extraction output, for N ticks (mirrors Logistics Strike's existing throughput-reduction shape, not a stockpile kill) | City point — full AA exposure |

"Area" replaces "civilian bombing" as a name — it's the actual historical term (RAF Bomber
Command's area-bombing campaign, distinct from precision industrial bombing) and avoids the
loaded framing of the old label.

Industry and Oil deliberately target the same city point as Area bombing rather than
inventing separate rural geography — no building in the current map schema has a position
distinct from the city (`MAP_DATA_CONTRACT.md`: only `city.position` is a literal point;
every other building, including every resource-extraction building, is a flat province
scalar). If a later map-authoring pass gives buildings point-placed positions, this can be
revisited; it isn't blocking today.

---

## AA Interaction — three distinct layers

| Layer | Defends | Triggers on | Defined in |
|---|---|---|---|
| Division grid AA | A specific engaged land division | CAS/dive-bomber attack on that division | `TACTICAL_COMBAT.md` (existing) |
| **Province fixed AA** | The city / province itself | Any strategic bombing mission | This document (new) |
| **Flotilla pooled AA** | Ships at sea | Naval Strike mission | `NAVAL_COMBAT.md` (new) |

**Province fixed AA** (the "anti-air network" building flagged as deferred in
`ECONOMY_BUILDINGS.md`'s military-buildings pass — this document defines only its functional
behaviour, not its full build/level/perk design):
- **City-point missions (Area, Industry, Oil)** — full damage. Historically, direct strikes
  on a defended city/industrial target faced the densest flak belts (the Ruhr, Berlin); this
  mechanic makes hitting the highest-value strategic target the highest-risk one, by design.
- **Logistics and Tactical bombing** (real geography away from the city — road segments, or
  wherever the front actually is) — damage decays with distance from the city centre, reusing
  the same non-linear "mild near, steep only at extreme range" curve shape already defined
  for the wing distance-penalty mechanic, rather than inventing a second falloff formula.
- Retains the existing light/heavy split by target altitude, same as division-grid AA.

**Flotilla pooled AA** — full mechanic defined in `NAVAL_COMBAT.md`; summarised here for
completeness. AA damage against an attacking air wing is **pooled across every AA-capable
ship currently in the target flotilla**, weighted toward light cruisers (already stated in
`NAVAL_COMBAT.md`: "best AA output per ship of any surface class... primary fleet role: AA
coverage for carriers") — not just whatever ship is being targeted. This matches real
carrier task force doctrine: ships arranged in a circular screen specifically so each ship's
AA fire covers the others in company, credited historically with results like the Philippine
Sea's 90%+ interception rate against a single large raid. A ship class set to Held Back
posture (existing toggle) does not contribute to the pool — out of formation, no mutual
coverage. Resolved as a single check at the moment of the attack run, same framing as land
CAS's AA exposure, not a continuous per-tick drain.

---

## Naval Missions

**Naval bomber** — Trade interdiction, Anti-submarine, Anti-ship. All sea-zone assignments,
gated by the same fog-of-war rules as the rest of naval combat (`NAVAL_COMBAT.md`): no
detection, no target.

- **Trade interdiction** reuses the existing cargo-sinking-event machinery submarines already
  trigger — no new mechanic, a second unit type feeding the same event.
- **Anti-ship / Anti-submarine** auto-target the highest-value contact first (reusing the
  carrier Strike preset's existing "capital ships first" priority) — no manual
  target-type filtering, consistent with every other auto-battler-style targeting rule in
  this game.

**Finding a target in real time, under naval fog of war:** a detected contact generates a
strike-able marker — a randomized-radius position, valid for a limited time window — rather
than the flotilla's exact true position. Precision and duration scale with what generated the
contact: a maritime patrol wing actively on-station gives a tight, continuously-refreshed
marker; a cargo-sinking-triangulated contact gives a wide radius and a short window. If the
bomber physically reaches the marker before it expires, the strike resolves against the
flotilla's true composition; if not, the sortie whiffs — mechanically honest to how real
contact-report strikes sometimes found empty ocean.

**Damage shape:**
- **Base:** single target (the highest-value ship found).
- **Splash** (research perk): primary target takes full damage, a percentage splashes to
  other ships in the same flotilla — flotillas have no internal grid, so "splash" means
  spreading across flotilla membership, the only spatial container that exists for naval
  units. This creates a genuine tension with the AA-pooling mechanic above: a tightly packed
  formation maximises mutual AA coverage but also maximises splash exposure — the tradeoff
  falls out of the two systems already designed, no extra mechanic needed.
- **Multi-sortie** (generic perk, not naval-specific — see Wing Lifecycle) lets a single
  flight engage additional targets, potentially a different ship or a different flotilla
  entirely, before RTB.

**Port strike** — targets ships in port; anchored ships have no zone-based or pooled-AA
defence, fully exposed. Naval base level reduces damage to docked ships (existing rule).

---

## Mission Auto-Targeting & Patrol Priority

> **Implemented August 2026 in Branch L** (`feat/air-mission-ai`). See
> `AirMissionTargetingSystem` in `game-server/src/systems/air_mission_targeting.ts` for the
> authoritative implementation. This section's design remains the specification the code was
> built against; the implementation note at [[game-server/simulation/air-operations|Air
> Operations]] summarizes the resulting code architecture.

Every mission needs a wing to behave sensibly with zero further clicks, per this document's
Design Philosophy — this section defines the tiered search chain each mission runs, and the
shared mechanisms behind the patrol fallback tiers every chain eventually reaches.

### Shared mechanisms

**Border-adjacency.** "Near the border with nation X" is real polygon-derived province
adjacency (which province physically touches which), not a distance-threshold approximation
— the map pipeline already computes this, for province-to-province checks. Evaluated from
**the searching wing's own nation**, not the province's owner, so a wing based at an allied
airbase correctly treats "my ally borders the enemy" or "my ally borders a neutral" as a
valid border case, since wings can be stationed at allied airbases.

A friendly land division has no province ID of its own (only a raw position), so "is this
division near a border of stance X" cannot reuse the polygon adjacency check directly and
falls back to a distance-threshold approximation instead: a division qualifies if it's within
`BORDER_PROXIMITY_DEG` of a province that itself borders a stance-X neighbor, **or** if it's
physically nearer to stance-X-owned territory than to friendly-owned territory (so a division
that has advanced, or was placed, several provinces deep into hostile land still qualifies —
not just one that's sitting right at the front line).

**Visibility.** "Visible enemy" reuses Detection & Visibility above unchanged — radar
buildings, friendly wings, and land divisions' observation radii all already feed the same
per-nation detection aggregation; this section adds no new detection source, only a
diplomacy-aware (war-stance) query over that existing aggregation.

**Crowd-balancing.** Every tier's candidate search is scored with the Combat Resolution
section's auto-target weighting formula (distance from the wing's current position, penalized
by how many other wings already claim that same target or patrol point) so multiple wings
spread across distinct targets/patrol points by default rather than piling onto one.

**Patrol movement.** "Patrol near/ahead of X" is not continuous formation-following — a wing
picks a patrol center point and orbits it (the existing Loiter mechanic), re-picking the
center as the underlying situation changes. This is intentionally an approximation of
"following," not true pursuit pathfinding.

**Responsiveness and hysteresis.** A wing without an active higher-tier target re-runs its
full search every tick, so it reacts within one tick of a new contact becoming visible — no
separate event system needed, since detection itself already recomputes every tick. To avoid
flip-flopping between near-equal candidates, a wing only abandons its current target/patrol
choice for a **strictly higher-priority tier** result, or when its current choice becomes
invalid (destroyed, no longer visible, or claimed away by a higher-priority wing). Within the
same tier it keeps its current pick.

**Reaching the final "stay at base" tier** does not change the wing's `mission` — it simply
remains `Idle` at its airbase, per Wing Lifecycle above, and the per-tick search
auto-launches it the moment a valid target or patrol condition appears, with no player input.

### Per-mission chains

**Interception**
1. Visible enemy strategic/tactical bombers
2. Visible enemy CAS/dive bombers
3. Visible enemy fighters/heavy fighters (any remaining visible enemy air wing)
4. Patrol over friendly land or naval units near a war- or neutral-stance border (own or
   allied nation's border), least-claimed first — **naval units are not yet implementable**
   (see note below the chains)
5. Patrol over own cities, nearest to home airbase first, least-claimed first
6. Duplicate onto an already-patrolled friendly unit/city if none of the above exist
7. Stay at base if nothing above exists at all

**Air Superiority** — the mirrored priority, same fallback shape:
1. Visible enemy fighters/heavy fighters
2. Visible enemy CAS/dive bombers
3. Visible enemy strategic/tactical bombers
4. Patrol over friendly land and naval units near a war-stance border, least-claimed first
   — **naval units are not yet implementable** (see note below the chains)
5. Patrol over friendly land and naval units near a neutral-stance border, least-claimed
   first — same naval caveat
6. Patrol spread across own cities if no enemy or neutral border exists at all (e.g. a nation
   fully surrounded by allies)
7. Stay at base if nothing above exists

**Tactical Bombing**
1. Visible enemy land units, scored by distance from the wing's current position plus the
   crowd term
2. Patrol over/near friendly land units close to a war-stance border (covering an advancing
   column), within the wing's max range from its home airbase
3. Stay at base if no such units exist within range

**Strategic Bombing (Logistics / Area / Industry / Oil)**
1. Visible enemy targets appropriate to the sub-mission (road segment, city point), scored
   by distance from the wing's current position plus the crowd term
2. Stay at base if no such targets exist (e.g. at peace)

**Naval Missions (Trade Interdiction / Anti-Submarine / Anti-Ship / Port Strike)**
Same shape as Tactical Bombing, applied to naval contacts under the existing fog-of-war
contact-marker rules above — unaffected by this section otherwise.

**Recon**
1. Escort-follow any visible friendly strategic or tactical bomber wing not already
   accompanied by another recon wing (direct following, not a border-patrol orbit)
2. Patrol ahead of a friendly land unit inside or near enemy territory, to give it forward
   vision
3. Patrol near a war-stance border generally (vision-only, no unit to lead)
4. Patrol near a neutral-stance border
5. Stay at base if none of the above exist

**Escort** needs no change here — its assignment logic is defined in full under "Command
Layer — Air Fleets" below and already matches this section's shared crowd-balancing intent
(round-robin spread by escort count).

**Known gap — no friendly naval unit state exists yet.** Interception and Air Superiority's
patrol-fallback tiers are written above as covering "friendly land or naval units," matching
the original design intent, but there is currently no schema representing a positioned,
controllable friendly flotilla anywhere in the game-server — only `NavalContactMarkerState`,
a per-nation fog-of-war contact blip for *enemy* detection, not a friendly unit list. This is
the same underlying gap already tracked in `DEV_PHASES.md`'s Phase 12 checklist (naval bomber
missions stubbed pending Phase 13 flotilla state), but it also blocks half of these two
patrol-fallback tiers specifically, which isn't the same claim as "naval bomber missions
don't resolve yet." Until Phase 13 adds real flotilla state, implementations of this section
should patrol over friendly **land** units only at these tiers; revisit once flotillas exist.

---

## Carrier Integration

Carrier-launched wings use the **same real-time wing system** as land-based wings — the
carrier is a mobile airbase, not a separate control model. `NAVAL_COMBAT.md`'s automated
mission presets (CAP, Strike, Anti-sub, CAS, Logistics Strike, Infra Strike, and now
Area/Industry/Oil) remain the casual-floor default — a player who never opens the air panel
still gets sensible automatic carrier air behaviour — but the same wings are individually
selectable and overridable exactly like land-based wings, for players who want to. See
`NAVAL_COMBAT.md` for the full preset list and naval-specific detail.

---

## Command Layer — Air Fleets

A player groups wings into an **Air Fleet** — a named, persistent grouping of wings that
represents a front or theater, not a unit type. Fleets are deliberately mixed-type (fighters,
bombers, heavy fighters together) because players think in terms of "Eastern Front" not "all
my fighters." Per-wing override is always available; the fleet is a convenience layer, not a
cage.

**Fleet is a grouping container only — it holds no mission state.** Individual wings hold
their own missions, which persist through RTB/refuel cycles automatically (wings re-sortie
without player input). `SET_FLEET_MISSION` is a one-shot batch operation: it assigns the
specified mission to all eligible wings in the fleet right now; ineligible wings receive IDLE.
When a wing is added to a fleet later, it keeps its current mission until the player
explicitly batch-assigns again.

**Escort spread logic (for `SET_FLEET_MISSION` with ESCORT):**
- Heavy fighters → strategic/tactical bombers first; fall back to CAS/dive/naval if none
- Fighters → CAS/dive/naval bombers first; fall back to strategic/tactical if none
- Spread round-robin within each class so no bomber is double-covered while another is open
- Excess heavy fighters (no bomber to escort) → keep current mission
- Excess fighters (no bomber to escort) → AIR_SUPERIORITY

### Fleet Relocation — Deferred (requires airbase levels)

**Feature:** `RELOCATE_FLEET { fleet_id, target_province_id, radius_deg? }` — player selects
a fleet, clicks a target airbase (new front center); system auto-distributes wings across
that base and nearby friendly airbases optimally.

**Design decisions locked in during Phase 12 brainstorming:**

1. **Coverage-based, not ferry-range-based.** For each wing, the question is "from candidate
   base B, can this wing cover target front T?" — not "can this wing ferry from its current
   position to B?" The ferry is handled by the existing REDEPLOY_WING + auto-staging logic.

2. **Wing type range determines placement depth.** Strategic/tactical bombers have long range
   and can operate from bases further behind the front. Fighters need forward basing. The
   distribution should not assign a fighter to a base too far to cover the front, and should
   not waste a forward slot on a bomber that could operate from deeper.

3. **"Nearby" = radius around the clicked airbase.** Candidate bases are all friendly
   provinces with city positions within a calibrated radius of the target. The radius should
   be anchored to typical fighter combat range (shortest-range type sets the zone size).

4. **Airbase level weighting.** Higher-level airbases receive proportionally more wing
   allocations. **Stubbed at uniform weight** until airbase levels are implemented
   (economy buildings phase adds `airbase_level` to ProvinceState, analogous to
   `naval_base_level`).

5. **Load balancing.** Spread wings across candidate bases to avoid congestion; the
   E-patch airbase recovery congestion mechanic already models the cost of over-stacking.

6. **Any owned/allied province with a city position = valid airbase.** No explicit
   `is_airbase` field exists; this matches how `_findNearestFriendlyAirbaseToPoint()` already
   identifies candidate bases.

**Why deferred:** The airbase level weighting (point 4) is the meaningful differentiator
between candidate bases. Without it, the distribution reduces to pure load-balancing, which
is not worth implementing and then reworking. Implement after the economy buildings phase
introduces `airbase_level` on `ProvinceState`.

---

## Server Architecture & Scaling

Wing-as-atomic-unit plus deterministic flight paths means real-time air combat generalises
land's existing dead-reckoning-plus-delta-diff architecture almost for free — bandwidth and
dollar cost stay flat across tested scales (30 to 100 concurrent players, thousands of total
entities across a full game lifecycle), because payload size tracks *state changes*, not
*entity count* or *visual smoothness*. Two concrete implementation notes worth carrying into
the build:

- **Use `StateView`/`@view()` for interest management, not the older `@filter()`/
  `@filterChildren()` named in `NetworkScalingSystem`'s original note** — Colyseus's own docs
  state `@filter()` "is not recommended for fast-paced games," which is exactly the category
  real-time air combat falls into.
- **AOI/interest management should be pulled forward, not left `[LATER]`.** Combined land +
  air + naval entity counts exceed the original ~150-unit trigger well before air is even
  factored in, once realistic player counts and late-game division growth are considered.

---

## Open Questions (To Be Resolved in Playtesting)

### Resolved in implementation (August 2026)

These values were set during Phase 12 implementation and are now in the codebase.
They remain subject to playtesting recalibration but are no longer open design questions.

- **Fuel decay** — transit: 0.012/tick, loiter: 0.008/tick; RTB threshold: 0.10; recovery:
  0.20/tick (~5 ticks to full). Source: `air_wing_lifecycle_system.ts` constants.
- **Combat readiness decay** — 0.003/tick (dev value, slow for testing); floor: 0.15;
  recovery: 0.04/tick. Source: `air_wing_lifecycle_system.ts`.
- **Formation density defence bonus** — saturating mitigation `1 / (1 + densityBonus)` where
  `densityBonus = min(count / 36, 1.0) × 0.4`; cap 36 planes, max bonus 0.4 (~28.6% less
  air-to-air damage at full size). Source: `air_unit_stats.ts`.
- **Airbase recovery congestion** — `congestionFactor = 1 / (1 + max(0, wingsAtBase - 3)
  × 0.15)`; first 3 wings at a base recover at full rate, each additional wing reduces
  recovery multiplicatively (e.g. 6 wings = 0.69×). Source: `air_wing_lifecycle_system.ts`.
- **Naval bomber splash-damage** — 15% splashes to other flotilla members (`SPLASH_PERCENT`).
  Source: `air_naval_bomber_system.ts`.
- **Oil debuff duration** — 120 seconds (`OIL_DEBUFF_DURATION_MS`).
  Source: `air_bombing_stats.ts`.
- **Port strike damage per plane** — 0.1 naval base levels (`PORT_STRIKE_NAVAL_BASE_
  DAMAGE_PER_PLANE`). Source: `air_bombing_stats.ts`.
- **Contact marker quality presets** — MARITIME_PATROL: 0.15° radius, 60s duration,
  refreshable; CARGO_SINKING: 0.8° radius, 20s duration; FLOTILLA_SCOUT: 0.4° radius,
  40s duration. Source: `air_naval_bomber_system.ts`.
- **AA damage coefficient** — 0.05 per unit of province AA strength; low-altitude types
  (CAS, dive bomber, fighter, naval bomber) take 1.5× damage. Source: `air_province_aa_
  system.ts`.
- **Observation range values per aircraft type** — Recon Plane: 1.0°, Heavy Fighter: 0.25°,
  all others: 0.05°. Source: `air_unit_stats.ts` STAT_TABLE.
- **Turn radii and speed** — Fighter: 0.30° turn / 0.00024°/ms; Heavy Fighter: 0.50° /
  0.00021; CAS/Dive/Naval Bomber: 0.30–0.40° / 0.00018; Tactical/Strategic Bomber:
  0.50–0.65° / 0.00016–0.00019; Recon: 0.30° / 0.00019. Source: `air_unit_stats.ts`.
- **Attack/Defense values** — Fighter: 0.25 atk / 0.03 def; Heavy Fighter: 0.22 / 0.05;
  CAS/Dive Bomber: 0.05 / 0.03 (0.15 perked); Tactical/Strategic/Naval Bomber: 0.0 / 0.02;
  Recon: 0.0 / 0.01. Source: `air_unit_stats.ts`.
- **Division-to-border proximity threshold** — `BORDER_PROXIMITY_DEG = 4.0`, tuned against
  `western_europe_6`'s real province-city-marker spacing (median ~2.8°, mean ~3.0°, max
  ~8.4° between adjacent provinces) so it reliably captures a division near the front line
  at real map scale. A division deep inside stance-X territory (well beyond this radius from
  the nearest bordering province) still qualifies via the separate "physically nearer to
  stance-X territory than to friendly territory" rule described in the Border-adjacency
  mechanism above. Source: `air_mission_targeting.ts`.

### Still open (to be resolved in playtesting)

- Fuel decay transit value (0.012/tick current dev setting) — may need adjustment for
  plausible operational ranges on the Western Europe 6 map
- Readiness decay per tick (0.003/tick current dev setting) — intentionally slow for
  testing; real value should make long sorties carry a meaningful combat penalty
- Multi-sortie loiter/cooldown duration (target: 10–20s; current MAX_LOITER_TICKS: 15)
- Weapon-ready/reload cooldown ticks (current: 3)
- Engagement auto-resolve ticks (current: 2)
- RTB and refuel duration ticks (current: 5 each)
- Redeployment/template-change stand-down time (previously 1 minute, flat, same as land —
  confirm this still holds under real-time resolution)
- **Lethality ratio `L` exact value** (shape confirmed: target 0.15–0.35 for a fair,
  mutually-spotted exchange between equal-strength wings)
- **Surprise multiplier `S` exact value** (shape confirmed: target 2.0–3.0×; note `L × S`
  approaching or exceeding 1.0 at the top of the range is intentional, not a bug to fix)
- Defense-value magnitude relative to Attack-value (target: small, ~10–15% of Attack —
  current stat table values range 12–27% for fighter types, 100% for pure bombers with
  zero attack)
- Distance-falloff curve constants for province fixed AA (shape confirmed, numbers pending
  alongside the existing wing distance-penalty curve they're reused from)
- Recon plane's detection-generation rate and how quickly visibility lapses after it leaves
- Pursuit-path recompute interval for interceptors chasing a moving target
- Fighter vs. Heavy Fighter dogfight modifier — a secondary Defense-value cushion on top of
  Heavy Fighter's observation-range advantage, mirroring the historical Bf 110 pattern
  (purpose-built escort, still occasionally out-turned by nimbler single-engine fighters)
- **Wing Sub-Status magnitudes** — Engine speed penalty, Weapons damage-output penalty,
  Fuel tank decay-rate multiplier, Instruments pattern-reach reduction (shape confirmed:
  multiplicative stacking, deterministic trigger-to-status mapping)
- Air Fleet directive vocabulary and auto-assignment heuristic (mirrors the land Army Group
  advance-axis heuristic; exact matching logic from playtesting)
- Wing withdrawal threshold — HP/readiness floor at which a wing auto-RTBs rather than
  fighting to zero, mirroring naval's zone-based withdrawal pattern; manual Retreat always
  available as an override

---

## Out of Scope for This Document

**Exact aircraft variants, research archetypes, and perk trees** (e.g. the German-heavy-
fighter vs. American-drop-tank escort-range archetypes discussed during design) — deferred
until after mechanics are implemented and playtested, per explicit direction for this
rewrite: mechanics before perks.

**Stand-off munitions** (e.g. the German Fritz X / Hs 293 guided glide bombs, historically
used against ships) — real historical precedent exists and a future research perk extending
Naval Bomber's effective attack range is plausible, but explicitly deferred as future work,
not part of this rewrite. Notably, the one documented WWII attempt to use a stand-off glide
bomb (Hs 293) against a land target (bridges, Normandy and the Oder) failed both times —
worth keeping any future version of this perk naval-specific rather than generalising it to
air-to-land.

**Radar and anti-air network building design** (cost, levels, perk tree) — deferred to the
"military buildings" pass flagged in `ECONOMY_BUILDINGS.md`. This document defines only their
functional effect on air combat.

**Rural/point-placed building geography** — if a future map-authoring pass gives buildings
positions distinct from the city point, Industry and Oil bombing's shared-city-point
targeting should be revisited.

---

## Relationship to Other Combat Layers

This design replaces the previous version of this document in full. What changed and why,
for anyone diffing against the old design:

- **Province-assigned, round-resolved wings → individually selectable, real-time, pathfinding
  wings.** The old model matched HoI4's abstraction; the new model is closer to Call of War,
  chosen deliberately over Wargame: Red Dragon's real-time-twitch model specifically because
  Call of War proves the same "individual entities, real-time simulation, zero required
  per-tick input" pattern this game already uses for naval flotillas.
- **3×5 internal wing grid → homogeneous wings.** Composition depth moved from "what's in
  this wing" to "which mission, which target, how well do you manage range and readiness
  across many wings" — the same floor/ceiling shift naval already made by dropping a grid in
  favour of flotilla-composition choices.
- **Abstract detection-proportional air-to-air damage → physical contact plus the Attack/
  Defense model.** Detection now gates *whether a path can be generated toward a target at
  all*, not a damage multiplier layered on top of an abstract "both wings are in this
  province" assumption.
