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
pamem pr-check --agent-id coder-local --head HEAD --target roles/coder/
```

For Slock workspaces, use the workspace anchor explicitly:

```bash
pamem init --workspace /root/.slock/agents/<slock-agent-id> --profile coder --runtime slock
```

In Slock mode, `MEMORY.md` stays a thin router to config, shared memory, and
the active role guide such as `roles/coder/coder.md`. The role guide points to
role-specific experience and topic files. `notes/current-task.md` and
`notes/work-log.md` stay workspace-local. `current-task.md` is the active
recovery pointer; `work-log.md` records completed summaries and verification
results. For multiple role instances, each agent home or Slock workspace keeps
its own current task and work log; only durable memory is shared.

## Docs

- [INSTALL.md](INSTALL.md): bootstrap, repair, remove, and workspace modes
- [DESIGN.md](DESIGN.md): layers, precedence, and runtime model
- [SYNC.md](SYNC.md): sync request handoff and sync executor boundaries
- `agents/sync-executor.md`: packaged sync executor agent definition
- `scripts/pamem`: human-facing CLI
- `scripts/onboard-pamem.sh`: onboarding helper
- `scripts/pamem-cli.sh`: CLI runtime helper
- `scripts/memory-pr-check.sh`: read-only memory PR scope and lint check
- `skills/memory-lint/scripts/memory-lint.sh`: read-only lint helper
