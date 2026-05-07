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
  '^\[memory_repo\.sync\]$' \
  '^[[:space:]]*backend[[:space:]]*=[[:space:]]*"local"' \
  '^[[:space:]]*sync_bootstrapped[[:space:]]*=[[:space:]]*false' \
  'L2/active/current-tasks\.md' \
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

if grep -Eq '^\[profiles\.(human|coder|reviewer|researcher)\]$' "$CONFIG"; then
  echo "base config template should only ship the onboarding profile" >&2
  exit 1
fi

for profile in human coder reviewer researcher; do
  profile_template="$ROOT/assets/config-profiles/${profile}.toml.template"
  test -s "$profile_template"
  grep -Eq "^[[:space:]]*default_profile[[:space:]]*=[[:space:]]*\"${profile}\"" "$profile_template"
  grep -Eq "^\[profiles\.${profile}\]$" "$profile_template"
done

for file in \
  "$ROOT/assets/MEMORY.md.template" \
  "$ROOT/assets/memory-governance.md.fragment" \
  "$ROOT/assets/sync-trigger.md.fragment" \
  "$ROOT/assets/notes/current-task.md.template" \
  "$ROOT/assets/shared/L0/constitution.md.template" \
  "$ROOT/assets/shared/L1/roles/onboarding.md.template" \
  "$ROOT/assets/shared/L1/roles/coder.md.template" \
  "$ROOT/assets/shared/L1/roles/reviewer.md.template" \
  "$ROOT/assets/shared/L1/roles/researcher.md.template" \
  "$ROOT/assets/config-profiles/human.toml.template" \
  "$ROOT/assets/config-profiles/coder.toml.template" \
  "$ROOT/assets/config-profiles/reviewer.toml.template" \
  "$ROOT/assets/config-profiles/researcher.toml.template" \
  "$ROOT/scripts/onboard-pamem.sh" \
  "$ROOT/scripts/memory-lint.sh" \
  "$ROOT/scripts/memory-sync.sh"
do
  test -s "$file"
done

if [ ! -x "$ROOT/scripts/memory-lint.sh" ]; then
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

WORKSPACE="$(mktemp -d)"
ONBOARD_WORKSPACE="$(mktemp -d)"
cleanup() {
  rm -rf "$WORKSPACE" "$ONBOARD_WORKSPACE"
}
trap cleanup EXIT

bash "$ROOT/scripts/install-pamem.sh" "$WORKSPACE" >/dev/null

for file in \
  "$WORKSPACE/.pamem/config.toml" \
  "$WORKSPACE/.pamem/memory/MEMORY.md" \
  "$WORKSPACE/.pamem/memory/L0/constitution.md" \
  "$WORKSPACE/.pamem/memory/L1/shared/preferences.md" \
  "$WORKSPACE/.pamem/memory/L1/roles/onboarding.md" \
  "$WORKSPACE/.pamem/memory/L2/active/current-tasks.md" \
  "$WORKSPACE/.pamem/memory/L3/work-log.md" \
  "$WORKSPACE/MEMORY.md" \
  "$WORKSPACE/notes/current-task.md"
do
  test -s "$file"
done

MEMORY_LINT_OUTPUT="$(bash "$ROOT/scripts/memory-lint.sh" --root "$WORKSPACE" --json)"
printf '%s' "$MEMORY_LINT_OUTPUT" | jq -e '
  .status == "ok" and
  .config_scope == "workspace-local" and
  .summary.error_count == 0 and
  .config.default_profile == "onboarding"
' >/dev/null

cat > "$WORKSPACE/.pamem/memory/L2/active/current-tasks.md" <<'EOF'
# Active Roster

## Active Tasks
- task-smoke: validate memory-lint active roster checks

## Status
- in_progress
EOF

cat > "$WORKSPACE/.pamem/memory/L2/active/task-smoke.md" <<'EOF'
# task-smoke

- status: in_progress
EOF

bash "$ROOT/scripts/memory-lint.sh" --root "$WORKSPACE" --json | jq -e '.status == "ok"' >/dev/null
rm "$WORKSPACE/.pamem/memory/L2/active/task-smoke.md"
if bash "$ROOT/scripts/memory-lint.sh" --root "$WORKSPACE" --json >/dev/null 2>&1; then
  echo "memory-lint must fail when the active roster points to a missing task file" >&2
  exit 1
fi

mkdir -p "$WORKSPACE/.pamem/memory/.pamem"
cp "$WORKSPACE/.pamem/config.toml" "$WORKSPACE/.pamem/memory/.pamem/config.toml"
if bash "$ROOT/scripts/memory-lint.sh" --root "$WORKSPACE" --json >/dev/null 2>&1; then
  echo "memory-lint must fail when the memory repo contains .pamem/config.toml" >&2
  exit 1
fi
rm -rf "$WORKSPACE/.pamem/memory/.pamem"

SESSION_OUTPUT="$(printf '{"cwd":"%s"}\n' "$WORKSPACE" | bash "$ROOT/scripts/memory-session-start.sh")"
printf '%s' "$SESSION_OUTPUT" | jq -e '
  .hookSpecificOutput.hookEventName == "SessionStart" and
  (.hookSpecificOutput.additionalContext | contains("Persistent memory source:") and contains(".pamem/memory"))
' >/dev/null

rm -f "$WORKSPACE/.pamem/memory/L2/active/current-tasks.md"
printf '{"cwd":"%s","trigger":"manual"}\n' "$WORKSPACE" | bash "$ROOT/scripts/memory-pre-compact.sh" 2>/dev/null
test -s "$WORKSPACE/.pamem/memory/L2/active/current-tasks.md"

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

if bash "$ROOT/scripts/onboard-pamem.sh" "$ONBOARD_WORKSPACE" --profile coder >/dev/null 2>&1; then
  echo "onboarding must not overwrite an existing config without --force" >&2
  exit 1
fi

echo "pamem smoke checks passed"
