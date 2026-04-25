---
name: sync-request
description: Generate sync requests for Adam when durable local memory, reusable notes, or managed workspace config changes need cross-device retention. This skill is for memory/config retention only, not project work, source-code delivery, branch sync, or PR workflow.
---

# Sync Request

Use this skill to generate sync requests for Adam. This skill is shared across agents and only creates request files.

It is for **memory/config retention only**. It is **not** a mechanism for syncing project work, source code, Git branches, or PR status.

## Hard Boundary

- Do not run sync directly from this agent.
- Do not run `cfg add`, `git commit`, `git push`, `scp`, or remote copy/delete steps as part of this skill.
- Do not move request files into `processing`, `done`, or `rejected`.
- Do not edit another agent's request unless the user explicitly asks.
- Do not use this skill to propagate project work such as source code edits, repo branches, commits, or PR metadata.

## Queue Layout

Use the home-directory queue:

```text
~/sync-queue/
  pending/
  processing/
  done/
  rejected/
```

This skill only writes to `~/sync-queue/pending/`.

If the queue directories do not exist, create them before writing the request.

## When to Create a Sync Request

Create a request when durable local changes should be retained across devices or handed off to Adam for centralized sync.

Common cases:

- `MEMORY.md` changed in a way worth preserving
- `notes/` gained durable findings, corrections, or stable summaries
- Managed workspace config changed:
  - `.claude/skills/`
  - `.codex/skills/`
  - `.claude/settings.json`
  - `.codex/config.toml`
  - `.codex/hooks.json`
- A reusable note or summary should be copied into the synced notes workflow

Do not create a request for:

- Raw command output
- Task-local planning files
- Temporary scratch notes
- Open-task chatter that has not stabilized
- Source code changes by themselves unless a managed config or durable note also changed
- Project work deliverables such as feature branches, PRs, review state, or repository history
- Requests whose primary purpose is to ship code rather than retain memory or managed config

## Stable Rule and Preference Sources

When durable communication rules, workflow rules, or preferences change, list the authoritative files explicitly in `sources`.

Common examples:

- `<workspace>/MEMORY.md`
- `<workspace>/notes/user-preferences.md`
- `<workspace>/notes/agent-workflow.md`
- `<workspace>/notes/corrections.md`
- `<workspace>/notes/projects/<project-key>.md`

Rules:

- `type` does not replace `sources`; always list the files that actually need sync
- If a rule was promoted into shared global skill content such as `memory-rule`, request sync for the relevant tracked skill or config paths instead of per-agent local notes
- If a communication rule remains agent-local, sync the local authoritative file rather than copying the rule into multiple places

## Request Types

Use one of:

- `config-sync`
- `note-sync`
- `both`

Choose:

- `config-sync` for managed workspace or global config changes
- `note-sync` for durable summaries or reusable notes
- `both` when the same unit of work includes both kinds of changes

Do not use any request type to represent project-work transport. If the work is mainly code or repo state, it belongs in the normal project workflow, not `sync-request`.

## Request Schema

Write each request as JSON.

Required fields:

```json
{
  "request_id": "2026-04-15T14-30-00Z__binance__config-sync",
  "agent": "binance",
  "workspace": "/absolute/path/to/agent/workspace",
  "project": "binance-quant",
  "type": "config-sync",
  "status": "pending",
  "created_at": "2026-04-15T14:30:00Z",
  "updated_at": "2026-04-15T14:30:00Z",
  "sources": [
    "/absolute/path/to/file-or-dir"
  ],
  "deletions": [
    "/absolute/path/to/removed/file-or-dir"
  ],
  "summary": "Short summary of what changed.",
  "why_sync": "Why this should be preserved or propagated."
}
```

Optional fields:

- `deletions` — list of absolute paths that were removed and should be cleaned up on other devices (e.g. merged or moved files, stale skill directories)
- `constraints`
- `notes`
- `supersedes`

Rules:

- `workspace` should be an absolute path
- `sources` should use absolute paths
- `sources` should identify the authoritative files or directories to sync, including durable preference or communication files when relevant
- `deletions` should list paths that no longer exist and must be removed on other devices to prevent stale state (e.g. merged note files, moved skill directories)
- Do not include paths in `deletions` that are also in `sources`; if a file was replaced, list only the new path in `sources`
- `summary` should stay short and outcome-focused
- `why_sync` should explain future value, not replay a transcript

## File Naming

Use:

```text
~/sync-queue/pending/<request_id>.json
```

Recommended `request_id` format:

```text
<timestamp>__<agent>__<type>
```

Use a filesystem-safe UTC timestamp such as:

```text
2026-04-15T14-30-00Z
```

## Request Creation Workflow

1. Classify the change as `config-sync`, `note-sync`, or `both`
2. Collect the durable source paths that justify sync
3. Collect any paths that were deleted, moved, or merged and need cleanup on other devices → add to `deletions`
4. Write a short `summary`
5. Write a short `why_sync`
6. Ensure the queue directories exist
7. Check `~/sync-queue/pending/` for an obvious duplicate request from the same agent
8. If an equivalent pending request already exists, update it instead of creating a duplicate
9. Otherwise create a new JSON request in `pending/`
10. Report the request path back to the user

## Duplicate Handling

Treat a pending request as an obvious duplicate when all of these are true:

- Same `agent`
- Same `workspace`
- Same `type`
- Same `project` or both omit `project`
- Same source set or a clear superset of the same work

In that case:

- Update the existing pending request
- Refresh `updated_at`
- Refine `summary`, `why_sync`, and `sources` if needed
- Do not create a second request for the same unit of work

## Ownership Rules

- Ordinary agents may create or refresh their own pending requests
- Ordinary agents must not process the queue
- Adam is the sync executor and reads requests from the queue separately
- Adam may also use this skill when Adam needs to create a request for Adam-owned work

## Notes

- This skill is for request generation only
- Execution stays in Adam's local sync workflow
- Keep request files concise and structured
