---
name: memory-rule
description: Governs agent memory loading, writing, promotion, compression, conflict repair, and archiving. Use when maintaining MEMORY.md, notes/, or any persistent memory so agent behavior stays stable across sessions without turning memory into an unstructured log.
---

# Memory Rule

This plugin skill governs how persistent memory is structured, loaded, updated, promoted, and archived.

## Hard Boundary

- This skill is the memory constitution, not a fact store.
- Do not put dynamic task facts inside this skill.
- Do not use `MEMORY.md` as a transcript, diary, or evidence chain.
- Stable rules may constrain memory updates; mutable memory must not redefine stable rules.

## Core Principle

**`MEMORY.md` is an index, not a transcript.**

```
MEMORY.md = Startup index (pointers only, keep short)
notes/    = Structured content storage
```

- Keep persistent memory files in English unless there is an explicit local exception.

## Multi-Instance Concurrency

When multiple agent instances run concurrently on different tasks, shared memory files become write-contended. The following rules prevent data loss and merge conflicts.

### Principles

- Shared memory (`MEMORY.md`, `notes/current-task.md`, `notes/work-log.md`, `notes/projects/`) is **read-only during task execution**.
- All task state lives in the task worktree (`task_plan.md`, `findings.md`, `progress.md`).
- Shared memory writes are deferred to **task completion** only.

### Pointer Format

When multiple instances may be active, pointer files use a list format so entries from different instances coexist:

- `MEMORY.md` Active Context: one line per active task, format `<project>: <brief description> → <pointer to notes/projects/ file>`.
- `notes/current-task.md`: list of active worktrees with one-line descriptions, format `<worktree-path> → <one-line task description>`.

On task start, add an entry. On task end, remove it and summarize into `notes/projects/<project-key>.md`.

### Conflict Tolerance

If last-write-wins occurs on a pointer file:

- The loss is limited to a pointer line, not task content.
- Full state is recoverable from the worktree's `progress.md`.
- Do not attempt file-locking or atomic-append protocols; the pointer format makes them unnecessary.

### Write Sequencing

1. **Task start:** Add pointer line to `notes/current-task.md` (and `MEMORY.md` Active Context if needed).
2. **Task execution:** Write only to worktree-local files. Read shared memory freely.
3. **Task completion:** Remove pointer from `notes/current-task.md`, update `notes/projects/<project-key>.md`, optionally append to `notes/work-log.md`.

## Memory Layers

### Layer 0: Constitution

- This skill and any non-editable startup rules
- Defines structure, precedence, write gates, and lifecycle
- Must not be auto-mutated by the agent

### Shared Communication Baseline

The following communication rules are treated as Layer 0 shared rules:

- Private or DM-scoped content is private by default; do not forward or restate it outside the intended audience unless explicitly asked
- Reply in the same conversation or thread by default; do not reroute the discussion unless explicitly requested
- Treat `@someone` as the intended actor by default; do not take over instructions aimed at another person unless explicitly delegated
- Visible replies should add new information; avoid empty acknowledgments or status noise

### Layer 1: Stable Memory

- Long-term user preferences
- Agent-local workflow rules
- Project or repo workflow rules
- Durable corrections and prohibitions
- Reusable technical findings with future decision value
- Methodological experience gained during interaction (meta-knowledge)

### Layer 2: Working Memory

- Current task state
- Current blocker
- Next step
- Current branch, PR, or resumable execution state

### Layer 3: Archive

- Closed-task summaries
- Historical snapshots
- Old findings or logs that are no longer startup-relevant

## Plugin Skill Identity

- `memory-rule` is a plugin-provided skill entry point, not a note file.
- `sync-request` is a plugin-provided skill entry point, not a note file.
- Memory files may reference these skills as procedures to apply, but they should not imply that a file like `notes/memory-rules.md` is the source of truth.

## Startup Load Order

On wake-up, load in this order:

1. `MEMORY.md`
2. `notes/user-preferences.md`
3. `notes/agent-workflow.md`
4. `notes/findings.md`
5. Active project rules, if present
6. `notes/current-task.md`, only if a task is still open

Do not auto-load archive files unless the current task explicitly depends on them.

## Precedence Rules

When rules conflict, higher precedence wins:

1. Constitution
2. Shared global rules
3. Role-specific rules
4. Agent-local workflow rules
5. Project rules
6. User preferences
7. Working memory
8. Archive

Lower-precedence memory may extend but must not override higher-precedence rules.

## Agent Workflow Boundary

- `notes/agent-workflow.md` is for agent-local, durable workflow or communication rules.
- The shared development flow belongs to the `shared-devflow` skill, not to `notes/agent-workflow.md`.
- `notes/agent-workflow.md` may supplement that shared flow, but it must not redefine or override it.

## Write Gate

Before writing any memory, classify it:

- Is it stable across sessions?
- Will it affect future decisions or behavior?
- Is it a rule, preference, correction, reusable finding, or active task state?
- Is it a summary rather than raw evidence?
- Does an existing entry already cover it?

If the answer is no to long-term value, do not write it to stable memory.

## Where to Write

| Type | Where | Notes |
|------|-------|-------|
| Collaboration preferences | `notes/user-preferences.md` | Durable communication and collaboration preferences |
| Agent-local workflow rules | `notes/agent-workflow.md` | Agent-local workflow and communication rules that remain stable across projects; they supplement but do not replace the shared `shared-devflow` skill |
| Project-specific rules | `notes/projects/<project-key>.md` | Project-specific workflow, environment, or repository policy |
| Error corrections and prohibitions | `notes/findings.md` | Corrected assumptions with `type: correction`; merged into findings to avoid split source of truth |
| Reusable technical findings | `notes/findings.md` | Reusable outcomes with `type: finding`; never raw evidence chains |
| Methodological meta-knowledge | `notes/findings.md` | Learnings about how to work better with `type: meta`; e.g. tool tips, workflow improvements |
| Active task state | `notes/current-task.md` | Only the current task summary and next-step state |
| Closed task summaries | `notes/work-log.md` | Summary only, never full transcripts; keep newest entries first |

## Current Task vs Planning Files

Use `notes/current-task.md` as the default working-memory summary file.

- `notes/current-task.md` is the startup-safe summary for the current task
- Keep it short: task, status, current phase, blocker, next step, and pointers
- Load it by default only when a task is still open

Use `planning-with-files` only for complex task execution tracking, not for persistent memory storage.

- `task_plan.md` is the detailed execution source when `planning-with-files` is active
- `findings.md` stores task-scoped discoveries for that task
- `progress.md` stores task-scoped session progress for that task
- These planning files are local execution scratchpads, not long-term memory

When `planning-with-files` is active:

- `task_plan.md` remains the detailed execution source of truth
- `notes/current-task.md` becomes the startup-safe exported summary
- `notes/current-task.md` should point back to `task_plan.md` for full details

Do not merge `notes/current-task.md` and `task_plan.md` into one file.

- `notes/current-task.md` is for wake-up, resume, and compact recovery
- `task_plan.md` is for phased execution and detailed task management

Recommended `notes/current-task.md` template:

When multiple instances may be active, use the pointer-list template:

```markdown
# Current Task

## Active Worktrees
- `<worktree-path>` → <one-line task description>
```

When only a single instance is active, the full template (Task, Project, Status, Current Phase, Blocker, Next Step, Source of Truth) may still be used.

## Planning Upgrade Rules

Default to light mode first.

- Start with `notes/current-task.md` only
- Do not create planning files for simple or short-lived tasks by default
- Do not invoke `planning-with-files` for memory-only or workflow-only maintenance tasks

Upgrade to `planning-with-files` when any of these become true:

- The task is likely to exceed 5 tool calls
- The task has 2 or more real phases or deliverables
- The task requires research, comparison, or branching approaches
- The task includes implementation plus validation or testing
- The task is likely to span multiple turns or be interrupted
- The task has already produced a blocker, retry loop, or plan mutation

If complexity was underestimated, upgrade in place.

- Keep `notes/current-task.md`
- Create `task_plan.md`, `findings.md`, and `progress.md`
- Export only the compact current snapshot back into `notes/current-task.md`

## Planning Integration Rules

Planning files feed memory by summary and promotion, not by direct persistence.

- `task_plan.md`, `findings.md`, and `progress.md` remain task-local execution records
- `notes/current-task.md` is the exported recovery summary for startup and compact recovery
- `notes/work-log.md` stores the closed-task summary
- Only reusable findings, corrections, meta-knowledge, or durable rules may be promoted into stable memory

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

## Promotion and Demotion

Promote to stable memory only when:

- Explicitly requested by the user
- Clearly durable across tasks
- Repeated often enough to be a reliable rule or preference
- Likely to affect future behavior

Keep in working memory when:

- Relevant only to the current task
- Useful for resume and recovery
- Likely to expire at task completion

Archive when:

- The task is closed
- A concise summary is enough for future recall
- Detailed process history is no longer needed in startup context

When a task closes:

- Remove it from `notes/current-task.md`
- Keep only a concise summary in `notes/work-log.md`
- Do not preserve `task_plan.md`, `findings.md`, or `progress.md` as long-term memory by default

## Work Log Order

`notes/work-log.md` must be maintained in reverse-chronological order.

- Newest date sections go at the top
- Newest entries inside a date section go above older entries when practical
- Keep milestone summaries, not execution transcripts

## Active Context Rules

`Active Context` in `MEMORY.md` holds only:

- Work that is still open
- Items that would block or materially affect next wake-up
- Pointers to the authoritative detailed files

**Compression trigger:** Compress immediately if `Active Context` grows beyond 3 items, mixes closed work, or repeats detail that already lives in `notes/`.

## What NOT to Write in MEMORY.md

| Don't Write | Why | Where Instead |
|-------------|-----|---------------|
| Closed task details | Clutters index | `notes/work-log.md` |
| Evidence chains | Linear narrative, not reusable | `notes/findings.md` (outcomes only) |
| Session transcripts | Historical, not actionable | Not saved |
| Raw command outputs | Transient data | Not saved or summarized in findings |
| Long explanations | Index should be pointers | `notes/` files |

## Update Discipline

### When updating `MEMORY.md`

1. Ask whether the item is index-worthy or belongs in `notes/`
2. Keep only a pointer in `MEMORY.md`
3. Write details in the authoritative notes file
4. Remove stale or duplicate startup-visible entries

### When learning new preferences, rules, corrections, or meta-knowledge

1. Check whether an authoritative entry already exists
2. Update by replacement or supersession, not duplication
3. Create a new entry only when it is a new rule or fact
4. Keep the pointer list in `MEMORY.md` aligned with the current source of truth

### When task completes

1. Do not expand `Active Context` with completion details
2. Move the final summary to `notes/work-log.md`
3. Remove the task from `Active Context`
4. Clear `notes/current-task.md` or replace it with the next open task

## File Structure

```
<agent-workspace>/
├── MEMORY.md              # Startup index only
└── notes/
    ├── user-preferences.md
    ├── agent-workflow.md
    ├── findings.md
    ├── current-task.md
    ├── work-log.md
    └── projects/
        └── <project-key>.md
```

## Compression Rules

- `MEMORY.md` stays short and pointer-based
- `Active Context` contains only open and blocking items
- Closed work leaves startup-visible memory immediately
- Archive stores summaries, not step-by-step logs
- If a file becomes repetitive, consolidate and supersede instead of appending

## Memory as Meta-Knowledge

Agent memory is the **schema layer** for the agent's entire knowledge system. Its purpose is not to store all knowledge, but to store the meta-knowledge that enables efficient retrieval and application of external knowledge.

### Meta vs Domain Boundary

- **Meta-knowledge** (write to `notes/`): methodology, principles, tool tips, workflow rules, corrected assumptions, "knowing where to look"
- **Domain knowledge** (write to external wiki/vault): concepts, facts, analyses, source material

When an interaction produces a durable insight, classify it:

| Classification | Destination | Examples |
|---|---|---|
| Meta: how to work better | `notes/findings.md` with `type: meta` | "use `rg --no-filename` not `rg -h`", "commit before amending" |
| Meta: corrected assumption | `notes/findings.md` with `type: correction` | "WeChat mobile UA does not bypass captcha" |
| Meta: reusable decision | `notes/findings.md` with `type: finding` | "For Chinese sites, browser path > requests" |
| Domain: concept or fact | External wiki/vault | Technical concepts, source summaries, MOCs |

### Finding Writeback

During interaction, when a meta-knowledge insight is discovered, promote it immediately rather than waiting for task completion.

Writeback triggers (any of):

- A tool usage revealed a non-obvious behavior or pitfall
- A workflow assumption was proven wrong
- A technique was discovered that would improve future interactions
- A correction was made to a previous approach

Writeback rules:

- **Auto-write**: factual meta discoveries (tool tips, environment quirks, corrected assumptions) — write directly to `notes/findings.md`
- **Confirm first**: rule changes, workflow modifications, or entries that supersede existing findings — propose to user before writing
- **Never write back**: domain knowledge, one-off troubleshooting, simple factual lookups, task-local observations

Writeback format — each entry in `notes/findings.md`:

```markdown
## <Title>
- **type**: finding | correction | meta
- **scope**: <what this affects>
- **statement**: <concise statement of the insight>
- **last_confirmed**: <date>
- **supersedes**: <prior entry title>, when applicable
```

### MEMORY.md Summaries

Each entry in `MEMORY.md` Key Knowledge should include a one-line summary after the dash, so the agent can decide whether to load a file without reading it first.

Format:

```markdown
## Key Knowledge
- `notes/findings.md` — 4 findings: MCP config, Inkscape render, topic-research browser, topic-research arch
- `notes/user-preferences.md` — note ops, autonomy, comms style, vault path
```

This enables **selective loading**: on startup, read `MEMORY.md` first, then load only the notes files relevant to the current context instead of all files unconditionally.

### Memory Lint

On startup or when explicitly requested, perform a quick health check on `notes/`:

| Check | Condition | Action |
|---|---|---|
| Stale finding | `last_confirmed` older than 90 days and not re-verified | Flag for re-confirmation |
| Superseded entry | Entry has `supersedes` pointing to another entry still present | Remove or collapse the superseded entry |
| Empty note | File has only heading or template placeholder | Remove from startup load order until populated |
| Conflicting entries | Two entries in same scope contradict each other | Flag for conflict repair |
| Orphan pointer | MEMORY.md references a note that does not exist | Remove the pointer |

Memory lint is informational only — it reports issues but does not auto-fix. Conflicts and stale entries should be resolved by supersession, not deletion.

## Conflict Repair

When new memory conflicts with existing memory:

1. Identify the authoritative scope and precedence
2. Mark the old rule or fact as superseded
3. Write the new authoritative entry
4. Remove or hide stale startup-visible duplicates
5. Keep only one active source of truth per rule

## Quality Checks

| Check | Action |
|------|--------|
| `MEMORY.md` repeats note details | Replace detail with pointers |
| `Active Context` > 3 items | Compress or prioritize open blockers only |
| Duplicate information exists | Consolidate into one authoritative entry |
| Contradictory rules exist | Repair conflict by supersession |
| Archive is loaded by default | Remove it from startup path |
| Placeholder text remains | Fill it in or remove it |

## Role-Specific Extensions

Role-specific memory rules extend (not replace) these base rules:
- Shared role workflow skills define role-default execution flow
- Agent-local workflow files and project rule files may supplement that flow without overriding it

## Integration with Common Notes

If agent has access to shared notes repo:
- Common rules apply to all agents (communication, memory structure)
- Role-specific rules apply only to matching roles
- Private agent notes store agent-specific experience or task-local state

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| Stuff everything in MEMORY.md | Organize in notes/ directory |
| Keep closed work in Active Context | Move to work-log.md |
| Repeat corrections in multiple places | Single authoritative entry in `notes/findings.md` with `type: correction` |
| Write evidence chains | Record outcome/lesson only |
| Create new notes file for one-time info | Add to an existing appropriate file |
| Append contradictory rules | Supersede old entries explicitly |
| Load archive by default | Load archive only when task-relevant |

## Last Updated
2026-04-26
