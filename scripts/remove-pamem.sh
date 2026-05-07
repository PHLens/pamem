#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: remove-pamem.sh <workspace>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_INPUT="$1"
WORKSPACE="$(cd "$TARGET_INPUT" && pwd)"

CODEX_HOOKS="$WORKSPACE/.codex/hooks.json"
CODEX_SKILLS_DIR="$WORKSPACE/.codex/skills"

SESSION_CMD='.pamem/scripts/memory-session-start.sh'

if ! command -v jq >/dev/null 2>&1; then
  echo "pamem requires jq; install jq and rerun." >&2
  exit 1
fi

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

if [ -d "$PLUGIN_ROOT/skills" ] && [ -d "$CODEX_SKILLS_DIR" ]; then
  for skill_src in "$PLUGIN_ROOT"/skills/*; do
    [ -d "$skill_src" ] || continue
    skill_link="$CODEX_SKILLS_DIR/$(basename "$skill_src")"
    if [ -L "$skill_link" ] && [ "$(readlink -f "$skill_link")" = "$skill_src" ]; then
      rm -f "$skill_link"
    fi
  done
fi

printf 'Removed Codex pamem hook entries from %s\n' "$WORKSPACE"
