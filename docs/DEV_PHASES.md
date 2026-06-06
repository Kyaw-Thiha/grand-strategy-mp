# Grand Strategy Multiplayer — Development Phases

> Development roadmap and sequencing reference.
> Last updated: June 2026.

---

## Repo Structure

```
grand-strategy/
├── client/         # Godot client (res:// lives here)
├── game-server/    # Colyseus game server
├── api-server/     # Hono API server
├── packages/
│   └── shared-types/   # TypeScript types shared by game-server/ and api-server/
└── package.json    # pnpm workspaces root
```

---

## Testing Strategy

Four levels of testing used across all phases:

| Level | What | When |
|---|---|---|
| Unit | Pure TypeScript — feed state in, assert output. No clients, no WebSocket. | Server logic: combat math, economy tick, diplomacy resolution |
| Single client | Godot + Colyseus running locally, one player | UI, map rendering, command submission, server event display |
| Bot clients | Headless TypeScript Colyseus clients running scripted action sequences | Multiplayer logic: diplomacy, combat between players, lobby flows |
| N× Godot instances | Debug → Run Multiple Instances, each with a different JWT | Ad-hoc smoke testing, visual verification |

**Bot client pattern (use from Phase 3 onward):**

```typescript
// grand-strategy/colyseus/tests/bots/bot_client.ts
const client = new Colyseus.Client("ws://localhost:2567")
const room = await client.joinOrCreate("game_room", { token: BOT_JWT })

room.onStateChange((state) => {
  // assert things about state
})

await sleep(1000)
room.send("MOVE_UNIT", { unit_id: "u1", target_province_id: "p5" })
await sleep(500)
room.send("ATTACK", { unit_id: "u1", target_province_id: "p6" })
```

Write one bot script per scenario. They become your regression suite — run them whenever
you add a new system to confirm nothing broke.

---

## Phase 1 — Auth + Bare-Bones Connection

**Goal:** Godot can authenticate and connect to Colyseus. Full handshake verified end-to-end.

**Why first:** Auth is a dependency of everything else. JWT shape must be correct before any
downstream work begins. The Hono↔Colyseus seam is the trickiest integration point — find
problems here, not later.

### Hono
- [x] `/auth/email` — register + login with email/password (Steam replacement for dev)
- [ ] `/auth/refresh` — token refresh *(deferred to Phase 10 — Steam auth swap)*
- [ ] `/profile` GET + PUT *(deferred to Phase 7 — player persistence)*
- [x] JWT signed with `{ sub: user_id, has_host_pass: bool, exp: 24h }`

### Supabase
- [x] `players` table + RLS policy
- [ ] `division_templates` table + RLS policy *(deferred to Phase 7)*
- [x] `game_sessions` table

### Colyseus
- [x] Bare `GameRoom` with `onAuth()` verifying JWT signature
- [x] `GameRoomState` schema skeleton (players map only for now)
- [x] `/internal/verify-host-pass` route on Hono (Hono side done; Colyseus call deferred
      to Phase 3 — lobby system)

### Godot
- [x] `AuthManager` — email login flow (no Steam yet), stores JWT in memory; parses
      `has_host_pass` claim
- [x] `APIClient` — HTTP calls to Hono with JWT header
- [x] `NetManager` — WebSocket connect to Colyseus with JWT in handshake

### Verification gate
Godot logs in → receives JWT → connects to Colyseus room → Colyseus logs the verified
user_id. Nothing more. If this works cleanly, Phase 1 is done.

> **Phase 1 completed 2026-05.** Email auth + JWT → Colyseus handshake verified end-to-end
> via `scripts/e2e-auth-handshake.sh`. Steam auth deferred to Phase 10.

---

## Phase 2 — Map (Parallel to Phase 1)

**Goal:** Province map renders in Godot from real GeoJSON data. Click and camera work.

**Why parallel:** No server dependency. GeoJSON pipeline is local work. Map rendering is the
visual foundation everything else sits on — want it done early.

### Mapping pipeline
- [x] Download CShapes 1939 GeoJSON
- [x] Process in geojson.io / QGIS — clean borders, assign province IDs matching future
      nation data
- [x] Conversion script → `map_data.json` (province_id, polygon vertices, metadata)
- [x] Place `map_data.json` in `godot/assets/data/`

### Godot modules
- [x] `MapLoader` — parse `map_data.json`, instantiate Polygon2D nodes, build province registry
- [x] `MapRenderer` — colour provinces by owner (hardcoded test palette, no server state yet)
- [x] `MapInteraction` — click detection, hover highlight, province_clicked signal
- [x] `CameraSystem` — pan, zoom, zoom limits, edge scroll

### Verification gate
Launch Godot → map renders → can click provinces → camera pans and zooms smoothly.

> **Phase 2 completed 2026-06-01.** Pipeline: `map/tools/map_pipeline/pipeline.py`. Output:
> `client/assets/data/western_europe_6/` (89 provinces, 159 adjacency edges, 8 output files).
> Debug scene: `client/scenes/debug/map_debug.tscn`.

---

## Phase 3 — Session Loop Skeleton

**Goal:** Two clients can create/join a lobby, pick nations, start a game, and end it.

**Testing:** Bot client for second player.

### Colyseus
- [x] Full `GameRoomState` schema (nations, provinces, units, relations, proposals maps)
- [x] Lobby phase: nation selection, ready state, host-starts (≥2 ready) or all-6-filled
      auto-start
- [x] Game speed voting (`VOTE_SPEED` majority vote); pause/resume deferred to Phase 11
- [x] `GAME_STARTED`, `GAME_ENDED` events broadcast
- [x] `game-server/src/data/maps/western_europe_6/nations.ts` + `map_loader.ts` —
      map-scoped nation definitions

### Hono
- [x] `/lobby/create` — requires `has_host_pass`; generates 6-char join code; in-memory
      lobby store
- [x] `/lobby/activate` — links Colyseus `room_id` to join code after host WebSocket connects
- [x] `/lobby/resolve/:code` — resolves join code to `room_id` for joiners
- [x] `/lobby/public` — list open (activated) lobbies
- [x] `/internal/game-end` — receives results, writes to `game_sessions`, cleans up lobby
      entry
- [x] `DEV_MODE=true` env var grants `has_host_pass: true` to all registered accounts

### Godot
- [x] `LobbySystem` — create/join/activate, nation pick, deselect, ready, start, vote speed
- [x] `SessionManager` — `GAME_STARTED`/`GAME_ENDED` → scene transitions
- [x] `SceneManager` — main menu → lobby → game → postgame
- [x] `GameState` — mirrors server state from `LOBBY_STATE_UPDATE` deltas; emits `EventBus`
      signals on change
- [x] `EventBus` — all core signals defined; `lobby_state_updated` drives lobby UI refresh
- [x] `CommandQueue` — single conduit for all outgoing server commands; validates auth +
      connection
- [x] `MsgPack` autoload — msgpack encode/decode for Colyseus binary protocol (Colyseus 0.17)
- [x] Main menu scene (`scenes/main_menu/`) — login form, create/join/browse lobby buttons
- [x] Lobby scene (`scenes/lobby/`) — nation list, player list, ready/start; debug autofill
      credentials
- [x] Postgame scene stub (`scenes/postgame/`)
- [x] `client/assets/data/western_europe_6/nations.json` — 6 playable nation definitions

### Testing
- [x] `scripts/e2e-session-loop.sh` + `game-server/test/session-loop.e2e.ts` — 11-step bot
      E2E test
- [x] `docs/LOCAL_TESTING.md` — two-instance Godot testing guide with debugging gotchas

### Verification gate
Player A creates lobby → bot joins → both pick nations → start → bot sends a VOTE_SPEED →
game ends cleanly → results posted to Hono.

> **Phase 3 completed 2026-06-02.** E2E bot test passes all 11 steps
> (`bash scripts/e2e-session-loop.sh`). Two Godot instances verified in local play: login →
> create lobby → join by code → select nations → ready up → start → both transition to game
> scene. See `docs/LOCAL_TESTING.md` for setup instructions and a record of debugging gotchas
> (Colyseus 0.17 protocol, GDScript lambda closures, `.tscn` unique_name_in_owner syntax).

---

## Phase 4 — Strategic Military Core

**Goal:** Divisions exist on the map, move, and engage. Combat resolves at the strategic layer
only (no tactical grid yet). Province capture works. The RTS feel is playable. Pathfinding
uses the two-level road + waypoint graph. Stacking mechanics and encirclement debuffs work.

**Why before tactical grid:** The strategic movement and engagement area system is the
foundation the tactical grid sits on. Getting division dots moving, engagement areas
colliding, and basic combat states (Engaged → Suppressed → Retreat → Destroyed) working
end-to-end first means the tactical grid can be layered on top cleanly in Phase 5.

**Testing:** Bot client sending opposing move orders and engaging your Godot client.
Unit tests for movement profile computation and A* path validity.

### Pipeline (prerequisite — before Phase 4 Godot work)
- [ ] Waypoint graph generation step added to `pipeline.py` — sample terrain rasters at
      ~750m intervals, assign cover_combat + elevation to each node, compute base_cost per
      edge (cover_move × elevation_move), flag river-crossing edges with river_size, connect
      road graph endpoints to nearest waypoint nodes
- [ ] Output: `waypoints.json` written to `godot/assets/data/<map_id>/`
- [ ] Pipeline summary updated to print waypoint node count alongside province count

### Colyseus (server-side simulation)
- [ ] Division spawning at game start (from starting positions config per nation)
- [ ] Nation config loaded at game start from `nation_config` per nation per map;
      current map uses balanced config (cavalry available to all, no unique modifiers,
      same research starting points); engine reads config and never hardcodes nation identity
- [ ] Division type classification — three types only (no Defensive type):
      armoured (>=40% armoured cells), motorised (15-39% armoured), infantry (remainder)
- [ ] Engagement radius computed from template composition at spawn and on template change:
      base 50 (infantry floor); subtract 5 per 10% armoured fraction above 15%;
      subtract 2 per 10% cavalry fraction; clamp to [30, 50] map units;
      recomputed same trigger as movement profile (template save / research upgrade)
- [ ] Division movement profile — computed from template at spawn and on template change;
      33-value table (11 cover_combat × 3 elevation) using weighted formula:
      (min_cost × 0.4) + (mean_cost × 0.6) per terrain; impassable if any unit has ∞ cost;
      cached server-side for path validation
- [ ] Division movement tick — advance toward player-set target waypoints each server tick;
      speed = road_level speed on roads; slowest-unit speed off-road from movement profile
- [ ] Engagement area collision detection — circular areas, radius by division type;
      full overlap triggers COMBAT_STARTED
- [ ] Attacker/defender determination at combat initiation:
      Tier 1: explicit ADVANCE vs HOLD orders; Tier 2: movement vector angle vs intercept
      line (<45° = attacker); Tier 3: both advancing = meeting battle (neither gets terrain
      bonus); Tier 4: fewer province holdings = defender
- [ ] Terrain modifiers applied at combat initiation — sample midpoint pixel for cover and
      elevation; apply defender bonus + attacker penalty from composable modifiers;
      apply transition modifier (attacker terrain tier vs midpoint tier)
- [ ] River crossing check at combat initiation — line segment between division centres
      intersects rivers.geojson → penalty applied to attacker for rounds 1-2 (minor) or
      1-3 (major)
- [ ] Observation area — divisions within observation radius appear as dots;
      movement path visible if within observation range
- [ ] Scouting range (shorter inner circle within observation area):
      - [ ] At base scouting range: unit category counts visible to enemy player
            (e.g. '3 armoured, 8 infantry') but not specific unit types
      - [ ] At upgraded scouting (research): specific unit types visible
      - [ ] At max scouting tier: full 5×5 grid composition visible
      - [ ] Scouting radius = max recon unit scouting range in template
      - [ ] Research upgrades two axes per recon unit: radius and detail quality
      - [ ] Scouting range circle shown only on hover of enemy dot within range;
            composition panel appears on hover
      - [ ] Stealth units not revealed by scouting unless anti-stealth level met
- [ ] Move order persistence:
      - [ ] Divisions with active move orders resume them after combat if not retreated
      - [ ] Move orders can be issued during combat; queued for post-combat execution
      - [ ] Defender status locked at combat initiation — move order given during
            combat does not reclassify defending division as attacker
- [ ] Strategic combat resolution (simplified) — HP and suppression tracked at division
      level (no 5×5 grid yet); combat ticks apply attrition per round
- [ ] Combat states: Engaged → Suppressed → Retreat → Destroyed (full state machine)
- [ ] Auto-retreat for defenders when suppressed (base 60% threshold) + road open
- [ ] Auto-retreat for attackers at higher threshold (base 80%) — attackers hold longer
      before breaking; manual retreat always available at any suppression level;
      encirclement takes precedence (auto-retreat disabled when no escape route)
- [ ] Meeting battle icon state — distinct from standard Engaged
- [ ] Positional stack mechanics:
      - [ ] Allied divisions at same position form ordered stack; player can reorder
      - [ ] Only first division engages enemy; on suppression threshold → rotates to back
            of stack, second steps forward (no physical retreat until last division suppressed)
      - [ ] Supply priority: first division gets supply first; remainder get overflow
      - [ ] Encirclement applies to whole stack — rotation does not help if surrounded
- [ ] Three-tier supply/encirclement status system (checked each supply tick):
      - [ ] Tier 1 — Out of Supply: supply connectivity check fails (<50% friendly
            influence on waypoint path to any supply hub); debuffs: no HP recovery,
            slow suppression threshold decay, reduced movement speed; clean retreat
            still available; `OUT_OF_SUPPLY` event fires
      - [ ] Tier 2 — Cut Off: no retreat path through ≥50% friendly-influenced
            waypoints in any direction; all Tier 1 debuffs plus fighting withdrawal
            on retreat (division takes HP damage proportional to enemy influence
            density along escape path); `CUT_OFF` event fires
      - [ ] Tier 3 — Encircled: 8-direction check from division centre — all 8
            directions blocked by enemy division engagement area overlap OR ≥70%
            enemy influence; retreat command disabled; all Tier 2 debuffs plus:
            - Armoured units: damage output decays per tick → 0 after N ticks
            - Infantry units: slower degradation than armour
            - All units: suppression threshold lowered further per tick
            `ENCIRCLED` event fires
      - [ ] Status degrades one tier at a time — cannot jump directly to Tier 3
      - [ ] Destruction: last stack division in Tier 3 hits suppression threshold
            → destroyed (not retreated); experience and template lost permanently
- [ ] Province capture — ownership transfers when defending division/stack is destroyed or
      retreated; city node must be physically occupied by capturing division
- [ ] Angle-based flanking system:
      - [ ] When second enemy division's engagement area overlaps an already-engaged
            division, compute angle at defender between line-to-attacker-1 and
            line-to-attacker-2 (dot product of the two vectors)
      - [ ] < 90°: no flanking bonus — converging frontal assault only
      - [ ] 90°–135°: standard flank attack bonus (% damage increase to second attacker)
      - [ ] 135°–180°: enhanced rear attack bonus (higher % damage increase)
      - [ ] Angle classification locked at moment of second contact initiation;
            not recalculated mid-combat (prevents bonus loss from minor drift)
      - [ ] `FLANK_ATTACK` and `REAR_ATTACK` events broadcast on classification
- [ ] Dynamic frontline influence computation per province per tick:
      - [ ] Both sides' units contribute influence simultaneously — frontline is net
            result of all nations competing, not a binary ownership flag
      - [ ] unit_influence[nation][province] = sum(hp_fraction × distance_falloff)
            for all divisions of that nation whose engagement area overlaps the province
      - [ ] Recon units excluded from influence calculation
      - [ ] HP fraction = aggregate living HP / max possible HP for full 25-unit grid
      - [ ] Ownership bonus: province owner gets passive influence bonus from ownership
            (administrative control, infrastructure, road network); added to unit influence
      - [ ] total_influence[province] = sum across all nations;
            nation_share = nation_influence / total_influence
      - [ ] City capture: ownership bonus flips to new owner immediately; previous owner
            loses bonus and projects influence only from unit positions + roads they
            physically control (same rules as attacker before capture)
      - [ ] Frontline does not snap to fully new-owner-coloured on capture — previous
            owner's unit-based influence persists wherever their units remain
      - [ ] Broadcast province influence values to all connected players each tick
            (belligerents receive full data; neutrals receive province-level scalars only,
            not division positions or compositions)
- [ ] Frontline supply connectivity check (separate from road graph supply):
      - [ ] Trace backward from division position through waypoint graph to nearest supply hub
      - [ ] Check each waypoint: if influence < 50% friendly, connection broken
      - [ ] Division with broken connectivity enters out-of-supply state
      - [ ] `SUPPLY_SEVERED_FRONTLINE` event when connectivity breaks
      - [ ] `SUPPLY_RESTORED_FRONTLINE` event when connectivity resumes
- [ ] `COMBAT_STARTED`, `COMBAT_RESULT`, `MEETING_BATTLE_STARTED`, `PROVINCE_CAPTURED`,
      `UNIT_DESTROYED`, `STACK_ROTATION`, `DIVISION_ENCIRCLED`, `SUPPLY_SEVERED_FRONTLINE`,
      `SUPPLY_RESTORED_FRONTLINE`, `FRONTLINE_UPDATED` events
- [ ] Basic supply — divisions out of supply take increased attrition (simplified supply
      model; full graph-based supply is Phase 6)

### Godot
- [ ] `waypoints.json` + `roads.geojson` loaded at game start and merged into unified A*
      graph; movement profile applied at query time per selected division
- [ ] A* pathfinding — road edges win naturally via low cost; off-road waypoint edges use
      division movement profile multiplier; infinity-cost edges excluded; river crossing
      penalty on flagged edges
- [ ] `MilitarySystem` — division dot rendering, selection, move orders, stack badge display
- [ ] Engagement area rendering:
      - [ ] Own engagement area: solid circle, radius from composition-based formula
      - [ ] Enemy engagement areas: faded/dashed circle — visible to all players;
            essential for players to judge flanking angle before committing
      - [ ] Observation area: larger faded circle (always larger than engagement area)
      - [ ] Scouting range: innermost circle, shown only on hover of enemy dot
            within scouting range
- [ ] Division status visual indicators (all stackable, no conflicts):
      - [ ] Engaged: subtle pulse on division dot; combat icon over engagement point
      - [ ] Out of Supply (Tier 1): amber supply icon below dot
      - [ ] Cut Off (Tier 2): red supply icon + broken chain symbol
      - [ ] Encircled (Tier 3): red ring around division dot (most dominant indicator)
      - [ ] Flank attack (90°–135°): diagonal arrow on flanking division dot
      - [ ] Rear attack (135°–180°): double diagonal arrow on flanking division dot
      - [ ] Meeting battle: distinct head-on combat icon (not standard crossed swords)
      - [ ] Retreating: retreat arrow on dot pointing direction of withdrawal
      - [ ] Redeploying: dot greyed out with gear/refresh symbol
- [ ] Tactical combat pop-up button on combat icon (crossed-swords symbol):
      opens 5×5 vs 5×5 grid panel with HP/suppression bars, experience badges,
      formation bonus glows, row perk labels, attack pattern overlay, recon indicator,
      terrain modifier display, river crossing penalty indicator, round timer,
      flanking angle indicator showing measured angle and active bonus tier
- [ ] Client rendering uses **LERP smoothing only** — no client-side prediction.
      On state update: cache server position. In `_process(delta)`: lerp visual
      position toward server position at ~10× speed. Snap directly if distance
      exceeds threshold (e.g. redeployment teleport). HP bars, suppression bars,
      and frontline colour values all lerp the same way between server updates.
      Server is always authoritative — client never simulates movement itself
- [ ] Observation radius computed as max recon unit range in template; baseline radius
      for divisions with no recon units; updates when movement profile recomputes
- [ ] Move order UX:
      - [ ] Select division → press M (or Move button) → cursor enters move mode
      - [ ] Single click: pathfind to destination, one waypoint, division deselected
      - [ ] Shift+click: add waypoint to chain, division stays selected and in move mode
      - [ ] Escape: cancel move mode, clear pending waypoints
      - [ ] Right-click existing waypoint: delete it from chain
      - [ ] Click moving division: show remaining waypoints; allow chain editing
      - [ ] Ghost dot at each waypoint: faded division icon + faded engagement circle;
            observation radius shown on hover only; estimated arrival time tooltip
      - [ ] Ghost dots and paths: visible to owner and allies; visible to enemy/neutral
            only if ghost dot falls within their observation radius
- [ ] Hotkey system: Q=Military, E=Economy, R=Diplomacy, F=Politics, Tab=toggle panels,
      M=Move, H=Hold, G=Retreat, X=Cancel, all remappable via InputMap
- [ ] Stack UI — ordered stack panel; drag to reorder; first/reserve indicators
- [ ] `CombatSystem` — combat icon rendering (standard Engaged vs Meeting Battle icons),
      HP bar, suppression pulse, round phase indicator
- [ ] `FrontlineRenderer` — province interior colour wash shader driven by per-province
      influence values received from server:
      - [ ] Each province interior shaded by blending owner's predefined nation colour
            (baseline) with dominating nation's predefined nation colour proportional to
            their influence advantage
      - [ ] Frontline isoline rendered at 50% influence threshold, smoothed with curve
            fit for organic appearance; purely cosmetic, no mechanical role
      - [ ] Province borders remain static (political map, never changes)
      - [ ] City node marker on each province; changes to capturing nation's icon on
            `PROVINCE_CAPTURED`; province baseline colour updates to new owner
      - [ ] Neutral player receives same province influence scalars; sees colour wash;
            does not see enemy division dots outside their own observation radius
      - [ ] Intensity of colour wash proportional to division HP fraction — fading colour
            regions indicate weakening fronts readable without opening any panel
- [ ] `MapRenderer` update — recolour province baseline on `PROVINCE_CAPTURED`; shader
      continues to apply influence wash on top of new baseline colour
- [ ] `NotificationSystem` — combat started, meeting battle, suppression threshold,
      stack rotation, encirclement, division destroyed, supply severed via frontline toasts

### Verification gate
Move division → pathfinding finds road route automatically → manually draw off-road route
through forest → armoured division cannot enter dense_forest → infantry division can.
Bot division advances toward player → attacker/defender determined by movement vectors →
terrain bonus applies to defender. Both advancing head-on → meeting battle icon appears,
neither gets terrain bonus. Commit second division to already-engaged enemy → flanking
bonus applies. Stack two friendly divisions → first engages → hits suppression → rotates →
second steps up → combat continues without physical retreat. Last stack division suppressed
with no escape route → entire stack destroyed. Encircled armoured division → damage output
decays over ticks → eventually deals zero damage.
Engagement radii: pure infantry template has radius ~50; pure armoured has radius ~30;
verify formula clamps correctly at both extremes. Enemy engagement area visible as
faded circle — own unit moving toward enemy can see enemy's engagement area before
entering it. Flanking angle: two units attack defender from 85° → no bonus; reposition
second unit to 95° → FLANK_ATTACK fires → standard bonus applied; reposition to 140°
→ REAR_ATTACK fires → enhanced bonus. Angle classification locked at first contact —
minor drift during combat does not change the bonus tier.
Frontline: advance division into contested province → province interior colour begins
washing toward advancing nation’s predefined colour → recon unit advance does not shift
colour. Both attacking and defending units contribute influence simultaneously → frontline
sits where forces balance. Division takes HP damage → colour intensity fades. Enemy advance
cuts through province influence chain → OUT_OF_SUPPLY fires → attrition begins; player
pushes relief force → supply restored. No relief comes → CUT_OFF fires → retreat triggers
fighting withdrawal (division takes damage while moving). Enemy divisions close all 8
directions → ENCIRCLED fires → retreat disabled → armour damage decays per tick →
division suppressed → destroyed (not retreated). Division captures city node → ownership
bonus flips to new owner immediately → previous owner’s unit influence persists where
their units are → frontline shifts but does not snap fully → province border unchanged.
Friendly colour persists along roads still defended by retreating forces. Neutral observer
sees colour wash shifting but not enemy division dots outside their observation radius.

---

## Phase 5 — Tactical Grid

**Goal:** The 5×5 grid activates when strategic combat initiates. Grid composition determines
combat outcomes. The auto-battler loop works end-to-end. Nation preset templates are playable.

**Why after Phase 4:** Phase 4 proves the strategic layer works. Phase 5 replaces the
simplified strategic attrition model with proper tactical grid resolution while keeping all
Phase 4 strategic plumbing intact.

**Testing:** Bot clients with opposing preset templates fighting each other. Unit test suite
for all attack pattern logic before any Godot work.

### Colyseus (server-side simulation)
- [ ] 5×5 grid state per division — each cell tracks unit type, HP, suppression value,
      experience tier (Green/Seasoned/Veteran/Elite)
- [ ] Round system — combat resolves in discrete rounds (target: 20 seconds per round);
      5-phase lethality escalation (Contact → Firefight → Intense → Decisive → Annihilation)
- [ ] All unit attack patterns server-side:
  - [ ] Infantry / MG — horizontal attack on frontmost occupied row (not always R5;
        targets first row with at least one living unit; damage distributed only among
        living units in that row)
  - [ ] Cavalry — horizontal attack like infantry; charge bonus (higher HP damage and
        suppression) in Round 1 only; standard infantry values from Round 2+; very high
        MG suppression vulnerability; moderate-high observation radius contribution;
        moderate stealth in forest/hills; fastest off-road unit type in movement profile
  - [ ] Armour — vertical column attack with depth rule + flanking/envelopment column shift;
        column shift disabled in dense_forest and urban terrain
  - [ ] AT infantry / AT gun — column selective targeting, side armour on column shift;
        picks one direction only (not both adjacent columns)
  - [ ] AA gun — passive defence vs air (no ground attack role)
  - [ ] Sniper — selective targeting across full grid with priority list (fallback to
        standard infantry when no priority targets present)
  - [ ] Flamethrower — 3-column × 2-row AOE anchored at fixed row offset from unit
        position (1 row ahead of own position, not anchored to enemy contact row)
  - [ ] Artillery — recon-proportional weighted random cell targeting
- [ ] Row positional perks applied per round:
      R5 Vanguard: +% suppression dealt; R4 Assault: +% HP damage dealt;
      R3 Support: +% suppression resistance; R2 Reserve: faster suppression decay;
      R1: no bonus
- [ ] Formation bonus detection — check adjacency of unit pairs each round; apply bonuses
      for confirmed pairs (AT+MG, Sniper+Recon inf, FLM+Assault inf, MG+MG same row,
      Artillery+Recon inf)
- [ ] Unit experience system:
      - [ ] Experience accumulates per unit per combat round survived + win bonus
      - [ ] Four tiers: Green → Seasoned → Veteran → Elite (diminishing returns curve)
      - [ ] Tier stat bonuses: HP%, suppression resistance%, recon contribution%
      - [ ] Experience is per cell slot — lost permanently if unit destroyed
      - [ ] Stealthed units that survive to reserve retain their experience tier
      - [ ] Barracks building grants training experience during non-combat downtime
            (up to tier unlocked by research; not above)
- [ ] Dual-bar system — HP (permanent) and suppression (decaying) tracked per cell
- [ ] Suppression decay per round (base rate); 2–3× faster during retreat; no instant reset
- [ ] Division-level suppression threshold (base 60%) → feeds Suppressed state in strategic
      layer; stealthed units excluded from threshold calculation
- [ ] Unit incapacitated state:
      - [ ] Infantry/cavalry/sniper/commando/flamethrower/MG/AT-inf/recon-inf: incapacitate
            at ~20% HP — zero damage, zero suppression, not targeted, not counted toward
            retreat threshold, HP stops decaying from combat
      - [ ] Armoured units: incapacitate at ~30% HP (mobility kill threshold)
      - [ ] Artillery, towed AT gun, AA gun: no incapacitation — fight until destroyed
      - [ ] Incapacitated units recover HP via supply when division not engaged
      - [ ] Experience on incapacitation: unit retains 60% of combat experience gained
      - [ ] Incapacitated units destroyed if division is destroyed (even at HP > 0)
      - [ ] `UNIT_INCAPACITATED`, `UNIT_RECOVERED` events
- [ ] Armour penetration scale (60/70/80/90/100% thresholds → 0/20/30/40/70/100% damage)
- [ ] Stealth system — stealthed units deal damage, cannot be targeted, excluded from retreat
      threshold; destroyed division puts stealthed units into reserve with experience retained
- [ ] Recon value accumulation per round per unit type; formation bonus (Artillery+Recon inf)
      increases recon rate; artillery targeting weight shifts with recon
- [ ] Force recon units bypass lethality ramp — deal full damage from Round 1
- [ ] Terrain modifiers feeding into grid combat (from Phase 4 terrain detection):
      unit-type specific bonuses by cover_combat (infantry suppression resistance in forests,
      armour flanking bonus in plains, AT ambush bonus in forest, etc.)
- [ ] Grid locked during combat — no template switching while engaged
- [ ] Movement profile recomputed whenever template is saved or unit research changes
- [ ] `ROUND_RESOLVED` event broadcast each round with full grid delta including experience
      changes and formation bonuses active
- [ ] `TACTICAL_BREAKTHROUGH` event when front row cleared with no reserves
- [ ] `UNIT_EXPERIENCE_GAINED`, `UNIT_ELITE_REACHED` events

### Hono
- [ ] `/divisions` CRUD routes — basic template persistence including movement profile
      cached alongside template; invalidated on research upgrade (minimal; full persistence
      in Phase 7)
- [ ] Nation preset templates served from `game-server/src/data/templates/<nation_id>/`
- [ ] `/internal/player/:user_id/templates` — loads player templates + movement profiles
      into Colyseus at game start

### Godot
- [ ] `TacticalGridUI` — the 5×5 grid panel, opened via combat button on combat icon;
      shows both grids, HP/suppression bars per cell, experience tier badge per cell,
      formation bonus indicators (glow on active adjacency pairs), row perk labels,
      attack pattern overlay, recon indicator, terrain modifier display, river crossing
      penalty indicator and remaining rounds, round timer
- [ ] Combat icon enhancements — aggregate HP bar, suppression pulse, round phase dots,
      meeting battle vs standard Engaged icon (from Phase 4)
- [ ] Combat button — appears over active combat icons, opens `TacticalGridUI`
- [ ] `DivisionBuilder` (MVP) — template builder UI in main menu; create/edit/save custom
      templates; shows movement profile summary (which terrains are impassable, slowest
      terrain); formation bonus preview (highlight when placing adjacent synergy units);
      select from nation presets in lobby; cavalry unit available to all nations per
      nation_config; motorised toggle available after motorisation research (Phase 8);
      mechanised infantry unit available after armour research branch unlocks it (Phase 8+)
- [ ] Template redeployment — switch template when out of combat; 1-minute flat cooldown;
      division redeploys at nearest friendly city; experience on existing units lost on redeploy
- [ ] Movement profile displayed on division selection — player can see what terrain their
      selected division can/cannot traverse before issuing a move order

### Verification gate
Two opposing preset templates fight — grid resolves rounds, suppression builds, one division
hits threshold and retreats at strategic layer. Open combat panel — see grid updating live
with HP bars, suppression, experience tier badges. Force recon unit deals full damage in
Round 1. Artillery misses more at zero recon, improves over rounds. Flamethrower in R4
reaches enemy R3 (not R4-R5 only). Infantry attacks frontmost occupied row — if enemy R5
is empty, hits R4 and concentrates damage on occupied cells only. Place AT adjacent to MG —
formation bonus indicator appears. Armoured division in dense_forest — column shift flanking
disabled. Division survives multiple combats — unit tiers advance to Seasoned → Veteran.
Research upgrade applied → movement profile recomputed → player can now enter terrain
previously impassable for that unit type.

---

## Phase 6 — Supply System

**Goal:** Full road-segment graph supply replaces the simplified Phase 4 supply model.
Encirclement via supply cut is a reliable, satisfying outcome. Air interdiction of roads works.

**Why its own phase:** Supply is architecturally complex (graph flow on the adjacency data from
MAP_DATA_CONTRACT.md) and interacts with the military, economy, and air layers. Separating it
ensures it can be tested and tuned in isolation before the other layers depend on it.

**Testing:** Unit tests for graph flow math. Bot clients testing encirclement scenarios.

### Colyseus
- [ ] Supply graph — road segments from adjacency data carry throughput capacity per road level
- [ ] Supply hub building generates supply at a rate that flows outward from its node through
      the graph each tick
- [ ] Divisions draw supply from the segment they currently occupy
- [ ] Segment cut detection — enemy unit physically occupying a node, or province capture
      breaking a supply path, reduces downstream throughput
- [ ] Out-of-supply attrition — divisions below supply threshold take increased HP decay per
      tick (rate set by playtesting)
- [ ] Encirclement detection — no land escape route + no supply → division marked for
      accelerated destruction
- [ ] `SUPPLY_DISRUPTED`, `SUPPLY_RESTORED`, `DIVISION_ENCIRCLED` events

### Hono
- [ ] Supply hub building persisted via `/internal/game-end` in player results

### Godot
- [ ] `SupplySystem` — road segment throughput visualisation; truck sprites on active
      segments; dim/broken visual for disrupted segments
- [ ] Supply status indicator on division icons — subtle colour shift when out of supply
- [ ] `NotificationSystem` additions — supply disrupted, encircled warnings

### Air interdiction integration
- [ ] Colyseus logistics strike handler reduces segment throughput for N ticks
- [ ] Both low-altitude (direct, no recon) and high-altitude (recon-proportional) variants
      resolve against the supply graph correctly

### Verification gate
Division advances beyond supply hub range → supply drops → attrition begins. Enemy cuts the
supply road → supply stops immediately → attrition accelerates. Enemy fully encircles a
division → division destroyed even at high HP. Air logistics strike dims a road segment and
reduces downstream division supply for the correct duration.

---

## Phase 7 — Player Persistence

**Goal:** Division templates persist between sessions. Stats accumulate after each game.
Full template builder is complete.

### Hono
- [ ] `/divisions` CRUD routes fully implemented and tested (extended from Phase 5 MVP)
- [ ] `/internal/game-end` updates player stats (games_played, games_won, playtime_hrs)
- [ ] `/internal/player/:user_id/templates` loads full template set into Colyseus at game
      start (extended from Phase 5 MVP)

### Supabase
- [ ] `division_templates` table + RLS policy

### Godot
- [ ] `PlayerProfile` — fetch and cache profile, stats, cosmetics
- [ ] `DivisionBuilder` (full) — complete template builder; save/load/delete custom templates;
      mid-game template editing when out of combat; redeployment flow
- [ ] `SupabaseClient` — direct reads for own profile data

### Colyseus
- [ ] On game start: fetch each player's full template library from Hono, make available
      for redeployment during session

### Verification gate
Create custom template in main menu → start game → redeploy a division to that template
→ 1-minute cooldown → division reappears at nearest city with new composition → game ends
→ stats updated → check profile shows correct games_played.

---

## Phase 8 — Economy + Diplomacy + General Technology

**Goal:** Resources accumulate, buildings can be constructed, players can form alliances
and declare war. General Technology research (motorisation) is available.

**Testing:** Bot client for diplomacy (needs two-player proposals/responses).

### Colyseus
- [ ] Economy tick — resource generation per province per tick, stored in player state
- [ ] `BUILD` handler — construct buildings in provinces (costs resources); supply hub,
      fort, port, airbase, factory, barracks
- [ ] General Technology research panel — motorisation node (mid-tier); once researched,
      applicable infantry units can be toggled to motorised versions in template builder;
      movement profile recomputed on toggle; zero grid combat stat change
- [ ] `PROPOSE_DIPLO`, `RESPOND_DIPLO`, `BREAK_DIPLO` handlers
- [ ] Relation state updates, `DIPLO_PROPOSAL`, `DIPLO_ACCEPTED`, `DIPLO_REJECTED` events
- [ ] Alliance combat rules — allied units do not engage each other
- [ ] Map-sharing agreement — allied nations can see all division dots, paths, and
      composition of each other regardless of observation radius

### Godot
- [ ] `EconomySystem` — resource bars, production display from GameState
- [ ] `DiplomacySystem` — proposal cache, propose/respond methods
- [ ] `DiplomacyUI` panel — propose alliance, accept/reject incoming proposals, treaty list,
      map-sharing agreement option
- [ ] `EconomyUI` panel — resource overview, province production detail, build queue
- [ ] `ResearchUI` panel — General Technology tree; motorisation node; research progress;
      motorised toggle per unit type in DivisionBuilder unlocks after research completes

### Verification gate
Resources tick up → build a supply hub → propose alliance to bot → bot accepts → bot's units
no longer engage yours → break alliance → war declared → supply hub generates supply flow.

---

## Phase 9 — Air Combat

**Goal:** Air wings exist, can be assigned missions, and affect land combat and supply.
Air-to-air combat drives off enemy wings. CAS damage lands on the tactical grid.

**Testing:** Bot clients assigning air wings to the same province and fighting for air
superiority. Unit tests for all damage pattern calculations.

### Colyseus
- [ ] Air wing state — 3×5 grid composition, current mission, province assignment, strength
- [ ] Mission assignment handler — CAS, logistics strike, infra strike, air superiority,
      interception
- [ ] Air-to-air resolution — detection-proportional attacks between opposing wings each round;
      5% damage floor; winning wing drives off losing wing
- [ ] CAS damage patterns against land tactical grid:
  - [ ] 1×1 / 2×2 bomb hit — recon-proportional target cell
  - [ ] Row bombing — TAC bomber row targeting
  - [ ] Column strafing — rocket/MG strafing column targeting
  - [ ] Dive bomber — high precision single-cell high damage
- [ ] Logistics strike handler — reduces road segment throughput in province (integrates
      with Phase 6 supply graph)
- [ ] Infra strike handler — reduces building levels / province infrastructure value
- [ ] Detection accumulation — radar buildings, recon planes, passive air unit detection
- [ ] Distance penalty — damage reduction at extreme range from home air base
- [ ] AA gun integration — AA units in land division grid defend against air attack;
      low-altitude air takes AA damage when striking
- [ ] `AIR_COMBAT_STARTED`, `AIR_SUPERIORITY_LOST`, `AIR_WING_DRIVEN_OFF` events

### Godot
- [ ] `AirSystem` — air wing icons on provinces, mission assignment UI, wing strength display
- [ ] Air combat notification integration — air superiority lost, wing driven off, CAS
      active over combat toasts
- [ ] Nation preset air wing templates (historically flavoured per nation)

### Verification gate
Assign CAS wing to province with active land combat → tactical grid takes air damage each
round in correct pattern → assign enemy interceptor wing → CAS wing is forced into air
combat → CAS damage drops → interceptor wins → CAS wing driven off → land combat proceeds
without air support. Logistics strike dims a supply road segment. Radar building increases
detection value for air-to-air in its province.

---

## Phase 10 — Naval Combat

**Goal:** Flotillas with all ten ship classes exist on the strategic map. Three-zone
engagement resolves correctly. Submarine Active/Silent modes, class posture controls, fog of
war, and carrier presets all work. Port economy (three independent upgrade tracks per port),
trade routes, blockade system, naval bombardment, coastal battery and fort buildings, cargo
simulation with sinking events, and naval base shielding are all functional. Naval supply
interdiction feeds into the Phase 6 supply graph.

**Testing:** Bot flotillas of different compositions across all three zones. Unit tests for
class matchup math, ASW detection, torpedo reload, refit queue, blockade income reduction,
cargo sinking event probability, and coastal battery return fire. Bot submarines testing
Active/Silent transitions. Bot trade pacts testing route disruption.

### Colyseus — ship classes and flotilla state
- [ ] All ten ship classes defined with stats: ocean-going submarine, coastal submarine,
      fleet destroyer, escort destroyer, light cruiser, heavy cruiser, battleship,
      battlecruiser, fleet carrier, escort carrier
- [ ] Torpedo boat as nation-specific unit — available only to qualifying nations
- [ ] Flotilla state schema — variable ship counts per class, max 15–20 ships, current
      sea zone position, speed, engagement zone depth
- [ ] Per-class posture state within flotilla: Active (participates in zone duties) or
      Held Back (pulls to rear, does not engage, does not take battery/zone fire)
- [ ] Zone proximity calculation — shared zone geometry determined by flotilla separation

### Colyseus — zone combat resolution
- [ ] Screen zone: 30–50% random participation; ASW detection accumulation; escort
      destroyer 2–3× ASW multiplier; coastal submarine stealth bonus near coastlines;
      torpedo boat glass cannon behaviour
- [ ] Engagement zone: full participation; light/heavy cruiser class matchup; battleship
      and battlecruiser long-range artillery at ~20–30% Strike damage; torpedo reload
      mechanic across all torpedo-carrying classes
- [ ] Strike zone: all classes full effectiveness; battleship armour rules; battlecruiser
      vulnerability; fleet carrier hull exposed; escort carrier heavy damage

### Colyseus — movement and engagement
- [ ] Speed debuff in Engagement (mild) and Strike (significant)
- [ ] Retreat command — increased speed, increased incoming damage
- [ ] Involuntary deepening when holding position
- [ ] Zone transition timing: ~1 min Screen→Engagement, ~1 min Engagement→Strike

### Colyseus — submarine system
- [ ] Active mode: attacks generate cargo sinking events and combat icons; higher detection
- [ ] Silent mode: no sinking events, no icons; reduced detection; same submerged speed
- [ ] Coastal submarine stealth bonus in Silent mode near coastlines
- [ ] ASW pinning threshold — cannot enter Silent until detecting destroyer leaves or sinks
- [ ] Silent mode still reduces trade flow (threat presence) — income reduction without
      sinking events or location intelligence for the defending player

### Colyseus — carrier aircraft presets
- [ ] Six presets per carrier: CAP, Strike, Anti-submarine, CAS, Logistics Strike,
      Infrastructure Strike — all confirmed in scope for carrier aircraft
- [ ] CAS, logistics strike, and infrastructure strike: effective only against coastal
      provinces within flotilla zone range; recon-proportional for high-altitude delivery
- [ ] Preset switchable between rounds when not in Strike zone
- [ ] AA defence from light cruisers scales damage to attacking carrier aircraft

### Colyseus — port economy and infrastructure
- [ ] Three independent upgrade tracks per port (not per province): port level, naval base
      level, supply base level — each built and levelled separately with resources
- [ ] Multiple ports per province each have their own independent upgrade levels
- [ ] Port level: passive income per tick scales with level; trade route throughput capacity
- [ ] Naval base level: governs repair rate, repair capacity (simultaneous ships = base
      level), refit capacity, and new ship construction throughput — all share the same
      slot pool; repair takes priority over refit; repair slots occupied → construction
      slows proportionally or stops if all slots full; HP damage reduction for docked
      ships (~10–15% at level 1, ~40–50% at max); applies only to docked ships
- [ ] Supply base: acts as supply hub (same graph flow as Phase 6 inland supply hubs);
      deactivates when port sea zone is under full blockade (Engagement range or deeper)
- [ ] Coastal battery building: fires at surface flotillas overlapping port sea zone at any
      zone level; does not fire at submerged submarines; damage scales with battery level:
      meaningful vs destroyers/light cruisers, reduced vs heavy cruisers/battlecruisers,
      very low vs battleships; fires during blockade as well as bombardment
- [ ] Fort building (one per province, protects all coastal batteries in province): reduces
      HP damage received by coastal battery from bombardment; reduces air infra-strike damage
      to coastal battery; does not increase battery damage output
- [ ] `PORT_BLOCKADED`, `PORT_BLOCKADE_LIFTED`, `COASTAL_BATTERY_DESTROYED` events

### Colyseus — trade routes and blockade
- [ ] Trade pact integration: when PROPOSE_DIPLO trade pact accepted, each player designates
      which of their ports to route through (player choice, not forced to highest level)
- [ ] Trade route drawn as a sea-lane on the map from chosen port to partner's port
- [ ] Resource trade: player draws route from chosen port to target port; terms agreed
      bilaterally; route drawn manually
- [ ] Trade income per tick: proportional to product of both designated port levels;
      reduced by trade route length (longer = lower income; exact decay from playtesting)
- [ ] Trade route visibility: visible within naval observation radius (maritime patrol
      reveals routes in patrolled zones); own routes always visible; diplomatic trade routes
      visible to both parties regardless of observation
- [ ] Blockade tiers:
  - [ ] Screen range over mid-ocean route: ~20–30% income reduction; cargo sinking events
  - [ ] Screen range over port sea zone directly: ~50–70% income reduction; coastal battery
        fires at surface blockaders; submarine blockade immune to battery
  - [ ] Engagement range or deeper: 100% income disruption; supply base deactivated;
        port passive income to zero; naval base shielding applies only to docked ships
- [ ] Income reduction begins immediately when threat conditions met; "Trade route disrupted"
      notification fires before first sinking event

### Colyseus — cargo simulation (sinking events)
- [ ] Probabilistic interception events per tick per trade route — probability scales with
      threat level (Active submarine present, blockade depth)
- [ ] Sinking event fires: flow reduction for N ticks; cargo sinking notification to owner
      with sea zone location; brief visual combat icon at interception location; slight naval
      detection increase for defending player in that sea zone
- [ ] Silent mode submarines: reduce income flow via threat presence but generate no sinking
      events — defending player gets no location intelligence from income loss alone
- [ ] `CARGO_SUNK`, `TRADE_DISRUPTED`, `TRADE_RESTORED` events

### Colyseus — naval bombardment
- [ ] Cruiser bombardment: when flotilla Engagement ring overlaps coastal province, cruisers
      deal HP damage to buildings; destroyers deal suppression to land divisions in province
- [ ] Battleship bombardment: requires Strike range; coastal provinces only; battleships
      deal high HP damage to buildings; fort buildings degraded only by battleship-level
      bombardment (not cruiser fire)
- [ ] Coastal battery return fire during both bombardment types
- [ ] Fort reduces bombardment damage received by coastal battery during Strike bombardment

### Colyseus — refit system
- [ ] Module slot schema per ship class (3–5 slots)
- [ ] Module variants unlocked by research tree; stored per nation
- [ ] Doctrine template per class — default loadout for new ships
- [ ] Bulk doctrine push — all ships of class queued; lump sum resource cost
- [ ] Individual ship override — non-doctrine loadout via ship detail panel
- [ ] Refit only in port or Screen zone of friendly coastal province; impossible in
      Engagement or Strike range
- [ ] Flat ~1–2 min per ship; queue runs passively
- [ ] `REFIT_QUEUED`, `REFIT_COMPLETE`, `MODULE_UNLOCKED` events

### Colyseus — fog of war and supply
- [ ] Enemy flotilla positions not revealed; combat icons only
- [ ] Maritime patrol aircraft reveals approximate enemy flotilla positions and trade routes
      in patrolled zones
- [ ] Naval supply interdiction: Active submarine flow reduction on coastal supply paths
      (feeds Phase 6 supply graph)
- [ ] Zone lethality system:
      - [ ] Screen zone: ship withdrawal when HP drops to threshold (not zero);
            submarines destroyed if detected+pinned, otherwise withdraw damaged;
            Active-mode undetected submarine takes chip damage only
      - [ ] Engagement zone: higher lethality than Screen; damaged ships withdraw
            to port at HP threshold; destroyers and submarines can be destroyed here
      - [ ] Strike zone: no withdrawal during combat; ships fight to HP zero;
            damaged ships receive combat debuffs (accuracy, torpedo capacity, speed)
            but remain in combat
- [ ] Automatic repair system:
      - [ ] Damaged ships auto-queue for repair on arriving at friendly port
      - [ ] Repair rate proportional to naval base level
      - [ ] Repair capacity = naval base level (additional ships queue)
      - [ ] Repair slots shared with construction: occupied repair slots slow
            new ship construction proportionally
      - [ ] Refit queued behind repair for same ship (repair takes priority)
      - [ ] Ship auto-rejoins assigned flotilla at full HP — no player action needed
      - [ ] `SHIP_DAMAGED`, `SHIP_WITHDRAWN`, `SHIP_REPAIRING`, `SHIP_REPAIRED`,
            `CONSTRUCTION_SLOWED` events
- [ ] Port strike: naval base level reduces damage to docked ships
- [ ] Naval strike handler
- [ ] `NAVAL_CONTACT`, `NAVAL_ENGAGEMENT`, `NAVAL_STRIKE`, `FLOTILLA_DESTROYED`,
      `CONVOY_RAIDED`, `CARGO_SUNK`, `TRADE_DISRUPTED`, `TRADE_RESTORED`,
      `SUBMARINE_DETECTED`, `SUBMARINE_PINNED`, `PORT_BLOCKADED`, `PORT_BLOCKADE_LIFTED`,
      `COASTAL_BATTERY_DESTROYED`, `REFIT_COMPLETE` events

### Hono
- [ ] `/flotillas` CRUD — templates saved to account; nation presets served from
      `game-server/src/data/templates/naval/<nation_id>/`
- [ ] `/internal/player/:user_id/naval-templates` — loads templates at game start
- [ ] Research tree state persistence per session

### Godot
- [ ] `NavalSystem` — flotilla dots (friendly only); own zone rings visible; enemy rings
      never shown
- [ ] Combat icon system — Screen / Engagement / Strike icons; cargo sinking icons (brief)
- [ ] Class posture controls — Active / Held Back toggle per ship class within flotilla panel
- [ ] `FlotillaBuilder` — template builder; ship counts per class; carrier presets; nation
      presets in lobby
- [ ] Doctrine template panel — set loadout per class; bulk push button
- [ ] Ship detail panel — individual module override; refit status
- [ ] Submarine mode toggle UI — Active / Silent per submarine or flotilla
- [ ] Carrier preset selector — six presets per carrier
- [ ] Trade route UI — draw route line from own port to partner's port; route rendered as
      sea-lane on map; income and disruption status shown on hover
- [ ] Port panel — three independent upgrade tracks per port (port level, naval base,
      supply base); coastal battery and fort build buttons
- [ ] Naval notification integration — full notification set including cargo sinkings, trade
      disruption, blockade, bombardment events; 2-minute response window toasts

### Verification gate
Full engagement: own flotilla sails toward bot → Screen contact → notification fires →
Engagement icon → torpedo volley → Strike icon → battleship full effectiveness → one
flotilla retreats or destroyed. Submarine Silent → no icons, income drops → switches Active
near carrier → sinking event fires → location notification → ASW destroyer detects → pinned.
Carrier set to CAS preset → land division in adjacent coastal province takes air damage each
round. Trade route drawn → income generates → enemy submarine moves to Screen range over
port sea zone → 50–70% reduction → "Trade route disrupted" notification → cargo sinking
events fire with sea zone location → player vectors maritime patrol → submarine detected.
Enemy flotilla at Engagement range over port → full blockade → supply base deactivates →
nearby land divisions begin out-of-supply attrition. Port coastal battery fires at blockading
cruisers each tick → cruiser HP decreases → player switches destroyers to Held Back posture
→ stop taking battery fire. Battleship bombards coastal province at Strike range → fort
reduces battery HP loss → fort must be destroyed over multiple rounds before battery goes
offline. Naval base level 3 port → docked ships take ~35% reduced damage from port strike.

---
Repair/construction: fleet takes damage in Engagement zone → ships withdraw to port
automatically → repair queue fills to naval base level capacity → new construction
slows → ships repaired in order → auto-rejoin flotilla → construction resumes.
Zone lethality: ship in Strike zone takes damage → continues fighting with debuffs
(reduced accuracy visible in damage output) → not destroyed until HP reaches zero.
Screen zone submarine detection: ASW destroyer detects Active submarine → submarine
takes significant damage → destroyed before it can disengage.
Scouting: own recon armoured car division approaches enemy division → within scouting
radius → hover enemy dot → partial composition panel appears → upgraded recon → full
grid composition revealed. Move order: division with move order engages enemy → combat
resolves → division automatically resumes move order from current position.

## Phase 11 — Steam Auth Swap + Polish

**Goal:** Email auth replaced with real Steam auth. Core loop polished enough for first
playtesters. Notification system complete across all combat layers.

**Why late:** Steam auth requires a published Steam app ID and Steamworks review. Email auth
kept the JWT shape identical so this is a drop-in swap at the Hono layer.

### Hono
- [ ] `/auth/steam` — replace `/auth/email`. Calls `ISteamUserAuth/AuthenticateUserTicket`
      server-side
- [ ] Remove email auth routes

### Godot
- [ ] `SteamManager` — GodotSteam init, `getAuthTicketForWebApi()`, ticket hex-encoding
- [ ] `AuthManager` — swap email flow for Steam ticket flow
- [ ] Steam overlay integration (open store page, etc)

### Polish
- [ ] `HUDManager` — panel show/hide orchestration, keyboard shortcuts
- [ ] `NotificationSystem` — full event coverage across land, air, and naval; toast queue
      and animation; naval response window notifications
- [ ] `PostGameUI` — results screen, player rankings, stats delta display
- [ ] `MainMenuUI` — final polish, news/changelog panel
- [ ] `LobbyUI` — final polish, join code display, spectator option
- [ ] `SettingsUI` — audio, graphics, keybinds, saved to local config

### Verification gate
Launch via Steam → authenticate with real Steam account → play full game with land, air, and
naval active → all notification types fire correctly → postgame screen shows full results →
see Steam achievement unlock.

---

## Phase 12 — Later Modules

Full contracts written when implementation begins. Prioritise based on playtester feedback.

| Module | Priority | Purpose |
|---|---|---|
| `PoliticsSystem` | `[LATER]` | Nation ideology, government type, political decisions |
| `TechSystem` | `[LATER]` | Research tree — aircraft variants, tank upgrades, AT specialisations |
| `CosmeticSystem` | `[LATER]` | Apply owned unit skins and nation themes |
| `ShopSystem` | `[LATER]` | In-game cosmetic store and resale marketplace |
| `AudioManager` | `[LATER]` | Music tracks, SFX pool, volume settings |
| `VFXManager` | `[LATER]` | Combat particles, province capture flash, movement trails, supply truck animation |
| `MinimapSystem` | `[LATER]` | Small viewport minimap, click to pan |
| `SpectatorSystem` | `[LATER]` | Observe ongoing sessions read-only |
| `AchievementSystem` | `[LATER]` | Steam achievement unlocks from game events |
| `AIPlayerSystem` | `[LATER]` | Server-side AI for unfilled nation slots (Colyseus module) |
| `LobbyTimerSystem` | `[LATER]` | Auto-start lobby after configurable countdown. Requires `AIPlayerSystem`. |
| `AmphbiousSystem` | `[LATER]` | Shore bombardment and amphibious assault. Requires Phase 10 naval complete. |
| `MineWarfareSystem` | `[LATER]` | Minelayer and minesweeper ship classes. Sea zone denial via minefield placement. Requires Phase 10 naval complete. |
| `MidgetSubmarineSystem` | `[LATER]` | Harbour-penetration submarine variant. Requires naval-land integration design. |
| `WeatherSystem` | `[OPTIONAL]` | Weather overlay affecting terrain movement and combat. Visual + mechanical. |
| `GeneralSystem` | `[OPTIONAL]` | Attachable general units that modify division suppression threshold, retreat behaviour, and attack patterns. |
| `DoctrineSystem` | `[OPTIONAL]` | Nation-level doctrine trees modifying suppression thresholds, supply consumption, air mission effectiveness, naval refit costs. |

---

## Key Principles

- **Bot clients from Phase 3 onward.** One bot script per multiplayer scenario. Run them as
  regression tests whenever a new system is added.
- **Steam auth is Phase 11, not Phase 1.** Email auth keeps JWT shape identical — the swap
  is one Hono route change.
- **Server is always authoritative.** If a system needs client-side prediction later, add it
  then — don't pre-optimise.
- **Each phase has a verification gate.** Don't start the next phase until the gate passes
  cleanly.
- **Tactical grid is auto-battler.** Composition is the skill expression. The grid resolves
  without player input. Never add real-time grid micromanagement — it breaks session length
  and accessibility guarantees.
- **Casual floor, sweaty ceiling.** Every system must produce reasonable outcomes for players
  who never open the detail panel, while rewarding players who do.
