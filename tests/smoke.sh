#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for file in "$ROOT"/scripts/*.sh; do
  bash -n "$file"
done

if grep -RIn --exclude-dir=.git -E '(^|[^A-Za-z0-9_])jq([^A-Za-z0-9_]|$)' "$ROOT/scripts"; then
  echo "scripts must not require jq" >&2
  exit 1
fi

python3 - "$ROOT/assets/config.toml.template" <<'PY'
from pathlib import Path
import sys

try:
    import tomllib
except ModuleNotFoundError:
    print("python3 with tomllib support is required", file=sys.stderr)
    sys.exit(1)

path = Path(sys.argv[1])
data = tomllib.loads(path.read_text())

for key in ("version", "default_profile", "governance", "sync", "profiles"):
    if key not in data:
        raise SystemExit(f"missing top-level config key: {key}")

if data["sync"].get("queue_root", "").startswith("~"):
    raise SystemExit("sync.queue_root must not be hardcoded to a home-directory path")

if data["sync"].get("executor") == "Adam":
    raise SystemExit("sync.executor must not be hardcoded to Adam")

profiles = data["profiles"]
for name in ("onboarding", "human", "coder", "reviewer", "researcher"):
    if name not in profiles:
        raise SystemExit(f"missing profile: {name}")
    profile = profiles[name]
    for key in ("role", "load", "write", "guarded_write"):
        if key not in profile:
            raise SystemExit(f"missing profiles.{name}.{key}")
PY

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
