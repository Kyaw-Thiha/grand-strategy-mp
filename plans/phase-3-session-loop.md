# Phase 3 — Session Loop Skeleton

## Context

Phase 1 (auth + bare connection) and Phase 2 (map rendering) are both complete. Phase 3 builds the session loop: two players can create a lobby, pick nations, start a game, and end it. This is the infrastructure every downstream system (military, economy, diplomacy) depends on — `GameState`, `CommandQueue`, `EventBus`, `SessionManager`, `SceneManager` all get wired up here.

**Locked decisions:**
- Join code: 6-character short alphanumeric (separate from Colyseus room ID)
- Nations: fixed set of 6 — United Kingdom, France, Germany, Spain, Algeria, Italy (defined in `nations.json`)
- Lobby start conditions: (a) host explicitly starts with ≥2 players ready, OR (b) all 6 nation slots filled and all players ready
- Lobby timer (condition c) is Phase 8 scope — note added to DEV_PHASES.md
- Host pass dev backdoor: `/auth/email` grants `has_host_pass: true` in debug builds, gated by env var `DEV_MODE=true`

---

## Implementation Plan

### Step 0 — nations.json

Create `client/assets/data/nations.json` and a matching server-side copy at `game-server/src/data/nations.json` (or load from shared-types).

```json
[
  { "id": "GBR", "name": "United Kingdom", "colour": "#012169" },
  { "id": "FRA", "name": "France",          "colour": "#002395" },
  { "id": "DEU", "name": "Germany",         "colour": "#000000" },
  { "id": "ESP", "name": "Spain",           "colour": "#c60b1e" },
  { "id": "DZA", "name": "Algeria",         "colour": "#006233" },
  { "id": "ITA", "name": "Italy",           "colour": "#009246" }
]
```

Province assignments (which province IDs belong to each nation) go in a separate `nation_provinces.json` derived from the map pipeline output. Keep definitions separate from assignments so balance can change without touching map data.

---

### Step 1 — Hono additions (`api-server/`)

**Files to modify/create:**
- `api-server/src/routes/auth.ts` — dev backdoor
- `api-server/src/routes/lobby.ts` — new file
- `api-server/src/routes/internal.ts` — add `/internal/game-end`
- `api-server/src/index.ts` — register lobby routes

#### 1a. Dev backdoor on `/auth/email`
When env var `DEV_MODE=true`, set `has_host_pass: true` for all registered accounts. One-line change in the register branch — no separate code path needed.

#### 1b. `/lobby/create` POST
- Requires valid JWT + `has_host_pass: true`
- Calls Colyseus matchmaker to create a room
- Generates a 6-char alphanumeric join code, stores `{ code → room_id }` in a short-lived in-memory map (or Supabase `lobbies` table if persistence needed)
- Returns `{ room_id, join_code }`

#### 1c. `/lobby/public` GET
- No auth required (free players can browse)
- Returns list of open rooms: `[ { room_id, join_code, player_count, nation_slots } ]`
- Pulls from Colyseus HTTP API (`GET /matchmake/lobby`)

#### 1d. `/internal/game-end` POST
- Guarded by `INTERNAL_SECRET`
- Receives `{ game_id, started_at, ended_at, result_json }`
- Writes to `game_sessions` table via Drizzle

---

### Step 2 — Colyseus (`game-server/`)

**Files to modify/create:**
- `game-server/src/rooms/schema/GameRoomState.ts` — expand schema
- `game-server/src/rooms/GameRoom.ts` — lobby phase state machine + handlers
- `game-server/src/data/nations.ts` — nation definitions

#### 2a. Expand `GameRoomState`
Add to the schema (all empty maps for now — downstream phases populate them):
```typescript
phase: string          // "lobby" | "running" | "ended"
map_id: string
nations: MapSchema<NationState>   // nation_id → { player_id, is_ready }
provinces: MapSchema<ProvinceState>  // skeleton only
units: MapSchema<UnitState>          // skeleton only
relations: MapSchema<RelationState>  // skeleton only
proposals: MapSchema<ProposalState>  // skeleton only
game_speed: number
```

`NationState`: `{ nation_id, player_id, is_ready }`

#### 2b. Lobby phase state machine in `GameRoom`

On `onCreate()`:
- Set `phase = "lobby"`, populate `nations` map with 6 slots (all `player_id = ""`).

Message handlers (all validate phase before acting):
- `SELECT_NATION { nation_id }` — assign `player_id` to that slot; error if taken
- `DESELECT_NATION {}` — clear player's current slot
- `SET_READY { ready: bool }` — toggle ready on player's nation slot; check start conditions after each change
- `START_GAME {}` — host only; requires ≥2 players ready; transitions to running
- `VOTE_SPEED { speed: int }` — majority vote; updates `game_speed`
- `END_GAME {}` — host only (or all players disconnected); transitions to ended, calls Hono `/internal/game-end`

Start condition check (runs after `SET_READY` and `SELECT_NATION`):
```
if all 6 nation slots have player_id != "" AND all are ready → auto-start
```

On transition to `"running"`: broadcast `GAME_STARTED { nation_assignments, game_speed }`.
On transition to `"ended"`: broadcast `GAME_ENDED { winner_id, reason }`, POST to Hono.

---

### Step 3 — Godot new autoloads (`client/`)

Wire up in `project.godot` in this order (after existing autoloads):
```
EventBus     → src/core/event_bus.gd
GameState    → src/core/game_state.gd
CommandQueue → src/core/command_queue.gd
SessionManager → src/systems/session/session_manager.gd
SceneManager → src/core/scene_manager.gd
```

**Files to create:**

#### `src/core/event_bus.gd`
Pure signal relay. Define all signals from the module contract. No logic.

#### `src/core/game_state.gd`
- Mirrors server state: `players`, `provinces`, `units`, `relations`, `proposals`, `phase`, `tick`, `game_speed`, `nations`
- `_apply_server_delta(delta: Dictionary)` — called only by NetManager
- Getter methods per the module contract
- On state change, emit the relevant EventBus signal

#### `src/core/command_queue.gd`
- `submit(type: String, payload: Dictionary)` — validates auth + connection state, then calls `NetManager.send_command()`
- Rate limiting stub (can be a no-op for now, enforced server-side)

#### `src/systems/session/session_manager.gd`
- Listens to `NetManager.server_event_received` for `GAME_STARTED`, `GAME_ENDED`, `SPEED_CHANGED`
- Owns phase enum, emits `session_started`, `session_ended`, `speed_changed`

#### `src/core/scene_manager.gd`
- `goto_main_menu()`, `goto_lobby()`, `goto_game()`, `goto_postgame()`
- Uses Godot's `get_tree().change_scene_to_file()`

#### `src/systems/session/lobby_system.gd`
- `create_lobby()` — calls `APIClient.post("/lobby/create")`, then `NetManager.connect_to_room(room_id, jwt)`
- `join_by_code(code: String)` — calls `APIClient.post("/lobby/join", {code})` to resolve room_id, then connects
- `join_public_game()` — fetches `/lobby/public`, picks first open room
- `select_nation(nation_id)`, `deselect_nation()`, `set_ready(bool)` — all go through `CommandQueue`
- Signals: `lobby_created`, `lobby_joined`, `lobby_join_failed`, `nation_selected`, `all_players_ready`

**Update `NetManager`** to handle the Colyseus state sync protocol — when a state patch arrives, call `GameState._apply_server_delta(delta)`. Also add `send_command(type, payload)` method used by `CommandQueue`.

---

### Step 4 — Scenes (`client/`)

**Files to create:**
- `client/scenes/main_menu/main_menu.tscn` + `src/ui/main_menu/main_menu.gd`
- `client/scenes/lobby/lobby.tscn` + `src/ui/lobby/lobby_ui.gd`
- `client/scenes/postgame/postgame.tscn` + `src/ui/postgame/postgame_ui.gd` (stub)

Update `project.godot` main scene to `main_menu.tscn`.

#### Main menu layout
```
┌─────────────────────────────┐
│      [Game Title]           │
│                             │
│  Email: [____________]      │
│  Pass:  [____________]      │
│         [Login]             │
│                             │
│  ── After login ──          │
│  [Create Game]  (host only) │
│  [Join by Code] [______]    │
│  [Browse Public Games]      │
└─────────────────────────────┘
```

#### Lobby layout
```
┌─────────────────────────────────────────────┐
│  Lobby  •  Code: XK7F2A                     │
├──────────────┬──────────────────────────────┤
│ Nations      │ Players                      │
│ ○ GBR        │ Player A  [GBR] ✓ Ready       │
│ ● FRA ←P.B   │ Player B  [FRA]               │
│ ○ DEU        │                              │
│ ○ ESP        │                              │
│ ○ DZA        │                              │
│ ○ ITA        │                              │
├──────────────┴──────────────────────────────┤
│              [Ready Up]    [Start] (host)   │
└─────────────────────────────────────────────┘
```

---

### Step 5 — DEV_PHASES.md update

Add to Phase 8 module list:
```
| `LobbyTimerSystem` | `[LATER]` | Auto-start lobby after configurable countdown (3–5 min). Used for auto-generated sessions with AI-filled slots. Requires AIPlayerSystem. |
```

---

## Testing

### Tier 1 — Automated E2E script

Create `scripts/e2e-session-loop.sh` (same pattern as `e2e-auth-handshake.sh`):
1. Start api-server + game-server
2. Run `game-server/test/session-loop.e2e.ts` — a TypeScript bot script:
   - Bot A: registers (dev backdoor gives host pass), logs in, calls `/lobby/create`, connects, selects GBR, sets ready
   - Bot B: registers, logs in, joins by code, selects FRA, sets ready
   - Assert `GAME_STARTED` received by both bots
   - Bot A sends `END_GAME`
   - Assert `GAME_ENDED` received, Hono `/internal/game-end` was called, `game_sessions` row exists

### Tier 2 — Two Godot instances

In Godot editor: `Debug → Run Multiple Instances → 2`.

Setup:
- Two test accounts seeded in local Supabase (Player A has `has_host_pass=true` via `DEV_MODE=true` backdoor)
- Instance 1: login as Player A → Create Game → get code → select nation → Ready
- Instance 2: login as Player B → Join by Code → enter code → select nation → Ready
- Player A hits Start → both instances transition to game scene (map_debug for now)

### Verification gate (from DEV_PHASES.md)

> Player A creates lobby → bot joins → both pick nations → start → bot sends VOTE_SPEED → game ends cleanly → results posted to Hono.

---

## Critical files

| File | Action |
|---|---|
| `api-server/src/routes/auth.ts` | Add dev backdoor (DEV_MODE guard) |
| `api-server/src/routes/lobby.ts` | Create — `/lobby/create`, `/lobby/public` |
| `api-server/src/routes/internal.ts` | Add `/internal/game-end` |
| `game-server/src/rooms/schema/GameRoomState.ts` | Expand schema |
| `game-server/src/rooms/GameRoom.ts` | Lobby state machine + all handlers |
| `client/src/core/event_bus.gd` | Create |
| `client/src/core/game_state.gd` | Create |
| `client/src/core/command_queue.gd` | Create |
| `client/src/core/scene_manager.gd` | Create |
| `client/src/systems/session/session_manager.gd` | Create |
| `client/src/systems/session/lobby_system.gd` | Create |
| `client/src/net/net_manager.gd` | Update — state sync + send_command |
| `client/scenes/main_menu/main_menu.tscn` + `.gd` | Create |
| `client/scenes/lobby/lobby.tscn` + `.gd` | Create |
| `client/assets/data/nations.json` | Create |
| `game-server/src/data/nations.ts` | Create |
| `docs/DEV_PHASES.md` | Add LobbyTimerSystem to Phase 8 |
| `scripts/e2e-session-loop.sh` | Create |
| `game-server/test/session-loop.e2e.ts` | Create |
