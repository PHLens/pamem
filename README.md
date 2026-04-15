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
- sync-request support

It is the runtime, not the memory content itself.

## How

### Claude Code

```bash
claude plugin marketplace add git@github.com:PHLens/pamem.git
claude plugin install pamem@phlens --scope project
```

### More

- [DESIGN.md](DESIGN.md): memory layers, design philosophy, and plugin responsibilities
- [INSTALL.md](INSTALL.md): Codex install, repair, update, and removal
