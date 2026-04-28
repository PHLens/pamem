# Memory Config Phase 1 Design

Status: approved design
Date: 2026-04-28

## Goal

Phase 1 defines how `pamem` finds, materializes, and validates a memory repository while keeping `pamem` itself as runtime code rather than memory content.

The core split is:

```text
pamem runtime repo
  hooks, scripts, skills, templates, governance

memory repo
  private memory content, profiles, requests, archive
```

Agent startup normally happens from the memory repo. When the memory repo is remote or lives elsewhere locally, startup may happen from a bootstrap directory whose config points to the memory repo.

## Non-Goals

Phase 1 does not:

- enable profile-aware loading
- run memory lint
- create or consume memory request files
- commit, push, or sync memory changes
- auto-update existing git clones during startup
- define a project-workspace pointer model
- change V0 behavior when config is absent

## Config File

All config uses:

```text
.pamem/config.toml
```

Every config must declare:

```toml
schema_version = "0.1"
kind = "source" # or "memory-repo"
```

`kind` is required. Phase 1 must not infer config type from field combinations.

## Source Config

`kind = "source"` is used in a bootstrap directory. It resolves a usable local memory repo.

### Local Source

```toml
schema_version = "0.1"
kind = "source"

[source]
type = "local"
path = "../agent-memory"
```

Rules:

- `path` is required.
- `path` must be relative to the bootstrap root.
- `path` may resolve outside the bootstrap root.
- the target must exist.
- the target must contain `.pamem/config.toml` with `kind = "memory-repo"`.

### Git Source

```toml
schema_version = "0.1"
kind = "source"

[source]
type = "git"
remote = "git@github.com:example/agent-memory.git"
ref = "main"
local_path = ".pamem/memory"
```

Rules:

- `remote` is required.
- `ref` is optional and defaults to `main`.
- `local_path` is optional and defaults to `.pamem/memory`.
- `local_path` must be relative to the bootstrap root.
- `local_path` must resolve under the bootstrap root's `.pamem/` directory.
- if `local_path` does not exist, Phase 1 clones `remote` at `ref` into it.
- if `local_path` exists, startup validates it but does not automatically pull.
- if `local_path` exists but is not a git repository, validation fails.
- the materialized repo must contain `.pamem/config.toml` with `kind = "memory-repo"`.

Phase 1 does not commit, push, or resolve git conflicts.

## Memory Repo Config

`kind = "memory-repo"` is used inside the actual memory repo.

```toml
schema_version = "0.1"
kind = "memory-repo"
name = "agent-memory"
entry_file = "MEMORY.md"
notes_dir = "notes"
default_profile = "developer"

[requests]
inbox_dir = "requests/inbox"

[profiles.developer]
description = "Developer profile."
load = [
  "MEMORY.md",
  "notes/shared/preferences.md",
  "notes/shared/workflow.md",
  "notes/shared/experience.md",
  "notes/roles/developer.md",
]
stable_targets = [
  "notes/shared/experience.md",
  "notes/roles/developer.md",
]
```

Required fields:

- `schema_version`
- `kind`
- `name`
- `entry_file`
- `notes_dir`

Optional fields:

- `default_profile`
- `[requests].inbox_dir`
- `[profiles.*]`

Defaults:

- `[requests].inbox_dir` defaults to `requests/inbox`.

## Path Policy

Memory repo internal paths must:

- be relative
- resolve from the memory repo root
- stay inside the memory repo after normalization

This applies to:

- `entry_file`
- `notes_dir`
- `requests.inbox_dir`
- profile `load`
- profile `stable_targets`

Absolute paths and escaping paths are invalid inside memory repo config.

Local source `path` is different: it is relative to the bootstrap root and may point outside the bootstrap root to an existing memory repo.

Git source `local_path` is also different: it is relative to the bootstrap root but must stay under the bootstrap root's `.pamem/` directory.

## Profiles

Profiles are optional in Phase 1.

If present, every profile must include:

- `description`
- `load`
- `stable_targets`

`load` and `stable_targets` must be arrays of strings.

`default_profile` is optional. If present, it must name an existing profile.

Phase 1 validates and reports profile metadata, but it does not use profiles to change startup loading.

## Requests Inbox

Memory update requests are represented by a configured inbox directory:

```toml
[requests]
inbox_dir = "requests/inbox"
```

This is a future replacement direction for the current standalone `sync-request` queue model. The request inbox belongs to the memory repo and is intended for later writeback consumption.

Phase 1 only validates and reports the path. It does not create request files, consume request files, archive applied requests, or record rejected requests.

Applied and rejected request directories are intentionally not part of Phase 1. They can be added later if git history and writeback records are not enough.

## Materialization

Phase 1 materialization produces a local memory repo path.

Direct memory repo:

```text
<cwd>/.pamem/config.toml kind=memory-repo
```

- `<cwd>` is the memory repo.
- validate memory repo config.
- use V0 `MEMORY.md` loading behavior.

Local source:

```text
<cwd>/.pamem/config.toml kind=source, source.type=local
```

- resolve `source.path`.
- validate the target as a memory repo.
- use the target as memory root.

Git source:

```text
<cwd>/.pamem/config.toml kind=source, source.type=git
```

- resolve `source.local_path`, defaulting to `.pamem/memory`.
- clone if the local path is missing.
- if the local path exists, validate without automatic pull.
- use the materialized repo as memory root.

An explicit update CLI may fetch or pull later. Startup does not auto-update existing clones.

## Startup Behavior

`memory-session-start.sh` should call the config helper and add a concise diagnostic line to startup context.

Startup must not activate profile-aware loading in Phase 1.

Expected diagnostics:

- no config: `Memory config: absent, using V0 layout`
- direct memory repo: `Memory config: memory-repo <name>, schema 0.1`
- source config: `Memory source: <local|git> -> <resolved memory repo>`
- invalid config: concise error diagnostic
- clone failure: materialization error diagnostic

If config is absent, invalid, or materialization fails, startup should fall back to V0 loading from the current directory where possible.

The CLI validator may return exit code `2` for invalid config. Startup should capture this and continue with a diagnostic instead of failing the session start hook.

## CLI Behavior

Phase 1 should expose `scripts/memory-config.sh` as a helper command that can:

- discover `.pamem/config.toml`
- validate source configs
- materialize missing git sources
- validate memory repo configs
- emit JSON diagnostics
- report concise human diagnostics when not using JSON

Exit policy:

- `0`: absent config, valid config, or warnings only
- `2`: invalid config or failed materialization

Suggested JSON fields:

- `status`
- `config_kind`
- `bootstrap_root`
- `memory_root`
- `schema_version`
- `name`
- `source`
- `profiles`
- `default_profile`
- `requests`
- `warnings`
- `errors`

## Testing

Phase 1 tests should cover:

- absent config returns V0 diagnostics
- valid direct memory repo config
- missing required memory repo fields
- invalid schema version or config kind
- absolute or escaping memory repo paths
- optional profiles with valid diagnostics
- invalid `default_profile`
- missing profile `load` or `stable_targets` paths as warnings
- local source resolving a valid memory repo
- local source missing target
- git source cloning into `.pamem/memory`
- git source existing local repo validation without pull
- git source existing non-git path as invalid
- startup hook adding concise config diagnostics without profile-aware loading

Tests that exercise git should use local fixture repositories rather than network remotes.

## Acceptance Criteria

Phase 1 is complete when:

- `.pamem/config.toml` supports `kind = "source"` and `kind = "memory-repo"`.
- absent config remains a valid V0 state.
- local and git source configs can resolve a local memory repo.
- git source can clone a missing local repo into `.pamem/memory`.
- existing git clones are not auto-pulled during startup.
- memory repo config validates repo fields, optional requests inbox, and optional profiles.
- startup emits concise diagnostics without changing profile loading.
- invalid CLI validation returns exit code `2`.
- docs state that profile-aware loading, writeback, request consumption, and sync are later phases.
