---
name: memory-lint
description: Report-only pamem memory lint for configured memory repositories. Use when explicitly checking a memory repo with .pamem/config.toml for stable target, entry file, pointer, boundary, and cleanup issues.
---

# Memory Lint

Report-only lint for configured pamem memory repositories.

This capability is explicit and read-only. It validates the configured memory repo boundary and reports issues, but it does not repair files, promote requests, or run automatically from hooks.

## Boundary

It must not:

- modify `entry_file`
- modify files under `notes_dir`
- stage or promote external knowledge notes
- mutate request artifacts
- run as part of startup or compact hooks
- block config discovery or profile loading
- sync, promote, or apply memory changes

It may:

- read an explicitly provided memory root
- require `.pamem/config.toml` with `kind = "memory-repo"`
- read `entry_file`, `notes_dir`, `[requests].inbox_dir`, `profiles.*.load`, and `profiles.*.stable_targets`
- report stable target, entry file, pointer, boundary, duplicate, and cleanup findings
- emit human-readable or JSON reports

## Commands

- `scripts/memory-lint.sh`

## Usage

```text
scripts/memory-lint.sh --memory-root /path/to/memory-repo
```

JSON report:

```text
scripts/memory-lint.sh --memory-root /path/to/memory-repo --json
```

Important options:

- `--memory-root`: required path containing `.pamem/config.toml`.
- `--json`: emit structured report.
- `--strict`: return exit code `1` when warnings are present.

Exit codes:

- `0`: no lint errors.
- `1`: lint errors, or warnings with `--strict`.
- `2`: invalid input, including missing config, invalid config, non-memory-repo config, or missing memory root.

## References

- `docs/superpowers/specs/2026-04-28-memory-lint-config-first-design.md`
- `DESIGN.md`
