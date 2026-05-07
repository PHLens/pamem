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
config.toml or .pamem/config.toml = machine-readable profile, runtime, memory repo location, load, write, and sync policy when present
L0/ or this skill   = constitution and governance
L1/ or notes/       = stable shared, role, preference, and experience memory
L2/ or notes/       = project memory
L3/ or notes/       = archive summaries not loaded by default, usually CLI-local
requests/           = reviewable memory-promotion requests
XDG data agent home = CLI runtime-local config and task recovery by agent id
.pamem/scripts/memory-sync.sh = repo-level sync helper for the configured memory repo backend
sync-request        = separate request-generation skill for cross-device retention
```

Keep persistent memory files in English unless there is an explicit local exception.

## Supported Layouts

Pamem supports both the current per-agent notes scaffold and a shared memory repo layout. Prefer the shared layout when multiple agents should reuse stable memory. The default shared repo is machine-local at `${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory`; default CLI agent homes live under `${XDG_DATA_HOME:-$HOME/.local/share}/pamem/agents/<agent-id>/` and hold config plus runtime-local state. Legacy or Slock workspaces may keep `.pamem/config.toml` and workspace-local hooks; in Slock mode, the Slock-generated agent workspace is the config/hook anchor, not the shared memory repo.

### Shared Memory Repo

```text
${XDG_DATA_HOME:-~/.local/share}/pamem/
  agents/<agent-id>/
    config.toml        # points at memory_repo.path
    current-task.md
    work-log.md
  memory/
    MEMORY.md
    L0/
    L1/
    L2/

<legacy-or-slock-workspace>/
  .pamem/
    config.toml        # compatibility/source-of-truth for that workspace

memory/
  MEMORY.md
  L0/
    constitution.md
  L1/
    shared/
      preferences.md
      operating-rules.md
      experience.md
    roles/
      coder.md
      reviewer.md
      researcher.md
      onboarding.md
      wiki.md
  L2/
    projects/
      <project-key>.md
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
    operating-rules.md
    experience.md
    current-task.md
    work-log.md
    projects/
      <project-key>.md

```

Map fallback files to the same layers:

- `notes/user-preferences.md`, `notes/operating-rules.md`, and `notes/experience.md` are L1.
- `notes/projects/<project-key>.md` is L2.
- XDG data `pamem/agents/<agent-id>/current-task.md` and `work-log.md` are the preferred CLI runtime files when `pamem start` or `resume` is used.
- `notes/current-task.md` and `notes/work-log.md` are CLI-local compatibility files, not durable shared memory layers.

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
- role-shared memory such as `L1/roles/coder.md`, `L1/roles/reviewer.md`, and `L1/roles/wiki.md`

Role memory belongs in L1 because it is stable shared experience for a role. It is loaded through a profile overlay and does not outrank project-specific rules.

### Layer 2: Project Memory

Layer 2 contains specific project context.

Examples:

- `L2/projects/<project-key>.md`
- `notes/projects/<project-key>.md`

Project-specific memory belongs in L2, not L1. Project context usually changes faster than role experience and should not pollute global stable memory.
Runtime task state is handled outside the shared memory repo.

### Layer 3: Archive

Layer 3 preserves closed-task summaries and historical context that should not be loaded by default.

Examples:

- `L3/archive/<date-or-task>.md`
- `notes/work-log.md` in CLI runtime mode

Archive stores summaries, not transcripts or raw evidence chains.

## Profile Configuration

When local `config.toml` or `.pamem/config.toml` exists, it is the machine-readable source for profiles, runtime mode, memory repo location, sharing mode, load targets, write targets, and sync policy. `MEMORY.md` should point to it instead of duplicating its details.

For onboarding, seed `config.toml` or `.pamem/config.toml` from `assets/config.toml.template` and then replace the placeholders with the agent's actual repo path, sharing mode, sync backend, queue root, executor, and profile owners. If the workspace should default to a different role, use the matching standalone starter in `assets/config-profiles/`.

The wiki profile stores curation workflow, knowledge pointers, and sync handoff memory; domain knowledge itself belongs in the external wiki.

Only one `default_profile` should be active in a workspace at a time. Role-specific starters are separate entry points, not simultaneous overlays.
Profile selection happens during onboarding, preferably through `pamem init`. After an agent starts, runtime hooks and ordinary task agents must treat `default_profile` as read-only; switching profile requires deliberate re-onboarding and restart.

The shared repo is resolved through:

```toml
[memory_repo]
path = "${XDG_DATA_HOME:-$HOME/.local/share}/pamem/memory"
sharing = "shared"
entry_file = "MEMORY.md"

[runtime]
mode = "cli"

[runtime.resume]
command = []

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
  "L1/shared/operating-rules.md",
  "L1/shared/experience.md",
  "L1/roles/coder.md",
  "L2/projects/pamem.md"
]
write = [
  "L2/projects/pamem.md",
  "requests/inbox/"
]
guarded_write = [
  "L1/roles/coder.md"
]
```

Rules:

- Profiles describe what to load; they do not create new precedence.
- Profile choice is fixed at onboarding time; do not switch profiles dynamically inside an active agent session.
- `runtime.resume.command`, when set, is the runtime-native resume launcher; otherwise `pamem resume` may reuse the last launcher recorded by `pamem start -- <launcher>`.
- Role-specific memory is a profile overlay loaded from L1.
- Project memory is loaded from L2 and wins over role memory on conflict.
- Ordinary task agents should write project memory and promotion requests, not mutable task state in the shared repo.
- `guarded_write` means the agent may update the target only when the change is high-confidence, reusable across tasks, and allowed by local policy; otherwise create a promotion request.
- Config changes that alter ownership, precedence, or sync policy should be treated as governance changes and reviewed by the config owner or onboarding profile.
- If no config exists, use the per-agent notes fallback load order.

## Startup Load Workflow

On wake-up:

1. Read `MEMORY.md`.
2. If present, read local `config.toml` or `.pamem/config.toml`, resolve `memory_repo.path`, and select the requested or default profile.
3. Load the repo entry file from `memory_repo.entry_file`; default is `MEMORY.md`.
4. Load L0 constitution sources for that profile.
5. Load L1 shared memory.
6. Load the L1 role overlay for the profile.
7. Load L2 project memory for the active project.
8. If runtime mode is `cli`, load hook-provided or XDG data CLI current-task/work-log state when present, falling back to `notes/current-task.md` and `notes/work-log.md` as compatibility files.
9. Do not load L3 archive or `requests/` by default.
10. If runtime mode is `slock`, treat Slock task state and workspace files as the source of truth for active work.

Fallback load order when local config is absent:

1. `MEMORY.md`
2. `notes/user-preferences.md`
3. `notes/operating-rules.md`
4. `notes/experience.md`
5. `notes/projects/<project-key>.md`, if the current project has one
6. XDG data or `notes/current-task.md`, only in CLI runtime mode and only if a task is still open
7. XDG data or `notes/work-log.md`, only in CLI runtime mode when a summary is useful

## Precedence Rules

Current system, developer, and explicit user instructions outrank memory. Within memory, higher precedence wins:

1. L0 constitution
2. L1 shared memory
3. L2 project memory
4. L1 role memory loaded through the active profile
5. L3 archive

Lower-precedence memory may extend but must not override higher-precedence memory.
Runtime-local task files are outside this precedence list.

Important consequences:

- Project-specific memory wins over role memory.
- Role memory can provide defaults, habits, and reusable role experience, but project constraints override it.
- Runtime-local task files can record current state and next steps, but they cannot redefine stable rules.
- Archive is historical context and never an active rule source unless explicitly re-promoted.

## Write Gate

Before writing any memory, classify it:

- Is it stable across sessions?
- Will it affect future decisions or behavior?
- Is it a rule, preference, correction, reusable finding, project fact, or runtime-local task state?
- Is it a summary rather than raw evidence?
- Which layer owns it?
- Does an existing entry already cover it?
- Is direct write allowed by the active profile or local policy?

If the answer is no to long-term value, do not write it to stable memory.

## Where To Write

| Type | Shared layout | Fallback layout | Notes |
|---|---|---|---|
| Global collaboration preferences | `L1/shared/preferences.md` | `notes/user-preferences.md` | Durable communication and collaboration preferences |
| Shared operating rules | `L1/shared/operating-rules.md` | `notes/operating-rules.md` | Stable operating defaults; must not override L0 |
| Role-shared experience | `L1/roles/<role>.md` | `notes/experience.md` with role scope | Reusable role memory such as coder/reviewer/wiki habits |
| Error corrections and prohibitions | `L1/shared/experience.md` or `L1/roles/<role>.md` | `notes/experience.md` | Use `type: correction`; avoid duplicates |
| Reusable technical findings | `L1/shared/experience.md` or `L1/roles/<role>.md` | `notes/experience.md` | Outcomes only, never raw evidence chains |
| Methodological meta-knowledge | `L1/shared/experience.md` or `L1/roles/<role>.md` | `notes/experience.md` | Tool tips, workflow improvements, corrected assumptions |
| Project-specific rules and facts | `L2/projects/<project-key>.md` | `notes/projects/<project-key>.md` | Project wins over role on conflict |
| CLI current-task recovery | n/a | XDG data `pamem/agents/<agent-id>/current-task.md`, fallback `notes/current-task.md` | Runtime-local, startup-safe summary only |
| CLI work-log summary | n/a | XDG data `pamem/agents/<agent-id>/work-log.md`, fallback `notes/work-log.md` | Runtime-local summary only |
| Memory promotion request | `requests/inbox/<request-id>.md` | local request note or user-visible task thread | For review before stable writes |
| Closed task summary | `L3/archive/` | `notes/work-log.md` in CLI runtime mode | Newest first; summaries only |

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

- project-specific and still changing, or
- useful as durable project context but not stable enough for L1.

Keep runtime task state out of the shared memory repo. In CLI mode, use local
recovery notes or task-local planning files. In Slock mode, use Slock task
state, workspace files, and task threads.

In Slock runtime mode, the Slock-generated agent workspace may contain
`.pamem/config.toml` and hook/runtime links, but `[memory_repo].path` should
normally remain the machine-level shared memory repo so Slock and CLI agents can
share durable memory.

Archive to CLI-local work log or optional L3 archive when:

- the task is closed,
- a concise summary is enough for future recall, or
- detailed process history is no longer needed in startup context.

In Slock mode, ordinary task summaries stay in Slock unless a durable finding is
promoted to project or shared memory.

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

## Hook And Sync Risk Boundary

Strict write control matters because pamem is shared across agents and
runtimes.

- `SessionStart` is a read-only loader. It may report missing or oversized
  memory, but it must not create, repair, rewrite, promote, or sync shared
  memory.
- An automatic `PreCompact` hook is not part of the runtime contract. The
  `memory-pre-compact.sh` script may be used only as an explicit CLI-local
  helper for current-task state; it must not write the shared memory repo.
- `memory-sync.sh` is executor-only unless the user explicitly assigns sync
  executor responsibility. Treat `git` push, WebDAV `bisync`, and WebDAV
  `--resync` as propagation operations.
- `config.toml` or `.pamem/config.toml` changes are governance changes when they alter memory
  repo location, sharing mode, runtime mode, profile, write targets, sync
  backend, remote, ref, or executor.
- Install, onboard, and repair scripts may create or restore skeleton files;
  use them for setup/repair, not ordinary task execution.
- `requests/inbox/` is the memory promotion review queue, not a sync queue.

## Multi-Instance Concurrency

When multiple agent instances run concurrently, shared memory files become write-contended. The following rules prevent data loss and merge conflicts.

### Principles

- L0 and L1 shared files are read-only during ordinary task execution unless the active profile explicitly permits guarded write.
- `MEMORY.md` is a shared index, not an isolation boundary.
- The shared memory repo must not contain mutable active rosters or per-task runtime state.
- CLI runtime state belongs in the XDG data agent home, workspace-local compatibility notes, or task-local planning files.
- Slock runtime state belongs in the Slock task board, task threads, and workspace files.
- Stable memory writes happen at task completion or through promotion review, and only for durable future value.

### Pointer Format

When multiple instances may be active, shared `MEMORY.md` can point to durable
project notes, but it should not try to enumerate every active task.

When more than 3 instances are active, do not try to list every instance in `MEMORY.md`. Keep `MEMORY.md` as a startup dashboard:

- one line for the lead blocker, if any
- one line for the current primary workstream
- one line pointing to the relevant durable project note, if any

The full task roster belongs to the runtime: Slock stores it in the task board
and threads; CLI agents may keep a local XDG data current-task summary, with
`notes/current-task.md` as a compatibility fallback.
Compressing `MEMORY.md` removes startup noise only; it must not delete runtime
task state.

### Conflict Tolerance

If last-write-wins occurs on a shared durable memory file:

- Treat it as a memory governance conflict, not a task-state recovery path.
- Prefer promotion requests when a change might conflict or cross scopes.
- Do not attempt to use the shared memory repo as a concurrent work queue.

### Write Sequencing

1. Task start: update only the runtime-owned task surface, not the shared memory repo.
2. Task execution: keep task state in CLI local notes/planning files or in Slock task threads and workspace files.
3. Task completion: promote durable findings to L2 project memory or `requests/inbox/`; in CLI mode optionally add a concise local work-log summary; in Slock mode leave ordinary work logs in Slock.

## Current Task Vs Planning Files

Use runtime-local current-task memory only when the runtime owns no stronger task-state surface.

- CLI mode: XDG data `pamem/agents/<agent-id>/current-task.md` is the preferred local startup-safe task summary when `pamem start` or `resume` is used; `notes/current-task.md` is the compatibility fallback.
- Slock mode: the Slock task board, task thread, and workspace files are the task-state source of truth.

Keep it short: task, status, current phase, blocker, next step, and pointers.

Use detailed planning files only for complex task execution tracking, not for persistent memory storage.

- `task_plan.md` is the detailed execution source when planning with files is active.
- `findings.md` stores task-scoped discoveries for that task.
- `progress.md` stores task-scoped session progress for that task.
- These planning files are local execution scratchpads, not long-term memory.

When planning files are active:

- `task_plan.md` remains the detailed execution source of truth.
- CLI XDG data current-task state, or fallback `notes/current-task.md`, may become the startup-safe exported summary.
- Slock task state should point to the relevant task thread or workspace planning file when useful.
- Do not merge startup-safe task memory and detailed task planning into one file.

## Planning Upgrade Rules

Default to light mode first.

- Start with the runtime-owned task surface only.
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

- keep the runtime-owned task summary,
- create `task_plan.md`, `findings.md`, and `progress.md`,
- export only the compact current snapshot back into CLI local recovery notes or the Slock task thread.

## Active Context Rules

`Active Context` in `MEMORY.md` holds only:

- work that is still open,
- items that would block or materially affect next wake-up,
- pointers to authoritative detailed files.

Compress immediately if `Active Context` grows beyond 3 items, mixes closed work, or repeats detail that already lives in L1, L2, or L3.

## Work Log Order

CLI-local work logs and optional L3 archives must be maintained in reverse-chronological order.

- Newest date sections go at the top.
- Newest entries inside a date section go above older entries when practical.
- Keep milestone summaries, not execution transcripts.

## What Not To Write In `MEMORY.md`

| Do not write | Why | Where instead |
|---|---|---|
| Closed task details | Clutters index | CLI-local work log, optional L3 archive, or Slock thread |
| Evidence chains | Linear narrative, not reusable | L1 experience outcomes only |
| Session transcripts | Historical, not actionable | Do not save |
| Raw command outputs | Transient data | Do not save |
| Long explanations | Index should be pointers | L1/L2/L3 files |
| Profile load lists | Duplicates config | `config.toml` or `.pamem/config.toml` |

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

When explicitly requested or during memory review, perform a quick health check on memory files:

| Check | Condition | Action |
|---|---|---|
| Stale finding | `last_confirmed` older than 90 days and not re-verified | Flag for re-confirmation |
| Superseded entry | Entry has `supersedes` pointing to another entry still present | Remove or collapse the superseded entry |
| Empty note | File has only heading or template placeholder | Remove from startup load order until populated |
| Conflicting entries | Two entries in same scope contradict each other | Flag for conflict repair |
| Orphan pointer | `MEMORY.md` or config references a note that does not exist | Remove or repair the pointer |
| Layer mismatch | Project content appears in L1, or role content appears only in runtime-local task state | Move or request promotion to the correct layer |
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
2026-05-07
