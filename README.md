# pamem

`pamem` is a persistent agent memory runtime.

## Why

Persistent agent memory becomes unstable when every workspace assembles its own memory setup by hand.

Common failure modes are:

- inconsistent startup hooks
- missing or drifting memory skeleton files
- `MEMORY.md` growing into a log instead of staying an index
- agents sharing memory concepts without sharing the same runtime

`pamem` exists to provide one shared memory runtime for persistent agents.

## What

It packages the shared Layer 0 runtime for agent memory so new workspaces do not need to hand-assemble:

- memory governance
- startup hooks
- memory skeleton files
- sync-request support

`pamem` is the runtime, not the memory itself. Agent-local preferences, workflow rules, project notes, and task state still live in each workspace.

Here, **Layer 0** means the shared memory constitution:

- what files exist
- what gets loaded on startup
- what counts as stable memory vs working memory
- what must never be written into long-term memory
- what hooks or runtime checks enforce those rules

The full model has **4 layers**:

- **Layer 0: Constitution**  
  Shared runtime rules. This is the memory operating model: structure, startup loading, precedence, write gates, and guardrails.
- **Layer 1: Stable Memory**  
  Durable information that should survive across tasks: user preferences, agent-local workflow rules, project rules, durable corrections, reusable findings.
- **Layer 2: Working Memory**  
  Current task state: active task, phase, blocker, next step, resumable execution context.
- **Layer 3: Archive**  
  Closed-task summaries and historical context that should not be loaded by default at startup.

`pamem` does **not** own all 4 layers equally.

- It **directly manages Layer 0**
- It **creates the base file structure for Layers 1-3**
- It **does not manage the actual content inside Layers 1-3**

Concretely:

- **Layer 0 via `pamem`**
  - ships `memory-rule`
  - ships `sync-request`
  - installs startup hooks
  - defines the default memory skeleton
- **Layer 1 via workspace files created by `pamem`**
  - `notes/user-preferences.md`
  - `notes/agent-workflow.md`
  - `notes/corrections.md`
  - `notes/projects/*`
- **Layer 2 via workspace files created by `pamem`**
  - `notes/current-task.md`
- **Layer 3 via workspace files created by `pamem`**
  - `notes/work-log.md`

So the plugin's job is:

- provide the shared memory runtime
- create the right files
- make startup loading deterministic

It is **not** responsible for deciding the actual long-term preferences, project rules, task details, or archive content for a given agent.

It provides:

- `memory-rule`
- `sync-request`
- Claude `SessionStart` and `PreCompact` hooks
- Codex bootstrap scripts
- `MEMORY.md` and `notes/` templates

## Design Philosophy

- **Stable governance, local data**: the runtime is shared, but each agent still owns its own memory content.
- **Thin index, not transcript**: `MEMORY.md` should stay a startup-safe index, not become a running log.
- **Explicit promotion**: only durable rules, preferences, corrections, and reusable findings should move into stable memory.
- **Startup-safe by default**: a new or resumed session should recover the right memory structure without manual repair.
- **Portable by default**: generated runtime state should avoid machine-specific leakage.
- **Runtime over content**: the plugin manages the memory system, not the agent's actual memories.

## Install Guide

### Claude Code

```bash
claude plugin marketplace add git@github.com:PHLens/pamem.git
claude plugin install pamem@phlens --scope project
```

### Codex

See [INSTALL.md](INSTALL.md) for:

- Codex install, bootstrap, and repair
- verification steps
- update and removal notes
