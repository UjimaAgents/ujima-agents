#!/usr/bin/env bash
# One command to rule them all: build once, then run watch mode across every package.
# Usage: pnpm dev
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "[ujima] initial build..."
pnpm -r build

echo "[ujima] starting watch mode across all packages..."
exec pnpm turbo run dev --parallel
