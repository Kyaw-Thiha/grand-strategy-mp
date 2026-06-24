#!/bin/sh
# Download large gitignored assets from Cloudflare R2.
#
# Usage: ./tools/r2/download.sh [--map <map_id>] [--include-dem] [--dry-run]
#
#   --map <map_id>   Map folder to sync (default: europe_1938_6)
#   --include-dem    Also download map/shared/dem/ (~22GB, slow)
#   --dry-run        Preview what would be transferred without actually downloading

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONF_FILE="$SCRIPT_DIR/rclone.conf"
ENV_FILE="$SCRIPT_DIR/.env"

MAP_ID="europe_1938_6"
INCLUDE_DEM=0
DRY_RUN=""

# --- Parse args ---
while [ $# -gt 0 ]; do
  case "$1" in
    --map)         MAP_ID="$2"; shift 2 ;;
    --include-dem) INCLUDE_DEM=1; shift ;;
    --dry-run)     DRY_RUN="--dry-run"; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# --- Load .env ---
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Copy $SCRIPT_DIR/.env.example and fill in credentials."
  exit 1
fi

if [ ! -f "$CONF_FILE" ] || [ "$ENV_FILE" -nt "$CONF_FILE" ]; then
  echo "rclone.conf missing or outdated — running setup..."
  "$SCRIPT_DIR/setup.sh"
fi

# shellcheck disable=SC1090
. "$ENV_FILE"

RCLONE="rclone --config $CONF_FILE"
REMOTE="r2:${R2_BUCKET}"

[ -n "$DRY_RUN" ] && echo "--- DRY RUN ---"
echo "Bucket: $REMOTE"
echo "Map:    $MAP_ID"
echo ""

# --- Sync map source GeoJSONs ---
MAP_SRC="$REMOTE/map/$MAP_ID"
MAP_DEST="$REPO_ROOT/map/$MAP_ID"
mkdir -p "$MAP_DEST"

echo "Downloading map/$MAP_ID/ ..."
$RCLONE sync "$MAP_SRC" "$MAP_DEST" \
  --progress \
  --transfers 8 \
  $DRY_RUN
echo "Done: map/$MAP_ID/"

# --- Sync client pipeline output ---
# Client asset folder name is the map_id field from map.json (may differ from source dir).
# After downloading map source above, map.json is available locally.
MAP_JSON="$REPO_ROOT/map/$MAP_ID/map.json"
CLIENT_FOLDER="$MAP_ID"
if [ -f "$MAP_JSON" ]; then
  PARSED=$(grep -o '"map_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$MAP_JSON" | grep -o '"[^"]*"$' | tr -d '"')
  [ -n "$PARSED" ] && CLIENT_FOLDER="$PARSED"
fi

if [ -n "$CLIENT_FOLDER" ]; then
  CLIENT_SRC="$REMOTE/client/assets/data/$CLIENT_FOLDER"
  CLIENT_DEST="$REPO_ROOT/client/assets/data/$CLIENT_FOLDER"
  mkdir -p "$CLIENT_DEST"
  echo "Downloading client/assets/data/$CLIENT_FOLDER/ ..."
  $RCLONE sync "$CLIENT_SRC" "$CLIENT_DEST" \
    --progress \
    --transfers 8 \
    $DRY_RUN
  echo "Done: client/assets/data/$CLIENT_FOLDER/"
else
  echo "WARN: No client/assets/data/ folder found for '$MAP_ID' in R2. Upload it first."
fi

# --- Sync client non-data assets (fonts, icons, flags, audio, textures, etc.) ---
ASSETS_SRC="$REMOTE/client/assets"
ASSETS_DEST="$REPO_ROOT/client/assets"
mkdir -p "$ASSETS_DEST"
echo "Downloading client/assets/ (non-data) ..."
$RCLONE sync "$ASSETS_SRC" "$ASSETS_DEST" \
  --progress \
  --transfers 8 \
  --exclude "data/**" \
  --exclude "source/**" \
  $DRY_RUN
echo "Done: client/assets/ (non-data)"

# --- Optionally sync DEM tiles ---
if [ "$INCLUDE_DEM" = "1" ]; then
  DEM_SRC="$REMOTE/map/shared/dem"
  DEM_DEST="$REPO_ROOT/map/shared/dem"
  mkdir -p "$DEM_DEST"
  echo "Downloading map/shared/dem/ (~22GB, this will take a while) ..."
  $RCLONE sync "$DEM_SRC" "$DEM_DEST" \
    --progress \
    --transfers 4 \
    --exclude "*.aux.xml" \
    $DRY_RUN
  echo "Done: map/shared/dem/"
fi

echo ""
echo "Download complete."
