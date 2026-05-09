# pamem

`pamem` is a persistent agent memory runtime.

It provides:

- memory governance and startup loading
- CLI and Slock task-state boundaries
- shared memory repo bootstrap and config templates
- a packaged sync executor agent definition
- sync request handoff and sync helper entry points

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

Choose a profile when the agent is first initialized:

```bash
pamem init --agent-id coder-local --profile coder
```

Start, resume, and inspect the runtime:

```bash
pamem start --agent-id coder-local -- codex
pamem resume --agent-id coder-local
pamem context --agent-id coder-local
pamem lint --agent-id coder-local --json
pamem sync --agent-id coder-local --dry-run
```

For Slock workspaces, use the workspace anchor explicitly:

```bash
pamem init --workspace /root/.slock/agents/<slock-agent-id> --profile coder --runtime slock
```

In Slock mode, `MEMORY.md` stays a thin router. Shared memory is loaded from
the configured repo through the active profile, while `notes/current-task.md`
and `notes/work-log.md` stay workspace-local.

## Docs

- [INSTALL.md](INSTALL.md): bootstrap, repair, remove, and workspace modes
- [DESIGN.md](DESIGN.md): layers, precedence, and runtime model
- [SYNC.md](SYNC.md): sync request handoff and sync executor boundaries
- `agents/sync-executor.md`: packaged sync executor agent definition
- `scripts/pamem`: human-facing CLI
- `scripts/onboard-pamem.sh`: onboarding helper
- `scripts/pamem-cli.sh`: CLI runtime helper
- `scripts/memory-sync.sh`: memory repo sync helper
- `skills/memory-lint/scripts/memory-lint.sh`: read-only lint helper
