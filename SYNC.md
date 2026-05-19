# Sync

This document defines the propagation contract for the configured pamem memory
repo.

## Core Rule

The main shared-memory path is:

```text
memory proposal -> memory owner PR/review -> merge -> pull/bootstrap
```

Pamem no longer exposes a separate request-generation skill or queue for
propagation. Durable shared memory becomes effective only after owner review
and repository merge. Other devices or workspaces receive the change through
normal git pull, bootstrap, or runtime startup against the configured memory
repo.

Workspace-local temporary memory, recovery notes, and work logs remain local
runtime state. They are not shared-memory promotion surfaces and are not
propagated by this contract.

## Memory Owner / Executor

`pamem` ships a memory executor agent definition at
`agents/memory-executor.md`. It is packaged with the plugin, not seeded into the
shared memory repo, and not a memory profile.

The executor may:

- review memory PRs and promotion requests
- run `pamem check` for Noesis memory proposals
- run `pamem pr-check` and memory lint before merge
- merge or reject durable memory changes
- propagate the configured memory repo with git when policy says to do so

The executor must not be treated as a general task agent.

For PR-based promotion, the executor runs
`pamem pr-check --head <candidate-ref> --target <declared-surface>` before
merge. `--base` may be supplied when reviewing against a protected ref other
than `memory_repo.sync.ref`. Guarded surfaces require explicit review and
`--allow-guarded`; this flag is an audit signal, not a way to skip review.

When a Noesis heuristic-system flow produces a `memory_proposal`, the executor
or memory owner first runs `pamem check <proposal.json> --json`. That gate only
validates the review artifact and owner boundary. It does not observe chats,
discover events, route signals, draft learning events, create promote requests,
or apply the proposal. Workspace-local temporary memory and runtime recovery
state remain available through explicit runtime paths; they are not part of the
shared-memory promotion flow. The later PR scope check still applies.

The shared memory repo is initialized as a git repository during bootstrap. If
no git remote is configured, the executor reports the repo path and tells you to
add a git remote for that repo before propagation.

## Proposal And Review Paths

Approved memory proposals can become effective memory in two ways:

- a memory PR against the configured memory repo
- a promotion request in `requests/inbox/` for explicit owner review

`requests/inbox/` is a memory-owner review queue. It is not a propagation queue
and not a loaded memory layer.

## Roles

### Workspace Agent

The workspace agent may:

- identify a durable memory candidate
- produce or hand off a proposal artifact
- open a memory PR when explicitly assigned owner/executor responsibility

The workspace agent must not:

- treat local recovery notes as shared memory
- run repository propagation during session start
- bypass memory owner review for guarded or cross-scope changes

### Memory Executor

The packaged memory executor, or another explicitly assigned executor, may:

- review memory PRs and `requests/inbox/` items
- run `pamem check`, `pamem pr-check`, and lint
- reject, accept, or ask for changes
- propagate the configured memory repo after merge when policy says to do so

## Memory Layers

Shared repo propagation usually touches:

- governance memory
- shared memory
- role memory
- project memory

It should not replace runtime-owned task handling. CLI task state stays local,
and Slock task state stays in Slock.
