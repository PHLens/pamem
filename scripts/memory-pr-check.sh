#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: memory-pr-check.sh [--root <agent-home-or-workspace>] [--base <ref>] [--head <ref>] [--target <path>]... [--allow-guarded] [--json]

Check whether a memory PR changes only authorized shared-memory surfaces, then
run memory lint against the configured repo.

Options:
  --root <path>       Agent home or workspace containing pamem config. Defaults to $PWD.
  --base <ref>        Base ref for git diff. Defaults to memory_repo.sync.ref.
  --head <ref>        Head ref for git diff. Defaults to HEAD.
  --target <path>     Required allowed target path or directory relative to the memory repo. Repeatable.
  --allow-guarded     Permit guarded surfaces such as MEMORY.md, governance/, shared/,
                      and paths listed in active profile guarded_write.
  --json              Emit a structured JSON report.
  -h, --help          Show this help.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=memory-store.sh
source "$SCRIPT_DIR/memory-store.sh"

ROOT="$PWD"
BASE_REF=""
HEAD_REF="HEAD"
ALLOW_GUARDED=0
JSON=0
TARGETS=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root)
      [ "$#" -ge 2 ] || { echo "missing value for --root" >&2; exit 2; }
      ROOT="$2"
      shift 2
      ;;
    --base)
      [ "$#" -ge 2 ] || { echo "missing value for --base" >&2; exit 2; }
      BASE_REF="$2"
      shift 2
      ;;
    --head)
      [ "$#" -ge 2 ] || { echo "missing value for --head" >&2; exit 2; }
      HEAD_REF="$2"
      shift 2
      ;;
    --target)
      [ "$#" -ge 2 ] || { echo "missing value for --target" >&2; exit 2; }
      TARGETS+=("$2")
      shift 2
      ;;
    --allow-guarded)
      ALLOW_GUARDED=1
      shift
      ;;
    --json)
      JSON=1
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

pamem_require_jq "memory-pr-check requires jq; install jq and rerun."
pamem_require_realpath "memory-pr-check requires GNU realpath; install coreutils and rerun."
pamem_require_command git "memory-pr-check requires git; install git and rerun."

WORKSPACE="$(pamem_expand_path "$PWD" "$ROOT")"
CONFIG_PATH="$(pamem_config_path "$WORKSPACE")"

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
    echo "memory-pr-check: $message" >&2
  fi
  exit 2
}

if [ ! -s "$CONFIG_PATH" ]; then
  fail_input "missing pamem config: $CONFIG_PATH"
fi

MEMORY_ROOT="$(pamem_memory_repo_root "$WORKSPACE")"
if [ ! -d "$MEMORY_ROOT" ]; then
  fail_input "configured memory repo does not exist: $MEMORY_ROOT"
fi

if ! git -C "$MEMORY_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail_input "configured memory repo is not a git work tree: $MEMORY_ROOT"
fi

if [ -z "$BASE_REF" ]; then
  BASE_REF="$(pamem_memory_repo_ref "$WORKSPACE")"
fi

FINDINGS_FILE="$(mktemp)"
LINT_JSON_FILE="$(mktemp)"
cleanup() {
  rm -f "$FINDINGS_FILE" "$LINT_JSON_FILE"
}
trap cleanup EXIT

add_finding() {
  local severity="$1"
  local rule="$2"
  local path="$3"
  local title="$4"
  local message="$5"
  local evidence="${6:-}"
  local suggested_action="${7:-request-review}"

  jq -nc \
    --arg severity "$severity" \
    --arg rule "$rule" \
    --arg path "$path" \
    --arg title "$title" \
    --arg message "$message" \
    --arg evidence "$evidence" \
    --arg suggested_action "$suggested_action" \
    '{
      severity: $severity,
      rule: $rule,
      path: $path,
      line: null,
      title: $title,
      message: $message,
      evidence: $evidence,
      suggested_action: $suggested_action
    }' >> "$FINDINGS_FILE"
}

normalize_target() {
  local target="$1"
  target="${target#./}"
  case "$target" in
    ""|/*|*'..'*|*'<'*'>'*|*'*'*|*'?'*|*'['*']'*)
      return 1
      ;;
  esac
  printf '%s' "$target"
}

if [ "${#TARGETS[@]}" -eq 0 ]; then
  fail_input "at least one --target is required"
fi

NORMALIZED_TARGETS=()
for target in "${TARGETS[@]}"; do
  if ! normalized="$(normalize_target "$target")"; then
    fail_input "invalid target path: $target"
  fi
  NORMALIZED_TARGETS+=("$normalized")
done

path_matches_targets() {
  local path="$1"
  local target

  for target in "${NORMALIZED_TARGETS[@]}"; do
    case "$target" in
      */)
        case "$path" in
          "$target"|"$target"*) return 0 ;;
        esac
        ;;
      *)
        [ "$path" = "$target" ] && return 0
        ;;
    esac
  done

  return 1
}

is_guarded_path() {
  local path="$1"
  local guarded

  case "$1" in
    MEMORY.md|governance/*|shared/*|config.toml|.pamem/*|agents/*|skills/*|scripts/*|assets/*)
      return 0
      ;;
  esac

  for guarded in "${GUARDED_TARGETS[@]}"; do
    case "$guarded" in
      */)
        case "$path" in
          "$guarded"|"$guarded"*) return 0 ;;
        esac
        ;;
      *)
        [ "$path" = "$guarded" ] && return 0
        ;;
    esac
  done

  return 1
}

is_memory_surface_path() {
  case "$1" in
    MEMORY.md|governance/*|shared/*|roles/*|projects/*|archive/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

DIFF_OUTPUT=""
if ! DIFF_OUTPUT="$(git -C "$MEMORY_ROOT" diff --name-only "$BASE_REF...$HEAD_REF" 2>&1)"; then
  fail_input "git diff failed for $BASE_REF...$HEAD_REF in $MEMORY_ROOT: $DIFF_OUTPUT"
fi

CHANGED_FILES=()
while IFS= read -r changed; do
  [ -n "$changed" ] || continue
  CHANGED_FILES+=("$changed")
done <<< "$DIFF_OUTPUT"

DEFAULT_PROFILE="$(pamem_default_profile "$WORKSPACE")"
GUARDED_TARGETS=()
while IFS= read -r guarded; do
  [ -n "$guarded" ] || continue
  if ! normalized="$(normalize_target "$guarded")"; then
    add_finding "error" "MP005" "$guarded" \
      "Configured guarded_write target is invalid" \
      "The active profile guarded_write list must contain concrete memory-repo-relative paths." \
      "$guarded" \
      "fix-config"
    continue
  fi
  GUARDED_TARGETS+=("$normalized")
done < <(pamem_toml_array_values "$CONFIG_PATH" "profiles.$DEFAULT_PROFILE" "guarded_write")

for changed in "${CHANGED_FILES[@]}"; do
  case "$changed" in
    /*|*'..'*)
      add_finding "error" "MP001" "$changed" \
        "Changed path escapes memory repo" \
        "Memory PR changed paths must stay relative to the configured memory repo." \
        "$changed" \
        "remove-out-of-scope-change"
      continue
      ;;
  esac

  if ! is_memory_surface_path "$changed"; then
    add_finding "error" "MP001" "$changed" \
      "Changed file is outside memory surfaces" \
      "Memory PRs may only change MEMORY.md, governance/, shared/, roles/, projects/, or archive/." \
      "$changed" \
      "remove-out-of-scope-change"
    continue
  fi

  if is_guarded_path "$changed" && [ "$ALLOW_GUARDED" -ne 1 ]; then
    add_finding "error" "MP002" "$changed" \
      "Changed file is a guarded memory surface" \
      "Guarded surfaces require explicit config-owner or memory-executor approval and --allow-guarded." \
      "$changed" \
      "request-guarded-review"
    continue
  fi

  if ! path_matches_targets "$changed"; then
    add_finding "error" "MP003" "$changed" \
      "Changed file is outside declared targets" \
      "Memory PRs must declare the target surface they are allowed to change." \
      "targets: ${NORMALIZED_TARGETS[*]}" \
      "fix-target-or-split-pr"
  fi
done

LINT_EXIT=0
"$SCRIPT_DIR/../skills/memory-lint/scripts/memory-lint.sh" --root "$WORKSPACE" --json > "$LINT_JSON_FILE" || LINT_EXIT=$?
if [ "$LINT_EXIT" -ne 0 ]; then
  add_finding "error" "MP004" "" \
    "Memory lint failed" \
    "Memory PRs must pass pamem lint before merge." \
    "pamem lint exited $LINT_EXIT" \
    "fix-lint-findings"
fi

ERROR_COUNT="$(jq -s '[.[] | select(.severity == "error")] | length' "$FINDINGS_FILE")"
WARNING_COUNT="$(jq -s '[.[] | select(.severity == "warning")] | length' "$FINDINGS_FILE")"
INFO_COUNT="$(jq -s '[.[] | select(.severity == "info")] | length' "$FINDINGS_FILE")"
FINDINGS_JSON="$(jq -s '.' "$FINDINGS_FILE")"
CHANGED_JSON="$(printf '%s\n' "${CHANGED_FILES[@]}" | jq -R -s 'split("\n") | map(select(length > 0))')"
TARGETS_JSON="$(printf '%s\n' "${NORMALIZED_TARGETS[@]}" | jq -R -s 'split("\n") | map(select(length > 0))')"
GUARDED_TARGETS_JSON="$(printf '%s\n' "${GUARDED_TARGETS[@]}" | jq -R -s 'split("\n") | map(select(length > 0))')"
LINT_JSON="$(cat "$LINT_JSON_FILE")"

if [ "$ERROR_COUNT" -gt 0 ]; then
  STATUS="error"
else
  STATUS="ok"
fi

if [ "$JSON" -eq 1 ]; then
  jq -n \
    --arg status "$STATUS" \
    --arg workspace_root "$WORKSPACE" \
    --arg config_path "$CONFIG_PATH" \
    --arg memory_root "$MEMORY_ROOT" \
    --arg base_ref "$BASE_REF" \
    --arg head_ref "$HEAD_REF" \
    --argjson changed_files "$CHANGED_JSON" \
    --argjson targets "$TARGETS_JSON" \
    --argjson guarded_targets "$GUARDED_TARGETS_JSON" \
    --argjson allow_guarded "$ALLOW_GUARDED" \
    --argjson findings "$FINDINGS_JSON" \
    --argjson lint "$LINT_JSON" \
    --argjson error_count "$ERROR_COUNT" \
    --argjson warning_count "$WARNING_COUNT" \
    --argjson info_count "$INFO_COUNT" \
    '{
      status: $status,
      workspace_root: $workspace_root,
      config_path: $config_path,
      memory_root: $memory_root,
      diff: {
        base_ref: $base_ref,
        head_ref: $head_ref,
        changed_files: $changed_files,
        allowed_targets: $targets,
        guarded_targets: $guarded_targets,
        allow_guarded: ($allow_guarded == 1)
      },
      summary: {
        error_count: $error_count,
        warning_count: $warning_count,
        info_count: $info_count
      },
      findings: $findings,
      lint: $lint
    }'
else
  printf 'Memory PR check: %s (%s errors, %s warnings) for %s\n' "$STATUS" "$ERROR_COUNT" "$WARNING_COUNT" "$MEMORY_ROOT"
  printf 'Diff: %s...%s\n' "$BASE_REF" "$HEAD_REF"
  printf 'Allowed targets: %s\n' "${NORMALIZED_TARGETS[*]}"
  if [ "${#GUARDED_TARGETS[@]}" -gt 0 ]; then
    printf 'Active profile guarded targets: %s\n' "${GUARDED_TARGETS[*]}"
  fi
  if [ "${#CHANGED_FILES[@]}" -eq 0 ]; then
    printf 'Changed files: none\n'
  else
    printf 'Changed files:\n'
    for changed in "${CHANGED_FILES[@]}"; do
      printf '  %s\n' "$changed"
    done
  fi
  jq -rsr '.[] | "\(.severity) \(.rule) \(.path)\n  \(.title): \(.message)\n  evidence: \(.evidence)\n  action: \(.suggested_action)"' "$FINDINGS_FILE" | while IFS= read -r line; do
    printf '%s\n' "$line"
  done
fi

if [ "$ERROR_COUNT" -gt 0 ]; then
  exit 1
fi

exit 0
