# Phase 6 — Tactical Combat Branch Plan

## Branch A — `feat/tactical-grid-schema`
**Must merge first. All other branches depend on this.**

- 5×5 grid cell schema added to `GameRoomState` (unit type, HP, suppression, XP tier per cell)
- `UnitType` const object (all archetypes: infantry, assault_infantry, recon_infantry, mg, cavalry, light_tank, medium_tank, heavy_tank, armoured_car, at_infantry, at_gun, at_gun_sp, aa_gun, sniper, flamethrower, artillery, commando)
- `ROUND_RESOLVED` event contract (full grid delta shape, XP changes, formation bonuses active)
- `UNIT_INCAPACITATED`, `UNIT_RECOVERED`, `UNIT_EXPERIENCE_GAINED`, `UNIT_ELITE_REACHED`, `TACTICAL_BREAKTHROUGH` event payload interfaces
- Unit terrain cost table (`unit_terrain_costs.ts` — extend to cover all UnitType values)

**Tests:** create a grid, place units, read back cell state. Verify schema serialises correctly through Colyseus. All UnitType values round-trip.

---

## Branch B — `feat/tactical-round-system`
**Starts after A merges.**

- Tick timer (target 20s per round)
- 5-phase lethality escalation: Contact → Firefight → Intense → Decisive → Annihilation; lethality multiplier applied to all damage per phase
- Force recon exception: bypass lethality ramp, deal full damage from Round 1
- `ROUND_RESOLVED` broadcast each round (grid delta shape from Branch A; delta values filled by later branches)
- Grid locked during active combat — no template switching while engaged

**Tests:** timer fires correctly, phase advances at correct round boundaries, ROUND_RESOLVED broadcast fires with correct shape, force recon exception flag bypasses multiplier.

---

## Branch C — `feat/tactical-combat-stats`
**Starts after B merges.**

- HP (permanent damage) and suppression (decaying) tracked per cell
- Suppression decay per round (base rate); 2–3× faster during retreat; no instant reset on retreat
- Division-level suppression threshold (base 60%) calculation → feeds Suppressed state; stealthed + incapacitated units excluded
- Unit incapacitation HP floors: infantry/MG/AT-inf/cavalry/sniper/commando/FLM/recon-inf at ~20% HP; armour at ~30%; artillery/towed AT/AA have no floor
- Armour penetration scale: pen/armour ratio → damage % (0/20/30/40/70/100% at 60/70/80/90/100% thresholds)

**Tests:** suppression decay rate correct, 2–3× faster during retreat, incapacitation triggers at correct HP thresholds per unit class, armour pen table values, division threshold excludes stealthed and incapacitated units, attacker threshold (80%) vs defender (60%).

---

## Branch D — `feat/tactical-infantry-patterns`
**Starts after C merges. Can run in parallel with E and F.**

All attack patterns are pure functions — write test fixtures first (grid state + unit position → expected targets + damage values), then implement.

- Infantry / MG — horizontal attack on frontmost occupied enemy row; damage distributed among living units only
- Assault infantry — same as infantry
- Cavalry — horizontal like infantry + Round 1 charge bonus (higher HP damage + suppression); standard from Round 2+; high MG suppression vulnerability
- Recon infantry — same horizontal as infantry
- Commando — same horizontal as infantry
- Flamethrower — 3-column × 2-row AOE anchored 1 row ahead of unit position; immune to armour damage reduction

**Tests:** each pattern as a pure function with fixture grid states; assert correct target cells and damage values before writing any implementation.

---

## Branch E — `feat/tactical-armour-patterns`
**Starts after C merges. Can run in parallel with D and F.**

All attack patterns are pure functions — write test fixtures first.

- Armour (light/medium/heavy tank, armoured car) — vertical column attack with depth rule; column shift flanking/envelopment bonus; disabled in dense_forest and urban terrain
- AT infantry / AT gun / AT gun SP — column selective targeting; side armour bonus on column shift; picks one direction only
- AA gun — passive vs air; no ground attack role in land-only combat

**Tests:** armour column targeting depth rule, column shift applies flanking bonus, armour disabled in dense_forest/urban, AT column selection logic, AA does nothing in land combat.

---

## Branch F — `feat/tactical-special-patterns`
**Starts after C merges. Can run in parallel with D and E.**

All attack patterns are pure functions — write test fixtures first.

- Sniper — full grid priority targeting: snipers → flamethrowers → force recon → MG → AT gun → infantry fallback
- Artillery — recon-proportional weighted random cell targeting; low recon = near-uniform scatter; high recon = concentrated weights
- Recon value accumulation per round per unit type (recon-inf accumulates fastest; infantry slowest)

**Tests:** sniper priority order correct across all archetypes; artillery weight distribution at zero, partial, and full recon values; recon accumulation rates per unit type.

---

## Branch G — `feat/tactical-xp-stealth`
**Starts after D + E + F all merge.**

- Unit experience system: accumulates per round survived; 4 tiers (Green/Seasoned/Veteran/Elite);
  60% XP credit when unit HP ≤ 50% at engagement end; 40% credit when incapacitated and division
  won; 0% if division destroyed; perk-extensible thresholds and retention rates; post-Elite XP
  gives diminishing-returns bonus
- Stealth system: stealthed units deal damage normally, cannot be targeted, excluded from
  division suppression threshold; stealth level vs anti-stealth level checked per round;
  terrain stealth bonuses via perk research; survive division destruction into reserve

**Tests (server):** XP accumulation per round, tier promotion at correct thresholds, retention
rates applied correctly at engagement end, stealth excludes cells from targeting and threshold,
reveal rule (anti_stealth >= stealth) applied per round.

---

## Branch G-Builder — `feat/tactical-division-builder`
**Can start after A merges. Independent of B–G and H–J.**

- DivisionBuilder MVP (Godot): template builder UI in main menu; 5×5 grid with row role labels (Vanguard/Assault/Support/Reserve/Rear); movement profile summary computed and displayed; formation bonus glow on cells when placing adjacent synergy units; derived division type + engagement radius shown live

**Tests (Godot):** DivisionBuilder places units and computes movement profile; formation bonus glow activates on valid adjacency.

---

## Branch G-Builder-Assign — `feat/template-assignment`
**Starts after G-Builder merges. Prerequisite for Branch L.**
**Plan:** `plans/phase-6-task-g-builder-template-assign.md`

- Wire local `DivisionTemplateStore` presets to strategic-map divisions via new production server handler `ASSIGN_TEMPLATE`
- `ASSIGN_TEMPLATE` sets `template_id` (schema-synced), populates server-side grid cells, recomputes `division_type` / `engagement_radius` / `movement_profile_json`
- Mini 5×5 composition grid (`CompBlock`) added to `FriendlyDivisionPanel` bottom bar — 25 `ColorRect` cells coloured by unit class; clicking opens the viewer
- New `DivisionTemplateViewerPanel` (FULL_CENTER overlay): read-only 5×5 grid (left) + View state / Select state (right); hover-preview; locked when division is engaged/retreating/suppressed
- Phase 8 migration path: only `DivisionTemplateStore._load_presets()` changes — all downstream code stays the same

**Tests (server):** `ASSIGN_TEMPLATE` sets `template_id`, populates grid, clears prior cells, recomputes `division_type`, rejects when engaged, no-ops on unknown division.

---

## Branch H — `feat/tactical-row-perks`
**Starts after G merges.**

- Row positional perks applied each round:
  - R5 (Vanguard): +suppression dealt
  - R4: +HP damage
  - R3: +suppression resistance
  - R2: faster suppression decay
  - R1 (Rear): no bonus

**Tests:** perk multiplier correct per row; unit in wrong row does not receive adjacent row's perk.

---

## Branch I — `feat/tactical-formation-bonuses`
**Starts after G merges. Can run in parallel with H.**

- Formation bonus detection each round: AT+MG adjacent, Sniper+Recon inf adjacent, FLM+Assault inf adjacent, MG+MG same row, Artillery+Recon inf adjacent (also increases recon accumulation rate)
- Formation bonus application: stat bonus applied to damage/suppression when pair detected

**Tests:** bonus activates on adjacency only; bonus does not activate when pair separated; Artillery+Recon inf increases recon accumulation rate correctly.

---

## Branch J — `feat/tactical-terrain-bridge`
**Starts after H + I merge.**

- Terrain modifiers wired into combat: unit-type specific bonuses/penalties per cover_combat group (infantry suppression resistance in forest, armour flanking bonus in plains, AT ambush bonus in forest, armour flanking disabled in dense_forest/urban); uses terrain sampled in Phase 4
- Suppression → strategic bridge cleanup: verify division-level suppression threshold correctly feeds the Phase 4 `Suppressed` state; attacker threshold (80%) vs defender (60%); stealthed/incapacitated exclusions confirmed

**Tests:** terrain modifier applies correct bonus per cover_combat group; armour flanking disabled in correct terrain types; threshold correctly feeds Suppressed state.

---

## Branch K — `feat/tactical-grid-ui`
**Can start after A merges. Independent of B–J.**

- `TacticalCombatPanel`: full-screen overlay, both 5×5 grids facing each other (own R5 faces enemy R5)
- HP + suppression bars per cell, XP tier badge per cell
- Formation bonus glow (persistent teal outline on synergy pairs)
- Attack pattern overlay on hover (stubbed via `AttackPatternRegistry` — returns [] until D/E/F fill it in)
- Terrain + river crossing modifier banner
- 5-phase escalation strip (muted at Contact, saturates to dark crimson at Annihilation)
- Combat button on division icon: appears when `combat_state == "engaged"`, opens TacticalCombatPanel

**Tests:** mock `ROUND_RESOLVED` → HP bars update, XP badges reflect new tiers, formation glow activates on correct pairs. Escalation strip advances correctly. Incapacitated cell dims.

---

## Branch L — `feat/tactical-templates`
**Can start any time (independent of all other branches).**

- `/divisions` CRUD routes (Hono): template persistence; movement profile cached alongside template; invalidated on research upgrade
- Nation preset templates: `game-server/src/data/templates/<nation_id>/` JSON files (historically flavoured presets per playable nation)
- `/internal/player/:user_id/templates` — loads player templates + movement profiles into Colyseus at game start

**Tests:** template POST/GET round-trip with movement profile cached; preset templates load correctly into Colyseus.

---

## Branch M — `feat/tactical-integration`
**Must be last. Starts after all other branches merge.**

- Wire all branches together
- Bot clients with two opposing preset templates fighting each other
- Verify full gate: grid resolves rounds, suppression builds, one division hits threshold and retreats at strategic layer
- Open combat panel: see grid updating live with HP bars, suppression, XP badges
- Force recon deals full damage in Round 1; artillery improves accuracy over rounds; flamethrower AOE reaches correct depth; infantry attacks frontmost occupied row
- Template CRUD round-trip: save template → loads at game start → appears in DivisionBuilder

**Tests:** end-to-end bot fight; verify gate from DEV_PHASES.md §6 verification gate.

---

## Merge Order

```
A
└── B
    └── C
        ├── D ──┐
        ├── E ──┼── G ─── H ──┐
        └── F ──┘     └── I ──┴── J ──┐
                                       │
K (after A, independent)               │
G-Builder (after A, independent)       │
G-Builder-Assign (after G-Builder)     │
L (after G-Builder-Assign)             │
                        M ◄────────────┘ (after all)
```
