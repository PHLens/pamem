# pamem

`pamem` is a persistent agent memory runtime.

It provides:

- memory governance and startup loading
- CLI and Slock task-state boundaries
- git-backed shared memory repo bootstrap and config templates
- a packaged sync executor agent definition
- sync request handoff and executor policy

## Install CLI

Install the standalone CLI from GitHub:

```bash
npm install -g git+ssh://git@github.com/PHLens/pamem.git
```

From a checked-out repo, install the local package:

```bash
npm install -g .
```

Then verify:

```bash
pamem --help
```

The package exposes the `pamem` command directly. Use `pamem install` to install
or repair runtime/plugin files, then `pamem launch` to start a role/runtime
instance.

## Plugin Install

Claude Code:

```bash
claude plugin marketplace add git@github.com:PHLens/pamem.git
claude plugin install pamem@phlens --scope project
```

Codex bootstrap reuses the installed plugin runtime. It links the packaged
`scripts/`, `assets/`, and `skills/` directories into the workspace instead of
copying them.

## Use

Start a CLI session with a fixed role:

```bash
pamem launch --role coder --agent-id coder-local -- codex
```

Resume and inspect the runtime:

```bash
pamem launch --role coder --agent-id coder-local --resume
pamem list
pamem resolve --agent-id coder-local --json
pamem status --agent-id coder-local
pamem context --agent-id coder-local
pamem lint --agent-id coder-local --json
pamem pr-check --agent-id coder-local --head HEAD --target roles/coder/
pamem skill list --agent-id coder-local
pamem skill verify --agent-id coder-local --json
```

`resolve` is the stable read-only interface for other tools that need the
configured agent home or Slock workspace path. For example, a separate skill
manager can call `pamem resolve --agent-id coder-local --json` before changing
workspace-local `.codex/skills` or `.claude/skills`. Agent-id resolution checks
configured CLI homes and local Slock agent workspaces.

For Slock workspaces, use the workspace anchor explicitly:

```bash
pamem launch --runtime slock --role coder --workspace <slock-agent-workspace>
```

To pin commits in the configured memory repo to a specific identity, configure
the repo-local git author during onboarding or launch:

```bash
pamem onboard /path/to/workspace --git-author-name "Memory Bot" --git-author-email memory-bot@example.invalid
pamem launch --role coder --agent-id coder-local --git-author-name "Memory Bot" --git-author-email memory-bot@example.invalid
```

Pamem stores this in `[memory_repo.git]`, applies it to the configured memory
repo's local `git config user.name/user.email`, and `pamem lint` reports a
mismatch if the repo-local config drifts.
When pamem initializes a new shared memory repo without a configured sync
remote or git author, the CLI prints a follow-up reminder with the relevant
flags and config fields.

In Slock mode, `pamem launch` binds or repairs the existing Slock workspace; it
does not create or start the Slock agent process. `MEMORY.md` stays a thin
router to config, shared memory, and the active role guide such as
`roles/coder/coder.md`. Pamem uses its packaged base role template only when
bootstrapping role guides; the shared memory repo stores concrete roles. The
role guide points to role-specific experience and topic files.
`notes/current-task.md` and `notes/work-log.md` stay workspace-local.
`current-task.md` is the active recovery pointer; `work-log.md` records
completed summaries and verification results. For multiple role instances, each
agent home or Slock workspace keeps its own current task and work log; only
durable memory is shared.

## Docs

- [INSTALL.md](INSTALL.md): bootstrap, repair, remove, and workspace modes
- [DESIGN.md](DESIGN.md): layers, precedence, and runtime model
- [SYNC.md](SYNC.md): sync request handoff and sync executor boundaries
- `agents/sync-executor.md`: packaged sync executor agent definition
- `bin/pamem.mjs`: human-facing npm CLI entrypoint
- `lib/`: Node CLI command, config, onboarding, runtime state, skill inspection, install/remove, and process helpers
- `scripts/memory-session-start.sh`: lightweight SessionStart hook used by runtimes and `pamem context`
- `scripts/memory-pre-compact.sh`: lightweight explicit PreCompact helper
- `scripts/memory-pr-check.sh`: read-only memory PR scope and lint check
- `skills/memory-lint/scripts/memory-lint.sh`: read-only lint helper
- `tests/smoke.test.mjs`: end-to-end Node smoke test
