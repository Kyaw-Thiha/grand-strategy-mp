# Grand Strategy Multiplayer — Naval Combat Design

> Confirmed design decisions for the naval combat layer.
> Last updated: July 2026 — carrier aircraft and flotilla AA sections updated to match
> AIR_COMBAT.md's real-time wing redesign (see those sections for what changed).
> Naval combat interacts with the strategic supply system (see STRATEGIC_COMBAT.md),
> air combat (see AIR_COMBAT.md), and the research/refit system (this document).

---

## Design Philosophy

Naval is the slowest-moving, highest-stakes layer of the game. In a 1-hour small map session,
naval may be largely a background threat — convoy raiding and supply interdiction. In a 4-hour
large map session with Mediterranean or Atlantic theatres, naval becomes a decisive strategic
layer that can determine whether land campaigns are even possible.

Naval combat is designed around three principles:

**Deliberate commitment.** Entering deeper engagement zones is a choice made through movement,
not a button. Players who close distance accept the consequences of a deeper engagement.

**Fog of war.** The ocean is fully opaque. Enemy fleet positions are invisible until contact
icons appear. Intelligence — maritime patrol aircraft, cargo sinking events, submarine reports
— is genuinely valuable rather than a secondary stat.

**Individual ship significance.** Ships are few, expensive, and slow to replace within a
session. Losing a battleship matters. The refit system reflects this — ships are upgraded
individually and deliberately, not automatically.

---

## The Flotilla

The flotilla is the atomic naval unit on the strategic map, equivalent to the land division.
Each flotilla is represented as a dot on the strategic map with concentric engagement rings.

**Flotilla size is variable.** Players decide how many ships to put in each flotilla, subject
to a maximum of 15–20 ships per flotilla (modelling real logistical limits on concentrating
a fleet). Unlike land divisions which have a fixed 5×5 grid, naval flotillas have no fixed
size. The interesting decisions are about how to distribute your total navy across multiple
flotillas — not about filling a grid.

A naval nation like Britain or Japan might run three flotillas simultaneously: one hunting
submarines on Atlantic convoy routes, one doing carrier operations in the Mediterranean, one
guarding home waters. A land nation like Germany might have one small surface action group
and rely primarily on submarines. Both are valid. The flotilla count is limited not by a cap
but by the player's total ship production — each flotilla is one strategic commitment that
cannot be in two places at once.

**No grid for naval.** The class matchup system (see Zone Combat Rules below) handles all
interactions. Ship interactions are about class composition and weapon range, not spatial
arrangement within the flotilla. A 5×5 grid would imply positional decisions that don't
meaningfully apply to 10–15 ships in open water.

---

## Ship Classes

Ten base ship classes. Each has a distinct role, a primary engagement zone, and a module
refit system (see Research and Refit).

### Submarines

**Ocean-going submarine**
- Long range, heavy torpedo load, designed for open-ocean convoy raiding and fleet operations
- Operates in all zones but most effective in Screen zone — high stealth, random engagement
- The standard commerce-raider and fleet-hunter
- Two modes: Active (raider) and Silent (stalker) — see Submarine System

**Coastal submarine**
- Smaller, shallower draft, optimised for restricted coastal and inland sea operations
  (North Sea, Baltic, Mediterranean)
- Shorter range and fewer torpedoes than ocean-going type
- Higher stealth value in coastal provinces and shallow sea zones — harder to detect near
  coastlines even for ASW-equipped destroyers
- Cannot sustain extended open-ocean patrols; less effective in Screen zone of deep-water
  engagements
- The cheaper volume unit for nations that need submarine presence but cannot afford full
  ocean-going fleet submarines

*Midget submarines are out of scope for base design. Too niche for 1–4 hour sessions —
deferred to a later module if harbour-penetration mechanics are ever designed.*

### Destroyers

**Fleet destroyer**
- High speed, torpedo-heavy, effective in all three zones
- The premium destroyer: expensive, powerful, genuinely flexible
- Primary fleet screening role at Strike range (protecting capital ships from submarines)
- Secondary convoy protection role at Screen range when needed
- The split-role unit — the destroyer allocation problem is most acute with fleet destroyers

**Escort destroyer**
- Slower, significantly cheaper, optimised entirely for ASW and convoy protection
- Massively higher ASW contribution per unit at Screen zone than fleet destroyers (2–3×
  multiplier over fleet destroyers)
- Sonar systems are useless above threshold speed — historically accurate; escort destroyers
  were designed to match convoy speeds, not fleet speeds
- Ineffective in Strike zone engagement — too slow and lightly armed for surface capital ship
  combat
- The correct choice for nations that need convoy protection without the cost of fleet
  destroyers; analogous to the jeep carrier for surface ASW

### Cruisers

**Light cruiser**
- Fast, numerous, optimised for anti-destroyer work, scouting, and fleet screening
- Best AA output per ship of any surface class — rapid-fire secondary batteries
- Good vs destroyers and submarines in Engagement zone
- Primary fleet role: AA coverage for carriers and screening lighter threats
- Cheap enough to build in numbers; a cruiser-heavy flotilla has excellent defensive coverage
  but is outgunned in serious surface engagement against heavy cruisers

**Heavy cruiser**
- Slower and more expensive than light cruisers
- 8-inch guns vs light cruiser's 6-inch: significantly higher damage vs cruisers and moderate
  damage vs capital ships when in numbers
- Historical role was specifically "cruiser-killer" — hunting and destroying enemy cruisers
- Contributes long-range artillery fire in Engagement zone (reduced accuracy, ~20–30% of
  Strike-range output), same principle as battleships
- A heavy-cruiser-heavy flotilla dominates surface engagements but has weaker AA screening

### Capital ships

**Battleship**
- Maximum armour, maximum Strike-zone damage output, slow movement on strategic map
- In Engagement zone: functions as long-range artillery — reduced accuracy, roughly 20–30%
  of Strike-range damage. Historically confirmed: battleships routinely opened fire at extreme
  range (North Cape, Guadalcanal) before decisive close action
- In Strike zone: full effectiveness — devastating vs any target class
- Cannot be effectively engaged by destroyer guns; only other battleships, torpedoes, and
  aircraft deal meaningful damage against battleship armour
- The decisive capital ship; expensive and slow to build

**Battlecruiser**
- Battleship-calibre guns at significantly faster strategic movement speed (larger engagement
  area on the strategic map, faster zone transitions)
- Noticeably thinner armour than battleships — takes meaningfully more HP damage when engaged
  at Strike range
- Historical role: outrun cruisers while outgunning them; force projection across wide
  strategic areas faster than a battleship fleet can respond
- The aggressive offensive player's capital ship: can close to Strike range and disengage
  faster than battleships, making commitment less permanent

### Carriers

**Fleet carrier**
- Large aircraft complement, full mission variety (strike, CAP, anti-submarine, maritime
  patrol, CAS, logistics strike, infrastructure strike)
- Fast enough to match fleet movement in all zones
- At Screen and Engagement range: aircraft operate at full effectiveness; carrier itself
  protected by distance
- At Strike range: carrier becomes a target for enemy surface fire — a deliberate risk decision
- Expensive, slow to build; the decisive offensive naval weapon

**Escort carrier**
- Smaller aircraft complement (~one-third of fleet carrier)
- Too slow to operate in a Strike-zone fleet engagement effectively
- Most effective at Screen and Engagement zones for ASW support, CAP, and convoy protection
- Primary historical role: close the mid-ocean air gap that land-based aircraft could not cover
- Much cheaper and faster to build than fleet carriers
- Fragile — historically nicknamed "Combustible, Vulnerable, Expendable"

### Torpedo boat *(nation-specific, not universally buildable)*

- Small, fast, torpedo-armed coastal craft
- Very cheap and fast to produce
- Deadly against larger ships at close range in Screen zone (torpedoes ignore armour class)
- Extremely fragile — easily destroyed by any surface combatant that can target it
- Screen-zone glass cannon: high torpedo output, near-zero survivability
- Available only to historically relevant nations (Germany, Italy, others); cannot be built
  by nations without the relevant tech/doctrine

---

## Zone Combat Rules — Class Matchup System

Combat resolves via a class matchup table, not a grid. Each ship class fires at preferred
targets simultaneously each round. Zone depth determines which classes participate and at
what effectiveness.

### Screen zone (outermost)

**Who participates:** Destroyers (both types), submarines, escort carrier aircraft, torpedo
boats. Approximately 30–50% of available units in each class fire per round — not all units
engage every round.

**What happens:**
- Fleet and escort destroyers hunt submarines; ASW contribution drives detection accumulation
- Ocean-going submarines attack convoy targets or capital ships (if in Active mode)
- Coastal submarines gain stealth bonus in adjacent coastal zones
- Escort carrier aircraft contribute ASW detection and light strike
- Torpedo boats fire torpedo volleys at any target class within range; high damage on hit,
  low survivability if return fire lands

**Key dynamic:** Cat-and-mouse of submarine vs ASW. Naval recon value determines detection
probability for submarines each round. Without destroyers or maritime patrol aircraft, a
defending flotilla has no meaningful ability to prosecute submarines here.

### Engagement zone (middle)

**Who participates:** All Screen zone classes at full participation (no longer random) plus
cruisers (both types). Battleships and battlecruisers contribute long-range artillery fire at
reduced accuracy (~20–30% of Strike damage).

**What happens:**
- Light cruisers engage enemy destroyers and submarines; AA batteries defend fleet from air
- Heavy cruisers engage enemy cruisers; can threaten capital ships when in numbers
- Battleships/battlecruisers fire at maximum range — enough to matter, not enough to decide
- Fleet carrier aircraft at full effectiveness; carrier hull still protected at this range
- Submarines are increasingly exposed — destroyers have better detection here, pinning more
  likely
- Torpedoes from destroyers and submarines remain the primary threat to capital ships

**Torpedo mechanic:** Any ship class carrying torpedoes (destroyers, submarines, some cruisers)
can fire at any target class. Torpedo hits deal very high HP damage regardless of armour class.
Torpedo reload takes multiple rounds; a destroyer that fires is temporarily defenceless.

### Strike zone (innermost)

**Who participates:** All classes at full effectiveness every round.

**What happens:**
- Battleships and battlecruisers fire at full accuracy; devastating vs any target class
- Battleships: maximum armour, maximum damage — only other battleships, torpedoes, and
  aircraft deal meaningful damage
- Battlecruisers: same gun calibre, faster, but significantly more vulnerable to incoming
  fire — sustained battleship fire will destroy a battlecruiser
- Fleet carriers become targets for enemy surface fire; aircraft still operate
- Escort carriers: too slow to manoeuvre effectively; take heavy damage; should not be sent
  here

---

## Movement as the Engagement Decision

Players do not issue Close or Hold orders as a separate UI element. Engagement zone is
determined entirely by flotilla position on the strategic map.

**Zone transition timing (target values — confirmed by playtesting):**
- Screen → Engagement: ~1 minute of game time
- Engagement → Strike: ~1 additional minute
- Total from first contact to decisive engagement: ~2 minutes

**Speed debuff in inner zones:** Mild debuff in Engagement, significant debuff in Strike.

**Retreat button:** Increased movement speed away from enemy; increased incoming damage
during withdrawal.

**Involuntary deepening:** A flotilla holding position while the enemy closes is dragged into
deeper zones involuntarily. Staying still is not a neutral choice.

**Default first contact:** Screen range. Decisive action requires active closing.

---

## Ship Class Posture Within the Flotilla

When a flotilla is in an active engagement or blockade, the player can set each ship class's
**posture** independently via the flotilla panel:

**Active** — class participates in the current zone's combat or blockade duties as normal.

**Held back** — class pulls to the rear of the formation, outside effective coastal battery
range and away from direct engagement. Does not contribute to blockade income disruption but
does not take battery or enemy fire either.

This is the primary mechanism for managing the destroyer allocation problem during combined
operations: a player can hold some destroyers in Strike-range screening posture while others
are in Active Screen-range blockade posture. A player losing too many destroyers to coastal
battery attrition can switch them to Held Back — trading blockade effectiveness for ship
preservation.

---

## Flotilla AA Defence Against Air Attack

> Referenced from AIR_COMBAT.md's AA Interaction section as one of three distinct AA layers
> in the game (division-grid AA, province fixed AA, and this one). Full mechanic lives here;
> AIR_COMBAT.md only summarises it.

AA damage against an attacking air wing (Naval Strike, or a carrier's own Strike/CAS wings
returning enemy fire) is **pooled across every AA-capable ship currently in the target
flotilla** — not just whichever ship the attacker happens to be aiming at. Light cruisers
contribute the most per ship ("best AA output per ship of any surface class... primary
fleet role: AA coverage for carriers" — see Cruisers above); other classes contribute a
smaller amount each, rather than zero, so a flotilla's total AA output scales with its full
composition, not just its cruiser count in isolation.

**This mirrors real carrier task force doctrine.** The standard formation was a literal
circular screen — carriers at the centre, cruisers and destroyers ringed around them
specifically so each ship's AA fire covered the others in company. The payoff was real: at
the Battle of the Philippine Sea (1944), coordinated fleet AA plus fighter defence destroyed
over 90% of a 450-plane Japanese strike. A pooled, escort-weighted AA mechanic is the
historically accurate outcome, not a simplification of one.

**Held Back posture excludes a ship class from the pool.** A ship class pulled to the rear
(see Ship Class Posture above) is out of formation and does not contribute AA coverage,
consistent with the same posture toggle already gating whether that class takes battery fire
or contributes to blockade duties.

**Resolution timing:** a single pooled-AA check at the moment the attacking wing executes its
attack run — not a continuous per-tick drain. Same framing as land CAS being "exposed to
enemy AA guns during this attack" in AIR_COMBAT.md; one roll per pass, using the pooled
value.

**In-port ships remain a special case:** per Air-Naval Integration below, ships in port have
no zone-based *or* pooled-AA defence — fully exposed. The pooling mechanic only applies to a
flotilla at sea.

---

## Submarine System

Submarines have two modes, toggled by the player on the strategic map.

### Active (raider) mode
- Attacks convoys and targets of opportunity in current zone
- Generates cargo ship sinking events (see Trade and Convoy System) — the defending player
  receives location intelligence from sinking notifications
- Full damage output
- Higher detection signature — ASW destroyers and maritime patrol aircraft locate more easily

### Silent (stalker) mode
- Holds all fire — no attacks, no sinking events generated
- Reduced detection signature — significantly harder to locate
- Moves submerged toward target area
- Full damage output preserved for when the player switches back to Active

**The strategic choice:** Active mode deals more economic damage per tick but reveals operating
area via sinking notifications. Silent mode is stealthier but the income reduction is diffuse
and harder for the enemy to attribute to a specific location. If a submarine reaches Strike
range undetected and switches to Active, damage to a carrier or battleship is severe.

**Coastal submarine advantage:** In Silent mode adjacent to coastlines, coastal submarines
gain an additional stealth bonus. Shallow water and coastal terrain degrade sonar.

**Submerged speed:** Approximately equal to surface warship crossing speed between zones.
The advantage is stealth, not speed.

### ASW interaction

**Detection accumulation:** Each round, ASW-equipped destroyers within the same zone
contribute to a detection value for that submarine. At threshold detection, the submarine is
pinned — cannot disengage to Silent mode until the detecting destroyer moves away or is sunk.

**Escort destroyer ASW superiority:** Escort destroyers contribute 2–3× more detection per
round than fleet destroyers.

**Maritime patrol aircraft:** Contribute detection each round. Active submarines are
detectable. Silent submarines have reduced but non-zero signature.

**Coastal battery vs submarines:** Coastal batteries fire at surface ships only. A submarine
in Active mode conducting a Screen-range blockade is immune to coastal battery fire. This
makes submarine blockades categorically safer than surface blockades but limits them to
Screen-range disruption percentages — a submarine cannot enforce a full close blockade without
surface ship support.

---

## Carrier Aircraft — Mobile Airbase, Same Wing System as Land

> **Updated July 2026 to match AIR_COMBAT.md's real-time wing redesign.** Carrier aircraft
> are no longer a separate, simpler abstraction — see AIR_COMBAT.md's "Carrier Integration"
> section for the full rationale. A carrier is a **mobile airbase**: its stationed wings are
> ordinary, individually-selectable, real-time wings using exactly the same aircraft types,
> mission set, pathfinding, and combat resolution as land-based air. Nothing below is a
> separate system — it is the casual-floor default layered on top of the same wings.

**Automated presets remain the default control mode.** Players set a mission preset per
carrier; its wings execute it continuously without further input, exactly matching the
"zero required clicks for sensible behaviour" floor AIR_COMBAT.md establishes for land-based
wings. A player who wants finer control can select any carrier-launched wing directly and
override it — retask it, pull it home, hand-pick its target — the same way a land-based wing
can be overridden. Casual and sweaty players get the same underlying system at different
levels of engagement, not two different systems.

**Presets:**

**Combat Air Patrol (CAP):** Fighter/Heavy Fighter wings set to Interception, loitering over
the flotilla by default (reusing AIR_COMBAT.md's default Interception wait-state) rather
than a fixed destination. No offensive output. The defensive default.

**Strike:** Naval bomber wings on Anti-ship, auto-targeting highest-value enemy ships
(capital ships first) per AIR_COMBAT.md's Naval Missions targeting rule. Full offensive
damage. No air defence for own flotilla while wings are away.

**Anti-submarine:** Naval bomber wings on Anti-submarine. Significantly increases naval
detection value each round.

**Close Air Support (CAS):** Wings on Tactical bombing against land divisions in an adjacent
coastal province. Carrier aircraft historically conducted infrastructure strikes (Operations
Meridian, Robson, Lentil against Sumatran oil refineries) as well as tactical ground support.
Damage lands on the land tactical grid using the same patterns as land-based Tactical
bombing (see AIR_COMBAT.md's Damage Patterns). Effective only against coastal provinces
within the flotilla's zone range.

**Logistics Strike:** Wings on Logistics bombing against a coastal province within range.
Historically confirmed — British Pacific Fleet carrier aircraft specifically targeted oil
refineries and supply installations. Reduces road segment throughput for N ticks, same
distance-decayed AA exposure rule as land-based Logistics bombing.

**Area / Industry / Oil Strike:** Wings on the corresponding Strategic bombing sub-mission
against a coastal city within range — full province-fixed-AA exposure, same as land-based
strikes on these targets (see AIR_COMBAT.md's Strategic Bombing and AA Interaction
sections). Newly in scope for carriers as part of this update; previously only CAS and
Logistics/Infrastructure Strike were confirmed.

**AA defence from cruisers:** Ships in the target flotilla with AA armament (light cruisers
especially) deal damage to attacking wings proportional to AA ship count — the pooled,
cruiser-weighted mechanic now fully specified in AA Interaction below. A cruiser-heavy
flotilla is significantly harder to strike than a battleship-heavy one.

---

## Fog of War — Naval Layer

**The ocean is opaque.** The sea provides no baseline visibility of enemy forces.

A player **cannot** see:
- Enemy flotilla positions on the strategic map
- Enemy flotilla composition
- Which zone an enemy flotilla occupies
- Whether an enemy submarine is in Active or Silent mode

A player **can** see:
- Combat icons at contact positions (Screen skirmish / Engagement / Strike)
- Cargo ship sinking events — notifications with approximate sea zone location, providing
  intelligence about where enemy submarines are operating
- Trade route disruption notifications — income reduction begins immediately when threat
  conditions are met, before the first sinking event fires
- Maritime patrol aircraft revealing approximate enemy flotilla positions within patrolled
  zones

**Trade route visibility:**
- Own trade routes always visible to both trading parties
- Enemy trade routes: visible only within observation radius of the route (maritime patrol
  aircraft, nearby flotillas reveal routes passing through patrolled sea zones)
- Exception: active diplomatic trade pacts — both parties can see their shared route
  regardless of observation

**Intelligence from sinking events:** Each cargo sinking notification fires with approximate
sea zone location. Multiple sinkings in the same zone over several ticks allows the defending
player to triangulate enemy submarine operating area — even without maritime patrol aircraft.
This is the primary intelligence mechanism for the ocean fog of war layer.

---

## Trade and Port Economy

### Port development tracks

Each port in a province has three **independent** upgrade tracks, each built and levelled
separately with production resources:

**Port level** — governs passive trade income per tick and trade route throughput capacity.
Higher levels generate more passive income and can sustain higher-volume resource trades.
Multiple ports in the same province each have their own port level — a province with two
ports can have one developed into a major trading hub while the other remains basic.

**Naval base level** — governs ship refit speed, repair speed, repair capacity, and
new ship construction throughput. The three functions share the same base capacity pool:

- **Repair rate:** damaged ships recover HP at a rate proportional to naval base level.
  A level 1 base repairs slowly; a max-level base repairs quickly
- **Repair capacity:** the number of ships that can be repaired simultaneously equals
  the naval base level. A level 3 base can repair 3 ships at once; additional damaged
  ships queue and wait
- **Construction interaction:** repair and new ship construction share the same base
  capacity. When repair slots are occupied, new ship construction slows proportionally
  or stops temporarily if all slots are full. A player who takes heavy fleet damage must
  choose: accept slow reconstruction while repairing, or queue construction and repair
  only after new ships are built. This creates meaningful strategic tension between fleet
  recovery and fleet expansion after a major engagement
- **Refit capacity:** ship refitting also competes for the same slots as repair.
  Repair takes priority over refit when a ship arrives damaged at port
- **HP damage reduction for docked ships:** higher naval base level provides damage
  reduction to ships docked at that port during enemy port strikes. At level 1: ~10–15%
  reduction. At maximum level: ~40–50% reduction. Hardened dry docks and shore AA
  batteries model this. Ships underway receive no port protection

**Supply base level** — acts as a supply hub for nearby land units, identical in function
to the inland supply hub building. Generates supply flow into the road network from the port
node outward. Separate from port level and naval base level. A player can develop a port
primarily as a forward supply hub for coastal land campaigns without investing in trade
income at all.

**Multiple ports in a province:** Each port is upgraded independently. There is no
province-wide upgrade that applies to all ports simultaneously. Players choose which ports
to invest in. A province with two well-developed ports is harder to fully blockade (requires
covering both port sea zones) and provides more defensive coverage via multiple coastal
batteries.

### Coastal battery and fort

**Coastal battery** — a dedicated building constructed in a port province. Fires at any
enemy surface flotilla whose engagement rings overlap that port's sea zone at any zone level
(Screen, Engagement, or Strike). Also fires during blockade.

Coastal battery does **not** fire at submarines. Surface guns cannot engage submerged
submarines. A submarine conducting a Screen-range blockade in Active mode is immune to
coastal battery fire, though it generates combat icons and ASW detection.

Damage output scales with battery level:
- Against destroyers and light cruisers: meaningful damage per tick — a destroyer squadron
  without capital ship escort takes real attrition
- Against heavy cruisers and battlecruisers: reduced but noticeable
- Against battleships: very low damage — a battleship at Strike range can absorb battery
  fire while conducting bombardment, but not indefinitely

Design intent: coastal defences favour naval players over shore players. Coastal batteries
are a deterrent and force-multiplier, not a standalone denial system. They make blockades
and bombardments non-trivial without being capable of stopping a committed fleet.

**Fort** — a separate building that reduces bombardment damage received by the coastal
battery. Without a fort, sustained battleship bombardment degrades the coastal battery's
HP directly. With a fort, battery HP loss per bombardment round is heavily reduced, requiring
either a much longer naval campaign or a land assault to neutralise it. The fort represents
hardened casemate construction of the entire coastal defensive zone. One fort per province
(not per port) — it protects all coastal batteries in the province.

Forts also make the coastal battery harder to destroy via land-based air strikes (infra
strike damage to the battery building is reduced), modelling dispersed, buried fortifications.

### Trade routes

**Default diplomatic trade:**
When two players form a trade pact (via the PROPOSE_DIPLO system), each player independently
chooses which of their ports to designate for that trade. The player draws a trade route line
from their chosen port to the partner's port on the map. Trade income generated per tick is
proportional to the product of both designated port levels. The chosen port does not have to
be the highest-level one — the player may prefer a strategically positioned port even at some
income cost.

One default trade pact per nation pair. Breaking the alliance or trade pact breaks the route.

**Resource trade:**
Players explicitly exchange specific resources through the port network. The player chooses
which of their ports to route from (not forced to use the highest-level one), then draws a
route line to the target port. Resources flow along that route each tick. Both players agree
to terms (rates, duration). A player routing all resource trade through one port creates a
single point of failure; spreading across multiple ports adds resilience but may use
lower-level ports.

**Trade route length effect:** Longer routes generate reduced income/flow per tick.
Longer routes also have more sea zones for enemy submarines to operate in. Exact decay
curve confirmed by playtesting (target: meaningful reduction but not punitive for
realistically sized maps).

**Drawing trade routes:** Both trade types are drawn manually by the player on the map —
selecting their port, then clicking the partner's port. The route line renders on the map
as a visible trade lane (similar to supply road visualisation). This makes trade tangible:
players can see their income lanes and understand immediately when those lanes are threatened.

---

## Blockade System

### Blockade tiers

**Screen range overlapping a trade route mid-ocean (not the port node):**
- 20–30% trade income and flow reduction
- Cargo sinking events fire probabilistically — some ships get through, some are sunk
- Defending player receives sinking notifications with sea zone location

**Screen range overlapping a port's sea zone directly:**
- 50–70% trade income and flow reduction (higher than mid-ocean — all cargo must pass
  through the blockading force to enter or leave the port)
- Coastal battery fires at surface blockading ships each tick
- Submarines in Active mode are immune to coastal battery fire but generate sinking events

**Engagement range or deeper at the port (full blockade):**
- 100% trade income disruption — no cargo ships can pass
- Port passive income drops to zero
- All trade routes through the sea zone are cut entirely
- Supply base deactivated — supply hub goes offline; nearby land divisions begin
  out-of-supply attrition
- Coastal battery fires at full rate; fort reduces bombardment damage to battery

Port's naval base shielding applies only to **docked ships** — ships underway conducting
the blockade receive no port protection.

### Naval bombardment

**Cruiser bombardment (Engagement range):**
When a flotilla's Engagement ring overlaps a coastal province, cruisers can bombard. Deals
HP damage to buildings in the province. Destroyers contribute suppression fire — deals
suppression to land divisions in the province (same effect as an MG unit in tactical
combat) rather than building HP damage. Historically destroyers provided "drenching fire"
to suppress defenders during approaches, not to destroy hardened positions.

**Battleship bombardment (Strike range only):**
Requires the flotilla to close to Strike range. Only coastal provinces are in range — inland
provinces are out of reach even for 16-inch guns. Battleships deal significantly higher HP
damage to buildings and fortifications. Historically confirmed: "a heavily protected battery
will not be effectively neutralised unless it receives a direct hit from a 15-inch shell."
In game terms: fort buildings can only be meaningfully degraded by battleship bombardment,
not cruiser fire. Cruisers suppress and damage buildings; battleships break fortifications.

Coastal battery return fire applies at full rate during Strike-range bombardment. The
attacking fleet must either destroy the battery (targeting it with bombardment) or accept
ongoing HP attrition to its ships. A province with both a coastal battery and a fort requires
a sustained, dedicated bombardment campaign before landings become safe.

---

## Trade and Convoy Supply Simulation

### Flow-based simulation with discrete interception events

Naval supply and trade uses the same graph flow model as land supply — throughput values on
sea zone nodes, income rates per tick. The simulation under the hood is continuous flow math.

**The presentation layer uses discrete interception events** to make the fog of war
meaningful and give players actionable intelligence:

Each trade route has a cargo throughput value. Each tick, the system checks threat conditions
in each sea zone the route passes through. When threat conditions trigger an interception
(probabilistic — higher threat level and Active-mode submarines increase the chance per
tick), a **cargo ship sinking event** fires:

- Sinking notification to the owning player: "Cargo ship sunk — [sea zone name]"
- Flow reduction on that route for N ticks (the lost shipment)
- A visual combat icon at the interception location (brief — disappears after the event)
- Slight increase in enemy naval detection in that sea zone for the defending player
  (wreckage and distress signals — the intelligence value of knowing where ships are sunk)

**Income reduction timing:** Flow reduction begins immediately when threat conditions are
met — before the first sinking event fires. A UI indicator shows "Trade route disrupted —
[sea zone]" as soon as reduction starts. Casual players understand their income is affected
without needing to see sinking events. Sinking events layer on top as additional intelligence.

**Silent mode behaviour:** A submarine in Silent mode does not generate sinking events. The
defending player's income still drops (the submarine's presence creates threat conditions and
reduces flow) but they receive no location intelligence — no sinking notifications, no combat
icons. This makes Active vs Silent mode a meaningful trade: Active deals more damage per tick
but reveals operating area; Silent is stealthier but the income reduction is diffuse and
harder to attribute.

---

## Naval Zone Lethality and Damage-Repair System

### Design principle

Naval combat is about cumulative damage leading to forced withdrawal and repair, not
instant destruction per engagement. Ships are individually significant — a destroyer that
survives a torpedoing and limps back to port is a meaningful outcome, not a game failure.
Only the Strike zone produces the sustained lethal combat where ships fight to destruction.

### Screen zone lethality

Skirmishing at extreme range. The majority of fire is inconclusive.

**Submarines:**
- If Active mode and **undetected**: fires freely at convoy targets or capital ships;
  takes minimal return fire (depth charges are probabilistic, rarely fatal on first pass);
  chip damage only to the submarine
- If Active mode and **detected + pinned by ASW destroyer**: forced toward the surface;
  exposed to destroyer gunfire; **high lethality** — a pinned submarine can be destroyed
  in the Screen zone. This is the primary submarine destruction mechanic
- If Silent mode: takes no damage regardless of proximity — enemy cannot engage what they
  cannot find

**Destroyers and light surface ships:**
- Low lethality vs each other at Screen range — long-range gunnery and torpedo shots are
  mostly inconclusive in random 30–50% participation rounds
- Primary risk: torpedo hit from a submarine that gets a shot off before being detected.
  A torpedo hit in Screen zone forces the destroyer to withdraw to port for repair

**Larger surface ships (cruisers and above):**
- Not typically engaged at Screen range — they do not participate in Screen zone firing
  unless the engagement deepens. Screen range damage to capital ships is near-zero

**Outcome:** Most Screen zone engagements result in damaged ships withdrawing to port for
automatic repair. Destruction is rare except for submarines that are detected and pinned.

### Engagement zone lethality

Moderate lethality — damage accumulates meaningfully over rounds.

**Cruisers vs cruisers:** Accurate medium-range gunnery causes real structural damage each
round. Over several rounds, the losing side accumulates enough damage to trigger withdrawal.
Rarely destroyed in a single engagement unless hopelessly outmatched.

**Destroyers:** Higher risk here than in Screen zone — now exposed to accurate cruiser fire.
A destroyer that fires its torpedoes and misses is briefly defenceless against cruiser
return fire. Destroyers can be destroyed in the Engagement zone, but usually withdraw
when HP drops to a threshold before that point.

**Submarines:** Increasingly exposed at Engagement range. Higher ASW detection from
destroyers, and now also within range of cruiser weapons if surfaced. A submarine forced
to the surface in the Engagement zone is in significant danger.

**Battleships (long-range artillery role):** Deal 20–30% of their Strike-range output.
Can cause meaningful damage to enemy cruisers over many rounds but rarely decisive alone.

**Outcome:** Damaged ships withdraw to port for automatic repair. Destruction more likely
than in Screen zone, especially for destroyers and submarines.

### Strike zone lethality

Decisive action. All ships fight to the end.

**No withdrawal from Strike zone during combat.** Once in Strike range, damaged ships
fight on with debuffs rather than withdrawing:
- Reduced accuracy (damaged fire control systems)
- Reduced torpedo capacity (damaged launchers)
- Reduced movement speed within the zone (damaged engines — relevant for zone transition
  if the player attempts to disengage)

Ships are destroyed only when HP reaches zero. This is the zone where fleet actions are
decided. The commitment cost is high — entering Strike range means accepting casualties,
not just damage.

**Battleships at full effectiveness:** Devastating against any target. High HP, high armour —
only other battleships, torpedoes, and aircraft cause meaningful damage. A battleship in
Strike range of a cruiser force without its own capital ship escorts will destroy the
cruisers but the cruisers' torpedoes may still inflict serious damage in return.

**Carriers exposed:** The carrier hull becomes a target for enemy surface fire. Aircraft
still operate but the carrier itself accumulates HP damage. A destroyed carrier loses its
aircraft complement — the most costly single loss possible in a fleet engagement.

### Automatic repair

When a ship withdraws from combat (Screen or Engagement zone) or when an engagement ends
with the ship still afloat, it automatically begins repair when it returns to a friendly
port:

- **Repair rate:** proportional to naval base level at the port
- **Repair capacity:** number of ships repaired simultaneously = naval base level
  (additional ships queue)
- **Construction competition:** repair slots are shared with new ship construction.
  Ships queue for repair before construction resumes. A player who takes heavy fleet damage
  must choose between fleet recovery (repair) and fleet expansion (construction)
- **Refit competition:** repair takes priority over refit. A damaged ship arriving at
  port jumps the refit queue
- **Automatic return to fleet:** once repaired to full HP, the ship automatically rejoins
  its assigned flotilla. No player action required

**Notification:** "Ship repaired — [name] — rejoining [flotilla name]"

---

## Research and Refit System

### Philosophy

A new module unlocking via research does not automatically improve all ships of that type —
it makes the upgrade available. The player must choose to refit specific ships.

### Module slots per class

Each ship class has 3–5 refit slots. Slots are filled with module variants unlocked through
the research tree. Module variants represent specialisation choices, not just stat upgrades.

**Example destroyer slots:**
- Torpedo slot: standard torpedo upgrade (better pen vs cruisers) OR long-range torpedo
  (longer range, slower speed — models the Japanese Type 93 Long Lance)
- ASW slot: sonar upgrade (better detection accumulation) OR depth charge upgrade (faster
  submarine HP damage once detected)
- AA slot: light AA upgrade OR fire control upgrade (improves AA accuracy)
- Speed slot: engine upgrade (faster zone transitions on strategic map)

**Example battleship slots:**
- Main battery slot: gun calibre upgrade OR fire control upgrade (accuracy improvement)
- Armour slot: belt armour upgrade OR deck armour upgrade (deck armour resists air attack;
  belt armour resists surface gunfire)
- AA suite slot: AA battery upgrade OR radar upgrade (improves detection contribution)
- Speed slot: engine refit (expensive, rare — models the fast battleship concept)

### Research tree structure

Naval modules unlock in the same unified research tree as land and air units. Unlocking a
module makes it available for refit — it does not apply it.

### Refit queue — streamlined, not micro-heavy

**Doctrine templates per class:** Default module loadout set at the class level. New ships
arrive from construction already fitted to doctrine.

**Bulk doctrine push:** "Apply doctrine to all [class]" queues all ships of that class for
refit. Resource cost paid in one lump sum. Ships at sea join the queue and refit when they
next return to port.

**Individual override (sweaty option):** Specific ship can have non-doctrine loadout set
via ship detail panel. Casuals never need this.

**Refit duration:** Flat ~1–2 minutes per ship at port. Queue runs passively; notification
fires on completion.

**Refit availability:** Only in port or Screen zone of a friendly coastal province. Ships in
active Engagement or Strike range cannot refit.

---

## Naval Notification System

Notifications (toast system):
- "Enemy contact — Screen range — [sea zone name]"
- "Enemy closing — Engagement range — [sea zone name]" (moderate urgency)
- "Enemy at Strike range — [sea zone name]" (high urgency)
- "Cargo ship sunk — [sea zone name]" (trade intelligence)
- "Trade route disrupted — [sea zone name]" (income reduction started)
- "Trade route cut — [sea zone name]" (full blockade — 100% disruption)
- "Port blockaded — [port name]" (supply base deactivated)
- "Port blockade lifted — [port name]" (supply resumes)
- "Submarine detected — [sea zone name]"
- "Flotilla retreating — [name]"
- "Flotilla lost — [name]"
- "Refit complete — [N] [class] ships updated"
- "Research complete — [module name] available for refit"

---

## Air-Naval Integration

### Carrier aircraft
See Carrier Aircraft — Mobile Airbase, Same Wing System as Land above for the full preset
list, including Area/Industry/Oil strike now confirmed in scope for carriers.

### Land-based air wing naval missions
**Port strike:** Targets ships in port. Anchored ships have no zone-based **or pooled-AA**
defence — fully exposed to air attack. Naval base level reduces damage to docked ships. Most
efficient way to damage capital ships without a naval engagement.

**Naval strike:** Targets a flotilla at sea, flown by Naval bomber wings on the Anti-ship
mission. Full targeting, detection, and damage-shape mechanics (fuzzy contact markers, the
highest-value-first auto-priority, single/splash/multi-sortie damage) are defined in
AIR_COMBAT.md's Naval Missions section — this entry is a pointer, not a duplicate. Ships can
manoeuvre and use the pooled AA defence defined above.

### Submarine vs maritime patrol
Maritime patrol wings over a sea zone increase submarine detection each round. Active
submarines detectable. Silent submarines have reduced but non-zero detection signature.

---

## Open Questions (To Be Resolved in Playtesting)

- Exact zone transition timings (target: 1 min Screen→Engagement, 1 min Engagement→Strike)
- Percentage of Screen-zone units that randomly engage each round (target: 30–50%)
- Speed debuff magnitude in Engagement and Strike zones
- Retreat speed bonus vs incoming damage increase ratio
- ASW detection accumulation rate per destroyer type per round; threshold for pinning
- Maritime patrol detection rate for Active vs Silent submarines
- Battleship and heavy cruiser long-range artillery damage fraction in Engagement zone
  (target: 20–30% of Strike-range output)
- Torpedo reload duration (number of rounds between volleys per ship)
- HP withdrawal threshold in Engagement zone before ship auto-retreats to port
  (distinct from Strike zone where ships fight to zero HP)
- Repair rate per naval base level (target: level 1 repairs slowly over ~5-10min
  of game time; max level repairs in ~1-2min)
- Construction slowdown formula when repair slots occupied (proportional reduction
  vs full stop — proportional is more nuanced; full stop is simpler)
- Strike zone combat debuff values for damaged ships (accuracy reduction,
  torpedo capacity reduction, speed reduction)
- Maximum flotilla size (target: 15–20 ships)
- Refit duration per ship at port (target: 1–2 minutes)
- Coastal submarine stealth bonus magnitude vs ocean-going
- Escort destroyer ASW contribution multiplier vs fleet destroyer (target: 2–3×)
- Torpedo boat HP and torpedo damage values
- Cargo sinking event probability per tick per threat level tier
- Trade route length income decay curve
- Coastal battery damage values per ship class tier
- Naval base level HP reduction percentages (target: ~10–15% at level 1, ~40–50% at max)
- Blockade disruption percentages: mid-ocean Screen (~20–30%), port-mouth Screen (~50–70%),
  full Engagement blockade (100%)
- Fort damage reduction multiplier for coastal battery bombardment HP loss

---

## Out of Scope for This Document

**Amphibious assault** — later module. Shore bombardment is now partially in scope (see
Naval Bombardment above); full amphibious landing mechanics (troop transport, beach assault,
landing craft) are deferred.

**Mine warfare** — not currently designed. Minelayer and minesweeper classes deferred.

**Midget submarines** — deferred.

**Torpedo boats for non-historical nations** — which nations receive torpedo boat access
is determined when nation rosters are finalised.

**Supply ship / oiler** — no persistent fleet supply mechanics designed. Deferred.
