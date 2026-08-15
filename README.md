# Grand Strategy Multiplayer

Session-based grand strategy multiplayer game with a Godot 4 client, a Colyseus game server, and a Hono API server.

## First-Time Setup: Download Assets

Large map assets (GeoJSONs, pipeline output) are not in git — they live in Cloudflare R2.
Download them before opening the Godot client or running the map pipeline.

```bash
cp scripts/r2/.env.example scripts/r2/.env
# fill in R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
./scripts/r2/download.sh
```

See `scripts/r2/README.md` for where to find credentials. Requires [rclone](https://rclone.org/install/).

---

## Run Locally

Run the game locally with three processes:

1. API server
2. Game server
3. Godot client

### Requirements

- Godot 4.x
- Bun
- Node.js 20.9 or newer
- npm
- Supabase project credentials

### Configure Environment Files

Create the API server environment file:

```bash
cd api-server
cp .env.example .env
```

Fill in `api-server/.env`:

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
JWT_SECRET=your_shared_secret
DATABASE_URL=...
INTERNAL_SECRET=your_internal_secret
PORT=3000
DEV_MODE=true
```

Create the game server environment file:

```bash
cd ../game-server
cp .env.example .env
```

Fill in `game-server/.env`:

```env
NODE_ENV=development
PORT=2567
JWT_SECRET=your_shared_secret
INTERNAL_SECRET=your_internal_secret
API_SERVER_URL=http://localhost:3000
DEV_MODE=true
```

`JWT_SECRET` and `INTERNAL_SECRET` must match between `api-server/.env` and `game-server/.env`.

You can generate secrets with:

```bash
openssl rand -base64 32
```

### Install Dependencies

Install API server dependencies:

```bash
cd api-server
bun install
```

Install game server dependencies:

```bash
cd ../game-server
npm install
```

### Start the API Server

In one terminal:

```bash
cd api-server
bun run dev
```

The API server runs at:

```text
http://localhost:3000
```

### Start the Game Server

In another terminal:

```bash
cd game-server
npm start
```

The game server runs at:

```text
ws://localhost:2567
```

### Start the Godot Client

Open Godot 4 and import or open the project at:

```text
client/
```

Press **Play** in the Godot editor.

In debug builds, the client automatically connects to:

```text
API server:  http://localhost:3000
Game server: ws://localhost:2567
```

Make sure both servers are running before pressing **Play**.

---
## Coding Agent Skills

Repository-wide instructions live in `AGENTS.md`. Claude Code reads the root
`CLAUDE.md`, which imports the same guide, so the two tools share one policy.

Task workflows live under `skills/`. The post-change documentation workflow is
`skills/docs-reconcile/SKILL.md`; `AGENTS.md` tells every coding agent when to run it.
OpenAI-facing skill metadata lives beside the skill under `agents/openai.yaml`.
