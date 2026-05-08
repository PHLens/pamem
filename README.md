# pamem

`pamem` is a persistent agent memory runtime.

## Why

Persistent agent memory becomes unstable when every workspace assembles its own memory setup by hand.

`pamem` exists to provide one shared memory runtime for persistent agents.

## What

`pamem` provides the shared runtime for:

- memory governance
- read-only startup hook
- memory skeleton files
- runtime-mode boundaries for CLI and Slock task state
- shared memory repo bootstrap and config templates
- sync request handoff
- sync helper entry points

It is the runtime, not the memory content itself.

## How

### Claude Code

```bash
claude plugin marketplace add git@github.com:PHLens/pamem.git
claude plugin install pamem@phlens --scope project
```

Codex bootstrap reuses that same marketplace install by symlinking the
workspace `.pamem/scripts` and `.pamem/assets` paths back to the installed
plugin runtime. It also exposes packaged pamem skills through `.codex/skills`
so `memory-rule`, `sync-request`, and `memory-lint` are runtime capabilities.
If those skills are missing, repair the pamem bootstrap before writing shared
memory, local config, or sync queues.

The bootstrap scripts assume `bash`, `jq`, and GNU `realpath` are available in
the workspace environment.

Onboarding chooses the runtime mode. `cli` mode keeps local recovery notes for
current-task and work-log state in the XDG data agent home, with workspace
`notes/` as a compatibility fallback. `slock` mode keeps current-task and
work-log state in the Slock workspace, and surfaces stable L1 notes as
workspace symlinks to the shared memory repo.

Here `agent home` means
`${XDG_DATA_HOME:-$HOME/.local/share}/pamem/agents/<agent-id>/`; it contains
`config.toml` plus local CLI recovery files. Legacy or Slock workspaces may
still contain `.pamem/config.toml`. Neither is the shared memory repo. The
shared memory repo is the path configured by `[memory_repo].path`; by default it is
`${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory`, so multiple local agent
homes and workspaces on the same machine share memory unless onboarding
overrides it.

In Slock runtime mode, pass the Slock-generated agent workspace as `--workspace`.
That workspace is the runtime/config and task-recovery anchor for
`.pamem/config.toml`, hooks, and `notes/current-task.md` / `notes/work-log.md`;
the default shared memory repo remains
`${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory`.

For direct CLI use across changing working directories, use a stable agent id:

```bash
pamem start --agent-id <agent-id> --print-env
```

`pamem init --agent-id <id>` creates the default agent home under XDG data, so
`start`, `resume`, `status`, and `hook-json` can resolve local config directly
from `--agent-id`. Use `--workspace` only for a legacy or Slock workspace
override.

The helper keeps CLI-local recovery files in the agent home and prints the
paths that a launcher can pass to hooks. For runtimes without plugin or hook
support, use `pamem context --agent-id <agent-id>` and pass the printed text
into that runtime's startup prompt or context mechanism.

To create a local coder agent the first time:

```bash
/path/to/pamem/scripts/pamem init --profile coder --runtime cli --agent-id coder-local
```

`pamem init` is a one-time setup step for a new agent home. It writes
`config.toml`, creates local CLI recovery files, and seeds the configured shared
memory repo. It uses the current plugin, source checkout, or standalone install
as the runtime source rather than copying scripts into the agent home. Do not
run it for every agent start.

After that, start the local coder with:

```bash
pamem start --agent-id coder-local -- codex
```

Resume the same local agent with:

```bash
pamem resume --agent-id coder-local
```

`start -- <launcher>` records the launcher command in the local agent home so
`resume` can reuse it. If a runtime has its own native resume command, configure
`[runtime.resume].command` in `config.toml`; that takes precedence. If neither
exists, `resume` fails instead of silently behaving like `start`.

Replace `codex` with `claude` or another local CLI launcher when needed.

For a Slock agent workspace, initialize the workspace anchor explicitly:

```bash
pamem init --workspace /root/.slock/agents/<slock-agent-id> --profile coder --runtime slock
```

This writes `.pamem/config.toml` into the Slock workspace and leaves
`[memory_repo].path` pointing at the machine-level shared memory repo by default.
Stable shared notes are exposed in the workspace as symlinks; update shared
memory through the governed request/sync flow, not by treating workspace links
as independent local files.

### More

- [DESIGN.md](DESIGN.md): memory layers, design philosophy, and plugin responsibilities
- [SYNC.md](SYNC.md): how `pamem` works with sync request handoff, the memory sync helper, and external sync executors
- [INSTALL.md](INSTALL.md): Codex install, repair, update, and removal
- `assets/config.toml.template`: starter config for onboarding a shared memory repo
- `assets/config-profiles/*.toml.template`: alternate role-specific starter configs
- `scripts/pamem`: human-facing CLI for init, start, resume, status, context, lint, and sync
- `scripts/onboard-pamem.sh`: implementation helper for selecting the initial profile config
- `scripts/pamem-cli.sh`: implementation helper for stable agent-home and local recovery paths
- `scripts/memory-sync.sh`: sync helper for the configured memory repo backend
- `scripts/memory-pre-compact.sh`: explicit runtime-local current-task helper; not installed as an automatic hook
- `skills/memory-lint/SKILL.md`: report-only lint boundary and usage notes
- `skills/memory-lint/scripts/memory-lint.sh`: read-only lint for the agent-local or workspace-local memory config and shared memory repo

## Check

Run the lightweight repository smoke checks:

```bash
bash tests/smoke.sh
```

The smoke script requires `jq`.

`skills/memory-lint/scripts/memory-lint.sh` reads agent-local `config.toml` or workspace-local `.pamem/config.toml` and lints the configured memory repo. It does not require a `.pamem/config.toml` inside the memory repo itself.
