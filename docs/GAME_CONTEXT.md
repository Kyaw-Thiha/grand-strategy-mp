# Grand Strategy Multiplayer — Game Context

> Read this first. Quick-reference for AI coding sessions.
> For full technical detail see the other files listed at the bottom.
> Last updated: May 2026.

---

## What This Game Is

Session-based RTS grand strategy multiplayer. The pitch:
- **HoI4 depth** — provinces, diplomacy, military units, economy, research
- **Evening-friendly** — small maps ~1 hour, large maps 4 hours maximum
- **Multiplayer-first** — the session is the product, not a single-player game with MP bolted on
- **No P2W, ever** — ethical monetisation only, free players get a complete fair experience
- **No dead lobbies** — session-based (not persistent), so no inactive player rot

Positioned as: "HoI4 but multiplayer-first. Call of War but session-based and ethical."

---

## What This Game Is NOT

- Not turn-based. Continuous RTS simulation with a game speed system (like HoI4's speed slider)
- Not a persistent world. Sessions start, run, end. Server rooms are ephemeral.
- Not P2P. Authoritative server (Colyseus) resolves all simulation. Clients display results only.
- Not a solo game with multiplayer added later. Everything is designed for 2–20 players.

---

## Core Design Decisions (locked)

| Decision | Choice | Reason |
|---|---|---|
| Session length | 1–4 hours | Fits an evening, solves scheduling problem |
| Simulation authority | Server-only (Colyseus) | No desync, no cheating |
| Monetisation | Free to join, one-time host pass, cosmetics only | Ethical, no P2W |
| Free player experience | Full gameplay, random nation | Zero barrier to discovery |
| Paid features | Host/private lobby, nation pick, cosmetics | Control + expression, never advantage |

---

## Three Target Audiences

**HoI4 / EU4 lapsed players** — love grand strategy, left because of 8hr sessions, desync, scheduling hell. Pitch: same depth, 1–4hr, works reliably.

**Call of War escapees** — burnt by P2W and month-long obligations. Pitch: session-based, fair competition, narrative closure.

**War of Dots / minimalist MP crowd** — already session-trained, hitting the depth ceiling. Pitch: one step up — real nations, diplomacy, unit variety.

---

## Tech Stack (summary)

| Layer | Technology |
|---|---|
| Game client | Godot 4 + GodotSteam + supabase-community/godot addon |
| Game server | Colyseus (Node.js / TypeScript) on Railway |
| API server | Hono + Bun (TypeScript) + Drizzle ORM on Railway |
| Database | Supabase (Postgres) |
| Auth | Steam → Hono → JWT → Supabase (Steam is identity, Supabase is ground truth) |
| AI coding tools | gdai-mcp-plugin → Claude Code + opencode/minimax |
| Map pipeline | CShapes 1939 GeoJSON → QGIS → map_data.json → Godot Polygon2D nodes |

---

## Repo Structure

```
grand-strategy/
├── client/          # Godot project (res:// lives here)
├── game-server/     # Colyseus game server
├── api-server/      # Hono API server
├── packages/
│   └── shared-types/    # TypeScript types shared by game-server/ and api-server/
└── package.json     # pnpm workspaces root
```

---

## Key Architectural Rules (never violate)

1. **GameState is read-only on the client.** Only NetManager updates it from server broadcasts.
2. **All commands go through CommandQueue.** Game logic never calls NetManager directly.
3. **UI never writes game state.** UI reads and emits signals. Systems submit via CommandQueue.
4. **Server resolves all simulation.** Combat, economy, diplomacy — Colyseus only. Client displays.
5. **Colyseus rooms are ephemeral.** Results written to Supabase via Hono before room dies.
6. **Steam API key never leaves Hono.** Environment variable only. Never in client code.
7. **Internal routes use INTERNAL_SECRET.** Never a player JWT. Separate trust domain.
8. **Cross-module communication uses EventBus.** No direct node references between systems.

---

## Current Development Phase

Phase 1 — Auth + bare-bones connection (in progress)
- Email auth (Steam placeholder), Supabase schema, Colyseus bare room, Godot auth + connect
- Phase 2 (map pipeline) runs in parallel

See `DEV_PHASES.md` for full roadmap and verification gates.

---

## What Each File Is For

| File | When to load |
|---|---|
| `GAME_CONTEXT.md` | Every session — read first |
| `ARCHITECTURE.md` | Any session touching infra, auth, folder structure, or the 8 rules |
| `MODULES.md` | Any session implementing or modifying a specific module |
| `DATA_CONTRACTS.md` | Any session touching networking, API routes, or database schema |
| `DEV_PHASES.md` | Planning sessions, deciding what to build next |

---

## Monetisation Model

| Tier | What | Price |
|---|---|---|
| Free | Join public games, random nation assigned | $0 |
| Host pass | Host games, private lobbies, pick nation | ~$10–15 one-time |
| Map DLCs | New theatres / time periods | TBD — free players can join hosted DLC games |
| Cosmetic bundles | Unit skins, nation themes — no gameplay impact | TBD |
| Cosmetic resale | Player-to-player marketplace with dev profit share | Market-priced |

---

## TAM + Revenue Scenarios

| Scenario | Players | Revenue |
|---|---|---|
| Bad case (40%) | 2k–5k | $5–15k |
| Base case (40%) | 20k–50k | $30–80k |
| Good case (15%) | 100k+ | $150k+ |
| Breakout (5%) | 500k+ | Manor Lords territory |

Realistic addressable: 3–5M PC grand strategy players, 500k–1M MP-enthusiast segment.
