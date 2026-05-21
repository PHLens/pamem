#!/usr/bin/env bash
set -euo pipefail

pamem_require_command() {
  local command="$1"
  local message="$2"

  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$message" >&2
    exit 1
  fi
}

pamem_require_jq() {
  local message="${1:-pamem requires jq; install jq and rerun.}"
  pamem_require_command jq "$message"
}

pamem_require_realpath() {
  local message="${1:-pamem requires GNU realpath; install coreutils and rerun.}"
  pamem_require_command realpath "$message"
}

pamem_toml_get_value() {
  local file="$1"
  local section="$2"
  local key="$3"

  awk -v section="[$section]" -v key="$key" '
    function trim(value) {
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      return value
    }
    BEGIN { in_section = (section == "[]") }
    {
      line = $0
      sub(/[[:space:]]*#.*/, "", line)
      line = trim(line)
      if (line ~ /^\[[^]]+\]$/) {
        in_section = (line == section)
        next
      }
      if (!in_section) {
        next
      }
      pattern = "^[[:space:]]*" key "[[:space:]]*="
      if (line ~ pattern) {
        sub(pattern, "", line)
        line = trim(line)
        if (line ~ /^".*"$/) {
          sub(/^"/, "", line)
          sub(/"$/, "", line)
        }
        print line
        exit
      }
    }
  ' "$file"
}

pamem_toml_array_values() {
  local file="$1"
  local section="$2"
  local key="$3"

  awk -v section="[$section]" -v key="$key" '
    function trim(value) {
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      return value
    }
    function emit_strings(value,    rest, match_value) {
      rest = value
      while (match(rest, /"([^"\\]|\\.)*"/)) {
        match_value = substr(rest, RSTART + 1, RLENGTH - 2)
        print match_value
        rest = substr(rest, RSTART + RLENGTH)
      }
    }
    BEGIN { in_section = (section == "[]"); in_array = 0 }
    {
      line = $0
      sub(/[[:space:]]*#.*/, "", line)
      line = trim(line)
      if (line ~ /^\[[^]]+\]$/) {
        in_section = (line == section)
        in_array = 0
        next
      }
      if (!in_section) {
        next
      }
      if (in_array) {
        emit_strings(line)
        if (line ~ /\]/) {
          in_array = 0
        }
        next
      }
      pattern = "^[[:space:]]*" key "[[:space:]]*="
      if (line ~ pattern) {
        sub(pattern, "", line)
        line = trim(line)
        emit_strings(line)
        if (line ~ /\[/ && line !~ /\]/) {
          in_array = 1
        }
      }
    }
  ' "$file"
}

pamem_workspace_config_path() {
  local workspace="$1"
  printf '%s/.pamem/config.toml' "$workspace"
}

pamem_agent_home_config_path() {
  local agent_home="$1"
  printf '%s/config.toml' "$agent_home"
}

pamem_config_path() {
  local root="$1"

  if [ -s "$(pamem_agent_home_config_path "$root")" ]; then
    pamem_agent_home_config_path "$root"
    return 0
  fi

  pamem_workspace_config_path "$root"
}

pamem_has_config() {
  local root="$1"
  [ -s "$(pamem_config_path "$root")" ]
}

pamem_is_agent_home() {
  local root="$1"
  [ -s "$(pamem_agent_home_config_path "$root")" ]
}

pamem_workspace_has_config() {
  local workspace="$1"
  pamem_has_config "$workspace"
}

pamem_installed_workspace_root() {
  local plugin_root="$1"
  local candidate

  if [ "$(basename "$plugin_root")" != ".pamem" ] || [ ! -s "$plugin_root/config.toml" ]; then
    return 0
  fi

  candidate="$(dirname "$plugin_root")"
  if [ -s "$(pamem_config_path "$candidate")" ]; then
    printf '%s' "$candidate"
  fi
}

pamem_config_value_or_default() {
  local config_path="$1"
  local section="$2"
  local key="$3"
  local default_value="$4"
  local value

  if [ ! -s "$config_path" ]; then
    printf '%s' "$default_value"
    return 0
  fi

  value="$(pamem_toml_get_value "$config_path" "$section" "$key" || true)"
  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '%s' "$default_value"
  fi
}

pamem_expand_path() {
  local base="$1"
  local raw="$2"
  local xdg_data_default='${XDG_DATA_HOME:-$HOME/.local/share}'
  local xdg_data_plain='$XDG_DATA_HOME'
  local xdg_data_braced='${XDG_DATA_HOME}'

  case "$raw" in
    "$xdg_data_default"|"$xdg_data_default"/*)
      printf '%s%s' "$(pamem_data_home)" "${raw#"$xdg_data_default"}"
      ;;
    "$xdg_data_plain"|"$xdg_data_plain"/*)
      printf '%s%s' "$(pamem_data_home)" "${raw#"$xdg_data_plain"}"
      ;;
    "$xdg_data_braced"|"$xdg_data_braced"/*)
      printf '%s%s' "$(pamem_data_home)" "${raw#"$xdg_data_braced"}"
      ;;
    "~")
      printf '%s' "$HOME"
      ;;
    "~/"*)
      printf '%s' "$HOME/${raw#~/}"
      ;;
    /*)
      printf '%s' "$raw"
      ;;
    *)
      realpath -m "$base/$raw"
      ;;
  esac
}

pamem_data_home() {
  if [ -n "${XDG_DATA_HOME:-}" ]; then
    printf '%s' "$XDG_DATA_HOME"
  else
    printf '%s/.local/share' "$HOME"
  fi
}

pamem_agent_home_path() {
  local agent_id="$1"
  pamem_expand_path "$PWD" "$(pamem_data_home)/pamem/agents/$agent_id"
}

pamem_default_memory_repo_root() {
  local workspace="$1"
  pamem_expand_path "$workspace" '${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory'
}

pamem_memory_repo_root() {
  local workspace="$1"
  local config_path
  local raw_path

  config_path="$(pamem_config_path "$workspace")"
  if [ ! -s "$config_path" ]; then
    pamem_default_memory_repo_root "$workspace"
    return 0
  fi

  raw_path="$(pamem_toml_get_value "$config_path" 'memory_repo' 'path' || true)"
  if [ -z "$raw_path" ]; then
    pamem_default_memory_repo_root "$workspace"
    return 0
  fi

  pamem_expand_path "$workspace" "$raw_path"
}

pamem_memory_repo_sharing() {
  local workspace="$1"
  local config_path

  config_path="$(pamem_config_path "$workspace")"
  pamem_config_value_or_default "$config_path" 'memory_repo' 'sharing' 'local'
}

pamem_memory_repo_entry_file() {
  local workspace="$1"
  local config_path

  config_path="$(pamem_config_path "$workspace")"
  pamem_config_value_or_default "$config_path" 'memory_repo' 'entry_file' 'MEMORY.md'
}

pamem_memory_repo_sync_remote() {
  local workspace="$1"
  local config_path

  config_path="$(pamem_config_path "$workspace")"
  pamem_config_value_or_default "$config_path" 'memory_repo.sync' 'remote' ''
}

pamem_memory_repo_ref() {
  local workspace="$1"
  local config_path

  config_path="$(pamem_config_path "$workspace")"
  pamem_config_value_or_default "$config_path" 'memory_repo.sync' 'ref' 'main'
}

pamem_memory_repo_git_author_name() {
  local workspace="$1"
  local config_path

  config_path="$(pamem_config_path "$workspace")"
  pamem_config_value_or_default "$config_path" 'memory_repo.git' 'author_name' ''
}

pamem_memory_repo_git_author_email() {
  local workspace="$1"
  local config_path

  config_path="$(pamem_config_path "$workspace")"
  pamem_config_value_or_default "$config_path" 'memory_repo.git' 'author_email' ''
}

pamem_runtime_mode() {
  local workspace="$1"
  local config_path

  config_path="$(pamem_config_path "$workspace")"
  pamem_config_value_or_default "$config_path" 'runtime' 'mode' 'cli'
}

pamem_default_profile() {
  local workspace="$1"
  local config_path

  config_path="$(pamem_config_path "$workspace")"
  pamem_config_value_or_default "$config_path" '' 'default_profile' 'onboarding'
}

pamem_agent_id() {
  local workspace="$1"
  local config_path
  local raw

  config_path="$(pamem_config_path "$workspace")"
  raw="$(pamem_config_value_or_default "$config_path" 'runtime' 'agent_id' '')"
  if [ -n "$raw" ]; then
    printf '%s' "$raw"
    return 0
  fi

  printf '%s' "$workspace" | sha256sum | awk '{print "workspace-" substr($1, 1, 16)}'
}

pamem_agent_local_dir() {
  local workspace="$1"
  local agent_id="${2:-}"

  if pamem_is_agent_home "$workspace"; then
    printf '%s' "$workspace"
    return 0
  fi

  if [ -z "$agent_id" ]; then
    agent_id="$(pamem_agent_id "$workspace")"
  fi
  pamem_agent_home_path "$agent_id"
}

pamem_agent_current_task_path() {
  local workspace="$1"
  printf '%s/current-task.md' "$(pamem_agent_local_dir "$workspace")"
}

pamem_agent_work_log_path() {
  local workspace="$1"
  printf '%s/work-log.md' "$(pamem_agent_local_dir "$workspace")"
}

pamem_workspace_current_task_path() {
  local workspace="$1"
  printf '%s/notes/current-task.md' "$workspace"
}

pamem_workspace_work_log_path() {
  local workspace="$1"
  printf '%s/notes/work-log.md' "$workspace"
}

pamem_copy_if_missing() {
  local src="$1"
  local dst="$2"

  if [ ! -s "$dst" ]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
  fi
}

pamem_copy_legacy_or_template_if_missing() {
  local legacy="$1"
  local src="$2"
  local dst="$3"

  if [ -s "$dst" ]; then
    return 0
  fi

  mkdir -p "$(dirname "$dst")"
  if [ -s "$legacy" ]; then
    cp "$legacy" "$dst"
  else
    cp "$src" "$dst"
  fi
}

pamem_render_to_file_if_missing() {
  local file="$1"
  shift

  if [ -s "$file" ]; then
    return 0
  fi

  mkdir -p "$(dirname "$file")"
  "$@" > "$file"
}

pamem_render_role_guide() {
  local template="$1"
  local role="$2"
  local title="$3"
  local workflow="$4"
  local experience="$5"

  sed \
    -e "s/{{ROLE_NAME}}/$role/g" \
    -e "s/{{ROLE_TITLE}}/$title/g" \
    -e "s/{{ROLE_WORKFLOW}}/$workflow/g" \
    -e "s/{{ROLE_EXPERIENCE}}/$experience/g" \
    "$template"
}

pamem_render_role_experience() {
  local role="$1"
  local title="$2"
  local experience="$3"

  cat <<EOF
# $title Experience

Durable role-specific $experience.

- No role-specific $role experience recorded yet.
EOF
}

pamem_ensure_memory_repo_skeleton() {
  local repo_root="$1"
  local assets_dir="$2"
  local role

  mkdir -p \
    "$repo_root/governance" \
    "$repo_root/shared" \
    "$repo_root/roles" \
    "$repo_root/projects" \
    "$repo_root/archive"

  pamem_copy_if_missing "$assets_dir/MEMORY.md.template" "$repo_root/MEMORY.md"
  pamem_copy_if_missing "$assets_dir/memory/governance/constitution.md.template" "$repo_root/governance/constitution.md"
  pamem_copy_if_missing "$assets_dir/notes/user-preferences.md.template" "$repo_root/shared/preferences.md"
  pamem_copy_if_missing "$assets_dir/notes/operating-rules.md.template" "$repo_root/shared/operating-rules.md"
  pamem_copy_if_missing "$assets_dir/memory/shared/experience.md.template" "$repo_root/shared/experience.md"

  for role in onboarding coder reviewer researcher; do
    local role_title
    local role_workflow
    local role_experience

    case "$role" in
      onboarding)
        role_title="Onboarding"
        role_workflow="onboarding workflow"
        role_experience="onboarding findings, corrections, and workflow lessons"
        ;;
      coder)
        role_title="Coder"
        role_workflow="implementation workflow"
        role_experience="implementation findings, corrections, and workflow lessons"
        ;;
      reviewer)
        role_title="Reviewer"
        role_workflow="review workflow"
        role_experience="review findings, corrections, and risk-analysis lessons"
        ;;
      researcher)
        role_title="Researcher"
        role_workflow="research, source capture, and knowledge curation workflow"
        role_experience="research findings, source curation, retrieval, and handoff lessons"
        ;;
    esac

    mkdir -p "$repo_root/roles/$role"
    pamem_render_to_file_if_missing \
      "$repo_root/roles/$role/$role.md" \
      pamem_render_role_guide \
      "$assets_dir/memory/roles/base/base.md.template" \
      "$role" \
      "$role_title" \
      "$role_workflow" \
      "$role_experience"
    pamem_render_to_file_if_missing \
      "$repo_root/roles/$role/experience.md" \
      pamem_render_role_experience \
      "$role" \
      "$role_title" \
      "$role_experience"
  done
}

pamem_ensure_memory_repo_git() {
  local repo_root="$1"

  if [ -e "$repo_root/.git" ]; then
    return 0
  fi

  pamem_require_command git "pamem install requires git to initialize the shared memory repo."

  if git init -b main "$repo_root" >/dev/null 2>&1; then
    return 0
  fi

  git -C "$repo_root" init >/dev/null
  git -C "$repo_root" symbolic-ref HEAD refs/heads/main >/dev/null 2>&1 || true
}
