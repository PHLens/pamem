#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSETS_DIR="$PLUGIN_ROOT/assets"

MEMORY_SKELETON="$(cat "$ASSETS_DIR/MEMORY.md.template")"
MEMORY_GOVERNANCE_BLOCK="$(cat "$ASSETS_DIR/memory-governance.md.fragment")"
SYNC_TRIGGER_BLOCK="$(cat "$ASSETS_DIR/sync-trigger.md.fragment")"

HOOK_INPUT="$(cat || true)"
ROOT="$(printf '%s' "$HOOK_INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  ROOT="$PWD"
fi

MEMORY_PATH="$ROOT/MEMORY.md"
CREATED=0
ADDED_GOVERNANCE=0
ADDED_SYNC_TRIGGER=0

if [ ! -s "$MEMORY_PATH" ]; then
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

CONTEXT=""
if [ "$CREATED" -eq 1 ]; then
  CONTEXT="${CONTEXT}Persistent memory bootstrap: created a minimal \`MEMORY.md\` because it was missing or empty."
fi

if [ "$ADDED_GOVERNANCE" -eq 1 ]; then
  if [ -n "$CONTEXT" ]; then
    CONTEXT="${CONTEXT}\n\n"
  fi
  CONTEXT="${CONTEXT}Persistent memory bootstrap: added a missing \`Memory Governance\` section to \`MEMORY.md\`."
fi

if [ "$ADDED_SYNC_TRIGGER" -eq 1 ]; then
  if [ -n "$CONTEXT" ]; then
    CONTEXT="${CONTEXT}\n\n"
  fi
  CONTEXT="${CONTEXT}Persistent memory bootstrap: added a missing \`Sync Trigger\` section to \`MEMORY.md\`."
fi

if [ "$LINE_COUNT" -gt 120 ] || [ "$BYTE_COUNT" -gt 6000 ]; then
  if [ -n "$CONTEXT" ]; then
    CONTEXT="${CONTEXT}\n\n"
  fi
  CONTEXT="${CONTEXT}Warning: \`MEMORY.md\` is larger than index guidance and should be compressed with \`memory-rule\`."
fi

if [ -n "$CONTEXT" ]; then
  CONTEXT="${CONTEXT}\n\n"
fi
CONTEXT="${CONTEXT}Load and follow this persistent memory index before proceeding:\n\n${MEMORY_TEXT}"

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'
