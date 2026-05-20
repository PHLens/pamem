---
name: memory-lint
description: Run the report-only pamem memory lint against the memory repo configured by an agent-local config.toml or workspace-local .pamem/config.toml. Use when explicitly checking shared memory repo health, runtime mode, profile load/write targets, MEMORY.md pointers, or accidental repo-local config files.
---

# Memory Lint

Report-only lint for a pamem agent home or workspace and its configured memory repo.

The active config is local to the agent home or legacy workspace. This skill reads `<agent-home>/config.toml` or `<workspace>/.pamem/config.toml`, resolves `memory_repo.path`, then lints the configured memory repo. Do not require or create `.pamem/config.toml` inside the memory repo itself.

## Boundary

This skill must not:

- modify `config.toml` or `.pamem/config.toml`
- modify memory repo files
- repair missing files
- promote memory requests
- run repository propagation
- run automatically from startup or compact hooks

It may:

- read an agent-local `config.toml` or workspace-local `.pamem/config.toml`
- read the configured memory repo
- report missing profile load/write targets
- report missing `MEMORY.md` pointers
- report invalid runtime mode
- report oversized entry files
- report accidental `.pamem/config.toml` files inside the memory repo
- report incomplete or unapplied `[memory_repo.git]` author config

## Command

```bash
scripts/memory-lint.sh --root <agent-home-or-workspace>
```

JSON output:

```bash
scripts/memory-lint.sh --root <agent-home-or-workspace> --json
```

Strict mode returns non-zero for warnings:

```bash
scripts/memory-lint.sh --root <agent-home-or-workspace> --strict
```

Exit codes:

- `0`: no errors, and no warnings unless `--strict` is omitted
- `1`: lint errors, or warnings with `--strict`
- `2`: invalid input or missing local config
