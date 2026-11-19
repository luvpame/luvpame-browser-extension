#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ensure_mise() {
  if command -v mise >/dev/null 2>&1; then
    return
  fi
  if [ -x /usr/local/bin/mise ]; then
    return
  fi
  exit 1
}

ensure_mise
export PATH="/usr/local/bin:${PATH:-}"
TMUX_CONF="/exec-daemon/tmux.portal.conf"
SESSION="wxt_dev"

if tmux -f "$TMUX_CONF" has-session -t "=$SESSION" 2>/dev/null; then
  exit 0
fi

tmux -f "$TMUX_CONF" new-session -d -s "$SESSION" -c "$REPO_ROOT" \
  "mise exec -- bun run dev 2>&1 | tee /tmp/wxt-dev.log"