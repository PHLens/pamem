#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: memory-sync.sh [--root <agent-home-or-workspace>] [--repo <path>] [--remote <name>] [--ref <branch>] [--message <text>] [--dry-run]

Sync the configured pamem shared memory repo with git.

Options:
  --root <path>       Agent home or workspace containing pamem config. Defaults to $PWD.
  --repo <path>       Memory repo path override. Relative paths resolve from --root.
  --remote <name>     Git remote override. Defaults to memory_repo.sync.remote or origin.
  --ref <branch>      Git branch/ref override. Defaults to memory_repo.sync.ref or main.
  --message <text>    Git commit message. Defaults to "Sync pamem memory repo".
  --dry-run           Print the git commands without changing remote state.
  -h, --help          Show this help.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=memory-store.sh
source "$SCRIPT_DIR/memory-store.sh"

ROOT="$PWD"
REPO_OVERRIDE=""
REMOTE_OVERRIDE=""
REF_OVERRIDE=""
MESSAGE="Sync pamem memory repo"
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root)
      [ "$#" -ge 2 ] || { echo "missing value for --root" >&2; exit 2; }
      ROOT="$2"
      shift 2
      ;;
    --repo)
      [ "$#" -ge 2 ] || { echo "missing value for --repo" >&2; exit 2; }
      REPO_OVERRIDE="$2"
      shift 2
      ;;
    --remote)
      [ "$#" -ge 2 ] || { echo "missing value for --remote" >&2; exit 2; }
      REMOTE_OVERRIDE="$2"
      shift 2
      ;;
    --ref)
      [ "$#" -ge 2 ] || { echo "missing value for --ref" >&2; exit 2; }
      REF_OVERRIDE="$2"
      shift 2
      ;;
    --message)
      [ "$#" -ge 2 ] || { echo "missing value for --message" >&2; exit 2; }
      MESSAGE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

pamem_require_realpath

ROOT="$(pamem_expand_path "$PWD" "$ROOT")"

if [ -n "$REPO_OVERRIDE" ]; then
  REPO_ROOT="$(pamem_expand_path "$ROOT" "$REPO_OVERRIDE")"
else
  REPO_ROOT="$(pamem_memory_repo_root "$ROOT")"
fi

REMOTE="${REMOTE_OVERRIDE:-$(pamem_memory_repo_sync_remote "$ROOT")}"
REF="${REF_OVERRIDE:-$(pamem_memory_repo_ref "$ROOT")}"

if [ -z "$REF" ]; then
  REF="main"
fi

if [ ! -d "$REPO_ROOT" ]; then
  echo "memory repo does not exist: $REPO_ROOT; run install-pamem.sh or repair-pamem.sh first" >&2
  exit 1
fi

print_command() {
  printf '%q' "$1"
  shift
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\n'
}

if ! command -v git >/dev/null 2>&1; then
  echo "pamem sync requires git" >&2
  exit 1
fi

if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "pamem sync requires the memory repo to be a git work tree: $REPO_ROOT" >&2
  echo "Run pamem install/repair to initialize it, then configure a git remote repo for updates." >&2
  exit 1
fi

GIT_REMOTE="${REMOTE:-origin}"

if ! git -C "$REPO_ROOT" remote get-url "$GIT_REMOTE" >/dev/null 2>&1; then
  echo "pamem sync requires a configured git remote repository." >&2
  echo "Memory repo: $REPO_ROOT" >&2
  echo "Configure it with: git -C \"$REPO_ROOT\" remote add $GIT_REMOTE <url>" >&2
  echo "Or set memory_repo.sync.remote in config.toml." >&2
  exit 1
fi

if [ "$DRY_RUN" -eq 1 ]; then
  print_command git -C "$REPO_ROOT" add .
  print_command git -C "$REPO_ROOT" commit -m "$MESSAGE"
  print_command git -C "$REPO_ROOT" push "$GIT_REMOTE" "$REF"
  exit 0
fi

if [ -z "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  printf 'memory repo clean: %s\n' "$REPO_ROOT"
  exit 0
fi

git -C "$REPO_ROOT" add .
git -C "$REPO_ROOT" commit -m "$MESSAGE"
git -C "$REPO_ROOT" push "$GIT_REMOTE" "$REF"
