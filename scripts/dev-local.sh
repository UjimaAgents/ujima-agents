#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export UJIMA_HOME="${UJIMA_HOME:-$ROOT/.ujima-dev-home}"
export UJIMA_PORT="${UJIMA_PORT:-7511}"
WEB_PORT="${WEB_PORT:-3452}"

mkdir -p "$UJIMA_HOME"

api_pid=""
web_pid=""

cleanup() {
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" 2>/dev/null || true
  fi
  if [[ -n "$web_pid" ]]; then
    kill "$web_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

(
  cd "$ROOT"
  bun run build --filter=@ujima/api...
)

(
  cd "$ROOT/apps/api"
  bun run dev
) &
api_pid=$!

(
  cd "$ROOT/apps/web"
  bun run dev -- --port "$WEB_PORT"
) &
web_pid=$!

wait "$api_pid" "$web_pid"
