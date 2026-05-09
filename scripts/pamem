#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: pamem <command> [options]

Commands:
  launch                 Initialize/bind a role, then start or resume a runtime.
  status                 Print resolved agent home, memory repo, and runtime state.
  hook-json              Print SessionStart hook input JSON for the agent.
  context                Print startup memory context for runtimes without hooks.
  lint                   Run read-only memory lint for the configured memory repo.
  pr-check               Check memory PR changed-file scope and lint status.
  install [workspace]    Install/repair default pamem bootstrap files.
  repair [workspace]     Repair pamem bootstrap files.
  remove [workspace]     Remove managed hook entries.

Examples:
  pamem launch --role coder --agent-id coder-local -- codex
  pamem launch --role coder --agent-id coder-local --resume
  pamem launch --runtime slock --role coder --workspace ~/.slock/agents/<agent-id>
  pamem status --agent-id coder-local
  pamem context --agent-id coder-local
  pamem lint --agent-id coder-local --json
  pamem pr-check --agent-id coder-local --head HEAD --target roles/coder/

Use "pamem <command> --help" for command-specific options.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_ROOT="$PLUGIN_ROOT"
if [ "$(basename "$PLUGIN_ROOT")" = ".pamem" ]; then
  if [ -L "$PLUGIN_ROOT/scripts" ]; then
    RUNTIME_SCRIPTS_DIR="$(cd "$(dirname "$PLUGIN_ROOT/scripts")/$(readlink "$PLUGIN_ROOT/scripts")" && pwd)"
    RUNTIME_ROOT="$(cd "$RUNTIME_SCRIPTS_DIR/.." && pwd)"
  fi
fi

# shellcheck source=memory-store.sh
source "$SCRIPT_DIR/memory-store.sh"

SUPPORTED_ROLES=(onboarding coder reviewer researcher wiki)

supported_role_list() {
  local IFS='|'
  printf '%s' "${SUPPORTED_ROLES[*]}"
}

require_supported_role() {
  local requested="$1"
  local role

  for role in "${SUPPORTED_ROLES[@]}"; do
    if [ "$role" = "$requested" ]; then
      return 0
    fi
  done

  echo "unsupported role: $requested (supported: $(supported_role_list))" >&2
  exit 2
}

require_role_match() {
  local root="$1"
  local requested_role="$2"
  local existing_role

  existing_role="$(pamem_default_profile "$root")"
  if [ "$existing_role" != "$requested_role" ]; then
    echo "pamem config at $root is already bound to role=$existing_role; choose a different --agent-id/--workspace or re-onboard deliberately" >&2
    exit 2
  fi
}

require_runtime_match() {
  local root="$1"
  local requested_runtime="$2"
  local existing_runtime

  existing_runtime="$(pamem_runtime_mode "$root")"
  if [ "$existing_runtime" != "$requested_runtime" ]; then
    echo "pamem config at $root is runtime=$existing_runtime, not $requested_runtime" >&2
    exit 2
  fi
}

run_launch() {
  local role=""
  local runtime="cli"
  local agent_id=""
  local workspace=""
  local resume=0
  local print_env=0
  local onboard_args=()
  local launch_args=()
  local init_args=()
  local cli_args=()

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --)
        shift
        launch_args=("$@")
        break
        ;;
      --role)
        [ "$#" -ge 2 ] || { echo "missing value for --role" >&2; exit 2; }
        role="$2"
        shift 2
        ;;
      --role=*)
        role="${1#*=}"
        shift
        ;;
      --runtime)
        [ "$#" -ge 2 ] || { echo "missing value for --runtime" >&2; exit 2; }
        runtime="$2"
        shift 2
        ;;
      --runtime=*)
        runtime="${1#*=}"
        shift
        ;;
      --agent-id)
        [ "$#" -ge 2 ] || { echo "missing value for --agent-id" >&2; exit 2; }
        agent_id="$2"
        shift 2
        ;;
      --agent-id=*)
        agent_id="${1#*=}"
        shift
        ;;
      --workspace)
        [ "$#" -ge 2 ] || { echo "missing value for --workspace" >&2; exit 2; }
        workspace="$2"
        shift 2
        ;;
      --workspace=*)
        workspace="${1#*=}"
        shift
        ;;
      --memory-repo|--sync-remote|--sync-ref|--sync-executor)
        [ "$#" -ge 2 ] || { echo "missing value for $1" >&2; exit 2; }
        onboard_args+=("$1" "$2")
        shift 2
        ;;
      --memory-repo=*|--sync-remote=*|--sync-ref=*|--sync-executor=*)
        onboard_args+=("${1%%=*}" "${1#*=}")
        shift
        ;;
      --resume)
        resume=1
        shift
        ;;
      --print-env)
        print_env=1
        shift
        ;;
      -h|--help)
        cat <<'EOF'
Usage: pamem launch --role <role> [--runtime cli|slock] [--agent-id <id>] [--workspace <path>] [--resume] [--print-env] [-- <command> [args...]]

CLI runtime:
  pamem launch --role coder --agent-id coder-local -- codex
  pamem launch --role coder --agent-id coder-local --resume

Slock runtime:
  pamem launch --runtime slock --role coder --workspace ~/.slock/agents/<agent-id>

Role selection is the public startup contract. The config still stores the
selected role in the internal default_profile field.
EOF
        exit 0
        ;;
      *)
        echo "unknown launch argument: $1" >&2
        exit 2
        ;;
    esac
  done

  if [ -z "$role" ]; then
    echo "pamem launch requires --role" >&2
    exit 2
  fi
  require_supported_role "$role"

  case "$runtime" in
    cli|slock)
      ;;
    *)
      echo "unsupported runtime: $runtime" >&2
      exit 2
      ;;
  esac

  if [ "$runtime" = "cli" ]; then
    if [ -z "$workspace" ]; then
      if [ -z "$agent_id" ]; then
        echo "pamem launch --runtime cli requires --agent-id when --workspace is not provided" >&2
        exit 2
      fi
      workspace="$(pamem_agent_home_path "$agent_id")"
    fi

    if pamem_has_config "$workspace"; then
      require_role_match "$workspace" "$role"
      require_runtime_match "$workspace" "cli"
    else
      init_args=("$workspace" "--agent-home" "--profile" "$role" "--runtime" "cli" "${onboard_args[@]}")
      if [ -n "$agent_id" ]; then
        init_args+=("--agent-id" "$agent_id")
      fi
      "$SCRIPT_DIR/onboard-pamem.sh" "${init_args[@]}" >&2
    fi

    cli_args=("--workspace" "$workspace")
    if [ -n "$agent_id" ]; then
      cli_args+=("--agent-id" "$agent_id")
    fi
    if [ "$print_env" -eq 1 ]; then
      cli_args+=("--print-env")
    fi
    if [ "${#launch_args[@]}" -gt 0 ]; then
      cli_args+=("--" "${launch_args[@]}")
    fi

    if [ "$resume" -eq 1 ]; then
      exec "$SCRIPT_DIR/pamem-cli.sh" resume "${cli_args[@]}"
    fi
    exec "$SCRIPT_DIR/pamem-cli.sh" start "${cli_args[@]}"
  fi

  if [ -z "$workspace" ]; then
    echo "pamem launch --runtime slock requires --workspace" >&2
    exit 2
  fi
  if [ "$resume" -eq 1 ]; then
    echo "pamem launch --runtime slock binds/repairs an existing Slock workspace; resume is handled by Slock" >&2
    exit 2
  fi
  if [ "$print_env" -eq 1 ]; then
    echo "pamem launch --runtime slock does not emit CLI launcher environment" >&2
    exit 2
  fi
  if [ "${#launch_args[@]}" -gt 0 ]; then
    echo "pamem launch --runtime slock does not start a process; start the agent through Slock" >&2
    exit 2
  fi

  if pamem_has_config "$workspace"; then
    require_role_match "$workspace" "$role"
    require_runtime_match "$workspace" "slock"
    "$SCRIPT_DIR/repair-pamem.sh" "$workspace" >&2
  else
    init_args=("$workspace" "--profile" "$role" "--runtime" "slock" "${onboard_args[@]}")
    if [ -n "$agent_id" ]; then
      init_args+=("--agent-id" "$agent_id")
    fi
    "$SCRIPT_DIR/onboard-pamem.sh" "${init_args[@]}" >&2
  fi

  exec "$SCRIPT_DIR/pamem-cli.sh" status --workspace "$workspace"
}

command_workspace_args() {
  local args=("$@")
  local saw_workspace=0
  local saw_separator=0
  local agent_id=""
  local rewritten=()
  local workspace

  while [ "${#args[@]}" -gt 0 ]; do
    if [ "$saw_separator" -eq 1 ]; then
      rewritten+=("${args[0]}")
      args=("${args[@]:1}")
      continue
    fi

    case "${args[0]}" in
      --)
        saw_separator=1
        rewritten+=("--")
        args=("${args[@]:1}")
        ;;
      --workspace)
        [ "${#args[@]}" -ge 2 ] || { echo "missing value for --workspace" >&2; exit 2; }
        saw_workspace=1
        rewritten+=("--workspace" "${args[1]}")
        args=("${args[@]:2}")
        ;;
      --workspace=*)
        saw_workspace=1
        rewritten+=("--workspace" "${args[0]#*=}")
        args=("${args[@]:1}")
        ;;
      --agent-id)
        [ "${#args[@]}" -ge 2 ] || { echo "missing value for --agent-id" >&2; exit 2; }
        agent_id="${args[1]}"
        rewritten+=("--agent-id" "$agent_id")
        args=("${args[@]:2}")
        ;;
      --agent-id=*)
        agent_id="${args[0]#*=}"
        rewritten+=("--agent-id" "$agent_id")
        args=("${args[@]:1}")
        ;;
      *)
        rewritten+=("${args[0]}")
        args=("${args[@]:1}")
        ;;
    esac
  done

  if [ "$saw_workspace" -eq 0 ]; then
    workspace="$(pamem_installed_workspace_root "$PLUGIN_ROOT")"
    if [ -z "$workspace" ] && [ -n "$agent_id" ]; then
      workspace="$(pamem_agent_home_path "$agent_id")"
    fi
    if [ -n "$workspace" ]; then
      rewritten=("--workspace" "$workspace" "${rewritten[@]}")
    fi
  fi

  printf '%s\0' "${rewritten[@]}"
}

run_cli_command() {
  local command="$1"
  shift
  local args=()
  local arg

  while IFS= read -r -d '' arg; do
    args+=("$arg")
  done < <(command_workspace_args "$@")

  exec "$SCRIPT_DIR/pamem-cli.sh" "$command" "${args[@]}"
}

workspace_default_args() {
  local args=("$@")
  local saw_root=0
  local rewritten=()
  local workspace
  local agent_id=""

  while [ "${#args[@]}" -gt 0 ]; do
    case "${args[0]}" in
      --root)
        [ "${#args[@]}" -ge 2 ] || { echo "missing value for --root" >&2; exit 2; }
        saw_root=1
        rewritten+=("--root" "${args[1]}")
        args=("${args[@]:2}")
        ;;
      --root=*)
        saw_root=1
        rewritten+=("${args[0]}")
        args=("${args[@]:1}")
        ;;
      --workspace)
        [ "${#args[@]}" -ge 2 ] || { echo "missing value for --workspace" >&2; exit 2; }
        saw_root=1
        rewritten+=("--root" "${args[1]}")
        args=("${args[@]:2}")
        ;;
      --workspace=*)
        saw_root=1
        rewritten+=("--root" "${args[0]#*=}")
        args=("${args[@]:1}")
        ;;
      --agent-id)
        [ "${#args[@]}" -ge 2 ] || { echo "missing value for --agent-id" >&2; exit 2; }
        agent_id="${args[1]}"
        args=("${args[@]:2}")
        ;;
      --agent-id=*)
        agent_id="${args[0]#*=}"
        args=("${args[@]:1}")
        ;;
      *)
        rewritten+=("${args[0]}")
        args=("${args[@]:1}")
        ;;
    esac
  done

  if [ "$saw_root" -eq 0 ]; then
    workspace="$(pamem_installed_workspace_root "$PLUGIN_ROOT")"
    if [ -z "$workspace" ] && [ -n "$agent_id" ]; then
      workspace="$(pamem_agent_home_path "$agent_id")"
    fi
    if [ -n "$workspace" ]; then
      rewritten=("--root" "$workspace" "${rewritten[@]}")
    fi
  fi

  printf '%s\0' "${rewritten[@]}"
}

run_root_tool() {
  local script="$1"
  shift
  local args=()
  local arg

  while IFS= read -r -d '' arg; do
    args+=("$arg")
  done < <(workspace_default_args "$@")

  exec "$script" "${args[@]}"
}

run_workspace_script() {
  local script="$1"
  shift
  local workspace="."

  if [ "$#" -gt 0 ]; then
    workspace="$1"
    shift
  else
    local installed
    installed="$(pamem_installed_workspace_root "$PLUGIN_ROOT")"
    if [ -n "$installed" ]; then
      workspace="$installed"
    fi
  fi

  exec "$script" "$workspace" "$@"
}

if [ "$#" -lt 1 ]; then
  usage >&2
  exit 2
fi

COMMAND="$1"
shift

case "$COMMAND" in
  launch)
    run_launch "$@"
    ;;
  status|hook-json|context)
    run_cli_command "$COMMAND" "$@"
    ;;
  lint)
    run_root_tool "$RUNTIME_ROOT/skills/memory-lint/scripts/memory-lint.sh" "$@"
    ;;
  pr-check)
    run_root_tool "$RUNTIME_ROOT/scripts/memory-pr-check.sh" "$@"
    ;;
  install)
    run_workspace_script "$SCRIPT_DIR/install-pamem.sh" "$@"
    ;;
  repair)
    run_workspace_script "$SCRIPT_DIR/repair-pamem.sh" "$@"
    ;;
  remove)
    run_workspace_script "$SCRIPT_DIR/remove-pamem.sh" "$@"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "unknown pamem command: $COMMAND" >&2
    usage >&2
    exit 2
    ;;
esac
