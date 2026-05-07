#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: pamem-cli.sh <start|resume|status|hook-json|context> [--workspace <path>] [--agent-id <id>] [--print-env] [-- <command> [args...]]

Manage CLI-local pamem runtime state for a configured agent home.

Commands:
  start       Ensure CLI runtime state exists and print recovery paths.
  resume      Resume with configured runtime command or last recorded launcher.
  status      Print resolved agent home, memory repo, and local paths.
  hook-json   Print the SessionStart hook input JSON for the agent.
  context     Print the resolved startup memory context as plain text.

Options:
  --workspace <path>  Agent home containing config.toml, or legacy workspace
                      containing .pamem/config.toml.
  --agent-id <id>     Override the runtime agent id for this invocation.
  --print-env         Print PAMEM_* shell exports for launcher integration.
  -- <command>         For start, exec and record the launcher. For resume,
                      exec this command as an explicit resume launcher.
  -h, --help          Show this help.

By default this script does not launch Claude, Codex, or another CLI. When a
command is supplied after --, it creates CLI-local state and execs that launcher
from the resolved agent home with PAMEM_* environment variables set.
EOF
}

if [ "$#" -lt 1 ]; then
  usage >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSETS_DIR="$PLUGIN_ROOT/assets"

# shellcheck source=memory-store.sh
source "$SCRIPT_DIR/memory-store.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "pamem cli requires jq; install jq and rerun." >&2
  exit 1
fi

if ! command -v realpath >/dev/null 2>&1; then
  echo "pamem cli requires GNU realpath; install coreutils and rerun." >&2
  exit 1
fi

COMMAND="$1"
shift

WORKSPACE_OVERRIDE=""
AGENT_ID_OVERRIDE=""
PRINT_ENV=0
LAUNCH_ARGS=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --)
      shift
      LAUNCH_ARGS=("$@")
      break
      ;;
    --workspace)
      [ "$#" -ge 2 ] || { echo "missing value for --workspace" >&2; exit 2; }
      WORKSPACE_OVERRIDE="$2"
      shift 2
      ;;
    --agent-id)
      [ "$#" -ge 2 ] || { echo "missing value for --agent-id" >&2; exit 2; }
      AGENT_ID_OVERRIDE="$2"
      shift 2
      ;;
    --print-env)
      PRINT_ENV=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

find_workspace_root() {
  local start="$1"
  local dir

  dir="$(pamem_expand_path "$PWD" "$start")"
  if [ -f "$dir" ]; then
    dir="$(dirname "$dir")"
  fi

  while [ "$dir" != "/" ]; do
    if [ -s "$dir/config.toml" ] || [ -s "$dir/.pamem/config.toml" ]; then
      printf '%s' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  pamem_expand_path "$PWD" "$start"
}

script_workspace_root() {
  local candidate

  if [ "$(basename "$PLUGIN_ROOT")" != ".pamem" ] || [ ! -s "$PLUGIN_ROOT/config.toml" ]; then
    return 0
  fi

  candidate="$(dirname "$PLUGIN_ROOT")"
  if [ -s "$(pamem_config_path "$candidate")" ]; then
    printf '%s' "$candidate"
  fi
}

shell_quote() {
  printf '%q' "$1"
}

json_array_from_args() {
  local args_json='[]'
  local arg

  for arg in "$@"; do
    args_json="$(jq -cn --argjson args "$args_json" --arg arg "$arg" '$args + [$arg]')"
  done

  printf '%s' "$args_json"
}

ensure_cli_state() {
  if [ "$RUNTIME_MODE" != "cli" ]; then
    echo "pamem cli state is only for runtime.mode=cli; current runtime is $RUNTIME_MODE" >&2
    exit 2
  fi

  mkdir -p "$LOCAL_DIR"

  if [ ! -s "$CURRENT_TASK_PATH" ]; then
    cp "$ASSETS_DIR/notes/current-task.md.template" "$CURRENT_TASK_PATH"
  fi

  if [ ! -s "$WORK_LOG_PATH" ]; then
    cp "$ASSETS_DIR/notes/work-log.md.template" "$WORK_LOG_PATH"
  fi
}

resolve_cli_state_paths() {
  if [ "$RUNTIME_MODE" = "cli" ]; then
    LOCAL_DIR="$(pamem_agent_local_dir "$WORKSPACE" "$AGENT_ID")"
    CURRENT_TASK_PATH="$LOCAL_DIR/current-task.md"
    WORK_LOG_PATH="$LOCAL_DIR/work-log.md"
    SESSION_PATH="$LOCAL_DIR/session.json"
  else
    LOCAL_DIR=""
    CURRENT_TASK_PATH=""
    WORK_LOG_PATH=""
    SESSION_PATH=""
  fi
}

print_status() {
  printf 'root=%s\n' "$WORKSPACE"
  printf 'runtime=%s\n' "$RUNTIME_MODE"
  printf 'agent_id=%s\n' "$AGENT_ID"
  printf 'memory_repo=%s\n' "$MEMORY_REPO_ROOT"
  printf 'memory_entry=%s\n' "$MEMORY_REPO_ROOT/$MEMORY_ENTRY_FILE"
  if [ "$RUNTIME_MODE" = "cli" ]; then
    printf 'local_dir=%s\n' "$LOCAL_DIR"
    printf 'current_task=%s\n' "$CURRENT_TASK_PATH"
    printf 'work_log=%s\n' "$WORK_LOG_PATH"
    printf 'session_file=%s\n' "$SESSION_PATH"
    if [ -s "$SESSION_PATH" ]; then
      printf 'last_command='
      jq -r '.last_command // [] | @sh' "$SESSION_PATH"
    else
      printf 'last_command=\n'
    fi
  else
    printf 'task_state=slock\n'
  fi
}

print_env() {
  local action="${1:-start}"

  if [ "$RUNTIME_MODE" != "cli" ]; then
    return 0
  fi

  printf 'export PAMEM_WORKSPACE=%s\n' "$(shell_quote "$WORKSPACE")"
  printf 'export PAMEM_AGENT_ID=%s\n' "$(shell_quote "$AGENT_ID")"
  printf 'export PAMEM_AGENT_HOME=%s\n' "$(shell_quote "$LOCAL_DIR")"
  printf 'export PAMEM_LOCAL_DIR=%s\n' "$(shell_quote "$LOCAL_DIR")"
  printf 'export PAMEM_CURRENT_TASK=%s\n' "$(shell_quote "$CURRENT_TASK_PATH")"
  printf 'export PAMEM_WORK_LOG=%s\n' "$(shell_quote "$WORK_LOG_PATH")"
  printf 'export PAMEM_SESSION_FILE=%s\n' "$(shell_quote "$SESSION_PATH")"
  if [ "$action" = "resume" ]; then
    printf 'export PAMEM_RESUME=1\n'
  else
    printf 'export PAMEM_RESUME=0\n'
  fi
}

print_hook_json() {
  if [ "$RUNTIME_MODE" = "cli" ]; then
    jq -n --arg cwd "$WORKSPACE" --arg runtime "$RUNTIME_MODE" --arg agent_id "$AGENT_ID" --arg local_dir "$LOCAL_DIR" --arg current_task "$CURRENT_TASK_PATH" --arg work_log "$WORK_LOG_PATH" --arg session_file "$SESSION_PATH" '{
      cwd: $cwd,
      pamem: {
        runtime: $runtime,
        agent_id: $agent_id,
        local_dir: $local_dir,
        current_task: $current_task,
        work_log: $work_log,
        session_file: $session_file
      }
    }'
  else
    jq -n --arg cwd "$WORKSPACE" --arg runtime "$RUNTIME_MODE" --arg agent_id "$AGENT_ID" '{
      cwd: $cwd,
      pamem: {
        runtime: $runtime,
        agent_id: $agent_id,
        task_state: "slock"
      }
    }'
  fi
}

print_context() {
  print_hook_json | "$SCRIPT_DIR/memory-session-start.sh" | jq -r '.hookSpecificOutput.additionalContext'
}

record_session() {
  local action="$1"
  shift
  local command_json

  command_json="$(json_array_from_args "$@")"
  mkdir -p "$(dirname "$SESSION_PATH")"
  jq -n \
    --argjson version 1 \
    --arg agent_id "$AGENT_ID" \
    --arg root "$WORKSPACE" \
    --arg local_dir "$LOCAL_DIR" \
    --arg current_task "$CURRENT_TASK_PATH" \
    --arg work_log "$WORK_LOG_PATH" \
    --arg last_action "$action" \
    --arg updated_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    --argjson last_command "$command_json" \
    '{
      version: $version,
      agent_id: $agent_id,
      root: $root,
      local_dir: $local_dir,
      current_task: $current_task,
      work_log: $work_log,
      last_action: $last_action,
      updated_at: $updated_at,
      last_command: $last_command
    }' > "$SESSION_PATH"
}

configured_resume_command() {
  local config_path="$1"
  pamem_toml_array_values "$config_path" "runtime.resume" "command"
}

load_last_command() {
  if [ ! -s "$SESSION_PATH" ]; then
    return 1
  fi

  jq -e '.last_command | type == "array" and length > 0' "$SESSION_PATH" >/dev/null
  jq -r '.last_command[]' "$SESSION_PATH"
}

run_launch_command() {
  local action="$1"
  shift

  export PAMEM_WORKSPACE="$WORKSPACE"
  export PAMEM_AGENT_ID="$AGENT_ID"
  export PAMEM_AGENT_HOME="$LOCAL_DIR"
  export PAMEM_LOCAL_DIR="$LOCAL_DIR"
  export PAMEM_CURRENT_TASK="$CURRENT_TASK_PATH"
  export PAMEM_WORK_LOG="$WORK_LOG_PATH"
  export PAMEM_SESSION_FILE="$SESSION_PATH"
  if [ "$action" = "resume" ]; then
    export PAMEM_RESUME=1
  else
    export PAMEM_RESUME=0
  fi
  cd "$WORKSPACE"
  exec "$@"
}

case "$COMMAND" in
  start|resume|status|hook-json|context)
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    echo "unknown command: $COMMAND" >&2
    usage >&2
    exit 2
    ;;
esac

if [ -n "$WORKSPACE_OVERRIDE" ]; then
  WORKSPACE="$(pamem_expand_path "$PWD" "$WORKSPACE_OVERRIDE")"
elif [ -n "$AGENT_ID_OVERRIDE" ]; then
  WORKSPACE="$(pamem_agent_home_path "$AGENT_ID_OVERRIDE")"
else
  WORKSPACE="$(find_workspace_root "$PWD")"
  if [ ! -s "$(pamem_config_path "$WORKSPACE")" ]; then
    SCRIPT_WORKSPACE="$(script_workspace_root)"
    if [ -n "$SCRIPT_WORKSPACE" ]; then
      WORKSPACE="$SCRIPT_WORKSPACE"
    fi
  fi
fi

if [ ! -s "$(pamem_config_path "$WORKSPACE")" ]; then
  echo "pamem config not found for root: $WORKSPACE" >&2
  echo "Run 'pamem init --agent-id <id>' or pass --workspace for an existing pamem workspace." >&2
  exit 1
fi

CONFIG_PATH="$(pamem_config_path "$WORKSPACE")"
RUNTIME_MODE="$(pamem_runtime_mode "$WORKSPACE")"
if [ -n "$AGENT_ID_OVERRIDE" ]; then
  AGENT_ID="$AGENT_ID_OVERRIDE"
else
  AGENT_ID="$(pamem_agent_id "$WORKSPACE")"
fi

MEMORY_REPO_ROOT="$(pamem_memory_repo_root "$WORKSPACE")"
MEMORY_ENTRY_FILE="$(pamem_memory_repo_entry_file "$WORKSPACE")"
resolve_cli_state_paths

case "$COMMAND" in
  start)
    ensure_cli_state
    if [ "${#LAUNCH_ARGS[@]}" -gt 0 ]; then
      record_session "start" "${LAUNCH_ARGS[@]}"
      run_launch_command "start" "${LAUNCH_ARGS[@]}"
    else
      print_status
      if [ "$PRINT_ENV" -eq 1 ]; then
        print_env "start"
      fi
    fi
    ;;
  resume)
    ensure_cli_state
    if [ "${#LAUNCH_ARGS[@]}" -gt 0 ]; then
      record_session "resume" "${LAUNCH_ARGS[@]}"
      run_launch_command "resume" "${LAUNCH_ARGS[@]}"
    elif [ "$PRINT_ENV" -eq 1 ]; then
      print_status
      print_env "resume"
    else
      RESUME_ARGS=()
      while IFS= read -r arg; do
        RESUME_ARGS+=("$arg")
      done < <(configured_resume_command "$CONFIG_PATH")

      if [ "${#RESUME_ARGS[@]}" -eq 0 ]; then
        while IFS= read -r arg; do
          RESUME_ARGS+=("$arg")
        done < <(load_last_command || true)
      fi

      if [ "${#RESUME_ARGS[@]}" -eq 0 ]; then
        echo "no resumable session found for agent_id=$AGENT_ID" >&2
        echo "Run 'pamem start --agent-id $AGENT_ID -- <launcher>' first, configure [runtime.resume].command, or pass an explicit resume command after --." >&2
        exit 1
      fi

      record_session "resume" "${RESUME_ARGS[@]}"
      run_launch_command "resume" "${RESUME_ARGS[@]}"
    fi
    ;;
  status)
    print_status
    if [ "$PRINT_ENV" -eq 1 ]; then
      print_env "start"
    fi
    ;;
  hook-json)
    print_hook_json
    ;;
  context)
    if [ "$RUNTIME_MODE" = "cli" ]; then
      ensure_cli_state
    fi
    print_context
    ;;
esac
