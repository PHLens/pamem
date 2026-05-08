#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: onboard-pamem.sh <root> [--agent-home] [--profile <onboarding|coder|reviewer|researcher|wiki>] [--runtime <cli|slock>] [--agent-id <id>] [--memory-repo <path>] [--sync-backend <local|git|webdav>] [--sync-remote <target>] [--sync-ref <ref>] [--sync-executor <name>] [--force]

Create the pamem config during onboarding, then seed local files.

Profile selection is an onboarding-time decision. This script refuses to replace
an existing config unless --force is passed for deliberate
re-onboarding.

Options:
  --agent-home           Treat <root> as an XDG-style agent home with config.toml.
  --profile <name>       Default active profile. Defaults to onboarding.
  --runtime <mode>       Runtime mode. Defaults to cli.
  --agent-id <id>        Stable CLI runtime id. Defaults to a workspace-derived id.
  --memory-repo <path>   Override memory_repo.path.
  --sync-backend <name>  Override memory_repo.sync.backend.
  --sync-remote <target> Override memory_repo.sync.remote.
  --sync-ref <ref>       Override memory_repo.sync.ref.
  --sync-executor <name> Override sync.executor.
  --force                Replace an existing config.
  -h, --help             Show this help.
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

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  usage
  exit 0
fi

TARGET_INPUT="$1"
shift

PROFILE="onboarding"
RUNTIME_MODE="cli"
AGENT_ID=""
MEMORY_REPO=""
SYNC_BACKEND=""
SYNC_REMOTE=""
SYNC_REF=""
SYNC_EXECUTOR=""
FORCE=0
AGENT_HOME_MODE=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent-home)
      AGENT_HOME_MODE=1
      shift
      ;;
    --profile)
      [ "$#" -ge 2 ] || { echo "missing value for --profile" >&2; exit 2; }
      PROFILE="$2"
      shift 2
      ;;
    --runtime)
      [ "$#" -ge 2 ] || { echo "missing value for --runtime" >&2; exit 2; }
      RUNTIME_MODE="$2"
      shift 2
      ;;
    --agent-id)
      [ "$#" -ge 2 ] || { echo "missing value for --agent-id" >&2; exit 2; }
      AGENT_ID="$2"
      shift 2
      ;;
    --memory-repo)
      [ "$#" -ge 2 ] || { echo "missing value for --memory-repo" >&2; exit 2; }
      MEMORY_REPO="$2"
      shift 2
      ;;
    --sync-backend)
      [ "$#" -ge 2 ] || { echo "missing value for --sync-backend" >&2; exit 2; }
      SYNC_BACKEND="$2"
      shift 2
      ;;
    --sync-remote)
      [ "$#" -ge 2 ] || { echo "missing value for --sync-remote" >&2; exit 2; }
      SYNC_REMOTE="$2"
      shift 2
      ;;
    --sync-ref)
      [ "$#" -ge 2 ] || { echo "missing value for --sync-ref" >&2; exit 2; }
      SYNC_REF="$2"
      shift 2
      ;;
    --sync-executor)
      [ "$#" -ge 2 ] || { echo "missing value for --sync-executor" >&2; exit 2; }
      SYNC_EXECUTOR="$2"
      shift 2
      ;;
    --force)
      FORCE=1
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

case "$PROFILE" in
  onboarding|coder|reviewer|researcher|wiki)
    ;;
  *)
    echo "unsupported profile: $PROFILE" >&2
    exit 2
    ;;
esac

case "$SYNC_BACKEND" in
  ""|local|git|webdav)
    ;;
  *)
    echo "unsupported sync backend: $SYNC_BACKEND" >&2
    exit 2
    ;;
esac

case "$RUNTIME_MODE" in
  cli|slock)
    ;;
  *)
    echo "unsupported runtime mode: $RUNTIME_MODE" >&2
    exit 2
    ;;
esac

if ! command -v jq >/dev/null 2>&1; then
  echo "pamem requires jq; install jq and rerun." >&2
  exit 1
fi

if ! command -v realpath >/dev/null 2>&1; then
  echo "pamem requires GNU realpath; install coreutils and rerun." >&2
  exit 1
fi

profile_template() {
  local profile="$1"
  case "$profile" in
    onboarding)
      printf '%s/config.toml.template' "$ASSETS_DIR"
      ;;
    *)
      printf '%s/config-profiles/%s.toml.template' "$ASSETS_DIR" "$profile"
      ;;
  esac
}

toml_string() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

set_toml_value() {
  local file="$1"
  local section="$2"
  local key="$3"
  local value="$4"
  local tmp_file

  tmp_file="$(mktemp)"
  awk -v target="[$section]" -v key="$key" -v value="$value" '
    BEGIN { in_section = 0; updated = 0 }
    /^\[[^]]+\]$/ {
      if (in_section && !updated) {
        print key " = " value
        updated = 1
      }
      in_section = ($0 == target)
      print
      next
    }
    in_section {
      pattern = "^[[:space:]]*" key "[[:space:]]*="
      if ($0 ~ pattern) {
        print key " = " value
        updated = 1
        next
      }
    }
    { print }
    END {
      if (in_section && !updated) {
        print key " = " value
      }
    }
  ' "$file" > "$tmp_file"
  mv "$tmp_file" "$file"
}

mkdir -p "$TARGET_INPUT"
WORKSPACE="$(cd "$TARGET_INPUT" && pwd)"
if [ "$AGENT_HOME_MODE" -eq 1 ]; then
  CONFIG_PATH="$(pamem_agent_home_config_path "$WORKSPACE")"
else
  CONFIG_PATH="$(pamem_workspace_config_path "$WORKSPACE")"
fi
TEMPLATE_PATH="$(profile_template "$PROFILE")"

if [ ! -s "$TEMPLATE_PATH" ]; then
  echo "missing config template for profile '$PROFILE': $TEMPLATE_PATH" >&2
  exit 1
fi

if [ -s "$CONFIG_PATH" ] && [ "$FORCE" -ne 1 ]; then
  EXISTING_PROFILE="$(pamem_toml_get_value "$CONFIG_PATH" '' 'default_profile' 2>/dev/null || true)"
  if [ -n "$EXISTING_PROFILE" ]; then
    echo "pamem config already exists with default_profile=$EXISTING_PROFILE; rerun with --force only for deliberate re-onboarding" >&2
  else
    echo "pamem config already exists; rerun with --force only for deliberate re-onboarding" >&2
  fi
  exit 1
fi

mkdir -p "$(dirname "$CONFIG_PATH")"
cp "$TEMPLATE_PATH" "$CONFIG_PATH"

if [ -n "$MEMORY_REPO" ]; then
  set_toml_value "$CONFIG_PATH" "memory_repo" "path" "$(toml_string "$MEMORY_REPO")"
fi

set_toml_value "$CONFIG_PATH" "runtime" "mode" "$(toml_string "$RUNTIME_MODE")"

if [ -n "$AGENT_ID" ]; then
  set_toml_value "$CONFIG_PATH" "runtime" "agent_id" "$(toml_string "$AGENT_ID")"
fi

if [ -n "$SYNC_BACKEND" ]; then
  set_toml_value "$CONFIG_PATH" "memory_repo.sync" "backend" "$(toml_string "$SYNC_BACKEND")"
fi

if [ -n "$SYNC_REMOTE" ]; then
  set_toml_value "$CONFIG_PATH" "memory_repo.sync" "remote" "$(toml_string "$SYNC_REMOTE")"
fi

if [ -n "$SYNC_REF" ]; then
  set_toml_value "$CONFIG_PATH" "memory_repo.sync" "ref" "$(toml_string "$SYNC_REF")"
fi

if [ -n "$SYNC_EXECUTOR" ]; then
  set_toml_value "$CONFIG_PATH" "sync" "executor" "$(toml_string "$SYNC_EXECUTOR")"
fi

if [ "$AGENT_HOME_MODE" -eq 1 ]; then
  "$SCRIPT_DIR/install-pamem.sh" "$WORKSPACE" --agent-home
else
  "$SCRIPT_DIR/install-pamem.sh" "$WORKSPACE"
fi

MEMORY_REPO_ROOT="$(pamem_memory_repo_root "$WORKSPACE")"

if [ "$AGENT_HOME_MODE" -eq 1 ]; then
  printf 'Onboarded pamem agent home %s with profile=%s\n' "$WORKSPACE" "$PROFILE"
else
  printf 'Onboarded pamem workspace %s with profile=%s\n' "$WORKSPACE" "$PROFILE"
fi
printf 'Config: %s\n' "$CONFIG_PATH"
printf 'Memory repo: %s\n' "$MEMORY_REPO_ROOT"
printf 'Agent: %s\n' "$(pamem_agent_id "$WORKSPACE")"
