#!/usr/bin/env bash
set -euo pipefail

# ── Vendor Binaries for Ujima Agents ──────────────────────────────
# Downloads and places CLI tools into packages/orchestrator/bin/
# under the platform triple directory structure expected by
# binary-resolver.ts.
#
# Usage:
#   scripts/vendor-binaries.sh            # all platforms (CI)
#   scripts/vendor-binaries.sh darwin     # current platform only (dev)
#   scripts/vendor-binaries.sh darwin arm64

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/../packages/orchestrator/bin"

# Detect platform/arch
OS="${1:-$(uname -s | tr '[:upper:]' '[:lower:]')}"
ARCH="${2:-$(uname -m)}"

case "$OS" in
  darwin)  TRIPLE="${ARCH}-apple-darwin" ;;
  linux)   TRIPLE="${ARCH}-unknown-linux-gnu" ;;
  mingw*|msys*|cygwin*) TRIPLE="${ARCH}-pc-windows-msvc" ;;
  *)       echo "Unknown OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)  RUST_ARCH="x86_64" ;;
  aarch64|arm64) RUST_ARCH="aarch64" ;;
  *)             echo "Unknown arch: $ARCH"; exit 1 ;;
esac

# Map to Rust target triple
case "$OS" in
  darwin)  TARGET="${RUST_ARCH}-apple-darwin" ;;
  linux)   TARGET="${RUST_ARCH}-unknown-linux-gnu" ;;
  mingw*|msys*|cygwin*) TARGET="${RUST_ARCH}-pc-windows-msvc" ;;
esac

echo "→ Target: $TARGET"

# ── ripgrep (rg) ──────────────────────────────────────────────────
echo "→ Downloading ripgrep for $TARGET..."
RG_VERSION="14.1.1"
RG_DIR="$BIN_DIR/rg/$TARGET"
mkdir -p "$RG_DIR"

if [ ! -f "$RG_DIR/rg" ]; then
  case "$OS" in
    darwin|linux)
      RG_URL="https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-${TARGET}.tar.gz"
      curl -sL "$RG_URL" | tar xz --strip-components=1 -C "$RG_DIR" "ripgrep-${RG_VERSION}-${TARGET}/rg"
      chmod +x "$RG_DIR/rg"
      echo "  → Installed rg at $RG_DIR/rg ($(file "$RG_DIR/rg" | sed 's/.*://'))"
      ;;
    mingw*)
      RG_URL="https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-${TARGET}.zip"
      curl -sL "$RG_URL" -o /tmp/rg.zip
      unzip -o /tmp/rg.zip "ripgrep-${RG_VERSION}-${TARGET}/rg.exe" -d "$RG_DIR"
      mv "$RG_DIR/ripgrep-${RG_VERSION}-${TARGET}/rg.exe" "$RG_DIR/rg.exe"
      rm -rf /tmp/rg.zip "$RG_DIR/ripgrep-${RG_VERSION}-${TARGET}"
      ;;
  esac
else
  echo "  → rg already present"
fi

# ── fd ─────────────────────────────────────────────────────────────
echo "→ Downloading fd for $TARGET..."
FD_VERSION="10.2.0"
FD_DIR="$BIN_DIR/fd/$TARGET"
mkdir -p "$FD_DIR"

if [ ! -f "$FD_DIR/fd" ]; then
  case "$OS" in
    darwin|linux)
      FD_URL="https://github.com/sharkdp/fd/releases/download/v${FD_VERSION}/fd-v${FD_VERSION}-${TARGET}.tar.gz"
      curl -sL "$FD_URL" | tar xz --strip-components=1 -C "$FD_DIR" "fd-v${FD_VERSION}-${TARGET}/fd"
      chmod +x "$FD_DIR/fd"
      echo "  → Installed fd at $FD_DIR/fd"
      ;;
    mingw*)
      FD_URL="https://github.com/sharkdp/fd/releases/download/v${FD_VERSION}/fd-v${FD_VERSION}-${TARGET}.zip"
      curl -sL "$FD_URL" -o /tmp/fd.zip
      unzip -o /tmp/fd.zip "fd-v${FD_VERSION}-${TARGET}/fd.exe" -d "$FD_DIR"
      mv "$FD_DIR/fd-v${FD_VERSION}-${TARGET}/fd.exe" "$FD_DIR/fd.exe"
      rm -rf /tmp/fd.zip "$FD_DIR/fd-v${FD_VERSION}-${TARGET}"
      ;;
  esac
else
  echo "  → fd already present"
fi

echo "→ Done. Vendored binaries in $BIN_DIR"
echo ""
echo "  rg: $(ls "$RG_DIR/rg" 2>/dev/null && echo '✔' || echo '✘')"
echo "  fd: $(ls "$FD_DIR/fd" 2>/dev/null && echo '✔' || echo '✘')"
echo ""
echo "Set *_BIN_PATH env vars to override (e.g. RG_BIN_PATH=/opt/homebrew/bin/rg)"
