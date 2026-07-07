# Grand Strategy Multiplayer — Air Combat Design

> Confirmed design decisions for the air combat layer.
> Last updated: July 2026.
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

**Interception targeting priority:** an Interception wing prefers bomber-class targets
(Strategic Bomber, Tactical Bomber, CAS Plane, Dive Bomber) — wings whose primary purpose
is hitting the ground. If no bomber-class target is detected, it will engage whatever enemy
is present. This lets interceptors behave sensibly in mixed engagements without needing
manual retasking.

**Air Superiority targeting priority:** an Air Superiority wing prefers fighter-class targets
(Fighter, Heavy Fighter) — wings whose primary purpose is air-to-air combat. If no
fighter-class target is detected, it will engage whatever enemy is present. Fighter and Heavy
Fighter are distinct unit types with different performance envelopes and separate research
perk trees; Air Superiority treats both as equal-priority fighter-class targets.

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
strategic-bomber missions by design (longer range, lower readiness decay); standard Fighter
is not hard-blocked from Escort, but its shorter range and faster readiness decay make it
naturally unsuited to deep escort and well suited to short-range tactical escort near the
front — the readiness/range mechanic above does this gating for free, matching the real
history of short-ranged fighters failing at deep escort (the Bf 109 over Britain, ~10 minutes
loiter time before having to turn back) without needing a hardcoded rule. A future
drop-tank-style research perk is one plausible way Fighter later reaches deep-escort
viability; a Heavy-Fighter-style archetype is the other route (slower, worse in a straight
dogfight against enemy Fighters, but long-ranged from the start, mirroring the historical
Bf 110) — research specifics are deferred, per this document's scope (mechanics before
perks).

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

**Attack vs. Defense — one rule covers bombers, fighters, and the reload-vulnerability case:**

```
damage_dealt_this_tick = weapon_ready ? Attack_value : Defense_value
```

Every wing has an Attack-vs-air value (its main offensive punch, gated by weapon-ready/
reload cooldown) and a small, always-available Defense-vs-air value (passive return fire —
tail gunner, deflection shot). A pure bomber simply has `Attack_vs_air = 0` — a data value,
not a special-cased code path, the same pattern `TACTICAL_COMBAT.md` already uses for AA guns
having no ground-attack role.

- **Two fresh fighters dogfighting:** both weapons ready → both deal full Attack
  simultaneously.
- **Fighter caught mid-reload:** falls into the Defense branch — still dangerous to attack,
  just far less so. Catching a reloading wing is good play, not a free kill; there's no
  zero-counterplay outcome.
- **Bombers:** always in the Defense branch against fighters, no special logic needed.

**Target deconfliction.** When multiple friendly wings could each independently pick the same
"best" enemy target, greedy unique-target assignment prevents pile-ups: sort engaged
friendlies, each claims its highest-scoring **still-unclaimed** enemy contact, removing it
from the pool. If attackers outnumber targets, overflow doubles up on the highest-value
remaining target rather than sitting idle. Cheap (O(n log n)), no new infrastructure.

**Auto-target weighting** (for Tactical bombing / CAS-style ground attack with no manually
selected target): utility score = `base_priority(target_type, mission) × distance_falloff(from
base) + noise_floor`. The noise floor matters for the same reason the old detection formula
kept a 5% minimum — a purely greedy nearest-target algorithm is predictable and gameable.

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

Extends `STRATEGIC_COMBAT.md`'s existing Macro/Micro command layer (originally land-only) to
air: a player groups wings into an **Air Fleet** and issues it a strategic directive ("hold
air superiority over this front," "interdict this supply network"); the system auto-assigns
individual wings to fulfil it, the same division of labour as an Army Group's advance axis.
Per-wing override is always available and never required — this is the actual answer to
commanding a late-game air force of dozens of wings without it becoming a second job, and it
reuses a pattern this game has already validated for land rather than inventing new command
UX for air specifically.

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

- Fuel decay rate while airborne and its RTB threshold (current: 0.065/tick, threshold 0.10)
- Fuel recovery rate at base (current: 0.20/tick, ~5 ticks to full)
- Combat readiness decay rate while airborne (current: 0.015/tick, much slower than fuel)
- Combat readiness floor (never zero; current: 0.15) and recovery rate (current: 0.04/tick)
- Multi-sortie loiter/cooldown duration (target: 10–20s)
- Redeployment/template-change stand-down time (previously 1 minute, flat, same as land —
  confirm this still holds under real-time resolution)
- Defense-value magnitude relative to Attack-value (target: small, ~10–15% of Attack — enough
  that catching a reloading wing is still clearly correct play, not enough to be a free kill)
- Weapon-ready/reload cooldown duration per aircraft type
- Distance-falloff curve constants for province fixed AA (shape confirmed, numbers pending
  alongside the existing wing distance-penalty curve they're reused from)
- Naval bomber splash-damage percentage and falloff by ship proximity within the flotilla
- Contact-marker radius and duration per detection source quality (maritime patrol vs.
  triangulated sinking-event contact vs. own-flotilla scouting)
- Recon plane's detection-generation rate and how quickly visibility lapses after it leaves
- Pursuit-path recompute interval for interceptors chasing a moving target
- Fighter vs. Heavy Fighter dogfight modifier (Heavy Fighter's proposed vulnerability in a
  straight dogfight against standard Fighters, mirroring the historical Bf 110 pattern)
- Air Fleet directive vocabulary and auto-assignment heuristic (mirrors the land Army Group
  advance-axis heuristic; exact matching logic from playtesting)
- Wing withdrawal threshold — HP/readiness floor at which a wing auto-RTBs rather than
  fighting to zero, mirroring naval's zone-based withdrawal pattern; manual Retreat always
  available as an override
- Airbase capacity — whether airbase level caps simultaneous stationed wings and/or governs
  refuel/rearm speed, mirroring naval base level's role for ship repair

---

## Out of Scope for This Document

**Exact aircraft variants, research archetypes, and perk trees** (e.g. the German-heavy-
fighter vs. American-drop-tank escort-range archetypes discussed during design) — deferred
until after mechanics are implemented and playtested, per explicit direction for this
rewrite: mechanics before perks.

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
