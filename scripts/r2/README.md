# R2 Asset Sync

Syncs large gitignored map assets to/from Cloudflare R2.

## What gets synced

| Local path | R2 path | Size | Notes |
|---|---|---|---|
| `map/europe_1938_6/*.geojson` | `map/europe_1938_6/` | ~20MB | Map source files — source of truth |
| `client/assets/data/western_europe_6/` | `client/assets/data/western_europe_6/` | ~249MB | Pipeline output for Godot |
| `map/shared/dem/*.tif` | `map/shared/dem/` | ~22GB | Raw EU-DEM tiles — opt-in only |

## Setup (new collaborator / fresh checkout)

### 1. Get your R2 credentials

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → click your account
2. **Account ID**: shown in the right sidebar on the account home page (or any R2 page). Copy it.
3. **Access Key + Secret**: R2 (left nav) → R2 **overview page** (not inside a bucket) →
   **Manage R2 API Tokens** button (top-right) → **Create API Token**
   - Permissions: `Object Read & Write`
   - Scope: restrict to the `grand-strategy-game` bucket (or leave as All buckets)
   - Create token → copy **Access Key ID** and **Secret Access Key** (secret shown once only)

### 2. Install rclone (if not already installed)

- Linux: `curl https://rclone.org/install.sh | sudo bash`
- Mac: `brew install rclone`

### 3. Create your .env and download

```bash
cp scripts/r2/.env.example scripts/r2/.env
# fill in R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
./scripts/r2/download.sh
```

`rclone.conf` is generated automatically on first run (and regenerated whenever `.env` changes).
Run `./scripts/r2/setup.sh` manually only if you need to verify or reset the config.

---

## Download assets

```bash
./scripts/r2/download.sh                      # map GeoJSONs + client/assets/data/
./scripts/r2/download.sh --include-dem        # also pull 22GB DEM tiles (needed to regenerate heightmap)
./scripts/r2/download.sh --map europe_1939_6  # different map
```

## Upload after map work

```bash
./scripts/r2/upload.sh                    # push map GeoJSONs + client/assets/data/
./scripts/r2/upload.sh --include-dem      # also push DEM tiles (first time, or after adding tiles)
./scripts/r2/upload.sh --dry-run          # preview without transferring
```

---

## How it works

Uses [rclone](https://rclone.org/) with Cloudflare's S3-compatible R2 endpoint. `rclone sync` is
idempotent — re-running only transfers changed files (checksummed). R2 paths mirror local repo
paths exactly, so browsing the R2 console is self-explanatory.
