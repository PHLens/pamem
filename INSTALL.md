# Install

This guide covers pamem bootstrap and runtime setup.

For the model and boundaries, see [DESIGN.md](DESIGN.md) and [SYNC.md](SYNC.md).

## Prerequisites

- `bash`
- `git`
- Node.js 18+ for the standalone npm CLI
- `jq` for the remaining shell-based SessionStart/PreCompact hooks, lint, and PR-check helpers
- GNU `realpath` for the remaining shell-based hooks, lint, and PR-check helpers

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

After installing, use `pamem install` to install or repair runtime/plugin
files, then `pamem launch` to start a role/runtime instance.

## Launch An Agent

Use `pamem launch` once per agent or Slock workspace. It chooses the role,
writes config if needed, exposes packaged skills, and seeds the configured
memory repo.

```bash
pamem launch --role coder --agent-id coder-local -- codex
```

Supported roles:

- `onboarding`
- `coder`
- `reviewer`
- `researcher`
- `wiki`

Useful options:

```bash
--role <name>
--runtime <cli|slock>
--agent-id <id>
--workspace <path>
--memory-repo <path>
--sync-remote <target>
--sync-ref <ref>
--sync-executor <name>
```

If config already exists, launch refuses to bind a different role. Profile
changes should be deliberate re-onboarding through the internal onboarding
helper.

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

Recommended local CLI practice:

- Install with npm, then verify the command:

  ```bash
  npm install -g git+ssh://git@github.com/PHLens/pamem.git
  pamem --help
  ```

- Treat `pamem` as the explicit agent launcher.
- Pick one stable `--agent-id` per long-lived local agent. The id is the
  recovery boundary for config, current task, work log, and resume state.
- Keep role and agent id effectively one-to-one. For concurrent roles, create
  separate ids such as `percy-coder`, `percy-reviewer`, and
  `percy-researcher` instead of rebinding one id between roles.
- Keep project repositories as work directories, not memory homes. The CLI
  agent home should stay under the XDG data path, while the launched command can
  `cd` into the project.
- Use `pamem status`, `pamem context`, and `pamem lint` before debugging startup
  behavior. Use `pamem pr-check` when proposing shared-memory changes.

The shared memory repo defaults to:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory
```

Bootstrap initializes that path as a git repository. If you want to sync it to
another location, configure a git remote for that repo path and set
`memory_repo.sync.remote` when needed.

Start and resume:

```bash
pamem launch --role coder --agent-id percy-coder -- codex
pamem launch --role coder --agent-id percy-coder --resume
```

Use distinct ids for other local role instances:

```bash
pamem launch --role reviewer --agent-id percy-reviewer -- codex
pamem launch --role researcher --agent-id percy-researcher -- codex
```

To work in a project repo while keeping the same stable pamem agent home:

```bash
pamem launch --role coder --agent-id percy-coder -- bash -lc 'cd /path/to/project && codex'
```

Without a launcher, `status`, `hook-json`, and `context` are useful for
runtime integration and debugging:

```bash
pamem status --agent-id percy-coder
pamem hook-json --agent-id percy-coder
pamem context --agent-id percy-coder
pamem lint --agent-id percy-coder --json
pamem pr-check --agent-id percy-coder --head HEAD --target roles/coder/ --json
```

`status`, `hook-json`, launch state, and resume dispatch are handled by Node.
`context` still feeds the lightweight SessionStart shell hook so runtime startup
loading stays shared with Codex/Slock hook execution.

To create or deliberately replace config without starting a runtime, use
`pamem onboard`:

```bash
pamem onboard /path/to/workspace --profile coder --runtime slock
pamem onboard /path/to/agent-home --agent-home --profile wiki --runtime cli --force
```

## Slock Runtime

Slock mode uses the Slock-generated workspace as the runtime anchor:

```bash
pamem launch --runtime slock --role coder --workspace /root/.slock/agents/<slock-agent-id>
```

`pamem launch` binds or repairs the workspace; the Slock runtime process itself
still starts through Slock.

The workspace owns local task state:

```text
notes/current-task.md
notes/work-log.md
```

The shared memory repo remains configured by `[memory_repo].path`. The workspace
`MEMORY.md` is only a thin router; governance and sync trigger text live in the
shared repo entry file. The active profile loads shared memory and the startup
role guide at `roles/<role>/<role>.md`; that guide points to detailed role
experience when needed. The packaged base role template is only a bootstrap
source for creating concrete role guides. In Slock mode, `notes/current-task.md`
is only a thin cache because the task board and threads remain primary;
`notes/work-log.md` keeps runtime-local completed summaries. Each Slock agent
workspace keeps its own copy.

## Bootstrap And Repair

Use the public CLI for bootstrap and cleanup:

```bash
pamem install <workspace>
pamem repair <workspace>
pamem remove <workspace>
```

Install/repair creates or refreshes:

- `.pamem/config.toml`
- `.pamem/scripts` and `.pamem/assets` links
- `.codex/hooks.json`
- `.codex/skills/memory-rule`
- `.codex/skills/memory-lint`
- the configured shared memory repo skeleton, including the startup role guides
- runtime-local task files for the selected runtime mode

`pamem remove` removes managed Codex hook and skill entries. It leaves memory
files and config in place so the workspace can be repaired later.

## Validate

Run the repo smoke test:

```bash
npm test
```

Run memory lint for a configured agent or workspace:

```bash
pamem lint --agent-id coder-local --json
pamem lint --workspace /root/.slock/agents/<slock-agent-id> --json
```
