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

for profile in onboarding human coder reviewer researcher; do
  if ! grep -Eq "^\[profiles\.${profile}\]$" "$CONFIG"; then
    echo "missing profile: $profile" >&2
    exit 1
  fi
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
  "$ROOT/scripts/memory-sync.sh"
do
  test -s "$file"
done

if [ ! -x "$ROOT/scripts/memory-sync.sh" ]; then
  echo "memory-sync.sh must be executable" >&2
  exit 1
fi

if grep -RIn --exclude-dir=.git --exclude-dir=tests -E '~/sync-queue|for Adam|Adam is the sync executor|agent-sync' "$ROOT"; then
  echo "stale sync executor or queue wording found" >&2
  exit 1
fi

WORKSPACE="$(mktemp -d)"
cleanup() {
  rm -rf "$WORKSPACE"
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

SESSION_OUTPUT="$(printf '{"cwd":"%s"}\n' "$WORKSPACE" | bash "$ROOT/scripts/memory-session-start.sh")"
printf '%s' "$SESSION_OUTPUT" | jq -e '
  .hookSpecificOutput.hookEventName == "SessionStart" and
  (.hookSpecificOutput.additionalContext | contains("Persistent memory source:") and contains(".pamem/memory"))
' >/dev/null

rm -f "$WORKSPACE/.pamem/memory/L2/active/current-tasks.md"
printf '{"cwd":"%s","trigger":"manual"}\n' "$WORKSPACE" | bash "$ROOT/scripts/memory-pre-compact.sh" 2>/dev/null
test -s "$WORKSPACE/.pamem/memory/L2/active/current-tasks.md"

bash "$ROOT/scripts/memory-sync.sh" --root "$WORKSPACE" --dry-run | grep -q '^local-only: no remote sync ran'
bash "$ROOT/scripts/memory-sync.sh" --root "$WORKSPACE" --backend git --remote origin --dry-run | grep -q '^git -C '

if bash "$ROOT/scripts/memory-sync.sh" --root "$WORKSPACE" --backend webdav --remote example:Memory --dry-run >/dev/null 2>&1; then
  echo "webdav dry-run must require --resync until sync_bootstrapped=true" >&2
  exit 1
fi

bash "$ROOT/scripts/memory-sync.sh" --root "$WORKSPACE" --backend webdav --remote example:Memory --resync --dry-run | grep -q '^rclone bisync '

echo "pamem smoke checks passed"
