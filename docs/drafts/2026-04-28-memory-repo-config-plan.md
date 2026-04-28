# Memory Repo Config Draft Plan

Status: draft for discussion
Date: 2026-04-28
Branch: `docs/cross-runtime-memory-store`

This draft captures the current direction for improving `pamem` so it can support shared memory repositories across multiple agents and runtimes without turning `pamem` into a wiki, a domain knowledge store, or a large orchestration system.

## Problem

`pamem` already provides a persistent memory runtime: governance rules, startup behavior, memory skeleton files, and sync-request support. The current default structure is intentionally local and simple.

The next use case is broader:

- multiple agents, such as developer, reviewer, architect, and QA, should be able to share one memory repository
- different runtimes should be able to load the same memory repository consistently
- role-specific behavior should not require separate memory repositories
- project-specific memory should not force a new repository for every project by default
- domain knowledge should remain outside `pamem`, especially when a LoreForge wiki is available

The main design risk is repository and concept sprawl: one memory repo, one wiki repo, multiple roles, multiple projects, and future integration code could easily become more complicated than the memory system itself.

## Goals

- Add a portable memory repository config, likely `.pamem/memory.toml`.
- Support named memory profiles for roles and runtimes.
- Keep role-specific, shared, project, and role-project memory in one repository by default.
- Keep stable memory writes gated through reviewable memory requests.
- Preserve the current `pamem` rule that `MEMORY.md` is an index, not a transcript.
- Keep `pamem` focused on memory governance and agent-local meta-knowledge.
- Keep domain knowledge and shared professional knowledge in LoreForge, not `pamem`.
- Keep sync explicit and opt-in. Config should not imply auto-push or auto-pull.
- Avoid building a large Noesis subsystem at this stage. The integration layer should stay thin.

## Non-Goals

- Do not add wiki concepts such as cards, MOCs, source notes, or promotion pipelines to `pamem`.
- Do not make `pamem` store domain facts that belong in LoreForge.
- Do not create one memory repository per role.
- Do not create one memory repository per topic.
- Do not require Git sync for local memory to function.
- Do not make automatic stable memory edits during task execution.
- Do not replace the existing V0 memory layout in a breaking way.

## Proposed Repository Shape

The current layout remains valid:

```text
MEMORY.md
notes/
  user-preferences.md
  agent-workflow.md
  experience.md
  current-task.md
  work-log.md
```

The profile-aware layout should be opt-in and backward compatible:

```text
agent-memory/
  .pamem/
    memory.toml
  MEMORY.md
  notes/
    shared/
      experience.md
      preferences.md
      workflow.md
    roles/
      developer.md
      reviewer.md
      architect.md
      qa.md
    projects/
      loreforge.md
      loreforge-developer.md
  requests/
    pending/
    promoted/
    rejected/
  archive/
```

Compatibility rule: if `.pamem/memory.toml` is absent, `pamem` must keep using the current startup load order and file locations.

## Proposed Config

Initial config should describe load paths and write targets only. It should not own memory content.

```toml
schema_version = "0.1"
name = "agent-memory"
entry_file = "MEMORY.md"
notes_dir = "notes"
requests_dir = "requests/pending"

[profiles.developer]
description = "Default coding and implementation profile."
load = [
  "MEMORY.md",
  "notes/shared/preferences.md",
  "notes/shared/workflow.md",
  "notes/shared/experience.md",
  "notes/roles/developer.md",
  "notes/projects/loreforge.md",
  "notes/projects/loreforge-developer.md",
]
write_default = "requests/pending/"
stable_targets = [
  "notes/shared/experience.md",
  "notes/roles/developer.md",
  "notes/projects/loreforge.md",
  "notes/projects/loreforge-developer.md",
]

[profiles.reviewer]
description = "Review, risk, and test coverage profile."
load = [
  "MEMORY.md",
  "notes/shared/preferences.md",
  "notes/shared/workflow.md",
  "notes/shared/experience.md",
  "notes/roles/reviewer.md",
  "notes/projects/loreforge.md",
]
write_default = "requests/pending/"
stable_targets = [
  "notes/shared/experience.md",
  "notes/roles/reviewer.md",
  "notes/projects/loreforge.md",
]
```

Profile selection can be introduced later through one or more runtime-specific mechanisms:

- `PAMEM_PROFILE`
- a Codex bootstrap option
- a Claude plugin setting
- a command-line flag in future helper scripts

## Loading Model

The runtime selects one active profile, then loads files in a stable order:

1. Constitution and plugin-provided rules.
2. Repository entry file, usually `MEMORY.md`.
3. Shared memory files.
4. Role-specific memory files for the selected profile.
5. Project-specific memory files for the current project.
6. Role-project memory files, only when explicitly configured.
7. Current task memory, only if an active task is still open.

Other role files may be searchable or manually referenced, but they should not be loaded by default. This prevents reviewer, architect, QA, and developer rules from all entering context at once.

## Routing Rules

Memory routing should prefer the narrowest stable scope that will be useful later:

| Signal | Target |
| --- | --- |
| Applies to all agents | `notes/shared/*` |
| Applies to one role | `notes/roles/<role>.md` |
| Applies to one project | `notes/projects/<project>.md` |
| Applies to one role in one project | `notes/projects/<project>-<role>.md` |
| Active task state | working memory, not stable memory |
| Domain knowledge | LoreForge, not `pamem` |
| Raw evidence or transcript | do not store as stable memory |

Role-project files should be used sparingly. Most memory should be either shared, role-specific, or project-specific.

## Memory Requests

Stable memory writes should be staged as requests first. A request is not a wiki ingest package. It is a small proposal to change agent memory.

Example:

```markdown
---
type: memory_request
status: pending
target: notes/roles/developer.md
category: finding
scope: role
profile: developer
review_required: true
source: conversation
reason: "The user corrected how implementation should be sequenced after brainstorming."
---

# Proposed Memory Update

Add a durable developer workflow rule: when a user asks for discussion or brainstorming, do not proceed into implementation until the user explicitly approves the implementation step.

## Evidence

- The user stopped direct implementation and asked to discuss first.
- The user later approved implementation explicitly.
```

Request fields should stay small and stable:

- `type`
- `status`
- `target`
- `category`
- `scope`
- `profile`
- `review_required`
- `source`
- `reason`

## Promotion Model

Promotion should be explicit:

1. Read pending request.
2. Validate request shape and target path.
3. Check for duplicate or conflicting memory.
4. Apply concise stable memory update.
5. Update `MEMORY.md` only if a new pointer is needed.
6. Move request to `requests/promoted/` with status metadata, or to `requests/rejected/` with a reason.

Promotion can be manual at first. Automation should only be added after the file contract is stable.

## Repository Count Rule

Repository boundaries should follow trust, sync, and lifecycle boundaries, not role or topic boundaries.

Default:

- one personal or team memory repository
- one LoreForge wiki repository per shared knowledge base
- optional project memory repositories only for long-lived projects with different sync or access requirements

Do not create separate memory repositories for developer, reviewer, architect, and QA. Represent those as profiles inside one memory repository.

## LoreForge Boundary

`pamem` and LoreForge should remain complementary:

- `pamem` manages agent memory, behavior, preferences, corrections, reusable findings, and meta-knowledge
- LoreForge manages shared professional knowledge, source-backed notes, domain knowledge, and wiki promotion
- future integration should route residue to either a `pamem` memory request or a LoreForge staged package
- the routing layer should be thin and should not become a new large Noesis subsystem

In this model, Noesis can remain the umbrella idea for a future integrated system, but the near-term implementation should be module-first:

- `pamem` for memory
- LoreForge for wiki knowledge
- a small writeback router between them

## Phased Plan

### Phase 0: Draft and Review

- Capture this plan.
- Review scope with the user.
- Decide file paths, naming, and minimum config fields.

### Phase 1: Config Discovery Only

- Add discovery for `.pamem/memory.toml`.
- Parse and validate schema version.
- Print or expose resolved profile load paths.
- Keep existing behavior unchanged if config is absent.

### Phase 2: Profile-Aware Startup Loading

- Allow selecting a profile.
- Resolve configured load paths.
- Preserve existing V0 load order as fallback.
- Add clear diagnostics for missing optional vs required files.

### Phase 3: Memory Request Queue

- Add `requests/pending/`, `requests/promoted/`, and `requests/rejected/` skeletons.
- Add request templates.
- Add lint for required frontmatter and valid target paths.
- Keep memory writes staged by default.

### Phase 4: Promotion Helper

- Add a small helper for promoting approved requests.
- Keep it conservative: validate, patch target, move request.
- Do not auto-decide what should be accepted.

### Phase 5: Optional Registry and Sync Integration

- Consider a lightweight registry only after profile config works.
- Integrate with existing sync-request behavior without making sync mandatory.
- Keep repository count under control by documenting repo boundary rules.

## Open Questions

- Should the config path be `.pamem/memory.toml`, `memory.toml`, or both with one preferred?
- Should role files live under `notes/roles/` or `notes/profiles/`?
- Should project-role files use `notes/projects/<project>-<role>.md` or nested directories?
- Should request metadata use Markdown frontmatter, JSON, or TOML?
- Which runtime should implement profile selection first: Codex bootstrap or Claude plugin settings?
- Should `requests/` be created by default or only when memory requests are first enabled?

## Recommended Next Step

Keep this branch as the planning branch. After review, convert the accepted parts into a narrow implementation spec for Phase 1 only: config discovery, schema validation, and diagnostics with no memory behavior change.
