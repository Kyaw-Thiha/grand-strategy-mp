# Grand Strategy Multiplayer — Naval Combat Design

> Confirmed design decisions for the naval combat layer.
> Last updated: June 2026.
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

## Carrier Aircraft — Automated Mission Presets

Carrier aircraft are automated. Players set a mission preset per carrier; aircraft execute
it every round without further input.

**Presets:**

**Combat Air Patrol (CAP):** Intercept enemy aircraft attacking the flotilla. No offensive
output. The defensive default.

**Strike:** Target highest-value enemy ships (capital ships first). Full offensive damage.
No air defence for own flotilla.

**Anti-submarine:** Hunt submarines in the current zone. Significantly increases naval
detection value each round.

**Close Air Support (CAS):** Attack land divisions in an adjacent coastal province. Carrier
aircraft historically conducted infrastructure strikes (Operations Meridian, Robson, Lentil
against Sumatran oil refineries) as well as tactical ground support. CAS damage lands on the
land tactical grid using the same patterns as land-based CAS (see AIR_COMBAT.md). Effective
only against coastal provinces within the flotilla's zone range.

**Logistics Strike:** Target supply infrastructure in a coastal province within range.
Historically confirmed — British Pacific Fleet carrier aircraft specifically targeted oil
refineries and supply installations. Reduces road segment throughput in the target province
for N ticks. Recon-proportional effectiveness for high-altitude delivery.

**Infrastructure Strike:** Target buildings in a coastal city within range. Recon-proportional
targeting for high-altitude; direct targeting at low altitude. Priority on fortifications and
port buildings.

**AA defence from cruisers:** Ships in the target flotilla with AA armament (light cruisers
especially) deal damage to attacking carrier aircraft proportional to AA ship count. A
cruiser-heavy flotilla is significantly harder to strike than a battleship-heavy one.

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

**Naval base level** — governs ship refit speed, refit capacity (how many ships can refit
simultaneously), and ship repair rate. Higher levels mean faster refit queues and more
flotillas that can use the port concurrently.
Additionally: **higher naval base level provides HP damage reduction to ships docked at
that port** — proportional to base level. At level 1, minimal protection (~10–15% reduction).
At maximum level, substantial protection (~40–50% reduction). This models hardened dry
docks, shore-based AA batteries, and port infrastructure. Ships must be stationary at port
to receive this protection — ships underway get none.

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
See Carrier Aircraft — Automated Mission Presets section above for the full list including
CAS, logistics strike, and infrastructure strike missions confirmed historically and now in
scope for carrier aircraft.

### Land-based air wing naval missions
**Port strike:** Targets ships in port. Anchored ships have no zone-based defence — fully
exposed to air attack. Naval base level reduces damage to docked ships. Most efficient way
to damage capital ships without a naval engagement.

**Naval strike:** Targets a flotilla at sea. Ships can manoeuvre and use AA defence.
Detection determines targeting accuracy.

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
