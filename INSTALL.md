# Install

This guide covers pamem bootstrap and runtime setup.

For the model and boundaries, see [DESIGN.md](DESIGN.md) and [SYNC.md](SYNC.md).

## Prerequisites

- `bash`
- `jq`
- GNU `realpath`

## Initialize An Agent

Use `pamem init` once per agent or Slock workspace. It chooses the profile,
writes config, exposes packaged skills, and seeds the configured memory repo.

```bash
pamem init --agent-id coder-local --profile coder
```

Supported profiles:

- `onboarding`
- `coder`
- `reviewer`
- `researcher`
- `wiki`

Useful options:

```bash
--runtime <cli|slock>
--agent-id <id>
--workspace <path>
--memory-repo <path>
--sync-backend <local|git|webdav>
--sync-remote <target>
--sync-ref <ref>
--sync-executor <name>
```

If config already exists, init refuses to replace it unless `--force` is passed.
Profile changes should be deliberate re-onboarding.

## CLI Runtime

CLI mode stores local recovery files in the agent home:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/pamem/agents/<agent-id>/
  config.toml
  current-task.md
  work-log.md
```

`current-task.md` is the primary recovery pointer in CLI mode. Keep it current
for the active task, blocker, and next step. `work-log.md` records completed
summaries and verification results. Multiple role instances should use distinct
agent ids so each instance has its own current task and work log.

The shared memory repo defaults to:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory
```

Start and resume:

```bash
pamem start --agent-id coder-local -- codex
pamem resume --agent-id coder-local
```

Without a launcher, `start`, `status`, `hook-json`, and `context` are useful for
wrappers and debugging:

```bash
pamem status --agent-id coder-local
pamem hook-json --agent-id coder-local
pamem context --agent-id coder-local
```

## Slock Runtime

Slock mode uses the Slock-generated workspace as the runtime anchor:

```bash
pamem init --workspace /root/.slock/agents/<slock-agent-id> --profile coder --runtime slock
```

The workspace owns local task state:

```text
notes/current-task.md
notes/work-log.md
```

The shared memory repo remains configured by `[memory_repo].path`. The workspace
`MEMORY.md` is only a thin router; governance and sync trigger text live in the
shared repo entry file. In Slock mode, `notes/current-task.md` is only a thin
cache because the task board and threads remain primary; `notes/work-log.md`
keeps runtime-local completed summaries. Each Slock agent workspace keeps its
own copy.

## Bootstrap And Repair

The lower-level scripts are still available when a wrapper needs them:

```bash
scripts/install-pamem.sh <workspace>
scripts/repair-pamem.sh <workspace>
scripts/remove-pamem.sh <workspace>
```

Install/repair creates or refreshes:

- `.pamem/config.toml`
- `.pamem/scripts` and `.pamem/assets` links
- `.codex/hooks.json`
- `.codex/skills/memory-rule`
- `.codex/skills/sync-request`
- `.codex/skills/memory-lint`
- the configured shared memory repo skeleton
- runtime-local task files for the selected runtime mode

`remove-pamem.sh` removes managed Codex hook and skill entries. It leaves memory
files and config in place so the workspace can be repaired later.

## Validate

Run the repo smoke test:

```bash
bash tests/smoke.sh
```

Run memory lint for a configured agent or workspace:

```bash
pamem lint --agent-id coder-local --json
pamem lint --workspace /root/.slock/agents/<slock-agent-id> --json
```
