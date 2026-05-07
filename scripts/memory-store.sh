#!/usr/bin/env bash
set -euo pipefail

pamem_trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
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

pamem_workspace_has_config() {
  local workspace="$1"
  [ -s "$(pamem_workspace_config_path "$workspace")" ]
}

pamem_workspace_memory_root() {
  local workspace="$1"
  printf '%s' "$workspace"
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

  case "$raw" in
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

pamem_memory_repo_root() {
  local workspace="$1"
  local config_path
  local raw_path

  config_path="$(pamem_workspace_config_path "$workspace")"
  if [ ! -s "$config_path" ]; then
    pamem_workspace_memory_root "$workspace"
    return 0
  fi

  raw_path="$(pamem_toml_get_value "$config_path" 'memory_repo' 'path' || true)"
  if [ -z "$raw_path" ]; then
    pamem_workspace_memory_root "$workspace"
    return 0
  fi

  pamem_expand_path "$workspace" "$raw_path"
}

pamem_memory_repo_sharing() {
  local workspace="$1"
  local config_path

  config_path="$(pamem_workspace_config_path "$workspace")"
  pamem_config_value_or_default "$config_path" 'memory_repo' 'sharing' 'local'
}

pamem_memory_repo_entry_file() {
  local workspace="$1"
  local config_path

  config_path="$(pamem_workspace_config_path "$workspace")"
  pamem_config_value_or_default "$config_path" 'memory_repo' 'entry_file' 'MEMORY.md'
}

pamem_memory_repo_sync_backend() {
  local workspace="$1"
  local config_path

  config_path="$(pamem_workspace_config_path "$workspace")"
  pamem_config_value_or_default "$config_path" 'memory_repo.sync' 'backend' 'local'
}

pamem_memory_repo_sync_remote() {
  local workspace="$1"
  local config_path

  config_path="$(pamem_workspace_config_path "$workspace")"
  pamem_config_value_or_default "$config_path" 'memory_repo.sync' 'remote' ''
}

pamem_memory_repo_sync_bootstrapped() {
  local workspace="$1"
  local config_path
  local value

  config_path="$(pamem_workspace_config_path "$workspace")"
  if [ ! -s "$config_path" ]; then
    printf 'false'
    return 0
  fi

  value="$(pamem_toml_get_value "$config_path" 'memory_repo.sync' 'sync_bootstrapped' || printf 'false')"
  case "$value" in
    true|false)
      printf '%s' "$value"
      ;;
    *)
      printf 'false'
      ;;
  esac
}

pamem_memory_repo_ref() {
  local workspace="$1"
  local config_path

  config_path="$(pamem_workspace_config_path "$workspace")"
  pamem_config_value_or_default "$config_path" 'memory_repo.sync' 'ref' 'main'
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

pamem_write_if_missing() {
  local dst="$1"
  local content="$2"

  if [ ! -s "$dst" ]; then
    mkdir -p "$(dirname "$dst")"
    printf '%s\n' "$content" > "$dst"
  fi
}

pamem_ensure_memory_repo_skeleton() {
  local repo_root="$1"
  local assets_dir="$2"

  mkdir -p \
    "$repo_root/L0" \
    "$repo_root/L1/shared" \
    "$repo_root/L1/roles" \
    "$repo_root/L2/active" \
    "$repo_root/L2/projects" \
    "$repo_root/L3" \
    "$repo_root/requests/inbox" \
    "$repo_root/requests/promoted" \
    "$repo_root/requests/rejected"

  pamem_copy_if_missing "$assets_dir/MEMORY.md.template" "$repo_root/MEMORY.md"
  pamem_copy_if_missing "$assets_dir/shared/L0/constitution.md.template" "$repo_root/L0/constitution.md"
  pamem_copy_if_missing "$assets_dir/notes/user-preferences.md.template" "$repo_root/L1/shared/preferences.md"
  pamem_copy_legacy_or_template_if_missing "$repo_root/L1/shared/workflow.md" "$assets_dir/notes/operating-rules.md.template" "$repo_root/L1/shared/operating-rules.md"
  pamem_copy_if_missing "$assets_dir/notes/experience.md.template" "$repo_root/L1/shared/experience.md"
  pamem_copy_if_missing "$assets_dir/shared/L1/roles/onboarding.md.template" "$repo_root/L1/roles/onboarding.md"
  pamem_copy_if_missing "$assets_dir/shared/L1/roles/coder.md.template" "$repo_root/L1/roles/coder.md"
  pamem_copy_if_missing "$assets_dir/shared/L1/roles/reviewer.md.template" "$repo_root/L1/roles/reviewer.md"
  pamem_copy_if_missing "$assets_dir/shared/L1/roles/researcher.md.template" "$repo_root/L1/roles/researcher.md"
  pamem_copy_if_missing "$assets_dir/shared/L1/roles/wiki.md.template" "$repo_root/L1/roles/wiki.md"
  pamem_copy_if_missing "$assets_dir/notes/current-task.md.template" "$repo_root/L2/active/current-tasks.md"
  pamem_copy_if_missing "$assets_dir/notes/work-log.md.template" "$repo_root/L3/work-log.md"
}
