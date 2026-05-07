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
  "$ROOT/assets/notes/current-task.md.template"
do
  test -s "$file"
done

if grep -RIn --exclude-dir=.git --exclude-dir=tests -E '~/sync-queue|for Adam|Adam is the sync executor|agent-sync' "$ROOT"; then
  echo "stale sync executor or queue wording found" >&2
  exit 1
fi

echo "pamem smoke checks passed"
