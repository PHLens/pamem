#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: install-pamem.sh <workspace>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSETS_DIR="$PLUGIN_ROOT/assets"
TARGET_INPUT="$1"

mkdir -p "$TARGET_INPUT"
WORKSPACE="$(cd "$TARGET_INPUT" && pwd)"
NOTES_DIR="$WORKSPACE/notes"
CLAUDE_DIR="$WORKSPACE/.claude"
CODEX_DIR="$WORKSPACE/.codex"
FOUNDATION_DIR="$WORKSPACE/.pamem"
FOUNDATION_SCRIPTS_DIR="$FOUNDATION_DIR/scripts"
FOUNDATION_ASSETS_DIR="$FOUNDATION_DIR/assets"
MEMORY_PATH="$WORKSPACE/MEMORY.md"

SESSION_CMD='.pamem/scripts/memory-session-start.sh'
PRECOMPACT_CMD='.pamem/scripts/memory-pre-compact.sh'

mkdir -p "$NOTES_DIR/projects" "$CLAUDE_DIR" "$CODEX_DIR" "$FOUNDATION_SCRIPTS_DIR" "$FOUNDATION_ASSETS_DIR"

cp -R "$ASSETS_DIR"/. "$FOUNDATION_ASSETS_DIR"/
cp "$PLUGIN_ROOT/scripts/memory-session-start.sh" "$FOUNDATION_SCRIPTS_DIR/memory-session-start.sh"
cp "$PLUGIN_ROOT/scripts/memory-pre-compact.sh" "$FOUNDATION_SCRIPTS_DIR/memory-pre-compact.sh"
chmod +x "$FOUNDATION_SCRIPTS_DIR/memory-session-start.sh" "$FOUNDATION_SCRIPTS_DIR/memory-pre-compact.sh"

copy_if_missing() {
  local src="$1"
  local dst="$2"
  if [ ! -s "$dst" ]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
  fi
}

copy_if_missing "$ASSETS_DIR/notes/user-preferences.md.template" "$NOTES_DIR/user-preferences.md"
copy_if_missing "$ASSETS_DIR/notes/agent-workflow.md.template" "$NOTES_DIR/agent-workflow.md"
copy_if_missing "$ASSETS_DIR/notes/corrections.md.template" "$NOTES_DIR/corrections.md"
copy_if_missing "$ASSETS_DIR/notes/current-task.md.template" "$NOTES_DIR/current-task.md"
copy_if_missing "$ASSETS_DIR/notes/work-log.md.template" "$NOTES_DIR/work-log.md"

if [ ! -s "$MEMORY_PATH" ]; then
  cp "$ASSETS_DIR/MEMORY.md.template" "$MEMORY_PATH"
fi

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

ensure_insert_after_title "$MEMORY_PATH" '## Memory Governance' "$ASSETS_DIR/memory-governance.md.fragment"
ensure_append_block "$MEMORY_PATH" '## Sync Trigger' "$ASSETS_DIR/sync-trigger.md.fragment"

ensure_json_file() {
  local file="$1"
  if [ ! -s "$file" ]; then
    printf '{}\n' > "$file"
  fi
  jq empty "$file" >/dev/null
}

claude_plugin_enabled() {
  local file="$1"
  [ -s "$file" ] || return 1
  jq -e '
    (.enabledPlugins // {})
    | to_entries
    | any((.key | startswith("pamem@")) and (.value == true))
  ' "$file" >/dev/null
}

merge_claude_settings() {
  local file="$1"
  local tmp_file
  tmp_file="$(mktemp)"
  jq \
    --arg session_cmd "$SESSION_CMD" \
    --arg precompact_cmd "$PRECOMPACT_CMD" '
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
    ensure_hook("SessionStart"; "startup|resume|clear|compact"; {"type":"command","command":$session_cmd}) |
    ensure_hook("PreCompact"; "manual|auto"; {"type":"command","command":$precompact_cmd})
    ' "$file" > "$tmp_file"
  mv "$tmp_file" "$file"
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

CLAUDE_SETTINGS="$CLAUDE_DIR/settings.json"
CODEX_CONFIG="$CODEX_DIR/config.toml"
CODEX_HOOKS="$CODEX_DIR/hooks.json"

if [ -s "$CLAUDE_SETTINGS" ] && claude_plugin_enabled "$CLAUDE_SETTINGS"; then
  :
else
  ensure_json_file "$CLAUDE_SETTINGS"
  merge_claude_settings "$CLAUDE_SETTINGS"
fi

ensure_codex_config "$CODEX_CONFIG"

ensure_json_file "$CODEX_HOOKS"
merge_codex_hooks "$CODEX_HOOKS"

printf 'Installed pamem into %s\n' "$WORKSPACE"
