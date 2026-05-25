# Grand Strategy Game — Godot Client

## Requirements
- Godot 4.x (Forward+ renderer)
- GodotSteam and Supabase addons (included in `addons/`)

## Running Locally
Open the project in Godot editor and press Play. The `Config` autoload automatically points to localhost in debug builds:
- API server: `http://localhost:3000`
- Game server: `ws://localhost:2567`

Make sure both servers are running locally before playing:
```bash
# api-server
cd api-server && bun run src/index.ts

# game-server
cd game-server && npm start
```

## Before Deploying to Production
Update the production URLs in `src/core/config.gd`:
```gdscript
API_URL = "https://your-api.railway.app"
COLYSEUS_URL = "wss://your-colyseus.railway.app"
```

These are only used in exported (release) builds — debug builds always use localhost.
