#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: skills/memory-lint/scripts/memory-lint.sh [--root <agent-home-or-workspace>] [--json] [--strict]

Run a read-only lint check for the memory repo configured by an agent-local
config.toml or a legacy workspace-local .pamem/config.toml.

Options:
  --root <path>  Agent home or workspace containing pamem config. Defaults to $PWD.
  --json         Emit a structured JSON report.
  --strict       Return exit code 1 when warnings are present.
  -h, --help     Show this help.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAMEM_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# shellcheck source=../../scripts/memory-store.sh
source "$PAMEM_ROOT/scripts/memory-store.sh"

ROOT="$PWD"
JSON=0
STRICT=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root)
      [ "$#" -ge 2 ] || { echo "missing value for --root" >&2; exit 2; }
      ROOT="$2"
      shift 2
      ;;
    --json)
      JSON=1
      shift
      ;;
    --strict)
      STRICT=1
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

if ! command -v jq >/dev/null 2>&1; then
  echo "memory-lint requires jq; install jq and rerun." >&2
  exit 1
fi

if ! command -v realpath >/dev/null 2>&1; then
  echo "memory-lint requires GNU realpath; install coreutils and rerun." >&2
  exit 1
fi

fail_input() {
  local message="$1"
  if [ "$JSON" -eq 1 ]; then
    jq -n --arg message "$message" '{
      status: "invalid",
      summary: { error_count: 1, warning_count: 0, info_count: 0 },
      findings: [],
      error: $message
    }'
  else
    echo "memory-lint: $message" >&2
  fi
  exit 2
}

WORKSPACE="$(pamem_expand_path "$PWD" "$ROOT")"
CONFIG_PATH="$(pamem_config_path "$WORKSPACE")"

if [ ! -s "$CONFIG_PATH" ]; then
  fail_input "missing pamem config: $CONFIG_PATH"
fi

MEMORY_ROOT="$(pamem_memory_repo_root "$WORKSPACE")"
if [ ! -d "$MEMORY_ROOT" ]; then
  fail_input "configured memory repo does not exist: $MEMORY_ROOT"
fi

ENTRY_FILE_RAW="$(pamem_config_value_or_default "$CONFIG_PATH" 'memory_repo' 'entry_file' 'MEMORY.md')"
DEFAULT_PROFILE="$(pamem_toml_get_value "$CONFIG_PATH" '' 'default_profile' || true)"
FINDINGS_FILE="$(mktemp)"

cleanup() {
  rm -f "$FINDINGS_FILE"
}
trap cleanup EXIT

add_finding() {
  local severity="$1"
  local rule="$2"
  local path="$3"
  local line="$4"
  local title="$5"
  local message="$6"
  local evidence="${7:-}"
  local suggested_action="${8:-request-review}"

  jq -nc \
    --arg severity "$severity" \
    --arg rule "$rule" \
    --arg path "$path" \
    --arg line "$line" \
    --arg title "$title" \
    --arg message "$message" \
    --arg evidence "$evidence" \
    --arg suggested_action "$suggested_action" \
    '{
      severity: $severity,
      rule: $rule,
      path: $path,
      line: (if $line == "" then null else ($line | tonumber) end),
      title: $title,
      message: $message,
      evidence: $evidence,
      suggested_action: $suggested_action
    }' >> "$FINDINGS_FILE"
}

repo_display_path() {
  local path="$1"
  case "$path" in
    "$MEMORY_ROOT"/*)
      printf '%s' "${path#"$MEMORY_ROOT"/}"
      ;;
    "$CONFIG_PATH")
      if pamem_is_agent_home "$WORKSPACE"; then
        printf 'config.toml'
      else
        printf '.pamem/config.toml'
      fi
      ;;
    *)
      printf '%s' "$path"
      ;;
  esac
}

resolve_repo_path() {
  local raw="$1"
  local resolved

  case "$raw" in
    /*)
      return 1
      ;;
  esac

  resolved="$(realpath -m "$MEMORY_ROOT/$raw")"
  case "$resolved" in
    "$MEMORY_ROOT"|"$MEMORY_ROOT"/*)
      printf '%s' "$resolved"
      ;;
    *)
      return 1
      ;;
  esac
}

is_template_path() {
  case "$1" in
    *'<'*'>'*|*'*'*|*'?'*|*'['*']'*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_workspace_local_path() {
  case "$1" in
    config.toml|.pamem/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

check_repo_target() {
  local raw="$1"
  local severity="$2"
  local rule="$3"
  local source="$4"
  local resolved

  if is_template_path "$raw" || is_workspace_local_path "$raw"; then
    return 0
  fi

  if ! resolved="$(resolve_repo_path "$raw")"; then
    add_finding "error" "ML001" "$(repo_display_path "$CONFIG_PATH")" "" \
      "Configured memory path escapes the memory repo" \
      "Memory profile paths must be relative to the configured memory repo." \
      "$source -> $raw" \
      "fix-config"
    return 0
  fi

  if [ ! -e "$resolved" ]; then
    add_finding "$severity" "$rule" "$(repo_display_path "$resolved")" "" \
      "Configured memory target is missing" \
      "Concrete profile load/write targets should exist in the configured memory repo." \
      "$source -> $raw" \
      "repair-memory-repo"
    return 0
  fi

  case "$raw" in
    */)
      if [ ! -d "$resolved" ]; then
        add_finding "$severity" "$rule" "$(repo_display_path "$resolved")" "" \
          "Configured memory target should be a directory" \
          "Profile paths ending with / should resolve to directories." \
          "$source -> $raw" \
          "repair-memory-repo"
      fi
      ;;
  esac
}

PROFILE_NAMES="$(awk '
  /^[[:space:]]*\[profiles\.[^]]+\][[:space:]]*$/ {
    line = $0
    sub(/^[[:space:]]*\[profiles\./, "", line)
    sub(/\][[:space:]]*$/, "", line)
    print line
  }
' "$CONFIG_PATH")"

if [ -z "$PROFILE_NAMES" ]; then
    add_finding "error" "ML002" "$(repo_display_path "$CONFIG_PATH")" "" \
    "No memory profiles are configured" \
    "Workspace-local config must define at least one [profiles.<name>] table." \
    "profiles table missing" \
    "fix-config"
fi

if [ -z "$DEFAULT_PROFILE" ]; then
  add_finding "error" "ML002" "$(repo_display_path "$CONFIG_PATH")" "" \
    "No default profile is configured" \
    "Workspace-local config should select one default_profile during onboarding." \
    "default_profile missing" \
    "fix-config"
elif ! awk -v profile="$DEFAULT_PROFILE" 'BEGIN { found = 1 } $0 == profile { found = 0; exit } END { exit found }' <<< "$PROFILE_NAMES"; then
  add_finding "error" "ML002" "$(repo_display_path "$CONFIG_PATH")" "" \
    "Default profile is not configured" \
    "default_profile must match one [profiles.<name>] table." \
    "$DEFAULT_PROFILE" \
    "fix-config"
fi

RUNTIME_MODE="$(pamem_config_value_or_default "$CONFIG_PATH" 'runtime' 'mode' 'cli')"
case "$RUNTIME_MODE" in
  cli|slock)
    ;;
  *)
  add_finding "error" "ML002" "$(repo_display_path "$CONFIG_PATH")" "" \
    "Runtime mode is not configured" \
    "runtime.mode, when present, must be either cli or slock." \
    "$RUNTIME_MODE" \
    "fix-config"
    ;;
esac

NESTED_CONFIG="$MEMORY_ROOT/.pamem/config.toml"
if [ -s "$NESTED_CONFIG" ]; then
  add_finding "error" "ML003" "$(repo_display_path "$NESTED_CONFIG")" "" \
    "Memory repo contains its own pamem config" \
    "The active config is local to the agent home or workspace; do not add .pamem/config.toml to the shared memory repo." \
    "$NESTED_CONFIG" \
    "remove-repo-config"
fi

check_workspace_symlink() {
  local path="$1"
  local expected="$2"
  local title="$3"
  local evidence="$4"
  local resolved
  local expected_resolved

  if [ ! -e "$path" ]; then
    add_finding "error" "ML008" "$(repo_display_path "$path")" "" \
      "$title" \
      "Slock workspaces should surface the shared memory file as a workspace symlink." \
      "$evidence -> missing" \
      "repair-workspace"
    return 0
  fi

  if [ ! -L "$path" ]; then
    add_finding "error" "ML008" "$(repo_display_path "$path")" "" \
      "$title" \
      "Slock workspaces should surface the shared memory file as a workspace symlink." \
      "$evidence -> regular file" \
      "repair-workspace"
    return 0
  fi

  resolved="$(realpath "$path")"
  expected_resolved="$(realpath -m "$expected")"
  if [ "$resolved" != "$expected_resolved" ]; then
    add_finding "error" "ML008" "$(repo_display_path "$path")" "" \
      "$title" \
      "Slock workspace symlinks must resolve to the shared memory repo surface." \
      "$evidence -> $resolved (expected $expected_resolved)" \
      "repair-workspace"
  fi
}

if [ "$RUNTIME_MODE" = "slock" ]; then
  for task_file in \
    "$WORKSPACE/notes/current-task.md" \
    "$WORKSPACE/notes/work-log.md"
  do
    if [ ! -s "$task_file" ]; then
      add_finding "error" "ML008" "$(repo_display_path "$task_file")" "" \
        "Slock workspace task file is missing" \
        "Slock runtime should keep current-task and work-log in workspace notes." \
        "$(repo_display_path "$task_file")" \
        "repair-workspace"
    fi
  done

  check_workspace_symlink \
    "$WORKSPACE/notes/user-preferences.md" \
    "$MEMORY_ROOT/L1/shared/preferences.md" \
    "Slock workspace user preferences should link to shared memory" \
    "notes/user-preferences.md"

  check_workspace_symlink \
    "$WORKSPACE/notes/operating-rules.md" \
    "$MEMORY_ROOT/L1/shared/operating-rules.md" \
    "Slock workspace operating rules should link to shared memory" \
    "notes/operating-rules.md"

  check_workspace_symlink \
    "$WORKSPACE/notes/experience.md" \
    "$MEMORY_ROOT/L1/shared/experience.md" \
    "Slock workspace experience should link to shared memory" \
    "notes/experience.md"
fi

ENTRY_PATH=""
if ! ENTRY_PATH="$(resolve_repo_path "$ENTRY_FILE_RAW")"; then
  add_finding "error" "ML001" "$(repo_display_path "$CONFIG_PATH")" "" \
    "Entry file path escapes the memory repo" \
    "memory_repo.entry_file must be relative to the configured memory repo." \
    "$ENTRY_FILE_RAW" \
    "fix-config"
elif [ ! -s "$ENTRY_PATH" ]; then
  add_finding "error" "ML004" "$(repo_display_path "$ENTRY_PATH")" "" \
    "Memory entry file is missing" \
    "The configured memory repo must contain the entry file used by startup." \
    "$ENTRY_FILE_RAW" \
    "repair-memory-repo"
else
  LINE_COUNT="$(wc -l < "$ENTRY_PATH" | awk '{print $1}')"
  BYTE_COUNT="$(wc -c < "$ENTRY_PATH" | awk '{print $1}')"
  if [ "$LINE_COUNT" -gt 120 ] || [ "$BYTE_COUNT" -gt 6000 ]; then
    add_finding "warning" "ML005" "$(repo_display_path "$ENTRY_PATH")" "" \
      "Memory entry file is too large" \
      "MEMORY.md should stay as a thin startup index, not a transcript or long notebook." \
      "$LINE_COUNT lines, $BYTE_COUNT bytes" \
      "compress-index"
  fi

  while IFS=: read -r line pointer; do
    [ -n "$pointer" ] || continue
    if is_template_path "$pointer"; then
      continue
    fi
    if ! pointer_path="$(resolve_repo_path "$pointer")"; then
      add_finding "error" "ML006" "$(repo_display_path "$ENTRY_PATH")" "$line" \
        "Memory index pointer escapes the memory repo" \
        "Pointers from the entry file to L0/L1/L2/L3 memory should stay inside the configured repo." \
        "$pointer" \
        "fix-pointer"
      continue
    fi
    if [ ! -e "$pointer_path" ]; then
      add_finding "error" "ML006" "$(repo_display_path "$ENTRY_PATH")" "$line" \
        "Memory index points to a missing file" \
        "Pointers from the entry file should resolve inside the configured memory repo." \
        "$pointer" \
        "fix-pointer"
    fi
  done < <(grep -Eno '((L0|L1|L2|L3|requests)/[A-Za-z0-9._<>/\-]+\.md)' "$ENTRY_PATH" || true)
fi

for required in \
  "L0/constitution.md" \
  "L1/shared/preferences.md" \
  "L1/shared/operating-rules.md" \
  "L1/shared/experience.md" \
  "L2/projects/" \
  "requests/inbox/"
do
  check_repo_target "$required" "error" "ML004" "required skeleton"
done

while IFS= read -r profile; do
  [ -n "$profile" ] || continue
  for key in load write guarded_write; do
    while IFS= read -r target; do
      [ -n "$target" ] || continue
      check_repo_target "$target" "error" "ML007" "profiles.$profile.$key"
    done < <(pamem_toml_array_values "$CONFIG_PATH" "profiles.$profile" "$key")
  done
done <<< "$PROFILE_NAMES"

ERROR_COUNT="$(jq -s '[.[] | select(.severity == "error")] | length' "$FINDINGS_FILE")"
WARNING_COUNT="$(jq -s '[.[] | select(.severity == "warning")] | length' "$FINDINGS_FILE")"
INFO_COUNT="$(jq -s '[.[] | select(.severity == "info")] | length' "$FINDINGS_FILE")"
FINDINGS_JSON="$(jq -s '.' "$FINDINGS_FILE")"
PROFILE_NAMES_JSON="$(printf '%s\n' "$PROFILE_NAMES" | jq -R -s 'split("\n") | map(select(length > 0))')"

if [ "$ERROR_COUNT" -gt 0 ]; then
  STATUS="error"
elif [ "$WARNING_COUNT" -gt 0 ]; then
  STATUS="warning"
else
  STATUS="ok"
fi

if [ "$JSON" -eq 1 ]; then
  jq -n \
    --arg status "$STATUS" \
    --arg workspace_root "$WORKSPACE" \
    --arg config_path "$CONFIG_PATH" \
    --arg memory_root "$MEMORY_ROOT" \
    --arg entry_file "$ENTRY_FILE_RAW" \
    --arg default_profile "$DEFAULT_PROFILE" \
    --arg runtime_mode "$RUNTIME_MODE" \
    --argjson profiles "$PROFILE_NAMES_JSON" \
    --argjson findings "$FINDINGS_JSON" \
    --argjson error_count "$ERROR_COUNT" \
    --argjson warning_count "$WARNING_COUNT" \
    --argjson info_count "$INFO_COUNT" \
    '{
      status: $status,
      workspace_root: $workspace_root,
      config_path: $config_path,
      config_scope: (if ($config_path | endswith("/.pamem/config.toml")) then "workspace-local" else "agent-local" end),
      memory_root: $memory_root,
      config: {
        entry_file: $entry_file,
        default_profile: $default_profile,
        runtime_mode: $runtime_mode,
        profiles: $profiles
      },
      summary: {
        error_count: $error_count,
        warning_count: $warning_count,
        info_count: $info_count
      },
      findings: $findings
    }'
else
  printf 'Memory lint: %s (%s errors, %s warnings) for %s\n' "$STATUS" "$ERROR_COUNT" "$WARNING_COUNT" "$MEMORY_ROOT"
  jq -rs '.[] | "\(.severity) \(.rule) \(.path)\(if .line then ":" + (.line|tostring) else "" end)\n  \(.title): \(.message)\n  evidence: \(.evidence)\n  action: \(.suggested_action)"' "$FINDINGS_FILE" | while IFS= read -r line; do
    printf '%s\n' "$line"
  done
fi

if [ "$ERROR_COUNT" -gt 0 ]; then
  exit 1
fi

if [ "$STRICT" -eq 1 ] && [ "$WARNING_COUNT" -gt 0 ]; then
  exit 1
fi

exit 0
