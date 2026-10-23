#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="$ROOT_DIR/.venv/bin/python"
NG="$ROOT_DIR/frontend/node_modules/.bin/ng"

if [[ ! -x "$PYTHON" ]]; then
  echo "Python environment not found at .venv/bin/python." >&2
  echo "Create it and install backend dependencies; see README.md." >&2
  exit 1
fi

if [[ ! -x "$NG" ]]; then
  echo "Angular CLI not found in frontend/node_modules." >&2
  echo "Run 'npm ci' from the frontend directory first." >&2
  exit 1
fi

api_pid=
frontend_pid=

api_is_healthy() {
  "$PYTHON" -c '
import json
from urllib.request import urlopen

try:
    with urlopen("http://127.0.0.1:8000/openapi.json", timeout=3) as response:
        api = json.load(response)
    paths = api.get("paths", {})
    if "/api/stocks/cache" not in paths or "/api/crypto" not in paths:
        raise SystemExit(1)
    with urlopen("http://127.0.0.1:8000/api/stocks/cache", timeout=3):
        pass
except Exception:
    raise SystemExit(1)
'
}

port_is_open() {
  "$PYTHON" -c '
import socket
import sys

with socket.socket() as connection:
    connection.settimeout(1)
    sys.exit(0 if connection.connect_ex(("127.0.0.1", int(sys.argv[1]))) == 0 else 1)
' "$1"
}

cleanup() {
  trap - INT TERM EXIT
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" 2>/dev/null || true
  fi
  if [[ -n "$frontend_pid" ]]; then
    kill "$frontend_pid" 2>/dev/null || true
  fi
  if [[ -n "$api_pid" ]]; then
    wait "$api_pid" 2>/dev/null || true
  fi
  if [[ -n "$frontend_pid" ]]; then
    wait "$frontend_pid" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

if api_is_healthy; then
  echo "Using existing MarketLens API at http://127.0.0.1:8000"
elif port_is_open 8000; then
  echo "Port 8000 is occupied by an unhealthy or incompatible API." >&2
  echo "Stop that process, then run ./run.sh again." >&2
  exit 1
else
  cd "$ROOT_DIR"
  "$PYTHON" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 &
  api_pid=$!
fi

if port_is_open 4200; then
  echo "Port 4200 is already in use. Stop the existing frontend before running ./run.sh." >&2
  exit 1
fi

cd "$ROOT_DIR/frontend"
"$NG" serve --host 127.0.0.1 --port 4200 &
frontend_pid=$!

echo "Dashboard: http://localhost:4200"
echo "API:       http://127.0.0.1:8000"
echo "Press Ctrl+C to stop the servers started by this script."

set +e
if [[ -n "$api_pid" ]]; then
  wait -n "$api_pid" "$frontend_pid"
else
  wait "$frontend_pid"
fi
status=$?
set -e

echo "A server exited; stopping the other one." >&2
exit "$status"
