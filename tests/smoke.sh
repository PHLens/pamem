#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "$1" >&2
  exit 1
}

assert_file() {
  [ -s "$1" ] || fail "missing or empty file: $1"
}

assert_link_target() {
  local link="$1"
  local target="$2"

  [ -L "$link" ] || fail "expected symlink: $link"
  [ "$(readlink -f "$link")" = "$target" ] || fail "symlink does not resolve to $target: $link"
}

assert_no_match() {
  local file="$1"
  local pattern="$2"

  if grep -Eq "$pattern" "$file"; then
    fail "unexpected match in $file: $pattern"
  fi
}

for script in "$ROOT"/scripts/*.sh; do
  bash -n "$script"
done
bash -n "$ROOT/scripts/pamem"

if ! command -v jq >/dev/null 2>&1; then
  fail "jq is required for pamem smoke checks"
fi

TMP_ROOT="$(mktemp -d)"
XDG_ROOT="$TMP_ROOT/xdg"
WORKSPACE="$TMP_ROOT/workspace"
REMOVE_WORKSPACE="$TMP_ROOT/remove"
SLOCK_WORKSPACE="$TMP_ROOT/slock"
AGENT_ID="smoke-agent"
AGENT_HOME="$XDG_ROOT/pamem/agents/$AGENT_ID"
MEMORY_ROOT="$XDG_ROOT/pamem/memory"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$WORKSPACE" "$REMOVE_WORKSPACE" "$SLOCK_WORKSPACE"

# Workspace bootstrap creates the runtime links, selected config, local task
# files, and the shared memory skeleton.
XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/install-pamem.sh" "$WORKSPACE" >/dev/null

assert_file "$WORKSPACE/.pamem/config.toml"
assert_file "$WORKSPACE/MEMORY.md"
assert_file "$WORKSPACE/notes/current-task.md"
assert_file "$WORKSPACE/notes/work-log.md"
assert_link_target "$WORKSPACE/.pamem/scripts" "$ROOT/scripts"
assert_link_target "$WORKSPACE/.pamem/assets" "$ROOT/assets"
grep -Fq 'default_profile = "onboarding"' "$WORKSPACE/.pamem/config.toml"
grep -Fq 'mode = "cli"' "$WORKSPACE/.pamem/config.toml"
assert_no_match "$WORKSPACE/.pamem/config.toml" 'backend[[:space:]]*='

for skill in memory-rule sync-request memory-lint; do
  assert_link_target "$WORKSPACE/.codex/skills/$skill" "$ROOT/skills/$skill"
done

assert_file "$MEMORY_ROOT/MEMORY.md"
assert_file "$MEMORY_ROOT/governance/constitution.md"
assert_file "$MEMORY_ROOT/shared/preferences.md"
assert_file "$MEMORY_ROOT/shared/operating-rules.md"
assert_file "$MEMORY_ROOT/shared/experience.md"
git -C "$MEMORY_ROOT" rev-parse --is-inside-work-tree >/dev/null
[ ! -e "$MEMORY_ROOT/roles/base" ] || fail "shared memory repo must not materialize base role templates"
for role in onboarding coder reviewer researcher wiki; do
  assert_file "$MEMORY_ROOT/roles/$role/$role.md"
  assert_file "$MEMORY_ROOT/roles/$role/experience.md"
done
assert_no_match "$MEMORY_ROOT/roles/onboarding/onboarding.md" '{{ROLE_'

git -C "$MEMORY_ROOT" config user.email "pamem-smoke@example.invalid"
git -C "$MEMORY_ROOT" config user.name "pamem smoke"
git -C "$MEMORY_ROOT" add .
if ! git -C "$MEMORY_ROOT" diff --cached --quiet; then
  git -C "$MEMORY_ROOT" commit -m "Initial smoke memory" >/dev/null
elif ! git -C "$MEMORY_ROOT" rev-parse --verify HEAD >/dev/null 2>&1; then
  fail "shared memory repo needs an initial commit for pr-check smoke"
fi

[ ! -e "$MEMORY_ROOT/agents" ] || fail "shared memory must not contain plugin-owned agents"
for layer in L0 L1 L2 L3; do
  [ ! -e "$MEMORY_ROOT/$layer" ] || fail "shared memory must use semantic paths, not $layer"
done
if jq -e '.hooks | has("PreCompact")' "$WORKSPACE/.codex/hooks.json" >/dev/null; then
  fail "bootstrap must not install an automatic PreCompact hook"
fi

# Removal only clears managed hook and skill entries. It leaves workspace memory
# and config in place for later repair.
XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/install-pamem.sh" "$REMOVE_WORKSPACE" >/dev/null
bash "$ROOT/scripts/remove-pamem.sh" "$REMOVE_WORKSPACE" >/dev/null
if jq -e '.hooks.SessionStart[]?.hooks[]?.command == ".pamem/scripts/memory-session-start.sh"' \
  "$REMOVE_WORKSPACE/.codex/hooks.json" >/dev/null; then
  fail "remove-pamem.sh must remove the managed SessionStart hook"
fi
for skill in memory-rule sync-request memory-lint; do
  [ ! -e "$REMOVE_WORKSPACE/.codex/skills/$skill" ] || fail "remove-pamem.sh must remove managed skill link: $skill"
done

# Agent-home init and CLI lifecycle.
XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" init \
  --profile wiki \
  --agent-id "$AGENT_ID" >/dev/null

assert_file "$AGENT_HOME/config.toml"
assert_file "$AGENT_HOME/current-task.md"
assert_file "$AGENT_HOME/work-log.md"
grep -Fq 'default_profile = "wiki"' "$AGENT_HOME/config.toml"
grep -Fq 'mode = "cli"' "$AGENT_HOME/config.toml"
assert_no_match "$AGENT_HOME/config.toml" 'backend[[:space:]]*='

SESSION_TEST='test "$PWD" = "$PAMEM_WORKSPACE" && test -s "$PAMEM_CURRENT_TASK" && if [ "$PAMEM_RESUME" = 1 ]; then printf resume > "$PAMEM_LOCAL_DIR/resume-marker"; else printf start > "$PAMEM_LOCAL_DIR/start-marker"; fi'
XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" start \
  --agent-id "$AGENT_ID" \
  -- sh -c "$SESSION_TEST"
assert_file "$AGENT_HOME/start-marker"
XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" resume --agent-id "$AGENT_ID"
assert_file "$AGENT_HOME/resume-marker"

CLI_STATUS="$(XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" status --agent-id "$AGENT_ID")"
grep -Fq "root=$AGENT_HOME" <<<"$CLI_STATUS"
grep -Fq "runtime=cli" <<<"$CLI_STATUS"
grep -Fq "memory_repo=$MEMORY_ROOT" <<<"$CLI_STATUS"

CLI_HOOK_JSON="$(XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" hook-json --agent-id "$AGENT_ID")"
printf '%s' "$CLI_HOOK_JSON" | jq -e \
  --arg cwd "$AGENT_HOME" \
  --arg current_task "$AGENT_HOME/current-task.md" \
  --arg work_log "$AGENT_HOME/work-log.md" \
  '.cwd == $cwd and .pamem.runtime == "cli" and .pamem.current_task == $current_task and .pamem.work_log == $work_log' >/dev/null

CLI_CONTEXT="$(XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" context --agent-id "$AGENT_ID")"
grep -Fq "Persistent memory source:" <<<"$CLI_CONTEXT"
grep -Fq 'Source: `roles/wiki/wiki.md`' <<<"$CLI_CONTEXT"
! grep -Fq 'Source: `roles/base/base.md`' <<<"$CLI_CONTEXT" || fail "base role template must not load at runtime"
grep -Fq "CLI runtime current task source:" <<<"$CLI_CONTEXT"

CLI_LINT="$(XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" lint --agent-id "$AGENT_ID" --json)"
printf '%s' "$CLI_LINT" | jq -e '
  .status == "ok" and
  .summary.error_count == 0 and
  .config_scope == "agent-local" and
  .config.default_profile == "wiki"
' >/dev/null

# Slock mode keeps task state in the Slock workspace and loads shared memory
# through the selected profile.
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

XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" init \
  --workspace "$SLOCK_WORKSPACE" \
  --profile coder \
  --runtime slock >/dev/null

assert_file "$SLOCK_WORKSPACE/.pamem/config.toml"
assert_file "$SLOCK_WORKSPACE/MEMORY.md"
assert_file "$SLOCK_WORKSPACE/notes/current-task.md"
assert_file "$SLOCK_WORKSPACE/notes/work-log.md"
grep -Fq 'default_profile = "coder"' "$SLOCK_WORKSPACE/.pamem/config.toml"
grep -Fq 'mode = "slock"' "$SLOCK_WORKSPACE/.pamem/config.toml"
assert_no_match "$SLOCK_WORKSPACE/.pamem/config.toml" 'backend[[:space:]]*='
grep -Fq '# Existing Slock Agent' "$SLOCK_WORKSPACE/MEMORY.md"
grep -Fq 'existing workspace note' "$SLOCK_WORKSPACE/MEMORY.md"
assert_no_match "$SLOCK_WORKSPACE/MEMORY.md" '^## (Memory Governance|Sync Trigger)$|old workspace governance block|old workspace sync block'

SLOCK_CONTEXT="$(XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" context --workspace "$SLOCK_WORKSPACE")"
grep -Fq "runtime=slock" <<<"$SLOCK_CONTEXT"
grep -Fq 'Source: `roles/coder/coder.md`' <<<"$SLOCK_CONTEXT"
! grep -Fq 'Source: `roles/base/base.md`' <<<"$SLOCK_CONTEXT" || fail "base role template must not load in Slock context"
grep -Fq "Slock runtime current task source:" <<<"$SLOCK_CONTEXT"
grep -Fq "Slock runtime work log source:" <<<"$SLOCK_CONTEXT"

SLOCK_LINT="$(XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" lint --workspace "$SLOCK_WORKSPACE" --json)"
printf '%s' "$SLOCK_LINT" | jq -e '
  .status == "ok" and
  .summary.error_count == 0 and
  .config.runtime_mode == "slock"
' >/dev/null

git -C "$MEMORY_ROOT" checkout -b smoke-memory-pr >/dev/null 2>&1
printf '\n## Smoke finding\n' >> "$MEMORY_ROOT/roles/coder/experience.md"
git -C "$MEMORY_ROOT" add roles/coder/experience.md
git -C "$MEMORY_ROOT" commit -m "Smoke role memory PR" >/dev/null

PR_CHECK_OK="$(XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" pr-check \
  --workspace "$SLOCK_WORKSPACE" \
  --head HEAD \
  --target roles/coder/ \
  --json)"
printf '%s' "$PR_CHECK_OK" | jq -e '
  .status == "ok" and
  .summary.error_count == 0 and
  (.diff.changed_files | index("roles/coder/experience.md"))
' >/dev/null

printf '\n- Smoke guarded change\n' >> "$MEMORY_ROOT/shared/preferences.md"
git -C "$MEMORY_ROOT" add shared/preferences.md
git -C "$MEMORY_ROOT" commit -m "Smoke guarded memory PR" >/dev/null

PR_CHECK_FAIL_JSON="$TMP_ROOT/pr-check-fail.json"
if XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" pr-check \
  --workspace "$SLOCK_WORKSPACE" \
  --head HEAD \
  --target roles/coder/ \
  --json > "$PR_CHECK_FAIL_JSON"; then
  fail "pamem pr-check must reject guarded or out-of-target memory PRs"
fi
jq -e '
  .status == "error" and
  any(.findings[]; .rule == "MP002" and .path == "shared/preferences.md")
' "$PR_CHECK_FAIL_JSON" >/dev/null

PR_CHECK_GUARDED_OK="$(XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" pr-check \
  --workspace "$SLOCK_WORKSPACE" \
  --head HEAD \
  --target roles/coder/ \
  --target shared/ \
  --allow-guarded \
  --json)"
printf '%s' "$PR_CHECK_GUARDED_OK" | jq -e '
  .status == "ok" and
  .diff.allow_guarded == true
' >/dev/null
git -C "$MEMORY_ROOT" checkout main >/dev/null 2>&1

if XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" start --workspace "$SLOCK_WORKSPACE" >/dev/null 2>&1; then
  fail "pamem start must reject runtime.mode=slock"
fi

# A missing shared memory entry is reported, not silently recreated at startup.
rm -f "$MEMORY_ROOT/MEMORY.md"
MISSING_CONTEXT="$(XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" context --agent-id "$AGENT_ID")"
grep -Fq "Warning: configured memory entry file is missing or empty" <<<"$MISSING_CONTEXT"
if grep -Fq "Load and follow this persistent memory index" <<<"$MISSING_CONTEXT"; then
  fail "missing memory entry must not be injected as loaded memory"
fi

sed -i 's/mode = "cli"/mode = "invalid"/' "$AGENT_HOME/config.toml"
if XDG_DATA_HOME="$XDG_ROOT" bash "$ROOT/scripts/pamem" lint --agent-id "$AGENT_ID" --json >/dev/null 2>&1; then
  fail "memory lint must fail when runtime.mode is invalid"
fi

echo "pamem smoke checks passed"
