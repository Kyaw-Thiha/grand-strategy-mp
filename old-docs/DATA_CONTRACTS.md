# Grand Strategy Multiplayer — Data Contracts

> Defines all data shapes flowing between Godot, Hono, Colyseus, and Supabase.
> Feed this to Claude Code when working on networking, persistence, or API routes.
> Last updated: May 2026.

Items marked `[TBD]` have a defined envelope but values that depend on game design decisions
not yet finalised (unit types, resource types, tech categories). The contract holds — only
the string values inside change.

---

## Shared Types

Defined in `packages/shared-types/index.ts`.
Imported by both Hono and Colyseus. Mirrored manually in GDScript constants.

### Enums

```typescript
// Stable — all values known
export type GamePhase =
  | "lobby"          // pre-game, nation picking
  | "running"        // simulation ticking
  | "paused"         // majority voted pause
  | "ended"          // game over, results pending

export type UnitState =
  | "idle"
  | "moving"
  | "combat"
  | "retreating"
  | "training"       // being raised in province
  | "encircled"

export type DiplomaticStance =
  | "war"
  | "neutral"
  | "non_aggression"
  | "alliance"
  | "trade_agreement"

// Open enums — envelope stable, values TBD
export type UnitType    = string   // [TBD] "infantry" | "armor" | "artillery" | ...
export type ResourceType = string  // [TBD] "manpower" | "steel" | "fuel" | ...
export type TechCategory = string  // [TBD] "land" | "naval" | "air" | "industry" | ...
export type BuildingType = string  // [TBD] "factory" | "fort" | "port" | ...
export type EndReason    = string  // [TBD] "conquest" | "timeout" | "concession" | ...
```

### Core Entity Interfaces

```typescript
export interface PlayerInfo {
  user_id:       string          // Supabase UUID
  steam_id:      string          // Steam 64-bit ID string
  display_name:  string
  nation_id:     string          // which nation they control
  color_hex:     string          // map rendering colour e.g. "#4A90D9"
  is_connected:  boolean
  is_ready:      boolean         // lobby phase only
  is_ai:         boolean         // AI-controlled slot
}

export interface ProvinceData {
  province_id:    string         // matches GeoJSON feature id from map_data.json
  owner_id:       string         // user_id, empty string = unowned
  core_ids:       string[]       // nation_ids with historical claim
  is_capital:     boolean
  is_contested:   boolean
  population:     number
  industry:       number         // abstract 0–100
  infrastructure: number         // affects movement speed 0–100
  fort_level:     number         // 0–5
  port:           boolean
  air_base:       boolean
  resources:      Record<ResourceType, number>  // [TBD]
}

export interface UnitData {
  unit_id:            string
  owner_id:           string
  unit_type:          UnitType       // [TBD]
  template_id:        string         // division template id, empty if none
  province_id:        string         // current location
  target_province_id: string         // movement target, empty if none
  state:              UnitState
  strength:           number         // 0–100
  organisation:       number         // 0–100, degrades in combat
  combat_target_id:   string         // unit_id of current combat target, empty if none
}

export interface DiplomaticRelation {
  from_id:    string
  to_id:      string
  stance:     DiplomaticStance
  since_tick: number
}

export interface DiplomaticProposal {
  proposal_id:  string
  from_id:      string
  to_id:        string
  stance:       DiplomaticStance
  expires_tick: number
}
```

---

## Colyseus Schema

Defined in `colyseus/src/schema/GameRoomState.ts`.
Uses `@colyseus/schema` decorators for automatic delta-sync to clients.
Only changed fields are transmitted each tick.

```typescript
import { Schema, type, MapSchema } from "@colyseus/schema"

class PlayerState extends Schema {
  @type("string")  user_id:      string
  @type("string")  steam_id:     string
  @type("string")  display_name: string
  @type("string")  nation_id:    string
  @type("string")  color_hex:    string
  @type("boolean") is_connected: boolean
  @type("boolean") is_ready:     boolean
  @type("boolean") is_ai:        boolean = false
}

class ProvinceState extends Schema {
  @type("string")  province_id:    string
  @type("string")  owner_id:       string    // "" = unowned
  @type("boolean") is_contested:   boolean
  @type("boolean") is_capital:     boolean
  @type("number")  population:     number
  @type("number")  industry:       number
  @type("number")  infrastructure: number
  @type("number")  fort_level:     number
  @type("boolean") port:           boolean
  @type("boolean") air_base:       boolean
  // Stored as JSON string until ResourceType enum is finalised [TBD]
  @type("string")  resources_json: string
}

class UnitState extends Schema {
  @type("string") unit_id:            string
  @type("string") owner_id:           string
  @type("string") unit_type:          string  // [TBD]
  @type("string") template_id:        string  // "" if none
  @type("string") province_id:        string
  @type("string") target_province_id: string  // "" if none
  @type("string") state:              string  // UnitState enum value
  @type("number") strength:           number
  @type("number") organisation:       number
  @type("string") combat_target_id:   string  // "" if none
}

class RelationState extends Schema {
  @type("string") from_id:    string
  @type("string") to_id:      string
  @type("string") stance:     string
  @type("number") since_tick: number
}

class ProposalState extends Schema {
  @type("string") proposal_id:  string
  @type("string") from_id:      string
  @type("string") to_id:        string
  @type("string") stance:       string
  @type("number") expires_tick: number
}

export class GameRoomState extends Schema {
  @type("string") game_id:      string
  @type("string") map_id:       string
  @type("string") phase:        string   // GamePhase enum value
  @type("number") tick:         number = 0
  @type("number") game_speed:   number = 2   // 1–5
  @type("number") tick_rate_ms: number = 500

  // Map keys documented below
  @type({ map: PlayerState })   players   = new MapSchema<PlayerState>()
  @type({ map: ProvinceState }) provinces = new MapSchema<ProvinceState>()
  @type({ map: UnitState })     units     = new MapSchema<UnitState>()
  @type({ map: RelationState }) relations = new MapSchema<RelationState>()
  @type({ map: ProposalState }) proposals = new MapSchema<ProposalState>()
}
```

**Map keys:**
| Map | Key |
|---|---|
| `players` | `user_id` |
| `provinces` | `province_id` |
| `units` | `unit_id` |
| `relations` | `"${from_id}:${to_id}"` |
| `proposals` | `proposal_id` |

---

## Colyseus Message Protocol

All messages are JSON: `{ type: string, payload: object }`.
Client → Server messages are validated server-side before any state mutation.
Server → Client events are out-of-band notifications (state changes flow via schema delta).

### Client → Server Commands

```typescript
// Session control
{ type: "SET_READY",      payload: { ready: boolean } }
{ type: "VOTE_SPEED",     payload: { speed: 1 | 2 | 3 | 4 | 5 } }
{ type: "REQUEST_PAUSE",  payload: {} }

// Military
{ type: "MOVE_UNIT",      payload: { unit_id: string, target_province_id: string } }
{ type: "ATTACK",         payload: { unit_id: string, target_province_id: string } }
{ type: "STOP_UNIT",      payload: { unit_id: string } }
{ type: "RETREAT",        payload: { unit_id: string, to_province_id: string } }
{ type: "DEPLOY_UNIT",    payload: { template_id: string, province_id: string } }
{ type: "DISBAND_UNIT",   payload: { unit_id: string } }

// Diplomacy
{ type: "PROPOSE_DIPLO",  payload: { to_id: string, stance: DiplomaticStance, expires_tick?: number } }
{ type: "RESPOND_DIPLO",  payload: { proposal_id: string, accept: boolean } }
{ type: "BREAK_DIPLO",    payload: { with_id: string, stance: "war" | "neutral" } }

// Economy / construction [TBD — envelope defined, building_type values pending]
{ type: "BUILD",          payload: { province_id: string, building_type: string } }
{ type: "QUEUE_RESEARCH", payload: { tech_id: string } }
```

### Server → Client Events

These are fired via `room.broadcast()` or `client.send()` — separate from schema delta.
They represent things that *happened* and warrant a UI notification.

```typescript
// Combat
{ type: "COMBAT_STARTED",    data: { attacker_id: string, defender_id: string, province_id: string } }
{ type: "COMBAT_RESULT",     data: { province_id: string,
                                     outcome: "attacker_wins" | "defender_wins" | "ongoing",
                                     attacker_losses: number,
                                     defender_losses: number } }
{ type: "PROVINCE_CAPTURED", data: { province_id: string,
                                     new_owner_id: string,
                                     old_owner_id: string } }

// Diplomacy
{ type: "DIPLO_PROPOSAL",    data: { proposal: ProposalState } }
{ type: "DIPLO_ACCEPTED",    data: { proposal_id: string, from_id: string } }
{ type: "DIPLO_REJECTED",    data: { proposal_id: string } }

// Players
{ type: "PLAYER_DISCONNECTED", data: { user_id: string, timeout_ticks: number } }
{ type: "PLAYER_ELIMINATED",   data: { user_id: string, eliminated_by: string } }

// Game lifecycle
{ type: "GAME_STARTED",      data: { game_id: string, map_id: string } }
{ type: "GAME_PAUSED",       data: { requested_by: string } }
{ type: "GAME_RESUMED",      data: {} }
{ type: "GAME_ENDED",        data: { winner_id: string, reason: EndReason, duration_ticks: number } }
{ type: "SPEED_CHANGED",     data: { speed: number } }
```

---

## Hono REST API

Base URL: `https://api.yourgame.com` (Railway)
All authenticated routes require: `Authorization: Bearer <jwt>`
All responses: `{ ok: true, data: ... }` or `{ ok: false, error: string, code: string }`

### Auth

```
POST /auth/steam
  Body:     { ticket: string, steam_id: string, identity: "mygame" }
  Response: { token: string, player: PlayerProfile }
  Notes:    ticket must be hex-encoded. identity must match getAuthTicketForWebApi() call.

POST /auth/refresh
  Body:     { token: string }
  Response: { token: string }
  Notes:    Call when JWT is within 1 hour of expiry.
```

### Player Profile (authenticated)

```
GET  /profile
  Response: PlayerProfile

PUT  /profile
  Body:     { display_name?: string }
  Response: PlayerProfile

GET  /profile/:user_id
  Response: PublicPlayerProfile   // name + stats only, no cosmetics
```

### Division Templates (authenticated)

```
GET    /divisions
  Response: DivisionTemplate[]

POST   /divisions
  Body:     { name: string, composition: UnitSlot[] }   // UnitSlot [TBD]
  Response: DivisionTemplate

PUT    /divisions/:id
  Body:     { name?: string, composition?: UnitSlot[] }
  Response: DivisionTemplate

DELETE /divisions/:id
  Response: { deleted: true }
```

### Shop (authenticated)

```
GET  /shop/items
  Response: ShopItem[]   // each includes "owned: boolean" for this player

POST /shop/purchase
  Body:     { item_id: string }
  Response: { cosmetics_owned: string[] }

POST /shop/list
  Body:     { item_id: string, price_cents: number }
  Response: { listing_id: string }
```

### Lobby (authenticated)

```
POST /lobby/create
  Body:     { map_id: string, max_players: number, private: boolean }
  Response: { room_id: string, join_code: string }
  Notes:    Requires has_host_pass: true. Validated server-side.

GET  /lobby/public
  Response: LobbyListing[]
```

### Response Type Definitions

```typescript
interface PlayerProfile {
  user_id:        string
  steam_id:       string
  display_name:   string
  created_at:     string          // ISO 8601
  has_host_pass:  boolean
  stats: {
    games_played: number
    games_won:    number
    playtime_hrs: number
  }
  cosmetics_owned: string[]       // item_ids
}

interface PublicPlayerProfile {
  user_id:      string
  display_name: string
  stats: {
    games_played: number
    games_won:    number
  }
}

interface DivisionTemplate {
  id:          string
  player_id:   string
  name:        string
  composition: UnitSlot[]         // [TBD]
  created_at:  string
  updated_at:  string
}

interface ShopItem {
  item_id:     string
  name:        string
  type:        string             // "unit_skin" | "nation_theme" | ...
  price_cents: number
  owned:       boolean
  metadata:    Record<string, unknown>  // preview url, skin paths, etc
}

interface LobbyListing {
  room_id:       string
  map_id:        string
  host_name:     string
  player_count:  number
  max_players:   number
  nations_taken: string[]         // nation_ids already claimed
}
```

---

## Supabase Database Schema (Drizzle)

Defined in `hono/src/db/schema.ts`.
Only Hono (service_role) and Colyseus (via Hono /internal/) write here.
Godot reads via anon key — RLS ensures only own rows are visible.

```typescript
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core"

export const players = pgTable("players", {
  id:            uuid("id").primaryKey().defaultRandom(),
  steam_id:      text("steam_id").notNull().unique(),
  display_name:  text("display_name").notNull(),
  has_host_pass: boolean("has_host_pass").default(false),
  created_at:    timestamp("created_at").defaultNow(),
  stats:         jsonb("stats").default({
                   games_played: 0,
                   games_won:    0,
                   playtime_hrs: 0,
                 }),
})

export const division_templates = pgTable("division_templates", {
  id:          uuid("id").primaryKey().defaultRandom(),
  player_id:   uuid("player_id").references(() => players.id).notNull(),
  name:        text("name").notNull(),
  composition: jsonb("composition").notNull(),   // UnitSlot[] [TBD]
  created_at:  timestamp("created_at").defaultNow(),
  updated_at:  timestamp("updated_at").defaultNow(),
})

export const cosmetics = pgTable("cosmetics", {
  id:               uuid("id").primaryKey().defaultRandom(),
  player_id:        uuid("player_id").references(() => players.id).notNull(),
  item_id:          text("item_id").notNull(),
  acquired_at:      timestamp("acquired_at").defaultNow(),
  for_sale:         boolean("for_sale").default(false),
  sale_price_cents: integer("sale_price_cents"),
})

export const shop_items = pgTable("shop_items", {
  id:          text("id").primaryKey(),          // human-readable slug e.g. "german_panzer_skin"
  name:        text("name").notNull(),
  type:        text("type").notNull(),            // "unit_skin" | "nation_theme" | ...
  price_cents: integer("price_cents").notNull(),
  active:      boolean("active").default(true),
  metadata:    jsonb("metadata"),                 // skin paths, preview url, etc
})

export const game_sessions = pgTable("game_sessions", {
  id:             uuid("id").primaryKey(),         // = Colyseus room_id
  map_id:         text("map_id").notNull(),
  started_at:     timestamp("started_at").notNull(),
  ended_at:       timestamp("ended_at"),
  duration_secs:  integer("duration_secs"),
  winner_id:      uuid("winner_id").references(() => players.id),
  end_reason:     text("end_reason"),              // EndReason value
  player_results: jsonb("player_results"),         // PlayerResult[] — see below
})

// PlayerResult shape (inside player_results jsonb array):
// {
//   player_id:      string,
//   nation_id:      string,
//   rank:           number,
//   provinces_held: number,
//   eliminated:     boolean,
//   playtime_secs:  number,
// }
```

### Row Level Security Policy (reference)

```sql
-- players: own row only
CREATE POLICY "own row" ON players
  FOR SELECT USING (steam_id = current_setting('request.jwt.claims')::json->>'steam_id');

-- division_templates: own rows only
CREATE POLICY "own templates" ON division_templates
  FOR SELECT USING (player_id = (
    SELECT id FROM players WHERE steam_id = current_setting('request.jwt.claims')::json->>'steam_id'
  ));

-- cosmetics: own rows only
CREATE POLICY "own cosmetics" ON cosmetics
  FOR SELECT USING (player_id = (
    SELECT id FROM players WHERE steam_id = current_setting('request.jwt.claims')::json->>'steam_id'
  ));
```

---

## Internal API (Server → Server)

Colyseus calls Hono on `/internal/*` routes.
Auth header: `Authorization: Internal <INTERNAL_SECRET>` (shared env var, never a player JWT).

```
GET  /internal/player/:user_id/templates
  Returns: DivisionTemplate[]
  Used by: Colyseus at game start to load each player's templates into room state.

POST /internal/game-end
  Body:
    {
      game_id:       string,
      map_id:        string,
      started_at:    string,       // ISO 8601
      duration_secs: number,
      winner_id:     string,       // user_id
      end_reason:    string,       // EndReason
      player_results: Array<{
        player_id:      string,
        nation_id:      string,
        rank:           number,
        provinces_held: number,
        eliminated:     boolean,
        playtime_secs:  number,
      }>
    }
  Response: { ok: true }
  Used by: Colyseus on GAME_ENDED before room is destroyed.

POST /internal/verify-host-pass
  Body:     { user_id: string }
  Response: { valid: boolean }
  Used by: Colyseus to check if room creator can host private lobbies.
```

### Colyseus JWT Verification

```typescript
// colyseus/src/rooms/GameRoom.ts
async onAuth(client: Client, options: { token: string }) {
  const payload = jwt.verify(options.token, process.env.JWT_SECRET) as JWTPayload
  // Payload shape:
  // {
  //   sub:            string,   // user_id (Supabase UUID)
  //   steam_id:       string,
  //   has_host_pass:  boolean,
  //   exp:            number,
  // }
  return payload  // attached to client.auth for duration of session
}
```

---

## GDScript Type Mirrors

These GDScript constants mirror the TypeScript enums for type-safety in Godot.
Defined in `src/core/game_constants.gd` (autoloaded as `GameConst`).

```gdscript
class_name GameConst

# GamePhase
const PHASE_LOBBY   := "lobby"
const PHASE_RUNNING := "running"
const PHASE_PAUSED  := "paused"
const PHASE_ENDED   := "ended"

# UnitState
const UNIT_IDLE       := "idle"
const UNIT_MOVING     := "moving"
const UNIT_COMBAT     := "combat"
const UNIT_RETREATING := "retreating"
const UNIT_TRAINING   := "training"
const UNIT_ENCIRCLED  := "encircled"

# DiplomaticStance
const DIPLO_WAR            := "war"
const DIPLO_NEUTRAL        := "neutral"
const DIPLO_NON_AGGRESSION := "non_aggression"
const DIPLO_ALLIANCE       := "alliance"
const DIPLO_TRADE          := "trade_agreement"

# Command types (Client → Server)
const CMD_SET_READY      := "SET_READY"
const CMD_VOTE_SPEED     := "VOTE_SPEED"
const CMD_REQUEST_PAUSE  := "REQUEST_PAUSE"
const CMD_MOVE_UNIT      := "MOVE_UNIT"
const CMD_ATTACK         := "ATTACK"
const CMD_STOP_UNIT      := "STOP_UNIT"
const CMD_RETREAT        := "RETREAT"
const CMD_DEPLOY_UNIT    := "DEPLOY_UNIT"
const CMD_DISBAND_UNIT   := "DISBAND_UNIT"
const CMD_PROPOSE_DIPLO  := "PROPOSE_DIPLO"
const CMD_RESPOND_DIPLO  := "RESPOND_DIPLO"
const CMD_BREAK_DIPLO    := "BREAK_DIPLO"
const CMD_BUILD          := "BUILD"
const CMD_QUEUE_RESEARCH := "QUEUE_RESEARCH"

# Server event types (Server → Client)
const EVT_COMBAT_STARTED    := "COMBAT_STARTED"
const EVT_COMBAT_RESULT     := "COMBAT_RESULT"
const EVT_PROVINCE_CAPTURED := "PROVINCE_CAPTURED"
const EVT_DIPLO_PROPOSAL    := "DIPLO_PROPOSAL"
const EVT_DIPLO_ACCEPTED    := "DIPLO_ACCEPTED"
const EVT_DIPLO_REJECTED    := "DIPLO_REJECTED"
const EVT_PLAYER_DISCONNECTED := "PLAYER_DISCONNECTED"
const EVT_PLAYER_ELIMINATED  := "PLAYER_ELIMINATED"
const EVT_GAME_STARTED      := "GAME_STARTED"
const EVT_GAME_PAUSED       := "GAME_PAUSED"
const EVT_GAME_RESUMED      := "GAME_RESUMED"
const EVT_GAME_ENDED        := "GAME_ENDED"
const EVT_SPEED_CHANGED     := "SPEED_CHANGED"
```
