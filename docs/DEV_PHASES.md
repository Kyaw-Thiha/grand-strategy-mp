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

Write one bot script per scenario. They become your regression suite — run them whenever you add a new system to confirm nothing broke.

---

## Phase 1 — Auth + Bare-Bones Connection

**Goal:** Godot can authenticate and connect to Colyseus. Full handshake verified end-to-end.

**Why first:** Auth is a dependency of everything else. JWT shape must be correct before any downstream work begins. The Hono↔Colyseus seam is the trickiest integration point — find problems here, not later.

### Hono
- [x] `/auth/email` — register + login with email/password (Steam replacement for dev)
- [ ] `/auth/refresh` — token refresh *(deferred to Phase 7 — Steam auth swap)*
- [ ] `/profile` GET + PUT *(deferred to Phase 6 — player persistence)*
- [x] JWT signed with `{ sub: user_id, has_host_pass: bool, exp: 24h }`

### Supabase
- [x] `players` table + RLS policy
- [ ] `division_templates` table + RLS policy *(deferred to Phase 6)*
- [x] `game_sessions` table

### Colyseus
- [x] Bare `GameRoom` with `onAuth()` verifying JWT signature
- [x] `GameRoomState` schema skeleton (players map only for now)
- [x] `/internal/verify-host-pass` route on Hono (Hono side done; Colyseus call deferred to Phase 3 — lobby system)

### Godot
- [x] `AuthManager` — email login flow (no Steam yet), stores JWT in memory; parses `has_host_pass` claim
- [x] `APIClient` — HTTP calls to Hono with JWT header
- [x] `NetManager` — WebSocket connect to Colyseus with JWT in handshake

### Verification gate
Godot logs in → receives JWT → connects to Colyseus room → Colyseus logs the verified user_id. Nothing more. If this works cleanly, Phase 1 is done.

> **Phase 1 completed 2026-05.** Email auth + JWT → Colyseus handshake verified end-to-end via `scripts/e2e-auth-handshake.sh`. Steam auth deferred to Phase 7.

---

## Phase 2 — Map (Parallel to Phase 1)

**Goal:** Province map renders in Godot from real GeoJSON data. Click and camera work.

**Why parallel:** No server dependency. GeoJSON pipeline is local work. Map rendering is the visual foundation everything else sits on — want it done early.

### Mapping pipeline
- [x] Download CShapes 1939 GeoJSON
- [x] Process in geojson.io / QGIS — clean borders, assign province IDs matching future nation data
- [x] Conversion script → `map_data.json` (province_id, polygon vertices, metadata)
- [x] Place `map_data.json` in `godot/assets/data/`

### Godot modules
- [x] `MapLoader` — parse `map_data.json`, instantiate Polygon2D nodes, build province registry
- [x] `MapRenderer` — colour provinces by owner (hardcoded test palette, no server state yet)
- [x] `MapInteraction` — click detection, hover highlight, province_clicked signal
- [x] `CameraSystem` — pan, zoom, zoom limits, edge scroll

### Verification gate
Launch Godot → map renders → can click provinces → camera pans and zooms smoothly.

> **Phase 2 completed 2026-06-01.** Pipeline: `map/tools/map_pipeline/pipeline.py`. Output: `client/assets/data/western_europe_6/` (89 provinces, 159 adjacency edges, 8 output files). Debug scene: `client/scenes/debug/map_debug.tscn`.

---

## Phase 3 — Session Loop Skeleton

**Goal:** Two clients can create/join a lobby, pick nations, start a game, and end it.

**Testing:** Bot client for second player.

### Colyseus
- [x] Full `GameRoomState` schema (nations, provinces, units, relations, proposals maps)
- [x] Lobby phase: nation selection, ready state, host-starts (≥2 ready) or all-6-filled auto-start
- [x] Game speed voting (`VOTE_SPEED` majority vote); pause/resume deferred to Phase 8
- [x] `GAME_STARTED`, `GAME_ENDED` events broadcast
- [x] `game-server/src/data/maps/western_europe_6/nations.ts` + `map_loader.ts` — map-scoped nation definitions

### Hono
- [x] `/lobby/create` — requires `has_host_pass`; generates 6-char join code; in-memory lobby store
- [x] `/lobby/activate` — links Colyseus `room_id` to join code after host WebSocket connects
- [x] `/lobby/resolve/:code` — resolves join code to `room_id` for joiners
- [x] `/lobby/public` — list open (activated) lobbies
- [x] `/internal/game-end` — receives results, writes to `game_sessions`, cleans up lobby entry
- [x] `DEV_MODE=true` env var grants `has_host_pass: true` to all registered accounts

### Godot
- [x] `LobbySystem` — create/join/activate, nation pick, deselect, ready, start, vote speed
- [x] `SessionManager` — `GAME_STARTED`/`GAME_ENDED` → scene transitions
- [x] `SceneManager` — main menu → lobby → game → postgame
- [x] `GameState` — mirrors server state from `LOBBY_STATE_UPDATE` deltas; emits `EventBus` signals on change
- [x] `EventBus` — all core signals defined; `lobby_state_updated` drives lobby UI refresh
- [x] `CommandQueue` — single conduit for all outgoing server commands; validates auth + connection
- [x] `MsgPack` autoload — msgpack encode/decode for Colyseus binary protocol (Colyseus 0.17)
- [x] Main menu scene (`scenes/main_menu/`) — login form, create/join/browse lobby buttons
- [x] Lobby scene (`scenes/lobby/`) — nation list, player list, ready/start; debug autofill credentials
- [x] Postgame scene stub (`scenes/postgame/`)
- [x] `client/assets/data/western_europe_6/nations.json` — 6 playable nation definitions

### Testing
- [x] `scripts/e2e-session-loop.sh` + `game-server/test/session-loop.e2e.ts` — 11-step bot E2E test
- [x] `docs/LOCAL_TESTING.md` — two-instance Godot testing guide with debugging gotchas

### Verification gate
Player A creates lobby → bot joins → both pick nations → start → bot sends a VOTE_SPEED → game ends cleanly → results posted to Hono.

> **Phase 3 completed 2026-06-02.** E2E bot test passes all 11 steps (`bash scripts/e2e-session-loop.sh`). Two Godot instances verified in local play: login → create lobby → join by code → select nations → ready up → start → both transition to game scene. See `docs/LOCAL_TESTING.md` for setup instructions and a record of debugging gotchas (Colyseus 0.17 protocol, GDScript lambda closures, `.tscn` unique_name_in_owner syntax).

---

## Phase 4 — Military Core

**Goal:** Units exist on the map, can move and fight. Combat resolves server-side and displays on client.

**Why fourth:** This is the heart of the RTS feel. Everything else builds on top of it.

**Testing:** Bot client sending opposing move/attack orders against your Godot client.

### Colyseus (server-side simulation)
- [ ] Unit spawning at game start (from starting positions config)
- [ ] `MOVE_UNIT` handler — pathfinding or direct province-to-province movement
- [ ] Movement tick — units advance toward target each server tick
- [ ] `ATTACK` handler — initiates combat between units in same/adjacent province
- [ ] Combat resolution — strength/organisation math, attrition per tick
- [ ] Province capture logic — ownership transfers on defender elimination
- [ ] `COMBAT_STARTED`, `COMBAT_RESULT`, `PROVINCE_CAPTURED` events broadcast
- [ ] `DEPLOY_UNIT`, `DISBAND_UNIT` handlers

### Godot
- [ ] `MilitarySystem` — unit icon nodes on map, selection, order submission
- [ ] `CombatSystem` — battle icons, attrition display, outcome popups
- [ ] `MapRenderer` update — recolour provinces on `province_captured`
- [ ] `NotificationSystem` — combat result toasts

### Verification gate
Move unit → it visually traverses the map → attacks enemy bot unit → combat resolves → province changes colour → notification appears.

---

## Phase 5 — Economy + Diplomacy

**Goal:** Resources accumulate, players can form alliances and declare war.

**Testing:** Bot client for diplomacy (needs two-player proposals/responses).

### Colyseus
- [ ] Economy tick — resource generation per province per tick, stored in player state
- [ ] `BUILD` handler — construct buildings in provinces (costs resources)
- [ ] `PROPOSE_DIPLO`, `RESPOND_DIPLO`, `BREAK_DIPLO` handlers
- [ ] Relation state updates, `DIPLO_PROPOSAL`, `DIPLO_ACCEPTED`, `DIPLO_REJECTED` events
- [ ] Alliance combat rules — allied units don't fight each other

### Godot
- [ ] `EconomySystem` — resource bars, production display from GameState
- [ ] `DiplomacySystem` — proposal cache, propose/respond methods
- [ ] `DiplomacyUI` panel — propose alliance, accept/reject incoming proposals, treaty list
- [ ] `EconomyUI` panel — resource overview, province production detail

### Verification gate
Resources tick up → build a fort → propose alliance to bot → bot accepts → bot's units no longer attack yours → break alliance → war declared.

---

## Phase 6 — Player Persistence

**Goal:** Division templates persist between sessions. Stats accumulate after each game.

### Hono
- [ ] `/divisions` CRUD routes fully implemented and tested
- [ ] `/internal/game-end` updates player stats (games_played, games_won, playtime_hrs)
- [ ] `/internal/player/:user_id/templates` loads templates into Colyseus at game start

### Godot
- [ ] `PlayerProfile` — fetch and cache profile, stats, cosmetics
- [ ] `DivisionBuilder` — template creation UI, save/load/delete via APIClient
- [ ] `SupabaseClient` — direct reads for own profile data

### Colyseus
- [ ] On game start: fetch each player's templates from Hono, load into room state
- [ ] `DEPLOY_UNIT` validates against player's loaded templates

### Verification gate
Create division template → start game → deploy that division type → game ends → stats updated → check profile shows correct games_played.

---

## Phase 7 — Steam Auth Swap + Polish

**Goal:** Email auth replaced with real Steam auth. Core loop polished enough for first playtesters.

**Why late:** Steam auth requires a published Steam app ID and Steamworks review. Email auth kept the JWT shape identical so this is a drop-in swap at the Hono layer.

### Hono
- [ ] `/auth/steam` — replace `/auth/email`. Calls `ISteamUserAuth/AuthenticateUserTicket` server-side
- [ ] Remove email auth routes

### Godot
- [ ] `SteamManager` — GodotSteam init, `getAuthTicketForWebApi()`, ticket hex-encoding
- [ ] `AuthManager` — swap email flow for Steam ticket flow
- [ ] Steam overlay integration (open store page, etc)

### Polish
- [ ] `HUDManager` — panel show/hide orchestration, keyboard shortcuts
- [ ] `NotificationSystem` — full event coverage, toast queue, animation
- [ ] `PostGameUI` — results screen, player rankings, stats delta display
- [ ] `MainMenuUI` — final polish, news/changelog panel
- [ ] `LobbyUI` — final polish, join code display, spectator option
- [ ] `SettingsUI` — audio, graphics, keybinds, saved to local config

### Verification gate
Launch via Steam → authenticate with real Steam account → play full game → see Steam achievement unlock.

---

## Phase 8 — Later Modules

Full contracts written when implementation begins. Prioritise based on playtester feedback.

| Module | Purpose |
|---|---|
| `PoliticsSystem` | Nation ideology, government type, political decisions |
| `TechSystem` | Research tree display and queue management |
| `SupplySystem` | Supply line visualisation, out-of-supply penalties |
| `MinimapSystem` | Small viewport minimap, click to pan |
| `CosmeticSystem` | Apply owned unit skins and nation themes |
| `ShopSystem` | In-game cosmetic store and resale marketplace |
| `AudioManager` | Music, SFX, volume settings |
| `VFXManager` | Combat particles, province capture flash, movement trails |
| `SpectatorSystem` | Observe ongoing sessions read-only |
| `AchievementSystem` | Steam achievement unlocks from game events |
| `AIPlayerSystem` | Server-side AI for unfilled nation slots (Colyseus module) |
| `LobbyTimerSystem` | Auto-start lobby after configurable countdown (3–5 min). Used for auto-generated sessions with AI-filled slots. Requires `AIPlayerSystem`. |
| `WeatherSystem` | Weather overlay, visual only |

---

## Key Principles

- **Bot clients from Phase 3 onward.** One bot script per multiplayer scenario. Run them as regression tests whenever a new system is added.
- **Steam auth is Phase 7, not Phase 1.** Email auth keeps JWT shape identical — the swap is one Hono route change.
- **Server is always authoritative.** If a system needs a client-side prediction later, add it then — don't pre-optimise.
- **Each phase has a verification gate.** Don't start the next phase until the gate passes cleanly.
