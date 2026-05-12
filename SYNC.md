# Sync

This document defines the sync contract for `pamem`.

`pamem` standardizes sync intent. The actual propagation path is git-only.

## Core Rule

Ordinary agents do not run sync directly and do not start the sync executor
during session start. When durable local memory or managed workspace config
should be retained elsewhere, they create a PR or promotion request. The
packaged sync executor reviews that request and decides whether it becomes
effective shared memory.

`sync-request` is the fallback handoff path for agents that need a structured
intent queue. It is useful for compatibility, low-permission handoff, or offline
retention. It is separate from the core memory layers and is not the mainline
path once PR-based promotion and the packaged sync executor are available.

## Packaged Executor

`pamem` ships a sync executor agent definition at `agents/sync-executor.md`.
It is packaged with the plugin, not seeded into the shared memory repo, and not
a memory profile.

The executor may:

- read pending requests
- validate and deduplicate requests
- run `pamem pr-check` and `memory-lint`
- merge or reject durable memory changes
- propagate the configured memory repo with git when policy says to do so

The executor must not be treated as a general task agent.

For PR-based promotion, the executor runs
`pamem pr-check --head <candidate-ref> --target <declared-surface>` before
merge. `--base` may be supplied when reviewing against a protected ref other
than `memory_repo.sync.ref`. Guarded surfaces require explicit review and
`--allow-guarded`; this flag is an audit signal, not a way to skip review.

The shared memory repo is initialized as a git repository during bootstrap. If
no git remote is configured, the executor reports the repo path and tells you to
add a git remote for that repo before propagation.

## When To Use Requests

Use a sync request when a change is durable and should outlive the current
workspace, for example:

- `MEMORY.md`
- stable notes
- managed workspace config
- reusable findings that should move across devices

Do not use a request for:

- scratch notes
- transient planning files
- source code or branch history
- PR status
- project work whose main purpose is delivery rather than memory retention

## Roles

### Workspace Agent

The workspace agent may:

- decide a durable change should be promoted
- create or refresh a sync request
- provide the authoritative source paths

The workspace agent must not:

- process the queue
- mutate `processing`, `done`, or `rejected`
- run propagation logic directly under the sync request contract

### Sync Executor

The packaged sync executor, or another explicitly assigned executor, may:

- read `pending/`
- validate requests
- reject or deduplicate requests
- move requests through the queue
- propagate the configured memory repo when policy says to do so

## Queue Shape

The active sync configuration defines the queue layout. A typical shape is:

```text
<sync-queue-root>/
  pending/
  processing/
  done/
  rejected/
```

## Memory Layers

Sync requests usually touch:

- Layer 1 stable shared memory
- Layer 2 project memory
- durable runtime summaries that need future retention

They should not replace runtime-owned task handling. CLI task state stays local,
and Slock task state stays in Slock.
