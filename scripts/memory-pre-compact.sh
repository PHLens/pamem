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

MEMORY_SKELETON="$(cat "$ASSETS_DIR/MEMORY.md.template")"
MEMORY_GOVERNANCE_BLOCK="$(cat "$ASSETS_DIR/memory-governance.md.fragment")"
SYNC_TRIGGER_BLOCK="$(cat "$ASSETS_DIR/sync-trigger.md.fragment")"
CURRENT_TASK_TEMPLATE="$(cat "$ASSETS_DIR/notes/current-task.md.template")"

HOOK_INPUT="$(cat || true)"
ROOT="$(printf '%s' "$HOOK_INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
TRIGGER="$(printf '%s' "$HOOK_INPUT" | jq -r '.trigger // empty' 2>/dev/null || true)"

if [ -z "$ROOT" ]; then
  ROOT="$PWD"
fi

MEMORY_ROOT="$(pamem_memory_repo_root "$ROOT")"
MEMORY_ENTRY_FILE="$(pamem_memory_repo_entry_file "$ROOT")"
MEMORY_PATH="$MEMORY_ROOT/$MEMORY_ENTRY_FILE"
NOTES_DIR="$ROOT/notes"
RUNTIME_MODE="$(pamem_runtime_mode "$ROOT")"
CURRENT_TASK_LABEL="notes/current-task.md"

if pamem_workspace_has_config "$ROOT"; then
  pamem_ensure_memory_repo_skeleton "$MEMORY_ROOT" "$ASSETS_DIR"
else
  mkdir -p "$NOTES_DIR"
fi

if [ "$RUNTIME_MODE" = "cli" ]; then
  CURRENT_TASK_PATH="$NOTES_DIR/current-task.md"
else
  CURRENT_TASK_PATH=""
fi

CREATED_MEMORY=0
ADDED_GOVERNANCE=0
ADDED_SYNC_TRIGGER=0
CREATED_CURRENT_TASK=0

if [ ! -s "$MEMORY_PATH" ]; then
  mkdir -p "$(dirname "$MEMORY_PATH")"
  printf '%s\n' "$MEMORY_SKELETON" > "$MEMORY_PATH"
  CREATED_MEMORY=1
elif ! grep -q '^## Memory Governance$' "$MEMORY_PATH"; then
  TMP_FILE="$(mktemp)"
  awk -v block="$MEMORY_GOVERNANCE_BLOCK" '
    NR == 1 { print; print ""; print block; next }
    { print }
  ' "$MEMORY_PATH" > "$TMP_FILE"
  mv "$TMP_FILE" "$MEMORY_PATH"
  ADDED_GOVERNANCE=1
fi

if [ -s "$MEMORY_PATH" ] && ! grep -q '^## Sync Trigger$' "$MEMORY_PATH"; then
  printf '\n%s\n' "$SYNC_TRIGGER_BLOCK" >> "$MEMORY_PATH"
  ADDED_SYNC_TRIGGER=1
fi

if [ -n "$CURRENT_TASK_PATH" ] && [ ! -s "$CURRENT_TASK_PATH" ]; then
  mkdir -p "$(dirname "$CURRENT_TASK_PATH")"
  printf '%s\n' "$CURRENT_TASK_TEMPLATE" > "$CURRENT_TASK_PATH"
  CREATED_CURRENT_TASK=1
fi

if [ "$CREATED_MEMORY" -eq 1 ]; then
  printf '[memory-pre-compact] Created minimal MEMORY.md before %s compact.\n' "${TRIGGER:-unknown}" >&2
fi

if [ "$ADDED_GOVERNANCE" -eq 1 ]; then
  printf '[memory-pre-compact] Added missing Memory Governance section to MEMORY.md before %s compact.\n' "${TRIGGER:-unknown}" >&2
fi

if [ "$ADDED_SYNC_TRIGGER" -eq 1 ]; then
  printf '[memory-pre-compact] Added missing Sync Trigger section to MEMORY.md before %s compact.\n' "${TRIGGER:-unknown}" >&2
fi

if [ "$CREATED_CURRENT_TASK" -eq 1 ]; then
  printf '[memory-pre-compact] Created %s placeholder before %s compact.\n' "$CURRENT_TASK_LABEL" "${TRIGGER:-unknown}" >&2
fi

exit 0
