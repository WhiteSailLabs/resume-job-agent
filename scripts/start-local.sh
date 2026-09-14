#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/backend"
FRONTEND_DIR="$ROOT_DIR/apps/frontend"
BACKEND_PID=""

cleanup() {
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    echo "$2" >&2
    exit 1
  fi
}

require_command python3 "Install Python 3.13 or newer: https://www.python.org/downloads/"
require_command uv "Install uv: https://docs.astral.sh/uv/getting-started/installation/"
require_command node "Install Node.js 22 or newer: https://nodejs.org/"
require_command pnpm "Install pnpm: https://pnpm.io/installation"

python3 - <<'PY'
import sys
if sys.version_info < (3, 13):
    raise SystemExit("Python 3.13 or newer is required.")
PY

node -e 'const major=Number(process.versions.node.split(".")[0]); if(major<22){console.error("Node.js 22 or newer is required."); process.exit(1)}'

if command -v lsof >/dev/null 2>&1; then
  if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 8000 is already in use. Stop the existing backend first." >&2
    exit 1
  fi
  if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 3000 is already in use. Stop the existing frontend first." >&2
    exit 1
  fi
fi

echo "[1/4] Installing backend dependencies"
(cd "$BACKEND_DIR" && uv sync)

echo "[2/4] Preparing the PDF browser"
(cd "$BACKEND_DIR" && uv run playwright install chromium)

echo "[3/4] Installing frontend dependencies"
(cd "$FRONTEND_DIR" && pnpm install --frozen-lockfile)

echo "[4/4] Starting Resume Job Agent"
(cd "$BACKEND_DIR" && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8000/api/v1/health >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend stopped during startup." >&2
    exit 1
  fi
  sleep 0.25
done

if ! curl -fsS http://127.0.0.1:8000/api/v1/health >/dev/null 2>&1; then
  echo "Backend did not become ready in time." >&2
  exit 1
fi

echo "Open http://127.0.0.1:3000"
(cd "$FRONTEND_DIR" && pnpm dev --hostname 127.0.0.1)
