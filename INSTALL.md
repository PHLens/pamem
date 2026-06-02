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

After installing, use `noesis update` to maintain Noesis-managed package and
component checkouts, including pamem. User-facing runtime/session management is
also owned by Noesis: use `noesis launch`, `noesis list`, and `noesis remove`.
Pamem remains the memory owner component surface: use `pamem setup` when an
external bootstrapper needs a deliberate workspace binding, and `pamem install`
/ `pamem repair` for low-level workspace runtime/plugin files.

## Launch An Agent Through Noesis

Use `noesis launch` once per agent or Slock workspace. Noesis owns the
user-facing runtime/session UX and calls pamem's component-facing setup/status
surfaces for memory readiness.

```bash
noesis launch --profile coder --runtime codex --agent-id coder-local
noesis launch --profile coder --runtime codex --agent-id coder-local --resume
noesis launch --runtime slock --profile coder --workspace <slock-agent-workspace>
```

Supported roles:

- `onboarding`
- `coder`
- `reviewer`
- `researcher`

`researcher` also covers source capture and wiki curation work. The retired
`wiki` role is rejected by new setup/onboard flows; re-onboard legacy
wiki workspaces with `--profile researcher` when migrating them.

Noesis forwards memory bootstrap intent to pamem setup. Useful setup options:

```bash
--profile <name>
--runtime <cli|slock>
--agent-id <id>
--workspace <path>
--memory-repo <path>
--sync-remote <target>
--sync-ref <ref>
```

Claude project installs use the pamem plugin `SessionStart` hook from
`hooks/hooks.json`. After updating pamem, an already-installed Claude project
plugin may need `/plugin update` inside Claude Code, or uninstall/reinstall of
`pamem@phlens`, before the next session sees the new hook version.

If config already exists, pamem setup refuses accidental profile/runtime
rebinding unless `--force` is passed. Profile changes should be deliberate
re-onboarding through the internal onboarding helper.

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
Noesis writes a generated `session_id` to `session.json` when it launches or
resumes a CLI runtime, exports it as `PAMEM_SESSION_ID`, and records it in
runtime-local task files so later summaries can be traced to a concrete
runtime session.
Slock runtime does not write pamem CLI session ids; use Slock task, thread, and
message ids for Slock-side provenance.

Recommended local CLI practice:

- Install with npm, then verify the command:

  ```bash
  npm install -g git+ssh://git@github.com/PHLens/pamem.git
  pamem --help
  ```

- Treat `noesis launch` as the explicit agent launcher.
- Pick one stable `--agent-id` per long-lived local agent. The id is the
  recovery boundary for config, current task, work log, and resume state.
- Keep role and agent id effectively one-to-one. For concurrent roles, create
  separate ids such as `coder-local`, `reviewer-local`, and
  `researcher-local` instead of rebinding one id between roles.
- Keep project repositories as work directories, not memory homes. The CLI
  agent home should stay under the XDG data path; launch the runtime through
  Noesis from the project context when needed.
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
noesis launch --profile coder --agent-id coder-local --runtime codex
noesis launch --profile coder --agent-id coder-local --runtime codex --resume
```

Use distinct ids for other local role instances:

```bash
noesis launch --profile reviewer --agent-id reviewer-local --runtime codex
noesis launch --profile researcher --agent-id researcher-local --runtime claude
```

To work in a project repo while keeping the same stable pamem agent home:

```bash
cd /path/to/project
noesis launch --profile coder --agent-id coder-local --runtime codex
```

Use `--runtime codex` or `--runtime claude` for built-in launchers. Use Noesis
runtime options for launcher-specific arguments and memory options for pamem
setup passthrough.

Without a launcher, `status`, `hook-json`, and `context` are useful for runtime
integration and debugging:

```bash
noesis list
pamem status --agent-id coder-local --json
pamem status --agent-id coder-local
pamem hook-json --agent-id coder-local
pamem context --agent-id coder-local
pamem lint --agent-id coder-local --json
pamem pr-check --agent-id coder-local --head HEAD --target roles/coder/ --json
```

`status --json` is the stable read-only interface for tools that need the configured
agent home or Slock workspace path without taking over memory responsibilities.
Agent-id resolution checks configured CLI homes and local Slock agent
workspaces.
`status`, `hook-json`, and context inspection are handled by Node.
`context` still feeds the lightweight SessionStart shell hook so runtime startup
loading stays shared with Codex/Slock hook execution.

To create or deliberately replace config without starting a runtime, use
`pamem setup`. This is the stable component-facing wrapper for external
bootstrappers:

```bash
pamem setup /path/to/workspace --profile coder --runtime slock --json
pamem setup /path/to/agent-home --agent-home --profile researcher --runtime cli --force --json
```

`pamem setup` requires an explicit profile, installs managed bootstrap files,
and returns a single JSON object when `--json` is passed. Internally it uses the
same intentional onboarding path as `pamem onboard`; `install` and `repair` are
only for refreshing bootstrap files without changing role binding.

For low-level manual onboarding, use `pamem onboard`:

```bash
pamem onboard /path/to/workspace --profile coder --runtime slock
pamem onboard /path/to/agent-home --agent-home --profile researcher --runtime cli --force
```

## Slock Runtime

Slock mode uses the Slock-generated workspace as the runtime anchor:

```bash
noesis launch --runtime slock --profile coder --workspace <slock-agent-workspace>
```

Noesis binds or repairs the workspace by calling pamem setup/status. The Slock
runtime process itself still starts through Slock.

The workspace owns local task state:

```text
notes/current-task.md
notes/work-log.md
```

The shared memory repo remains configured by `[memory_repo].path`. The workspace
`MEMORY.md` is only a thin router; governance text lives in the shared repo
entry file. The active profile loads shared memory and the startup
role guide at `roles/<role>/<role>.md`; that guide points to detailed role
experience when needed. The packaged base role template is only a bootstrap
source for creating concrete role guides. In Slock mode, `notes/current-task.md`
is only a thin cache because the task board and threads remain primary;
`notes/work-log.md` keeps runtime-local completed summaries. Each Slock agent
workspace keeps its own copy. Slock provenance remains in Slock task, thread,
and message ids rather than pamem CLI `session_id` records.

## Bootstrap And Repair

Use the public CLI for bootstrap and repair:

```bash
pamem install <workspace>
pamem setup <workspace> --profile coder --runtime slock --json
noesis update
pamem repair <workspace>
```

Install/repair creates or refreshes:

- `.pamem/config.toml`
- `.pamem/scripts` and `.pamem/assets` links
- `.codex/hooks.json`
- `.codex/skills/memory-rule`
- `.codex/skills/memory-lint`
- the configured shared memory repo skeleton, including the startup role guides
- runtime-local task files for the selected runtime mode

`noesis update` updates Noesis-managed package/component checkouts, including
pamem, without making pamem a separate user maintenance path. After updating
pamem, run `pamem repair <workspace>` when a workspace's managed hooks, skill
links, or bootstrap files need to be refreshed.

User-facing cleanup has moved to `noesis remove`, which removes launch
integration while leaving memory files and config in place.

## Validate

Run the repo smoke test:

```bash
npm test
```

Run memory lint for a configured agent or workspace:

```bash
pamem lint --agent-id coder-local --json
pamem lint --workspace <slock-agent-workspace> --json
```
