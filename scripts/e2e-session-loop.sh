#!/usr/bin/env bash
# End-to-end session loop test.
# Starts api-server + game-server with DEV_MODE=true, runs the session loop bot script, then tears down.
# Usage: bash scripts/e2e-session-loop.sh

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_LOG="$(mktemp)"
GS_LOG="$(mktemp)"

cleanup() {
  echo ""
  echo "Stopping servers..."
  kill "$API_PID" "$GS_PID" 2>/dev/null || true
  rm -f "$API_LOG" "$GS_LOG"
}
trap cleanup EXIT

# Start api-server with DEV_MODE so all accounts get has_host_pass
echo "Starting api-server (DEV_MODE=true)..."
cd "$REPO_ROOT/api-server"
DEV_MODE=true bun run src/index.ts > "$API_LOG" 2>&1 &
API_PID=$!

# Start game-server
echo "Starting game-server..."
cd "$REPO_ROOT/game-server"
npm start > "$GS_LOG" 2>&1 &
GS_PID=$!

# Wait for both servers to be ready
echo "Waiting for servers..."
for i in $(seq 1 20); do
  API_READY=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "0")
  GS_READY=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:2567 2>/dev/null || echo "0")
  if [[ "$API_READY" != "0" && "$GS_READY" != "0" ]]; then
    echo "Servers ready."
    break
  fi
  sleep 1
done

echo ""

# Run the session loop e2e bot script
cd "$REPO_ROOT/game-server"
npx tsx test/session-loop.e2e.ts
