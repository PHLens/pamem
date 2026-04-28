# pamem

`pamem` is a persistent agent memory runtime.

## Why

Persistent agent memory becomes unstable when every workspace assembles its own memory setup by hand.

`pamem` exists to provide one shared memory runtime for persistent agents.

## What

`pamem` provides the shared runtime for:

- memory governance
- startup hooks
- memory skeleton files
- explicit report-only memory lint
- sync-request support

It is the runtime, not the memory content itself.

The memory content should live in an explicitly configured private memory store when cross-runtime continuity matters. That store may be local-only, synced by a private Git repository, or handled by another private backend.

A memory store can expose profiles for roles such as developer, reviewer, architect, and QA while still remaining one repository. Stable memory updates should be staged as reviewable requests before promotion.

This keeps the model clear:

- `pamem` repository: runtime, hooks, skills, templates, governance
- `pamem` memory store: private user/workspace memory and project recovery context
- external wiki: shared professional knowledge, source notes, and curated domain indexes

### Memory Config

Phase 1 uses `.pamem/config.toml`.

The config can be either:

- `kind = "memory-repo"` inside the actual memory repository
- `kind = "source"` inside a bootstrap directory that points to a local or git-backed memory repository

Run:

```bash
scripts/memory-config.sh --root /path/to/bootstrap-or-memory-repo --json
```

Startup reports the config status but does not enable profile-aware loading yet.

## How

### Claude Code

```bash
claude plugin marketplace add git@github.com:PHLens/pamem.git
claude plugin install pamem@phlens --scope project
```

Codex bootstrap reuses that same marketplace install by symlinking the
workspace `.pamem/scripts` and `.pamem/assets` paths back to the installed
plugin runtime.

### Optional Checks

`scripts/memory-lint.sh` can run an explicit read-only health check on a configured memory repository:

```bash
scripts/memory-lint.sh --memory-root /path/to/memory-repo --json
```

The memory root must contain `.pamem/config.toml` with `kind = "memory-repo"`. Lint uses `entry_file`, `notes_dir`, `requests.inbox_dir`, and `profiles.*.stable_targets` from that config.

It is not run automatically and does not modify memory files.

### More

- [DESIGN.md](DESIGN.md): memory layers, design philosophy, and plugin responsibilities
- [docs/drafts/2026-04-28-memory-lint-migration.md](docs/drafts/2026-04-28-memory-lint-migration.md): superseded memory lint migration note
- [SYNC.md](SYNC.md): how `pamem` works with `sync-request` and external sync executors
- [INSTALL.md](INSTALL.md): Codex install, repair, update, and removal
