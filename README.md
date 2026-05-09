# pamem

`pamem` is a persistent agent memory runtime.

It provides:

- memory governance and startup loading
- CLI and Slock task-state boundaries
- git-backed shared memory repo bootstrap and config templates
- a packaged sync executor agent definition
- sync request handoff and executor policy

## Install

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
pamem context --agent-id coder-local
pamem lint --agent-id coder-local --json
pamem pr-check --agent-id coder-local --head HEAD --target roles/coder/
```

For Slock workspaces, use the workspace anchor explicitly:

```bash
pamem launch --runtime slock --role coder --workspace /root/.slock/agents/<slock-agent-id>
```

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
- `scripts/pamem`: human-facing CLI
- `scripts/onboard-pamem.sh`: internal onboarding helper
- `scripts/pamem-cli.sh`: internal CLI runtime helper
- `scripts/memory-pr-check.sh`: read-only memory PR scope and lint check
- `skills/memory-lint/scripts/memory-lint.sh`: read-only lint helper
