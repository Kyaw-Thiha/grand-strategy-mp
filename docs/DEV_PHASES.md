# Grand Strategy Multiplayer — Development Phases

> Development roadmap and sequencing reference.
> Last updated: May 2026.

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
- [ ] `/auth/email` — register + login with email/password (Steam replacement for dev)
- [ ] `/auth/refresh` — token refresh
- [ ] `/profile` GET + PUT
- [ ] JWT signed with `{ sub: user_id, steam_id: "dev_steamid", has_host_pass: false, exp: 24h }`

### Supabase
- [ ] `players` table + RLS policy
- [ ] `division_templates` table + RLS policy
- [ ] `game_sessions` table

### Colyseus
- [ ] Bare `GameRoom` with `onAuth()` verifying JWT signature
- [ ] `GameRoomState` schema skeleton (players map only for now)
- [ ] `/internal/verify-host-pass` route on Hono, called from Colyseus

### Godot
- [ ] `AuthManager` — email login flow (no Steam yet), stores JWT in memory
- [ ] `APIClient` — HTTP calls to Hono with JWT header
- [ ] `NetManager` — WebSocket connect to Colyseus with JWT in handshake

### Verification gate
Godot logs in → receives JWT → connects to Colyseus room → Colyseus logs the verified user_id. Nothing more. If this works cleanly, Phase 1 is done.

---

## Phase 2 — Map (Parallel to Phase 1)

**Goal:** Province map renders in Godot from real GeoJSON data. Click and camera work.

**Why parallel:** No server dependency. GeoJSON pipeline is local work. Map rendering is the visual foundation everything else sits on — want it done early.

### Mapping pipeline
- [ ] Download CShapes 1939 GeoJSON
- [ ] Process in geojson.io / QGIS — clean borders, assign province IDs matching future nation data
- [ ] Conversion script → `map_data.json` (province_id, polygon vertices, metadata)
- [ ] Place `map_data.json` in `godot/assets/data/`

### Godot modules
- [ ] `MapLoader` — parse `map_data.json`, instantiate Polygon2D nodes, build province registry
- [ ] `MapRenderer` — colour provinces by owner (hardcoded test palette, no server state yet)
- [ ] `MapInteraction` — click detection, hover highlight, province_clicked signal
- [ ] `CameraSystem` — pan, zoom, zoom limits, edge scroll

### Verification gate
Launch Godot → map renders → can click provinces → camera pans and zooms smoothly.

---

## Phase 3 — Session Loop Skeleton

**Goal:** Two clients can create/join a lobby, pick nations, start a game, and end it.

**Testing:** Bot client for second player.

### Colyseus
- [ ] Full `GameRoomState` schema (all maps: players, provinces, units, relations, proposals)
- [ ] Lobby phase: nation selection, ready state, all-ready → transition to running
- [ ] Game speed voting, pause/resume
- [ ] `GAME_STARTED`, `GAME_ENDED` events broadcast

### Hono
- [ ] `/lobby/create` — requires host pass flag
- [ ] `/lobby/public` — list open games
- [ ] `/internal/game-end` — receives results, writes to `game_sessions`

### Godot
- [ ] `LobbySystem` — create/join rooms, nation picking, ready state
- [ ] `SessionManager` — lifecycle phases, scene transitions
- [ ] `SceneManager` — main menu → lobby → game → postgame
- [ ] `GameState` — receives and mirrors server state deltas
- [ ] `EventBus` — wired up, all core signals defined
- [ ] `CommandQueue` — single conduit for all server commands

### Verification gate
Player A creates lobby → bot joins → both pick nations → start → bot sends a VOTE_SPEED → game ends cleanly → results posted to Hono.

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
| `WeatherSystem` | Weather overlay, visual only |

---

## Key Principles

- **Bot clients from Phase 3 onward.** One bot script per multiplayer scenario. Run them as regression tests whenever a new system is added.
- **Steam auth is Phase 7, not Phase 1.** Email auth keeps JWT shape identical — the swap is one Hono route change.
- **Server is always authoritative.** If a system needs a client-side prediction later, add it then — don't pre-optimise.
- **Each phase has a verification gate.** Don't start the next phase until the gate passes cleanly.
