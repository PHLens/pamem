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

HOOK_INPUT="$(cat || true)"

ROOT="$(printf '%s' "$HOOK_INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  ROOT="$PWD"
fi

MEMORY_ROOT="$(pamem_memory_repo_root "$ROOT")"
MEMORY_ENTRY_FILE="$(pamem_memory_repo_entry_file "$ROOT")"
MEMORY_PATH="$MEMORY_ROOT/$MEMORY_ENTRY_FILE"
MEMORY_SHARING="$(pamem_memory_repo_sharing "$ROOT")"
MEMORY_SYNC_BACKEND="$(pamem_memory_repo_sync_backend "$ROOT")"
RUNTIME_MODE="$(pamem_runtime_mode "$ROOT")"

if pamem_workspace_has_config "$ROOT"; then
  pamem_ensure_memory_repo_skeleton "$MEMORY_ROOT" "$ASSETS_DIR"
fi

CREATED=0
ADDED_GOVERNANCE=0
ADDED_SYNC_TRIGGER=0

if [ ! -s "$MEMORY_PATH" ]; then
  mkdir -p "$(dirname "$MEMORY_PATH")"
  printf '%s\n' "$MEMORY_SKELETON" > "$MEMORY_PATH"
  CREATED=1
else
  if ! grep -q '^## Memory Governance$' "$MEMORY_PATH"; then
    TMP_FILE="$(mktemp)"
    awk -v block="$MEMORY_GOVERNANCE_BLOCK" '
      NR == 1 { print; print ""; print block; next }
      { print }
    ' "$MEMORY_PATH" > "$TMP_FILE"
    mv "$TMP_FILE" "$MEMORY_PATH"
    ADDED_GOVERNANCE=1
  fi

  if ! grep -q '^## Sync Trigger$' "$MEMORY_PATH"; then
    printf '\n%s\n' "$SYNC_TRIGGER_BLOCK" >> "$MEMORY_PATH"
    ADDED_SYNC_TRIGGER=1
  fi
fi

MEMORY_TEXT="$(cat "$MEMORY_PATH")"
LINE_COUNT="$(printf '%s\n' "$MEMORY_TEXT" | wc -l | awk '{print $1}')"
BYTE_COUNT="$(printf '%s' "$MEMORY_TEXT" | wc -c | awk '{print $1}')"

if pamem_workspace_has_config "$ROOT"; then
  CONTEXT="Persistent memory source: \`${MEMORY_ROOT}\` (runtime=${RUNTIME_MODE}, sharing=${MEMORY_SHARING}, sync=${MEMORY_SYNC_BACKEND})."
else
  CONTEXT="Persistent memory source: workspace fallback \`${ROOT}\` (runtime=${RUNTIME_MODE})."
fi

if [ "$CREATED" -eq 1 ]; then
  CONTEXT="${CONTEXT}"$'\n\n'
  CONTEXT="${CONTEXT}Persistent memory bootstrap: created a minimal \`MEMORY.md\` because it was missing or empty."
fi

if [ "$ADDED_GOVERNANCE" -eq 1 ]; then
  CONTEXT="${CONTEXT}"$'\n\n'
  CONTEXT="${CONTEXT}Persistent memory bootstrap: added a missing \`Memory Governance\` section to \`MEMORY.md\`."
fi

if [ "$ADDED_SYNC_TRIGGER" -eq 1 ]; then
  CONTEXT="${CONTEXT}"$'\n\n'
  CONTEXT="${CONTEXT}Persistent memory bootstrap: added a missing \`Sync Trigger\` section to \`MEMORY.md\`."
fi

if [ "$LINE_COUNT" -gt 120 ] || [ "$BYTE_COUNT" -gt 6000 ]; then
  CONTEXT="${CONTEXT}"$'\n\n'
  CONTEXT="${CONTEXT}Warning: \`MEMORY.md\` is larger than index guidance and should be compressed with \`memory-rule\`."
fi

CONTEXT="${CONTEXT}"$'\n\n'"Load and follow this persistent memory index before proceeding:"$'\n\n'"${MEMORY_TEXT}"

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'
