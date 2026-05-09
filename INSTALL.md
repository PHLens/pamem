# Codex Install Guide

This guide covers Codex bootstrap for `pamem`.

For the plugin overview, memory-layer model, and Claude install command, see [README.md](README.md).

Codex bootstrap is workspace-local. It does not install or enable the Claude plugin and it does not modify `.claude/settings.json`.

Current Codex plugin CLI support can add or update a marketplace source, but it
does not expose a Claude-style `plugin install` step for runtime capabilities.
The pamem bootstrap therefore creates workspace- or agent-home-local
`.codex/skills` links for packaged pamem skills. Missing `memory-rule` or
`sync-request` means the pamem runtime is not fully installed or exposed; repair
bootstrap before changing shared memory, local config, or sync queues.

## Prerequisites

- `bash`
- `jq`
- GNU coreutils `realpath`

## First-Time Onboarding

Use `pamem init` when a human or onboarding agent needs to choose the initial
profile config for a new local agent:

```bash
$HOME/.claude/plugins/marketplaces/phlens/scripts/pamem init --agent-id coder-local --profile coder
```

Supported profiles are `onboarding`, `coder`, `reviewer`,
`researcher`, and `wiki`. `pamem init` chooses the matching config template,
writes `config.toml` into
`${XDG_DATA_HOME:-$HOME/.local/share}/pamem/agents/<agent-id>/`, creates local
CLI recovery files, and seeds the configured memory repo. The runtime source is
the current plugin, source checkout, or later standalone install path; scripts
and assets are not copied into the agent home.

`pamem init` is a one-time setup step, not the recurring start command.
After `config.toml` exists, launch or resume the local agent with
`pamem start` or `pamem resume`.

Profile selection is an onboarding-time decision. The runtime startup hook reads
the selected local config; it does not switch `default_profile`. If config
already exists, the onboarding script refuses to replace it unless `--force` is
passed for deliberate re-onboarding.

Useful options:

```bash
--runtime <cli|slock>
--agent-id <id>
--memory-repo <path>
--sync-backend <local|git|webdav>
--sync-remote <target>
--sync-ref <ref>
--sync-executor <name>
```

The plugin ships `agents/sync-executor.md` as the packaged sync executor agent
definition. That file belongs to the plugin package, not the shared memory repo
and not a pamem profile.

Default CLI mode uses an agent home at
`${XDG_DATA_HOME:-$HOME/.local/share}/pamem/agents/<agent-id>/`. Legacy or Slock
workspaces may still contain `.pamem/config.toml`. Neither location is the
shared memory repo. The shared memory repo is `[memory_repo].path`, which defaults to
`${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory` and can be changed with
`--memory-repo`.

For Slock runtime mode, use the Slock-generated agent workspace as the explicit
workspace anchor:

```bash
pamem init --workspace /root/.slock/agents/<slock-agent-id> --profile coder --runtime slock
```

This writes `.pamem/config.toml`, hook/runtime links, and workspace task files
into the Slock workspace, but `[memory_repo].path` still defaults to the
machine-level shared memory repo. The Slock workspace owns task state; it is
not the shared memory repo. Its workspace `MEMORY.md` is a thin router/intro;
Memory Governance and sync trigger instructions live in the shared repo's
top-level `MEMORY.md`.

Use `--runtime cli` when the agent should keep CLI-local recovery state for
current-task and work-log summaries. `pamem start` stores that state in the XDG
data agent home; workspace `notes/current-task.md` and `notes/work-log.md`
remain compatibility fallbacks. Use `--runtime slock` when Slock owns task state through
its workspace, task board, and threads; in that mode pamem keeps workspace
`notes/current-task.md` and `notes/work-log.md`, while shared memory is loaded
through the selected profile and shared repo path.

For direct CLI usage where the shell cwd may change between sessions, use `pamem`
after onboarding:

```bash
pamem start --agent-id <agent-id> --print-env
pamem hook-json --agent-id <agent-id>
pamem context --agent-id <agent-id>
```

`pamem init --agent-id <id>` creates the default agent home under XDG data, so
`start`, `resume`, `status`, and `hook-json` can resolve local config directly
from `--agent-id`. Use `--workspace` only for a legacy or Slock workspace
override.

The helper resolves the local agent home, derives or accepts an agent id, and
can exec a launcher from that directory:

```bash
pamem resume --agent-id <agent-id> -- codex
```

For example, to create a local coder agent the first time:

```bash
$HOME/.claude/plugins/marketplaces/phlens/scripts/pamem init --profile coder --runtime cli --agent-id coder-local
```

After that, start the local coder with:

```bash
pamem start --agent-id coder-local -- codex
```

Resume the same local agent with:

```bash
pamem resume --agent-id coder-local
```

The command after `--` can be `codex`, `claude`, or another CLI launcher.
`start -- <launcher>` records the launcher command in the local agent home so
`resume` can reuse it. If a runtime has its own native resume command, configure
`[runtime.resume].command` in `config.toml`; that takes precedence. If neither
exists, `resume` fails instead of silently behaving like `start`.

By default, another local agent onboarded with the same pamem install will point
at the same machine-level shared memory repo. Use `--memory-repo` only when you
need a different repo.

For runtimes that do not support pamem as a plugin or hook, use
`pamem context --agent-id <agent-id>` as the portable boundary. It prints the
same startup memory context as the hook loader, so a wrapper can inject that text
through the runtime's own prompt/context mechanism.

`skills/memory-lint/scripts/memory-lint.sh` is a separate read-only check. It
reads agent-local `config.toml` or workspace-local `.pamem/config.toml`,
resolves the configured memory repo, and reports boundary/pointer/runtime issues
without mutating files.

## Runtime Hooks

The installed runtime hook is `SessionStart` only.

`SessionStart` is a read-only loader. It resolves local pamem config, reports
the configured memory source, and loads the configured memory entry file when it
exists. In CLI runtime mode it also loads CLI-local current-task/work-log state
from hook-provided pamem paths, then from the XDG data agent home, then from
legacy workspace `notes/` files. In Slock runtime mode it loads workspace
current-task/work-log state from the Slock workspace notes. It must not create,
repair, rewrite, promote, or sync shared memory.

`memory-pre-compact.sh` remains an explicit runtime-local helper for creating a
missing current-task placeholder. It uses hook-provided or XDG data agent-home
paths first in CLI mode and workspace notes in Slock mode. It is not installed
as an automatic hook and must not write the shared memory repo.

## Install

Codex reuses the Claude marketplace-installed runtime. The bootstrap keeps the
workspace-local hooks and memory files, but points `.pamem/scripts` and
`.pamem/assets` back to the installed plugin with symlinks. It also exposes
packaged pamem skills through `.codex/skills` symlinks.

The bootstrap now creates `.pamem/config.toml` from `assets/config.toml.template`
if it is missing, then seeds the configured memory repo root and shared
L0, L1, and L2 project skeleton. Update the generated config when you want to move
the memory repo, change the runtime mode, change the sharing mode, or point sync
at a different backend.
For normal human onboarding, prefer `pamem init`. Use `pamem install` directly
for the default onboarding profile or `pamem repair` after `.pamem/config.toml`
has already been chosen.

Install into a workspace:

```bash
$HOME/.claude/plugins/marketplaces/phlens/scripts/install-pamem.sh <workspace>
```

Example:

```bash
$HOME/.claude/plugins/marketplaces/phlens/scripts/install-pamem.sh "$HOME/.slock/agents/<agent-id>"
```

## Repair

Repair an existing workspace:

```bash
$HOME/.claude/plugins/marketplaces/phlens/scripts/repair-pamem.sh <workspace>
```

## Remove

Remove managed bootstrap entries from a workspace:

```bash
$HOME/.claude/plugins/marketplaces/phlens/scripts/remove-pamem.sh <workspace>
```

This removal path removes the Codex `SessionStart` hook entry added by the bootstrap. It leaves `.pamem/` and other workspace files in place so the workspace can be repaired later.

## What Codex Bootstrap Creates

The Codex bootstrap creates or repairs:

- `MEMORY.md` as a CLI compatibility index or Slock workspace router
- `notes/user-preferences.md` as a local compatibility copy in CLI mode
- `notes/operating-rules.md` as a local compatibility copy in CLI mode
- `notes/experience.md` as a local compatibility copy in CLI mode
- `notes/projects/*` as a local compatibility copy in CLI mode
- `notes/current-task.md` in CLI and Slock runtime modes
- `notes/work-log.md` in CLI and Slock runtime modes
- XDG CLI runtime state only when `pamem start` or `resume` is used
- `.codex/config.toml`
- `.codex/hooks.json`
- `.codex/skills/memory-rule`
- `.codex/skills/sync-request`
- `.codex/skills/memory-lint`
- `.pamem/`
- `.pamem/config.toml`
- the configured shared memory repo root
- `L1/shared/experience.md`, `L1/roles/<role>/index.md`, and `L1/roles/<role>/experience.md` inside the configured shared memory repo, without root-level role placeholder files
- `L2/projects/` inside the configured shared memory repo

Within `.pamem/`, the managed `scripts/` and `assets/` entries are symlinks to
the installed Claude marketplace plugin rather than copied runtime files.
Within `.codex/skills/`, the managed pamem skill entries are also symlinks to
the installed plugin's packaged `skills/` directories.

## Verify

After installation, check:

- `MEMORY.md` exists
- `notes/current-task.md` exists in CLI and Slock runtime modes
- `notes/work-log.md` exists in CLI and Slock runtime modes
- in Slock runtime mode, `notes/user-preferences.md`, `notes/operating-rules.md`, `notes/experience.md`, and `notes/projects/` are not mirrored into the workspace
- in Slock runtime mode, workspace `MEMORY.md` does not contain `Memory Governance` or `Sync Trigger` sections
- `.pamem/` exists
- `.codex/config.toml` enables `codex_hooks = true`
- `.codex/hooks.json` contains the `SessionStart` hook for `.pamem/scripts/memory-session-start.sh`
- `.codex/hooks.json` does not contain a `PreCompact` hook
- `.codex/skills/memory-rule`, `.codex/skills/sync-request`, and `.codex/skills/memory-lint` resolve to the installed plugin
- startup loads the memory index
- startup loads the selected role index rather than the full role experience shard
- `.pamem/config.toml` exists and points to the shared memory repo root
- `.pamem/config.toml` sets `[runtime].mode` to `cli` or `slock`
- `default_profile` was selected during onboarding and is not changed by startup hooks
- `pamem start --agent-id <id>` creates/uses
  `${XDG_DATA_HOME:-$HOME/.local/share}/pamem/agents/<id>/` without writing the
  shared memory repo
- `.pamem/scripts/memory-sync.sh --dry-run` prints the configured sync backend action
- `skills/memory-lint/scripts/memory-lint.sh --root <agent-home-or-workspace> --json` reports the local config and shared repo state

## Update

### Claude Code

Update the marketplace, then update the plugin:

```bash
claude plugin marketplace update phlens
claude plugin update pamem@phlens
```

### Codex

Pull the latest repository and rerun:

```bash
$HOME/.claude/plugins/marketplaces/phlens/scripts/repair-pamem.sh <workspace>
```

## Security Notes

`pamem` is designed to keep generated workspace state portable.

Constraints:

- no usernames or absolute home paths in managed workspace hook commands
- no machine-specific secrets in generated note files
- runtime commands use workspace-local relative paths when installed into a workspace

## Boundaries

`pamem` provides the runtime only.

It does not replace:

- `notes/user-preferences.md`
- `notes/operating-rules.md`
- `notes/projects/*` as a CLI-local compatibility surface for `L2/projects/`
- runtime-local task state owned by CLI notes or by Slock
- the local sync executor workflow
