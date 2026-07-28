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

## ✅ Branch A — `feat/air-wing-schema` — COMPLETE

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

---

## ✅ Branch K-stubs — `feat/air-client-stubs` — COMPLETE

Minimal GDScript client that makes every server branch visually verifiable as it lands.
No panels, no mission UI — just map presence and state feedback.

- `AirWingSystem` autoload (`client/src/systems/air/air_wing_system.gd`): subscribes to
  `AIR_WING_UPDATES`; spawns/removes `AirWingIcon` nodes per wing
- `AirWingIcon` scene: diamond icon with readiness color tint; hidden for enemy wings unless
  detected; own wings always visible
- Readiness color tint: green (≥ 0.7) → yellow (0.4–0.7) → red (< 0.4)
- Detection circles drawn per icon as two filled discs (inner = passive radius, outer = recon
  radius) matching land unit observation/scouting ring pattern; own airborne wings only
- Smooth icon movement via `DubinsInterpolator` each `_process` frame

---

## ✅ Branch B — `feat/air-wing-lifecycle` — COMPLETE

- `AirWingLifecycleSystem` (`game-server/src/systems/air_wing_lifecycle_system.ts`)
- State machine: IDLE → TRANSIT → ENGAGED → LOITER/RTB → REFUEL → IDLE
- Readiness decay airborne, recovery at base; weapon_ready/reload cooldown
- Fuel decay, forced RTB at threshold, recovery at base
- Auto-staging: out-of-range transit orders relocate wing to a closer airbase first
- `CREATE_WING`, `DISBAND_WING` handlers; LOITER orbit arc via Dubins

---

## ✅ Branch B-patch — `feat/air-wing-lifecycle-patch` — COMPLETE

- `REDEPLOY_WING` handler: ferry wing to a new home airbase; updates `home_airbase_province_id`
  on arrival; REFUEL → IDLE at new base
- `RETREAT_WING` handler: manual early-RTB from any airborne state; no-op from ground states

---

## ✅ Branch C — `feat/air-dubins-pathfinding` — COMPLETE

**Server:**
- `DubinsPathfinder` class (`game-server/src/systems/air_dubins_pathfinder.ts`)
- Straight-leg + minimum-turn-radius arc path generator
- RTB path respects current heading; loiter arc-only special case; pursuit path (lead pursuit)
- `AIR_WING_PATH` broadcast on every new path; `path_elapsed_ms` updated each tick
- Spatial bucketing for proximity checks

**Client:**
- `DubinsInterpolator` reconstructs wing position at 60fps
- Dashed arc overlay on wing selection
- Right-click-to-move: empty map → `ASSIGN_WING_MISSION`; friendly province → `REDEPLOY_WING`

---

## ✅ Branch D — `feat/air-detection` — COMPLETE

**Server (`game-server/src/systems/air_detection_system.ts`):**
- Binary detection: wing visible iff inside radar, friendly wing, or land division
  observation radius
- Radar entries (`setRadarEntry`) with province-scoped coverage
- Recon wings use `RECON_WING_RADIUS_DEG` (1.0°); passive wings use `PASSIVE_WING_RADIUS_DEG` (0.1°)
- Interception/Air Superiority wings in LOITER pursue nearest detected enemy
- `WING_DETECTED` / `WING_LOST_DETECTION` broadcast to all clients
- **Beyond original spec — Air-to-ground visibility:** `_tickDivisionVisibility` tracks which
  divisions each nation can see from airborne wings. RECON_WING_RADIUS_DEG (1.0°, ×2 for RECON
  mission) used for ground detection. `DIVISION_REVEALED` / `DIVISION_HIDDEN` broadcast per-nation
  via `broadcastToNation` lambda. Divisions hidden from enemy clients by default; `military_system.gd`
  shows them only when `_air_revealed_divisions` contains them.

**Client:**
- Enemy wing icons hidden unless `is_detected`; own wings always visible
- Detection disc overlay drawn in `AirWingIcon._draw()` — two filled circles, very low alpha
- `DIVISION_REVEALED` / `DIVISION_HIDDEN` → `EventBus.division_revealed/hidden` →
  `military_system._air_revealed_divisions` dict → `_update_division_visibility()`
- `_vision_filter_enabled = false` (no province vision data yet) means enemy divisions default
  to hidden unless air-revealed

---

## Branch E — `feat/air-to-air-combat`
**Starts after B + C + D all merge. ✅ All prerequisites met.**

### Server — `game-server/src/systems/air_combat_system.ts`

**Range constants** (defined in `air_combat_system.ts`, not globals):
- `ATTACK_RANGE_DEG = 0.3` — uniform across all aircraft types (≈33km, matches land engagement scale)
- Passive detection radius is **per-type in the stat table** (no longer a single global constant),
  defaulting to 0.05° for most types; HEAVY_FIGHTER carries ~0.25° to match its near-attack-range
  observation design. This replaces `PASSIVE_WING_RADIUS_DEG` in `air_detection_system.ts`.

**Aircraft stat table** (`game-server/src/data/air_unit_stats.ts`):

| Type | `attack_vs_air` | `defense_vs_air` | `observation_deg` |
|---|---|---|---|
| FIGHTER | 0.25 | 0.03 | 0.05 |
| HEAVY_FIGHTER | 0.22 | 0.05 | 0.25 |
| CAS_PLANE | 0.0 | 0.03 | 0.05 |
| DIVE_BOMBER | 0.0 | 0.03 | 0.05 |
| TACTICAL_BOMBER | 0.0 | 0.02 | 0.05 |
| STRATEGIC_BOMBER | 0.0 | 0.02 | 0.05 |
| NAVAL_BOMBER | 0.0 | 0.02 | 0.05 |
| RECON_PLANE | 0.0 | 0.01 | 1.0 |

- Pure bombers have `attack_vs_air = 0` — data value, not a code branch
- All values are playtesting-tunable starting points; L ≈ 0.25 for a fair fighter-vs-fighter fight
- `observation_deg` replaces the old `PASSIVE_WING_RADIUS_DEG` global; `AirDetectionSystem` reads
  this per-wing instead of a constant. RECON_PLANE's value here doubles when on RECON mission
  (existing ×2 behaviour preserved)

**Engagement detection:**
- Each tick: find all pairs of opposing airborne wings within `ATTACK_RANGE_DEG`
- Wings already in ENGAGED skip re-engagement check; wings in LOITER/TRANSIT are candidates
- Spatial bucketing reused from `AirDubinsPathfinder` to prune distant pairs cheaply

**Combat resolution per engagement (one exchange per sortie):**
```
damage_dealt = weapon_ready ? attack_vs_air : defense_vs_air
effective_damage = damage_dealt × count × combat_readiness × status_fuel
```
- `status_fuel` is the only active status modifier in Branch E (see Wing Sub-Status below)
- Apply `effective_damage` to opponent `count` (HP pool); clamp at 0
- On first engagement tick: check surprise condition (see below)

**Surprise mechanic:**
- Attacker had target in detection coverage *before this tick* (`target.is_detected === true`
  coming into the tick) AND target did NOT have attacker detected → apply multiplier S = 2.5×
  to attacker's `attack_vs_air` damage
- If both detected each other on the same tick → fair fight, no S
- Pure bombers (`attack_vs_air = 0`) are unaffected by S in the Attack branch; they were
  always in the Defense branch anyway

**Targeting — Interception mission:**
- Primary target: bomber-class (STRATEGIC_BOMBER, TACTICAL_BOMBER, CAS_PLANE, DIVE_BOMBER)
- Falls back to any hostile if no bomber-class detected

**Targeting — Air Superiority mission:**
- Primary target: fighter-class (FIGHTER, HEAVY_FIGHTER — equal priority)
- Falls back to any hostile if no fighter-class detected

**Target deconfliction (applies to all missions):**
- Sort engaging friendlies by score descending
- Each claims its highest-scoring still-unclaimed hostile; remove from pool
- Overflow: doubly assign to the highest-value remaining target rather than sitting idle
- O(n log n)

**Escort mission (separate code path — server only in Branch E):**
- Wing bound to a specific `target_id` friendly bomber wing
- Follows bomber's Dubins path (mirrors `path_gen_id` and elapsed time)
- Engagement trigger: an enemy wing is currently ENGAGED with the assigned bomber
  (not nearest-enemy logic — explicitly different)
- On assigned bomber RTB or destruction: escort follows home automatically
- Assignment UI (player picks which bomber to escort) is deferred to Branch K-ui;
  server logic is fully testable via test harness with manually set `target_id`

**Post-engagement lifecycle handoff:**
- Wing transitions to LOITER or RTB per existing `AirWingLifecycleSystem` logic (Branch B)
- `AirCombatSystem` calls `lifecycleSystem.onEngagementComplete(wingId, outcome)`
- On WING_DESTROYED: call `lifecycleSystem.destroyWing(wingId)` → removes from state,
  broadcasts `AIR_WING_DESTROYED`

**Wing Sub-Status — Fuel tank only (Branch E scope):**

Schema addition to `AirWingState`:
- `status_fuel: number = 1.0` — fuel decay rate multiplier; default 1.0, damaged > 1.0

Trigger rule:
- **Fighter full Attack_value landing, target survives** → `status_fuel` ×1.5
  (tank hit: wing survives but burns fuel faster, implicitly shortening its remaining range)

Clears to 1.0 on RTB+refuel. No other status flags in Branch E — Engine, Weapons, and
Instruments are deferred to Branch E-patch (see below).

**Events broadcast:**
- `AIR_COMBAT_STARTED` — `{ engagement_id, wing_a_id, wing_b_id, is_surprise: bool }`
- `AIR_COMBAT_ENDED` — `{ engagement_id, winner_id, loser_id, loser_destroyed: bool }`
- `AIR_WING_DESTROYED` — `{ wing_id, nation_id }`
- `AIR_SUPERIORITY_LOST` — `{ nation_id, province_id }` (broadcast when a nation loses all
  air coverage over a province due to wing destruction or driven off)
- `AIR_WING_DRIVEN_OFF` — `{ wing_id }` (wing survives but retreats — RTB forced)

### Client

- `AirWingIcon`: on `AIR_COMBAT_STARTED` involving own or detected wing → red tint override +
  crosshairs sprite overlay; clear on `AIR_COMBAT_ENDED`
- Thin line drawn between engaged wing icons while engagement active; cleared on end
- `AIR_WING_DESTROYED` → destruction animation (icon flashes 3× → fades → removed); also
  triggers `GameState._apply_air_wing_destroyed(data)` to remove from local state
- `AIR_SUPERIORITY_LOST` → brief screen-edge red flash on the affected player's client
- `AIR_WING_DRIVEN_OFF` → icon clears engaged state, begins RTB arc animation

### Tests (`game-server/test/12e-air-combat.test.ts`)

- Attack/Defense rule: `weapon_ready = true` uses `attack_vs_air`; `false` uses `defense_vs_air`
- Pure bomber (`attack_vs_air = 0`): always in Defense branch regardless of `weapon_ready`
- Surprise multiplier: attacker detected target before tick + target missed attacker → S applied
- Fair fight: both detected same tick → no S
- Deconfliction: 3 friendlies vs 2 enemies → unique assignment + overflow doubles
- Escort: only engages enemy attacking its assigned bomber, not nearest enemy
- Interception: picks bomber-class over fighter-class target when both present
- Air Superiority: picks fighter-class over bomber-class
- Fuel tank status: fighter attack landing on surviving target → `status_fuel` ×1.5;
  clears on RTB+refuel
- WING_DESTROYED emitted when count reaches 0
- Per-type `observation_deg` read correctly from stat table (HEAVY_FIGHTER ≠ FIGHTER)

---

## Branch E-patch — `feat/air-formation-density`
**After E merges. Adds remaining Wing Sub-Status flags, Wing Size & Airbase Capacity.**

**Remaining Wing Sub-Status flags** (deferred from E):

Schema additions to `AirWingState`:
- `status_engine: number = 1.0` — speed multiplier (< 1.0 = Engine damage)
- `status_weapons: number = 1.0` — attack/defense multiplier (< 1.0 = Weapons damage)
- `status_instruments: number = 0` — pattern reach reduction count (integer; used in Branch F)

Deterministic trigger rules:
- **Defense-value return fire** (counter-fire from a surviving target) → `status_instruments` +1
- **AA fire** (province fixed AA or flotilla pooled AA, from Branch G) → `status_fuel` ×1.5
  (AA trigger joins the existing Fuel tank trigger from Branch E)
- **Fighter full Attack_value landing, target survives** → alternates between
  `status_engine` ×0.7 and `status_weapons` ×0.6 per engagement

Multipliers stack multiplicatively (two Weapons hits = 0.6 × 0.6 = 0.36). All four flags
clear on RTB+refuel. `status_instruments` feeds into Branch F's attack pattern registry.

**Wing Size & Formation Density:**
- Bigger wings (higher `count`) get a saturating Defense-value bonus from mutual covering fire
  — increasing returns up to ~36 planes, then plateaus
- Bigger wings take proportionally more AA damage — roughly linear, no saturation
- Formula constants tuned during playtesting; historical anchor: 18/36/54 planes
- Wing size *adjustment UI* (+10/−10 controls) is Branch K-ui

**Airbase Capacity — soft cap via recovery congestion:**
- More wings stationed at one base → each wing's fuel and readiness recovery rate while IDLE
  gets marginally slower (shared ground crew bandwidth)
- Continuous pressure, never a hard wall; same shape as manpower recruitment cost curve

**Tests:** Engine/Weapons/Instruments triggers fire correctly; stacking is multiplicative;
all flags clear on RTB; Defense bonus increases with count up to plateau then flat; AA damage
scales linearly; base congestion reduces recovery rate proportionally to wing count at base.

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
  bomber), render a brief flak burst particle at the province location
- **Province damage overlay:** on province click, info panel shows live industry/logistics/
  oil scalars

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
- **Port strike:** targets ships anchored in a friendly or contested port province; no
  zone-based or pooled-AA defence; naval base level on target province reduces damage
- **Fuzzy contact marker system:** `NavalContactMarker` — position marker with randomized
  radius + expiry window; precision/duration scale by detection source quality
- **Splash damage perk** (`perk_splash = true`): primary target full damage, percentage
  splashes to other ships in same flotilla; default 15%
- New schema: `NavalContactMarkerState` (position, radius_deg, expires_at_ms, nation_id)
- Events: `NAVAL_BOMBER_STRIKE_HIT`, `NAVAL_BOMBER_STRIKE_MISSED`, `CONTACT_MARKER_EXPIRED`

**Client:**
- On `NavalContactMarkerState` schema add: translucent circle; fades as expiry approaches
- Own-nation markers shown; enemy markers hidden

**Tests:** marker radius within spec per tier; strike resolves on arrival before expiry;
whiffs after expiry; trade interdiction reaches pipeline; anti-ship targets highest-value;
port strike resolves with no AA; splash perk distributes damage across flotilla.

---

## Branch I — `feat/air-fleet-command` — DEFERRED

**Deferred pending:** multi-select UI design. Air fleet value depends heavily on whether
persistent named groupings are better than good ad-hoc multi-select. That question needs
to be settled first; otherwise fleet membership management becomes overhead with no payoff.

**Design decisions captured in:**
- `old-docs/AIR_COMBAT.md` → "Command Layer — Air Fleets" (fleet model, escort spread logic,
  RELOCATE_FLEET deferred section)
- `wiki/future-works/air-fleet-command.md` (full design notes + dependencies)
- `wiki/future-works/multi-select-ui.md` (multi-select UI design, prerequisite for fleet)

**When to revisit:** after multi-select UI is designed and implemented. If multi-select alone
covers the use case (select wings on map → batch assign), fleet as a persistent concept may
not be needed. If players need stable named theater groupings, fleet is the right layer on top.

---

## Branch J — `feat/air-networking-aoi`
**Starts after A merges. Can run parallel with all other branches.**

**Server:**
- Switch air wing interest management from `@filter()` to `StateView`/`@view()`
- AOI: client receives only wings within strategic viewport + all own wings regardless
- IDLE wings at home base emit zero position updates

---

## Branch K-ui — `feat/air-client-ui`
**Starts after I merges. Pure UI panels — no map rendering logic.**

- Military panel → Air sub-tab: wing list per airbase, mission assignment dropdown
- Air Fleet panel: fleet list, directive selector
- Nation preset air wing templates
- Air combat notification toasts
- Move button + Retreat button on wing selection bottom panel

---

## Branch M — `feat/air-integration`
**Must be last. Starts after all other branches merge.**

- Wire all branches together end-to-end
- Bot clients launching wings on every mission type against bot land divisions and bot
  flotilla stubs
- Verify full gate from `DEV_PHASES.md §12`:
  - Tactical-bombing wing → land combat → grid takes damage in correct pattern
  - Enemy Interception wing → LOITER → recon reveals bomber → interceptor pursues →
    Attack/Defense rule resolves; surprise multiplier fires if detection gap exists
  - Naval bomber → maritime-patrol contact → reaches marker → strike resolves with pooled AA stub
  - Strategic bomber hits city → full province fixed-AA → industry scalar reduced
  - Escort wing follows bomber; engages only attackers of its assigned bomber
- **Load test:** wing counts at `AIR_COMBAT.md` "Server Architecture & Scaling" scale

---

## Merge Order

```
A (✅)
├── K-stubs (✅)
├── B (✅) ── B-patch (✅) ──────────────────────────────────────────────────────┐
├── C (✅) ──────────────────────────────────────────────────────────────────────┤
└── D (✅) ──────────────────────────────────────────────────────────────────────┴── E ── E-patch ──┐
                                                                                    ├──── F ──────────┤
                                                                                    ├──── G ──────────┤
                                                                                    └──── H ──────────┴── I ──┐
                                                                                                              │
J (after A, parallel)                                                                                         │
K-ui (after I)                                                                                                │
                                                                                    M ◄──────────────────────┘
```

---

## Phase 13 Seams (forward-compatibility notes)

| Item | This phase | Phase 13 wires |
|---|---|---|
| Flotilla pooled AA | `getFlotillaAaDamage()` returns 0 | Phase 13 passes real FloatillaState |
| Anti-ship target data | Mock highest-value contact | Phase 13 passes real ship composition |
| Carrier CAS preset | Method stub defined | Phase 13 calls with flotilla position |
| Naval detection boost from radar | Field stubbed | Phase 13 reads it from AirDetectionSystem |
