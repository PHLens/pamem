#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: memory-sync.sh [--root <agent-home-or-workspace>] [--repo <path>] [--backend <local|git|webdav>] [--remote <target>] [--ref <branch>] [--message <text>] [--resync] [--dry-run]

Sync the configured pamem shared memory repo.

Options:
  --root <path>       Agent home or workspace containing pamem config. Defaults to $PWD.
  --repo <path>       Memory repo path override. Relative paths resolve from --root.
  --backend <name>    Sync backend override: local, git, or webdav.
  --remote <target>   Remote override. Git uses origin by default; WebDAV requires rclone remote:path.
  --ref <branch>      Git branch/ref override. Defaults to memory_repo.sync.ref or main.
  --message <text>    Git commit message. Defaults to "Sync pamem memory repo".
  --resync            WebDAV first-sync/recovery mode when the local repo should win.
  --dry-run           Print the command or action without changing remote state.
  -h, --help          Show this help.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSETS_DIR="$PLUGIN_ROOT/assets"

# shellcheck source=memory-store.sh
source "$SCRIPT_DIR/memory-store.sh"

ROOT="$PWD"
REPO_OVERRIDE=""
BACKEND_OVERRIDE=""
REMOTE_OVERRIDE=""
REF_OVERRIDE=""
MESSAGE="Sync pamem memory repo"
RESYNC=0
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
    --backend)
      [ "$#" -ge 2 ] || { echo "missing value for --backend" >&2; exit 2; }
      BACKEND_OVERRIDE="$2"
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
    --resync)
      RESYNC=1
      shift
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

BACKEND="${BACKEND_OVERRIDE:-$(pamem_memory_repo_sync_backend "$ROOT")}"
REMOTE="${REMOTE_OVERRIDE:-$(pamem_memory_repo_sync_remote "$ROOT")}"
REF="${REF_OVERRIDE:-$(pamem_memory_repo_ref "$ROOT")}"
SYNC_BOOTSTRAPPED="$(pamem_memory_repo_sync_bootstrapped "$ROOT")"

if [ -z "$BACKEND" ]; then
  BACKEND="local"
fi

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

case "$BACKEND" in
  local)
    printf 'local-only: no remote sync ran for %s\n' "$REPO_ROOT"
    ;;
  git)
    if [ "$DRY_RUN" -eq 1 ]; then
      print_command git -C "$REPO_ROOT" add .
      print_command git -C "$REPO_ROOT" commit -m "$MESSAGE"
      print_command git -C "$REPO_ROOT" push "${REMOTE:-origin}" "$REF"
      exit 0
    fi

    if ! command -v git >/dev/null 2>&1; then
      echo "git backend requires git" >&2
      exit 1
    fi

    if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo "git backend requires the memory repo to be a git work tree: $REPO_ROOT" >&2
      exit 1
    fi

    if [ -z "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
      printf 'memory repo clean: %s\n' "$REPO_ROOT"
      exit 0
    fi

    git -C "$REPO_ROOT" add .
    git -C "$REPO_ROOT" commit -m "$MESSAGE"
    git -C "$REPO_ROOT" push "${REMOTE:-origin}" "$REF"
    ;;
  webdav)
    if [ -z "$REMOTE" ]; then
      echo "webdav backend requires memory_repo.sync.remote or --remote" >&2
      exit 2
    fi

    if [ "$SYNC_BOOTSTRAPPED" != "true" ] && [ "$RESYNC" -ne 1 ]; then
      echo "webdav sync is not marked bootstrapped; rerun with --resync only when the local memory repo should win" >&2
      exit 2
    fi

    cmd=(
      rclone
      bisync
      "$REPO_ROOT"
      "$REMOTE"
      --create-empty-src-dirs
      --resilient
      --recover
      --max-lock
      2m
      --size-only
      --conflict-resolve
      path1
      --conflict-loser
      delete
    )

    if [ "$RESYNC" -eq 1 ]; then
      cmd+=(--resync)
    fi

    cmd+=(-P -v)

    if [ "$DRY_RUN" -eq 1 ]; then
      print_command "${cmd[@]}"
      exit 0
    fi

    if ! command -v rclone >/dev/null 2>&1; then
      echo "webdav backend requires rclone" >&2
      exit 1
    fi

    exec "${cmd[@]}"
    ;;
  *)
    echo "unsupported memory sync backend: $BACKEND" >&2
    exit 2
    ;;
esac
