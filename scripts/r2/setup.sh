#!/bin/sh
# One-time setup: validates rclone is installed and writes rclone.conf from .env.
# Run once before using upload.sh or download.sh.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
CONF_FILE="$SCRIPT_DIR/rclone.conf"

# --- Check rclone ---
if ! command -v rclone >/dev/null 2>&1; then
  echo "ERROR: rclone not found."
  echo "Install: https://rclone.org/install/"
  echo "  Linux:  curl https://rclone.org/install.sh | sudo bash"
  echo "  Mac:    brew install rclone"
  exit 1
fi

echo "rclone $(rclone --version | head -1) found."

# --- Load .env ---
if [ ! -f "$ENV_FILE" ]; then
  echo ""
  echo "ERROR: $ENV_FILE not found."
  echo "Copy and fill in: cp $SCRIPT_DIR/.env.example $ENV_FILE"
  exit 1
fi

# shellcheck disable=SC1090
. "$ENV_FILE"

for var in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  eval val=\$$var
  if [ -z "$val" ]; then
    echo "ERROR: $var is not set in $ENV_FILE"
    exit 1
  fi
done

# --- Write rclone.conf ---
cat > "$CONF_FILE" <<EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
acl = private
EOF

echo "rclone.conf written to $CONF_FILE"
echo ""
echo "Setup complete. Next steps:"
echo "  Upload map assets:  ./scripts/r2/upload.sh"
echo "  Download assets:    ./scripts/r2/download.sh"
echo ""
echo "Add --dry-run to preview without transferring files."
