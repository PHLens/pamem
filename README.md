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
- sync-request support

It is the runtime, not the memory content itself.

The memory content should live in an explicitly configured private memory store when cross-runtime continuity matters. That store may be local-only, synced by a private Git repository, or handled by another private backend.

A memory store can expose profiles for roles such as developer, reviewer, architect, and QA while still remaining one repository. Stable memory updates should be staged as reviewable requests before promotion.

This keeps the model clear:

- `pamem` repository: runtime, hooks, skills, templates, governance
- `pamem` memory store: private user/workspace memory and project recovery context
- external wiki: shared professional knowledge, source notes, and curated domain indexes

## How

### Claude Code

```bash
claude plugin marketplace add git@github.com:PHLens/pamem.git
claude plugin install pamem@phlens --scope project
```

Codex bootstrap reuses that same marketplace install by symlinking the
workspace `.pamem/scripts` and `.pamem/assets` paths back to the installed
plugin runtime.

### More

- [DESIGN.md](DESIGN.md): memory layers, design philosophy, and plugin responsibilities
- [SYNC.md](SYNC.md): how `pamem` works with `sync-request` and external sync executors
- [INSTALL.md](INSTALL.md): Codex install, repair, update, and removal
