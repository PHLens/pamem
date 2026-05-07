---
name: memory-lint
description: Run the report-only pamem memory lint against the memory repo configured by a workspace-local .pamem/config.toml. Use when explicitly checking shared memory repo health, profile load/write targets, MEMORY.md pointers, active roster cleanup, or accidental repo-local config files.
---

# Memory Lint

Report-only lint for a pamem workspace and its configured memory repo.

The active config is workspace-local. This skill reads `<workspace>/.pamem/config.toml`, resolves `memory_repo.path`, then lints the configured memory repo. Do not require or create `.pamem/config.toml` inside the memory repo itself.

## Boundary

This skill must not:

- modify `.pamem/config.toml`
- modify memory repo files
- repair missing files
- promote memory requests
- run sync
- run automatically from startup or compact hooks

It may:

- read a workspace-local `.pamem/config.toml`
- read the configured memory repo
- report missing profile load/write targets
- report missing `MEMORY.md` pointers
- report stale or unlisted active task files
- report oversized entry files
- report accidental `.pamem/config.toml` files inside the memory repo

## Command

```bash
scripts/memory-lint.sh --root <workspace>
```

JSON output:

```bash
scripts/memory-lint.sh --root <workspace> --json
```

Strict mode returns non-zero for warnings:

```bash
scripts/memory-lint.sh --root <workspace> --strict
```

Exit codes:

- `0`: no errors, and no warnings unless `--strict` is omitted
- `1`: lint errors, or warnings with `--strict`
- `2`: invalid input or missing workspace-local config
