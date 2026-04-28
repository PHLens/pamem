# Memory Lint Config-First Design

Status: approved design
Date: 2026-04-28

## Goal

Define the next memory lint iteration as a config-first memory repository governance tool.

Memory lint should no longer preserve the migrated prototype's V0 assumptions. It should validate a configured memory repository and report quality issues against the repository's declared memory boundaries.

The core model is:

```text
.pamem/config.toml
  kind = "memory-repo"
  entry_file
  notes_dir
  requests.inbox_dir
  profiles.*.load
  profiles.*.stable_targets
```

`stable_targets` are the files a profile may use for durable memory writes. They are the primary lint boundary.

## Non-Goals

This phase does not:

- preserve V0 lint inference
- preserve `.writeback/intents` lint behavior
- support `--workspace`
- support `--intent`
- define a `requests/inbox` request file schema
- inspect request file contents
- auto-fix memory files
- run from startup or pre-compact hooks
- enable profile-aware startup loading
- promote, reject, sync, or apply memory changes

## Command Boundary

The command remains explicit and read-only:

```bash
scripts/memory-lint.sh --memory-root /path/to/memory-repo --json
```

`--memory-root` must point at the actual memory repository. A source or bootstrap directory is not a valid lint target.

Rules:

- `.pamem/config.toml` is required.
- The config must be valid.
- The config must declare `kind = "memory-repo"`.
- `kind = "source"` is an input error for memory lint.
- Missing or invalid config exits with code `2`.
- Lint does not fall back to V0 layout inference.

This differs from startup behavior. Startup may fall back for runtime safety, but lint is a governance command and should fail fast on invalid inputs.

## Config Model

Memory lint should read `.pamem/config.toml` and build a normalized lint model:

```text
entry_file
notes_dir
requests_inbox_dir
profiles
stable_targets = union(profiles.*.stable_targets)
load_paths = union(profiles.*.load)
```

`entry_file` is the startup index file. It is checked for pointer health, size, transcript-like content, and domain explanation leakage.

`notes_dir` is the content boundary for durable memory notes.

`requests_inbox_dir` is the configured request inbox. This phase only checks path health, not request file shape.

`load_paths` are profile load inputs. Because profile-aware startup loading is not active yet, missing load paths are warnings rather than errors.

`stable_targets` are durable memory write targets. They are stricter than load paths.

Profiles remain optional for runtime config validation, but memory lint requires at least one configured stable target. A memory repo with no stable targets is valid for startup discovery but not useful as a stable-memory lint target.

## Stable Target Policy

Every `profiles.*.stable_targets` item must:

- be a relative memory repo path already accepted by config validation
- exist
- be a file
- be under `notes_dir`
- not equal `entry_file`

Violations are lint errors.

If no profiles define any stable targets, lint reports a config-derived lint error instead of silently passing.

Multiple profiles may share a stable target.

Missing stable targets are errors, not warnings. If a profile should write to a future file, the file should be created first with a small heading so the target can be reviewed and linted.

## Requests Inbox Policy

Memory lint should resolve `[requests].inbox_dir`, defaulting to `requests/inbox`.

This phase checks:

- the inbox path is inside the memory repo through config validation
- whether the directory exists

If the inbox directory does not exist, lint reports a warning. The directory is useful for future request workflows, but absence should not block current stable memory governance.

This phase does not scan request files or define request metadata.

## Rule Set

Existing high-value rules should be retained only after moving their scope to config-defined paths.

### Stable Target Rules

`ML001`: Domain or wiki-stage content appears in a stable target.

- Severity: error
- Applies to: config-defined stable targets
- Suggested action: `stage-wiki-note`

`ML002`: Mixed content appears in a stable target without an explicit pending split review marker.

- Severity: error
- Applies to: config-defined stable targets
- Suggested action: `request-review`

`ML004`: Transient or discard-routed content appears in a stable target.

- Severity: warning
- Applies to: config-defined stable targets
- Suggested action: `discard`

`ML008`: A stable target entry lacks a valid `type` marker.

- Severity: warning
- Applies to: config-defined stable targets
- Valid types: `finding`, `correction`, `meta`
- Suggested action: `request-review`

`ML009`: Possible duplicate stable memory entries exist across stable targets.

- Severity: info
- Applies to: config-defined stable targets
- Suggested action: `request-review`

### Entry File Rules

`ML004`: Transient or discard-routed content appears in the entry file.

- Severity: warning
- Applies to: `entry_file`
- Suggested action: `discard`

`ML006`: Entry file is too large, transcript-like, contains oversized paragraphs, too many code blocks, or domain explanations.

- Severity: warning
- Applies to: `entry_file`
- Suggested action: `request-review`

`ML007`: Entry file points to a missing local note.

- Severity: error
- Applies to: `entry_file`
- Suggested action: `request-review`

### Config-Derived Rules

`ML010`: Memory lint input is missing config, has invalid config, or points at a non-memory-repo config.

- Severity: input error
- Exit code: `2`

`ML011`: No stable targets are configured, or a stable target is missing, is not a file, is outside `notes_dir`, or equals `entry_file`.

- Severity: error
- Applies to: `profiles.*.stable_targets`
- Suggested action: `request-review`

`ML012`: The configured request inbox directory does not exist.

- Severity: warning
- Applies to: `[requests].inbox_dir`
- Suggested action: `request-review`

`ML013`: A profile load path does not exist.

- Severity: warning
- Applies to: `profiles.*.load`
- Suggested action: `request-review`

## Deleted Legacy Surface

The old migrated prototype behavior should be removed rather than preserved:

- hardcoded V0 stable paths:
  - `notes/user-preferences.md`
  - `notes/agent-workflow.md`
  - `notes/experience.md`
  - `notes/projects/*.md`
- hardcoded working paths:
  - `notes/current-task.md`
  - `notes/work-log.md`
- `.writeback/intents` batch validation
- intent `source_ref` correlation
- low-confidence intent item validation
- review-required intent application validation
- `--workspace`
- `--intent`

Future request lint should target `requests/inbox` after the request schema is designed.

## Output

JSON output should remain report-first and add config diagnostics:

```json
{
  "schema_version": "0.1",
  "lint_id": "2026-04-28T12-00-00Z__memory_lint",
  "created_at": "2026-04-28T12:00:00Z",
  "memory_root": "/path/to/memory",
  "config": {
    "path": "/path/to/memory/.pamem/config.toml",
    "schema_version": "0.1",
    "kind": "memory-repo",
    "name": "agent-memory",
    "entry_file": "MEMORY.md",
    "notes_dir": "notes",
    "requests_inbox_dir": "requests/inbox",
    "profiles": ["developer", "reviewer"],
    "stable_targets": [
      "notes/shared/experience.md",
      "notes/roles/developer.md"
    ],
    "load_paths": [
      "MEMORY.md",
      "notes/shared/preferences.md"
    ]
  },
  "summary": {
    "error_count": 0,
    "warning_count": 0,
    "info_count": 0
  },
  "findings": []
}
```

Human output should stay concise:

- summary
- finding id
- severity
- rule
- path and line when available
- suggested action

## Exit Codes

- `0`: no lint errors
- `1`: one or more lint errors, or warnings with `--strict`
- `2`: invalid input, including missing config, invalid config, non-memory-repo config, or missing memory root

## Documentation Updates

Implementation should update:

- `README.md`: document that memory lint requires `.pamem/config.toml`
- `skills/memory-lint/SKILL.md`: remove prototype/V0/writeback wording and document config-first usage
- `docs/drafts/2026-04-28-memory-lint-migration.md`: mark the migrated prototype as superseded by this design

## Testing Strategy

Tests should cover:

- missing config exits `2`
- `kind = "source"` exits `2`
- invalid config exits `2`
- valid memory repo config with clean stable targets passes
- memory repo config with no stable targets reports `ML011` error
- missing stable target reports `ML011` error
- stable target outside `notes_dir` reports `ML011` error
- stable target equal to `entry_file` reports `ML011` error
- missing load path reports `ML013` warning
- missing requests inbox reports `ML012` warning
- entry file pointer checks use `entry_file`, not hardcoded `MEMORY.md`
- domain, mixed, transient, type, duplicate, and size rules apply to config-defined files only
- removed CLI options `--workspace` and `--intent` are rejected by argparse

## Open Decisions

There are no open decisions for this phase.
