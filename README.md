# pamem

`pamem` is a persistent agent memory runtime.

## Why

Persistent agent memory becomes unstable when every workspace assembles its own memory setup by hand.

`pamem` exists to provide one shared memory runtime for persistent agents.

## What

`pamem` provides the shared runtime for:

- memory governance
- startup hooks
- memory skeleton files
- shared memory repo bootstrap and config templates
- sync-request support
- sync helper entry points

It is the runtime, not the memory content itself.

## How

### Claude Code

```bash
claude plugin marketplace add git@github.com:PHLens/pamem.git
claude plugin install pamem@phlens --scope project
```

Codex bootstrap reuses that same marketplace install by symlinking the
workspace `.pamem/scripts` and `.pamem/assets` paths back to the installed
plugin runtime.

The bootstrap scripts assume `bash`, `jq`, and GNU `realpath` are available in
the workspace environment.

### More

- [DESIGN.md](DESIGN.md): memory layers, design philosophy, and plugin responsibilities
- [SYNC.md](SYNC.md): how `pamem` works with `sync-request`, the memory sync helper, and external sync executors
- [INSTALL.md](INSTALL.md): Codex install, repair, update, and removal
- `assets/config.toml.template`: starter config for onboarding a shared memory repo
- `assets/config-profiles/*.toml.template`: alternate role-specific starter configs
- `scripts/onboard-pamem.sh`: human-facing onboarding helper for selecting the initial profile config
- `scripts/memory-sync.sh`: sync helper for the configured memory repo backend

## Check

Run the lightweight repository smoke checks:

```bash
bash tests/smoke.sh
```

The smoke script requires `jq`.
