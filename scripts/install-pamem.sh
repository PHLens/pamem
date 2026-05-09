#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: install-pamem.sh <root> [--agent-home]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSETS_DIR="$PLUGIN_ROOT/assets"
TARGET_INPUT="$1"
AGENT_HOME_MODE=0
if [ "$#" -eq 2 ]; then
  case "$2" in
    --agent-home)
      AGENT_HOME_MODE=1
      ;;
    *)
      echo "unknown argument: $2" >&2
      exit 2
      ;;
  esac
fi

# shellcheck source=memory-store.sh
source "$SCRIPT_DIR/memory-store.sh"

pamem_require_jq
pamem_require_realpath

mkdir -p "$TARGET_INPUT"
WORKSPACE="$(cd "$TARGET_INPUT" && pwd)"
if [ "$AGENT_HOME_MODE" -eq 1 ]; then
  CODEX_DIR="$WORKSPACE/.codex"
  CODEX_SKILLS_DIR="$CODEX_DIR/skills"
  CONFIG_PATH="$(pamem_agent_home_config_path "$WORKSPACE")"
  CURRENT_TASK_PATH="$WORKSPACE/current-task.md"
  WORK_LOG_PATH="$WORKSPACE/work-log.md"
  SESSION_CMD="$SCRIPT_DIR/memory-session-start.sh"
  mkdir -p "$CODEX_DIR"
else
  NOTES_DIR="$WORKSPACE/notes"
  CODEX_DIR="$WORKSPACE/.codex"
  CODEX_SKILLS_DIR="$CODEX_DIR/skills"
  FOUNDATION_DIR="$WORKSPACE/.pamem"
  FOUNDATION_SCRIPTS_DIR="$FOUNDATION_DIR/scripts"
  FOUNDATION_ASSETS_DIR="$FOUNDATION_DIR/assets"
  CONFIG_PATH="$FOUNDATION_DIR/config.toml"
  MEMORY_PATH="$WORKSPACE/MEMORY.md"
  CURRENT_TASK_PATH="$NOTES_DIR/current-task.md"
  WORK_LOG_PATH="$NOTES_DIR/work-log.md"
  SESSION_CMD='.pamem/scripts/memory-session-start.sh'
  mkdir -p "$NOTES_DIR" "$FOUNDATION_DIR"
fi

mkdir -p "$CODEX_DIR"

relative_link_target() {
  local src="$1"
  local dst="$2"
  realpath --relative-to="$(dirname "$dst")" "$src"
}

ensure_runtime_link() {
  local src="$1"
  local dst="$2"
  local rel_src

  rel_src="$(relative_link_target "$src" "$dst")"
  mkdir -p "$(dirname "$dst")"

  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$rel_src" ]; then
    return 0
  fi

  rm -rf "$dst"
  ln -s "$rel_src" "$dst"
}

ensure_skill_link() {
  local src="$1"
  local dst="$2"
  local rel_src

  rel_src="$(relative_link_target "$src" "$dst")"
  mkdir -p "$(dirname "$dst")"

  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$rel_src" ]; then
    return 0
  fi

  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    echo "pamem skill target exists and is not a symlink: $dst" >&2
    echo "remove or rename it, then rerun pamem install/repair" >&2
    exit 1
  fi

  rm -f "$dst"
  ln -s "$rel_src" "$dst"
}

ensure_codex_skill_links() {
  local skill_src
  local skill_name

  if [ ! -d "$PLUGIN_ROOT/skills" ]; then
    return 0
  fi

  mkdir -p "$CODEX_SKILLS_DIR"
  for skill_src in "$PLUGIN_ROOT"/skills/*; do
    [ -d "$skill_src" ] || continue
    skill_name="$(basename "$skill_src")"
    ensure_skill_link "$skill_src" "$CODEX_SKILLS_DIR/$skill_name"
  done
}

if [ "$AGENT_HOME_MODE" -ne 1 ]; then
  ensure_runtime_link "$PLUGIN_ROOT/scripts" "$FOUNDATION_SCRIPTS_DIR"
  ensure_runtime_link "$ASSETS_DIR" "$FOUNDATION_ASSETS_DIR"
fi
ensure_codex_skill_links

ensure_slock_workspace_memory() {
  local file="$1"
  local tmp_file

  if [ ! -s "$file" ]; then
    mkdir -p "$(dirname "$file")"
    cp "$ASSETS_DIR/slock/MEMORY.md.template" "$file"
    return 0
  fi

  tmp_file="$(mktemp)"
  awk '
    BEGIN { skip = 0 }
    /^##[[:space:]]+Memory Governance$/ { skip = 1; next }
    /^##[[:space:]]+Sync Trigger$/ { skip = 1; next }
    skip && /^##[[:space:]]+/ { skip = 0 }
    !skip { print }
  ' "$file" > "$tmp_file"

  if [ -s "$tmp_file" ]; then
    mv "$tmp_file" "$file"
  else
    cp "$ASSETS_DIR/slock/MEMORY.md.template" "$file"
    rm -f "$tmp_file"
  fi
}

ensure_insert_after_title() {
  local file="$1"
  local heading="$2"
  local block_file="$3"
  if grep -q "^${heading}\$" "$file"; then
    return 0
  fi
  local tmp_file
  tmp_file="$(mktemp)"
  awk -v block="$(cat "$block_file")" '
    NR == 1 { print; print ""; print block; next }
    { print }
  ' "$file" > "$tmp_file"
  mv "$tmp_file" "$file"
}

ensure_append_block() {
  local file="$1"
  local heading="$2"
  local block_file="$3"
  if grep -q "^${heading}\$" "$file"; then
    return 0
  fi
  printf '\n%s\n' "$(cat "$block_file")" >> "$file"
}

pamem_copy_if_missing "$ASSETS_DIR/config.toml.template" "$CONFIG_PATH"

RUNTIME_MODE="$(pamem_runtime_mode "$WORKSPACE")"
MEMORY_REPO_ROOT="$(pamem_memory_repo_root "$WORKSPACE")"

pamem_ensure_memory_repo_skeleton "$MEMORY_REPO_ROOT" "$ASSETS_DIR"

if [ "$AGENT_HOME_MODE" -ne 1 ]; then
  case "$RUNTIME_MODE" in
    cli)
      mkdir -p "$NOTES_DIR/projects"
      pamem_copy_if_missing "$ASSETS_DIR/notes/user-preferences.md.template" "$NOTES_DIR/user-preferences.md"
      pamem_copy_legacy_or_template_if_missing "$NOTES_DIR/agent-workflow.md" "$ASSETS_DIR/notes/operating-rules.md.template" "$NOTES_DIR/operating-rules.md"
      pamem_copy_if_missing "$ASSETS_DIR/notes/experience.md.template" "$NOTES_DIR/experience.md"
      if [ ! -s "$MEMORY_PATH" ]; then
        cp "$ASSETS_DIR/MEMORY.md.template" "$MEMORY_PATH"
      fi
      ensure_insert_after_title "$MEMORY_PATH" '## Memory Governance' "$ASSETS_DIR/memory-governance.md.fragment"
      ensure_append_block "$MEMORY_PATH" '## Sync Trigger' "$ASSETS_DIR/sync-trigger.md.fragment"
      ;;
    slock)
      ensure_slock_workspace_memory "$MEMORY_PATH"
      ;;
  esac
fi

if [ "$RUNTIME_MODE" = "cli" ] || [ "$RUNTIME_MODE" = "slock" ]; then
  pamem_copy_if_missing "$ASSETS_DIR/notes/current-task.md.template" "$CURRENT_TASK_PATH"
  pamem_copy_if_missing "$ASSETS_DIR/notes/work-log.md.template" "$WORK_LOG_PATH"
fi

ensure_json_file() {
  local file="$1"
  if [ ! -s "$file" ]; then
    printf '{}\n' > "$file"
  fi
  jq empty "$file" >/dev/null
}

merge_codex_hooks() {
  local file="$1"
  local tmp_file
  tmp_file="$(mktemp)"
  jq \
    --arg session_cmd "$SESSION_CMD" '
    def ensure_hook($event; $matcher; $hook):
      .hooks = (.hooks // {}) |
      .hooks[$event] = (
        (.hooks[$event] // [])
        | if any(.matcher == $matcher) then
            map(
              if .matcher == $matcher then
                .hooks = (
                  (.hooks // [])
                  | if any(.command == $hook.command) then . else . + [$hook] end
                )
              else . end
            )
          else
            . + [{"matcher": $matcher, "hooks": [$hook]}]
          end
      );
    ensure_hook("SessionStart"; "startup|resume"; {"type":"command","command":$session_cmd,"statusMessage":"Loading memory index"})
    ' "$file" > "$tmp_file"
  mv "$tmp_file" "$file"
}

ensure_codex_config() {
  local file="$1"
  if [ ! -s "$file" ]; then
    printf '[features]\ncodex_hooks = true\n' > "$file"
    return 0
  fi

  local tmp_file
  tmp_file="$(mktemp)"

  if grep -q '^[[:space:]]*codex_hooks[[:space:]]*=' "$file"; then
    sed -E 's/^[[:space:]]*codex_hooks[[:space:]]*=.*/codex_hooks = true/' "$file" > "$tmp_file"
    mv "$tmp_file" "$file"
    return 0
  fi

  if grep -q '^\[features\]' "$file"; then
    awk '
      BEGIN { inserted = 0 }
      /^\[features\]/ {
        print
        if (!inserted) {
          print "codex_hooks = true"
          inserted = 1
        }
        next
      }
      { print }
      END {
        if (!inserted) {
          print ""
          print "[features]"
          print "codex_hooks = true"
        }
      }
    ' "$file" > "$tmp_file"
    mv "$tmp_file" "$file"
    return 0
  fi

  cat "$file" > "$tmp_file"
  printf '\n[features]\ncodex_hooks = true\n' >> "$tmp_file"
  mv "$tmp_file" "$file"
}

CODEX_CONFIG="$CODEX_DIR/config.toml"
CODEX_HOOKS="$CODEX_DIR/hooks.json"

ensure_codex_config "$CODEX_CONFIG"

ensure_json_file "$CODEX_HOOKS"
merge_codex_hooks "$CODEX_HOOKS"

printf 'Installed Codex pamem bootstrap into %s\n' "$WORKSPACE"
