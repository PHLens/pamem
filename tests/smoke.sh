#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for file in "$ROOT"/scripts/*.sh; do
  bash -n "$file"
done
bash -n "$ROOT/scripts/pamem"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for pamem runtime checks" >&2
  exit 1
fi

CONFIG="$ROOT/assets/config.toml.template"

jq empty "$ROOT/hooks/hooks.json" >/dev/null
if jq -e '.hooks | has("PreCompact")' "$ROOT/hooks/hooks.json" >/dev/null; then
  echo "runtime hooks must not install automatic PreCompact writes" >&2
  exit 1
fi

for pattern in \
  '^[[:space:]]*version[[:space:]]*=' \
  '^[[:space:]]*default_profile[[:space:]]*=' \
  '^\[memory_repo\]$' \
  '^[[:space:]]*path[[:space:]]*=[[:space:]]*"\$\{XDG_DATA_HOME:-\$HOME/\.local/share\}/pamem/memory"' \
  '^[[:space:]]*sharing[[:space:]]*=[[:space:]]*"shared"' \
  '^\[runtime\]$' \
  '^[[:space:]]*mode[[:space:]]*=[[:space:]]*"cli"' \
  '^[[:space:]]*agent_id[[:space:]]*=[[:space:]]*""' \
  '^\[runtime\.resume\]$' \
  '^[[:space:]]*command[[:space:]]*=[[:space:]]*\[\]' \
  '^\[memory_repo\.sync\]$' \
  '^[[:space:]]*backend[[:space:]]*=[[:space:]]*"local"' \
  '^[[:space:]]*sync_bootstrapped[[:space:]]*=[[:space:]]*false' \
  '^\[governance\]$' \
  '^\[sync\]$'
do
  if ! grep -Eq "$pattern" "$CONFIG"; then
    echo "missing config pattern: $pattern" >&2
    exit 1
  fi
done

if grep -Eq '^[[:space:]]*queue_root[[:space:]]*=[[:space:]]*"~' "$CONFIG"; then
  echo "sync.queue_root must not be hardcoded to a home-directory path" >&2
  exit 1
fi

if grep -Eq '^[[:space:]]*executor[[:space:]]*=[[:space:]]*"Adam"' "$CONFIG"; then
  echo "sync.executor must not be hardcoded to Adam" >&2
  exit 1
fi

if grep -Eq '^\[profiles\.(coder|reviewer|researcher|wiki)\]$' "$CONFIG"; then
  echo "base config template should only ship the onboarding profile" >&2
  exit 1
fi

base_load_block="$(awk -v profile="onboarding" '
  BEGIN { in_profile = 0; in_load = 0 }
  $0 == "[profiles." profile "]" {
    in_profile = 1
    next
  }
  in_profile && /^[[:space:]]*load[[:space:]]*=[[:space:]]*\[/ {
    in_load = 1
    next
  }
  in_load {
    if ($0 ~ /^[[:space:]]*\]/) {
      exit
    }
    print
  }
' "$CONFIG")"
printf '%s\n' "$base_load_block" | grep -Eq '"L1/roles/onboarding/index\.md"'
if printf '%s\n' "$base_load_block" | grep -Eq '"L1/roles/onboarding/experience\.md"'; then
  echo "base config load must route through role index instead of role experience" >&2
  exit 1
fi

for profile in coder reviewer researcher wiki; do
  profile_template="$ROOT/assets/config-profiles/${profile}.toml.template"
  test -s "$profile_template"
  grep -Eq "^[[:space:]]*default_profile[[:space:]]*=[[:space:]]*\"${profile}\"" "$profile_template"
  grep -Eq '^[[:space:]]*mode[[:space:]]*=[[:space:]]*"cli"' "$profile_template"
  grep -Eq '^[[:space:]]*agent_id[[:space:]]*=[[:space:]]*""' "$profile_template"
  grep -Eq '^\[runtime\.resume\]$' "$profile_template"
  grep -Eq '^[[:space:]]*command[[:space:]]*=[[:space:]]*\[\]' "$profile_template"
  grep -Eq '^[[:space:]]*path[[:space:]]*=[[:space:]]*"\$\{XDG_DATA_HOME:-\$HOME/\.local/share\}/pamem/memory"' "$profile_template"
  grep -Eq "^\[profiles\.${profile}\]$" "$profile_template"
  load_block="$(awk -v profile="$profile" '
    BEGIN { in_profile = 0; in_load = 0 }
    $0 == "[profiles." profile "]" {
      in_profile = 1
      next
    }
    in_profile && /^[[:space:]]*load[[:space:]]*=[[:space:]]*\[/ {
      in_load = 1
      next
    }
    in_load {
      if ($0 ~ /^[[:space:]]*\]/) {
        exit
      }
      print
    }
  ' "$profile_template")"
  printf '%s\n' "$load_block" | grep -Eq "\"L1/roles/${profile}/index\\.md\""
  if printf '%s\n' "$load_block" | grep -Eq "\"L1/roles/${profile}/experience\\.md\""; then
    echo "profile load must route through role index instead of role experience: $profile_template" >&2
    exit 1
  fi
  if grep -Eq 'L2/active|L3/work-log|current-tasks' "$profile_template"; then
    echo "profile template must not use shared active/work-log paths: $profile_template" >&2
    exit 1
  fi
  write_block="$(awk -v key="write" '
    $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      in_array = 1
      print
      if ($0 ~ /\]/) {
        exit
      }
      next
    }
    in_array {
      print
      if ($0 ~ /\]/) {
        exit
      }
    }
  ' "$profile_template")"
  guarded_block="$(awk -v key="guarded_write" '
    $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      in_array = 1
      print
      if ($0 ~ /\]/) {
        exit
      }
      next
    }
    in_array {
      print
      if ($0 ~ /\]/) {
        exit
      }
    }
  ' "$profile_template")"
  printf '%s\n' "$write_block" | grep -Eq '"requests/inbox/"'
  grep -Eq '^[[:space:]]*guarded_write[[:space:]]*=[[:space:]]*\[\]' "$profile_template"
  if printf '%s\n%s\n' "$write_block" "$guarded_block" | grep -Eq '"L[0-3]/'; then
    echo "ordinary profile write policy must stay limited to promotion requests: $profile_template" >&2
    exit 1
  fi
done

for file in \
  "$ROOT/agents/sync-executor.md" \
  "$ROOT/assets/MEMORY.md.template" \
  "$ROOT/assets/memory-governance.md.fragment" \
  "$ROOT/assets/sync-trigger.md.fragment" \
  "$ROOT/assets/notes/operating-rules.md.template" \
  "$ROOT/assets/notes/current-task.md.template" \
  "$ROOT/assets/notes/work-log.md.template" \
  "$ROOT/assets/slock/MEMORY.md.template" \
  "$ROOT/assets/shared/L0/constitution.md.template" \
  "$ROOT/assets/shared/L1/shared/experience.md.template" \
  "$ROOT/assets/shared/L1/roles/onboarding/index.md.template" \
  "$ROOT/assets/shared/L1/roles/onboarding/experience.md.template" \
  "$ROOT/assets/shared/L1/roles/coder/index.md.template" \
  "$ROOT/assets/shared/L1/roles/coder/experience.md.template" \
  "$ROOT/assets/shared/L1/roles/reviewer/index.md.template" \
  "$ROOT/assets/shared/L1/roles/reviewer/experience.md.template" \
  "$ROOT/assets/shared/L1/roles/researcher/index.md.template" \
  "$ROOT/assets/shared/L1/roles/researcher/experience.md.template" \
  "$ROOT/assets/shared/L1/roles/wiki/index.md.template" \
  "$ROOT/assets/shared/L1/roles/wiki/experience.md.template" \
  "$ROOT/assets/config-profiles/coder.toml.template" \
  "$ROOT/assets/config-profiles/reviewer.toml.template" \
  "$ROOT/assets/config-profiles/researcher.toml.template" \
  "$ROOT/assets/config-profiles/wiki.toml.template" \
  "$ROOT/hooks/hooks.json" \
  "$ROOT/scripts/pamem" \
  "$ROOT/scripts/onboard-pamem.sh" \
  "$ROOT/scripts/pamem-cli.sh" \
  "$ROOT/scripts/memory-sync.sh"
do
  test -s "$file"
done

if grep -RIn -E 'otherwise follow these rules directly|otherwise ask the assigned sync executor|helper skills when the runtime exposes|If the runtime exposes a `sync-request` helper' \
  "$ROOT/assets/MEMORY.md.template" \
  "$ROOT/assets/memory-governance.md.fragment" \
  "$ROOT/assets/sync-trigger.md.fragment" \
  "$ROOT/DESIGN.md" \
  "$ROOT/SYNC.md" \
  "$ROOT/scripts/memory-session-start.sh"; then
  echo "runtime-loaded pamem text must treat missing helper skills as install/repair failures" >&2
  exit 1
fi

for required_helper in memory-rule sync-request memory-lint; do
  if ! grep -RIn "$required_helper" \
    "$ROOT/assets/MEMORY.md.template" \
    "$ROOT/assets/memory-governance.md.fragment" \
    "$ROOT/assets/sync-trigger.md.fragment" \
    "$ROOT/DESIGN.md" \
    "$ROOT/INSTALL.md" >/dev/null; then
    echo "runtime text must mention packaged pamem helper skill: $required_helper" >&2
    exit 1
  fi
done

MEMORY_LINT="$ROOT/skills/memory-lint/scripts/memory-lint.sh"

if [ ! -x "$MEMORY_LINT" ]; then
  echo "memory-lint.sh must be executable" >&2
  exit 1
fi

if [ ! -x "$ROOT/scripts/onboard-pamem.sh" ]; then
  echo "onboard-pamem.sh must be executable" >&2
  exit 1
fi

if [ ! -x "$ROOT/scripts/pamem" ]; then
  echo "pamem CLI must be executable" >&2
  exit 1
fi

if [ ! -x "$ROOT/scripts/pamem-cli.sh" ]; then
  echo "pamem-cli.sh must be executable" >&2
  exit 1
fi

if [ ! -x "$ROOT/scripts/memory-sync.sh" ]; then
  echo "memory-sync.sh must be executable" >&2
  exit 1
fi

if grep -RIn --exclude-dir=.git --exclude-dir=tests -E '~/sync-queue|for Adam|Adam is the sync executor|agent-sync' "$ROOT"; then
  echo "stale sync executor or queue wording found" >&2
  exit 1
fi

if grep -RIn --exclude-dir=.git --exclude-dir=tests -E 'L2/active|L3/work-log|current-tasks' "$ROOT"; then
  echo "stale shared active/work-log wording found" >&2
  exit 1
fi

WORKSPACE="$(mktemp -d)"
SHARED_XDG_DATA_ROOT="$(mktemp -d)"
ONBOARD_WORKSPACE="$(mktemp -d)"
ONBOARD_XDG_DATA_ROOT="$(mktemp -d)"
WIKI_WORKSPACE="$(mktemp -d)"
LEGACY_WORKSPACE="$(mktemp -d)"
SLOCK_WORKSPACE="$(mktemp -d)"
SLOCK_EMPTY_WORKSPACE="$(mktemp -d)"
SLOCK_XDG_DATA_ROOT="$(mktemp -d)"
INVALID_RUNTIME_WORKSPACE="$(mktemp -d)"
REMOVE_WORKSPACE="$(mktemp -d)"
cleanup() {
  rm -rf "$WORKSPACE" "$SHARED_XDG_DATA_ROOT" "$ONBOARD_WORKSPACE" "$ONBOARD_XDG_DATA_ROOT" "$WIKI_WORKSPACE" "$LEGACY_WORKSPACE" "$SLOCK_WORKSPACE" "$SLOCK_EMPTY_WORKSPACE" "$SLOCK_XDG_DATA_ROOT" "$INVALID_RUNTIME_WORKSPACE" "$REMOVE_WORKSPACE"
}
trap cleanup EXIT

XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/install-pamem.sh" "$WORKSPACE" >/dev/null
DEFAULT_MEMORY_REPO="$SHARED_XDG_DATA_ROOT/pamem/memory"

for skill in memory-rule sync-request memory-lint; do
  test -L "$WORKSPACE/.codex/skills/$skill"
  if [ "$(readlink -f "$WORKSPACE/.codex/skills/$skill")" != "$ROOT/skills/$skill" ]; then
    echo "Codex bootstrap skill link does not resolve to packaged skill: $skill" >&2
    exit 1
  fi
done

XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/install-pamem.sh" "$REMOVE_WORKSPACE" >/dev/null
for skill in memory-rule sync-request memory-lint; do
  test -L "$REMOVE_WORKSPACE/.codex/skills/$skill"
done
bash "$ROOT/scripts/remove-pamem.sh" "$REMOVE_WORKSPACE" >/dev/null
for skill in memory-rule sync-request memory-lint; do
  if [ -e "$REMOVE_WORKSPACE/.codex/skills/$skill" ]; then
    echo "remove-pamem.sh must remove managed Codex skill link: $skill" >&2
    exit 1
  fi
done

mkdir -p "$LEGACY_WORKSPACE/notes" "$LEGACY_WORKSPACE/.pamem/memory/L1/shared"
printf '# Legacy Agent Workflow\n\n- legacy workspace operating rule\n' > "$LEGACY_WORKSPACE/notes/agent-workflow.md"
printf '# Legacy Shared Workflow\n\n- legacy shared operating rule\n' > "$LEGACY_WORKSPACE/.pamem/memory/L1/shared/workflow.md"
mkdir -p "$LEGACY_WORKSPACE/.pamem"
sed 's#path = "${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory"#path = ".pamem/memory"#' "$ROOT/assets/config.toml.template" > "$LEGACY_WORKSPACE/.pamem/config.toml"
bash "$ROOT/scripts/install-pamem.sh" "$LEGACY_WORKSPACE" >/dev/null
grep -Fq 'legacy workspace operating rule' "$LEGACY_WORKSPACE/notes/operating-rules.md"
grep -Fq 'legacy shared operating rule' "$LEGACY_WORKSPACE/.pamem/memory/L1/shared/operating-rules.md"

for file in \
  "$WORKSPACE/.pamem/config.toml" \
  "$DEFAULT_MEMORY_REPO/MEMORY.md" \
  "$DEFAULT_MEMORY_REPO/L0/constitution.md" \
  "$DEFAULT_MEMORY_REPO/L1/shared/preferences.md" \
  "$DEFAULT_MEMORY_REPO/L1/shared/operating-rules.md" \
  "$DEFAULT_MEMORY_REPO/L1/shared/experience.md" \
  "$DEFAULT_MEMORY_REPO/L1/roles/onboarding/index.md" \
  "$DEFAULT_MEMORY_REPO/L1/roles/onboarding/experience.md" \
  "$DEFAULT_MEMORY_REPO/L1/roles/coder/index.md" \
  "$DEFAULT_MEMORY_REPO/L1/roles/reviewer/index.md" \
  "$DEFAULT_MEMORY_REPO/L1/roles/researcher/index.md" \
  "$DEFAULT_MEMORY_REPO/L1/roles/wiki/index.md" \
  "$DEFAULT_MEMORY_REPO/L1/roles/wiki/experience.md" \
  "$WORKSPACE/MEMORY.md" \
  "$WORKSPACE/notes/operating-rules.md" \
  "$WORKSPACE/notes/current-task.md" \
  "$WORKSPACE/notes/work-log.md"
do
  test -s "$file"
done

if jq -e '.hooks | has("PreCompact")' "$WORKSPACE/.codex/hooks.json" >/dev/null; then
  echo "Codex bootstrap must not install a PreCompact hook" >&2
  exit 1
fi

test -d "$DEFAULT_MEMORY_REPO/L2/projects"
test ! -e "$DEFAULT_MEMORY_REPO/L2/active"
test ! -e "$DEFAULT_MEMORY_REPO/L3/work-log.md"
test ! -e "$DEFAULT_MEMORY_REPO/L1/agents"
test ! -e "$DEFAULT_MEMORY_REPO/L1/roles/common"
test ! -e "$DEFAULT_MEMORY_REPO/L1/roles/onboarding.md"

if [ -e "$DEFAULT_MEMORY_REPO/L1/shared/workflow.md" ] || [ -e "$WORKSPACE/notes/agent-workflow.md" ]; then
  echo "legacy shared workflow file names should not be generated" >&2
  exit 1
fi

MEMORY_LINT_OUTPUT="$(XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$MEMORY_LINT" --root "$WORKSPACE" --json)"
printf '%s' "$MEMORY_LINT_OUTPUT" | jq -e '
  .status == "ok" and
  .config_scope == "workspace-local" and
  .summary.error_count == 0 and
  .config.default_profile == "onboarding" and
  .config.runtime_mode == "cli" and
  (.memory_root | endswith("/pamem/memory"))
' >/dev/null

cp -a "$WORKSPACE/." "$INVALID_RUNTIME_WORKSPACE/"
sed -i 's/mode = "cli"/mode = "invalid"/' "$INVALID_RUNTIME_WORKSPACE/.pamem/config.toml"
if XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$MEMORY_LINT" --root "$INVALID_RUNTIME_WORKSPACE" --json >/dev/null 2>&1; then
  echo "memory-lint must fail when runtime.mode is invalid" >&2
  exit 1
fi

mkdir -p "$DEFAULT_MEMORY_REPO/.pamem"
cp "$WORKSPACE/.pamem/config.toml" "$DEFAULT_MEMORY_REPO/.pamem/config.toml"
if XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$MEMORY_LINT" --root "$WORKSPACE" --json >/dev/null 2>&1; then
  echo "memory-lint must fail when the memory repo contains .pamem/config.toml" >&2
  exit 1
fi
rm -rf "$DEFAULT_MEMORY_REPO/.pamem"

SESSION_OUTPUT="$(printf '{"cwd":"%s"}\n' "$WORKSPACE" | XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/memory-session-start.sh")"
printf '%s' "$SESSION_OUTPUT" | jq -e '
  .hookSpecificOutput.hookEventName == "SessionStart" and
  (.hookSpecificOutput.additionalContext | contains("Persistent memory source:") and contains("Runtime anchor:") and contains("runtime=cli") and contains("/pamem/memory"))
' >/dev/null

rm -f "$DEFAULT_MEMORY_REPO/MEMORY.md"
MISSING_SESSION_OUTPUT="$(printf '{"cwd":"%s"}\n' "$WORKSPACE" | XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/memory-session-start.sh")"
test ! -e "$DEFAULT_MEMORY_REPO/MEMORY.md"
printf '%s' "$MISSING_SESSION_OUTPUT" | jq -e '
  .hookSpecificOutput.hookEventName == "SessionStart" and
  (.hookSpecificOutput.additionalContext | contains("Warning: configured memory entry file is missing or empty")) and
  (.hookSpecificOutput.additionalContext | contains("Load and follow this persistent memory index") | not)
' >/dev/null

rm -f "$WORKSPACE/notes/current-task.md"
XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem-cli.sh" start --workspace "$WORKSPACE" --agent-id smoke-agent --print-env > "$WORKSPACE/pamem-cli-start.out"
grep -Fq "agent_id=smoke-agent" "$WORKSPACE/pamem-cli-start.out"
grep -Fq "PAMEM_CURRENT_TASK=" "$WORKSPACE/pamem-cli-start.out"
test -s "$SHARED_XDG_DATA_ROOT/pamem/agents/smoke-agent/current-task.md"
test -s "$SHARED_XDG_DATA_ROOT/pamem/agents/smoke-agent/work-log.md"
test ! -e "$WORKSPACE/notes/current-task.md"

CLI_HOOK_INPUT="$(XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem-cli.sh" hook-json --workspace "$WORKSPACE" --agent-id smoke-agent)"
printf '%s' "$CLI_HOOK_INPUT" | jq -e \
  --arg workspace "$WORKSPACE" \
  --arg current_task "$SHARED_XDG_DATA_ROOT/pamem/agents/smoke-agent/current-task.md" \
  '.cwd == $workspace and .pamem.agent_id == "smoke-agent" and .pamem.current_task == $current_task' >/dev/null

CLI_STATE_SESSION_OUTPUT="$(printf '%s\n' "$CLI_HOOK_INPUT" | XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/memory-session-start.sh")"
printf '%s' "$CLI_STATE_SESSION_OUTPUT" | jq -e '
  .hookSpecificOutput.hookEventName == "SessionStart" and
  (.hookSpecificOutput.additionalContext | contains("CLI runtime current task source:") and contains("smoke-agent/current-task.md"))
' >/dev/null

CLI_CONTEXT_OUTPUT="$(XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem-cli.sh" context --workspace "$WORKSPACE" --agent-id smoke-agent)"
grep -Fq "Persistent memory source:" <<< "$CLI_CONTEXT_OUTPUT"
grep -Fq "CLI runtime current task source:" <<< "$CLI_CONTEXT_OUTPUT"

printf '%s\n' "$CLI_HOOK_INPUT" | XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/memory-pre-compact.sh" 2>/dev/null
test -s "$SHARED_XDG_DATA_ROOT/pamem/agents/smoke-agent/current-task.md"
test ! -e "$WORKSPACE/notes/current-task.md"

if XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem-cli.sh" resume --workspace "$WORKSPACE" --agent-id no-session-agent >/dev/null 2>&1; then
  echo "pamem resume must fail before a launcher is recorded or configured" >&2
  exit 1
fi

RESUME_TEST_COMMAND='test "$PWD" = "$PAMEM_WORKSPACE" && test -s "$PAMEM_CURRENT_TASK" && if [ "$PAMEM_RESUME" = 1 ]; then printf resume > "$PAMEM_LOCAL_DIR/resume-marker"; else printf start > "$PAMEM_LOCAL_DIR/start-marker"; fi'
XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem-cli.sh" start --workspace "$WORKSPACE" --agent-id smoke-agent -- sh -c "$RESUME_TEST_COMMAND"
test -s "$SHARED_XDG_DATA_ROOT/pamem/agents/smoke-agent/session.json"
test -s "$SHARED_XDG_DATA_ROOT/pamem/agents/smoke-agent/start-marker"
XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem-cli.sh" resume --workspace "$WORKSPACE" --agent-id smoke-agent
test -s "$SHARED_XDG_DATA_ROOT/pamem/agents/smoke-agent/resume-marker"

LOCAL_SYNC_OUTPUT="$(XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/memory-sync.sh" --root "$WORKSPACE" --dry-run)"
if [[ "$LOCAL_SYNC_OUTPUT" != local-only:* ]]; then
  echo "local sync output did not start with the expected status" >&2
  exit 1
fi

GIT_SYNC_OUTPUT="$(XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/memory-sync.sh" --root "$WORKSPACE" --backend git --remote origin --dry-run)"
if [[ "$GIT_SYNC_OUTPUT" != git\ -C\ * ]]; then
  echo "git sync dry-run output did not start with the expected command" >&2
  exit 1
fi

if XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/memory-sync.sh" --root "$WORKSPACE" --backend webdav --remote example:Memory --dry-run >/dev/null 2>&1; then
  echo "webdav dry-run must require --resync until sync_bootstrapped=true" >&2
  exit 1
fi

WEBDAV_SYNC_OUTPUT="$(XDG_DATA_HOME="$SHARED_XDG_DATA_ROOT" bash "$ROOT/scripts/memory-sync.sh" --root "$WORKSPACE" --backend webdav --remote example:Memory --resync --dry-run)"
if [[ "$WEBDAV_SYNC_OUTPUT" != rclone\ bisync\ * ]]; then
  echo "webdav sync dry-run output did not start with the expected command" >&2
  exit 1
fi

bash "$ROOT/scripts/onboard-pamem.sh" "$ONBOARD_WORKSPACE" \
  --profile reviewer \
  --agent-id reviewer-agent \
  --memory-repo ".pamem/reviewer-memory" \
  --sync-backend webdav \
  --sync-remote "example:Memory" \
  --sync-ref "main" \
  --sync-executor "sync-executor" >/dev/null

grep -Fq 'default_profile = "reviewer"' "$ONBOARD_WORKSPACE/.pamem/config.toml"
grep -Fq 'agent_id = "reviewer-agent"' "$ONBOARD_WORKSPACE/.pamem/config.toml"
grep -Fq 'path = ".pamem/reviewer-memory"' "$ONBOARD_WORKSPACE/.pamem/config.toml"
grep -Fq 'backend = "webdav"' "$ONBOARD_WORKSPACE/.pamem/config.toml"
grep -Fq 'remote = "example:Memory"' "$ONBOARD_WORKSPACE/.pamem/config.toml"
grep -Fq 'executor = "sync-executor"' "$ONBOARD_WORKSPACE/.pamem/config.toml"
test -s "$ONBOARD_WORKSPACE/.pamem/reviewer-memory/MEMORY.md"
test -s "$ONBOARD_WORKSPACE/.pamem/reviewer-memory/L1/shared/experience.md"
test -s "$ONBOARD_WORKSPACE/.pamem/reviewer-memory/L1/roles/reviewer/experience.md"

XDG_DATA_HOME="$ONBOARD_XDG_DATA_ROOT" bash "$ROOT/scripts/onboard-pamem.sh" "$ONBOARD_WORKSPACE/shared-a" \
  --profile coder >/dev/null
XDG_DATA_HOME="$ONBOARD_XDG_DATA_ROOT" bash "$ROOT/scripts/onboard-pamem.sh" "$ONBOARD_WORKSPACE/shared-b" \
  --profile reviewer >/dev/null
XDG_DATA_HOME="$ONBOARD_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem" init \
  --profile wiki \
  --agent-id wiki-agent >/dev/null
WIKI_AGENT_HOME="$ONBOARD_XDG_DATA_ROOT/pamem/agents/wiki-agent"

grep -Fq 'path = "${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory"' "$ONBOARD_WORKSPACE/shared-a/.pamem/config.toml"
grep -Fq 'path = "${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory"' "$ONBOARD_WORKSPACE/shared-b/.pamem/config.toml"
grep -Fq 'path = "${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory"' "$WIKI_AGENT_HOME/config.toml"
grep -Fq 'agent_id = "wiki-agent"' "$WIKI_AGENT_HOME/config.toml"
test -s "$ONBOARD_XDG_DATA_ROOT/pamem/memory/MEMORY.md"
test -s "$ONBOARD_XDG_DATA_ROOT/pamem/memory/L1/shared/experience.md"
test -s "$ONBOARD_XDG_DATA_ROOT/pamem/memory/L1/roles/coder/experience.md"
test -s "$ONBOARD_XDG_DATA_ROOT/pamem/memory/L1/roles/reviewer/experience.md"
test -s "$ONBOARD_XDG_DATA_ROOT/pamem/memory/L1/roles/wiki/experience.md"
test -s "$WIKI_AGENT_HOME/current-task.md"
test -s "$WIKI_AGENT_HOME/work-log.md"
test ! -e "$WIKI_AGENT_HOME/.pamem"
test ! -e "$WIKI_AGENT_HOME/scripts"
test ! -e "$WIKI_AGENT_HOME/assets"
for skill in memory-rule sync-request memory-lint; do
  test -L "$WIKI_AGENT_HOME/.codex/skills/$skill"
  if [ "$(readlink -f "$WIKI_AGENT_HOME/.codex/skills/$skill")" != "$ROOT/skills/$skill" ]; then
    echo "agent-home Codex skill link does not resolve to packaged skill: $skill" >&2
    exit 1
  fi
done

SHARED_A_STATUS="$(XDG_DATA_HOME="$ONBOARD_XDG_DATA_ROOT" bash "$ONBOARD_WORKSPACE/shared-a/.pamem/scripts/pamem-cli.sh" status)"
printf '%s' "$SHARED_A_STATUS" | grep -Fq "root=$ONBOARD_WORKSPACE/shared-a"
printf '%s' "$SHARED_A_STATUS" | grep -Fq "memory_repo=$ONBOARD_XDG_DATA_ROOT/pamem/memory"
GLOBAL_C_START="$(XDG_DATA_HOME="$ONBOARD_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem" start --agent-id wiki-agent --print-env)"
printf '%s' "$GLOBAL_C_START" | grep -Fq "root=$WIKI_AGENT_HOME"
printf '%s' "$GLOBAL_C_START" | grep -Fq "agent_id=wiki-agent"
printf '%s' "$GLOBAL_C_START" | grep -Fq "memory_repo=$ONBOARD_XDG_DATA_ROOT/pamem/memory"
printf '%s' "$GLOBAL_C_START" | grep -Fq "current_task=$WIKI_AGENT_HOME/current-task.md"
printf '%s' "$GLOBAL_C_START" | grep -Fq "PAMEM_CURRENT_TASK="
GLOBAL_C_CONTEXT="$(XDG_DATA_HOME="$ONBOARD_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem" context --agent-id wiki-agent)"
grep -Fq "Persistent memory source:" <<< "$GLOBAL_C_CONTEXT"
grep -Fq "Shared Experience" <<< "$GLOBAL_C_CONTEXT"
grep -Fq "Wiki Index" <<< "$GLOBAL_C_CONTEXT"
grep -Fq "CLI runtime current task source: \`$WIKI_AGENT_HOME/current-task.md\`" <<< "$GLOBAL_C_CONTEXT"
SHARED_C_LINT="$(XDG_DATA_HOME="$ONBOARD_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem" lint --agent-id wiki-agent --json)"
printf '%s' "$SHARED_C_LINT" | jq -e '.status == "ok" and .config.default_profile == "wiki" and .config_scope == "agent-local"' >/dev/null
SHARED_C_SYNC="$(XDG_DATA_HOME="$ONBOARD_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem" sync --agent-id wiki-agent --dry-run)"
if [[ "$SHARED_C_SYNC" != local-only:* ]]; then
  echo "pamem sync dry-run did not use the inferred agent home" >&2
  exit 1
fi

bash "$ROOT/scripts/onboard-pamem.sh" "$WIKI_WORKSPACE" \
  --profile wiki \
  --memory-repo ".pamem/wiki-memory" >/dev/null

grep -Fq 'default_profile = "wiki"' "$WIKI_WORKSPACE/.pamem/config.toml"
grep -Fq 'path = ".pamem/wiki-memory"' "$WIKI_WORKSPACE/.pamem/config.toml"
test -s "$WIKI_WORKSPACE/.pamem/wiki-memory/MEMORY.md"
test -s "$WIKI_WORKSPACE/.pamem/wiki-memory/L1/shared/experience.md"
test -s "$WIKI_WORKSPACE/.pamem/wiki-memory/L1/roles/wiki/experience.md"

cat > "$SLOCK_WORKSPACE/MEMORY.md" <<'EOF'
# Existing Slock Agent

## Memory Governance
old workspace governance block

## Role
coder

## Sync Trigger
old workspace sync block

## Key Knowledge
- existing workspace note
EOF

XDG_DATA_HOME="$SLOCK_XDG_DATA_ROOT" bash "$ROOT/scripts/onboard-pamem.sh" "$SLOCK_WORKSPACE" \
  --profile coder \
  --runtime slock >/dev/null

grep -Fq 'default_profile = "coder"' "$SLOCK_WORKSPACE/.pamem/config.toml"
grep -Fq 'mode = "slock"' "$SLOCK_WORKSPACE/.pamem/config.toml"
grep -Fq 'path = "${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory"' "$SLOCK_WORKSPACE/.pamem/config.toml"
test -s "$SLOCK_XDG_DATA_ROOT/pamem/memory/MEMORY.md"
test ! -e "$SLOCK_WORKSPACE/.pamem/memory/MEMORY.md"
test -s "$SLOCK_WORKSPACE/notes/current-task.md"
test -s "$SLOCK_WORKSPACE/notes/work-log.md"
test -s "$SLOCK_WORKSPACE/MEMORY.md"
grep -Fq '# Existing Slock Agent' "$SLOCK_WORKSPACE/MEMORY.md"
grep -Fq 'existing workspace note' "$SLOCK_WORKSPACE/MEMORY.md"
if grep -Eq '^## (Memory Governance|Sync Trigger)$|old workspace governance block|old workspace sync block' "$SLOCK_WORKSPACE/MEMORY.md"; then
  echo "Slock workspace MEMORY.md must stay a thin router without governance/sync fragments" >&2
  exit 1
fi

test ! -e "$SLOCK_WORKSPACE/notes/user-preferences.md"
test ! -e "$SLOCK_WORKSPACE/notes/operating-rules.md"
test ! -e "$SLOCK_WORKSPACE/notes/experience.md"
test ! -e "$SLOCK_WORKSPACE/notes/projects"

XDG_DATA_HOME="$SLOCK_XDG_DATA_ROOT" bash "$ROOT/scripts/onboard-pamem.sh" "$SLOCK_EMPTY_WORKSPACE" \
  --profile reviewer \
  --runtime slock >/dev/null
grep -Fq '# Workspace Memory Router' "$SLOCK_EMPTY_WORKSPACE/MEMORY.md"
if grep -Eq '^## (Memory Governance|Sync Trigger)$' "$SLOCK_EMPTY_WORKSPACE/MEMORY.md"; then
  echo "new Slock workspace MEMORY.md must not include governance/sync fragments" >&2
  exit 1
fi

SLOCK_SESSION_OUTPUT="$(printf '{"cwd":"%s"}\n' "$SLOCK_WORKSPACE" | XDG_DATA_HOME="$SLOCK_XDG_DATA_ROOT" bash "$ROOT/scripts/memory-session-start.sh")"
printf '%s' "$SLOCK_SESSION_OUTPUT" | jq -e '
  .hookSpecificOutput.hookEventName == "SessionStart" and
  (.hookSpecificOutput.additionalContext | contains("Persistent memory source:") and contains("Runtime anchor:") and contains("runtime=slock") and contains("/pamem/memory") and contains("Loaded profile memory for `coder`:") and contains("Shared Experience") and contains("Coder Index") and contains("Slock runtime current task source:") and contains("Slock runtime work log source:"))
' >/dev/null

rm -f "$SLOCK_WORKSPACE/notes/current-task.md"
printf '{"cwd":"%s","trigger":"manual"}\n' "$SLOCK_WORKSPACE" | XDG_DATA_HOME="$SLOCK_XDG_DATA_ROOT" bash "$ROOT/scripts/memory-pre-compact.sh" 2>/dev/null
test -s "$SLOCK_WORKSPACE/notes/current-task.md"

SLOCK_LINT_OUTPUT="$(XDG_DATA_HOME="$SLOCK_XDG_DATA_ROOT" bash "$MEMORY_LINT" --root "$SLOCK_WORKSPACE" --json)"
printf '%s' "$SLOCK_LINT_OUTPUT" | jq -e '
  .status == "ok" and
  .config.runtime_mode == "slock" and
  .summary.error_count == 0
' >/dev/null

SLOCK_CLI_STATUS="$(XDG_DATA_HOME="$SLOCK_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem-cli.sh" status --workspace "$SLOCK_WORKSPACE")"
grep -Fq 'runtime=slock' <<<"$SLOCK_CLI_STATUS"
grep -Fq 'task_state=slock' <<<"$SLOCK_CLI_STATUS"
grep -Fq "current_task=$SLOCK_WORKSPACE/notes/current-task.md" <<<"$SLOCK_CLI_STATUS"
grep -Fq "work_log=$SLOCK_WORKSPACE/notes/work-log.md" <<<"$SLOCK_CLI_STATUS"

SLOCK_CLI_HOOK_JSON="$(XDG_DATA_HOME="$SLOCK_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem-cli.sh" hook-json --workspace "$SLOCK_WORKSPACE")"
printf '%s' "$SLOCK_CLI_HOOK_JSON" | jq -e \
  --arg current_task "$SLOCK_WORKSPACE/notes/current-task.md" \
  --arg work_log "$SLOCK_WORKSPACE/notes/work-log.md" \
  '
  .pamem.runtime == "slock" and
  .pamem.task_state == "slock" and
  .pamem.current_task == $current_task and
  .pamem.work_log == $work_log
' >/dev/null

if XDG_DATA_HOME="$SLOCK_XDG_DATA_ROOT" bash "$ROOT/scripts/pamem-cli.sh" start --workspace "$SLOCK_WORKSPACE" >/dev/null 2>&1; then
  echo "pamem-cli start must reject slock runtime" >&2
  exit 1
fi

if bash "$ROOT/scripts/onboard-pamem.sh" "$ONBOARD_WORKSPACE" --profile coder >/dev/null 2>&1; then
  echo "onboarding must not overwrite an existing config without --force" >&2
  exit 1
fi

if bash "$ROOT/scripts/onboard-pamem.sh" "$ONBOARD_WORKSPACE/sync-executor-profile" --profile sync-executor >/dev/null 2>&1; then
  echo "sync-executor must be a packaged plugin agent, not an onboardable memory profile" >&2
  exit 1
fi

echo "pamem smoke checks passed"
