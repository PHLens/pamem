# Codex Install Guide

This guide covers Codex bootstrap for `pamem`.

For the plugin overview, memory-layer model, and Claude install command, see [README.md](README.md).

Codex bootstrap is workspace-local. It does not install or enable the Claude plugin and it does not modify `.claude/settings.json`.

## Install

Codex reuses the Claude marketplace-installed runtime. The bootstrap keeps the
workspace-local hooks and memory files, but points `.pamem/scripts` and
`.pamem/assets` back to the installed plugin with symlinks.

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

- `MEMORY.md`
- `notes/user-preferences.md`
- `notes/agent-workflow.md`
- `notes/findings.md`
- `notes/current-task.md`
- `notes/work-log.md`
- `.codex/config.toml`
- `.codex/hooks.json`
- `.pamem/`

Within `.pamem/`, the managed `scripts/` and `assets/` entries are symlinks to
the installed Claude marketplace plugin rather than copied runtime files.

## Verify

After installation, check:

- `MEMORY.md` exists
- `notes/current-task.md` exists
- `.pamem/` exists
- `.codex/config.toml` enables `codex_hooks = true`
- `.codex/hooks.json` contains the `SessionStart` hook for `.pamem/scripts/memory-session-start.sh`
- startup loads the memory index

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
- `notes/agent-workflow.md`
- `notes/projects/*`
- `notes/current-task.md`
- Adam's local `agent-sync` executor workflow
