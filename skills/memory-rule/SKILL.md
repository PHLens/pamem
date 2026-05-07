---
name: memory-rule
description: Governs profile-based agent memory loading, L0/L1/L2/L3 writes, promotion, compression, sync-request handoff, conflict repair, and archiving. Use when maintaining MEMORY.md, notes/, shared memory repos, or any persistent memory so agents keep stable behavior without turning memory into an unstructured log.
---

# Memory Rule

This plugin skill governs how persistent agent memory is structured, loaded, updated, promoted, archived, and handed off for optional sync.

## Hard Boundary

- This skill is the memory constitution, not a fact store.
- Do not put dynamic task facts inside this skill.
- Do not use `MEMORY.md` as a transcript, diary, evidence chain, or detailed work log.
- Do not merge `sync-request` into this skill; `sync-request` stays separate.
- Stable rules may constrain memory updates; mutable memory must not redefine stable rules.
- Memory does not replace project repositories, issue trackers, PRs, delivery artifacts, or external knowledge bases.

## Core Principle

**`MEMORY.md` is a thin startup index, not a transcript.**

```text
MEMORY.md          = human-readable startup index and pointers
.pamem/config.toml = machine-readable profile, memory repo location, load, write, and sync policy when present
L0/ or this skill   = constitution and governance
L1/ or notes/       = stable shared, role, preference, and experience memory
L2/ or notes/       = project and active task memory
L3/ or notes/       = archive summaries not loaded by default
requests/           = reviewable memory-promotion requests
.pamem/scripts/memory-sync.sh = repo-level sync helper for the configured memory repo backend
sync-request        = separate request-generation skill for cross-device retention
```

Keep persistent memory files in English unless there is an explicit local exception.

## Supported Layouts

Pamem supports both the current per-agent notes scaffold and a shared memory repo layout. Prefer the shared layout when multiple agents should reuse stable memory.

### Shared Memory Repo

```text
<agent-workspace>/
  .pamem/
    config.toml        # points at memory_repo.path

agent-memory/
  MEMORY.md
  L0/
    constitution.md
  L1/
    shared/
      preferences.md
      workflow.md
      experience.md
    roles/
      coder.md
      reviewer.md
      researcher.md
      onboarding.md
  L2/
    projects/
      <project-key>.md
    active/
      current-tasks.md
      <task-id>.md
  L3/
    work-log.md
    archive/
  requests/
    inbox/
    promoted/
    rejected/
```

### Per-Agent Notes Fallback

```text
<agent-workspace>/
  MEMORY.md
  notes/
    user-preferences.md
    agent-workflow.md
    experience.md
    current-task.md
    work-log.md
    projects/
      <project-key>.md
```

Map fallback files to the same layers:

- `notes/user-preferences.md`, `notes/agent-workflow.md`, and `notes/experience.md` are L1.
- `notes/projects/<project-key>.md` and `notes/current-task.md` are L2.
- `notes/work-log.md` is L3.

## Memory Layers

### Layer 0: Constitution

Layer 0 defines the memory operating model:

- structure and layer semantics
- startup load rules
- profile selection
- precedence and conflict rules
- write gates
- promotion and archival lifecycle
- sync-request handoff boundary

Layer 0 includes this skill, non-editable startup rules, and `L0/constitution.md` when a shared memory repo provides one. It must not be auto-mutated by ordinary task agents.

The following communication rules are also treated as Layer 0 shared rules:

- Private or DM-scoped content is private by default; do not forward or restate it outside the intended audience unless explicitly asked.
- Reply in the same conversation or thread by default; do not reroute the discussion unless explicitly requested.
- Treat `@someone` as the intended actor by default; do not take over instructions aimed at another person unless explicitly delegated.
- Visible replies should add new information; avoid empty acknowledgments or status noise.

### Layer 1: Stable Shared Memory

Layer 1 contains durable memory that should survive across tasks and be reusable by multiple sessions or agents.

Examples:

- global collaboration preferences
- shared workflow rules
- durable corrections and prohibitions
- reusable technical findings with future decision value
- methodological experience and meta-knowledge
- role-shared memory such as `L1/roles/coder.md` and `L1/roles/reviewer.md`

Role memory belongs in L1 because it is stable shared experience for a role. It is loaded through a profile overlay and does not outrank project-specific rules.

### Layer 2: Project And Working Memory

Layer 2 contains specific project context and active resumable task state.

Examples:

- `L2/projects/<project-key>.md`
- `L2/active/current-tasks.md`
- `L2/active/<task-id>.md`
- `notes/projects/<project-key>.md`
- `notes/current-task.md`

Project-specific memory belongs in L2, not L1. Project context usually changes faster than role experience and should not pollute global stable memory.

### Layer 3: Archive

Layer 3 preserves closed-task summaries and historical context that should not be loaded by default.

Examples:

- `L3/work-log.md`
- `L3/archive/<date-or-task>.md`
- `notes/work-log.md`

Archive stores summaries, not transcripts or raw evidence chains.

## Profile Configuration

When `.pamem/config.toml` exists, it is the machine-readable source for profiles, memory repo location, sharing mode, load targets, write targets, and sync policy. `MEMORY.md` should point to it instead of duplicating its details.

For onboarding, seed `.pamem/config.toml` from `assets/config.toml.template` and then replace the placeholders with the workspace's actual repo path, sharing mode, sync backend, queue root, executor, and profile owners.

The shared repo is resolved through:

```toml
[memory_repo]
path = ".pamem/memory"
sharing = "shared"
entry_file = "MEMORY.md"

[memory_repo.sync]
backend = "local"
remote = ""
ref = "main"
sync_bootstrapped = false
```

Example shape:

```toml
[profiles.coder]
role = "coder"
load = [
  "L0/constitution.md",
  "L1/shared/preferences.md",
  "L1/shared/workflow.md",
  "L1/shared/experience.md",
  "L1/roles/coder.md",
  "L2/projects/pamem.md",
  "L2/active/current-tasks.md",
  "L2/active/task-123.md"
]
write = [
  "L2/active/current-tasks.md",
  "L2/active/task-123.md",
  "requests/inbox/"
]
guarded_write = [
  "L1/roles/coder.md"
]
```

Rules:

- Profiles describe what to load; they do not create new precedence.
- Role-specific memory is a profile overlay loaded from L1.
- Project memory is loaded from L2 and wins over role memory on conflict.
- Ordinary task agents should write active task state and promotion requests, not stable shared files.
- `guarded_write` means the agent may update the target only when the change is high-confidence, reusable across tasks, and allowed by local policy; otherwise create a promotion request.
- Config changes that alter ownership, precedence, or sync policy should be treated as governance changes and reviewed by the config owner or onboarding profile.
- If no config exists, use the per-agent notes fallback load order.

## Startup Load Workflow

On wake-up:

1. Read `MEMORY.md`.
2. If present, read `.pamem/config.toml`, resolve `memory_repo.path`, and select the requested or default profile.
3. Load the repo entry file from `memory_repo.entry_file`; default is `MEMORY.md`.
4. Load L0 constitution sources for that profile.
5. Load L1 shared memory.
6. Load the L1 role overlay for the profile.
7. Load L2 project memory for the active project.
8. Load L2 active task memory only when a task is open.
9. Do not load L3 archive or `requests/` by default.
10. If using the shared repo layout, prefer `L2/active/current-tasks.md` as the startup-safe active roster and keep `notes/current-task.md` only for fallback workspaces.

Fallback load order when `.pamem/config.toml` is absent:

1. `MEMORY.md`
2. `notes/user-preferences.md`
3. `notes/agent-workflow.md`
4. `notes/experience.md`
5. `notes/projects/<project-key>.md`, if the current project has one
6. `notes/current-task.md`, only if a task is still open

## Precedence Rules

Current system, developer, and explicit user instructions outrank memory. Within memory, higher precedence wins:

1. L0 constitution
2. L1 shared memory
3. L2 project memory
4. L1 role memory loaded through the active profile
5. L2 active task memory
6. L3 archive

Lower-precedence memory may extend but must not override higher-precedence memory.

Important consequences:

- Project-specific memory wins over role memory.
- Role memory can provide defaults, habits, and reusable role experience, but project constraints override it.
- Active task memory can record current state and next steps, but it cannot redefine stable rules.
- Archive is historical context and never an active rule source unless explicitly re-promoted.

## Write Gate

Before writing any memory, classify it:

- Is it stable across sessions?
- Will it affect future decisions or behavior?
- Is it a rule, preference, correction, reusable finding, project fact, or active task state?
- Is it a summary rather than raw evidence?
- Which layer owns it?
- Does an existing entry already cover it?
- Is direct write allowed by the active profile or local policy?

If the answer is no to long-term value, do not write it to stable memory.

## Where To Write

| Type | Shared layout | Fallback layout | Notes |
|---|---|---|---|
| Global collaboration preferences | `L1/shared/preferences.md` | `notes/user-preferences.md` | Durable communication and collaboration preferences |
| Shared workflow rules | `L1/shared/workflow.md` | `notes/agent-workflow.md` | Stable workflow defaults; must not override L0 |
| Role-shared experience | `L1/roles/<role>.md` | `notes/experience.md` with role scope | Reusable role memory such as coder/reviewer habits |
| Error corrections and prohibitions | `L1/shared/experience.md` or `L1/roles/<role>.md` | `notes/experience.md` | Use `type: correction`; avoid duplicates |
| Reusable technical findings | `L1/shared/experience.md` or `L1/roles/<role>.md` | `notes/experience.md` | Outcomes only, never raw evidence chains |
| Methodological meta-knowledge | `L1/shared/experience.md` or `L1/roles/<role>.md` | `notes/experience.md` | Tool tips, workflow improvements, corrected assumptions |
| Project-specific rules and facts | `L2/projects/<project-key>.md` | `notes/projects/<project-key>.md` | Project wins over role on conflict |
| Active roster | `L2/active/current-tasks.md` | `notes/current-task.md` | Startup-safe active task list; remove completed tasks |
| Active task state | `L2/active/<task-id>.md` | `notes/current-task.md` | Startup-safe summary and pointers only |
| Memory promotion request | `requests/inbox/<request-id>.md` | local request note or user-visible task thread | For review before stable writes |
| Closed task summary | `L3/work-log.md` or `L3/archive/` | `notes/work-log.md` | Newest first; summaries only |

## Promotion Policy

Stable shared memory should change by promotion, not by casual append.

Promote to L1 only when:

- explicitly requested by the user,
- clearly durable across tasks,
- repeated often enough to be reliable,
- likely to affect future behavior, or
- approved by a human or an onboarding profile responsible for memory curation.

Use `requests/inbox/` for proposed promotions when direct write is not authorized. A promotion request should include:

- target layer and file
- proposed change
- source context or task pointer
- reason it is durable
- conflict or supersession notes

Promotion decisions:

- accepted changes move into the target memory file and the request moves to `requests/promoted/`.
- rejected changes move to `requests/rejected/` with a short reason.
- ordinary task agents must not silently promote contentious or cross-scope rules.

Keep in L2 when the content is:

- relevant only to the current task,
- useful for resume and recovery,
- project-specific and still changing, or
- likely to expire at task completion.

Archive to L3 when:

- the task is closed,
- a concise summary is enough for future recall, or
- detailed process history is no longer needed in startup context.

## Sync-Request Boundary

Do not merge `sync-request` into `memory-rule`.

`memory-rule` owns the decision gate for whether a memory or managed-config change is durable. `sync-request` owns the separate act of creating a structured request for cross-device retention.

Use `sync-request` only when:

- the user explicitly asks for sync or retention, or
- workspace policy explicitly requires a sync request for this durable memory/config change.

Do not create unsolicited sync requests from ordinary memory maintenance.

Never use `sync-request` for:

- source-code delivery,
- feature branches,
- PR creation or review status,
- project work transport,
- raw command output,
- task-local planning files, or
- unstable in-progress chatter.

Do not use the sync queue as the memory promotion queue. Use `requests/inbox/` or a task thread for promotion review.

`memory-sync.sh` is separate from `sync-request`: it is the repo-level helper a sync executor may call after policy decides the configured memory repo should be propagated. Ordinary task agents should not run it unless explicitly assigned executor responsibility.

## Multi-Instance Concurrency

When multiple agent instances run concurrently, shared memory files become write-contended. The following rules prevent data loss and merge conflicts.

### Principles

- L0 and L1 shared files are read-only during ordinary task execution unless the active profile explicitly permits guarded write.
- `MEMORY.md` is a shared index and pointer list, not an isolation boundary.
- L2 active task state must live in per-task files such as `L2/active/<task-id>.md` or in the task worktree.
- The shared active roster belongs in `L2/active/current-tasks.md`; fallback workspaces keep it in `notes/current-task.md`.
- Shared pointer files contain only short lines pointing to the authoritative task state.
- Stable memory writes happen at task completion or through promotion review.

### Pointer Format

When multiple instances may be active, pointer files use a list format so entries from different instances coexist:

- `MEMORY.md` Active Context: one line per active task, format `<project>: <brief description> -> <pointer to L2/active or notes/current-task>`.
- `L2/active/current-tasks.md` or `notes/current-task.md`: the active roster for the workspace, listing active worktrees or task files in the format `<worktree-path or task-id> -> <one-line task description>`.

When more than 3 instances are active, do not try to list every instance in `MEMORY.md`. Keep `MEMORY.md` as a startup dashboard:

- one line for the lead blocker, if any
- one line for the current primary workstream
- one line pointing to the full active roster, such as `L2/active/current-tasks.md` or `notes/current-task.md`

The full roster belongs in `L2/active/current-tasks.md`, `notes/current-task.md`, or per-task L2 files. Compressing `MEMORY.md` removes startup noise only; it must not delete task state.

### Conflict Tolerance

If last-write-wins occurs on a pointer file:

- The loss is limited to a pointer line, not task content.
- Full state is recoverable from the task file or worktree progress file.
- Do not attempt file-locking or atomic-append protocols by default; the pointer format keeps recovery simple.

### Write Sequencing

1. Task start: create or update the L2 task file and add a pointer line if needed.
2. Task execution: write task state only to L2 active files or task-local planning files.
3. Task completion: remove the completed task from `MEMORY.md` and the active roster (`L2/active/current-tasks.md` or `notes/current-task.md`), update L2 project memory if needed, create promotion requests for L1 candidates, and archive a concise summary to L3.

## Current Task Vs Planning Files

Use L2 active task memory as the default startup-safe task summary.

- Shared layout: `L2/active/current-tasks.md` for the roster and `L2/active/<task-id>.md` for detailed per-task state
- Fallback layout: `notes/current-task.md`

Keep it short: task, status, current phase, blocker, next step, and pointers.

Use detailed planning files only for complex task execution tracking, not for persistent memory storage.

- `task_plan.md` is the detailed execution source when planning with files is active.
- `findings.md` stores task-scoped discoveries for that task.
- `progress.md` stores task-scoped session progress for that task.
- These planning files are local execution scratchpads, not long-term memory.

When planning files are active:

- `task_plan.md` remains the detailed execution source of truth.
- L2 active task memory becomes the startup-safe exported summary.
- L2 active task memory should point back to `task_plan.md` for full details.
- Do not merge startup-safe task memory and detailed task planning into one file.

## Planning Upgrade Rules

Default to light mode first.

- Start with L2 active task memory only.
- Do not create planning files for simple or short-lived tasks by default.
- Do not invoke detailed planning for memory-only or workflow-only maintenance tasks.

Upgrade to detailed planning when any of these become true:

- The task is likely to exceed 5 tool calls.
- The task has 2 or more real phases or deliverables.
- The task requires research, comparison, or branching approaches.
- The task includes implementation plus validation or testing.
- The task is likely to span multiple turns or be interrupted.
- The task has already produced a blocker, retry loop, or plan mutation.

If complexity was underestimated, upgrade in place:

- keep the L2 active summary,
- create `task_plan.md`, `findings.md`, and `progress.md`,
- export only the compact current snapshot back into L2 active memory.

## Active Context Rules

`Active Context` in `MEMORY.md` holds only:

- work that is still open,
- items that would block or materially affect next wake-up,
- pointers to authoritative detailed files.

Compress immediately if `Active Context` grows beyond 3 items, mixes closed work, or repeats detail that already lives in L1, L2, or L3.

## Work Log Order

L3 work logs must be maintained in reverse-chronological order.

- Newest date sections go at the top.
- Newest entries inside a date section go above older entries when practical.
- Keep milestone summaries, not execution transcripts.

## What Not To Write In `MEMORY.md`

| Do not write | Why | Where instead |
|---|---|---|
| Closed task details | Clutters index | L3 work log |
| Evidence chains | Linear narrative, not reusable | L1 experience outcomes only |
| Session transcripts | Historical, not actionable | Do not save |
| Raw command outputs | Transient data | Do not save |
| Long explanations | Index should be pointers | L1/L2/L3 files |
| Profile load lists | Duplicates config | `.pamem/config.toml` |

## Entry Discipline

Stable entries should be updated by replacement or supersession, not blind append.

Each durable entry should implicitly or explicitly support:

- `id`
- `type`
- `scope`
- `statement`
- `source`
- `status`
- `last_confirmed`
- `supersedes`, when applicable

When learning new preferences, rules, corrections, or meta-knowledge:

1. Check whether an authoritative entry already exists.
2. Update by replacement or supersession, not duplication.
3. Create a new entry only when it is a new rule or fact.
4. Keep `MEMORY.md` aligned with the current source of truth by pointer, not detail.

## Memory As Meta-Knowledge

Agent memory is the schema layer for the agent's broader knowledge system. Its purpose is not to store all knowledge, but to store the meta-knowledge that enables efficient retrieval and application of external knowledge.

### Meta Vs Domain Boundary

- Meta-knowledge belongs in L1 experience memory: methodology, principles, tool tips, workflow rules, corrected assumptions, and knowing where to look.
- Domain knowledge belongs in an external wiki, vault, project repo, or other source of truth: concepts, facts, analyses, source material, and long-form research.

When an interaction produces a durable insight, classify it:

| Classification | Destination | Examples |
|---|---|---|
| Meta: how to work better | L1 experience with `type: meta` | "use `rg --no-filename` not `rg -h`", "commit before amending" |
| Meta: corrected assumption | L1 experience with `type: correction` | "WeChat mobile UA does not bypass captcha" |
| Meta: reusable decision | L1 experience with `type: finding` | "For Chinese sites, browser path > requests" |
| Domain: concept or fact | External wiki/vault/project source | Technical concepts, source summaries, MOCs |

### Finding Writeback

During interaction, when a meta-knowledge insight is discovered, promote it immediately only if direct write is allowed by policy. Otherwise create a promotion request.

Writeback triggers:

- A tool usage revealed a non-obvious behavior or pitfall.
- A workflow assumption was proven wrong.
- A technique was discovered that would improve future interactions.
- A correction was made to a previous approach.

Writeback rules:

- Direct write: factual meta discoveries when allowed by the active profile and local policy.
- Promotion request: rule changes, workflow modifications, cross-role knowledge, or entries that supersede existing experience.
- Never write back: domain knowledge, one-off troubleshooting, simple factual lookups, task-local observations, or raw evidence.

Writeback format:

```markdown
## <Title>
- **type**: finding | correction | meta
- **scope**: <what this affects>
- **statement**: <concise statement of the insight>
- **last_confirmed**: <date>
- **supersedes**: <prior entry title>, when applicable
```

## Memory Lint

On startup or when explicitly requested, perform a quick health check on memory files:

| Check | Condition | Action |
|---|---|---|
| Stale finding | `last_confirmed` older than 90 days and not re-verified | Flag for re-confirmation |
| Superseded entry | Entry has `supersedes` pointing to another entry still present | Remove or collapse the superseded entry |
| Empty note | File has only heading or template placeholder | Remove from startup load order until populated |
| Conflicting entries | Two entries in same scope contradict each other | Flag for conflict repair |
| Orphan pointer | `MEMORY.md` or config references a note that does not exist | Remove or repair the pointer |
| Layer mismatch | Project content appears in L1, or role content appears only in L2 task state | Move or request promotion to the correct layer |
| Direct stable write | Ordinary task work changed L0/L1 without policy support | Convert to promotion request or ask for review |

Memory lint is informational by default. Conflicts and stale entries should be resolved by supersession, not silent deletion.

## Conflict Repair

When new memory conflicts with existing memory:

1. Identify the authoritative scope and precedence.
2. Mark the old rule or fact as superseded.
3. Write or request the new authoritative entry.
4. Remove or hide stale startup-visible duplicates.
5. Keep only one active source of truth per rule.

## Quality Checks

| Check | Action |
|---|---|
| `MEMORY.md` repeats note details | Replace detail with pointers |
| `Active Context` has more than 3 items | Compress or prioritize open blockers only |
| Duplicate information exists | Consolidate into one authoritative entry |
| Contradictory rules exist | Repair conflict by supersession |
| Archive is loaded by default | Remove it from startup path |
| Placeholder text remains | Fill it in or remove it |
| Project-specific content appears in L1 role/shared memory | Move it to L2 project memory |
| Role-shared experience is scattered across task files | Promote or request promotion into L1 role memory |
| Sync request is used for project delivery | Cancel and use normal project workflow |

## Anti-Patterns

| Do not | Do instead |
|---|---|
| Stuff everything in `MEMORY.md` | Organize in L1/L2/L3 and keep pointers in `MEMORY.md` |
| Keep closed work in Active Context | Move a concise summary to L3 |
| Put project-specific rules in L1 role memory | Put them in L2 project memory |
| Treat role overlay as higher priority than project rules | Let project memory override role memory |
| Repeat corrections in multiple places | Keep one authoritative entry with `type: correction` and supersession |
| Write evidence chains | Record outcome or lesson only |
| Use `sync-request` as a promotion queue | Use `requests/inbox/` or review in the task thread |
| Create unsolicited sync requests | Create them only by explicit user request or workspace policy |
| Load archive by default | Load archive only when task-relevant |

## Last Updated
2026-05-06
