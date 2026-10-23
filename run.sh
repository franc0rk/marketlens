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

cd "$ROOT_DIR"
"$PYTHON" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 &
api_pid=$!

cd "$ROOT_DIR/frontend"
"$NG" serve --host 127.0.0.1 --port 4200 &
frontend_pid=$!

echo "API:       http://127.0.0.1:8000"
echo "Dashboard: http://localhost:4200"
echo "Press Ctrl+C to stop both servers."

set +e
wait -n "$api_pid" "$frontend_pid"
status=$?
set -e

echo "A server exited; stopping the other one." >&2
exit "$status"
