---
name: memory-rule
description: Governs profile-based agent memory loading, semantic shared-memory paths, promotion, compression, sync-request handoff, conflict repair, and archiving. Use when maintaining MEMORY.md, notes/, shared memory repos, or any persistent memory so agents keep stable behavior without turning memory into an unstructured log.
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
governance/ or this skill = constitution and governance
shared/ or notes/         = stable shared preferences, rules, and cross-role experience
roles/                    = role guides and role-scoped experience
projects/ or notes/       = project memory
archive/ or notes/        = archive summaries not loaded by default, usually CLI-local
requests/           = reviewable memory-promotion requests
XDG data agent home = CLI runtime-local config and task recovery by agent id
git push / repo propagation = executor-only write path for the configured memory repo
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
    governance/
    shared/
    roles/
    projects/
    archive/
    requests/

<legacy-or-slock-workspace>/
  .pamem/
    config.toml        # compatibility/source-of-truth for that workspace

memory/
  MEMORY.md
  governance/
    constitution.md
  shared/
    preferences.md
    operating-rules.md
    experience.md
  roles/
    coder/
      coder.md
      experience.md
    reviewer/
      reviewer.md
      experience.md
    researcher/
      researcher.md
      experience.md
    onboarding/
      onboarding.md
      experience.md
    wiki/
      wiki.md
      experience.md
  projects/
    <project-key>.md
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
    operating-rules.md
    experience.md
    current-task.md
    work-log.md
    projects/
      <project-key>.md

```

Map fallback files to the same semantic surfaces:

- `notes/user-preferences.md` and `notes/operating-rules.md` are compatibility surfaces for `shared/`.
- `shared/experience.md` is the cross-role shared experience surface loaded by profile overlays.
- `roles/<role>/<role>.md` is the startup-loaded role guide and should stay short.
- `notes/experience.md` is the compatibility surface for active role experience in `roles/<role>/experience.md` or role-local topic files.
- `notes/projects/<project-key>.md` is CLI-local compatibility for `projects/<project-key>.md`.
- XDG data `pamem/agents/<agent-id>/current-task.md` and `work-log.md` are the preferred CLI runtime files when `pamem start` or `resume` is used.
- `notes/current-task.md` and `notes/work-log.md` are CLI-local compatibility files, not durable shared memory layers.

## Memory Surfaces

### Governance

Governance defines the memory operating model:

- structure and path semantics
- startup load rules
- profile selection
- precedence and conflict rules
- write gates
- promotion and archival lifecycle
- sync-request handoff boundary

Governance includes this skill, non-editable startup rules, and `governance/constitution.md` when a shared memory repo provides one. It must not be auto-mutated by ordinary task agents.

The following communication rules are also treated as governance rules:

- Private or DM-scoped content is private by default; do not forward or restate it outside the intended audience unless explicitly asked.
- Reply in the same conversation or thread by default; do not reroute the discussion unless explicitly requested.
- Treat `@someone` as the intended actor by default; do not take over instructions aimed at another person unless explicitly delegated.
- Visible replies should add new information; avoid empty acknowledgments or status noise.

### Shared Memory

`shared/` contains durable memory that should survive across tasks and be reusable by multiple sessions or agents.

Examples:

- global collaboration preferences
- shared workflow rules
- durable corrections and prohibitions
- reusable technical findings with future decision value
- methodological experience and meta-knowledge
- shared cross-role experience such as `shared/experience.md`

Shared experience is loaded through the active profile overlay. It does not outrank project-specific rules.

### Role Memory

`roles/<role>/` contains durable role guidance and role-scoped experience.

Examples:

- role guides such as `roles/coder/coder.md`, `roles/reviewer/reviewer.md`, `roles/wiki/wiki.md`, and `roles/onboarding/onboarding.md`
- role-specific experience such as `roles/coder/experience.md`, `roles/reviewer/experience.md`, `roles/wiki/experience.md`, and `roles/onboarding/experience.md`
- role-local topic files for detailed on-demand workflow or findings

The role guide `roles/<role>/<role>.md` is the startup entry point for that
role. Keep high-frequency operating workflow and pointers there. Put detailed
lessons in `experience.md`, and split `experience.md` into smaller role-local
topic files when it grows too long. Role-local topic files are read on demand,
not by default.

### Project Memory

`projects/` contains specific project context.

Examples:

- `projects/<project-key>.md`
- `notes/projects/<project-key>.md`

Project-specific memory belongs in `projects/`, not `shared/` or role guides. Project context usually changes faster than role experience and should not pollute global stable memory.
Runtime task state is handled outside the shared memory repo.

### Archive

`archive/` preserves closed-task summaries and historical context that should not be loaded by default.

Examples:

- `archive/<date-or-task>.md`
- `notes/work-log.md` in CLI runtime mode

Archive stores summaries, not transcripts or raw evidence chains.

## Profile Configuration

When local `config.toml` or `.pamem/config.toml` exists, it is the machine-readable source for profiles, runtime mode, memory repo location, sharing mode, load targets, write targets, and sync policy. `MEMORY.md` should point to it instead of duplicating its details.

For onboarding, seed `config.toml` or `.pamem/config.toml` from `assets/config.toml.template` and then replace the placeholders with the agent's actual repo path, sharing mode, git remote, queue root, executor, and profile owners. If the workspace should default to a different role, use the matching standalone starter in `assets/config-profiles/`.

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
remote = ""
ref = "main"
```

Example shape:

```toml
[profiles.coder]
role = "coder"
load = [
  "governance/constitution.md",
  "shared/preferences.md",
  "shared/operating-rules.md",
  "shared/experience.md",
  "roles/coder/coder.md",
  "projects/pamem.md"
]
write = [
  "requests/inbox/"
]
guarded_write = []
```

Rules:

- Profiles describe what to load; they do not create new precedence.
- Profile choice is fixed at onboarding time; do not switch profiles dynamically inside an active agent session.
- `runtime.resume.command`, when set, is the runtime-native resume launcher; otherwise `pamem resume` may reuse the last launcher recorded by `pamem start -- <launcher>`.
- Shared experience is a profile overlay loaded from `shared/experience.md`.
- Role guides are startup-loaded overlays from `roles/<role>/<role>.md`; role
  experience and role-local topic files are read through the role guide when
  task-relevant.
- Project memory is loaded from `projects/` and wins over role memory on conflict.
- Ordinary task agents should write promotion requests or open PRs, not directly make effective shared-memory writes.
- Ordinary task agents do not start or assign the sync executor during session start; they hand off durable memory/config changes as PRs or promotion requests, and executor-side review decides when sync-executor work is activated.
- `guarded_write` is empty for ordinary bundled profiles. If a local policy adds guarded targets, treat them as PR/request candidates unless explicit executor/config-owner responsibility is assigned.
- The packaged sync executor agent lives in the pamem plugin at `agents/sync-executor.md`; it is not a memory profile and must not be copied into shared memory.
- Config changes that alter ownership, precedence, or sync policy should be treated as governance changes and reviewed by the config owner or onboarding profile.
- Humans and the sync executor can run `pamem pr-check` against the configured memory repo before merging a memory PR. The check verifies changed-file scope, guarded surfaces, and memory lint; it does not replace content review.
- If no config exists, use the per-agent notes fallback load order.

## Startup Load Workflow

On wake-up:

1. Read `MEMORY.md`.
2. If present, read local `config.toml` or `.pamem/config.toml`, resolve `memory_repo.path`, and select the requested or default profile.
3. Load the repo entry file from `memory_repo.entry_file`; default is `MEMORY.md`.
4. Load governance sources for that profile.
5. Load shared memory for that profile.
6. Load the role guide for that profile; use it to decide which role experience
   or role-local topic files are task-relevant.
7. Load project memory for the active project.
9. If runtime mode is `cli`, load hook-provided or XDG data CLI current-task/work-log state when present, falling back to `notes/current-task.md` and `notes/work-log.md` as compatibility files.
10. Do not load `archive/` or `requests/` by default.
11. If runtime mode is `slock`, treat Slock task state and workspace files as the source of truth for active work.

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

1. Governance
2. Shared memory
3. Project memory
4. Role memory loaded through the active profile
5. Archive

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
- Which memory surface owns it?
- Does an existing entry already cover it?
- Is direct write allowed by the active profile or local policy?

If the answer is no to long-term value, do not write it to stable memory.

## Where To Write

| Type | Shared layout | Fallback layout | Notes |
|---|---|---|---|
| Global collaboration preferences | `shared/preferences.md` | `notes/user-preferences.md` | Durable communication and collaboration preferences |
| Shared operating rules | `shared/operating-rules.md` | `notes/operating-rules.md` | Stable operating defaults; must not override governance |
| Cross-role shared experience | `shared/experience.md` | n/a | Durable findings shared across roles and loaded through the active profile |
| Role guide | `roles/<role>/<role>.md` | n/a | Short startup guide for high-frequency role workflow and pointers |
| Role-scoped experience | `roles/<role>/experience.md` or role-local topic files | `notes/experience.md` | Reusable role memory such as coder/reviewer/wiki habits |
| Error corrections and prohibitions | `roles/<role>/experience.md` or a role-local topic file | `notes/experience.md` | Use `type: correction`; avoid duplicates |
| Reusable technical findings | `roles/<role>/experience.md` or a role-local topic file | `notes/experience.md` | Outcomes only, never raw evidence chains |
| Methodological meta-knowledge | `shared/experience.md`, `roles/<role>/experience.md`, or a role-local topic file | `notes/experience.md` | Tool tips, workflow improvements, corrected assumptions |
| Project-specific rules and facts | `projects/<project-key>.md` | `notes/projects/<project-key>.md` | Project wins over role on conflict; CLI-local compatibility only |
| CLI current-task recovery | n/a | XDG data `pamem/agents/<agent-id>/current-task.md`, fallback `notes/current-task.md` | Runtime-local, startup-safe summary only |
| CLI work-log summary | n/a | XDG data `pamem/agents/<agent-id>/work-log.md`, fallback `notes/work-log.md` | Runtime-local summary only |
| Memory promotion request | `requests/inbox/<request-id>.md` | local request note or user-visible task thread | For review before stable writes |
| Closed task summary | `archive/` | `notes/work-log.md` in CLI runtime mode | Newest first; summaries only |

## Promotion Policy

Stable shared memory should change by promotion, not by casual append.

Promote to shared or role memory only when:

- explicitly requested by the user,
- clearly durable across tasks,
- repeated often enough to be reliable,
- likely to affect future behavior, or
- approved by a human or an onboarding profile responsible for memory curation.

Choose the target surface before editing:

- Put high-frequency role workflow that should be startup-visible in
  `roles/<role>/<role>.md`.
- Put reusable role lessons, corrections, and findings in
  `roles/<role>/experience.md`.
- Split long role experience into smaller role-local topic files when a topic
  has enough detail to be useful on demand but too much detail for startup.
- Put cross-role methods and corrections in `shared/experience.md`.
- Put project-specific facts and rules in `projects/<project-key>.md`.
- Keep Slock workspace `MEMORY.md` as a router to config, shared memory, and the
  active role guide; do not promote durable role workflow into the workspace
  router.

Use `requests/inbox/` for proposed promotions when direct write is not authorized. A promotion request should include:

- target memory surface and file
- proposed change
- source context or task pointer
- reason it is durable
- conflict or supersession notes

Promotion decisions:

- accepted changes move into the target memory file and the request moves to `requests/promoted/`.
- rejected changes move to `requests/rejected/` with a short reason.
- ordinary task agents must not silently promote contentious or cross-scope rules.

Memory PR merge rule:

- The sync executor, or a human reviewer acting as executor, decides whether a memory PR is merged.
- Every memory PR must declare its intended memory surface, such as `roles/coder/`, `projects/<project-key>.md`, or `requests/inbox/`.
- Before merge, run `pamem pr-check --head <candidate-ref> --target <declared-surface>` from an agent home or workspace that points to the target memory repo; pass `--base` only when reviewing against a protected ref other than `memory_repo.sync.ref`.
- A PR that changes files outside the declared target must be split or retargeted before merge.
- `MEMORY.md`, `governance/`, `shared/`, and active profile `guarded_write` targets require explicit guarded review and `--allow-guarded`; use the flag only after verifying the reviewer has config-owner, onboarding, sync-executor, or explicit human authority for that surface.
- `pamem pr-check` is a scope and lint gate. The reviewer still checks content quality, durability, privacy, precedence, and whether the change belongs in memory at all.

Keep in `projects/` when the content is:

- project-specific and still changing, or
- useful as durable project context but not stable enough for shared or role memory.

Keep runtime task state out of the shared memory repo. In CLI mode, use local
recovery notes or task-local planning files. In Slock mode, use Slock task
state, workspace files, and task threads.

In Slock runtime mode, the Slock-generated agent workspace may contain
`.pamem/config.toml` and hook/runtime links, but `[memory_repo].path` should
normally remain the machine-level shared memory repo so Slock and CLI agents can
share durable memory.

Archive to CLI-local work log or optional `archive/` when:

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

Repository propagation is separate from `sync-request`: it is executor-only git work after policy decides the configured memory repo should be propagated. Ordinary task agents should not run it unless explicitly assigned executor responsibility.

## Hook And Sync Risk Boundary

Strict write control matters because pamem is shared across agents and
runtimes.

- `SessionStart` is a read-only loader. It may report missing or oversized
  memory, but it must not create, repair, rewrite, promote, or sync shared
  memory.
- An automatic `PreCompact` hook is not part of the runtime contract. The
  `memory-pre-compact.sh` script may be used only as an explicit CLI-local
  helper for current-task state; it must not write the shared memory repo.
- git push is executor-only unless the user explicitly assigns sync
  executor responsibility.
- `config.toml` or `.pamem/config.toml` changes are governance changes when they alter memory
  repo location, sharing mode, runtime mode, profile, write targets, sync
  remote, ref, or executor.
- Memory PRs must pass `pamem pr-check` before merge; guarded changes require
  explicit review plus `--allow-guarded`.
- Install, onboard, and repair scripts may create or restore skeleton files;
  use them for setup/repair, not ordinary task execution.
- `requests/inbox/` is the memory promotion review queue, not a sync queue.

## Multi-Instance Concurrency

When multiple agent instances run concurrently, shared memory files become write-contended. The following rules prevent data loss and merge conflicts.

### Principles

- Governance, shared, and role files are read-only during ordinary task execution unless the active profile explicitly permits guarded write.
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
3. Task completion: promote durable findings to `projects/` or `requests/inbox/`; in CLI mode optionally add a concise local work-log summary; in Slock mode leave ordinary work logs in Slock.

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

Compress immediately if `Active Context` grows beyond 3 items, mixes closed work, or repeats detail that already lives in shared, role, project, or archive memory.

## Work Log Order

CLI-local work logs and optional `archive/` entries must be maintained in reverse-chronological order.

- Newest date sections go at the top.
- Newest entries inside a date section go above older entries when practical.
- Keep milestone summaries, not execution transcripts.

## What Not To Write In `MEMORY.md`

| Do not write | Why | Where instead |
|---|---|---|
| Closed task details | Clutters index | CLI-local work log, optional `archive/`, or Slock thread |
| Evidence chains | Linear narrative, not reusable | `shared/experience.md`, `roles/<role>/experience.md`, or a role-local topic file |
| Session transcripts | Historical, not actionable | Do not save |
| Raw command outputs | Transient data | Do not save |
| Long explanations | Index should be pointers | `shared/`, `roles/`, `projects/`, or `archive/` files |
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

- Meta-knowledge belongs in shared experience, role experience, or role-local topic memory: methodology, principles, tool tips, workflow rules, corrected assumptions, and knowing where to look.
- Domain knowledge belongs in an external wiki, vault, project repo, or other source of truth: concepts, facts, analyses, source material, and long-form research.

When an interaction produces a durable insight, classify it:

| Classification | Destination | Examples |
|---|---|---|
| Meta: how to work better | `shared/experience.md`, `roles/<role>/experience.md`, or a role-local topic file with `type: meta` | "use `rg --no-filename` not `rg -h`", "commit before amending" |
| Meta: corrected assumption | `shared/experience.md`, `roles/<role>/experience.md`, or a role-local topic file with `type: correction` | "WeChat mobile UA does not bypass captcha" |
| Meta: reusable decision | `shared/experience.md`, `roles/<role>/experience.md`, or a role-local topic file with `type: finding` | "For Chinese sites, browser path > requests" |
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
| Scope mismatch | Project content appears in shared/role memory, or role content appears only in runtime-local task state | Move or request promotion to the correct memory surface |
| Direct stable write | Ordinary task work changed governance/shared/role memory without policy support | Convert to promotion request or ask for review |

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
| Project-specific content appears in shared or role memory | Move it to `projects/` |
| Role-scoped experience is scattered across task files | Promote or request promotion into the role guide, role experience, or a role-local topic file based on startup value |
| Sync request is used for project delivery | Cancel and use normal project workflow |

## Anti-Patterns

| Do not | Do instead |
|---|---|
| Stuff everything in `MEMORY.md` | Organize in `shared/`, `roles/`, `projects/`, and `archive/`, then keep pointers in `MEMORY.md` |
| Keep closed work in Active Context | Move a concise summary to `archive/` or a work log |
| Put project-specific rules in role memory | Put them in `projects/` |
| Treat role overlay as higher priority than project rules | Let project memory override role memory |
| Repeat corrections in multiple places | Keep one authoritative entry with `type: correction` and supersession |
| Write evidence chains | Record outcome or lesson only |
| Use `sync-request` as a promotion queue | Use `requests/inbox/` or review in the task thread |
| Create unsolicited sync requests | Create them only by explicit user request or workspace policy |
| Load archive by default | Load archive only when task-relevant |

## Last Updated
2026-05-11
