#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for file in "$ROOT"/scripts/*.sh; do
  bash -n "$file"
done

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for pamem runtime checks" >&2
  exit 1
fi

CONFIG="$ROOT/assets/config.toml.template"

for pattern in \
  '^[[:space:]]*version[[:space:]]*=' \
  '^[[:space:]]*default_profile[[:space:]]*=' \
  '^\[memory_repo\]$' \
  '^[[:space:]]*path[[:space:]]*=[[:space:]]*".pamem/memory"' \
  '^[[:space:]]*sharing[[:space:]]*=[[:space:]]*"shared"' \
  '^[[:space:]]*layout[[:space:]]*=[[:space:]]*"L0/L1/L2/projects"' \
  '^\[runtime\]$' \
  '^[[:space:]]*mode[[:space:]]*=[[:space:]]*"cli"' \
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

if grep -Eq '^\[profiles\.(human|coder|reviewer|researcher|wiki)\]$' "$CONFIG"; then
  echo "base config template should only ship the onboarding profile" >&2
  exit 1
fi

for profile in human coder reviewer researcher wiki; do
  profile_template="$ROOT/assets/config-profiles/${profile}.toml.template"
  test -s "$profile_template"
  grep -Eq "^[[:space:]]*default_profile[[:space:]]*=[[:space:]]*\"${profile}\"" "$profile_template"
  grep -Eq '^[[:space:]]*mode[[:space:]]*=[[:space:]]*"cli"' "$profile_template"
  grep -Eq "^\[profiles\.${profile}\]$" "$profile_template"
  if grep -Eq 'L2/active|L3/work-log|current-tasks' "$profile_template"; then
    echo "profile template must not use shared active/work-log paths: $profile_template" >&2
    exit 1
  fi
done

for file in \
  "$ROOT/assets/MEMORY.md.template" \
  "$ROOT/assets/memory-governance.md.fragment" \
  "$ROOT/assets/sync-trigger.md.fragment" \
  "$ROOT/assets/notes/operating-rules.md.template" \
  "$ROOT/assets/notes/current-task.md.template" \
  "$ROOT/assets/notes/work-log.md.template" \
  "$ROOT/assets/shared/L0/constitution.md.template" \
  "$ROOT/assets/shared/L1/roles/onboarding.md.template" \
  "$ROOT/assets/shared/L1/roles/coder.md.template" \
  "$ROOT/assets/shared/L1/roles/reviewer.md.template" \
  "$ROOT/assets/shared/L1/roles/researcher.md.template" \
  "$ROOT/assets/shared/L1/roles/wiki.md.template" \
  "$ROOT/assets/config-profiles/human.toml.template" \
  "$ROOT/assets/config-profiles/coder.toml.template" \
  "$ROOT/assets/config-profiles/reviewer.toml.template" \
  "$ROOT/assets/config-profiles/researcher.toml.template" \
  "$ROOT/assets/config-profiles/wiki.toml.template" \
  "$ROOT/scripts/onboard-pamem.sh" \
  "$ROOT/scripts/memory-sync.sh"
do
  test -s "$file"
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
ONBOARD_WORKSPACE="$(mktemp -d)"
WIKI_WORKSPACE="$(mktemp -d)"
LEGACY_WORKSPACE="$(mktemp -d)"
SLOCK_WORKSPACE="$(mktemp -d)"
INVALID_RUNTIME_WORKSPACE="$(mktemp -d)"
cleanup() {
  rm -rf "$WORKSPACE" "$ONBOARD_WORKSPACE" "$WIKI_WORKSPACE" "$LEGACY_WORKSPACE" "$SLOCK_WORKSPACE" "$INVALID_RUNTIME_WORKSPACE"
}
trap cleanup EXIT

bash "$ROOT/scripts/install-pamem.sh" "$WORKSPACE" >/dev/null

mkdir -p "$LEGACY_WORKSPACE/notes" "$LEGACY_WORKSPACE/.pamem/memory/L1/shared"
printf '# Legacy Agent Workflow\n\n- legacy workspace operating rule\n' > "$LEGACY_WORKSPACE/notes/agent-workflow.md"
printf '# Legacy Shared Workflow\n\n- legacy shared operating rule\n' > "$LEGACY_WORKSPACE/.pamem/memory/L1/shared/workflow.md"
bash "$ROOT/scripts/install-pamem.sh" "$LEGACY_WORKSPACE" >/dev/null
grep -Fq 'legacy workspace operating rule' "$LEGACY_WORKSPACE/notes/operating-rules.md"
grep -Fq 'legacy shared operating rule' "$LEGACY_WORKSPACE/.pamem/memory/L1/shared/operating-rules.md"

for file in \
  "$WORKSPACE/.pamem/config.toml" \
  "$WORKSPACE/.pamem/memory/MEMORY.md" \
  "$WORKSPACE/.pamem/memory/L0/constitution.md" \
  "$WORKSPACE/.pamem/memory/L1/shared/preferences.md" \
  "$WORKSPACE/.pamem/memory/L1/shared/operating-rules.md" \
  "$WORKSPACE/.pamem/memory/L1/roles/onboarding.md" \
  "$WORKSPACE/.pamem/memory/L1/roles/wiki.md" \
  "$WORKSPACE/MEMORY.md" \
  "$WORKSPACE/notes/operating-rules.md" \
  "$WORKSPACE/notes/current-task.md" \
  "$WORKSPACE/notes/work-log.md"
do
  test -s "$file"
done

test -d "$WORKSPACE/.pamem/memory/L2/projects"
test ! -e "$WORKSPACE/.pamem/memory/L2/active"
test ! -e "$WORKSPACE/.pamem/memory/L3/work-log.md"

if [ -e "$WORKSPACE/.pamem/memory/L1/shared/workflow.md" ] || [ -e "$WORKSPACE/notes/agent-workflow.md" ]; then
  echo "legacy shared workflow file names should not be generated" >&2
  exit 1
fi

MEMORY_LINT_OUTPUT="$(bash "$MEMORY_LINT" --root "$WORKSPACE" --json)"
printf '%s' "$MEMORY_LINT_OUTPUT" | jq -e '
  .status == "ok" and
  .config_scope == "workspace-local" and
  .summary.error_count == 0 and
  .config.default_profile == "onboarding" and
  .config.runtime_mode == "cli"
' >/dev/null

cp -a "$WORKSPACE/." "$INVALID_RUNTIME_WORKSPACE/"
sed -i 's/mode = "cli"/mode = "invalid"/' "$INVALID_RUNTIME_WORKSPACE/.pamem/config.toml"
if bash "$MEMORY_LINT" --root "$INVALID_RUNTIME_WORKSPACE" --json >/dev/null 2>&1; then
  echo "memory-lint must fail when runtime.mode is invalid" >&2
  exit 1
fi

mkdir -p "$WORKSPACE/.pamem/memory/.pamem"
cp "$WORKSPACE/.pamem/config.toml" "$WORKSPACE/.pamem/memory/.pamem/config.toml"
if bash "$MEMORY_LINT" --root "$WORKSPACE" --json >/dev/null 2>&1; then
  echo "memory-lint must fail when the memory repo contains .pamem/config.toml" >&2
  exit 1
fi
rm -rf "$WORKSPACE/.pamem/memory/.pamem"

SESSION_OUTPUT="$(printf '{"cwd":"%s"}\n' "$WORKSPACE" | bash "$ROOT/scripts/memory-session-start.sh")"
printf '%s' "$SESSION_OUTPUT" | jq -e '
  .hookSpecificOutput.hookEventName == "SessionStart" and
  (.hookSpecificOutput.additionalContext | contains("Persistent memory source:") and contains("runtime=cli") and contains(".pamem/memory"))
' >/dev/null

rm -f "$WORKSPACE/notes/current-task.md"
printf '{"cwd":"%s","trigger":"manual"}\n' "$WORKSPACE" | bash "$ROOT/scripts/memory-pre-compact.sh" 2>/dev/null
test -s "$WORKSPACE/notes/current-task.md"

LOCAL_SYNC_OUTPUT="$(bash "$ROOT/scripts/memory-sync.sh" --root "$WORKSPACE" --dry-run)"
if [[ "$LOCAL_SYNC_OUTPUT" != local-only:* ]]; then
  echo "local sync output did not start with the expected status" >&2
  exit 1
fi

GIT_SYNC_OUTPUT="$(bash "$ROOT/scripts/memory-sync.sh" --root "$WORKSPACE" --backend git --remote origin --dry-run)"
if [[ "$GIT_SYNC_OUTPUT" != git\ -C\ * ]]; then
  echo "git sync dry-run output did not start with the expected command" >&2
  exit 1
fi

if bash "$ROOT/scripts/memory-sync.sh" --root "$WORKSPACE" --backend webdav --remote example:Memory --dry-run >/dev/null 2>&1; then
  echo "webdav dry-run must require --resync until sync_bootstrapped=true" >&2
  exit 1
fi

WEBDAV_SYNC_OUTPUT="$(bash "$ROOT/scripts/memory-sync.sh" --root "$WORKSPACE" --backend webdav --remote example:Memory --resync --dry-run)"
if [[ "$WEBDAV_SYNC_OUTPUT" != rclone\ bisync\ * ]]; then
  echo "webdav sync dry-run output did not start with the expected command" >&2
  exit 1
fi

bash "$ROOT/scripts/onboard-pamem.sh" "$ONBOARD_WORKSPACE" \
  --profile reviewer \
  --memory-repo ".pamem/reviewer-memory" \
  --sync-backend webdav \
  --sync-remote "example:Memory" \
  --sync-ref "main" \
  --sync-executor "sync-executor" >/dev/null

grep -Fq 'default_profile = "reviewer"' "$ONBOARD_WORKSPACE/.pamem/config.toml"
grep -Fq 'path = ".pamem/reviewer-memory"' "$ONBOARD_WORKSPACE/.pamem/config.toml"
grep -Fq 'backend = "webdav"' "$ONBOARD_WORKSPACE/.pamem/config.toml"
grep -Fq 'remote = "example:Memory"' "$ONBOARD_WORKSPACE/.pamem/config.toml"
grep -Fq 'executor = "sync-executor"' "$ONBOARD_WORKSPACE/.pamem/config.toml"
test -s "$ONBOARD_WORKSPACE/.pamem/reviewer-memory/MEMORY.md"
test -s "$ONBOARD_WORKSPACE/.pamem/reviewer-memory/L1/roles/reviewer.md"

bash "$ROOT/scripts/onboard-pamem.sh" "$WIKI_WORKSPACE" \
  --profile wiki \
  --memory-repo ".pamem/wiki-memory" >/dev/null

grep -Fq 'default_profile = "wiki"' "$WIKI_WORKSPACE/.pamem/config.toml"
grep -Fq 'path = ".pamem/wiki-memory"' "$WIKI_WORKSPACE/.pamem/config.toml"
test -s "$WIKI_WORKSPACE/.pamem/wiki-memory/MEMORY.md"
test -s "$WIKI_WORKSPACE/.pamem/wiki-memory/L1/roles/wiki.md"

bash "$ROOT/scripts/onboard-pamem.sh" "$SLOCK_WORKSPACE" \
  --profile coder \
  --runtime slock \
  --memory-repo ".pamem/slock-memory" >/dev/null

grep -Fq 'default_profile = "coder"' "$SLOCK_WORKSPACE/.pamem/config.toml"
grep -Fq 'mode = "slock"' "$SLOCK_WORKSPACE/.pamem/config.toml"
test -s "$SLOCK_WORKSPACE/.pamem/slock-memory/MEMORY.md"
test ! -e "$SLOCK_WORKSPACE/notes/current-task.md"
test ! -e "$SLOCK_WORKSPACE/notes/work-log.md"

SLOCK_SESSION_OUTPUT="$(printf '{"cwd":"%s"}\n' "$SLOCK_WORKSPACE" | bash "$ROOT/scripts/memory-session-start.sh")"
printf '%s' "$SLOCK_SESSION_OUTPUT" | jq -e '
  .hookSpecificOutput.hookEventName == "SessionStart" and
  (.hookSpecificOutput.additionalContext | contains("Persistent memory source:") and contains("runtime=slock") and contains(".pamem/slock-memory"))
' >/dev/null

printf '{"cwd":"%s","trigger":"manual"}\n' "$SLOCK_WORKSPACE" | bash "$ROOT/scripts/memory-pre-compact.sh" 2>/dev/null
test ! -e "$SLOCK_WORKSPACE/notes/current-task.md"

if bash "$ROOT/scripts/onboard-pamem.sh" "$ONBOARD_WORKSPACE" --profile coder >/dev/null 2>&1; then
  echo "onboarding must not overwrite an existing config without --force" >&2
  exit 1
fi

echo "pamem smoke checks passed"
