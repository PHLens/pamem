#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: skills/memory-lint/scripts/memory-lint.sh [--root <workspace>] [--json] [--strict]

Run a read-only lint check for the memory repo configured by a workspace-local
.pamem/config.toml.

Options:
  --root <path>  Agent workspace containing .pamem/config.toml. Defaults to $PWD.
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
CONFIG_PATH="$(pamem_workspace_config_path "$WORKSPACE")"

if [ ! -s "$CONFIG_PATH" ]; then
  fail_input "missing workspace-local config: $CONFIG_PATH"
fi

MEMORY_REPO_RAW="$(pamem_toml_get_value "$CONFIG_PATH" 'memory_repo' 'path' || true)"
if [ -z "$MEMORY_REPO_RAW" ]; then
  fail_input "missing memory_repo.path in workspace-local config: $CONFIG_PATH"
fi

MEMORY_ROOT="$(pamem_expand_path "$WORKSPACE" "$MEMORY_REPO_RAW")"
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
      printf '.pamem/config.toml'
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
    .pamem/*)
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
    add_finding "error" "ML001" ".pamem/config.toml" "" \
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
  add_finding "error" "ML002" ".pamem/config.toml" "" \
    "No memory profiles are configured" \
    "Workspace-local config must define at least one [profiles.<name>] table." \
    "profiles table missing" \
    "fix-config"
fi

if [ -z "$DEFAULT_PROFILE" ]; then
  add_finding "error" "ML002" ".pamem/config.toml" "" \
    "No default profile is configured" \
    "Workspace-local config should select one default_profile during onboarding." \
    "default_profile missing" \
    "fix-config"
elif ! printf '%s\n' "$PROFILE_NAMES" | grep -Fxq "$DEFAULT_PROFILE"; then
  add_finding "error" "ML002" ".pamem/config.toml" "" \
    "Default profile is not configured" \
    "default_profile must match one [profiles.<name>] table." \
    "$DEFAULT_PROFILE" \
    "fix-config"
fi

NESTED_CONFIG="$MEMORY_ROOT/.pamem/config.toml"
if [ -s "$NESTED_CONFIG" ]; then
  add_finding "error" "ML003" "$(repo_display_path "$NESTED_CONFIG")" "" \
    "Memory repo contains its own pamem config" \
    "The active config is workspace-local; do not add .pamem/config.toml to the shared memory repo." \
    "$NESTED_CONFIG" \
    "remove-repo-config"
fi

ENTRY_PATH=""
if ! ENTRY_PATH="$(resolve_repo_path "$ENTRY_FILE_RAW")"; then
  add_finding "error" "ML001" ".pamem/config.toml" "" \
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
  "L1/shared/workflow.md" \
  "L1/shared/experience.md" \
  "L2/active/current-tasks.md" \
  "L3/work-log.md" \
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

CURRENT_TASKS="$MEMORY_ROOT/L2/active/current-tasks.md"
if [ -s "$CURRENT_TASKS" ]; then
  TASK_IDS="$(awk '
    /^[[:space:]]*-[[:space:]]*[A-Za-z0-9._-]+:/ {
      line = $0
      sub(/^[[:space:]]*-[[:space:]]*/, "", line)
      sub(/:.*/, "", line)
      print line
    }
  ' "$CURRENT_TASKS")"

  while IFS= read -r task_id; do
    [ -n "$task_id" ] || continue
    if [ ! -s "$MEMORY_ROOT/L2/active/$task_id.md" ]; then
      add_finding "error" "ML008" "L2/active/current-tasks.md" "" \
        "Active roster points to a missing task file" \
        "Every active task in current-tasks.md should have a matching L2/active/<task-id>.md file." \
        "$task_id" \
        "repair-active-task"
    fi
  done <<< "$TASK_IDS"

  for task_file in "$MEMORY_ROOT"/L2/active/*.md; do
    [ -e "$task_file" ] || continue
    task_name="$(basename "$task_file" .md)"
    if [ "$task_name" = "current-tasks" ]; then
      continue
    fi
    if ! printf '%s\n' "$TASK_IDS" | grep -Fxq "$task_name"; then
      add_finding "warning" "ML008" "$(repo_display_path "$task_file")" "" \
        "Active task file is not listed in the active roster" \
        "Completed or abandoned task files should be archived or listed in L2/active/current-tasks.md." \
        "$task_name" \
        "archive-or-list-task"
    fi
  done
fi

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
    --argjson profiles "$PROFILE_NAMES_JSON" \
    --argjson findings "$FINDINGS_JSON" \
    --argjson error_count "$ERROR_COUNT" \
    --argjson warning_count "$WARNING_COUNT" \
    --argjson info_count "$INFO_COUNT" \
    '{
      status: $status,
      workspace_root: $workspace_root,
      config_path: $config_path,
      config_scope: "workspace-local",
      memory_root: $memory_root,
      config: {
        entry_file: $entry_file,
        default_profile: $default_profile,
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
