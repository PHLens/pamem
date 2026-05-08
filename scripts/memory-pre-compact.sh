#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSETS_DIR="$PLUGIN_ROOT/assets"

# shellcheck source=memory-store.sh
source "$SCRIPT_DIR/memory-store.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "pamem requires jq; install jq and rerun." >&2
  exit 1
fi

if ! command -v realpath >/dev/null 2>&1; then
  echo "pamem requires GNU realpath; install coreutils and rerun." >&2
  exit 1
fi

CURRENT_TASK_TEMPLATE="$(cat "$ASSETS_DIR/notes/current-task.md.template")"

HOOK_INPUT="$(cat || true)"
ROOT="$(printf '%s' "$HOOK_INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
TRIGGER="$(printf '%s' "$HOOK_INPUT" | jq -r '.trigger // empty' 2>/dev/null || true)"
HOOK_CURRENT_TASK="$(printf '%s' "$HOOK_INPUT" | jq -r '.pamem.current_task // empty' 2>/dev/null || true)"

if [ -z "$ROOT" ]; then
  ROOT="${PAMEM_WORKSPACE:-$PWD}"
fi

RUNTIME_MODE="$(pamem_runtime_mode "$ROOT")"
CURRENT_TASK_LABEL="current-task.md"

case "$RUNTIME_MODE" in
  cli)
    if [ -n "$HOOK_CURRENT_TASK" ]; then
      CURRENT_TASK_PATH="$(pamem_expand_path "$ROOT" "$HOOK_CURRENT_TASK")"
      CURRENT_TASK_LABEL="$CURRENT_TASK_PATH"
    elif [ -n "${PAMEM_CURRENT_TASK:-}" ]; then
      CURRENT_TASK_PATH="$(pamem_expand_path "$ROOT" "$PAMEM_CURRENT_TASK")"
      CURRENT_TASK_LABEL="$CURRENT_TASK_PATH"
    else
      CURRENT_TASK_PATH="$(pamem_agent_current_task_path "$ROOT")"
      CURRENT_TASK_LABEL="$CURRENT_TASK_PATH"
    fi
    ;;
  slock)
    if [ -n "$HOOK_CURRENT_TASK" ]; then
      CURRENT_TASK_PATH="$(pamem_expand_path "$ROOT" "$HOOK_CURRENT_TASK")"
      CURRENT_TASK_LABEL="$CURRENT_TASK_PATH"
    elif [ -n "${PAMEM_CURRENT_TASK:-}" ]; then
      CURRENT_TASK_PATH="$(pamem_expand_path "$ROOT" "$PAMEM_CURRENT_TASK")"
      CURRENT_TASK_LABEL="$CURRENT_TASK_PATH"
    else
      CURRENT_TASK_PATH="$(pamem_workspace_current_task_path "$ROOT")"
      CURRENT_TASK_LABEL="$CURRENT_TASK_PATH"
    fi
    ;;
  *)
    CURRENT_TASK_PATH=""
    ;;
esac

CREATED_CURRENT_TASK=0

if [ -n "$CURRENT_TASK_PATH" ] && [ ! -s "$CURRENT_TASK_PATH" ]; then
  mkdir -p "$(dirname "$CURRENT_TASK_PATH")"
  printf '%s\n' "$CURRENT_TASK_TEMPLATE" > "$CURRENT_TASK_PATH"
  CREATED_CURRENT_TASK=1
fi

if [ "$CREATED_CURRENT_TASK" -eq 1 ]; then
  printf '[memory-pre-compact] Created %s placeholder before %s compact.\n' "$CURRENT_TASK_LABEL" "${TRIGGER:-unknown}" >&2
fi

exit 0
