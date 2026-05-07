#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

HOOK_INPUT="$(cat || true)"

ROOT="$(printf '%s' "$HOOK_INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
HOOK_CURRENT_TASK="$(printf '%s' "$HOOK_INPUT" | jq -r '.pamem.current_task // empty' 2>/dev/null || true)"
HOOK_WORK_LOG="$(printf '%s' "$HOOK_INPUT" | jq -r '.pamem.work_log // empty' 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  ROOT="${PAMEM_WORKSPACE:-$PWD}"
fi

MEMORY_ROOT="$(pamem_memory_repo_root "$ROOT")"
MEMORY_ENTRY_FILE="$(pamem_memory_repo_entry_file "$ROOT")"
MEMORY_PATH="$MEMORY_ROOT/$MEMORY_ENTRY_FILE"
MEMORY_SHARING="$(pamem_memory_repo_sharing "$ROOT")"
MEMORY_SYNC_BACKEND="$(pamem_memory_repo_sync_backend "$ROOT")"
RUNTIME_MODE="$(pamem_runtime_mode "$ROOT")"
MEMORY_TEXT=""
LINE_COUNT=0
BYTE_COUNT=0
MEMORY_AVAILABLE=0
CURRENT_TASK_PATH=""
WORK_LOG_PATH=""
CURRENT_TASK_TEXT=""
WORK_LOG_TEXT=""

if [ -s "$MEMORY_PATH" ]; then
  MEMORY_TEXT="$(cat "$MEMORY_PATH")"
  LINE_COUNT="$(printf '%s\n' "$MEMORY_TEXT" | wc -l | awk '{print $1}')"
  BYTE_COUNT="$(printf '%s' "$MEMORY_TEXT" | wc -c | awk '{print $1}')"
  MEMORY_AVAILABLE=1
fi

if [ "$RUNTIME_MODE" = "cli" ]; then
  if [ -n "$HOOK_CURRENT_TASK" ]; then
    CURRENT_TASK_PATH="$(pamem_expand_path "$ROOT" "$HOOK_CURRENT_TASK")"
  elif [ -n "${PAMEM_CURRENT_TASK:-}" ]; then
    CURRENT_TASK_PATH="$(pamem_expand_path "$ROOT" "$PAMEM_CURRENT_TASK")"
  else
    CURRENT_TASK_PATH="$(pamem_agent_current_task_path "$ROOT")"
  fi

  if [ -n "$HOOK_WORK_LOG" ]; then
    WORK_LOG_PATH="$(pamem_expand_path "$ROOT" "$HOOK_WORK_LOG")"
  elif [ -n "${PAMEM_WORK_LOG:-}" ]; then
    WORK_LOG_PATH="$(pamem_expand_path "$ROOT" "$PAMEM_WORK_LOG")"
  else
    WORK_LOG_PATH="$(pamem_agent_work_log_path "$ROOT")"
  fi

  if [ ! -s "$CURRENT_TASK_PATH" ] && [ -s "$ROOT/current-task.md" ]; then
    CURRENT_TASK_PATH="$ROOT/current-task.md"
  elif [ ! -s "$CURRENT_TASK_PATH" ] && [ -s "$ROOT/notes/current-task.md" ]; then
    CURRENT_TASK_PATH="$ROOT/notes/current-task.md"
  fi

  if [ ! -s "$WORK_LOG_PATH" ] && [ -s "$ROOT/work-log.md" ]; then
    WORK_LOG_PATH="$ROOT/work-log.md"
  elif [ ! -s "$WORK_LOG_PATH" ] && [ -s "$ROOT/notes/work-log.md" ]; then
    WORK_LOG_PATH="$ROOT/notes/work-log.md"
  fi

  if [ -s "$CURRENT_TASK_PATH" ]; then
    CURRENT_TASK_TEXT="$(cat "$CURRENT_TASK_PATH")"
  fi

  if [ -s "$WORK_LOG_PATH" ]; then
    WORK_LOG_TEXT="$(cat "$WORK_LOG_PATH")"
  fi
fi

if pamem_workspace_has_config "$ROOT"; then
  CONTEXT="Persistent memory source: \`${MEMORY_ROOT}\` (runtime=${RUNTIME_MODE}, sharing=${MEMORY_SHARING}, sync=${MEMORY_SYNC_BACKEND})."
  CONTEXT="${CONTEXT}"$'\n'"Runtime anchor: \`${ROOT}\`."
else
  CONTEXT="Persistent memory source: workspace fallback \`${ROOT}\` (runtime=${RUNTIME_MODE})."
fi

if [ "$MEMORY_AVAILABLE" -ne 1 ]; then
  CONTEXT="${CONTEXT}"$'\n\n'
  CONTEXT="${CONTEXT}Warning: configured memory entry file is missing or empty: \`${MEMORY_PATH}\`. Run pamem install/repair or ask the config owner before writing shared memory."
elif [ "$LINE_COUNT" -gt 120 ] || [ "$BYTE_COUNT" -gt 6000 ]; then
  CONTEXT="${CONTEXT}"$'\n\n'
  CONTEXT="${CONTEXT}Warning: \`MEMORY.md\` is larger than index guidance and should be compressed with the \`memory-rule\` plugin skill; if that skill is unavailable, run pamem install/repair or ask onboarding before changing shared memory."
fi

if [ "$MEMORY_AVAILABLE" -eq 1 ]; then
  CONTEXT="${CONTEXT}"$'\n\n'"Load and follow this persistent memory index before proceeding:"$'\n\n'"${MEMORY_TEXT}"
fi

if [ -n "$CURRENT_TASK_TEXT" ]; then
  CONTEXT="${CONTEXT}"$'\n\n'"CLI runtime current task source: \`${CURRENT_TASK_PATH}\`."$'\n\n'"${CURRENT_TASK_TEXT}"
fi

if [ -n "$WORK_LOG_TEXT" ]; then
  CONTEXT="${CONTEXT}"$'\n\n'"CLI runtime work log source: \`${WORK_LOG_PATH}\`."$'\n\n'"${WORK_LOG_TEXT}"
fi

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'
