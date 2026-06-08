#!/usr/bin/env bash
set -euo pipefail

# ── Vendor Binaries for Ujima Agents ──────────────────────────────
# Downloads and places CLI tools into packages/orchestrator/bin/
# under the platform triple directory structure expected by
# binary-resolver.ts.
#
# Usage:
#   scripts/vendor-binaries.sh            # current platform (dev)
#   scripts/vendor-binaries.sh linux x86_64

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/../packages/orchestrator/bin"

# Detect platform/arch
OS="${1:-$(uname -s | tr '[:upper:]' '[:lower:]')}"
ARCH="${2:-$(uname -m)}"

case "$ARCH" in
  x86_64|amd64)  RUST_ARCH="x86_64" ;;
  aarch64|arm64) RUST_ARCH="aarch64" ;;
  *)             echo "Unknown arch: $ARCH"; exit 1 ;;
esac

# Storage triple must match binary-resolver.ts platformTriple()
case "$OS" in
  darwin)  STORAGE_TRIPLE="${RUST_ARCH}-apple-darwin" ;;
  linux)   STORAGE_TRIPLE="${RUST_ARCH}-unknown-linux-gnu" ;;
  mingw*|msys*|cygwin*) STORAGE_TRIPLE="${RUST_ARCH}-pc-windows-msvc" ;;
  *)       echo "Unknown OS: $OS"; exit 1 ;;
esac

echo "→ Storage triple: $STORAGE_TRIPLE"

rg_bin_name() {
  if [[ "$OS" == mingw* || "$OS" == msys* || "$OS" == cygwin* ]]; then
    echo "rg.exe"
  else
    echo "rg"
  fi
}

fd_bin_name() {
  if [[ "$OS" == mingw* || "$OS" == msys* || "$OS" == cygwin* ]]; then
    echo "fd.exe"
  else
    echo "fd"
  fi
}

# ── ripgrep (rg) ──────────────────────────────────────────────────
echo "→ Downloading ripgrep..."
RG_VERSION="15.1.0"
RG_DIR="$BIN_DIR/rg/$STORAGE_TRIPLE"
RG_BIN="$(rg_bin_name)"
mkdir -p "$RG_DIR"

# Release asset triple (may differ from storage path on disk)
RG_DOWNLOAD_TARGET="$STORAGE_TRIPLE"
if [ "$OS" = "linux" ] && [ "$RUST_ARCH" = "x86_64" ]; then
  # ripgrep 15.x no longer ships gnu x86_64; musl static binary runs on Ubuntu CI.
  RG_DOWNLOAD_TARGET="x86_64-unknown-linux-musl"
fi

if [ ! -x "$RG_DIR/$RG_BIN" ]; then
  case "$OS" in
    darwin|linux)
      RG_URL="https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-${RG_DOWNLOAD_TARGET}.tar.gz"
      curl -fsSL "$RG_URL" | tar xz --strip-components=1 -C "$RG_DIR" "ripgrep-${RG_VERSION}-${RG_DOWNLOAD_TARGET}/rg"
      chmod +x "$RG_DIR/rg"
      echo "  → Installed rg at $RG_DIR/rg"
      ;;
    mingw*|msys*|cygwin*)
      RG_URL="https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-${STORAGE_TRIPLE}.zip"
      curl -fsSL "$RG_URL" -o /tmp/rg.zip
      unzip -o /tmp/rg.zip "ripgrep-${RG_VERSION}-${STORAGE_TRIPLE}/rg.exe" -d "$RG_DIR"
      mv "$RG_DIR/ripgrep-${RG_VERSION}-${STORAGE_TRIPLE}/rg.exe" "$RG_DIR/rg.exe"
      rm -rf /tmp/rg.zip "$RG_DIR/ripgrep-${RG_VERSION}-${STORAGE_TRIPLE}"
      ;;
  esac
else
  echo "  → rg already present at $RG_DIR/$RG_BIN"
fi

# ── fd ─────────────────────────────────────────────────────────────
echo "→ Downloading fd..."
FD_VERSION="10.2.0"
FD_DIR="$BIN_DIR/fd/$STORAGE_TRIPLE"
FD_BIN="$(fd_bin_name)"
mkdir -p "$FD_DIR"

if [ ! -x "$FD_DIR/$FD_BIN" ]; then
  case "$OS" in
    darwin|linux)
      FD_URL="https://github.com/sharkdp/fd/releases/download/v${FD_VERSION}/fd-v${FD_VERSION}-${STORAGE_TRIPLE}.tar.gz"
      curl -fsSL "$FD_URL" | tar xz --strip-components=1 -C "$FD_DIR" "fd-v${FD_VERSION}-${STORAGE_TRIPLE}/fd"
      chmod +x "$FD_DIR/fd"
      echo "  → Installed fd at $FD_DIR/fd"
      ;;
    mingw*|msys*|cygwin*)
      FD_URL="https://github.com/sharkdp/fd/releases/download/v${FD_VERSION}/fd-v${FD_VERSION}-${STORAGE_TRIPLE}.zip"
      curl -fsSL "$FD_URL" -o /tmp/fd.zip
      unzip -o /tmp/fd.zip "fd-v${FD_VERSION}-${STORAGE_TRIPLE}/fd.exe" -d "$FD_DIR"
      mv "$FD_DIR/fd-v${FD_VERSION}-${STORAGE_TRIPLE}/fd.exe" "$FD_DIR/fd.exe"
      rm -rf /tmp/fd.zip "$FD_DIR/fd-v${FD_VERSION}-${STORAGE_TRIPLE}"
      ;;
  esac
else
  echo "  → fd already present at $FD_DIR/$FD_BIN"
fi

echo "→ Done. Vendored binaries in $BIN_DIR"
echo ""
echo "  rg: $([ -x "$RG_DIR/$RG_BIN" ] && echo '✔' || echo '✘') $RG_DIR/$RG_BIN"
echo "  fd: $([ -x "$FD_DIR/$FD_BIN" ] && echo '✔' || echo '✘') $FD_DIR/$FD_BIN"
echo ""
echo "Set *_BIN_PATH env vars to override (e.g. RG_BIN_PATH=/opt/homebrew/bin/rg)"
