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
- [ ] `/auth/refresh` — token refresh *(deferred to Phase 15 — Steam auth swap)*
- [ ] `/profile` GET + PUT *(deferred to Phase 8 — player persistence)*
- [x] JWT signed with `{ sub: user_id, has_host_pass: bool, exp: 24h }`

### Supabase
- [x] `players` table + RLS policy
- [ ] `division_templates` table + RLS policy *(deferred to Phase 8)*
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
> via `scripts/e2e-auth-handshake.sh`. Steam auth deferred to Phase 15.

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
- [x] Game speed voting (`VOTE_SPEED` majority vote); pause/resume deferred to Phase 15
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
end-to-end first means the tactical grid can be layered on top cleanly in Phase 6.

**Testing:** Bot client sending opposing move orders and engaging your Godot client.
Unit tests for movement profile computation and A* path validity.

### Pipeline (prerequisite — before Phase 4 Godot work)
- [x] Waypoint graph generation step added to `pipeline.py` — **non-uniform density**:
      three tiers (open 0.20°/~22km: plains/steppe/desert/tundra; medium 0.10°/~11km:
      light_forest/shrubland/hills; complex 0.07°/~7.5km: dense_forest/jungle/swamp/urban/
      mountains); longitude steps are latitude-corrected; assign cover_combat + elevation
      to each node, compute base_cost per edge (cover_move × elevation_move); flag
      river-crossing edges with river_size; connect road graph endpoints to nearest
      waypoint nodes (K=3, within 0.11°); terrain-to-terrain K=8 within CONNECT_DEG=0.40°
- [x] Road edge cost set to `base_distance × 0.05` (road base 0.05/deg vs terrain 1.0+/deg)
- [x] Output: `waypoints.json` written to `client/assets/data/<map_id>/`
- [x] Pipeline summary prints waypoint node count alongside province count
- [ ] Hierarchical layer added to `pipeline.py` — partition the completed waypoint graph
      into clusters (provinces, since they're already a first-class map concept); for each
      cluster, pre-compute and cache optimal path cost between every pair of border nodes
      (nodes connecting to a neighbouring cluster); output an abstract graph (one node per
      border crossing) alongside the existing `waypoints.json`, not replacing it; see
      `docs/PATHFINDING.md` — Hierarchical Layer for the full approach and query-time
      behaviour. This item is new work, added after the original waypoint graph generation
      above and not part of what's already complete on this map
- See `docs/PATHFINDING.md` for the full waypoint graph generation spec and terrain cost tables

### Colyseus (server-side simulation)
- [x] Division spawning at game start (from starting positions config per nation)
- [ ] Nation config loaded at game start from `nation_config` per nation per map;
      current map uses balanced config (cavalry available to all, no unique modifiers,
      same research starting points); engine reads config and never hardcodes nation identity
- [ ] `STARTING_WARS` array in `nations.ts` — DEV ONLY, replace with real diplomacy
      in Phase 10: `[['germany','france'], ['germany','uk']]`; loaded into `war_matrix`
      in `GameRoom.onCreate()`; `at_war` 6×6 matrix sent to all clients at game start;
      frontline and influence only activates between nations where `at_war == true`
- [x] Division type classification — three types only (no Defensive type):
      armoured (>=40% armoured cells), motorised (15-39% armoured), infantry (remainder)
- [x] Engagement radius computed from template composition at spawn and on template change:
      base 50 (infantry floor); subtract 5 per 10% armoured fraction above 15%;
      subtract 2 per 10% cavalry fraction; clamp to [30, 50] map units;
      recomputed same trigger as movement profile (template save / research upgrade)
- [x] Division movement profile — computed from template at spawn and on template change;
      33-value table (11 cover_combat × 3 elevation) using weighted formula:
      (min_cost × 0.4) + (mean_cost × 0.6) per terrain; impassable if any unit has ∞ cost;
      cached server-side for path validation
- [ ] Division movement tick — advance toward player-set target waypoints each server tick;
      speed = road_level speed on roads; slowest-unit speed off-road from movement profile
- [x] Engagement area collision detection — circular areas, radius by division type;
      full overlap triggers COMBAT_STARTED
- [ ] Attacker/defender determination at combat initiation:
      Tier 0: engagement areas already overlapping at the instant war is declared between
      the two nations → war-declaring nation is the attacker, other nation is defender
      (no movement involved); Tier 1: explicit ADVANCE vs HOLD orders; Tier 2: movement
      vector angle vs intercept line (<45° = attacker); Tier 3: both advancing = meeting
      battle (neither gets terrain bonus); Tier 4: fewer province holdings = defender
      (only reached if Tier 0 does not apply)
- [ ] Terrain modifiers applied at combat initiation — sample **both** divisions' positions
      (not defender-only); elevation bonus is comparative (only the higher-tier side
      receives it, cancels to zero for both if tiers match); cover bonus is absolute (both
      sides receive their own cover bonus independently, never cancels on match); attacker's
      movement/attack friction penalty remains derived from the defender's terrain group,
      with the existing better/same/worse transition modifier applied to that penalty only
- [ ] River crossing check — initial check at combat initiation (line segment between
      division centres intersects rivers.geojson) sets penalty tier and a **cap** (2 rounds
      minor, 3 rounds major), but status is **re-checked each round** for the duration of
      the cap, not snapshotted once: penalty ends the round a division's position crosses
      the river line, which can be earlier than the cap if Reposition closes the distance,
      or can ride out the full cap if the division does not reposition
- [ ] Reposition movement state — available to an engaged division only while below the
      retreat suppression threshold (not yet Suppressed); moves a short distance within or
      adjacent to the current engagement at a fraction of the general in-combat speed
      (itself already reduced from normal off-road speed, ~30%); terrain (cover/elevation)
      and river-crossing status re-sampled on Reposition completion / each round respectively;
      distinct from and much slower than Retreat, which remains the only movement option
      once Suppressed; **requires an explicit player command issued while COMBAT_STARTED is
      already active on that division — never triggered automatically by a pre-existing or
      newly-issued ordinary move order**, which always queues for execution after combat per
      existing Move Order Persistence behaviour regardless of when it was issued
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
      - [x] Divisions with active move orders resume them after combat if not retreated
      - [x] Move orders can be issued during combat; queued for post-combat execution
      - [ ] Defender status locked at combat initiation — move order given during
            combat does not reclassify defending division as attacker
- [x] Strategic combat resolution (simplified) — HP and suppression tracked at division
      level (no 5×5 grid yet); combat ticks apply attrition per round
- [x] Combat states: Engaged → Suppressed → Retreat → Destroyed (full state machine)
- [x] Auto-retreat for defenders when suppressed (base 60% threshold) + road open
- [x] Auto-retreat for attackers at higher threshold (base 80%) — attackers hold longer
      before breaking; manual retreat always available at any suppression level;
      encirclement takes precedence (auto-retreat disabled when no escape route)
- [ ] Meeting battle icon state — distinct from standard Engaged
- [ ] Positional stack mechanics:
      - [x] Allied divisions at same position form ordered stack; player can reorder
      - [x] Only first division engages enemy; on suppression threshold → rotates to back
            of stack, second steps forward (no physical retreat until last division suppressed)
      - [ ] Supply priority: first division gets supply first; remainder get overflow
      - [ ] Encirclement applies to whole stack, not per-division — rotation does not help
            if the stack as a whole is surrounded; the encirclement check itself is Phase 7's
            three-tier system, this item only confirms the stack-level rule once that system
            exists
- [x] Province capture — ownership transfers when defending division/stack is destroyed or
      retreated; city node must be physically occupied by capturing division
- [x] Angle-based flanking system:
      - [x] When a second (or further) enemy division's engagement area overlaps an
            already-engaged division, compute the angle at the defender between every
            pairwise combination of currently-attacking divisions' position vectors
            (dot product of each pair); with exactly two attackers this is one pair, with
            N attackers this is every pairwise combination among them
      - [x] Classification uses the **maximum** of all computed pairwise angles, looked up
            against the same thresholds regardless of attacker count
      - [x] < 90°: no flanking bonus — converging frontal assault only
      - [x] 90°–135°: standard flank attack bonus (% damage increase to non-primary attackers)
      - [x] 135°–180°: enhanced rear attack bonus (higher % damage increase)
      - [x] Angle classification locked at the moment each *new* division's engagement
            area first overlaps — not recalculated mid-combat or on every tick; a third+
            division joining triggers one fresh evaluation considering all pairwise angles
            at that instant, which then holds until the next division joins or one departs
      - [x] `FLANK_ATTACK` and `REAR_ATTACK` events broadcast on classification, including
            which pair of divisions produced the winning (maximum) angle
- [ ] Dynamic frontline influence computation — **128×128 grid, per supply tick**:
      - [ ] `computeInfluenceGrid()` in `GameRoom.ts`: for each division, add
            hp_fraction × distance_falloff contribution to cells within influence radius
            (falloff_radius = engagement_radius × 2.5 in grid cells); recon units excluded
      - [ ] Ownership bonus: add `OWNERSHIP_BONUS` constant to province owner's cells
            (covers cells within province boundaries at grid resolution)
      - [ ] Serialize to `dominant[Uint8Array]` + `advantage[Float32Array]` — leading
            nation per cell and its margin over second-place nation
      - [ ] Broadcast `FRONTLINE_UPDATE` with binary payload every supply tick (~5s);
            all players receive same grid; division visibility is filtered separately
      - [ ] Only compute/include influence for nations where `at_war == true` against
            at least one other present nation; neutral-vs-neutral pairs produce no contest
      - [ ] City capture: ownership bonus cell coverage updates immediately on
            `PROVINCE_CAPTURED`; next `FRONTLINE_UPDATE` reflects new ownership
      - [ ] See `STRATEGIC_COMBAT.md` — Dynamic Frontline System (deferred) for algorithm design
      - [ ] `FRONTLINE_UPDATE` event replaces old per-province broadcast approach
- [ ] `COMBAT_STARTED`, `COMBAT_RESULT`, `MEETING_BATTLE_STARTED`, `PROVINCE_CAPTURED`,
      `UNIT_DESTROYED`, `STACK_ROTATION`, `FRONTLINE_UPDATED` events. Supply/encirclement
      events (`OUT_OF_SUPPLY`, `CUT_OFF`, `ENCIRCLED`) are emitted by the full three-tier
      system in Phase 7, not by this phase. (An earlier draft of this phase also named
      `SUPPLY_SEVERED_FRONTLINE`/`SUPPLY_RESTORED_FRONTLINE` as separate events — these were
      always describing the same influence-grid connectivity check as Tier 1's
      `OUT_OF_SUPPLY`/`SUPPLY_RESTORED`, not a second distinct signal, so they are dropped
      here rather than carried forward as a duplicate.)
- [ ] Basic supply placeholder — **none needed.** Earlier drafts of this phase had a
      simplified "out of supply = increased attrition" placeholder here, on the assumption
      Phase 7 was far enough away to need a stand-in. It is not: Phase 7 directly follows
      this phase and supersedes this entirely, so no placeholder model, no
      frontline-connectivity duplicate of Phase 7's Tier 1 check, and no encirclement
      stand-in are implemented here. Divisions simply have no supply mechanic at all until
      Phase 7 — there is nothing to retrofit and no redundant code to delete later

### Godot
- [ ] `waypoints.json` + `roads.geojson` loaded at game start and merged into unified
      graph; movement profile applied at query time per selected division
- [x] Pathfinding uses **two-phase routing** (bidirectional A*): off-road purity pre-check;
      road entry pre-check (nearest road within 0.015°²/~1.5km → route to road then
      road-only to goal); full graph fallback (see `docs/PATHFINDING.md` — Two-Phase Routing)
- [x] **String-pulling post-processor** applied to raw A* output — greedy forward skip
      to furthest passable node within 0.05°²/~5km (see `docs/PATHFINDING.md` — String-Pulling)
- [x] Shift-move road avoidance heuristic — activates from segment 2 onward; road crossing
      check at 200m intervals; continuous avoidance multiplier 1.0–13.0 based on off-road
      depth (see `docs/PATHFINDING.md` — Shift-Move Road Avoidance)
- [ ] Hierarchical query added on top of the existing two-phase routing above (new work,
      not replacing it): cheap abstract-graph search across clusters first, identifying
      which clusters the route crosses; full two-phase A* (unchanged) runs only within
      those clusters, always at full precision at the start and goal clusters; results
      stitched at border-crossing nodes (see `docs/PATHFINDING.md` — Hierarchical Layer)
- [ ] Path smoothing — centripetal Catmull-Rom spline fit through the string-pulled
      waypoint list, client-side, before handing to dead reckoning; deviation from the
      original straight-line polyline clamped to ~750m so the curve cannot cut across
      terrain the route deliberately avoided; falls back to a straight segment if the
      clamp would be exceeded (see `docs/PATHFINDING.md` — Path Smoothing)
- [ ] Infinity-cost edges excluded from A* search; river crossing penalty on flagged
      edges; server validates smoothed path (not raw A* path)
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
      - [x] Retreating: retreat arrow on dot pointing direction of withdrawal
      - [ ] Redeploying: dot greyed out with gear/refresh symbol
- [ ] Tactical combat pop-up button on combat icon (crossed-swords symbol):
      opens 5×5 vs 5×5 grid panel with HP/suppression bars, experience badges,
      formation bonus glows, row perk labels, attack pattern overlay, recon indicator,
      terrain modifier display, river crossing penalty indicator, round timer,
      flanking angle indicator showing measured angle and active bonus tier
- [ ] Movement rendering uses **dead reckoning** — client drives animation locally
      using the pre-validated waypoint list and terrain speed; no waiting for server
      per-waypoint acknowledgements. Server sends `DIVISION_WAYPOINT_REACHED` on
      each waypoint arrival and `DIVISION_POSITION_CORRECTION` every ~3 seconds;
      client applies correction only if divergence > 15 map units (lerp over 0.5s).
      HP bars, suppression bars, frontline values lerp between server updates.
      Dead reckoning implementation in `client/src/systems/military/military_system.gd`;
      see `docs/PATHFINDING.md` — Dead Reckoning for speed constants and correction logic.
- [ ] Observation radius computed as max recon unit range in template; baseline radius
      for divisions with no recon units; updates when movement profile recomputes
- [ ] Move order UX:
      - [ ] Select division → press Move hotkey (or Move button) → cursor enters move mode
            (exact key per `UI_UX_DESIGN.md` §9 / Phase 5's `InputMap`, not hardcoded here)
      - [ ] Single click: pathfind to destination, one waypoint, division deselected
      - [ ] Shift+click: add waypoint to chain, division stays selected and in move mode
      - [ ] Escape: cancel move mode, clear pending waypoints
      - [ ] Right-click existing waypoint: delete it from chain
      - [ ] Click moving division: show remaining waypoints; allow chain editing
      - [ ] Ghost dot at each waypoint: faded division icon + faded engagement circle;
            observation radius shown on hover only; estimated arrival time tooltip
      - [ ] Ghost dots and paths: visible to owner and allies; visible to enemy/neutral
            only if ghost dot falls within their observation radius
      - [ ] Waypoint Drag Refinement: press-and-hold (rather than click-and-release) on
            any waypoint placement — final destination or any shift-click intermediate
            waypoint — drags the ghost dot live with the cursor; release commits at final
            cursor position; live preview during drag uses the hierarchical pathfinding
            abstract-layer estimate only (see `PATHFINDING.md` — Hierarchical Layer), full
            precision A* runs once on release, not on every drag-frame
      - [ ] Move is never triggered by drag alone — only by the click described above,
            after move mode is entered via hotkey/button; drag is reserved for refining an
            already-triggered waypoint and for Box Selection (below), which must not be
            ambiguous with each other or with plain camera panning
- [ ] Box Selection — drag over empty map space with no move mode active draws a selection
      rectangle; on release, every division dot inside it is added to the selection;
      `Shift+drag` adds to existing selection, `Ctrl+drag` removes from it; does not create
      or modify a saved control group on its own
- [ ] Formation Move — move order issued to 2+ selected divisions spreads them into a grid
      formation around the destination point rather than converging on one point; adjacent
      division spacing derived from each division's own engagement radius (sum of the two
      radii at every adjacent pair, not a new constant); divisions already stacked together
      before the order move as one formation slot, not unstacked into the spread; slot
      assignment uses a cheap nearest-available heuristic, not an optimal assignment search
- [ ] Stack UI — ordered stack panel; drag to reorder; first/reserve indicators
- [ ] `CombatSystem` — combat icon rendering (standard Engaged vs Meeting Battle icons),
      HP bar, suppression pulse, round phase indicator
- [ ] `FrontlineRenderer` — GPU shader approach (not CPU polygon per tick):
      - [ ] Server sends 128×128 influence grid as two binary arrays: `dominant[Uint8]`
            (leading nation per cell) and `advantage[Float32]` (dominance margin) every
            ~5 seconds; ~80KB payload total
      - [ ] Client uploads arrays as two `ImageTexture` uniforms (`FORMAT_R8` and
            `FORMAT_RF`) on `FRONTLINE_UPDATE` receipt
      - [ ] `advantage` texture lerps smoothly over 2 seconds between updates;
            `dominant` texture snaps immediately (discrete ownership change)
      - [ ] `frontline.gdshader` fragment shader on a `MeshInstance2D` covering full
            map bounds: blends nation colours by dominant/advantage; renders edge glow
            at zero-crossing of advantage; `political_view` uniform toggles fill vs
            line-only rendering; z-index above base map, below unit dots
      - [ ] `set_political_view(bool)` function toggles shader uniform
      - [ ] Frontline only renders between nations marked `at_war = true` in game state;
            `at_war` uniform is a 6×6 bool matrix sent once at game start
      - [ ] Province borders remain static (political map, never changes)
      - [ ] City node marker changes to capturing nation's icon on `PROVINCE_CAPTURED`
      - [ ] Neutral player receives same influence grid broadcast; sees colour wash;
            does not see enemy division dots outside their own observation radius
      - [ ] Intensity of colour wash proportional to division HP fraction (baked into
            server influence computation) — fading regions indicate weakening fronts
      - [ ] See `STRATEGIC_COMBAT.md` — Dynamic Frontline System (deferred) for shader
            design and server computation approach
- [ ] `MapRenderer` update — recolour province baseline on `PROVINCE_CAPTURED`; shader
      continues to apply influence wash on top of new baseline colour
- [ ] `NotificationSystem` — combat started, meeting battle, suppression threshold,
      stack rotation, encirclement, division destroyed, supply severed via frontline toasts

### Verification gate
Move division → pathfinding finds road route automatically → manually draw off-road route
through forest → armoured division cannot enter dense_forest → infantry division can.
Bot division advances toward player → attacker/defender determined by movement vectors →
terrain bonus applies to defender; attacker's own elevation checked too — if attacker holds
higher elevation tier than defender, attacker receives the elevation bonus instead, and if
both sides share the same elevation tier neither receives it, while each side's own cover
bonus (e.g. forest) applies independently regardless of the other side's terrain or role.
Both advancing head-on → meeting battle icon appears, neither gets terrain bonus. Two
divisions already overlapping while neutral → war declared between their nations → declaring
nation's division is the attacker, other division is the defender with terrain bonuses, with
no movement having occurred. Commit second division to already-engaged enemy → flanking
bonus applies. Commit a third division to the same engagement at an angle that falls
*inside* the arc already covered by the first two attackers → classification unchanged
(maximum pairwise angle still comes from the original pair) — confirms a new attacker can
never silently downgrade an existing flank/rear classification. Commit a third division
that widens the existing arc instead → classification upgrades accordingly (e.g. flank →
rear attack) at the instant of that third division's overlap, not continuously. Stack two
friendly divisions → first engages → hits suppression → rotates →
second steps up → combat continues without physical retreat. Last stack division suppressed
with no escape route → entire stack destroyed. Encircled armoured division → damage output
decays over ticks → eventually deals zero damage. Box-select three divisions over empty map
space → all three added to selection; Shift+drag a fourth division's area → added to
existing selection without clearing it. Issue a move order to the three boxed divisions →
they spread into formation around the destination rather than converging on one point;
adjacent spacing in the formation is at least the sum of each pair's engagement radii.
Box-select two divisions that are already stacked together plus one unstacked division →
issue group move → the pre-existing stack moves as a single formation slot, not split into
two separately-spread divisions. Enter move mode, press and hold at a destination, drag
before releasing → ghost dot follows the cursor live using the cheap hierarchical-layer
estimate, not a full A* recompute every frame → release → full-precision path computed once
at the final position. Long-distance move order spanning many provinces → hierarchical
query resolves at a small fraction of the equivalent full-graph A* search time, with the
resulting path's total cost within a small margin of the non-hierarchical result. Move
order producing a route with at least one sharp turn → rendered path curves smoothly
through the turn instead of snapping heading at the waypoint, while still not cutting
across terrain the original route avoided (verify clamp behaviour against a route
deliberately routed around impassable terrain). Division with a move order already queued
before combat begins → gets pulled into an engagement → does nothing unusual, order remains
queued, executes automatically only after combat resolves — confirms ordinary move orders
never auto-trigger Reposition. Division engaged but not yet Suppressed →
issue Reposition order toward adjacent forest → division crawls at reduced speed → cover
bonus applies once repositioned; division engaged and crossing a major river → river penalty
active → Reposition toward far bank → penalty ends once position crosses the river line,
before the 3-round cap, if the crossing completes early; division that does not reposition →
rides out the full 3-round cap as before. Division reaches Suppressed state → Reposition no
longer available, only Retreat.
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
sits where forces balance. Division takes HP damage → colour intensity fades. Division
captures city node → ownership
bonus flips to new owner immediately → previous owner’s unit influence persists where
their units are → frontline shifts but does not snap fully → province border unchanged.
Friendly colour persists along roads still defended by retreating forces. Neutral observer
sees colour wash shifting but not enemy division dots outside their observation radius.
(Supply/encirclement behaviour — out-of-supply attrition, cut-off fighting withdrawal,
full encirclement and its armour-damage decay — is verified in Phase 7, where that system
is actually implemented; nothing in this phase's gate exercises it.)

---

## Phase 5 — UI Foundation

**Goal:** Shared panel and input scaffolding exists before any panel content gets built.
`HUDManager` and the finalized `InputMap` are real and working — pulled forward from Phase 15
— so Phase 6 onward registers panels into a system that already enforces the rules in
`UI_UX_DESIGN.md`, instead of each phase hand-rolling its own panel visibility logic and
keybindings that need retrofitting later.

**Why this phase exists:** `HUDManager` and `SettingsUI` keybind remapping were originally
scheduled in Phase 15 — Polish, on the assumption that panel orchestration is a cosmetic
finishing step. It isn't, for this game specifically. `UI_UX_DESIGN.md` specifies cross-cutting
rules — same-hotkey-closes/different-hotkey-swaps panel behaviour, Tab's dual meaning
(sub-tab cycle inside a panel vs. attention-cycle when none is open), Escape's recursive
back-out state machine — that every later panel (`DivisionBuilder` and `TacticalGridUI` in
Phase 6, Economy/Building/Market panels in Phase 9, Research in Phase 10, Unit Specialization
Research in Phase 11, Air/Naval in Phase 12–13) needs to consume identically. If
`HUDManager` doesn't exist until Phase 15, those five-plus panels each get built against no
shared contract and need retrofitting once `HUDManager` finally arrives. Building the
scaffolding once, here, removes that retrofit risk entirely.

This is also the first phase with two panels designed to deliberately share a component:
`TacticalGridUI` and `DivisionBuilder` both open the same Unit Profile view on a unit click
(`UI_UX_DESIGN.md` §6.6, §7.4). That sharing needs a home before either panel is built, or
one of them will build its own copy.

**Why before Phase 6, not folded into it:** Phase 6's own goal is the tactical grid's combat
logic and the auto-battler loop — `DivisionBuilder` and `TacticalGridUI` are explicitly listed
Godot tasks inside it. Giving Phase 6 a clean, pre-existing panel/input substrate to build on
keeps its own scope focused on grid logic rather than mixing in foundational UI plumbing.

**Scope discipline:** this phase is infrastructure only — registry, orchestration rules,
input bindings, reusable layout shells. It does **not** build any panel's actual content.
Military/Economy/Diplomacy panel content, the Research tree, naval/air sub-tab content, and
all map-mode rendering remain owned by the phases that already specify them. Nothing here
should require redoing when those phases land.

**Testing:** Headless Godot scene with mock panels registered into `HUDManager`, verifying
open/close/swap rules and Tab/Escape state transitions before any real panel content exists.

### ✅ Phase 5 — UI Foundation — IMPLEMENTED (June 2026)

All Godot items below are implemented:

- [x] `HUDManager` — panel registry, `show_panel`/`hide_panel`/`toggle_panel`/`close_all`,
      `panel_opened`/`panel_closed` signals
- [x] Panel open/close orchestration (per UI_UX_DESIGN.md §5.5)
- [x] Tab dual-context (sub-tab cycle vs. notification cycle)
- [x] Escape recursive state machine (per UI_UX_DESIGN.md §9.6)
- [x] Reusable two-column layout shell (§6.1)
- [x] `UnitProfile` scaffolded (§6.6)
- [x] Side-dock vs. full-center overlay modes (§5.3)
- [x] Bottom selection panel container — FriendlyDivision, FriendlyProvince,
      FriendlyStack, EnemyDivision states (§5.6)
- [x] `InputMap` with finalized keybind scheme (per UI_UX_DESIGN.md §9)
- [x] Left-handed mirror preset (§9.1)
- [x] Settings keybind remapping UI — list/rebind/reset, persisted to `user://keybinds.cfg`
- [x] Reserved input actions: Z (idle-select), V (engaged-cycle), U (Politics), I (Espionage)

Key files produced:
- `src/ui/hud/hud_manager.gd` — panel orchestration
- `src/ui/hud/game_hud.gd` — HUD root, dock buttons, bottom bar wiring, MapLoader integration
- `src/ui/game/pause_menu.gd` — ESC handling, settings integration via `is_settings_open()`
- `src/ui/settings/settings_keybind.gd` — rebind UI with close_callback hook
- `src/core/keybind_manager.gd` — InputMap registry + config persistence
- `src/core/keybind_presets.gd` — DEFAULT + LEFT_HANDED presets
- `scenes/game/panels/friendly_division_panel.tscn|.gd`
- `scenes/game/panels/friendly_province_panel.tscn|.gd`
- `scenes/game/panels/enemy_division_panel.tscn|.gd`
- `scenes/game/panels/friendly_stack_panel.tscn|.gd`
- `scenes/game/settings_keybind.tscn`

### Godot
- [ ] `HUDManager` — implemented now per its existing `[MVP]` contract in `MODULES.md`
      (panel registry, `show_panel`/`hide_panel`/`toggle_panel`/`close_all`,
      `panel_opened`/`panel_closed` signals) — moved forward from Phase 15
- [ ] Panel open/close orchestration rules enforced in `HUDManager`, per
      `UI_UX_DESIGN.md` §5.5: pressing a panel's hotkey while it is already open closes it;
      pressing a different panel's hotkey closes the current panel and opens the new one;
      panels never stack
- [ ] Tab dual-context handling: cycles sub-tabs within the currently open panel
      (`UI_UX_DESIGN.md` §5.4) when a panel is open; cycles the `NotificationSystem` queue
      (§8) when no panel is open. One key, two contexts, never ambiguous
- [ ] Escape recursive state machine per `UI_UX_DESIGN.md` §9.6: cancel pending move-mode
      waypoints → close open panel → close settings menu → open settings menu (only when
      nothing else is open). Implemented as one recursive rule, not per-context special cases
- [ ] Reusable two-column layout shell (fixed left content area / context-sensitive right
      column that swaps by state) per `UI_UX_DESIGN.md` §6.1 — built generically so
      `DivisionBuilder` and `TacticalGridUI` (Phase 6) both consume it rather than each
      implementing their own grid-plus-context-panel layout
- [ ] `UnitProfile` component scaffolded (empty/placeholder content is fine — Phase 6 fills
      it in) per `UI_UX_DESIGN.md` §6.6, as a standalone reusable component rather than
      built inside either `DivisionBuilder` or `TacticalGridUI` — both will open the same
      instance on a unit click (§7.4)
- [ ] Side-dock vs. full-center-overlay placement modes built as a property of the panel
      shell, not per-panel custom code, per `UI_UX_DESIGN.md` §5.3
- [ ] Bottom selection panel container with state-switching (friendly division / friendly
      province / friendly stack / enemy division) per `UI_UX_DESIGN.md` §5.6 — container
      and state-switching built now; per-state content (e.g. province build-queue inline
      actions) filled in by the phase that owns that system
- [ ] `InputMap` populated with the finalized keybind scheme from `UI_UX_DESIGN.md` §9 —
      see full table below. This **replaces** the stale placeholder scheme previously
      embedded in `STRATEGIC_COMBAT.md` (Q/E/R/F panels, M/H/G/X orders), which predated
      this design pass and is now superseded
- [ ] Left-handed mirror keymap shipped as a second named default mapping, not a
      runtime-computed mirror — per `UI_UX_DESIGN.md` §9.1
- [ ] Settings keybind remapping UI moved forward from Phase 15's `SettingsUI` — minimum
      viable version only (list bindings, rebind, reset to default/left-handed preset,
      persist to local config). Full audio/graphics settings remain in Phase 15; only the
      keybind remapping piece moves here, since it depends on the same `InputMap` work
- [ ] Reserved-but-unbound input actions registered now for future use, so later phases
      extend rather than retrofit: `Z`/`V` (idle-division-select / engaged-division-cycle),
      `U`/`I` (Politics / Espionage panels)

### Finalized keybind scheme (implemented in `InputMap` this phase)

Full rationale for every choice below is in `UI_UX_DESIGN.md` §9. This table supersedes
the placeholder scheme previously documented in `STRATEGIC_COMBAT.md`'s "Default Hotkey
Layout" section (Q/E/R/F panels, M/H/G/X orders) — that section predates this UI/UX design
pass.

**Camera & zoom**
| Key | Action |
|---|---|
| W A S D | Pan camera |
| Ctrl +/− | Zoom in/out |
| F1–F8 | Jump to camera bookmark |
| Ctrl + F1–F8 | Set camera bookmark at current position/zoom |

**Unit orders** (active when division/stack selected)
| Key | Action |
|---|---|
| Space | Move (enter move mode; click = waypoint; Shift+click = chain) |
| G | Hold position |
| C | Retreat |
| X | Cancel orders |
| Z | *(reserved)* select idle/unengaged divisions |
| V | *(reserved)* cycle engaged/in-combat divisions |

**Control groups**
| Key | Action |
|---|---|
| 0–9 | Select group |
| Double-tap 0–9 | Select group + snap camera to it |
| Ctrl + 0–9 | Assign current selection to group |
| Shift + 0–9 | Add current selection to group |

**Panels**
| Key | Panel |
|---|---|
| Q | Military (Land/Air/Naval sub-tabs) |
| E | Economy / Trade |
| T | Diplomacy |
| Y | Research |
| U, I | *(reserved)* Politics, Espionage |
| Tab (panel open) | Cycle sub-tabs within current panel |
| same key again | Close current panel |
| different panel key | Close current, open new |

**Map & navigation**
| Key | Action |
|---|---|
| ` (backtick) | Cycle map mode forward (Political → Cover → Elevation) |
| Shift + ` | Cycle map mode backward |
| Alt (held) | Show relationship-ring overlay (self/ally/enemy/neutral) on Political mode |
| Tab (no panel open) | Jump to next item needing attention (shared queue with `NotificationSystem`) |

**Chat**
| Key | Action |
|---|---|
| Enter | Chat — defaults to Allies if allied, else All |
| Shift + Enter | Chat — All (explicit) |

**System**
| Key | Action |
|---|---|
| Escape | Context-sensitive back-out (see Escape state machine above) |

No pause and no speed control exist in this game by design (`UI_UX_DESIGN.md` §9.7) —
no keys are reserved for either.

### Verification gate
Two mock panels registered into `HUDManager` — pressing panel A's hotkey opens it; pressing
A's hotkey again closes it; pressing B's hotkey while A is open closes A and opens B; panels
never stack. With a panel open, Tab cycles its sub-tabs; with no panel open, Tab cycles a
mock notification queue. Escape, with a mock move-mode pending, cancels it; pressed again
with nothing pending, opens settings; pressed again, closes settings. Open `DivisionBuilder`
mock and `TacticalGridUI` mock — both render inside the same two-column shell and both open
the identical `UnitProfile` instance on a unit click. Open Settings → keybind list shows all
current bindings → rebind one action → binding persists after restart → reset to left-handed
preset → all bindings swap to the mirrored layout in one action.

---

## Phase 6 — Tactical Grid

**Goal:** The 5×5 grid activates when strategic combat initiates. Grid composition determines
combat outcomes. The auto-battler loop works end-to-end. Nation preset templates are playable.

**Why after Phase 4:** Phase 4 proves the strategic layer works. Phase 6 replaces the
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
      in Phase 8)
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
      nation_config; motorised toggle available after motorisation research (Phase 10);
      mechanised infantry unit available after armour research branch unlocks it (Phase 10+)
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

## Phase 7 — Supply System

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
- [ ] Three-tier supply/encirclement status system (checked each supply tick) — **moved
      here from an earlier draft of Phase 4**, which only ever had a simplified placeholder;
      this is the real system, not an upgrade of something already implemented:
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
      - [ ] Stack-level encirclement: the check applies to the whole stack at its shared
            position, not per-division — rotation (Phase 4's stack mechanic) does not
            protect a stack that is, as a whole, surrounded
- [ ] `SUPPLY_DISRUPTED`, `SUPPLY_RESTORED`, `OUT_OF_SUPPLY`, `CUT_OFF`, `ENCIRCLED` events
      (an earlier draft also named `DIVISION_ENCIRCLED` separately — dropped here as a
      duplicate of `ENCIRCLED`, the actual Tier 3 transition event)

### Hono
- [ ] Supply hub building persisted via `/internal/game-end` in player results

### Godot
- [ ] `SupplySystem` — road segment throughput visualisation; truck sprites on active
      segments; dim/broken visual for disrupted segments
- [ ] Supply status indicator on division icons — subtle colour shift when out of supply;
      distinct visual treatment per tier (Out of Supply / Cut Off / Encircled), not a single
      generic "low supply" indicator, since the three tiers carry meaningfully different
      player consequences and should read differently on the map at a glance
- [ ] `NotificationSystem` additions — supply disrupted, cut off, encircled warnings (three
      distinct notification types matching the three tiers, not one generic warning)

### Air interdiction integration
- [ ] Colyseus logistics strike handler reduces segment throughput for N ticks
- [ ] Both low-altitude (direct, no recon) and high-altitude (recon-proportional) variants
      resolve against the supply graph correctly

### Verification gate
Division advances beyond supply hub range, connectivity check drops below 50% friendly
influence → Tier 1 Out of Supply: HP recovery stops, movement speed reduced, retreat still
clean → `OUT_OF_SUPPLY` fires. Player pushes a relief force restoring the influence chain →
status returns to normal, `SUPPLY_RESTORED` fires. Enemy advance removes every retreat path
through friendly-influenced ground → Tier 2 Cut Off: retreat now triggers a fighting
withdrawal (HP damage proportional to enemy influence density along the escape path) rather
than a clean retreat → `CUT_OFF` fires. Enemy closes all 8 directions around the division
(engagement-area overlap or ≥70% enemy influence in every direction) → Tier 3 Encircled:
retreat command disabled entirely, armoured units' damage output decays toward zero over
several ticks, infantry degrades slower → `ENCIRCLED` fires. Status never jumps directly
from normal to Tier 3 — confirm it always passes through Tier 1 and Tier 2 first. Stack of
three divisions, fully encircled → confirm encirclement applies to the stack as a whole, not
reset by Phase 4's stack-rotation mechanic. Last division in a Tier 3 stack hits its
suppression threshold → destroyed outright (not retreated) → experience and template lost
permanently. Air logistics strike dims a road segment and reduces downstream division supply
for the correct duration, and can independently push a division from normal into Tier 1 if
the strike cuts its only connection to a supply hub.

---

## Phase 8 — Player Persistence

**Goal:** Division templates persist between sessions. Stats accumulate after each game.
Full template builder is complete.

### Hono
- [ ] `/divisions` CRUD routes fully implemented and tested (extended from Phase 6 MVP)
- [ ] `/internal/game-end` updates player stats (games_played, games_won, playtime_hrs)
- [ ] `/internal/player/:user_id/templates` loads full template set into Colyseus at game
      start (extended from Phase 6 MVP)

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

## Phase 9 — Resource Economy + Buildings

**Goal:** The full ten-resource economy from RESOURCE_ECONOMY.md is live — each resource's
distinct mechanic (oil's flow debuff, rubber/nitrate combat attrition, tungsten's
substitution, chromium/aluminium's hard draw-blocks, uranium's research-bound identity)
actually functions, not just a generic per-tick number going up. Every building in
ECONOMY_BUILDINGS.md can be constructed, leveled, and researched into its perk tree. The
national industry pool, population/manpower, and both market mechanisms (spot order book,
standing trade routes) are playable.

**Why this phase is no longer "Resources accumulate, buildings can be constructed":** the
original one-line goal predates RESOURCE_ECONOMY.md and ECONOMY_BUILDINGS.md entirely, from
when MAP_DATA_CONTRACT.md's resource envelope was still an explicit placeholder
(`manpower, steel, oil, fuel, coal`, "TBD pending game design decisions"). That placeholder
has since been replaced with a real ten-resource roster, each with its own mechanic, plus
roughly fifteen buildings each with their own perk-tree research, a national allocation
pool, and a real player-driven market. None of that fits a flat `BUILD` handler and a generic
economy tick — this phase is rewritten in full to match what was actually designed.

**Why Diplomacy and General Technology move to Phase 10, not bundled in here:** the
original Phase 9 combined three largely-independent systems (economy, diplomacy, General
Technology) under one goal because all three were small at the time. Economy alone has
since grown into the largest single system in the game outside of combat — ten resources,
fifteen-plus buildings, perk-tree research, a market, population/manpower. Diplomacy and
General Technology have not grown at all and remain exactly as small as before. Keeping them
bundled would force this phase's verification gate to mix economy correctness with
alliance-proposal correctness, two unrelated failure surfaces. Splitting lets Phase 9 close
on "the economy works" alone, and Phase 10 close on "diplomacy and motorisation work" alone,
mirroring how Phase 5 was split out of Phase 15 for the same reason — a system that grew
past the size that justified bundling it with its original neighbours.

**Testing:** Unit tests for each resource's mechanic in isolation (oil debuff curve at each
demand band, rubber/nitrate attrition rate, tungsten's stat-table shift, chromium/aluminium
draw-block thresholds). Bot client for the spot market (needs a second party to match orders
against) and for standing trade routes (needs a second nation to negotiate with).

### Colyseus
- [ ] Resource envelope migrated to the ten-key schema (`money, grain, iron, oil, rubber,
      nitrates, tungsten, chromium, aluminium, uranium`) per MAP_DATA_CONTRACT.md's updated
      Resources section — replaces the old five-key placeholder entirely, not additive
- [ ] Per-resource extraction tick — each resource-extraction building (Iron Mine, Grain
      Farm, Oil Derrick/Offshore Platform, Rubber Plantation/Synthetic Plant, Nitrate
      Works/Synthetic Works, Tungsten Mine, Chromium Mine, Bauxite Mine+Refinery, Uranium
      Mine) produces its base-tier output with **zero** industry allocated — confirms the
      no-forgetfulness-trap guarantee from ECONOMY_BUILDINGS.md before the industry
      multiplier is layered on top
- [ ] National Industry Pool — single pool fed by all factories nationally; one slider per
      resource type + construction speed + unit production speed; diminishing-returns curve
      applied per slice independently; near-instant reallocation (short cooldown only, to
      prevent frame-perfect switching); new factories default-allocate to money production +
      construction speed, player-changeable at any time
- [ ] Oil mechanic — continuous draw from oil-consuming unit types only (motorised,
      armoured, naval, air); soft debuff curve at 100–50% / 50–20% / <20% demand-met bands;
      military/balanced/economy allocation-priority toggle per nation; HP recovery-rate
      degradation for oil-dependent units layered under existing supply-tier status, not
      replacing it
- [ ] Rubber mechanic — stockpile depletion from vehicle-type unit build cost AND from
      vehicle-type units' combat participation (per-round drain while engaged); shortage
      slows HP recovery rate for vehicle-type units specifically
- [ ] Nitrates/Sulfur mechanic — mirrors Rubber exactly but targets infantry/artillery-type
      units' ammunition expenditure and recovery rate instead of vehicle wear
- [ ] Tungsten mechanic — national tungsten availability shifts which row of the existing
      armour-penetration threshold table (TACTICAL_COMBAT.md) a nation's AT/tank-gun units
      resolve against; zero tungsten never blocks production or slows recovery, only
      downgrades the resolved penetration tier
- [ ] Chromium mechanic — premium-tier units (heavy tank tier, battleship belt-armour tier,
      and equivalents) draw supply independently of the rest of their division; below the
      national chromium threshold, only the chromium-gated units in a division stop
      recovering HP, the rest of the division is unaffected
- [ ] Aluminium mechanic — hard ceiling on air-unit supply throughput, same draw-block shape
      as Chromium but air-specific; **gated on a placeholder research flag in this phase**,
      not the real air-doctrine tier (which has no content until Air Combat and the Air
      specialization tree exist — see the Economy Integration phase, after Naval Combat,
      for the swap to the real tech-tier gate); flag starts false for every nation, so the
      mechanic is inert and untestable beyond "ceiling exists" until that follow-up phase
- [ ] Uranium mechanic — Uranium Mine output is research-bound, not geography-bound; reaching
      the relevant tech node grants a one-time research-currency injection (see Phase 10's
      research-currency model) — no combat-stat mechanic, deliberately kept to this single
      use case
- [ ] Population — per-province stock, flat-or-lightly-accelerating tick-based growth;
      feeds the `vp_value × population reached` end-of-session VP weighting; manpower is
      derived from population at recruitment time (part of each unit's existing build-cost
      vector), not tracked as an independent field
- [ ] Manpower soft cap — recruiting from a heavily exhausted manpower pool costs
      progressively more (money/time multiplier), never hard-blocks
- [ ] Division build cost — fixed resource-vector cost paid once at raise time, sum of unit
      costs (each unit type's cost vector includes money/iron/manpower plus whichever
      restricted resources that unit type consumes)
- [ ] Division supply draw — at each tick, `(missing HP fraction) × (division's build-cost
      resource vector)`, drawn from whatever is flowing down the existing STRATEGIC_COMBAT.md
      supply graph; the flow becomes a resource-mix vector per division type, not a flat
      scalar — reuses the existing hub→road-graph→division flow model, does not replace it
- [ ] `BUILD` handler reworked for the perk-tree model — construct/level a building (costs
      resources, capped at level 5 per ECONOMY_BUILDINGS.md); base level produces exactly one
      fixed effect scaling in magnitude only; building does not gain new effect categories
      from leveling alone
- [ ] Research-to-building perk handler — applying a researched perk node to a building
      unlocks a new effect or redistributes existing effect weighting (per the adjacency-web
      rules in ECONOMY_BUILDINGS.md: paths adjacent-unlock, tier-local mutual exclusivity
      only at designated locked tiers); unlocked perks scale automatically with building
      level going forward, no re-research needed per level
- [ ] All eighteen building trees from ECONOMY_BUILDINGS.md implemented: School, Hospital
      (with nationally-pooled hard-diminishing-returns casualty reduction), Infrastructure,
      Warehouse/Depot, Shipyard, Town Hall, and the nine resource-extraction/processing
      buildings listed above
- [ ] Spot market — global per-resource order book; money-only (no resource-for-resource
      barter); matched orders resolve instantly; symmetric ~10–20% spread penalty applied to
      both legs (seller receives less, buyer pays more), difference burned as a money sink;
      NPC liquidity floor (baseline AI buy/sell wall) seeded at session start so no resource
      is ever fully illiquid
- [ ] Standing trade routes — port-to-port and capital-to-capital/province-to-province for
      land-bordering nations only; resource-for-resource barter allowed here, unlike the
      spot market; no spread penalty — friction is setup time and exposure to disruption
      instead. **Two pieces are placeholders in this phase, both replaced in the Economy
      Integration phase after Naval Combat:** (1) port-to-port route disruption uses a flat
      "is an enemy unit present in the port's sea zone" check, not real
      NAVAL_COMBAT.md blockade-percentage math, since naval combat doesn't exist yet; (2)
      land routes are border-adjacency-only — no third-party transit-rights routing through
      a non-participant neighbour, since the transit-rights flag is defined in Phase 10,
      which has not run yet at this point in the build
- [ ] `RESOURCE_TICK`, `MARKET_ORDER_FILLED`, `TRADE_ROUTE_ESTABLISHED`,
      `TRADE_ROUTE_DISRUPTED`, `BUILDING_CONSTRUCTED`, `BUILDING_LEVELED`, `PERK_RESEARCHED`
      events

### Godot
- [ ] `EconomySystem` — replaces the old generic resource-bar display; ten distinct resource
      readouts, each with its own mechanic-appropriate UI treatment (e.g. oil shows a flow
      rate and the allocation-priority toggle, not just a static bar)
- [ ] `EconomyUI` panel — resource overview (ten resources, common tier visually distinct
      from restricted tier), province production detail, build queue, **Industry Pool
      allocation panel** (live sliders, one per resource + construction + production speed)
- [ ] `BuildingUI` — per-building detail view showing current level, active perks, and the
      building's own perk tree (adjacency web rendering shared with the unit-research panel's
      tree-rendering component where the underlying shape matches — see
      `docs/UI_UX_DESIGN.md` for the shared adjacency-web widget)
- [ ] `MarketUI` — spot market order book (post buy/sell, view standing orders, see fills);
      separate `TradeRouteUI` for establishing/viewing standing routes, distinct panel since
      barter (resource-for-resource) only applies here, not on the spot market
- [ ] Population/manpower readout on the province detail view and the nation-overview panel

### Verification gate
Build an Oil Derrick at zero industry allocation → produces full base-tier oil output
immediately, confirming the no-forgetfulness guarantee. Allocate industry toward oil →
output increases on a diminishing-returns curve, not linearly. Nation's oil demand drops
below 50% → oil-consuming units show a visible but minor readiness penalty; non-oil units
(standard infantry) completely unaffected. Toggle allocation priority to Military → civilian
oil throughput throttles first under continued scarcity. Tank-heavy division fights several
rounds while engaged → rubber stockpile visibly depletes from combat alone, independent of
any new vehicle production. Nation's tungsten stock hits zero → AT/tank-gun units continue
building and fighting, but resolve at a lower armour-penetration tier on the existing
TACTICAL_COMBAT.md threshold table — no production block, no recovery-rate penalty. Nation's
chromium stock hits zero → a division with both standard and chromium-gated premium units
stops healing the premium units only; standard units in the same division recover normally.
Raise a new division → resource vector deducted once at raise time, matches the sum of unit
costs. Damaged division sitting on a supply-connected road segment → draws a resource-mix
vector proportional to missing HP and its own composition, not a flat number. Post a sell
order on the spot market → a matching buy order (player or NPC floor) fills it → seller
receives ~80–90% of listed price. Establish a standing port-to-port trade route between two
nations → an enemy unit physically present in either port's sea zone disrupts the route
using this phase's placeholder check (real blockade-percentage math is verified in the
Economy Integration phase, after Naval Combat). Land trade route attempted between two
non-bordering nations → rejected, no transit-rights exception exists yet in this phase
(verified once Phase 10 and the Economy Integration phase have both run). Research a
Hospital perk node on the Logistics Integration path → hospital begins contributing to local
supply-graph throughput, which it did not do at base level. Population in an undisturbed
province grows over the session → that province's effective end-of-session VP contribution
(`vp_value × population reached`) is visibly higher than an equally-`vp_value` province that
saw heavy fighting and population loss.

---

## Phase 10 — Diplomacy + General Technology

**Goal:** Players can form alliances and declare war. General Technology research
(motorisation) is available. Split out of the original combined Phase 9 — see Phase 9's
rationale above for why economy and these two smaller systems no longer belong in the same
phase. Functionally unchanged from the original Phase 9 scope for these two systems
specifically; this phase's content is a relocation, not a redesign.

**Why this phase exists between Economy (Phase 9) and Naval Combat:** the transit-rights
diplomacy flag this phase defines (a non-bordering nation routing trade through a willing
third-party neighbour) is a diplomacy-layer concept that Phase 9's land trade routes were
deliberately built without — Phase 9 ships border-adjacency-only land routes and defers
transit-rights routing entirely to the Economy Integration phase, after Naval Combat, rather
than having Phase 9 stub the flag. This phase simply needs to exist and be real before that
later integration phase can consume it; it does not need to land immediately adjacent to
Phase 9 the way an earlier draft of this plan assumed.

**Testing:** Bot client for diplomacy (needs two-player proposals/responses).

### Colyseus
- [ ] `PROPOSE_DIPLO`, `RESPOND_DIPLO`, `BREAK_DIPLO` handlers
- [ ] Relation state updates, `DIPLO_PROPOSAL`, `DIPLO_ACCEPTED`, `DIPLO_REJECTED` events
- [ ] Alliance combat rules — allied units do not engage each other
- [ ] Map-sharing agreement — allied nations can see all division dots, paths, and
      composition of each other regardless of observation radius
- [ ] Transit-rights flag — a nation can grant another nation permission to route a land
      trade line through its territory without itself being a party to that trade. Defined
      and testable in isolation here (the flag can be set/unset/queried); not yet wired into
      trade-route logic, since Phase 9's land trade routes shipped border-adjacency-only by
      design — the wiring happens in the Economy Integration phase, after Naval Combat
- [ ] General Technology research panel — motorisation node (mid-tier); once researched,
      applicable infantry units can be toggled to motorised versions in template builder;
      movement profile recomputed on toggle; zero grid combat stat change
- [ ] Research-currency model — the funding mechanism research draws from (money + science
      currency, generated by School buildings per ECONOMY_BUILDINGS.md); concurrency cost
      curve for running multiple research projects simultaneously (soft cap via cost, not a
      hard slot limit); this is the shared currency every research system in the game draws
      from — Phase 9's building perk trees, this phase's General Technology node, Phase 9's
      Uranium research-currency-injection mechanic (a one-time lump deposit into this pool),
      and Phase 11's unit specialization trees all spend from the same pool, not separate
      per-system currencies

### Godot
- [ ] `DiplomacySystem` — proposal cache, propose/respond methods
- [ ] `DiplomacyUI` panel — propose alliance, accept/reject incoming proposals, treaty list,
      map-sharing agreement option, transit-rights grant option
- [ ] `GeneralTechUI` panel — General Technology tree; motorisation node; research progress;
      motorised toggle per unit type in DivisionBuilder unlocks after research completes;
      research-currency readout (science + money cost of active projects, concurrency cost
      indicator) — this readout is shared chrome that Phase 11's unit-research panel and
      Phase 9's building-perk UI also display, since all three spend from the one currency
      pool this phase establishes

### Verification gate
Propose alliance to bot → bot accepts → bot's units no longer engage yours → break alliance →
war declared. Grant transit rights to a third nation → that nation's land trade route through
your territory becomes possible; revoke → route disrupted using the same mechanism as a
border closure. Research motorisation → applicable infantry units show the motorised toggle
in DivisionBuilder → toggling recomputes movement profile with zero grid combat stat change.
Run two research projects simultaneously → confirm the concurrency cost curve, not a flat
per-project cost. Uranium tech node completed (Phase 9 mechanic) → one-time currency
injection lands in this phase's research-currency pool, confirming the cross-phase interface
works.

---

## Phase 11 — Unit Specialization Research (Minimal)

**Goal:** A bare-bones version of the unit specialization research system exists and is
wired into the existing Armoured branch skeleton already defined in TACTICAL_COMBAT.md
(motorisation → mechanisation → APC → improved APC → IFV). Nothing here commits to final
content for Infantry, Artillery, Air, or Naval doctrine trees — those are not designed yet.
This phase exists so the *mechanism* (adjacency-web tree, variants coexisting in the same
division, tier-local mutual exclusivity) is real and testable against one concrete branch,
without blocking on design work that hasn't happened.

**Why minimal, and why its own phase rather than waiting:** the spatially-adjacent web
system (paths unlock adjacent paths at the same tier, variable width/depth per unit
complexity, scattered mutual-exclusivity nodes) is a confirmed design but currently only has
one real worked skeleton to build against — Armoured's existing motorisation/mechanisation
chain. Building the full mechanism now, against that one branch, and leaving Infantry/
Artillery/Air/Naval as explicit stubs is preferable to either (a) blocking this phase
entirely until all five branches are designed, which has no scheduled endpoint, or (b)
quietly building Air/Naval combat in later phases with no research system underneath them
at all. A minimal real implementation now means later phases extend a working system with
more content, rather than retrofitting a research mechanism into combat systems that
shipped without one.

**Why after Phase 10, not before:** this phase's research draws from the same research-
currency pool Phase 10 establishes (see Phase 10's Colyseus notes). Building the unit-tree
mechanism before that currency model exists would mean stubbing the funding side instead,
which is the same retrofit risk this phase is otherwise trying to avoid for combat systems.

**Testing:** Unit tests confirming a variant unlock does not retroactively break any
existing division template (the "no template ever breaks due to missing research"
guarantee from the unit research design tenets).

### Colyseus
- [ ] Adjacency-web tree data structure — paths, tiers, per-path-per-tier node definitions,
      adjacency unlock rule (unlocking a tier unlocks the next tier same-path + same-tier
      adjacent-path), tier-local mutual exclusivity flag (not path-local)
- [ ] Armoured branch populated into this structure using the existing TACTICAL_COMBAT.md
      skeleton (motorisation → mechanisation → APC → improved APC → IFV) as real tree
      content — the only branch with real content in this phase
- [ ] Infantry, Artillery, Air, Naval branches — empty stub trees only (structure exists,
      zero nodes defined); explicitly not designed in this phase
- [ ] Variant coexistence — researching a specialization produces a new unit *variant*
      that coexists with the unverspecialized base and with other variants of the same base
      unit, never a destructive replace; a template referencing an unresearched variant
      defaults silently to the base unit, never breaks
- [ ] Research draws from the Phase 10 research-currency pool; no separate currency
      introduced for unit research specifically

### Godot
- [ ] Shared adjacency-web rendering widget — the tree visualization (paths as columns,
      tiers as rows, locked-tier nodes visually distinct) used by both this phase's
      Armoured panel and, retroactively, by Phase 9's building-perk trees (Phase 9 shipped
      ahead of this widget existing — this phase backfills the shared component Phase 9's
      `BuildingUI` was written assuming would exist; Phase 9's perk-tree UI should be
      revisited once this widget is real, rather than maintaining two separate tree-drawing
      implementations)
- [ ] `LandDoctrineUI` panel — Armoured sub-tab populated with real content; Infantry/
      Artillery sub-tabs present but empty, clearly marked not-yet-available rather than
      hidden, so the panel structure is correct even though most content is stubbed
- [ ] `DivisionBuilder` — variant selection at the unit-slot level once a variant is
      researched; unresearched slots show the base unit only, no broken or greyed-out state

### Verification gate
Research the Armoured tree's motorisation node → mechanisation node becomes available
(same-path, next-tier) → Infantry's stub tree remains empty and clearly marked, not
silently populated with placeholder content. Build a division template referencing a
not-yet-researched Armoured variant → template loads using the base unit, does not error.
Research a variant → existing saved templates referencing the base unit are unaffected;
only newly-built templates can select the variant. Confirm Infantry/Artillery/Air/Naval
panels render their empty-stub state without crashing or showing Armoured's content by
mistake.

---

## Phase 12 — Air Combat

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
      with Phase 7 supply graph)
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

## Phase 13 — Naval Combat

**Goal:** Flotillas with all ten ship classes exist on the strategic map. Three-zone
engagement resolves correctly. Submarine Active/Silent modes, class posture controls, fog of
war, and carrier presets all work. Port economy (three independent upgrade tracks per port),
trade routes, blockade system, naval bombardment, coastal battery and fort buildings, cargo
simulation with sinking events, and naval base shielding are all functional. Naval supply
interdiction feeds into the Phase 7 supply graph.

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
- [ ] Supply base: acts as supply hub (same graph flow as Phase 7 inland supply hubs);
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
      (feeds Phase 7 supply graph)
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

---

## Phase 14 — Economy Integration

**Goal:** The three placeholder mechanics shipped in Phase 9 because their real dependencies
didn't exist yet are now wired to the genuine systems those dependencies provide. No new
player-facing mechanic is introduced in this phase — everything here was already designed
and already playable in placeholder form; this phase only replaces the placeholder
implementation with the real one.

**Why this phase exists instead of just stubbing forever:** Phase 9 (Resource Economy)
needed to ship before Naval Combat (Phase 13) and before Air Combat (Phase 12) had any real
content, because Economy is a prerequisite for a playable strategic loop far earlier than
either combat system is ready. Rather than let three mechanics stay permanently degraded
(flat sea-zone-presence checks instead of real blockade percentages, a placeholder research
flag instead of a real air-doctrine gate, border-adjacency-only trade with no transit
routing), this phase closes that gap once every real dependency is finally available.

**Why here, after Naval Combat, and not earlier:** two of the three items need Naval Combat
specifically (the blockade-percentage swap needs Phase 13's working blockade system; nothing
upstream of Phase 13 would let this phase do anything but stub again). The third item
(transit-rights routing) only needs Phase 10 (Diplomacy), which finished long before this
point — it could technically have been wired in earlier, but bundling all three swaps into
one phase, done once after the last of the three dependencies (Naval Combat) is ready, is
simpler to schedule and verify than splitting the transit-rights swap out on its own for no
real benefit.

**A note on Aluminium specifically:** this phase swaps Aluminium's placeholder research flag
for the real air-doctrine-tier gate only if Phase 11's Air specialization tree has real
content by this point. Phase 11 explicitly stubs Air as an empty tree — if Air doctrine
research still has no real nodes when this phase runs, Aluminium's mechanic should be
flagged as still-deferred here rather than wired to an empty tree that would make the
mechanic permanently inert. This phase does not commit to designing Air's tree itself; that
remains out of scope for everything in this document, same as it was in Phase 11.

**Testing:** Regression tests confirming the placeholder-to-real swap doesn't change behaviour
for nations not currently affected by a blockade/transit grant (i.e. the swap should be
invisible until the real mechanic is actually exercised).

### Colyseus
- [ ] Standing trade route disruption — replace Phase 9's flat "enemy unit present in sea
      zone" check with real NAVAL_COMBAT.md blockade-percentage throughput reduction; existing
      trade routes re-evaluate against the real check immediately on this system going live,
      no save-data migration needed since the route's existence and parties are unchanged,
      only the disruption math underneath it
- [ ] Land trade route transit routing — consume the Phase 10 transit-rights flag to allow a
      land route through a non-participant neighbour's territory; routes that were previously
      rejected for non-bordering nations become possible once a transit grant exists
- [ ] Aluminium mechanic — replace Phase 9's placeholder research flag with the real
      air-doctrine-research-tier gate, **conditional on Phase 11's Air tree having real
      content by this point**; if it does not, leave the placeholder in place and note this
      explicitly rather than wiring to an empty tree

### Godot
- [ ] `TradeRouteUI` — sea-zone disruption indicator updated to reflect real blockade
      percentage rather than a binary present/absent enemy-unit flag
- [ ] `DiplomacyUI` — transit-rights grant option now visibly enables a previously-rejected
      land route in the trade route planner, rather than the option existing with no
      observable effect

### Verification gate
Establish a standing port-to-port trade route → enemy fleet partially blockades the sea zone
(not full presence/absence, an actual percentage) → route throughput reduces proportionally,
matching Phase 13's blockade math exactly, not a binary cutoff. Attempt a land trade route
between two non-bordering nations with no transit grant → still rejected; grant transit
rights via Phase 10's flag → route becomes possible, confirming the deferred wiring from
Phase 9's original verification gate. If Phase 11's Air tree has real content by this point,
confirm Aluminium's ceiling now scales with actual air-doctrine tier rather than the flat
placeholder flag; if Air's tree is still stubbed, confirm the placeholder remains active and
no error occurs from attempting to read an empty tree.

---

## Phase 15 — Steam Auth Swap + Polish

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
- [ ] `HUDManager` — *(moved to Phase 5 — UI Foundation; built there so Phase 6 onward
      has a working panel orchestration system from the start)*
- [ ] `NotificationSystem` — full event coverage across land, air, and naval; toast queue
      and animation; naval response window notifications
- [ ] `PostGameUI` — results screen, player rankings, stats delta display
- [ ] `MainMenuUI` — final polish, news/changelog panel
- [ ] `LobbyUI` — final polish, join code display, spectator option
- [ ] `SettingsUI` — audio, graphics settings, final polish *(keybind remapping MVP moved
      to Phase 5 — UI Foundation; this phase adds audio/graphics and polishes the
      keybind UI built there)*

### Verification gate
Launch via Steam → authenticate with real Steam account → play full game with land, air, and
naval active → all notification types fire correctly → postgame screen shows full results →
see Steam achievement unlock.

---

## Phase 16 — Later Modules

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
| `AmphbiousSystem` | `[LATER]` | Shore bombardment and amphibious assault. Requires Phase 13 naval complete. |
| `MineWarfareSystem` | `[LATER]` | Minelayer and minesweeper ship classes. Sea zone denial via minefield placement. Requires Phase 13 naval complete. |
| `MidgetSubmarineSystem` | `[LATER]` | Harbour-penetration submarine variant. Requires naval-land integration design. |
| `WeatherSystem` | `[OPTIONAL]` | Weather overlay affecting terrain movement and combat. Visual + mechanical. |
| `GeneralSystem` | `[OPTIONAL]` | Attachable general units that modify division suppression threshold, retreat behaviour, and attack patterns. |
| `DoctrineSystem` | `[OPTIONAL]` | Nation-level doctrine trees modifying suppression thresholds, supply consumption, air mission effectiveness, naval refit costs. |

---

## Key Principles

- **Bot clients from Phase 3 onward.** One bot script per multiplayer scenario. Run them as
  regression tests whenever a new system is added.
- **Steam auth is Phase 15, not Phase 1.** Email auth keeps JWT shape identical — the swap
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
