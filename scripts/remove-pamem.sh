#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: remove-pamem.sh <workspace>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_INPUT="$1"
WORKSPACE="$(cd "$TARGET_INPUT" && pwd)"

CODEX_HOOKS="$WORKSPACE/.codex/hooks.json"

SESSION_CMD='.pamem/scripts/memory-session-start.sh'

if [ -s "$CODEX_HOOKS" ]; then
  tmp_file="$(mktemp)"
  jq \
    --arg session_cmd "$SESSION_CMD" '
    .hooks = (.hooks // {}) |
    .hooks.SessionStart = ((.hooks.SessionStart // []) | map(
      if .matcher == "startup|resume" then
        .hooks = ((.hooks // []) | map(select(.command != $session_cmd)))
      else . end
    ) | map(select((.hooks // []) | length > 0)))
    ' "$CODEX_HOOKS" > "$tmp_file"
  mv "$tmp_file" "$CODEX_HOOKS"
fi

printf 'Removed Codex pamem hook entries from %s\n' "$WORKSPACE"
