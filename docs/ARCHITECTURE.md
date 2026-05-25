# Grand Strategy Multiplayer — Architecture Reference

> Internal reference. Feed this file to Claude Code at the start of every coding session.
> Last updated: May 2026.

---

## Game Concept

Session-based RTS grand strategy multiplayer. HoI4 depth, evening-friendly sessions.

- Small maps: ~1 hour average
- Large maps: 4 hours maximum
- RTS-style continuous simulation (not turn-based), paced like HoI4's game speed system
- No P2W, ethical monetisation only
- Multiplayer-first — the session is the product

---

## Tech Stack

### Client
| Concern | Technology |
|---|---|
| Engine | Godot 4 |
| Steam integration | GodotSteam addon |
| Supabase integration | supabase-community/godot addon |
| AI coding tools | gdai-mcp-plugin → Claude Code + opencode/minimax |
| Mapping pipeline | CShapes 1939 GeoJSON → geojson.io/QGIS → conversion pipeline → `map_data.json` → Godot Polygon2D nodes |

### Game Server
| Concern | Technology |
|---|---|
| Framework | Colyseus (Node.js / TypeScript) |
| Hosting | Railway (or Fly.io) |
| Role | Authoritative game state, RTS simulation tick, room lifecycle, schema delta broadcast to clients |

### API Server
| Concern | Technology |
|---|---|
| Framework | Hono + Bun (TypeScript) |
| Hosting | Railway (same project as Colyseus, separate service) |
| ORM | Drizzle ORM |
| Role | Steam auth bridge, REST API for persistent data, internal Colyseus↔Supabase bridge |

### Persistence
| Concern | Technology |
|---|---|
| Platform | Supabase (Postgres) |
| Role | Ground truth for player accounts, division templates, stats, cosmetics, game session history |

### Shared Code
- A shared TypeScript package (`packages/shared-types/`) consumed by both Hono and Colyseus
- Contains: enums, interfaces, message type definitions
- See `DATA_CONTRACTS.md` for full contents

---

## Infrastructure Topology

```
Godot client
  ├── WebSocket ──────────→ Colyseus (Railway) — real-time game state delta
  ├── HTTP/REST ──────────→ Hono (Railway)     — auth, profile, divisions, shop
  └── Supabase JS SDK ────→ Supabase           — direct reads (own data, anon key + RLS)

Hono (Railway)
  ├── Drizzle ORM ────────→ Supabase Postgres  — writes via service_role key
  └── Steam Web API ──────→ api.steampowered.com — ticket verification

Colyseus (Railway)
  └── Internal HTTP ──────→ Hono /internal/*   — load templates on start, write results on end

Trust boundary: INTERNAL_SECRET env var guards /internal/* routes.
Player JWTs never accepted on internal routes.
```

### Server Cost Estimates
| Stage | Monthly cost |
|---|---|
| Early (0–50 CCU) | $20–40 |
| At 500 CCU | $100–200 |

Session-based architecture means Colyseus rooms spin up per game and spin down on completion.
No persistent world = near-zero idle cost.

---

## Authentication Flow

Steam is the **identity provider**. Supabase is **ground truth**. Hono is the **bridge**.
Supabase does not natively support Steam OpenID — the flow is implemented manually.

```
1. Godot calls Steam.getAuthTicketForWebApi("mygame") via GodotSteam
2. Wait for get_ticket_for_web_api_response callback (do NOT send before this fires)
3. Hex-encode ticket bytes
4. POST /auth/steam  { ticket: "a1b2c3...", steam_id: "7656119..." }
5. Hono calls ISteamUserAuth/AuthenticateUserTicket (secret key stays on server)
6. Steam returns verified steamid64
7. Hono upserts player row in Supabase (service_role key, bypasses RLS)
8. Hono signs JWT: { sub: user_id, steam_id, has_host_pass, exp: 24h }
9. JWT returned to Godot, stored in AuthManager (memory only, never disk)
10. All Hono calls: Authorization: Bearer <jwt>
11. Colyseus connect: jwt passed in handshake options → verified in onAuth()
```

**Critical:** `service_identity` string in `getAuthTicketForWebApi()` must exactly match
the `identity` param used in `AuthenticateUserTicket` on the server. Keep them in sync.

**Never use** `getAuthSessionTicket()` for backend auth — that API is for P2P/BeginAuthSession only.

---

## Godot → Data Layer: When to Go Direct vs Via Hono

| Operation | Route | Why |
|---|---|---|
| Read own profile, stats, cosmetics | Direct → Supabase (anon key + RLS) | Safe, no secret needed |
| Read other player's public profile | Direct → Supabase (anon key + RLS) | Public data, RLS allows |
| Write divisions, purchases | Via Hono (service_role) | Needs server-side validation |
| Auth operations | Via Hono | Needs Steam secret key |
| Game results | Colyseus → Hono internal | Trusted server-to-server |

---

## Godot Project Structure

Option A (layer + domain hybrid) with MODULE.md context files per system folder.

```
res://
├── addons/               # gdai-mcp-plugin, supabase-community addon
├── assets/               # art, audio, fonts — no logic here
├── src/
│   ├── core/             # autoloads: EventBus, GameState, ConfigManager, SceneManager, CommandQueue
│   ├── net/              # NetManager, APIClient, SupabaseClient
│   ├── auth/             # AuthManager, SteamManager
│   ├── systems/          # one subfolder per game domain
│   │   ├── map/          # MapLoader, MapRenderer, MapInteraction, CameraSystem
│   │   ├── military/     # MilitarySystem, CombatSystem
│   │   ├── diplomacy/    # DiplomacySystem
│   │   ├── economy/      # EconomySystem
│   │   ├── politics/     # PoliticsSystem (later)
│   │   ├── tech/         # TechSystem (later)
│   │   ├── session/      # SessionManager, LobbySystem
│   │   └── player/       # PlayerProfile, DivisionBuilder, CosmeticSystem
│   └── ui/               # all UI scenes and scripts
│       ├── hud/          # HUDManager, NotificationSystem
│       ├── menus/        # MainMenuUI, LobbyUI, PostGameUI, SettingsUI
│       └── panels/       # MilitaryUI, DiplomacyUI, EconomyUI, TechUI
├── scenes/               # .tscn roots — mirrors src/ structure
└── ARCHITECTURE.md       # this file — feed to AI at session start
```

Each `src/systems/<domain>/` folder contains a `MODULE.md` with the contract for that domain.
See `MODULES.md` for all contracts.

---

## Core Architectural Rules

These rules must never be violated. When in doubt, check here first.

1. **GameState is read-only on the client.** It is updated only by NetManager from server broadcasts.
   Systems and UI read from it. Nothing else mutates it.

2. **Game logic never calls NetManager directly.** All commands go through CommandQueue.
   CommandQueue is the single conduit between intent and network.

3. **UI never writes game state.** UI reads GameState, emits user intent signals.
   Systems receive those signals and submit via CommandQueue.

4. **Server is authoritative on all simulation.** Combat math, economy ticks, diplomacy resolution,
   supply calculation — all server-side (Colyseus). Client only displays results.

5. **Colyseus rooms are ephemeral.** All data that must survive the session is written to
   Supabase via Hono before the room is destroyed. Never rely on room state after game end.

6. **Steam API key never leaves Hono.** It is an environment variable. Never in client code.

7. **Internal routes use INTERNAL_SECRET, not player JWTs.** Completely separate trust domain.
   Colyseus calls `/internal/*` with `Authorization: Internal <secret>`.

8. **Cross-module communication uses EventBus.** No direct node references between systems.
   Exception: autoloads may be called directly by name (GameState.get_province(), etc).

---

## Monetisation Model

| Tier | What you get | Price |
|---|---|---|
| Free | Join public games, random nation | $0 |
| Host pass | Host games, private lobbies, nation pick | ~$10–15 one-time |
| Map DLCs | New theatres, time periods | TBD — free players can join hosted DLC games |
| Cosmetic bundles | Unit skins, nation themes — no gameplay impact | TBD |
| Cosmetic resale | Player-to-player with dev profit share | Market-priced |

**Core principle:** Free players must have a complete, fair gameplay experience.
Paid features are about control and expression, never about advantage.

---

## AI Coding Session Setup

When starting a Claude Code session, provide:

```
1. This file (ARCHITECTURE.md)
2. MODULES.md (for the relevant module)
3. DATA_CONTRACTS.md (if touching network or persistence)
4. The specific MODULE.md for the system being worked on
5. The .gd file(s) being modified
```

This gives the AI complete context without requiring it to infer dependencies.
