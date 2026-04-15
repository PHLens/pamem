#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSETS_DIR="$PLUGIN_ROOT/assets"

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

NOTES_DIR="$ROOT/notes"
MEMORY_PATH="$ROOT/MEMORY.md"
CURRENT_TASK_PATH="$NOTES_DIR/current-task.md"

mkdir -p "$NOTES_DIR"

CREATED_MEMORY=0
ADDED_GOVERNANCE=0
ADDED_SYNC_TRIGGER=0
CREATED_CURRENT_TASK=0

if [ ! -s "$MEMORY_PATH" ]; then
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

if [ ! -s "$CURRENT_TASK_PATH" ]; then
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
  printf '[memory-pre-compact] Created notes/current-task.md placeholder before %s compact.\n' "${TRIGGER:-unknown}" >&2
fi

exit 0
