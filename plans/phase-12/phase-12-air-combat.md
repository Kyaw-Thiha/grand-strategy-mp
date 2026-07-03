# Phase 12 — Air Combat Branch Plan

## Context

Air combat is being built as Phase 12, skipping Phases 7–11. The design is a full departure
from HoI4-style province-assigned abstraction: wings are individually selectable, real-time,
Dubins-pathfinding units (see `docs/AIR_COMBAT.md`). The phase-6 tactical combat plan
(`plans/phase-6/phase-6-tactical-combat.md`) is the structural template for this document.

**Starting point (from codebase survey):**
- No air system exists anywhere — starting from scratch
- `GameRoomState.ts` has schema classes for divisions, provinces, relations, proposals — no wings
- `game-server/src/systems/` has movement, combat, formation, terrain, supply, frontline
- `client/src/systems/military/` has division icons, pathfinder, military_system — no air
- Pattern: class-based TypeScript systems on server; GDScript autoloads/scenes on client

**Simplifications due to skipped phases:**
- **Supply (Phase 7 absent):** Readiness recovery at home base uses a simplified rate, not the
  full road-graph supply tick. Interface is designed for the future wire-up.
- **Research perks (Phase 11 absent):** Perk flags (multi-sortie, strafing unlock, etc.)
  exist as boolean fields on wing state, set via a `SET_WING_PERK` handler rather than wired
  to a real research tree. Same pattern as Phase 6's formation/terrain engines shipping with
  zero active rules.
- **Template persistence (Phase 8 absent):** In-memory MVP with nation presets; full Hono
  CRUD deferred (same Phase 6 precedent).
- **Flotilla pooled AA (Phase 13 absent):** AA resolution interface defined and consumed
  here; data source stubs to 0 AA until Phase 13 supplies real flotilla state.

---

## Branch A — `feat/air-wing-schema`
**Must merge first. All other branches depend on this.**

- `AirWingState` Colyseus schema class added to `GameRoomState` (aircraft_type, count as HP
  pool, combat_readiness, position_lng/lat, heading_deg, lifecycle_state, mission, target_id,
  home_airbase_province_id, weapon_ready, path_gen_id, path_elapsed_ms, perk flags)
- `AIR_UNIT_TYPES` const (CAS_PLANE, DIVE_BOMBER, FIGHTER, NAVAL_BOMBER, HEAVY_FIGHTER,
  STRATEGIC_BOMBER, TACTICAL_BOMBER, RECON_PLANE)
- `MISSION_TYPES` const (TACTICAL_BOMBING, INTERCEPTION, AIR_SUPERIORITY, ESCORT, LOGISTICS,
  AREA, INDUSTRY, OIL, RECON, TRADE_INTERDICTION, ANTI_SUBMARINE, ANTI_SHIP)
- `WING_LIFECYCLE` enum (IDLE, TRANSIT, ENGAGED, LOITER, RTB, REFUEL)
- Wing template schema (aircraft_type + count only — no internal grid)
- Event payload interfaces: `AIR_COMBAT_STARTED`, `AIR_SUPERIORITY_LOST`, `AIR_WING_DRIVEN_OFF`,
  `WING_RTB`, `WING_DESTROYED`
- Airbase linkage: `home_airbase_province_id` on wing points to existing `ProvinceState`
- `air_wings` MapSchema on `GameRoomState`

**Tests:** create a wing schema instance, verify all fields serialise/deserialise through
Colyseus. All AIR_UNIT_TYPE and MISSION_TYPE values round-trip. Wing added to GameRoomState
`air_wings` map.

---

## Branch K-stubs — `feat/air-client-stubs`
**Starts after A merges. Unblocks visual verification for all subsequent branches.**

Minimal GDScript client that makes every server branch visually verifiable as it lands.
No panels, no mission UI — just map presence and state feedback.

- `AirSystem` autoload (`client/src/systems/air/air_system.gd`): subscribes to
  `air_wings` MapSchema; spawns/removes `AirWingIcon` nodes on schema add/remove
- `AirWingIcon` scene: placeholder icon (aircraft silhouette sprite) positioned at
  `position_lng/lat`; hidden when `lifecycle_state == IDLE` at home base; visible for
  TRANSIT / ENGAGED / LOITER / RTB states
- Readiness color tint: green (≥ 0.7) → yellow (0.4–0.7) → red (< 0.4), driven directly
  from `combat_readiness` schema field — no dependency on Branch B logic
- Wing stacking at strategic zoom: wings at same home airbase collapse to one icon
  (count label) until zoomed in or selected; mirrors land road-column stacking
- No movement interpolation yet (icons snap to schema position each tick — smooth movement
  comes in Branch C)

**Visual check:** spawn two wings via `SPAWN_WING` test message; verify icons appear on
map, disappear when lifecycle set to IDLE, tint correctly as readiness changes.

---

## Branch B — `feat/air-wing-lifecycle`
**Starts after A merges. Can run parallel with K-stubs, C, D.**

- `AirWingLifecycleSystem` (new file: `game-server/src/systems/air_wing_lifecycle_system.ts`)
- **State machine transitions:** Idle → Transit → Engaged → (target scan) → Refuel → Idle
- **Multi-sortie post-engagement target scan** (replaces mandatory Loiter cooldown):
  after engagement resolves, immediately re-score available targets:
  - New target found → TRANSIT directly (skip LOITER entirely)
  - Same target only → re-engage allowed, but with a recency penalty multiplier (× 0.4 on
    priority score); if readiness is below threshold, prefer LOITER first to recover slightly
  - No targets found → LOITER (orbit patrol area, same arc path as Branch C); exits when
    detection event fires a new contact or readiness floor forces RTB
  - LOITER's purpose is "orbiting while searching", not an arbitrary cooldown
- **Single-sortie default** (`perk_multi_sortie = false`): Engaged → RTB directly; no
  target scan, no LOITER
- **Readiness decay** per tick while airborne (floor: never reaches 0); recovery per tick
  while IDLE/REFUEL at home base — simplified rate constant, supply-graph wire-up deferred
- **Weapon-ready/reload cooldown** — toggles `weapon_ready` field on each tick
- **Wing handlers:** `CREATE_WING` spawns from template, `DISBAND_WING` removes
- **K-stubs visual verification:** lifecycle transitions visible via icon show/hide
  (IDLE hides, TRANSIT/ENGAGED/LOITER/RTB shows) and readiness tint — no additional client
  code needed in this branch

**Tests:** state machine advances through every transition; multi-sortie post-engagement scan
goes to TRANSIT when new target found, LOITER when none, re-engages same target with penalty;
single-sortie goes straight to RTB; recency penalty reduces priority score by × 0.4; readiness
decays airborne, recovers at base; weapon_ready toggles on cooldown schedule.

---

## Branch C — `feat/air-dubins-pathfinding`
**Starts after A merges. Can run parallel with K-stubs, B, D.**

**Server:**
- `DubinsPathfinder` class (`game-server/src/systems/air_dubins_pathfinder.ts`) — entirely
  distinct from land A*; no shared code
- Straight-leg + minimum-turn-radius arc path generator; input: position, heading, target
  position/heading, turn radius → outputs compact path descriptor (path type + arc/straight
  segment parameters)
- RTB path: Dubins from current position/heading to home airbase entry heading — never
  instant-flip
- Loiter/orbit path: arc-only Dubins special case — used for Interception wait state AND
  multi-sortie no-target pause (one piece of code, two uses)
- Pursuit path (lead pursuit): given target position + velocity vector, compute intercept
  point; recomputed every N ticks (not every tick — server-cheap)
- Server broadcasts `AIR_WING_PATH` room message on every new path (path_gen_id, path_type,
  start_pos, start_heading_rad, end_pos, end_heading_rad, turn_radius_deg, speed_deg_per_ms);
  schema `path_elapsed_ms` updated each tick as a lightweight correction signal
- Swept contact check per existing 500ms room tick: analytic "did these two Dubins curves
  come within engagement range during this window?" — not position-sample; scoped by spatial
  bucketing (lat/lng grid partition)

**Client (same branch — needed to visually verify path math):**
- `DubinsInterpolator` (`client/src/systems/air/dubins_interpolator.gd`): stores received
  `AIR_WING_PATH` params; reconstructs wing position at 60fps from local elapsed time —
  mirrors land dead-reckoning exactly (server corrects via `path_elapsed_ms`, client animates
  between corrections)
- `AirSystem` consumes `AIR_WING_PATH` messages, calls `DubinsInterpolator` each `_process`
  frame; icons now move smoothly instead of snapping to schema position
- Dashed arc overlay on wing selection: visualises the current Dubins curve shape; hidden by
  default; consistent with land ghost-dot waypoint pattern

**Tests (server):** Dubins path connects start to goal with correct heading at both ends; RTB
respects current heading (no instant flip); Loiter generates a closed arc; pursuit path
converges on a moving target over successive recomputes; swept contact detects two paths
crossing within range, misses paths passing outside range; spatial bucketing prunes distant
wings correctly.
**Visual check:** launch two wings, select one, confirm dashed arc matches the smooth
animated movement.

---

## Branch D — `feat/air-detection`
**Starts after A merges. Can run parallel with K-stubs, B, C.**

**Server:**
- `AirDetectionSystem` (`game-server/src/systems/air_detection_system.ts`)
- Detection model: binary, continuously updated — enemy wing visible iff inside any
  detection source's coverage radius; reuses land division observation-radius pattern
- Detection sources:
  - **Radar building:** province coverage radius; also boosts naval detection in same area
    (naval field stubbed until Phase 13); functional effect only — full building design
    deferred per `AIR_COMBAT.md` Out of Scope
  - **Recon wing on RECON mission:** extends coverage in area currently overflown;
    non-persistent — lapses when wing leaves area; no cached state
  - **Land division observation radius:** taps existing `observation_radius` on DivisionState
  - **Other friendly wings:** small passive detection radius
- Detection gates path generation: no detected target → wing LOITER instead of pursuing
- Broadcasts `WING_DETECTED` / `WING_LOST_DETECTION` events

**Client (same branch — detection is invisible without it):**
- `AirSystem` listens for `WING_DETECTED` and `WING_LOST_DETECTION` events
- Enemy wing icons hidden by default; shown only while detected; own wings always visible
- Detection radius debug overlay (dev-mode toggle): circle showing each source's coverage

**Tests (server):** wing inside radar radius → detected; outside → not detected; recon wing
overflying → detected, leaves → lapses next tick; land division observation radius reveals
nearby wing; detection gates Interception Loiter→pursuit transition.
**Visual check:** enemy wing outside detection range → no icon; friendly recon wing flies
over → enemy icon appears; recon leaves → icon disappears.

---

## Branch E — `feat/air-to-air-combat`
**Starts after B + C + D all merge.**

**Server:**
- `AirCombatSystem` (`game-server/src/systems/air_combat_system.ts`)
- **Interception:** auto-targets enemy bomber-class wings; pursuit path (Branch C) when
  detected; LOITER when not
- **Air Superiority:** auto-targets enemy fighter-class wings
- **Attack/Defense damage rule:** `damage = weapon_ready ? Attack_value : Defense_value`;
  pure bombers have `Attack_vs_air = 0` as a data value — not a special-cased branch
- **Target deconfliction:** sort engaged friendlies by score; each claims highest unclaimed
  enemy; overflow doubles on highest-value remaining — O(n log n)
- **Escort:** wing bound to a specific friendly bomber wing ID; follows bomber's Dubins path;
  engages only when "enemy is currently attacking my assigned bomber"; follows bomber home on
  RTB or destruction
- Fighter vs Heavy Fighter modifier: data field, not hard-coded branch
- Events: `AIR_COMBAT_STARTED`, `AIR_SUPERIORITY_LOST`, `AIR_WING_DRIVEN_OFF`, `WING_RTB`,
  `WING_DESTROYED`

**Client (same branch — combat is invisible without it):**
- On `AIR_COMBAT_STARTED`: switch both wing icons to engaged visual state (red tint +
  crosshairs overlay); draw a thin line between the two wings while engaged
- On `WING_DESTROYED`: play destruction animation (icon flashes → fades out → removed)
- On `AIR_WING_DRIVEN_OFF` / `WING_RTB`: clear engaged visual state, icon returns to normal
  tint and begins RTB path
- On `AIR_SUPERIORITY_LOST`: brief screen-edge flash on the affected player's client

**Tests (pure functions where possible):** Attack/Defense rule correct for weapon_ready
true/false; Attack_vs_air=0 keeps pure bombers in Defense branch; deconfliction assigns
unique targets, overflow doubles correctly; Escort triggers only on "attacker of assigned
bomber" not nearest enemy; Interception transitions from LOITER to pursuit on detection.
**Visual check:** two opposing fighter wings — confirm crosshairs appear on both during
engagement, destruction animation plays on the losing wing.

---

## Branch F — `feat/tactical-bombing-patterns`
**Starts after B + C + D all merge. Can run parallel with E.**

All damage patterns are pure functions — write test fixtures first (grid state + wing context
→ expected target cells + damage values), then implement.

**Server:**
- `AirAttackPatternRegistry` (`game-server/src/systems/air_attack_pattern_registry.ts`)
- **Dive bomber:** single-cell; recon-weighted priority; perk flag raises target count
- **Tactical bomber:** frontmost occupied enemy row; soft-target priority; partial → full
  row via perk
- **CAS bomber:** column pattern (IL-2 strafing run); partial → full column via perk
- **Fighter strafing perk:** column — deliberately distinct from Tactical bomber's row;
  only active when `perk_strafing = true`
- All patterns call into live `GridCellState` at resolution time (not a snapshot)
- Auto-target weighting: `base_priority × distance_falloff + noise_floor`
- Carrier CAS interface stub (Phase 13 wires flotilla position)

**Client: none needed — verify via existing TacticalCombatPanel from Phase 6.**
Open TacticalCombatPanel during a bot bombing run; the existing Phase 6 HP bars and cell
state already display the grid damage caused by bombing patterns. No new GDScript required.

**Tests:** each pattern as pure function; Dive single-cell shifts toward high-value targets
as recon increases; Tactical row partial→full with perk; CAS column same; Fighter strafing
column not row; noise floor prevents greedy-nearest convergence; all patterns re-check live
grid (fixture with mid-round cell deaths).
**Visual check:** open TacticalCombatPanel, run a bombing bot — confirm correct cells take
damage per pattern.

---

## Branch G — `feat/strategic-bombing-aa`
**Starts after B + C + D all merge. Can run parallel with E, F.**

**Server:**
- Strategic bombing handler (STRATEGIC_BOMBER and TACTICAL_BOMBER aircraft types)
- **Logistics:** reduces road segment throughput (stubs to no-op until Phase 7; interface
  defined so Phase 7 wires without touching air code)
- **Area:** reduces province `population`/infrastructure scalar
- **Industry:** reduces province `industry` scalar
- **Oil:** reduces province oil extraction for N ticks
- **Province fixed AA:** `ProvinceAaSystem` — single check at moment of attack; full damage
  on city missions (Area/Industry/Oil); distance-decayed on Logistics/Tactical (reuses same
  non-linear curve as wing distance penalty — one formula, two uses); light/heavy altitude
  split from existing land AA
- **Flotilla pooled AA stub:** `getFlotillaAaDamage(province_id)` returns 0

**Client (same branch — AA and province damage are invisible without it):**
- **AA flak visual:** on `PROVINCE_AA_FIRED` event (new, broadcast when AA engages a
  bomber), render a brief flak burst particle at the province location; essential to see
  whether AA is actually triggering
- **Province damage overlay:** on province click, info panel shows live industry/logistics/
  oil scalars so you can confirm bombing is reducing the correct fields; driven from
  existing province schema fields (no new schema fields needed if the scalars are already
  on ProvinceState — add them if not)
- **Wing count reduction from AA hit:** already visible via K-stubs icon tint (readiness)
  and E's destruction animation — no additional client

**Tests:** Logistics stub no-ops before Phase 7; Area/Industry/Oil reduce correct scalars;
province AA applies full damage for city missions, distance-decayed for logistics/tactical;
altitude split correct; flotilla stub always returns 0.
**Visual check:** fly a strategic bomber over an enemy city province — confirm flak burst
appears; open province info panel — confirm industry scalar is reduced.

---

## Branch H — `feat/naval-bomber-missions`
**Starts after B + C + D all merge. Can run parallel with E, F, G.**

**Server:**
- **Trade interdiction:** feeds existing cargo-sinking event pipeline (same as submarines)
- **Anti-submarine:** auto-targets detected sub contacts (fog of war applies)
- **Anti-ship:** auto-targets highest-value detected ship contact; stubs to mock data
  (Phase 13 wires real flotilla composition)
- **Fuzzy contact marker system:** `NavalContactMarker` — position marker with randomized
  radius + expiry window; precision/duration scale by detection source quality; naval bomber
  generates Dubins transit path to marker centre; strike resolves if wing reaches marker
  before expiry; whiffs if expired; marker cleared on expiry
- New schema: `NavalContactMarkerState` added to `GameRoomState` (position, radius_deg,
  expires_at_ms, nation_id) — needed so client can render it
- Events: `NAVAL_BOMBER_STRIKE_HIT`, `NAVAL_BOMBER_STRIKE_MISSED`, `CONTACT_MARKER_EXPIRED`

**Client (same branch — fuzzy markers are the core mechanic and must be visible):**
- On `NavalContactMarkerState` schema add: draw a translucent circle on the sea at marker
  position with radius matching `radius_deg`; circle fades in opacity as expiry approaches
  (visual countdown)
- On `CONTACT_MARKER_EXPIRED` / marker removed from schema: circle fades out and disappears
- Own-nation markers always shown; enemy markers not shown (fog of war)

**Tests:** marker radius within spec per detection source tier; bomber arrives before expiry
→ strike resolves (mock flotilla); arrives after expiry → sortie whiffs; trade interdiction
reaches existing cargo-sinking pipeline; anti-ship targets highest-value first.
**Visual check:** trigger a maritime patrol detection — confirm translucent circle appears at
sea; send a naval bomber to it — confirm circle fades as time runs out; bomber arrives in
time → circle disappears on hit.

---

## Branch I — `feat/air-fleet-command`
**Starts after E merges.**

**Server:**
- `AirFleetState` schema (fleet_id, nation_id, wing_ids[], directive)
- Handlers: `CREATE_AIR_FLEET`, `DISBAND_AIR_FLEET`, `ASSIGN_WINGS_TO_FLEET`,
  `SET_FLEET_DIRECTIVE`
- Directives: `HOLD_AIR_SUPERIORITY` (Interception/Air Superiority over a front area),
  `INTERDICT_SUPPLY` (Logistics bombing), `ESCORT_BOMBERS` (fighters escort fleet's bombers)
- Auto-assignment: score unassigned wings by suitability (aircraft type × mission
  eligibility); greedy assignment; per-wing override always available
- Extends STRATEGIC_COMBAT.md's Macro/Micro command layer to air

**Client: none in this branch** — fleet panel and directive selector are K-ui territory.
Server correctness is verifiable via test messages and Colyseus state inspection.

**Tests:** directive assigns correct mission type to eligible wings; ineligible types skipped;
per-wing override survives fleet re-evaluation; fleet dissolve clears all wing assignments.

---

## Branch J — `feat/air-networking-aoi`
**Starts after A merges. Can run parallel with all other branches.**
**Requires K-stubs running to visually verify viewport gating.**

**Server:**
- Switch air wing interest management from `@filter()` to `StateView`/`@view()` — Colyseus
  docs flag `@filter()` as unsuitable for fast-paced real-time layers
- AOI: client receives only wings within strategic viewport + all own wings regardless
- IDLE wings at home base emit zero position updates

**Client: none** — K-stubs already renders wings; AOI verification is observing which
wings appear/disappear as the viewport moves.

**Tests:** viewport-limited client receives updates only for wings inside viewport; own wings
always received; IDLE wings at base emit no continuous updates; entering viewport triggers
initial state sync.
**Visual check:** zoom/pan map — confirm enemy wings outside viewport vanish from map and
reappear when viewport covers them; own wings always visible.

---

## Branch K-ui — `feat/air-client-ui`
**Starts after I merges. Pure UI panels — no map rendering logic.**

- Military panel → Air sub-tab: wing list per airbase, mission assignment dropdown, target
  province/wing override
- Air Fleet panel: fleet list, directive selector, wing assignment drag-and-drop view
- Nation preset air wing templates in lobby/game-start (type + count; historically flavoured)
- Air combat notification toasts: air superiority lost, wing driven off/RTB, strike resolved;
  feeds existing `NotificationSystem`
- Manual wing retask: click wing icon → side panel shows current mission + override controls

---

## Branch M — `feat/air-integration`
**Must be last. Starts after all other branches merge.**

- Wire all branches together end-to-end
- Bot clients launching wings on every mission type against bot land divisions and bot
  flotilla stubs
- Verify full gate from `DEV_PHASES.md §12`:
  - Tactical-bombing wing → land combat → grid takes damage in correct pattern (visible in
    TacticalCombatPanel)
  - Enemy Interception wing → LOITER (no detection) → recon wing reveals bomber →
    interceptor pursues → Attack/Defense rule resolves
  - Naval bomber → maritime-patrol contact → reaches marker in time → strike resolves with
    pooled AA stub; marker expiry causes whiff
  - Strategic bomber hits city → full province fixed-AA (flak burst visible) → industry
    scalar reduced (visible in province panel)
  - Escort wing follows bomber path; engages only bombers attacking its assigned target
- **Load test:** wing counts at AIR_COMBAT.md "Server Architecture & Scaling" scale —
  confirm bandwidth and tick-budget headroom (mandatory perf pass per DEV_PHASES.md)

---

## Merge Order

```
A
├── K-stubs (after A — unblocks visual verification for all branches below)
├── B ──────────────────────────────────────────────┐
├── C (+ DubinsInterpolator client) ───────────────┤
└── D (+ detection visibility client) ──────────────┴──── E (+ combat indicator client) ──┐
                                                          ├──── F (verify via Phase 6 panel)┤
                                                          ├──── G (+ AA flak + province UI) ┤
                                                          └──── H (+ contact marker client) ─┴── I ──┐
                                                                                                      │
J (after A, parallel; needs K-stubs running for viewport AOI check)                                  │
K-ui (after I — pure panels)                                                                          │
                                                          M ◄──────────────────────────────────────── ┘
```

---

## Phase 13 Seams (forward-compatibility notes)

| Item | This phase | Phase 13 wires |
|---|---|---|
| Flotilla pooled AA | `getFlotillaAaDamage()` returns 0 | Phase 13 passes real FloatillaState |
| Anti-ship target data | Mock highest-value contact | Phase 13 passes real ship composition |
| Carrier CAS preset | Method stub defined | Phase 13 calls with flotilla position |
| Naval detection boost from radar | Field stubbed | Phase 13 reads it from AirDetectionSystem |
