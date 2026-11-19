#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ensure_mise() {
  if command -v mise >/dev/null 2>&1; then
    return
  fi
  curl -fsSL https://mise.jdx.dev/install.sh | sh
  sudo ln -sf "$HOME/.local/bin/mise" /usr/local/bin/mise
}

ensure_mise
mise install
mise exec -- bun install --frozen-lockfile