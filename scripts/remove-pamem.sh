#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: remove-pamem.sh <workspace>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_INPUT="$1"
WORKSPACE="$(cd "$TARGET_INPUT" && pwd)"

CODEX_HOOKS="$WORKSPACE/.codex/hooks.json"

SESSION_CMD='.pamem/scripts/memory-session-start.sh'

if [ -s "$CODEX_HOOKS" ]; then
  tmp_file="$(mktemp)"
  python3 - "$CODEX_HOOKS" "$SESSION_CMD" <<'PY' > "$tmp_file"
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
session_cmd = sys.argv[2]

try:
    data = json.loads(path.read_text())
except Exception as exc:
    raise SystemExit(f"invalid JSON in {path}: {exc}")

if not isinstance(data, dict):
    raise SystemExit(f"{path} must contain a JSON object")

hooks = data.get("hooks")
if not isinstance(hooks, dict):
    hooks = {}

session_entries = hooks.get("SessionStart", [])
if not isinstance(session_entries, list):
    session_entries = []

filtered_entries = []
for entry in session_entries:
    if not isinstance(entry, dict):
        continue
    if entry.get("matcher") != "startup|resume":
        filtered_entries.append(entry)
        continue

    entry_hooks = entry.get("hooks", [])
    if not isinstance(entry_hooks, list):
        continue

    kept_hooks = [
        hook for hook in entry_hooks
        if not (isinstance(hook, dict) and hook.get("command") == session_cmd)
    ]
    if kept_hooks:
        new_entry = dict(entry)
        new_entry["hooks"] = kept_hooks
        filtered_entries.append(new_entry)

hooks["SessionStart"] = filtered_entries
data["hooks"] = hooks
print(json.dumps(data, indent=2, ensure_ascii=False))
PY
  mv "$tmp_file" "$CODEX_HOOKS"
fi

printf 'Removed Codex pamem hook entries from %s\n' "$WORKSPACE"
