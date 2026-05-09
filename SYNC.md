# Sync

This document defines the sync contract for `pamem`.

`pamem` standardizes sync intent. The actual propagation backend remains
environment-specific.

## Core Rule

Ordinary agents do not run sync directly and do not start the sync executor
during session start. When durable local memory or managed workspace config
should be retained elsewhere, they create a PR or promotion request. The
packaged sync executor reviews that request and decides whether it becomes
effective shared memory.

`sync-request` is the fallback handoff path for agents that need a structured
intent queue. It is useful for compatibility, low-permission handoff, or offline
retention. It is not the mainline path once PR-based promotion and the packaged
sync executor are available.

## Packaged Executor

`pamem` ships a sync executor agent definition at `agents/sync-executor.md`.
It is packaged with the plugin, not seeded into the shared memory repo, and not
a memory profile.

The executor may:

- read pending requests
- validate and deduplicate requests
- run `memory-lint`
- merge or reject durable memory changes
- call `scripts/memory-sync.sh` when repo propagation is required

The executor must not be treated as a general task agent.

## Memory Sync Helper

`scripts/memory-sync.sh` is the repo-level sync helper. Installed workspaces
call it through `.pamem/scripts/memory-sync.sh`.

Supported backends:

- `local`: no remote sync
- `git`: commit and push the configured memory repo
- `webdav`: `rclone bisync` against the configured remote

Use `--dry-run` to print the resolved command. For WebDAV, `--resync` is
required when the local repo should win.

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
